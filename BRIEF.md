# Session Brief — quantum-harness (first runnable session)

> The brief a highly-capable autonomous model receives at kickoff. Per the harness rules:
> clear problem, who it's for, what done looks like — then minimal interaction. The model
> designs; a fresh, non-conflicted judge recomputes every number and returns a verdict.
> DRAFT v1 (2026-06-15).

## Problem

Design constraint-respecting quantum artifacts that hit a target the judge can re-derive: a
circuit that **prepares a declared target state** (`state_prep`) or one that **minimizes the
energy of a declared Hamiltonian** (`vqe`), a hardware **topology** that routes a workload
(`architecture`), or a **feature map** that classifies data (`classify`). The hard part is not "find any circuit" — it is
finding a circuit that meets the bar *while honoring the physical constraints of a chip*:
a fixed qubit count, a depth budget, a native gate set, a coupling map (which qubit pairs can
physically interact), and a cap on two-qubit gates. A circuit that ignores those constraints
is not runnable on hardware and is rejected before its result is even scored.

This is the first rung of a longer ladder. Constraint-respecting quantum primitives are the
verifiable atoms of quantum design, and the bench that grades them is the wedge for a broader
aim: a **verifiable-efficiency referee** for machine intelligence — where every efficiency claim
is held to a number a third party can re-derive. (To be honest about where quantum fits: it is
**not** an accelerator for today's LLMs; its genuine, further-off role is simulating
strongly-correlated materials for better *classical* chips. The full map is the curriculum's
North Star.) We start with circuits that prepare states and minimize Hamiltonian energy because
those are the verifiable atoms, then extend to designing the hardware **topology** those circuits
run on (`architecture`) and the quantum **feature map** that classifies data (`classify`) — five
task types, each judged the same way.

The chain the harness maintains is: target (stated conceptually in this brief) → submitted
circuit → re-simulated result → constraint check + reproducibility check + threshold check
(each re-derived against the hidden reference) → machine-checkable verdict (an exit code, not prose).

## Who it's for

The public, pointing an autonomous model (today Opus 4.8; built to be READY for Fable 5 /
"Mythos") at a hard quantum design problem and getting back a **machine-checkable verdict** with
the model's autonomy measured from the raw transcript. The model is the designer. The judge is a
**fresh verifier with no stake in the design** — it did not author the circuit and re-derives
every claimed number from scratch on a hermetic pure-numpy simulator. No conversational claim
about a result is admissible; only the exit code of a re-run is.

## Deliverable

A **proof bundle** conforming to `quantum-harness/proof-bundle@1`, one per problem attempted,
that ACCEPTs (exit 0) under `bench/quantum-judge/judge_verify.py`. The bundle is the unit of
work — there is no display-only artifact; every submission is a re-runnable bundle whose verdict
is an exit code.

The schema:

```json
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "<ghz3 | isingbell2 | bell_pops2 | aiaccel4 | qml_sign1 | ...>",
  "task": "state_prep | vqe | populations | architecture | classify",
  "circuit": { "n_qubits": N, "ops": [ { "gate": "...", "q": [...], "params": [...] } ] },
  "constraints": {
    "n_qubits": N, "max_depth": D,
    "native_gates": [...], "coupling_map": [[i, j], ...], "max_two_qubit_gates": K
  },
  "claim": { "fidelity": F }              // state_prep
       /* or */ { "energy": E }           // vqe
       /* or */ { "populations": [...] }, // populations
  "classical_baseline": { "fidelity": ... | "energy": ..., "note": "..." },
  "meta": {}
}
```

Supported gates (hermetic `sim.py`, qubit 0 = most-significant index): 1-qubit
`x y z h s sdg t tdg sx sxdg rx ry rz p`; 2-qubit `cx cz cy swap crz cp rzz`; 3-qubit `ccx`.
You may author the circuit however you like (Qiskit/Cirq/PennyLane are *optional* adapters), but
the bundle is graded only by the numpy simulator at the verification root — no quantum framework
is required to verify.

### How the verdict is computed — four active gates (first failing gate wins)

Run `python3 bench/quantum-judge/judge_verify.py <bundle.json>`:

| gate | exit | what it proves |
|------|------|----------------|
| STRUCTURE       | 3 | parses; respects `n_qubits`, `max_depth`, `native_gates`, `coupling_map`, `max_two_qubit_gates` |
| REPRODUCIBILITY | 4 | re-simulating reproduces your CLAIMED `fidelity`/`energy` within tolerance (catches fabrication) |
| PERFORMANCE     | 5 | the *recomputed* result meets the threshold AND beats/ties the classical baseline |
| ANTI-OVERFIT   | 6 | held-out generalization check — fires when the problem declares a held-out check; an artifact that matches the VISIBLE spec but fails the HIDDEN held-out observable / workload / test set is REJECTED |
| ACCEPT 0 · schema/parse 2 |||

`capture.py` builds a well-formed bundle from a raw circuit using the SAME simulator if you want
a tool-generated artifact rather than a hand-authored one. `RUBRIC.md` in this directory is the
full grading contract; every criterion there binds to an exit code, a `node --test` assertion,
or an emitted metric — nothing grades on prose.

## The worked targets (committed, runnable today)

These five worked problems are your concrete first deliverables. Each has a committed reference
solution and a committed passing bundle, so you can confirm the bench is green before designing.
Three of them (`bell_pops2`, `aiaccel4`, `qml_sign1`) are anti-overfit demonstrators: each carries
a held-out check — a held-out **observable**, **workload**, or **test set** — that triggers the exit-6 gate.

### Target 1 — `ghz3` (task `state_prep`)

Prepare the **3-qubit GHZ state** `(|000⟩ + |111⟩)/√2` under a **linear `[0-1-2]` coupling map**
(only the pairs `[0,1]` and `[1,2]` may interact directly — there is no direct `0–2` link).

- threshold: `fidelity ≥ 0.99`
- classical baseline to beat/tie: `fidelity 0.5` (the best unentangled product state overlaps GHZ at 0.5)
- depth budget `max_depth 6`, two-qubit cap `max_two_qubit_gates 4`
- reference solution (yields fidelity 1.0): `h q0; cx 0,1; cx 1,2`
- committed passing bundle: `bench/quantum-judge/quantum-proof-poc.json`

The trap: a naive `h q0; cx 0,1; cx 0,2` would need a direct `0–2` interaction the coupling map
forbids — that routes through STRUCTURE (exit 3). The chain `cx 1,2` respects the linear map.

### Target 2 — `isingbell2` (task `vqe`)

Find the ground state of the 2-qubit Hamiltonian **H = −X₀X₁ − Z₀Z₁** (n=2). The true ground
energy is **E₀ = −2** (a Bell state); the best product/classical state only reaches −1.

- threshold: `energy − E₀ ≤ energy_gap = 0.05` (i.e. recomputed energy must be within 0.05 of −2)
- classical baseline to beat/tie: `energy −1.0`
- depth budget `max_depth 4`, two-qubit cap `max_two_qubit_gates 2`
- reference solution (yields energy −2.0): `h q0; cx 0,1`
- committed passing bundle: `bench/quantum-judge/quantum-proof-vqe.json`

### Target 3 — `bell_pops2` (task `populations`, the anti-overfit demonstrator)

Prepare the **Bell state** `|Φ⁺⟩ = (|00⟩ + |11⟩)/√2`. The **visible** spec is its Z-basis
population distribution: **50/50 between `|00⟩` and `|11⟩`** (and 0 elsewhere). The judge
auto-grades that distribution at the reproducibility/performance gates. But the spec is
deliberately **under-determined** — `|Φ⁻⟩ = (|00⟩ − |11⟩)/√2` has the *same* populations — so the
reference **HOLDS OUT** the X-parity **`⟨X₀X₁⟩ = +1`**, which you are never told.

- visible spec: Z-basis populations `[0.5, 0, 0, 0.5]`
- HELD-OUT check (exit 6): `⟨X₀X₁⟩ = +1` (true for `|Φ⁺⟩`, but `−1` for the wrong-phase `|Φ⁻⟩`)
- depth budget `max_depth 4`, two-qubit cap `max_two_qubit_gates 2`
- reference solution (ACCEPTs): `h q0; cx 0,1`
- committed passing bundle: `bench/quantum-judge/quantum-proof-pops.json`

The trap: a circuit that appends `z q1` produces `|Φ⁻⟩`, whose populations are *still* 50/50, so
it passes STRUCTURE, REPRODUCIBILITY and PERFORMANCE — but its `⟨X₀X₁⟩ = −1` fails the held-out
check and it is REJECTED at ANTI-OVERFIT (exit 6). The committed adversarial fixture
`bench/quantum-judge/quantum-proof-OVERFIT.json` is exactly that impostor and MUST be rejected at
exit 6 — proving the anti-overfit gate has teeth on a problem that declares a held-out check.

