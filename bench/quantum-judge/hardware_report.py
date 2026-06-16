#!/usr/bin/env python3
"""
hardware_report.py — verify a REAL-HARDWARE run report against a sim-verified design.

The hermetic simulator judge stays the canonical, reproducible score. A run on an
actual QPU is NOT re-executable by a third party (noise, nondeterminism, queue), so a
hardware report is treated as a labeled OVERLAY with two layers:

  • RE-VERIFIABLE layer — the *metric recomputed from the reported raw counts*. Given
    the counts, anyone recomputes the same expectation value deterministically. This
    catches a report whose headline number doesn't match its own data.
  • ATTESTED layer — that those counts actually came from backend X at time T. We do
    NOT (cannot) re-run the device; provenance is recorded (backend, job_id,
    calibration) and trusted-but-labeled. A hardware report never outranks the sim
    score; it validates the design on real silicon.

This verifier checks: (1) the attested design is itself sim-ACCEPTed by judge_verify;
(2) the report's measured metric is reproduced by recomputing it from the raw counts;
(3) schema sanity. Exit 0 = consistent + attested; non-zero = the report contradicts
its own data or attests an un-accepted design.

  python3 hardware_report.py <hardware-report.json>

Counts convention: bitstring qubit 0 = leftmost char (matches sim.py / OpenQASM).
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import judge_verify  # noqa: E402

SCHEMA = "quantum-harness/hardware-report@1"


def observable_expectation(pauli, counts):
    """<P> estimated from measurement counts taken in P's eigenbasis.

    Eigenvalue of a bitstring outcome = (-1)^(# of 1s at the non-identity positions
    of `pauli`). Returns sum of eigenvalue*count / shots.
    """
    mask = [i for i, p in enumerate(pauli.upper()) if p != "I"]
    total = sum(counts.values())
    if total == 0:
        return 0.0
    acc = 0
    for bits, n in counts.items():
        ones = sum(1 for i in mask if i < len(bits) and bits[i] == "1")
        acc += ((-1) ** ones) * n
    return acc / total


def recompute(report):
    """Recompute the report's headline metric from its raw counts.

    Two supported shapes:
      - single observable: settings=[{pauli, counts}], measured.metric == that pauli
      - weighted sum (vqe): measured.terms=[{coeff, pauli, setting}] indexing settings
    """
    settings = report["settings"]
    m = report["measured"]
    if "terms" in m:                       # weighted Pauli sum (e.g. <H>)
        val = 0.0
        for t in m["terms"]:
            s = settings[int(t["setting"])]
            val += float(t["coeff"]) * observable_expectation(t["pauli"], s["counts"])
        return val
    return observable_expectation(settings[0]["pauli"], settings[0]["counts"])


def main(argv):
    if len(argv) < 2:
        print("usage: hardware_report.py <hardware-report.json>", file=sys.stderr)
        return 2
    with open(argv[1]) as f:
        rep = json.load(f)
    if rep.get("schema") != SCHEMA:
        print(f"REJECT: schema must be {SCHEMA!r}", file=sys.stderr)
        return 2

    # (1) the attested design must itself be sim-ACCEPTed.
    bundle_path = os.path.join(REPO, rep["attests"])
    try:
        with open(bundle_path) as f:
            bundle = json.load(f)
        judge_verify.verify(bundle)
        sim_ok = True
    except FileNotFoundError:
        print(f"REJECT: attested bundle not found: {rep['attests']}", file=sys.stderr)
        return 2
    except judge_verify.Reject as r:
        print(f"REJECT: attested design is NOT sim-accepted ({r}) — verify in sim first", file=sys.stderr)
        return 3

    # (2) recompute the headline metric from the raw counts.
    recomputed = recompute(rep)
    claimed = float(rep["measured"]["value"])
    tol = float(rep.get("tolerance", 0.01))
    consistent = abs(recomputed - claimed) <= tol

    print(f"HARDWARE REPORT — {rep['problem_id']} ({rep['task']})")
    print(f"  attests   : {rep['attests']}  [sim: {'ACCEPT' if sim_ok else 'REJECT'}]")
    print(f"  backend   : {rep.get('backend','?')}   shots: {rep.get('n_shots','?')}   job: {rep.get('job_id','-')}")
    print(f"  metric    : {rep['measured']['metric']}  reported {claimed:.4f}  recomputed {recomputed:.4f}"
          f"  [{'consistent' if consistent else 'MISMATCH'}]")
    print("  status    : ATTESTED — provenance trusted, not re-executable; the sim score is the canonical rank.")
    if not consistent:
        print("REJECT: reported metric does not match the report's own counts.", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
