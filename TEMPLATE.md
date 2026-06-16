# Using quantum-harness as a template for new verifiable runs

This repo is the reusable **harness** behind quantum-chip / quantum-processing architecture
design: the brief/rubric/scorecard/runbooks + the **verifiable bench** (`bench/quantum-judge/`)
+ the backlog of deltas. Make it a GitHub template so each iteration starts from the same
verifiable scaffolding and incorporates the work queued in `IMPROVEMENTS.md`.

> Provenance: this harness reuses the *pattern* of the FieldOps Build Day harness
> (`ClaudeFarms/fieldops-harness`) but was seeded **fresh, with no shared git history**. The
> lineage is stated here in prose — it is not inherited through commits. The content (the
> simulator, the judge, the problems) is entirely new and quantum.

## Make it a template (one-time, in the GitHub UI)
Repo **Settings → ✅ Template repository**. (There is no API for this in our tooling — it's a
one-click checkbox.) After that, **"Use this template"** mints a fresh repo seeded with these
artifacts — no hand-copying, no drift.

## The verifiable-run loop (what every new run does)
1. **Pick the work** — choose an item from `IMPROVEMENTS.md`; its referenced delta proposal is
   the design (e.g. a new `state_prep`/`vqe` problem, a tighter coupling map, an
   `architecture` topology or a `classify` feature map).
2. **Write the contract** — update `BRIEF.md` (problem, target *conceptually*, what "done"
   means) and `RUBRIC.md` with a **fresh-verifier contract**: every criterion binds to a
   **judge gate**, a test, or a verifier sub-agent — no human judgment. The model learns the
   target from the BRIEF; the exact target/Hamiltonian + thresholds stay with the judge in
   `bench/quantum-judge/references/<problem_id>.json` (the held-out ground truth — the analog
   of a signing key that never enters the sandbox).
3. **Remove friction** — allowlist the run's commands in `.claude/settings.json`: the **hermetic
   simulator + judge** (`python3 bench/quantum-judge/judge_verify.py …`,
   `python3 bench/quantum-judge/test_judge.py`,
   `python3 bench/quantum-judge/capture.py …`) and the scorecard
   (`node --test test/*.test.mjs`). Deps are pre-installed — `numpy` ONLY at the verification
   root (no Qiskit/Cirq/PennyLane required; those are optional authoring adapters). Optional
   **QPU credentials go in env** (referenced by name, never printed); point the judge at a
   live held-out reference set with `QH_REFERENCES_DIR` when running a real contest.
