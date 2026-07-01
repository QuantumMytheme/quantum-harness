import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// ---------------------------------------------------------------------------
// Replication Census — "replicated in-browser ×N".
//  Worker half: POST/GET /api/replications in viewer/_worker.js (mock env/KV,
//  Turnstile siteverify stubbed via a fetch patch — no network).
//  Browser half: viewer/census.js run in a vm sandbox with a stub DOM — inert
//  when the API says disabled, decorates scoreboard rows when enabled.
// ---------------------------------------------------------------------------

const v = p => fileURLToPath(new URL(`../viewer/${p}`, import.meta.url))
const worker = (await import(new URL('../viewer/_worker.js', import.meta.url))).default

const GOOD_SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null },
    async put(k, val) { store.set(k, val) },
  }
}
function envEnabled(kv = mockKV()) {
  return { ASSETS: { fetch: async () => new Response('asset') }, TURNSTILE_SECRET: 's3cret', TURNSTILE_SITEKEY: 'sitekey-1', SUBMIT_RATE: kv }
}
function post(body, ip = '1.2.3.4') {
  return new Request('https://quantummytheme.com/api/replications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })
}
const get = (qs = '') => new Request('https://quantummytheme.com/api/replications' + qs)

// Stub Turnstile siteverify: token 'human' passes, anything else fails.
const realFetch = globalThis.fetch
function patchTurnstile() {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('challenges.cloudflare.com/turnstile')) {
      const b = JSON.parse(init.body)
      return new Response(JSON.stringify({ success: b.response === 'human' }))
    }
    throw new Error('unexpected network call: ' + url)
  }
  return () => { globalThis.fetch = realFetch }
}

// ---------------- disabled / fail-closed --------------------------------------------

test('census GET degrades honestly to {enabled:false} when KV or Turnstile is unbound', async () => {
  for (const env of [
    { ASSETS: {} },                                                        // nothing
    { ASSETS: {}, TURNSTILE_SECRET: 's', TURNSTILE_SITEKEY: 'k' },         // no KV
    { ASSETS: {}, SUBMIT_RATE: mockKV() },                                 // no Turnstile
  ]) {
    const r = await worker.fetch(get('?hashes=' + GOOD_SHA), env)
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { enabled: false })
  }
})

test('census POST fails closed (503) with a how-to-provision message when unconfigured', async () => {
  const r = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'ghz3', turnstile_token: 'human' }), { ASSETS: {} })
  assert.equal(r.status, 503)
  const j = await r.json()
  assert.match(j.error, /not enabled/)
  assert.match(j.how, /TURNSTILE_SECRET/)
  assert.match(j.how, /SUBMIT_RATE/)
})

// ---------------- validation ---------------------------------------------------------

test('census POST rejects malformed sha256 and unknown problem_id (400) before Turnstile', async () => {
  const restore = patchTurnstile()
  try {
    const env = envEnabled()
    for (const sha of ['', 'xyz', 'A'.repeat(63), GOOD_SHA + 'a']) {
      const r = await worker.fetch(post({ sha256: sha, problem_id: 'ghz3', turnstile_token: 'human' }), env)
      assert.equal(r.status, 400)
      assert.match((await r.json()).error, /sha256/)
    }
    const r2 = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'not-a-problem', turnstile_token: 'human' }), env)
    assert.equal(r2.status, 400)
    assert.match((await r2.json()).error, /problem_id/)
  } finally { restore() }
})

test('census POST requires a passing Turnstile token (403 otherwise)', async () => {
  const restore = patchTurnstile()
  try {
    const r = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'ghz3', turnstile_token: 'bot' }), envEnabled())
    assert.equal(r.status, 403)
    assert.match((await r.json()).error, /bot-protection/)
  } finally { restore() }
})

// ---------------- counting + caps -----------------------------------------------------

test('census POST increments a per-sha counter storing count + last date ONLY', async () => {
  const restore = patchTurnstile()
  try {
    const kv = mockKV()
    const env = envEnabled(kv)
    const day = new Date().toISOString().slice(0, 10)
    const r1 = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'ghz3', turnstile_token: 'human' }), env)
    assert.equal(r1.status, 200)
    assert.deepEqual(await r1.json(), { ok: true, sha256: GOOD_SHA, n: 1, last: day })
    const r2 = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'ghz3', turnstile_token: 'human' }), env, )
    assert.equal((await r2.json()).n, 2)
    // stored record is exactly {n, last} — no IP, no problem_id, no PII on the hash key
    assert.deepEqual(JSON.parse(kv.store.get('repl:' + GOOD_SHA)), { n: 2, last: day })
    // the transient IP-cap key exists but is separate from the bundle record
    assert.equal(kv.store.get(`repl-day:1.2.3.4:${day}`), '2')
  } finally { restore() }
})

