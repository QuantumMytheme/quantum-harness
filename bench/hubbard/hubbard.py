#!/usr/bin/env python3
"""
hubbard.py: the Fermi-Hubbard model on small clusters, two independent ways.

1. Exact diagonalization (ED) in the occupation basis, one (N_up, N_dn) sector at a time.
   This is the ground truth every quantum result on this track is judged against.
2. The Jordan-Wigner Pauli-sum Hamiltonian, in the same {"coeff", "pauli"} term format the
   quantum judge (bench/quantum-judge/sim.py) already evaluates.

numpy only, like the judge: runs offline on a Raspberry Pi.

Conventions
-----------
* Modes: mode(site, spin) = spin * n_sites + site, spin 0 = up, 1 = down.
  Mode m is qubit m under Jordan-Wigner (qubit 0 = leftmost Pauli character).
* A Fock state is an int bitmask; bit m set = mode m occupied. Fermion operators carry the
  sign (-1)^(number of occupied modes with a lower index), which is exactly the JW Z string.
* H = -sum_bonds t_ij (c+_is c_js + h.c.) + U * sum_i W_i, where W_i = n_up n_dn ("plain")
  or (n_up - 1/2)(n_dn - 1/2) ("ph", particle-hole symmetric). The two differ by a term
  linear in N plus a constant, so second differences in N (pair binding) are identical.
"""

import itertools
import math

import numpy as np


# ---------------------------------------------------------------- clusters

class Cluster:
    """Sites plus hopping bonds. bonds = [(i, j, t, label)], each unordered pair once."""

    def __init__(self, n_sites, bonds, name=""):
        self.n_sites = int(n_sites)
        self.bonds = [(int(i), int(j), float(t), lab) for i, j, t, lab in bonds]
        self.name = name

    @property
    def n_modes(self):
        return 2 * self.n_sites

    def mode(self, site, spin):
        return spin * self.n_sites + site


def dimer(t=1.0):
    return Cluster(2, [(0, 1, t, "x")], "dimer")


def plaquette(t=1.0, tp=0.0):
    """2x2 plaquette, sites 0 (0,0), 1 (1,0), 2 (1,1), 3 (0,1). x bonds 0-1, 3-2; y bonds 1-2, 0-3.
    tp = next-nearest-neighbour (diagonal) hopping t'."""
    bonds = [(0, 1, t, "x"), (3, 2, t, "x"), (1, 2, t, "y"), (0, 3, t, "y")]
    if tp:
        bonds += [(0, 2, tp, "d"), (1, 3, tp, "d")]
    return Cluster(4, bonds, "plaquette")


def ladder(length, t=1.0, t_rung=None, tp=0.0):
    """2-leg ladder, open ends. Site (x, leg) = leg * length + x. Legs are 'x' bonds, rungs 'y'."""
    t_rung = t if t_rung is None else t_rung
    bonds = []
    for leg in (0, 1):
        for x in range(length - 1):
            bonds.append((leg * length + x, leg * length + x + 1, t, "x"))
    for x in range(length):
        bonds.append((x, length + x, t_rung, "y"))
    if tp:
        for x in range(length - 1):
            bonds += [(x, length + x + 1, tp, "d"), (length + x, x + 1, tp, "d")]
    return Cluster(2 * length, bonds, f"ladder{length}")


# ---------------------------------------------------------------- fermion algebra on bitmasks

def _sign_below(mask, m):
    return -1 if bin(mask & ((1 << m) - 1)).count("1") & 1 else 1


def annihilate(mask, m):
    """c_m |mask> -> (sign, new_mask) or (0, None)."""
    if not (mask >> m) & 1:
        return 0, None
    return _sign_below(mask, m), mask ^ (1 << m)


def create(mask, m):
    if (mask >> m) & 1:
        return 0, None
    return _sign_below(mask, m), mask | (1 << m)


def sector_states(cluster, n_up, n_dn):
    ns = cluster.n_sites
    ups = [sum(1 << s for s in c) for c in itertools.combinations(range(ns), n_up)]
    dns = [sum(1 << (ns + s) for s in c) for c in itertools.combinations(range(ns), n_dn)]
    return [u | d for u in ups for d in dns]


# ---------------------------------------------------------------- exact diagonalization

def _interaction(mask, cluster, U, form):
    ns = cluster.n_sites
    total = 0.0
    for i in range(ns):
        nu = (mask >> i) & 1
        nd = (mask >> (ns + i)) & 1
        total += nu * nd if form == "plain" else (nu - 0.5) * (nd - 0.5)
    return U * total


