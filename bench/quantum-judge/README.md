# quantum-judge — the verifiable bench

`bench/quantum-judge/` is the spine of **quantum-harness**: a hermetic, offline,
exit-code judge for quantum chip / quantum-processing-architecture design
problems. You hand it a **proof bundle** (a circuit plus the result the model
claims it achieves) and it re-derives ground truth on a deterministic simulator,
then **ACCEPTs (exit 0)** or **REJECTs (non-zero)**. The verdict is
machine-checkable: there is no rubric scoring, no LLM-in-the-loop, no judgement
call. Either the design reproduces, respects its constraints, beats the
baseline, matches the hidden reference, and passes any held-out generalization
check — or it does not.

The judge spans five task types — three state-based circuit tasks (`state_prep`,
`vqe`, `populations`), a hardware-**`architecture`** (topology) task, and a QML
**`classify`** task — each with its own structure check but the same four-gate
spine. A "proof bundle" is therefore shaped per task: a state task carries a
`circuit`; `architecture` carries an `architecture` block (an `n_qubits` +
`coupling_map`); `classify` carries a `feature_map` + `readout`. Every task
re-derives ground truth from the hidden reference and, when that reference
declares one, runs a held-out generalization check.

This is the quantum re-skin of the verifiable-run pattern from
`fieldops-harness/bench/rcan-proof`. quantum-harness is seeded fresh (MIT, no
shared git history); the *pattern* is inherited, the content is entirely new.

## Why numpy-only and offline

The verification root depends on **numpy and nothing else**. No Qiskit, Cirq,
PennyLane, network, or accelerator is required to run the judge. The rule is:
**a judge that re-derives ground truth must run identically on a contributor's
laptop, in CI, and on a Raspberry Pi.** Heavyweight quantum SDKs are supported
only as *optional authoring adapters* (a contributor may design a circuit in a
framework and export it to the proof-bundle IR) — they are never the thing that
grades. The judge always re-verifies with numpy. See `requirements.txt`: the
SDKs are commented out and optional; `numpy>=1.24` is the only hard dep.

Determinism is a hard requirement, not a nicety: two independent verifiers must
grade a bundle identically, so `sim.py` does exact statevector math and nothing
in it depends on wall-clock time or unseeded RNG.

## Files

| file | role |
|------|------|
| `sim.py` | hermetic pure-numpy statevector simulator (the math) |
| `graph.py` | dependency-free graph utilities (degree, connectivity, routing cost) for the `architecture` task |
| `judge_verify.py` | the four-gate judge; consumes a proof bundle, returns an exit code |
| `capture.py` | builds a well-formed proof bundle from a circuit IR using the SAME simulator |
| `test_judge.py` | 29/29 regression suite: accept the worked examples, reject every class of forgery |
| `references/<problem_id>.json` | **hidden ground truth** (target state / Hamiltonian / workload / train set + thresholds; may declare a held-out check) |
| `quantum-proof-poc.json` | worked `state_prep` example (GHZ-3) — must ACCEPT |
| `quantum-proof-vqe.json` | worked `vqe` example (Ising/Bell-2) — must ACCEPT |
| `quantum-proof-pops.json` | worked `populations` example (genuine Bell `|Phi+>`, problem `bell_pops2`) — must ACCEPT |
| `quantum-proof-arch.json` | worked `architecture` example (ring topology, problem `aiaccel4`) — must ACCEPT |
| `quantum-proof-qml.json` | worked `classify` example (low-frequency `Ry(x)` map, problem `qml_sign1`) — must ACCEPT |
| `quantum-proof-FORGED.json` | adversarial fixture — must REJECT (exit 4) |
| `quantum-proof-OVERFIT.json` | anti-overfit fixture: wrong-phase `|Phi->` impostor — must REJECT (exit 6) |
| `quantum-proof-arch-OVERFIT.json` | anti-overfit fixture: topology overfit to the visible workload — must REJECT (exit 6) |
| `quantum-proof-qml-OVERFIT.json` | anti-overfit fixture: high-frequency `Ry(7x)` map overfit to the training set — must REJECT (exit 6) |
| `references/aiaccel4.json` | hidden reference for the `architecture` demonstrator (held-out workload) |
| `references/qml_sign1.json` | hidden reference for the `classify` demonstrator (held-out test set) |
| `requirements.txt` | `numpy` only; SDKs listed as optional authoring adapters |

