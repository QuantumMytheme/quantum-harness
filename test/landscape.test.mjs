import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadRunner, makeStubDom } from './stub-dom.mjs'

// Landscape Explorer — the local-only tfim3 p=1 QAOA γ×β sweep. These tests pin
// the physics (hand-checked energies), the circuit the sim expresses, and the
// honest-copy contract in the UI (stays-on-your-machine, no uploads, chunked).

const { QMRunner: R } = loadRunner()
const L = R.landscape

test('landscape helpers exposed: p=1 ops + energyAt over the committed tfim3 Hamiltonian', () => {
  assert.ok(L && L.ops && L.energyAt && Array.isArray(L.terms))
  assert.equal(L.terms.length, 5, 'H = -Z0Z1 - Z1Z2 - 0.8(X0+X1+X2)')
  assert.ok(Math.abs(L.E0 - (-3.0090221197813234)) < 1e-12, 'exact-diagonalization E0 from the committed reference')
})

test('the p=1 circuit is the rank-1 QAOA structure truncated to one layer', () => {
  const ops = L.ops(0.5, 0.25)
  assert.equal(ops.length, 8)
  assert.deepEqual(ops.slice(0, 3).map(o => o.gate), ['h', 'h', 'h'])
  assert.deepEqual(ops[3], { gate: 'rzz', q: [0, 1], params: [0.5] })
  assert.deepEqual(ops[4], { gate: 'rzz', q: [1, 2], params: [0.5] }, 'couplers on the chain edges only')
  assert.deepEqual(ops.slice(5).map(o => o.gate), ['rx', 'rx', 'rx'])
  assert.deepEqual(ops.slice(5).map(o => o.params[0]), [0.25, 0.25, 0.25])
})

test('hand-checked point 1: γ=0 leaves |+++⟩ → ⟨H⟩ = −0.8·3 = −2.4 exactly', () => {
  assert.ok(Math.abs(L.energyAt(0, 0) - (-2.4)) < 1e-12)
})

test('hand-checked point 2: at γ=0 the mixer only adds a phase to |+++⟩ → still −2.4', () => {
  // |+> is an X eigenstate, so rx(β)|+> = e^{-iβ/2}|+> — a global phase
  assert.ok(Math.abs(L.energyAt(0, 1.234) - (-2.4)) < 1e-12)
  assert.ok(Math.abs(L.energyAt(0, Math.PI / 2) - (-2.4)) < 1e-12)
})

test('hand-checked point 3: β=0 gives the closed form E(γ,0) = −0.8·(2cosγ + cos²γ)', () => {
  // rzz phases leave Z-basis probabilities uniform (⟨ZZ⟩ = 0); flipping q0/q2 sees one
  // coupler → ⟨X⟩ = cosγ; flipping q1 sees both → ⟨X1⟩ = cos²γ. Cross-checked vs sim.py.
  for (const g of [0.7, 2.0]) {
    const want = -0.8 * (2 * Math.cos(g) + Math.cos(g) ** 2)
    assert.ok(Math.abs(L.energyAt(g, 0) - want) < 1e-12, `E(${g},0) = ${L.energyAt(g, 0)} vs ${want}`)
  }
})

test('cross-check vs a committed independent number: the p=2 rank-1 circuit reproduces its claim', () => {
  const st = R.sim.runOps(R.RUNS.tfim3.ops, 3)
  const E = R.sim.expectation(st, 3, L.terms)
  assert.ok(Math.abs(E - (-3.0089189812867385)) < 1e-9, `p=2 energy ${E} matches the committed claim`)
})

