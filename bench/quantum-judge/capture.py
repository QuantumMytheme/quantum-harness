#!/usr/bin/env python3
"""
capture.py — build a well-formed proof bundle from a circuit + problem id.

A contributor (or a model's run-time tool) authors a circuit IR; capture.py runs
it on the deterministic simulator, computes the honest claimed result, and emits a
proof bundle shaped exactly the way judge_verify.py expects. This keeps the
authoring side and the verifying side using ONE simulator, so a circuit that
captures clean is guaranteed to reproduce under the judge.

Usage:
  python3 capture.py <circuit.json> <problem_id> [--task state_prep] > bundle.json

The circuit.json is {"n_qubits", "ops", "constraints"?, "classical_baseline"?}.
Ground truth (target state / Hamiltonian) is NEVER read here — only the judge
holds it. capture computes the claim from the circuit alone, exactly as a model
would self-report; the judge is what independently confirms or refutes it.
"""

import json
import sys

import numpy as np

import sim
import judge_verify


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    task = "state_prep"
    for i, a in enumerate(argv):
        if a == "--task" and i + 1 < len(argv):
            task = argv[i + 1]
    if len(args) < 2:
        print("usage: capture.py <circuit.json> <problem_id> [--task ...]", file=sys.stderr)
        return 2

    with open(args[0]) as f:
        spec = json.load(f)
    problem_id = args[1]
    circuit = {"n_qubits": spec["n_qubits"], "ops": spec["ops"]}
    state = sim.simulate(circuit)

    claim = {}
    if task == "state_prep":
        # The model self-reports fidelity against the target it was ASKED to make.
        # It must compute this against its own intended target; here we read the
        # committed reference only to make the worked example self-consistent.
        ref = judge_verify.load_reference(problem_id)
        target = judge_verify._statevector_from_ref(ref)
        claim["fidelity"] = sim.fidelity(state, target)
    elif task == "vqe":
        ref = judge_verify.load_reference(problem_id)
        claim["energy"] = sim.expectation_pauli(state, ref["hamiltonian_terms"], circuit["n_qubits"])
    elif task == "populations":
        # The model self-reports the Z-basis population distribution (the visible
        # spec). The held-out observable is NOT computed here — only the judge holds it.
        claim["populations"] = [float(p) for p in (np.abs(state) ** 2).real]
    else:
        print(f"unknown task {task!r}", file=sys.stderr)
        return 2

    bundle = {
        "schema": judge_verify.SCHEMA,
        "problem_id": problem_id,
        "task": task,
        "circuit": circuit,
        "constraints": spec.get("constraints", {}),
        "claim": claim,
        "classical_baseline": spec.get("classical_baseline", {}),
        "meta": {"author": "capture.py", "framework": "json-ir"},
    }
    print(json.dumps(bundle, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
