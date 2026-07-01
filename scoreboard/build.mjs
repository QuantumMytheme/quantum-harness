#!/usr/bin/env node
// build.mjs — aggregate scoreboard/entries.json into a ranked, render-ready data
// file the viewer loads (viewer/scoreboard-data.js -> window.SCOREBOARD_DATA).
//
// Ranking mirrors SCOREBOARD.md (b): per problem_id, by the primary verified metric
// (direction per task) with resource-efficiency tie-breaks. No network, no deps.
//
// Besides the ranked `rows`, the payload carries two derived structures:
//   coverage — one record per KNOWN problem (every reference in
//              bench/quantum-judge/references/ + bench/kernel-judge/references/,
//              runs or not): which paradigm families have been tried, whether any
//              model-authored run / classical-baseline row / hardware overlay
//              exists, and the concrete open gaps with a copyable mint command.
//              A gap is "untried" — never "impossible", never "easy".
//   frontier — per problem, every verified run as a point in (metric, primary
//              resource cost) space with Pareto dominance flags, plus an honest
//              machine-derived open-gap sentence. Dominated runs stay in the data:
//              the board is a record, not a highlight reel.
//
// Honesty rule for hardware overlays: an emulated/synthetic backend (explicit
// emulated:true, or a backend named emulated/synthetic/simulat*/local-*) is NEVER
// presented as hardware. It earns a smaller, separately-labeled 'noisy-sim'
// robustness credit and the row's hardware block says so.
//
//   node scoreboard/build.mjs           # regenerate viewer/scoreboard-data.js
//   node scoreboard/build.mjs --check   # exit 1 if the committed file is stale
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DIR = { state_prep: 'higher', vqe: 'lower', populations: 'higher', architecture: 'lower', classify: 'higher' }
export const TIES = {
  state_prep: ['two_qubit_gates', 'depth'], vqe: ['two_qubit_gates', 'depth'],
  populations: ['two_qubit_gates', 'depth'], architecture: ['edges', 'max_degree'],
  classify: ['feature_map_ops', 'n_qubits'],
}
const COST_LABEL = { two_qubit_gates: '2q gates', depth: 'depth', edges: 'edges', max_degree: 'max degree', feature_map_ops: 'feature-map ops', n_qubits: 'qubits' }
const num = x => (x === undefined || x === null ? 0 : Number(x))
const fmt = x => (Object.is(x, -0) ? '0' : `${x}`)

// ---- defensive shape validation over discovered/registered entries ---------
// discover.mjs ingests community scoreboard-entry.json files with only a JSON
// parse between them and this pipeline. One malformed entry (e.g. {"problem_id":"x"})
// must be skipped + logged — never allowed to crash the whole board refresh.
export function validEntry(e) {
  const errs = []
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, errs: ['not an object'] }
  if (typeof e.problem_id !== 'string' || !e.problem_id) errs.push('problem_id')
  if (typeof e.task !== 'string' || !e.task) errs.push('task')
  if (typeof (e.paradigm_short ?? e.paradigm) !== 'string' || !(e.paradigm_short || e.paradigm)) errs.push('paradigm')
  if (!e.verified_metric || typeof e.verified_metric !== 'object' || !Number.isFinite(Number(e.verified_metric.value))) errs.push('verified_metric.value')
  if (!e.resource_costs || typeof e.resource_costs !== 'object') errs.push('resource_costs')
  if (typeof e.run_repo !== 'string' || !/^https:\/\/github\.com\//.test(e.run_repo)) errs.push('run_repo')
  if (typeof e.proof_bundle !== 'string' || !e.proof_bundle) errs.push('proof_bundle')
  return { ok: errs.length === 0, errs }
}
export function filterValid(list, label = 'entry') {
  const kept = []
  for (const e of list || []) {
    const v = validEntry(e)
    if (v.ok) kept.push(e)
    else console.error(`skipped malformed ${label} (${v.errs.join(', ')}): ${JSON.stringify(e).slice(0, 120)}`)
  }
  return kept
}

// ---- emulated / synthetic hardware-report detection -------------------------
// A hardware overlay from an emulated or synthetic backend is honest data, but it
// is not a device run. It must never earn the hardware badge or hardware credit.
export function isEmulatedReport(hr) {
  if (!hr || typeof hr !== 'object') return false
  if (hr.emulated === true) return true
  const b = String(hr.backend || '').toLowerCase()
  return /emulat|synthetic|simulat/.test(b) || b.startsWith('local-')
}

