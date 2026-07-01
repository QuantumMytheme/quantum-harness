# TPU-Native Architectures as a Verifiable-Efficiency Referee

*QuantumMytheme design brainstorm — 35 stress-tested ideas, six lenses, honest verdicts folded in.*

---

## 1. Framing

QuantumMytheme's Part-V north star is a specific, unglamorous claim: **machine intelligence gets more efficient through classical architecture and post-CMOS substrates, not through a quantum LLM accelerator — and the efficiency has to be *measured*, not asserted.** TPU-native architecture design is the most concrete place that thesis can be cashed out on real silicon *today*. A TPU is a small, legible machine: nearly all math flows through one dominant 128×128 systolic MXU (bf16-in / fp32-accumulate, int8 at ~2×), a program-managed VMEM scratchpad, and HBM. That legibility is exactly what a referee needs. The roofline is unusually sharp — a single well-defined compute peak over a single HBM bandwidth — so "compute-bound vs bandwidth-bound," "what fraction of peak did you reach," and "how many HBM bytes did you move per token" are crisp, first-principles questions with hardware-anchored answers rather than vibes.

The second half of the credibility story is **Pallas's `interpret=True` correctness contract.** The same kernel source that lowers to the MXU can be run in a pure-JAX emulator that shares the BlockSpec/grid tiling, giving a deterministic, third-party-replayable correctness oracle. That is the missing piece in every efficiency benchmark: a speed number is meaningless unless the kernel is still *right*, and here "right" is a compiler-tied artifact, not a claimant's word. QuantumMytheme already runs a 4-gate numpy judge and a `mint_run`/`verify_bundle` flow for quantum bundles; a TPU kernel bundle slots into exactly that machinery.

So the project's identity — **verifiable-efficiency referee** — is not a metaphor here. The TPU supplies the physics (roofline, VMEM residency, ICI topology) and Pallas supplies the notary (`interpret=True`). The honest boundary, held throughout this doc, is that *measured-in-harness* and *hoped-on-hardware* are different words and we never blur them.

---

## 2. The unifying insight

Across every idea that survived adversarial review, the through-line is the same triangle: **arithmetic intensity is the currency, VMEM-residency and precision are the two levers that move it, and `interpret=True` + compiler cost-analysis are what make the resulting claim falsifiable.** LLM decode lives far to the *left* of the roofline ridge (batch-1 intensity ≈ 1–2 ops/byte vs a ~240 ops/byte knee), so it is bandwidth-bound and the MXU idles. Every strong idea is a different honest attempt to raise bytes-worth-of-useful-work-per-token — fewer bytes (int4/ternary/PQ), reused bytes (batching, weight-tying, resident state), or bytes kept on-chip (VMEM residency) — *paired with a gate that proves the win was real and correctness held.* The recurring failure mode, and the reason so many verdicts landed on "weak," is the seductive but false belief that **residency or shape-pinning alone crosses the roofline knee.** It does not: at batch-1 a weight is read once and used once regardless of where it lives, so residency only swaps *which* bandwidth tier binds you. The batching/reuse dimension is the only lever that actually moves intensity — and the referee's job is to force that admission into the open.

---

## 3. Idea catalog (grouped by theme, strongest first)

Tiers: **[BUILD-FIRST]** buildable + verifiable + high-leverage now · **[STRONG]** sound and referee-able, real win survives refinement · **[SPECULATIVE]** keep-able but the headline claim is wrong/narrow; the *refined* version is the deliverable · **[MOONSHOT]** pod-scale or post-CMOS, honest thought-experiment + small-slice measurement.

### Theme A — The referee machinery (the platform itself)

This theme is first because it is what makes all the others trustworthy, and it holds the two highest-excitement ideas.

**Oracle-Diff Gate — `interpret=True` as notary. [BUILD-FIRST]**
*One-line:* every kernel bundle ships a Pallas `interpret=True` golden run; an efficiency claim is scored only if the hardware kernel matches the oracle within a *judge-checked* tolerance.
*Bet:* correctness becomes a hash-sealed, replayable artifact rather than a claimant assertion — the first hardware referee gate, reusing the quantum harness's golden-output machinery.
*Mechanism:* `interpret=True` (deterministic, CPU-pure JAX) vs the real MXU lowering, identical BlockSpec grid.
*Metric:* an *enabling* pass/fail predicate (max element-wise deviation vs oracle) that must pass before any speed number is scored.
*Novelty:* reframes a debug aid as a mintable correctness oracle.
*Kill-shot / risk:* `interpret=True` does **not** model MXU bf16/int8 rounding, so any real MXU kernel can never bit-match — the scheme collapses to "within a claimant-declared tolerance," which is exactly where a numerically-degraded fast path hides. **Refinement (adopt):** split into two notaries — (1) an fp32 *control/tiling* notary that near-exactly verifies grid/index_map/masking logic, and (2) a *numeric* notary that gates reduced-precision kernels against a **higher-precision fp64 host reference** with a tolerance *derived from the declared dtype* (bf16 ≈ 2⁻⁸ ulp), plus a distribution check, not a claimant-chosen scalar.

