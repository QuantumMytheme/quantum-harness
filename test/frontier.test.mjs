import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Wanted Board (coverage) + Frontier Atlas (Pareto) + pipeline hardening.
// Guards: build.mjs emits coverage over ALL known problems (runs or not) and
// per-problem Pareto frontiers; a malformed community entry is skipped + logged,
// never a crash; an emulated backend never earns hardware credit. Pure
// file/spawn checks — no network.
// ---------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const v = p => join(ROOT, 'viewer', p)
const { validEntry, filterValid, isEmulatedReport, qualityAxes, paretoFrontier, frontierGap, problemCatalog, lineage } =
  await import(new URL('../scoreboard/build.mjs', import.meta.url))

const sbData = () => {
  const s = readFileSync(v('scoreboard-data.js'), 'utf8')
  return JSON.parse(s.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''))
}

// --- coverage: the wanted board's data --------------------------------------
test('coverage enumerates EVERY known problem — quantum + kernel references, not just problems with runs', () => {
  const d = sbData()
  assert.ok(Array.isArray(d.coverage), 'scoreboard-data carries a coverage array')
  const byId = Object.fromEntries(d.coverage.map(c => [c.problem_id, c]))
  // every quantum-judge reference is a coverage row (filename stem when problem_id is not inline)
  for (const f of readdirSync(join(ROOT, 'bench/quantum-judge/references')).filter(f => f.endsWith('.json'))) {
    const ref = JSON.parse(readFileSync(join(ROOT, 'bench/quantum-judge/references', f), 'utf8'))
    const pid = ref.problem_id || basename(f, '.json')
    assert.ok(byId[pid], `coverage includes quantum problem ${pid}`)
    assert.equal(byId[pid].source, 'quantum-judge')
  }
  // and the kernel-judge problem set
  const kernel = d.coverage.filter(c => c.source === 'kernel-judge')
  assert.ok(kernel.length >= 1, 'coverage includes the kernel-judge problem set')
  // shape of every record
  for (const c of d.coverage) {
    assert.ok(Array.isArray(c.paradigms_tried), `${c.problem_id}.paradigms_tried is an array`)
    for (const k of ['has_model_run', 'has_classical_baseline', 'has_hardware_overlay', 'has_noisy_sim_overlay'])
      assert.equal(typeof c[k], 'boolean', `${c.problem_id}.${k} is boolean`)
    assert.ok(Array.isArray(c.gaps), `${c.problem_id}.gaps is an array`)
  }
  // a problem with zero runs is an explicit first-run gap, with a pasteable mint command
  const untried = d.coverage.find(c => c.runs === 0 && c.source === 'quantum-judge')
  assert.ok(untried, 'at least one quantum problem is still untried (e.g. bellnoisy2)')
  assert.equal(untried.gaps[0].kind, 'first-run')
})

test('wanted-board gaps are honest and pasteable: "untried" language, mint commands with no --org', () => {
  const d = sbData()
  for (const c of d.coverage) for (const g of c.gaps) {
    assert.match(g.command, /^bin\/new-run\.sh run-[\w-]+ --remix [\w-]+$/, `${c.problem_id}/${g.kind} command is a plain new-run.sh invocation`)
    assert.doesNotMatch(g.command, /--org/, 'mint commands default to the caller\'s own login — no --org')
    assert.match(g.command, new RegExp(`--remix ${c.problem_id}$`), 'remix targets the gap\'s own problem')
    // a gap is untried — never promised winnable or trivial
    assert.match(g.label, /untried/i, `${c.problem_id}/${g.kind} label says untried`)
    assert.doesNotMatch(g.label, /impossible|\beasy\b|guaranteed/i, 'no difficulty claims either way')
  }
  // the emulated tfim3 overlay does NOT satisfy the hardware cell
  const t = d.coverage.find(c => c.problem_id === 'tfim3')
  assert.equal(t.has_hardware_overlay, false, 'emulated overlay is not a hardware overlay')
  assert.equal(t.has_noisy_sim_overlay, true)
  assert.ok(t.gaps.some(g => g.kind === 'hardware'), 'tfim3 still wants a real-device overlay')
  assert.equal(t.has_model_run, true)
  assert.deepEqual([...t.paradigms_tried].sort(), ['hardware-efficient', 'qaoa'])
})

