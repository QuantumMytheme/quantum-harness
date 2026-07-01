# Platform vision — quantummytheme.com

> **Status: roadmap, not built.** Nothing in this document ships today. This repo
> (`QuantumMytheme/quantum-harness`) is the *engine* — the verifiable-run prompt harness and
> its deterministic judge. **quantummytheme.com** is the public platform that engine is
> designed to feed. The harness exists; the platform is the destination. Treat every section
> below as a target architecture, not a description of current behavior.

`quantummytheme.com` (domain owned by the org) is the planned home for a **"best of citizen
science"** web platform layered directly on top of this harness: a place where anyone can point
a highly-capable autonomous model at a hard quantum design problem, get a **machine-checkable
verdict**, and have that verdict — and the circuit behind it — become a public, re-runnable,
re-verifiable artifact that others can browse, learn from, and build on.

The thesis is simple: **correctness can be scored without human taste.** The judge already
delivers an objective ACCEPT/REJECT on a submitted circuit. A platform built on that judge can
host open contribution at scale, because the merge gate is a deterministic simulator, not an
editor's opinion.

---

## What the platform is

A public web platform with six capabilities, every one of them rooted in something the harness
already produces:

1. **Interactive quantum models.** Load any submission as a live circuit you can **run and
   visualize in the browser** — step through gates, watch the statevector evolve, inspect the
   claimed metric, and re-run the exact simulation the judge ran.
2. **A public directory of submissions.** Browse and search every accepted (and rejected)
   bundle by problem, qubit count, depth, score, and task type (`state_prep` / `vqe` /
   `populations` / `architecture` / `classify`).
3. **Transparent scoring.** The judge's ACCEPT/REJECT verdict and its four active gate results
   (structure, reproducibility, performance, anti-overfit) are surfaced publicly. Every claim
   is **re-verifiable** — anyone can recompute the number, because the simulator is hermetic
   and deterministic.
4. **Education.** Learn quantum computing *and* how a verifiable-run harness works, with a
   guided path to a first submission.
5. **"Run your own run."** Fork the template harness, point a **subscription** (a capable
   autonomous model) at a **brief**, and submit the resulting proof bundle.
6. **Open contribution with the judge as the merge gate.** No human taste required to score
   correctness — the judge decides what is correct, and CI enforces it.

---

## How the harness feeds the platform

Every platform capability is a *projection* of an artifact this repo already emits. The harness
is not a prototype to be replaced; it is the substrate the platform renders.

### Proof bundles → interactive submissions

A proof bundle (`quantum-harness/proof-bundle@1`) is self-contained: it carries the full
circuit (`circuit.ops`), the constraints it was solved under, the claimed metric, and the
classical baseline it beat. That is *exactly* the data an in-browser runner needs. The platform
loads a bundle, hands `circuit.ops` to a client-side port of `sim.py`, and renders the live
statevector. **The submission format and the visualization format are the same file** — no
lossy export step, no second source of truth.

### Judge verdicts → public scores

`judge_verify.py` already returns a structured verdict across four active gates, each able to
REJECT with its own exit code:

| Gate | Exit | What it proves |
|---|---|---|
| Structure | 3 | Respects `n_qubits`, `max_depth`, native gates, coupling map, 2-qubit cap |
| Reproducibility | 4 | The claimed number is real — re-simulated, fabrication caught |
| Performance | 5 | Meets threshold **and** beats/ties the classical baseline |
| Anti-overfit | 6 | Held-out generalization check — fires when the problem declares a held-out check |

The platform surfaces these directly as the public score. There is no separate scoring service
to trust and no model grading its own homework: the score *is* the judge's verdict, and because
the simulator is deterministic, any visitor can reproduce it locally and get the same answer.

### The template → "run your own run"

`templates/quantum-runner-skeleton.md` plus the BRIEF/RUBRIC/KICKOFF discipline is a
**forkable run harness**. The platform turns that into self-serve: fork the template, get a
brief, run an autonomous model against the rubric until the judge goes green, and submit. The
five domain-invariant parts (contract, friction removal, one-kickoff + self-correction,
verifiable bench, computed measurement) are what make this safe to hand to the public — the
contract is machine-checked, so a stranger's run is graded by the same gate as everyone else's.

### The judge as the merge gate

