import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Panel-judged board analysis layers:
//   1. Paradigm League — (paradigm family × task) rollup with the n<3
//      "anecdote, not evidence" honesty gate.
//   2. Frontier Log + Ledger — append-only typed events (diffed against the
//      committed frontier-history.json) + Atom feed; byte-stable no-event
//      rebuilds (dates come from verified_at, never the build clock).
// Pure file/function/spawn checks — no network.
// ---------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const v = p => join(ROOT, 'viewer', p)
const { buildParadigms, frontierSnapshot, genesisEvents, diffFrontier, atomFeed, buildAll } =
  await import(new URL('../scoreboard/build.mjs', import.meta.url))

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

/* --------------------- 2 · frontier log + ledger -------------------------- */
const vqe = (pid, para, value, twoq, repo) => ({
  problem_id: pid, task: 'vqe', paradigm_short: para, model: 'm', verified_at: '2026-06-20',
  run_repo: repo || `https://github.com/x/${pid}-${para}`, proof_bundle: 'b.json',
  verified_metric: { value, gap_budget: 0.05 },
  resource_costs: { two_qubit_gates: twoq, depth: 2, n_qubits: 2 },
})

test('genesisEvents backfills the current state: NEW_PROBLEM per board, NEW_LEADER only for contested boards, all genesis-flagged', () => {
  const byProblem = {
    p1: [vqe('p1', 'qaoa', 0.001, 4), vqe('p1', 'hwe', 0.01, 2)],
    p2: [vqe('p2', 'ring', 0.02, 2)],
  }
  const ev = genesisEvents(frontierSnapshot(byProblem), byProblem)
  assert.deepEqual(ev.map(e => e.type), ['NEW_PROBLEM', 'NEW_LEADER', 'NEW_PROBLEM'])
  for (const e of ev) {
    assert.equal(e.genesis, true, 'genesis events are labeled — the true order predates the ledger')
    assert.equal(e.date, '2026-06-20', 'event dates come from verified_at')
    assert.ok(!('observed' in e), 'no observed stamp unless the operator passes --now')
  }
  assert.match(ev[1].detail, /qaoa holds rank 1 of 2/)
})

test('diffFrontier: a synthetic rank flip fires exactly one NEW_LEADER with judge-emitted numbers', () => {
  const before = { p1: [vqe('p1', 'hwe', 0.01, 2)] }
  const after = { p1: [vqe('p1', 'hwe', 0.01, 2), vqe('p1', 'qaoa', 0.001, 2)] }
  const ev = diffFrontier(frontierSnapshot(before), frontierSnapshot(after), after)
  assert.deepEqual(ev.map(e => e.type), ['NEW_LEADER'], 'the dethroning point never double-fires PARETO_EXPANSION')
  assert.equal(ev[0].problem_id, 'p1')
  assert.match(ev[0].detail, /qaoa took rank 1 from hwe — metric 0\.01 → 0\.001/)
  assert.equal(ev[0].date, '2026-06-20')
})

test('diffFrontier: a no-change rebuild emits nothing', () => {
  const byProblem = { p1: [vqe('p1', 'qaoa', 0.001, 4), vqe('p1', 'hwe', 0.01, 2)] }
  assert.deepEqual(diffFrontier(frontierSnapshot(byProblem), frontierSnapshot(byProblem), byProblem), [])
})

test('diffFrontier: PARETO_EXPANSION fires for a new non-dominated non-leader point', () => {
  const before = { p1: [vqe('p1', 'qaoa', 0.001, 4)] }
  const after = { p1: [vqe('p1', 'qaoa', 0.001, 4), vqe('p1', 'hwe', 0.01, 2)] } // worse metric, cheaper → non-dominated
  const ev = diffFrontier(frontierSnapshot(before), frontierSnapshot(after), after)
  assert.deepEqual(ev.map(e => e.type), ['PARETO_EXPANSION'])
  assert.match(ev[0].detail, /hwe/)
})

