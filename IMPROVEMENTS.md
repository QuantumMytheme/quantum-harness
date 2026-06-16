# Outstanding asks / improvement backlog

> The running list of enhancements for quantum-harness, captured across the seed sessions.
> Each new verifiable run (a future Fable 5 / "Mythos" run, or an Opus 4.8 run today) picks
> an item from here and turns its delta proposal into that run's BRIEF + RUBRIC. "Done" is
> phrased so a fresh verifier sub-agent (the judge) can grade it without a human — every
> criterion binds to `judge_verify.py`, a reference under `references/`, or a metric.

Order ≈ priority. Status: ☐ todo · ◐ in progress · ☑ done.

## ☐ 1. Hardware-efficient ansatz study (state_prep under a real native set)
Constrain prep to a fixed hardware-efficient layer pattern (rz/rx/cz only) and ask the model
to hit the GHZ target through transpilation, not by emitting the textbook h/cx circuit.
- **Do:** add problem `ghz3_he` (task state_prep): same 3-qubit GHZ target, linear [0-1-2]
  coupling, but `native_gates:["rz","rx","cz"]` and a tighter `max_depth`; the model must
  decompose h and cx into the native set itself.
- **Done =** `judge_verify.py <bundle>` exits 0 on a circuit using ONLY {rz,rx,cz}, fidelity
  ≥ 0.99 vs the held-out `references/ghz3_he.json`, and STRUCTURE (exit 3) rejects any bundle
  that emits a non-native gate.
- Ref: bench/quantum-judge/references/ghz3.json, sim.py native-gate gate set.

## ☐ 2. Error-mitigation-aware design (depth/2q-count is the lever)
Reward circuits that reach the target with FEWER two-qubit gates, since 2q gates dominate
real error budgets — make the rubric prefer the shallower of two correct solutions.
- **Do:** tighten `max_two_qubit_gates` on an existing problem (e.g. ghz3 → cap 2) and add a
  PERFORMANCE sub-check that the claimed fidelity holds when each 2q gate is treated as the
  cost unit beaten against the classical baseline.
- **Done =** a 3-cx GHZ variant is REJECTED at STRUCTURE (exit 3) by the cap, the 2-cx
  reference still ACCEPTs (exit 0), and `test_judge.py` gains a regression asserting both.
- Ref: bench/quantum-judge/judge_verify.py STRUCTURE gate, max_two_qubit_gates.

## ☐ 3. Larger GHZ / graph-state prep under sparse coupling
Scale state_prep past the 3-qubit toy to a 5-qubit GHZ (or a ring graph state) where a sparse
coupling map forces SWAP routing or a cascade order.
- **Do:** add problem `ghz5_line` (task state_prep): 5-qubit GHZ, linear [0-1-2-3-4] coupling,
  threshold fidelity 0.99, classical baseline 0.5; ship the held-out reference + a worked
  cascade solution (h q0; cx 0,1; cx 1,2; cx 2,3; cx 3,4).
- **Done =** `judge_verify.py` exits 0 on the cascade reaching fidelity ≥ 0.99 vs
  `references/ghz5_line.json`, and a bundle that violates the coupling map (e.g. cx 0,4) is
  REJECTED at STRUCTURE (exit 3).
- Ref: bench/quantum-judge/references/ghz3.json (as the n=3 prior).

## ☑ 4. Quantum feature-map for a small classification task — task=classify is LIVE
A problem class where the circuit ENCODES a classical input and the judge scores a
data-dependent quantity. The `classify` task ships a quantum feature-map classifier with a
held-out TEST SET as the anti-overfit guard.
- **Did:** added task `classify` (`verify_classify`) with an angle-encoding feature map
  (feature-bound op `{"feature": idx, "scale": s}` so its angle = s·x[idx]) + a Pauli readout
  with bias; reference holds the `train` set, `thresholds.train_accuracy_min`, and a held-out
  `holdout.test` + `test_accuracy_min`. The judge re-simulates per input, reproduces the claimed
  training accuracy, then classifies the UNSEEN test set under the anti-overfit gate.
- **Done =** the worked `qml_sign1` problem ACCEPTs the low-frequency Ry(x) map
  (`quantum-proof-qml.json` → exit 0): claimed train accuracy reproduces (REPRODUCIBILITY,
  exit 4), clears `train_accuracy_min` (PERFORMANCE, exit 5), and generalizes to the held-out
  test set — while the aliasing Ry(7x) map that fits training but flips on unseen data is
  REJECTED at ANTI-OVERFIT (exit 6) (`quantum-proof-qml-OVERFIT.json`). `test_judge.py` asserts
  both plus the exit-4/exit-5 reject fixtures.
