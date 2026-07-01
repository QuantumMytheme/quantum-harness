#!/usr/bin/env python3
"""
fuzz_kernel.py — property / soundness fuzz test for the kernel judge (Oracle-Diff +
Roofline). Two properties a referee must hold, checked over many randomized inputs:

  COMPLETENESS — an HONEST bundle is always ACCEPTed (exit 0). The judge must not
                 false-reject a correct kernel across random shapes / seeds / dtypes.
  SOUNDNESS    — a FORGED bundle is NEVER ACCEPTed (exit != 0). No random tamper of
                 the output, hash, tolerance, tiling, byte tally, or roofline number
                 may score. This is the whole promise of the bench.

Deterministic (seeded) so a failure reproduces. Uses a throwaway QK_REFERENCES_DIR so
the judge regenerates the fp64 reference from a random seed, exactly as in production.

Run:  python3 fuzz_kernel.py   (exit 0 = both properties held on every trial)
"""

import json
import os
import random
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import judge_kernel as jk  # noqa: E402

RNG = random.Random(20260630)
SRC = "".join(RNG.choice("0123456789abcdef") for _ in range(64))
BLOCK = {"a": {"index_map": "(i,j)->(i,0)"}, "b": {"index_map": "(i,j)->(0,j)"}, "out": {"index_map": "(i,j)->(i,j)"}}


def to_bf16(x):
    x = np.ascontiguousarray(x, dtype=np.float32)
    u = x.view(np.uint32)
    return ((u + (((u >> 16) & 1) + 0x7FFF)) & 0xFFFF0000).view(np.float32)


def sealed(arr):
    lst = arr.tolist()
    return lst, jk.canonical_hash(lst)


def rand_shape():
    return [8 * RNG.randint(1, 3), 128 * RNG.randint(1, 2), 128 * RNG.randint(1, 3)]


def write_ref(refdir, pid, ref):
    with open(os.path.join(refdir, pid + ".json"), "w") as f:
        json.dump(ref, f)