---

## The proof bundle schema

`schema` is the literal string **`quantum-harness/proof-bundle@1`**. A bundle is
JSON:

```jsonc
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "ghz3",                  // selects the hidden reference file
  "task": "state_prep",                  // state_prep | vqe | populations | architecture | classify
  "circuit": {                           // the circuit IR (state tasks) — see below
    "n_qubits": 3,
    "ops": [
      { "gate": "h",  "q": [0] },
      { "gate": "cx", "q": [0, 1] },
      { "gate": "cx", "q": [1, 2] }
    ]
  },
  "constraints": {                       // checked by the STRUCTURE gate
    "n_qubits": 3,
    "max_depth": 6,
    "native_gates": ["h", "cx", "rz", "rx", "ry", "sx", "x", "cz"],
    "coupling_map": [[0, 1], [1, 2]],
    "max_two_qubit_gates": 4
  },
  "claim": { "fidelity": 1.0 },          // state_prep -> {fidelity}; vqe -> {energy}; populations -> {populations}
  "classical_baseline": {                // what the circuit must beat or tie
    "fidelity": 0.5,
    "note": "best unentangled product state overlaps GHZ at 0.5"
  },
  "meta": {}                             // free-form provenance; not graded
}
```

### Top-level fields

- **`schema`** — must equal `quantum-harness/proof-bundle@1` exactly, or the
  judge exits **2** (schema).
- **`problem_id`** — string key that selects `references/<problem_id>.json`. If
  no reference file exists, exit **2**.
- **`task`** — one of:
  - `state_prep` — prepare a target statevector; carries a `circuit`; `claim`
    carries `fidelity`.
  - `vqe` — minimize the energy of a Hamiltonian; carries a `circuit`; `claim`
    carries `energy`.
  - `populations` — match a Z-basis population distribution; carries a `circuit`;
    `claim` carries `populations` (a length-`2**n` probability vector).
    Deliberately under-determined — many states share a distribution — so a
    held-out observable in the reference pins down the intended state (this is the
    task that gives the anti-overfit gate teeth).
  - `architecture` — design a hardware **topology** (coupling map) that routes a
    workload of required two-qubit interactions within budget; carries an
    `architecture` block (`n_qubits` + `coupling_map`); `claim` carries
    `routing_cost`. The held-out check is a second **workload** the same topology
    must also route. See the `aiaccel4` problem and the bundle-shape note below.
  - `classify` — design a QML **feature map** that classifies data; carries a
    `feature_map` + `readout`; `claim` carries `train_accuracy`. The held-out
    check is an unseen **test set** the map must also classify. See the
    `qml_sign1` problem and the bundle-shape note below.
  Any other value exits **2**. The bundle's `task` must also match the
  reference's `task`, else exit **2**.
- **`circuit`** — the circuit IR (below) for state tasks. `architecture` instead
  supplies an `architecture` block, and `classify` a `feature_map` + `readout`
  (see their bundle-shape notes below).
- **`constraints`** — budgets/legality checked by the STRUCTURE gate. Every key
  is optional; absent keys are simply not enforced. (For `architecture`:
  `max_degree`, `connected`.)
- **`claim`** — the model's self-reported result. The REPRODUCIBILITY gate
  recomputes this number and rejects any mismatch.
- **`classical_baseline`** — `{fidelity|energy, note}`. The PERFORMANCE gate
  requires the verified result to beat or tie this. Missing baseline defaults to
  0.0 for fidelity (always beaten) and is skipped for energy.
- **`meta`** — free-form provenance (author, framework, notes). Not graded.

### The circuit IR

```jsonc
"circuit": {
  "n_qubits": <int>,
  "ops": [ { "gate": "<name>", "q": [<int>, ...], "params": [<float>, ...] }, ... ]
}
```

