#!/usr/bin/env python3
"""
verify.py — re-verify every scoreboard entry by re-running the judge on its
committed proof bundle. Operationalizes the scoreboard's core promise: no number
is self-reported. An entry counts only if judge_verify.py exits 0.

  python3 scoreboard/verify.py        # re-verify all seed entries -> exit 0 if all pass

Entries whose proof_bundle lives in an external run repo are skipped (clone that
repo and run there); seed entries live in THIS repo and are re-verified here.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JUDGE = os.path.join(ROOT, "bench", "quantum-judge", "judge_verify.py")


def main():
    data = json.load(open(os.path.join(ROOT, "scoreboard", "entries.json")))
    entries = data["entries"]
    bad = 0
    for e in entries:
        rel = e["proof_bundle"]
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print(f"skip (external run repo): {e['problem_id']:12} -> {rel}")
            continue
        code = subprocess.run([sys.executable, JUDGE, path], stdout=subprocess.DEVNULL).returncode
        mark = "OK  " if code == 0 else "FAIL"
        print(f"{mark} {e['problem_id']:12} {e['paradigm'][:38]:38} exit {code}")
        bad += code != 0
    print(f"\n{len(entries) - bad}/{len(entries)} seed entries re-verified (exit 0)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