test('census POST enforces the per-IP daily cap (5) with a 429, and other IPs still count', async () => {
  const restore = patchTurnstile()
  try {
    const env = envEnabled()
    for (let i = 1; i <= 5; i++) {
      const r = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'tfim3', turnstile_token: 'human' }), env)
      assert.equal(r.status, 200, `record ${i} of 5 should pass`)
    }
    const capped = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'tfim3', turnstile_token: 'human' }), env)
    assert.equal(capped.status, 429)
    assert.match((await capped.json()).error, /limit/)
    const other = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'tfim3', turnstile_token: 'human' }, '9.9.9.9'), env)
    assert.equal(other.status, 200)
    assert.equal((await other.json()).n, 6)
  } finally { restore() }
})

test('census POST enforces the global daily cap with a 429', async () => {
  const restore = patchTurnstile()
  try {
    const day = new Date().toISOString().slice(0, 10)
    const env = envEnabled(mockKV({ [`repl-day:all:${day}`]: '500' }))
    const r = await worker.fetch(post({ sha256: GOOD_SHA, problem_id: 'h2vqe', turnstile_token: 'human' }), env)
    assert.equal(r.status, 429)
    assert.match((await r.json()).error, /full for today/)
  } finally { restore() }
})

// ---------------- batch GET -----------------------------------------------------------

test('census GET returns a batch {sha: {n,last}} map, skips unknown/malformed hashes, caches 5 min', async () => {
  const day = new Date().toISOString().slice(0, 10)
  const kv = mockKV({
    ['repl:' + GOOD_SHA]: JSON.stringify({ n: 3, last: day }),
    ['repl:' + 'c'.repeat(64)]: 'not-json{{',            // corrupt record → treated as uncounted
  })
  const r = await worker.fetch(get(`?hashes=${GOOD_SHA},${OTHER_SHA},${'c'.repeat(64)},zz,`), envEnabled(kv))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=300')
  const j = await r.json()
  assert.equal(j.enabled, true)
  assert.equal(j.sitekey, 'sitekey-1')
  assert.deepEqual(j.counts, { [GOOD_SHA]: { n: 3, last: day } })
})

test('census GET with no hashes doubles as the enabled-probe {enabled, sitekey, counts:{}}', async () => {
  const j = await (await worker.fetch(get(), envEnabled())).json()
  assert.deepEqual(j, { enabled: true, sitekey: 'sitekey-1', counts: {} })
})

test('census endpoint rejects other methods with 405', async () => {
  const r = await worker.fetch(new Request('https://quantummytheme.com/api/replications', { method: 'DELETE' }), envEnabled())
  assert.equal(r.status, 405)
})

// ---------------------------------------------------------------------------
// Browser half — viewer/census.js in a stub DOM.
// ---------------------------------------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}
    this.style = {}; this.textContent = ''; this.className = ''; this.id = ''
    this.parentNode = null; this.title = ''; this.type = ''; this.disabled = false
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null }
  setAttribute(k, val) { this.attrs[k] = String(val) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  addEventListener() {}
  querySelector(sel) {
    if (sel === 'td') return this.children.find(c => c.tagName === 'TD') || null
    if (sel === '.qm-census-chip') return findAll(this, e => e.className === 'qm-census-chip')[0] || null
    return null
  }
}
function findAll(root, pred, out = []) {
  for (const c of root.children) { if (pred(c)) out.push(c); findAll(c, pred, out) }
  return out
}

function makeDom({ rows = [] } = {}) {
  const head = new El('head'), body = new El('body')
  const listeners = {}
  const document = {
    readyState: 'complete', head, body,
    addEventListener(t, f) { (listeners[t] ||= []).push(f) },
    createElement: t => new El(t),
    getElementById(id) { return findAll(body, e => e.id === id)[0] || findAll(head, e => e.id === id)[0] || null },
    querySelectorAll(sel) { return sel === 'tr.sb-row[data-pid]' ? rows : [] },
    dispatch(t, detail) { for (const f of listeners[t] || []) f({ detail }) },
  }
  return { document, head, body, listeners }
}

function runCensus({ dom, fetchStub, runs = {} }) {
  const src = readFileSync(v('census.js'), 'utf8')
  const calls = []
  const sandbox = {
    document: dom.document,
    window: { QMRunner: { RUNS: runs } },
    fetch: (url, init) => { calls.push({ url: String(url), init }); return fetchStub(String(url), init) },
    crypto: globalThis.crypto,
    setTimeout: (f) => 0, // decoration retries + auto-dismiss are irrelevant in the stub
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console, Promise, JSON, Array, String, Object,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'census.js' })
  return { calls }
}