- Ref: bench/quantum-judge/judge_verify.py `verify_classify` / `check_holdout` EXIT_OVERFIT (6),
  references/qml_sign1.json, quantum-proof-qml.json, quantum-proof-qml-OVERFIT.json.

## ☐ 5. VQE on a 4-qubit molecular-style Hamiltonian
Push VQE past the 2-qubit isingbell toy to a 4-qubit Pauli-sum Hamiltonian (H2-style, but
defined entirely numerically in the reference — no chemistry deps).
- **Do:** add problem `mol4` (task vqe): 4-qubit Hamiltonian as a Pauli-string list in the
  held-out reference, with true E0, a product/classical baseline energy, and an `energy_gap`
  budget; brief states the Hamiltonian shape conceptually only.
- **Done =** `judge_verify.py` exits 0 when the recomputed energy is within `energy_gap` of
  E0 in `references/mol4.json` AND beats the classical baseline (PERFORMANCE, exit 5); a
  bundle claiming E0 but whose ansatz recomputes higher is REJECTED at exit 4.
- Ref: bench/quantum-judge/references/isingbell2.json (the n=2 prior).

## ☐ 6. Quantum-kernel block
A kernel-estimation circuit (state-overlap / inversion test) whose judged quantity is a
fidelity-kernel entry between two encoded inputs.
- **Do:** add task `kernel`: brief asks for an overlap circuit on a data pair; reference holds
  the input pair + the expected |⟨φ(x)|φ(y)⟩|² and a tolerance; judge re-simulates the
  overlap and compares.
- **Done =** `judge_verify.py` exits 0 only when the recomputed kernel value matches the claim
  within tolerance (REPRODUCIBILITY, exit 4) for the held-out pair in
  `references/kernel2.json`, and a forged overlap claim is rejected.
- Ref: bench/quantum-judge/sim.py statevector overlap.

## ☐ 7. OpenQASM3 import adapter (authoring convenience, judge unchanged)
Let authors hand the harness an OpenQASM3 file; convert to the proof-bundle `circuit.ops`
form so the existing simulator and judge grade it unchanged.
- **Do:** add `qasm_import.py` mapping the supported gate subset (x y z h s sdg t tdg sx sxdg
  rx ry rz p; cx cz cy swap crz cp rzz; ccx) onto bundle ops, with explicit failure on any
  unsupported instruction; numpy-only verification root stays intact (QASM parse is authoring
  side).
- **Done =** `capture.py`/judge round-trips a QASM3 GHZ file to a bundle that `judge_verify.py`
  ACCEPTs (exit 0) on ghz3, and a QASM file using an unsupported gate fails the importer with
  a clear error rather than silently dropping the op.
- Ref: bench/quantum-judge/capture.py, sim.py gate table.

## ☐ 8. Noisy-simulation judge mode
Add an optional depolarizing-noise model so PERFORMANCE can be graded under a noise budget,
not just ideal statevector — a more honest fidelity for hardware-leaning runs.
- **Do:** add a `--noise p` path in `sim.py` (density-matrix or trajectory-averaged
  depolarizing per gate) and a judge mode that reads a per-problem noise level from the
  reference; ideal mode stays the default so existing problems are unaffected.
- **Done =** `judge_verify.py --noise` reproduces a claimed noisy fidelity within tolerance
  for a problem whose `references/*.json` declares a noise level, the ideal-mode regression in
  `test_judge.py` is unchanged (still 29/29), and a claim of ideal fidelity 1.0 under noise>0
  is REJECTED at exit 4.
- Ref: bench/quantum-judge/sim.py, judge_verify.py PERFORMANCE gate.

## ☑ 9. Architecture-design judge (task=architecture) — IMPLEMENTED, no longer a stub
`task=architecture` is a real, machine-checkable verdict: the model designs a hardware coupling
map (topology) that must route a declared workload of two-qubit interactions within budget.
- **Did:** added `verify_architecture` + `graph.py` (degrees / connectivity / shortest-path
  routing cost). The bundle carries `architecture:{n_qubits,coupling_map}` + `constraints:
  {max_degree,connected}` + `claim:{routing_cost}`; the reference holds the visible `workload`,
  `thresholds.routing_cost_max`, and a held-out `holdout.workload` + `routing_cost_max`. The
  judge validates the graph (STRUCTURE), reproduces the routing cost (REPRODUCIBILITY), checks
  the budget/baseline (PERFORMANCE), then routes the held-out workload on the SAME topology
  (ANTI-OVERFIT).
