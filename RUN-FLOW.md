# Start a design run

Every design run lives in its **own public repository** — a fresh *harnessing*
minted from this template, under **your own GitHub account** (QuantumMytheme org
members can mint into the org instead). That repo becomes the permanent, public,
re-verifiable record of the run.

### 1 · Mint a run repo from this template
- **From the CLI (recommended):** `bin/new-run.sh <run-name>` — creates the repo under
  **your account**, applies the `quantum-harness-run` discovery topic, and clones it.
  Org members may add `--org QuantumMytheme`.
- **On GitHub:** "Use this template" → owner **your account** → visibility **Public**
  → name it for the run (e.g. `run-ghz3-<date>`). Then add the repo topic
  **`quantum-harness-run`** yourself (⚙ next to *About* → Topics) — the template UI
  does not copy topics, and discovery keys on it.

### 2 · Pick or write a BRIEF
Choose a committed problem — `ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`,
`qml_sign1`, `tfim3`, `h2vqe` — or author a new one ([RERUN.md](./RERUN.md)). The BRIEF states the
problem *conceptually*; the hidden reference stays host-side.

### 3 · Run the kickoff prompt
Point your capable model — your Claude subscription, or API / token credits — at
[KICKOFF.md](./KICKOFF.md). The model designs the artifact and self-corrects
against the rubric until the judge **ACCEPTs**.

### 4 · Commit the run's output back to your run repo
```sh
# the proof bundle the model produced + its verdict, the scrubbed transcript, the scorecard
python3 bench/quantum-judge/judge_verify.py my-bundle.json          # expect exit 0
node bin/prepare-transcript.mjs <session.jsonl> --out-dir transcript # scrub secrets
node bin/autonomy-scorecard.mjs <session.jsonl> --out scorecard.html # autonomy evidence
git add -A && git commit -m "run: <problem> — judge ACCEPT, scorecard attached"
git push
```

### 5 · Register it on the board — tag and crawl, no PR needed
Two things put your run on the live scoreboard (**org membership NOT required** —
the crawler finds tagged repos wherever they live):

1. the GitHub topic **`quantum-harness-run`** on your run repo (auto-applied by
   `bin/new-run.sh`; add it manually if you minted via the GitHub UI), and
2. a **`scoreboard-entry.json`** at the repo root — minimal example inline in
   [GETTING-STARTED.md](./GETTING-STARTED.md) §3.

The discovery crawler ingests tagged repos and a **fail-closed re-judge gate**
(`scoreboard/verify.py`) re-derives every entry's metric against the canonical
hidden references before it ranks — nothing is trusted on say-so. No human scores
correctness, and anyone can re-run `judge_verify.py` on your committed bundle and
get the same verdict. *(A PR from your run repo into the catalog still works as an
alternative — the judge is the merge gate ([CONTRIBUTING.md](./CONTRIBUTING.md));
the aggregator merges both paths.)*

---
This is the citizen-science loop: **mint a public repo → bring your own model →
inject your parameters → run against the bench → commit the verified result.**
See the live, in-browser showcase of the bench in [`viewer/`](./viewer/index.html).
