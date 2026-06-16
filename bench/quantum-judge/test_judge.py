#!/usr/bin/env python3
"""
test_judge.py — regression suite for the quantum bench judge.

Mirrors fieldops-harness/bench/rcan-proof's expect-pass / expect-fail discipline:
the committed worked examples must ACCEPT, and every class of forgery must be
REJECTED with the right exit code. If this suite is green, the bench is sound:
no fabricated result, constraint violation, or overfit claim can score.

Run:  python3 test_judge.py   (exit 0 = all pass)
"""

import copy
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE = os.path.join(HERE, "judge_verify.py")

sys.path.insert(0, HERE)
import judge_verify  # noqa: E402

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = PASS if ok else FAIL
    print(f"  {mark} {name}" + (f"  — {detail}" if detail and not ok else ""))


def run_cli(bundle_path):
    """End-to-end: invoke judge_verify.py as a subprocess, return exit code."""
    p = subprocess.run([sys.executable, JUDGE, bundle_path, "--json"],
                       capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def verify_code(bundle):
    """In-process verify(); return exit code (0 on accept)."""
    try:
        judge_verify.verify(bundle)
        return 0
    except judge_verify.Reject as r:
        return r.code


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def main():
    print("quantum-judge regression suite")

    # 1. Worked examples ACCEPT end-to-end (exit 0).
    for fixture in ("quantum-proof-poc.json", "quantum-proof-vqe.json"):
        code, out = run_cli(os.path.join(HERE, fixture))
        record(f"{fixture} ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")

    # 2. The committed FORGED bundle is REJECTED for fabricated results (exit 4).
    code, out = run_cli(os.path.join(HERE, "quantum-proof-FORGED.json"))
    record("quantum-proof-FORGED.json REJECTed as reproducibility fraud (exit 4)",
           code == judge_verify.EXIT_REPRODUCIBILITY, f"exit {code}: {out}")

    poc = load("quantum-proof-poc.json")

    # 3. Tampered claim on an otherwise-valid circuit -> reproducibility reject.
    b = copy.deepcopy(poc); b["claim"]["fidelity"] = 0.95
    record("overclaimed fidelity REJECTed (exit 4)",
           verify_code(b) == judge_verify.EXIT_REPRODUCIBILITY)

    # 4. 2q gate off the coupling map -> structure reject.
    b = copy.deepcopy(poc)
    b["circuit"]["ops"] = [{"gate": "h", "q": [0]}, {"gate": "cx", "q": [0, 2]}]
    record("2q gate off coupling map REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # 5. Non-native gate -> structure reject.
    b = copy.deepcopy(poc)
    b["circuit"]["ops"].append({"gate": "t", "q": [0]})
    record("non-native gate REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # 6. Depth over budget -> structure reject.
    b = copy.deepcopy(poc); b["constraints"]["max_depth"] = 2
    record("depth over budget REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # 7. Wrong qubit count -> structure reject.
    b = copy.deepcopy(poc); b["constraints"]["n_qubits"] = 4
    record("n_qubits mismatch REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # 8. 2q-gate cap exceeded -> structure reject.
    b = copy.deepcopy(poc); b["constraints"]["max_two_qubit_gates"] = 1
    record("2q-gate cap exceeded REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # 9. Underperforming circuit (valid but low fidelity) -> performance reject.
    b = copy.deepcopy(poc)
    b["circuit"]["ops"] = [{"gate": "h", "q": [0]}, {"gate": "cx", "q": [0, 1]}]
    b["claim"]["fidelity"] = 0.25  # honest claim for this weaker circuit
    record("honest-but-underperforming circuit REJECTed (exit 5)",
           verify_code(b) == judge_verify.EXIT_PERFORMANCE)

    # 10. capture.py round-trip: a captured bundle ACCEPTs under the judge.
    circ = {"n_qubits": 3,
            "ops": poc["circuit"]["ops"],
            "constraints": poc["constraints"],
            "classical_baseline": poc["classical_baseline"]}
    spec_path = os.path.join(HERE, "_tmp_circuit.json")
    with open(spec_path, "w") as f:
        json.dump(circ, f)
    try:
        cap = subprocess.run([sys.executable, os.path.join(HERE, "capture.py"),
                              spec_path, "ghz3", "--task", "state_prep"],
                             capture_output=True, text=True)
        bundle = json.loads(cap.stdout)
        record("capture.py output ACCEPTs under judge", verify_code(bundle) == 0)
    finally:
        os.remove(spec_path)

    # --- ANTI-OVERFIT gate (exit 6): the held-out generalization check ---------
    # 12. genuine Bell state ACCEPTs end-to-end.
    code, out = run_cli(os.path.join(HERE, "quantum-proof-pops.json"))
    record("quantum-proof-pops.json (genuine Bell) ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")

    # 13. wrong-phase impostor is REJECTed at the held-out gate.
    code, out = run_cli(os.path.join(HERE, "quantum-proof-OVERFIT.json"))
    record("quantum-proof-OVERFIT.json REJECTed at ANTI-OVERFIT (exit 6)",
           code == judge_verify.EXIT_OVERFIT, f"exit {code}: {out}")

    pops = load("quantum-proof-pops.json")
    overfit = load("quantum-proof-OVERFIT.json")

    # 14. the impostor passes structure/reproducibility/performance and fails ONLY exit 6.
    record("overfit impostor fails ONLY at the held-out gate (exit 6)",
           verify_code(overfit) == judge_verify.EXIT_OVERFIT)

    # 15. control: same task, genuine circuit -> ACCEPT (the held-out gate is the sole difference).
    record("genuine populations bundle ACCEPTs (exit 0)", verify_code(pops) == 0)

    # 16. tampered populations claim -> reproducibility reject (gate independence).
    b = copy.deepcopy(pops); b["claim"]["populations"] = [0.4, 0.0, 0.0, 0.6]
    record("tampered populations claim REJECTed (exit 4)",
           verify_code(b) == judge_verify.EXIT_REPRODUCIBILITY)

    # 17. honest circuit that misses the target distribution -> performance reject.
    b = copy.deepcopy(pops)
    b["circuit"]["ops"] = [{"gate": "h", "q": [0]}]
    b["claim"]["populations"] = [0.5, 0.0, 0.5, 0.0]  # honest for this weaker circuit
    record("wrong-distribution populations REJECTed (exit 5)",
           verify_code(b) == judge_verify.EXIT_PERFORMANCE)

    # --- ARCHITECTURE task: topology design with held-out routing -------------
    code, out = run_cli(os.path.join(HERE, "quantum-proof-arch.json"))
    record("quantum-proof-arch.json (ring topology) ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")
    code, out = run_cli(os.path.join(HERE, "quantum-proof-arch-OVERFIT.json"))
    record("quantum-proof-arch-OVERFIT.json REJECTed at ANTI-OVERFIT (exit 6)",
           code == judge_verify.EXIT_OVERFIT, f"exit {code}: {out}")
    arch = load("quantum-proof-arch.json")
    b = copy.deepcopy(arch); b["claim"]["routing_cost"] = 1
    record("architecture tampered routing_cost REJECTed (exit 4)",
           verify_code(b) == judge_verify.EXIT_REPRODUCIBILITY)
    b = copy.deepcopy(arch)
    b["architecture"]["coupling_map"] = [[0, 2], [2, 1], [1, 3]]  # path 0-2-1-3 -> visible cost 4
    b["claim"]["routing_cost"] = 4
    record("architecture over-budget routing REJECTed (exit 5)",
           verify_code(b) == judge_verify.EXIT_PERFORMANCE)
    b = copy.deepcopy(arch); b["architecture"]["coupling_map"] = [[0, 1], [0, 2], [0, 3]]  # degree 3
    record("architecture degree-over-budget REJECTed (exit 3)",
           verify_code(b) == judge_verify.EXIT_STRUCTURE)

    # --- CLASSIFY task: QML feature map with held-out test set ----------------
    code, out = run_cli(os.path.join(HERE, "quantum-proof-qml.json"))
    record("quantum-proof-qml.json (low-frequency map) ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")
    code, out = run_cli(os.path.join(HERE, "quantum-proof-qml-OVERFIT.json"))
    record("quantum-proof-qml-OVERFIT.json REJECTed at ANTI-OVERFIT (exit 6)",
           code == judge_verify.EXIT_OVERFIT, f"exit {code}: {out}")
    qml = load("quantum-proof-qml.json")
    b = copy.deepcopy(qml); b["claim"]["train_accuracy"] = 0.5
    record("classify tampered train_accuracy REJECTed (exit 4)",
           verify_code(b) == judge_verify.EXIT_REPRODUCIBILITY)
    b = copy.deepcopy(qml)  # scale 0 -> Ry(0)=I -> <X>=0 -> predicts 0 for all -> train acc 0.5
    b["feature_map"]["ops"][0]["scale"] = 0.0
    b["claim"]["train_accuracy"] = 0.5
    record("classify under-fit training REJECTed (exit 5)",
           verify_code(b) == judge_verify.EXIT_PERFORMANCE)

    # --- HARDWARE report overlay (real-QPU validation) -----------------------
    hw = os.path.join(HERE, "hardware_report.py")
    rep_path = os.path.join(HERE, "hardware-report-bell_pops2.json")
    p = subprocess.run([sys.executable, hw, rep_path], capture_output=True, text=True)
    record("hardware report consistent + sim-accepted (exit 0)", p.returncode == 0, p.stderr.strip())
    rep = json.load(open(rep_path)); rep["measured"]["value"] = 0.30  # lie about the result
    tmp = os.path.join(HERE, "_tmp_hw.json")
    with open(tmp, "w") as f:
        json.dump(rep, f)
    try:
        p = subprocess.run([sys.executable, hw, tmp], capture_output=True, text=True)
        record("hardware report with a lying metric REJECTed (exit 4)", p.returncode == 4)
    finally:
        os.remove(tmp)

    # run_on_hardware -> hardware_report round-trip on the local backend (no QPU/creds)
    roh, rt = os.path.join(HERE, "run_on_hardware.py"), os.path.join(HERE, "_tmp_hwrt.json")
    with open(rt, "w") as f:
        subprocess.run([sys.executable, roh, os.path.join(HERE, "quantum-proof-pops.json"),
                        "--observable", "XX", "--backend", "local-ideal", "--seed", "0"], stdout=f, check=True)
    try:
        p = subprocess.run([sys.executable, hw, rt], capture_output=True, text=True)
        record("run_on_hardware -> hardware_report round-trip (exit 0)", p.returncode == 0, p.stderr.strip())
    finally:
        os.remove(rt)

    n_pass = sum(1 for _, ok, _ in results if ok)
    print(f"\n{n_pass}/{len(results)} checks passed")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