**Roofline Notary — compiler-derived FLOP/byte attestation. [BUILD-FIRST]**
*One-line:* the judge extracts FLOPs and bytes from XLA's own `cost_analysis()` of the lowered program (never from the claimant), pairs them with measured wall-clock, and stamps the kernel's roofline coordinate on the named TPU generation.
*Bet:* kill the original sin of efficiency benchmarks — self-counted FLOPs — by making numerator and denominator compiler-computed from attacker-supplied input.
*Mechanism:* `jax.jit(f).lower().compile().cost_analysis()` over the MXU-lowered HLO; peak/bandwidth constants pinned per generation; `device_kind` read at runtime.
*Metric:* achieved MXU FLOP/s as % of bf16 peak, plus arithmetic intensity.
*Kill-shot / risk:* `cost_analysis()` "bytes accessed" is a **static HLO estimate that ignores fusion and VMEM reuse** — it is not measured HBM traffic, so the *x*-axis (compute- vs bandwidth-bound classification) can be wrong by several×, while advertising itself as "measured." **Refinement (adopt):** demote to an "achieved-peak notary." Ship the verifiable core (algorithmic-FLOPs ÷ measured-median-time = %-of-peak; *time is physical and hard to fake*), read `device_kind` from the harness (kills the mis-declaration attack for free), take arithmetic intensity from the **profiler's HBM counters** not the cost model (or label it explicitly "compiler-model estimate"), report logical-vs-MXU-issued FLOPs separately to disclose padding, and hash the jaxlib+libtpu+XLA-flags into the bundle.

**HBM-Byte Ledger — bytes/token you can re-derive. [STRONG]**
*One-line:* reconstruct HBM traffic per token from the Pallas BlockSpec DMA schedule and cross-check against XLA's memory model.
*Bet:* the declared BlockSpec *is* the byte ledger — two independent derivations that must agree = a verifiable claim.
*Metric:* HBM bytes/token, double-derived.
*Kill-shot / risk:* the two derivations are **both static views of the same compiler schedule** (agreement ≈ tautology), and BlockSpec only sees Pallas-authored kernels, so a whole-model bytes/token — dominated by XLA matmul weight loads — is outside its view. **Refinement:** add a **third, measured** leg from the XProf HBM-bandwidth counters and treat the static ledger as a *predictor validated against measured traffic*; scope the task to a single self-contained Pallas decode kernel; label output "issued bytes, padded to 8×128, lower bound."

**XPlane Provenance Cartridge — replayable profiler attestation. [STRONG]**
*One-line:* a hermetic run-bundle pinning libtpu/XLA-flags/topology/seed and embedding the raw XProf trace, so a third party re-runs and confirms MXU-util and wall-clock reproduce within a stated band.
*Kill-shot / risk:* **MXU FLOP-utilization is a *duty-cycle* metric, trivially gamed** — a kernel can pin the array at 90% doing padded/redundant work, and the cartridge faithfully, hash-sealed, certifies busywork; the claimant-declared variance band absorbs the rest. **Refinement:** seal *useful*-FLOP throughput (declared problem FLOPs ÷ measured time, so padding counts against you) + the roofline classification, not raw duty cycle; seal the autotune cache and inputs (not just flags) or replay is non-deterministic; make the variance band *platform-set* from a calibration corpus. Be honest that cloud-gated silicon makes this *attested-reproduction on a notary pool*, not open third-party verification.

