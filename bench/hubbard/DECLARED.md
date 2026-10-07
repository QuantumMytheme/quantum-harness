# Hubbard track: checks declared before the first run

Written 2026-10-02, before any code in this directory had been executed. These are the
answers the exact-diagonalization core must reproduce before any number it produces, or any
quantum circuit graded against it, is believed. A check that fails is reported as a failure,
never retuned to pass.

Model: H = −Σ t_ij (c†_iσ c_jσ + h.c.) + U Σ_i (n_i↑ − ½)(n_i↓ − ½), with t = 1 throughout.
The particle-hole symmetric form only shifts each fixed-N energy by a term linear in N plus a
constant, so pair-binding energies (second differences in N) are unchanged by it.

## Analytic checks (must agree to 1e-10)

1. **Two-site dimer, half filling (N = 2, S_z = 0).** Ground energy in the plain form
   (U n↑n↓) is (U − √(U² + 16t²)) / 2. Checked at U = 0, 1, 4, 10.
2. **Non-interacting plaquette (U = 0).** The 4-site ring has one-particle energies
   −2t, 0, 0, +2t, so E(N=2) = −4t, E(N=3) = −4t, E(N=4) = −4t in the plain form, and the
   pair-binding energy is exactly 0.
3. **Two routes, one Hamiltonian.** The Jordan–Wigner Pauli-sum Hamiltonian, built as a
   full 2^8 matrix and restricted to each (N↑, N↓) sector, gives the same spectrum as the
   occupation-basis ED for every sector of the plaquette at U = 4.

## Limits (must agree within the stated tolerance)

4. **Heisenberg limit.** At half filling and large U, E(N=4) → −3J with J = 4t²/U in the
   plain form (4-site Heisenberg ring, H = J Σ (S·S − ¼ n n)). At U = 100: within 2% of
   −0.12.

## Literature positive control (the one that matters)

5. **Pair binding on the 2×2 plaquette.** Δ_pb = E(2) + E(4) − 2E(3), with t′ = 0. The
   literature (Scalapino & Trugman, Phil. Mag. B 74, 607 (1996), and earlier work on the
   plaquette) reports Δ_pb < 0, meaning two holes bind, for 0 < U < U_c with U_c ≈ 4.6t.
   **Declared:** Δ_pb < 0 at U = 1, 2, 3, 4; Δ_pb > 0 at U = 6, 8; sign change found by
   bisection between 4.4 and 4.8.
6. **d-wave symmetry of the bound pair.** The two-hole ground state is reached from the
   half-filled ground state by removing a d_{x²−y²} singlet pair, not an extended-s one:
   |⟨ψ(N=2)| Δ_d |ψ(N=4)⟩| > 0.1 and |⟨ψ(N=2)| Δ_s |ψ(N=4)⟩| < 1e-8 at U = 4, where
   Δ_d = Σ_⟨ij⟩ f_ij (c_i↓ c_j↑ − c_i↑ c_j↓)/√2, f = +1 on x bonds and −1 on y bonds,
   and Δ_s has f = +1 on all bonds.

If check 5 or 6 fails, the core is wrong or our reading of the literature is. Either way,
nothing downstream (the VQE problem, the noise sweep, hardware runs) is built on it until it
is resolved.

## The quantum problem, once 1–6 pass

7. **`hubbard2x2`, an 8-qubit VQE task** (half filling, U = 4, t = 1). The hidden reference
   holds the Jordan–Wigner Hamiltonian, the exact ground energy and a held-out correlation
   the brief does not mention. The judge must ACCEPT a worked Hamiltonian-variational circuit,
   REJECT a forged energy claim (exit 4), REJECT the best product state as underpowered
   (exit 5), and REJECT a circuit that misses the held-out correlation (exit 6) if one can be
   built honestly.

## Addendum, 2026-10-02 (before the shallow-circuit sweep and before any mitigation run)

Context: the noise sweep on the ~170-two-qubit-gate circuits lost the plaquette's pair binding
(Δ_pb = −0.0363 t at U = 3) by p₂q ≈ 1×10⁻⁴ raw, ≈ 2×10⁻⁴ post-selected.

8. **Compact circuits are the same unitary.** `hop_compact` (2 CNOTs per adjacent hop, 8 per
   wrap-around bond) equals `hop` to 1e-12 for every bond geometry used. Verified before this
   addendum; it is a precondition, not a result. Ideal Δ_pb is therefore unchanged.
9. **Prediction for the compact sweep.** Two-qubit count per 3-layer circuit falls from ~170 to
   ~104. Expected: the post-selected threshold moves up by roughly that ratio, to ~3×10⁻⁴. Not
   1×10⁻³.
