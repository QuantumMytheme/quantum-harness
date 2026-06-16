#!/usr/bin/env python3
"""
run_on_hardware.py — submit a sim-verified circuit to a REAL QPU and emit a
hardware-report@1 JSON that hardware_report.py then verifies.

This is the ONLY part of the harness that needs a network, a vendor SDK, and YOUR
credentials, so it lives OUTSIDE the hermetic judge and ships as an adapter STUB.
Without a provider wired in, it emits a fillable report skeleton (with the right
circuit + observable) so you can run on any device and paste the counts back.

  python3 run_on_hardware.py <proof-bundle.json> --observable XX [--backend NAME --shots 4096]

Providers (install only the one you use — NONE are required by the judge):
  IBM Quantum : pip install qiskit qiskit-ibm-runtime
  AWS Braket  : pip install amazon-braket-sdk
  IonQ / etc. : the vendor SDK

The circuit is the proof bundle's `circuit.ops` (qubit 0 = leftmost bit). For an
observable like XX you append a basis change (H on each X-qubit) before measuring,
submit, collect counts, and the skeleton fields fill in.
"""

import json
import sys


def emit_skeleton(bundle, observable, backend, shots):
    return {
        "schema": "quantum-harness/hardware-report@1",
        "attests": "PATH/TO/your-proof-bundle.json",      # the sim-ACCEPTed design (repo-relative)
        "problem_id": bundle.get("problem_id"),
        "task": bundle.get("task"),
        "backend": backend or "FILL-IN: e.g. ibm_torino / aws-braket:ionq",
        "n_shots": shots,
        "settings": [
            {"pauli": observable, "counts": {"FILL": 0}}    # paste your device counts here
        ],
        "measured": {"metric": observable, "value": 0.0},   # set to <obs> recomputed from counts
        "tolerance": 0.01,
        "calibration": {"note": "snapshot the backend's error rates at run time"},
        "job_id": "FILL-IN", "run_at": "FILL-IN-DATE", "runner": "your-handle",
    }


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
    if not args:
        print("usage: run_on_hardware.py <proof-bundle.json> --observable XX [--backend NAME --shots N]", file=sys.stderr)
        return 2
    with open(args[0]) as f:
        bundle = json.load(f)
    observable = opt.get("observable", "XX")
    backend = opt.get("backend")
    shots = int(opt.get("shots", 4096))

    # ---- PROVIDER ADAPTER (uncomment + wire your SDK; emits real counts) ----------
    # from qiskit import QuantumCircuit, transpile
    # from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
    # qc = build_qiskit_circuit(bundle["circuit"], observable)   # ops -> gates + basis change + measure
    # service = QiskitRuntimeService()                           # uses your saved IBM credentials
    # backend_obj = service.backend(backend)
    # counts = SamplerV2(backend_obj).run([transpile(qc, backend_obj)], shots=shots) ...
    # -> fill settings[0].counts and measured.value, then run hardware_report.py to verify.
    # -------------------------------------------------------------------------------

    json.dump(emit_skeleton(bundle, observable, backend, shots), sys.stdout, indent=2)
    print("\n# Skeleton emitted. Run on your device, paste counts into settings[].counts,")
    print("# set measured.value to <obs> from those counts, then: python3 hardware_report.py <report.json>", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
