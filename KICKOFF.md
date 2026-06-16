# KICKOFF — one quantum design run (reusable template)

> Paste as the FIRST and only substantive message of an autonomous session, at your
> strongest effort, in the **QuantumMytheme/quantum-harness** repo. Set the GOAL below
> with `/goal` so it survives compaction. This template is **model-agnostic**: it works
> for Opus 4.8 today and is built to be READY for Fable 5 / "Mythos" when they arrive.
> One run = one `<problem_id>`. Fill the `«placeholders»`. A filled-in `ghz3` example is
> at the bottom; copy it and edit.
>
> The harness pattern (reused verbatim across domains): a goal CONTRACT that binds every
> criterion to a check, FRICTION REMOVAL (allowlisted commands, deps preinstalled),
> ONE-KICKOFF + SELF-CORRECTION (a fresh non-conflicted verifier grades and you loop until
> green), a VERIFIABLE BENCH (the judge), and COMPUTED MEASUREMENT (the autonomy scorecard
> off the raw transcript). This file is part 1 (the CONTRACT) for a single run.

---

## GOAL (set with `/goal` at kickoff — one sentence, persistent anchor)

> Verbatim, one sentence. Name the problem, the task type, the binding threshold, and that
> DONE = judge ACCEPT + `node --test` green + scorecard generated.

Produce a **PROOF BUNDLE** for `«problem_id»` (task `«state_prep | vqe | populations | architecture | classify»`) that the bench
judge ACCEPTs — a circuit meeting `«the BRIEF's stated target, conceptually»` under its
constraints and beating the classical baseline — with DONE = `judge_verify.py` exits 0 on
the bundle, `node --test test/*.test.mjs` green, and an autonomy scorecard generated from
the scrubbed transcript.

---

## THE PROBLEM + CONSTRAINTS (fill these in)

> You know the target **conceptually** from this BRIEF. The EXACT target statevector /
> Hamiltonian + numeric thresholds live host-side with the judge in
> `bench/quantum-judge/references/«problem_id».json` — the analog of a signing key that
> never enters the sandbox. In a live contest those references are HELD OUT (judge runs
> with `QH_REFERENCES_DIR` pointed elsewhere); in this public template they are committed
> so CI is exercisable. Do not reverse-engineer the held-out numbers; design to the concept
> and let the judge confirm.

- **problem_id:** `«problem_id»`
- **task:** `«state_prep | vqe | populations | architecture | classify»`  (all five are runnable design targets)
- **Target (conceptual):** `«e.g. "the 3-qubit GHZ state" / "the ground state of H = -X0X1 - Z0Z1"»`
- **Constraints (must hold or STRUCTURE rejects, exit 3):**
  - `n_qubits` = `«N»`
  - `max_depth` = `«D»`
  - `native_gates` ⊇ every gate you emit = `«[h, cx, rz, rx, ry, sx, x, cz, ...]»`
  - `coupling_map` = `«[[i,j], ...]»` — every 2-qubit op's qubits must be an allowed pair
  - `max_two_qubit_gates` = `«K»`
- **Threshold (PERFORMANCE, exit 5):** `«fidelity ≥ 0.99»` *(state_prep)* **or**
  `«energy ≤ E0 + energy_gap»` *(vqe)* — AND you must beat-or-tie the classical baseline.
- **Classical baseline to beat:** `«fidelity 0.5 / energy -1»` with a one-line `note`.

**Available gates** (hermetic pure-numpy simulator, qubit 0 = most-significant index):
`x y z h s sdg t tdg sx sxdg rx ry rz p` (1q); `cx cz cy swap crz cp rzz` (2q); `ccx` (3q).
**numpy is the ONLY dependency at the verification root** — Qiskit/Cirq/PennyLane are
optional authoring adapters, never required to verify. Runs offline on a laptop, in CI, or
on a Raspberry Pi.

### PROOF BUNDLE schema — `quantum-harness/proof-bundle@1`

