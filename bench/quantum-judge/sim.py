"""
sim.py — a tiny, hermetic, deterministic statevector simulator.

Design goals (inherited from the fieldops-harness rcan-proof judge ethos):
  - SELF-CONTAINED: the only dependency is numpy. No network, no quantum SDK.
    A judge that re-derives ground truth must run identically on a contributor's
    laptop, in CI, and on a Raspberry Pi. Heavy frameworks (Qiskit/Cirq/PennyLane)
    are supported as *optional authoring adapters* elsewhere, never as the
    verification root.
  - DETERMINISTIC: exact statevector math for amplitude/fidelity/expectation
    tasks; seeded sampling for shot-based tasks. Two verifiers must grade
    identically, so nothing here may depend on wall-clock or unseeded RNG.

Qubit/index convention:
  Qubit 0 is the MOST-significant bit of the computational-basis index, i.e.
  basis index = sum_q bit_q * 2**(n-1-q). So for n=3, |000> = index 0 and
  |111> = index 7. reshape(state, [2]*n) makes axis 0 == qubit 0.
"""

import numpy as np

SQRT1_2 = 1.0 / np.sqrt(2.0)


def _const_gates():
    I = np.eye(2, dtype=complex)
    X = np.array([[0, 1], [1, 0]], dtype=complex)
    Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
    Z = np.array([[1, 0], [0, -1]], dtype=complex)
    H = np.array([[SQRT1_2, SQRT1_2], [SQRT1_2, -SQRT1_2]], dtype=complex)
    S = np.array([[1, 0], [0, 1j]], dtype=complex)
    Sdg = np.array([[1, 0], [0, -1j]], dtype=complex)
    T = np.array([[1, 0], [0, np.exp(1j * np.pi / 4)]], dtype=complex)
    Tdg = np.array([[1, 0], [0, np.exp(-1j * np.pi / 4)]], dtype=complex)
    # sqrt(X): SX SX = X
    SX = 0.5 * np.array([[1 + 1j, 1 - 1j], [1 - 1j, 1 + 1j]], dtype=complex)
    SXdg = 0.5 * np.array([[1 - 1j, 1 + 1j], [1 + 1j, 1 - 1j]], dtype=complex)
    return {
        "id": I, "i": I,
        "x": X, "y": Y, "z": Z, "h": H,
        "s": S, "sdg": Sdg, "t": T, "tdg": Tdg,
        "sx": SX, "sxdg": SXdg,
    }


_CONST = _const_gates()

# qubit 0 of a multi-qubit gate is the MOST-significant index of the gate block,
# matching the apply() convention below (front qubits are most significant).
_CX = np.array([[1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 0, 1],
                [0, 0, 1, 0]], dtype=complex)
_CZ = np.diag([1, 1, 1, -1]).astype(complex)
_CY = np.array([[1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 0, -1j],
                [0, 0, 1j, 0]], dtype=complex)
_SWAP = np.array([[1, 0, 0, 0],
                  [0, 0, 1, 0],
                  [0, 1, 0, 0],
                  [0, 0, 0, 1]], dtype=complex)
_CCX = np.eye(8, dtype=complex)
_CCX[[6, 7], :] = _CCX[[7, 6], :]

_TWO_Q = {"cx": _CX, "cnot": _CX, "cz": _CZ, "cy": _CY, "swap": _SWAP}
_THREE_Q = {"ccx": _CCX, "toffoli": _CCX}

# arity by gate name — the judge uses this to validate q-list lengths.
PARAM_1Q = {"rx", "ry", "rz", "p", "phase", "u1"}
ONE_Q = set(_CONST) | PARAM_1Q
TWO_Q = set(_TWO_Q) | {"crz", "cp", "rzz"}
THREE_Q = set(_THREE_Q)
KNOWN_GATES = ONE_Q | TWO_Q | THREE_Q


