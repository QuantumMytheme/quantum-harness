# Start a design run

Every design run lives in its **own public repository** in the QuantumMytheme org —
a fresh *harnessing* minted from this template. That repo becomes the permanent,
public, re-verifiable record of the run.

### 1 · Mint a run repo from this template
- **On GitHub:** "Use this template" → owner **QuantumMytheme** → visibility **Public**
  → name it for the run (e.g. `run-ghz3-2026-06-16`).
- **From the CLI:** `bin/new-run.sh <run-name>` (wraps `gh repo create --template`).

### 2 · Pick or write a BRIEF
Choose a committed problem — `ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`,
`qml_sign1` — or author a new one ([RERUN.md](./RERUN.md)). The BRIEF states the
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

### 5 · (Optional) submit it to the directory
Open a PR from your run repo's bundle into the catalog; **the judge is the merge
gate** ([CONTRIBUTING.md](./CONTRIBUTING.md)). No human scores correctness — anyone
can re-run `judge_verify.py` on your committed bundle and get the same verdict.

---
This is the citizen-science loop: **mint a public repo → bring your own model →
inject your parameters → run against the bench → commit the verified result.**
See the live, in-browser showcase of the bench in [`viewer/`](./viewer/index.html).
