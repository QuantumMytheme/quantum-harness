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
`ghz3`, `isingbell2`, `bell_pops2`, `aiaccel4`, `qml_sign1`, `tfim3` — or write a
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

That's the flywheel: **remix prior runs → model molds → judge verifies → auto-register → (optionally) validate on silicon → the next person remixes yours.**
- **Cost to participate:** your model (and an optional ~$0–$1 chip run). 
- **Cost to host:** ~nothing — GitHub + a static page. Open source, by design.

New here? Read **[README.md](README.md)** for what the bench checks, **[RUN-FLOW.md](RUN-FLOW.md)**
for the run lifecycle, and **[SCOREBOARD.md](SCOREBOARD.md)** for how ranking works.
