#!/usr/bin/env python3
"""
make_roofline_fixtures.py — generate the T1 Roofline Notary references + bundles,
then self-verify each against judge_kernel.py. All numbers are recomputed by the
judge from the shape + pinned device constants + the supplied wall-clock samples;
the honest bundle states them correctly, each forgery lies about exactly one.

Run:  python3 make_roofline_fixtures.py
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(HERE, "references")
sys.path.insert(0, HERE)
import judge_kernel as jk  # noqa: E402

DEV = "TPU v5e"
SHAPE = [1024, 1024, 1024]           # square GEMM: arithmetic intensity ~ dim/3 = 341 > ridge 240 -> compute-bound
DTYPE = "bf16"
M, N, K = SHAPE
PEAK = jk.PINNED[DEV]["peak_bf16"]
HBM_BW = jk.PINNED[DEV]["hbm_bw"]
RIDGE = PEAK / HBM_BW
USEFUL = 2 * M * N * K
LB = jk._bytes_per_elem(DTYPE) * (M * K + K * N + M * N)   # physical byte lower bound (read once)
INTENSITY = USEFUL / LB
REGIME = "compute-bound" if INTENSITY >= RIDGE else "memory-bound"


def samples_for(pct_target):
    median_t = USEFUL / (pct_target * PEAK)
    return [median_t * 0.98, median_t, median_t * 1.02]      # np.median of 3 -> the middle


def base(problem_id, pct_target=0.6, hbm_bytes=LB, device=DEV, claim=None):
    s = samples_for(pct_target)
    med = float(np.median(np.asarray(s, dtype=float)))
    pct = USEFUL / (med * PEAK)
    if claim is None:
        claim = {"algorithmic_flops": USEFUL, "arithmetic_intensity": INTENSITY,
                 "pct_of_peak": pct, "roofline_regime": REGIME}
    return {
        "schema": jk.SCHEMA, "task": "roofline-attest", "problem_id": problem_id,
        "constraints": {"shape": list(SHAPE), "declared_dtype": DTYPE},
        "hardware": {"device_kind": device, "wall_clock_s": s, "hbm_bytes": hbm_bytes},
        "oracle": {"numeric": {"runner": "xprof + xla.cost_analysis (measured on silicon; NEEDS-A-TPU)"}},
        "claim": claim,
        "meta": {"note": "wall_clock_s + hbm_bytes are placeholder measured values for the hermetic fixture; on real silicon they come from XProf"},
    }


def write(name, obj):
    with open(os.path.join(HERE, name), "w") as f:
        json.dump(obj, f, indent=2)


def write_ref(problem_id, device, threshold=None):
    ref = {"task": "roofline-attest", "contract": "gemm", "shape": list(SHAPE),
           "declared_dtype": DTYPE, "device_kind": device}
    if threshold is not None:
        ref["thresholds"] = {"pct_of_peak_min": threshold}
    os.makedirs(REFS, exist_ok=True)
    with open(os.path.join(REFS, f"{problem_id}.json"), "w") as f:
        json.dump(ref, f, indent=2)


def honest_for(device, shape, pid, dtype="bf16"):
    """An honest roofline coordinate for any PINNED generation/precision (proves the pin attests)."""
    m, n, k = shape
    pin = jk.PINNED[device]
    peak = pin.get("peak_fp4") if dtype in ("fp4", "fp4_e2m1") else (pin.get("peak_int8") if dtype in jk.INT_DTYPES else pin.get("peak_bf16"))
    hbm = pin["hbm_bw"]
    ridge = peak / hbm
    useful = 2 * m * n * k
    lb = jk._bytes_per_elem(dtype) * (m * k + k * n + m * n)
    intensity = useful / lb
    med = useful / (0.5 * peak)
    s = [med * 0.98, med, med * 1.02]
    pct = useful / (float(np.median(np.asarray(s, dtype=float))) * peak)
    regime = "compute-bound" if intensity >= ridge else "memory-bound"
    os.makedirs(REFS, exist_ok=True)
    with open(os.path.join(REFS, pid + ".json"), "w") as f:
        json.dump({"task": "roofline-attest", "contract": "gemm", "shape": list(shape), "declared_dtype": dtype, "device_kind": device}, f, indent=2)
    name = "bundle-roofline-" + device.split()[-1] + "-OK.json"
    write(name, {"schema": jk.SCHEMA, "task": "roofline-attest", "problem_id": pid,
                 "constraints": {"shape": list(shape), "declared_dtype": dtype},
                 "hardware": {"device_kind": device, "wall_clock_s": s, "hbm_bytes": lb},
                 "oracle": {"numeric": {"runner": "xprof (measured on silicon; NEEDS-A-TPU)"}},
                 "claim": {"algorithmic_flops": useful, "arithmetic_intensity": intensity, "pct_of_peak": pct, "roofline_regime": regime},
                 "meta": {}})
    return name, regime


def main():
    write_ref("roofline_gemm_v5e", DEV, threshold=0.2)
    write_ref("roofline_unpinned", "TPU v7x")             # a generation with no pinned constants

    fixtures = []

    ok = base("roofline_gemm_v5e", pct_target=0.6)
    write("bundle-roofline-OK.json", ok); fixtures.append(("bundle-roofline-OK.json", 0, "honest coordinate (compute-bound, ~60% of peak)"))

    b = base("roofline_gemm_v5e"); b["claim"]["algorithmic_flops"] = USEFUL * 2
    write("bundle-roofline-FLOPSLIE.json", b); fixtures.append(("bundle-roofline-FLOPSLIE.json", 4, "FLOP count != 2·M·N·K"))

    b = base("roofline_gemm_v5e"); b["claim"]["pct_of_peak"] = b["claim"]["pct_of_peak"] * 1.3
    write("bundle-roofline-PEAKLIE.json", b); fixtures.append(("bundle-roofline-PEAKLIE.json", 4, "inflated %-of-peak vs recomputed"))

    b = base("roofline_gemm_v5e"); b["claim"]["arithmetic_intensity"] = INTENSITY * 2
    write("bundle-roofline-INTENSITYLIE.json", b); fixtures.append(("bundle-roofline-INTENSITYLIE.json", 4, "arithmetic intensity != FLOPs/bytes"))

    b = base("roofline_gemm_v5e"); b["claim"]["roofline_regime"] = "memory-bound"
    write("bundle-roofline-REGIMELIE.json", b); fixtures.append(("bundle-roofline-REGIMELIE.json", 4, "claims memory-bound but intensity > ridge"))

    b = base("roofline_gemm_v5e", hbm_bytes=LB // 2)
    write("bundle-roofline-UNDERBYTES.json", b); fixtures.append(("bundle-roofline-UNDERBYTES.json", 4, "byte tally below the physical lower bound"))

    b = base("roofline_gemm_v5e", pct_target=1.5)          # median too small -> >100% of peak
    write("bundle-roofline-OVER100.json", b); fixtures.append(("bundle-roofline-OVER100.json", 4, "recomputed rate exceeds 100% of peak"))

    b = base("roofline_gemm_v5e", device="TPU v6e")        # mis-declared vs the reference's v5e
    write("bundle-roofline-BADDEV.json", b); fixtures.append(("bundle-roofline-BADDEV.json", 3, "device_kind mis-declared vs reference"))

    b = base("roofline_unpinned", device="TPU v7x")        # generation not in PINNED
    write("bundle-roofline-UNPINNED.json", b); fixtures.append(("bundle-roofline-UNPINNED.json", 2, "no pinned constants for this generation"))

    b = base("roofline_gemm_v5e", pct_target=0.1)          # honest but below the 0.2 performance floor
    write("bundle-roofline-UNDERPERF.json", b); fixtures.append(("bundle-roofline-UNDERPERF.json", 5, "achieved below the reference's %-of-peak floor"))

    # newly-pinned generations: an honest coordinate on each must ACCEPT (proves the pin attests)
    for dev, shape, dt in [("TPU v6e", [2048, 2048, 2048], "bf16"), ("TPU v5p", [1024, 1024, 1024], "bf16"),
                           ("TPU7x", [2048, 2048, 2048], "bf16"), ("TPU 8t", [4096, 4096, 4096], "fp4")]:
        nm, rg = honest_for(dev, shape, "roofline_gemm_" + dev.split()[-1], dt)
        fixtures.append((nm, 0, "honest " + dev + " " + dt + " coordinate (" + rg + ")"))
    # 8t is pinned for FP4 ONLY — a bf16 claim on it is refused (bf16 peak undisclosed)
    with open(os.path.join(REFS, "roofline_8t_bf16.json"), "w") as f:
        json.dump({"task": "roofline-attest", "contract": "gemm", "shape": [1024, 1024, 1024], "declared_dtype": "bf16", "device_kind": "TPU 8t"}, f, indent=2)
    write("bundle-roofline-8t-bf16-REFUSED.json", {"schema": jk.SCHEMA, "task": "roofline-attest", "problem_id": "roofline_8t_bf16",
          "constraints": {"shape": [1024, 1024, 1024], "declared_dtype": "bf16"},
          "hardware": {"device_kind": "TPU 8t", "wall_clock_s": [1e-4], "hbm_bytes": 6291456}, "claim": {}})
    fixtures.append(("bundle-roofline-8t-bf16-REFUSED.json", 2, "8t bf16 claim refused — bf16 peak not published"))

    print("Roofline Notary — fixture self-verification\n")
    ok_all = True
    for name, want, note in fixtures:
        bundle = json.load(open(os.path.join(HERE, name)))
        try:
            jk.verify(bundle); got = 0
        except jk.Reject as r:
            got = r.code
        mark = "ok " if got == want else "FAIL"
        if got != want:
            ok_all = False
        print(f"  [{mark}] {name:34s} exit {got} (want {want})  — {note}")

    print(f"\n  ridge={RIDGE:.1f} ops/byte · intensity={INTENSITY:.1f} ({REGIME}) · useful={USEFUL/1e9:.3f} GFLOP · lb_bytes={LB}")
    print(f"\n{'ALL ROOFLINE FIXTURES OK' if ok_all else 'FIXTURE MISMATCH — see above'}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
