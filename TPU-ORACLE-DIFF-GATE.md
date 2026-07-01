# TPU Oracle-Diff Gate — `interpret=True` as a correctness notary

*Implementation-ready spec for a new verifiable task type in the quantum-harness. Build-first item #1 of the TPU-native referee trio (see [TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md) §4).*

> **Status: roadmap, not built.** This document specifies a task type the harness does **not** ship today. The existing engine (`bench/quantum-judge/judge_verify.py`, the five committed task types, the `mint_run`/`verify_bundle` MCP flow) is real and runs on a laptop. The `kernel-correctness-oracle` task described here **extends** that engine; the parts that can be graded by the offline numpy/JS judge are marked **HERMETIC-NOW**, and the parts that require a TPU VM are marked **NEEDS-A-TPU** and are explicitly *hoped-on-hardware, not measured-in-harness*. Nothing below changes the trust model of the existing four gates; it reuses them.

> **Build update (2026-06-30): the HERMETIC-NOW half is implemented** in [`bench/kernel-judge/`](./bench/kernel-judge/) — a self-contained, offline, numpy-only, exit-code judge (`judge_kernel.py`) that runs STRUCTURE (exit 3) / REPRODUCIBILITY (exit 4, incl. sealed-hash integrity + dtype-derived tolerance + distribution + bit-exact integers) / ANTI-OVERFIT (exit 6), with the K1–K12 forgery fixtures and a green regression suite (`test_kernel.py`, 16/16). It is built as a **parallel module** in the image of `bench/quantum-judge/` (so the 38/38 quantum suite is untouched); folding it into `judge_verify.py`'s `TASKS` dispatch and the `verify_bundle` MCP route (§6) is a follow-up. The **NEEDS-A-TPU** legs — producing `hardware.output` on real silicon, the fp32 `interpret=True` diff, and the roofline/bytes-per-token speed gates it enables — remain roadmap, not built.

---

## 1. What the gate is, and why `interpret=True` is a legitimate notary

Every efficiency benchmark has the same original sin: a speed number is meaningless unless the kernel is still **right**, and "right" is almost always the claimant's word. The Oracle-Diff Gate removes that word from the trust path.

A Pallas kernel has a property no hand-written CUDA kernel has: the *same source* that lowers to the TPU's 128×128 MXU can be run under `interpret=True` — a deterministic, CPU-pure JAX emulator that shares the kernel's `BlockSpec`/grid tiling and index maps. That emulated run is a **compiler-tied artifact**, not an assertion. It is reproducible by a third party, it can be hash-sealed, and it depends on the *identical* program structure the hardware runs. That makes it a legitimate correctness **notary**: a reference the claimant cannot forge without also changing the kernel that produced the speed number.

So the gate's job is narrow and load-bearing: **it is an *enabling* pass/fail predicate.** It produces no speed number of its own. It answers exactly one question — *does the hardware kernel still compute the right thing?* — and it must return ACCEPT before the roofline task ([TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md) §4 #2) is permitted to score any FLOP/s or bytes/token. A fast kernel that is wrong scores nothing, because it never clears this gate. This is the precondition every other TPU task depends on, which is why it is build-first #1.

The harness already has the exact machinery for this. `judge_verify.py` re-derives ground truth on a hermetic simulator and returns an exit code (`0` accept, `2` schema, `3` structure, `4` reproducibility, `5` performance, `6` anti-overfit); the hidden reference lives host-side in `references/<problem_id>.json`; the claimant's `claim` block is "decorative until the judge recomputes it." The Oracle-Diff Gate is that same discipline pointed at silicon: **the judge recomputes, the claimant never self-reports.**

---

## 2. The `kernel-correctness-oracle` proof-bundle variant

The bundle keeps the `proof-bundle@1` schema string and the familiar top-level fields (`schema`, `problem_id`, `task`, `constraints`, `claim`, `classical_baseline`, `meta`), matching every other task type. It adds four task-specific blocks:

- **`kernel`** — kernel identity, source hash, declared dtype/accumulator, and the grid/BlockSpec structure the notaries verify.
- **`oracle`** — the `interpret=True` **control** golden output (fp32, or its hash) and the **numeric** fp64 host reference (or its hash). This is the hash-sealed notary.
- **`hardware`** — the output the real MXU lowering produced on a named TPU generation, sealed by hash. This is the one field that **NEEDS-A-TPU** to produce.
- **`toolchain`** — the pins (`jaxlib`, `libtpu`, `XLA_FLAGS`, `device_kind`) hashed into the bundle so the run is replayable and mis-declaration is caught.

### (a) JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "quantum-harness/proof-bundle@1#kernel-correctness-oracle",
  "title": "Oracle-Diff Gate proof bundle (kernel-correctness-oracle task)",
  "type": "object",
  "required": ["schema", "task", "problem_id", "kernel", "oracle", "hardware", "toolchain", "claim"],
  "additionalProperties": true,
  "properties": {
    "schema":     { "const": "quantum-harness/proof-bundle@1" },
    "task":       { "const": "kernel-correctness-oracle" },
    "problem_id": { "type": "string", "description": "hidden reference key, e.g. \"gemm-bf16-tile1\"" },

    "constraints": {
      "type": "object",
      "description": "declared budgets the STRUCTURE/control notary checks",
      "properties": {
        "shape":        { "type": "array", "items": { "type": "integer" }, "description": "[M, N, K] logical problem shape" },
        "tile":         { "type": "array", "items": { "type": "integer" }, "description": "MXU-aligned block shape, each dim ≡ 0 mod (8,128)" },
        "declared_dtype": { "enum": ["bf16", "fp16", "fp8_e4m3", "fp8_e5m2", "int8", "int4", "fp32"] },
        "accum_dtype":  { "enum": ["fp32", "int32"] }
      },
      "required": ["shape", "declared_dtype", "accum_dtype"]
    },

    "kernel": {
      "type": "object",
      "required": ["name", "source_sha256", "grid", "block_spec"],
      "properties": {
        "name":          { "type": "string" },
        "source_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$",
                           "description": "sha256 of the exact Pallas kernel source that lowered BOTH to interpret=True and to the MXU" },
        "grid":          { "type": "array", "items": { "type": "integer" } },
        "block_spec":    { "type": "object", "description": "index_map + block shape per operand; verified by the control notary" }
      }
    },

    "oracle": {
      "type": "object",
      "description": "the hash-sealed correctness notary — split into control (fp32) and numeric (fp64) legs",
      "required": ["control", "numeric"],
      "properties": {
        "control": {
          "type": "object",
          "description": "interpret=True fp32 golden — verifies grid/index_map/masking LOGIC near-exactly",
          "required": ["output_sha256", "runner"],
          "properties": {
            "output_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "output_npy_b64":{ "type": "string", "description": "optional: the raw fp32 array so an offline judge can recompute the diff" },
            "runner":        { "const": "pallas.interpret=True" }
          }
        },
        "numeric": {
          "type": "object",
          "description": "HIGHER-PRECISION fp64 host reference — gates the reduced-precision kernel",
          "required": ["reference_sha256", "runner"],
          "properties": {
            "reference_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "reference_npy_b64":{ "type": "string", "description": "optional: raw fp64 array for offline diff recompute" },
            "runner":           { "const": "numpy.float64" },
            "reduction_len":    { "type": "integer", "description": "K — accumulation length, feeds the tolerance derivation" }
          }
        }
      }
    },

    "hardware": {
      "type": "object",
      "description": "NEEDS-A-TPU: the actual MXU lowering's output on named silicon",
      "required": ["device_kind", "output_sha256"],
      "properties": {
        "device_kind":  { "type": "string", "description": "read from the harness at runtime, e.g. \"TPU v5e\" — NOT self-declared" },
        "output_sha256":{ "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "output_npy_b64":{ "type": "string", "description": "the raw reduced-precision hardware output array" }
      }
    },

    "toolchain": {
      "type": "object",
      "description": "hermetic pins hashed into the bundle so replay is deterministic and mis-declaration is caught",
      "required": ["jaxlib", "libtpu", "xla_flags_sha256"],
      "properties": {
        "jaxlib":          { "type": "string" },
        "libtpu":          { "type": "string" },
        "xla_flags_sha256":{ "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "autotune_cache_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
      }
    },

    "claim": {
      "type": "object",
      "description": "DECORATIVE — the judge derives tolerance and recomputes deviation itself; a claimant tolerance that disagrees with the derived one is rejected at exit 4",
      "properties": {
        "max_abs_deviation":   { "type": "number", "description": "claimant's stated max |hw − fp64|; judge recomputes and ignores this if it disagrees" },
        "declared_tolerance":  { "type": "number", "description": "OPTIONAL and cross-checked: MUST equal the dtype-derived tolerance or the bundle is rejected" }
      }
    },

    "classical_baseline": {
      "type": "object",
      "description": "e.g. the reconstructed higher-precision reference this reduced path is claimed to match; carried for the downstream roofline task, not scored here"
    },

    "meta": {
      "type": "object",
      "description": "free-form provenance (model, run repo, timestamps) — never part of the trust path"
    }
  }
}
```

### (b) Concrete filled-in example

A plain tiled bf16 GEMM (`A@B`, fp32 accumulate) — the recommended starter kernel from [TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md) §4 #1. Hashes are illustrative.

```json
{
  "schema": "quantum-harness/proof-bundle@1",
  "task": "kernel-correctness-oracle",
  "problem_id": "gemm-bf16-tile1",
  "_comment": "Tiled bf16 GEMM, fp32 accumulate, one (8,128)-aligned block. The interpret=True fp32 run pins the tiling/masking logic exactly; the fp64 host reference gates the bf16 MXU output within a dtype-derived tolerance.",
  "constraints": {
    "shape": [512, 512, 512],
    "tile": [256, 128, 128],
    "declared_dtype": "bf16",
    "accum_dtype": "fp32"
  },
  "kernel": {
    "name": "tiled_gemm_bf16",
    "source_sha256": "9f2c1e7ab4d0c6e5f83b1290aa77e4d3c1b0f6a29e5d84c73b1a0f2e6d5c4b3a",
    "grid": [2, 4],
    "block_spec": {
      "a": { "block": [256, 128], "index_map": "(i, j) -> (i, k)" },
      "b": { "block": [128, 128], "index_map": "(i, j) -> (k, j)" },
      "out": { "block": [256, 128], "index_map": "(i, j) -> (i, j)" }
    }
  },
  "oracle": {
    "control": {
      "runner": "pallas.interpret=True",
      "output_sha256": "3ab7c9d1e05f24681bda3c7e9f01a2b3c4d5e6f708192a3b4c5d6e7f80912a3b"
    },
    "numeric": {
      "runner": "numpy.float64",
      "reduction_len": 512,
      "reference_sha256": "c1d2e3f405162738495a6b7c8d9e0f1122334455667788990aabbccddeeff001"
    }
  },
  "hardware": {
    "device_kind": "TPU v5e",
    "output_sha256": "77aa55cc33bb1199ee2244dd66ff8800112233445566778899aabbccddeeff00"
  },
  "toolchain": {
    "jaxlib": "0.4.35",
    "libtpu": "libtpu-nightly-2026.06.20",
    "xla_flags_sha256": "5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a392817060",
    "autotune_cache_sha256": "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"
  },
  "claim": {
    "max_abs_deviation": 0.0117,
    "declared_tolerance": 0.0156
  },
  "classical_baseline": {
    "reference": "fp64 host GEMM (the numeric-notary reference this reduced path must match within the bf16 bound)"
  },
  "meta": {
    "model": "opus-4.8",
    "run": "run-gemm-bf16-tile1-2026-06-30"
  }
}
```

---

## 3. The SPLIT-NOTARY design (what survived adversarial review)

A naive Oracle-Diff Gate dies to one kill-shot, and the split is the scar.

**The kill-shot.** `interpret=True` runs in pure CPU JAX; it does **not** model the MXU's bf16/int8 rounding, its systolic accumulation order, or its fp32 partial-sum behavior. So a real reduced-precision MXU kernel can **never bit-match** the `interpret=True` output. A single-notary gate therefore has no choice but to collapse to "match within *some* tolerance" — and if the claimant picks that tolerance, the whole gate is theater: a numerically **degraded fast path** (aggressive rounding, a dropped correction term, a quality-losing shortcut) hides comfortably inside a tolerance chosen to admit it. A green gate would certify a wrong kernel.

The refinement, adopted, is **two separately-typed notaries** that never share a tolerance:

### (a) Control / tiling notary — fp32, near-exact → **exit 3 (structure)**

Run the kernel under `interpret=True` in **fp32** and diff it against an fp32 reference of the *same* tiling. Because both sides are fp32 and share the grid, this leg tests **only the control logic** — the `grid`, the `index_map`s, the masking/padding, the block boundaries — and it should match to within floating-point identity (≤ 1 ulp fp32, effectively bit-for-bit for integer index arithmetic). A mismatch here is not a rounding question; it means the kernel's *structure* is wrong (a mis-indexed block, an off-by-one mask, a padding leak). That is a **structural** defect, so it maps to **exit 3** — the same gate that today rejects a circuit whose shape violates its declared constraints. The control notary carries **no dtype tolerance at all**; near-exact is the bar.

### (b) Numeric notary — fp64 reference, dtype-derived tolerance → **exit 4 (reproducibility)**

Gate the *reduced-precision* hardware output against a **higher-precision fp64 host reference** (numpy `float64`), **not** against `interpret=True`. Using fp64 as the reference means the reduced-precision kernel is measured against something *more* accurate than either the emulator or the hardware, so the only thing the tolerance has to absorb is the genuine, bounded rounding error of the declared datatype — never the emulator's own imprecision.

The tolerance is a **checked function of the declared dtype and the reduction length K**, computed by the judge and never read from the claimant:

```
ulp(dtype)      # unit-in-last-place from the dtype's mantissa bits:
  bf16      ≈ 2^-8    (7 mantissa + implicit)
  fp16      ≈ 2^-11
  fp8_e4m3  ≈ 2^-3
  fp8_e5m2  ≈ 2^-2
  int8/int4 = 0        (integer accumulation is EXACT → require bit-match, not tolerance)

