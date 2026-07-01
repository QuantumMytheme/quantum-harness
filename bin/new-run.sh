#!/usr/bin/env bash
# new-run.sh — mint a fresh PUBLIC run repo from this template and clone it locally.
# Each design run gets its own public repo. With --remix it pre-loads the current
# frontier for a problem (INGREDIENTS.md); every minted repo is tagged
# `quantum-harness-run` so the scoreboard crawler auto-discovers it.
#
# The repo is created under YOUR OWN GitHub account by default (no org membership
# needed — discovery works by topic, GitHub-wide). QuantumMytheme org members can
# opt in with `--org QuantumMytheme` to mint directly into the org.
#
# Requires the gh CLI, authenticated (gh auth status).
# usage: bin/new-run.sh <run-name> [--org OWNER] [--remix <problem_id>]
set -euo pipefail

NAME=""; ORG=""; REMIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --org)   ORG="$2"; shift 2 ;;
    --remix) REMIX="$2"; shift 2 ;;
    -*)      echo "unknown flag: $1" >&2; exit 2 ;;
    *)       NAME="$1"; shift ;;
  esac
done
[ -n "$NAME" ] || { echo "usage: new-run.sh <run-name> [--org OWNER] [--remix <problem_id>]" >&2; exit 2; }

# default owner = the authenticated user (works for everyone; members may pass --org QuantumMytheme)
if [ -z "$ORG" ]; then
  ORG="$(gh api user -q .login)" || { echo "could not resolve your GitHub login — is gh authenticated? (gh auth status)" >&2; exit 1; }
fi
TEMPLATE="QuantumMytheme/quantum-harness"

echo "Minting ${ORG}/${NAME} from template ${TEMPLATE} (public)…"
gh repo create "${ORG}/${NAME}" --template "${TEMPLATE}" --public --clone
cd "${NAME}"

# tag every run repo for auto-discovery — the crawler finds it by topic, org or not.
gh repo edit "${ORG}/${NAME}" --add-topic quantum-harness-run >/dev/null 2>&1 || true

if [ -n "${REMIX}" ]; then
  echo "Assembling remix ingredients for '${REMIX}' (the current frontier)…"
  node bin/ingredients.mjs "${REMIX}" > INGREDIENTS.md || echo "(ingredients unavailable — start fresh)"
  echo "Wrote INGREDIENTS.md."
fi

cat <<EOF

Done — https://github.com/${ORG}/${NAME} is live (topic 'quantum-harness-run' applied).
  cd ${NAME}
$( [ -n "${REMIX}" ] && echo "  # INGREDIENTS.md = the current best designs for ${REMIX}. Feed it + KICKOFF.md to your model to remix and beat them." )
  # 1. choose/write a BRIEF; run KICKOFF.md with your model until: judge_verify.py your-bundle.json -> exit 0
  # 2. commit your proof bundle, a scoreboard-entry.json, and (optional) a hardware report; push
  # 3. that's it — the topic is already set, so the crawler picks it up and the judge re-verifies it
  # Have a quantum chip (or rent one)? See ACCESS.md to overlay a real-hardware result.
EOF
