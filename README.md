# quantum-harness — a verifiable-run prompt harness for quantum chip design

**quantum-harness** is a public, MIT-licensed prompt harness for **quantum chip and
quantum-processing architecture design**: you point a highly-capable autonomous model
(today Opus 4.8; built to be ready for Fable 5 / "Mythos" when it arrives) at a hard
quantum design problem, and it produces a **proof bundle** that a hermetic, deterministic
judge either **ACCEPTs or REJECTs** — no human in the scoring loop, no model grading its own
homework. The model's autonomy is measured separately from the raw session transcript. The
long game is native quantum-processing architectures for AI models and inference, beyond
today's hybrid intermediate-representation / classical stack; the near-term deliverable is a
machine-checkable verdict you can reproduce on a laptop.

## The pattern: one orchestration shape, two levels

This harness is built on a single idea: **the goal is a contract, and the contract is
machine-checked.** That discipline shows up at two levels — the level that *builds* a
solution, and the level that *verifies* it — and the same five domain-invariant parts power
both.

- **Build time — BRIEF + RUBRIC + fresh verifier.** A run sets direction with a **BRIEF**
  (the problem stated conceptually: "prepare a 3-qubit GHZ state under a linear coupling map")
  and a **RUBRIC** where every criterion binds to a concrete check — a structural constraint,
  a recomputed number, a performance threshold, a held-out reference. Nothing is "done" on the
  author's say-so: a **fresh, non-conflicted verifier** — one with no stake in the circuit —
  grades the proof bundle against the rubric, and the run loops back until every gate is green.

- **Verify time — deterministic-sim judge + hidden reference.** The judge is a hermetic
  pure-numpy statevector simulator. It **re-simulates the submitted circuit from scratch** and
  checks it against ground truth that the author never sees: the exact target state /
  Hamiltonian and the pass thresholds live with the judge in `references/<problem_id>.json`, the
  analog of a signing key that never enters the sandbox. The model knows the target
  *conceptually* from the BRIEF; it does not get the answer key. Re-simulation is what catches
  fabrication — a bundle can *claim* fidelity 1.0, but the judge recomputes it and rejects the
  lie.

The five parts, reused verbatim from the pattern this repo is derived from: **(1)** a goal
**contract** = BRIEF + RUBRIC, every criterion bound to a test/endpoint/judge; **(2) friction
removal** — allowlisted commands, deps preinstalled; **(3) one kickoff + self-correction** — a
fresh verifier grades against the rubric and the model loops until green; **(4) a verifiable
bench** — the judge; **(5) computed measurement** — a transcript-fed autonomy scorecard plus a
secret scrub. The domain is new; the discipline is not.

## Why this exists

Three reasons, in plain terms:

1. **Contribute to science.** Every accepted run adds to an open, reproducible, re-verifiable
   corpus of verified quantum designs — and anyone can check any claim by re-running the judge.
   Correctness is scored without human taste: the simulator recomputes the number, so a bundle
   either holds up or it doesn't.
2. **A scoreboard across paradigms.** The same judge-scored problems let you compare design
   approaches head-to-head — which ansatz, which qubit topology, which feature map (and how each
   stacks up against the classical baseline) currently leads. The frontier is public, ranked by a
   verified metric, and re-verifiable by anyone.
3. **For the curious.** It's a place to point a capable autonomous model at a **BRIEF** and watch
   it hill-climb: loop until the judge ACCEPTs, then try to beat the current best verified score.

**New here? → [GETTING-STARTED.md](./GETTING-STARTED.md) — your first run in three commands** (remix
the current frontier, your model molds it, it auto-registers). Then **[RUN-FLOW.md](./RUN-FLOW.md)** is
the full lifecycle, **[SCOREBOARD.md](./SCOREBOARD.md)** is where runs are ranked, and
**[ACCESS.md](./ACCESS.md)** shows how to validate on a real (or rented) quantum chip.

## Repo layout

