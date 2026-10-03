#!/usr/bin/env python3
"""
realistic.py: the mitigated pair-binding protocol under device-like measurement and noise
(DECLARED.md items 12-15, fixed before this ran).

Settings: all-Z, x bonds, y bonds. Hopping pairs are rotated by S_a then hop_compact(a, b, pi/4), which
preserves electron number, so each setting is post-selected on (N_up, N_dn). Noise: depolarizing
(p1q = p2q/10), coherent rzz(eps) after each two-qubit gate, readout flip p_ro per qubit. Protocol:
confusion-matrix inversion -> post-selection -> quadratic Richardson ZNE (scales 1, 3, 5) -> Delta_pb.

  python3 bench/hubbard/realistic.py 3 3        # U, layers    (numpy only)
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import ansatz as az  # noqa: E402
import fastdm  # noqa: E402
import hubbard as hb  # noqa: E402
import mitigation as mit  # noqa: E402
import pair_binding_vqe as pbv  # noqa: E402
import sim  # noqa: E402

CL, N_Q = pbv.cluster, pbv.N_Q
SCALES, RICH = mit.SCALES, mit.RICHARDSON
TWIRL = "--twirl" in sys.argv
CASES_TWIRL = [(3e-4, 0.02, 0.01, "twirled, lower depolarizing"), (1e-3, 0.02, 0.01, "twirled, headline")]
CASES = [  # (p2, eps, p_ro, label)
    (1e-3, 0.02, 0.01, "headline"),
    (3e-4, 0.02, 0.01, "lower depolarizing"),
    (1e-3, 0.0, 0.01, "no coherent error"),
    (1e-3, 0.02, 0.0, "no readout error"),
    (1e-3, 0.0, 0.0, "depolarizing only (item 10 conditions, device measurement)"),
]


def bond_pairs(label):
    return [tuple(sorted((CL.mode(i, s), CL.mode(j, s)))) for i, j, _, lab in CL.bonds if lab == label for s in (0, 1)]


def settings(U):
    """[(name, rotation ops, diagonal value of the group's terms per basis index)]"""
    terms = hb.jw_terms(CL, U)
    out = []
    z_terms = [t for t in terms if set(t["pauli"]) <= {"I", "Z"}]
    out.append(("Z", [], np.real(np.diag(hb.pauli_matrix(z_terms, N_Q)))))
    for lab in ("x", "y"):
        pairs = bond_pairs(lab)
        ops = []
        for a, b in pairs:
            ops.append({"gate": "s", "q": [a]})
            az.hop_compact(ops, N_Q, a, b, np.pi / 4)
        group = [t for t in terms if not set(t["pauli"]) <= {"I", "Z"}
                 and tuple(q for q, c in enumerate(t["pauli"]) if c in "XY") in pairs]
        Ug = np.eye(2 ** N_Q, dtype=complex)
        for op in ops:
            Ug = mit_full(op) @ Ug
        D = Ug @ hb.pauli_matrix(group, N_Q) @ Ug.conj().T
        off = float(np.abs(D - np.diag(np.diag(D))).max())
        assert off < 1e-10, f"setting {lab} not diagonal after rotation ({off:.1e})"
        out.append((lab, ops, np.real(np.diag(D))))
    n_terms = len(z_terms) + sum(1 for t in terms if not set(t["pauli"]) <= {"I", "Z"})
    assert n_terms == len(terms), "every Hamiltonian term must be in exactly one setting"
    return out


def mit_full(op):
    import density_matrix as dm
    return dm.full_operator(sim.gate_matrix(op["gate"], op.get("params", [])), list(op["q"]), N_Q)


def readout(probs, p, invert=False):
    """Apply (or invert) a symmetric per-qubit bit-flip confusion matrix to a 2^n probability vector."""
    if not p:
        return probs
    A = np.array([[1 - p, p], [p, 1 - p]])
    if invert:
        A = np.linalg.inv(A)
    t = probs.reshape([2] * N_Q)
    for q in range(N_Q):
        t = np.moveaxis(np.tensordot(A, t, axes=([1], [q])), 0, q)
    return t.reshape(-1)


def main(U, layers):
    data = json.load(open(os.path.join(HERE, "results", f"pb-circuits-U{U:g}.json")))
    by_N = data["layers"][str(layers)]["by_N"]
    pb_exact = data["pb_exact"]
    sets = settings(U)
    in_sector = {N: np.array([hb.sector_of_index(i, CL) == pbv.SECTOR[N] for i in range(2 ** N_Q)]) for N in (2, 3, 4)}
    rows = []
    for p2, eps, pro, label in (CASES_TWIRL if TWIRL else CASES):
        E, var, keep = {}, {}, {}
        for N in (2, 3, 4):
            prep = pbv.circuit(N, by_N[str(N)]["params"], compact=True)
            for s in SCALES:
                e_tot, v_tot, k_min = 0.0, 0.0, 1.0
                for name, rot, f in sets:
                    c = mit.fold({"n_qubits": N_Q, "ops": prep["ops"] + rot}, s)
                    rho = fastdm.simulate_density(c, p2 / 10, p2, eps, twirl=TWIRL)
                    measured = readout(np.clip(np.real(np.diag(rho)), 0, None), pro)
                    q = readout(measured, pro, invert=True) * in_sector[N]
                    w = q.sum()
                    e = float(q @ f / w)
                    # per-shot variance of this setting's estimator, from the measured post-selected distribution
                    m = measured * in_sector[N]; wm = m.sum()
                    v = float((m @ (f * f)) / wm - ((m @ f) / wm) ** 2) / wm
                    e_tot += e; v_tot += v; k_min = min(k_min, wm)
                E[(N, s)], var[(N, s)], keep[(N, s)] = e_tot, v_tot, k_min
        zne = {N: sum(c * E[(N, s)] for c, s in zip(RICH, SCALES)) for N in (2, 3, 4)}
        unmit = {N: E[(N, 1)] for N in (2, 3, 4)}
        pb = lambda e: e[2] + e[4] - 2 * e[3]
        var_pb = sum((4 if N == 3 else 1) * sum(c * c * var[(N, s)] for c, s in zip(RICH, SCALES)) for N in (2, 3, 4))
        shots = var_pb / (abs(pb_exact) / 3) ** 2
        ok = pb(zne) < 0 and abs(pb(zne) - pb_exact) <= 0.5 * abs(pb_exact)
        row = {"label": label, "p2": p2, "eps": eps, "p_ro": pro, "pb_postselected_unmitigated": pb(unmit),
               "pb_zne": pb(zne), "declared_pass": bool(ok), "shots_per_setting_3sigma": float(shots),
               "settings": 27, "kept_min": {str(k): v for k, v in keep.items()}}
        rows.append(row)
        print(f"{label:58s} p2 {p2:.0e} eps {eps} ro {pro}: post-sel {pb(unmit):+.4f}  ZNE {pb(zne):+.4f}  "
              f"{'PASS' if ok else 'fail'}  shots/setting {shots:.1e}   [exact {pb_exact:+.4f}]", flush=True)
    with open(os.path.join(HERE, "results", f"realistic-U{U:g}-L{layers}{'-twirled' if TWIRL else ''}.json"), "w") as fh:
        json.dump({"U": U, "layers": layers, "pb_exact": pb_exact, "rows": rows,
                   "protocol": "readout inversion -> post-selection -> quadratic Richardson ZNE (1,3,5) per N"}, fh, indent=1)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(float(args[0]) if args else 3.0, int(args[1]) if len(args) > 1 else 3)
