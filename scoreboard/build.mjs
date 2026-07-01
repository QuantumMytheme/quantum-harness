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
import { createHash } from 'node:crypto'
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

// ---- frontier ledger: append-only history + typed events ---------------------
// Every rebuild diffs the freshly-computed board against the committed
// scoreboard/frontier-history.json and appends typed events: NEW_LEADER,
// PARETO_EXPANSION, NEW_PARADIGM, NEW_PROBLEM, GAP_NARROWED. Honesty + stability:
//   - events are APPEND-ONLY (never rewritten); the snapshot is a mutable cache
//     of the last-seen state used only to compute the next diff.
//   - event `date` comes from the triggering entry's verified_at (the submitter's
//     last judge re-run) — NEVER a build-time clock read, so a no-event rebuild is
//     byte-stable under the --check staleness gate. If the operator wants a "when
//     observed" stamp, they pass `--now YYYY-MM-DD` and it is stored as `observed`
//     ONLY on genuinely-appended events; by default the field is omitted.
//   - genesis: when no history file exists, the current board state is backfilled
//     as genesis-flagged events (the true opening order predates the ledger and
//     the events say so).
const entryKey = e => `${e.run_repo}|${e.proof_bundle}`
const sig6 = v => Number(Number(v).toPrecision(6))
export function frontierSnapshot(byProblem) {
  const problems = {}
  const paradigms = new Set()
  for (const pid of Object.keys(byProblem).sort()) {
    const list = byProblem[pid]
    const ranked = rankGroup(list)
    for (const e of list) paradigms.add(paradigmShort(e))
    const f = paretoFrontier(list, ranked[0].task)
    const frontierKeys = f.points
      .map((p, i) => ({ p, e: list[i] }))
      .filter(x => !x.p.dominated)
      .map(x => entryKey(x.e))
      .sort()
    const lead = ranked[0]
    const rec = {
      task: ranked[0].task, entries: ranked.length,
      leader: {
        key: entryKey(lead), paradigm: paradigmShort(lead),
        metric: Number(lead.verified_metric.value),
        verified_at: lead.verified_at || null, run_repo: lead.run_repo, proof_bundle: lead.proof_bundle,
      },
      frontier: frontierKeys,
    }
    if (ranked.length >= 2) rec.runner_up_gap = Math.abs(Number(ranked[0].verified_metric.value) - Number(ranked[1].verified_metric.value))
    problems[pid] = rec
  }
  return { problems, paradigms: [...paradigms].sort() }
}

const earliestDate = list => (list || []).map(e => e.verified_at).filter(Boolean).sort()[0] || null
const withDate = d => (d ? { date: d } : {})   // omit rather than invent
export function genesisEvents(snapshot, byProblem) {
  const events = []
  for (const pid of Object.keys(snapshot.problems)) {
    const c = snapshot.problems[pid]
    events.push({
      type: 'NEW_PROBLEM', problem_id: pid, ...withDate(earliestDate(byProblem[pid])),
      detail: `board opened — leading design: ${c.leader.paradigm} (metric ${sig6(c.leader.metric)}); backfilled at genesis from the current board state`,
      run_repo: c.leader.run_repo, proof_bundle: c.leader.proof_bundle, genesis: true,
    })
    if (c.entries >= 2) events.push({
      type: 'NEW_LEADER', problem_id: pid, ...withDate(c.leader.verified_at),
      detail: `${c.leader.paradigm} holds rank 1 of ${c.entries} verified designs (metric ${sig6(c.leader.metric)}); backfilled at genesis — the dethrone order predates this ledger`,
      run_repo: c.leader.run_repo, proof_bundle: c.leader.proof_bundle, genesis: true,
    })
  }
  const ord = { NEW_PROBLEM: 0, NEW_LEADER: 1 }
  return events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || a.problem_id.localeCompare(b.problem_id) || ord[a.type] - ord[b.type])
}

