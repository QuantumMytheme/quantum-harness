import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseWorkflowScriptMeta,
  parseJournal,
  parseMainTranscript,
  sessionRoster,
} from '../lib/planner-roster.mjs'

// ---------------------------------------------------------------------------
// Fixtures: test/fixtures/roster/ holds REAL journal.jsonl + meta.json files
// copied from a live session's subagents tree (verified secret-free by eye).
// agent-*.jsonl files there are EMPTY placeholders — presence-only stand-ins,
// real transcripts are never copied into the repo. transcript.jsonl is
// synthetic but shape-accurate (modeled line-by-line on the real session).
// ---------------------------------------------------------------------------
const fix = p => fileURLToPath(new URL(`./fixtures/roster/${p}`, import.meta.url))
const TRANSCRIPT = fix('transcript.jsonl')
const SUBAGENTS = fix('subagents')

// ---------------------------------------------------------------------------
// parseWorkflowScriptMeta
// ---------------------------------------------------------------------------
test('parseWorkflowScriptMeta extracts name, description, and phase titles', () => {
  const m = parseWorkflowScriptMeta(`export const meta = {
  name: 'demo-planner-build',
  description: 'Build the HTML session planner/tracker: roster, walkthrough',
  phases: [
    { title: 'Build', detail: '3 parallel TDD module builders' },
    { title: 'Integrate', detail: 'HTML renderer + CLI' },
  ],
}
phase('Build')`)
  assert.equal(m.name, 'demo-planner-build')
  assert.equal(m.description, 'Build the HTML session planner/tracker: roster, walkthrough')
  assert.deepEqual(m.phases, ['Build', 'Integrate'])
})

test('parseWorkflowScriptMeta tolerates double quotes, no phases, missing meta', () => {
  const m = parseWorkflowScriptMeta('export const meta = { name: "x-y", description: "a, b: c" }\n')
  assert.equal(m.name, 'x-y')
  assert.equal(m.description, 'a, b: c')
  assert.deepEqual(m.phases, [])
  assert.deepEqual(parseWorkflowScriptMeta('const x = 1'), { name: null, description: null, phases: [] })
  assert.deepEqual(parseWorkflowScriptMeta(''), { name: null, description: null, phases: [] })
})

test('parseWorkflowScriptMeta does not bleed into the script body past the meta object', () => {
  // body text below meta contains decoy name:/title: strings
  const m = parseWorkflowScriptMeta(`export const meta = {
  name: 'real-name',
  phases: [{ title: 'Only', detail: 'detail with ] bracket and { brace' }],
}
const PROMPT = "ignore this name: 'decoy' and title: 'decoy-phase'"`)
  assert.equal(m.name, 'real-name')
  assert.deepEqual(m.phases, ['Only'])
})

// ---------------------------------------------------------------------------
// parseJournal
// ---------------------------------------------------------------------------
test('parseJournal reads started and result lines, skipping garbage', () => {
  const j = parseJournal(
    [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
      'not json at all',
      '',
      '{"type":"result","key":"v2:k1","agentId":"a1","result":{"done":true}}',
      '{"type":"result","key":"v2:k2","value":{"done":true}}', // spec'd `value` variant, no agentId
    ].join('\n')
  )
  assert.deepEqual(j.started, [{ key: 'v2:k1', agentId: 'a1' }])
  assert.equal(j.results.length, 2)
  assert.deepEqual(j.results[0], { key: 'v2:k1', agentId: 'a1' })
  assert.deepEqual(j.results[1], { key: 'v2:k2', agentId: null })
})

