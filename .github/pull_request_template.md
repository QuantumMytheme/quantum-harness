## What this changes

<!-- one line -->

## Checklist (CI re-runs all of this as the merge gate)

- [ ] `node --test test/*.test.mjs` — 82/82
- [ ] `python3 bench/quantum-judge/test_judge.py` — 29/29
- [ ] `python3 scoreboard/verify.py` — every entry ACCEPTs and its metric matches the judge
- [ ] `node scoreboard/build.mjs` — regenerated `viewer/scoreboard-data.js` and committed it

## Registering a scoreboard entry?

Add your row to **`scoreboard/entries.json`**, run `node scoreboard/build.mjs`, and commit the
regenerated `viewer/scoreboard-data.js`. Your `proof_bundle` must live in a **public run repo**
and ACCEPT under the judge — CI fetches it, re-runs `judge_verify.py` against the canonical hidden
references, and checks the metric you report **matches the judge's recompute** (no rank overclaim).

```jsonc
{
  "problem_id":      "ghz3",
  "task":            "state_prep",
  "paradigm":        "your design approach (full sentence)",
  "paradigm_short":  "short-tag",
  "model":           "opus-4.8",                 // what you pointed at the BRIEF (provenance only)
  "verified_metric": { "name": "fidelity", "value": 1.0, "threshold": 0.99, "classical_baseline": 0.5 },
  "resource_costs":  { "two_qubit_gates": 2, "depth": 3, "n_qubits": 3 },  // copy the judge's checks.structure
  "run_repo":        "https://github.com/<you>/<run-repo>",
  "run_branch":      "main",
  "proof_bundle":    "path/to/your-bundle.json",  // within run_repo
  "judge_exit":      0,
  "why_it_scores":   "one line — why this design earns its rank"
}
```

The judge re-simulates regardless of author: **`model` is provenance, never a ranking key.**
See [SCOREBOARD.md](../SCOREBOARD.md) for the ranking rules and [RUN-FLOW.md](../RUN-FLOW.md) to do a run.