export function metric(e) {
  const m = e.verified_metric, v = Number(m.value)
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
const paradigmShort = e => e.paradigm_short || String(e.paradigm || '').split(/ \(| — /)[0]
// ---- holistic 5-axis quality profile (transparent + documented) ------------
// A run's leaderboard RANK is its single verified primary metric. Its GRADE is a
// holistic profile, so a leaner / hardware-validated design can out-grade a run
// with a slightly better raw metric. Each axis is in [0,1]; formulas are mirrored
// (in prose) in viewer/knowledge.js so the page can explain them.
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)
const QW = { correctness: 0.28, margin: 0.30, efficiency: 0.16, robustness: 0.16, novelty: 0.10 }
const CLASSIFY_COST_BUDGET = 8                            // feature-map ops + qubits past which efficiency hits 0
export function qualityAxes(e) {
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
  // hardware overlay credit: 0.35 only for a REAL device run. An emulated/synthetic
  // backend earns a smaller 'noisy-sim' credit (0.15) — emulation is never hardware.
  const hr = (e.hardware_reports && e.hardware_reports[0]) || null
  const hw = hr ? (isEmulatedReport(hr) ? 0.15 : 0.35) : 0
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
export function quality(e) {
  const a = qualityAxes(e)
  const score = QW.correctness * a.correctness + QW.margin * a.margin + QW.efficiency * a.efficiency + QW.robustness * a.robustness + QW.novelty * a.novelty
  const rnd = x => Math.round(x * 100) / 100
  return { correctness: rnd(a.correctness), margin: rnd(a.margin), efficiency: rnd(a.efficiency), robustness: rnd(a.robustness), novelty: rnd(a.novelty), score: rnd(score), grade: gradeOf(score) }
}

export function rankGroup(list) {
  const t = list[0].task, dir = DIR[t] || 'higher', ties = TIES[t] || []
  return [...list].sort((a, b) => {
    const d = dir === 'higher' ? b.verified_metric.value - a.verified_metric.value
                               : a.verified_metric.value - b.verified_metric.value
    if (Math.abs(d) > 1e-12) return d
    for (const k of ties) { const dd = num(a.resource_costs[k]) - num(b.resource_costs[k]); if (dd) return dd }
    return 0
  })
}

// ---- problem catalog: EVERY known problem, with or without runs -------------
// The wanted board must enumerate the full problem set, not just problems that
// already have entries — the empty cells are the point.
export function problemCatalog(root = ROOT) {
  const out = []
  const readRefs = (dir) => {
    try { return readdirSync(join(root, dir)).filter(f => f.endsWith('.json')).sort() } catch { return [] }
  }
  for (const f of readRefs('bench/quantum-judge/references')) {
    try {
      const ref = JSON.parse(readFileSync(join(root, 'bench/quantum-judge/references', f), 'utf8'))
      // some references carry problem_id inline; others are keyed by filename
      const pid = (ref && typeof ref.problem_id === 'string' && ref.problem_id) || basename(f, '.json')
      out.push({ problem_id: pid, task: (ref && ref.task) || 'unknown', source: 'quantum-judge' })
    } catch (err) { console.error(`skipped unreadable reference ${f}: ${err.message}`) }
  }
  for (const f of readRefs('bench/kernel-judge/references')) {
    try {
      const ref = JSON.parse(readFileSync(join(root, 'bench/kernel-judge/references', f), 'utf8'))
      out.push({ problem_id: basename(f, '.json'), task: (ref && ref.task) || 'kernel', source: 'kernel-judge' })
    } catch (err) { console.error(`skipped unreadable reference ${f}: ${err.message}`) }
  }
  return out
}

// ---- coverage: paradigms tried + honest open gaps per problem ---------------
// Gap labels state what is UNTRIED — never that a gap is impossible or easy.
// Mint commands assume bin/new-run.sh defaults to the caller's own GitHub login,
// so a stranger can paste them as-is (no --org).
const isClassicalRow = e => /classical-baseline/i.test(`${e.paradigm_short || ''} ${e.paradigm || ''} ${e.model || ''}`)
const isModelRun = e => !String(e.model || '').toLowerCase().includes('reference')
export function buildCoverage(catalog, byProblem) {
  return catalog.map(p => {
    const list = byProblem[p.problem_id] || []
    const mint = (suffix) => `bin/new-run.sh run-${p.problem_id}${suffix ? '-' + suffix : ''} --remix ${p.problem_id}`
    const has_model_run = list.some(isModelRun)
    const has_classical_baseline = list.some(isClassicalRow)
    const reports = list.flatMap(e => e.hardware_reports || [])
    const has_hardware_overlay = reports.some(h => !isEmulatedReport(h))     // real device only
    const has_noisy_sim_overlay = reports.some(h => isEmulatedReport(h))     // emulated ≠ hardware
    const gaps = []
    if (!list.length) {
      gaps.push({ kind: 'first-run', label: 'untried — no verified design on this board at all; the first ACCEPT opens it', command: mint('') })
    } else {
      if (!has_model_run) gaps.push({ kind: 'model-run', label: 'no model-authored run yet — only the hand-authored reference baseline (untried, not settled)', command: mint('') })
      if (p.source === 'quantum-judge' && !has_classical_baseline) gaps.push({ kind: 'classical-baseline', label: 'no classical-baseline row — the board invites one so the quantum-vs-classical gap is visible (untried)', command: mint('classical') })
      if (p.source === 'quantum-judge' && !has_hardware_overlay) gaps.push({ kind: 'hardware', label: has_noisy_sim_overlay ? 'no REAL-device hardware overlay — only an emulated (noisy-sim) one; a device run is untried' : 'no hardware overlay — no ACCEPTed design here has been run on a device (untried; see HARDWARE.md)', command: mint('hw') })
    }
    return {
      problem_id: p.problem_id, task: p.task, source: p.source,
      paradigms_tried: [...new Set(list.map(paradigmShort))],
      runs: list.length, has_model_run, has_classical_baseline, has_hardware_overlay, has_noisy_sim_overlay,
      gaps,
    }
  })
}

// ---- Pareto frontier: verified metric vs primary resource cost --------------
// A point is dominated iff another point is at least as good on BOTH axes and
// strictly better on at least one. Dominated points stay in the data.
export function paretoFrontier(list, task) {
  const dir = DIR[task] || 'higher'
  const costKey = (TIES[task] || ['two_qubit_gates'])[0]
  const pts = list.map(e => ({
    paradigm: paradigmShort(e), model: e.model || '', run_repo: e.run_repo,
    metric: Number(e.verified_metric.value), cost: num((e.resource_costs || {})[costKey]),
    reference: !isModelRun(e),
  }))
  const asGood = (a, b) => dir === 'higher' ? a >= b : a <= b       // metric at least as good
  const strictly = (a, b) => dir === 'higher' ? a > b : a < b       // metric strictly better
  for (const p of pts) {
    p.dominated = pts.some(q => q !== p
      && asGood(q.metric, p.metric) && q.cost <= p.cost
      && (strictly(q.metric, p.metric) || q.cost < p.cost))
  }
  return { dir, costKey, costLabel: COST_LABEL[costKey] || costKey, points: pts }
}
const sig = v => Number(Number(v).toPrecision(3))
export function frontierGap(f, metricName) {
  const front = f.points.filter(p => !p.dominated).sort((a, b) => a.cost - b.cost || a.metric - b.metric)
  if (f.points.length < 2) {
    const p = f.points[0]
    return p ? `Only one verified entry so far (${p.paradigm}, ${metricName} ${sig(p.metric)} at ${p.cost} ${f.costLabel}) — the frontier is a single point. A second paradigm at a different cost is untried.` : 'No verified entries yet — the whole frontier is untried.'
  }
  if (front.length === 1) {
    const p = front[0]
    return `${p.paradigm} currently dominates every other entry (${metricName} ${sig(p.metric)} at ${p.cost} ${f.costLabel}). Matching it at lower ${f.costLabel} is untried.`
  }
  const cheap = front[0], best = front[front.length - 1]
  return `Open gap: no verified entry below ${cheap.cost} ${f.costLabel}, and ${metricName} ${sig(best.metric)} is only reached at ${best.cost} ${f.costLabel} — a design beating either corner is untried. Untried means nobody has posted one; it says nothing about difficulty.`
}

// ---- structured lineage (optional remix_of field) ----------------------------
// Entries MAY declare `remix_of: ["Org/run-repo", ...]` (bin/ingredients.mjs prints
// the exact field to copy). When present, the board surfaces the descent chain and
// credits the ingredient with a descendant count. Prose-only lineage stays prose.
export function lineage(entries) {
  const key = u => String(u || '').replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '').toLowerCase()
  const declared = e => (Array.isArray(e.remix_of) ? e.remix_of : []).filter(x => typeof x === 'string' && x).map(key)
  const counts = {}
  for (const e of entries) for (const r of new Set(declared(e))) counts[r] = (counts[r] || 0) + 1
  return e => ({ remix_of: declared(e), remixed_by: counts[key(e.run_repo)] || 0 })
}

// ---- paradigm league: corpus-level (paradigm family × task) rollup -----------
// Answers SCOREBOARD.md §(c)'s comparative question at corpus level: across ALL
// verified runs, which design idea wins where? Grouping key is the stable `family`
// tag when an entry declares one, else paradigm_short. HONESTY RULES: (1) an
// aggregate with n < 3 is an anecdote, not evidence — `evidence:false` and the
// viewer greys it with an explicit badge; (2) groups are (paradigm × task) pairs,
// so no cross-task ranking can ever be read off the table (different tasks are
// different games); (3) untested_problems lists same-task problems the paradigm
// has NOT entered — untried, never "impossible", never "easy".
export function buildParadigms(byProblem, catalog) {
  const groups = {}
  for (const pid of Object.keys(byProblem)) {
    rankGroup(byProblem[pid]).forEach((e, i) => {
      const para = e.family || paradigmShort(e)
      const key = `${para} ${e.task}`
      const g = (groups[key] ||= { paradigm: para, task: e.task, n: 0, boards: new Set(), rank1_count: 0, marginSum: 0, effSum: 0 })
      const ax = qualityAxes(e)
      g.n++; g.boards.add(pid)
      if (i === 0) g.rank1_count++
      g.marginSum += ax.margin; g.effSum += ax.efficiency
    })
  }
  const taskPids = {}
  for (const p of catalog) (taskPids[p.task] ||= []).push(p.problem_id)
  const rnd = x => Math.round(x * 1000) / 1000
  return Object.values(groups).map(g => ({
    paradigm: g.paradigm, task: g.task, n: g.n,
    boards: [...g.boards].sort(),
    rank1_count: g.rank1_count,
    mean_margin: rnd(g.marginSum / g.n),
    mean_efficiency: rnd(g.effSum / g.n),
    untested_problems: (taskPids[g.task] || []).filter(pid => !g.boards.has(pid)).sort(),
    evidence: g.n >= 3,        // n < 3 is an anecdote, not a finding — never render it as one
  })).sort((a, b) => a.task.localeCompare(b.task) || b.n - a.n || a.paradigm.localeCompare(b.paradigm))
}

// ---- assemble the full payload ----------------------------------------------
export function buildData(root = ROOT) {
  const data = JSON.parse(readFileSync(join(root, 'scoreboard', 'entries.json'), 'utf8'))
  // seeds (entries.json) + auto-discovered run-repo entries (discovered.json), deduped
  let discovered = []
  try { discovered = JSON.parse(readFileSync(join(root, 'scoreboard', 'discovered.json'), 'utf8')).entries || [] } catch { /* none yet */ }
  const seen = new Set()
  const allEntries = [...filterValid(data.entries, 'seed entry'), ...filterValid(discovered, 'discovered entry')].filter((e) => {
    const k = `${e.run_repo}|${e.proof_bundle}|${e.problem_id}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  const byProblem = {}
  for (const e of allEntries) (byProblem[e.problem_id] ||= []).push(e)
  const problems = Object.keys(byProblem)
  const lin = lineage(allEntries)
  const rows = []
  for (const pid of problems) {
    rankGroup(byProblem[pid]).forEach((e, i) => {
      const m = metric(e)
      const hr = (e.hardware_reports && e.hardware_reports[0]) || null
      rows.push({
        ...lin(e),
        problem_id: e.problem_id, task: e.task, rank: i + 1,
        paradigm_short: paradigmShort(e),
        metricName: m.name, metricValue: m.value, metricSub: m.sub,
        costLabel: cost(e), model: e.model,
        quality: quality(e),
        bundleUrl: `${e.run_repo}/blob/main/${e.proof_bundle}`,
        why: e.why_it_scores,
        hardware: hr
          ? { backend: hr.backend, metric: hr.metric, value: hr.value, url: hr.report_url, emulated: isEmulatedReport(hr), label: isEmulatedReport(hr) ? 'noisy-sim' : 'hw' }
          : null,
      })
    })
  }

  const catalog = problemCatalog(root)
  const coverage = buildCoverage(catalog, byProblem)
  const frontier = {}
  for (const pid of problems) {
    const f = paretoFrontier(byProblem[pid], byProblem[pid][0].task)
    const mName = metric(byProblem[pid][0]).name
    frontier[pid] = { task: byProblem[pid][0].task, metricName: mName, ...f, gap: frontierGap(f, mName) }
  }

  const paradigms = buildParadigms(byProblem, catalog)

  const generated = new Date().toISOString().slice(0, 10)
  return { generated, count: rows.length, problems, rows, coverage, frontier, paradigms }
}

function main() {
  const payload = buildData(ROOT)
  const out = `// GENERATED by scoreboard/build.mjs — do not edit. Run \`node scoreboard/build.mjs\`.\n`
    + `window.SCOREBOARD_DATA = ${JSON.stringify(payload, null, 2)};\n`

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
  console.log(`wrote viewer/scoreboard-data.js — ${payload.count} entries across ${payload.problems.length} problems, ${payload.coverage.length} known problems in coverage`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
