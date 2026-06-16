#!/usr/bin/env python3
"""
verify.py — re-verify every scoreboard entry against the judge, INCLUDING entries
whose proof bundle lives in an external public run repo. This is the cross-repo merge
gate: no number on the board is self-reported.

For each entry it checks two things:
  1. ACCEPT  — judge_verify.py exits 0 on the bundle (re-run against the harness's
     canonical hidden references; an external run repo cannot ship its own answer key).
  2. METRIC  — the entry's verified_metric.value matches the number the JUDGE recomputes
     from that bundle (so a submitter can't claim a better rank than the bundle earns).

In-repo bundles (run_repo == the harness repo) are read locally. External bundles are
fetched read-only from the run repo's raw URL (the only networked step; the judge itself
stays offline). Use --local-only to skip external fetches when developing offline.

  python3 scoreboard/verify.py                # verify all entries (fetches external)
  python3 scoreboard/verify.py --local-only   # in-repo entries only
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JUDGE = os.path.join(ROOT, "bench", "quantum-judge", "judge_verify.py")
DATA = json.load(open(os.path.join(ROOT, "scoreboard", "entries.json")))
HARNESS = DATA.get("harness_repo", "https://github.com/QuantumMytheme/quantum-harness")
LOCAL_ONLY = "--local-only" in sys.argv


def raw_url(run_repo, branch, path):
    base = run_repo.rstrip("/").replace("https://github.com/", "https://raw.githubusercontent.com/")
    return f"{base}/{branch}/{path}"


def judged_metric(task, checks):
    """The primary ranking number, recomputed by the judge (None if not auto-checkable)."""
    try:
        if task == "state_prep":   return checks["reproduced"]["fidelity"]
        if task == "vqe":          return checks["performance"]["gap"]
        if task == "populations":  return checks["anti_overfit"]["checks"][0]["got"]
        if task == "architecture": return checks["performance"]["routing_cost"]
        if task == "classify":     return checks["anti_overfit"]["test_accuracy"]
    except (KeyError, IndexError, TypeError):
        return None
    return None


def run_judge(bundle_path):
    p = subprocess.run([sys.executable, JUDGE, bundle_path, "--json"], capture_output=True, text=True)
    if p.returncode != 0:
        return p.returncode, None
    try:
        return 0, json.loads(p.stdout).get("checks", {})
    except json.JSONDecodeError:
        return 0, {}


def verify_entry(e):
    pid, task = e["problem_id"], e["task"]
    external = e.get("run_repo", HARNESS) != HARNESS
    if external:
        if LOCAL_ONLY:
            return None, "skipped (external, --local-only)"
        url = raw_url(e["run_repo"], e.get("run_branch", "main"), e["proof_bundle"])
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                blob = r.read()
        except Exception as ex:  # noqa: BLE001 — a dead link is a failed entry
            return False, f"fetch failed: {ex}"
        fd, path = tempfile.mkstemp(suffix=".json")
        os.write(fd, blob); os.close(fd)
        cleanup = path
    else:
        path = os.path.join(ROOT, e["proof_bundle"])
        cleanup = None
        if not os.path.exists(path):
            return False, f"in-repo bundle missing: {e['proof_bundle']}"

    try:
        code, checks = run_judge(path)
        if code != 0:
            return False, f"judge REJECT (exit {code})"
        jm = judged_metric(task, checks)
        claimed = float(e["verified_metric"]["value"])
        if jm is not None and abs(float(jm) - claimed) > 1e-3:
            return False, f"metric overclaim: entry {claimed} != judge {jm}"
        loc = "external" if external else "in-repo"
        return True, f"ACCEPT · metric {('matches judge' if jm is not None else 'ok')} · {loc}"
    finally:
        if cleanup:
            os.remove(cleanup)


def all_entries():
    """Seeds (entries.json) + auto-discovered run-repo entries (discovered.json), deduped."""
    out, seen = [], set()
    src = list(DATA["entries"])
    try:
        src += json.load(open(os.path.join(ROOT, "scoreboard", "discovered.json"))).get("entries", [])
    except FileNotFoundError:
        pass
    for e in src:
        k = (e.get("run_repo"), e.get("proof_bundle"), e.get("problem_id"))
        if k not in seen:
            seen.add(k); out.append(e)
    return out


def main():
    entries = all_entries()
    bad = 0
    for e in entries:
        ok, msg = verify_entry(e)
        mark = "OK  " if ok else ("skip" if ok is None else "FAIL")
        print(f"{mark} {e['problem_id']:12} {e.get('paradigm_short', e['paradigm'])[:24]:24} {msg}")
        if ok is False:
            bad += 1
    print(f"\n{len(entries) - bad}/{len(entries)} entries re-verified" + (f" — {bad} FAILED" if bad else " (exit 0)"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