Open contribution is only tractable because **the merge gate is mechanical.** A new submission
is accepted into the directory iff the judge ACCEPTs it and the regression suite stays green
(`node --test`). No maintainer has to evaluate whether a circuit is "good" — the judge decides
correctness, the hidden reference decides honesty. This is the property that lets the directory
grow without a human bottleneck. (Contribution mechanics live in
[CONTRIBUTING.md](./CONTRIBUTING.md).)

### The education layer

Education is not a separate codebase — it is the harness made legible. The worked problems
(`ghz3` (`state_prep`), `isingbell2` (`vqe`), `bell_pops2` (the `populations` anti-overfit
demonstrator), `aiaccel4` (the `architecture` held-out-workload demonstrator), and `qml_sign1`
(the `classify` held-out-test demonstrator)) are already a curriculum: a learner can read the
BRIEF, see the reference solution, watch the simulator evolve the state, and understand *why* the
judge accepts it. The forged fixture (`quantum-proof-FORGED.json`, which claims fidelity 1.0 but
truly 0.25) is a ready-made lesson in why re-simulation matters, and the overfit fixtures
(`quantum-proof-OVERFIT.json`, a wrong-phase impostor that matches the visible populations but
fails the held-out `<X0X1>` parity; `quantum-proof-arch-OVERFIT.json`, a topology hand-tuned to
the visible workload that blows the held-out routing budget; and `quantum-proof-qml-OVERFIT.json`,
a high-frequency feature map that memorizes the training set but fails the held-out test) show why
a held-out check is needed. The platform wraps these in a guided first-submission flow.

