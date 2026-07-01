#!/usr/bin/env python3
"""
test_router.py — the unified judge router (bench/judge.py) sends each bundle to the
right judge and returns its exit code unchanged. If this is green, the single door
in front of both judges is sound: quantum bundles reach the quantum judge, kernel
bundles reach the Oracle-Diff Gate, and an unknown task is rejected.

Run:  python3 test_router.py   (exit 0 = all pass)
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROUTER = os.path.join(HERE, "judge.py")
QJ = os.path.join(HERE, "quantum-judge")
KJ = os.path.join(HERE, "kernel-judge")

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []


def run(bundle_path):
    p = subprocess.run([sys.executable, ROUTER, bundle_path, "--json"], capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def record(name, ok, detail=""):
    results.append(ok)
    print(f"  {(PASS if ok else FAIL)} {name}" + (f"  — {detail}" if detail and not ok else ""))


def main():
    print("judge router regression suite")
    cases = [
        ("quantum ACCEPT routes to quantum judge (exit 0)", os.path.join(QJ, "quantum-proof-poc.json"), 0),
        ("quantum held-out forgery routes + REJECTs (exit 6)", os.path.join(QJ, "quantum-proof-OVERFIT.json"), 6),
        ("kernel bf16 ACCEPT routes to Oracle-Diff Gate (exit 0)", os.path.join(KJ, "bundle-gemm-bf16-OK.json"), 0),
        ("kernel int8 ACCEPT routes (exit 0)", os.path.join(KJ, "bundle-int8-OK.json"), 0),
        ("kernel structure forgery routes + REJECTs (exit 3)", os.path.join(KJ, "bundle-gemm-bf16-MISTILE.json"), 3),
        ("kernel held-out forgery routes + REJECTs (exit 6)", os.path.join(KJ, "bundle-gemm-bf16-INPUTFIT.json"), 6),
    ]
    for name, path, want in cases:
        code, out = run(path)
        record(name, code == want, f"exit {code} (want {want}): {out}")

    # in-process routing: verify() returns the module that handled it.
    sys.path.insert(0, HERE)
    import judge as router  # noqa: E402
    import json
    kb = json.load(open(os.path.join(KJ, "bundle-gemm-bf16-OK.json")))
    mod, _ = router.verify(kb)
    record("verify() routes kernel task to the kernel module", mod is router.kernel)
    qb = json.load(open(os.path.join(QJ, "quantum-proof-poc.json")))
    mod, _ = router.verify(qb)
    record("verify() routes quantum task to the quantum module", mod is router.quantum)

    # an unknown task falls through to the quantum judge, which rejects it (schema, exit 2).
    unknown = {"schema": "quantum-harness/proof-bundle@1", "task": "no-such-task", "problem_id": "x"}
    try:
        router.verify(unknown)
        code = 0
    except Exception as e:
        code = getattr(e, "code", -1)
    record("unknown task REJECTed at schema (exit 2)", code == 2)

    n = sum(1 for ok in results if ok)
    print(f"\n{n}/{len(results)} checks passed")
    return 0 if n == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