**Precision-Ledger — int8/int4 claims with a statistical honesty gate. [STRONG]**
*One-line:* a reduced-precision throughput claim is only minted alongside a judge-recomputed quality-degradation bound vs the full-precision oracle over a held-out distribution.
*Kill-shot / risk:* the hardware side contributes only a trivial constant ceiling (and **int4 is not a first-class MXU mode** on mainstream generations — it's emulated), while the entire value is a distribution-dependent empirical *estimate*, not a bound, over a claimant-chosen set — the honesty gate can be green while real degradation is unbounded. **Refinement:** split into two separately-typed claims — (a) a deterministic *hardware* claim (achieved int8 MXU multiple on shape S, VPU dequant overhead counted, int4 flagged "software-emulated" where it is), and (b) a *quality estimate* with reported n and CI over a **platform-registered** distribution; grade the axis on disclosure-with-provenance, not on clearing a threshold.

### Theme B — Precision as the lever (the cleanest verifiable wins)

Low-bit datatypes give a *bit-exact integer oracle* — the strongest verifiability in the whole set — because integer accumulation is deterministic.

**Twin-Rail Int4 — packed int4 pairs → native int8 MXU. [BUILD-FIRST]**
*One-line:* store weights as int4 pairs in HBM (½ the bytes of int8), unpack in VMEM, drive the int8 systolic path at full fill.
*Bet:* in memory-bound decode the halved HBM traffic is the whole win and the unpack hides under DMA.
*Mechanism:* int8 MXU + int32 accumulate; VPU shift/mask unpack; async DMA of the reduced stream.
*Metric:* HBM weight-bytes/token vs int8 (scales **included** in the tally) + MXU util unchanged + judge-checked perplexity delta. **Verifiability: yes** — unpack+matmul is bit-exact against the reconstructed int8 reference under `interpret=True`.
*Kill-shot / risk:* this is textbook **W4A8 weight-only quant** — the "pack/unpack discipline" is the default, not an invention — and if quality forces a bf16 dequant target you drop onto the half-rate bf16 MXU, dissolving the win. **Refinement:** commit to a packing layout where low/high nibbles land as separate MXU-aligned sub-tiles (unpack provably elementwise, no cross-lane shuffle); fix the contract as int4-weight / int8-act / int32-accum with per-group scales in the accumulator; grade **end-to-end measured decode tokens/s and realized bytes** vs a real Pallas int8 baseline.

**Bitplane Ternary MXU — sub-INT4 via bitplane accumulation. [STRONG]**
*One-line:* decompose ternary weights into ±1 bitplanes, run each as an int8 MXU pass, accumulate — sub-2-bit memory footprint on the fully-utilized int8 path.
*Bet:* for memory-bound decode, fewer weight bytes beats a few extra "spare" int8 passes.
*Metric:* effective bits/weight jointly with tokens/s (two-axis, so a bytes-only mirage is caught). **Verifiability: yes** — exact integer arithmetic, bit-identical oracle.
*Kill-shot / risk:* reaching the ~1.58-bit floor at quality essentially requires BitNet-class QAT — but a native BitNet model is *one* int8 matmul, not an accumulating stack, so there's no "spare passes buy bytes" arbitrage; and int4 (1 pass) already captures most of the memory-bound win. **Refinement:** narrow to serving *already-ternary* checkpoints and publish the honest **roofline crossover map**: net decode tokens/s vs a bf16/int8 baseline as a function of batch B, reporting the batch where the extra passes stop paying.

**Q4 Highway — int4 residual stream with per-tile scales. [SPECULATIVE]**
*One-line:* keep residual + weights int4 with fp32 accumulate, per-128-block learned scales, requant at tile boundaries.
*Kill-shot / risk:* the one claimed TPU-exclusive edge — "tile-boundary requant free of cross-tile reductions" — is **self-refuting**: computing a per-block scale *is* a 128-wide last-axis absmax reduction (the expensive VPU case); static scales dodge it but can't track activation outliers. The 4× int4 MXU path is also unproven on TPU. **Refinement:** retreat to the defensible half — int4 **weight-only** (dequant to the documented int8 path, 2×) — i.e. Twin-Rail, above. Q4 Highway survives only as a cautionary entry.

### Theme C — The decode bandwidth wall: VMEM residency, recurrence, KV

The largest cluster. Every idea here is a genuine attempt at the memory-bound decode regime; the recurring correction is that **residency ≠ crossing the ridge; batching/reuse does.**

**Torus-SSM — MXU-native 128-wide recurrence. [STRONG]**
*One-line:* pin SSM/linear-attention state dim to the MXU width (128/256), keep the O(1) state VMEM-resident across chunks.
*Bet:* a normally bandwidth-bound recurrence runs at MXU throughput.
*Metric:* MXU util % and ops/byte at matched long-context accuracy (state-dim tile-alignment is *statically* auto-checkable).
*Kill-shot / risk:* "pin state = MXU width" is **already standard** (Mamba2/GLA pick 64/128/256 for tensor-core alignment); the real TPU bottleneck is the **data-dependent gating / cumulative-decay VPU work** (last-axis cumsum/segsum), which 128-pinning doesn't touch. **Refinement:** fold the decay into the MXU as a precomputed lower-triangular decay-weighted mask and *measure* the resulting MXU-vs-VPU balance; sweep state-dim {64,128,256} for a capacity/utilization Pareto; require the bundle to **beat a Mamba2/GLA Pallas baseline in wall-clock at matched accuracy.**

**ResidentMoE — VMEM-locked micro-experts. [STRONG]**
*One-line:* many tiny low-rank experts whose whole bank fits in VMEM, so per-token expert compute never touches HBM.
*Kill-shot / risk:* at batch-1 a d→r→d expert is ~1 op/byte **regardless of where weights live** — residency swaps the bandwidth tier, it does not make decode compute-bound; and r=32 experts starve the 128-wide MXU. **Refinement:** reframe around **decode batching** — with batch B, each resident expert's weights are reused by every routed token, so effective intensity scales ~B and *genuinely* crosses into compute-bound. Metric becomes "expert-weight HBM-bytes/token at concurrency B" with the crossover curve; pad expert ranks to 128 (block-diagonal batched matmul); add a sustained-multi-step DMA trace proving *persistent* residency, not one-time load.

**Residency-Bounded Attention (RBA) — sparsity sized to VMEM. [STRONG]**
*One-line:* choose the attention mask so each query block's KV working set is exactly VMEM-resident, then reuse it across the block.
*Kill-shot / risk:* attention intensity is set by the **query-reuse factor**, not by residency; sparsifying cuts FLOPs and bytes proportionally so ops/byte is ~unchanged, and at batch-1 you stay memory-bound. **Refinement:** change the gate from "ops/byte crossed 240" (Goodhart-able via redundant FLOPs) to **perplexity-within-bound + measured decode tokens/s (or HBM-bytes/token) at iso-quality, iso-batch**; make query-reuse the explicit design variable; use *static* strided landmarks so the kernel is Pallas-implementable.

**QuadKV — nibble-cache windowed attention. [SPECULATIVE]**
*One-line:* int4 sliding-window KV pinned in VMEM, dequantized on the fly.
*Kill-shot / risk:* batch-1 decode attention is **GEMV (M=1)** — the systolic array runs at ~1/128 occupancy no matter where KV lives or its precision; shrinking/pinning KV changes the *bandwidth tier*, not the ~2 ops/byte intensity, so it cannot be made compute-bound. **Refinement:** co-design window × **batch** so decode is a real M=batch GEMM; use int4 for *storage* only, dequant in-VMEM to int8 for the MXU; redefine the metric as ops/byte-against-VMEM-traffic **plus MXU occupancy** (kills the "zero HBM bytes" loophole).

**VMEM Drafter — speculative-residency decode. [SPECULATIVE]**
*One-line:* a tiny drafter kept entirely VMEM-resident (HBM-free drafting), verify K tokens in one wide matmul.
*Kill-shot / risk:* the drafter's HBM traffic was **already a rounding error** next to the target's per-verify weight stream (<1%), and the ~60M-param VMEM cap forces a drafter too weak to keep acceptance high — optimizing a negligible term while hurting the dominant one. **Refinement:** keep the genuinely solid part — **accepted-tokens/HBM-byte with an exact accept-reject lossless oracle** — as a standalone referee task; run an honest drafter-size sweep to find where residency actually crosses over (small on-device targets, tiny-active-expert MoE); a "tiny-drafter-loses" result is a publishable honest negative.

**StateHold — the VMEM-resident SSM. [SPECULATIVE]**
*Kill-shot / risk:* VMEM is a **transient per-kernel scratchpad, not a cross-dispatch persistent store**, so in the decode regime each AR step is a separate launch and state round-trips HBM anyway; residency only holds *within* a chunk kernel, which is already compute-bound. Per-layer *param* residency also fails (one layer's projections > 128 MiB). **Refinement:** retarget long-context **prefill** (a single megakernel with a grid loop legitimately keeps scan operands VMEM-resident across chunks); account scan-attributable HBM traffic *separately* from unavoidable weight-streaming; the honest win is the known SSM memory advantage below a flash-attention baseline, not a pinning trick.

**Vertical Fusion Tower — G narrow layers fused in VMEM. [SPECULATIVE]**
*Kill-shot / risk:* the "G× weight-bytes/token" saving **does not exist** — streaming a tile through G resident layers reads the same total weight bytes as the unfused loop (batching already reads each weight once); the idea mislabels an *activation*-fusion win as a weight-streaming win. **Refinement:** measure **activation**-bytes/token (the real saved inter-layer traffic), pin the baseline at batch-optimal so the comparison isn't rigged, and add a quality gate for narrow-deep vs wide.

**Conveyor — layers pinned to the roofline ridge. [MOONSHOT / impossibility-referee]**
*Kill-shot / risk:* arithmetic intensity of a batch-1 weight-load matmul is fixed ≈ 1 op/byte and **independent of layer width/depth** — you cannot "design intensity = 240" by reshaping layers; decode is bandwidth-bound by physics. **Refinement:** the only lever that raises batch-1 intensity is **weight reuse in the iteration dimension** (weight-tied/looped/DEQ blocks, apply a resident tile ~R times, R at the ridge). Or ship it as an **"impossibility referee"** — a verified negative result demonstrating the batch-1 memory-bound floor, which is itself a legitimate, honest artifact.

**Reversible VMEM-Resident Transformer (RVR). [SPECULATIVE]**
*Kill-shot / risk:* reversibility is a *training*-memory trick; **at inference there is no backward pass**, so a plain forward already discards activations and runs near the weight+KV floor — the eliminated round-trips largely don't exist, and the extra recompute FLOPs land on the critical path in the compute-bound regime it invokes. **Refinement:** move the judged quantity to **training** (real activation-checkpoint HBM savings, same harness), or retarget long-context **prefill** with pure VMEM-resident tiling (drop reversibility); hard-constrain to models where a layer provably fits VMEM (d_model ≤ 1024) as gate zero.

### Theme D — MoE dispatch & sparsity

**SC-Retrieve — SparseCore external memory. [STRONG]**
*One-line:* push the kNN/PQ memory gather onto SparseCore (int8 PQ codes) so the MXU/VMEM stay devoted to dense compute.
*Kill-shot / risk:* "retrieval bytes are free relative to the matmul roofline" is **false — SparseCore and the MXU share the same HBM bandwidth**; the offload is compute-*issue* relief, not a bandwidth free lunch. Also the full kNN needs a top-k reduction SparseCore isn't built for, and Pallas SC programmability is immature. **Refinement:** reframe as two honest wins — int8/PQ **HBM-traffic reduction** + **address-gen/issue offload** so the MXU never stalls on gather; scope SC to the gather-shaped IVF-PQ ADC step, keep top-k on the VPU; change the metric to *achieved HBM bandwidth during the overlapped window*; verify PQ distances against a brute-force fp32 recall@k reference.

**Expert-Stationary MoE — route tokens to VMEM-resident experts. [SPECULATIVE]**
*Kill-shot / risk:* a real expert (~340 MB bf16) **exceeds VMEM**, and autoregressive decode touches each active expert once/step, so "stationary reuse" doesn't exist — the ops/byte gain is purely a function of batch (~7,680 concurrent tokens to cross 240), i.e. "batch big," which serious stacks already do. **Refinement:** drop the residency novelty; make the referee report **padded** expert-weight-bytes/token (the 8×128 tile-quantization + routing-imbalance tax) as an honest amortization curve; use DMA-gather, not SparseCore.

**Tile-MoD — 128-token depth quantum. [SPECULATIVE]**
*Kill-shot / risk:* the problem is **already solved** by fixed-capacity MoD — a static [C, d_model] tensor with C a multiple of 128 gives tile alignment for free at per-token granularity, so 128-block routing is strictly *coarser* (worse quality) to fix a shape problem that doesn't exist; MXU util is governed by the weight tile, not the token axis. **Refinement:** baseline against fixed-capacity per-token MoD and study the real, TPU-real cost — gather/scatter + dynamic-index overhead, and whether SparseCore compaction actually frees MXU cycles vs a VPU/MXU-path gather.

**SparseCore MoE Router — off-MXU gather. [SPECULATIVE]**
*Kill-shot / risk:* **category error** — SC shares HBM with the MXU, so moving the gather changes *which engine issues DMA*, not the total bytes the roofline counts; and SC isn't Pallas-programmable for arbitrary permute/capacity logic (it's the XLA embedding API). **Refinement:** reframe as a **latency-hiding** claim (dispatch DMA overlapped behind expert-GEMM, raising MXU duty cycle), measure end-to-end latency vs a MegaBlocks grouped-GEMM baseline, scope to single-chip high-expert-count large-batch, build on the JAX SparseCore/TPU-embedding API.

**Centtile MoE — expert = one MXU tile. [DROPPED — keep=false, footnoted]**
Category error: MoE's structural waste is on the **token/capacity (M) axis**, but the pad-to-128 rule it exploits is on the weight (N/K) axis, which is already 128-aligned and wastes nothing. Making an expert literally 128×128 sets hidden-dim=128 (destroys FFN quality) and explodes expert/router count. Retained only as a lesson: *don't confuse the token axis with the weight axis.* Its one salvageable harness idea (true MXU-active-useful-cycles / total-cycles under routing imbalance) is subsumed by Expert-Stationary's refinement.[†]

### Theme E — Interconnect-native, pod-scale

All three ride the static ICI 3D-torus; all three are honest thought-experiments until run on a real pod slice.

**TorusWeave — one-hop model parallelism. [SPECULATIVE]**
*Kill-shot / risk:* a hard 1-hop cap is a **quality tax that grows with pod size** — a 6-neighbor torus node reaches <0.2% of experts at pod scale, and torus all-to-all is *already* a nearest-neighbor bucket-brigade, so the marginal win over a well-tuned hierarchical baseline is small. **Refinement:** make it a locality-*biased* router (hop-distance penalty on gating logits + small escape budget), deliver a **Pareto frontier (quality vs ICI-bytes/token)**, prove it at single-tray scale where 1-hop covers real experts, and separate routing-permutation correctness (single-host `interpret=True`) from the perf claim (small multi-host slice, profiler ICI counters).

**Torus-MoE — locality-routed all-to-all-free experts. [MOONSHOT]**
*Kill-shot / risk:* the router-locality prior is in **direct tension with load-balancing** — you can't have locality, balanced load, and specialization simultaneously; the comm saving is bought precisely by sacrificing what MoE exists for, and the baseline (XLA's already-topology-aware ring-decomposed all-to-all) is over-stated. **Refinement:** decouple **placement** (learn it by co-activation clustering so correlated experts sit adjacent) from **routing** (keep it globally free); make the locality bias one swept scalar λ; ship the deliverable as a **λ-Pareto curve of ICI-bytes/token vs eval-loss** — the curve is the verifiable artifact.

