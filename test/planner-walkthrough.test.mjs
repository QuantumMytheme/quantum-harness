import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscript } from '../lib/scorecard.mjs'
import { walkthrough } from '../lib/planner-walkthrough.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers — same style as test/scorecard.test.mjs (human(ts, text) arg
// order). T(m) uses date math instead of string templating so spans past
// minute 59 stay valid timestamps.
// ---------------------------------------------------------------------------
let uuidCounter = 0
const uid = () => `w-${++uuidCounter}`

function human(ts, text, extra = {}) {
  return { type: 'user', uuid: uid(), timestamp: ts, message: { role: 'user', content: text }, ...extra }
}

function toolResult(ts, text, { isError = false } = {}) {
  return {
    type: 'user', uuid: uid(), timestamp: ts,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-x', is_error: isError, content: [{ type: 'text', text }] }] },
  }
}

function assistantText(ts, text, { requestId = `req-${uid()}`, usage } = {}) {
  return {
    type: 'assistant', uuid: uid(), timestamp: ts, requestId,
    message: { role: 'assistant', usage, content: [{ type: 'text', text }] },
  }
}

function assistantTool(ts, name, input, { requestId = `req-${uid()}`, usage, toolId } = {}) {
  return {
    type: 'assistant', uuid: uid(), timestamp: ts, requestId,
    message: { role: 'assistant', usage, content: [{ type: 'tool_use', id: toolId || `t-${uid()}`, name, input }] },
  }
}

const toLines = events => events.map(e => JSON.stringify(e)).join('\n') + '\n'

const T0 = Date.parse('2026-06-12T07:00:00.000Z')
const T = m => new Date(T0 + m * 60000).toISOString() // minute m from session start

const parse = events => parseTranscript(toLines(events))

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------
test('chapters: every human message becomes a chapter with ts, title, idx', () => {
  const w = walkthrough(parse([
    human(T(0), 'kickoff: build the quantum demo'),
    assistantText(T(1), 'working'),
    human(T(30), 'now wire the metrics panel'),
  ]))
  assert.equal(w.chapters.length, 2)
  assert.deepEqual(w.chapters[0], { ts: T(0), title: 'kickoff: build the quantum demo', idx: 0 })
  assert.deepEqual(w.chapters[1], { ts: T(30), title: 'now wire the metrics panel', idx: 1 })
})

test('chapters: titles collapse whitespace and truncate to ~80 chars', () => {
  const long = 'build the harness,\n  then the panel, ' + 'x'.repeat(120)
  const w = walkthrough(parse([human(T(0), long)]))
  const title = w.chapters[0].title
  assert.ok(title.length <= 80, `title is ${title.length} chars`)
  assert.ok(title.endsWith('…'))
  assert.match(title, /^build the harness, then the panel, x/) // newline+runs collapsed
})

test('chapters: tool results and assistant turns are not chapters', () => {
  const w = walkthrough(parse([
    human(T(0), 'kickoff'),
    assistantTool(T(1), 'Bash', { command: 'ls' }),
    toolResult(T(2), 'ok'),
    assistantText(T(3), 'done'),
  ]))
  assert.equal(w.chapters.length, 1)
})

// ---------------------------------------------------------------------------
// workflowLaunches
// ---------------------------------------------------------------------------
test('workflowLaunches: extracts meta name/description from Workflow input.script', () => {
  const script = `export const meta = {
  name: 'verify-rubric',
  description: "Grade every RUBRIC.md criterion adversarially",
}
export default async function run(ctx) { /* … */ }`
  const w = walkthrough(parse([
    human(T(0), 'kickoff'),
    assistantTool(T(5), 'Workflow', { script }),
  ]))
  assert.equal(w.workflowLaunches.length, 1)
  assert.deepEqual(w.workflowLaunches[0], {
    ts: T(5),
    name: 'verify-rubric',
    description: 'Grade every RUBRIC.md criterion adversarially',
  })
})

test('workflowLaunches: meta regex tolerates quote styles, spacing, and field order', () => {
  const script = 'export const meta={\n  description : `multi-angle research`,\n  name :"fan-out" }\nrest'
  const w = walkthrough(parse([human(T(0), 'k'), assistantTool(T(1), 'Workflow', { script })]))
  assert.equal(w.workflowLaunches[0].name, 'fan-out')
  assert.equal(w.workflowLaunches[0].description, 'multi-angle research')
})

