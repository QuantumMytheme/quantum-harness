#!/usr/bin/env python3
"""
pair_binding_vqe.py: the plaquette's pair-binding energy through the quantum route.

Optimizes one Hamiltonian-variational circuit per electron number (N = 2, 3, 4, lowest S_z) and
reports Delta_pb = E(2) + E(4) - 2 E(3) against exact diagonalization. Circuits are cached in
results/pb-circuits-U<U>.json for noise_sweep.py. Authoring needs scipy.

  python bench/hubbard/pair_binding_vqe.py 3 4      # U values
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import ansatz as az  # noqa: E402
import hubbard as hb  # noqa: E402
import sim  # noqa: E402

cluster = hb.plaquette()
N_Q = cluster.n_modes
# Initial bonding orbitals: (spin, x-bond) pairs to fill. Each is the ground state of that bond's hopping.
FILL = {
    4: [(0, (0, 1)), (0, (3, 2)), (1, (0, 1)), (1, (3, 2))],
    3: [(0, (0, 1)), (0, (3, 2)), (1, (0, 1))],
    2: [(0, (0, 1)), (1, (0, 1))],
}
SECTOR = {4: (2, 2), 3: (2, 1), 2: (1, 1)}
# One angle per bond, not per bond direction: the doped start states fill only some x bonds, so
# tying the two x bonds to one angle stalls N = 2 at 1.3 t and N = 3 at 0.7 t above exact.
FREE = hb.Cluster(cluster.n_sites, [(i, j, t, f"b{k}") for k, (i, j, t, _) in enumerate(cluster.bonds)])
GROUPS = tuple(f"b{k}" for k in range(len(cluster.bonds)))


def prep(N):
    ops = []
    for spin, (i, j) in FILL[N]:
        a, b = cluster.mode(i, spin), cluster.mode(j, spin)
        ops.append({"gate": "x", "q": [a]})
        az.hop(ops, N_Q, a, b, np.pi / 4)
        ops.append({"gate": "rz", "q": [b], "params": [np.pi / 2]})
    return ops


def circuit(N, params):
    c = az.hva(FREE, list(params), [], GROUPS)
    c["ops"] = prep(N) + c["ops"]
    for op in c["ops"]:
        if "params" in op:
            op["params"] = [float(v) for v in op["params"]]
    return c


def optimize(N, H, layers, trials=8, seed=200):
    from scipy.optimize import minimize  # authoring only; noise_sweep.py imports this module numpy-only
    best = None
    for k in range(trials):
        x0 = np.random.default_rng(seed + k).uniform(-0.8, 0.8, (1 + len(GROUPS)) * layers)
        f = lambda x: float(np.real(np.vdot(p := sim.simulate(circuit(N, x)), H @ p)))
        r = minimize(f, x0, method="BFGS", options={"gtol": 1e-11})
        if best is None or r.fun < best.fun:
            best = r
    return best


def main(Us):
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    for U in Us:
        H = hb.pauli_matrix(hb.jw_terms(cluster, U), N_Q)
        exact = {N: hb.energy_N(cluster, U, N) for N in (2, 3, 4)}
        pb_exact = exact[2] + exact[4] - 2 * exact[3]
        out = {"U": U, "exact": exact, "pb_exact": pb_exact, "layers": {}}
        for L in (2, 3):
            res = {}
            for N in (2, 3, 4):
                r = optimize(N, H, L)
                c = circuit(N, r.x)
                res[N] = {"energy": float(r.fun), "error": float(r.fun - exact[N]), "params": r.x.tolist(),
                          "two_qubit_gates": sim.two_qubit_gate_count(c)}
            pb = res[2]["energy"] + res[4]["energy"] - 2 * res[3]["energy"]
            out["layers"][L] = {"by_N": res, "pb": pb}
            print(f"U {U} layers {L}: errors " + ", ".join(f"N{N} {res[N]['error']:.1e}" for N in (2, 3, 4))
                  + f" | pb {pb:+.5f} vs exact {pb_exact:+.5f}", flush=True)
        with open(os.path.join(HERE, "results", f"pb-circuits-U{U:g}.json"), "w") as f:
            json.dump(out, f, indent=1)


if __name__ == "__main__":
    main([float(u) for u in sys.argv[1:]] or [3.0, 4.0])
