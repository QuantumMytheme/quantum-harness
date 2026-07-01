#!/usr/bin/env python3
"""
judge_kernel.py — the hermetic half of the TPU Oracle-Diff Gate (Phase T0).

Companion to bench/quantum-judge/judge_verify.py, and deliberately built in its
image: a SELF-CONTAINED, OFFLINE, exit-code judge that re-derives ground truth
with numpy alone and either ACCEPTS (exit 0) or REJECTS (non-zero). It verifies a
`kernel-correctness-oracle` proof bundle — the correctness NOTARY that must pass
before any TPU speed number is scored (see ../../TPU-ORACLE-DIFF-GATE.md).

It runs the same gate discipline and the SAME exit codes as the quantum judge:

  STRUCTURE       (exit 3) — the declared tiling is valid: shape/dtype match the
                            hidden reference, the output block obeys the (8,128)
                            MXU rule, and grid == ceil(shape / tile) covers the
                            output exactly. (Hermetic stand-in for the fp32
                            interpret=True control notary — the real interpret=True
                            diff is the NEEDS-A-TPU leg; here we check the tiling
                            logic deterministically.)
  REPRODUCIBILITY (exit 4) — the NUMERIC notary. The judge recomputes an fp64
                            reference from the hidden input seed and checks the
                            SUPPLIED reduced-precision output against it within a
                            tolerance DERIVED FROM THE DECLARED DTYPE (bf16 ~ 2^-8
                            ulp), plus a distribution check (fraction-within,
                            zero-mean bias, tail). Also fires on a sealed-hash
                            mismatch (a swapped array) and on a claimant-declared
                            tolerance that disagrees with the derived one. Integer
                            dtypes are held to a BIT-EXACT match (no tolerance).
  ANTI-OVERFIT    (exit 6) — the held-out generalization check: the same numeric
                            notary re-run on a HELD-OUT input batch (seed the model
                            never saw). A kernel accurate on the visible inputs but
                            degraded on the held-out batch is rejected here.

The claimant NEVER self-reports the deviation, the tolerance, or the reference:
the judge recomputes all three. This exit code — not any claim in the bundle — is
the result. Exit codes: 0 ok | 2 schema | 3 structure | 4 reproducibility |
6 anti-overfit.

HERMETIC-NOW vs NEEDS-A-TPU: this judge proves, on a laptop with numpy only, that
the sealed output is correct to the datatype's own bound, that the tolerance was
not chosen by the claimant, and that no array was swapped after sealing. It does
NOT prove the output was produced on real silicon — producing hardware.output is
the NEEDS-A-TPU leg, sealed into the bundle and honestly labelled (roadmap, not
built).

Usage:
  python3 judge_kernel.py <bundle.json> [--json]
  QK_REFERENCES_DIR=/secret/refs python3 judge_kernel.py <bundle.json>
"""

import hashlib
import json
import math
import os
import sys

import numpy as np

SCHEMA = "quantum-harness/proof-bundle@1"
TASK = "kernel-correctness-oracle"

EXIT_OK = 0
EXIT_SCHEMA = 2
EXIT_STRUCTURE = 3
EXIT_REPRODUCIBILITY = 4
EXIT_OVERFIT = 6

# ---- tolerance model: PLATFORM constants, fixed in the judge (never claimant-set) ----
# ulp = unit-in-last-place from the dtype's mantissa bits.
ULP = {"bf16": 2 ** -8, "fp16": 2 ** -11, "fp8_e4m3": 2 ** -3, "fp8_e5m2": 2 ** -2, "fp32": 2 ** -23}
INT_DTYPES = {"int8", "int4", "int16"}
KNOWN_DTYPES = set(ULP) | INT_DTYPES

REL_C = 6.0     # relative bound grows ~ ulp * sqrt(K) (accumulation growth)
ATOL_C = 8.0    # absolute floor ~ ulp * max|ref|
BIAS_C = 4.0    # |mean signed error| bound ~ ulp * mean|ref| — catches a degraded/biased fast path
TAIL_C = 12.0   # 99.9th-percentile |error| bound, as a multiple of the per-element ceiling
FRAC_MIN = 0.999  # fraction of elements that must be within the per-element bound

_HEX64 = set("0123456789abcdef")