test('workflowLaunches: script without meta falls back to input name/description, else null', () => {
  const w = walkthrough(parse([
    human(T(0), 'k'),
    assistantTool(T(1), 'Workflow', { script: 'export default async () => {}', name: 'bare-launch' }),
    assistantTool(T(2), 'Workflow', { script: 'export default async () => {}' }),
  ]))
  assert.equal(w.workflowLaunches.length, 2)
  assert.equal(w.workflowLaunches[0].name, 'bare-launch')
  assert.equal(w.workflowLaunches[1].name, null)
  assert.equal(w.workflowLaunches[1].description, null)
})

test('workflowLaunches: TaskCreate carrying a script counts; plain TaskCreate does not', () => {
  const script = 'export const meta = { name: "bg-verifier", description: "background grading pass" }'
  const w = walkthrough(parse([
    human(T(0), 'k'),
    assistantTool(T(1), 'TaskCreate', { script }),
    assistantTool(T(2), 'TaskCreate', { prompt: 'watch the deploy', run_in_background: true }),
  ]))
  assert.equal(w.workflowLaunches.length, 1)
  assert.equal(w.workflowLaunches[0].name, 'bg-verifier')
  assert.equal(w.stats.workflowCount, 1)
})

// ---------------------------------------------------------------------------
// agentLaunches
// ---------------------------------------------------------------------------
test('agentLaunches: Agent toolUses are listed with description + subagent_type', () => {
  const w = walkthrough(parse([
    human(T(0), 'k'),
    assistantTool(T(1), 'Agent', { description: 'verify rubric', prompt: 'grade it', subagent_type: 'general-purpose' }),
    assistantTool(T(2), 'Agent', { prompt: 'explore' }),
    assistantTool(T(3), 'Task', { description: 'not an Agent launch' }),
  ]))
  assert.equal(w.agentLaunches.length, 2)
  assert.deepEqual(w.agentLaunches[0], { ts: T(1), description: 'verify rubric', subagent_type: 'general-purpose' })
  assert.deepEqual(w.agentLaunches[1], { ts: T(2), description: null, subagent_type: null })
  assert.equal(w.stats.agentCount, 2)
})

// ---------------------------------------------------------------------------
// toolMix
// ---------------------------------------------------------------------------
test('toolMix: 30-min buckets anchored at session start, contiguous through the last tool use', () => {
  const w = walkthrough(parse([
    human(T(0), 'kickoff'), // session start anchors bucket 0
    assistantTool(T(5), 'Read', {}),
    assistantTool(T(10), 'Grep', {}),
    assistantTool(T(20), 'Read', {}),
    assistantTool(T(40), 'Edit', {}),
    assistantTool(T(45), 'Write', {}),
    assistantTool(T(50), 'Edit', {}),
    assistantTool(T(95), 'Bash', {}),
  ]))
  assert.equal(w.toolMix.length, 4) // [0,30) [30,60) [60,90) [90,120)
  assert.equal(w.toolMix[0].bucketStart, T(0))
  assert.equal(w.toolMix[0].bucketMinutes, 30)
  assert.deepEqual(w.toolMix[0].counts, { Read: 2, Grep: 1 })
  assert.deepEqual(w.toolMix[0].top3, ['Read', 'Grep'])
  assert.deepEqual(w.toolMix[1].counts, { Edit: 2, Write: 1 })
  // empty middle bucket is kept so the renderer gets a continuous axis
  assert.equal(w.toolMix[2].bucketStart, T(60))
  assert.deepEqual(w.toolMix[2].counts, {})
  assert.deepEqual(w.toolMix[2].top3, [])
  assert.deepEqual(w.toolMix[3].counts, { Bash: 1 })
})

test('toolMix: top3 keeps at most three names, count desc then name asc', () => {
  const uses = ['Bash', 'Bash', 'Bash', 'Edit', 'Edit', 'Read', 'Read', 'Grep']
  const w = walkthrough(parse([
    human(T(0), 'k'),
    ...uses.map((name, i) => assistantTool(T(1 + i), name, {})),
  ]))
  assert.deepEqual(w.toolMix[0].top3, ['Bash', 'Edit', 'Read']) // Edit/Read tie broken asc; Grep cut
})

test('toolMix: bucketMinutes is configurable and boundary times round down into the later bucket', () => {
  const w = walkthrough(parse([
    human(T(0), 'k'),
    assistantTool(T(9), 'Read', {}),
    assistantTool(T(10), 'Edit', {}), // exactly on the boundary -> bucket 1
  ]), { bucketMinutes: 10 })
  assert.equal(w.toolMix.length, 2)
  assert.equal(w.toolMix[0].bucketMinutes, 10)
  assert.deepEqual(w.toolMix[0].counts, { Read: 1 })
  assert.deepEqual(w.toolMix[1].counts, { Edit: 1 })
})