10. **Mitigation pass/fail, fixed now.** Zero-noise extrapolation by local unitary folding
    (noise scale factors 1, 3, 5), applied to the particle-number post-selected energies, each of
    N = 2, 3, 4 extrapolated separately, then combined into Δ_pb. **Passes at a given p₂q only if
    the mitigated Δ_pb is negative and within ±50% of exact (between −0.054 t and −0.018 t).**
    Read at p₂q = 1×10⁻³ (the headline), also reported at 3×10⁻⁴ and 3×10⁻³. Both linear and
    quadratic (Richardson) extrapolations are reported; the declared one is **quadratic
    Richardson through all three points**. The other is shown, never substituted.
11. **Shots are not free.** The density-matrix simulator gives exact expectation values. Any pass
    is reported with an estimate of the shots a real device would need to resolve Δ_pb at 3σ,
    including the variance amplification of the extrapolation and the post-selection discard.

## Addendum 2, 2026-10-02 (before the realistic-noise run)

Item 10 passed at p₂q = 1×10⁻³ under depolarizing noise with exact expectation values. Before any
hardware time, the same pass rule is re-applied under a device-like model:

12. **Measurement as a device does it.** Three settings: all-Z (interaction terms); the x bonds of
    both spins; the y bonds of both spins. Each hopping pair is rotated by S then a compact hop at
    θ = π/4, which preserves electron number, so every setting can still be post-selected on
    (N↑, N↓). Precondition (checked in code, not a result): each rotated group is diagonal.
13. **Noise model.** Depolarizing as before (p₁q = p₂q / 10), plus a coherent ZZ over-rotation
    rzz(ε = 0.02 rad) after every two-qubit gate, plus symmetric readout bit-flip p_ro = 1% per
    qubit. Folding applies to every gate, including the measurement rotations.
14. **Protocol (fixed now):** readout correction by inverting the known per-qubit confusion
    matrix → post-selection on (N↑, N↓) → quadratic Richardson ZNE at scales 1, 3, 5 per N → Δ_pb.
15. **Pass/fail:** the item-10 rule (negative, within ±50% of −0.0363 t) at p₂q = 1×10⁻³ with
    ε = 0.02 rad and p_ro = 1%. Also reported: p₂q = 3×10⁻⁴, and ε = 0 / p_ro = 0 variants, so the
    cost of each effect is visible. Shots are counted per setting (3 N × 3 scales × 3 settings = 27)
    from the actual measured distributions.

## Addendum 3, 2026-10-02 (before the twirled run)

16. **Pauli twirling.** Modelled exactly: the twirled coherent error rzz(ε) becomes the stochastic
    channel ρ → (1 − sin²(ε/2)) ρ + sin²(ε/2) ZZ ρ ZZ after every two-qubit gate. Same protocol and
    item-10 rule, ε = 0.02, readout 1%, at p₂q = 3×10⁻⁴ (failed untwirled) and 1×10⁻³. Expected:
    both pass, with the 3×10⁻⁴ estimate close to the ε = 0 value (−0.036).

## Hardware addendum (2026-10-06, before any QPU job): hubbard2x2 on an IBM Heron device

README "Next" 1: the half-filled `hubbard2x2` energy and its held-out spin correlations on a real device,
sized to the free tier (Open Plan, 600 s/month, 0 s used). Nothing about pair binding (Δ_pb needs ~4×10⁷ shots).

**Circuit.** The committed per-bond HVA, 3 layers, compact hops (`results/pb-circuits-U4.json` regenerated
2026-10-06 with the committed code: N = 4 error 2×10⁻¹², 104 logical two-qubit gates), plus the three
number-conserving settings of item 12 (all-Z, x bonds, y bonds). Conversion to Qiskit checked: ideal
statevector energy −6.102748483 (diff −1.6×10⁻¹³). Transpiled (opt 3, best of 8 seeds) on the Heron
heavy-hex: 222 / 236 / 243 CZ for Z / x / y.

**Device.** ibm_kingston (median CZ error 2.0×10⁻³, readout 0.90 %) unless it has > 20 pending jobs at
submission, then ibm_fez (2.68×10⁻³, 1.05 %). Calibration medians are recorded with the result.