4. **Direct the model** — set `/effort ultracode` AND `/goal <one sentence>` (e.g. *"prepare
   the GHZ-3 state under the linear coupling map and pass judge_verify with fidelity ≥ 0.99"*);
   send **one** kickoff, then let it run.
5. **Prove it** — the **fresh, non-conflicted judge** grades the PROOF BUNDLE and the model
   loops until green:
   - `python3 bench/quantum-judge/judge_verify.py <bundle.json>` re-simulates deterministically
     and ACCEPTs (exit 0) or REJECTs through four active gates: **STRUCTURE** (exit 3),
     **REPRODUCIBILITY** (exit 4 — recompute the claimed number, catch fabrication),
     **PERFORMANCE** (exit 5 — meet threshold AND beat/tie the classical baseline), and
     **ANTI-OVERFIT** (exit 6 — the **held-out generalization check**). The judge always reads
     ground truth ONLY from the hidden reference (`references/<id>.json`, relocatable via
     `QH_REFERENCES_DIR`), never from the bundle, and the circuit IR cannot embed a target state —
     so a forged number a model placed in its own bundle is caught at the reproducibility (4) /
     performance (5) gates. The anti-overfit gate **fires for problems whose reference declares a
     `holdout` block** — something the model was NEVER told: a held-out **observable** (state tasks,
     e.g. `bell_pops2` holds out `<X0X1>`), a held-out **workload** (architecture — the topology must
     also route a second interaction set within budget, e.g. `aiaccel4`), or a held-out **test set**
     (classify — the feature map must classify unseen data, e.g. `qml_sign1`). A design that matches the
     VISIBLE spec but fails the HIDDEN held-out check overfit the part it could see and is REJECTED
     at exit 6. For problems with NO holdout block (e.g. `ghz3`, `isingbell2`)
     anti-overfit ALSO holds by construction, so exit 6 is simply not triggered for them. (Other
     exit: 2 schema/parse.)
   - `node --test test/*.test.mjs` → **82 tests green** (autonomy scorecard + transcript scrub +
     planner roster/walkthrough).
   Then generate the autonomy scorecard from the SCRUBBED transcript
   (`bin/autonomy-scorecard.mjs`). Keep ≥1 self-caught failure visible.

That loop IS the orchestration story judges reward: brief + rubric + `/goal` + saved workflow
scripts + a machine-checkable "done" — a verdict, not an opinion.

### The five worked problems (committed, runnable today)
Use these as the templates for the BRIEF+RUBRIC of any new run:
- **`ghz3`** — task `state_prep`: prepare the 3-qubit GHZ state under a linear `[0-1-2]`
  coupling map. Threshold fidelity `0.99`, classical baseline `0.5`. Reference solution
  `h q0; cx 0,1; cx 1,2` → fidelity `1.0`. Bundle: `bench/quantum-judge/quantum-proof-poc.json`.
- **`isingbell2`** — task `vqe`: ground state of `H = -X0X1 - Z0Z1` (n=2). True `E0 = -2`
  (a Bell state), product/classical baseline `-1`, energy gap budget `0.05`. Reference solution
  `h q0; cx 0,1` → energy `-2`. Bundle: `bench/quantum-judge/quantum-proof-vqe.json`.
- **`bell_pops2`** — task `populations` (the anti-overfit demonstrator): prepare the Bell state
  `|Φ+>`. The VISIBLE spec is just the Z-basis populations (50/50 between `|00>` and `|11>`); the
  judge HOLDS OUT the X-parity `<X0X1> = +1` the model was never told. The genuine `|Φ+>` ACCEPTs
  (`quantum-proof-pops.json` → exit 0); a wrong-phase impostor `|Φ->` that still matches the
  populations passes STRUCTURE/REPRODUCIBILITY/PERFORMANCE yet is REJECTED at the held-out
  **ANTI-OVERFIT** gate (exit 6) — `bench/quantum-judge/quantum-proof-OVERFIT.json`.
- **`aiaccel4`** — task `architecture` (held-out workload): design a hardware coupling map for a
  workload of two-qubit interactions. The VISIBLE workload routes within budget on a ring topology
  (`quantum-proof-arch.json` → exit 0); the judge HOLDS OUT a second interaction set the same
  topology must also route within budget, so a map hand-tuned to one circuit is REJECTED at the
  held-out **ANTI-OVERFIT** gate (exit 6) — `quantum-proof-arch-OVERFIT.json`.
- **`qml_sign1`** — task `classify` (held-out test set): design a quantum feature map that classifies
  data. The low-frequency map `Ry(x)` learns the training set AND generalizes
  (`quantum-proof-qml.json` → exit 0); an `Ry(7x)` map that overfits the training data fails the
  HELD-OUT test set and is REJECTED at the **ANTI-OVERFIT** gate (exit 6) —
  `quantum-proof-qml-OVERFIT.json`.

### The anti-cheat regression (must stay red for forgeries)
`bench/quantum-judge/quantum-proof-FORGED.json` omits the 2nd CX and claims fidelity `1.0` while
the circuit truly yields `0.25`; `judge_verify.py` MUST reject it at the **REPRODUCIBILITY**
gate (exit 4). `quantum-proof-OVERFIT.json` passes structure/reproducibility/performance but MUST
be rejected at the held-out **ANTI-OVERFIT** gate (exit 6). `test_judge.py` is the 29/29
regression: accept the worked examples, reject every class of forgery (including the overfit
impostor). Never weaken these to make a run pass.

## Shipping each iteration (pick one)
- **Recommended — one repo, a tag/release per shipped problem/feature**
  (`v1-ghz3`, `v2-vqe`, `v3-architecture`, …). The git history is the iteration record; you
  submit a tag/commit. No copies.
- **Standalone repo per submission** (only if a contest requires it) — `Use this template` to
  mint a fresh repo for that iteration, or script an export (subtree/filter) from the canonical
  one. Duplication via the template mechanism, in sync — never hand-maintained.

Either way, each iteration carries its own BRIEF + RUBRIC + fresh-verifier judge so "done" stays
a machine verdict.

## What stays vs. what each run replaces
- **Stays (the template skeleton):** `bench/quantum-judge/` (the spine — `sim.py`, `graph.py`,
  `judge_verify.py`, `capture.py`, `test_judge.py`, the `references/` held-out truth, and the
  committed fixtures incl. `quantum-proof-FORGED.json`, the architecture pair
  `quantum-proof-arch.json` + `quantum-proof-arch-OVERFIT.json`, and the classify pair
  `quantum-proof-qml.json` + `quantum-proof-qml-OVERFIT.json`); `bin/` + `lib/` + `test/` (autonomy
  scorecard + transcript scrub + planner pipeline); `README.md`, `VERIFIER-MAP.md`,
  `IMPROVEMENTS.md`, this guide.
- **Replace per run:** `BRIEF.md`, `RUBRIC.md`, the kickoff, `/goal`, the chosen IMPROVEMENTS
  item, and the run's PROOF BUNDLE under `bench/quantum-judge/` — plus disclose the template as
  pre-built (the own-work / provenance line above).

### Proof bundle schema (`quantum-harness/proof-bundle@1`)
What the model authors and the judge grades:
```
{ schema, problem_id, task ∈ { state_prep | vqe | populations | architecture | classify },
  circuit:    { n_qubits, ops:[ {gate, q:[...], params?:[...]} ] },
  constraints:{ n_qubits, max_depth, native_gates:[...], coupling_map:[[i,j],...],
                max_two_qubit_gates },
  claim:      { fidelity }  or  { energy }  or  { populations },
  classical_baseline: { fidelity|energy, note },
  meta:       {} }
```
The `architecture` and `classify` tasks carry their own bundle shapes instead of `circuit`:
```
architecture: { architecture:{ n_qubits, coupling_map:[[i,j],...] },
                constraints:{ max_degree, connected }, claim:{ routing_cost } }
classify:     { feature_map:{ n_qubits, ops:[ {gate, q, feature?, scale?, params?} ] },
                readout:{ pauli, bias }, claim:{ train_accuracy } }
```
(A feature-bound op uses `{"feature": idx, "scale": s}` so its angle = `s * x[idx]`.)
The hermetic simulator (`sim.py`) uses **qubit 0 = most-significant index** and supports gates
`x y z h s sdg t tdg sx sxdg rx ry rz p; cx cz cy swap crz cp rzz; ccx`. Build a well-formed
bundle from a circuit with the SAME simulator via `capture.py` — never hand-fabricate the
claimed number.