def _rot(axis, theta):
    c, s = np.cos(theta / 2.0), np.sin(theta / 2.0)
    if axis == "x":
        return np.array([[c, -1j * s], [-1j * s, c]], dtype=complex)
    if axis == "y":
        return np.array([[c, -s], [s, c]], dtype=complex)
    if axis == "z":
        return np.array([[np.exp(-1j * theta / 2), 0], [0, np.exp(1j * theta / 2)]], dtype=complex)
    raise ValueError(axis)


def gate_matrix(name, params):
    """Return the unitary matrix for a gate name + params (radians)."""
    name = name.lower()
    if name in _CONST:
        return _CONST[name]
    if name in ("rx", "ry", "rz"):
        return _rot(name[1], float(params[0]))
    if name in ("p", "phase", "u1"):
        lam = float(params[0])
        return np.array([[1, 0], [0, np.exp(1j * lam)]], dtype=complex)
    if name in _TWO_Q:
        return _TWO_Q[name]
    if name in _THREE_Q:
        return _THREE_Q[name]
    if name == "crz":
        m = np.eye(4, dtype=complex)
        m[2:, 2:] = _rot("z", float(params[0]))
        return m
    if name == "cp":
        m = np.eye(4, dtype=complex)
        m[3, 3] = np.exp(1j * float(params[0]))
        return m
    if name == "rzz":
        theta = float(params[0])
        return np.diag([np.exp(-1j * theta / 2), np.exp(1j * theta / 2),
                        np.exp(1j * theta / 2), np.exp(-1j * theta / 2)]).astype(complex)
    raise ValueError(f"unknown gate: {name}")


def apply(state, n, U, qubits):
    """Apply k-qubit unitary U to `qubits` (qubits[0] = most-significant of block)."""
    k = len(qubits)
    psi = state.reshape([2] * n)
    rest = [a for a in range(n) if a not in qubits]
    perm = list(qubits) + rest
    psi = np.transpose(psi, perm).reshape(2 ** k, 2 ** (n - k))
    psi = U @ psi
    psi = psi.reshape([2] * n)
    inv = np.argsort(perm)
    return np.transpose(psi, inv).reshape(-1)


def simulate(circuit):
    """Run a circuit IR -> final statevector (numpy complex array, len 2**n).

    circuit = {"n_qubits": int, "ops": [{"gate": str, "q": [int...], "params": [float...]?}]}
    Starts from |0...0>.
    """
    n = int(circuit["n_qubits"])
    state = np.zeros(2 ** n, dtype=complex)
    state[0] = 1.0
    for op in circuit.get("ops", []):
        name = op["gate"].lower()
        qs = list(op["q"])
        params = op.get("params", [])
        U = gate_matrix(name, params)
        state = apply(state, n, U, qs)
    return state


def fidelity(state, target):
    """State fidelity |<target|state>|^2 for pure states."""
    state = np.asarray(state, dtype=complex)
    target = np.asarray(target, dtype=complex)
    return float(np.abs(np.vdot(target, state)) ** 2)


def expectation_pauli(state, terms, n):
    """<state| H |state> for H = sum_i coeff_i * Pauli_i.

    terms = [{"coeff": float, "pauli": "IXYZ..."}], pauli string length == n,
    leftmost char == qubit 0.
    """
    pauli_1q = {"i": _CONST["id"], "x": _CONST["x"], "y": _CONST["y"], "z": _CONST["z"]}
    total = 0.0
    for term in terms:
        op = np.array([[1.0 + 0j]])
        for ch in term["pauli"].lower():
            op = np.kron(op, pauli_1q[ch])
        val = np.vdot(state, op @ state)
        total += float(term["coeff"]) * val.real
    return float(total)


def circuit_depth(circuit):
    """Standard greedy circuit depth (max over qubits of layered op count)."""
    n = int(circuit["n_qubits"])
    last = [0] * n
    depth = 0
    for op in circuit.get("ops", []):
        qs = list(op["q"])
        layer = max((last[q] for q in qs), default=0) + 1
        for q in qs:
            last[q] = layer
        depth = max(depth, layer)
    return depth


def two_qubit_gate_count(circuit):
    return sum(1 for op in circuit.get("ops", []) if len(op["q"]) >= 2)
