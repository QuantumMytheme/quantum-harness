# quantum-harness rubric — every criterion verifiable by a fresh agent, no human

Grader contract: a verifier sub-agent with **no stake in the design** reads this file, the
public BRIEF, the submitted PROOF BUNDLE(s), and the committed bench under
`bench/quantum-judge/`. It returns verdicts only. The builder may not stop while any R
criterion fails. H criteria are honesty: any H failure = overall fail. The verifier must be
**fresh and non-conflicted** — it did not author the circuit and re-derives every claimed
number from scratch on the hermetic simulator. No conversational claim about a result is
admissible; only the exit code of a re-run is.

**Hidden ground truth.** The exact target statevector / Hamiltonian terms / thresholds live
host-side in `bench/quantum-judge/references/<problem_id>.json` — the analog of a signing key
that never enters the sandbox. The model knows the target only CONCEPTUALLY from the BRIEF.
The public template COMMITS the references so CI is exercisable; a real contest HOLDS THEM OUT
and points the judge at them via `QH_REFERENCES_DIR=/secret/refs`. A criterion graded against
a reference is therefore graded against data the builder never saw — this is the anti-overfit
spine, not a courtesy.

**Artifact binding rule.** The builder maintains `VERIFIER-MAP.md` binding EVERY criterion to
its named artifact — exact file path, trigger command, expected exit code, or test name. A
criterion whose artifact is unnamed in the map cannot pass. This is how "two reasonable
verifiers grade identically" is achieved without this rubric hard-coding numbers that belong
to the hidden reference. Each R-criterion below names the **exit code** of
`bench/quantum-judge/judge_verify.py`, a `node --test` assertion, the `test_judge.py`
regression suite, or an emitted metric — nothing grades on prose.

**The four active judge gates** (`judge_verify.py`, run per bundle; first failing gate wins). Each can REJECT with its own exit code:

| gate | exit | what it proves |
|------|------|----------------|
| STRUCTURE       | 3 | circuit parses; respects n_qubits, depth budget, native gate set, coupling map, 2q-gate cap |
| REPRODUCIBILITY | 4 | re-simulating reproduces the CLAIMED number within tolerance (catches fabrication) |
| PERFORMANCE     | 5 | the *recomputed* result meets the rubric threshold AND beats/ties the classical baseline |
| ANTI-OVERFIT    | 6 | held-out generalization check — fires when the problem declares a held-out check the model was never told |
| (other) schema 2 · ACCEPT 0 |||

Anti-overfit is a **live held-out gate**, not a courtesy: for a problem whose reference declares a
`holdout` block, the judge evaluates a hidden observable / target the model was NEVER told and
REJECTS at exit 6 a circuit that matched the VISIBLE spec but fails the held-out check. The
demonstrator is `bell_pops2` (task `populations`): the visible spec is the Z-basis populations
50/50 between |00> and |11>, the judge HOLDS OUT the X-parity `<X0X1> = +1`; the genuine Bell
state |Φ+> ACCEPTs (exit 0) while a wrong-phase |Φ-> impostor that still matches the populations
is REJECTED at exit 6 — having passed structure/reproducibility/performance and failed ONLY the
held-out check. Ground truth always lives ONLY in the hidden reference
(`references/<problem_id>.json`, relocatable via `QH_REFERENCES_DIR`), never in the bundle, and
the circuit IR cannot embed a target state. So for problems that do NOT declare a holdout block
(`ghz3`, `isingbell2`) anti-overfit ALSO holds by construction — a circuit must genuinely build
the state from gates, a number it placed in its own bundle is caught at reproducibility (4) /
performance (5), and exit 6 is simply not triggered for them.

The held-out forms vary by task: a held-out OBSERVABLE (state tasks; e.g. `bell_pops2` holds
out `<X0X1>`), a held-out WORKLOAD (architecture; the topology must also route a second
interaction set within budget), and a held-out TEST SET (classify; the feature map must
classify unseen data). Problems that declare no held-out check hold anti-overfit by construction.