```json
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "«problem_id»",
  "task": "«state_prep | vqe | populations»",   // this circuit shape; architecture/classify use their own (see worked examples)
  "circuit": { "n_qubits": «N», "ops": [ { "gate": "«g»", "q": [«...»], "params": [«...»] } ] },
  "constraints": {
    "n_qubits": «N», "max_depth": «D»,
    "native_gates": [«...»], "coupling_map": [[«i»,«j»]], "max_two_qubit_gates": «K»
  },
  "claim": { "fidelity": «f» }      // state_prep   —  OR  —  "claim": { "energy": «e» }   // vqe
  ,"classical_baseline": { "fidelity": «b», "note": "«why»" }   // key matches the task
  ,"meta": {}
}
```

`params` is omitted for non-parametric gates and required for `rx ry rz p crz cp rzz`.
Build the bundle by hand or with `capture.py`, which fills `claim` from the SAME simulator
the judge uses (so a hand-typed `claim` can never silently drift from the circuit).

---

## THE BENCH COMMAND THAT PROVES IT

The judge re-simulates your circuit deterministically and runs **four active gates**;
any one failing REJECTs with a distinct exit code:

| exit | gate | meaning |
|---|---|---|
| 0 | — | **ACCEPT** |
| 2 | schema | bundle malformed / wrong `schema` string |
| 3 | STRUCTURE | violates `n_qubits` / `max_depth` / a non-native gate / off-coupling-map 2q op / over the 2q cap |
| 4 | REPRODUCIBILITY | your `claim` number does not match the re-simulated value (catches fabrication) |
| 5 | PERFORMANCE | meets neither the threshold NOR beats/ties the classical baseline |
| 6 | ANTI-OVERFIT | held-out generalization check (fires when the problem declares a held-out check) — a design that matches the visible spec but fails the hidden held-out observable/workload/test set is rejected |

```bash
# (optional) author a well-formed bundle from a circuit, claim filled by the simulator:
python3 bench/quantum-judge/capture.py <circuit.json> «problem_id» --task «state_prep|vqe|populations» > my-proof.json
# (architecture and classify bundles are authored directly — see the bench README for their shapes)

# the one command that decides the run — exit 0 = ACCEPT:
python3 bench/quantum-judge/judge_verify.py my-proof.json ; echo "EXIT=$?"

# the regression harness must stay 29/29 (accepts the worked examples; rejects every forgery and the held-out overfit):
python3 bench/quantum-judge/test_judge.py

# the committed adversarial fixture MUST reject at exit 4 (claims fidelity 1.0, truly 0.25):
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-FORGED.json ; echo "EXPECT 4, GOT $?"
```

> A live contest sets `QH_REFERENCES_DIR=/path/to/held-out` before `judge_verify.py` so the
> ground truth never enters the sandbox; the public template uses the committed
> `references/` so anyone can run CI. The judge reads ground truth ONLY from that hidden
> reference and never from the bundle, and the circuit IR cannot embed a target state — so
> a bundle must genuinely build the state from gates and the judge re-derives every claimed
> number. The **ANTI-OVERFIT (6)** gate is live and tested: for a problem whose reference
> declares a `holdout` block, the judge also checks a held-out observable/target the model
> was NEVER told — a circuit that matches the visible spec but fails the hidden check is
> REJECTED at exit 6 (see the `bell_pops2` demonstrator below). For problems that declare no
> `holdout` block (e.g. `ghz3`, `isingbell2`), anti-overfit additionally holds **by
> construction** — a number a model "overfits" into its own bundle is caught at the
> REPRODUCIBILITY (4) / PERFORMANCE (5) gates, and exit 6 is simply not triggered. Never edit
> `references/` to make a bundle pass.

---

## DEFINITION OF DONE (all three, no exceptions)

1. **Judge ACCEPTs** — `python3 bench/quantum-judge/judge_verify.py <your-bundle>.json`
   exits **0**, AND the regression suite `python3 bench/quantum-judge/test_judge.py` is
   still **29/29** (you did not weaken a gate to pass).
2. **Tests green** — `node --test test/*.test.mjs` passes (**82 tests**: scorecard +
   transcript scrub + planner roster/walkthrough). A red measurement harness invalidates
   the autonomy claim.
