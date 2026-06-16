# How an autonomous model is used on quantum-harness — the effectiveness design

> The harness scores the environment you built (brief, rubric, bench, workflow scripts)
> and the raw session transcript. A highly-capable autonomous model's documented edge is
> long-horizon work — running against a goal, checking its own work, correcting, and
> continuing. So the design principle is:
>
> **The human's job is environment design before kickoff. Everything else is the model's,
> and everything the model does is machine-verified (a re-simulating judge) and
> machine-measured (a transcript scorecard).**
>
> This design is **model-agnostic**: today it is pointed at Opus 4.8, but it is authored to
> be fed Fable 5 / "Mythos" the moment they arrive — nothing here binds to a model version.

## 1. The five layers

### Layer 1 — Goal contract (pre-built, judged)
- `BRIEF.md`: problem, who it's for, deliverable, hard rules. One document; no oral lore.
- `RUBRIC.md`: done = one passing run graded by a **fresh verifier sub-agent** with no
  stake in the design. H criteria (honesty) auto-fail; R criteria (the verifiable chain)
  independently checkable by exit code; A criteria force the autonomy evidence to exist.
- The rubric is the contract: the builder may not stop while any criterion fails and may
  not declare done without a verifier pass. This converts "is it done?" from a human
  judgment call into a machine verdict — which is exactly what lets the human stay out of
  the loop. **EXAMPLE — goal contract = a sim-verifiable circuit target**: "prepare the
  3-qubit GHZ state under a linear `[0-1-2]` coupling map at fidelity ≥ 0.99" or "find the
  ground state of `H = −X₀X₁ − Z₀Z₁` within 0.05 of E₀ = −2". The target is stated
  *conceptually* in the brief; the exact target statevector / Hamiltonian terms / thresholds
  live host-side with the judge under `bench/quantum-judge/references/<problem_id>.json` and
  never enter the sandbox — so the criterion is graded against data the builder never saw.

### Layer 2 — Friction removal (pre-built, invisible, decisive)
Long unattended stretches die on permission prompts and missing dependencies, so:
- `.claude/settings.json` pre-allowlists the run's commands (`python3` on the judge, bench
  self-test, and `capture.py`; `node --test`; the scorecard/transcript tooling under `bin/`)
  so the model never stops to ask for a permission it will always be granted.
- **EXAMPLE — friction removal = numpy/sim deps preinstalled + optional QPU creds**: the
  verification root needs **numpy ONLY** — the hermetic pure-numpy statevector simulator
  `sim.py` runs offline on a laptop, in CI, or on a Raspberry Pi, with no Qiskit/Cirq/
  PennyLane required. Those frameworks are **optional authoring adapters**, not verification
  dependencies, so a missing quantum SDK can never block a run. If a live contest wires in
  real QPU credentials for hardware execution, they are provisioned before kickoff and
  referenced by env var name only. **Zero mid-run operator asks for deps or secrets.**
- Environment pre-commissioned: the two worked problems (`ghz3`, `isingbell2`) ship with a
  committed reference solution and a committed passing bundle, so the model can confirm the
  bench is green before designing anything. Ground truth is relocatable via
  `QH_REFERENCES_DIR` for a real held-out contest — that path is exercised before kickoff,
  not discovered mid-run.

### Layer 3 — One-kickoff discipline (the autonomy score is made here)
- **One kickoff message** carries everything (Appendix A). After it, the operator replies
  only when the model is genuinely blocked — and on this bench there is almost nothing to be
  blocked on, because the verdict is a local exit code, not an external approval.
- **The verdict happens in the bench, not the chat**: a bundle that ACCEPTs (exit 0) under
  `judge_verify.py` IS the proof. No conversational claim about a fidelity or energy is
  admissible — only the exit code of a re-run. A result typed into chat is not a result; the
  same circuit re-simulated by the judge is.
- Anything we're tempted to say mid-run that could have been anticipated is a brief-authoring
  failure — it goes into `BRIEF.md` v2 for next time, not into chat.

