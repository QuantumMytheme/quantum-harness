#!/usr/bin/env python3
"""
qpu.py: the hubbard2x2 half-filled state on a real IBM device (README "Next" 1; DECLARED.md, hardware addendum).
Builds the compact 3-layer circuit (results/pb-circuits-U4.json, N = 4, U = 4) plus the three number-conserving
measurement settings of realistic.py (all-Z, x bonds, y bonds), converts them to Qiskit, and transpiles them for a
backend. `study` is local and free (no QPU time): it reports two-qubit counts and the device's calibration medians.
  ~/venvs/qiskit/bin/python bench/hubbard/qpu.py study ibm_fez ibm_marrakesh ibm_kingston
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "quantum-judge"))
import pair_binding_vqe as pbv  # noqa: E402
import realistic as rl  # noqa: E402

U, N, LAYERS = 4, 4, "3"


def ops_for(setting):
    rec = json.load(open(os.path.join(HERE, "results", f"pb-circuits-U{U}.json")))["layers"][LAYERS]["by_N"][str(N)]
    circ = pbv.circuit(N, rec["params"], compact=True)
    name, rot, _diag = setting
    return circ["ops"] + list(rot), rec


def to_qiskit(ops, n=8, name="", measure=True):
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, n, name=name)
    for op in ops:
        g, q, p = op["gate"], op["q"], op.get("params", [])
        if g in ("x", "h", "s", "sdg"):
            getattr(qc, g)(q[0])
        elif g == "rz":
            qc.rz(p[0], q[0])
        elif g == "ry":
            qc.ry(p[0], q[0])
        elif g == "cx":
            qc.cx(q[0], q[1])
        elif g == "rzz":
            qc.rzz(p[0], q[0], q[1])
        else:
            raise ValueError(f"unmapped gate {g}")
    if measure:
        qc.measure(range(n), range(n))
    return qc


def calib_medians(backend):
    t = backend.target
    two = [p.error for name in t.operation_names if t.operation_from_name(name).num_qubits == 2
           for qargs, p in t[name].items() if p is not None and p.error is not None]
    ro = [p.error for qargs, p in t["measure"].items() if p is not None and p.error is not None]
    return float(np.median(two)), float(np.median(ro)), [n for n in t.operation_names if t.operation_from_name(n).num_qubits == 2]


def study(names):
    from qiskit import transpile
    from qiskit_ibm_runtime import QiskitRuntimeService
    svc = QiskitRuntimeService(name="quantummytheme")
    settings = rl.settings(U)
    for name in names:
        be = svc.backend(name)
        e2, ero, gates2 = calib_medians(be)
        row = []
        for s in settings:
            ops, rec = ops_for(s)
            qc = to_qiskit(ops, name=s[0])
            best = None
            for seed in range(8):
                tq = transpile(qc, backend=be, optimization_level=3, seed_transpiler=seed)
                n2 = sum(v for k, v in tq.count_ops().items() if k in gates2)
                if best is None or n2 < best[0]:
                    best = (n2, tq.depth(), seed)
            row.append((s[0], best))
        logical = sum(1 for o in ops_for(settings[0])[0] if len(o["q"]) == 2)
        print(f"{name}: median 2q error {e2:.2e}, median readout {ero:.2e}, 2q gates {gates2}; logical 2q (state prep, Z setting) {logical}")
        for s, (n2, d, seed) in row:
            est = np.exp(-n2 * e2)
            print(f"   setting {s}: transpiled 2q {n2}, depth {d} (seed {seed}); crude whole-circuit fidelity exp(-n2*e2) = {est:.2f}")


import hubbard as hb  # noqa: E402
import fastdm  # noqa: E402

HOLDOUT = {"ZIIIIZII": 0.482078, "ZIZIIIII": 0.230597}  # references/hubbard2x2.json holdout (tolerance 0.05)
IN_SECTOR = np.array([hb.sector_of_index(i, pbv.cluster) == pbv.SECTOR[N] for i in range(2 ** 8)])


def zstring_diag(p):
    d = np.ones(2 ** 8)
    for q, c in enumerate(p):
        if c == "Z":
            d = d * np.array([1 - 2 * ((i >> (7 - q)) & 1) for i in range(2 ** 8)])
    return d


def invert_readout(probs, conf):
    """conf[q] = (e01, e10): P(read 1 | prep 0), P(read 0 | prep 1) for bench qubit q (qubit 0 = most significant)."""
    t = probs.reshape([2] * 8)
    for q, (e01, e10) in enumerate(conf):
        A = np.linalg.inv(np.array([[1 - e01, e10], [e01, 1 - e10]]))
        t = np.moveaxis(np.tensordot(A, t, axes=([1], [q])), 0, q)
    return t.reshape(-1)


def analyze(probs, conf):
    """probs: {setting name: 256-vector in bench order}. Same function for the prediction and the hardware.
    Returns raw (no mitigation), and readout-inverted + post-selected energy and holdouts, with kept fractions."""
    sets = {s[0]: s for s in rl.settings(U)}
    out = {}
    for mode in ("raw", "mitigated"):
        e, kept = 0.0, {}
        hold = {}
        for name, (_, _rot, f) in sets.items():
            p = np.clip(probs[name], 0, None); p = p / p.sum()
            if mode == "mitigated":
                p = invert_readout(p, conf) * IN_SECTOR
                kept[name] = float(p.sum()); p = p / p.sum()
            e += float(p @ f)
            if name == "Z":
                hold = {k: float(p @ zstring_diag(k)) for k in HOLDOUT}
        out[mode] = {"energy": e, "holdout": hold, "kept": kept}
    return out


def predict(e2q, e_ro, transpiled):
    """Gate-error model on the logical circuit: per-qubit depolarizing p2 on each logical two-qubit gate, scaled so
    the logical count carries the transpiled CZ count's error (p2 = e_cz * n_cz / n_logical; p1 = p2 / 10);
    symmetric readout flip e_ro. Idle decoherence and crosstalk are NOT modelled (model B doubles p2 for them)."""
    out = {}
    for label, k in (("A: gates at calibration medians", 1.0), ("B: x2 for idle/crosstalk/worse qubits", 2.0)):
        probs = {}
        for s in rl.settings(U):
            ops, _ = ops_for(s)
            n_log = sum(1 for o in ops if len(o["q"]) == 2)
            p2 = k * e2q * transpiled[s[0]] / n_log
            rho = fastdm.simulate_density({"n_qubits": 8, "ops": ops}, p2 / 10, p2)
            probs[s[0]] = rl.readout(np.clip(np.real(np.diag(rho)), 0, None), e_ro)
        out[label] = analyze(probs, [(e_ro, e_ro)] * 8)
    return out


def check_conversion():
    """Ideal Qiskit statevector of the state prep must give the exact energy under the bench's Hamiltonian
    (catches qubit-order and angle-convention mismatches). Qiskit is little-endian: reverse to the bench order."""
    import hubbard as hb
    from qiskit.quantum_info import Statevector
    ops, rec = ops_for(("Z", [], None))
    psi = Statevector(to_qiskit(ops, measure=False)).data.reshape([2] * 8).transpose(list(range(7, -1, -1))).reshape(-1)
    H = hb.pauli_matrix(hb.jw_terms(pbv.cluster, float(U)), pbv.N_Q)
    e = float(np.real(psi.conj() @ H @ psi))
    print(f"qiskit statevector energy {e:.9f} vs saved {rec['energy']:.9f} (diff {e - rec['energy']:+.1e})")
    return abs(e - rec["energy"]) < 1e-8


if __name__ == "__main__":
    if sys.argv[1] == "predict":   # predict <e_cz> <e_ro> <n_cz Z> <n_cz x> <n_cz y>
        e2, ero = float(sys.argv[2]), float(sys.argv[3])
        tr = dict(zip(("Z", "x", "y"), map(int, sys.argv[4:7])))
        res = predict(e2, ero, tr)
        print(json.dumps({"exact": {"energy": -6.102748483462076, "holdout": HOLDOUT}, "inputs": {"e_cz": e2, "e_ro": ero, "n_cz": tr}, "predictions": res}, indent=1))
    if sys.argv[1] == "check":
        sys.exit(0 if check_conversion() else 1)
    if sys.argv[1] == "study":
        study(sys.argv[2:])