test('diffFrontier: GAP_NARROWED fires when the runner-up closes in without a dethrone; never on no-change', () => {
  const before = { p1: [vqe('p1', 'lead', 0.001, 2), vqe('p1', 'hwe', 0.01, 1)] }
  // new dominated entry (worse metric, more gates) that still becomes the closer runner-up
  const after = { p1: [...before.p1, vqe('p1', 'qaoa', 0.005, 3)] }
  const ev = diffFrontier(frontierSnapshot(before), frontierSnapshot(after), after)
  assert.deepEqual(ev.map(e => e.type), ['GAP_NARROWED'])
  assert.match(ev[0].detail, /0\.009 → 0\.004/)
  // a farther entry of a known paradigm narrows nothing and fires nothing
  const far = { p1: [...before.p1, vqe('p1', 'hwe', 0.02, 3)] }
  assert.deepEqual(diffFrontier(frontierSnapshot(before), frontierSnapshot(far), far), [])
})

test('diffFrontier: NEW_PARADIGM fires on an existing board, and is suppressed when it only rides in on a NEW_PROBLEM', () => {
  const before = { p1: [vqe('p1', 'qaoa', 0.001, 2)] }
  // dominated newcomer (worse metric, more gates) → no PARETO event, only the paradigm is new
  const after = { p1: [vqe('p1', 'qaoa', 0.001, 2), vqe('p1', 'brickwork', 0.01, 4)] }
  const ev = diffFrontier(frontierSnapshot(before), frontierSnapshot(after), after)
  assert.deepEqual(ev.map(e => e.type), ['NEW_PARADIGM'])
  assert.match(ev[0].detail, /brickwork/)
  // a paradigm arriving only with a brand-new board is already named by NEW_PROBLEM
  const fresh = { p2: [vqe('p2', 'heavy-hex', 0.01, 2)] }
  const ev2 = diffFrontier(frontierSnapshot(before), frontierSnapshot({ ...before, ...fresh }), { ...before, ...fresh })
  assert.deepEqual(ev2.map(e => e.type), ['NEW_PROBLEM'])
})

