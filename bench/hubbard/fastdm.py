#!/usr/bin/env python3
"""
fastdm.py: the judge's density-matrix simulation (bench/quantum-judge/density_matrix.py), computed by
applying each gate to the qubit axes of rho instead of building a 2^n x 2^n operator per gate.

Same semantics: start in |0..0><0..0|; after each 1-qubit gate a depolarizing channel of strength p1 on
that qubit; after each multi-qubit gate one of strength p2 on each involved qubit;
E(rho) = (1-p) rho + (p/3)(X rho X + Y rho Y + Z rho Z). test_fastdm in test_hubbard.py checks the two agree.
numpy only.
"""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import sim  # noqa: E402

_P = {"x": np.array([[0, 1], [1, 0]], dtype=complex),
      "y": np.array([[0, -1j], [1j, 0]], dtype=complex),
      "z": np.array([[1, 0], [0, -1]], dtype=complex)}


def _apply(t, n, U, qubits, side):
    """Apply U to the row (side 0) or column (side 1, as conj) axes `qubits` of the 2n-axis tensor t."""
    k = len(qubits)
    axes = [q + side * n for q in qubits]
    G = U if side == 0 else U.conj()
    G = G.reshape([2] * (2 * k))
    t = np.tensordot(G, t, axes=(list(range(k, 2 * k)), axes))
    # tensordot puts the new axes first; move them back into place
    return np.moveaxis(t, list(range(k)), axes)


def _unitary(t, n, U, qubits):
    return _apply(_apply(t, n, U, qubits, 0), n, U, qubits, 1)


def _depolarize(t, n, q, p):
    if p <= 0:
        return t
    acc = (1 - p) * t
    for P in _P.values():
        acc = acc + (p / 3) * _unitary(t, n, P, [q])
    return acc


def simulate_density(circuit, p1=0.0, p2=0.0):
    n = int(circuit["n_qubits"])
    t = np.zeros([2] * (2 * n), dtype=complex)
    t[(0,) * (2 * n)] = 1.0
    for op in circuit.get("ops", []):
        qs = list(op["q"])
        U = sim.gate_matrix(op["gate"].lower(), op.get("params", []))
        t = _unitary(t, n, U, qs)
        for q in qs:
            t = _depolarize(t, n, q, p1 if len(qs) == 1 else p2)
    return t.reshape(2 ** n, 2 ** n)
