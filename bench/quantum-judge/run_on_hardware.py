#!/usr/bin/env python3
"""
run_on_hardware.py — run a sim-verified design on a backend and emit a
hardware-report@1 JSON that hardware_report.py verifies.

Backends:
  local-ideal              shot sampling from the exact statevector (no noise) — offline, deterministic
  local-noisy[:p]          + depolarizing mixing p (default 0.03) — a stand-in for a noisy device, labeled EMULATED
  ibm:<backend>            real IBM Quantum device (needs qiskit + qiskit-ibm-runtime + your creds)
  braket:<device-arn>      real AWS Braket device (needs amazon-braket-sdk + your creds)

The local backends make the WHOLE hardware path runnable with no QPU and no
credentials (clearly labeled emulated). The provider adapters submit the same
circuit to real silicon. None of this touches the hermetic judge.

  # populations / single observable:
  python3 run_on_hardware.py <bundle.json> --observable XX --backend local-noisy --shots 4096 > report.json
  # vqe (measures the Hamiltonian from the problem's reference term structure):
  python3 run_on_hardware.py <bundle.json> --backend local-noisy --shots 8192 > report.json

Counts convention: qubit 0 = leftmost bit (matches sim.py / judge).
"""
import json
import os
import sys

import numpy as np

import sim

HERE = os.path.dirname(os.path.abspath(__file__))


def basis_change(pauli, n):
    """Ops that rotate each qubit into the eigenbasis of its Pauli before a Z measurement."""
    ops = []
    for i, p in enumerate(pauli.upper()):
        if p == "X":
            ops.append({"gate": "h", "q": [i]})
        elif p == "Y":
            ops.append({"gate": "sdg", "q": [i]}); ops.append({"gate": "h", "q": [i]})
    return ops


def sample_local(circuit, basis, n, shots, noise, seed):
    aug = {"n_qubits": n, "ops": list(circuit["ops"]) + basis_change(basis, n)}
    probs = np.abs(sim.simulate(aug)) ** 2
    if noise > 0:
        probs = (1 - noise) * probs + noise / len(probs)
    probs = probs / probs.sum()
    rng = np.random.RandomState(seed)
    draws = rng.choice(len(probs), size=shots, p=probs)
    counts = {}
    for d in draws:
        b = format(int(d), f"0{n}b")
        counts[b] = counts.get(b, 0) + 1
    return counts


def group_settings(terms, n):
    """Group qubit-wise-commuting Hamiltonian terms into shared measurement settings."""
    settings = []
    for ti, t in enumerate(terms):
        p = t["pauli"].upper()
        for s in settings:
            if all(s["basis"][i] == "I" or p[i] == "I" or s["basis"][i] == p[i] for i in range(n)):
                for i in range(n):
                    if p[i] != "I":
                        s["basis"][i] = p[i]
                s["terms"].append(ti); break
        else:
            b = list("I" * n)
            for i in range(n):
                if p[i] != "I":
                    b[i] = p[i]
            settings.append({"basis": b, "terms": [ti]})
    return settings


def expectation(pauli, counts):
    mask = [i for i, p in enumerate(pauli.upper()) if p != "I"]
    total = sum(counts.values()) or 1
    return sum(((-1) ** sum(1 for i in mask if bits[i] == "1")) * n for bits, n in counts.items()) / total


def run_backend(backend, circuit, basis, n, shots, noise, seed):
    if backend.startswith("local"):
        p = noise
        if backend.startswith("local-ideal"):
            p = 0.0
        if ":" in backend:
            p = float(backend.split(":", 1)[1])
        return sample_local(circuit, basis, n, shots, p, seed)
    if backend.startswith("ibm:"):
        return _ibm(backend.split(":", 1)[1], circuit, basis, n, shots)
    if backend.startswith("braket:"):
        return _braket(backend.split(":", 1)[1], circuit, basis, n, shots)
    raise SystemExit(f"unknown backend {backend!r}")