**Protocol (fixed now).** One Sampler V2 job: 3 settings × 2 noise scales (1; 3 = global fold C·C†·C on
the ISA circuit, so the CZ count triples and no gate is cancelled) × 24 576 shots (Pauli twirling on the
two-qubit gates, 96 randomizations × 256 shots; XY4 dynamical decoupling), plus readout calibration
(all-0 and all-1 on the measured physical qubits of each setting, 4 096 shots each). Analysis =
`qpu.analyze`, the same function that produced the predictions: per-qubit readout inversion →
post-selection on (N↑, N↓) = (2, 2) → energy (sum of the three settings) and the two held-out
⟨Z₀↑Z₁↓⟩, ⟨Z₀↑Z₂↑⟩; linear Richardson ZNE = (3·E₁ − E₃)/2. Budget cap: if the job's estimated usage
exceeds 400 s it is not submitted; one job only.

**Predictions (computed before the run; `qpu.py predict`; gate-error model, idle/crosstalk not modelled):**

| ibm_kingston | scale-1 mitigated E | holdouts | kept (Z) | linear ZNE E | ZNE holdouts |
|---|---|---|---|---|---|
| model A (calibration medians) | −4.43 (73 %) | 0.349 / 0.064 | 0.55 | −5.84 (96 %) | 0.460 / 0.192 |
| model B (A × 2) | −2.82 (46 %) | 0.222 / −0.086 | 0.35 | −4.13 (68 %) | 0.324 / 0.027 |

Exact: E₀ = −6.102748, holdouts 0.482078 / 0.230597; best product state (Néel) −4.0.

