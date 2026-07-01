// MCP connector — protocol surface + the six tools. verify_bundle shells out to the real
// numpy judge; those assertions skip cleanly when python3/numpy isn't on the box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { TOOLS, callTool, handleMessage } from '../mcp/server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// the unified door (bench/judge.py) lists BOTH judges' problems, so list_problems
// mirrors the union of the quantum-judge and kernel-judge reference directories.
const readRefs = d => readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
const refIds = [...new Set([...readRefs('bench/quantum-judge/references'), ...readRefs('bench/kernel-judge/references')])].sort()
const parse = r => JSON.parse(r.content[0].text)

test('exposes exactly the seven harness tools, each with an input schema', () => {
  assert.deepEqual(TOOLS.map(t => t.name).sort(),
    ['commit_run', 'get_brief', 'get_kickoff', 'list_problems', 'mint_recipe', 'mint_run', 'verify_bundle'])
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string')
    assert.equal(t.inputSchema.type, 'object')
  }
})

test('JSON-RPC: initialize handshake, notifications, tools/list, unknown method', async () => {
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  assert.equal(init.result.serverInfo.name, 'quantum-harness')
  assert.ok(init.result.capabilities.tools)
  assert.equal(init.result.protocolVersion, '2024-11-05') // echoes the client's version

  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)

  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(list.result.tools.length, 7)

  const bad = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'no/such' })
  assert.equal(bad.error.code, -32601)
})

test('list_problems mirrors the committed reference directory', async () => {
  const out = parse(await callTool('list_problems', {}))
  assert.equal(out.count, refIds.length)
  assert.deepEqual(out.problems.map(p => p.problem_id).sort(), refIds)
  for (const p of out.problems) assert.ok(p.task && p.label)
})

test('get_brief returns the conceptual spec and never leaks the hidden target', async () => {
  const out = (await callTool('get_brief', { problem_id: 'ghz3' })).content[0].text
  assert.match(out, /BRIEF — ghz3/)
  assert.match(out, /conceptually|conceptual/i)
  assert.doesNotMatch(out, /target_statevector/) // the held-out reference must not appear
  const unknown = parse(await callTool('get_brief', { problem_id: 'nope' }))
  assert.match(unknown.error, /unknown problem_id/)
})

test('mint_run refuses without a token instead of failing silently', async () => {
  const saved = process.env.GITHUB_TOKEN, savedGh = process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN; delete process.env.GH_TOKEN
  try {
    const out = await callTool('mint_run', { name: 'run-x' })
    assert.equal(out.isError, true)
    assert.match(parse(out).error, /no GitHub token/)
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved
    if (savedGh !== undefined) process.env.GH_TOKEN = savedGh
  }
})

test('commit_run refuses without a token instead of failing silently', async () => {
  const saved = process.env.GITHUB_TOKEN, savedGh = process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN; delete process.env.GH_TOKEN
  try {
    const out = await callTool('commit_run', { repo: 'owner/name', bundle_path: 'bench/quantum-judge/quantum-proof-h2.json' })
    assert.equal(out.isError, true)
    assert.match(parse(out).error, /no GitHub token/)
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved
    if (savedGh !== undefined) process.env.GH_TOKEN = savedGh
  }
})

test('mint_recipe refuses without a token, and validates the full-stack recipe first', async () => {
  const saved = process.env.GITHUB_TOKEN, savedGh = process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN; delete process.env.GH_TOKEN
  try {
    const noTok = await callTool('mint_recipe', { name: 'run-fs', recipe: { hardware: { chips: [{ id: 'tpu-8t', pinned: true }] }, target: 'tfim3' } })
    assert.equal(noTok.isError, true)
    assert.match(parse(noTok).error, /no GitHub token/)
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved
    if (savedGh !== undefined) process.env.GH_TOKEN = savedGh
  }
  // with a token present, an INVALID recipe (no hardware half) is rejected BEFORE any network call
  const s2 = process.env.GITHUB_TOKEN
  process.env.GITHUB_TOKEN = 'dummy-token-validation-only'
  try {
    const bad = parse(await callTool('mint_recipe', { name: 'run-fs', recipe: { target: 'tfim3' } }))
    assert.match(bad.error, /invalid RECIPE.json/)
    assert.ok(bad.problems.some(p => /hardware\.chips/.test(p)), 'flags the missing hardware half')
  } finally {
    if (s2 !== undefined) process.env.GITHUB_TOKEN = s2; else delete process.env.GITHUB_TOKEN
  }
})

test('commit_run runs the judge first and refuses a REJECT (before any network call)', async t => {
  const saved = process.env.GITHUB_TOKEN, savedGh = process.env.GH_TOKEN
  process.env.GITHUB_TOKEN = 'dummy-unused-when-the-judge-rejects-offline'
  delete process.env.GH_TOKEN
  try {
    const out = parse(await callTool('commit_run', { repo: 'owner/name', bundle_path: 'bench/quantum-judge/quantum-proof-FORGED.json' }))
    if (/judge|python3|numpy/i.test(out.reason || out.error || '')) { t.skip('python3 + numpy not available'); return }
    assert.match(out.error, /refusing to commit a REJECT/)
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved; else delete process.env.GITHUB_TOKEN
    if (savedGh !== undefined) process.env.GH_TOKEN = savedGh
  }
})

test('verify_bundle re-derives ACCEPT and REJECT through the real judge', async t => {
  const ok = parse(await callTool('verify_bundle', { bundle_path: 'bench/quantum-judge/quantum-proof-h2.json' }))
  if (ok.error && /python3|numpy/.test(ok.reason || '')) { t.skip('python3 + numpy not available'); return }
  assert.equal(ok.verdict, 'ACCEPT')
  assert.equal(ok.exit_code, 0)
  assert.equal(ok.failed_gate, null)

  const bad = parse(await callTool('verify_bundle', { bundle_path: 'bench/quantum-judge/quantum-proof-FORGED.json' }))
  assert.equal(bad.verdict, 'REJECT')
  assert.equal(bad.exit_code, 4)            // reproducibility gate
  assert.equal(bad.failed_gate, 'reproducibility')
})

test('Desktop Extension manifest is valid and matches the served tools', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'mcp/manifest.json'), 'utf8'))
  assert.equal(m.name, 'quantum-harness')
  assert.equal(m.server.mcp_config.command, 'node')
  assert.deepEqual(m.tools.map(t => t.name).sort(), TOOLS.map(t => t.name).sort())
  assert.ok(existsSync(path.join(ROOT, 'CLAUDE-DESKTOP.md')))
})
