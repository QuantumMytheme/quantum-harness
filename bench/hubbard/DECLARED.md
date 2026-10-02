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