// ---------------------------------------------------------------------------
// parseMainTranscript
// ---------------------------------------------------------------------------
test('parseMainTranscript finds workflows, agents, and runId bindings (deduped on replay)', () => {
  const tx = parseMainTranscript(readFileSync(TRANSCRIPT, 'utf8'))
  // 4 Workflow tool_use blocks; the replayed W1 entry must not double-count
  assert.equal(tx.workflows.length, 4)
  const w1 = tx.workflows.find(w => w.name === 'circuit-quick-wins')
  assert.ok(w1)
  assert.deepEqual(w1.phases, ['Wins'])
  // bindings: toolUseResult.runId for W1+W2, tool_result text fallback for W3
  assert.equal(tx.bindings['wf_6b2f5410-80a'], w1.toolUseId)
  assert.equal(tx.bindings['wf_f4ff58fc-95b'], 'toolu_W2')
  assert.equal(tx.bindings['wf_dc4a0323-a65'], 'toolu_W3')
  // W4 never launched -> no binding
  assert.equal(Object.values(tx.bindings).includes('toolu_W4'), false)
  // direct Agent spawns
  assert.equal(tx.agents.length, 2)
  const rev = tx.agents.find(a => a.toolUseId === 'toolu_016iNmphic4JiLnhNuLFQ2Dq')
  assert.equal(rev.description, 'Review autonomy scorecard code')
  assert.equal(rev.subagentType, 'feature-dev:code-reviewer')
})

// ---------------------------------------------------------------------------
// sessionRoster — real fixtures
// ---------------------------------------------------------------------------
test('sessionRoster joins disk workflow runs with transcript metadata', () => {
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: SUBAGENTS })

  const quick = r.workflows.find(w => w.runId === 'wf_6b2f5410-80a')
  assert.equal(quick.name, 'circuit-quick-wins')
  assert.match(quick.description, /quick wins from the 06-11 handoff/)
  assert.deepEqual(quick.phases, ['Wins'])
  assert.equal(quick.agentCount, 3)
  assert.equal(quick.resultCount, 3)
  // journal order preserved
  assert.deepEqual(
    quick.agents.map(a => a.id),
    ['a4261c7da70812697', 'ada74f3d96729bb58', 'af955195e245b9aae']
  )
  assert.ok(quick.agents.every(a => a.started && a.hasResult))

  const final = r.workflows.find(w => w.runId === 'wf_f4ff58fc-95b')
  assert.equal(final.name, 'bench-final-prep')
  assert.deepEqual(final.phases, ['Final'])
  assert.equal(final.agentCount, 3)
  assert.equal(final.resultCount, 3)

  // in-flight run: started agents, zero results
  const planner = r.workflows.find(w => w.runId === 'wf_dc4a0323-a65')
  assert.equal(planner.name, 'demo-planner-build')
  assert.deepEqual(planner.phases, ['Build', 'Integrate'])
  assert.equal(planner.agentCount, 2)
  assert.equal(planner.resultCount, 0)
  assert.ok(planner.agents.every(a => a.started && !a.hasResult))
})

test('sessionRoster lists a transcript-only workflow that never launched (runId null)', () => {
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: SUBAGENTS })
  const orphan = r.workflows.find(w => w.name === 'orphan-sweep')
  assert.ok(orphan)
  assert.equal(orphan.runId, null)
  assert.deepEqual(orphan.agents, [])
  assert.equal(orphan.agentCount, 0)
  assert.equal(orphan.resultCount, 0)
})

test('sessionRoster reads direct agents from meta.json files', () => {
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: SUBAGENTS })
  assert.deepEqual(
    r.directAgents.map(a => a.id),
    ['a5dcd2c53020e7380', 'a7ec2f3769f8d3578']
  )
  const [ci, rev] = r.directAgents
  assert.equal(ci.agentType, 'general-purpose')
  assert.equal(ci.description, 'M2-1: CI to ubuntu-latest PR')
  assert.equal(rev.agentType, 'feature-dev:code-reviewer')
  assert.equal(rev.description, 'Review autonomy scorecard code')
})

test('sessionRoster totals count workflows and every agent (workflow + direct)', () => {
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: SUBAGENTS })
  assert.equal(r.totals.workflows, 4) // 3 disk runs + 1 transcript-only orphan
  assert.equal(r.totals.agents, 10) // 3 + 3 + 2 workflow agents + 2 direct
})

