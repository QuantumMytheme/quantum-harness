#!/usr/bin/env node
// discover.mjs — find run repos that self-registered and collect their entries.
//
// A run repo opts in by (1) the GitHub topic `quantum-harness-run` and (2) a
// `scoreboard-entry.json` at its root. This crawler lists the org's tagged repos
// (live `repositoryTopics`, no search-index lag), fetches each entry, and writes
// scoreboard/discovered.json. NOTHING here is trusted — the merge gate
// (scoreboard/verify.py) re-judges every discovered entry against the canonical
// hidden references and checks the metric matches. Uses the gh CLI (authed locally,
// and in CI via GITHUB_TOKEN).
//
//   node scoreboard/discover.mjs            # refresh scoreboard/discovered.json
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORG = process.env.QH_ORG || 'QuantumMytheme'
const TOPIC = 'quantum-harness-run'
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let repos = []
try {
  const jq = `.[] | select([.repositoryTopics[]?.name] | index("${TOPIC}")) | .nameWithOwner`
  repos = sh(`gh repo list ${ORG} --limit 500 --json nameWithOwner,repositoryTopics --jq '${jq}'`)
    .trim().split('\n').filter(Boolean)
} catch (e) {
  console.error('discovery: gh unavailable —', String(e.message).split('\n')[0])
}

const entries = []
for (const full of repos) {
  try {
    const meta = JSON.parse(sh(`gh api repos/${full}/contents/scoreboard-entry.json`))
    const entry = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'))
    entry._discovered_from = full
    entries.push(entry)
    console.error(`discovered: ${full} -> ${entry.problem_id} (${entry.paradigm_short || entry.paradigm})`)
  } catch (e) {
    console.error(`skip ${full}: no valid scoreboard-entry.json (${String(e.message).split('\n')[0]})`)
  }
}

writeFileSync(join(ROOT, 'scoreboard', 'discovered.json'),
  JSON.stringify({ topic: TOPIC, org: ORG, count: entries.length, entries }, null, 2) + '\n')
console.log(`discovered ${entries.length} run-repo entr${entries.length === 1 ? 'y' : 'ies'} across ${repos.length} tagged repo(s)`)
