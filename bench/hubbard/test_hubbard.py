#!/usr/bin/env python3
"""
test_hubbard.py: the checks declared in DECLARED.md, before any result on this track counts.

Run:  python3 test_hubbard.py   (exit 0 = all pass)
      HUBBARD_BREAK=1 python3 test_hubbard.py   (must exit 1: shows the checks can fail)
"""

import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hubbard as hb  # noqa: E402

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {PASS if ok else FAIL} {name}" + (f"  ({detail})" if detail else ""))


def main():
    print("Hubbard track: declared checks")
    if os.environ.get("HUBBARD_BREAK"):
        # Prove the suite can fail: drop every fermion sign (hard-core bosons instead of electrons).
        print("  HUBBARD_BREAK set: fermion signs removed, checks 2, 3, 5 and 6 must FAIL")
        hb._sign_below = lambda mask, m: 1

    # 1. dimer, closed form
    d = hb.dimer()
    worst = max(abs(hb.ground(d, U, 1, 1, "plain")[0][0] - (U - math.sqrt(U * U + 16)) / 2)
                for U in (0, 1, 4, 10))
    record("1 dimer matches (U - sqrt(U^2 + 16)) / 2 at U = 0, 1, 4, 10", worst < 1e-10, f"max err {worst:.1e}")

    # 2. non-interacting plaquette
    p = hb.plaquette()
    es = [hb.energy_N(p, 0, N, "plain") for N in (2, 3, 4)]
    pb0 = hb.pair_binding(p, 0)
    record("2 U = 0 plaquette: E(2) = E(3) = E(4) = -4t, pair binding 0",
           max(abs(e + 4) for e in es) < 1e-10 and abs(pb0) < 1e-10, f"pb {pb0:.1e}")

    # 3. Jordan-Wigner spectrum == ED spectrum, every sector, both forms
    worst = 0.0
    for form in ("ph", "plain"):
        H = hb.pauli_matrix(hb.jw_terms(p, 4, form), p.n_modes)
        for nu in range(5):
            for nd in range(5):
                idx = [i for i in range(2 ** p.n_modes) if hb.sector_of_index(i, p) == (nu, nd)]
                ev_jw = np.linalg.eigvalsh(H[np.ix_(idx, idx)])
                st, r, c, v = hb.sector_hamiltonian(p, 4, nu, nd, form)
                ev_ed = np.linalg.eigvalsh(hb._dense(len(st), r, c, v))
                worst = max(worst, float(np.max(np.abs(np.sort(ev_jw) - np.sort(ev_ed)))))
    record("3 JW Pauli sum and occupation-basis ED agree in all 25 sectors (U = 4)", worst < 1e-10,
           f"max err {worst:.1e}")

    # 4. Heisenberg limit
    e = hb.energy_N(p, 100, 4, "plain")
    record("4 U = 100 half filling within 2% of -3J = -0.12", abs(e + 0.12) / 0.12 < 0.02, f"E = {e:.5f}")

    # 5. pair binding sign, literature U_c ~ 4.6
    neg = all(hb.pair_binding(p, U) < 0 for U in (1, 2, 3, 4))
    pos = all(hb.pair_binding(p, U) > 0 for U in (6, 8))
    lo, hi = 4.4, 4.8
    bracket = hb.pair_binding(p, lo) < 0 < hb.pair_binding(p, hi)
    for _ in range(30):
        m = (lo + hi) / 2
        lo, hi = (m, hi) if hb.pair_binding(p, m) < 0 else (lo, m)
    record("5 plaquette: holes bind at U = 1-4, unbind at 6, 8; sign change in (4.4, 4.8)",
           neg and pos and bracket, f"U_c = {lo:.3f}t (literature ~4.58t)")

    # 6. d-wave, not extended s
    od = hb.pair_overlap(p, 4, hb.D_WAVE)
    os_ = hb.pair_overlap(p, 4, hb.EXT_S)
    record("6 bound pair is d_{x2-y2}: |<2|D_d|4>| > 0.1, |<2|D_s|4>| < 1e-8 (U = 4)",
           od > 0.1 and os_ < 1e-8, f"d {od:.3f}, s {os_:.1e}")

    # Lanczos path agrees with dense on a cluster big enough to use both
    lad = hb.ladder(3)
    e_dense = hb.ground(lad, 4, 3, 3, dense_max=10 ** 6)[0][0]
    e_lanc = hb.ground(lad, 4, 3, 3, dense_max=0)[0][0]
    record("Lanczos ground energy equals dense on the 2x3 ladder (400 states)",
           abs(e_dense - e_lanc) < 1e-9, f"diff {abs(e_dense - e_lanc):.1e}")

    # 8. compact hops are the same unitary (DECLARED.md item 8)
    import ansatz as az
    sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
    import density_matrix as dm
    import fastdm
    import sim

    def unitary(ops, n):
        cols = []
        for k in range(2 ** n):
            st = np.zeros(2 ** n, dtype=complex); st[k] = 1
            for op in ops:
                st = sim.apply(st, n, sim.gate_matrix(op["gate"], op.get("params", [])), op["q"])
            cols.append(st)
        return np.array(cols).T

    worst = 0.0
    for a, b in ((0, 1), (0, 3), (1, 3), (0, 4)):
        for th in (0.3, -1.1, 2.0):
            o1, o2 = [], []
            az.hop(o1, 5, a, b, th); az.hop_compact(o2, 5, a, b, th)
            A, B = unitary(o1, 5), unitary(o2, 5)
            ph = np.vdot(B.ravel(), A.ravel()); ph /= abs(ph)
            worst = max(worst, float(np.abs(A - ph * B).max()))
    record("8 hop_compact equals hop (adjacent, 1-, 2- and 3-qubit JW strings)", worst < 1e-12, f"max err {worst:.1e}")

    # fastdm reproduces the judge's density-matrix simulator
    rng = np.random.default_rng(0)
    ops = []
    for _ in range(40):
        if rng.random() < 0.4:
            q = [int(x) for x in rng.choice(4, 2, replace=False)]
            ops.append({"gate": "rzz", "q": q, "params": [float(rng.normal())]} if rng.random() < 0.5 else {"gate": "cx", "q": q})
        else:
            ops.append({"gate": "ry", "q": [int(rng.integers(4))], "params": [float(rng.normal())]} if rng.random() < 0.5
                       else {"gate": str(rng.choice(["h", "s", "sdg", "x"])), "q": [int(rng.integers(4))]})
    c = {"n_qubits": 4, "ops": ops}
    diff = float(np.abs(dm.simulate_density(c, {"depolarizing_1q": 0.01, "depolarizing_2q": 0.03})
                        - fastdm.simulate_density(c, 0.01, 0.03)).max())
    record("fastdm equals density_matrix.py on a random noisy 4-qubit circuit", diff < 1e-12, f"max err {diff:.1e}")

    # Saved circuit files must rebuild with the committed ansatz and give back their saved energies
    # (2026-10-06: pb-circuits-U4.json was a stale artifact of the rejected x/y-tied ansatz).
    import glob
    import json as _json
    import pair_binding_vqe as pbv
    import ansatz as az
    for path in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "pb-circuits-U*.json"))):
        data = _json.load(open(path))
        Hs = hb.pauli_matrix(hb.jw_terms(pbv.cluster, float(data["U"])), pbv.N_Q)
        worst, why = 0.0, ""
        for L, v in data["layers"].items():
            rec = v["by_N"]["4"]
            try:
                worst = max(worst, abs(az.energy(pbv.circuit(4, rec["params"], compact=True), Hs) - rec["energy"]))
            except ValueError as e:
                worst, why = float("inf"), str(e)
        record(f"{os.path.basename(path)} rebuilds with the committed ansatz", worst < 1e-9, why or f"max energy diff {worst:.1e}")

    n_ok = sum(ok for _, ok in results)
    print(f"\n{n_ok}/{len(results)} checks passed")
    return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