export function diffFrontier(prev, cur, byProblem) {
  const events = []
  const prevProblems = (prev && prev.problems) || {}
  const prevParadigms = new Set((prev && prev.paradigms) || [])
  // paradigms already named by another event this diff — NEW_PARADIGM only fires
  // for a design idea that entered the corpus WITHOUT otherwise making noise
  const announced = new Set()
  const findEntry = (pid, key) => (byProblem[pid] || []).find(e => entryKey(e) === key) || null
  for (const pid of Object.keys(cur.problems)) {
    const c = cur.problems[pid], p = prevProblems[pid]
    if (!p) {
      for (const e of byProblem[pid] || []) announced.add(paradigmShort(e))
      events.push({
        type: 'NEW_PROBLEM', problem_id: pid, ...withDate(earliestDate(byProblem[pid])),
        detail: `board opened — first verified design: ${c.leader.paradigm} (metric ${sig6(c.leader.metric)})`,
        run_repo: c.leader.run_repo, proof_bundle: c.leader.proof_bundle,
      })
      continue
    }
    let leaderChanged = false
    if (p.leader.key !== c.leader.key) {
      leaderChanged = true
      announced.add(c.leader.paradigm)
      events.push({
        type: 'NEW_LEADER', problem_id: pid, ...withDate(c.leader.verified_at),
        detail: `${c.leader.paradigm} took rank 1 from ${p.leader.paradigm} — metric ${sig6(p.leader.metric)} → ${sig6(c.leader.metric)}`,
        run_repo: c.leader.run_repo, proof_bundle: c.leader.proof_bundle,
      })
    }
    const prevFront = new Set(p.frontier)
    for (const k of c.frontier) {
      if (prevFront.has(k)) continue
      if (leaderChanged && k === c.leader.key) continue   // the NEW_LEADER event already covers it
      const e = findEntry(pid, k)
      if (e) announced.add(paradigmShort(e))
      events.push({
        type: 'PARETO_EXPANSION', problem_id: pid, ...withDate(e && e.verified_at),
        detail: `the Pareto frontier gained a non-dominated point: ${e ? `${paradigmShort(e)} (metric ${sig6(e.verified_metric.value)})` : k}`,
        ...(e ? { run_repo: e.run_repo, proof_bundle: e.proof_bundle } : {}),
      })
    }
    if (!leaderChanged && p.runner_up_gap !== undefined && c.runner_up_gap !== undefined
        && c.runner_up_gap < p.runner_up_gap - 1e-12) {
      const runnerUp = rankGroup(byProblem[pid] || [])[1]
      if (runnerUp) announced.add(paradigmShort(runnerUp))
      events.push({
        type: 'GAP_NARROWED', problem_id: pid,
        detail: `the runner-up closed on the leader: metric gap ${sig6(p.runner_up_gap)} → ${sig6(c.runner_up_gap)} (${c.leader.paradigm} still leads)`,
      })
    }
  }
  // NEW_PARADIGM: a family seen for the first time — but only when no other event
  // this diff already names it (a paradigm arriving as a new leader / Pareto point /
  // closing runner-up / on a brand-new board is already announced there).
  const paraBoards = {}
  for (const pid of Object.keys(byProblem)) for (const e of byProblem[pid]) (paraBoards[paradigmShort(e)] ||= new Set()).add(pid)
  for (const para of cur.paradigms) {
    if (prevParadigms.has(para) || announced.has(para)) continue
    const boards = [...(paraBoards[para] || [])].sort()
    const its = boards.flatMap(b => (byProblem[b] || []).filter(e => paradigmShort(e) === para))
    events.push({
      type: 'NEW_PARADIGM', ...withDate(earliestDate(its)),
      detail: `a new design paradigm entered the corpus: ${para} (boards: ${boards.join(', ') || 'unknown'})`,
      paradigm: para,
    })
  }
  return events
}

// ---- Atom feed (viewer/feed.xml) — generated purely from the history ---------
export function atomFeed(history, site = 'https://quantummytheme.com') {
  const X = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const events = (history.events || []).slice(-50).reverse()   // newest first, last ~50
  const iso = d => `${d}T00:00:00Z`
  const dates = (history.events || []).map(e => e.date || e.observed).filter(Boolean).sort()
  const updated = iso(dates[dates.length - 1] || '1970-01-01')
  const content = e => {
    let s = e.detail
    if (e.run_repo) s += ` · run repo: ${e.run_repo}`
    if (e.proof_bundle) s += ` · re-verify: python3 bench/quantum-judge/judge_verify.py ${e.proof_bundle}` + (e.run_repo && !e.run_repo.endsWith('/quantum-harness') ? ` (bundle from ${e.run_repo})` : '')
    return s
  }
  const items = events.map(e => `  <entry>
    <title>${X(`${e.type}${e.problem_id ? ' · ' + e.problem_id : ''}${e.genesis ? ' (genesis backfill)' : ''}`)}</title>
    <id>${site}/feed.xml#e${e.seq}</id>
    <link href="${site}/#frontier" rel="alternate" type="text/html"/>
    <updated>${iso(e.date || e.observed || '1970-01-01')}</updated>
    <content type="text">${X(content(e))}</content>
  </entry>`)
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>QuantumMytheme — frontier ledger</title>
  <subtitle>Typed events appended by scoreboard/build.mjs whenever the verified frontier moves. Every number is judge-emitted; event dates are each entry's verified_at (the submitter's last judge re-run), never a build-time clock read.</subtitle>
  <id>${site}/feed.xml</id>
  <link href="${site}/feed.xml" rel="self" type="application/atom+xml"/>
  <link href="${site}/#frontier" rel="alternate" type="text/html"/>
  <updated>${updated}</updated>
  <author><name>QuantumMytheme scoreboard build</name></author>
