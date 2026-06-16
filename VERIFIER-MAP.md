# VERIFIER-MAP — criterion → artifact → exact command → pass condition

Mechanical grading table for `RUBRIC.md`. Two fresh, non-conflicted verifiers running these
commands MUST reach the same verdict. Every R/A/S criterion binds to a `judge_verify.py` exit
code, a `node --test` assertion, the `test_judge.py` regression suite, or an emitted metric.
No criterion grades on prose. A criterion whose artifact is absent here cannot pass.

Run all commands from the repo root `/home/craigm26/quantum-harness`. Reference override for a
live contest: prefix any judge command with `QH_REFERENCES_DIR=/secret/refs`.

## Exit-code legend (`bench/quantum-judge/judge_verify.py`)

The judge handles FIVE task types — `state_prep`, `vqe`, `populations` (state-based circuits),
`architecture` (hardware topology design), `classify` (QML feature-map classifier) — and runs FOUR
active gates, each able to REJECT with its own exit code: STRUCTURE (3), REPRODUCIBILITY (4),
PERFORMANCE (5), ANTI-OVERFIT (6). The ANTI-OVERFIT gate is the HELD-OUT generalization check: it
fires for problems whose hidden reference declares a `holdout` block the model was NEVER told. The
held-out form depends on the task: a held-out OBSERVABLE (state tasks; e.g. `bell_pops2` holds out
`<X0X1>`), a held-out WORKLOAD (architecture; the topology must also route a second interaction set
within budget), or a held-out TEST SET (classify; the feature map must classify unseen data). A
submission that matches the VISIBLE spec but fails the HIDDEN held-out check is REJECTED at exit 6.
For problems that declare no `holdout` block (ghz3, isingbell2), anti-overfit ALSO holds by
construction — ground truth lives only in the hidden reference, never the bundle, and the circuit IR
cannot embed a target state — so exit 6 is simply not triggered for them (an overfit number a model
placed in its own bundle is caught at the reproducibility (4) / performance (5) gates).

`0` ACCEPT · `2` schema/parse · `3` STRUCTURE · `4` REPRODUCIBILITY · `5` PERFORMANCE ·
`6` ANTI-OVERFIT (held-out generalization check — fires when the problem declares a held-out check)

## H — Honesty (auto-fail)