### Layer 4 — The loop the model runs (self-correction as the default motion)
```
orient (read BRIEF/RUBRIC/bench) → plan → design circuit (TDD against the judge)
  → self-verify: judge_verify.py + test_judge.py + node --test + fresh verifier sub-agent grades RUBRIC.md
  → fix what failed → repeat until the verifier passes → ship → re-verify under relocated references
```
- **Verifier is always a fresh sub-agent** — never the builder grading its own homework. It
  re-derives every claimed number from scratch on the hermetic simulator; it did not author
  the circuit.
- **EXAMPLE — self-correction = judge REJECTs → the coordinator re-designs the ansatz/
  parameters and re-submits**: the four active judge gates name exactly what to fix, first
  failing gate wins. A two-qubit gate on a pair the coupling map forbids (e.g. a naive
  `cx 0,2` under a linear `[0-1-2]` map) → **STRUCTURE, exit 3** → re-route through `cx 1,2`.
  A claimed fidelity the re-simulation contradicts → **REPRODUCIBILITY, exit 4** → stop
  fabricating, let the judge compute the number. An honest result that misses the bar or
  fails to beat the classical baseline → **PERFORMANCE, exit 5** → re-design the ansatz /
  re-tune the rotation parameters until the *recomputed* result clears the threshold.
  A circuit that matches the VISIBLE spec but fails the HELD-OUT generalization check →
  **ANTI-OVERFIT, exit 6** → it overfit the part it could see; design to the true target,
  not to the visible spec alone. For the `bell_pops2` demonstrator (task `populations`) a
  wrong-phase |Φ−⟩ impostor reproduces the 50/50 |00⟩/|11⟩ populations and clears
  structure/reproducibility/performance, yet the judge holds out the X-parity ⟨X₀X₁⟩=+1 the
  model was never told and rejects it at exit 6. The model loops on these exit codes until
  the judge ACCEPTs (exit 0) — no human points out the failure first.
- **Dynamic workflows for fan-out**: parallel circuit candidates explored in worktree
  isolation, an adversarial reviewer sub-agent before any "done" claim, fresh verifier runs.
- Failures are kept, not hidden: every self-caught REJECT is autonomy evidence (rubric A3
  requires at least one, cited with transcript timestamps).

### Layer 5 — Measurement (computed, not narrated)
- The raw session transcript is submitted as-is (after a secret scrub).
- **EXAMPLE — computed measurement = the scorecard.** `bin/autonomy-scorecard.mjs` derives
  the judge-facing numbers from the transcript: every human message verbatim with
  classification (course-correction / new-information / **approval-gate** — a bare
  affirmation labeled as the bench working, not steering), longest unattended stretch,
  self-caught failures with timestamps (each judge REJECT the model fixed before a human
  spoke), agents orchestrated, timeline strip. The generator is built TDD and its suite is
  green (`node --test test/scorecard.test.mjs`); judges can rerun it.
- `bin/prepare-transcript.mjs` scrubs secrets and enforces the byte cap before the
  transcript ships public.
- This closes the loop: the discipline in Layer 3 is what makes the Layer 5 numbers good,
  and Layer 5 makes the discipline visible.

## 2. Why this maps to the scoring

| Scoring lens | What they see |
|---|---|
| Impact | A real category gap: constraint-respecting quantum primitives as the building blocks for native quantum-processing architectures for AI inference, beyond today's hybrid IR / classical stack |
| Verifiable result | The proof bundle that ACCEPTs (exit 0) under a fresh re-simulating judge — a machine-checkable verdict, not prose; the committed forgery (`quantum-proof-FORGED.json`) that MUST be rejected at exit 4, and the wrong-phase impostor (`quantum-proof-OVERFIT.json`) that MUST be rejected at the held-out anti-overfit gate (exit 6) |
| Autonomy | Session log: one kickoff, long model-only stretches; interventions classified, approval-gates separated; self-caught judge REJECTs cited with timestamps |
| Orchestration | `BRIEF.md` + `RUBRIC.md` + `VERIFIER-MAP.md` + the bench + saved workflows — the harness IS the artifact, rerunnable on a new problem tomorrow (`RERUN.md`) |

Honesty (H-criteria, the "Honest limits" section, the H4 provenance manifest) is both a
rubric auto-fail and the disqualification line. The manifest must state plainly:
authored-for-this-run = the submitted circuit/bundle(s); pre-built environment =
`bench/quantum-judge/` + the measurement tooling under `bin/`/`lib/`; provenance-in-prose =
derived from the FieldOps Build Day harness *pattern*, seeded FRESH with NO shared git
history (stated, not inherited through commits).

