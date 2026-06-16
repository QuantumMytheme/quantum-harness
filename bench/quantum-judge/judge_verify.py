#!/usr/bin/env python3
"""
judge_verify.py — the verifiable bench for quantum-harness.

This is the quantum re-skin of fieldops-harness/bench/rcan-proof/judge_verify.py.
It is a SELF-CONTAINED, OFFLINE, exit-code judge: hand it a model-produced PROOF
BUNDLE and it re-derives ground truth on a deterministic simulator and either
ACCEPTS (exit 0) or REJECTS (non-zero). A committed FORGED bundle MUST be rejected.

Verification runs FOUR gates, each of which can REJECT with its own exit code,
each bound to a rubric criterion:

  STRUCTURE       (exit 3) — circuit parses; respects declared n_qubits, depth
                            budget, native gate set, coupling map, 2q-gate cap.
  REPRODUCIBILITY (exit 4) — re-simulating the circuit reproduces the CLAIMED
                            result within tolerance. The model cannot fabricate
                            a number; the judge recomputes it. (anti-overclaim)
  PERFORMANCE     (exit 5) — the verified result meets the rubric threshold AND
                            beats/ties the stated classical baseline.
  ANTI-OVERFIT    (exit 6) — the HELD-OUT generalization check. Fires for problems
                            whose reference declares a `holdout` block (an
                            observable / target the model was NEVER told). A
                            circuit that matches the VISIBLE spec but fails the
                            HIDDEN held-out check overfit the part it could see
                            and is rejected here. See the bell_pops2 problem.

Ground truth always lives ONLY in the hidden reference (references/<id>.json,
relocatable via QH_REFERENCES_DIR), never in the bundle, and the circuit IR cannot
embed a target state — so for problems WITHOUT a holdout block (e.g. ghz3,
isingbell2) anti-overfit additionally holds by construction and exit 6 is simply
not triggered.

Exit codes: 0 ok | 2 schema/parse | 3 structure | 4 reproducibility |
            5 performance | 6 anti-overfit (held-out).

Task types: state_prep, vqe, populations (state-based); architecture (topology);
classify (QML feature map). Each runs its own STRUCTURE check, then reproducibility,
performance, and — when the reference declares a held-out check — anti-overfit.

Usage:
  python3 judge_verify.py <bundle.json> [--json]
  QH_REFERENCES_DIR=/secret/refs python3 judge_verify.py <bundle.json>
"""

import json
import os
import sys

import numpy as np

import sim
import graph

SCHEMA = "quantum-harness/proof-bundle@1"

EXIT_OK = 0
EXIT_SCHEMA = 2
EXIT_STRUCTURE = 3
EXIT_REPRODUCIBILITY = 4
EXIT_PERFORMANCE = 5
EXIT_OVERFIT = 6  # held-out anti-overfit gate — raised when a declared `holdout` check fails (see docstring)