**Torus Systolic Layer — ICI-as-dataflow. [MOONSHOT]**
*Kill-shot / risk:* it optimizes a **negligible term** — per-chip activation traffic (tens of KB/token) is dwarfed by weight streaming — and forces activations onto ICI, which is **~10× lower bandwidth than HBM** with per-hop latency; a wavefront *lengthens* the latency-bound decode critical path. **Refinement:** retarget the **compute-bound prefill/large-batch** regime where activations are large and genuinely reused (overlap collective-permute with MXU compute), metric = tokens/s-per-watt vs a tuned tensor-parallel baseline; or restrict to small-MoE experts that fit VMEM so "no HBM in the inner loop" is a *true* statement.

### Theme F — Shape & utilization discipline

**Tile-Perfect Transformer — snap every dim to the (8,128) lattice. [STRONG, as a decomposer]**
*Kill-shot / risk:* **padding-free ≠ MXU-utilized** — real underutilization is dominated by roofline/memory-boundness and systolic fill-drain, which shape-snapping can't touch, so "MXU fill provably 100%" is unreachable and the metric is mis-defined; and production configs already choose 128-friendly shapes. **Refinement:** reframe as a **utilization-deficit *decomposer*** — from one trace, report three terms (static padding waste, roofline/memory-bound stall fraction, pipeline fill-drain) and attribute the gap to peak across them. The *static* half (auto-flag any dim ≢ 0 mod (8,128), useful/padded FLOP ratio) is cheap, deterministic, and genuinely useful as one honest line item.