def _ibm(name, circuit, basis, n, shots):  # pragma: no cover - needs creds + SDK
    from qiskit import QuantumCircuit, transpile                      # noqa: F401
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
    qc = _to_qiskit(circuit, basis, n)
    svc = QiskitRuntimeService()                                      # your saved IBM creds
    be = svc.backend(name)
    res = SamplerV2(be).run([transpile(qc, be)], shots=shots).result()
    raw = res[0].data.meas.get_counts()                              # {bitstring: n}
    # qiskit is little-endian; reverse to qubit-0-leftmost
    return {k[::-1]: v for k, v in raw.items()}


def _to_qiskit(circuit, basis, n):  # pragma: no cover
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, n)
    G = {"h": qc.h, "x": qc.x, "z": qc.z, "sdg": qc.sdg, "cx": qc.cx,
         "ry": qc.ry, "rz": qc.rz, "rx": qc.rx}
    for op in list(circuit["ops"]) + basis_change(basis, n):
        g, q, pr = op["gate"], op["q"], op.get("params", [])
        # qiskit qubit i == our qubit n-1-i (endianness); map indices
        qq = [n - 1 - x for x in q]
        (G[g](*pr, *qq) if pr else G[g](*qq))
    qc.measure(range(n), range(n))
    return qc


def _braket(arn, circuit, basis, n, shots):  # pragma: no cover - needs creds + SDK
    from braket.aws import AwsDevice
    from braket.circuits import Circuit
    c = Circuit()
    for op in list(circuit["ops"]) + basis_change(basis, n):
        g, q, pr = op["gate"], op["q"], op.get("params", [])
        getattr(c, g)(*q, *pr)
    counts = AwsDevice(arn).run(c, shots=shots).result().measurement_counts
    return dict(counts)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
    if not args:
        print("usage: run_on_hardware.py <bundle.json> [--observable XX] [--backend local-noisy] [--shots N --noise p --seed S]", file=sys.stderr)
        return 2
    bundle = json.load(open(args[0]))
    n = int(bundle["circuit"]["n_qubits"])
    backend = opt.get("backend", "local-noisy")
    shots = int(opt.get("shots", 4096))
    noise = float(opt.get("noise", 0.03))
    seed = int(opt.get("seed", 1))
    emulated = backend.startswith("local")

    rep = {"schema": "quantum-harness/hardware-report@1",
           "attests": opt.get("attests", os.path.relpath(os.path.abspath(args[0]), os.path.dirname(os.path.dirname(HERE)))),
           "problem_id": bundle.get("problem_id"), "task": bundle.get("task"),
           "backend": backend + (" (EMULATED — not a real device)" if emulated else ""),
           "n_shots": shots, "settings": [], "measured": {}, "tolerance": 0.05,
           "run_at": opt.get("run_at", "FILL-DATE"), "runner": opt.get("runner", "run_on_hardware.py")}

    if bundle.get("task") == "vqe":
        ref = json.load(open(os.path.join(HERE, "references", f"{bundle['problem_id']}.json")))
        terms = ref["hamiltonian_terms"]                     # term STRUCTURE is public; E0 is not used here
        groups = group_settings(terms, n)
        for s in groups:
            basis = "".join(s["basis"])
            rep["settings"].append({"pauli": basis, "counts": run_backend(backend, bundle["circuit"], basis, n, shots, noise, seed)})
        mterms, val = [], 0.0
        for gi, s in enumerate(groups):
            for ti in s["terms"]:
                e = expectation(terms[ti]["pauli"], rep["settings"][gi]["counts"])
                val += float(terms[ti]["coeff"]) * e
                mterms.append({"coeff": terms[ti]["coeff"], "pauli": terms[ti]["pauli"], "setting": gi})
        rep["measured"] = {"metric": "energy", "value": round(val, 6), "terms": mterms}
    else:
        obs = opt.get("observable", "Z" * n)
        counts = run_backend(backend, bundle["circuit"], obs, n, shots, noise, seed)
        rep["settings"] = [{"pauli": obs, "counts": counts}]
        rep["measured"] = {"metric": obs, "value": round(expectation(obs, counts), 6)}

    print(json.dumps(rep, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
