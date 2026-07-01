import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Panel-judged board analysis layers:
//   1. Paradigm League — (paradigm family × task) rollup with the n<3
//      "anecdote, not evidence" honesty gate.
// Pure file/function checks — no network.
// ---------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const v = p => join(ROOT, 'viewer', p)
const { buildParadigms } = await import(new URL('../scoreboard/build.mjs', import.meta.url))

const sbData = () => {
  const s = readFileSync(v('scoreboard-data.js'), 'utf8')
  return JSON.parse(s.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''))
}

/* ---------------------- 1 · paradigm league ------------------------------ */
// hand-computed fixture: two vqe boards, qaoa on both (rank 1 on both), hwe
// second on p1. vqe margin = clamp01(1 - value/gap_budget); efficiency
// = clamp01(1 - (2q + 0.5*depth) / (2.5*n_qubits + 3)).
const vqeEntry = (pid, para, value, twoq, depth) => ({
  problem_id: pid, task: 'vqe', paradigm_short: para, model: 'm',
  run_repo: `https://github.com/x/${pid}-${para}`, proof_bundle: 'b.json',
  verified_metric: { value, gap_budget: 0.05 },
  resource_costs: { two_qubit_gates: twoq, depth, n_qubits: 2 },
})
test('buildParadigms matches a hand-computed rollup (n, rank1, mean margin/efficiency, untested)', () => {
  const byProblem = {
    p1: [vqeEntry('p1', 'qaoa', 0.01, 2, 2), vqeEntry('p1', 'hwe', 0.02, 1, 2)],
    p2: [vqeEntry('p2', 'qaoa', 0.025, 4, 4)],
  }
  const catalog = [
    { problem_id: 'p1', task: 'vqe' }, { problem_id: 'p2', task: 'vqe' },
    { problem_id: 'p3', task: 'vqe' }, { problem_id: 'q1', task: 'classify' },
  ]
  const league = buildParadigms(byProblem, catalog)
  const qaoa = league.find(g => g.paradigm === 'qaoa')
  const hwe = league.find(g => g.paradigm === 'hwe')
  assert.ok(qaoa && hwe)
  assert.equal(qaoa.n, 2)
  assert.deepEqual(qaoa.boards, ['p1', 'p2'])
  assert.equal(qaoa.rank1_count, 2, 'qaoa leads p1 (0.01 < 0.02, lower better) and is alone on p2')
  // margins: 1-0.01/0.05=0.8 · 1-0.025/0.05=0.5 → mean 0.65
  assert.equal(qaoa.mean_margin, 0.65)
  // efficiency: 1-(2+1)/8=0.625 · 1-(4+2)/8=0.25 → mean 0.4375 → 0.438
  assert.equal(qaoa.mean_efficiency, 0.438)
  assert.deepEqual(qaoa.untested_problems, ['p3'], 'same-task problems only, never cross-task')
  assert.equal(qaoa.evidence, false, 'n=2 < 3 is an anecdote, not evidence')
  assert.equal(hwe.n, 1)
  assert.equal(hwe.rank1_count, 0)
  assert.deepEqual(hwe.untested_problems, ['p2', 'p3'])
  // never a cross-task aggregate: every group is a single (paradigm × task) pair
  for (const g of league) assert.equal(typeof g.task, 'string')
  assert.ok(!qaoa.untested_problems.includes('q1'), 'a classify problem is never "untested" for a vqe paradigm')
})

test('n >= 3 flips the evidence flag — a real sample stops being an anecdote', () => {
  const byProblem = {
    p1: [vqeEntry('p1', 'qaoa', 0.01, 2, 2)],
    p2: [vqeEntry('p2', 'qaoa', 0.02, 2, 2)],
    p3: [vqeEntry('p3', 'qaoa', 0.03, 2, 2)],
  }
  const league = buildParadigms(byProblem, [{ problem_id: 'p1', task: 'vqe' }, { problem_id: 'p2', task: 'vqe' }, { problem_id: 'p3', task: 'vqe' }])
  assert.equal(league[0].n, 3)
  assert.equal(league[0].evidence, true)
})

test('the emitted paradigms block is honest about today’s corpus: every cell is small-n', () => {
  const d = sbData()
  assert.ok(Array.isArray(d.paradigms) && d.paradigms.length >= 6, 'paradigms block emitted')
  const problems = new Set(d.problems)
  for (const g of d.paradigms) {
    assert.equal(typeof g.paradigm, 'string')
    assert.equal(typeof g.task, 'string')
    assert.ok(g.n >= 1)
    assert.equal(g.evidence, g.n >= 3, `${g.paradigm} evidence flag mirrors n>=3`)
    assert.ok(g.rank1_count <= g.n)
    for (const b of g.boards) assert.ok(problems.has(b), `${g.paradigm} board ${b} is a real board`)
    for (const u of g.untested_problems) assert.ok(!g.boards.includes(u), 'untested ∩ entered = ∅')
    assert.ok(g.mean_margin >= 0 && g.mean_margin <= 1)
    assert.ok(g.mean_efficiency >= 0 && g.mean_efficiency <= 1)
  }
  // today every group is n=1 — the whole table must render as anecdotes, honestly
  assert.ok(d.paradigms.every(g => g.n < 3 ? !g.evidence : true))
  // untested cells cross-link the wanted board: tfim3's qaoa has open vqe cells
  const qaoa = d.paradigms.find(g => g.paradigm === 'qaoa' && g.task === 'vqe')
  assert.ok(qaoa && qaoa.untested_problems.includes('isingbell2'))
})

test('league viewer wiring: container, renderer, grey anecdote badge, CSP-clean', () => {
  const html = readFileSync(v('index.html'), 'utf8')
  assert.match(html, /id="sb-league"/)
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /renderLeague/)
  assert.match(app, /anecdote, not evidence/, 'the n<3 badge language is explicit')
  assert.match(app, /No cross-task ranking/i, 'the cross-task honesty rule is stated in the UI')
  assert.doesNotMatch(app, /on(click|mouseover|load)\s*=/i, 'no inline handlers — CSP-clean')
  const css = readFileSync(v('style.css'), 'utf8')
  for (const cls of ['.sb-league', '.anecbadge', 'tr.league-row.anecdote']) assert.ok(css.includes(cls), `style.css styles ${cls}`)
})