### Target 4 — `aiaccel4` (task `architecture`, held-out WORKLOAD)

Design a **4-qubit hardware coupling map** (a topology, not a circuit) that routes a workload of
required two-qubit interactions under a connectivity budget. The **visible** workload is the
disjoint pairs `[[0,1],[2,3]]`; the judge recomputes a `routing_cost` (sum of shortest-path
distances) on your topology. But the reference **HOLDS OUT** a second workload `[[0,3],[1,2]]`
that the same topology must *also* route within budget — so a design cannot be hand-tuned to the
one workload it could see.

- bundle shape: `{ "architecture": { "n_qubits", "coupling_map": [[i,j]...] }, "constraints": { "max_degree", "connected" }, "claim": { "routing_cost" } }`
- constraints: `max_degree 2`, `connected true`
- threshold: `routing_cost ≤ routing_cost_max` (host-side); classical baseline to beat/tie: `routing_cost 4`
- HELD-OUT check (exit 6): the held-out workload must route at `routing_cost ≤ routing_cost_max`
- reference solution (ACCEPTs): the **ring** `[[0,1],[1,2],[2,3],[3,0]]` — routes both the visible and held-out cross-pairs at distance 1
- committed passing bundle: `bench/quantum-judge/quantum-proof-arch.json`

The trap: a linear path overfit to the visible disjoint pairs passes STRUCTURE, REPRODUCIBILITY
and PERFORMANCE but blows the held-out cross-pair budget. The committed adversarial fixture
`bench/quantum-judge/quantum-proof-arch-OVERFIT.json` is exactly that impostor and MUST be
rejected at exit 6.

### Target 5 — `qml_sign1` (task `classify`, held-out TEST set)

Design a **quantum feature map** (n=1) that classifies 1-D data by the sign of `x`. The **visible**
training set is `{(-2,0),(-1,0),(1,1),(2,1)}`; the judge instantiates your feature map per data
point, reads out a Pauli expectation, thresholds it at `bias`, and scores accuracy. But the
reference **HOLDS OUT** a test set placed in the gap between the training points — the textbook
train-vs-test guard.

- bundle shape: `{ "feature_map": { "n_qubits", "ops":[{gate,q,feature?,scale?,params?}] }, "readout": { "pauli", "bias" }, "claim": { "train_accuracy" } }`; a feature-bound op uses `{"feature": idx, "scale": s}` so its angle = `s * x[idx]`
- threshold: `train_accuracy ≥ train_accuracy_min` (host-side: 1.0)
- HELD-OUT check (exit 6): `test_accuracy ≥ test_accuracy_min` on the unseen test set
- reference solution (ACCEPTs): a low-frequency map `Ry(x)` with `⟨X⟩` readout — `⟨X⟩ = sin(x)`, decision boundary `x=0`, which generalizes
- committed passing bundle: `bench/quantum-judge/quantum-proof-qml.json`

The trap: a high-frequency map `Ry(7x)` nails the four training points but oscillates and
misclassifies the held-out test — it passes STRUCTURE, REPRODUCIBILITY and PERFORMANCE but is
REJECTED at ANTI-OVERFIT. The committed adversarial fixture
`bench/quantum-judge/quantum-proof-qml-OVERFIT.json` is exactly that impostor and MUST be
rejected at exit 6.

You are told the Hamiltonian and the GHZ target **conceptually, here**. The exact target
amplitude vector, the exact Hamiltonian terms, and the numeric thresholds live **host-side** with
the judge in `bench/quantum-judge/references/<problem_id>.json` — the analog of a signing key that
never enters the sandbox. The judge reads ground truth from there, NEVER from your bundle, and
recomputes `⟨ψ|H|ψ⟩` (vqe) or the state overlap (state_prep) itself. In this public template the
references are committed so CI is exercisable; in a real contest they are HELD OUT and the judge
is pointed at them via `QH_REFERENCES_DIR`. Because the judge re-derives every claimed number
from the hidden reference and the circuit IR cannot embed a target state, a circuit tuned to a
number you embedded in the bundle, rather than to the true target, is caught at the
REPRODUCIBILITY (exit 4) / PERFORMANCE (exit 5) gates. On top of that, problems whose reference
declares a `holdout` block (e.g. `bell_pops2`, `aiaccel4`, `qml_sign1`) add a dedicated
**ANTI-OVERFIT gate (exit 6)**: the judge grades the visible spec at gates 4/5 and then checks a
HELD-OUT observable / workload / test set you were never told — an artifact that matches only the
part it could see is REJECTED at exit 6. For problems that declare no `holdout` block (`ghz3`,
`isingbell2`) anti-overfit additionally holds by construction (ground truth lives only in the
hidden reference and the IR cannot embed a target), so exit 6 is simply not triggered for them.

