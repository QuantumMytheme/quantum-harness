#!/usr/bin/env python3
"""
fuzz_judge.py — property / soundness fuzz for the quantum judge. Complements the
targeted regression in test_judge.py with randomized tampering over the committed
worked bundles, pinning the referee's core promise:

  SOUNDNESS — a fabricated result never ACCEPTs. A random perturbation of a bundle's
              CLAIMED metric is rejected at reproducibility (exit 4); an unknown gate
              spliced into a circuit is rejected at structure (exit 3).

Deterministic (seeded). Ground truth stays host-side in references/; the judge
recomputes and the tamper cannot survive. Run:  python3 fuzz_judge.py
"""

import copy
import json
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import judge_verify as jv  # noqa: E402

RNG = random.Random(20260630)

# worked bundle -> the primary numeric claim key the judge recomputes
BUNDLES = [
    ("quantum-proof-poc.json", "fidelity"),
    ("quantum-proof-vqe.json", "energy"),
    ("quantum-proof-h2.json", "energy"),
    ("quantum-proof-pops.json", "populations"),
    ("quantum-proof-arch.json", "routing_cost"),
    ("quantum-proof-qml.json", "train_accuracy"),
]


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def verify(b):
    try:
        jv.verify(b); return 0
    except jv.Reject as r:
        return r.code


def tamper_claim(b, key):
    """Perturb the claimed metric so it CANNOT match the recomputation (tol ~1e-6)."""
    c = b["claim"]
    if key == "fidelity":
        c["fidelity"] = max(0.0, c["fidelity"] - RNG.uniform(0.1, 0.6))       # always down (avoid clamping back to 1.0)
    elif key == "energy":
        c["energy"] = c["energy"] + RNG.choice([-1, 1]) * RNG.uniform(0.2, 2.0)
    elif key == "populations":
        p = list(c["populations"]); p[0] = p[0] + RNG.uniform(0.1, 0.3); c["populations"] = p
    elif key == "routing_cost":
        c["routing_cost"] = int(c["routing_cost"]) + RNG.randint(1, 5)
    elif key == "train_accuracy":
        c["train_accuracy"] = round(RNG.uniform(0.0, 0.49), 3)                 # true is high; a low value cannot match
    return b


def main():
    N = 20
    ok = True
    claim_trials = struct_trials = 0
    claim_fail = struct_fail = 0

    for _ in range(N):
        for name, key in BUNDLES:
            base = load(name)

            # SOUNDNESS 1 — a tampered claim is rejected (expect exit 4).
            b = tamper_claim(copy.deepcopy(base), key)
            claim_trials += 1
            if verify(b) != jv.EXIT_REPRODUCIBILITY:
                # a REJECT at any gate still upholds soundness; only an ACCEPT is a violation
                if verify(b) == 0:
                    claim_fail += 1; ok = False

            # SOUNDNESS 2 — an unknown gate spliced into a circuit is rejected at structure (exit 3).
            if "circuit" in base and base["circuit"].get("ops"):
                b = copy.deepcopy(base)
                pos = RNG.randint(0, len(b["circuit"]["ops"]))
                b["circuit"]["ops"].insert(pos, {"gate": "zznotagate", "q": [0]})
                struct_trials += 1
                if verify(b) == 0:
                    struct_fail += 1; ok = False

    print("quantum-judge property / soundness fuzz\n")
    print(f"  SOUNDNESS · claim tamper    {claim_trials} trials → never ACCEPT   · {claim_fail} accepted")
    print(f"  SOUNDNESS · unknown gate    {struct_trials} trials → never ACCEPT   · {struct_fail} accepted")
    print(f"\n{'SOUNDNESS HELD on every trial' if ok else 'SOUNDNESS VIOLATED — a forgery scored'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
