import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadRunner } from './stub-dom.mjs'

// Circuit Golf — the in-browser editor that lets a visitor hand-golf the rank-1
// circuit under the board's REAL tie-break rules (metric, then fewer 2q gates,
// then lower depth) and prove the result with the real judge. These tests pin
// the pure logic: the exact JS sim, the cost model (mirroring sim.py), the
// status/ranking maths, the client-built proof bundle, and the census hook.

const { QMRunner: R, doc, events } = loadRunner()
const S2 = Math.SQRT1_2

test('runner exposes the sim primitives and the golf module', () => {
  assert.ok(R.sim && R.sim.zeroState && R.sim.applyOp && R.sim.runOps && R.sim.fidelity && R.sim.expectation)
  assert.ok(R.golf && R.golf.status && R.golf.bundle && R.golf.cost && R.GOLF)
  assert.deepEqual(Object.keys(R.GOLF).sort(), ['ghz3', 'isingbell2'], 'first slice: ghz3 + isingbell2 only')
})

test('hand-computed: the rank-1 GHZ₃ circuit re-simulates to fidelity 1.0', () => {
  const st = R.sim.runOps(R.RUNS.ghz3.ops, 3)
  const fid = R.sim.fidelity(st, R.RUNS.ghz3.target)
  assert.ok(Math.abs(fid - 1.0) < 1e-12, `fidelity ${fid}`)
})

test('hand-computed: dropping the second CX gives fidelity 0.25 exactly', () => {
  // (|000>+|110>)/√2 overlaps GHZ with |<t|s>|² = |1/√2·1/√2|² = 0.25
  const ops = [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }]
  const fid = R.sim.fidelity(R.sim.runOps(ops, 3), R.RUNS.ghz3.target)
  assert.ok(Math.abs(fid - 0.25) < 1e-12, `fidelity ${fid}`)
})

test('hand-computed: the rank-1 Ising Bell circuit hits E = −2 exactly', () => {
  const st = R.sim.runOps(R.RUNS.isingbell2.ops, 2)
  const E = R.sim.expectation(st, 2, R.RUNS.isingbell2.terms)
  assert.ok(Math.abs(E - (-2.0)) < 1e-12, `energy ${E}`)
})

test('sx gate: √X — two applications equal X, one gives 50/50', () => {
  const one = R.sim.runOps([{ gate: 'sx', q: [0] }], 1)
  const p0 = one[0][0] ** 2 + one[0][1] ** 2
  assert.ok(Math.abs(p0 - 0.5) < 1e-12, 'single sx → 50/50')
  const two = R.sim.runOps([{ gate: 'sx', q: [0] }, { gate: 'sx', q: [0] }], 1)
  const p1 = two[1][0] ** 2 + two[1][1] ** 2
  assert.ok(Math.abs(p1 - 1.0) < 1e-12, 'sx·sx = X (|0⟩ → |1⟩)')
})

test('cost model mirrors sim.py: greedy layered depth + 2q count', () => {
  // ghz3 rank 1: h(0) | cx(0,1) | cx(1,2) → layers 1,2,3 → depth 3, 2q 2
  assert.deepEqual(R.golf.cost(R.RUNS.ghz3.ops, 3), { twoq: 2, depth: 3 })
  // parallel single-qubit gates share a layer
  const par = [{ gate: 'h', q: [0] }, { gate: 'h', q: [1] }, { gate: 'h', q: [2] }, { gate: 'cx', q: [0, 1] }]
  assert.deepEqual(R.golf.cost(par, 3), { twoq: 1, depth: 2 })
  // tfim3 p=2 committed circuit: sim.circuit_depth gives 7, 4 rzz (cross-checked against sim.py)
  assert.deepEqual(R.golf.cost(R.RUNS.tfim3.ops, 3), { twoq: 4, depth: 7 })
})

test('golf status: the unmodified rank-1 circuit is a dead heat (tie)', () => {
  const st = R.golf.status('ghz3', R.RUNS.ghz3.ops)
  assert.equal(st.rank, 'tie')
  assert.equal(st.violations.length, 0)
  assert.ok(st.metric.meets && st.metric.tie)
})

test('golf status: metric tie at HIGHER depth ranks behind (real tie-break order)', () => {
  // rz(0) on q0 is identity → energy still −2, but depth 3 > rank-1 depth 2
  const ops = [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }, { gate: 'rz', q: [0], params: [0] }]
  const st = R.golf.status('isingbell2', ops)
  assert.equal(st.metric.tie, true)
  assert.deepEqual(st.cost, { twoq: 1, depth: 3 })
  assert.equal(st.rank, 'behind')
})

test('golf status: metric tie at LOWER cost would outrank rank 1', () => {
  // simulate a costlier incumbent (the comparison logic, not the physics —
  // the real ghz3/isingbell2 frontiers are provably saturated)
  const orig = R.RUNS.isingbell2.ops
  R.RUNS.isingbell2.ops = [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }, { gate: 'rz', q: [0], params: [0] }]
  try {
    const st = R.golf.status('isingbell2', [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }])
    assert.deepEqual(st.rank1, { twoq: 1, depth: 3 })
    assert.equal(st.rank, 'outrank')
  } finally { R.RUNS.isingbell2.ops = orig }
})