test('toolMix: counts every tool_use block of a parallel multi-tool assistant turn', () => {
  const multi = {
    type: 'assistant', uuid: uid(), timestamp: T(1), requestId: 'r-multi',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't-a', name: 'Read', input: {} },
      { type: 'tool_use', id: 't-b', name: 'Read', input: {} },
      { type: 'tool_use', id: 't-c', name: 'Bash', input: {} },
    ] },
  }
  const w = walkthrough(parse([human(T(0), 'k'), multi]))
  assert.deepEqual(w.toolMix[0].counts, { Read: 2, Bash: 1 })
  assert.deepEqual(w.toolTotals, { Read: 2, Bash: 1 })
})

// ---------------------------------------------------------------------------
// toolTotals
// ---------------------------------------------------------------------------
test('toolTotals: keys are ordered by count desc, ties by name asc', () => {
  const uses = ['Edit', 'Read', 'Bash', 'Edit', 'Grep', 'Read', 'Write']
  const w = walkthrough(parse([
    human(T(0), 'k'),
    ...uses.map((name, i) => assistantTool(T(1 + i), name, {})),
  ]))
  assert.deepEqual(Object.keys(w.toolTotals), ['Edit', 'Read', 'Bash', 'Grep', 'Write'])
  assert.equal(w.toolTotals.Edit, 2)
  assert.equal(w.toolTotals.Write, 1)
})

test('toolTotals counts null-timestamp tool uses that toolMix cannot bucket', () => {
  const w = walkthrough(parse([
    human(T(0), 'k'),
    assistantTool(null, 'Bash', {}),
    assistantTool(T(5), 'Read', {}),
  ]))
  assert.deepEqual(w.toolTotals, { Bash: 1, Read: 1 })
  assert.deepEqual(w.toolMix.map(b => b.counts), [{ Read: 1 }])
})

// ---------------------------------------------------------------------------
// stats + robustness
// ---------------------------------------------------------------------------
test('stats: wall clock spans all timestamped events; counters match the lists', () => {
  const w = walkthrough(parse([
    human(T(0), 'kickoff'),
    assistantTool(T(1), 'Workflow', { script: 'export const meta = { name: "a", description: "b" }' }),
    assistantTool(T(2), 'Agent', { description: 'check', subagent_type: 'reviewer' }),
    toolResult(T(90), 'ok'),
  ]))
  assert.equal(w.stats.wallClockMs, 90 * 60000)
  assert.equal(w.stats.firstTs, T(0))
  assert.equal(w.stats.lastTs, T(90))
  assert.equal(w.stats.humanCount, 1)
  assert.equal(w.stats.workflowCount, 1)
  assert.equal(w.stats.agentCount, 1)
})

test('walkthrough sorts unordered events and dedupes replayed uuids', () => {
  const k = human(T(0), 'kickoff')
  const shuffled = [
    assistantTool(T(40), 'Edit', {}),
    human(T(30), 'second chapter'),
    k,
    assistantTool(T(5), 'Read', {}),
  ]
  // resumed sessions replay history: merge two parses of overlapping files
  const ev = [...parse(shuffled), ...parse([k])]
  const w = walkthrough(ev)
  assert.deepEqual(w.chapters.map(c => c.title), ['kickoff', 'second chapter'])
  assert.deepEqual(w.chapters.map(c => c.idx), [0, 1])
  assert.equal(w.stats.humanCount, 2)
  assert.deepEqual(w.toolMix.map(b => b.counts), [{ Read: 1 }, { Edit: 1 }])
})

test('walkthrough of an empty stream is sane — no NaN, no undefined, empty shapes', () => {
  const w = walkthrough([])
  assert.deepEqual(w.chapters, [])
  assert.deepEqual(w.workflowLaunches, [])
  assert.deepEqual(w.agentLaunches, [])
  assert.deepEqual(w.toolMix, [])
  assert.deepEqual(w.toolTotals, {})
  assert.deepEqual(w.stats, { wallClockMs: 0, firstTs: null, lastTs: null, humanCount: 0, workflowCount: 0, agentCount: 0 })
  assert.ok(!/NaN|undefined/.test(JSON.stringify(w)))
})