## 3. Operator touchpoints (planned, exhaustive)

1. **Kickoff** — send Appendix A. Start the clock.
2. **Held-out reference relocation** — only in a real contest: point the judge at the
   secret references via `QH_REFERENCES_DIR` before kickoff (one factual, anticipated step,
   not a mid-run ask).

Everything else: watch, don't type. There is no physical-world gate and no product-channel
approval on this bench — the verdict is a local exit code, so the unattended stretch is
bounded only by the problem's difficulty.

## 4. Risk containment (decided in advance so it never needs mid-run debate)

- **numpy-only verification root.** The judge depends on numpy alone; no quantum framework
  can fail to import and break the bench. Optional adapters stay optional.
- **Hidden ground truth, relocatable.** The judge reads the target from
  `references/<problem_id>.json`, NEVER from the bundle, and re-computes `⟨ψ|H|ψ⟩` (vqe) or
  the state overlap (state_prep) itself. The public template commits the references so CI is
  exercisable; a real contest holds them out via `QH_REFERENCES_DIR`. Mislabeling which
  regime is in effect is a disqualification.
- **Five task types, all scored.** state_prep, vqe, populations (state-based circuits),
  architecture (hardware topology design), and classify (QML feature-map classifier) each run
  the full gate stack. The architecture task is fully implemented — it designs a coupling map
  for a workload of two-qubit interactions and is held to a held-out workload. Overclaiming
  any result as a passing verdict is an honesty failure exactly like faking a fidelity.
- **Anti-cheat is regression-pinned.** `quantum-proof-FORGED.json` (omits the 2nd CX, claims
  fidelity 1.0 but is truly 0.25) MUST be rejected at exit 4, and the wrong-phase
  `quantum-proof-OVERFIT.json` impostor MUST be rejected at the held-out anti-overfit gate
  (exit 6); `test_judge.py` holds the line at 29/29 checks. Faking a number — or overfitting
  the visible spec — is caught by the judge, not by trust.

---

## Appendix A — Kickoff message draft

> Sent as the first and ideally only substantive message of the session, in the
> `quantum-harness` repo.

