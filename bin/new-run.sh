#!/usr/bin/env bash
# new-run.sh — mint a fresh PUBLIC run repo from this template and clone it locally.
# Each design run gets its own public repo. With --remix it pre-loads the current
# frontier for a problem (INGREDIENTS.md) and tags the repo for auto-discovery.
#
# Requires the gh CLI, authenticated (gh auth status).
# usage: bin/new-run.sh <run-name> [--org ORG] [--remix <problem_id>]
set -euo pipefail

NAME=""; ORG="QuantumMytheme"; REMIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --org)   ORG="$2"; shift 2 ;;
    --remix) REMIX="$2"; shift 2 ;;
    -*)      echo "unknown flag: $1" >&2; exit 2 ;;
    *)       NAME="$1"; shift ;;
  esac
done
[ -n "$NAME" ] || { echo "usage: new-run.sh <run-name> [--org ORG] [--remix <problem_id>]" >&2; exit 2; }
TEMPLATE="${ORG}/quantum-harness"

echo "Minting ${ORG}/${NAME} from template ${TEMPLATE} (public)…"
gh repo create "${ORG}/${NAME}" --template "${TEMPLATE}" --public --clone
cd "${NAME}"

if [ -n "${REMIX}" ]; then
  echo "Assembling remix ingredients for '${REMIX}' (the current frontier)…"
  node bin/ingredients.mjs "${REMIX}" > INGREDIENTS.md || echo "(ingredients unavailable — start fresh)"
  gh repo edit "${ORG}/${NAME}" --add-topic quantum-harness-run >/dev/null 2>&1 || true
  echo "Wrote INGREDIENTS.md and tagged the repo for auto-discovery."
fi

cat <<EOF

Done — https://github.com/${ORG}/${NAME} is live.
  cd ${NAME}
$( [ -n "${REMIX}" ] && echo "  # INGREDIENTS.md = the current best designs for ${REMIX}. Feed it + KICKOFF.md to your model to remix and beat them." )
  # 1. choose/write a BRIEF; run KICKOFF.md with your model until: judge_verify.py your-bundle.json -> exit 0
  # 2. commit your proof bundle, a scoreboard-entry.json, and (optional) a hardware report; push
  # 3. tag the repo 'quantum-harness-run' (auto if --remix) — it self-registers on the board
  # Have a quantum chip (or rent one)? See ACCESS.md to overlay a real-hardware result.
EOF
