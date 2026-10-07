# From pairing in a model to a material: the Hubbard track's next phase (plan, 2026-10-07)

**Why the change.** The lab's primary goal is room-temperature superconductivity. The best large
computational study of conventional (phonon) superconductors at ambient pressure (Gao et al., Nat.
Commun. 2025, 20,000+ metals) concludes that room temperature by that mechanism is "extremely
unlikely". The ambient-pressure record holders are cuprates, where pairing is generally attributed to
electronic correlations of the kind the Hubbard model describes, and no comparable ceiling is known for
that mechanism. So the useful question for this track is no longer "can a quantum computer reproduce a
4-site answer", but **which model parameters make pairing strongest, and which real compounds have them.**

**What stays.** The harness, the judge and the hardware path (`qpu.py`) remain; quantum hardware is used
again only for a question that exceeds what exact classical methods can answer.

## The question, in parameters

For one- and two-orbital Hubbard-type models: how does a pairing scale depend on

| parameter | meaning | where real materials sit |
|---|---|---|
| t′/t | next-nearest-neighbour hopping | cuprates span a range of t′/t; often linked to Tc_max (verify the literature, below) |
| U/t | on-site repulsion | ~6–12 in cuprates (model-dependent) |
| doping x | holes per site | optimal near 0.15 in cuprates |
| t⊥ / t | interlayer hopping | central to the bilayer nickelates (La₃Ni₂O₇ under pressure) |

## First experiment (declare before running; classical, ~$0)

**Does a small-cluster pairing proxy track known cuprate trends at all?** If it does not, nothing built on
it can guide materials design.

1. Pair-binding Δ_pb and the pair-field correlation on 2×4 and 2×6 ladders (Lanczos, extending
   `hubbard.py`), U/t ∈ {6, 8}, t′/t ∈ {0, −0.1, −0.2, −0.3, −0.4}, two doped holes.
2. **Oracle (read 2026-10-07, arXiv cond-mat/0012051 = Pavarini, Dasgupta, Saha-Dasgupta, Jepsen,
   Andersen, PRL 87, 047003 (2001)):** "For the single-layer materials, we observe a strong correlation
   between r and Tc max", and Tc max "increases" with r; "one may think of r as t′/t, this holds only for
   flat layers and when r<0.2"; "t′/t=0.17 for La2CuO4 and 0.33 for Tl2Ba2CuO6" (Tc max ≈ 40 K vs ≈ 90 K).
   Hedge kept: r is not exactly t′/t beyond 0.2, and the correlation is empirical.
3. **Declared rule (2026-10-07, before running):** pairing proxy = −Δ_pb (positive = bound pair) for two
   holes doped into the half-filled ladder, t′ on the plaquette diagonals with the hole-doped sign
   (t′/t < 0). **Pass** if −Δ_pb increases monotonically with |t′/t| over {0, 0.1, 0.2, 0.3, 0.4} at
   U/t = 8 on the 2×4 ladder, and the 2×6 ladder agrees in direction between |t′/t| = 0.1 and 0.3.
   **Fail** otherwise; a fail means this proxy, on these clusters, cannot be used to rank materials.

## Then (if the proxy passes)

- **Downfold real compounds.** Use the lab's existing DFT pipeline plus Wannier functions (wannier90 from
  conda-forge) to extract t, t′, t⊥ for known cuprates and nickelates, then for hypothetical variants
  (strain, substitution, layering). Rank them with the validated proxy.
- **Larger systems.** Move from exact diagonalisation to DMRG on longer ladders (TeNPy, pip) for the
  top-ranked parameter sets.
- **Quantum hardware** returns when a ranked candidate needs a cluster size beyond exact methods; the
  free-tier minutes are kept for that.

## What this is not

Not a claim that the Hubbard model fully explains cuprates (still argued), and not a substitute for
experiment: the deliverable is a ranked list of real or near-real compounds with model parameters that
the validated proxy says pair more strongly than known ones.

## Result of the first experiment (2026-10-07): **FAIL, the proxy runs opposite to the cuprate trend**

`ladder_tprime.py` → `results/ladder-tprime.json`. Two holes on the 2×4 ladder do not bind even at t′ = 0
(Δ_pb = +0.037 at U/t = 8), and binding gets weaker as t′/t goes from 0 to −0.4:

| t′/t | 0 | −0.1 | −0.2 | −0.3 | −0.4 |
|---|---|---|---|---|---|
| Δ_pb, U/t = 8 | +0.037 | +0.102 | +0.154 | +0.197 | +0.211 |
| Δ_pb, U/t = 6 | +0.041 | +0.092 | +0.132 | +0.168 | +0.203 |

The declared rule needed −Δ_pb to *rise* with |t′/t|; it falls monotonically at both U. As declared, this
proxy on these clusters cannot rank materials. (The 2×6 points were still computing when this was
written; they are appended to the results file when done, and cannot reverse a monotone 2×4 failure.)
Next proxy to try, declared before running: d-wave pair-field correlations on wider ladders with DMRG.