def sector_hamiltonian(cluster, U, n_up, n_dn, form="ph"):
    """Sparse H in one sector: (states, rows, cols, vals)."""
    states = sector_states(cluster, n_up, n_dn)
    index = {s: k for k, s in enumerate(states)}
    rows, cols, vals = [], [], []
    for k, s in enumerate(states):
        rows.append(k); cols.append(k); vals.append(_interaction(s, cluster, U, form))
        for i, j, t, _ in cluster.bonds:
            for spin in (0, 1):
                a, b = cluster.mode(i, spin), cluster.mode(j, spin)
                for p, q in ((a, b), (b, a)):  # c+_p c_q
                    s1, m1 = annihilate(s, q)
                    if not s1:
                        continue
                    s2, m2 = create(m1, p)
                    if not s2:
                        continue
                    rows.append(index[m2]); cols.append(k); vals.append(-t * s1 * s2)
    return states, np.array(rows), np.array(cols), np.array(vals, dtype=float)


def _dense(dim, rows, cols, vals):
    H = np.zeros((dim, dim))
    np.add.at(H, (rows, cols), vals)
    return H


def _lanczos(dim, rows, cols, vals, k_max=400, tol=1e-12, seed=7):
    """Lowest eigenpair with full reorthogonalization (fine up to ~1e6 states)."""
    def mv(v):
        return np.bincount(rows, weights=vals * v[cols], minlength=dim)
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim); v /= np.linalg.norm(v)
    V, a, b = [v], [], []
    e_old = None
    for it in range(min(k_max, dim)):
        w = mv(V[-1])
        a.append(float(V[-1] @ w))
        for u in V:
            w -= (u @ w) * u
        beta = float(np.linalg.norm(w))
        T = np.diag(a) + np.diag(b, 1) + np.diag(b, -1)
        ev, evec = np.linalg.eigh(T)
        if e_old is not None and abs(ev[0] - e_old) < tol or beta < 1e-14:
            break
        e_old = ev[0]
        b.append(beta)
        V.append(w / beta)
    vec = np.array(V[:len(a)]).T @ evec[:, 0]
    return float(ev[0]), vec / np.linalg.norm(vec)


def ground(cluster, U, n_up, n_dn, form="ph", n_states=1, dense_max=3000):
    """Lowest eigenvalue(s) and eigenvector(s) of one sector.
    Returns (energies[n], vectors[dim, n], states)."""
    states, rows, cols, vals = sector_hamiltonian(cluster, U, n_up, n_dn, form)
    dim = len(states)
    if dim <= dense_max:
        ev, evec = np.linalg.eigh(_dense(dim, rows, cols, vals))
        return ev[:n_states], evec[:, :n_states], states
    if n_states != 1:
        raise ValueError("Lanczos path returns only the ground state")
    e, v = _lanczos(dim, rows, cols, vals)
    return np.array([e]), v[:, None], states


def energy_N(cluster, U, N, form="ph"):
    """Ground energy at total electron number N, minimized over S_z sectors."""
    ns = cluster.n_sites
    best = math.inf
    for n_up in range(max(0, N - ns), min(ns, N) + 1):
        e, _, _ = ground(cluster, U, n_up, N - n_up, form)
        best = min(best, float(e[0]))
    return best


def pair_binding(cluster, U, N_half=None, form="ph"):
    """Delta_pb = E(N-2) + E(N) - 2 E(N-1), holes doped into N electrons (default half filling).
    Negative = two holes bind."""
    N = cluster.n_sites if N_half is None else N_half
    return energy_N(cluster, U, N - 2, form) + energy_N(cluster, U, N, form) - 2 * energy_N(cluster, U, N - 1, form)


