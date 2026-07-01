import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadRunner } from './stub-dom.mjs'

// Impostor Workshop · Gallery of Traps — the committed OVERFIT/FORGED fixtures
// rendered as runnable cards. These tests pin the honest contract: every card is
// a real committed fixture, its documented catching gate matches the fixture's
// own documentation, and the run path executes the real-judge flow.

const { QMRunner: R, doc } = loadRunner()
const BENCH = (f) => fileURLToPath(new URL('../bench/quantum-judge/' + f, import.meta.url))

test('IMPOSTORS enumerates exactly the committed OVERFIT + FORGED fixtures', () => {
  const files = Object.values(R.IMPOSTORS).map(t => t.file).sort()
  assert.deepEqual(files, [
    'quantum-proof-FORGED.json',
    'quantum-proof-OVERFIT.json',
    'quantum-proof-arch-OVERFIT.json',
    'quantum-proof-h2-FORGED.json',
    'quantum-proof-noisy-FORGED.json',
    'quantum-proof-qml-OVERFIT.json',
  ])
  for (const t of Object.values(R.IMPOSTORS)) {
    assert.ok(existsSync(BENCH(t.file)), `${t.file} is committed in bench/quantum-judge/`)
    assert.ok(t.label && t.trap && t.refId && t.expect, `${t.file}: label/trap/refId/expect present`)
  }
})

test('each card matches its fixture: refId = problem_id, expected exit = documented exit', () => {
  for (const [key, t] of Object.entries(R.IMPOSTORS)) {
    const fx = JSON.parse(readFileSync(BENCH(t.file), 'utf8'))
    assert.equal(t.refId, fx.problem_id, `${key}: refId matches the fixture's problem_id`)
    const doc0 = String(fx._attack || fx._comment || '')
    assert.match(doc0, new RegExp(`exit ${t.expect}`), `${key}: fixture documents exit ${t.expect}`)
    assert.ok(existsSync(BENCH(`references/${t.refId}.json`)), `${key}: hidden reference exists for ${t.refId}`)
    // OVERFIT traps are caught by the held-out gate (6); FORGED by re-simulation (4)
    assert.equal(t.expect, /OVERFIT/.test(t.file) ? 6 : 4, `${key}: gate class matches the fixture class`)
  }
})

test('the Results-tab gallery renders every trap as a runnable, honestly-labeled card', () => {
  const labSrc = readFileSync(fileURLToPath(new URL('../viewer/lab.js', import.meta.url)), 'utf8')
  assert.match(labSrc, /data-impostor/, 'cards carry data-impostor (delegated, CSP-clean — no inline handlers)')
  assert.match(labSrc, /committed adversarial fixture/i, 'honest framing: these are committed fixtures')
  assert.match(labSrc, /every gate you can <em>see<\/em>/, 'the lesson: passing visible gates is not enough')
  assert.match(labSrc, /anti-overfit gate, exit 6/, 'names the held-out gate')
  assert.ok(!/onclick=/.test(labSrc), 'no inline handlers in lab.js')
})

test('the run path executes: openImpostor renders the drawer, runImpostor is wired', () => {
  for (const key of Object.keys(R.IMPOSTORS)) {
    R.openImpostor(key)
    const overlay = doc.getElementById('qm-overlay')
    const panel = overlay.children[overlay.children.length - 1]
    assert.match(panel.innerHTML, /committed forgery fixture/, `${key}: labeled as a committed fixture`)
    assert.match(panel.innerHTML, new RegExp('data-impjudge="' + key + '"'), `${key}: real-judge Run button present`)
    assert.match(panel.innerHTML, new RegExp('exit ' + R.IMPOSTORS[key].expect), `${key}: documents the expected exit code`)
    assert.match(panel.innerHTML, /REJECT/, `${key}: shows the expected verdict`)
    R.closeOverlay()
  }
  // the delegated click handler routes both card and Run-button attributes
  const src = readFileSync(fileURLToPath(new URL('../viewer/runner.js', import.meta.url)), 'utf8')
  assert.match(src, /data-impostor.*data-impjudge|data-impjudge.*data-impostor/s, 'both attributes in the delegated selector')
  assert.match(src, /runImpostor\(el\.getAttribute\('data-impjudge'\)\)/)
  // runImpostor drives the same real-judge core the committed re-verify path uses
  assert.match(src, /async function runImpostor[\s\S]*?judgeBundleText\(T\.refId, bundle\)/, 'impostor runs use judgeBundleText (the real judge)')
  // and fetches fixtures from the same raw path runner.js already uses (RAW + file)
  assert.match(src, /fetch\(RAW \+ T\.file\)/)
})

test('impostor runs never fire the census accept-event (only known-good committed bundles do)', () => {
  const src = readFileSync(fileURLToPath(new URL('../viewer/runner.js', import.meta.url)), 'utf8')
  const seg = src.slice(src.indexOf('async function runImpostor'), src.indexOf('WASM real KERNEL judge'))
  assert.ok(seg.length > 100, 'found the runImpostor segment')
  assert.ok(!/emitVerifyAccept/.test(seg), 'runImpostor does not emit qm:verify-accept')
})
