# Getting started — your first run in three commands

The whole point: **runs compound.** You start from the best designs already on the board,
your model molds them into something better, the judge verifies it, and it auto-registers —
ready for the next person to remix. Free to participate (bring your own model), free to host.

## 1 · Mint a run and pull in the frontier

```sh
git clone https://github.com/QuantumMytheme/quantum-harness && cd quantum-harness
bin/new-run.sh my-tfim3-run --remix tfim3
```

This mints a fresh **public** run repo **under your own GitHub account** (no org
membership needed — QuantumMytheme members can opt in with `--org QuantumMytheme`),
writes **`INGREDIENTS.md`** (the current best designs for `tfim3`, with their actual
circuits), and tags it `quantum-harness-run` for auto-discovery. Pick any problem:
`ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`, `qml_sign1`, `tfim3`, `h2vqe` — or write a
new BRIEF.

## 2 · Let your model remix and beat the frontier

Point your capable model — your Claude subscription, or API / token credits (Opus 4.8,
Fable 5, Mythos) — at **`INGREDIENTS.md` + `KICKOFF.md`**. It combines the prior designs
into a better one and self-corrects against the bench until:

```sh
python3 bench/quantum-judge/judge_verify.py your-bundle.json   # -> ACCEPT, exit 0
```

The judge re-simulates from scratch (numpy only, offline) — it can't be fooled. Tie the top
metric with fewer gates, or push it lower, and you take rank 1.

## 3 · Commit, and it auto-registers

```sh
# add your proof bundle + a scoreboard-entry.json (minimal example below)
git add -A && git commit -m "run: <problem> — beats the frontier" && git push
```

Registration needs exactly two things in your public run repo — **works from any
GitHub account, org membership NOT required**:

1. the GitHub **topic `quantum-harness-run`** (`bin/new-run.sh` applies it for you;
   otherwise: repo page → ⚙ next to *About* → Topics, or
   `gh repo edit <you>/<repo> --add-topic quantum-harness-run`), and
2. a **`scoreboard-entry.json`** at the repo root. Minimal example:

```json
{
  "problem_id": "tfim3",
  "task": "vqe",
  "paradigm": "QAOA p=2 (rzz couplers + rx mixer)",
  "paradigm_short": "qaoa",
  "model": "opus-4.8",
  "verified_metric": { "name": "energy_gap_to_E0", "value": 0.000103 },
  "resource_costs": { "two_qubit_gates": 4, "depth": 7, "n_qubits": 3 },
  "run_repo": "https://github.com/<you>/my-tfim3-run",
  "proof_bundle": "quantum-proof-tfim3.json",
  "judge_exit": 0,
  "why_it_scores": "one honest sentence on why this design ranks"
}
```

Set `model` to what you actually pointed at the BRIEF (provenance only — never a
ranking key). The discovery crawler finds tagged repos, and a **fail-closed re-judge
gate** (`scoreboard/verify.py`) re-derives your metric against the hidden references
before anything lands on the **[live board](https://quantummytheme.com/#scoreboard)** —
a wrong or inflated entry is dropped, not ranked. No PR to anyone's repo required
(a PR into the catalog still works too, if you prefer; the aggregator merges both).

## Optional · Run it on a real chip

Have a quantum computer, or rent one (often **free / under a dollar** — see **[ACCESS.md](ACCESS.md)**)?
Overlay a real-hardware result:

```sh
python3 bench/quantum-judge/run_on_hardware.py your-bundle.json --backend ibm:<device> --shots 4096 > hw.json
python3 bench/quantum-judge/hardware_report.py hw.json     # re-verify the metric from your counts
```

Add it to your entry's `hardware_reports` and it shows as a **⚛ overlay** on the board.

---

## The full run lifecycle — five steps in detail

Every design run lives in its **own public repository** — a fresh *harnessing* minted from
this template, under **your own GitHub account** (QuantumMytheme org members can mint into
the org instead). That repo becomes the permanent, public, re-verifiable record of the run.

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
the crawler finds tagged repos wherever they live): the `quantum-harness-run` topic
and a `scoreboard-entry.json` at the repo root (minimal example in §3 above).

The discovery crawler ingests tagged repos and a **fail-closed re-judge gate**
(`scoreboard/verify.py`) re-derives every entry's metric against the canonical
hidden references before it ranks — nothing is trusted on say-so. No human scores
correctness, and anyone can re-run `judge_verify.py` on your committed bundle and
get the same verdict. *(A PR from your run repo into the catalog still works as an
alternative — the judge is the merge gate ([CONTRIBUTING.md](./CONTRIBUTING.md));
the aggregator merges both paths.)*

This is the citizen-science loop: **mint a public repo → bring your own model →
inject your parameters → run against the bench → commit the verified result.**
See the live, in-browser showcase of the bench in [`viewer/`](./viewer/index.html).

---

That's the flywheel: **remix prior runs → model molds → judge verifies → auto-register → (optionally) validate on silicon → the next person remixes yours.**
- **Cost to participate:** your model (and an optional ~$0–$1 chip run). 
- **Cost to host:** ~nothing — GitHub + a static page. Open source, by design.

New here? Read **[README.md](README.md)** for what the bench checks and
**[SCOREBOARD.md](SCOREBOARD.md)** for how ranking works.