def spin_gap(cluster, U, form="ph"):
    """E(S_z = 1) - E(S_z = 0) at half filling."""
    ns = cluster.n_sites
    e0, _, _ = ground(cluster, U, ns // 2, ns - ns // 2, form)
    e1, _, _ = ground(cluster, U, ns // 2 + 1, ns - ns // 2 - 1, form)
    return float(e1[0] - e0[0])


# ---------------------------------------------------------------- pair operators

def _apply_pair(vec, states, cluster, f, spin_order):
    """sum_bonds f(label) * c_{i,s1} c_{j,s2} applied to a vector; returns dict mask -> amp."""
    out = {}
    for amp, s in zip(vec, states):
        if abs(amp) < 1e-15:
            continue
        for i, j, _, lab in cluster.bonds:
            w = f(lab)
            if not w:
                continue
            for (si, sj), sgn in spin_order:
                for a, b in ((i, j), (j, i)):  # symmetrize over the bond direction
                    s1, m1 = annihilate(s, cluster.mode(b, sj))
                    if not s1:
                        continue
                    s2, m2 = annihilate(m1, cluster.mode(a, si))
                    if not s2:
                        continue
                    out[m2] = out.get(m2, 0.0) + amp * w * sgn * s1 * s2 / math.sqrt(2) / 2
    return out


SINGLET = [((1, 0), +1), ((0, 1), -1)]  # c_i,dn c_j,up - c_i,up c_j,dn


def pair_overlap(cluster, U, f, n_half=None, form="ph", degenerate_tol=1e-8):
    """Norm of the projection of Delta_f |psi(N)> onto the (N-2) ground manifold
    in the S_z = 0 sector. f maps a bond label to its form factor."""
    ns = cluster.n_sites
    N = ns if n_half is None else n_half
    eN, vN, sN = ground(cluster, U, N // 2, N - N // 2, form, n_states=1)
    out = _apply_pair(vN[:, 0], sN, cluster, f, SINGLET)
    nu, nd = (N - 2) // 2, (N - 2) - (N - 2) // 2
    k = min(6, len(sector_states(cluster, nu, nd)))
    e2, v2, s2 = ground(cluster, U, nu, nd, form, n_states=k)
    idx = {s: n for n, s in enumerate(s2)}
    phi = np.zeros(len(s2))
    for m, amp in out.items():
        phi[idx[m]] += amp
    manifold = [c for c in range(len(e2)) if e2[c] - e2[0] < degenerate_tol]
    return float(np.linalg.norm(v2[:, manifold].T @ phi))


D_WAVE = lambda lab: {"x": 1.0, "y": -1.0}.get(lab, 0.0)
EXT_S = lambda lab: {"x": 1.0, "y": 1.0}.get(lab, 0.0)


# ---------------------------------------------------------------- Jordan-Wigner

def jw_terms(cluster, U, form="ph"):
    """Pauli-sum Hamiltonian, [{"coeff", "pauli"}], identical spectrum to the ED sectors.
    Hopping a<b:  c+_a c_b + h.c. = (X_a Z..Z X_b + Y_a Z..Z Y_b) / 2.
    Number: n_m = (I - Z_m) / 2."""
    n = cluster.n_modes
    acc = {}

    def add(chars, c):
        key = "".join(chars)
        acc[key] = acc.get(key, 0.0) + c

    for i, j, t, _ in cluster.bonds:
        for spin in (0, 1):
            a, b = sorted((cluster.mode(i, spin), cluster.mode(j, spin)))
            for P in "XY":
                chars = ["I"] * n
                chars[a] = chars[b] = P
                for m in range(a + 1, b):
                    chars[m] = "Z"
                add(chars, -t / 2)
    ns = cluster.n_sites
    for i in range(ns):
        u, d = cluster.mode(i, 0), cluster.mode(i, 1)
        zz = ["I"] * n; zz[u] = zz[d] = "Z"
        if form == "ph":
            add(zz, U / 4)                     # (n_u - 1/2)(n_d - 1/2) = Z_u Z_d / 4
        else:
            zu = ["I"] * n; zu[u] = "Z"
            zd = ["I"] * n; zd[d] = "Z"
            add(["I"] * n, U / 4); add(zu, -U / 4); add(zd, -U / 4); add(zz, U / 4)
    return [{"coeff": round(c, 15), "pauli": p} for p, c in sorted(acc.items()) if abs(c) > 1e-14]


def pauli_matrix(terms, n):
    """Full 2^n matrix of a Pauli sum, judge convention: qubit 0 = most significant bit."""
    P = {"I": np.eye(2), "X": np.array([[0, 1], [1, 0]]), "Y": np.array([[0, -1j], [1j, 0]]),
         "Z": np.diag([1.0, -1.0])}
    H = np.zeros((2 ** n, 2 ** n), dtype=complex)
    for term in terms:
        op = np.array([[1.0 + 0j]])
        for ch in term["pauli"]:
            op = np.kron(op, P[ch])
        H += term["coeff"] * op
    return H


def mask_to_index(mask, n):
    """Occupation bitmask (bit m = mode m) -> statevector index (qubit 0 most significant)."""
    return sum(1 << (n - 1 - m) for m in range(n) if (mask >> m) & 1)


def sector_of_index(idx, cluster):
    n, ns = cluster.n_modes, cluster.n_sites
    occ = [(idx >> (n - 1 - m)) & 1 for m in range(n)]
    return sum(occ[:ns]), sum(occ[ns:])


def statevector(vec, states, n):
    """Embed an ED sector vector into the 2^n statevector, so judge observables apply to it."""
    psi = np.zeros(2 ** n, dtype=complex)
    for amp, s in zip(vec, states):
        psi[mask_to_index(s, n)] = amp
    return psi
