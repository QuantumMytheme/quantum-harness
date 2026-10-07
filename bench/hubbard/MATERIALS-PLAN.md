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
2. Oracle (to be read, quoted and registered before comparing): the reported correlation between the
   band-structure parameter tied to t′/t and Tc_max across cuprate families (Pavarini et al., Phys. Rev.
   Lett. 87, 047003 (2001), as recalled; not yet read).
3. Pass: the sign and ordering of the pairing proxy versus t′/t matches the oracle's trend across ≥ 4
   points, on both ladder widths. Fail: report it, and the proxy is not used for design.

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