- **Done =** the worked `aiaccel4` problem ACCEPTs the ring topology (`quantum-proof-arch.json`
  → exit 0) and REJECTs a topology hand-tuned to the visible workload at ANTI-OVERFIT (exit 6)
  because it cannot route the held-out workload within budget (`quantum-proof-arch-OVERFIT.json`);
  a degree-over-budget graph is REJECTED at STRUCTURE (exit 3). `test_judge.py` asserts all of
  these plus the exit-4/exit-5 reject fixtures.
- Ref: bench/quantum-judge/judge_verify.py `verify_architecture`, graph.py,
  references/aiaccel4.json, quantum-proof-arch.json, quantum-proof-arch-OVERFIT.json.

## ◐ 10. Real-QPU optional swap (sim → hardware, judge contract preserved) — SPINE LANDED
Run a sim-verified circuit on a real backend and report back, keeping the deterministic numpy
judge as the source of truth (hardware results are a labeled overlay, not the gate).
- **Landed:** `hardware-report@1` schema; `hardware_report.py` (recomputes the metric from raw
  counts — re-verifiable — and requires the attested design to be sim-ACCEPTed; provenance is
  attested/labeled); `run_on_hardware.py` adapter stub (optional qiskit/braket, no SDK at the
  verification root); worked `hardware-report-bell_pops2.json`; `HARDWARE.md`; scoreboard
  hardware-overlay section; 2 regression checks (now 29/29). Removing any provider SDK changes
  nothing — the judge never imports one.
- **Next:** real provider adapters wired (IBM/Braket); `classify` accuracy-from-counts; a
  deterministic noisy-sim (density-matrix) judge mode so hardware reports score against a
  reproducible noise prediction; a hardware column on the rendered scoreboard.
- Ref: bench/quantum-judge/{hardware_report.py, run_on_hardware.py}, HARDWARE.md.

## ☑ 11. Anti-overfit hardening — the EXIT_OVERFIT held-out reject path is LIVE
The explicit exit-6 reject path landed: a held-out generalization check the model is never told,
so a circuit tuned to the VISIBLE spec cannot pass by coincidence. Anti-overfit is now a REAL,
TESTED gate (not by-construction only) for any problem declaring a held-out check.
- **Did:** added a `holdout` block to references (held-out observables / target the model never
  sees), a new `populations` task + `bell_pops2` problem as the worked under-determined case, and
  the `check_holdout` code path in `judge_verify.py` that raises EXIT_OVERFIT (6) when a held-out
  observable/target fails.
- **Done =** the genuine Bell state |Φ+⟩ ACCEPTs (`quantum-proof-pops.json` → exit 0), while a
  wrong-phase impostor |Φ−⟩ that still matches the visible Z-basis populations is REJECTED at
  ANTI-OVERFIT (exit 6) on the held-out ⟨X0X1⟩=+1 check (`quantum-proof-OVERFIT.json`); the
  impostor passes structure/reproducibility/performance and fails ONLY the held-out gate.
  `test_judge.py` is now 29/29 (was 12/12) with the overfit-rejection regression added.
- Ref: bench/quantum-judge/judge_verify.py `check_holdout` / EXIT_OVERFIT (6),
  references/bell_pops2.json, quantum-proof-pops.json, quantum-proof-OVERFIT.json.

## ☐ 12. Forgery-fixture expansion (one fixture per forgery class)
The committed `quantum-proof-FORGED.json` covers one class (dropped CX, fabricated fidelity).
Add a committed adversarial fixture for EACH judge gate so every reject path has a regression.
- **Do:** add fixtures that trip STRUCTURE (coupling-map violation), PERFORMANCE (meets
  threshold but loses to baseline), and ANTI-OVERFIT (passes primary, fails held-out), each
  named for the exit it must produce.
- **Done =** `test_judge.py` asserts each new fixture is REJECTED at its exact exit code
  (3 / 5 / 6), the existing exit-4 forgery still rejects, and the worked examples still ACCEPT
  — total green count grows from 29/29. Note: the ANTI-OVERFIT (exit 6) fixture now exists
  (`quantum-proof-OVERFIT.json`, shipped with item 11) and is asserted in `test_judge.py`;
  remaining scope is the dedicated STRUCTURE (3) and PERFORMANCE (5) per-class fixtures named
  for their exit code.
- Ref: bench/quantum-judge/quantum-proof-FORGED.json, test_judge.py.

---
When an item ships, mark it ☑, note the worked reference + fixtures it shipped with, and move
any follow-ups into a fresh todo. Every "Done" must remain gradable by `judge_verify.py` or a
metric — no human-eyeball criteria.