// ---------------------------------------------------------------------------
// sessionRoster — crash tolerance (synthetic trees)
// ---------------------------------------------------------------------------
function tree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'roster-'))
  for (const [rel, content] of Object.entries(spec)) {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

test('workflow with agent files but a stub journal still lists the agents', () => {
  const dir = tree({
    'workflows/wf_stub-123/journal.jsonl': '',
    'workflows/wf_stub-123/agent-aaa.jsonl': '',
    'workflows/wf_stub-123/agent-bbb.jsonl': '',
  })
  const r = sessionRoster({ transcriptPath: '/nope/missing.jsonl', subagentsDir: dir })
  const wf = r.workflows.find(w => w.runId === 'wf_stub-123')
  assert.equal(wf.name, null) // no transcript to name it
  assert.deepEqual(wf.agents, [
    { id: 'aaa', started: false, hasResult: false },
    { id: 'bbb', started: false, hasResult: false },
  ])
  assert.equal(wf.agentCount, 2)
  assert.equal(wf.resultCount, 0)
})

test('journal entries survive missing transcript files and missing journal counterparts', () => {
  const dir = tree({
    // started agent with NO transcript file on disk; result-only agent (truncated journal head)
    'workflows/wf_crash-1/journal.jsonl':
      '{"type":"started","key":"v2:k1","agentId":"gone"}\n' +
      '{"type":"result","key":"v2:k2","agentId":"headless","result":{}}\n',
  })
  const r = sessionRoster({ transcriptPath: '/nope/missing.jsonl', subagentsDir: dir })
  const wf = r.workflows.find(w => w.runId === 'wf_crash-1')
  assert.deepEqual(wf.agents, [
    { id: 'gone', started: true, hasResult: false },
    { id: 'headless', started: false, hasResult: true },
  ])
  assert.equal(wf.resultCount, 1)
})

test('agent label comes from a meta.json description when present', () => {
  const dir = tree({
    'workflows/wf_lab-1/journal.jsonl': '{"type":"started","key":"v2:k1","agentId":"axe"}\n',
    'workflows/wf_lab-1/agent-axe.meta.json':
      '{"agentType":"workflow-subagent","description":"verify the depth budget"}',
  })
  const r = sessionRoster({ transcriptPath: '/nope/missing.jsonl', subagentsDir: dir })
  const wf = r.workflows.find(w => w.runId === 'wf_lab-1')
  assert.deepEqual(wf.agents, [{ id: 'axe', started: true, hasResult: false, label: 'verify the depth budget' }])
})

test('direct agent description falls back to the transcript Agent tool_use via toolUseId', () => {
  const dir = tree({
    'agent-bare.jsonl': '',
    'agent-bare.meta.json': '{"agentType":"general-purpose","toolUseId":"toolu_01AcM1jikq4iqV8hhuqwDFvL"}',
  })
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: dir })
  assert.deepEqual(r.directAgents, [
    { id: 'bare', agentType: 'general-purpose', description: 'M2-1: CI to ubuntu-latest PR' },
  ])
})

test('missing subagentsDir yields transcript-only workflows and no direct agents', () => {
  const r = sessionRoster({ transcriptPath: TRANSCRIPT, subagentsDir: '/nope/missing-subagents' })
  assert.equal(r.directAgents.length, 0)
  // all 4 transcript workflows still reported; the 3 launched ones keep their runId binding
  assert.equal(r.totals.workflows, 4)
  const quick = r.workflows.find(w => w.name === 'circuit-quick-wins')
  assert.equal(quick.runId, 'wf_6b2f5410-80a')
  assert.deepEqual(quick.agents, [])
})

test('missing everything still returns an empty roster shape', () => {
  const r = sessionRoster({ transcriptPath: '/nope/a.jsonl', subagentsDir: '/nope/b' })
  assert.deepEqual(r, { workflows: [], directAgents: [], totals: { workflows: 0, agents: 0 } })
})
