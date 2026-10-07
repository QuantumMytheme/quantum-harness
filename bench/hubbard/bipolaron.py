#!/usr/bin/env python3
"""bipolaron.py: Peierls vs Holstein bipolarons on a small ring (RTSC hypothesis W2(a), rtlab-private HYPOTHESES.md).

Two electrons of opposite spin (U = 0) on an N-site ring, one dispersionless phonon (frequency Omega) per site,
phonon Hilbert space truncated to at most NPH total quanta. Exact diagonalisation (scipy sparse, complex).
  Holstein:  H_eph = g sum_i n_i (b_i + b_i^+)
  Peierls :  H_eph = g sum_{i,s} (c+_{i+1,s} c_{i,s} + h.c.) (X_{i+1} - X_i),  X = b + b^+   (Sous et al. PRL 2018)
A twist phi on every bond (all hopping-type terms carry e^{i phi}) gives the pair's mass from the curvature of
E(phi): m*/m0 = kappa(g=0)/kappa(g). Binding Delta = E2 - 2 E1 (negative = bound).
  python3 bench/hubbard/bipolaron.py            -> results/bipolaron-control.json
"""
import itertools
import json
import os
import sys

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import eigsh

HERE = os.path.dirname(os.path.abspath(__file__))
T, OMEGA = 1.0, 1.0


def phonon_basis(n, nph):
    return [c for k in range(nph + 1) for c in itertools.product(range(k + 1), repeat=n) if sum(c) == k]


class Model:
    def __init__(self, kind, n=6, nph=8, electrons=2):
        self.kind, self.n, self.nph = kind, n, nph
        self.ph = phonon_basis(n, nph)
        self.ph_index = {c: k for k, c in enumerate(self.ph)}
        self.el = [(i, j) for i in range(n) for j in range(n)] if electrons == 2 else [(i, None) for i in range(n)]
        self.el_index = {e: k for k, e in enumerate(self.el)}
        self.dim = len(self.el) * len(self.ph)
        self._build()

    def idx(self, e, c):
        return self.el_index[e] * len(self.ph) + self.ph_index[c]

    def _shift(self, c, site, d):
        """b^+ (d=+1) or b (d=-1) on site; returns (new config, amplitude) or (None, 0)."""
        m = c[site] + d
        if m < 0 or sum(c) + d > self.nph:
            return None, 0.0
        new = list(c); new[site] = m
        return tuple(new), np.sqrt(m if d > 0 else c[site])

    def _build(self):
        n = self.n
        hop, ph, vtw, vst = ([], [], []), ([], [], []), ([], [], []), ([], [], [])   # (rows, cols, vals)
        add = lambda m, r, c, v: (m[0].append(r), m[1].append(c), m[2].append(v))
        for e in self.el:
            for c in self.ph:
                k = self.idx(e, c)
                add(ph, k, k, OMEGA * sum(c))
                # forward hops i -> i+1 for each spin present; the h.c. is added when assembling
                for s in (0, 1):
                    if e[s] is None:
                        continue
                    i = e[s]; j = (i + 1) % n
                    e2 = list(e); e2[s] = j; e2 = tuple(e2)
                    add(hop, self.idx(e2, c), k, -T)
                    if self.kind == "peierls":     # (c+_{j} c_{i}) (X_j - X_i): j = i+1
                        for site, sgn in ((j, 1.0), (i, -1.0)):
                            for d in (1, -1):
                                c2, a = self._shift(c, site, d)
                                if c2 is not None:
                                    add(vtw, self.idx(e2, c2), k, sgn * a)
                if self.kind == "holstein":
                    for s in (0, 1):
                        if e[s] is None:
                            continue
                        for d in (1, -1):
                            c2, a = self._shift(c, e[s], d)
                            if c2 is not None:
                                add(vst, self.idx(e, c2), k, a)
        mk = lambda m: sp.csr_matrix((np.array(m[2], complex), (m[0], m[1])), shape=(self.dim, self.dim))
        self.F, self.P, self.Vf, self.Vs = mk(hop), mk(ph), mk(vtw), mk(vst)

    def H(self, g, phi=0.0):
        ph = np.exp(1j * phi)
        fwd = ph * (self.F + g * self.Vf)
        return fwd + fwd.getH() + self.P + g * self.Vs

    def ground(self, g, phi=0.0):
        return float(eigsh(self.H(g, phi), k=1, which="SA", tol=1e-10)[0][0])


def binding_and_mass(m2, m1, g, d=0.02):
    e2 = m2.ground(g); e1 = m1.ground(g)
    kap = (m2.ground(g, d) + m2.ground(g, -d) - 2 * e2) / d ** 2
    return e2 - 2 * e1, kap


def g_for_binding(m2, m1, target=-1.0, lo=0.0, hi=3.0, steps=14):
    """Bisection on g so that Delta = target (binding grows with g in both models over this range)."""
    for _ in range(steps):
        mid = 0.5 * (lo + hi)
        if binding_and_mass(m2, m1, mid)[0] > target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def main(nphs=(8, 10)):
    out = {"model": "two electrons, U = 0, 6-site ring, Omega = t", "rule": "HYPOTHESES.md W2(a)", "rows": []}
    for nph in nphs:
        for kind in ("holstein", "peierls"):
            m2, m1 = Model(kind, nph=nph), Model(kind, nph=nph, electrons=1)
            _, kap0 = binding_and_mass(m2, m1, 0.0)
            g = g_for_binding(m2, m1)
            delta, kap = binding_and_mass(m2, m1, g)
            row = {"kind": kind, "nph": nph, "dim": m2.dim, "g": g, "binding": delta, "mass_ratio": kap0 / kap}
            out["rows"].append(row); print(json.dumps(row), flush=True)
            json.dump(out, open(os.path.join(HERE, "results", "bipolaron-control.json"), "w"), indent=1)
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        m2, m1 = Model("holstein", nph=4), Model("holstein", nph=4, electrons=1)
        print("g=0 binding (must be ~0 for U=0 free pair on a ring):", binding_and_mass(m2, m1, 0.0))
        sys.exit(0)
    main()