- The circuit starts from `|0...0>`. Ops are applied left to right.
- `gate` is a case-insensitive name from the supported set (below).
- `q` is the qubit list; its length must match the gate's arity. Indices must be
  in `[0, n_qubits)` and **must not repeat within one op**.
- `params` is required only for parameterized gates; angles are in **radians**.

### Supported gates

| arity | gates |
|-------|-------|
| 1-qubit, fixed | `x` `y` `z` `h` `s` `sdg` `t` `tdg` `sx` `sxdg` (`id`/`i` identity) |
| 1-qubit, parameterized | `rx` `ry` `rz` `p` (aliases `phase`, `u1`) |
| 2-qubit | `cx` (alias `cnot`) `cz` `cy` `swap` `crz` `cp` `rzz` |
| 3-qubit | `ccx` (alias `toffoli`) |

`sx`/`sxdg` are the √X and its adjoint (`sx·sx = x`). `crz`/`cp` are
controlled-`rz`/controlled-phase; `rzz` is the two-qubit ZZ rotation. The
authoritative set is `sim.KNOWN_GATES`. A gate outside this set fails STRUCTURE.

### Qubit-ordering convention (read this carefully)

**Qubit 0 is the MOST-significant bit of the computational-basis index.**

```
basis index = sum over q of  bit_q * 2**(n - 1 - q)
```

So for `n=3`: `|000>` is index 0 and `|111>` is index 7. In the simulator,
`reshape(state, [2]*n)` makes axis 0 correspond to qubit 0; for a multi-qubit
gate, `q[0]` is the most-significant index of the gate block (e.g. for `cx`,
`q[0]` is the control, `q[1]` the target).

The **Pauli-string convention matches**: in a Hamiltonian term like `"XX"` or
`"IZ"`, the **leftmost character is qubit 0**. A reference state is stored as a
length-`2**n` list of `[re, im]` pairs in this same index order.

### The `architecture` bundle (topology design)

Instead of a `circuit`, an `architecture` bundle supplies a hardware graph:

```jsonc
{
  "task": "architecture",
  "architecture": {
    "n_qubits": 4,
    "coupling_map": [[0, 1], [1, 2], [2, 3], [3, 0]]   // undirected hardware edges
  },
  "constraints": { "max_degree": 2, "connected": true },  // connectivity budget
  "claim": { "routing_cost": 2 }                          // sum of shortest-path distances over the workload
}
```

The hidden reference supplies the visible `workload` (the required two-qubit
interaction pairs), `thresholds.routing_cost_max`, and a `holdout` block carrying
a second `workload` + `routing_cost_max`. `graph.py` computes degree,
connectivity, and routing cost (sum of shortest-path distances over a workload —
a SWAP-overhead proxy).

### The `classify` bundle (QML feature map)

Instead of a `circuit`, a `classify` bundle supplies a feature-map template and a
readout:

```jsonc
{
  "task": "classify",
  "feature_map": {
    "n_qubits": 1,
    "ops": [ { "gate": "ry", "q": [0], "feature": 0, "scale": 1.0 } ]
  },
  "readout": { "pauli": "X", "bias": 0.0 },
  "claim": { "train_accuracy": 1.0 }
}
```

A **feature-bound op** carries `{"feature": idx, "scale": s}`: at predict time its
angle is `s * x[idx]` (so `Ry` with `feature 0, scale 1.0` rotates by `x[0]`). The
judge instantiates the template per data point, simulates it, and predicts class
`1` iff the readout `<pauli>` exceeds `bias`. The hidden reference supplies the
visible `train` set, `thresholds.train_accuracy_min`, and a `holdout` block with a
`test` set + `test_accuracy_min`.

---

## The judge gates and exit codes

`judge_verify.py` runs four active, machine-checkable gates. Each binds to a
rubric criterion and rejects with a distinct code, so a failure tells you exactly
*what* went wrong. The fourth — ANTI-OVERFIT — is a real, tested held-out gate
(exit 6): it fires for any problem whose reference declares a `holdout` block.
For problems without one, anti-overfit *additionally* holds by construction
(ground truth lives only in the hidden reference; the circuit IR cannot embed a
target), so exit 6 is simply not triggered there.