test('golf status: constraint violations are caught live (host-pinned 2q cap)', () => {
  // 3 CX exceeds ghz3's reference-pinned cap of 2 (the bundle's own budget says 4)
  const ops = [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }, { gate: 'cx', q: [1, 2] }, { gate: 'cx', q: [0, 1] }]
  const st = R.golf.status('ghz3', ops)
  assert.equal(st.rank, 'invalid')
  assert.ok(st.violations.some(v => /2q-gate count 3 exceeds the cap 2/.test(v)), st.violations.join(' | '))
  // and a fidelity below threshold is invalid even when structurally legal
  const bad = R.golf.status('ghz3', [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }])
  assert.equal(bad.rank, 'invalid')
  assert.equal(bad.violations.length, 0, 'no structure violation — it fails on the metric gate')
})

test('add-gate options respect the native set and coupling map', () => {
  const opts = R.golf.addOptions(R.GOLF.ghz3).map(o => o[0])
  assert.ok(opts.includes('cx:0,1') && opts.includes('cx:1,0') && opts.includes('cx:1,2'), 'CX both directions per edge')
  assert.ok(!opts.includes('cx:0,2'), 'no CX off the coupling map')
  assert.ok(opts.includes('sx:0'), 'ghz3 native set includes sx')
  const ising = R.golf.addOptions(R.GOLF.isingbell2).map(o => o[0])
  assert.ok(!ising.some(v => v.startsWith('sx:')), 'isingbell2 native set has no sx')
  assert.ok(ising.includes('cz:0,1') && !ising.includes('cz:1,0'), 'symmetric 2q gates listed once per edge')
})

test('the client-built proof bundle matches the judge schema, claim from the exact sim', () => {
  const b = R.golf.bundle('ghz3', R.RUNS.ghz3.ops)
  assert.equal(b.schema, 'quantum-harness/proof-bundle@1')
  assert.equal(b.problem_id, 'ghz3')
  assert.equal(b.task, 'state_prep')
  assert.equal(b.circuit.n_qubits, 3)
  assert.equal(b.circuit.ops.length, 3)
  assert.ok(Math.abs(b.claim.fidelity - 1.0) < 1e-12)
  assert.equal(b.classical_baseline.fidelity, 0.5)
  assert.deepEqual(b.constraints.coupling_map, [[0, 1], [1, 2]])
  // an EDITED circuit claims what the sim recomputes — never the rank-1 number
  const cut = R.golf.bundle('ghz3', [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }])
  assert.ok(Math.abs(cut.claim.fidelity - 0.25) < 1e-12)
  const bi = R.golf.bundle('isingbell2', R.RUNS.isingbell2.ops)
  assert.ok(Math.abs(bi.claim.energy - (-2.0)) < 1e-12)
  assert.equal(bi.classical_baseline.energy, -1.0)
})

test('golf drawer renders: rules copy, editable rows, live meter, Prove-it', () => {
  R.openGolf('ghz3')
  const overlay = doc.getElementById('qm-overlay')
  const panel = overlay.children[overlay.children.length - 1]
  assert.match(panel.innerHTML, /real tie-break rules/, 'explains the golf rules = the board tie-breaks')
  assert.match(panel.innerHTML, /fewer 2-qubit gates/)
  assert.match(panel.innerHTML, /in-browser JS sim/, 'labels the live numbers as in-browser sim')
  assert.match(panel.innerHTML, /only a public repo the board re-verifies actually ranks/, 'never claims the browser run is on the board')
  assert.match(panel.innerHTML, /data-golfprove/)
  const rows = doc.getElementById('qm-golf-ops')
  assert.match(rows.innerHTML, /data-golfdel="0"/, 'op rows are editable')
  assert.match(rows.innerHTML, /CX/, 'rank-1 ops loaded')
  const meter = doc.getElementById('qm-golf-meter')
  assert.match(meter.innerHTML, /rank 1 cost/, 'cost meter vs rank 1')
  assert.match(meter.innerHTML, /2q 2 · depth 3/)
  assert.match(meter.innerHTML, /dead heat/, 'unmodified circuit = tie')
  R.closeOverlay()
})

test('qm:verify-accept fires with {problem_id, sha256-of-raw-bytes} and never from golf', async () => {
  events.length = 0
  const raw = Buffer.from('{"schema":"quantum-harness/proof-bundle@1","x":1}\n')
  await R.emitVerifyAccept('ghz3', new Uint8Array(raw))
  assert.equal(events.length, 1)
  const ev = events[0]
  assert.equal(ev.type, 'qm:verify-accept')
  assert.equal(ev.detail.problem_id, 'ghz3')
  const expect = createHash('sha256').update(raw).digest('hex')
  assert.equal(ev.detail.sha256, expect, 'SHA-256 over the raw bundle bytes, lowercase hex')
  assert.match(ev.detail.sha256, /^[0-9a-f]{64}$/)
  // string fallback hashes the UTF-8 bytes of the text — same digest for UTF-8 content
  events.length = 0
  await R.emitVerifyAccept('ghz3', raw.toString('utf8'))
  assert.equal(events[0].detail.sha256, expect)
  // the hook is wired ONLY into the committed re-verify path, never golf's Prove-it
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../viewer/runner.js', import.meta.url), 'utf8')
  assert.equal((src.match(/emitVerifyAccept\(pid, bundleBuf\)/g) || []).length, 1, 'one call site: runRealJudge')
  assert.ok(!/emitVerifyAccept/.test(src.slice(src.indexOf('async function golfProve'), src.indexOf('IMPOSTOR WORKSHOP UI'))), 'golfProve never emits the census event')
})