**Pass rules (each reported, pass or fail):**
- **H1, held-out (the judge's rule):** both ZNE holdouts within ±0.05 of exact. Model A says pass, B says fail.
- **H2, energy:** ZNE energy within 10 % of exact (≤ −5.49).
- **H3, beats the best product state:** scale-1 mitigated energy below −4.0 by ≥ 3σ (shot noise).
- **H4, model check:** where each measured number falls against models A and B; a value outside [B, A]
  is reported as a model miss, not explained away.

### Result (2026-10-06, job db2scfs7f06c73aqf40g on ibm_kingston; 55 s of the 600 s Open Plan)

Raw counts, calibrations and the analysis are in `results/qpu-db2scfs7f06c73aqf40g.json`. Uncertainties:
300-sample multinomial bootstrap of every circuit's counts, calibrations included (seed 20261006).

| quantity | measured | model A | model B | exact |
|---|---|---|---|---|
| scale-1 raw E | −1.996 | −2.72 | −1.28 | −6.103 |
| scale-1 mitigated E | **−4.082 ± 0.040** | −4.43 | −2.82 | −6.103 |
| scale-1 holdouts | 0.315 ± 0.011 / 0.019 ± 0.011 | 0.349 / 0.064 | 0.222 / −0.086 | 0.482 / 0.231 |
| kept after post-selection (Z / x / y) | 0.41 / 0.51 / 0.48 | 0.55 / 0.53 / 0.53 | 0.35 / 0.34 / 0.33 | 1 |
| scale-3 mitigated E | −1.082 | −1.62 | −0.21 | — |
| **linear ZNE E** | **−5.581 ± 0.066 (91 %)** | −5.84 | −4.13 | −6.103 |
| **ZNE holdouts** | **0.455 ± 0.019 / 0.147 ± 0.019** | 0.460 / 0.192 | 0.324 / 0.027 | 0.482 / 0.231 |

- **H1 (held-out, ±0.05): FAIL.** ⟨Z₀↑Z₁↓⟩ 0.455 passes (0.027 off); ⟨Z₀↑Z₂↑⟩ 0.147 is 0.084 off.
- **H2 (ZNE energy within 10 %): PASS**, −5.581 ± 0.066 against the −5.49 line (1.4σ margin).
- **H3 (scale-1 below the Néel product state −4.0 by ≥ 3σ): FAIL**, −4.082 ± 0.040 is 2.1σ below.
- **H4 (model band): every measured value lies inside [B, A]**, at roughly 80 % of the way toward A for the
  scale-1 energy. Readout was asymmetric (1→0 flips up to 10 % on one qubit, 8 % on another), which the
  per-qubit calibration absorbed; the symmetric-readout model did not have it.

Reading: the device reproduced the half-filled plaquette's energy to 91 % after post-selection, readout
inversion and a two-point linear extrapolation, and the nearest-neighbour antiferromagnetic correlation to
within the tolerance. The diagonal correlation, a smaller signal, is under-recovered (0.147 vs 0.231), as
model A also predicted it would be (0.192): linear extrapolation from scale 3, where only ~20 % of shots
survive post-selection, leaves that bias. Next, if wanted (≈ 2 min of the remaining 545 s): a third scale
(5) for quadratic Richardson, which the simulator work (items 10–16) found necessary for small signals.

## Hardware addendum 2 (2026-10-06, before the second QPU job): three noise scales, quadratic ZNE

Craig: "yes do the third noise level". One new Sampler job on ibm_kingston with all three scales
(1; 3 = C·C†·C; 5 = C·(C†·C)²) and fresh readout calibration, so every point shares one calibration
window. It also **replicates** job db2scfs7f06c73aqf40g at scales 1 and 3. Shots 49 152 per circuit
(96 randomizations × 512, gate twirling, XY4), calibrations 4 096. Analysis unchanged (`qpu.analyze_job`),
plus quadratic Richardson (15·E₁ − 10·E₃ + 3·E₅)/8 (mitigation.py's declared weights). Budget: 545 s
left; estimate ~190 s; cancel while queued if IBM's estimate exceeds 350 s.

Predictions (`qpu.py`, same gate model as addendum 1, ibm_kingston medians):

| | scale-5 E | kept (Z) | quadratic ZNE E | ZNE holdouts |
|---|---|---|---|---|
| model A | −0.43 | 0.18 | −6.45 (106 %) | 0.508 / 0.251 |
| model B | −0.01 | 0.14 | −5.04 (83 %) | 0.396 / 0.105 |

Expected holdout uncertainty after the quadratic weights: ~0.019 (keep fractions from job 1).

Rules: **H1′** both quadratic-ZNE holdouts within ±0.05 of exact; **H2′** quadratic-ZNE energy within
10 % of exact (−5.49 ≥ E ≥ −6.71); **H5 (replication)** this job's scale-1 and scale-3 mitigated energies
agree with job 1's within 3σ (combined bootstrap); a disagreement is reported as device drift.
Model A over-shoots the energy (106 %): an over-shoot inside 10 % passes H2′; beyond it fails.

**Deviation, caught before any data (2026-10-06):** the first submission of the addendum-2 job
(`db2srrm8v0ts73c3fhn0`) was routed to ibm_fez by addendum 1's fallback rule (kingston had > 20 pending).
Addendum 2 names ibm_kingston, its predictions are kingston's, and H5 replicates a kingston job, so the
fez job was cancelled while still queued (0 s used) and resubmitted with the backend forced to kingston.

### Result of addendum 2 (2026-10-07, job db2ssrk2ljfc73d54dg0 on ibm_kingston; 153 s, 208 of 600 s used)

150-sample bootstrap (seed 20261007), calibrations included.

| quantity | measured | model A | model B | exact |
|---|---|---|---|---|
| scale-1 mitigated E | −3.408 ± 0.033 | −4.43 | −2.82 | −6.103 |
| scale-3 mitigated E | −0.491 ± 0.042 | −1.62 | −0.21 | — |
| scale-5 mitigated E | +0.017 ± 0.047 | −0.43 | −0.01 | — |
| linear ZNE (1, 3) E / holdouts | −4.867 ± 0.051 / 0.369, 0.082 | | | |
| **quadratic ZNE (1, 3, 5) E** | **−5.771 ± 0.077 (95 %)** | −6.45 | −5.04 | −6.103 |
| **quadratic ZNE holdouts** | **0.447 ± 0.022 / 0.157 ± 0.022** | 0.508 / 0.251 | 0.396 / 0.105 | 0.482 / 0.231 |

- **H1′ (holdouts ±0.05): FAIL.** ⟨Z₀↑Z₁↓⟩ passes (0.035 off); ⟨Z₀↑Z₂↑⟩ misses by 0.074, as in job 1 (0.147).
- **H2′ (quadratic energy within 10 %): PASS**, −5.771 ± 0.077 (3.6σ inside −5.49).
- **H5 (replication): FAIL, device drift.** Scale-1 −3.408 vs job 1's −4.082 (13σ); scale-3 −0.491 vs
  −1.082 (7.8σ). The device was noisier in this window; the kept fractions fell too (0.39 vs 0.41–0.51).
- **H4:** every value inside [B, A] except scale 5, which sits at B's edge (+0.017 ± 0.047 vs −0.01).

Reading: two independent hardware windows bracket the plaquette's energy at 91 % (linear, quiet window)
and 95 % (quadratic, noisy window). Quadratic extrapolation held up under a 13σ drift where linear fell
from 91 % to 80 %. The diagonal spin correlation came in at 0.147 and 0.157: under-recovered both times by
~0.08, a systematic the gate-error model does not reproduce at scale 1 (model A 0.064 vs 0.019 measured).
Open: whether that correlation's qubits sit on worse couplers (layout-specific), or decay faster than
the global fold models. Next hardware step would be a layout check, not more shots.