**Five task types.** The judge handles `state_prep`, `vqe`, `populations` (state-based
circuits), `architecture` (a real hardware-TOPOLOGY design task — a coupling map that must route
a workload within budget), and `classify` (a QML feature-map classifier). Each runs its own
STRUCTURE check, then reproducibility, performance, and — when the reference declares a held-out
check — anti-overfit.

---

## H — Honesty (auto-fail)

- [ ] **H1 Nothing fabricated, nothing overclaimed.** Every claimed fidelity/energy in a
      submitted bundle equals what `judge_verify.py` recomputes (exit 0, not exit 4). The
      committed adversarial fixture `quantum-proof-FORGED.json` (omits the 2nd CX, claims
      fidelity 1.0 but is truly 0.25) MUST be rejected at exit 4. Claiming any recomputed number
      a bundle did not earn fails H1 exactly like faking a fidelity.
- [ ] **H2 "Honest limits" section exists and matches reality** (spot-check 3 claims). Must
      state plainly: the simulator is pure-numpy statevector (no noise model, no shots);
      references are committed in the template but held out in a real contest.
- [ ] **H3 Every result artifact is generated by re-running the bench**, not a pre-staged
      number. The verifier re-runs `judge_verify.py` and `test_judge.py` itself; a bundle's
      `claim` block is decorative until the judge recomputes it.
- [ ] **H4 Provenance manifest is accurate.** The README carries a manifest stating: (1)
      **authored for this run** — the submitted circuit/bundle(s); (2) **pre-built
      environment** — `bench/quantum-judge/` (sim, judge, references, test suite) and the
      measurement tooling under `bin/`+`lib/`, disclosed as environment design; (3)
      **provenance in prose** — derived from the FieldOps Build Day harness pattern, seeded
      FRESH with NO shared git history (stated, not inherited through commits). Mislabeling in
      either direction is a disqualification.

## R — The verifiable chain (each independently checkable by exit code or assertion)

- [ ] **R1 — Constraint compliance (STRUCTURE, exit 3).** The submitted circuit parses and
      respects its declared `constraints`: `n_qubits`, `max_depth`, `native_gates`,
      `coupling_map`, and `max_two_qubit_gates`. PASS = `judge_verify.py <bundle>` does not
      exit 3. Regression proof: `test_judge.py` checks 4–8 each force one structural violation
      (off-coupling-map 2q gate, non-native gate, depth over budget, n_qubits mismatch,
      2q-cap exceeded) and require exit 3.
- [ ] **R2 — Reproducibility / honesty (REPRODUCIBILITY, exit 4).** Re-simulating the circuit
      on `sim.py` reproduces the bundle's `claim.fidelity` (state_prep) or `claim.energy`
      (vqe) within the reference tolerance. PASS = no exit 4. The anti-cheat regression:
      `quantum-proof-FORGED.json` and `test_judge.py` check 3 (overclaimed 0.95 fidelity) MUST
      exit 4. A builder cannot type a number; the judge computes it.
- [ ] **R3 — Performance vs threshold AND classical baseline (PERFORMANCE, exit 5).** The
      *recomputed* result meets the hidden-reference threshold (state_prep: `fidelity ≥`
      `thresholds.fidelity`; vqe: `energy − E0 ≤ thresholds.energy_gap`) AND beats/ties the
      bundle's stated `classical_baseline`. PASS = no exit 5. Regression: `test_judge.py`
      check 9 (an honest but underperforming `h;cx` GHZ attempt, true fidelity 0.25 < 0.99)
      MUST exit 5 — meeting reproducibility is not enough; it must also clear the bar and beat
      the classical number.