${items.join('\n')}
</feed>
`
}

// ---- bundle hash pins (cite-this-run) ----------------------------------------
// PLATFORM CONTRACT: a bundle's sha256 is always computed over the RAW FILE BYTES
// exactly as committed/fetched (`sha256sum <file>` semantics, lowercase hex) —
// never over re-parsed/re-serialized JSON — so the same bundle hashes identically
// here, in verify.py --attest, and in any in-browser fetch→arrayBuffer→SHA-256.
// HONESTY: an external run-repo bundle is not committed in this repo and the build
// is offline, so its hash CANNOT be computed honestly at build time → null, and the
// viewer says "hash unavailable — re-verify from the run repo" instead of faking one.
export function bundleHashers(root, harness) {
  const cache = {}
  return (e) => {
    if (e.run_repo !== harness) return null
    const p = join(root, e.proof_bundle)
    if (!(p in cache)) {
      try { cache[p] = createHash('sha256').update(readFileSync(p)).digest('hex') } catch { cache[p] = null }
    }
    return cache[p]
  }
}
export function reverifyCommand(e, harness) {
  if (e.run_repo === harness) return `python3 bench/quantum-judge/judge_verify.py ${e.proof_bundle}`
  const raw = `${e.run_repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${e.run_branch || 'main'}/${e.proof_bundle}`
  return `curl -sL ${raw} -o bundle.json && python3 bench/quantum-judge/judge_verify.py bundle.json`
}

// ---- reproduced ×N: third-party re-verification attestations -----------------
// scoreboard/attestations/*.json — one-line records emitted by
// `python3 scoreboard/verify.py --attest <ref> --handle <who>` and committed via PR
// (PR-only: zero new attack surface). Counting rules, honestly:
//   - an attestation binds to a bundle by sha256 of the RAW COMMITTED BYTES; one
//     whose hash matches no known bundle is SKIPPED + LOGGED, never counted;
//   - N = DISTINCT handles per bundle (re-attesting twice doesn't inflate the badge);
//   - the badge is credibility display only — it NEVER changes rank (the same
//     attested/trusted-but-labeled vocabulary as HARDWARE.md).
export function loadAttestations(root, knownHashes) {
  const byHash = {}   // sha256 -> Set of handles
  let files = []
  try { files = readdirSync(join(root, 'scoreboard', 'attestations')).filter(f => f.endsWith('.json')).sort() } catch { return byHash }
  for (const f of files) {
    let a
    try { a = JSON.parse(readFileSync(join(root, 'scoreboard', 'attestations', f), 'utf8')) } catch (err) {
      console.error(`skipped unreadable attestation ${f}: ${err.message}`); continue
    }
    const errs = []
    if (!a || typeof a !== 'object' || Array.isArray(a)) errs.push('not an object')
    else {
      if (!/^[0-9a-f]{64}$/.test(String(a.bundle_sha256 || ''))) errs.push('bundle_sha256')
      if (typeof a.handle !== 'string' || !a.handle) errs.push('handle')
      if (a.judge_exit !== 0) errs.push('judge_exit must be 0')
      if (typeof a.problem_id !== 'string' || !a.problem_id) errs.push('problem_id')
    }
    if (errs.length) { console.error(`skipped malformed attestation ${f} (${errs.join(', ')})`); continue }
    if (!knownHashes.has(a.bundle_sha256)) {
      console.error(`skipped attestation ${f}: bundle sha256 ${a.bundle_sha256.slice(0, 12)}… matches no committed bundle`)
      continue
    }
    ;(byHash[a.bundle_sha256] ||= new Set()).add(a.handle)
  }
  return byHash
}

const HISTORY_NOTE = 'Append-only frontier ledger. `events` are NEVER rewritten — build.mjs only appends; `snapshot` is a mutable cache of the last-diffed board state. Event dates come from each entry\'s verified_at; `observed` (when present) is the date the operator ran the build with --now. Genesis-flagged events were backfilled from the board state when the ledger was created.'

// ---- assemble the full payload ----------------------------------------------
export function buildData(root = ROOT) { return buildAll(root).payload }
export function buildAll(root = ROOT, opts = {}) {
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
  const harness = data.harness_repo || 'https://github.com/QuantumMytheme/quantum-harness'
  const shaOf = bundleHashers(root, harness)
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
        bundle_sha256: shaOf(e),                    // raw-bytes hash of the committed bundle; null = honestly unavailable
        reverify: reverifyCommand(e, harness),
        verified_at: e.verified_at || null,
        why: e.why_it_scores,
        hardware: hr
          ? { backend: hr.backend, metric: hr.metric, value: hr.value, url: hr.report_url, emulated: isEmulatedReport(hr), label: isEmulatedReport(hr) ? 'noisy-sim' : 'hw' }
          : null,
      })
    })
  }

  // reproduced ×N — count PR-committed attestations per bundle hash (display only, never rank)
  const knownHashes = new Set(rows.map(r => r.bundle_sha256).filter(Boolean))
  const atts = loadAttestations(root, knownHashes)
  for (const r of rows) {
    const s = r.bundle_sha256 ? atts[r.bundle_sha256] : null
    r.reproduced = s ? s.size : 0
    r.reproduced_by = s ? [...s].sort() : []
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

  // frontier ledger: diff the fresh board against the committed history
  const snapshot = frontierSnapshot(byProblem)
  let committed = null
  try { committed = JSON.parse(readFileSync(join(root, 'scoreboard', 'frontier-history.json'), 'utf8')) } catch { /* genesis */ }
  const pendingEvents = committed
    ? diffFrontier(committed.snapshot, snapshot, byProblem)
    : genesisEvents(snapshot, byProblem)
  const baseSeq = (committed && committed.events && committed.events.length) || 0
  pendingEvents.forEach((e, i) => {
    e.seq = baseSeq + i + 1
    if (opts.now) e.observed = opts.now   // only genuinely-appended events, only when the operator says when
  })
  const history = {
    schema: 'quantummytheme/frontier-history@1',
    note: HISTORY_NOTE,
    snapshot,
    events: [...((committed && committed.events) || []), ...pendingEvents],
  }
  const feedXml = atomFeed(history)
  const changelog = history.events.slice(-10).reverse()   // newest first

  const generated = new Date().toISOString().slice(0, 10)
  const payload = { generated, count: rows.length, problems, rows, coverage, frontier, paradigms, changelog }
  return { payload, history, pendingEvents, feedXml }
}

function main() {
  const nowIdx = process.argv.indexOf('--now')
  const now = nowIdx > -1 ? process.argv[nowIdx + 1] : null
  const { payload, history, pendingEvents, feedXml } = buildAll(ROOT, { now })
  const out = `// GENERATED by scoreboard/build.mjs — do not edit. Run \`node scoreboard/build.mjs\`.\n`
    + `window.SCOREBOARD_DATA = ${JSON.stringify(payload, null, 2)};\n`
  const histOut = JSON.stringify(history, null, 2) + '\n'

  // ignore the generated-date line when comparing freshness
  const strip = s => s.replace(/"generated":\s*"[^"]*",?\n?/, '')
  const same = s => s
  const targets = [
    [join(ROOT, 'viewer', 'scoreboard-data.js'), out, strip],
    [join(ROOT, 'scoreboard', 'frontier-history.json'), histOut, same],
    [join(ROOT, 'viewer', 'feed.xml'), feedXml, same],
  ]
  if (process.argv.includes('--check')) {
    let stale = false
    for (const [target, want, norm] of targets) {
      let cur = ''
      try { cur = readFileSync(target, 'utf8') } catch {}
      if (norm(cur) !== norm(want)) { stale = true; console.error(`STALE: ${target.slice(ROOT.length + 1)} — run \`node scoreboard/build.mjs\` and commit.`) }
    }
    if (stale) process.exit(1)
    console.log('fresh: scoreboard-data.js, frontier-history.json and feed.xml all match entries.json'); process.exit(0)
  }
  for (const [target, want] of targets) writeFileSync(target, want)
  console.log(`wrote viewer/scoreboard-data.js — ${payload.count} entries across ${payload.problems.length} problems, ${payload.coverage.length} known problems in coverage`)
  console.log(pendingEvents.length
    ? `frontier ledger: appended ${pendingEvents.length} event${pendingEvents.length === 1 ? '' : 's'} (${pendingEvents.map(e => e.type).join(', ')}) — commit scoreboard/frontier-history.json + viewer/feed.xml`
    : 'frontier ledger: no new events — history and feed unchanged')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
