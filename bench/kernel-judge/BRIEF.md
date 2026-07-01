# BRIEF — TPU kernel Oracle-Diff Gate (the efficiency referee)

You are being pointed at a **verifiable efficiency** problem, not a quantum-circuit
problem. The judge is `bench/kernel-judge/judge_kernel.py` (routed through
`bench/judge.py`), and — exactly like the quantum bench — it re-derives ground truth
itself and returns an exit code. **The exit code is the result, not anything you
claim.** Full design: [`../../TPU-ORACLE-DIFF-GATE.md`](../../TPU-ORACLE-DIFF-GATE.md).

There are two task types.

## Task 1 — `kernel-correctness-oracle` (is the kernel still *right*?)

Design a **tiled GEMM kernel** for the stated shape and dtype. A speed number is
worthless unless the kernel is still correct, so this gate is the precondition for
any efficiency claim. You submit a proof bundle; the judge:

1. **STRUCTURE (exit 3)** — checks the declared tiling is a valid MXU tiling: the
   output block obeys the `(8, 128)` rule, `grid == ceil(shape / tile)`, and the
   shape/dtype match the (hidden) reference.
2. **REPRODUCIBILITY (exit 4)** — recomputes an **fp64 reference** from the hidden
   input seed and checks your supplied reduced-precision output against it within a
   tolerance **derived from the declared dtype** (bf16 ≈ 2⁻⁸ ulp) plus a distribution
   check (fraction-within, zero-mean bias, tail). Integer dtypes must be **bit-exact**.
   Also fires on a sealed-hash mismatch (a swapped array) or a claimant-declared
   tolerance that disagrees with the derived one.
3. **ANTI-OVERFIT (exit 6)** — re-runs the numeric check on a **held-out** input seed
   you never saw. A kernel accurate on the visible inputs but degraded on the held-out
   batch is rejected here.

You cannot choose your own tolerance, self-report the deviation, or hand-pick inputs —
the judge derives all three.

## Task 2 — `roofline-attest` (how *fast*, honestly?)

Once correct, attest the efficiency **coordinate**. The judge recomputes the useful
FLOPs from the shape (`2·M·N·K`), the median wall-clock from your samples, the
`%-of-peak` against a **pinned per-generation** peak, and the arithmetic intensity /
compute-vs-memory-bound regime vs the pinned ridge (~240 ops/byte on v5e). It rejects
any self-reported number that disagrees, a byte tally below the physical lower bound,
or a rate above 100% of peak (exit 4); a mis-declared or unpinned device (exit 3/2);
and an achieved `%-of-peak` below a declared floor (exit 5).

## The honest boundary — hermetic-now vs needs-a-TPU

- **On a real TPU VM:** author the kernel in Pallas, run it under `interpret=True`
  (the golden/control output) and on the MXU (the hardware output), and measure the
  wall-clock + HBM bytes with XProf. Seal them into the bundle.
- **Offline (no TPU), to exercise the judge today:** emulate the reduced-precision
  output in numpy (bf16 = round the low 16 mantissa bits; int8 = exact integer
  accumulate), and use placeholder measured values for the roofline task. This is
  what `make_fixtures.py` / `make_roofline_fixtures.py` do — read them for the exact
  bundle shape, then run `python3 judge_kernel.py <bundle>.json --json` and loop until
  exit 0. The *correctness* half is fully verifiable on a laptop; the *"it really ran
  on silicon"* half is measured-on-hardware and honestly labelled (roadmap, not built).

## The contract

Ground truth (input seeds, held-out seed, pinned constants) lives host-side with the
judge and is never in the bundle. A bundle that fabricates an output, undercounts
bytes, or overfits the visible inputs is rejected. Reproducible with numpy alone.
Design honestly and let `verify_bundle` (or the CLI) confirm.