| Path | What it is |
|---|---|
| `bench/quantum-judge/sim.py` | Hermetic pure-**numpy** statevector simulator (the verification engine) |
| `bench/quantum-judge/graph.py` | Hermetic graph helpers (degrees / connectivity / routing cost) for the architecture task |
| `bench/quantum-judge/judge_verify.py` | The judge — feed it a proof bundle, get ACCEPT (exit 0) or REJECT (non-zero) |
| `bench/quantum-judge/capture.py` | Builds a well-formed proof bundle from a circuit using the *same* simulator |
| `bench/quantum-judge/test_judge.py` | 29/29 regression checks (accept the worked examples, reject every class of forgery) |
| `bench/quantum-judge/references/<id>.json` | **Hidden ground truth** — target/Hamiltonian + thresholds (incl. the held-out `holdout` block, e.g. `references/bell_pops2.json`, `references/aiaccel4.json`, `references/qml_sign1.json`); the answer key the author never sees |
| `bench/quantum-judge/quantum-proof-poc.json` | Worked **ghz3** proof bundle (state_prep) |
| `bench/quantum-judge/quantum-proof-vqe.json` | Worked **isingbell2** proof bundle (vqe) |
| `bench/quantum-judge/quantum-proof-pops.json` | Worked **bell_pops2** proof bundle (populations) — genuine Bell state, passes the held-out check |
| `bench/quantum-judge/quantum-proof-arch.json` | Worked **aiaccel4** proof bundle (architecture) — ring topology, routes the held-out workload |
| `bench/quantum-judge/quantum-proof-qml.json` | Worked **qml_sign1** proof bundle (classify) — low-frequency feature map, generalizes to the held-out test set |
| `bench/quantum-judge/quantum-proof-OVERFIT.json` | Adversarial fixture — matches the visible populations but fails the held-out `<X₀X₁>`; **must** be rejected at exit 6 |
| `bench/quantum-judge/quantum-proof-arch-OVERFIT.json` | Adversarial fixture — routes the visible workload but blows the held-out workload budget; **must** be rejected at exit 6 |
| `bench/quantum-judge/quantum-proof-qml-OVERFIT.json` | Adversarial fixture — fits the training set but fails the held-out test set; **must** be rejected at exit 6 |
| `bench/quantum-judge/quantum-proof-FORGED.json` | Adversarial fixture — claims fidelity 1.0 but truly 0.25; **must** be rejected |
| `bin/autonomy-scorecard.mjs` | Parses a session transcript → intervention classification, longest unattended stretch, timeline |
| `bin/prepare-transcript.mjs` | Secret-scrub pipeline for publishing a transcript |
| `lib/scorecard.mjs` | Scorecard engine (intervention classification, autonomy scoring) |
| `lib/prepare-transcript.mjs` | Scrub engine behind the transcript pipeline |
| `lib/planner-*.mjs` | Planner roster / walkthrough used by the run orchestration |
| `test/*.test.mjs` | Measurement test suite — 82 tests (scorecard + transcript scrub + planner roster/walkthrough) |
| `viewer/index.html` | Interactive, self-contained showcase of the bench (paper / luminous themes) — opens from `file://`, no build, runs the real sim |
| `GETTING-STARTED.md` | Your first run in three commands — remix the frontier, your model molds it, auto-register |
| `RUN-FLOW.md` · `bin/new-run.sh` | Mint a fresh public run repo from this template (`--remix <problem>` pre-loads the frontier), run, commit back |
| `bin/ingredients.mjs` | Assemble prior verified designs for a problem into a remix pack — how runs **compound** |
| `ACCESS.md` | Get or rent a quantum chip (often free / under $1) and overlay a real-hardware result |
| `HARDWARE.md` · `bench/quantum-judge/hardware_report.py` | Run a sim-verified design on a **real QPU** and report back — a labeled, partly-re-verifiable hardware overlay (sim score stays canonical) |
| `LICENSE` | MIT |

## Quickstart

No build step. Node 22+ for the measurement layer; Python 3 with **numpy only** for the judge.