// --- Pareto dominance: hand-computed fixtures --------------------------------
const mk = (metric, twoq) => ({ paradigm_short: `p${metric}-${twoq}`, model: 'm', run_repo: 'https://github.com/x/y', verified_metric: { value: metric }, resource_costs: { two_qubit_gates: twoq } })
test('paretoFrontier matches a hand-computed lower-is-better fixture (vqe)', () => {
  // A(0.01 @2) and B(0.001 @4) trade off; C(0.02 @4) is beaten by B on metric at equal
  // cost (and by A on both); D duplicates A exactly — ties do not dominate each other.
  const f = paretoFrontier([mk(0.01, 2), mk(0.001, 4), mk(0.02, 4), mk(0.01, 2)], 'vqe')
  assert.equal(f.dir, 'lower')
  assert.equal(f.costKey, 'two_qubit_gates')
  assert.deepEqual(f.points.map(p => p.dominated), [false, false, true, false])
  const gap = frontierGap(f, 'gap')
  assert.match(gap, /no verified entry below 2 2q gates/)
  assert.match(gap, /untried/i)
  assert.doesNotMatch(gap, /impossible|\beasy\b/i)
})
test('paretoFrontier matches a hand-computed higher-is-better fixture (state_prep)', () => {
  // A(1.0 @2) best metric; B(0.995 @1) cheapest; C(0.99 @3) worse than A on both axes.
  const f = paretoFrontier([mk(1.0, 2), mk(0.995, 1), mk(0.99, 3)], 'state_prep')
  assert.deepEqual(f.points.map(p => p.dominated), [false, false, true])
})
test('the real tfim3 board is a genuine two-point frontier in the emitted data', () => {
  const d = sbData()
  const t = d.frontier.tfim3
  assert.ok(t, 'frontier carries tfim3')
  assert.equal(t.points.length, 2)
  assert.ok(t.points.every(p => !p.dominated), 'QAOA vs HWE is a real tradeoff — neither dominates')
  assert.equal(typeof t.gap, 'string')
  assert.match(t.gap, /untried/i)
  for (const p of t.points) assert.match(p.run_repo, /^https:\/\/github\.com\//)
  // single-entry boards still get an honest one-point sentence
  const single = Object.values(d.frontier).find(f => f.points.length === 1)
  assert.ok(single && /single point|Only one verified entry/i.test(single.gap))
})

// --- malformed-entry survival (the audit's reproduced crash) -----------------
test('a shapeless discovered entry ({"problem_id":"x"}) is skipped + logged — build.mjs and ingredients.mjs both survive', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qh-frontier-'))
  try {
    for (const dir of ['scoreboard', 'bin', 'bench/quantum-judge/references', 'bench/kernel-judge/references'])
      cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true })
    mkdirSync(join(tmp, 'viewer'), { recursive: true })
    const dpath = join(tmp, 'scoreboard', 'discovered.json')
    const disc = JSON.parse(readFileSync(dpath, 'utf8'))
    const goodCount = disc.entries.length
    disc.entries.push({ problem_id: 'x' })
    writeFileSync(dpath, JSON.stringify(disc))

    const b = spawnSync(process.execPath, [join(tmp, 'scoreboard', 'build.mjs')], { encoding: 'utf8' })
    assert.equal(b.status, 0, `build.mjs exits 0 despite the malformed entry\n${b.stderr}`)
    assert.match(b.stderr, /skipped malformed discovered entry/, 'the skip is logged, not silent')
    const built = JSON.parse(readFileSync(join(tmp, 'viewer', 'scoreboard-data.js'), 'utf8').replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''))
    assert.ok(built.rows.length >= goodCount, 'every legitimate entry still lands on the board')
    assert.ok(!built.rows.some(r => r.problem_id === 'x'), 'the malformed entry is not on the board')

    // pre-fix, `ingredients.mjs x` crashed with a TypeError at e.run_repo
    const i = spawnSync(process.execPath, [join(tmp, 'bin', 'ingredients.mjs'), 'x'], { encoding: 'utf8' })
    assert.equal(i.status, 0, `ingredients.mjs exits 0 despite the malformed entry\n${i.stderr}`)
    assert.match(i.stderr, /skipped malformed/, 'ingredients logs the skip too')
    assert.match(i.stdout, /No prior runs yet/, 'the remix pack degrades honestly')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('validEntry accepts every committed entry and rejects the shapeless one', () => {
  const seeds = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'entries.json'), 'utf8')).entries
  const disc = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'discovered.json'), 'utf8')).entries
  for (const e of [...seeds, ...disc]) assert.ok(validEntry(e).ok, `${e.problem_id} seed/discovered entry validates`)
  assert.equal(validEntry({ problem_id: 'x' }).ok, false)
  assert.equal(validEntry(null).ok, false)
  assert.equal(validEntry({ ...seeds[0], run_repo: 'http://evil.example' }).ok, false, 'non-GitHub run_repo rejected')
  assert.equal(filterValid([seeds[0], { problem_id: 'x' }]).length, 1)
})

// --- emulated backends never earn hardware credit -----------------------------
test('isEmulatedReport detects emulated/synthetic/local backends; real devices pass', () => {
  assert.equal(isEmulatedReport({ backend: 'local-noisy (EMULATED — not a real device)' }), true)
  assert.equal(isEmulatedReport({ backend: 'local-noisy (emulated)' }), true)
  assert.equal(isEmulatedReport({ backend: 'synthetic-nisq' }), true)
  assert.equal(isEmulatedReport({ backend: 'ibm_torino', emulated: true }), true, 'explicit flag wins')
  assert.equal(isEmulatedReport({ backend: 'ibm_torino' }), false)
  assert.equal(isEmulatedReport({ backend: 'ionq_aria' }), false)
  assert.equal(isEmulatedReport(null), false)
})

