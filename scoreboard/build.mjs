#!/usr/bin/env node
// build.mjs — aggregate scoreboard/entries.json into a ranked, render-ready data
// file the viewer loads (viewer/scoreboard-data.js -> window.SCOREBOARD_DATA).
//
// Ranking mirrors SCOREBOARD.md (b): per problem_id, by the primary verified metric
// (direction per task) with resource-efficiency tie-breaks. No network, no deps.
//
//   node scoreboard/build.mjs           # regenerate viewer/scoreboard-data.js
//   node scoreboard/build.mjs --check   # exit 1 if the committed file is stale
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'entries.json'), 'utf8'))

const DIR = { state_prep: 'higher', vqe: 'lower', populations: 'higher', architecture: 'lower', classify: 'higher' }
const TIES = {
  state_prep: ['two_qubit_gates', 'depth'], vqe: ['two_qubit_gates', 'depth'],
  populations: ['two_qubit_gates', 'depth'], architecture: ['edges', 'max_degree'],
  classify: ['feature_map_ops', 'n_qubits'],
}
const num = x => (x === undefined || x === null ? 0 : Number(x))
const fmt = x => (Object.is(x, -0) ? '0' : `${x}`)

function metric(e) {
  const m = e.verified_metric, v = m.value
  switch (e.task) {
    case 'state_prep': return { name: 'fidelity', value: v.toFixed(3), sub: `≥ ${m.threshold} · base ${m.classical_baseline}` }
    case 'vqe': return { name: 'gap', value: v.toFixed(3), sub: `to E₀=${fmt(m.ground_state_energy)} · base ${fmt(m.classical_baseline)}` }
    case 'populations': return { name: `⟨${m.observable || 'X₀X₁'}⟩`, value: `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, sub: `held-out · pops dev ${m.populations_max_deviation ?? 0}` }
    case 'architecture': return { name: 'routing', value: `${v}`, sub: `budget ${m.budget} · base ${m.classical_baseline} · held-out ${m.held_out_routing_cost}` }
    case 'classify': return { name: 'test', value: `${(v * 100).toFixed(0)}%`, sub: `held-out · train ${(m.train_accuracy * 100).toFixed(0)}%` }
    default: return { name: m.name || 'metric', value: `${v}`, sub: '' }
  }
}
function cost(e) {
  const r = e.resource_costs
  if (e.task === 'architecture') return `edges ${r.edges} · deg ${r.max_degree}`
  if (e.task === 'classify') return `ops ${r.feature_map_ops} · ${r.n_qubits} qubit`
  return `2q ${r.two_qubit_gates} · depth ${r.depth}`
}
// ---- holistic 5-axis quality profile (transparent + documented) ------------
// A run's leaderboard RANK is its single verified primary metric. Its GRADE is a
// holistic profile, so a leaner / hardware-validated design can out-grade a run
// with a slightly better raw metric. Each axis is in [0,1]; formulas are mirrored
// (in prose) in viewer/knowledge.js so the page can explain them.
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)
const QW = { correctness: 0.28, margin: 0.30, efficiency: 0.16, robustness: 0.16, novelty: 0.10 }
const CLASSIFY_COST_BUDGET = 8                            // feature-map ops + qubits past which efficiency hits 0
function qualityAxes(e) {
  const m = e.verified_metric, r = e.resource_costs || {}, t = e.task
  const correctness = 1                                   // on the board = passed all 4 gates
  let margin = 0.5                                        // how far the result clears the bar toward the ideal
  if (t === 'state_prep') { const d = 1 - m.threshold; margin = d > 1e-9 ? clamp01((m.value - m.threshold) / d) : 1 }
  else if (t === 'vqe') margin = clamp01(1 - m.value / (m.gap_budget || 0.05))
  else if (t === 'populations') margin = clamp01(1 - Math.abs(m.value - (m.expected ?? 1)) / 2 - num(m.populations_max_deviation))   // expected defaults to the canonical target, never the submitted value
  else if (t === 'architecture') margin = clamp01((m.classical_baseline - m.value) / Math.max(1, m.classical_baseline - num(m.budget)))   // fraction of the baseline→budget gap closed
  else if (t === 'classify') { const lo = (m.min ?? 0.5), d = 1 - lo; margin = d > 1e-9 ? clamp01((m.value - lo) / d) : 1 }
  let efficiency = 0.5                                    // leaner circuit / topology = higher
  if (t === 'architecture') efficiency = clamp01(1 - (num(r.edges) - (num(r.n_qubits) - 1)) / Math.max(1, num(r.n_qubits)))   // excess edges over a spanning tree
  else if (t === 'classify') efficiency = clamp01(1 - (num(r.feature_map_ops) + num(r.n_qubits)) / CLASSIFY_COST_BUDGET)
  else { const n = num(r.n_qubits) || 2; efficiency = clamp01(1 - (num(r.two_qubit_gates) + 0.5 * num(r.depth)) / (2.5 * n + 3)) }
  const teeth = (t === 'populations' || t === 'architecture' || t === 'classify') ? 0.40 : 0   // a real held-out gate
  const hw = (e.hardware_reports && e.hardware_reports[0]) ? 0.35 : 0                            // verified hardware overlay
  const robustness = clamp01(0.25 + teeth + hw)
  // novelty is a pure function of the row: a reference baseline is the floor, a model-authored run adds new knowledge
  const isRef = String(e.model || '').toLowerCase().includes('reference')
  const novelty = isRef ? 0.5 : 0.75
  return { correctness, margin, efficiency, robustness, novelty }
}
function gradeOf(s) {
  const bands = [[0.90, 'A+'], [0.85, 'A'], [0.80, 'A-'], [0.75, 'B+'], [0.70, 'B'], [0.65, 'B-'], [0.60, 'C+'], [0.54, 'C'], [0.48, 'C-'], [0.40, 'D'], [0, 'F']]
  for (const [th, g] of bands) if (s >= th) return g
  return 'F'
}
function quality(e) {
  const a = qualityAxes(e)
  const score = QW.correctness * a.correctness + QW.margin * a.margin + QW.efficiency * a.efficiency + QW.robustness * a.robustness + QW.novelty * a.novelty
  const rnd = x => Math.round(x * 100) / 100
  return { correctness: rnd(a.correctness), margin: rnd(a.margin), efficiency: rnd(a.efficiency), robustness: rnd(a.robustness), novelty: rnd(a.novelty), score: rnd(score), grade: gradeOf(score) }
}

function rankGroup(list) {
  const t = list[0].task, dir = DIR[t] || 'higher', ties = TIES[t] || []
  return [...list].sort((a, b) => {
    const d = dir === 'higher' ? b.verified_metric.value - a.verified_metric.value
                               : a.verified_metric.value - b.verified_metric.value
    if (Math.abs(d) > 1e-12) return d
    for (const k of ties) { const dd = num(a.resource_costs[k]) - num(b.resource_costs[k]); if (dd) return dd }
    return 0
  })
}

// seeds (entries.json) + auto-discovered run-repo entries (discovered.json), deduped
let discovered = []
try { discovered = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'discovered.json'), 'utf8')).entries || [] } catch { /* none yet */ }
const seen = new Set()
const allEntries = [...data.entries, ...discovered].filter((e) => {
  const k = `${e.run_repo}|${e.proof_bundle}|${e.problem_id}`
  if (seen.has(k)) return false
  seen.add(k); return true
})

const byProblem = {}
for (const e of allEntries) (byProblem[e.problem_id] ||= []).push(e)
const problems = Object.keys(byProblem)
const rows = []
for (const pid of problems) {
  rankGroup(byProblem[pid]).forEach((e, i) => {
    const m = metric(e)
    rows.push({
      problem_id: e.problem_id, task: e.task, rank: i + 1,
      paradigm_short: e.paradigm_short || e.paradigm.split(/ \(| — /)[0],
      metricName: m.name, metricValue: m.value, metricSub: m.sub,
      costLabel: cost(e), model: e.model,
      quality: quality(e),
      bundleUrl: `${e.run_repo}/blob/main/${e.proof_bundle}`,
      why: e.why_it_scores,
      hardware: (e.hardware_reports && e.hardware_reports[0])
        ? { backend: e.hardware_reports[0].backend, metric: e.hardware_reports[0].metric, value: e.hardware_reports[0].value, url: e.hardware_reports[0].report_url }
        : null,
    })
  })
}

const generated = new Date().toISOString().slice(0, 10)
const out = `// GENERATED by scoreboard/build.mjs — do not edit. Run \`node scoreboard/build.mjs\`.\n`
  + `window.SCOREBOARD_DATA = ${JSON.stringify({ generated, count: rows.length, problems, rows }, null, 2)};\n`

const target = join(ROOT, 'viewer', 'scoreboard-data.js')
if (process.argv.includes('--check')) {
  let cur = ''
  try { cur = readFileSync(target, 'utf8') } catch {}
  // ignore the generated-date line when comparing freshness
  const strip = s => s.replace(/"generated":\s*"[^"]*",?\n?/, '')
  if (strip(cur) !== strip(out)) { console.error('STALE: viewer/scoreboard-data.js — run `node scoreboard/build.mjs` and commit.'); process.exit(1) }
  console.log('fresh: viewer/scoreboard-data.js matches entries.json'); process.exit(0)
}
writeFileSync(target, out)
console.log(`wrote viewer/scoreboard-data.js — ${rows.length} entries across ${problems.length} problems`)
