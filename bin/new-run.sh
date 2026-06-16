#!/usr/bin/env bash
# new-run.sh — mint a fresh PUBLIC run repository in the QuantumMytheme org from
# this template and clone it locally. Each design run gets its own public repo.
#
# Requires the gh CLI, authenticated (gh auth status).
# usage: bin/new-run.sh <run-name> [org]
set -euo pipefail
NAME="${1:?usage: new-run.sh <run-name> [org]}"
ORG="${2:-QuantumMytheme}"
TEMPLATE="${ORG}/quantum-harness"

echo "Minting ${ORG}/${NAME} from template ${TEMPLATE} (public)…"
gh repo create "${ORG}/${NAME}" --template "${TEMPLATE}" --public --clone

cat <<EOF

Done. Next:
  cd ${NAME}
  # 1. pick or write a BRIEF (see RUN-FLOW.md / RERUN.md)
  # 2. run KICKOFF.md with your model
  # 3. commit the proof bundle + scrubbed transcript + scorecard back, then push
EOF
