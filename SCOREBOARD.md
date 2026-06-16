# SCOREBOARD — a per-problem leaderboard of judge-ACCEPTED designs

[![judge](https://img.shields.io/badge/score-machine--checked-2ea44f)](bench/quantum-judge/README.md)
[![no self-report](https://img.shields.io/badge/numbers-re--verifiable-blue)](RUBRIC.md)
[![phase 1](https://img.shields.io/badge/board-viewer%20live%20%C2%B7%20CI%20gated-2ea44f)](https://quantum-harness.pages.dev/#scoreboard)

The scoreboard is the public answer to one question: **on this exact problem, which
design currently leads — and can I re-derive that for myself?** It exists because a
verified corpus is only worth something if anyone can check it. So no number here is
self-reported. Every row links a committed **proof bundle**, and the rank is whatever
`bench/quantum-judge/judge_verify.py` recomputes when you re-run it on your own laptop
(numpy only, offline, no QPU). If you don't believe a score, re-run the judge — that's
the whole point, and you are warmly invited to.

This is a convention, not (yet) a website. Read [§ Status](#status-honest) before you
expect a hosted board.

---

## (a) What the scoreboard is

A **per-`problem_id` leaderboard of judge-ACCEPTED submissions.** One board per problem
(`ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`, `qml_sign1`, and any new problem you
add). A submission is eligible for a board **iff** its proof bundle exits `0` under
`judge_verify.py` — it cleared all four gates: STRUCTURE (exit 3), REPRODUCIBILITY
(exit 4), PERFORMANCE (exit 5), and, where the reference declares a `holdout` block,
ANTI-OVERFIT (exit 6). A bundle that REJECTs is not "low-ranked"; it is **not on the
board at all.** The board is a record of designs that genuinely worked, sorted by how
well.

The bar is correctness scored without human taste. The frontier is who clears it best.

---

## (b) Ranking — primary verified metric, then resource-efficiency tie-breaks

Rows are ranked by the **primary verified metric** for that problem's task — the same
number the PERFORMANCE gate already recomputes from scratch. **Higher rank = better
design.** Ties on the primary metric break on **resource efficiency**, read directly
from the judge's emitted `checks.structure` (and, for architecture, the verified
`routing_cost`). Nothing here is hand-counted.

| task | primary verified metric | better is | tie-breaks (in order) |
|---|---|---|---|
| `state_prep` | `fidelity` (vs hidden target) | higher | `two_qubit_gates` ↑less · `depth` ↑less · `n_qubits`/total gates ↑less |
| `vqe` | energy **gap to E0** = `energy − ground_state_energy` | lower (closer to 0) | `two_qubit_gates` ↑less · `depth` ↑less |
| `populations` | matches visible distribution **and** passes held-out `<X₀X₁>` | pass (then by margin) | `two_qubit_gates` ↑less · `depth` ↑less |
| `architecture` | verified `routing_cost` over the workload | lower | total edges ↑fewer · `max_degree` ↑lower (sparser map) |
| `classify` | held-out `test_accuracy` (generalization), then `train_accuracy` | higher | feature-map ops ↑fewer · `two_qubit_gates` ↑less · `n_qubits` ↑less |

Why these tie-breaks: the metric says *is the design correct enough*; the resource
costs say *how cheaply*. A GHZ state at fidelity 1.0 with 2 two-qubit gates beats the
same fidelity with 6 of them — fewer entangling gates, less depth, less routing
overhead is the real engineering win. **Gate count, two-qubit-gate count, and circuit
depth** are the universal currency; **routing cost** is the architecture currency. All
are first-class machine-read numbers (rubric **R5**), never prose.

For `classify`, generalization is the headline: the bench is built to punish overfit, so
the board ranks by **held-out** `test_accuracy` first — a `Ry(7x)` map that nails the
training set but oscillates on the held-out test does not even make the board (it exits
6), let alone top it.

---

## (c) The `paradigm` tag — what's actually being compared

Each entry carries a **`paradigm`** tag: a short, honest label for the *design approach*
the row represents, so the board shows **which paradigm currently leads each problem**.
This is the comparative heart of the project — not "model X vs model Y" (the judge is
model-agnostic; see below), but **design idea vs design idea** on identical, hidden-graded
problems. Pick or coin a tag that names the actual choice you made. Suggested vocab:

- **Ansatz family** (state tasks): `hardware-efficient` vs `problem-specific` /
  `chain-cascade` vs `brickwork` vs `qaoa-p1` …
- **Topology family** (architecture): `ring` vs `grid` vs `heavy-hex` vs `star` vs
  `linear-chain` …
- **Feature map / model family** (classify): `low-frequency-encoding` vs
  `high-frequency-encoding` vs `classical-baseline` …
- **Classical baselines welcome and encouraged.** Tag them `classical-baseline`. A
  paradigm board that includes the best classical approach is the honest one — it shows
  exactly *where* (and whether) a quantum design pulls ahead. The judge already requires
  every quantum entry to beat or tie a stated classical baseline (PERFORMANCE gate); the
  scoreboard lets the classical approach stand as its own row so the gap is visible.

Read across a problem's board and the leading `paradigm` tag is the takeaway: *on
`aiaccel4`, the `ring` topology currently leads the `linear-chain`; on `qml_sign1`,
`low-frequency-encoding` generalizes where `high-frequency-encoding` can't even qualify.*

---

## (d) Entry format — every row links a re-verifiable proof bundle

An entry is one small JSON object (or one Markdown table row). The **load-bearing field
is `proof_bundle`**: a path, in a committed public run repo, to the exact bundle the
judge re-verifies. No score is admissible without it.

```jsonc
{
  "problem_id":      "ghz3",                  // which board this row joins
  "paradigm":        "chain-cascade-ansatz",  // the design approach being compared (c)
  "model":           "opus-4.8",              // provenance only — NOT a ranking key (see below)
  "verified_metric": { "name": "fidelity", "value": 1.0 },   // the primary metric (b)
  "resource_costs":  { "depth": 3, "two_qubit_gates": 2, "n_qubits": 3 },  // judge-emitted (R5)
  "run_repo":        "https://github.com/QuantumMytheme/run-ghz3-chaincascade",
  "proof_bundle":    "bench/quantum-judge/quantum-proof-poc.json",  // path within run_repo
  "judge_exit":      0,                        // MUST be 0; anything else is not on the board
  "verified_at":     "2026-06-16"              // when the submitter last re-ran the judge
}
```

`verified_metric.name` is the task's primary metric: `fidelity` (state_prep), `energy`
with the gap to E0 derived by the judge (vqe), `populations` + held-out observable pass
(populations), `routing_cost` (architecture), `test_accuracy` (classify).
`resource_costs` mirrors the judge's `checks.structure` block — copy it, don't compute it
by hand; the judge prints it on ACCEPT (`--json`). For `architecture`, also carry the
verified `routing_cost`; for `classify`, also carry `train_accuracy`.

As a Markdown row (how a problem's board renders):

| rank | paradigm | metric | resource_costs | model | proof_bundle |
|---|---|---|---|---|---|
| 1 | `ring` | routing_cost **2** | edges 4 · max_degree 2 | opus-4.8 | [run-aiaccel4-ring › quantum-proof-arch.json](https://github.com/QuantumMytheme) |
| 2 | `linear-chain` | routing_cost **4** | edges 3 · max_degree 2 | classical-baseline | [run-aiaccel4-chain › …](https://github.com/QuantumMytheme) |

> **`model` is provenance, never a ranking key.** Models are model-agnostic *fuel*. The
> judge does not care who — or what — produced a bundle; it only re-simulates. Today
> people drive runs with Opus 4.8 / Fable 5, and the harness is built to be ready for the
> next-gen models you may hear called *Mythos* — but the board ranks **designs**,
> not authors. Record `model` so the corpus is honest about provenance; rank on the
> verified metric and resource costs.

---

## (e) How entries get added — the judge is the merge gate

Adding a row is **opening a PR that registers your run**. The judge re-verifies as the
merge gate; no maintainer scores anything by taste. The flow mirrors
[CONTRIBUTING.md](CONTRIBUTING.md):

1. **Do a run.** Mint a fresh public run repo from this template (`bin/new-run.sh
   <run-name>`, or use the GitHub "Use this template" button), pick or write a BRIEF,
   run `KICKOFF.md` with your capable model, and let it self-correct against the rubric
   until `judge_verify.py` exits `0`. Commit the **proof bundle, the judge verdict (exit
   0), the scrubbed transcript, and the autonomy scorecard** back to your run repo, then
   push. That public run repo is the permanent, re-verifiable record — it is where the
   number actually lives.
2. **Open a registration PR** adding your entry object/row (the format in (d)), linking
   `run_repo` + `proof_bundle`.
3. **The merge gate re-verifies.** A PR is mergeable **only if**:
   - `judge_verify.py <proof_bundle>` exits `0` (re-run against the held-out references —
     no self-reported numbers survive this), **and**
   - the regression suite stays green: `python3 bench/quantum-judge/test_judge.py` is
     `29/29` **and** `node --test test/*.test.mjs` is `82/82`.
4. **Re-verification, not negotiation.** No human reviewer overrides a REJECT into a
   merge. If the judge accepts and the suite is green, the row earns its place; the
   ranking follows mechanically from (b).

Because every entry links a committed bundle, anyone can audit the whole board with one
loop — `for b in $(bundles); do judge_verify.py "$b"; done` — and reproduce every rank.
That is the contract: **re-verifiable by re-running the judge, or it doesn't count.**

---

## Seeded boards — the current frontier

These five boards are **seeded with the harness's reference baselines**: the committed
worked examples, one per problem, the bar every run aims to match or beat. Every number
below is the judge's own emitted value — run **`python3 scoreboard/verify.py`** to
re-derive all five offline (it re-runs `judge_verify.py` on each linked bundle; today it
reports `5/5 re-verified, exit 0`). Machine-readable data:
[`scoreboard/entries.json`](scoreboard/entries.json).

**On model usage.** The seed rows are tagged `reference-baseline` — *no autonomous model
produced them; they are hand-authored worked examples.* When you do a run, your row names
the model you pointed at the BRIEF (e.g. `opus-4.8`, `fable-5`, or a next-gen model) and
links **your own** public run repo. `model` is provenance, never a ranking key — the judge
re-simulates regardless of author. The bundles below live in the repository that holds the
harness, [`QuantumMytheme/quantum-harness`](https://github.com/QuantumMytheme/quantum-harness).

### `ghz3` · state_prep
| rank | paradigm | verified metric | resources | model | proof bundle |
|---|---|---|---|---|---|
| 1 | `chain-cascade` | fidelity **1.000** (≥ 0.99; baseline 0.5) | 2q-gates 2 · depth 3 | `reference-baseline` | [quantum-proof-poc.json](https://github.com/QuantumMytheme/quantum-harness/blob/main/bench/quantum-judge/quantum-proof-poc.json) |

**Why it leads —** perfect fidelity at the minimal cost for a GHZ state on the `[0-1-2]`
coupling map (depth 3, two CX). Nothing reaches the target with fewer entangling gates; only
a tie at lower cost could outrank it.

### `isingbell2` · vqe
| rank | paradigm | verified metric | resources | model | proof bundle |
|---|---|---|---|---|---|
| 1 | `minimal-bell-ansatz` | energy gap **0.000** to E0 = −2 (budget 0.05; baseline −1) | 2q-gates 1 · depth 2 | `reference-baseline` | [quantum-proof-vqe.json](https://github.com/QuantumMytheme/quantum-harness/blob/main/bench/quantum-judge/quantum-proof-vqe.json) |

**Why it leads —** reaches the *exact* ground state (gap 0.000) at depth 2 with a single CX;
the Bell state is the true ground state of `H = −X₀X₁ − Z₀Z₁`, and entangling beats the best
product-state baseline (−1). You cannot improve on a zero gap — only tie it more cheaply.

### `bell_pops2` · populations
| rank | paradigm | verified metric | resources | model | proof bundle |
|---|---|---|---|---|---|
| 1 | `phase-correct-bell` | held-out ⟨X₀X₁⟩ **+1.00** ✓ · populations dev 0.000 | 2q-gates 1 · depth 2 | `reference-baseline` | [quantum-proof-pops.json](https://github.com/QuantumMytheme/quantum-harness/blob/main/bench/quantum-judge/quantum-proof-pops.json) |

**Why it leads —** matches the visible 50/50 populations **and** the hidden held-out
⟨X₀X₁⟩ = +1 — the genuine `|Φ+>`, not a phase-flipped impostor that games only the visible
spec. It clears the anti-overfit gate (exit 6) the OVERFIT fixture fails.

### `aiaccel4` · architecture
| rank | paradigm | verified metric | resources | model | proof bundle |
|---|---|---|---|---|---|
| 1 | `ring` | routing_cost **2** (budget 2; baseline 4) · held-out **2** | edges 4 · max_degree 2 | `reference-baseline` | [quantum-proof-arch.json](https://github.com/QuantumMytheme/quantum-harness/blob/main/bench/quantum-judge/quantum-proof-arch.json) |

**Why it leads —** a ring routes **both** the visible and the held-out workload at cost 2
within the degree-2 budget, beating the linear-chain baseline (4). It *generalizes* — the
overfit path that aces the visible pairs blows the held-out budget and is rejected at exit 6.
Only a sparser map at equal cost could outrank it.

### `qml_sign1` · classify
| rank | paradigm | verified metric | resources | model | proof bundle |
|---|---|---|---|---|---|
| 1 | `low-frequency-encoding` | held-out test acc **100%** · train **100%** | ops 1 · n_qubits 1 | `reference-baseline` | [quantum-proof-qml.json](https://github.com/QuantumMytheme/quantum-harness/blob/main/bench/quantum-judge/quantum-proof-qml.json) |

**Why it leads —** 100% train **and** 100% held-out test accuracy with a single rotation.
A high-frequency `Ry(7x)` map also nails training but fails the held-out test (exit 6) and
can't qualify; generalization is the headline metric, and nothing simpler generalizes.

> **These are baselines, not ceilings.** Each row is the design to beat — tie the metric with
> fewer two-qubit gates, route on a sparser map, or generalize with a simpler feature map, and
> your run takes rank 1. Open a registration PR; the judge re-verifies.

---

## Hardware overlay — validate on a real QPU

The sim score is the canonical rank. If you have a quantum chip, you can attach a
**hardware overlay** to any sim-ACCEPTed design: run the same circuit on your device and
report the measured metric. A hardware report (`hardware-report@1`) is checked two ways —
the metric is **recomputed from your raw counts** (re-verifiable; a number that doesn't
match its own data is rejected), and the provenance is **attested** (backend, job id,
calibration — trusted-but-labeled, since a device run isn't re-executable by a third
party). A hardware overlay **never outranks** the sim score; it shows *"validated on
`ibm_torino`, ⟨X₀X₁⟩ = 0.94, 4096 shots."* Full flow + format: **[HARDWARE.md](HARDWARE.md)**.

---

## (f) Status — honest

**Phase 1 is now partly shipped.** An **aggregator** (`scoreboard/build.mjs`) ranks
`scoreboard/entries.json` per problem (the rules in (b)) and generates the data the
**viewer renders** — the live board is the Scoreboard section at
<https://quantum-harness.pages.dev/#scoreboard>. CI
(`.github/workflows/scoreboard.yml`) is the merge gate: `scoreboard/verify.py` re-verifies
every entry — **including entries whose bundle lives in an external run repo, which it
fetches and re-runs against the canonical hidden references** — and **checks the reported
metric matches the judge's own recompute** (no rank overclaim); it runs the suites
(29/29 + 82/82) and **fails any PR whose generated board is stale**
(`node scoreboard/build.mjs --check`). **Discovery is automated too:** a run repo opts in
with the GitHub topic `quantum-harness-run` + a `scoreboard-entry.json` at its root;
`scoreboard/discover.mjs` (scheduled via `.github/workflows/discover.yml`) crawls the org for
tagged repos, ingests their entries into `scoreboard/discovered.json`, re-verifies them, and
rebuilds the board — **no PR needed** (the [PR template](.github/pull_request_template.md)
still works if you prefer). Seeds live in `entries.json`, discovered runs in `discovered.json`;
the aggregator merges both. The one manual step for a fully-live board is the Cloudflare
deploy — automated if you add a `CLOUDFLARE_API_TOKEN` repo secret (the discover workflow
deploys when it's present).

What this means in practice, right now:
- **The numbers are real and already re-verifiable** — re-run `judge_verify.py` on any
  linked bundle and you reproduce the score offline.
- **Ranking is by convention** — apply (b) by hand across a problem's registered entries.
  When the aggregator ships, it will compute exactly this ordering from the committed
  bundles; nothing about the data model changes.
- **You can start contributing today** without waiting for the site. Do a run, commit the
  bundle, open the PR. When the board goes live it ingests what's already here.

That honesty is deliberate. We would rather ship a convention that's true than a
dashboard that's decorative.

---

## Why a scoreboard exists (the warm part)

Three reasons, plainly:

1. **Contribute to science.** Every accepted entry adds to an open, reproducible,
   re-verifiable corpus of verified quantum designs that anyone can check by re-running
   the judge. Correctness is scored without human taste — so the corpus is trustworthy in
   a way a leaderboard of self-reported numbers never is.
2. **A scoreboard across paradigms.** This is what makes the corpus more than a pile of
   solutions: the same hidden-graded problems let you compare design approaches head to
   head — which ansatz, which topology, which feature map (and which classical baseline)
   currently leads. The frontier is public, and it moves when someone posts a better
   verified design.
3. **For the curious.** Pick a problem, point a capable model at its BRIEF, watch it loop
   to ACCEPT — then try to **beat the current best verified score**. The tie-breaks make
   that a real game: match the fidelity with fewer two-qubit gates, route the workload on
   a sparser map, generalize the classifier with a simpler feature map. Hill-climb on a
   number a machine will check for you.

You don't need a QPU, a cloud account, or our permission. You need numpy, a BRIEF, and a
model willing to self-correct. **Do your own harness-preparation run, and put a row on the
board.** The judge is waiting, and it grades the same for everyone.

— the [QuantumMytheme](https://github.com/QuantumMytheme) org