| exit | gate | what it proves |
|------|------|----------------|
| **0** | — | ACCEPT: all active gates pass |
| **2** | schema/parse | bundle unreadable, wrong `schema`, unknown `task`, missing reference, or reference/bundle task mismatch |
| **3** | **STRUCTURE** | circuit parses and respects `n_qubits`, `max_depth`, `native_gates`, `coupling_map`, `max_two_qubit_gates` |
| **4** | **REPRODUCIBILITY** | re-simulating the circuit reproduces the **claimed** number within tolerance — the model cannot fabricate a result |
| **5** | **PERFORMANCE** | the verified result meets the rubric threshold **AND** beats/ties the classical baseline |
| **6** | **ANTI-OVERFIT** | held-out generalization check — fires when the problem declares a held-out check; a design that matches the visible spec but fails the hidden held-out form (observable / workload / test set) is rejected |

### STRUCTURE (exit 3)

Pure static/legality check on `circuit` against `constraints`:

- `n_qubits` matches the constraint if present.
- Every op's `gate` is in `sim.KNOWN_GATES`, and — if `native_gates` is given —
  is in that native set.
- Every qubit index is in range and no op repeats a qubit.
- Every 2-qubit op's qubit pair is an edge of `coupling_map` (compared as an
  unordered pair, so `[1,0]` satisfies an edge `[0,1]`).
- `circuit_depth` ≤ `max_depth` (standard greedy layered depth).
- 2-qubit gate count ≤ `max_two_qubit_gates`.

### REPRODUCIBILITY (exit 4)

The anti-overclaim gate. The judge simulates the circuit and computes the actual
result, then compares it to `claim`:

- `state_prep`: actual `fidelity = |<target|state>|^2` against the hidden target;
  reject if `|claimed − recomputed| > tolerance.fidelity_reproduce` (default
  `1e-6`).
- `vqe`: actual `energy = <state|H|state>` for the hidden Hamiltonian; reject if
  `|claimed − recomputed| > tolerance.energy_reproduce` (default `1e-6`).
- `populations`: recomputed Z-basis distribution; reject if `claim.populations`
  disagrees beyond `tolerance.populations_reproduce`.
- `architecture`: recomputed `routing_cost` over the hidden workload; reject if
  `claim.routing_cost` differs.
- `classify`: recomputed `train_accuracy` over the hidden train set; reject if
  `claim.train_accuracy` differs.

This is the gate that catches `quantum-proof-FORGED.json`, which claims fidelity
`1.0` for a circuit that truly achieves `0.25`.

### PERFORMANCE (exit 5)

The verified result must clear two bars:

- `state_prep`: `fidelity ≥ thresholds.fidelity` **and** `fidelity ≥
  classical_baseline.fidelity`.
- `vqe`: the energy gap `(<H> − E0) ≤ thresholds.energy_gap`, **and** the energy
  must not be worse (higher) than `classical_baseline.energy`. Lower energy is
  better.
- `populations`: the recomputed distribution matches the visible target spec
  within `tolerance.populations_match`.
- `architecture`: `routing_cost ≤ thresholds.routing_cost_max` **and** not worse
  than `classical_baseline.routing_cost`. Lower is better.
- `classify`: `train_accuracy ≥ thresholds.train_accuracy_min`.

An honest design that simply isn't good enough fails here (exit 5), distinctly
from a *lying* one (exit 4).

### ANTI-OVERFIT (exit 6) — the held-out generalization gate

This is the spine of the bench, and it is a **real, active gate** with its own
exit code (6). The whole design works like a "signing key that never enters the
sandbox." The model is told the target **conceptually**, from the BRIEF (e.g.
"the 3-qubit GHZ state", "the ground state of H = −X0X1 − Z0Z1", "the Bell state
`|Phi+>` whose Z-basis populations are 50/50"). The **exact** target statevector
/ Hamiltonian terms / ground-state energy / numeric thresholds — and any
**held-out** observable — live host-side in `references/<problem_id>.json` and are
loaded only by the judge, never handed to the model during a live run.

When a reference declares a **`holdout`** block, the judge re-derives that
held-out check after structure/reproducibility/performance have already passed. A
design that matches everything the model could *see* but fails the hidden held-out
form overfit the visible spec and is **rejected at exit 6**. The held-out form
depends on the task:

- a held-out **OBSERVABLE** (state tasks; e.g. `bell_pops2` holds out `<X0X1>`) —
  and, optionally, a held-out **target statevector** with its own fidelity floor;
- a held-out **WORKLOAD** (`architecture`) — the topology must also route a second
  interaction set within budget;
- a held-out **TEST SET** (`classify`) — the feature map must classify unseen data.

For the state-task form:

```jsonc
"holdout": {
  "observables": [
    { "pauli": "XX", "expected": 1.0, "tolerance": 0.02 }   // <X0X1>; tolerance optional, default 1e-3
  ],
  "target_statevector": [ [re, im], ... ],   // optional held-out target state ...
  "fidelity_min": 0.99                        // ... with its own minimum fidelity
}
```

Each `observables` entry is a Pauli string (leftmost char = qubit 0) whose
expectation the judge recomputes; an optional `target_statevector` adds a held-out
fidelity floor. `architecture` references instead carry
`holdout.workload` + `holdout.routing_cost_max`, and `classify` references carry
`holdout.test` + `holdout.test_accuracy_min`. All are checked only by the judge.

**Worked demonstrator — `bell_pops2` (task `populations`).** The model is told to
prepare `|Phi+>`; the *visible* spec is the Z-basis population distribution
(50/50 between `|00>` and `|11>`), which is graded at the
reproducibility/performance gates. The reference **holds out** the X-parity
`<X0X1> = +1`. The genuine Bell state (`h q0; cx 0,1`) ACCEPTs
(`quantum-proof-pops.json` → exit 0). A wrong-phase impostor `|Phi->`
(`h q0; cx 0,1; z q1`) has the *same* 50/50 populations — so it passes structure
(3), reproducibility (4) and performance (5) — but its `<X0X1> = −1`, so it is
REJECTED **only** at the anti-overfit gate (`quantum-proof-OVERFIT.json` →
exit 6).

**Worked demonstrator — `aiaccel4` (task `architecture`).** The model is told the
*visible* workload (two-qubit interaction pairs `[[0,1],[2,3]]`) and asked for a
4-qubit coupling map under a `max_degree ≤ 2` budget. The reference **holds out** a
second workload `[[0,3],[1,2]]`. A ring topology (`quantum-proof-arch.json`) routes
both at distance 1 and ACCEPTs (exit 0); a topology overfit to the visible disjoint
pairs blows the held-out cross-pair budget and is REJECTED at exit 6
(`quantum-proof-arch-OVERFIT.json`).

**Worked demonstrator — `qml_sign1` (task `classify`).** The model is given the
*visible* training set and asked for a feature map that classifies it. The
reference **holds out** a test set placed between the training points. A genuine
low-frequency map `Ry(x)` (`quantum-proof-qml.json`) generalizes and ACCEPTs
(exit 0); a high-frequency `Ry(7x)` nails the training points but oscillates and
misclassifies the held-out test — the textbook overfit, REJECTED at exit 6
(`quantum-proof-qml-OVERFIT.json`).

For problems that do **not** declare a `holdout` block (`ghz3`, `isingbell2`),
anti-overfit *additionally* holds **by construction**: every result is computed
against the hidden reference rather than against anything in the bundle, and the
circuit IR cannot embed a target state, so a circuit must genuinely build the
state from gates. A model that "overfits" a number it placed in its own bundle is
caught at the reproducibility (4) / performance (5) gates. For those problems
exit 6 is simply not triggered — but it is **not** reserved or dead code; it is
the gate `bell_pops2`, `aiaccel4`, and `qml_sign1` exercise.

### The hidden-reference override: `QH_REFERENCES_DIR`

By default references load from `bench/quantum-judge/references/`. Set the
environment variable **`QH_REFERENCES_DIR`** to point the judge at a different
directory:

```sh
QH_REFERENCES_DIR=/secret/contest-refs python3 judge_verify.py bundle.json
```

