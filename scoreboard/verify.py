#!/usr/bin/env python3
"""
verify.py — re-verify every scoreboard entry against the judge, INCLUDING entries
whose proof bundle lives in an external public run repo. This is the cross-repo merge
gate: no number on the board is self-reported.

For each entry it checks, fail-closed (a malformed entry FAILs, it never crashes the run):
  1. SHAPE    — the entry has the required fields with sane types (problem_id, known
     task, paradigm, numeric verified_metric.value, resource_costs, GitHub run_repo,
     proof_bundle path).
  2. BINDING  — the bundle's own problem_id/task equal the entry's declared ones, so an
     entry cannot point at any ACCEPTing bundle while claiming a different board.
  3. ACCEPT   — judge_verify.py exits 0 on the bundle (re-run against the harness's
     canonical hidden references; an external run repo cannot ship its own answer key).
  4. METRIC   — the entry's verified_metric.value matches the number the JUDGE recomputes
     from that bundle (so a submitter can't claim a better rank than the bundle earns).
     If the judge produced no recomputable metric for the task, the entry FAILs — a
     value the judge didn't recompute is self-reported, and self-reported numbers
     don't rank.
  5. RESOURCES — every resource_costs key the judge also emits (checks.structure:
     two_qubit_gates, depth, edges, max_degree, n_qubits, ops …) must match the judge's
     number; resource costs are tie-breaks, so lying about them is a rank overclaim too.
  6. FAMILY   — the optional `family` tag (or a paradigm_short that doubles as one) is
     checked against the small controlled enum; unknown/missing is a WARN, never a FAIL.

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

# The five tasks whose primary metric the judge recomputes. An entry with any other
# task has no judge-recomputed metric, so it can never rank — fail it closed.
KNOWN_TASKS = {"state_prep", "vqe", "populations", "architecture", "classify"}

# Controlled paradigm-family vocabulary (SCOREBOARD.md §c). Free-text `paradigm`
# stays the human label; `family` is the stable grouping key. WARN-only.
FAMILIES = {"qaoa", "hardware-efficient", "brickwork", "ring", "grid", "heavy-hex",
            "low-frequency-encoding", "classical-baseline", "other"}


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


def entry_shape_error(e):
    """Return a human-readable defect if the entry is malformed, else None.

    Mirrors the discover.mjs ingest validator; verify.py re-checks so a bad entry
    that reaches discovered.json by any path still per-entry-FAILs instead of
    crashing the whole merge gate.
    """
    if not isinstance(e, dict):
        return "entry is not an object"
    if not isinstance(e.get("problem_id"), str) or not e["problem_id"]:
        return "missing/invalid problem_id"
    if e.get("task") not in KNOWN_TASKS:
        return f"unknown task {e.get('task')!r} (known: {', '.join(sorted(KNOWN_TASKS))})"
    label = e.get("paradigm_short") or e.get("paradigm")
    if not isinstance(label, str) or not label:
        return "missing paradigm/paradigm_short"
    vm = e.get("verified_metric")
    if (not isinstance(vm, dict) or isinstance(vm.get("value"), bool)
            or not isinstance(vm.get("value"), (int, float))):
        return "missing/non-numeric verified_metric.value"
    if not isinstance(e.get("resource_costs"), dict):
        return "missing resource_costs object"
    rr = e.get("run_repo", HARNESS)  # absent run_repo means in-repo (the harness itself)
    if not isinstance(rr, str) or not rr.startswith("https://github.com/"):
        return "run_repo is not a https://github.com/ URL"
    pb = e.get("proof_bundle")
    if not isinstance(pb, str) or not pb or pb.startswith("/") or ".." in pb:
        return "missing/invalid proof_bundle path"
    return None


def family_warning(e):
    """WARN (never FAIL) when the paradigm family tag is missing or unknown."""
    fam = e.get("family")
    if fam is None:
        if e.get("paradigm_short") in FAMILIES:
            return None  # paradigm_short doubles as the family tag
        return "no family tag (see SCOREBOARD.md §c for the controlled vocabulary)"
    if fam not in FAMILIES:
        return f"unknown family {fam!r} (known: {', '.join(sorted(FAMILIES))})"
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
    shape_err = entry_shape_error(e)
    if shape_err:
        return False, f"malformed entry: {shape_err}"
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
        # BINDING: the bundle must be FOR the board the entry claims. Without this an
        # entry could point at any ACCEPTing bundle (e.g. the template's ghz3 PoC)
        # while declaring a different problem_id/task and an arbitrary metric.
        try:
            with open(path) as f:
                bundle = json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as ex:
            return False, f"unreadable bundle: {ex}"
        if not isinstance(bundle, dict):
            return False, "unreadable bundle: not a JSON object"
        if bundle.get("problem_id") != pid or bundle.get("task") != task:
            return False, (f"bundle binding mismatch: bundle is "
                           f"{bundle.get('problem_id')}/{bundle.get('task')}, "
                           f"entry claims {pid}/{task}")

        code, checks = run_judge(path)
        if code != 0:
            return False, f"judge REJECT (exit {code})"

        # METRIC: the judge MUST have recomputed the primary metric; otherwise the
        # entry's value is self-reported and cannot rank.
        jm = judged_metric(task, checks)
        if jm is None:
            return False, f"judge recomputed no {task} metric from this bundle — value would be self-reported"
        claimed = float(e["verified_metric"]["value"])
        if abs(float(jm) - claimed) > 1e-3:
            return False, f"metric overclaim: entry {claimed} != judge {jm}"

        # RESOURCES: tie-break costs must match the judge's own structure numbers
        # wherever the judge emitted the same key.
        structure = checks.get("structure", {}) if isinstance(checks, dict) else {}
        if not isinstance(structure, dict):
            structure = {}
        for key, claimed_cost in e["resource_costs"].items():
            judge_cost = structure.get(key)
            if judge_cost is None:
                continue  # judge doesn't emit this key for this task; nothing to bind
            if (isinstance(claimed_cost, bool) or not isinstance(claimed_cost, (int, float))
                    or abs(float(judge_cost) - float(claimed_cost)) > 1e-9):
                return False, f"resource_costs mismatch: entry {key}={claimed_cost!r} != judge {judge_cost}"

        loc = "external" if external else "in-repo"
        msg = f"ACCEPT · metric matches judge · {loc}"
        warn = family_warning(e)
        if warn:
            msg += f" · WARN: {warn}"
        return True, msg
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
        if not isinstance(e, dict):
            out.append(e)  # kept so verify_entry FAILs it visibly (never crash here)
            continue
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
        if isinstance(e, dict):
            pid = str(e.get("problem_id") or "?")
            label = str(e.get("paradigm_short") or e.get("paradigm") or "?")
        else:
            pid, label = "?", "?"
        print(f"{mark} {pid:12} {label[:24]:24} {msg}")
        if ok is False:
            bad += 1
    print(f"\n{len(entries) - bad}/{len(entries)} entries re-verified" + (f" — {bad} FAILED" if bad else " (exit 0)"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