**Ridgeline — self-homing roofline kernel. [SPECULATIVE]**
*Kill-shot / risk:* **category error** — TPUs expose no in-kernel performance counters, so a running kernel cannot instrument its own intensity; measurement and search must be host-side, collapsing the idea into a rebranded XLA/Triton autotuner. Intensity is analytic (from M·N·K), not runtime-measured. **Refinement:** ship it honestly as a host-side autotuner emitting a **hermetic pinned recipe** (chip-gen + libtpu + dtype + shape + tile), judged on (a) tolerance-match (**not** bit-exact — different tilings change reduction order) vs the `interpret=True` oracle and (b) an independently re-benchmarked achieved-ceiling fraction with a CI.

**MonoMXU — all-matmul forward pass. [SPECULATIVE]**
*Kill-shot / risk:* the central primitive is **impossible as stated** — normalization (and linear-attention's denominator) is a *data-dependent nonlinear last-axis reduction* that no fixed/learned matmul can express; and XLA already overlaps those VPU reductions with MXU work, so the eliminated stall is Amdahl-bounded, paid for with linear/poly attention's known quality loss. **Refinement:** reframe as "reduction-lite" (keep one cheap fused reduction), change the metric from MXU-share to **iso-quality wall-clock tokens/s**, narrow the architectural claim to attention alone (a real linear-vs-softmax speed/quality frontier).

### Theme G — Quantum / tensor-network on the MXU (the on-mission classical simulators)

This theme is the tightest fit to QuantumMytheme's existing identity: the systolic array *is* a tensor-contraction engine, and each task yields a fidelity-vs-exact number the referee already knows how to gate. The honest line throughout: **classical simulator, not a quantum accelerator; the crossover where the QPU genuinely wins is itself the published number.**

**XEB-Referee — TPU as the classical verifier of quantum-advantage sampling. [STRONG]**
*One-line:* contract the ideal circuit as a tensor network on the MXU to compute linear cross-entropy fidelity of a QPU's bitstring samples.
*Bet:* the tightest possible fit — the TPU *becomes* the harness's scoring engine; "largest circuit we can certify" is a headline scoreboard coordinate.
*Kill-shot / risk:* the TPU's only real edge is **bf16 systolic throughput, but XEB amplitudes demand fp32/complex** due to catastrophic cancellation — on the MXU that's bf16×3 emulation (~⅓–⅙ peak) + 4-matmul complex, forfeiting the advantage exactly where it's needed; the "int8/bf16 for cheap early edges" idea silently corrupts a global amplitude sum. **Refinement:** reposition as a reproducible, precision-audited XEB co-processor — **pin and publish the contraction-path optimizer** (cotengra/opt_einsum) so FLOPs are comparable, contract in fp32 real/imag by default (bf16×3 only where a probe-amplitude error bound certifies safety, and make the precision policy itself judge-verified), and publish the honest frontier as a **measured** (n,depth) where intermediates exceed VMEM/HBM.

**BondForge — VMEM-resident MPS/TEBD simulator. [STRONG]**
*One-line:* keep the matrix-product-state resident in VMEM and stream every χ×χ bond contraction through the MXU.
*Kill-shot / risk:* the **per-gate SVD/QR truncation** is intrinsic to TEBD and is the antithesis of a systolic workload (non-matmul, last-axis, iterative, un-Pallas-able); by Amdahl it caps the very MXU-utilization the idea is sold on (~30–50% at χ=128), and complex gates cost ~3–4 real matmuls. **Refinement:** stop gating on MXU-util% (hides the stall, rewards padding); gate on **useful-contraction-FLOP per joule to reach a fixed target fidelity**; amortize orthogonalization (truncate every k steps / fixed-χ TDVP, double-buffer the fp32 SVD on the VPU against the next MXU matmul); scope the harness to low-depth brickwork where χ stays small; report the fidelity-vs-utilization tradeoff *curve*.

**BoundaryMXU — randomized-SVD boundary-MPS PEPS contraction. [MOONSHOT]**
*Kill-shot / risk:* "**entire sweep is dense matmul**" is false — randomized truncation still needs a QR + a small SVD/eig to recover singular values, landing on the same VPU/last-axis/un-Pallas path it was invented to avoid; and the regime where that residual is negligible (small χ) is the regime where the problem *isn't* hard, self-cancelling the "strong bar on brutal problems" pitch. **Refinement:** use randomized subspace iteration with Cholesky-QR (Gᵀ=YᵀY is a matmul, only a tiny k×k eig remains); report **two** numbers (FLOP-in-matmul purity *and* achieved MXU util); publish the χ/L VMEM ceiling and scope the win to moderate entanglement; pin the RNG seed *and* report error over a seed ensemble.

**TorusVector — statevector sim mapping qubit bits to torus coordinates. [SPECULATIVE]**
*Kill-shot / risk:* the novel claim is **topologically false** — a partition-qubit gate pairs chip c with c XOR (1≪q), a *hypercube* edge that does not embed isometrically in a 3D torus, so at most ~3 partition qubits are truly nearest-neighbor; the rest are multi-hop, exactly the traffic it claims to eliminate. Also a k-qubit gate is a **butterfly (O(1) ops/byte, VPU-bound)**, not an MXU workload. **Refinement:** reframe as the honest-accounting tool it wants to be — VPU butterfly kernels, publish "fraction of gates 1-hop vs multi-hop under a given qubit→coordinate map + total ICI hop-bytes + the qubits-vs-pod-bytes crossover," keep the exact `interpret=True`/JAX correctness oracle. A true, refereeable "classical cost of exactness" curve.

**TT-Squeeze — tensor-train compression of weights/KV. [SPECULATIVE]**
*Kill-shot / risk:* transformer weights are **near-full-rank**, so TT ranks that hold perplexity erase most byte savings — and int4/int8 quantization already meets the same goal *more simply* (no reshape glue, no small-matmul MXU waste); KV-cache-in-TT is near-infeasible for streaming decode (per-step re-SVD). **Refinement:** weight-only, baseline against **int4** (not dense), require TT to beat/complement quantization per-layer (TT-on-the-quantization-residual, certify only empirically low-rank layers like tied embed/output); an honest "TT loses to int4 except on layers X,Y" is a publishable refereed result.

**VariBatch — batched shallow QAOA/VQE. [SPECULATIVE]**
*Kill-shot / risk:* the MXU is the **wrong engine** — the MaxCut cost layer is a diagonal VPU phase multiply and mixer gates contract over a size-2 axis, so batching fills the *free* dimension but leaves the contraction at 2-of-128 (~1.5% array fill); the "tall-skinny full-array matmul" premise is false and the TPU has no differentiated advantage. **Refinement:** either honestly reframe as a VPU/8×128-occupancy batched simulator (drop the systolic claim), or use **light-cone blocking** (fuse k≈7 qubits into dense [B, 2ᵏ]×[2ᵏ, 2ᵏ] block-unitaries) to genuinely fill the array; add *measured MXU util* to the gate; denominate the public metric in **evals/sec (deterministic)** with evals/joule as an instrumented, caveated secondary.

### Theme H — Post-CMOS substrate twins (moonshot)

**Crossbar Digital Twin — differentiable ReRAM/PCM in-memory GEMM twin. [MOONSHOT, labeled]**
*One-line:* run a faithful digital twin of an analog crossbar matmul (device noise, ADC quant, drift) on the TPU to certify what noise budget a substrate must hit to beat digital.
*Bet:* Part-V's post-CMOS lever made honest — a real, checkable *substrate-crossover* number today, clearly "measured-in-twin, hoped-on-hardware."
*Kill-shot / risk:* the MXU-friendly **elementwise weight-noise twin is the already-solved easy part**; the non-idealities that decide real silicon (per-K-tile ADC quantization — the MXU never exposes partial sums; IR-drop nonlinearity, which is a resistive solve not a GEMM; dominant ADC energy) fall off the MXU or get omitted, so a clean "certified accuracy" certifies an optimistic device. The energy crossover is a **vendor-spec calculator**, not a TPU measurement. **Refinement:** ship a tiered, explicitly-labeled noise spec — Tier 0 (weight noise + output quant, MXU-native, fully verifiable), Tier 1 (per-K-tile partial-sum quant via Pallas, still deterministic), Tier 2 (IR-drop flagged approximate-physics) — and expose the ADC-energy term as the dominant knob; report only "accuracy at Tier-k budget" as the portable number.

---

## 4. Recommended build-first trio

Three ideas that a TPU VM can build *now*, that the harness can verify, and that together stand up the whole referee loop: **two gates + one refereed kernel.**

**1. Oracle-Diff Gate (split notary).** *The enabling correctness gate.*
- **Milestone:** a Pallas kernel bundle (start with a plain tiled GEMM) that ships an `interpret=True` golden run; `verify_bundle` runs the fp32 *control notary* (bit-match grid/masking logic) and, for the reduced-precision path, a *numeric notary* against an **fp64 host reference** with a dtype-derived tolerance (bf16 ≈ 2⁻⁸ ulp) plus a distribution check.
- **Proves:** correctness is a hash-sealed, third-party-replayable artifact — the precondition for scoring *any* speed number. This is the single highest-leverage build because every other task depends on it.

**2. Roofline Notary (achieved-peak edition).** *The measurement backbone.*
- **Milestone:** a `roofline-attest` task that re-lowers the submitted kernel, pulls algorithmic FLOPs from `cost_analysis()`, reads `device_kind` from the harness (not the claimant), times median wall-clock over N runs, and emits `%-of-bf16-peak` + logical-vs-MXU-issued FLOPs (padding disclosed). HBM bytes read from the **XProf counters** (labeled "hardware traffic"), with the cost-model estimate shown separately and stamped as modeled.
- **Proves:** a reproducible, hard-to-game efficiency coordinate anchored on *physical time*, with the honesty split (measured vs compiler-modeled) built into the output.

**3. Twin-Rail Int4 (W4A8 decode kernel).** *The first real refereed architecture claim.*
- **Milestone:** a Pallas W4A8 decode kernel — int4 weights packed so low/high nibbles form separate MXU-aligned sub-tiles (elementwise unpack, no cross-lane shuffle), int8 activations, int32 accumulate, per-group scales in the accumulator. Verified bit-exact against the reconstructed int8 reference under `interpret=True` (Gate 1); graded on **measured decode tokens/s and realized HBM bytes/token (scales included)** vs a real Pallas int8 baseline (Gate 2), with a Precision-Ledger quality-delta estimate attached.
- **Proves:** the cleanest verifiable win in the whole set — a bit-exact integer oracle plus a genuine memory-bound decode speedup — exercising both gates end-to-end and producing the first entry on a TPU-efficiency leaderboard.

Rationale: this trio is self-reinforcing. #1 and #2 are the referee; #3 is the first thing refereed. All three are single-chip, need no pod slice, and every claim they make is either bit-exact or wall-clock-physical.

---

## 5. Harness / platform additions

These extend the existing 4-gate numpy judge and the `mint_run` / `verify_bundle` flow rather than replacing them. The through-line: **the judge recomputes, the claimant never self-reports.**

**New run-bundle format (the "cartridge").** A hermetic bundle pinning `jaxlib` + `libtpu` + `XLA_FLAGS` + `device_kind`/topology + RNG seed + **autotune cache** + input tensors, embedding the raw XProf trace and the `interpret=True` golden output hash. `verify_bundle` boots the cartridge on matching silicon, replays, and diffs. Honest caveat surfaced in the UI: cloud-gated TPUs make this *attested-reproduction on a platform notary pool*, not open third-party verification.

**New efficiency judge gates (compose with the existing 4):**
1. **Correctness (extends the existing golden-output gate):** `interpret=True` control-notary (fp32, near-exact) + numeric-notary (fp64 reference, dtype-derived tolerance) for reduced-precision paths. Tolerance is a *checkable function of the declared dtype*, never claimant-chosen.
2. **FLOP/roofline gate:** FLOPs from XLA `cost_analysis()` (compiler-computed from attacker input); `%-of-peak` = algorithmic-FLOPs ÷ measured-median-time; logical-vs-issued FLOPs reported to disclose 8×128/128×128 padding.
3. **HBM-byte gate:** bytes/token from **XProf HBM counters** as ground truth, with the static BlockSpec + cost-model derivations shown as *predictors validated against* the measurement (three-leg, not two-leg self-consistency).
4. **MXU-utilization gate — as a *diagnostic, not a headline*:** duty cycle is trivially gamed by busywork, so the leaderboard sorts on **useful-FLOP throughput** and the roofline classification (compute- vs bandwidth-bound vs the ~240 ops/byte ridge), with duty cycle shown only alongside.
5. **Energy-proxy gate (clearly aspirational):** where per-chip power is available, joules-per-token as an *instrumented, caveated* secondary; where it isn't (analog twins, substrate crossovers), an explicit "measured-in-twin / hoped-on-hardware" label and a vendor-spec calculator with the dominant term (e.g. ADC energy) exposed as a knob.

**New task types (each maps to a theme above):** `kernel-correctness-oracle`, `roofline-attest`, `bytes-per-token`, `cartridge-replay`, `precision-tradeoff`, plus the architecture tasks (`residency-*`, `chunked-recurrence`, `windowed-decode`, `moe-amortize`, `int4-rail`, `lowbit-bundle`) and the on-mission simulator tasks (`mps-evolve`, `xeb-certify`, `peps-contract`, `qaoa-batch`, `statevector-exact`) and the multi-host tier (`topology-moe`, `collective-claim`, `pod-dataflow-bundle`).

**Scoreboard:** each run gets a roofline coordinate + tier, rendered like the existing 5-axis quality grade, sorted by useful-FLOP throughput or bytes/token *within a problem class* (cross-class ranking is dishonest). Variance bands are platform-set from a calibration corpus, never claimant-set.

**Anti-gaming invariants baked in (each is a scar from a kill-shot above):** sort on *useful* FLOPs not duty cycle; measure HBM bytes from hardware counters not the cost model; derive precision tolerances from dtype not the claimant; count quant *scale bytes* in every byte tally; separate deterministic *hardware* claims from statistical *quality estimates*; and read `device_kind` from the harness to kill mis-declaration.

---

## 6. Honest limits & open questions

**The hardware constants in this doc are asserted, not re-pinned.** Every idea cites the same figures — 128 MiB VMEM at ~22× HBM bandwidth, a ~240 ops/byte roofline ridge, the 128×128 MXU, int8 at 2× — drawn from the stress-tested ideas and Google's "How to Scale Your Model." The authoritative TPU grounding was **unavailable** when this doc was written, and these constants are **generation-specific** (v5e/v5p/v6e differ materially). The first act on a real VM is to re-measure them; anything tuned to one chip is mis-tuned on another, and the roofline ridge itself moves with dtype.

**The single most-repeated correction is load-bearing and unresolved in the field, not just here.** Residency and shape-pinning do **not** cross the roofline knee; only batching/reuse raises batch-1 intensity. Half the architecture ideas mistarget the decode regime because of this, and their refined forms all pivot to *batching* or *prefill*. Whether the refined, honest versions still beat competent baselines (a well-tiled Mamba2 kernel, a batch-optimal MoE stack, an int8 W8A8 decoder) is **hoped, not measured** — that is exactly what the harness exists to settle.

**int4 as a native MXU datatype is unconfirmed on mainstream TPU generations.** Several precision ideas lean on a 4× int4 path; the documented native low-precision path is int8 (2×). Until verified on silicon, int4 claims must be flagged "software-emulated, no MXU multiple," and the defensible wins are int4 *weight-only* (memory) + int8 *compute*.

**Multi-host claims cannot be reproduced in a single-chip bundle.** Every interconnect idea (TorusWeave, Torus-MoE, Torus Systolic Layer) needs a real pod slice; `interpret=True` has no inter-chip collectives, so their correctness oracles are single-host (routing-permutation only) while the perf claim is privileged/optional. These stay explicitly **thought-experiment + small-slice-measured**.

**Quality gates never generalize from the judge's sample.** Every "at matched perplexity" claim is a point estimate over a chosen distribution; quantization/pruning/locality failures live precisely off-distribution. The platform must register the eval distribution, report n and CI, and grade on *disclosure with provenance*, not on clearing a threshold — and say so out loud.

**Some metrics are irreducibly non-deterministic.** Wall-clock, MXU duty cycle, and per-chip power vary with thermal state, co-tenants, and XLA autotuning. We mitigate with pinned toolchains, sealed autotune caches, and N-run statistics with variance bands — but reproduction is *statistical*, and a loose band can hide a weak claim. The honest framing is "reproduces within a platform-set band," never "identical."

**The two most on-mission ideas (XEB-Referee, BondForge) forfeit the TPU's headline advantage exactly where it matters.** Quantum amplitude work needs fp32/complex, and the MXU's edge is bf16 throughput; both must run bf16×3 emulation or fp32 real/imag pairs, so they are *precision-audited co-processors*, not throughput winners. Their honest deliverable is the **measured crossover** where VMEM/HBM runs out and a real QPU wins — a number we can certify, and one we must not dress up as classical supremacy.

**Open questions we can't yet answer without the VM:** Does the refined ResidentMoE crossover curve actually reach compute-bound at deployable batch? Does Twin-Rail's nibble-unpack stay elementwise under Mosaic, or does it become a cross-lane shuffle? Does `cost_analysis()` on the TPU backend return usable FLOP/byte numbers, or does it silently null out on VPU-heavy ops? Is SparseCore reachable from Pallas at all for custom dispatch, or only via the XLA embedding API? Each is a first-week experiment, and each could kill or confirm a whole theme.

---

*[†] One idea (Centtile MoE) failed hard on adversarial review (keep=false) and is retained only as a documented lesson — don't confuse the token/capacity axis with the weight axis. Its salvageable harness contribution is folded into Expert-Stationary MoE's refinement.*