test('an emulated overlay earns the smaller noisy-sim robustness credit, not the hardware bonus', () => {
  const base = { task: 'vqe', verified_metric: { value: 0.01, gap_budget: 0.05 }, resource_costs: { two_qubit_gates: 2, depth: 3, n_qubits: 3 }, model: 'opus-4.8' }
  const none = qualityAxes(base).robustness
  const emu = qualityAxes({ ...base, hardware_reports: [{ backend: 'local-noisy (emulated)' }] }).robustness
  const real = qualityAxes({ ...base, hardware_reports: [{ backend: 'ibm_torino' }] }).robustness
  assert.ok(emu > none, 'a noisy-sim overlay is still worth something')
  assert.ok(real > emu, 'but strictly less than a real device run')
  assert.equal(real - none, 0.35)
  assert.ok(Math.abs(emu - none - 0.15) < 1e-9, 'noisy-sim credit is the smaller 0.15')
})

test('the emitted board labels the tfim3 overlay noisy-sim, and the viewer renders it inline (not tooltip-only)', () => {
  const d = sbData()
  const hwe = d.rows.find(r => r.problem_id === 'tfim3' && r.paradigm_short === 'hardware-efficient')
  assert.ok(hwe && hwe.hardware, 'tfim3 HWE row still carries its overlay')
  assert.equal(hwe.hardware.emulated, true)
  assert.equal(hwe.hardware.label, 'noisy-sim')
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /noisy-sim/, 'app.js renders the emulated label inline')
  assert.match(app, /simlink/, 'emulated overlays get their own visual class')
  assert.match(readFileSync(v('style.css'), 'utf8'), /\.hwlink\.simlink/)
})

// --- viewer wiring -------------------------------------------------------------
test('frontier viewer is wired: section container, script tag, CSP-clean renderer, styles', () => {
  const html = readFileSync(v('index.html'), 'utf8')
  assert.match(html, /<section id="frontier"[^>]*>/)
  assert.match(html, /id="frontier-root"/)
  assert.match(html, /<script src="frontier\.js">/)
  assert.ok(html.indexOf('<script src="scoreboard-data.js">') < html.indexOf('<script src="frontier.js">'), 'data loads before the renderer')
  assert.ok(existsSync(v('frontier.js')), 'viewer/frontier.js exists')
  const js = readFileSync(v('frontier.js'), 'utf8')
  assert.doesNotMatch(js, /on(click|mouseover|mousemove|load)\s*=/i, 'no inline handlers — CSP-clean')
  assert.match(js, /addEventListener/)
  for (const sym of ['wantedHTML', 'atlasHTML', 'dominated', 'data-copy', 'frontier-root'])
    assert.match(js, new RegExp(sym), `frontier.js contains ${sym}`)
  assert.match(js, /untried/i, 'viewer copy keeps the honesty language')
  const css = readFileSync(v('style.css'), 'utf8')
  for (const cls of ['.wanted-grid', '.wanted-card', '.gap-line', 'code.mint', '.copybtn', '.fr-canvas', '.fr-pts'])
    assert.ok(css.includes(cls), `style.css styles ${cls}`)
})

// --- structured lineage (stretch: remix_of surfaced per row) ------------------
test('lineage: structured remix_of yields descent + ingredient credit; prose/malformed stays inert', () => {
  const A = { run_repo: 'https://github.com/Org/run-a' }
  const B = { run_repo: 'https://github.com/Org/run-b', remix_of: ['Org/run-a'] }
  const C = { run_repo: 'https://github.com/Org/run-c', remix_of: ['https://github.com/Org/run-a', 'Org/run-b'] }
  const D = { run_repo: 'https://github.com/Org/run-d', remix_of: 'prose, not a list' }
  const lin = lineage([A, B, C, D])
  assert.deepEqual(lin(B).remix_of, ['org/run-a'])
  assert.deepEqual(lin(C).remix_of, ['org/run-a', 'org/run-b'], 'full URLs normalize to org/repo')
  assert.equal(lin(A).remixed_by, 2, 'run-a credited by both descendants')
  assert.equal(lin(B).remixed_by, 1)
  assert.deepEqual(lin(D).remix_of, [], 'non-array remix_of is ignored, never a crash')
  // emitted rows carry the fields; the viewer + remix pack surface them
  const d = sbData()
  for (const r of d.rows) {
    assert.ok(Array.isArray(r.remix_of), `${r.problem_id} row carries remix_of[]`)
    assert.equal(typeof r.remixed_by, 'number')
  }
  assert.match(readFileSync(v('app.js'), 'utf8'), /lineageTags/)
  assert.match(readFileSync(join(ROOT, 'bin', 'ingredients.mjs'), 'utf8'), /"remix_of"/, 'ingredients pack prints the exact field to copy')
})

test('problemCatalog picks up new references dynamically (filename-keyed and inline-keyed)', () => {
  const cat = problemCatalog(ROOT)
  const ids = cat.map(c => c.problem_id)
  for (const pid of ['ghz3', 'tfim3', 'bellnoisy2', 'h2vqe']) assert.ok(ids.includes(pid), `catalog includes ${pid}`)
  assert.ok(cat.some(c => c.source === 'kernel-judge'))
  assert.equal(new Set(ids).size, ids.length, 'no duplicate problem ids')
})
