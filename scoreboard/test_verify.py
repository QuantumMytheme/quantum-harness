#!/usr/bin/env python3
"""
test_verify.py — regression suite for the scoreboard merge gate (scoreboard/verify.py).

Mirrors bench/quantum-judge/test_judge.py's expect-pass / expect-fail discipline:
the committed seed entries must ACCEPT, and every class of scoreboard fraud must be
FAILed per-entry (never a crash). If this suite is green, the merge gate is sound:
an entry cannot point at someone else's ACCEPTing bundle, claim a metric the judge
did not recompute, or lie about its tie-break resource costs.

Run:  python3 scoreboard/test_verify.py   (exit 0 = all pass; offline, stdlib only)
"""

import copy
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

sys.path.insert(0, HERE)
import verify  # noqa: E402

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []

# The template's own worked-example bundle (ghz3 / state_prep) — the exact bundle a
# spoofed entry would point at, since it ships in every minted run repo.
POC_BUNDLE = "bench/quantum-judge/quantum-proof-poc.json"


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = PASS if ok else FAIL
    print(f"  {mark} {name}" + (f"  — {detail}" if detail and not ok else ""))


def seed(problem_id):
    for e in verify.DATA["entries"]:
        if e["problem_id"] == problem_id:
            return copy.deepcopy(e)
    raise KeyError(problem_id)


