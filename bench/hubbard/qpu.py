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


def counts_to_probs(counts):
    """Sampler counts ('c7...c0', clbit i = bench qubit i) -> 256-vector in bench order (qubit 0 most significant)."""
    v = np.zeros(2 ** 8)
    for bits, c in counts.items():
        v[int(bits[::-1], 2)] += c
    return v / v.sum()


def confusion(c0, c1):
    """Per bench qubit (e01, e10) from all-0 and all-1 calibration counts."""
    out = []
    for q in range(8):
        n0 = sum(c0.values()); n1 = sum(c1.values())
        e01 = sum(c for b, c in c0.items() if b[::-1][q] == "1") / n0
        e10 = sum(c for b, c in c1.items() if b[::-1][q] == "0") / n1
        out.append((e01, e10))
    return out


def fold3(isa, scale=3):
    """Global fold C·(C†·C)^((scale-1)/2) of an ISA circuit's body (measurements moved to the end), re-translated
    to the native gates with no optimisation, so no inverse pair is cancelled and the layout is unchanged."""
    from qiskit import QuantumCircuit, transpile
    body = isa.remove_final_measurements(inplace=False)
    folded = body
    for _ in range((scale - 1) // 2):
        folded = folded.compose(body.inverse()).compose(body)
    meas = QuantumCircuit(isa.num_qubits, isa.num_clbits)
    for inst in isa.data:
        if inst.operation.name == "measure":
            meas.append(inst.operation, inst.qubits, inst.clbits)
    out = QuantumCircuit(isa.num_qubits, isa.num_clbits); out.compose(folded, inplace=True); out.compose(meas, inplace=True)
    return out


def measured_physical(isa):
    """clbit index -> physical qubit, from the ISA circuit's measurements."""
    return {isa.find_bit(i.clbits[0]).index: isa.find_bit(i.qubits[0]).index for i in isa.data if i.operation.name == "measure"}


def calibration_circuits(isa, n_qubits):
    from qiskit import QuantumCircuit
    m = measured_physical(isa); cs = []
    for ones in (False, True):
        qc = QuantumCircuit(n_qubits, 8)
        for cb, pq in m.items():
            if ones:
                qc.x(pq)
            qc.measure(pq, cb)
        cs.append(qc)
    return cs


def build(backend, seeds=range(8), scales=(1, 3)):
    """ISA circuits: for each setting the best-of-seeds transpile (scale 1), its fold (scale 3), and calibrations."""
    from qiskit import transpile
    gates2 = calib_medians(backend)[2]
    pubs, meta = [], []
    for s in rl.settings(U):
        qc = to_qiskit(ops_for(s)[0], name=s[0])
        best = min((transpile(qc, backend=backend, optimization_level=3, seed_transpiler=sd) for sd in seeds),
                   key=lambda t: sum(v for k, v in t.count_ops().items() if k in gates2))
        n1 = sum(v for k, v in best.count_ops().items() if k in gates2)
        folds = {}
        for sc in scales:
            if sc == 1:
                continue
            f = transpile(fold3(best, sc), backend=backend, optimization_level=0, layout_method="trivial", routing_method="none")
            nf = sum(v for k, v in f.count_ops().items() if k in gates2)
            assert nf == sc * n1, (s[0], sc, n1, nf)
            assert measured_physical(f) == measured_physical(best), "fold changed the measured qubits"
            folds[sc] = f
        cal0, cal1 = (transpile(c, backend=backend, optimization_level=0, layout_method="trivial", routing_method="none")
                      for c in calibration_circuits(best, backend.num_qubits))
        for kind, circ in [("scale1", best)] + [(f"scale{sc}", folds[sc]) for sc in sorted(folds)] + [("cal0", cal0), ("cal1", cal1)]:
            pubs.append(circ); meta.append({"setting": s[0], "kind": kind, "cz": sum(v for k, v in circ.count_ops().items() if k in gates2),
                                            "measured_physical": measured_physical(circ)})
    return pubs, meta


def analyze_job(meta, counts):
    """counts[i] for pub i. Returns per-scale mitigated/raw results and linear ZNE."""
    by = {(m["setting"], m["kind"]): c for m, c in zip(meta, counts)}
    res = {}
    scales = sorted({m["kind"] for m in meta if m["kind"].startswith("scale")}, key=lambda k: int(k[5:]))
    for scale in scales:
        probs = {s: counts_to_probs(by[(s, scale)]) for s in ("Z", "x", "y")}
        conf = {s: confusion(by[(s, "cal0")], by[(s, "cal1")]) for s in ("Z", "x", "y")}
        sets = {x[0]: x for x in rl.settings(U)}
        mit, raw = 0.0, 0.0
        kept, hold_m, hold_r = {}, {}, {}
        for s in ("Z", "x", "y"):
            f = sets[s][2]
            pr = probs[s]; raw += float(pr @ f)
            pm = invert_readout(pr, conf[s]) * IN_SECTOR; kept[s] = float(pm.sum()); pm = pm / pm.sum(); mit += float(pm @ f)
            if s == "Z":
                hold_m = {k: float(pm @ zstring_diag(k)) for k in HOLDOUT}; hold_r = {k: float(pr @ zstring_diag(k)) for k in HOLDOUT}
                nZ = sum(by[(s, scale)].values()) * kept[s]
        res[scale] = {"raw": {"energy": raw, "holdout": hold_r}, "mitigated": {"energy": mit, "holdout": hold_m, "kept": kept},
                      "confusion": {s: conf[s] for s in conf}, "n_kept_Z": nZ}
    z = lambda a, b: (3 * a - b) / 2
    res["zne"] = {"energy": z(res["scale1"]["mitigated"]["energy"], res["scale3"]["mitigated"]["energy"]),
                  "holdout": {k: z(res["scale1"]["mitigated"]["holdout"][k], res["scale3"]["mitigated"]["holdout"][k]) for k in HOLDOUT}}
    if "scale5" in res:
        q = lambda a, b, c: (15 * a - 10 * b + 3 * c) / 8
        m = lambda sc, key=None: res[sc]["mitigated"]["energy"] if key is None else res[sc]["mitigated"]["holdout"][key]
        res["zne_quadratic"] = {"energy": q(m("scale1"), m("scale3"), m("scale5")),
                                "holdout": {k: q(m("scale1", k), m("scale3", k), m("scale5", k)) for k in HOLDOUT}}
    return res


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


SHOTS, RANDOMIZATIONS, CAL_SHOTS, USAGE_CAP_S = 24576, 96, 4096, 400


def run(scales=(1, 3), shots=SHOTS, cap=USAGE_CAP_S, force=None):
    """Declared run (DECLARED.md hardware addendum): one Sampler V2 job; device by the declared rule; cancel while
    queued if IBM's usage estimate exceeds the cap. Writes results/qpu-<job>.json before and after."""
    import time
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
    svc = QiskitRuntimeService(name="quantummytheme")
    usage0 = svc.usage()
    be = svc.backend(force or "ibm_kingston")
    if force is None and be.status().pending_jobs > 20:
        be = svc.backend("ibm_fez")
    e2, ero, _ = calib_medians(be)
    pubs, meta = build(be, scales=scales)
    sampler = SamplerV2(mode=be)
    sampler.options.twirling.enable_gates = True
    sampler.options.twirling.num_randomizations = RANDOMIZATIONS
    sampler.options.twirling.shots_per_randomization = "auto"  # 256 on the 24 576-shot circuits, ~43 on calibrations
    sampler.options.dynamical_decoupling.enable = True
    sampler.options.dynamical_decoupling.sequence_type = "XY4"
    job = sampler.run([(c, None, CAL_SHOTS if m["kind"].startswith("cal") else shots) for c, m in zip(pubs, meta)])
    rec = {"job_id": job.job_id(), "backend": be.name, "submitted": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "calibration_medians": {"cz_error": e2, "readout_error": ero}, "pending_at_submit": be.status().pending_jobs,
           "usage_before_s": usage0.get("usage_consumed_seconds"), "shots": shots, "scales": list(scales), "randomizations": RANDOMIZATIONS,
           "cal_shots": CAL_SHOTS, "meta": meta}
    path = os.path.join(HERE, "results", f"qpu-{job.job_id()}.json")
    json.dump(rec, open(path, "w"), indent=1)
    print("submitted", job.job_id(), "to", be.name, "->", path, flush=True)
    for _ in range(60):
        est = (job.usage_estimation or {}).get("quantum_seconds")
        if est is not None:
            print("IBM usage estimate", est, "s", flush=True)
            if est > cap:
                job.cancel(); print("CANCELLED: estimate over the declared cap", flush=True)
            break
        time.sleep(10)
    return job.job_id()


def collect(job_id):
    from qiskit_ibm_runtime import QiskitRuntimeService
    svc = QiskitRuntimeService(name="quantummytheme")
    job = svc.job(job_id)
    path = os.path.join(HERE, "results", f"qpu-{job_id}.json")
    rec = json.load(open(path))
    result = job.result()
    counts = [r.data[list(r.data.keys())[0]].get_counts() for r in result]
    rec["counts"] = counts
    rec["metrics"] = {k: str(v) for k, v in (job.metrics() or {}).items()}
    rec["usage_after_s"] = svc.usage().get("usage_consumed_seconds")
    rec["analysis"] = analyze_job(rec["meta"], counts)
    json.dump(rec, open(path, "w"), indent=1)
    return rec


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run()
    if sys.argv[1] == "run3":   # addendum 2: scales 1, 3, 5; 49 152 shots; cap 350 s
        run(scales=(1, 3, 5), shots=49152, cap=350, force="ibm_kingston")
    if sys.argv[1] == "collect":
        r = collect(sys.argv[2]); print(json.dumps(r["analysis"], indent=1)[:4000])
    if sys.argv[1] == "predict":   # predict <e_cz> <e_ro> <n_cz Z> <n_cz x> <n_cz y>
        e2, ero = float(sys.argv[2]), float(sys.argv[3])
        tr = dict(zip(("Z", "x", "y"), map(int, sys.argv[4:7])))
        res = predict(e2, ero, tr)
        print(json.dumps({"exact": {"energy": -6.102748483462076, "holdout": HOLDOUT}, "inputs": {"e_cz": e2, "e_ro": ero, "n_cz": tr}, "predictions": res}, indent=1))
    if sys.argv[1] == "check":
        sys.exit(0 if check_conversion() else 1)
    if sys.argv[1] == "study":
        study(sys.argv[2:])