class Reject(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def _refs_dir():
    return os.environ.get(
        "QH_REFERENCES_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "references"),
    )


def load_reference(problem_id):
    path = os.path.join(_refs_dir(), f"{problem_id}.json")
    if not os.path.exists(path):
        raise Reject(EXIT_SCHEMA, f"no hidden reference for problem_id={problem_id!r} at {path}")
    with open(path) as f:
        return json.load(f)


def _statevector_from_ref(ref):
    pairs = ref["target_statevector"]
    return np.array([complex(re, im) for re, im in pairs], dtype=complex)


# ---------------------------------------------------------------------------
# Gate 1: STRUCTURE
# ---------------------------------------------------------------------------
def check_structure(circuit, constraints, checks):
    c = constraints
    n = int(circuit["n_qubits"])

    if "n_qubits" in c and n != int(c["n_qubits"]):
        raise Reject(EXIT_STRUCTURE, f"n_qubits {n} != required {c['n_qubits']}")

    native = {g.lower() for g in c.get("native_gates", [])}
    coupling = {frozenset(e) for e in c.get("coupling_map", [])}
    for i, op in enumerate(circuit.get("ops", [])):
        g = op["gate"].lower()
        qs = list(op["q"])
        if g not in sim.KNOWN_GATES:
            raise Reject(EXIT_STRUCTURE, f"op[{i}] uses gate {g!r} unknown to the simulator")
        if native and g not in native:
            raise Reject(EXIT_STRUCTURE, f"op[{i}] gate {g!r} not in native set {sorted(native)}")
        if any(q < 0 or q >= n for q in qs):
            raise Reject(EXIT_STRUCTURE, f"op[{i}] qubit index out of range: {qs}")
        if len(set(qs)) != len(qs):
            raise Reject(EXIT_STRUCTURE, f"op[{i}] repeats a qubit: {qs}")
        if len(qs) == 2 and coupling and frozenset(qs) not in coupling:
            raise Reject(EXIT_STRUCTURE, f"op[{i}] 2q gate on {qs} violates coupling map")

    depth = sim.circuit_depth(circuit)
    if "max_depth" in c and depth > int(c["max_depth"]):
        raise Reject(EXIT_STRUCTURE, f"depth {depth} exceeds budget {c['max_depth']}")

    twoq = sim.two_qubit_gate_count(circuit)
    if "max_two_qubit_gates" in c and twoq > int(c["max_two_qubit_gates"]):
        raise Reject(EXIT_STRUCTURE, f"2q-gate count {twoq} exceeds budget {c['max_two_qubit_gates']}")

    checks["structure"] = {"depth": depth, "two_qubit_gates": twoq, "n_qubits": n}


# ---------------------------------------------------------------------------
# Per-task verification (REPRODUCIBILITY + PERFORMANCE + ANTI-OVERFIT held-out)
# ---------------------------------------------------------------------------
def verify_state_prep(bundle, ref, checks):
    circuit = bundle["circuit"]
    check_structure(circuit, bundle.get("constraints", {}), checks)
    state = sim.simulate(circuit)

    # ANTI-OVERFIT spine: ground truth comes from the HIDDEN reference, not the
    # bundle. The model only knew the target *conceptually* (via the BRIEF).
    target = _statevector_from_ref(ref)
    if len(target) != len(state):
        raise Reject(EXIT_SCHEMA, "reference target dimension mismatch")

    actual = sim.fidelity(state, target)
    checks["reproduced"] = {"fidelity": actual}

    # REPRODUCIBILITY: the claimed number must match what we recompute.
    claimed = float(bundle.get("claim", {}).get("fidelity"))
    tol = float(ref.get("tolerance", {}).get("fidelity_reproduce", 1e-6))
    if abs(claimed - actual) > tol:
        raise Reject(
            EXIT_REPRODUCIBILITY,
            f"claimed fidelity {claimed:.6f} != recomputed {actual:.6f} (tol {tol:g})",
        )

    # PERFORMANCE: meet rubric threshold AND beat/tie the classical baseline.
    threshold = float(ref.get("thresholds", {}).get("fidelity"))
    if actual + 1e-12 < threshold:
        raise Reject(EXIT_PERFORMANCE, f"fidelity {actual:.6f} below threshold {threshold}")
    baseline = float(bundle.get("classical_baseline", {}).get("fidelity", 0.0))
    if actual + 1e-12 < baseline:
        raise Reject(EXIT_PERFORMANCE, f"fidelity {actual:.6f} below classical baseline {baseline}")
    checks["performance"] = {"threshold": threshold, "baseline": baseline, "achieved": actual}

    check_holdout(state, int(circuit["n_qubits"]), ref, checks)


def verify_vqe(bundle, ref, checks):
    circuit = bundle["circuit"]
    check_structure(circuit, bundle.get("constraints", {}), checks)
    state = sim.simulate(circuit)
    n = int(circuit["n_qubits"])

    # H and the exact ground-state energy live in the HIDDEN reference.
    terms = ref["hamiltonian_terms"]
    energy = sim.expectation_pauli(state, terms, n)
    checks["reproduced"] = {"energy": energy}

    claimed = float(bundle.get("claim", {}).get("energy"))
    tol = float(ref.get("tolerance", {}).get("energy_reproduce", 1e-6))
    if abs(claimed - energy) > tol:
        raise Reject(EXIT_REPRODUCIBILITY, f"claimed energy {claimed:.6f} != recomputed {energy:.6f}")

    e0 = float(ref["ground_state_energy"])
    gap_budget = float(ref.get("thresholds", {}).get("energy_gap"))
    gap = energy - e0
    if gap > gap_budget + 1e-12:
        raise Reject(EXIT_PERFORMANCE, f"energy gap {gap:.6f} above budget {gap_budget} (E0={e0})")
    # beat/tie the classical baseline (lower energy is better)
    baseline = bundle.get("classical_baseline", {}).get("energy")
    if baseline is not None and energy > float(baseline) + 1e-9:
        raise Reject(EXIT_PERFORMANCE, f"energy {energy:.6f} worse than classical baseline {baseline}")
    checks["performance"] = {"ground_state_energy": e0, "gap": gap, "gap_budget": gap_budget,
                             "baseline": baseline}

    check_holdout(state, n, ref, checks)


def check_holdout(state, n, ref, checks):
    """ANTI-OVERFIT gate (exit 6) — the held-out-generalization check.

    Fires ONLY for problems that DECLARE a held-out check (ref["holdout"]) the
    model was never told. A circuit that matches the visible spec (graded by the
    reproducibility/performance gates) but fails the hidden held-out observable /
    target overfit the part it could see, and is REJECTED here. Problems with no
    holdout block rely on anti-overfit-by-construction (exit 6 is not raised).
    """
    holdout = ref.get("holdout")
    if not holdout:
        return
    results = []
    for obs in holdout.get("observables", []):
        val = sim.expectation_pauli(state, [{"coeff": 1.0, "pauli": obs["pauli"]}], n)
        exp = float(obs["expected"])
        tol = float(obs.get("tolerance", 1e-3))
        results.append({"pauli": obs["pauli"], "expected": exp, "got": round(val, 6)})
        if abs(val - exp) > tol:
            raise Reject(
                EXIT_OVERFIT,
                f"held-out <{obs['pauli']}> = {val:.4f} != expected {exp:.4f} (tol {tol:g}); "
                f"the circuit matched the visible spec but failed the hidden held-out check",
            )
    if "target_statevector" in holdout:
        ht = np.array([complex(re, im) for re, im in holdout["target_statevector"]], dtype=complex)
        fmin = float(holdout.get("fidelity_min", 0.99))
        f = sim.fidelity(state, ht)
        results.append({"holdout_fidelity": round(f, 6), "min": fmin})
        if f + 1e-12 < fmin:
            raise Reject(EXIT_OVERFIT, f"held-out fidelity {f:.4f} below {fmin}; overfit to the visible target")
    checks["anti_overfit"] = {"checks": results, "passed": True}


def verify_populations(bundle, ref, checks):
    """A deliberately UNDER-DETERMINED task: the visible spec is a Z-basis
    population distribution (many states satisfy it), and a HELD-OUT observable
    pins down the intended one. This is where the anti-overfit gate has teeth."""
    circuit = bundle["circuit"]
    check_structure(circuit, bundle.get("constraints", {}), checks)
    state = sim.simulate(circuit)
    n = int(circuit["n_qubits"])
    probs = (np.abs(state) ** 2).real

    target = np.asarray(ref["population_target"], dtype=float)
    if target.shape[0] != probs.shape[0]:
        raise Reject(EXIT_SCHEMA, "population_target dimension mismatch")
    checks["reproduced"] = {"populations": [round(float(p), 6) for p in probs]}

    # REPRODUCIBILITY: the claimed population vector matches what we recompute.
    claimed = bundle.get("claim", {}).get("populations")
    if claimed is None:
        raise Reject(EXIT_SCHEMA, "populations task requires claim.populations")
    claimed = np.asarray(claimed, dtype=float)
    rtol = float(ref.get("tolerance", {}).get("populations_reproduce", 1e-6))
    if claimed.shape != probs.shape or float(np.max(np.abs(claimed - probs))) > rtol:
        raise Reject(EXIT_REPRODUCIBILITY, "claimed populations do not match the recomputed distribution")

    # PERFORMANCE: the populations match the visible target spec.
    mtol = float(ref.get("tolerance", {}).get("populations_match", 1e-3))
    dev = float(np.max(np.abs(probs - target)))
    if dev > mtol:
        raise Reject(EXIT_PERFORMANCE, f"populations deviate {dev:.6g} from target spec (tol {mtol:g})")
    checks["performance"] = {"max_population_deviation": round(dev, 9), "tolerance": mtol}

    # ANTI-OVERFIT (exit 6): the held-out observable the model was never told.
    check_holdout(state, n, ref, checks)


def verify_architecture(bundle, ref, checks):
    """Design a hardware coupling map (topology) for a workload of required
    two-qubit interactions. Anti-overfit = the HELD-OUT workload must also route
    within budget on the SAME topology, so a design cannot be hand-tuned to one
    circuit."""
    arch = bundle.get("architecture")
    if not arch:
        raise Reject(EXIT_SCHEMA, "architecture task requires an 'architecture' block")
    n = int(arch["n_qubits"])
    edges = arch.get("coupling_map", [])
    c = bundle.get("constraints", {})

    # STRUCTURE (exit 3): a valid hardware graph within the connectivity budget.
    if "n_qubits" in c and n != int(c["n_qubits"]):
        raise Reject(EXIT_STRUCTURE, f"n_qubits {n} != required {c['n_qubits']}")
    seen = set()
    for e in edges:
        if len(e) != 2:
            raise Reject(EXIT_STRUCTURE, f"edge {list(e)} is not a pair")
        a, b = int(e[0]), int(e[1])
        if a == b:
            raise Reject(EXIT_STRUCTURE, f"self-loop on qubit {a}")
        if not (0 <= a < n and 0 <= b < n):
            raise Reject(EXIT_STRUCTURE, f"edge {list(e)} out of range [0,{n})")
        key = (min(a, b), max(a, b))
        if key in seen:
            raise Reject(EXIT_STRUCTURE, f"duplicate edge {list(e)}")
        seen.add(key)
    max_degree = max(graph.degrees(n, edges).values(), default=0)
    if "max_degree" in c and max_degree > int(c["max_degree"]):
        raise Reject(EXIT_STRUCTURE, f"max degree {max_degree} exceeds budget {c['max_degree']}")
    if c.get("connected") and not graph.is_connected(n, edges):
        raise Reject(EXIT_STRUCTURE, "coupling map is not connected")
    checks["structure"] = {"n_qubits": n, "edges": len(seen), "max_degree": max_degree}

    # REPRODUCIBILITY (exit 4): the claimed routing cost matches what we recompute.
    cost = graph.routing_cost(n, edges, ref["workload"])
    checks["reproduced"] = {"routing_cost": cost}
    claimed = bundle.get("claim", {}).get("routing_cost")
    if claimed is None:
        raise Reject(EXIT_SCHEMA, "architecture claim requires routing_cost")
    if int(claimed) != cost:
        raise Reject(EXIT_REPRODUCIBILITY, f"claimed routing_cost {claimed} != recomputed {cost}")

    # PERFORMANCE (exit 5): within the routing budget AND beats/ties the baseline.
    budget = ref.get("thresholds", {}).get("routing_cost_max")
    if budget is not None and cost > int(budget):
        raise Reject(EXIT_PERFORMANCE, f"routing_cost {cost} over budget {budget}")
    baseline = bundle.get("classical_baseline", {}).get("routing_cost")
    if baseline is not None and cost > int(baseline):
        raise Reject(EXIT_PERFORMANCE, f"routing_cost {cost} worse than baseline {baseline}")
    checks["performance"] = {"routing_cost": cost, "budget": budget, "baseline": baseline}

    # ANTI-OVERFIT (exit 6): the held-out workload must also route within budget.
    holdout = ref.get("holdout")
    if holdout and "workload" in holdout:
        h_cost = graph.routing_cost(n, edges, holdout["workload"])
        h_budget = int(holdout["routing_cost_max"])
        checks["anti_overfit"] = {"holdout_routing_cost": h_cost, "budget": h_budget}
        if h_cost > h_budget:
            raise Reject(EXIT_OVERFIT,
                         f"held-out routing_cost {h_cost} over budget {h_budget}; "
                         f"the topology overfit the visible workload")


def _instantiate(template, x):
    """Bind data features into a feature-map template -> a concrete circuit IR."""
    ops = []
    for op in template.get("ops", []):
        if "feature" in op:
            theta = float(op.get("scale", 1.0)) * float(x[int(op["feature"])])
            ops.append({"gate": op["gate"], "q": op["q"], "params": [theta]})
        else:
            ops.append(dict(op))
    return {"n_qubits": int(template["n_qubits"]), "ops": ops}


def _predict(template, readout, x, n):
    state = sim.simulate(_instantiate(template, x))
    exp = sim.expectation_pauli(state, [{"coeff": 1.0, "pauli": readout["pauli"]}], n)
    return 1 if exp > float(readout.get("bias", 0.0)) else 0


def _accuracy(template, readout, data, n):
    if not data:
        return 0.0
    correct = sum(1 for d in data if _predict(template, readout, d["x"], n) == int(d["y"]))
    return correct / len(data)


def verify_classify(bundle, ref, checks):
    """Design a quantum feature map that classifies data. Anti-overfit = the
    HELD-OUT test set the model never saw must also be classified correctly — the
    textbook train-vs-test overfit guard."""
    fm = bundle.get("feature_map")
    readout = bundle.get("readout")
    if not fm or not readout:
        raise Reject(EXIT_SCHEMA, "classify task requires 'feature_map' and 'readout'")
    n = int(fm["n_qubits"])

    # STRUCTURE (exit 3): the feature-map template is well-formed.
    n_features = len(ref["train"][0]["x"])
    for i, op in enumerate(fm.get("ops", [])):
        if op["gate"].lower() not in sim.KNOWN_GATES:
            raise Reject(EXIT_STRUCTURE, f"op[{i}] unknown gate {op['gate']!r}")
        if any(q < 0 or q >= n for q in op["q"]):
            raise Reject(EXIT_STRUCTURE, f"op[{i}] qubit index out of range")
        if "feature" in op and not (0 <= int(op["feature"]) < n_features):
            raise Reject(EXIT_STRUCTURE, f"op[{i}] feature index {op['feature']} out of range")
    if len(readout.get("pauli", "")) != n:
        raise Reject(EXIT_STRUCTURE, f"readout pauli must have length {n}")
    checks["structure"] = {"n_qubits": n, "ops": len(fm.get("ops", []))}

    # REPRODUCIBILITY (exit 4): claimed training accuracy matches recomputed.
    train_acc = _accuracy(fm, readout, ref["train"], n)
    checks["reproduced"] = {"train_accuracy": round(train_acc, 6)}
    claimed = bundle.get("claim", {}).get("train_accuracy")
    if claimed is None:
        raise Reject(EXIT_SCHEMA, "classify claim requires train_accuracy")
    if abs(float(claimed) - train_acc) > 1e-9:
        raise Reject(EXIT_REPRODUCIBILITY, f"claimed train_accuracy {claimed} != recomputed {train_acc:.4f}")

    # PERFORMANCE (exit 5): it actually learned the visible training data.
    tr_min = float(ref.get("thresholds", {}).get("train_accuracy_min", 1.0))
    if train_acc + 1e-12 < tr_min:
        raise Reject(EXIT_PERFORMANCE, f"train accuracy {train_acc:.3f} below {tr_min}")
    checks["performance"] = {"train_accuracy": round(train_acc, 6), "min": tr_min}

    # ANTI-OVERFIT (exit 6): generalize to the HELD-OUT test set.
    holdout = ref.get("holdout", {})
    test = holdout.get("test")
    if test:
        test_acc = _accuracy(fm, readout, test, n)
        te_min = float(holdout.get("test_accuracy_min", 0.99))
        checks["anti_overfit"] = {"test_accuracy": round(test_acc, 6), "min": te_min}
        if test_acc + 1e-12 < te_min:
            raise Reject(EXIT_OVERFIT,
                         f"held-out test accuracy {test_acc:.3f} below {te_min}; "
                         f"the feature map overfit the training data")


TASKS = {
    "state_prep": verify_state_prep,
    "vqe": verify_vqe,
    "populations": verify_populations,
    "architecture": verify_architecture,
    "classify": verify_classify,
}


def verify(bundle):
    checks = {}
    if bundle.get("schema") != SCHEMA:
        raise Reject(EXIT_SCHEMA, f"schema must be {SCHEMA!r}, got {bundle.get('schema')!r}")
    task = bundle.get("task")
    if task not in TASKS:
        raise Reject(EXIT_SCHEMA, f"unknown task {task!r}")

    ref = load_reference(bundle["problem_id"])
    if ref.get("task") != task:
        raise Reject(EXIT_SCHEMA, f"reference task {ref.get('task')!r} != bundle task {task!r}")

    # Each task verifier runs its own STRUCTURE check first (circuit / topology /
    # feature-map shapes differ), then reproducibility, performance, anti-overfit.
    TASKS[task](bundle, ref, checks)
    return checks


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    if not args:
        print("usage: judge_verify.py <bundle.json> [--json]", file=sys.stderr)
        return EXIT_SCHEMA
    try:
        with open(args[0]) as f:
            bundle = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"REJECT [schema]: cannot read bundle: {e}", file=sys.stderr)
        return EXIT_SCHEMA

    try:
        checks = verify(bundle)
    except Reject as r:
        out = {"verdict": "REJECT", "code": r.code, "reason": str(r)}
        if as_json:
            print(json.dumps(out))
        else:
            print(f"REJECT [{r.code}]: {r}", file=sys.stderr)
        return r.code

    out = {"verdict": "ACCEPT", "code": 0, "problem_id": bundle.get("problem_id"),
           "task": bundle.get("task"), "checks": checks}
    if as_json:
        print(json.dumps(out))
    else:
        print(f"ACCEPT  problem={bundle.get('problem_id')} task={bundle.get('task')}")
        for k, v in checks.items():
            print(f"  {k}: {v}")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv))
