# Outstanding asks / improvement backlog

> The running list of enhancements for quantum-harness, captured across the seed sessions.
> Each new verifiable run (a future Fable 5 / "Mythos" run, or an Opus 4.8 run today) picks
> an item from here and turns its delta proposal into that run's BRIEF + RUBRIC. "Done" is
> phrased so a fresh verifier sub-agent (the judge) can grade it without a human — every
> criterion binds to `judge_verify.py`, a reference under `references/`, or a metric.

Order ≈ priority. Status: ☐ todo · ◐ in progress · ☑ done.

## ☑ 1. Hardware-efficient ansatz study (state_prep under a real native set) — ghz3_he is LIVE
Constrain prep to a fixed hardware-efficient layer pattern (rz/rx/cz only) and ask the model
to hit the GHZ target through transpilation, not by emitting the textbook h/cx circuit.
- **Did:** added problem `ghz3_he` (task state_prep): same 3-qubit GHZ target as ghz3, linear
  [0-1-2] coupling, `native_gates:["rz","rx","cz"]`, `max_depth: 12` (the worked decomposition
  is depth 11, vs ghz3's 2× slack). The worked bundle derives the transpilation itself:
  h = rz(π/2)·rx(π/2)·rz(π/2) (= −i·H, a global phase) and cx(c,t) = (I⊗H)·cz·(I⊗H) with each
  H decomposed likewise — 17 native ops, 2 cz, fidelity 1.0 vs the held-out reference.
- **Done =** `quantum-proof-ghz3he.json` ACCEPTs (exit 0, fidelity 1.0 ≥ 0.99 vs
  `references/ghz3_he.json`) and the textbook h/cx circuit answering the same brief is REJECTED
  at STRUCTURE (exit 3) on the first non-native gate (`quantum-proof-ghz3he-NONNATIVE.json`);
  `test_judge.py` asserts both plus a single-smuggled-cx variant (41/41, was 38/38).
- Ref: bench/quantum-judge/references/ghz3_he.json, quantum-proof-ghz3he.json,
  quantum-proof-ghz3he-NONNATIVE.json.

## ☑ 2. Error-mitigation-aware design (depth/2q-count is the lever) — reference-pinned cap + 2q-cost gate LIVE
Reward circuits that reach the target with FEWER two-qubit gates, since 2q gates dominate
real error budgets — make the rubric prefer the shallower of two correct solutions.
- **Did:** references can now pin `constraints` HOST-SIDE (`_effective_constraints`: numeric
  budgets merge as the TIGHTER of reference and bundle; identity keys like native_gates /
  coupling_map override), so a bundle can no longer self-declare a looser budget. ghz3 is
  pinned at `max_two_qubit_gates: 2` (the provably-optimal count) and ghz3_he's full brief
  (native set, coupling, depth 12, cap 2) is pinned too. Added the PERFORMANCE sub-check:
  when the reference prices 2q gates (`thresholds.two_qubit_cost`, ghz3/ghz3_he: 0.05), the
  fidelity must still beat the classical baseline after paying that cost per 2q gate.
- **Done =** the 3-cx GHZ variant (`quantum-proof-ghz3-3CX.json` — exact GHZ state, honest
  claim, self-declared loose budget 4) is REJECTED at STRUCTURE (exit 3) by the reference cap;
  the 2-cx reference solution still ACCEPTs (exit 0); and a priced run whose cost-adjusted
  fidelity drops below the baseline is REJECTED at exit 5. `test_judge.py` asserts all four
  (45/45, was 41/41).
- Ref: bench/quantum-judge/judge_verify.py `_effective_constraints` + the two_qubit_cost
  sub-check in `verify_state_prep`, references/ghz3.json, quantum-proof-ghz3-3CX.json.

## ☑ 3. Larger GHZ / graph-state prep under sparse coupling — ghz5_line is LIVE
Scale state_prep past the 3-qubit toy to a 5-qubit GHZ (or a ring graph state) where a sparse
coupling map forces SWAP routing or a cascade order.
- **Did:** added problem `ghz5_line` (task state_prep): 5-qubit GHZ, threshold fidelity 0.99,
  classical baseline 0.5, and the linear [0-1-2-3-4] coupling map pinned HOST-SIDE in the
  reference (with `max_two_qubit_gates: 4` and `two_qubit_cost: 0.05` from item 2), so a
  bundle cannot self-declare a denser map. No simulator change was needed — `sim.py` is
  n-qubit generic and the judge verified the full 32-amplitude statevector at n=5.
- **Done =** the worked cascade (h q0; cx 0,1; cx 1,2; cx 2,3; cx 3,4 — depth 5, 4 entangling
  gates) ACCEPTs (exit 0, fidelity 1.0 vs `references/ghz5_line.json`,
  `quantum-proof-ghz5line.json`); a shortcut `cx 0,4` between the line's ends is REJECTED at
  STRUCTURE (exit 3, `quantum-proof-ghz5line-COUPLING.json`), including when the bundle
  declares [0,4] in its own coupling map. `test_judge.py` asserts all three (48/48, was 45/45).
- Ref: bench/quantum-judge/references/ghz5_line.json, quantum-proof-ghz5line.json,
  quantum-proof-ghz5line-COUPLING.json.

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

## ☑ 5. VQE on a 4-qubit molecular-style Hamiltonian — mol4 is LIVE
Push VQE past the 2-qubit isingbell toy to a 4-qubit Pauli-sum Hamiltonian (H2-style, but
defined entirely numerically in the reference — no chemistry deps).
- **Did:** added problem `mol4` (task vqe): a 4-qubit ring TFIM plus next-nearest-neighbor ZZ
  coupling, H = −J·Σ_ring(ZᵢZᵢ₊₁) − h·Σᵢ(Xᵢ) − K·Σ_nnn(ZᵢZᵢ₊₂), J=1.0 h=0.8 K=0.3 on the
  4-cycle 0-1-2-3-0 with diagonals 0-2/1-3 — chosen (after sweeping several (h,K) pairs) for a
  genuinely entangled ground state with real headroom over the mean-field baseline, not a
  near-product state. E0 = **−5.231094971581286** from `numpy.linalg.eigh` on the dense 16×16
  matrix (not hand-derived); the best PRODUCT state (all 4 qubits at the same Bloch angle by
  the ring's 4-fold symmetry, found by gradient descent AND confirmed analytically) reaches
  **−5.156521739130422** — a 0.0746 Ha correlation gap, so the `energy_gap: 0.02` budget
  forces a genuinely entangled ansatz. The worked ansatz (3 RY layers + 2 CX rings, 12 free
  angles, optimized by finite-difference gradient descent directly against the judge's
  `sim.expectation_pauli` — no scipy available in this environment) reaches energy
  **−5.2205633111956296**, gap **0.0105** (≤ 0.02, clears the baseline by 0.064 Ha), at depth
  11 / 8 two-qubit gates.
- **Done =** `quantum-proof-mol4.json` ACCEPTs (exit 0, verified live: gap 0.010532 ≤ 0.02,
  baseline −5.156522 beaten); the same ansatz re-claiming the exact E0 instead of its true
  recomputed energy is REJECTED at REPRODUCIBILITY (exit 4, `quantum-proof-mol4-FORGED.json`,
  verified live); a mean-field-only circuit (no entangling gates) genuinely lands on the
  0.0746 baseline gap, outside the 0.02 budget, and is REJECTED at PERFORMANCE (exit 5).
  `test_judge.py` asserts all three (51/51, was 48/48).
- Ref: bench/quantum-judge/references/mol4.json, quantum-proof-mol4.json,
  quantum-proof-mol4-FORGED.json; registered in mcp/server.mjs LABELS and
  viewer/knowledge.js PROBLEMS; added to the "no holdout block" enumeration in RUBRIC.md /
  VERIFIER-MAP.md alongside ghz3/ghz3_he/ghz5_line/isingbell2.

## ☑ 6. Quantum-kernel block — task=kernel is LIVE
A kernel-estimation circuit (state-overlap / inversion test) whose judged quantity is a
fidelity-kernel entry between two encoded inputs.
- **Did:** added task `kernel` (problem `kernel2`): a fidelity-kernel overlap
  |⟨φ(x)|φ(y)⟩|² between two classically-encoded points, using the SAME feature-bound-op
  encoding mechanism as `classify` (`_instantiate`) — the closest existing precedent flagged in
  the brief, since both tasks are data-dependent and need a held-out generalization check. One
  design choice differs from the literal spec: instead of a real SWAP-test circuit (which needs
  a 2n+1-qubit ancilla register and controlled-SWAPs), the judge instantiates the submitted
  feature-map template **independently** for x and for y (two ordinary n-qubit runs) and takes
  the overlap of the two returned statevectors directly with `sim.fidelity` — mathematically
  identical to what a SWAP test estimates, without paying for the extra qubits/gates to get it,
  and it reuses `_instantiate`/`sim.fidelity` verbatim rather than adding new simulator
  machinery. I DID build the optional held-out pair (the brief flagged it as optional): the
  reference holds a VISIBLE near-pair `x=[0.5,-0.3], y=[0.55,-0.25]` the encoding must call
  similar (`kernel_min: 0.9`) and a HELD-OUT far-pair `y=[3.0, 2.5]` it must call dissimilar
  (`kernel_max: 0.1`) — the opposite relationship, not just a second similar pair, so a
  degenerate feature map that ignores its input (`scale: 0` → every point encodes to |00⟩)
  cannot pass by being constant. Both the "expected" kernel value and the OVERFIT numbers are
  computed by re-running the judge's own `sim.py` (via `judge_verify._instantiate` +
  `sim.fidelity`), never hand-derived — printed live: visible kernel `0.9987506508572361`,
  held-out kernel `0.002872364109197902`, degenerate (both pairs) `1.0`. The worked ansatz is a
  per-feature `Ry(scale·xᵢ)` product map (2 qubits, 2 ops, scale 1.0); overlap factorizes per
  qubit as `cos²((Δθᵢ)/2)`, so a small visible Δ (~0.05/feature) stays near 1 while the large
  held-out Δ (~2.5–2.8/feature) collapses it — the same template genuinely distinguishes both
  without any hand-tuning per pair.
- **Done =** `judge_verify.py` exits 0 only when the recomputed kernel value matches the claim
  within tolerance (REPRODUCIBILITY, exit 4) for the visible pair in `references/kernel2.json`,
  AND clears `thresholds.kernel_min` (PERFORMANCE, exit 5), AND the SAME template calls the
  held-out pair dissimilar (`holdout.kernel_max`, ANTI-OVERFIT, exit 6) — all four verified
  live: `quantum-proof-kernel2.json` ACCEPTs (exit 0); `quantum-proof-kernel2-FORGED.json` (same
  genuine circuit, claims overlap `1.0` the re-sim contradicts) REJECTs at REPRODUCIBILITY
  (exit 4); `quantum-proof-kernel2-OVERFIT.json` (input-ignoring `scale: 0` map, honestly
  reproduces train-pair kernel `1.0`, clears the 0.9 threshold) REJECTs ONLY at ANTI-OVERFIT
  (exit 6) once the held-out far pair also comes back `1.0` instead of ≤ 0.1.
  `test_judge.py` grew from an observed 53/53 baseline to **58/58** (5 new checks: ACCEPT,
  FORGED exit 4, OVERFIT exit 6, tampered-claim exit 4, an honest-but-over-sensitive
  `scale: 50` encoding that genuinely misses the visible-pair threshold at exit 5).
  `bench/test_router.py` stays 9/9 (task string `kernel` does not collide with the
  kernel-judge's `kernel-correctness-oracle`/`roofline-attest` TPU tasks). `npm test` stays
  283/283 after registering `kernel2` in `mcp/server.mjs` LABELS, `viewer/knowledge.js`
  PROBLEMS/TASKS/TASK_HUE (required by `test/mcp.test.mjs`'s every-reference-has-task+label
  assertion), and rebuilding `viewer/scoreboard-data.js` via `node scoreboard/build.mjs`
  (`test/frontier.test.mjs` enumerates every committed reference into the Wanted Board coverage
  table and failed until the board was regenerated — a real, mechanical gap, not hardcoded
  around). **Follow-up closed same session:** `scoreboard/verify.py` and
  `scoreboard/discover.mjs` initially gated community entries on a `KNOWN_TASKS` set that
  excluded `kernel` — checked whether this was a silent trust-gate hole (it was not: unknown
  tasks FAIL CLOSED via `entry_shape_error`, so a `kernel2` entry would have been correctly
  rejected, just unable to register at all) and closed it properly: `kernel` added to
  `KNOWN_TASKS` in both files, `judged_metric()` gained `checks["reproduced"]["kernel"]` as
  the ranking value (higher-is-better, same convention as `state_prep`'s fidelity), and
  `bin/ingredients.mjs`'s `DIR` map marked it `'higher'`. Rebuilt the board — `kernel2` now
  shows as a genuine, mintable Wanted Board gap (`bin/new-run.sh run-kernel2 --remix kernel2`),
  and `scoreboard/verify.py` still re-verifies 9/9 (unaffected — no `kernel` entries exist yet).
- Ref: `bench/quantum-judge/judge_verify.py` (`verify_kernel`, registered in `TASKS`),
  `bench/quantum-judge/references/kernel2.json`, `quantum-proof-kernel2.json`,
  `quantum-proof-kernel2-FORGED.json`, `quantum-proof-kernel2-OVERFIT.json`; registered in
  `mcp/server.mjs` LABELS and `viewer/knowledge.js` PROBLEMS/TASKS/TASK_HUE; RUBRIC.md (new
  R7c, X2 marked done, held-out-forms list, task count, worked-bundle count, test count) and
  VERIFIER-MAP.md (task count, held-out-forms list, R7c/R7c-regression rows, X3 stretch row,
  copy-paste gate block) updated to enumerate the sixth task type; BRIEF.md (Target 6 section +
  schema enum) and RERUN.md (six worked problems, kernel bundle shape, anti-cheat regression,
  "what stays" fixture list) and README.md (schema `task` enum) updated for consistency.

## ☑ 7. OpenQASM3 import adapter (authoring convenience, judge unchanged)
Let authors hand the harness an OpenQASM3 file; convert to the proof-bundle `circuit.ops`
form so the existing simulator and judge grade it unchanged.
- **Did:** added `bench/quantum-judge/qasm_import.py`, a stdlib-only (no `qiskit`/`openqasm3`
  package — checked `requirements.txt` first; nothing like that was a dep) statement-level
  regex/split parser over an EXPLICIT subset: `qubit[n] name;` declarations (one or more
  registers, flattened into a single 0-based index space) plus the exact gate list from the
  spec (`x y z h s sdg t tdg sx sxdg rx ry rz p`; `cx cz cy swap crz cp rzz`; `ccx`). Verified
  the gate-name mapping against `sim.py`'s real `KNOWN_GATES`/`ONE_Q`/`TWO_Q`/`THREE_Q` tables
  rather than assuming: the mapping turned out to be the **identity** for every name in this
  subset (OpenQASM3's `stdgates.inc` names and `sim.py`'s internal op names are already the
  same string, including `p` — no renaming table was needed), asserted in
  `test_qasm_import.py` as `qasm_import.SUPPORTED_GATES.issubset(sim.KNOWN_GATES)`. Params are
  evaluated with a small hand-written recursive-descent expression parser (not Python `eval`)
  supporting `+ - * /`, parens, float literals, and the `pi` identifier — deliberate: this is
  authoring input, and the project's ethos is to avoid running arbitrary code to parse it. Any
  instruction outside the subset (`barrier`, `measure`, `reset`, `if`/`for`/`gate`/`def`,
  `bit`/`creg`, or a real-but-unlisted stdgates.inc gate like `ch`/`u`/`u1`) raises
  `QasmImportError` naming the offending line/instruction — never a silent drop. The CLI either
  emits the bare `{n_qubits, ops}` circuit IR (`capture.py`'s own input shape) or, given
  `--problem_id`/`--task`, shells out to `capture.py` UNCHANGED to build the full bundle, so
  this file never re-implements bundle-building or touches the judge's trust boundary.
- **Done =** verified live: `qasm_fixtures/ghz3.qasm` (h + 2×cx) round-trips through
  `qasm_import.py --problem_id ghz3 --task state_prep` → `capture.py` → `judge_verify.py` and
  ACCEPTs (exit 0, fidelity 1.0 reproduced, cost-adjusted fidelity 0.9 ≥ baseline 0). Two
  unsupported-instruction fixtures (`qasm_fixtures/unsupported_barrier.qasm`,
  `qasm_fixtures/unsupported_gate.qasm` using `ch`) both fail the importer with a clear,
  specific error and exit 2 — no traceback, no dropped op. New `test_qasm_import.py`
  (17/17, wired into `bin/test-all.sh` and `npm run judge:qasm-import:test`) covers the
  round-trip ACCEPT, both clean-failure cases, and gate-mapping unit checks (e.g. QASM
  `cx q[0], q[1];` → `{"gate":"cx","q":[0,1]}`, `ccx q[0],q[1],q[2];` →
  `{"gate":"ccx","q":[0,1,2]}`, `rz(pi/2) q[0];` → `{"gate":"rz","q":[0],"params":[pi/2]}`).
  `test_judge.py` is untouched and stayed at 53/53 — the judge's trust boundary did not move;
  this is purely an authoring-side converter that hands the existing judge input it already
  knew how to grade.
- Ref: `bench/quantum-judge/qasm_import.py`, `bench/quantum-judge/capture.py`,
  `bench/quantum-judge/test_qasm_import.py`, `bench/quantum-judge/qasm_fixtures/`, sim.py gate
  table.

## ☑ 8. Noisy-simulation judge mode — IMPLEMENTED, via a stronger mechanism than proposed
Add an optional depolarizing-noise model so PERFORMANCE can be graded under a noise budget,
not just ideal statevector — a more honest fidelity for hardware-leaning runs.
- **Did:** built `density_matrix.py` (depolarizing channel, density-matrix simulation) and
  `check_noisy_prediction()` in `judge_verify.py`, wired into **both** `verify_state_prep`
  (fidelity kind) and `verify_vqe` (energy kind) — not just the one worked problem. It fires
  whenever a reference declares a `noise_model` block; references without one are byte-for-byte
  unaffected (`Backward-compatible: references without a noise_model skip this entirely`). The
  worked problem `bellnoisy2` claims both an ideal fidelity (1.0) and a `noisy_fidelity`
  (0.916159, recomputed by the judge from a real depolarizing channel — `depolarizing_1q: 0.01`,
  `depolarizing_2q: 0.04`), and both must reproduce.
- **Deliberately not a `--noise p` CLI flag.** The proposal's flag would let the AUTHOR pick an
  easy noise level; the shipped design makes the noise level **reference-authoritative** instead
  — the same anti-gaming principle as the hidden target in every other gate (and as the
  reference-pinned constraints landed the same day in item 2). A CLI flag was rejected as
  strictly worse, not merely different.
- **Done =** verified live: `quantum-proof-noisy.json` (genuine on-device-style prediction)
  ACCEPTs exit 0; `quantum-proof-noisy-FORGED.json` (claims 0.98, true value 0.916159) REJECTS
  at exit 4 exactly as spec'd; ideal-mode problems (ghz3, isingbell2, …) are unchanged because
  their references carry no `noise_model` key. Regression-tested in `test_judge.py` (part of
  the current 48/48 suite).
- Ref: bench/quantum-judge/density_matrix.py, judge_verify.py `check_noisy_prediction`,
  references/bellnoisy2.json.
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

## ☑ 12. Forgery-fixture expansion (one fixture per forgery class) — full gallery LIVE
The committed `quantum-proof-FORGED.json` covers one class (dropped CX, fabricated fidelity).
Add a committed adversarial fixture for EACH judge gate so every reject path has a regression.
- **Did:** the STRUCTURE (3) and ANTI-OVERFIT (6) classes already had committed, named fixtures
  from other items (`quantum-proof-ghz3-3CX.json` — item 2's 2q-cost cap; `quantum-proof-OVERFIT.json`
  + 2 siblings — item 11) but PERFORMANCE (5) only existed as a fixture constructed inline inside
  `test_judge.py` (mol4's mean-field-only case), not a standalone committed file a citizen could
  browse or run. Shipped `quantum-proof-ghz3-UNDERPOWERED.json`: RY(0.6π) instead of the exact H,
  then the real cascade — fidelity 0.9755, exactly what the judge recomputes (no lie), clears the
  0.5 classical baseline by a wide margin, and still misses the 0.99 threshold. The literal
  "meets threshold but loses to baseline" phrasing in the original proposal doesn't apply to any
  current problem's numbers (baseline < threshold everywhere it's declared), so this fixture
  demonstrates the real, common PERFORMANCE failure instead: an honest, correctly-reproduced,
  genuinely-not-good-enough design — distinct from a reproducibility lie or a structural cap
  violation.
- **Also wired into the Impostor Workshop** (the lab's "Gallery of Traps", built earlier this
  session): both new-to-the-gallery fixtures (STRUCTURE + PERFORMANCE) added to `runner.js`
  `IMPOSTORS`, so all four reject gates are now visitor-runnable trap cards, not just two.
- **Done =** `test_judge.py` asserts `quantum-proof-ghz3-3CX.json` (exit 3) and
  `quantum-proof-ghz3-UNDERPOWERED.json` (exit 5) as standalone "forgery gallery" checks
  alongside the existing exit-4/exit-6 assertions (53/53, was 51/51); `test/impostor.test.mjs`
  asserts the gallery covers exactly `{3,4,5,6}` — every judge reject gate, not a fixed count.
- Ref: bench/quantum-judge/quantum-proof-ghz3-3CX.json, quantum-proof-ghz3-UNDERPOWERED.json,
  viewer/runner.js `IMPOSTORS`, test/impostor.test.mjs.

---
When an item ships, mark it ☑, note the worked reference + fixtures it shipped with, and move
any follow-ups into a fresh todo. Every "Done" must remain gradable by `judge_verify.py` or a
metric — no human-eyeball criteria.
