# kernel-judge — the Oracle-Diff Gate (hermetic half, Phase T0)

The **correctness notary** for TPU-native kernels: the gate that must pass before
any speed number is scored (design: [`../../TPU-ORACLE-DIFF-GATE.md`](../../TPU-ORACLE-DIFF-GATE.md);
platform track: [`../../PLATFORM-VISION.md`](../../PLATFORM-VISION.md) “Track 2”).

It is built in the image of [`../quantum-judge`](../quantum-judge): a
self-contained, **offline, numpy-only, exit-code** judge that re-derives ground
truth and either ACCEPTs (exit 0) or REJECTs (non-zero). Nothing here touches JAX,
Pallas, or a TPU — this is the part a laptop can check **today**.

## What it verifies

A `kernel-correctness-oracle` proof bundle for a tiled GEMM, through the same gate
discipline and exit codes as the quantum judge:

| Exit | Gate | The judge recomputes… |
|---|---|---|
| 3 | **STRUCTURE** | the declared tiling is a valid MXU tiling: shape/dtype match the hidden reference, the output block obeys the (8, 128) rule, and `grid == ceil(shape/tile)` tiles the output exactly. (Hermetic stand-in for the fp32 `interpret=True` control notary.) |
| 4 | **REPRODUCIBILITY** | the numeric notary: the supplied reduced-precision output vs a judge-recomputed **fp64** reference, within a tolerance **derived from the declared dtype** (bf16 ≈ 2⁻⁸ ulp) + a distribution check (fraction-within, zero-mean bias, tail). Also fires on a **sealed-hash mismatch** (a swapped array) and on a **claimant-declared tolerance** that disagrees with the derived one. Integer dtypes are held to a **bit-exact** match. |
| 6 | **ANTI-OVERFIT** | the same numeric notary re-run on a **held-out** input batch (a seed the model never saw). Accurate-on-visible / degraded-on-held-out is rejected here. |

The claimant never self-reports the deviation, the tolerance, or the reference —
the judge recomputes all three. **This exit code, not any claim in the bundle, is
the result.**

## Run

```bash
python3 judge_kernel.py bundle-gemm-bf16-OK.json          # ACCEPT (exit 0)
python3 judge_kernel.py bundle-gemm-bf16-OK.json --json   # verify_bundle-shaped JSON
python3 test_kernel.py                                    # regression suite, K1–K12 (exit 0 = all pass)
python3 make_fixtures.py                                  # regenerate references + fixtures deterministically
QK_REFERENCES_DIR=/secret/refs python3 judge_kernel.py <bundle.json>   # contest override
```

## Files

- `judge_kernel.py` — the judge (schema / structure / reproducibility / anti-overfit).
- `references/*.json` — the **hidden** ground truth: only input **seeds** + shape + dtype (the judge regenerates the fp64 reference itself; relocatable via `QK_REFERENCES_DIR`).
- `bundle-*.json` — the K1–K12 fixtures: genuine kernels that ACCEPT, one forgery per rejection class.
- `make_fixtures.py` — deterministic generator (numpy-emulates honest bf16/int8 outputs; forgeries are surgical mutations) that self-verifies every fixture.
- `test_kernel.py` — the expect-pass / expect-fail suite.

## HERMETIC-NOW vs NEEDS-A-TPU

This judge proves — on a laptop, numpy only — that the sealed output is correct to
the datatype’s own bound, that the tolerance was **not** chosen by the claimant, and
that no array was swapped after sealing. It does **not** prove the output was
produced on real silicon: generating `hardware.output` on a TPU (and the roofline /
bytes-per-token speed gates it enables) is the NEEDS-A-TPU leg — **roadmap, not
built**. The honest boundary between *measured-in-harness* and *hoped-on-hardware*
is held here exactly as in the quantum bench.