```sh
# 1. Measurement layer — 82 tests green
node --test test/*.test.mjs

# 2. Verify a proof bundle — ACCEPT (exit 0) / REJECT (non-zero)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-poc.json

# 3. Judge regression suite — 29/29 checks (accept the worked examples, reject every forgery)
python3 bench/quantum-judge/test_judge.py

# 4. Build a bundle from your own circuit, using the same simulator the judge uses
python3 bench/quantum-judge/capture.py <circuit.json> <problem_id> [--task state_prep|vqe|populations]
```

The judge runs **four active verification gates** — structure, reproducibility, performance,
and anti-overfit — each able to REJECT with its own exit code, and signals the failing one
through that code. The **anti-overfit gate (exit 6)** is the held-out generalization check: it
fires for any problem whose hidden reference declares a `holdout` block — an observable or
target the model was never told — and rejects a circuit that matches the visible spec but
fails the hidden check (see below).

| Exit | Gate | What it checks |
|---|---|---|
| 0 | ACCEPT | all gates pass |
| 2 | schema | bundle is well-formed |
| 3 | **structure** | parses; respects `n_qubits` / depth / native gates / coupling map / 2-qubit cap |
| 4 | **reproducibility** | recompute the claimed number — catches fabrication |
| 5 | **performance** | meet the threshold *and* beat or tie the classical baseline |
| 6 | **anti-overfit** | held-out generalization check (fires when the problem declares a held-out check) |

**The held-out anti-overfit gate (exit 6).** The judge reads ground truth *only* from the
hidden reference (`references/<id>.json`, relocatable via `QH_REFERENCES_DIR`), never from the
bundle, and the circuit IR cannot embed a target state. On top of that spine, a reference may
declare a **`holdout` block** — an observable or target the model was *never* told — and the
judge checks the re-simulated state against it. A circuit that satisfies the *visible* spec but
fails the *hidden* held-out check overfit the part it could see and is **REJECTED at exit 6**.

The worked demonstrator is **`bell_pops2`** (task `populations`): the model is told to prepare
the Bell state |Φ⁺⟩, and the *visible* spec is only the Z-basis populations — 50/50 between
|00⟩ and |11⟩. The judge **holds out** the X-parity ⟨X₀X₁⟩ = +1. The genuine Bell state ACCEPTs
(`quantum-proof-pops.json` → exit 0), while a wrong-phase impostor |Φ⁻⟩ that matches the
populations exactly is REJECTED at exit 6 (`quantum-proof-OVERFIT.json`) — it cleared structure,
reproducibility, and performance, and failed *only* the held-out check.

For problems that declare **no** `holdout` block (e.g. `ghz3`, `isingbell2`), anti-overfit
additionally holds *by construction* — ground truth lives only in the hidden reference and the
circuit IR cannot embed a target, so the model must genuinely build the state from gates — and
exit 6 is simply not triggered for them.

## Proof-bundle schema (`quantum-harness/proof-bundle@1`)

```json
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "ghz3",
  "task": "state_prep",
  "circuit": { "n_qubits": 3, "ops": [ { "gate": "h", "q": [0] }, { "gate": "cx", "q": [0, 1] } ] },
  "constraints": {
    "n_qubits": 3, "max_depth": 6,
    "native_gates": ["h", "cx", "rz", "sx"],
    "coupling_map": [[0, 1], [1, 2]],
    "max_two_qubit_gates": 4
  },
  "claim": { "fidelity": 1.0 },
  "classical_baseline": { "fidelity": 0.5, "note": "best unentangled product state" },
  "meta": {}
}
```

`task` is one of `state_prep` | `vqe` | `populations` | `architecture` | `classify`. For a VQE
task, `claim` carries `{ "energy": ... }` instead of `{ "fidelity": ... }`; for a `populations`
task it carries `{ "populations": [...] }`; the `architecture` and `classify` tasks use their own
bundle shapes (see the bench README). The simulator uses **qubit 0 = most
significant index** and supports the gate set `x y z h s sdg t tdg sx sxdg rx ry rz p` (1-qubit),
`cx cz cy swap crz cp rzz` (2-qubit), and `ccx` (3-qubit).

## The worked problems

