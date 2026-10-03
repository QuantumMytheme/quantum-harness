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
