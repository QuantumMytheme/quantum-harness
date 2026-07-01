#!/usr/bin/env python3
"""
judge.py — unified entrypoint: route a proof bundle to the right judge by its task.

The harness now has TWO judges, and this is the single door in front of both:

  * bench/quantum-judge/judge_verify.py — quantum-circuit correctness (state_prep,
    vqe, populations, architecture, classify).
  * bench/kernel-judge/judge_kernel.py  — the TPU Oracle-Diff Gate: kernel
    correctness on real silicon (kernel-correctness-oracle, roofline-attest).

Both judges share one contract — a SELF-CONTAINED, OFFLINE, numpy-only, exit-code
verdict where the judge recomputes the claim and REJECTs a forgery — and the SAME
exit codes (0 ok · 2 schema · 3 structure · 4 reproducibility · 5 performance ·
6 anti-overfit). This router reads the bundle's `task`, dispatches to the matching
judge, and returns that judge's exit code unchanged. The verdict is the exit code,
not any claim in the bundle.

Usage:
  python3 judge.py <bundle.json> [--json]     # any task type, routed automatically
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "quantum-judge"))
sys.path.insert(0, os.path.join(HERE, "kernel-judge"))

import judge_verify as quantum  # noqa: E402
import judge_kernel as kernel   # noqa: E402

EXIT_SCHEMA = 2

# task -> judge module. Everything the kernel judge owns routes to it; all other
# (quantum) tasks route to the quantum judge, which reports its own unknown-task error.
KERNEL_TASKS = set(kernel.TASKS)


def route(task):
    return kernel if task in KERNEL_TASKS else quantum


def verify(bundle):
    """Route + verify in-process. Returns (module, checks) on ACCEPT; the module's
    own Reject propagates on REJECT (its .code is the exit code)."""
    mod = route(bundle.get("task"))
    return mod, mod.verify(bundle)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    if not args:
        print("usage: judge.py <bundle.json> [--json]", file=sys.stderr)
        return EXIT_SCHEMA
    try:
        with open(args[0]) as f:
            bundle = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"REJECT [schema]: cannot read bundle: {e}", file=sys.stderr)
        return EXIT_SCHEMA

    mod = route(bundle.get("task"))
    try:
        checks = mod.verify(bundle)
    except mod.Reject as r:
        out = {"verdict": "REJECT", "code": r.code, "reason": str(r)}
        if as_json:
            print(json.dumps(out))
        else:
            print(f"REJECT [{r.code}]: {r}", file=sys.stderr)
        return r.code

    out = {"verdict": "ACCEPT", "code": 0, "problem_id": bundle.get("problem_id"),
           "task": bundle.get("task"), "checks": checks}
    if as_json:
        print(json.dumps(out))
    else:
        judge_name = "kernel" if mod is kernel else "quantum"
        print(f"ACCEPT  problem={bundle.get('problem_id')} task={bundle.get('task')} judge={judge_name}")
        for key, val in checks.items():
            print(f"  {key}: {val}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