- [ ] **R4 — Anti-overfit generalization (ANTI-OVERFIT, exit 6).** A live held-out gate.
      For a problem whose reference declares a `holdout` block, the judge evaluates a hidden
      check the model was NEVER told. PASS = ACCEPT (the held-out check passes, exit 0); FAIL =
      exit 6 when a held-out check is declared and the submission fails it. The held-out forms
      are: a held-out OBSERVABLE (state tasks; `bell_pops2` holds out `<X0X1> = +1`), a held-out
      WORKLOAD (architecture; `aiaccel4`'s topology must also route a second interaction set
      within budget), and a held-out TEST SET (classify; `qml_sign1`'s feature map must classify
      unseen data). Worked demonstrators: `bell_pops2` — visible spec is the Z-basis populations
      50/50 between |00> and |11>, held out is `<X0X1> = +1`; the genuine Bell state
      `quantum-proof-pops.json` ACCEPTs (exit 0) while the wrong-phase impostor
      `quantum-proof-OVERFIT.json` passes structure/reproducibility/performance yet is REJECTED at
      exit 6. `aiaccel4` — the ring `quantum-proof-arch.json` ACCEPTs while the overfit topology
      `quantum-proof-arch-OVERFIT.json` exits 6. `qml_sign1` — the Ry(x) map
      `quantum-proof-qml.json` generalizes and ACCEPTs while the Ry(7x) overfit
      `quantum-proof-qml-OVERFIT.json` exits 6. Ground truth always lives ONLY in
      `references/<problem_id>.json`, NEVER in the bundle, and ACCEPTs unchanged when the
      references are relocated via `QH_REFERENCES_DIR` outside the builder's tree. For problems
      that declare no holdout block (`ghz3`, `isingbell2`) anti-overfit holds by construction —
      the IR cannot embed a target, so a bundle-embedded answer is caught at reproducibility (4)
      / performance (5) and exit 6 is simply not triggered.
      Regression: `test_judge.py` proves each overfit fixture exits 6 (and `quantum-proof-OVERFIT.json`
      fails ONLY the held-out gate), while each genuine bundle ACCEPTs.
- [ ] **R5 — Resource efficiency (emitted metrics, within budget).** On ACCEPT, the judge
      emits `checks.structure = {depth, two_qubit_gates, n_qubits}`. PASS = these are present
      AND each is within the bundle's declared budget (`depth ≤ max_depth`,
      `two_qubit_gates ≤ max_two_qubit_gates`). These are reported gate/2q-gate/depth counts a
      verifier can read directly from `--json` output; over-budget is already an exit-3
      failure under R1, so R5 additionally requires the metrics be *emitted and within
      budget*, making efficiency a first-class, machine-read number rather than prose.
- [ ] **R6 — End-to-end ACCEPT on every worked problem (exit 0).** The five committed worked
      bundles pass cleanly: `quantum-proof-poc.json` (ghz3, state_prep → fidelity 1.0),
      `quantum-proof-vqe.json` (isingbell2, vqe → energy −2.0), `quantum-proof-pops.json`
      (bell_pops2, populations), `quantum-proof-arch.json` (aiaccel4, architecture — the ring
      topology), and `quantum-proof-qml.json` (qml_sign1, classify — the Ry(x) feature map) each
      exit 0. Regression: `test_judge.py` asserts each ACCEPTs (exit 0).
- [ ] **R7 — Architecture-design dimension is a real, scored gate (exit 0/3/4/5/6).** A
      bundle with `task: "architecture"` (`aiaccel4`) submits a coupling map that must parse
      (STRUCTURE, exit 3), reproduce its claimed `routing_cost` (exit 4), route the visible
      workload within budget and beat/tie its baseline (PERFORMANCE, exit 5), and route the
      HELD-OUT workload within budget (ANTI-OVERFIT, exit 6). PASS = `quantum-proof-arch.json`
      (ring) ACCEPTs at exit 0 while `quantum-proof-arch-OVERFIT.json` (a topology hand-tuned to
      the visible workload) is REJECTed at exit 6. Regression: `test_judge.py` asserts the ring
      ACCEPTs and the overfit path exits 6 (plus tampered-cost → exit 4, over-budget → exit 5,
      degree-over-budget → exit 3).
