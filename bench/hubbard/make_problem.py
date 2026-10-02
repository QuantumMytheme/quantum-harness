#!/usr/bin/env python3
"""
make_problem.py: author the `hubbard2x2` VQE problem from the exact-diagonalization core.

Writes the HIDDEN reference (bench/quantum-judge/references/hubbard2x2.json) and the committed
bundles the judge regression suite grades:

  quantum-proof-hubbard2x2.json              3-layer HVA, gap ~2e-3: must ACCEPT (exit 0)
  quantum-proof-hubbard2x2-exact.json        4-layer HVA, exact ground state: must ACCEPT
  quantum-proof-hubbard2x2-FORGED.json       3-layer circuit claiming E0: must exit 4
  quantum-proof-hubbard2x2-UNDERPOWERED.json 1-layer circuit, honest claim: must exit 5
  quantum-proof-hubbard2x2-OVERFIT.json      in budget on energy, wrong correlations: must exit 6
                                             (written only if the adversarial search finds one)

Authoring needs scipy (any venv with it). The judge that grades the result stays numpy-only.
Run from the repo root:  python bench/hubbard/make_problem.py
"""

import json
import os
import sys

import numpy as np
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE_DIR = os.path.join(HERE, "..", "quantum-judge")
sys.path.insert(0, HERE)
sys.path.insert(0, JUDGE_DIR)
import ansatz as az  # noqa: E402
import hubbard as hb  # noqa: E402
import sim  # noqa: E402

U = 4.0
GAP_BUDGET = 0.01          # ~3% of the singlet-triplet gap (0.296 t): energy alone pins the state
HOLDOUT = ["ZIIIIZII", "ZIZIIIII"]   # <Z_0up Z_1dn> (nearest-neighbour), <Z_0up Z_2up> (diagonal)
HOLDOUT_TOL = 0.05
TWOQ_BUDGET = 240

cluster = hb.plaquette()
N = cluster.n_modes
terms = hb.jw_terms(cluster, U)
H = hb.pauli_matrix(terms, N)
evals, evecs = np.linalg.eigh(H)
E0, ground = float(evals[0]), evecs[:, 0]
product_best = float(np.min(np.real(np.diag(H))))   # best computational-basis (product) state


def prep():
    """Bonding orbital on each x bond, each spin: the ground state of the x-bond hopping alone."""
    ops = []
    for spin in (0, 1):
        for i, j in ((0, 1), (3, 2)):
            a, b = cluster.mode(i, spin), cluster.mode(j, spin)
            ops.append({"gate": "x", "q": [a]})
            az.hop(ops, N, a, b, np.pi / 4)
            ops.append({"gate": "rz", "q": [b], "params": [np.pi / 2]})
    return ops


PREP = prep()


def circuit(params, groups=("x", "y"), clu=cluster):
    c = az.hva(clu, list(params), [], groups)
    c["ops"] = PREP + c["ops"]
    for op in c["ops"]:
        if "params" in op:
            op["params"] = [float(v) for v in op["params"]]
    return c


def energy(c):
    psi = sim.simulate(c)
    return float(np.real(np.vdot(psi, H @ psi)))


def optimize(layers, trials=8, seed=100):
    best = None
    for k in range(trials):
        x0 = np.random.default_rng(seed + k).uniform(-0.8, 0.8, 3 * layers)
        r = minimize(lambda x: energy(circuit(x)), x0, method="BFGS", options={"gtol": 1e-11})
        if best is None or r.fun < best.fun:
            best = r
    return best.x


def observable(psi, pauli):
    return sim.expectation_pauli(psi, [{"coeff": 1.0, "pauli": pauli}], N)


def coupling_of(*circuits):
    pairs = set()
    for c in circuits:
        for op in c["ops"]:
            if len(op["q"]) == 2:
                pairs.add(tuple(sorted(op["q"])))
    return [list(p) for p in sorted(pairs)]


def overfit_search():
    """Adversarial: per-bond angles, maximize the held-out miss while keeping energy in budget.
    Honest fixture = what an optimizer that only watched the energy could land on."""
    free = hb.Cluster(cluster.n_sites, [(i, j, t, f"b{k}") for k, (i, j, t, _) in enumerate(cluster.bonds)])
    groups = tuple(f"b{k}" for k in range(len(cluster.bonds)))
    exp = [observable(ground, p) for p in HOLDOUT]

    def obj(x):
        psi = sim.simulate(circuit(x, groups, free))
        e = float(np.real(np.vdot(psi, H @ psi)))
        miss = max(abs(observable(psi, p) - v) for p, v in zip(HOLDOUT, exp))
        return -miss + 1e4 * max(0.0, e - E0 - 0.8 * GAP_BUDGET) ** 2

    best = None
    for k in range(6):
        x0 = np.random.default_rng(7 + k).uniform(-0.8, 0.8, 4 * (1 + len(groups)))
        r = minimize(obj, x0, method="Nelder-Mead", options={"maxiter": 20000, "xatol": 1e-8, "fatol": 1e-10})
        r = minimize(obj, r.x, method="BFGS")
        c = circuit(r.x, groups, free)
        psi = sim.simulate(c)
        e = float(np.real(np.vdot(psi, H @ psi)))
        miss = max(abs(observable(psi, p) - v) for p, v in zip(HOLDOUT, exp))
        print(f"  overfit trial {k}: gap {e - E0:.4f}, held-out miss {miss:.4f}", flush=True)
        if e - E0 <= GAP_BUDGET and miss > HOLDOUT_TOL and (best is None or miss > best[1]):
            best = (c, miss, e)
    return best


