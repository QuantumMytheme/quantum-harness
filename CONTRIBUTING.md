# Contributing to quantum-harness

Thanks for contributing. This is a verifiable-run prompt harness for quantum chip /
quantum-processing architecture design, and contribution works the way the whole project works:
**the judge is the merge gate.** No maintainer scores your circuit by taste — a hermetic,
deterministic simulator decides whether your proof bundle meets the contract. If it does, and the
regression suite stays green, your contribution can merge.

There are two ways to contribute:

- **Solve an existing problem** — submit a proof bundle that the judge ACCEPTs.
- **Author a new problem** — write a BRIEF + RUBRIC and a hidden reference, with a worked
  reference solution that the judge accepts.

Both flow through the same gate. Both run on a laptop, in CI, or on a Raspberry Pi — the judge's
only root dependency is **numpy**.

This document is the contribution mechanics. The bigger picture of where contributions go — a
public, searchable, re-runnable directory at `quantummytheme.com` — lives in
[PLATFORM-VISION.md](./PLATFORM-VISION.md) (that platform is a roadmap, not yet built).

---

## The merge gate (read this first)

A pull request is mergeable **only if both** of these are true:

1. **The judge ACCEPTs the bundle** — `judge_verify.py` exits `0`.
2. **The regression suite is green** — `python3 bench/quantum-judge/test_judge.py` passes
   (29/29) **and** `node --test test/*.test.mjs` passes (82 tests: scorecard, transcript scrub,
   planner roster/walkthrough).

No human reviewer overrides a REJECT into a merge. The point of the harness is that correctness is
machine-checked; the merge gate honors that.

---

## Setup

```sh
# Python side (the judge + simulator). numpy only.
pip install -r bench/quantum-judge/requirements.txt

# Node side (the measurement layer: scorecard + transcript scrub).
npm install        # or: npm ci

# Sanity check — everything green before you start.
python3 bench/quantum-judge/test_judge.py
node --test test/*.test.mjs
```

Qiskit / Cirq / PennyLane are **optional authoring adapters** — convenient for *writing*
circuits, never required to *check* them. Do not put them on the trust path.

---

## Path A — solve an existing problem

The worked problems are `ghz3` (state prep), `isingbell2` (VQE), `bell_pops2` (task
`populations`, held-out X-parity), `aiaccel4` (task `architecture`, held-out workload), and
`qml_sign1` (task `classify`, held-out test set) — the last three are anti-overfit
demonstrators. To solve one:

1. **Read the BRIEF.** The problem is stated conceptually (e.g. "prepare a 3-qubit GHZ state
   under a linear `[0–1–2]` coupling map"). You know the target *conceptually*; you do **not**
   get the exact answer key — the precise target state / Hamiltonian and pass thresholds live with
   the judge in `references/<problem_id>.json`.

2. **Author a circuit** using the supported gate set — `x y z h s sdg t tdg sx sxdg rx ry rz p`
   (1-qubit), `cx cz cy swap crz cp rzz` (2-qubit), `ccx` (3-qubit). Qubit 0 is the
   most-significant index. Respect the problem's constraints: `n_qubits`, `max_depth`, native
   gates, coupling map, and the 2-qubit-gate cap.

3. **Build a proof bundle** with the same simulator the judge uses, so your claimed metric is
   honest:

   ```sh
   python3 bench/quantum-judge/capture.py <circuit.json> <problem_id> --task state_prep
   # or --task vqe, --task populations, --task architecture, --task classify
   ```

4. **Verify locally** — loop until green:

   ```sh
   python3 bench/quantum-judge/judge_verify.py <your-bundle>.json
   ```

   The judge runs four active verification gates (structure, reproducibility, performance,
   anti-overfit), each able to reject with its own exit code. If it rejects, the exit code tells you
   which one:

   | Exit | Gate | Meaning |
   |---|---|---|
   | 0 | — | **ACCEPT** |
   | 2 | schema | Bundle doesn't match `quantum-harness/proof-bundle@1` |
   | 3 | structure | Violates `n_qubits` / `max_depth` / native gates / coupling map / 2q cap |
   | 4 | reproducibility | Your claimed number doesn't survive re-simulation (fabrication) |
   | 5 | performance | Misses the threshold, or fails to beat/tie the classical baseline |
   | 6 | anti-overfit | Fails the held-out generalization check (fires when the problem declares a held-out check) |

5. **Open a PR** with the bundle. CI re-runs the judge and the regression suite. Green = mergeable.

### Proof-bundle schema

```jsonc
{
  "schema": "quantum-harness/proof-bundle@1",
  "problem_id": "ghz3",
  "task": "state_prep",              // state_prep | vqe | populations | architecture | classify
  "circuit": {
    "n_qubits": 3,
    "ops": [ { "gate": "h", "q": [0] }, { "gate": "cx", "q": [0, 1] } ]
  },
  "constraints": {
    "n_qubits": 3,
    "max_depth": 8,
    "native_gates": ["h", "cx"],
    "coupling_map": [[0, 1], [1, 2]],
    "max_two_qubit_gates": 4
  },
  "claim": { "fidelity": 1.0 },      // or { "energy": -2 } for vqe
  "classical_baseline": { "fidelity": 0.5, "note": "best product state" },
  "meta": {}
}
```

Ops with parameters carry them in `params`, e.g. `{ "gate": "rz", "q": [0], "params": [1.5708] }`.

---

## Path B — author a new problem

A new problem is a contract plus a hidden answer key plus a proof that the contract is solvable.

1. **Write a BRIEF** that states the problem *conceptually* — enough for a solver (human or model)
   to understand the target without handing them the exact numbers.

2. **Write a RUBRIC** where **every criterion binds to a concrete check** — a structural
   constraint, a recomputed number, or a performance threshold, each evaluated against the held-out
   reference. Nothing is "done" on the author's say-so; every line maps to one of the judge's active
   gates. See `VERIFIER-MAP.md` for how existing criteria bind to gates.

3. **Add the hidden reference** at `bench/quantum-judge/references/<problem_id>.json`: the exact
   target state / Hamiltonian, the pass threshold, the energy-gap budget (for VQE), and the
   classical baseline. This file is the analog of a signing key — it is what the
   reproducibility, performance, and anti-overfit gates check against, and keeping it out of the
   bundle is what gives the anti-overfit gate its teeth. To put a held-out generalization check on a
   problem, declare a `holdout` block here; it can take one of three forms — a held-out **observable**
   (state tasks; e.g. `bell_pops2` holds out `<X0X1>`), a held-out **workload** (architecture; the
   topology must also route a second interaction set within budget, as in `aiaccel4`), or a held-out
   **test set** (classify; the feature map must classify unseen data, as in `qml_sign1`). The judge
   enforces whichever form is declared at exit 6.

4. **Provide a worked reference solution** — a circuit and a proof bundle that the judge ACCEPTs —
   so CI proves the problem is actually solvable. Wire it into the regression suite the way `ghz3`,
   `isingbell2`, `bell_pops2`, `aiaccel4`, and `qml_sign1` are. If your problem declares a `holdout`
   block, ship a worked bundle that passes the held-out check too.

5. **Add an adversarial fixture.** Every problem should ship at least one forgery the judge must
   REJECT — the analog of `quantum-proof-FORGED.json`, which omits a `CX`, truly scores fidelity
   0.25, but *claims* 1.0, and must be rejected at exit 4. This is the anti-cheat regression; it
   proves the judge catches lies, not just honest answers. For a problem with a `holdout` block, also
   ship an over-fit fixture the judge must reject at exit 6 — the analog of `quantum-proof-OVERFIT.json`
   (matches the visible populations spec but fails the held-out X-parity check),
   `quantum-proof-arch-OVERFIT.json` (a topology hand-tuned to the visible workload that blows the
   held-out routing budget), or `quantum-proof-qml-OVERFIT.json` (a feature map that fits the training
   data but misclassifies the held-out test set).

### The hidden-reference rule (for problem authors)

This is the rule that keeps the whole platform honest:

> **The reference is the answer key. Solvers know the target conceptually from the BRIEF; they
> must never receive the exact target / Hamiltonian / thresholds.**

- In the **public template**, references are **committed** so CI can run end-to-end. That is fine
  for practice and learning problems.
- In a **live contest**, references are **held out** — placed in a private directory and pointed
  to with `QH_REFERENCES_DIR`, so the answer key never enters the model's sandbox.
- Holding the reference out is what makes anti-overfit meaningful. The judge reads ground truth only
  from the hidden reference (never from the bundle) and re-derives every claimed number, so a circuit
  tuned to the public brief still has to survive a reference it never saw — and is caught at the
  **reproducibility (exit 4)** and **performance (exit 5)** gates if it doesn't.
- On top of that, a problem can declare a `holdout` block — a held-out observable / target the solver
  is never told — and the judge enforces it as the **anti-overfit (exit 6)** gate. `bell_pops2` is the
  worked demonstrator: the solver is told to prepare the Bell state |Φ+> (the visible spec is the
  Z-basis populations, 50/50 between |00> and |11>), but the judge holds out the X-parity `<X0X1> = +1`.
  The genuine |Φ+> ACCEPTs; a wrong-phase impostor |Φ−> that still matches the populations passes
  structure, reproducibility, and performance and is **rejected only at exit 6**. For problems that do
  **not** declare a `holdout` block (e.g. `ghz3`, `isingbell2`), anti-overfit additionally holds by
  construction — the circuit IR can't embed a target the model was never given — so exit 6 simply
  isn't triggered for them. Author your problem so a merely-memorized or over-fit solution would fail
  these checks against a held-out reference.

Never inline reference values into the BRIEF, the RUBRIC, the template, or a fixture that ships to
solvers. If a number belongs to the answer key, it belongs only in `references/<problem_id>.json`.

---

## PR checklist

Before you open a PR, confirm:

- [ ] `python3 bench/quantum-judge/judge_verify.py <your-bundle>.json` exits `0` (ACCEPT).
- [ ] `python3 bench/quantum-judge/test_judge.py` passes (29/29).
- [ ] `node --test test/*.test.mjs` passes (82 tests).
- [ ] (New problem) a hidden reference exists in `references/`, a worked reference solution is
      wired into the suite, and at least one adversarial fixture is rejected.
- [ ] (New problem) no reference value leaked into the BRIEF, RUBRIC, template, or solver-facing
      fixtures.
- [ ] No secrets in any transcript you publish — run `bin/prepare-transcript.mjs` to scrub first.

## License

By contributing you agree your contribution is licensed under the project's **MIT** license (see
[LICENSE](./LICENSE)).
