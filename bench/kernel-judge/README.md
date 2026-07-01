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

## T1 — the Roofline Notary (`roofline-attest` task)

Once a kernel is *correct* (the gate above), the second task attests *how fast* it
ran — again without trusting a single claimant number. For a `roofline-attest`
bundle the judge recomputes, from the GEMM shape + the supplied measured samples +
a **pinned per-generation** peak/bandwidth:

- **useful FLOPs** = 2·M·N·K (and the padded/MXU-issued FLOPs, so padding waste is disclosed),
- **median wall-clock** from the raw per-run samples (not a self-reported median),
- **%-of-peak** = useful FLOPs ÷ median time ÷ pinned peak,
- **arithmetic intensity** = useful FLOPs ÷ measured HBM bytes, and the **compute- vs memory-bound regime** vs the pinned ridge (~240 ops/byte on v5e).

It REJECTs (exit 4) any self-reported number that disagrees, a **byte tally below
the physical lower bound** (operands must cross HBM at least once), or an impossible
**rate above 100 % of peak**; a **mis-declared device** (exit 3) or an **unpinned
generation** (exit 2, refused rather than guessed); and, when the reference declares
one, an achieved %-of-peak **below the floor** (exit 5). Only devices with verified
constants are attested — today that is **TPU v5e**; add a generation only with a
source. The wall-clock samples and measured HBM bytes are the **NEEDS-A-TPU** leg
(placeholder in the fixtures); the arithmetic and the sanity bounds are HERMETIC-NOW.

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