But the education layer is bigger than the bench: it is a full, highly-animated arc — now
**39 slices in six parts** ([live](https://quantummytheme.com/education)). It climbs two ladders
in parallel — classical, from a single bit up to LLMs, state-space models, and the silicon that
runs them; and quantum, from a single qubit up to error correction and real hardware — lets you
experiment with qubit counts against the chips that exist today, **re-runs thirteen landmark
experiments** (Bell, teleportation, error correction, Deutsch–Jozsa / Bernstein–Vazirani / Simon,
Landauer, the RSA→Shor bridge, and more, each computing its headline number live), and ends at
**Part V, "the North Star"**: an honest, source-backed map of where machine intelligence actually
gets more efficient — and where quantum does and doesn't fit — built around the efficiency-frontier
explorer and five verify-it-yourself lessons, before the page hands the learner the loop: prove a
design in simulation with a classical model, then run it on real silicon. The whole curriculum —
and how a learner ends up pointing their own Claude subscription or API credits at a BRIEF — is
designed in [EDUCATION.md](./EDUCATION.md).

### The subscription model

"Run your own run" needs compute: a capable autonomous model (today Opus 4.8; built to be ready
for Fable 5 / "Mythos") pointed at a brief. A **subscription** provisions that capacity. The
harness side stays unchanged — the model still produces a proof bundle the judge grades — so the
subscription is purely the *fuel*, never part of the trust path. The judge does not care which
model (or which human) produced a bundle; it only re-simulates the circuit.

---

## Held-out references at platform scale

Today the public template **commits** its references (`references/<problem_id>.json`) so CI can
run end-to-end. A real contest **holds them out** via `QH_REFERENCES_DIR`, so the answer key —
the exact target state / Hamiltonian and the pass thresholds — never reaches the model. The
platform generalizes this: public practice problems ship their references for learning, while
live contest problems keep theirs server-side. What makes a held-out problem meaningful is now
literally enforced by the **anti-overfit gate** (`EXIT_OVERFIT` (6)): for problems whose
reference declares a `holdout` block (a held-out check the model was never told), the judge
re-derives that hidden check on the simulated state and REJECTS at exit 6 a circuit that matched
the visible spec but failed it. The held-out form depends on the task: a held-out **observable**
(state tasks — e.g. `bell_pops2` holds out ⟨X0X1⟩), a held-out **workload** (`architecture` — the
topology must also route a second interaction set within budget), or a held-out **test set**
(`classify` — the feature map must classify unseen data). The worked `bell_pops2` problem (task
`populations`) is the canonical demonstrator: the model is told to prepare the Bell state |Φ+⟩
(visible spec = Z-basis populations 50/50 between |00⟩ and |11⟩), the judge holds out the X-parity
⟨X0X1⟩ = +1, the genuine Bell state ACCEPTs (`quantum-proof-pops.json`), and a wrong-phase
impostor |Φ-⟩ that still matches the populations is REJECTED at exit 6
(`quantum-proof-OVERFIT.json`) — it passed structure/reproducibility/performance and failed
ONLY the held-out check. The worked `aiaccel4` (`architecture`) and `qml_sign1` (`classify`)
problems demonstrate the other two held-out forms: a ring topology ACCEPTs while a workload-tuned
topology is REJECTED at exit 6 (`quantum-proof-arch.json` vs `quantum-proof-arch-OVERFIT.json`),
and an `Ry(x)` feature map that generalizes ACCEPTs while an `Ry(7x)` map that memorizes the
training set is REJECTED at exit 6 (`quantum-proof-qml.json` vs `quantum-proof-qml-OVERFIT.json`). Underneath it all the judge reads ground truth **only** from the hidden
reference (`references/<id>.json`, relocatable via `QH_REFERENCES_DIR`), never from the bundle,
and the circuit IR cannot embed a target state — so a circuit must genuinely build the state from
gates and the judge re-derives every claimed number. A circuit tuned to the public brief that
simply parrots a number it placed in its own bundle is therefore caught at the reproducibility
(4) / performance (5) gates against a reference it never saw. For problems that do not declare a
holdout block (`ghz3`, `isingbell2`), anti-overfit additionally holds by construction (the target
lives only in the hidden reference and the IR cannot embed it), so exit 6 is simply not triggered
for them.

---

## Phased path

A deliberately incremental route from "this repo" to "live platform." Each phase is shippable on
its own and strictly additive — nothing earlier is thrown away.

### Phase 0 — the harness (today, done)

This repo. The deterministic judge, the hermetic numpy simulator, the proof-bundle schema, the
worked problems (`ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`, `qml_sign1`), the 38/38
regression suite, the autonomy scorecard, and the forkable template.
**The engine works on a laptop, in CI, or on a Raspberry Pi.** Everything below consumes its
output; nothing below changes its trust model.

### Phase 1 — static directory + judge in CI

A static, read-only site generated from a corpus of committed proof bundles. The judge runs in
CI on every contribution; the public page shows each bundle's verdict, its four active gate
results, and its metrics. Search and filter by problem, qubits, depth, score, task. No live execution yet
— scores are precomputed by the judge and published. This is the smallest thing that makes the
directory and transparent-scoring capabilities real, using only what Phase 0 already emits.

Concretely, this "directory" **is a scoreboard**: per problem and per paradigm (ansatz / qubit
topology / feature map, plus the classical baseline), the judge-ACCEPTED runs are ranked by their
verified metric, and every entry is re-verifiable — anyone can re-run the judge and reproduce the
ranking. The leading entry per problem is the current frontier, held honest by the same gates.
The format and current standings live in [SCOREBOARD.md](./SCOREBOARD.md).

### Phase 2 — interactive in-browser circuit runner

Port the statevector simulator to run client-side (WASM/JS), so the directory's "view" becomes
"run." Step through `circuit.ops`, visualize the statevector, recompute the claimed metric in
the browser, and confirm it matches the published verdict. The education layer lands here: the
worked problems and the forged fixture become interactive lessons, and a guided first-submission
flow walks newcomers through authoring a bundle. **Re-verifiability becomes hands-on** — a
visitor reproduces the judge's number themselves.

### Phase 3 — self-serve runs + subscriptions

The full "run your own run" loop. Fork the template from the platform, get (or author) a brief,
point a subscription's autonomous model at it, loop against the rubric until the judge is green,
and submit the proof bundle for open contribution — merged by the judge-as-gate. Subscriptions
provision the model capacity; live contests use held-out references via `QH_REFERENCES_DIR`.
This is where the platform becomes a self-sustaining citizen-science engine: briefs in, verified
quantum circuits out, all scored without human taste.

---

---

## Track 2 — refereeing efficiency on real classical silicon (TPU)

> **Status: roadmap, not built.** Nothing in this track ships today. The quantum
> harness in this repo is real and runs; this section describes a *second* referee track
> designed on top of the same judge machinery, and it does not exist yet. The design work is
> in [TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md); nothing below has touched a
> TPU. Treat every gate, task, and phase here as a target, not a description of current behavior.

Everything above is one track: the platform referees **quantum-circuit correctness** — a submitted
circuit either builds the claimed state or it doesn't, and the judge re-derives the number. That is
the *hardest verifiability case*, which is why it is the wedge. But the project's own
[curriculum](https://quantummytheme.com/education) (Part V, "the North Star") says plainly where the
real machine-intelligence efficiency gains live: **classical architectures on real silicon**, not a
quantum LLM accelerator. If that is the honest map, then the platform's job is not finished when it
can referee a *correctness* claim — it has to be able to referee an **efficiency** claim, on the
silicon where efficiency is actually won or lost. Track 2 is that extension.

The reframe is the whole point. A correctness verdict asks "is this circuit right?" An efficiency
verdict asks a strictly harder question — "is this kernel both *right* **and** *faster*, and can a
stranger reproduce the number?" — because a speed claim is worthless if the kernel quietly went
numerically wrong to get there. A TPU is the cleanest place to ask it: nearly all math flows through
one dominant 128×128 systolic MXU over one HBM bandwidth, so the roofline is unusually sharp and
"compute-bound vs bandwidth-bound," "what fraction of peak," and "how many HBM bytes per token" are
first-principles questions with hardware-anchored answers rather than vibes. And Pallas's
`interpret=True` supplies the missing half: the same kernel source that lowers to the MXU can be
replayed in a deterministic pure-JAX emulator sharing the exact tiling, giving a third-party-replayable
correctness oracle. **The TPU supplies the physics (roofline); Pallas supplies the notary.** That is
the same shape as Track 1 — a deterministic thing recomputes the claim — pointed at real classical
hardware instead of a statevector.

### The efficiency judge — extending the four gates

Track 1's judge is four gates, each able to REJECT with its own exit code (structure /
reproducibility / performance / anti-overfit). Track 2 does not replace that model; it *extends* it
with efficiency gates that obey the same discipline — **the judge recomputes, the claimant never
self-reports** — and the same exit-code contract, so a kernel bundle slots into the existing
`mint_run` / `verify_bundle` flow:

| Gate | Role | What it proves | Honesty rule |
|---|---|---|---|
| Correctness | **enabling** (extends the golden-output gate) | `interpret=True` *control notary* (fp32, near-exact grid/masking) **plus** a *numeric notary* for reduced-precision paths against an fp64 host reference | tolerance is a **checked function of the declared dtype** (bf16 ≈ 2⁻⁸ ulp), never claimant-chosen; must pass before any speed number is scored |
| FLOP / roofline | **scored** | `%-of-peak` = algorithmic-FLOPs ÷ measured-median wall-clock; roofline coordinate on the named generation | FLOPs come from XLA `cost_analysis()` of the lowered program (compiler-computed from attacker input); logical-vs-MXU-issued FLOPs reported to disclose 8×128 / 128×128 padding; `device_kind` read from the harness |
| HBM-byte | **scored** | bytes/token moved | ground truth is the **XProf hardware counters**; the static BlockSpec + cost-model derivations are shown only as *predictors validated against* the measurement (three legs, not two static views agreeing with themselves) |
| MXU-utilization | **diagnostic, not headline** | duty cycle | trivially gamed by padded/redundant busywork, so it is *shown, never sorted on* |
| Energy-proxy | **explicitly aspirational** | joules/token | instrumented-and-caveated where per-chip power exists; where it doesn't (analog twins), a labeled "measured-in-twin / hoped-on-hardware" vendor-spec calculator with the dominant term exposed, never a verified number |

The rule that makes this an *extension* and not a new trust path: correctness is the precondition,
speed is the payload. A kernel that fails the correctness notary is REJECTED before any efficiency
number is even computed — exactly as a fabricated quantum metric is caught at reproducibility before
performance is scored.

### New task types, the cartridge, and the anti-gaming invariants

A quantum submission is a proof bundle. A TPU submission is a **cartridge**: a hermetic run-bundle
that pins the toolchain (`jaxlib` + `libtpu` + `XLA_FLAGS` + `device_kind`/topology + RNG seed +
autotune cache + input tensors), embeds the raw XProf trace, and carries the `interpret=True` golden
output hash. `verify_bundle` boots the cartridge on matching silicon, replays, and diffs — the same
"self-contained, re-runnable artifact" property that makes a proof bundle a submission, now carrying a
pinned execution environment because wall-clock is physical and environment-dependent. New task types
name the claims a cartridge can make — `kernel-correctness-oracle`, `roofline-attest`,
`bytes-per-token`, `cartridge-replay`, `precision-tradeoff`, the architecture tasks (`int4-rail`,
`residency-*`, `chunked-recurrence`, `windowed-decode`, `moe-amortize`), the on-mission classical
simulators (`mps-evolve`, `xeb-certify`, `qaoa-batch`, `statevector-exact`), and a later multi-host
tier (`topology-moe`, `collective-claim`, `pod-dataflow-bundle`).

The scoreboard generalizes too. Where Track 1 ranks judge-ACCEPTED runs by a verified metric per
problem, Track 2 stamps each run with a **roofline coordinate** (achieved %-of-peak vs arithmetic
intensity, against the ~240 ops/byte ridge on the named generation) and ranks *within a problem
class* — cross-class ranking is dishonest. Variance bands are platform-set from a calibration corpus,
never claimant-set.

And because every entry above was a scar earned in adversarial review, a set of **anti-gaming
invariants** is baked into the judge, not left to reviewer taste:

- **Sort on *useful* FLOPs, not duty cycle.** A kernel can pin the MXU at 90% doing padded busywork; the leaderboard denominates in declared-problem-FLOPs ÷ measured time, so padding counts *against* you.
- **Measure HBM from hardware counters, not the cost model.** `cost_analysis()` "bytes accessed" is a static estimate that ignores fusion and VMEM reuse — the bandwidth-bound classification can be wrong by several× while advertising itself as measured. XProf counters are the ground truth; the cost model is labeled "modeled."
- **Derive precision tolerance from dtype, not from the claimant.** A claimant-chosen scalar is exactly where a numerically-degraded fast path hides.
- **Count quant *scale* bytes in every tally.** A W4A8 "half the bytes" claim that omits per-group scales is a rigged ledger.
- **Read `device_kind` from the harness.** Kills the mis-declaration attack (claiming a slower chip to inflate %-of-peak) for free.
- **Separate deterministic *hardware* claims from statistical *quality estimates*.** An int8 MXU multiple on a fixed shape is a hardware fact; a perplexity delta is a point estimate over a registered distribution with reported n and CI — graded on disclosure-with-provenance, not on clearing a threshold.

### Phased path (Track 2)

Same discipline as Track 1's Phase 0→3: each phase shippable on its own, strictly additive, anchored
on the **build-first trio** — two gates, then the first refereed kernel — every claim either bit-exact
or wall-clock-physical, all single-chip until the last step.

#### Phase T0 — Oracle-Diff Gate (the enabling correctness notary)

A Pallas kernel bundle (start with a plain tiled GEMM) that ships an `interpret=True` golden run.
`verify_bundle` runs the fp32 control notary (bit-match grid/index-map/masking logic) and, for the
reduced-precision path, the numeric notary against an fp64 host reference with a dtype-derived
tolerance plus a distribution check. This is the highest-leverage build because *every* efficiency
number below is unscorable until correctness is a hash-sealed, replayable artifact. Nothing here
crosses the roofline knee or touches performance — it just makes "right" a compiler-tied fact instead
of a claimant's word.

#### Phase T1 — Roofline Notary (the measurement backbone)

A `roofline-attest` task that re-lowers the submitted kernel, pulls algorithmic FLOPs from
`cost_analysis()`, reads `device_kind` from the harness, times median wall-clock over N runs, and
emits `%-of-bf16-peak` + arithmetic intensity + logical-vs-issued FLOPs (padding disclosed). HBM
bytes come from the XProf counters and are labeled "hardware traffic," with the cost-model estimate
shown separately and stamped as modeled. This is the honesty split — measured vs compiler-modeled —
built into the output, and it makes the transparent-scoring capability real for efficiency, using only
what a single TPU VM emits.

#### Phase T2 — Twin-Rail Int4 (the first refereed kernel)

A Pallas W4A8 decode kernel: int4 weights packed so low/high nibbles land as separate MXU-aligned
sub-tiles (elementwise unpack, no cross-lane shuffle), int8 activations, int32 accumulate, per-group
scales in the accumulator. Verified bit-exact against the reconstructed int8 reference under
`interpret=True` (Phase T0), then graded on **measured decode tokens/s and realized HBM bytes/token —
scales included** — against a real Pallas int8 baseline (Phase T1), with a Precision-Ledger quality
estimate attached. In memory-bound decode the halved HBM traffic is the whole win and the unpack hides
under DMA; because integer accumulation is deterministic it gives the strongest verifiability in the
whole set. This is the first entry on a TPU-efficiency leaderboard — the moment the referee has
actually refereed something on classical silicon.

#### Phase T3 — multi-host / pod-scale (later, honestly caveated)

Interconnect-native claims (locality-routed MoE, ICI-as-dataflow, one-hop model parallelism) that need
a real pod slice. `interpret=True` has no inter-chip collectives, so their correctness oracles are
single-host (routing-permutation only) while the perf claim is a small-slice measurement with profiler
ICI counters. These stay explicitly **thought-experiment + small-slice-measured** until a pod is in
hand, and are strictly additive on top of the single-chip referee below them.

### The honest boundary

The line held throughout the design doc, and the reason this whole track is marked roadmap-not-built,
is that **measured-in-harness and hoped-on-hardware are different words and we never blur them.**
Specifically:

- **The TPU constants are asserted, not re-pinned.** VMEM size and bandwidth, the ~240 ops/byte ridge, int8 at 2× — all generation-specific (v5e/v5p/v6e differ materially) and unverified until a real VM re-measures them. Anything tuned to one chip is mis-tuned on another.
- **Native int4 on the MXU is unconfirmed.** The documented low-precision path is int8 (2×); until proven on silicon, int4 claims are flagged "software-emulated, no MXU multiple," and the defensible win is int4 *weight-only* (memory) + int8 *compute* — which is exactly what Twin-Rail commits to.
- **Multi-host needs a pod slice.** No single-chip cartridge can reproduce a collective; Phase T3 is thought-experiment until the hardware exists.
- **This is not open third-party verification.** Cloud-gated silicon means a stranger cannot spin up the exact chip on a whim, so the honest framing is **attested reproduction on a notary pool** — reproduces within a platform-set band on matching silicon — not "anyone, anywhere, reproduces bit-for-bit on a laptop" the way a quantum bundle does. That is a real weakening of the trust model relative to Track 1, and the platform must say so in the UI rather than dress an efficiency verdict up as something it isn't.

This is the concrete first step of the [long game](#the-long-game) below: the same gate that re-derives
a quantum number, pointed at the efficiency claims — quantization, sparse MoE, resident-state
recurrence — that actually decide whether machine intelligence gets cheaper. Quantum correctness is the
hardest verifiability case and the wedge; TPU efficiency is the first place the referee earns its keep
on the silicon that runs today's models.

## The long game

The near-term deliverable is a machine-checkable verdict you can reproduce on a laptop. The
platform is how that verdict becomes a public good — a growing, searchable, re-runnable corpus of
verified quantum designs, contributed openly and gated mechanically. The far horizon is to
generalize the *discipline*, not the substrate: a **verifiable-efficiency referee** for machine
intelligence — one third-party-recheckable yardstick for the question the project exists to
answer, *how do we make machine intelligence useful and far more efficient than the classical
computers running today's LLMs?* Quantum design is the wedge because it is the **hardest
verifiability case**, the field most prone to unfalsifiable speedup claims; the same gate that
re-derives a quantum number is how we would hold every efficiency claim — quantization, sparse
MoE, analog in-memory, neuromorphic, photonic — to a number a stranger can reproduce.

> **An honest correction to an earlier framing.** Prior drafts named the far horizon as "native
> quantum-processing architectures for AI inference." The project's own [curriculum](https://quantummytheme.com/education)
> (Part V, "the North Star") now states the verified position plainly, and this document follows
> it: a quantum computer will **not** make today's LLMs faster, cheaper, or greener — the
> data-loading wall, dequantization, and barren plateaus all close that door. Quantum's genuine
> role is narrower and further off (simulating strongly-correlated **materials** to build better
> *classical* chips, a decade-plus out on fault-tolerant hardware). Near-term efficiency comes
> from classical architectures and real-but-narrow post-CMOS substrates, bounded by the memory
> wall and the Landauer floor. The platform's value is the *referee*, not a bet that quantum
> accelerates AI.

> Reminder: this is a forward-looking roadmap. The harness in this repo is real and runs today;
> `quantummytheme.com` is the destination it is designed to feed.
