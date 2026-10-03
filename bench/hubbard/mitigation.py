#!/usr/bin/env python3
"""
mitigation.py: shallower circuits plus zero-noise extrapolation, judged against the exact pair binding.
Pass/fail was fixed before this ran (DECLARED.md items 8-11).

For each p2q: the compact circuits (same unitary as pair_binding_vqe's, ~40% fewer two-qubit gates) run
through fastdm at noise scales 1, 3, 5 by local unitary folding (G -> G G^dag G -> G G^dag G G^dag G).
Energies are post-selected on the right (N_up, N_dn) sector, extrapolated to zero noise per N, then
combined: Delta_pb = E(2) + E(4) - 2 E(3).

  python3 bench/hubbard/mitigation.py 3 3      # U, layers     (numpy only)
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import fastdm  # noqa: E402
import hubbard as hb  # noqa: E402
import pair_binding_vqe as pbv  # noqa: E402
import sim  # noqa: E402

P2 = [0.0, 1e-4, 3e-4, 1e-3, 3e-3]
SCALES = (1, 3, 5)
RICHARDSON = (15 / 8, -5 / 4, 3 / 8)   # Lagrange weights at 0 through scales 1, 3, 5
INVERSE = {"s": "sdg", "sdg": "s"}


def inverse(op):
    g = op["gate"]
    inv = {"gate": INVERSE.get(g, g), "q": list(op["q"])}
    if "params" in op:
        inv["params"] = [-p for p in op["params"]]
    return inv


def fold(circuit, scale):
    ops = []
    for op in circuit["ops"]:
        ops.append(op)
        for _ in range((scale - 1) // 2):
            ops += [inverse(op), op]
    return {"n_qubits": circuit["n_qubits"], "ops": ops}


def postselected(rho, H, idx):
    sub = rho[np.ix_(idx, idx)]
    w = float(np.real(np.trace(sub)))
    Hs = H[np.ix_(idx, idx)]
    e = float(np.real(np.trace(sub @ Hs))) / w
    e2 = float(np.real(np.trace(sub @ Hs @ Hs))) / w
    return e, max(e2 - e * e, 0.0), w


def main(U, layers):
    data = json.load(open(os.path.join(HERE, "results", f"pb-circuits-U{U:g}.json")))
    by_N = data["layers"][str(layers)]["by_N"]
    pb_exact = data["pb_exact"]
    cl, n = pbv.cluster, pbv.N_Q
    H = hb.pauli_matrix(hb.jw_terms(cl, U), n)
    idx = {N: np.array([i for i in range(2 ** n) if hb.sector_of_index(i, cl) == pbv.SECTOR[N]]) for N in (2, 3, 4)}
    circ = {N: pbv.circuit(N, by_N[str(N)]["params"], compact=True) for N in (2, 3, 4)}
    old = {N: pbv.circuit(N, by_N[str(N)]["params"]) for N in (2, 3, 4)}
    twoq = {N: (sim.two_qubit_gate_count(old[N]), sim.two_qubit_gate_count(circ[N])) for N in (2, 3, 4)}
    print("two-qubit gates (old -> compact):", twoq, flush=True)
    for N in (2, 3, 4):   # ideal check: compact == old unitary
        a, b = sim.simulate(old[N]), sim.simulate(circ[N])
        assert abs(abs(np.vdot(a, b)) - 1) < 1e-10, "compact circuit differs from the optimized one"

    rows = []
    for p2 in P2:
        E = {N: {} for N in (2, 3, 4)}
        for N in (2, 3, 4):
            for s in (SCALES if p2 else (1,)):
                rho = fastdm.simulate_density(fold(circ[N], s), p2 / 10, p2)
                E[N][s] = postselected(rho, H, idx[N])
        raw_rho = {N: fastdm.simulate_density(circ[N], p2 / 10, p2) for N in (2, 3, 4)}
        e_raw = {N: float(np.real(np.trace(raw_rho[N] @ H))) for N in (2, 3, 4)}
        pb = lambda e: e[2] + e[4] - 2 * e[3]
        row = {"p2": p2,
               "pb_raw": pb(e_raw),
               "pb_postselected": pb({N: E[N][1][0] for N in (2, 3, 4)}),
               "kept": {N: E[N][1][2] for N in (2, 3, 4)}}
        if p2:
            rich = {N: sum(c * E[N][s][0] for c, s in zip(RICHARDSON, SCALES)) for N in (2, 3, 4)}
            lin = {N: float(np.polyval(np.polyfit(SCALES, [E[N][s][0] for s in SCALES], 1), 0)) for N in (2, 3, 4)}
            row["pb_zne_richardson"] = pb(rich)
            row["pb_zne_linear"] = pb(lin)
            row["energies_by_scale"] = {N: {s: E[N][s][0] for s in SCALES} for N in (2, 3, 4)}
            # shots for a 3-sigma Delta_pb, equal shots S per (N, scale); lower bound: assumes H is sampled in
            # its eigenbasis (real devices measure several Pauli groups, which costs more).
            var_per_shot = sum((4 if N == 3 else 1) * sum(c * c * E[N][s][1] / E[N][s][2] for c, s in zip(RICHARDSON, SCALES))
                               for N in (2, 3, 4))
            row["shots_per_setting_3sigma_lower_bound"] = float(var_per_shot / (abs(pb_exact) / 3) ** 2)
            ok = row["pb_zne_richardson"] < 0 and abs(row["pb_zne_richardson"] - pb_exact) <= 0.5 * abs(pb_exact)
            row["declared_pass"] = bool(ok)
        rows.append(row)
        msg = f"p2 {p2:7.0e}: raw {row['pb_raw']:+.4f}  post-sel {row['pb_postselected']:+.4f}"
        if p2:
            msg += (f"  ZNE quad {row['pb_zne_richardson']:+.4f} (lin {row['pb_zne_linear']:+.4f})"
                    f"  {'PASS' if row['declared_pass'] else 'fail'}  shots>= {row['shots_per_setting_3sigma_lower_bound']:.1e}")
        print(msg + f"   [exact {pb_exact:+.4f}]", flush=True)
    out = {"U": U, "layers": layers, "pb_exact": pb_exact, "two_qubit_gates_old_compact": twoq,
           "noise": "depolarizing, p1q = p2q/10; fold scales 1,3,5; Richardson weights 15/8, -5/4, 3/8",
           "pass_rule": "mitigated Delta_pb < 0 and within 50% of exact (DECLARED.md item 10)", "rows": rows}
    with open(os.path.join(HERE, "results", f"mitigation-U{U:g}-L{layers}.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 3.0, int(sys.argv[2]) if len(sys.argv) > 2 else 3)
