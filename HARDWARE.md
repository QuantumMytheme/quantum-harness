# Run on real hardware — and report back

Have a quantum chip (or free-tier access to one)? You can validate a sim-verified
design on real silicon and attach the result to the corpus. The harness is built so
this **bridges simulation and hardware without weakening the score**.

## The boundary (read this first)

- **The hermetic simulator stays the canonical score.** It is deterministic and
  re-runnable by anyone — that's what makes the leaderboard trustworthy.
- **A hardware run is a labeled OVERLAY, not a new ranking.** A real QPU run isn't
  re-executable by a third party (noise, nondeterminism, queue), so a *hardware
  report* never outranks the sim score. It says: *"this sim-ACCEPTed design was run on
  backend X and measured Y."*

A hardware report has two layers, and the verifier checks both:

| layer | what it is | how it's checked |
|---|---|---|
| **re-verifiable** | the headline metric **recomputed from the raw counts** | `hardware_report.py` recomputes ⟨observable⟩ from the counts; a report whose number doesn't match its own data is **rejected** (exit 4) |
| **attested** | that those counts came from backend X at time T | recorded (`backend`, `job_id`, `calibration`) and *trusted-but-labeled* — we cannot re-run your device |

So you can't fake the number relative to your counts, and the design must already pass
in sim — but the provenance of the counts is an attestation, clearly marked.

## The flow

1. **Design + verify in sim.** Get a proof bundle that `judge_verify.py` ACCEPTs (exit 0).
   That's the design you'll run on hardware.
2. **Run it on your QPU.** `run_on_hardware.py` takes the bundle's circuit, adds the
   measurement-basis change for the observable, and (with your provider SDK wired in)
   submits and collects counts. Without a provider it emits a fillable report skeleton.
   ```sh
   python3 bench/quantum-judge/run_on_hardware.py <proof-bundle.json> --observable XX --backend ibm_torino --shots 4096
   ```
   Providers are **optional and yours** — `pip install qiskit qiskit-ibm-runtime`
   (IBM), `amazon-braket-sdk` (AWS Braket), or your vendor's SDK. None are required by
   the judge; the hermetic bench never imports them.
3. **Verify the report.** Fill the counts, then:
   ```sh
   python3 bench/quantum-judge/hardware_report.py <hardware-report.json>   # recomputes the metric, checks sim-ACCEPT
   ```
   See the worked example: [`bench/quantum-judge/hardware-report-bell_pops2.json`](bench/quantum-judge/hardware-report-bell_pops2.json)
   — a Bell state whose held-out ⟨X₀X₁⟩ measures ≈ 0.94 on a noisy device (vs the
   noiseless +1.00; that gap is real-hardware error, honestly recorded).
4. **Commit + register.** Commit the hardware report to your public run repo next to
   the proof bundle, and register a hardware overlay on the scoreboard
   ([SCOREBOARD.md](SCOREBOARD.md)). The sim score keeps the rank; the overlay shows
   *"validated on ibm_torino, ⟨X₀X₁⟩ = 0.94, 4096 shots."*

## Report format (`hardware-report@1`)

```jsonc
{
  "schema":   "quantum-harness/hardware-report@1",
  "attests":  "bench/quantum-judge/quantum-proof-pops.json",  // the sim-ACCEPTed design, repo-relative
  "problem_id": "bell_pops2", "task": "populations",
  "backend":  "ibm_torino", "n_shots": 4096,
  "settings": [ { "pauli": "XX", "counts": { "00": 1980, "11": 1986, "01": 60, "10": 70 } } ],
  "measured": { "metric": "X0X1", "value": 0.9365 },          // recomputed + checked from the counts
  "calibration": { "two_qubit_error": 0.008, "readout_error": 0.012 },
  "job_id": "...", "run_at": "2026-06-16", "runner": "your-handle"
}
```

For a weighted observable (e.g. ⟨H⟩ for `vqe`), give one `settings` entry per Pauli
basis and a `measured.terms: [{coeff, pauli, setting}]`; the verifier sums them.
Bitstring convention: qubit 0 = leftmost character (matches `sim.py`).

**Supported today:** Pauli-observable metrics (`populations` held-out observables,
`vqe` energy from Pauli-basis counts). **Next:** `classify` accuracy from per-point
counts; an optional deterministic **noisy-simulation** judge mode (density-matrix +
fixed seed) that *predicts* hardware fidelity and is itself re-verifiable, so a
hardware report can be scored against a reproducible noise model.

---
This closes the loop: **design → sim-verify → run on silicon → report back**, with the
score honest at every step. Bring your chip.