test('a full 48×48 sweep finds the p=1 basin — honestly short of E₀', () => {
  const RES = 48
  let min = Infinity, max = -Infinity
  for (let bi = 0; bi < RES; bi++) for (let gi = 0; gi < RES; gi++) {
    const E = L.energyAt(gi / (RES - 1) * Math.PI, bi / (RES - 1) * Math.PI)
    if (E < min) min = E; if (E > max) max = E
  }
  assert.ok(min < -2.85, `p=1 minimum ${min} is a real improvement over |+++⟩ (−2.4)`)
  assert.ok(min > L.E0 + 1e-6, 'and p=1 provably cannot reach E₀ — the honest headline')
  assert.ok(max > 1, 'the plane includes genuinely bad regions (structure to see)')
})

test('the Landscape tab is wired with honest local-only copy and a chunked sweep', () => {
  const src = readFileSync(fileURLToPath(new URL('../viewer/lab.js', import.meta.url)), 'utf8')
  assert.match(src, /\['land', 'Landscape', '09'\]/, 'tab registered')
  assert.match(src, /land: secLand/, 'section registered')
  assert.match(src, /land: 1/, 'hash route valid')
  assert.match(src, /stays on your machine/i, 'honest copy: local-only')
  assert.match(src, /nothing is uploaded, nothing persists/i, 'honest copy: no persistence, no uploads')
  assert.match(src, /judge’s verdict is the only authority/, 'sim labeled advisory')
  assert.match(src, /setTimeout\(chunk, 0\)/, 'sweep is chunked so the UI stays responsive')
  assert.match(src, /data-landsweep/, 'CSP-clean delegated trigger (no inline handlers)')
  assert.match(src, /in-browser sim/, 'results labeled in-browser sim')
  assert.ok(!/fetch\(.*\/api\/atlas/.test(src), 'no tile-upload endpoint — the crowd mechanic was cut on purpose')
})

test('boot smoke: lab.js renders the Landscape and Results (traps) sections without throwing', () => {
  const runnerSrc = readFileSync(fileURLToPath(new URL('../viewer/runner.js', import.meta.url)), 'utf8')
  const labSrc = readFileSync(fileURLToPath(new URL('../viewer/lab.js', import.meta.url)), 'utf8')
  for (const hash of ['#land', '#atlas']) {
    const { win, doc } = makeStubDom()
    const sheet = doc.createElement('div'); sheet.id = 'qm-sheet'
    const tabs = doc.createElement('nav'); tabs.id = 'qm-tabs'
    win.location.hash = hash
    const gcs = () => ({ getPropertyValue: () => '#123456' })
    new Function('window', 'document', 'getComputedStyle', 'navigator', runnerSrc)(win, doc, gcs, {})
    new Function('window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'performance', 'history', 'location', 'navigator', labSrc)(
      win, doc, gcs, () => 0, { now: () => 0 }, { replaceState() {} }, win.location, {})
    assert.ok(tabs.innerHTML.includes('Landscape'), 'the § 09 tab is offered')
    if (hash === '#land') {
      assert.match(sheet.innerHTML, /stays on your machine/)
      assert.match(sheet.innerHTML, /data-landsweep/)
      assert.match(sheet.innerHTML, /data-key="land"/)
    } else {
      assert.match(sheet.innerHTML, /Gallery of Traps/)
      const expectedTraps = Object.keys(win.QMRunner.IMPOSTORS).length
      assert.equal((sheet.innerHTML.match(/data-impostor=/g) || []).length, expectedTraps,
        `all ${expectedTraps} trap cards render (one per IMPOSTORS entry, not a hardcoded count)`)
    }
  }
})

test('mint-this-point produces the prefilled command from the picked angles', () => {
  const src = readFileSync(fileURLToPath(new URL('../viewer/lab.js', import.meta.url)), 'utf8')
  assert.match(src, /bin\/new-run\.sh ' \+ repo \+ ' --remix tfim3/, 'prefilled mint command')
  assert.match(src, /run-tfim3-p1-g' \+ Math\.round\(p\.g \* 1000\)/, 'repo name carries the starting angles')
  assert.match(src, /starting-point ops \(JSON/, 'the exact circuit rides along')
  assert.match(src, /nothing from this page is sent anywhere/i, 'mint copy stays honest')
})
