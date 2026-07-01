#!/usr/bin/env python3
"""
test_kernel.py — regression suite for the Oracle-Diff Gate hermetic judge.

Same expect-pass / expect-fail discipline as bench/quantum-judge/test_judge.py:
the genuine kernel bundles must ACCEPT, and every class of forgery must be
REJECTED with the right exit code. If this suite is green, the correctness notary
is sound — no swapped array, claimant-chosen tolerance, degraded fast path, or
overfit kernel can clear the gate, and every check runs offline with numpy alone.

Checks are labelled K1–K12 to match the VERIFIER-MAP in ../../TPU-ORACLE-DIFF-GATE.md.

Run:  python3 test_kernel.py   (exit 0 = all pass)
"""

import copy
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE = os.path.join(HERE, "judge_kernel.py")

sys.path.insert(0, HERE)
import judge_kernel as jk  # noqa: E402

PASS = "\033[32m[PASS]\033[0m"
FAIL = "\033[31m[FAIL]\033[0m"
results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    mark = PASS if ok else FAIL
    print(f"  {mark} {name}" + (f"  — {detail}" if detail and not ok else ""))


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def verify_code(bundle):
    try:
        jk.verify(bundle)
        return 0
    except jk.Reject as r:
        return r.code


def run_cli(name):
    p = subprocess.run([sys.executable, JUDGE, os.path.join(HERE, name), "--json"],
                       capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def main():
    print("kernel-judge (Oracle-Diff Gate) regression suite")

    # Fixtures must exist; regenerate if missing (deterministic).
    if not os.path.exists(os.path.join(HERE, "bundle-gemm-bf16-OK.json")):
        subprocess.run([sys.executable, os.path.join(HERE, "make_fixtures.py")], check=True)

    # K9 / K1 — genuine bf16 kernel ACCEPTs end-to-end (exit 0), schema is well-formed.
    code, out = run_cli("bundle-gemm-bf16-OK.json")
    record("K9  genuine bf16 kernel ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")

    # K7 — genuine int8 kernel ACCEPTs (bit-exact integer path).
    code, out = run_cli("bundle-int8-OK.json")
    record("K7  genuine int8 kernel ACCEPTs (exit 0)", code == 0, f"exit {code}: {out}")

    # K2 — mis-tiled kernel -> STRUCTURE (exit 3).
    code, _ = run_cli("bundle-gemm-bf16-MISTILE.json")
    record("K2  mis-tiled block REJECTed at STRUCTURE (exit 3)", code == jk.EXIT_STRUCTURE)

    # K1(neg) — malformed bundle -> SCHEMA (exit 2).
    code, _ = run_cli("bundle-gemm-bf16-BADSCHEMA.json")
    record("K1  missing kernel block REJECTed at SCHEMA (exit 2)", code == jk.EXIT_SCHEMA)

    # K4 — claimant-chosen (loose) tolerance -> REPRODUCIBILITY (exit 4).
    code, _ = run_cli("bundle-gemm-bf16-LOOSETOL.json")
    record("K4  loose declared tolerance REJECTed (exit 4)", code == jk.EXIT_REPRODUCIBILITY)

    # K5 — swapped array vs sealed hash -> REPRODUCIBILITY (exit 4).
    code, _ = run_cli("bundle-gemm-bf16-SWAPPED.json")
    record("K5  swapped output vs sealed hash REJECTed (exit 4)", code == jk.EXIT_REPRODUCIBILITY)

    # K6 — degraded fast path (biased) -> REPRODUCIBILITY (exit 4), and it passes max-abs.
    code, _ = run_cli("bundle-gemm-bf16-DEGRADED.json")
    record("K6  biased fast path REJECTed at the distribution check (exit 4)", code == jk.EXIT_REPRODUCIBILITY)

    # K8 — accurate on visible, degraded on held-out -> ANTI-OVERFIT (exit 6).
    code, _ = run_cli("bundle-gemm-bf16-INPUTFIT.json")
    record("K8  visible-accurate/held-out-degraded REJECTed at ANTI-OVERFIT (exit 6)", code == jk.EXIT_OVERFIT)

    # K7(neg) — a single 1-lsb int tamper -> REPRODUCIBILITY (exit 4), NOT the hash.
    tamper = load("bundle-int8-TAMPER.json")
    code = verify_code(tamper)
    record("K7  int8 off-by-one REJECTed at bit-exactness (exit 4)", code == jk.EXIT_REPRODUCIBILITY)

    ok = load("bundle-gemm-bf16-OK.json")

    # K6(gate independence) — the DEGRADED bundle fails ONLY at reproducibility (bias),
    # confirmed by the recorded stats: it stays within the per-element (max-abs) bound.
    deg = load("bundle-gemm-bf16-DEGRADED.json")
    checks = {}
    try:
        jk.check_structure(deg, jk.load_reference(deg["problem_id"]), checks)
        struct_ok = True
    except jk.Reject:
        struct_ok = False
    record("K6  degraded bundle passes STRUCTURE (fails only the numeric notary)", struct_ok)

    # K3 — the numeric notary ACCEPTs an honest kernel: recomputed deviation is within
    # the dtype-derived bound (not self-reported). Inspect the ACCEPT checks.
    ck = {}
    jk.verify_kernel_oracle(ok, jk.load_reference(ok["problem_id"]), ck)
    rep = ck.get("reproduced", {})
    within = rep.get("frac_within", 0) >= jk.FRAC_MIN and abs(rep.get("mean_signed_bias", 1)) <= rep.get("bias_bound", 0)
    record("K3  honest deviation within the dtype-derived tolerance (judge-recomputed)", within)

    # K10 — hermetic / offline: verification touched numpy only, never JAX or a TPU.
    record("K10 verification is offline (numpy only, no jax imported)", "jax" not in sys.modules)

    # K11 — device_kind is NOT part of the trust path: a mis-declared chip still ACCEPTs.
    b = copy.deepcopy(ok)
    b["hardware"]["device_kind"] = "TPU v999-unobtanium"
    record("K11 mis-declared device_kind does not change the verdict (exit 0)", verify_code(b) == 0)

    # K12 — the CLI --json output has the verify_bundle-compatible shape.
    code, out = run_cli("bundle-gemm-bf16-OK.json")
    j = json.loads(out)
    accept_shape = j.get("verdict") == "ACCEPT" and j.get("code") == 0 and "checks" in j
    code_r, out_r = run_cli("bundle-gemm-bf16-SWAPPED.json")
    jr = json.loads(out_r)
    reject_shape = jr.get("verdict") == "REJECT" and jr.get("code") == 4 and "reason" in jr
    record("K12 CLI --json emits the {verdict,code,checks|reason} shape", accept_shape and reject_shape)

    # ---- T1 Roofline Notary (roofline-attest task) ---------------------------
    if not os.path.exists(os.path.join(HERE, "bundle-roofline-OK.json")):
        subprocess.run([sys.executable, os.path.join(HERE, "make_roofline_fixtures.py")], check=True)
    roof = [
        ("R1  honest roofline coordinate ACCEPTs (exit 0)", "bundle-roofline-OK.json", 0),
        ("R2  FLOP-count lie REJECTed (exit 4)", "bundle-roofline-FLOPSLIE.json", 4),
        ("R3  inflated %-of-peak REJECTed (exit 4)", "bundle-roofline-PEAKLIE.json", 4),
        ("R4  arithmetic-intensity lie REJECTed (exit 4)", "bundle-roofline-INTENSITYLIE.json", 4),
        ("R5  compute/memory-bound regime lie REJECTed (exit 4)", "bundle-roofline-REGIMELIE.json", 4),
        ("R6  byte tally below the physical lower bound REJECTed (exit 4)", "bundle-roofline-UNDERBYTES.json", 4),
        ("R7  >100%-of-peak (impossible rate) REJECTed (exit 4)", "bundle-roofline-OVER100.json", 4),
        ("R8  mis-declared device_kind REJECTed (exit 3)", "bundle-roofline-BADDEV.json", 3),
        ("R9  unpinned generation REJECTed (exit 2)", "bundle-roofline-UNPINNED.json", 2),
        ("R10 below the %-of-peak floor REJECTed (exit 5)", "bundle-roofline-UNDERPERF.json", 5),
    ]
    for name, fx, want in roof:
        code, _ = run_cli(fx)
        record(name, code == want, f"exit {code} (want {want})")

    # Gate independence: a tampered claim on an otherwise-valid bundle is caught, and
    # an honest bundle with the SAME structure is accepted (the notary is the sole diff).
    b = copy.deepcopy(ok)
    b["claim"]["declared_tolerance"] = 999.0
    record("overclaimed tolerance REJECTed (exit 4)", verify_code(b) == jk.EXIT_REPRODUCIBILITY)
    record("control: unmodified OK bundle ACCEPTs (exit 0)", verify_code(ok) == 0)

    n_pass = sum(1 for _, ok_ in results if ok_)
    print(f"\n{n_pass}/{len(results)} checks passed")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
