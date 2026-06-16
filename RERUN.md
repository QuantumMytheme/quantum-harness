# RERUN — point this harness at a NEW quantum problem tomorrow

The harness *is* the artifact. Adding a new problem is five steps; none of them
touch the judge's machinery — you add data + a contract, and the existing
`judge_verify.py` grades it. (This is rubric criterion **S4**.)

### 1. Author the hidden ground truth — `bench/quantum-judge/references/<id>.json`
This is the answer key the model never sees (the analog of a signing key that
never enters the sandbox). Shape depends on the task:

- **state_prep:** `target_statevector` (list of `[re, im]`, length `2**n`),
  `thresholds.fidelity`, `tolerance.fidelity_reproduce`.
- **vqe:** `hamiltonian_terms` (`[{coeff, pauli}]`, Pauli string leftmost = qubit 0),
  `ground_state_energy` (from offline diagonalization), `thresholds.energy_gap`,
  `tolerance.energy_reproduce`.

In a **live contest**, keep this directory out of the model's repo and point the
judge at it with `QH_REFERENCES_DIR=/secret/refs`. In the public template it is
committed so CI can run.

### 2. State the problem conceptually — a stanza in `BRIEF.md`
Describe the target *in words* ("prepare the 4-qubit linear-cluster state under a
ring coupling map") and the hard constraints (`n_qubits`, `max_depth`,
`native_gates`, `coupling_map`, `max_two_qubit_gates`). **Do not reveal the
amplitude vector / exact energy** — that lives only with the judge.

### 3. Bind the rubric — reuse `RUBRIC.md` + `VERIFIER-MAP.md`
The H/R/A/S criteria and their judge-exit-code bindings are already generic. A
new problem usually needs **zero** rubric edits; just confirm each criterion maps
to an exit code / metric for your task.

### 4. Build → capture → a proof bundle
The model (or a contributor) authors a circuit IR and runs:
```sh
python3 bench/quantum-judge/capture.py <circuit.json> <id> --task state_prep|vqe > bundle.json
```
`capture.py` uses the *same* simulator as the judge, so a clean capture is
guaranteed to reproduce under verification.

### 5. Verify + measure
```sh
python3 bench/quantum-judge/judge_verify.py bundle.json        # exit 0 = ACCEPT
node bin/autonomy-scorecard.mjs <session-transcript.jsonl>     # autonomy metrics
node bin/prepare-transcript.mjs <session-transcript.jsonl> --out-dir <dir>  # scrub before publishing
```

### (Optional) Lock it in as a regression
Commit a passing `quantum-proof-<id>.json` **and** an adversarial
`*-FORGED.json` for the new problem, then add both to `test_judge.py`. The bench
now defends the new problem against fabrication forever.

---
**Done definition for any rerun:** `judge_verify.py` ACCEPTs the worked bundle,
`python3 bench/quantum-judge/test_judge.py` is green, and `node --test test/*.test.mjs`
is green.