The **public template commits its references** so CI can exercise the judge end
to end. A **real contest holds them out**: keep `references/` out of the model's
repo, and point the judge at the secret copy via `QH_REFERENCES_DIR`. The model
sees the BRIEF; the judge sees the answer.

---

## Running the judge, the tests, and capture

All commands run from the repo root with `python3` (numpy installed).

### Verify a proof bundle

```sh
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-poc.json
# ACCEPT  problem=ghz3 task=state_prep
#   structure: {'depth': 3, 'two_qubit_gates': 2, 'n_qubits': 3}
#   reproduced: {'fidelity': 1.0}
#   performance: {'threshold': 0.99, 'baseline': 0.5, 'achieved': 1.0}

echo $?        # 0 on ACCEPT; the gate's exit code on REJECT
```

Add `--json` for machine-readable output:

```sh
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-FORGED.json --json
# {"verdict": "REJECT", "code": 4, "reason": "claimed fidelity 1.000000 != recomputed 0.250000 (tol 1e-06)"}
```

### Run the regression suite

```sh
python3 bench/quantum-judge/test_judge.py
# ... 29/29 checks passed   (exit 0)
```

The suite asserts the worked bundles ACCEPT (including the genuine `populations`
Bell state `quantum-proof-pops.json`, the ring topology `quantum-proof-arch.json`,
and the low-frequency feature map `quantum-proof-qml.json`), the FORGED fixture is
rejected exit 4, and each held-out overfit fixture
(`quantum-proof-OVERFIT.json`, `quantum-proof-arch-OVERFIT.json`,
`quantum-proof-qml-OVERFIT.json`) is rejected at the held-out gate exit 6 (passing
structure/reproducibility/performance first). It also asserts that each class of
forgery (overclaimed result, off-coupling-map 2q gate, non-native gate,
over-budget depth, wrong qubit count, 2q-cap exceeded, honest-but-underperforming
circuit, tampered/wrong-distribution populations, tampered/over-budget/degree-over
architecture, tampered/under-fit classifier) rejects with the right code — plus a
`capture.py` round-trip that ACCEPTs.

### Build a bundle from a circuit with `capture.py`

`capture.py` runs a circuit IR on the same simulator the judge uses, computes the
honest claim, and emits a bundle shaped exactly the way the judge expects — so a
circuit that captures clean is guaranteed to reproduce under the judge.

```sh
python3 bench/quantum-judge/capture.py <circuit.json> <problem_id> [--task state_prep|vqe] > bundle.json
```

`<circuit.json>` is `{"n_qubits", "ops", "constraints"?, "classical_baseline"?}`.
`capture.py` reads the committed reference *only* to make the worked example's
self-reported claim self-consistent; the **judge** is what independently confirms
or refutes that claim.

---

## The worked problems

All are committed, exercisable today, and pass under the judge.

### `ghz3` — task `state_prep`

- **Goal:** prepare the 3-qubit GHZ state `(|000> + |111>)/√2` under a **linear
  `[0-1-2]` coupling map**.
- **Hidden reference** (`references/ghz3.json`): the GHZ target statevector;
  `thresholds.fidelity = 0.99`; classical baseline `0.5` (the best unentangled
  product state overlaps GHZ at 0.5).
- **Reference solution:** `h q0; cx 0,1; cx 1,2` → fidelity **1.0**. The two CX
  gates lie on edges `[0,1]` and `[1,2]`, respecting the chain.

### `isingbell2` — task `vqe`

- **Goal:** find the ground state of `H = −X0X1 − Z0Z1` on `n=2`.
- **Hidden reference** (`references/isingbell2.json`): the two Pauli terms;
  exact `ground_state_energy = −2.0` (a Bell state, from offline
  diagonalization); `thresholds.energy_gap = 0.05`; classical/product baseline
  `−1.0`.
- **Reference solution:** `h q0; cx 0,1` → energy **−2.0**, the true ground.

### `bell_pops2` — task `populations` (the anti-overfit demonstrator)

- **Goal:** prepare the Bell state `|Phi+> = (|00> + |11>)/√2` on `n=2`. The
  **visible spec** is its Z-basis population distribution — 50/50 between `|00>`
  and `|11>` (`population_target = [0.5, 0, 0, 0.5]`).
