#!/usr/bin/env python3
"""
noise_sweep.py: at what gate-error rate does the plaquette's d-wave pair binding disappear?

Takes the circuits pair_binding_vqe.py optimized (results/pb-circuits-U<U>.json), runs each one
through the judge's density-matrix simulator under depolarizing noise (p_2q per qubit after each
two-qubit gate, p_1q = p_2q / 10 after each one-qubit gate) and reports Delta_pb two ways:

  raw            Tr(rho H): what the circuit's energy estimate gives as is
  post-selected  rho projected onto the right (N_up, N_dn) sector and renormalized, the standard
                 first mitigation on hardware (measure the particle number, discard the rest)

numpy only (runs on the Pi).  python3 bench/hubbard/noise_sweep.py 3 [layers]
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import density_matrix as dm  # noqa: E402
import hubbard as hb  # noqa: E402
import pair_binding_vqe as pbv  # noqa: E402

P2 = [0.0, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2]


def run(U, layers):
    data = json.load(open(os.path.join(HERE, "results", f"pb-circuits-U{U:g}.json")))
    cl = pbv.cluster
    n = cl.n_modes
    H = hb.pauli_matrix(hb.jw_terms(cl, U), n)
    exact = {int(k): v for k, v in data["exact"].items()}
    by_N = data["layers"][str(layers)]["by_N"]
    sector_idx = {N: np.array([i for i in range(2 ** n) if hb.sector_of_index(i, cl) == pbv.SECTOR[N]])
                  for N in (2, 3, 4)}
    rows = []
    for p2 in P2:
        noise = {"model": "depolarizing", "depolarizing_1q": p2 / 10, "depolarizing_2q": p2}
        raw, ps, keep = {}, {}, {}
        for N in (2, 3, 4):
            c = pbv.circuit(N, by_N[str(N)]["params"])
            rho = dm.simulate_density(c, noise if p2 else None)
            raw[N] = float(np.real(np.trace(rho @ H)))
            idx = sector_idx[N]
            sub = rho[np.ix_(idx, idx)]
            w = float(np.real(np.trace(sub)))
            ps[N] = float(np.real(np.trace(sub @ H[np.ix_(idx, idx)])) / w)
            keep[N] = w
        pb_raw = raw[2] + raw[4] - 2 * raw[3]
        pb_ps = ps[2] + ps[4] - 2 * ps[3]
        rows.append({"p2": p2, "pb_raw": pb_raw, "pb_postselected": pb_ps, "kept_fraction": keep,
                     "energy_raw": raw, "energy_postselected": ps})
        print(f"U {U:g} L{layers} p2 {p2:7.0e}: pb raw {pb_raw:+.4f}  post-selected {pb_ps:+.4f}  "
              f"(exact {data['pb_exact']:+.4f}; kept N4 {keep[4]:.2f})", flush=True)
    out = {"U": U, "layers": layers, "pb_exact": data["pb_exact"], "pb_ideal_circuit": data["layers"][str(layers)]["pb"],
           "two_qubit_gates": {N: by_N[str(N)]["two_qubit_gates"] for N in (2, 3, 4)},
           "noise": "depolarizing, p_1q = p_2q / 10", "rows": rows}
    with open(os.path.join(HERE, "results", f"noise-sweep-U{U:g}-L{layers}.json"), "w") as f:
        json.dump(out, f, indent=1)
    return out


if __name__ == "__main__":
    U = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    L = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    run(U, L)
