# Measuring what the model did — the autonomy scorecard design

We score Autonomy **from the session log**: how many times did humans intervene mid-task,
and were interventions course-corrections or new information? When something broke, did the
model catch it itself? And we want the impact provable: a verifiable quantum-design result
plus the autonomy with which it was reached. So the measurement must be **computed from the
transcript, not narrated** — and the *result* must be machine-checked by the judge, not
asserted.

## Source of truth

Claude Code session transcripts: `~/.claude/projects/<project-dir>/*.jsonl` — every user
message, assistant turn, tool call/result, subagent, and workflow run, timestamped. A
contest session is submitted raw; the scorecard is derived from it by a script a judge can
rerun. Pair it with the proof bundle the run produced and the judge's verdict
(`judge_verify.py` exit code) so the *what* and the *how-autonomously* are inspectable
side by side.

## The scorecard (one HTML page, auto-generated)

`bin/autonomy-scorecard.mjs <transcript.jsonl...> → autonomy-scorecard.html`
(it is environment/measurement, not a deliverable — it grades the run, it is not the run)

| Metric | How computed | Why it matters |
|---|---|---|
| Interventions | Count of human messages after kickoff; each listed verbatim with timestamp | The headline Autonomy number |
| Intervention class | Heuristic + hand-tag pass: course-correction / new-information / **approval-gate** | Approval-gate clicks are the harness working as designed (HITL where wanted) — labeling them separately is the difference between "needed steering" and "demonstrated governance" |
| Longest unattended stretch | Max gap between human messages with assistant/tool activity inside it | "Ran long stretches without steering" |
| Self-caught failures | Tool results containing errors/test failures (or a judge REJECT) followed by a model fix BEFORE the next human message; each cited with timestamps | "Did the model catch it itself?" |
| Verifier activity | Subagent/workflow runs whose prompt matches the verifier contract; `judge_verify.py` ACCEPT/REJECT verdicts over time | Proves the rubric loop ran against the real judge |
| Scale | Tokens, tool calls, subagents, workflow agents, wall-clock | The "powerful" story in one row |
| Timeline strip | Horizontal bar: model activity vs. human touchpoints | The single most legible artifact on a projector |

The script borrows transcript parsing for tokens/subagents/skills, adds the
intervention/self-caught lenses, and outputs the one-pager. The full session-report HTML is
linked as the deep-dive appendix.

## The engine (what backs these numbers)

- `node --test test/*.test.mjs` → **82 tests green** (scorecard classification + transcript
  scrub + planner roster/walkthrough). This is the regression spine for the measurement
  layer; if the scorecard logic drifts, these go red.
- `bin/autonomy-scorecard.mjs` parses a session transcript → intervention classification,
  longest unattended stretch, self-caught failures, timeline.
- `bin/prepare-transcript.mjs` scrubs secrets before a transcript is published.

The autonomy layer measures *the run*; the **judge** (`bench/quantum-judge/judge_verify.py`,
re-simulating against held-out references) decides whether the run's quantum result is real.
A high autonomy score on a bundle the judge REJECTs is not a win — autonomy is only credited
for runs that reach a green verdict.

## What the classes look like in this domain

These are illustrative of the *kinds* of events the scorecard tags; the script tags them
from the transcript, not from this list.

**Interventions** (human messages after kickoff — each costs one):
- *course-correction* — operator re-tuned an optimizer (e.g. tightened the VQE convergence
  tolerance or step size after a stall).
- *course-correction* — operator told the model to switch ansatz family (e.g. away from a
  hardware-efficient ansatz that wasn't reaching the `isingbell2` ground-state energy).
- *new-information* — operator relaxed a depth budget / `max_depth` constraint so a deeper
  circuit was admissible under the structure gate.
- *approval-gate* — operator confirmed a constraint change through the contract, not the
  chat; the harness working as designed, scored separately from steering.

**Self-caught failures** (model recovered before any human message):
- The judge **REJECTed on REPRODUCIBILITY** (exit 4 — the claimed fidelity didn't recompute
  from the circuit) and the model **re-derived** the circuit and re-ran `judge_verify.py` to
  a clean ACCEPT — no human in the loop.
- The model detected an **optimizer plateau** (energy not improving toward the `isingbell2`
  target within the `energy_gap` budget) and **re-seeded / restarted** the optimization
  before any operator noticed.
- A STRUCTURE reject (exit 3 — circuit violated the linear `[0-1-2]` coupling map on
  `ghz3`, or blew the `max_two_qubit_gates` cap) caught by the model, which re-routed the
  two-qubit gates and re-verified itself.

## Presentation stack (what's actually shown)

1. **Live run**: kickoff → the model authors a circuit → `capture.py` builds the bundle →
   `judge_verify.py` returns a green verdict, with the self-correction loop visible.
2. **One page**: the timeline strip + 4 numbers (interventions, longest unattended stretch,
   self-caught failures, agents orchestrated) — alongside the judge ACCEPT/REJECT verdict.
3. **Judge-inspectable**: the public repo — `BRIEF.md`, `RUBRIC.md`, the `bench/quantum-judge/`
   spine, `bin/autonomy-scorecard.mjs`, `autonomy-scorecard.html`, and the raw (scrubbed)
   session log. Anyone can rerun the judge and the scorecard.

## Discipline during the run (so the numbers are real)

- One kickoff message carries the whole brief; afterwards reply ONLY when the model is
  blocked on the operator (approval gates, credentials) — every extra message costs an
  intervention.
- All steering that can be pre-decided goes in `BRIEF.md`/`RUBRIC.md` before kickoff — the
  problem, the constraints, the thresholds the model is aiming for conceptually.
- Approval-gate interactions happen through the contract/harness, not the chat, wherever
  possible — then they aren't chat interventions at all.
- Don't pause/resume the session casually; gaps read as human absence either way, but a
  clean single session is the strongest log.
- Let the judge be the corrector. When a bundle is REJECTed, resist explaining the fix in
  chat — a self-caught recovery (model reads the exit code, re-derives, re-verifies) is
  worth more to the score than a steered one.
</content>
</invoke>
