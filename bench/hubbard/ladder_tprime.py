#!/usr/bin/env python3
"""MATERIALS-PLAN first experiment: two-hole binding on 2-leg ladders vs t'/t (declared rule in MATERIALS-PLAN.md).
  python3 bench/hubbard/ladder_tprime.py     (numpy/scipy; writes results/ladder-tprime.json)"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import hubbard as hb
out = {"rule": "MATERIALS-PLAN.md first experiment", "rows": []}
plan = [(4, U, tp) for U in (8.0, 6.0) for tp in (0.0, -0.1, -0.2, -0.3, -0.4)] + [(6, 8.0, -0.1), (6, 8.0, -0.3)]
for L, U, tp in plan:
    t0 = time.time()
    pb = hb.pair_binding(hb.ladder(L, tp=tp), U)
    row = {"ladder": f"2x{L}", "U": U, "tp": tp, "delta_pb": pb, "binding": -pb, "seconds": round(time.time() - t0, 1)}
    out["rows"].append(row); print(json.dumps(row), flush=True)
    json.dump(out, open(os.path.join(HERE, "results", "ladder-tprime.json"), "w"), indent=1)