All five are committed and runnable today.

- **`ghz3` — state prep.** Prepare the 3-qubit **GHZ** state under a linear `[0–1–2]` coupling
  map. Threshold fidelity **0.99**; classical baseline **0.5** (the best unentangled product
  state). Reference solution: `h q0; cx 0,1; cx 1,2` → fidelity **1.0**.

- **`isingbell2` — VQE.** Find the ground state of **H = −X₀X₁ − Z₀Z₁** (n = 2). The true
  ground energy is **E₀ = −2** (a Bell state); the product/classical baseline is **−1**; the
  energy-gap budget is **0.05**. Reference solution: `h q0; cx 0,1` → energy **−2**.

- **`bell_pops2` — populations (anti-overfit demonstrator).** Prepare the Bell state |Φ⁺⟩.
  The *visible* spec is only the Z-basis populations — 50/50 between |00⟩ and |11⟩ — and the
  held-out check is the X-parity ⟨X₀X₁⟩ = +1. The genuine Bell state ACCEPTs; a wrong-phase
  |Φ⁻⟩ impostor that matches the populations is REJECTED at the **anti-overfit gate (exit 6)**.

- **`aiaccel4` — architecture (held-out workload).** Design a hardware coupling map (topology)
  that routes a workload of required two-qubit interactions within budget. The held-out check is
  a *second* interaction set that must also route within budget on the **same** topology. The
  ring topology ACCEPTs; a design hand-tuned to the visible workload is REJECTED at the
  **anti-overfit gate (exit 6)**.

- **`qml_sign1` — classify (held-out test set).** Design a quantum feature map that classifies
  data. The held-out check is an unseen **test set** the model never saw. The low-frequency map
  `Ry(x)` generalizes and ACCEPTs; a high-frequency `Ry(7x)` map that fits the training data but
  fails the test set is REJECTED at the **anti-overfit gate (exit 6)**.

The adversarial fixture `quantum-proof-FORGED.json` omits the second `CX`, so its true GHZ
fidelity is **0.25** — but it *claims* **1.0**. The reproducibility gate recomputes the number
and rejects it (exit 4). The `quantum-proof-OVERFIT.json` fixture matches the visible
populations but fails the held-out ⟨X₀X₁⟩, and is rejected at exit 6. Both rejections are
anti-cheat regressions, locked into the 29/29 judge suite.

## Honest boundary: a simulator-only bench

Verification is **simulator-only** by design. The judge's root dependency is **numpy and
nothing else** — no Qiskit, Cirq, or PennyLane required to grade a bundle. Those frameworks are
**optional authoring adapters**: handy for *writing* circuits, never on the trust path for
*checking* them. That keeps the judge hermetic, deterministic, and reproducible anywhere — a
laptop, CI, or a Raspberry Pi.

The flip side, stated plainly: a simulator validates *logical correctness and resource
constraints*, not the physics of any specific fabricated device — no noise model, no hardware
calibration, no shot statistics. Optional QPU / hardware backends are a possible future
extension; today's verdict means "this circuit provably meets the contract under ideal
simulation," and nothing more.

For live contests, point `QH_REFERENCES_DIR` at a private directory of held-out references. The
public template **commits** its references so CI can run end-to-end; a real contest **holds them
out** so the answer key never reaches the model.

## Provenance

This repo reuses a verifiable-run *pattern* first built for an unrelated domain
(`fieldops-harness`). Only the **domain-invariant measurement layer** — the autonomy scorecard,
the transcript scrub, and the run orchestration — is carried over; everything quantum (the
simulator, the judge, the proof-bundle schema, the worked problems) is new to this repo. It is
seeded **fresh, with no shared git history** — the lineage is stated here in prose, not
inherited through commits.

## Platform vision

The worked problems are a seed, not the ceiling. The longer arc — a growing problem set,
held-out contest references, and a path toward native quantum-processing architectures for AI
inference — is laid out in **[PLATFORM-VISION.md](./PLATFORM-VISION.md)**.

## License

MIT — see [LICENSE](./LICENSE).
