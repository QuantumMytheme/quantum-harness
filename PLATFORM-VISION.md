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

But the education layer is bigger than the bench: it is a full, highly-animated arc from the
origins of machine learning → big data → transformers and the modern inference zoo →
pretraining/post-training → the classical machines underneath (the IR/classical stack) →
quantum simulation → hybrid classical/quantum → and finally *running this harness yourself*
against your own model. The whole curriculum — and how a learner ends up pointing their own
Claude subscription or API credits at a BRIEF and injecting their own parameters — is designed
in [EDUCATION.md](./EDUCATION.md).

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
worked problems (`ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`, `qml_sign1`), the 29/29
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

## The long game

The near-term deliverable is a machine-checkable verdict you can reproduce on a laptop. The
platform is how that verdict becomes a public good — a growing, searchable, re-runnable corpus of
verified quantum designs, contributed openly and gated mechanically. The far horizon is the same
one the harness was built for: **native quantum-processing architectures for AI models and
inference**, beyond today's hybrid intermediate-representation / classical stack. A platform that
can pose hard architecture briefs and score honest answers at scale is the instrument for getting
there.

> Reminder: this is a forward-looking roadmap. The harness in this repo is real and runs today;
> `quantummytheme.com` is the destination it is designed to feed.
