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

    n_ok = sum(ok for _, ok in results)
    print(f"\n{n_ok}/{len(results)} checks passed")
    return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