def bundle(c, claim, comment, constraints):
    return {
        "schema": "quantum-harness/proof-bundle@1",
        "task": "vqe",
        "problem_id": "hubbard2x2",
        "_comment": comment,
        "circuit": c,
        "constraints": constraints,
        "claim": {"energy": claim},
        "classical_baseline": {
            "energy": round(product_best, 12),
            "note": "best product (computational-basis) state: one electron per site, Neel order; no hopping energy",
        },
    }


def main():
    print(f"E0 = {E0:.12f}, singlet-triplet gap = {evals[1] - E0:.6f}, best product state = {product_best}")
    x3, x4, x1 = optimize(3), optimize(4), optimize(1, trials=4)
    c3, c4, c1 = circuit(x3), circuit(x4), circuit(x1)
    e3, e4, e1 = energy(c3), energy(c4), energy(c1)
    print(f"layers 3: gap {e3 - E0:.3e}   layers 4: gap {e4 - E0:.3e}   layers 1: gap {e1 - E0:.3e}")

    over = overfit_search()
    circuits = [c3, c4, c1] + ([over[0]] if over else [])
    depth = max(sim.circuit_depth(c) for c in circuits)
    constraints = {
        "n_qubits": N,
        "native_gates": az.NATIVE,
        "coupling_map": coupling_of(*circuits),
        "max_depth": int(depth * 1.1) + 1,
        "max_two_qubit_gates": TWOQ_BUDGET,
    }

    ref = {
        "problem_id": "hubbard2x2",
        "task": "vqe",
        "n_qubits": N,
        "_comment": (
            "2x2 Fermi-Hubbard plaquette at half filling, t = 1, U = 4, particle-hole symmetric form "
            "U sum (n_up - 1/2)(n_dn - 1/2). Jordan-Wigner, mode(site, spin) = spin * 4 + site, qubit = mode. "
            "ground_state_energy is the exact min eigenvalue of the 256x256 Pauli-sum matrix and equals the "
            "occupation-basis ED value of the (N_up, N_dn) = (2, 2) sector (bench/hubbard/test_hubbard.py check 3). "
            "The ground state is a unique singlet, 0.296 t below a triplet, so the energy budget pins the state. "
            "The held-out observables are spin-density correlations the brief never mentions: <Z_0up Z_1dn> on a "
            "nearest-neighbour bond and <Z_0up Z_2up> across the diagonal. Generated by bench/hubbard/make_problem.py."
        ),
        "hamiltonian_terms": terms,
        "ground_state_energy": E0,
        "tolerance": {"energy_reproduce": 1e-6},
        "thresholds": {"energy_gap": GAP_BUDGET},
        "constraints": constraints,
        "holdout": {
            "observables": [
                {"pauli": p, "expected": round(observable(ground, p), 6), "tolerance": HOLDOUT_TOL} for p in HOLDOUT
            ]
        },
    }
    write(os.path.join(JUDGE_DIR, "references", "hubbard2x2.json"), ref)

    write(os.path.join(JUDGE_DIR, "quantum-proof-hubbard2x2.json"), bundle(
        c3, e3, "Three-layer Hamiltonian-variational ansatz from the x-bond bonding-orbital state. "
        f"Gap {e3 - E0:.1e} t, fidelity with the exact ground state ~0.9992.", constraints))
    write(os.path.join(JUDGE_DIR, "quantum-proof-hubbard2x2-exact.json"), bundle(
        c4, e4, "Four-layer Hamiltonian-variational ansatz: reaches the exact ground state "
        f"(gap {e4 - E0:.1e} t).", constraints))
    write(os.path.join(JUDGE_DIR, "quantum-proof-hubbard2x2-FORGED.json"), bundle(
        c3, E0, "FORGED: the three-layer circuit, but claiming the exact ground energy. "
        "The judge recomputes the energy and must reject at exit 4.", constraints))
    write(os.path.join(JUDGE_DIR, "quantum-proof-hubbard2x2-UNDERPOWERED.json"), bundle(
        c1, e1, f"UNDERPOWERED: one honest layer, gap {e1 - E0:.3f} t above E0. Beats the product state "
        "but misses the energy budget: must reject at exit 5.", constraints))
    if over:
        c, miss, e = over
        write(os.path.join(JUDGE_DIR, "quantum-proof-hubbard2x2-OVERFIT.json"), bundle(
            c, e, f"OVERFIT: per-bond angles found by an adversarial search. Energy is inside the budget "
            f"(gap {e - E0:.4f} t) but a held-out correlation misses by {miss:.3f}. Must reject at exit 6.",
            constraints))
    else:
        print("no in-budget overfit circuit found: OVERFIT fixture not written")


def write(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")
    print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
