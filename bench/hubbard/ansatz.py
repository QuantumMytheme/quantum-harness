#!/usr/bin/env python3
"""
ansatz.py: Hamiltonian-variational circuits for the Hubbard model, emitted in the judge's
circuit IR ({"n_qubits", "ops": [{"gate", "q", "params"}]}).

Each layer applies exp(-i gamma/2 sum Z_u Z_d) (the U term) and then, bond group by bond group,
exp(-i theta/2 (X Z..Z X + Y Z..Z Y)) (the hopping term with its Jordan-Wigner string). Both
conserve N_up and N_dn, so the circuit never leaves the sector its initial state is in.

Gates used: x, h, s, sdg, rz, cx, rzz. All are native to sim.py.
"""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import sim  # noqa: E402

NATIVE = ["x", "h", "s", "sdg", "rz", "cx", "rzz"]
NATIVE_COMPACT = ["x", "h", "s", "sdg", "rz", "ry", "cx", "rzz"]


def pauli_rotation(ops, pauli, phi):
    """Append exp(-i phi P) for a Pauli string P (qubit 0 = first char)."""
    support = [q for q, ch in enumerate(pauli) if ch != "I"]
    pre, post = [], []
    for q in support:
        ch = pauli[q]
        if ch == "X":
            pre.append({"gate": "h", "q": [q]}); post.append({"gate": "h", "q": [q]})
        elif ch == "Y":
            pre += [{"gate": "sdg", "q": [q]}, {"gate": "h", "q": [q]}]
            post += [{"gate": "h", "q": [q]}, {"gate": "s", "q": [q]}]
    ladder = [{"gate": "cx", "q": [support[k], support[k + 1]]} for k in range(len(support) - 1)]
    ops += pre + ladder + [{"gate": "rz", "q": [support[-1]], "params": [2 * phi]}] + ladder[::-1] + post


def hop(ops, n, a, b, theta):
    """exp(-i theta/2 (X_a Z.. X_b + Y_a Z.. Y_b)), a < b."""
    a, b = sorted((a, b))
    for P in "XY":
        chars = ["I"] * n
        chars[a] = chars[b] = P
        for m in range(a + 1, b):
            chars[m] = "Z"
        pauli_rotation(ops, "".join(chars), theta / 2)


def hop_compact(ops, n, a, b, theta):
    """Same unitary as hop(), with 2 CNOTs for the (a, b) core instead of 4.
    Frame C = CX(a,b) . (H_a x S_b) maps X_a X_b -> Y_b and Y_a Y_b -> Y_a (found by search over one-CNOT
    Cliffords), so exp(-i theta/2 (XX + YY)) = C^dag (RY_a(theta) RY_b(theta)) C. A Jordan-Wigner string
    is first folded into its last qubit m by a CNOT ladder; each Y then picks up Z_m and costs 2 CNOTs."""
    a, b = sorted((a, b))
    mid = list(range(a + 1, b))
    ladder = [{"gate": "cx", "q": [mid[k], mid[k + 1]]} for k in range(len(mid) - 1)]
    frame = [{"gate": "h", "q": [a]}, {"gate": "s", "q": [b]}, {"gate": "cx", "q": [a, b]}]
    unframe = [{"gate": "cx", "q": [a, b]}, {"gate": "sdg", "q": [b]}, {"gate": "h", "q": [a]}]
    ops += ladder + frame
    if not mid:
        ops += [{"gate": "ry", "q": [a], "params": [theta]}, {"gate": "ry", "q": [b], "params": [theta]}]
    else:
        pauli = ["I"] * n
        for q in (a, b):
            pauli = ["I"] * n
            pauli[q], pauli[mid[-1]] = "Y", "Z"
            pauli_rotation(ops, "".join(pauli), theta / 2)
    ops += unframe + ladder[::-1]


def hva(cluster, params, occupied, groups=("x", "y"), compact=False):
    """params: [gamma_1, theta_1[group]..., gamma_2, ...] for len(params) / (1 + len(groups)) layers.
    occupied: modes set to |1> by the initial X gates."""
    n = cluster.n_modes
    per = 1 + len(groups)
    if len(params) % per:
        raise ValueError("params length must be a multiple of 1 + len(groups)")
    ops = [{"gate": "x", "q": [m]} for m in occupied]
    for L in range(len(params) // per):
        gamma = params[L * per]
        for i in range(cluster.n_sites):
            ops.append({"gate": "rzz", "q": [cluster.mode(i, 0), cluster.mode(i, 1)], "params": [gamma]})
        for g, group in enumerate(groups):
            theta = params[L * per + 1 + g]
            for i, j, t, lab in cluster.bonds:
                if lab != group:
                    continue
                for spin in (0, 1):
                    (hop_compact if compact else hop)(ops, n, cluster.mode(i, spin), cluster.mode(j, spin), theta)
    for op in ops:
        if "params" in op:
            op["params"] = [float(x) for x in op["params"]]
    return {"n_qubits": n, "ops": ops}


def energy(circuit, H):
    psi = sim.simulate(circuit)
    return float(np.real(np.vdot(psi, H @ psi)))