- **Hidden reference** (`references/bell_pops2.json`): the population target plus
  a **`holdout`** block holding out the X-parity `<X0X1> = +1` (tolerance `0.02`)
  — the observable the model is never told.
- **Reference solution:** `h q0; cx 0,1` → populations 50/50 **and** `<X0X1>=+1`
  → ACCEPT (`quantum-proof-pops.json`, exit 0).
- **Anti-overfit catch:** the wrong-phase impostor `|Phi->` (`h q0; cx 0,1; z q1`)
  has the *same* 50/50 populations and an honest populations claim, so it clears
  structure/reproducibility/performance — but its `<X0X1> = −1` fails the held-out
  check, so it is REJECTED at exit 6 (`quantum-proof-OVERFIT.json`).

### `aiaccel4` — task `architecture` (held-out workload)

- **Goal:** design a 4-qubit hardware coupling map that routes the **visible
  workload** `[[0,1],[2,3]]` under a `max_degree ≤ 2`, `connected` budget.
- **Hidden reference** (`references/aiaccel4.json`): the visible workload;
  `thresholds.routing_cost_max = 2`; a **`holdout`** block holding out a second
  workload `[[0,3],[1,2]]` with its own `routing_cost_max = 2`.
- **Reference solution:** the ring `[[0,1],[1,2],[2,3],[3,0]]` → both workloads
  route at distance 1 (cost 2 each) → ACCEPT (`quantum-proof-arch.json`, exit 0).
- **Anti-overfit catch:** a topology tuned to the visible disjoint pairs routes
  them cheaply but cannot route the held-out cross-pairs within budget, so it is
  REJECTED at exit 6 (`quantum-proof-arch-OVERFIT.json`).

### `qml_sign1` — task `classify` (held-out test set)

- **Goal:** design a 1-qubit feature map + readout that classifies the **visible
  training set** (`x<0 → 0`, `x>0 → 1`).
- **Hidden reference** (`references/qml_sign1.json`): the train set;
  `thresholds.train_accuracy_min = 1.0`; a **`holdout`** block with a `test` set
  between the training points and `test_accuracy_min = 0.99`.
- **Reference solution:** `Ry(x)` on q0 with an `X` readout (bias 0) →
  `<X> = sin(x)`, decision boundary `x=0` → train and test both correct → ACCEPT
  (`quantum-proof-qml.json`, exit 0).
- **Anti-overfit catch:** a high-frequency `Ry(7x)` map nails the four training
  points but oscillates, misclassifying the held-out test, so it is REJECTED at
  exit 6 (`quantum-proof-qml-OVERFIT.json`).

---

## How to add a new problem

A problem is the pair *(hidden reference, public brief)*, optionally plus a
worked bundle. Steps:

### 1. Write `references/<problem_id>.json` (the hidden ground truth + thresholds)

This file is what the judge grades against and is held out from the model in a
contest. Shape depends on the task.

**state_prep:**

```jsonc
{
  "problem_id": "<id>",
  "task": "state_prep",
  "n_qubits": <int>,
  "target_statevector": [ [re, im], ... ],   // length 2**n_qubits, qubit-0 = MSB order
  "thresholds": { "fidelity": 0.99 },
  "tolerance":  { "fidelity_reproduce": 1e-06 }   // optional; this is the default
}
```

**vqe:**

```jsonc
{
  "problem_id": "<id>",
  "task": "vqe",
  "n_qubits": <int>,
  "hamiltonian_terms": [ { "coeff": <float>, "pauli": "XX" }, ... ],  // leftmost char = qubit 0
  "ground_state_energy": <float>,               // from offline diagonalization
  "thresholds": { "energy_gap": 0.05 },
  "tolerance":  { "energy_reproduce": 1e-06 }    // optional; this is the default
}
```

**populations:**

```jsonc
{
  "problem_id": "<id>",
  "task": "populations",
  "n_qubits": <int>,
  "population_target": [ <p0>, <p1>, ... ],      // length 2**n_qubits, qubit-0 = MSB order
  "tolerance": {
    "populations_reproduce": 1e-06,              // optional; claim-vs-recomputed (default)
    "populations_match": 1e-03                   // optional; recomputed-vs-target (default)
  },
  "holdout": { "observables": [ { "pauli": "XX", "expected": 1.0, "tolerance": 0.02 } ] }
}
```