3. **Scorecard generated** — run the transcript through the scrub, then the scorecard:
   ```bash
   node bin/prepare-transcript.mjs <raw-transcript> > scrubbed.json   # secret scrub FIRST (transcript ships public)
   node bin/autonomy-scorecard.mjs scrubbed.json > scorecard.json     # intervention class, longest unattended stretch, self-caught failures, timeline
   ```
   The scorecard is COMPUTED MEASUREMENT off the **scrubbed** log — never the raw one.

Stop only when all three hold. Never declare done on a partial gate; never edit the judge,
the references, or a test to manufacture green.

---

## ONE-KICKOFF + SELF-CORRECTION DISCIPLINE

- **One kickoff.** This message is the whole instruction. Plan a workflow for the design
  loop; don't go turn-by-turn waiting for me. I will not steer mid-run.
- **The judge is the fresh, non-conflicted verifier.** It has no stake in your circuit and
  re-simulates from scratch. Treat its exit code as the verdict and **loop**: design →
  `judge_verify.py` → read the failing gate → fix the specific cause → re-run. The exit
  code tells you which gate to attack:
  - **3** redesign for the constraint (route 2q gates onto the `coupling_map`, cut depth/2q
    count, swap a non-native gate for an allowed decomposition).
  - **4** your `claim` is fabricated or drifted — recompute it from the simulator (use
    `capture.py`) and make the circuit actually achieve it.
  - **5** the circuit is honest but too weak — improve the ansatz / preparation until it
    crosses the threshold AND beats the baseline.
  - **6** you matched the visible spec but failed the HELD-OUT check — fix the design, not
    the number. You overfit the part of the problem you could see; rebuild the circuit so it
    also satisfies the hidden held-out observable/target (e.g. for `bell_pops2`, get the Bell
    *phase* right, not just the populations).
- **Self-caught failures are the autonomy evidence.** Keep them in the transcript; don't
  hide a rejection and retry silently. The scorecard reads your self-corrections from the
  log.
- **Reply-worthy events only:** (1) a bench/environment blocker you cannot work around,
  (2) a genuine BRIEF/constraint ambiguity unresolvable from the documents — propose your
  reading when you raise it. Everything else: decide, record it, proceed.

---

## FILLED-IN EXAMPLE — `ghz3` (copy, then edit for your problem)

**Problem.** Prepare the **3-qubit GHZ state** (task `state_prep`) under a **linear
[0-1-2] coupling map**. Threshold fidelity **0.99**; classical baseline **0.5** (the best
unentangled product state overlaps GHZ at 0.5). Reference solution: `h q0; cx 0,1; cx 1,2`
→ fidelity **1.0**.

**Bundle** (`bench/quantum-judge/quantum-proof-poc.json`, committed):

```json
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "ghz3",
  "task": "state_prep",
  "circuit": { "n_qubits": 3, "ops": [
    { "gate": "h",  "q": [0] },
    { "gate": "cx", "q": [0, 1] },
    { "gate": "cx", "q": [1, 2] }
  ]},
  "constraints": {
    "n_qubits": 3, "max_depth": 6,
    "native_gates": ["h", "cx", "rz", "rx", "ry", "sx", "x", "cz"],
    "coupling_map": [[0, 1], [1, 2]],
    "max_two_qubit_gates": 4
  },
  "claim": { "fidelity": 1.0 },
  "classical_baseline": { "fidelity": 0.5, "note": "best unentangled product state overlaps GHZ at 0.5" },
  "meta": { "note": "linear-chain GHZ respecting the [0-1-2] coupling map" }
}
```

**Why it passes each gate.** STRUCTURE: depth 3 ≤ 6, two `cx` ≤ 4, both `cx` use pairs in
the coupling map, every gate is native. REPRODUCIBILITY: re-simulating against the hidden
GHZ reference yields fidelity 1.0 = the claim. PERFORMANCE: 1.0 ≥ 0.99 threshold AND > 0.5
baseline. ANTI-OVERFIT: `ghz3` declares no `holdout` block, so the exit-6 gate is not
triggered here — anti-overfit holds by construction, since the fidelity is re-derived from
the gates against the held-out reference and never read from the bundle. → **ACCEPT (exit 0).**