const tick = (ms = 40) => new Promise(r => globalThis.setTimeout(r, ms))

test('census.js is fully inert when the API says disabled — no chips, no affordance, no styles', async () => {
  const row = new El('tr'); row.setAttribute('data-pid', 'ghz3'); row.appendChild(new El('td'))
  const dom = makeDom({ rows: [row] })
  const { calls } = runCensus({
    dom,
    runs: { ghz3: { bundle: 'https://raw.example/bundle.json' } },
    fetchStub: async (url) => {
      if (url === '/api/replications') return new Response(JSON.stringify({ enabled: false }))
      throw new Error('should not fetch anything else when disabled: ' + url)
    },
  })
  await tick()
  dom.document.dispatch('qm:verify-accept', { problem_id: 'ghz3', sha256: GOOD_SHA })
  await tick()
  assert.equal(dom.document.getElementById('qm-census-toast'), null, 'no affordance when disabled')
  assert.equal(findAll(dom.body, e => e.className === 'qm-census-chip').length, 0, 'no chips when disabled')
  assert.equal(dom.head.children.length, 0, 'no style injected when disabled')
  assert.ok(calls.every(c => !c.init || c.init.method !== 'POST'), 'never POSTs when disabled')
})

test('census.js decorates scoreboard rows with a distinct "replicated in-browser ×N" chip when enabled', async () => {
  const row = new El('tr'); row.setAttribute('data-pid', 'ghz3'); row.appendChild(new El('td'))
  const dom = makeDom({ rows: [row] })
  const bundleBytes = new TextEncoder().encode('{"proof":"bundle"}')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bundleBytes)
  const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  runCensus({
    dom,
    runs: { ghz3: { bundle: 'https://raw.example/quantum-proof-poc.json' } },
    fetchStub: async (url) => {
      if (url === '/api/replications') return new Response(JSON.stringify({ enabled: true, sitekey: 'sk', counts: {} }))
      if (url === 'https://raw.example/quantum-proof-poc.json') return new Response(bundleBytes)
      if (url === `/api/replications?hashes=${sha}`) return new Response(JSON.stringify({ enabled: true, sitekey: 'sk', counts: { [sha]: { n: 4, last: '2026-07-01' } } }))
      throw new Error('unexpected fetch: ' + url)
    },
  })
  await tick(80)
  const chip = row.querySelector('.qm-census-chip')
  assert.ok(chip, 'chip appended to the row')
  assert.equal(chip.textContent, 'replicated in-browser ×4 · 2026-07-01')
  assert.match(chip.title, /judge verdict is the authority/, 'honesty hover text')
  assert.match(chip.title, /distinct from "reproduced ×N \(attested\)"/, 'never conflated with the attested badge')
})

test('census.js shows the record affordance (not a Turnstile widget yet) only on a genuine verify-accept when enabled', async () => {
  const dom = makeDom()
  runCensus({
    dom,
    fetchStub: async (url) => {
      if (url === '/api/replications') return new Response(JSON.stringify({ enabled: true, sitekey: 'sk', counts: {} }))
      throw new Error('unexpected fetch: ' + url)
    },
  })
  await tick()
  dom.document.dispatch('qm:verify-accept', { problem_id: 'ghz3', sha256: 'NOT-A-SHA' })
  await tick()
  assert.equal(dom.document.getElementById('qm-census-toast'), null, 'malformed detail is ignored')
  dom.document.dispatch('qm:verify-accept', { problem_id: 'ghz3', sha256: GOOD_SHA })
  await tick()
  const toast = dom.document.getElementById('qm-census-toast')
  assert.ok(toast, 'affordance appears after a genuine verify-accept')
  const texts = findAll(toast, () => true).map(e => e.textContent).join(' ')
  assert.match(texts, /Record your replication\?/)
  assert.match(texts, /not verification; the judge verdict is the authority/)
  assert.equal(dom.document.getElementById('qm-ts-script'), null, 'Turnstile is NOT loaded until the visitor opts in')
})

// ---------------- wiring hygiene ------------------------------------------------------

test('census.js is wired into both viewer pages and the worker routes /api/replications', () => {
  assert.match(readFileSync(v('index.html'), 'utf8'), /<script src="census\.js"><\/script>/)
  assert.match(readFileSync(v('lab.html'), 'utf8'), /<script src="census\.js"><\/script>/)
  const w = readFileSync(v('_worker.js'), 'utf8')
  assert.match(w, /\/api\/replications/)
  assert.match(w, /repl-day:/)
})