test('--now stamps observed ONLY on genuinely-appended events (and is omitted by default)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qh-ledger-'))
  try {
    for (const dir of ['scoreboard', 'bench/quantum-judge', 'bench/kernel-judge/references'])
      cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true })
    mkdirSync(join(tmp, 'viewer'), { recursive: true })
    rmSync(join(tmp, 'scoreboard', 'frontier-history.json'), { force: true })   // force genesis
    const a = buildAll(tmp, { now: '2026-07-01' })
    assert.ok(a.pendingEvents.length >= 7, 'genesis appends events')
    for (const e of a.pendingEvents) {
      assert.equal(e.observed, '2026-07-01')
      assert.notEqual(e.date, '2026-07-01', 'date stays the entry verified_at — observed never overwrites it')
    }
    const b = buildAll(tmp)   // no --now
    for (const e of b.pendingEvents) assert.ok(!('observed' in e))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a no-event rebuild is byte-stable: build twice, all three generated files identical; --check exits 0', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qh-stable-'))
  try {
    for (const dir of ['scoreboard', 'bench/quantum-judge', 'bench/kernel-judge/references'])
      cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true })
    mkdirSync(join(tmp, 'viewer'), { recursive: true })
    const build = () => spawnSync(process.execPath, [join(tmp, 'scoreboard', 'build.mjs')], { encoding: 'utf8' })
    const snap = () => ['viewer/scoreboard-data.js', 'scoreboard/frontier-history.json', 'viewer/feed.xml']
      .map(f => readFileSync(join(tmp, f), 'utf8'))
    const r1 = build(); assert.equal(r1.status, 0, r1.stderr)
    const s1 = snap()
    const r2 = build(); assert.equal(r2.status, 0, r2.stderr)
    assert.match(r2.stdout, /no new events/)
    const s2 = snap()
    // scoreboard-data may differ only in the generated date; history + feed must be byte-identical
    const strip = s => s.replace(/"generated":\s*"[^"]*",?\n?/, '')
    assert.equal(strip(s2[0]), strip(s1[0]), 'scoreboard-data.js is stable (modulo the generated date)')
    assert.equal(s2[1], s1[1], 'frontier-history.json is byte-identical — no clock reads')
    assert.equal(s2[2], s1[2], 'feed.xml is byte-identical — no clock reads')
    const c = spawnSync(process.execPath, [join(tmp, 'scoreboard', 'build.mjs'), '--check'], { encoding: 'utf8' })
    assert.equal(c.status, 0, `--check is green after a rebuild\n${c.stderr}`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('the COMMITTED board, history and feed are fresh (build.mjs --check green in-repo)', () => {
  const c = spawnSync(process.execPath, [join(ROOT, 'scoreboard', 'build.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(c.status, 0, c.stderr)
})

// minimal well-formedness checker (no XML parser in node's stdlib): balanced
// tags, quoted attributes, no unescaped < or & in text nodes.
function assertWellFormedXml(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n/)
  const body = xml.replace(/^<\?xml[^>]*\?>/, '')
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g
  const stack = []
  let m, last = 0
  while ((m = tagRe.exec(body))) {
    const text = body.slice(last, m.index)
    assert.doesNotMatch(text, /</, 'no stray < in text')
    assert.doesNotMatch(text, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/, 'no unescaped & in text')
    last = tagRe.lastIndex
    if (m[4] === '/') continue
    if (m[1] === '/') assert.equal(stack.pop(), m[2], `</${m[2]}> matches its opener`)
    else stack.push(m[2])
  }
  assert.doesNotMatch(body.slice(last), /[<&]/)
  assert.deepEqual(stack, [], 'all tags closed')
}

test('feed.xml is a valid Atom feed: well-formed, absolute quantummytheme.com URLs, unique ids, ≤50 entries', () => {
  const xml = readFileSync(v('feed.xml'), 'utf8')
  assertWellFormedXml(xml)
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/)
  for (const el of ['<title>', '<id>', '<updated>', 'rel="self"']) assert.ok(xml.includes(el), `feed carries ${el}`)
  const entries = xml.split('<entry>').slice(1)
  assert.ok(entries.length >= 1 && entries.length <= 50)
  const ids = entries.map(e => (e.match(/<id>([^<]+)<\/id>/) || [])[1])
  for (const id of ids) assert.match(id, /^https:\/\/quantummytheme\.com\//, 'entry ids are absolute site URLs')
  assert.equal(new Set(ids).size, ids.length, 'entry ids are unique')
  for (const e of entries) for (const el of ['<title>', '<updated>', '<link ']) assert.ok(e.includes(el), `every entry carries ${el}`)
  for (const href of [...xml.matchAll(/href="([^"]+)"/g)].map(x => x[1]))
    assert.match(href, /^https:\/\/quantummytheme\.com\//, 'all links are absolute site URLs')
  // dates come from verified_at (or --now observed) — the build clock is never used
  assert.doesNotMatch(readFileSync(join(ROOT, 'scoreboard', 'build.mjs'), 'utf8'),
    /Date\.now|new Date\(\)[^\n]*(atomFeed|event)/i, 'no clock reads in the ledger path')
})

test('atomFeed truncates to the last 50 events, newest first', () => {
  const events = Array.from({ length: 60 }, (_, i) => ({
    seq: i + 1, type: 'NEW_PROBLEM', problem_id: `p${i + 1}`, date: '2026-06-20',
    detail: `board opened <${i + 1}> & counting`, run_repo: 'https://github.com/x/y', proof_bundle: 'b.json',
  }))
  const xml = atomFeed({ events })
  assertWellFormedXml(xml)
  const got = [...xml.matchAll(/<id>https:\/\/quantummytheme\.com\/feed\.xml#e(\d+)<\/id>/g)].map(x => +x[1])
  assert.equal(got.length, 50)
  assert.equal(got[0], 60, 'newest first')
  assert.equal(got[49], 11, 'oldest retained is seq 11')
})

test('ledger + changelog viewer wiring: committed history is append-only-labeled, payload carries last events newest-first, UI + feed link present', () => {
  const hist = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'frontier-history.json'), 'utf8'))
  assert.equal(hist.schema, 'quantummytheme/frontier-history@1')
  assert.match(hist.note, /Append-only/i)
  assert.ok(Array.isArray(hist.events) && hist.events.length >= 7)
  hist.events.forEach((e, i) => {
    assert.equal(e.seq, i + 1, 'seq is dense and append-ordered')
    assert.ok(['NEW_LEADER', 'PARETO_EXPANSION', 'NEW_PARADIGM', 'NEW_PROBLEM', 'GAP_NARROWED'].includes(e.type))
  })
  const d = sbData()
  assert.ok(Array.isArray(d.changelog) && d.changelog.length >= 1 && d.changelog.length <= 10)
  for (let i = 1; i < d.changelog.length; i++) assert.ok(d.changelog[i - 1].seq > d.changelog[i].seq, 'newest first')
  const html = readFileSync(v('index.html'), 'utf8')
  assert.match(html, /id="sb-changelog"/)
  assert.match(html, /<link rel="alternate" type="application\/atom\+xml"[^>]*href="https:\/\/quantummytheme\.com\/feed\.xml"/)
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /renderChangelog/)
  assert.match(app, /never[^<]*build clock|never by the build clock/i, 'the date-honesty rule is stated in the UI')
  assert.ok(readFileSync(v('style.css'), 'utf8').includes('.chlog'))
})

/* ------------------------- 3 · cite-this-run ------------------------------ */
test('bundle_sha256 pins are raw-file-byte hashes of the committed bundles; external bundles are honestly null', async () => {
  const { createHash } = await import('node:crypto')
  const d = sbData()
  for (const r of d.rows) {
    if (r.bundle_sha256 === null) {
      // external run-repo bundle: not committed here, so no honest offline hash —
      // the re-verify command fetches from the run repo instead
      assert.match(r.reverify, /^curl -sL https:\/\/raw\.githubusercontent\.com\/.+ -o bundle\.json && python3 bench\/quantum-judge\/judge_verify\.py bundle\.json$/)
      continue
    }
    assert.match(r.bundle_sha256, /^[0-9a-f]{64}$/, 'lowercase hex sha256')
    const path = r.bundleUrl.replace(/^https:\/\/github\.com\/QuantumMytheme\/quantum-harness\/blob\/main\//, '')
    const want = createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')
    assert.equal(r.bundle_sha256, want, `${r.problem_id} hash matches sha256sum of the committed file bytes (never re-serialized JSON)`)
    assert.equal(r.reverify, `python3 bench/quantum-judge/judge_verify.py ${path}`)
  }
  // both kinds exist in today's corpus, so both paths are exercised
  assert.ok(d.rows.some(r => r.bundle_sha256), 'seed bundles are hash-pinned')
  assert.ok(d.rows.some(r => r.bundle_sha256 === null), 'external bundles stay null')
  for (const r of d.rows) assert.ok(r.verified_at === null || /^\d{4}-\d{2}-\d{2}$/.test(r.verified_at))
})

test('cite viewer wiring: per-row cite button, BibTeX + CSL-JSON exports, honest hash-unavailable fallback, CSP-clean', () => {
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /citebtn/)
  assert.match(app, /@misc\{/, 'BibTeX export')
  assert.match(app, /CSL-JSON/, 'CSL-JSON export')
  assert.match(app, /citeStrings/)
  assert.match(app, /hash unavailable — re-verify from the run repo/, 'no fake hashes: the fallback language is exact')
  assert.match(app, /not peer review/, 'the honest verification framing is baked into every export')
  assert.match(app, /r\.reverify/, 'the exact re-verify command rides in the citation')
  assert.doesNotMatch(app, /on(click|mouseover|load)\s*=/i, 'no inline handlers — CSP-clean')
  const css = readFileSync(v('style.css'), 'utf8')
  for (const cls of ['.citebtn', '.citeblock', '.citecopy']) assert.ok(css.includes(cls), `style.css styles ${cls}`)
})

/* ---------------------- 4 · reproduced ×N attestations -------------------- */
test('the seeded attestation counts: ghz3 shows reproduced ×1 by the maintainer handle; badge never touches rank', () => {
  const d = sbData()
  const ghz3 = d.rows.find(r => r.problem_id === 'ghz3')
  assert.equal(ghz3.reproduced, 1)
  assert.deepEqual(ghz3.reproduced_by, ['quantum-harness-ci'])
  assert.equal(ghz3.rank, 1, 'attestations are credibility display — rank still comes from the verified metric')
  for (const r of d.rows) {
    assert.equal(typeof r.reproduced, 'number')
    assert.ok(Array.isArray(r.reproduced_by))
    if (!r.bundle_sha256) assert.equal(r.reproduced, 0, 'no honest hash → nothing to bind an attestation to')
  }
  // the committed attestation is honest about being the maintainer's own re-run
  const att = JSON.parse(readFileSync(join(ROOT, 'scoreboard', 'attestations', 'ghz3-2c38fa2b-quantum-harness-ci.json'), 'utf8'))
  assert.match(att.note, /maintainer/i)
  assert.equal(att.judge_exit, 0)
})

test('an attestation whose hash matches no committed bundle is skipped + logged; duplicates by the same handle never inflate ×N', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qh-attest-'))
  try {
    for (const dir of ['scoreboard', 'bench/quantum-judge', 'bench/kernel-judge/references'])
      cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true })
    mkdirSync(join(tmp, 'viewer'), { recursive: true })
    const adir = join(tmp, 'scoreboard', 'attestations')
    const mk = (name, obj) => writeFileSync(join(adir, name), JSON.stringify(obj) + '\n')
    mk('zz-unknown-hash.json', { schema: 'quantummytheme/attestation@1', bundle_sha256: 'f'.repeat(64), problem_id: 'ghz3', handle: 'stranger', judge_exit: 0, date: '2026-07-01' })
    mk('zz-malformed.json', { problem_id: 'ghz3' })
    const real = JSON.parse(readFileSync(join(adir, 'ghz3-2c38fa2b-quantum-harness-ci.json'), 'utf8'))
    mk('zz-duplicate-handle.json', real)                       // same hash + same handle
    mk('zz-second-handle.json', { ...real, handle: 'independent-verifier' })
    const b = spawnSync(process.execPath, [join(tmp, 'scoreboard', 'build.mjs')], { encoding: 'utf8' })
    assert.equal(b.status, 0, b.stderr)
    assert.match(b.stderr, /skipped attestation zz-unknown-hash\.json: bundle sha256 ffffffffffff… matches no committed bundle/)
    assert.match(b.stderr, /skipped malformed attestation zz-malformed\.json/)
    const built = JSON.parse(readFileSync(join(tmp, 'viewer', 'scoreboard-data.js'), 'utf8').replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''))
    const ghz3 = built.rows.find(r => r.problem_id === 'ghz3')
    assert.equal(ghz3.reproduced, 2, 'distinct handles count; a duplicate by the same handle does not')
    assert.deepEqual(ghz3.reproduced_by, ['independent-verifier', 'quantum-harness-ci'])
    assert.ok(!built.rows.some(r => r.reproduced_by.includes('stranger')), 'the unknown-hash attestation never lands')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('reproduced viewer wiring: badge renderer, honest attested-not-rank language, style', () => {
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /reproduced ×/, 'badge text')
  assert.match(app, /never changes rank/i, 'the HARDWARE.md attested-but-labeled rule is stated')
  assert.match(app, /re-run it yourself/i, 'the badge still points at self-verification')
  assert.ok(readFileSync(v('style.css'), 'utf8').includes('.repro'))
  // the CLI flow is documented where contributors look
  const sb = readFileSync(join(ROOT, 'SCOREBOARD.md'), 'utf8')
  assert.match(sb, /--attest/)
  assert.match(sb, /attestations\//)
  assert.match(sb, /PR-only|PR only/i)
})

/* ------------------- 5 · hardware overlays: all reports ------------------- */
test('hardwareViews emits ALL reports (never truncated to [0]) with per-report sim-vs-hw deltas', async () => {
  const { hardwareViews } = await import(new URL('../scoreboard/build.mjs', import.meta.url))
  const e = {
    task: 'vqe',
    verified_metric: { name: 'energy_gap_to_E0', value: 0.01, energy: -3.0 },
    hardware_reports: [
      { backend: 'ibm_torino', metric: 'energy', value: -2.9, report_url: 'https://x/1', shots: 4096 },
      { backend: 'local-noisy (emulated)', metric: 'energy', value: -2.8, report_url: 'https://x/2' },
      { backend: 'ionq_aria', metric: 'weird_metric', value: 0.5, report_url: 'https://x/3' },
    ],
  }
  const v3 = hardwareViews(e)
  assert.equal(v3.length, 3, 'every report is emitted')
  assert.equal(v3[0].label, 'hw')
  assert.equal(v3[0].sim_value, -3.0)
  assert.ok(Math.abs(v3[0].delta - 0.1) < 1e-9, 'delta = measured − sim')
  assert.ok(Math.abs(v3[0].delta_pct - 3.33) < 0.01)
  assert.equal(v3[0].shots, 4096)
  assert.equal(v3[1].label, 'noisy-sim', 'emulated is never presented as hardware')
  assert.equal(v3[1].emulated, true)
  assert.ok(Math.abs(v3[1].delta - 0.2) < 1e-9)
  assert.equal(v3[2].delta, null, 'no comparable sim-side number → delta stays null, never faked')
  assert.equal(v3[2].delta_pct, null)
  assert.deepEqual(hardwareViews({ task: 'vqe', verified_metric: {} }), [], 'no reports → empty list')
})

test('the emitted tfim3 noisy-sim overlay carries the computed sim-vs-hw delta; rows keep back-compat hardware[0]', () => {
  const d = sbData()
  const hwe = d.rows.find(r => r.problem_id === 'tfim3' && r.paradigm_short === 'hardware-efficient')
  assert.ok(Array.isArray(hwe.hardware_reports))
  assert.equal(hwe.hardware_reports.length, 1)
  const hw = hwe.hardware_reports[0]
  assert.equal(hw.label, 'noisy-sim')
  assert.equal(hw.sim_value, -2.9947640963492943, 'delta is vs the SIM energy, not E0')
  assert.ok(Math.abs(hw.delta - 0.0913461) < 1e-6)
  assert.ok(Math.abs(hw.delta_pct - 3.05) < 0.01)
  assert.deepEqual(hwe.hardware, hw, 'hardware stays as the first report for back-compat')
  for (const r of d.rows) assert.ok(Array.isArray(r.hardware_reports), `${r.problem_id} row carries hardware_reports[]`)
})

test('viewer lists every hardware report per row with the delta visible inline (not tooltip-only)', () => {
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /hardware_reports/, 'the loop reads the full array')
  assert.match(app, /for \(const hw of reports\)/, 'reports are iterated, never truncated to [0]')
  assert.match(app, /Δ \$\{hw\.delta_pct/, 'the sim-vs-hw delta is rendered in visible link text')
})
