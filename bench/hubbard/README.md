# Hubbard track

The Fermi-Hubbard model is the standard minimal model of the strongly correlated electrons in
cuprate and nickelate superconductors. It is also one of the leading candidates for a genuine
quantum-computing advantage, because the classical exact methods hit an exponential wall and the
approximate ones disagree about the bulk.

This track does not claim an advantage. At every cluster size here a laptop is faster. What it
builds is a pipeline in which every quantum number is graded against an exact answer, so the same
tooling can be pointed at larger lattices and real hardware later.

## What is here

| file | role |
|---|---|
| `DECLARED.md` | the checks and expected answers, committed before any code ran |
| `hubbard.py` | exact diagonalization (numpy only) + Jordan-Wigner Pauli Hamiltonian |
| `test_hubbard.py` | the declared checks; `HUBBARD_BREAK=1` removes fermion signs and must fail |
| `ansatz.py` | Hamiltonian-variational circuits in the judge's circuit IR |
| `make_problem.py` | authors `hubbard2x2` (reference + committed bundles); needs scipy |

## Results so far (2026-10-02)

Exact-diagonalization core, 7/7 declared checks (0.5 s on a Raspberry Pi 5):

- Dimer and non-interacting plaquette match their closed forms to 1e-14.
- The Jordan-Wigner Pauli sum and the occupation-basis ED give identical spectra in all 25
  (N↑, N↓) sectors of the plaquette.
- **Positive control:** on the 2×2 plaquette, two holes bind for 0 < U < **4.584 t**
  (literature: ~4.58 t), and the bound pair is pure d_{x²−y²} (extended-s overlap 6×10⁻¹⁷).
- With fermion signs removed, 4 of the 7 checks fail, so the suite does test fermion physics.

`hubbard2x2`, an 8-qubit VQE problem in the quantum judge (half filling, U = 4):

| bundle | circuit | judge |
|---|---|---|
| worked | 3-layer HVA, 172 two-qubit gates, gap 2.3×10⁻³ t, fidelity 0.9992 | exit 0 |
| exact | 4-layer HVA, 224 two-qubit gates, gap 3×10⁻¹³ t | exit 0 |
| FORGED | 3-layer circuit claiming the exact E₀ | exit 4 |
| UNDERPOWERED | 1 honest layer, gap 0.446 t | exit 5 |
| OVERFIT | adversarial per-bond angles: energy in budget (gap 0.008 t), ⟨Z₀↑Z₁↓⟩ 0.395 vs 0.482 | exit 6 |

The initial state matters: from a Néel state the symmetric ansatz stalls 0.5 t above E₀ even at
4 layers. From the ground state of the x-bond hopping alone (a closed-shell product of bonding
orbitals) it converges.

Pair binding through the quantum route (`pair_binding_vqe.py`, U = 3, 3 layers, one angle per bond):
VQE energies at N = 2, 3, 4 are each within 6×10⁻⁴ t of exact, giving **Δ_pb = −0.0357 t vs exact
−0.0363 t**. Tying both x bonds to one angle (as at half filling) stalls N = 2 at 1.3 t and N = 3 at
0.7 t above exact, because the doped start states fill only some of the x bonds.

Noise sweep (`noise_sweep.py`, depolarizing, p₁q = p₂q / 10, the same circuits, 164–172 two-qubit gates):

| p₂q | Δ_pb raw | Δ_pb post-selected on (N↑, N↓) | kept (N = 4) |
|---|---|---|---|
| 0 | −0.0357 | −0.0357 | 100% |
| 1×10⁻⁴ | +0.0061 | −0.0177 | 98% |
| 3×10⁻⁴ | +0.0842 | +0.0186 | 93% |
| 1×10⁻³ | +0.3045 | +0.1465 | 80% |
| 3×10⁻³ | +0.6163 | +0.4990 | 54% |
| 1×10⁻² | +0.4776 | +1.1050 | 22% |

**The binding signal is gone by p₂q ≈ 1×10⁻⁴ raw and ≈ 2×10⁻⁴ with post-selection.** Today's best
two-qubit error rates are around 10⁻³, a few ×10⁻⁴ on the best devices, so these circuits run as-is
on hardware would measure noise, not pairing. The hardware step has to cut the two-qubit count by an
order of magnitude, add error mitigation tested first in this simulator, or measure a larger signal
than a 0.04 t second difference.

Shallower circuits + zero-noise extrapolation (`mitigation.py`; pass/fail fixed beforehand in
`DECLARED.md` items 8–11). `hop_compact` is the same unitary with 2 CNOTs per adjacent hop and 8 per
wrap-around bond, so the 3-layer circuits drop from 164–172 to **100–104 two-qubit gates** with
identical ideal answers. ZNE: local unitary folding at noise scales 1, 3, 5, quadratic Richardson
on the post-selected energies, per N, then Δ_pb. `fastdm.py` reproduces the judge's density-matrix
simulator to 1e-16, 23× faster.

| p₂q | raw | post-selected | ZNE (quadratic, declared) | ZNE (linear) | declared pass | shots per setting, 3σ (lower bound) |
|---|---|---|---|---|---|---|
| 1×10⁻⁴ | −0.0132 | −0.0274 | −0.0357 | −0.0359 | pass | 3.4×10⁴ |
| 3×10⁻⁴ | +0.0299 | −0.0106 | −0.0358 | −0.0369 | pass | 1.1×10⁵ |
| 1×10⁻³ | +0.1610 | +0.0494 | **−0.0405** | −0.0394 | **pass** | 4.5×10⁵ |
| 3×10⁻³ | +0.4024 | +0.2283 | −0.1024 | +0.0921 | fail | 2.0×10⁶ |

Exact Δ_pb = −0.0363 t. Compact circuits alone keep the post-selected binding to between 3×10⁻⁴
and 1×10⁻³ (predicted ~3×10⁻⁴). With ZNE the binding is recovered at 1×10⁻³, within 12% of exact,
and lost at 3×10⁻³.

How far to trust that:

- Here p₂q is depolarizing strength per qubit after each two-qubit gate; the matching two-qubit gate
  infidelity is about 4p/3, so the pass at 1×10⁻³ corresponds to ~1.3×10⁻³ gate error.
- Depolarizing noise is the case ZNE handles best. Real devices add coherent errors, crosstalk,
  leakage and readout error, which extrapolate worse.
- The shot counts are lower bounds (they assume H is sampled in its eigenbasis). Measuring the
  ~20 Pauli terms in commuting groups costs more, and there are 9 settings (3 electron numbers ×
  3 noise scales): a few million shots at 1×10⁻³ before measurement-group overhead.
- The compact circuits use the qubit pairs of an all-to-all device (trapped ions). A
  nearest-neighbour superconducting layout would add SWAPs.

## Limits

- Small clusters mislead about the bulk. The plaquette's pair binding is real, but whether the
  infinite 2D Hubbard model superconducts is still argued over with the largest classical
  calculations.
- The coupling map is all-to-all and the circuits use 170–220 two-qubit gates. No current device
  runs that coherently; the hardware step needs a fermionic-swap layout and a much shallower
  circuit, measured against the same exact answer.

## Next

1. Before hardware time: add readout error and a coherent over-rotation to the noise model and
   re-run the mitigation judged the same way; count shots with real measurement groups.
2. Real QPU: the plaquette on a free-tier device, mapped to its coupling graph, reported against
   the exact answer.
3. Larger clusters by Lanczos (2×3, 2×4 ladders, 3×3), t′ sweeps, and published cuprate and
   nickelate parameters.