def honest_oracle_bundle(refdir, pid, dtype):
    shape = rand_shape()
    m, n, k = shape
    vseed, hseed = RNG.randint(1, 10 ** 6), RNG.randint(1, 10 ** 6)
    write_ref(refdir, pid, {"task": jk.TASK, "contract": "gemm", "shape": shape,
                            "declared_dtype": dtype, "accum_dtype": "int32" if dtype in jk.INT_DTYPES else "fp32",
                            "inputs": {"seed": vseed}, "holdout": {"seed": hseed}})
    if dtype in jk.INT_DTYPES:
        va, vb = jk.gen_inputs(shape, vseed, dtype); vis = (va @ vb).astype(np.int64)
        ha, hb = jk.gen_inputs(shape, hseed, dtype); ho = (ha @ hb).astype(np.int64)
    else:
        va, vb = jk.gen_inputs(shape, vseed, dtype); vis = np.asarray(to_bf16(va.astype(np.float32)) @ to_bf16(vb.astype(np.float32)), dtype=np.float64)
        ha, hb = jk.gen_inputs(shape, hseed, dtype); ho = np.asarray(to_bf16(ha.astype(np.float32)) @ to_bf16(hb.astype(np.float32)), dtype=np.float64)
    vl, vh = sealed(vis); hl, hh = sealed(ho)
    return {"schema": jk.SCHEMA, "task": jk.TASK, "problem_id": pid,
            "constraints": {"shape": shape, "tile": [8, 128, 128], "declared_dtype": dtype, "accum_dtype": "int32" if dtype in jk.INT_DTYPES else "fp32"},
            "kernel": {"name": "gemm", "source_sha256": SRC, "grid": [m // 8, n // 128], "block_spec": BLOCK},
            "oracle": {"numeric": {"runner": "numpy.float64", "reduction_len": k}},
            "hardware": {"device_kind": "TPU v5e", "output": vl, "output_sha256": vh},
            "holdout_hardware": {"output": hl, "output_sha256": hh}, "claim": {}}, shape


def honest_roofline_bundle(refdir, pid):
    m, n, k = rand_shape()
    dtype = "bf16"
    write_ref(refdir, pid, {"task": "roofline-attest", "contract": "gemm", "shape": [m, n, k],
                            "declared_dtype": dtype, "device_kind": "TPU v5e"})   # no perf floor
    peak = jk.PINNED["TPU v5e"]["peak_bf16"]
    useful = 2 * m * n * k
    lb = jk._bytes_per_elem(dtype) * (m * k + k * n + m * n)
    intensity = useful / lb
    ridge = peak / jk.PINNED["TPU v5e"]["hbm_bw"]
    pct = RNG.uniform(0.05, 0.9)
    med = useful / (pct * peak)
    samples = [med * 0.98, med, med * 1.02]
    return {"schema": jk.SCHEMA, "task": "roofline-attest", "problem_id": pid,
            "constraints": {"shape": [m, n, k], "declared_dtype": dtype},
            "hardware": {"device_kind": "TPU v5e", "wall_clock_s": samples, "hbm_bytes": lb},
            "claim": {"algorithmic_flops": useful, "arithmetic_intensity": intensity,
                      "pct_of_peak": useful / (float(np.median(samples)) * peak),
                      "roofline_regime": "compute-bound" if intensity >= ridge else "memory-bound"}}, (useful, lb, intensity, ridge)


def corrupt_oracle(b, shape):
    m, n, k = shape
    kind = RNG.choice(["bias", "tamper", "loosetol", "holdout", "tile", "shape", "nokernel"])
    if kind == "bias":
        arr = np.asarray(b["hardware"]["output"], dtype=np.float64) + RNG.uniform(50, 500)
        b["hardware"]["output"] = arr.tolist(); b["hardware"]["output_sha256"] = jk.canonical_hash(b["hardware"]["output"])
    elif kind == "tamper":
        arr = [row[:] for row in b["hardware"]["output"]]; arr[0][0] = arr[0][0] + RNG.uniform(10, 100); b["hardware"]["output"] = arr  # stale hash
    elif kind == "loosetol":
        b["claim"]["declared_tolerance"] = RNG.uniform(5, 50)
    elif kind == "holdout":
        arr = np.asarray(b["holdout_hardware"]["output"], dtype=np.float64) + RNG.uniform(50, 500)
        b["holdout_hardware"]["output"] = arr.tolist(); b["holdout_hardware"]["output_sha256"] = jk.canonical_hash(b["holdout_hardware"]["output"])
    elif kind == "tile":
        b["constraints"]["tile"] = [8, RNG.choice([100, 130, 7]), 128]
    elif kind == "shape":
        b["constraints"]["shape"] = [m + 8, n, k]
    elif kind == "nokernel":
        del b["kernel"]
    return kind


def corrupt_roofline(b, facts):
    useful, lb, intensity, ridge = facts
    kind = RNG.choice(["flops", "peak", "intensity", "regime", "underbytes", "over100"])
    if kind == "flops":
        b["claim"]["algorithmic_flops"] = useful * RNG.uniform(1.5, 3)
    elif kind == "peak":
        b["claim"]["pct_of_peak"] = b["claim"]["pct_of_peak"] * RNG.uniform(1.3, 3)
    elif kind == "intensity":
        b["claim"]["arithmetic_intensity"] = intensity * RNG.uniform(2, 6)
    elif kind == "regime":
        real = "compute-bound" if intensity >= ridge else "memory-bound"
        b["claim"]["roofline_regime"] = "memory-bound" if real == "compute-bound" else "compute-bound"
    elif kind == "underbytes":
        b["hardware"]["hbm_bytes"] = int(lb * RNG.uniform(0.1, 0.8))
    elif kind == "over100":
        peak = jk.PINNED["TPU v5e"]["peak_bf16"]; t = useful / (RNG.uniform(1.2, 3) * peak)
        b["hardware"]["wall_clock_s"] = [t]
    return kind


def verify(b):
    try:
        jk.verify(b); return 0
    except jk.Reject as r:
        return r.code


def main():
    N = 120
    tmp = tempfile.mkdtemp(prefix="qk-fuzz-")
    os.environ["QK_REFERENCES_DIR"] = tmp
    ok = True
    complete_fail = sound_fail = 0
    kinds_seen = set()

    # COMPLETENESS — honest bundles ACCEPT
    for i in range(N):
        dtype = RNG.choice(["bf16", "int8"])
        b, _ = honest_oracle_bundle(tmp, f"fuzz_o_{i}", dtype)
        if verify(b) != 0:
            complete_fail += 1; ok = False
    for i in range(N):
        b, _ = honest_roofline_bundle(tmp, f"fuzz_r_{i}")
        if verify(b) != 0:
            complete_fail += 1; ok = False

    # SOUNDNESS — forged bundles NEVER ACCEPT
    for i in range(N):
        dtype = RNG.choice(["bf16", "int8"])
        b, shape = honest_oracle_bundle(tmp, f"fuzz_of_{i}", dtype)
        kinds_seen.add("oracle:" + corrupt_oracle(b, shape))
        if verify(b) == 0:
            sound_fail += 1; ok = False
    for i in range(N):
        b, facts = honest_roofline_bundle(tmp, f"fuzz_rf_{i}")
        kinds_seen.add("roofline:" + corrupt_roofline(b, facts))
        if verify(b) == 0:
            sound_fail += 1; ok = False

    print("kernel-judge property / soundness fuzz\n")
    print(f"  COMPLETENESS  {2 * N} honest bundles → ACCEPT   · {complete_fail} false reject(s)")
    print(f"  SOUNDNESS     {2 * N} forged bundles → REJECT   · {sound_fail} forgery accepted")
    print(f"  corruption kinds exercised: {len(kinds_seen)}")
    print(f"\n{'BOTH PROPERTIES HELD on every trial' if ok else 'PROPERTY VIOLATED — see counts above'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