```
Today you are designing constraint-respecting quantum circuits for quantum-harness, a
verifiable-run prompt harness for quantum chip / quantum-processing architecture design.

THE CONTRACT
- Read BRIEF.md and RUBRIC.md in full before any other action. BRIEF.md is the goal;
  RUBRIC.md is the definition of done. You may not stop while any R criterion fails, and
  you may not declare done without a fresh verifier sub-agent (no stake in the design)
  passing EVERY criterion in one run. No conversational claim about a fidelity or energy is
  admissible — only the exit code of a re-run by the judge.

THE ENVIRONMENT (already in place — consult, don't rebuild)
- The bench lives in bench/quantum-judge/: sim.py is a hermetic pure-numpy statevector
  simulator (numpy ONLY at the verification root — Qiskit/Cirq/PennyLane are OPTIONAL
  authoring adapters, never required to verify). judge_verify.py re-simulates a PROOF BUNDLE
  and ACCEPTs (exit 0) or REJECTs via four active gates: STRUCTURE (3), REPRODUCIBILITY (4),
  PERFORMANCE (5), ANTI-OVERFIT (6). It handles five task types: state_prep, vqe, populations
  (state-based circuits), architecture (hardware topology design), and classify (QML feature
  map). The anti-overfit gate is the HELD-OUT generalization check: it fires for problems
  whose hidden reference declares a `holdout` block — a held-out OBSERVABLE (state tasks), a
  held-out WORKLOAD (architecture), or a held-out TEST SET (classify) the model was never
  told — rejecting a design that matches the visible spec but fails the hidden check. For
  problems with no holdout block (ghz3, isingbell2) anti-overfit additionally holds by
  construction (ground truth lives only in the hidden reference), so exit 6 is simply not
  triggered for them. capture.py builds a well-formed bundle from a raw circuit using the SAME
  simulator. test_judge.py is the 29/29 regression line.
- Five worked problems ship with committed reference solutions and committed passing
  bundles: ghz3 (state_prep, linear [0-1-2] coupling, fidelity ≥ 0.99), isingbell2 (vqe,
  H = −X₀X₁ − Z₀Z₁, energy within 0.05 of −2), bell_pops2 (populations — the anti-overfit
  demonstrator: prepare |Φ+⟩ from its 50/50 |00⟩/|11⟩ populations, with ⟨X₀X₁⟩=+1 held out so
  a wrong-phase |Φ−⟩ is rejected at exit 6), aiaccel4 (architecture — design a coupling map
  whose held-out workload must also route within budget, so a ring ACCEPTs while a topology
  overfit to the visible workload is rejected at exit 6), and qml_sign1 (classify — a feature
  map where Ry(x) generalizes to the held-out test set but Ry(7x) overfits and is rejected at
  exit 6). Confirm the bench is green before designing.
- Ground truth (exact target statevector / Hamiltonian terms / thresholds) is HELD OUT in
  references/<problem_id>.json and read by the judge, never from your bundle. Design to the
  TRUE target described in the brief, not to any number you can read in a committed bundle.
- Permissions for python3 (judge + bench + capture), node --test, and the bin/ tooling are
  pre-allowlisted. If a contest provisions QPU credentials, they are in env — reference env
  var names only; never print a credential value.

HOW TO WORK
- Loop on the judge: submit a bundle, read the exit code, fix the circuit, re-submit. On a
  REJECT, re-design the ansatz / re-route around the coupling map / re-tune the parameters
  per the failing gate, then re-submit — do not ask me first. A failure you catch with the
  judge (or test_judge.py, or node --test) before any human points it out is the autonomy
  this harness measures.
- TDD against the bench. Use dynamic workflows for fan-out: parallel circuit candidates in
  worktree isolation, adversarial review before any "done" claim, fresh verifier runs.
- Do not fabricate a claim — the judge recomputes it. The committed quantum-proof-FORGED.json
  MUST be rejected at exit 4; never type a result, let the judge compute it.
- All five task types (state_prep, vqe, populations, architecture, classify) are fully scored:
  never overclaim a result as a passing verdict. Overclaiming is an honesty failure exactly
  like faking a fidelity.
- State limits honestly: the simulator is pure-numpy statevector (no noise model, no shots);
  references are committed in this template but held out in a real contest. Put these in the
  README "Honest limits" section.
- NEVER print a credential value into a command, file, or output — env var names only. The
  transcript ships PUBLIC after a secret scan (prepare-transcript.mjs).

DONE
- Bench-done = all H + R1–R8 + A1–A3 + S1 + S2 in ONE fresh-verifier run: node --test
  test/*.test.mjs is 82/82, python3 bench/quantum-judge/test_judge.py is 29/29, and every
  submitted bundle exits 0 under judge_verify.py (including under a relocated
  QH_REFERENCES_DIR). Submission-done = S3 + S4 + an S1 re-check in a second short run.
- If time runs short, the designated cuts are stretch problems — record the cut in "Honest
  limits" rather than shipping half-working. S-criteria are never cut.

INTERACTION RULES
- I will not steer mid-task. Reply-worthy events only: a rubric ambiguity that genuinely
  cannot be resolved from the documents. Everything else: decide, record the decision,
  proceed.

Begin: orient, then post your plan as a short markdown file (PLAN.md), then go.
```

## Appendix B — What the operator does NOT do

- No mid-run circuit review (the judge + fresh verifier + adversarial workflow do it).
- No "how's it going?" pings (they cost interventions and add nothing).
- No scope additions after kickoff (they go in a post-run retro file → BRIEF.md v2).
- No chat-channel result claims — the verdict is the judge's exit code, not a typed number.

## Appendix C — Model-agnostic by construction

Nothing in this design names a model version as a dependency. The brief, rubric, bench, and
scorecard would grade Opus 4.8, Fable 5, or "Mythos" identically — the judge re-simulates
the same circuits and the scorecard parses the same transcript shape regardless of which
model produced them. As more capable autonomous models arrive, the only change is the model
pointed at the kickoff message; the contract, the friction removal, the self-correction loop,
and the computed measurement are unchanged. That is the whole point of building the harness
as the artifact rather than the run.
```