## What done looks like (the rubric is the contract)

`RUBRIC.md` in this directory. A fresh verifier sub-agent must be able to grade every criterion
without a human. Do not stop while any R criterion fails; do not declare done without a verifier
pass. Concretely, for this session:

- the worked bundles ACCEPT (exit 0): `judge_verify.py quantum-proof-poc.json`,
  `judge_verify.py quantum-proof-vqe.json`, `judge_verify.py quantum-proof-pops.json`,
  `judge_verify.py quantum-proof-arch.json`, and `judge_verify.py quantum-proof-qml.json`;
- the anti-overfit impostors are REJECTED at exit 6: `judge_verify.py quantum-proof-OVERFIT.json`,
  `judge_verify.py quantum-proof-arch-OVERFIT.json`, and `judge_verify.py quantum-proof-qml-OVERFIT.json`;
- the bench self-test is green: `python3 bench/quantum-judge/test_judge.py` → `38/38 checks passed`;
- the measurement suite is green: `node --test test/*.test.mjs` → 107 tests pass, 0 fail;
- the same bundles still ACCEPT when the references are relocated via `QH_REFERENCES_DIR` to a
  directory outside your tree (anti-overfit, proven not assumed).

## Hard rules

- **Respect the declared constraints, always.** Honor `n_qubits`, `max_depth`, `native_gates`,
  the `coupling_map`, and `max_two_qubit_gates` exactly as the bundle declares them. A two-qubit
  gate on a pair not in the coupling map, a non-native gate, an over-budget depth, a qubit-count
  mismatch, or exceeding the 2q cap is a STRUCTURE failure (exit 3) — the circuit is rejected
  before its result is scored. Constraint-respecting is the whole point: an unrunnable circuit is
  not a solution.
- **No fabricated claims — the judge recomputes.** Your `claim.fidelity` / `claim.energy` is
  decorative until the judge re-simulates it. If the recomputed number disagrees with your claim,
  the bundle is REJECTED at REPRODUCIBILITY (exit 4). The committed adversarial fixture
  `quantum-proof-FORGED.json` — which omits the second CX so its true GHZ fidelity is 0.25 yet
  claims 1.0 — MUST be rejected at exit 4. Do not type a result; let the judge compute it.
- **Ground truth is hidden.** You know each target only CONCEPTUALLY from this brief. The exact
  target statevector / Hamiltonian terms / thresholds are held out with the judge under
  `references/<problem_id>.json` and may be relocated via `QH_REFERENCES_DIR`. Design to the
  *true target* described here, not to any number you can read in a committed bundle — the
  judge re-derives every claimed number against that hidden reference, so a number you fit to your
  own bundle is caught at REPRODUCIBILITY (exit 4) / PERFORMANCE (exit 5).
- **Beat or tie the classical baseline.** Meeting the threshold is necessary but not sufficient:
  the recomputed result must also beat/tie the bundle's stated `classical_baseline`
  (GHZ: 0.5; isingbell2: −1) or it fails PERFORMANCE (exit 5). The point of these problems is the
  entanglement a classical product state cannot reach.
- **Run the bench yourself; self-correct until green.** One kickoff, then loop: submit a bundle,
  read the exit code, fix the circuit, re-submit. A failure you catch with the judge (or
  `test_judge.py`, or `node --test`) before any human points it out is the autonomy this harness
  measures — the transcript scorecard surfaces it.
- **Credentials never appear in output; the transcript ships PUBLIC** (after a secret scan).
  Reference env var names only; treat every byte you emit as judge-visible.
- **State limits honestly.** The simulator is pure-numpy statevector — no noise model, no shots;
  references are committed in this template but held out in a real contest. Mislabeling, in either
  direction, is a disqualification.
