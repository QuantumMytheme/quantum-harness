#!/usr/bin/env python3
"""
test_qasm_import.py — regression suite for qasm_import.py, the OpenQASM3 -> proof-bundle
`circuit` authoring adapter.

This is deliberately NOT a test of a new judged task: qasm_import.py is an authoring
convenience only, and the whole point of item 7 is that the judge's trust boundary does
not move. So the suite asserts two things:
  1. a genuine QASM3 circuit round-trips through the importer + capture.py into a bundle
     that judge_verify.py ACCEPTs (exit 0) unchanged — same simulator, same judge, same gates.
  2. any instruction outside the supported gate subset fails the IMPORTER explicitly (a
     clear error, non-zero exit) rather than being silently dropped, which would otherwise
     let an authored circuit quietly diverge from what actually gets verified.

Run:  python3 test_qasm_import.py   (exit 0 = all pass)
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMPORTER = os.path.join(HERE, "qasm_import.py")
JUDGE = os.path.join(HERE, "judge_verify.py")
FIXTURES = os.path.join(HERE, "qasm_fixtures")

sys.path.insert(0, HERE)
import qasm_import  # noqa: E402

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = PASS if ok else FAIL
    print(f"  {mark} {name}" + (f"  — {detail}" if detail and not ok else ""))


def run(*args):
    p = subprocess.run([sys.executable, *args], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def main():
    print("qasm_import.py regression suite")

    # 1. Circuit-only mode: a genuine GHZ-3 QASM3 file converts to the exact
    #    same {n_qubits, ops} shape as the hand-authored worked example.
    circuit = qasm_import.parse_qasm(open(os.path.join(FIXTURES, "ghz3.qasm")).read())
    expected_ops = [
        {"gate": "h", "q": [0]},
        {"gate": "cx", "q": [0, 1]},
        {"gate": "cx", "q": [1, 2]},
    ]
    record("ghz3.qasm parses to n_qubits=3, ops=[h(0), cx(0,1), cx(1,2)]",
           circuit == {"n_qubits": 3, "ops": expected_ops},
           f"got {circuit}")

    # 2. Gate-mapping unit checks: QASM name -> sim.py op name, verified for one
    #    gate of each arity/param class (the mapping is the identity for every
    #    name in the supported subset — see qasm_import.py's SUPPORTED_GATES doc).
    c = qasm_import.parse_qasm("OPENQASM 3;\nqubit[2] q;\ncx q[0], q[1];\n")
    record("QASM 'cx q[0], q[1];' -> sim op {'gate':'cx','q':[0,1]}",
           c["ops"] == [{"gate": "cx", "q": [0, 1]}], f"got {c['ops']}")

    c = qasm_import.parse_qasm("OPENQASM 3;\nqubit[1] q;\nrz(1.5707963267948966) q[0];\n")
    op = c["ops"][0]
    record("QASM 'rz(pi/2) q[0];' -> sim op {'gate':'rz','q':[0],'params':[pi/2]}",
           op["gate"] == "rz" and op["q"] == [0] and abs(op["params"][0] - 1.5707963267948966) < 1e-12,
           f"got {op}")

    c = qasm_import.parse_qasm("OPENQASM 3;\nqubit[1] q;\nrz(pi/2) q[0];\n")
    record("the 'pi' identifier evaluates to math.pi in param expressions",
           abs(c["ops"][0]["params"][0] - 1.5707963267948966) < 1e-12, f"got {c['ops'][0]}")

    c = qasm_import.parse_qasm("OPENQASM 3;\nqubit[3] q;\nccx q[0], q[1], q[2];\n")
    record("QASM 'ccx q[0], q[1], q[2];' -> sim op {'gate':'ccx','q':[0,1,2]}",
           c["ops"] == [{"gate": "ccx", "q": [0, 1, 2]}], f"got {c['ops']}")

    c = qasm_import.parse_qasm("OPENQASM 3;\nqubit[2] q;\ncp(pi/4) q[0], q[1];\n")
    op = c["ops"][0]
    record("QASM 'cp(pi/4) q[0], q[1];' -> sim op {'gate':'cp','q':[0,1],'params':[pi/4]}",
           op["gate"] == "cp" and op["q"] == [0, 1] and abs(op["params"][0] - 0.7853981633974483) < 1e-12,
           f"got {op}")

    # 3. Every name in the declared supported subset is one sim.py already knows,
    #    i.e. the QASM name IS the sim.py op name for this whole list (no renaming
    #    table needed — checked, not assumed).
    import sim
    record("every qasm_import.SUPPORTED_GATES name is in sim.KNOWN_GATES (identity mapping)",
           qasm_import.SUPPORTED_GATES.issubset(sim.KNOWN_GATES),
           f"missing: {qasm_import.SUPPORTED_GATES - sim.KNOWN_GATES}")

    # 4. End-to-end round-trip: qasm_import.py -> capture.py -> judge_verify.py
    #    ACCEPTs (exit 0) on the real ghz3 reference. This is run as a live
    #    subprocess pipeline, not asserted in-process, so it exercises the real CLI.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        bundle_path = os.path.join(td, "bundle.json")
        code, out, err = run(IMPORTER, os.path.join(FIXTURES, "ghz3.qasm"),
                              "--problem_id", "ghz3", "--task", "state_prep", "-o", bundle_path)
        record("qasm_import.py --problem_id ghz3 produces a bundle (exit 0)",
               code == 0, f"exit {code}: {err}")
        jcode, jout, jerr = run(JUDGE, bundle_path, "--json")
        verdict = json.loads(jout) if jout.strip() else {}
        record("judge_verify.py ACCEPTs the qasm_import.py round-trip bundle (exit 0)",
               jcode == 0 and verdict.get("verdict") == "ACCEPT",
               f"exit {jcode}: {jout or jerr}")
        record("the round-trip bundle reproduces fidelity 1.0 on ghz3",
               verdict.get("checks", {}).get("reproduced", {}).get("fidelity") == 1.0,
               f"checks: {verdict.get('checks')}")

    # 5. Circuit-only mode (no --problem_id) emits exactly {n_qubits, ops} to stdout,
    #    i.e. the shape capture.py's own <circuit.json> argument expects.
    code, out, err = run(IMPORTER, os.path.join(FIXTURES, "ghz3.qasm"))
    record("qasm_import.py with no --problem_id emits {n_qubits, ops} to stdout (exit 0)",
           code == 0 and json.loads(out) == {"n_qubits": 3, "ops": expected_ops},
           f"exit {code}: {out or err}")

    # 6. Unsupported instruction (barrier) fails the IMPORTER explicitly — clear
    #    error text, non-zero exit, NOT a silent drop and NOT an uncaught crash.
    code, out, err = run(IMPORTER, os.path.join(FIXTURES, "unsupported_barrier.qasm"))
    record("unsupported_barrier.qasm: importer fails cleanly (non-zero exit, no traceback)",
           code != 0 and "Traceback" not in err, f"exit {code}: {err}")
    record("unsupported_barrier.qasm: error names the offending instruction ('barrier')",
           "barrier" in err.lower(), f"stderr: {err}")

    try:
        qasm_import.parse_qasm(open(os.path.join(FIXTURES, "unsupported_barrier.qasm")).read())
        record("parse_qasm() raises QasmImportError on 'barrier' (in-process)", False)
    except qasm_import.QasmImportError as e:
        record("parse_qasm() raises QasmImportError on 'barrier' (in-process)",
               "barrier" in str(e).lower(), str(e))

    # 7. A second unsupported case: a real stdgates.inc gate ('ch') that is simply
    #    not in this converter's declared subset — distinct code path from #6.
    code, out, err = run(IMPORTER, os.path.join(FIXTURES, "unsupported_gate.qasm"))
    record("unsupported_gate.qasm ('ch'): importer fails cleanly (non-zero exit, no traceback)",
           code != 0 and "Traceback" not in err, f"exit {code}: {err}")
    record("unsupported_gate.qasm: error names the offending gate ('ch')",
           "'ch'" in err or "\"ch\"" in err, f"stderr: {err}")

    # 8. An unsupported instruction is never silently coerced into a no-op op list —
    #    confirm the importer raises rather than returning a circuit that merely
    #    omits the barrier (which would silently diverge from the authored QASM).
    try:
        qasm_import.parse_qasm(open(os.path.join(FIXTURES, "unsupported_barrier.qasm")).read())
        got_circuit = None
    except qasm_import.QasmImportError:
        got_circuit = "raised"
    record("no partial circuit is ever returned for a file with an unsupported instruction",
           got_circuit == "raised")

    n_pass = sum(1 for _, ok, _ in results if ok)
    print(f"\n{n_pass}/{len(results)} checks passed")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