| Crit | Artifact | Exact command | Pass condition |
|------|----------|---------------|----------------|
| H1 | `bench/quantum-judge/quantum-proof-FORGED.json` | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-FORGED.json; echo $?` | exit **4** (claims 1.0, recomputes 0.25) — fabrication rejected |
| H2 | `README` "Honest limits" section | manual read; spot-check 3 claims vs `judge_verify.py` docstring + `sim.py` | states pure-numpy statevector (no noise/shots), refs held-out in contest |
| H3 | `bench/quantum-judge/test_judge.py` | `python3 bench/quantum-judge/test_judge.py; echo $?` | exit **0**, prints `29/29 checks passed` — numbers re-derived, not staged |
| H4 | `README` provenance manifest | manual read | names authored-bundle / pre-built `bench/` env / fresh-seed-from-fieldops (no shared git history) accurately |

## R — Verifiable chain

| Crit | Dimension | Artifact | Exact command | Pass condition |
|------|-----------|----------|---------------|----------------|
| R1 | constraint compliance | submitted bundle + `judge_verify.py:check_structure` | `python3 bench/quantum-judge/judge_verify.py <bundle.json>; echo $?` | **not** exit 3 |
| R1 (regression) | constraint compliance | `test_judge.py` checks 4–8 | `python3 bench/quantum-judge/test_judge.py` | checks "2q gate off coupling map", "non-native gate", "depth over budget", "n_qubits mismatch", "2q-gate cap exceeded" each = exit **3** |
| R2 | reproducibility / honesty | submitted bundle `claim` block | `python3 bench/quantum-judge/judge_verify.py <bundle.json> --json; echo $?` | **not** exit 4; `checks.reproduced` equals `claim` within tolerance |
| R2 (regression) | reproducibility / honesty | `quantum-proof-FORGED.json`; `test_judge.py` check 3 | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-FORGED.json; echo $?` | exit **4** (forged + overclaimed-0.95 both rejected) |
| R3 | performance vs threshold + classical baseline | hidden `references/<id>.json` thresholds + bundle `classical_baseline` | `python3 bench/quantum-judge/judge_verify.py <bundle.json> --json; echo $?` | **not** exit 5; `checks.performance.achieved ≥ threshold` and `≥ baseline` (vqe: `gap ≤ gap_budget` and `energy ≤ baseline`) |
| R3 (regression) | performance | `test_judge.py` check 9 (`h;cx` GHZ, true fid 0.25) | `python3 bench/quantum-judge/test_judge.py` | "honest-but-underperforming circuit" = exit **5** |
| R4 | anti-overfit (held-out generalization) | `references/bell_pops2.json` / `aiaccel4.json` / `qml_sign1.json` (`holdout` block) + the matching OVERFIT fixture | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-OVERFIT.json; echo $?` (also `-arch-OVERFIT`, `-qml-OVERFIT`) | exit **6** — the held-out form is one of three: a held-out OBSERVABLE (state; `bell_pops2` holds out `<X0X1>=+1`), a held-out WORKLOAD (architecture; `aiaccel4` routes a second interaction set), or a held-out TEST SET (classify; `qml_sign1` classifies unseen data); each OVERFIT fixture matches the VISIBLE spec but fails the HIDDEN check |
| R4 (accept) | anti-overfit (genuine generalizes) | `quantum-proof-pops.json` (genuine \|Phi+\>) | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-pops.json; echo $?` | exit **0** — the genuine Bell state passes the held-out `<X0X1>=+1` check; `checks.anti_overfit.passed` true |
| R4 (by construction) | anti-overfit (no holdout block) | relocated `references/` for ghz3 / isingbell2 | `cp -r bench/quantum-judge/references /tmp/qh-refs && QH_REFERENCES_DIR=/tmp/qh-refs python3 bench/quantum-judge/judge_verify.py <bundle.json>; echo $?` | exit **0** with references outside the tree — ground truth read from ref, not bundle; exit 6 not triggered (no held-out block), so an overfit number is caught at gates 4/5 |
| R5 | resource efficiency (gate/2q/depth) | `checks.structure` in judge `--json` output | `python3 bench/quantum-judge/judge_verify.py <bundle.json> --json` | output contains `structure.{depth,two_qubit_gates,n_qubits}`; `depth ≤ max_depth` and `two_qubit_gates ≤ max_two_qubit_gates` |
| R6 | end-to-end worked problems | `quantum-proof-poc.json`, `quantum-proof-vqe.json`, `quantum-proof-pops.json` | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-poc.json; echo $?` and same for `quantum-proof-vqe.json` and `quantum-proof-pops.json` | each exit **0** (ghz3 fid 1.0; isingbell2 energy −2.0; bell_pops2 task `populations`, anti-overfit demonstrator, passes held-out `<X0X1>=+1`) |
| R6 (regression) | end-to-end | `test_judge.py` check 1 | `python3 bench/quantum-judge/test_judge.py` | both "…ACCEPTs (exit 0)" lines PASS |
| R7 | architecture design quality (topology) | `quantum-proof-arch.json` + `references/aiaccel4.json` | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-arch.json; echo $?` | exit **0** — ring topology routes the visible workload within budget AND routes the held-out workload (aiaccel4); the overfit path REJECTs at exit **6** (`quantum-proof-arch-OVERFIT.json`) |
| R7 (regression) | architecture | `test_judge.py` checks "ring topology ACCEPTs", "arch-OVERFIT exit 6", "tampered routing_cost exit 4", "over-budget routing exit 5", "degree-over-budget exit 3" | `python3 bench/quantum-judge/test_judge.py` | each PASS |
| R7b | classify quality (QML feature map) | `quantum-proof-qml.json` + `references/qml_sign1.json` | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-qml.json; echo $?` | exit **0** — the `Ry(x)` low-frequency map generalizes to the held-out test set; the `Ry(7x)` overfit map REJECTs at exit **6** (`quantum-proof-qml-OVERFIT.json`) |
| R7b (regression) | classify | `test_judge.py` checks "low-frequency map ACCEPTs", "qml-OVERFIT exit 6", "tampered train_accuracy exit 4", "under-fit training exit 5" | `python3 bench/quantum-judge/test_judge.py` | each PASS |
| R8 | verifiability of artifacts | full bench self-test + `capture.py` round-trip | `python3 bench/quantum-judge/test_judge.py; echo $?` | exit **0**, `29/29 checks passed`; check "capture.py output ACCEPTs under judge" PASS |

## A — Autonomy evidence (transcript-computed)

| Crit | Artifact | Exact command | Pass condition |
|------|----------|---------------|----------------|
| A1 | `autonomy-scorecard.html` ← `bin/autonomy-scorecard.mjs` | `node bin/autonomy-scorecard.mjs <scrubbed-transcript.jsonl> --out autonomy-scorecard.html` then `node --test test/scorecard.test.mjs` | HTML exists, tool-generated, linked in README; scorecard suite green |
| A2 | scorecard intervention classifier | `node --test test/scorecard.test.mjs` | passes (course-correction / new-information / approval-gate classification + longest-unattended-stretch + timeline) |
| A3 | scorecard self-caught-failure section | inspect generated `autonomy-scorecard.html` | ≥1 self-caught failure cited with transcript timestamp (judge/`node --test`/`test_judge.py` caught it before a human) |

## S — Submission readiness

| Crit | Artifact | Exact command | Pass condition |
|------|----------|---------------|----------------|
| S1 | public MIT repo + `bench/quantum-judge/`, `bin/`, `lib/`, `test/`, `RUBRIC.md`, `VERIFIER-MAP.md`, scrubbed log | `ls bench/quantum-judge RUBRIC.md VERIFIER-MAP.md LICENSE` | all present; LICENSE = MIT; provenance-from-fieldops stated in prose |
| S2 | node measurement suite | `node --test test/*.test.mjs` | **82 tests pass, 0 fail** |
| S3 | secret scan + scrubbed transcript | `node bin/prepare-transcript.mjs <raw.jsonl> --out-dir transcript/` then a `gitleaks`/`trufflehog` scan | no live keys/tokens; scorecard built from committed scrubbed log; no transcript over the byte cap |
| S4 | `RERUN.md` | manual read | one-page new-problem rerun doc (add held-out `references/<id>.json`, BRIEF stanza, submit bundle, run judge) |

## STRETCH (non-gating)

| Crit | Artifact | Exact command | Pass condition |
|------|----------|---------------|----------------|
| X1 | third problem `references/<id>.json` + bundle | `QH_REFERENCES_DIR=/tmp/qh-refs python3 bench/quantum-judge/judge_verify.py <new-bundle.json>; echo $?` | exit **0**; skipping never fails the run |
| X2 | real architecture judge (DONE — now R7) | `python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-arch.json; echo $?` | exit **0** on a valid architecture — R7 grades a passing verdict (routing cost + held-out workload), no longer a stub |

## One-shot bench gate (verifier copy-paste)

```
node --test test/*.test.mjs                                   # expect: 82 pass, 0 fail
python3 bench/quantum-judge/test_judge.py                     # expect: 29/29 checks passed (exit 0)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-poc.json    # expect exit 0
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-vqe.json    # expect exit 0
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-pops.json   # expect exit 0 (genuine Bell, passes held-out check)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-arch.json   # expect exit 0 (architecture, ring routes held-out workload)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-qml.json    # expect exit 0 (classify, low-frequency map generalizes)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-OVERFIT.json # expect exit 6 (anti-overfit: held-out check fails)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-arch-OVERFIT.json # expect exit 6 (architecture overfit visible workload)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-qml-OVERFIT.json  # expect exit 6 (classify overfit training data)
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-FORGED.json  # expect exit 4
```