- [ ] **R8 — Verifiability of artifacts (bench self-test green, capture round-trips).** The
      whole bench re-derives soundly: `python3 bench/quantum-judge/test_judge.py` reports
      `29/29 checks passed` (exit 0). Within it, the `capture.py` check proves it builds a
      well-formed bundle from a raw circuit using the SAME simulator and that bundle ACCEPTs
      under the judge — so artifacts are reproducible by tool, not hand-authored. Every R
      above is mirrored by a named regression check, so a fresh verifier reproduces every
      verdict.

## A — Autonomy evidence (transcript-computed, never hand-written)

- [ ] **A1 `autonomy-scorecard.html` exists and is generated from the scrubbed session
      transcript** by `bin/autonomy-scorecard.mjs` (not hand-written) and is linked from the
      README. PASS = the file exists, was produced by the tool, and the generator's own suite
      is green (`node --test test/scorecard.test.mjs`).
- [ ] **A2 The scorecard classifies every human intervention** (course-correction /
      new-information / approval-gate) and reports the longest unattended stretch + timeline,
      consistent with the scorecard library's tested classification semantics
      (`test/scorecard.test.mjs`, e.g. bare affirmation = approval-gate, "yes but…" =
      course-correction).
- [ ] **A3 ≥1 failure during the build was caught by the model's own check** (the judge, a
      `node --test` run, or `test_judge.py`) before any human pointed it out — cited with
      transcript timestamps the scorecard surfaces as self-caught failures.

## S — Submission readiness

- [ ] **S1 The repo is PUBLIC, MIT, and contains everything shown**, plus the pre-built
      environment under `bench/quantum-judge/` (sim, judge, references, fixtures, test suite),
      the measurement tooling (`bin/` + `lib/` + `test/`), this RUBRIC.md, VERIFIER-MAP.md, and
      the scrubbed session log. Provenance-from-fieldops is stated in prose (no shared git
      history).
- [ ] **S2 The full measurement suite is green:** `node --test test/*.test.mjs` reports **82
      tests pass, 0 fail** (scorecard + transcript scrub + planner roster/walkthrough).
- [ ] **S3 The committed session log and the entire repo pass a secret scan** (no live keys,
      bearer/deploy tokens); the scorecard was generated from the COMMITTED (scrubbed) log via
      `bin/prepare-transcript.mjs`; no transcript file is oversized (`prepare-transcript`
      enforces the byte cap).
- [ ] **S4 RERUN.md exists** — the one-page "point this harness at a NEW problem tomorrow" doc:
      add `references/<id>.json` (held out), write the BRIEF stanza, submit a bundle, run the
      judge. No view/artifact is display-only: every submission is a re-runnable bundle whose
      verdict is an exit code.

## STRETCH (non-gating — cut without ceremony, record the cut in "Honest limits")

- [ ] **X1 A further problem** (new `problem_id`, held-out reference) is added and a submitted
      bundle ACCEPTs end-to-end under `QH_REFERENCES_DIR`, proving the harness generalizes
      beyond the seeded worked problems. Skipping X1 NEVER fails the run.
- [ ] **X2 A sixth task type** (beyond `state_prep`, `vqe`, `populations`, `architecture`,
      `classify`) is added with its own STRUCTURE / reproducibility / performance / held-out
      gates and a worked bundle. Until then H1/H2 forbid claiming a task the judge does not
      implement.

## Done is a two-stage gate

- **Bench-done** = all H + R1–R8 + A1–A3 + S1 + S2 pass in ONE fresh-verifier run:
  `node --test test/*.test.mjs` is 82/82, `python3 bench/quantum-judge/test_judge.py` is
  29/29, and every submitted bundle exits 0 under `judge_verify.py` (including under a
  relocated `QH_REFERENCES_DIR`).
- **Submission-done** = S3 + S4 pass, plus an S1 re-check, in a second short verifier run.

(If time runs short, X1/X2 are the designated cuts — record the cut in "Honest limits" rather
than shipping it half-working. S-criteria are never cut.)