def main():
    print("scoreboard merge-gate regression suite")

    # 1. The committed seed entries still ACCEPT (the gate is strict, not broken).
    for pid in ("ghz3", "isingbell2", "aiaccel4", "qml_sign1"):
        ok, msg = verify.verify_entry(seed(pid))
        record(f"seed {pid} ACCEPTs", ok is True, msg)

    # 2. Entry↔bundle BINDING: an entry cannot claim a different task than the bundle.
    #    (Historic hole: judged_metric('vqe', ghz3-checks) -> None used to pass as
    #    'metric ok' with ANY self-reported value.)
    spoof = {
        "problem_id": "tfim3", "task": "vqe", "paradigm_short": "qaoa",
        "verified_metric": {"name": "energy_gap_to_E0", "value": 0.0},
        "resource_costs": {"two_qubit_gates": 1},
        "run_repo": verify.HARNESS, "proof_bundle": POC_BUNDLE,
    }
    ok, msg = verify.verify_entry(spoof)
    record("task-mismatch bundle REJECTED (vqe entry -> ghz3/state_prep bundle)",
           ok is False and "binding mismatch" in msg, msg)

    # 3. problem_id spoof: right task, wrong board — still rejected by the binding.
    spoof2 = seed("ghz3")
    spoof2["problem_id"] = "ghz3-imposter"
    ok, msg = verify.verify_entry(spoof2)
    record("problem_id spoof REJECTED (bundle is ghz3, entry claims ghz3-imposter)",
           ok is False and "binding mismatch" in msg, msg)

    # 4. judged_metric() returning None is a FAIL, never 'metric ok': a value the
    #    judge did not recompute is self-reported and must not rank.
    orig = verify.judged_metric
    try:
        verify.judged_metric = lambda task, checks: None
        ok, msg = verify.verify_entry(seed("ghz3"))
        record("judge-recomputed-no-metric FAILs (jm None is not 'metric ok')",
               ok is False and "self-reported" in msg, msg)
    finally:
        verify.judged_metric = orig

    # 5. Metric overclaim is still rejected (pre-existing guarantee kept).
    over = seed("ghz3")
    over["verified_metric"]["value"] = 0.9  # judge recomputes 1.0
    ok, msg = verify.verify_entry(over)
    record("metric overclaim REJECTED", ok is False and "overclaim" in msg, msg)

    # 6. resource_costs lies are rejected: tie-break numbers must match the judge's
    #    own checks.structure emission.
    cheap = seed("ghz3")
    cheap["resource_costs"]["two_qubit_gates"] = 1  # judge counts 2
    ok, msg = verify.verify_entry(cheap)
    record("resource_costs lie REJECTED (claims 1 two-qubit gate, judge counts 2)",
           ok is False and "resource_costs mismatch" in msg, msg)

    junk = seed("ghz3")
    junk["resource_costs"]["depth"] = "3"  # non-numeric where the judge emits a number
    ok, msg = verify.verify_entry(junk)
    record("non-numeric resource cost for a judged key REJECTED",
           ok is False and "resource_costs mismatch" in msg, msg)

    extra = seed("ghz3")
    extra["resource_costs"]["feature_map_ops"] = 7  # judge emits no such key for ghz3
    ok, msg = verify.verify_entry(extra)
    record("resource key the judge does not emit is ignored (no false reject)",
           ok is True, msg)

    # 7. Malformed entries per-entry-FAIL with a message — the gate never crashes,
    #    so one bad community file cannot halt every legitimate refresh.
    malformed = [
        ({"problem_id": "x"}, "problem_id only"),
        ({}, "empty object"),
        ("not an object", "non-dict entry"),
        (None, "null entry"),
        ({**seed("ghz3"), "task": "banana"}, "unknown task"),
        ({**seed("ghz3"), "verified_metric": {"name": "fidelity", "value": "1.0"}}, "string metric value"),
        ({**seed("ghz3"), "verified_metric": None}, "null verified_metric"),
        ({**{k: v for k, v in seed("ghz3").items() if k != "resource_costs"}}, "missing resource_costs"),
        ({**seed("ghz3"), "run_repo": "http://evil.example/repo"}, "non-GitHub run_repo"),
        ({**seed("ghz3"), "proof_bundle": "../../etc/passwd"}, "path-traversal proof_bundle"),
        ({**{k: v for k, v in seed("ghz3").items() if k != "proof_bundle"}}, "missing proof_bundle"),
    ]
    for bad, label in malformed:
        try:
            ok, msg = verify.verify_entry(bad)
            record(f"malformed entry FAILs without crashing ({label})",
                   ok is False and "malformed entry" in msg, msg)
        except Exception as ex:  # noqa: BLE001 — a crash here is exactly the regression
            record(f"malformed entry FAILs without crashing ({label})", False, f"raised {ex!r}")

    # 8. family tag: WARN-only, never a reject.
    fam = seed("ghz3")
    fam["family"] = "quantum-vibes"  # not in the controlled vocabulary
    ok, msg = verify.verify_entry(fam)
    record("unknown family WARNs but still ACCEPTs",
           ok is True and "WARN" in msg and "quantum-vibes" in msg, msg)

    fam_ok = seed("ghz3")
    fam_ok["family"] = "other"
    ok, msg = verify.verify_entry(fam_ok)
    record("known family tag ACCEPTs with no warning",
           ok is True and "WARN" not in msg, msg)

    ok, msg = verify.verify_entry(seed("aiaccel4"))  # paradigm_short 'ring' is a family
    record("paradigm_short doubling as a family needs no separate tag",
           ok is True and "WARN" not in msg, msg)

    ok, msg = verify.verify_entry(seed("ghz3"))  # 'chain-cascade' is not a family
    record("missing family tag WARNs but still ACCEPTs",
           ok is True and "WARN" in msg and "no family tag" in msg, msg)

    # 9. End-to-end: a malformed discovered entry FAILs that entry (exit 1) but the
    #    run completes — no traceback, and the seeds still verify.
    disc = os.path.join(HERE, "discovered.json")
    bak = disc + ".test-bak"
    had_file = os.path.exists(disc)
    if had_file:
        shutil.copy2(disc, bak)
    try:
        with open(disc, "w") as f:
            json.dump({"topic": "quantum-harness-run", "count": 1,
                       "entries": [{"problem_id": "x"}]}, f)
        p = subprocess.run([sys.executable, os.path.join(HERE, "verify.py"), "--local-only"],
                           capture_output=True, text=True)
        record("pipeline run with a malformed discovered entry exits 1 (fail-closed)",
               p.returncode == 1, f"exit {p.returncode}")
        record("…without a traceback (per-entry FAIL, not a crash)",
               "Traceback" not in p.stderr, p.stderr[-200:])
        record("…and the malformed entry is the one that FAILed",
               "FAIL" in p.stdout and "malformed entry" in p.stdout, p.stdout)
        record("…while the seed entries still verify OK",
               "OK   ghz3" in p.stdout and "OK   h2vqe" in p.stdout, p.stdout)
    finally:
        if had_file:
            shutil.move(bak, disc)
        elif os.path.exists(disc):
            os.remove(disc)

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
