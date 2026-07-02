#!/usr/bin/env bash
# test-all.sh — run EVERY suite in the harness (both judges + the router + the node
# site/mcp suite + the headless canvas smoke test + the MCP connector selftest) and
# fail if any do. One green run = the whole site + harness is safe to push (main
# auto-deploys to quantummytheme.com). Numpy-only + Node; no network.
#
#   bash bin/test-all.sh      (or: npm run test:all)
set -u
cd "$(dirname "$0")/.." || exit 2

fail=0
run() {
  local name="$1"; shift
  local out rc last
  out="$("$@" 2>&1)"; rc=$?
  last="$(printf '%s\n' "$out" | grep -iE 'passed|pass |green|SELFTEST|OK ' | tail -1)"
  [ -z "$last" ] && last="$(printf '%s\n' "$out" | tail -1)"
  if [ "$rc" -eq 0 ]; then
    printf '  \033[32m✓\033[0m  %-44s %s\n' "$name" "$last"
  else
    printf '  \033[31m✗\033[0m  %-44s (exit %d)\n' "$name" "$rc"
    printf '%s\n' "$out" | tail -10 | sed 's/^/       /'
    fail=1
  fi
}

echo "quantum-harness · full suite"
echo
run "quantum-judge (numpy)"                 python3 bench/quantum-judge/test_judge.py
run "qasm_import.py (OpenQASM3 authoring adapter)" python3 bench/quantum-judge/test_qasm_import.py
run "kernel-judge · Oracle-Diff + Roofline" python3 bench/kernel-judge/test_kernel.py
run "judge router (both judges, one door)"  python3 bench/test_router.py
run "kernel-judge soundness fuzz"           python3 bench/kernel-judge/fuzz_kernel.py
run "quantum-judge soundness fuzz"          python3 bench/quantum-judge/fuzz_judge.py
run "node suite · site/mcp/planner/scorecard" npm test --silent
run "education/site smoke (headless canvas)" node viewer/test-education.mjs
run "mcp connector selftest"                node mcp/selftest.mjs
echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mALL SUITES GREEN\033[0m — safe to push (main auto-deploys)\n'
else
  printf '\033[31mSOME SUITES FAILED\033[0m — do not push\n'
fi
exit "$fail"