```
$ python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-poc.json ; echo "EXIT=$?"
ACCEPT  problem=ghz3 task=state_prep
  structure: {'depth': 3, 'two_qubit_gates': 2, 'n_qubits': 3}
  reproduced: {'fidelity': 1.0}
  performance: {'threshold': 0.99, 'baseline': 0.5, 'achieved': 1.0}
EXIT=0
```

**Contrast — the forgery (`quantum-proof-FORGED.json`).** Drops the second `cx` so the true
fidelity is 0.25 but still claims 1.0. The judge re-simulates, finds 0.25 ≠ 1.0, and
REJECTs at **exit 4** — the anti-cheat regression. Your bundle must never resemble it.

**A second shape — `isingbell2` (task `vqe`).** Ground state of `H = -X0X1 - Z0Z1` (n=2),
true `E0 = -2` (a Bell state), product/classical baseline `-1`, `energy_gap` budget `0.05`.
Reference solution `h q0; cx 0,1` → energy `-2`; the `claim`/`classical_baseline` key is
`energy`, not `fidelity`.

**The anti-overfit demonstrator — `bell_pops2` (task `populations`).** The VISIBLE spec is a
Z-basis population distribution: prepare the Bell state |Φ+⟩ with 50/50 weight on `|00⟩` and
`|11⟩` (the `claim`/`classical_baseline` key is `populations`). Many circuits satisfy that
distribution, so the reference HOLDS OUT the X-parity `<X0X1> = +1` — a phase the model was
never told. The genuine |Φ+⟩ (`quantum-proof-pops.json`, `h q0; cx 0,1`) ACCEPTs (exit 0); a
wrong-phase impostor |Φ−⟩ that still matches the populations (`quantum-proof-OVERFIT.json`)
passes STRUCTURE / REPRODUCIBILITY / PERFORMANCE and is REJECTED at **exit 6** — it failed
ONLY the held-out check. This is the live worked example of the ANTI-OVERFIT gate.

```
$ python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-OVERFIT.json ; echo "EXIT=$?"
REJECT [6]: held-out <XX> = -1.0000 != expected 1.0000 (tol 0.02); the circuit matched the visible spec but failed the hidden held-out check
EXIT=6
```

**An architecture shape — `aiaccel4` (task `architecture`).** Design a 4-qubit hardware
**coupling map** (topology) that routes a VISIBLE two-qubit workload under a `max_degree ≤ 2`
budget. The bundle is `{ "architecture": { "n_qubits", "coupling_map" }, "constraints": {
"max_degree", "connected" }, "claim": { "routing_cost" } }`; the reference holds out a SECOND
workload that the same topology must also route within budget. A ring
(`quantum-proof-arch.json`) routes both cheaply and ACCEPTs (exit 0); a topology overfit to the
visible pairs (`quantum-proof-arch-OVERFIT.json`) blows the held-out cross-pair budget and is
REJECTED at **exit 6** — the held-out WORKLOAD is the anti-overfit teeth here.

**A classify shape — `qml_sign1` (task `classify`).** Design a quantum **feature map** that
classifies a VISIBLE training set. The bundle is `{ "feature_map": { "n_qubits", "ops":
[{gate,q,feature?,scale?,params?}] }, "readout": { "pauli", "bias" }, "claim": {
"train_accuracy" } }`; a feature-bound op uses `{"feature": idx, "scale": s}` so its angle =
`s * x[idx]`. The reference holds out a TEST set. A low-frequency map `Ry(x)`
(`quantum-proof-qml.json`) generalizes and ACCEPTs (exit 0); a high-frequency `Ry(7x)`
(`quantum-proof-qml-OVERFIT.json`) nails the training points but misclassifies the held-out
test and is REJECTED at **exit 6** — the textbook train-vs-test overfit guard.

---

Begin: orient (this KICKOFF, the BRIEF, the target concept, the constraints and schema
above), post a short PLAN for the design loop, then design → `judge_verify.py` → fix until
all three DONE conditions hold.