rtol = C · ulp(dtype) · g(K)     # g(K) bounds fp32-accumulate growth over K terms
atol = ulp(dtype) · max|reference|
```

`C` and `g(K)` (a documented `√K`-order accumulation-growth factor) are **platform constants**, fixed in the judge and pinned per dtype — the analog of the hidden thresholds in `references/<id>.json`. The claimant's `claim.declared_tolerance`, if present, is **cross-checked against the derived value and rejected on disagreement** (exit 4): you may not choose your own tolerance, and stating a looser one is treated exactly like fabricating a fidelity.

The numeric notary also runs a **distribution check**, not just a max-abs bound. A degraded fast path rarely shows up as one big outlier under a loose max; it shows up as a *biased* or *heavy-tailed* error cloud. So the judge additionally requires:
- the fraction of elements within `rtol` ≥ a fixed floor (e.g. 99.9%),
- the mean signed error ≈ 0 (no systematic bias — a dropped correction term biases every output),
- the 99.9th-percentile `|error|/ulp` within a fixed multiple.

Because integer paths (`int8`/`int4`) accumulate exactly, they get **no** numeric tolerance at all — they are held to a **bit-exact** match against the reconstructed integer reference, the strongest verifiability in the set (this is what makes Twin-Rail Int4, §4 #3 of the trio, cleanly refereeable).

The kill-shot this defends against, stated plainly: *the emulator can't model MXU rounding, so bit-match is impossible, so a single tolerance is unavoidable — and a claimant-chosen tolerance is exactly where a numerically-degraded fast path hides.* The split fixes the tolerance to the physics of the datatype and moves the near-exact check onto the fp32 control leg where bit-match **is** achievable.

---

## 4. Exit-code mapping and gate composition

The task reuses the existing judge's exit codes verbatim — a fresh verifier reads the same legend it already knows.

| Exit | Gate | What the Oracle-Diff Gate binds it to |
|------|------|----------------------------------------|
| `0` | ACCEPT | control notary near-exact **and** numeric notary within the dtype-derived tolerance + distribution bounds, all seals intact |
| `2` | schema | missing `kernel`/`oracle`/`hardware`/`toolchain`, unknown `declared_dtype`, malformed hashes |
| `3` | **STRUCTURE** | **control notary** (fp32): the `grid`/`index_map`/masking logic diverges from the `interpret=True` fp32 golden by more than fp32 identity — the tiling structure is wrong |
| `4` | **REPRODUCIBILITY** | **numeric notary**: hardware output vs fp64 reference exceeds the **dtype-derived** tolerance or fails the distribution check; **or** a sealed hash (`oracle.*`, `hardware.output`) does not match the supplied array; **or** `claim.declared_tolerance` disagrees with the judge-derived tolerance (attempted overclaim) |
| `5` | performance | **not raised by this gate** — the Oracle-Diff Gate scores no speed; see composition below |
| `6` | ANTI-OVERFIT | numeric notary re-run on the **held-out input distribution** from the hidden reference exceeds the tolerance/distribution bound — the kernel is accurate on the claimant's chosen inputs but degrades off-distribution |

**This gate EXTENDS the exit-4 reproducibility gate to silicon.** Today exit 4 means "re-simulating the circuit reproduces the claimed number." Here it means "re-deriving the fp64 reference and diffing the *hardware* output reproduces correctness within the datatype's own bound." Same contract — *the model cannot fabricate a number; the judge recomputes it* — now spanning the compiler and the chip.

**Composition (why it is *enabling*).** The Oracle-Diff Gate is a **predicate, not a score**. The `roofline-attest` task ([TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md) §4 #2, §5 gate 2) must call this gate first and **refuse to emit any `%-of-peak` or bytes/token unless it returns exit 0**. A fast-but-wrong kernel exits 3, 4, or 6 here and is never scored for speed — so a speed claim is *void unless the kernel is still right*. This is the single highest-leverage build in the trio because every other TPU task depends on it clearing first.

---

## 5. HERMETIC-NOW vs NEEDS-A-TPU

The repo's ethos is a hard line between *measured-in-harness* and *hoped-on-hardware*. The Oracle-Diff Gate honors it by splitting the work at exactly that line.

### HERMETIC-NOW — verifiable today by the offline numpy / WASM-JS judge

Given a bundle that already carries the arrays (or hashes + arrays), the existing hermetic judge — numpy only, no JAX, no TPU — can verify **all of the following on a laptop or in the browser at `quantummytheme.com/lab`**:

1. **Schema & pin completeness** — the bundle is well-formed; `declared_dtype` is known; `toolchain` pins and their hashes are present.
2. **Golden-output hash integrity** — recompute `sha256` of each supplied array (`oracle.control`, `oracle.numeric`, `hardware.output`) and confirm it matches the sealed hash. A swapped array after sealing is caught here.
3. **Tolerance-is-dtype-derived** — recompute `rtol`/`atol` from `declared_dtype` + `reduction_len` via the fixed table and confirm any `claim.declared_tolerance` equals it. A claimant-chosen scalar is rejected (exit 4) **without ever running on hardware**.
4. **Deviation recompute (numeric notary)** — given the supplied `hardware.output` and the fp64 reference, recompute the max-abs deviation *and* the full distribution check, and compare against the derived tolerance. **The claimant never self-reports the deviation** — the judge computes it from the arrays.
5. **Control-notary diff** — given the supplied fp32 `interpret=True` golden and the fp32 control reference, recompute the near-exact match. (Producing the fp32 golden needs JAX-on-CPU; *diffing* two supplied fp32 arrays is pure numpy.)
6. **fp64 reference recompute (preferred posture)** — if the kernel's mathematical contract is declared (e.g. "tiled GEMM `A@B` of these shapes"), the judge **derives the fp64 reference itself** from the inputs, exactly as `references/<id>.json` holds ground truth host-side — so the reference is judge-computed, not claimant-supplied. This is the strongest anti-gaming posture and the default for problems whose contract is a standard primitive.

### NEEDS-A-TPU — cannot be produced offline; sealed and replayed on a notary pool

1. **Producing `hardware.output`** — the *actual MXU lowering* run on named silicon. This is a physical measurement; the offline judge can verify its *integrity and correctness-vs-reference* but cannot **generate** it. It is **measured-on-silicon, sealed into the bundle**, and honestly labeled as such.
2. **`device_kind` at runtime** — read from the harness on the TPU VM (kills the mis-declaration attack for free), not trusted from the claimant.
3. **Cartridge replay** — booting the pinned `jaxlib`+`libtpu`+`XLA_FLAGS`+autotune cache on matching silicon to *re-produce* `hardware.output` and confirm it reproduces the sealed hash within a platform-set band. Because TPUs are cloud-gated, this is **attested-reproduction on a platform notary pool, not open third-party verification** — the same honest caveat [TPU-NATIVE-ARCHITECTURES.md](./TPU-NATIVE-ARCHITECTURES.md) §5 surfaces for the cartridge format.

**The honest framing, held throughout:** the offline judge proves *the hardware output that was sealed is correct to the datatype's own bound, the tolerance was not chosen by the claimant, and no array was swapped after sealing*. It does **not** prove the number was produced on real silicon — that leg is measured-on-silicon and re-attested on the notary pool. A bundle that supplies arrays a laptop can check today is HERMETIC-NOW for correctness; the "this really ran on a v5e" claim is NEEDS-A-TPU and **roadmap, not built**.

---

## 6. `mcp/server.mjs` — `verify_bundle` extension interface

No new tool and no change to the transport. `verify_bundle` already shells the project's own `judge_verify.py` and returns `{verdict, exit_code, failed_gate, checks, reason}`; the `GATE` map already spells `0/2/3/4/5/6`. Routing a kernel bundle is purely additive:

- **Judge side (`bench/quantum-judge/judge_verify.py`).** Add one entry to the `TASKS` dispatch:
  ```python
  TASKS = {
      "state_prep": verify_state_prep,
      "vqe": verify_vqe,
      "populations": verify_populations,
      "architecture": verify_architecture,
      "classify": verify_classify,
      "kernel-correctness-oracle": verify_kernel_oracle,   # NEW
  }
  ```
  `verify_kernel_oracle(bundle, ref, checks)` runs, in order: schema/pin checks (`raise Reject(EXIT_SCHEMA, …)`); the fp32 **control notary** (`raise Reject(EXIT_STRUCTURE, …)` on divergence, filling `checks["structure"]`); hash-seal integrity + the fp64 **numeric notary** with the dtype-derived tolerance and distribution check (`raise Reject(EXIT_REPRODUCIBILITY, …)`, filling `checks["reproduced"]`); and, when the reference declares a held-out input distribution, the **anti-overfit** re-run (`raise Reject(EXIT_OVERFIT, …)`, filling `checks["anti_overfit"]`). It never raises `EXIT_PERFORMANCE` — this gate scores no speed. Ground truth (fp64 reference / held-out inputs / platform tolerance constants) lives host-side in `references/<problem_id>.json`, relocatable via `QH_REFERENCES_DIR`, exactly like every other task.

- **MCP side (`mcp/server.mjs`).** No code change is required to route the verdict — `verify_bundle` shells the judge and reflects whatever exit code it returns through the existing `GATE` map into `{verdict, exit_code, failed_gate, checks, reason}`. The only enrichment is one `LABELS` entry so `list_problems` reads well:
  ```js
  gemm_bf16_tile1: { task: 'kernel-correctness-oracle',
    label: 'Tiled bf16 GEMM — MXU output vs fp64 reference within the bf16-derived tolerance (Oracle-Diff Gate)' },
  ```

The framing carries over unchanged and is the whole point: **this exit code — not any claim in chat — is the result.** `verify_bundle`'s note on ACCEPT ("This exit-0 re-derivation IS the proof") and `commit_run`'s refusal to commit a REJECT apply to kernel bundles verbatim. A model that *says* its kernel is correct proves nothing; the judge re-derives the fp64 reference and diffs the sealed hardware output, and the exit code decides.

---

## 7. VERIFIER-MAP — criterion → artifact → exact command → pass condition

Mechanical grading table in the [VERIFIER-MAP.md](./VERIFIER-MAP.md) style. Two fresh, non-conflicted verifiers running these commands must reach the same verdict. Every criterion binds to a `judge_verify.py` exit code or an emitted metric; nothing grades on prose. The `-K…` bundle fixtures below are the kernel-task analogs of the existing `quantum-proof-*.json` fixtures. Run from the repo root; prefix any judge command with `QH_REFERENCES_DIR=/secret/refs` for a live contest.

| Crit | Dimension | Artifact | Exact command | Pass condition |
|------|-----------|----------|---------------|----------------|
| K1 | schema / pins present | submitted kernel bundle | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-bf16.json; echo $?` | **not** exit 2 — `kernel`/`oracle`/`hardware`/`toolchain` present, `declared_dtype` known, hashes well-formed |
| K2 | control notary (tiling/masking) | fp32 `interpret=True` golden + `checks.structure` | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-bf16.json --json; echo $?` | **not** exit 3 — fp32 control diff ≤ fp32-identity band; `checks.structure` emitted |
| K2 (regression) | control notary catches a mis-tiled kernel | `quantum-proof-gemm-MISTILE.json` (off-by-one index_map) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-MISTILE.json; echo $?` | exit **3** — structural divergence rejected |
| K3 | numeric notary (dtype-derived tolerance) | fp64 host reference + `checks.reproduced` | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-bf16.json --json; echo $?` | **not** exit 4 — max-abs + distribution within judge-derived bf16 tolerance |
| K4 | tolerance is NOT claimant-chosen | `quantum-proof-gemm-LOOSETOL.json` (declares a wide `declared_tolerance`) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-LOOSETOL.json; echo $?` | exit **4** — declared tolerance disagrees with the dtype-derived one; overclaim rejected |
| K5 | golden-output hash integrity | `quantum-proof-gemm-SWAPPED.json` (array swapped after sealing) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-SWAPPED.json; echo $?` | exit **4** — recomputed sha256 ≠ sealed hash |
| K6 | degraded fast path caught | `quantum-proof-gemm-DEGRADED.json` (drops a correction term; biased error cloud) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-DEGRADED.json; echo $?` | exit **4** — passes max-abs but fails the zero-mean / percentile distribution check |
| K7 | integer path is bit-exact | `quantum-proof-int8-rail.json` (int8/int32-accum) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-int8-rail.json; echo $?` | exit **0** — bit-identical to the reconstructed int reference (no tolerance); a 1-lsb tampered fixture → exit **4** |
| K8 | anti-overfit (held-out inputs) | `references/gemm-bf16-tile1.json` `holdout` inputs + `quantum-proof-gemm-INPUTFIT.json` | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-INPUTFIT.json; echo $?` | exit **6** — accurate on the visible inputs, exceeds tolerance on the held-out distribution |
| K9 | genuine kernel end-to-end | `quantum-proof-gemm-bf16.json` | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-bf16.json; echo $?` | exit **0** — all seals intact, both notaries pass, held-out inputs pass |
| K10 | offline / hermetic path | same bundle, numpy-only judge (no JAX/TPU) | `python3 bench/quantum-judge/judge_verify.py quantum-proof-gemm-bf16.json --json` | ACCEPT using only supplied arrays + host-derived fp64 reference — no TPU touched |
| K11 | device_kind not self-declared | `references/*.json` (harness-recorded `device_kind`) | manual read | `hardware.device_kind` is stamped by the harness at runtime, not trusted from the bundle |
| K12 | MCP round-trip | `mcp/server.mjs` `verify_bundle` | `verify_bundle({ bundle })` in the Desktop app | returns `{verdict, exit_code, failed_gate, checks, reason}`; exit code — not chat — is the verdict |

---

## 8. Anti-gaming invariants

Each invariant is a scar from a specific kill-shot, and each is enforced by the judge recomputing rather than the claimant asserting.

- **Tolerance is a checked function of the declared dtype (and K), never claimant-chosen.** The judge derives `rtol`/`atol` from the dtype's mantissa bits and the reduction length using platform constants pinned host-side; a `claim.declared_tolerance` that disagrees is rejected at exit 4. This is the direct fix for the single-notary kill-shot — a degraded fast path can no longer buy itself a loose tolerance.
- **Correctness is measured against a HIGHER-precision reference (fp64), not against the emulator.** The reduced-precision kernel is diffed against something more accurate than either `interpret=True` or the hardware, so the tolerance only has to absorb the datatype's genuine rounding — not the emulator's own imprecision.
- **The near-exact check lives on the fp32 control leg, where bit-match is achievable.** Tiling/index/masking logic is verified structurally (exit 3) with no dtype tolerance at all, so the numeric tolerance never has to cover a logic bug.
- **Golden-output and reference hashes are sealed into the bundle.** The `oracle.control`, `oracle.numeric`, and `hardware.output` arrays are `sha256`-sealed; the judge recomputes every hash and rejects a post-seal swap (exit 4).
- **Toolchain is hashed.** `jaxlib` + `libtpu` + `XLA_FLAGS` (+ autotune cache) are pinned and hashed into the bundle, so the run is replayable and the numeric result is attributable to a specific compiler stack — no silent flag change.
- **`device_kind` is read from the harness, not the claimant.** The named TPU generation (which sets the peak/bandwidth constants downstream) is stamped at runtime, killing the mis-declaration attack for free.
- **The claimant never self-reports the deviation.** `claim.max_abs_deviation` is decorative — the judge recomputes the max-abs *and* the full distribution (fraction-within-tolerance, zero-mean, tail percentile) from the sealed arrays. A biased or heavy-tailed error cloud fails even when the max-abs is nudged under a bound.
- **Integer paths are held to bit-exactness, not tolerance.** `int8`/`int4` accumulation is exact, so there is no tolerance to game — the cleanest verifiability in the set, and the reason the Twin-Rail Int4 kernel is the trio's first fully-refereeable architecture claim.
- **Held-out inputs, host-side.** The anti-overfit gate (exit 6) re-runs the numeric notary on an input distribution the claimant never saw, registered in `references/<id>.json` — a kernel tuned to look correct on its own inputs is caught the same way an overfit feature map is.

---

*This spec extends the existing four-gate judge and the `mint_run`/`verify_bundle` flow; it does not replace them. The through-line is unchanged from the quantum bench: **the judge recomputes, the claimant never self-reports, and the exit code — not any claim in chat — is the result.** The parts a laptop can check today are HERMETIC-NOW; the part that needs a v5e is sealed, attested on a notary pool, and honestly labeled roadmap, not built.*
