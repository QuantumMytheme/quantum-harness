#!/usr/bin/env node
// discover.mjs — find run repos that self-registered and collect their entries.
//
// A run repo opts in by (1) the GitHub topic `quantum-harness-run` and (2) a
// `scoreboard-entry.json` at its root. Discovery is GitHub-WIDE: a run repo under a
// personal account registers exactly like one in the org. Two sources, deduped:
//   1. global topic search (`gh search repos --topic quantum-harness-run`) — the open
//      path; subject to GitHub's search-index lag,
//   2. the org's own repo list (live `repositoryTopics`, no index lag) — the fast
//      path, and the fallback when search is rate-limited or unavailable.
// Every fetched entry is shape-validated before it is ingested (invalid entries are
// skipped and logged — one malformed community file must never halt the pipeline).
// NOTHING here is trusted — the merge gate (scoreboard/verify.py) re-judges every
// discovered entry against the canonical hidden references, binds the entry to its
// bundle's own problem_id/task, and checks the metric + resource costs match. Uses
// the gh CLI (authed locally, and in CI via GITHUB_TOKEN).
//
//   node scoreboard/discover.mjs            # refresh scoreboard/discovered.json
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORG = process.env.QH_ORG || 'QuantumMytheme'
const TOPIC = 'quantum-harness-run'
const KNOWN_TASKS = new Set(['state_prep', 'vqe', 'populations', 'architecture', 'classify', 'kernel'])
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// Shape gate for community-authored scoreboard-entry.json. Mirrored by
// entry_shape_error() in scoreboard/verify.py (defense in depth: verify.py
// per-entry-FAILs whatever slips past this). Returns a defect string or null.
function entryShapeError (e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'entry is not an object'
  if (typeof e.problem_id !== 'string' || !e.problem_id) return 'missing/invalid problem_id'
  if (!KNOWN_TASKS.has(e.task)) return `unknown task ${JSON.stringify(e.task)}`
  const label = e.paradigm_short ?? e.paradigm
  if (typeof label !== 'string' || !label) return 'missing paradigm/paradigm_short'
  if (!e.verified_metric || typeof e.verified_metric !== 'object' ||
      typeof e.verified_metric.value !== 'number' || !Number.isFinite(e.verified_metric.value)) {
    return 'missing/non-numeric verified_metric.value'
  }
  if (!e.resource_costs || typeof e.resource_costs !== 'object' || Array.isArray(e.resource_costs)) {
    return 'missing resource_costs object'
  }
  if (typeof e.run_repo !== 'string' || !e.run_repo.startsWith('https://github.com/')) {
    return 'run_repo is not a https://github.com/ URL'
  }
  if (typeof e.proof_bundle !== 'string' || !e.proof_bundle ||
      e.proof_bundle.startsWith('/') || e.proof_bundle.includes('..')) {
    return 'missing/invalid proof_bundle path'
  }
  return null
}

const repos = new Set()
const sources = []

// Source 1: GitHub-wide topic search — personal-account run repos register too.
try {
  sh(`gh search repos --topic ${TOPIC} --limit 200 --json fullName --jq '.[].fullName'`)
    .trim().split('\n').filter(Boolean).forEach((r) => repos.add(r))
  sources.push('topic-search')
} catch (e) {
  console.error('discovery: global topic search unavailable —', String(e.message).split('\n')[0])
}

// Source 2: the org's live repo list (no search-index lag; also the fallback when
// the global search errors, e.g. rate limits).
try {
  const jq = `.[] | select([.repositoryTopics[]?.name] | index("${TOPIC}")) | .nameWithOwner`
  sh(`gh repo list ${ORG} --limit 500 --json nameWithOwner,repositoryTopics --jq '${jq}'`)
    .trim().split('\n').filter(Boolean).forEach((r) => repos.add(r))
  sources.push('org-list')
} catch (e) {
  console.error('discovery: gh org listing unavailable —', String(e.message).split('\n')[0])
}

if (sources.length === 0) {
  // Both sources failed (offline / unauthed / rate-limited). Keep the existing
  // discovered.json rather than wiping the board's community entries with an
  // empty file — fail safe, not fail empty.
  console.error('discovery: no source reachable — leaving scoreboard/discovered.json untouched')
  process.exit(0)
}

const entries = []
for (const full of [...repos].sort()) {
  try {
    const meta = JSON.parse(sh(`gh api repos/${full}/contents/scoreboard-entry.json`))
    const entry = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'))
    const err = entryShapeError(entry)
    if (err) {
      console.error(`skip ${full}: invalid scoreboard-entry.json — ${err}`)
      continue
    }
    entry._discovered_from = full
    entries.push(entry)
    console.error(`discovered: ${full} -> ${entry.problem_id} (${entry.paradigm_short || entry.paradigm})`)
  } catch (e) {
    console.error(`skip ${full}: no valid scoreboard-entry.json (${String(e.message).split('\n')[0]})`)
  }
}

writeFileSync(join(ROOT, 'scoreboard', 'discovered.json'),
  JSON.stringify({ topic: TOPIC, org: ORG, sources, count: entries.length, entries }, null, 2) + '\n')
console.log(`discovered ${entries.length} run-repo entr${entries.length === 1 ? 'y' : 'ies'} across ${repos.size} tagged repo(s) [${sources.join(' + ')}]`)