class Reject(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def _refs_dir():
    return os.environ.get(
        "QK_REFERENCES_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "references"),
    )


def load_reference(problem_id):
    path = os.path.join(_refs_dir(), f"{problem_id}.json")
    if not os.path.exists(path):
        raise Reject(EXIT_SCHEMA, f"no hidden reference for problem_id={problem_id!r} at {path}")
    with open(path) as f:
        return json.load(f)


def canonical_hash(array_list):
    """Deterministic sha256 of an output array as it appears in the bundle.

    Hashing the canonical JSON of the parsed list is round-trip stable for
    float64/int values, so the judge recomputes exactly what the sealer sealed."""
    return hashlib.sha256(
        json.dumps(array_list, separators=(",", ":")).encode()
    ).hexdigest()


def gen_inputs(shape, seed, dtype):
    """Regenerate the (hidden) inputs deterministically. default_rng(PCG64) is
    stable across numpy versions, so the reference stores only a seed."""
    m, n, k = shape
    rng = np.random.default_rng(int(seed))
    if dtype in INT_DTYPES:
        a = rng.integers(-127, 128, size=(m, k)).astype(np.int64)
        b = rng.integers(-127, 128, size=(k, n)).astype(np.int64)
    else:
        a = rng.standard_normal((m, k))
        b = rng.standard_normal((k, n))
    return a, b


def reference_output(shape, seed, dtype):
    a, b = gen_inputs(shape, seed, dtype)
    return a @ b  # int64 exact, or float64


def derive_tolerance(dtype, k, maxref):
    ulp = ULP[dtype]
    rtol = REL_C * ulp * math.sqrt(k)
    atol = ATOL_C * ulp * maxref
    return rtol, atol


# ---------------------------------------------------------------------------
# Gate 1: STRUCTURE — the declared tiling is a valid MXU tiling of the problem
# ---------------------------------------------------------------------------
def check_structure(bundle, ref, checks):
    c = bundle.get("constraints")
    if not isinstance(c, dict):
        raise Reject(EXIT_SCHEMA, "missing 'constraints' block")
    shape = c.get("shape")
    ref_shape = ref["shape"]
    if list(shape or []) != list(ref_shape):
        raise Reject(EXIT_STRUCTURE, f"constraints.shape {shape} != reference shape {ref_shape}")
    m, n, k = (int(x) for x in ref_shape)

    dtype = c.get("declared_dtype")
    if dtype not in KNOWN_DTYPES:
        raise Reject(EXIT_SCHEMA, f"unknown declared_dtype {dtype!r}")
    if dtype != ref["declared_dtype"]:
        raise Reject(EXIT_STRUCTURE, f"declared_dtype {dtype!r} != reference {ref['declared_dtype']!r}")

    tile = c.get("tile")
    if not (isinstance(tile, list) and len(tile) == 3):
        raise Reject(EXIT_STRUCTURE, "tile must be [tm, tn, tk]")
    tm, tn, tk = (int(x) for x in tile)
    if tm < 1 or tn < 1 or tk < 1:
        raise Reject(EXIT_STRUCTURE, f"tile {tile} has a non-positive dimension")
    # the output block's last two dims must obey the MXU rule: divisible by 8 and
    # 128 respectively, or equal to the overall array dimension.
    if not (tm % 8 == 0 or tm == m):
        raise Reject(EXIT_STRUCTURE, f"output block rows {tm} not divisible by 8 (and != M={m})")
    if not (tn % 128 == 0 or tn == n):
        raise Reject(EXIT_STRUCTURE, f"output block cols {tn} not divisible by 128 (and != N={n})")
    if k % tk != 0:
        raise Reject(EXIT_STRUCTURE, f"reduction tile tk={tk} does not divide K={k}")
    if m % tm != 0 or n % tn != 0:
        raise Reject(EXIT_STRUCTURE, f"tile {tm}x{tn} does not tile the {m}x{n} output exactly")

    kernel = bundle.get("kernel")
    if not isinstance(kernel, dict):
        raise Reject(EXIT_SCHEMA, "missing 'kernel' block")
    src = kernel.get("source_sha256", "")
    if not (isinstance(src, str) and len(src) == 64 and set(src) <= _HEX64):
        raise Reject(EXIT_SCHEMA, "kernel.source_sha256 must be a 64-hex sha256")
    if not isinstance(kernel.get("block_spec"), dict):
        raise Reject(EXIT_SCHEMA, "kernel.block_spec must be present")

    grid = kernel.get("grid")
    exp_grid = [m // tm, n // tn]
    if list(grid or []) != exp_grid:
        raise Reject(EXIT_STRUCTURE, f"kernel.grid {grid} != expected ceil(shape/tile) = {exp_grid}")

    rlen = bundle.get("oracle", {}).get("numeric", {}).get("reduction_len")
    if rlen is None:
        raise Reject(EXIT_SCHEMA, "oracle.numeric.reduction_len is required")
    if int(rlen) != k:
        raise Reject(EXIT_STRUCTURE, f"oracle.numeric.reduction_len {rlen} != K={k}")

    checks["structure"] = {"shape": [m, n, k], "tile": [tm, tn, tk], "grid": exp_grid, "dtype": dtype}
    return dtype, (m, n, k)


# ---------------------------------------------------------------------------
# The numeric notary — one input batch, reused for visible (exit 4) and held-out (exit 6)
# ---------------------------------------------------------------------------
def _get_output(block, shape, label):
    out = block.get("output")
    if out is None:
        raise Reject(EXIT_SCHEMA, f"{label}.output is required")
    arr = np.asarray(out, dtype=np.float64)
    m, n, _ = shape
    if arr.shape != (m, n):
        raise Reject(EXIT_STRUCTURE, f"{label}.output shape {arr.shape} != ({m},{n})")
    return out, arr


def _check_hash(block, label):
    out = block["output"]
    sealed = block.get("output_sha256")
    if not sealed:
        raise Reject(EXIT_SCHEMA, f"{label}.output_sha256 (sealed hash) is required")
    got = canonical_hash(out)
    if got != sealed:
        raise Reject(EXIT_REPRODUCIBILITY,
                     f"{label}.output sealed-hash mismatch: recomputed {got[:12]}… != sealed {sealed[:12]}… "
                     f"(the array was swapped after sealing)")


def check_deviation(hw, ref_out, dtype, k, gate_exit, label, checks_key, checks):
    hw = np.asarray(hw, dtype=np.float64)
    ref = np.asarray(ref_out, dtype=np.float64)
    err = hw - ref
    absref = np.abs(ref)
    maxref = float(absref.max()) if absref.size else 0.0

    if dtype in INT_DTYPES:
        # integer accumulation is EXACT — no tolerance; require a bit-exact match.
        mism = int(np.count_nonzero(np.rint(hw).astype(np.int64) != np.rint(ref).astype(np.int64)))
        stat = {"dtype": dtype, "exact": True, "mismatches": mism, "max_abs_dev": float(np.abs(err).max() if err.size else 0.0)}
        checks[checks_key] = stat
        if mism:
            raise Reject(gate_exit,
                         f"{label}: {mism} element(s) differ from the exact integer reference "
                         f"(integer accumulation must be bit-exact)")
        return stat

    rtol, atol = derive_tolerance(dtype, k, maxref)
    bound = atol + rtol * absref
    within = np.abs(err) <= bound
    frac_within = float(within.mean()) if within.size else 1.0
    mean_bias = float(err.mean()) if err.size else 0.0
    bias_bound = BIAS_C * ULP[dtype] * float(absref.mean() if absref.size else 0.0)
    p999 = float(np.percentile(np.abs(err), 99.9)) if err.size else 0.0
    tail_bound = TAIL_C * (atol + rtol * maxref)

    stat = {"dtype": dtype, "max_abs_dev": float(np.abs(err).max() if err.size else 0.0),
            "rtol": rtol, "atol": atol, "frac_within": round(frac_within, 6),
            "mean_signed_bias": mean_bias, "bias_bound": bias_bound,
            "p999_abs_err": p999, "tail_bound": tail_bound}
    checks[checks_key] = stat

    if frac_within < FRAC_MIN:
        raise Reject(gate_exit,
                     f"{label}: only {frac_within:.4f} of elements within the {dtype}-derived bound "
                     f"(rtol={rtol:.4g}); the kernel diverges from the fp64 reference")
    if abs(mean_bias) > bias_bound:
        raise Reject(gate_exit,
                     f"{label}: systematic bias mean(err)={mean_bias:.4g} exceeds the zero-mean bound "
                     f"{bias_bound:.4g} — a numerically-degraded fast path (passes max-abs, fails the "
                     f"distribution check)")
    if p999 > tail_bound:
        raise Reject(gate_exit,
                     f"{label}: heavy tail p99.9(|err|)={p999:.4g} exceeds {tail_bound:.4g}")
    return stat


# ---------------------------------------------------------------------------
def verify_kernel_oracle(bundle, ref, checks):
    dtype, shape = check_structure(bundle, ref, checks)
    _, k = shape[0], shape[2]

    # tolerance-is-dtype-derived: a declared tolerance may ONLY equal the judge's own.
    hw_block = bundle.get("hardware")
    if not isinstance(hw_block, dict):
        raise Reject(EXIT_SCHEMA, "missing 'hardware' block")
    ho_block = bundle.get("holdout_hardware")
    if not isinstance(ho_block, dict):
        raise Reject(EXIT_SCHEMA, "missing 'holdout_hardware' block")

    _get_output(hw_block, shape, "hardware")
    _get_output(ho_block, shape, "holdout_hardware")

    # sealed-hash integrity (a swapped array is caught here, before any diff).
    _check_hash(hw_block, "hardware")
    _check_hash(ho_block, "holdout_hardware")

    declared_tol = bundle.get("claim", {}).get("declared_tolerance")
    if declared_tol is not None:
        # recompute the dtype-derived rtol against the VISIBLE reference scale.
        vis_ref = reference_output(shape, ref["inputs"]["seed"], dtype)
        maxref = float(np.abs(vis_ref).max())
        if dtype in INT_DTYPES:
            derived = 0.0
        else:
            derived, _ = derive_tolerance(dtype, k, maxref)
        if abs(float(declared_tol) - derived) > max(1e-12, 1e-6 * max(derived, 1.0)):
            raise Reject(EXIT_REPRODUCIBILITY,
                         f"claim.declared_tolerance {declared_tol} disagrees with the {dtype}-derived "
                         f"tolerance {derived:.6g}; the tolerance is a checked function of the dtype, "
                         f"not a claimant's choice")

    # REPRODUCIBILITY (exit 4): visible batch vs judge-recomputed fp64 reference.
    vis_ref = reference_output(shape, ref["inputs"]["seed"], dtype)
    check_deviation(hw_block["output"], vis_ref, dtype, k,
                    EXIT_REPRODUCIBILITY, "visible batch", "reproduced", checks)

    # ANTI-OVERFIT (exit 6): held-out batch (a seed the model never saw).
    ho_seed = ref.get("holdout", {}).get("seed")
    if ho_seed is not None:
        ho_ref = reference_output(shape, ho_seed, dtype)
        check_deviation(ho_block["output"], ho_ref, dtype, k,
                        EXIT_OVERFIT, "held-out batch", "anti_overfit", checks)
        checks["anti_overfit"]["passed"] = True


TASKS = {TASK: verify_kernel_oracle}


def verify(bundle):
    checks = {}
    if bundle.get("schema") != SCHEMA:
        raise Reject(EXIT_SCHEMA, f"schema must be {SCHEMA!r}, got {bundle.get('schema')!r}")
    task = bundle.get("task")
    if task not in TASKS:
        raise Reject(EXIT_SCHEMA, f"unknown task {task!r}")
    if "problem_id" not in bundle:
        raise Reject(EXIT_SCHEMA, "missing problem_id")
    ref = load_reference(bundle["problem_id"])
    if ref.get("task") != task:
        raise Reject(EXIT_SCHEMA, f"reference task {ref.get('task')!r} != bundle task {task!r}")
    TASKS[task](bundle, ref, checks)
    return checks


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    if not args:
        print("usage: judge_kernel.py <bundle.json> [--json]", file=sys.stderr)
        return EXIT_SCHEMA
    try:
        with open(args[0]) as f:
            bundle = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"REJECT [schema]: cannot read bundle: {e}", file=sys.stderr)
        return EXIT_SCHEMA

    try:
        checks = verify(bundle)
    except Reject as r:
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
        print(f"ACCEPT  problem={bundle.get('problem_id')} task={bundle.get('task')}")
        for key, val in checks.items():
            print(f"  {key}: {val}")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv))