**architecture:**

```jsonc
{
  "problem_id": "<id>",
  "task": "architecture",
  "n_qubits": <int>,
  "workload": [ [i, j], ... ],                   // visible required two-qubit interaction pairs
  "thresholds": { "routing_cost_max": <int> },   // max sum-of-shortest-path-distances over the workload
  "holdout": { "workload": [ [i, j], ... ], "routing_cost_max": <int> }   // held-out workload + its budget
}
```

**classify:**

```jsonc
{
  "problem_id": "<id>",
  "task": "classify",
  "n_features": <int>,
  "train": [ { "x": [ <float>, ... ], "y": 0|1 }, ... ],   // visible training set
  "thresholds": { "train_accuracy_min": 1.0 },
  "holdout": { "test": [ { "x": [...], "y": 0|1 }, ... ], "test_accuracy_min": 0.99 }   // held-out test set
}
```

**The `holdout` block (enables the exit-6 anti-overfit gate).** Any reference may
add a `holdout` block; when present, the judge runs the held-out generalization
check after structure/reproducibility/performance and rejects at exit 6 if it
fails. It is the only way to arm exit 6 for a problem. The form depends on the
task: a held-out **OBSERVABLE** (state tasks; optionally a held-out target
statevector), a held-out **WORKLOAD** (`architecture`), or a held-out **TEST SET**
(`classify`). For state tasks the observable form is:

```jsonc
"holdout": {
  "observables": [
    { "pauli": "<string>", "expected": <float>, "tolerance": <float> }  // leftmost char = qubit 0; tolerance optional (default 1e-3)
  ],
  "target_statevector": [ [re, im], ... ],   // optional held-out target state ...
  "fidelity_min": 0.99                        // ... with its own minimum fidelity (default 0.99)
}
```

Notes:
- Keep `task` here consistent with the bundle `task`, or the judge exits 2.
- Compute `ground_state_energy` offline (e.g. exact diagonalization of the dense
  H built from the same Pauli convention; `sim.expectation_pauli` and
  `numpy.linalg.eigh` are enough). Get this number right — it is the bar.
- Pick `thresholds` so the intended solution passes with margin and trivial
  baselines fail. Set a `classical_baseline` (in the BRIEF / bundle) the
  solution must beat.
- **To enable the anti-overfit (exit 6) gate, declare a `holdout`** — an
  **observable** (state tasks), a **workload** (`architecture`), or a **test set**
  (`classify`) the BRIEF never reveals. This is what gives an under-determined task
  (like `populations`) teeth: pick a held-out check that the *intended* design
  satisfies but an impostor matching only the visible spec does not (e.g. the
  X-parity that separates `|Phi+>` from `|Phi->`, a second routing workload, or a
  test set between the training points).

### 2. Write a BRIEF for the model

State the target **conceptually** — never paste the reference's exact statevector
or numeric thresholds. Give the model: the task type, the qubit count, the
coupling map / native gate set / depth & 2q budgets it must respect, the
classical baseline it must beat, and the conceptual target ("prepare the W
state", "minimize H = …"). The whole point of the hidden-reference invariant is
that the model earns the verdict from the concept, not from the answer key.

### 3. (Optional) Write a worked proof bundle

To make the new problem exercisable in CI and give contributors a reference
solution, author a circuit and run it through `capture.py`:

```sh
python3 bench/quantum-judge/capture.py my_circuit.json <problem_id> --task <task> > bench/quantum-judge/quantum-proof-<id>.json
python3 bench/quantum-judge/judge_verify.py bench/quantum-judge/quantum-proof-<id>.json   # expect ACCEPT (exit 0)
```

Then wire it into `test_judge.py`'s accept list (and, if you want the anti-cheat
regression for this problem, add a forged variant that must reject exit 4 — and,
if the reference declares a `holdout`, an overfit variant that matches the visible
spec but must reject exit 6) so the suite stays a complete tripwire.
