#!/usr/bin/env node
// ingredients.mjs — assemble the prior verified designs for a problem into a
// "remix pack" a model can build from. This is how runs COMPOUND: a new run starts
// from the current frontier (every accepted design + its actual circuit) and the
// model molds those ingredients into something better.
//
//   node bin/ingredients.mjs <problem_id>          # markdown remix pack -> stdout
//   node bin/ingredients.mjs <problem_id> --json   # machine-readable ingredients
//
// Reads the local board (scoreboard/entries.json + discovered.json), fetches each
// design's proof bundle (local for seeds, raw URL for external run repos), and lists
// them best-first. No deps; Node 18+ (global fetch).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pid = process.argv[2]
const asJson = process.argv.includes('--json')
if (!pid || pid.startsWith('--')) {
  console.error('usage: ingredients.mjs <problem_id> [--json]')
  process.exit(2)
}

const load = (p) => { try { return JSON.parse(readFileSync(join(ROOT, p), 'utf8')) } catch { return null } }
const seeds = load('scoreboard/entries.json')?.entries || []
const disc = load('scoreboard/discovered.json')?.entries || []
const entries = [...seeds, ...disc].filter((e) => e.problem_id === pid)

const DIR = { state_prep: 'higher', vqe: 'lower', populations: 'higher', architecture: 'lower', classify: 'higher' }
entries.sort((a, b) => ((DIR[a.task] === 'lower' ? 1 : -1) * (a.verified_metric.value - b.verified_metric.value)))

async function bundleOf(e) {
  try { return JSON.parse(readFileSync(join(ROOT, e.proof_bundle), 'utf8')) } catch { /* not local */ }
  const raw = e.run_repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')
    + '/' + (e.run_branch || 'main') + '/' + e.proof_bundle
  try { const r = await fetch(raw); if (r.ok) return await r.json() } catch { /* offline */ }
  return null
}

const items = []
for (const e of entries) {
  const b = await bundleOf(e)
  items.push({ ...e, design: b ? (b.circuit || b.architecture || b.feature_map || null) : null })
}

if (asJson) {
  console.log(JSON.stringify({ problem_id: pid, count: items.length, ingredients: items }, null, 2))
  process.exit(0)
}

const L = []
L.push(`# Ingredients for \`${pid}\` — the current frontier to remix`, '')
L.push(`These are the verified designs already on the board for \`${pid}\`, best first. **Combine and improve`)
L.push(`them.** A new run starts here: feed this pack to your model and have it mold these ingredients into a`)
L.push(`design that beats the current best — a lower energy gap, higher fidelity, or the same metric with fewer`)
L.push(`gates / a sparser map. Then verify: \`python3 bench/quantum-judge/judge_verify.py your-bundle.json\` (exit 0).`, '')
if (!items.length) {
  L.push(`*(No prior runs yet — you would be first. Read the BRIEF, post the opening design, and the board starts here.)*`)
}
items.forEach((e, i) => {
  L.push(`## ${i + 1}. \`${e.paradigm_short || e.paradigm}\`  ·  ${e.model}  ·  metric ${e.verified_metric.value}`)
  L.push(`- task \`${e.task}\` · costs ${JSON.stringify(e.resource_costs)}`)
  if (e.why_it_scores) L.push(`- why it scores: ${e.why_it_scores}`)
  L.push(`- run repo: ${e.run_repo} · bundle \`${e.proof_bundle}\``)
  if (e.design) { L.push('```json', JSON.stringify(e.design, null, 2), '```') }
  L.push('')
})
L.push('---')
L.push(`Beat rank 1, or tie its metric more cheaply (the tie-breaks reward fewer gates / lower depth / a sparser map).`)
L.push(`Then commit your bundle to a public run repo, tag it \`quantum-harness-run\`, drop a \`scoreboard-entry.json\`,`)
L.push(`and it auto-registers on the board. Have a quantum chip (or rent one)? Overlay a real-hardware result — see ACCESS.md.`)
console.log(L.join('\n'))
