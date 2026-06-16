"""
density_matrix.py — a deterministic density-matrix simulator with a depolarizing
noise model, so the judge can verify a NOISY device prediction the same way it
verifies an ideal one: by recomputing it exactly.

Why this exists
  The statevector sim in sim.py answers "what does this circuit do on a perfect
  machine?". Real devices are noisy, and a contributor may want to predict what a
  circuit yields UNDER a stated noise budget (a device-fidelity prediction). That
  prediction must be re-verifiable — anyone recomputes the same number — so it
  cannot be sampled (shots wander). Here we evolve the full density matrix rho
  under unitary gates AND depolarizing channels and read off Tr(rho P) and
  <target|rho|target> EXACTLY. Same numpy-only, offline, deterministic ethos.

Noise model (declared in the hidden reference as `noise_model`, also stated in the
brief so a contributor can compute it; the judge uses the REFERENCE's copy so the
model cannot be gamed):
    {"model": "depolarizing", "depolarizing_1q": p1, "depolarizing_2q": p2}
  After each 1-qubit gate, a single-qubit depolarizing channel of strength p1 acts
  on that qubit; after each multi-qubit gate, a depolarizing channel of strength p2
  acts on EACH involved qubit. Single-qubit depolarizing(p):
      E(rho) = (1-p) rho + (p/3)(X rho X + Y rho Y + Z rho Z),
  which shrinks a qubit's Bloch vector by the factor (1 - 4p/3) — the standard
  convention, checked in the test suite.

Qubit/index convention is sim.py's: qubit 0 is the most-significant index.
"""

import numpy as np

import sim

_PAULI = {"i": sim._CONST["id"], "x": sim._CONST["x"], "y": sim._CONST["y"], "z": sim._CONST["z"]}


def full_operator(U, qubits, n):
    """Embed a k-qubit unitary U acting on `qubits` into the full 2**n operator.

    Built by pushing U through sim.apply() on each basis column, so it inherits
    sim.py's exact qubit-ordering convention (no separate, drift-prone code path).
    """
    dim = 2 ** n
    out = np.empty((dim, dim), dtype=complex)
    e = np.zeros(dim, dtype=complex)
    for i in range(dim):
        e[:] = 0.0
        e[i] = 1.0
        out[:, i] = sim.apply(e, n, U, list(qubits))
    return out


def _pauli_full(axis, q, n):
    return full_operator(_PAULI[axis], [q], n)


def depolarize_1q(rho, q, n, p):
    """Apply a single-qubit depolarizing channel of strength p to qubit q."""
    if p <= 0.0:
        return rho
    X = _pauli_full("x", q, n)
    Y = _pauli_full("y", q, n)
    Z = _pauli_full("z", q, n)
    return (1.0 - p) * rho + (p / 3.0) * (X @ rho @ X + Y @ rho @ Y + Z @ rho @ Z)


def simulate_density(circuit, noise_model=None):
    """Run a circuit IR -> final density matrix rho (2**n x 2**n), starting from
    |0...0><0...0|, applying the depolarizing noise_model after each gate."""
    noise_model = noise_model or {}
    p1 = float(noise_model.get("depolarizing_1q", noise_model.get("p1", 0.0)))
    p2 = float(noise_model.get("depolarizing_2q", noise_model.get("p2", 0.0)))
    n = int(circuit["n_qubits"])
    dim = 2 ** n
    rho = np.zeros((dim, dim), dtype=complex)
    rho[0, 0] = 1.0
    for op in circuit.get("ops", []):
        name = op["gate"].lower()
        qs = list(op["q"])
        params = op.get("params", [])
        G = full_operator(sim.gate_matrix(name, params), qs, n)
        rho = G @ rho @ G.conj().T
        if len(qs) == 1:
            rho = depolarize_1q(rho, qs[0], n, p1)
        else:
            for q in qs:
                rho = depolarize_1q(rho, q, n, p2)
    return rho


def expectation_pauli_dm(rho, terms, n):
    """<H> = Tr(rho H) for H = sum_i coeff_i Pauli_i (real)."""
    total = 0.0
    for term in terms:
        op = np.array([[1.0 + 0j]])
        for ch in term["pauli"].lower():
            op = np.kron(op, _PAULI[ch])
        total += float(term["coeff"]) * np.trace(rho @ op).real
    return float(total)


def state_fidelity_dm(rho, target):
    """Fidelity of a mixed state rho to a PURE target: <target|rho|target>."""
    target = np.asarray(target, dtype=complex)
    return float((target.conj() @ rho @ target).real)


def purity(rho):
    """Tr(rho^2): 1 for a pure state, < 1 once noise mixes it."""
    return float(np.trace(rho @ rho).real)


def main(argv):
    """CLI: recompute a bundle's NOISY prediction under its problem's noise model.

    Usage: python3 density_matrix.py <bundle.json>
    Loads the hidden reference's noise_model (and target/Hamiltonian) and prints
    the deterministic noisy metric a contributor would put in claim.noisy_*.
    """
    import json
    import judge_verify

    if not argv[1:]:
        print("usage: density_matrix.py <bundle.json>", file=__import__("sys").stderr)
        return 2
    with open(argv[1]) as f:
        bundle = json.load(f)
    ref = judge_verify.load_reference(bundle["problem_id"])
    noise = ref.get("noise_model")
    if not noise:
        print(f"problem {bundle['problem_id']!r} declares no noise_model", file=__import__("sys").stderr)
        return 1
    circuit = bundle["circuit"]
    n = int(circuit["n_qubits"])
    rho = simulate_density(circuit, noise)
    out = {"problem_id": bundle["problem_id"], "noise_model": noise, "purity": round(purity(rho), 8)}
    if ref.get("task") == "vqe":
        out["noisy_energy"] = round(expectation_pauli_dm(rho, ref["hamiltonian_terms"], n), 8)
    else:
        target = np.array([complex(re, im) for re, im in ref["target_statevector"]], dtype=complex)
        out["noisy_fidelity"] = round(state_fidelity_dm(rho, target), 8)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv))
