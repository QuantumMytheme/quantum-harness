import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTranscript,
  interventions,
  classifyIntervention,
  longestUnattendedStretch,
  selfCaughtFailures,
  verifierActivity,
  scaleStats,
  buildReport,
  renderHTML,
} from '../lib/scorecard.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers — shapes match the empirically documented JSONL structure
// (see session-report's analyze-sessions.mjs notes): one API response spans
// multiple assistant entries sharing requestId; user entries include tool
// results, meta-injected text, and harness auto-continuations.
// ---------------------------------------------------------------------------
let uuidCounter = 0
const uid = () => `u-${++uuidCounter}`

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

const T = m => `2026-06-12T07:${String(m).padStart(2, '0')}:00.000Z` // minute m of a fake hour

// ---------------------------------------------------------------------------
// parseTranscript
// ---------------------------------------------------------------------------
test('parseTranscript keeps human, assistant, and tool_result events in order', () => {
  const lines = toLines([
    human(T(0), 'kickoff: build the thing'),
    assistantText(T(1), 'starting'),
    toolResult(T(2), 'ok'),
  ])
  const ev = parseTranscript(lines)
  assert.equal(ev.length, 3)
  assert.deepEqual(ev.map(e => e.kind), ['human', 'assistant', 'tool_result'])
})

test('parseTranscript drops meta, compact-summary, sidechain, and auto-continuation user entries', () => {
  const lines = toLines([
    human(T(0), 'kickoff'),
    human(T(1), 'injected context', { isMeta: true }),
    human(T(2), 'summary', { isCompactSummary: true }),
    human(T(3), 'sidechain msg', { isSidechain: true }),
    human(T(4), '<task-notification>done</task-notification>'),
    human(T(5), '<scheduled-wakeup reason="x"/>'),
    human(T(6), '[Request interrupted by user]'),
    human(T(7), 'real follow-up'),
  ])
  const ev = parseTranscript(lines)
  const humans = ev.filter(e => e.kind === 'human')
  assert.equal(humans.length, 2)
  assert.deepEqual(humans.map(h => h.text), ['kickoff', 'real follow-up'])
})

test('parseTranscript dedupes replayed entries by uuid', () => {
  const a = human(T(0), 'kickoff')
  const lines = toLines([a, a, assistantText(T(1), 'hi')])
  const ev = parseTranscript(lines)
  assert.equal(ev.filter(e => e.kind === 'human').length, 1)
})

test('parseTranscript marks error tool results', () => {
  const lines = toLines([
    human(T(0), 'go'),
    toolResult(T(1), 'Error: ECONNREFUSED', { isError: true }),
    toolResult(T(2), 'all 12 tests passed'),
  ])
  const ev = parseTranscript(lines)
  const results = ev.filter(e => e.kind === 'tool_result')
  assert.equal(results[0].isError, true)
  assert.equal(results[1].isError, false)
})

test('parseTranscript flags failure-text tool results as errors even without is_error', () => {
  const lines = toLines([
    human(T(0), 'go'),
    toolResult(T(1), 'FAIL test/foo.test.mjs — 2 failing'),
  ])
  const ev = parseTranscript(lines)
  assert.equal(ev.find(e => e.kind === 'tool_result').isError, true)
})

// ---------------------------------------------------------------------------
// interventions
// ---------------------------------------------------------------------------
test('interventions excludes the kickoff message and lists later human messages verbatim', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff brief, very long'),
    assistantText(T(1), 'working'),
    human(T(10), 'actually use port 8091'),
    assistantText(T(11), 'ok'),
    human(T(20), 'approved, go ahead'),
  ]))
  const iv = interventions(ev)
  assert.equal(iv.length, 2)
  assert.equal(iv[0].text, 'actually use port 8091')
  assert.equal(iv[0].ts, T(10))
  assert.equal(iv[1].text, 'approved, go ahead')
})

test('classifyIntervention: short approval phrasing is approval-gate', () => {
  assert.equal(classifyIntervention('approved, go ahead'), 'approval-gate')
  assert.equal(classifyIntervention('yes, proceed'), 'approval-gate')
  assert.equal(classifyIntervention('LGTM ship it'), 'approval-gate')
})

test('classifyIntervention: supplying credentials/URLs/paths is new-information', () => {
  assert.equal(classifyIntervention('the key is sk_live_abc123, here you go'), 'new-information')
  assert.equal(classifyIntervention('use https://example.com/api as the base url'), 'new-information')
})

test('classifyIntervention: steering defaults to course-correction', () => {
  assert.equal(classifyIntervention('no, refactor the module to use the metrics API instead'), 'course-correction')
})

test('interventions accepts hand-tag overrides by index', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    human(T(5), 'ambiguous message'),
  ]))
  const iv = interventions(ev, { overrides: { 0: 'approval-gate' } })
  assert.equal(iv[0].class, 'approval-gate')
  assert.equal(iv[0].overridden, true)
})

// ---------------------------------------------------------------------------
// longestUnattendedStretch
// ---------------------------------------------------------------------------
test('longestUnattendedStretch finds the max human-to-human gap containing model activity', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantText(T(1), 'a'),
    human(T(5), 'nudge'),
    assistantText(T(6), 'b'),
    assistantText(T(30), 'c'),
    human(T(40), 'done?'),
  ]))
  const s = longestUnattendedStretch(ev)
  assert.equal(s.ms, 35 * 60000) // T(5) -> T(40)
  assert.equal(s.fromTs, T(5))
  assert.equal(s.toTs, T(40))
})

test('longestUnattendedStretch counts the tail after the last human message', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantText(T(1), 'a'),
    assistantText(T(50), 'still going'),
  ]))
  const s = longestUnattendedStretch(ev)
  assert.equal(s.ms, 50 * 60000)
  assert.equal(s.openEnded, true)
})

test('longestUnattendedStretch ignores gaps with no model activity inside', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    human(T(45), 'hello? (user walked away, nothing ran)'),
    assistantText(T(46), 'hi'),
    human(T(50), 'k'),
  ]))
  const s = longestUnattendedStretch(ev)
  assert.equal(s.ms, 5 * 60000) // T(45)->T(50), the only stretch with activity inside
})

// ---------------------------------------------------------------------------
// selfCaughtFailures
// ---------------------------------------------------------------------------
test('selfCaughtFailures counts an error episode resolved before the next human message', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantTool(T(1), 'Bash', { command: 'npm test' }),
    toolResult(T(2), 'FAIL: 2 tests failing', { isError: true }),
    assistantTool(T(3), 'Edit', { file_path: '/x.js' }),
    toolResult(T(4), 'ok'),
    assistantTool(T(5), 'Bash', { command: 'npm test' }),
    toolResult(T(6), 'all tests passed'),
    human(T(10), 'status?'),
  ]))
  const sc = selfCaughtFailures(ev)
  assert.equal(sc.length, 1)
  assert.equal(sc[0].errorTs, T(2))
  assert.equal(sc[0].resolved, true)
})

test('selfCaughtFailures groups consecutive errors in one turn into one episode', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    toolResult(T(1), 'Error: flaky', { isError: true }),
    toolResult(T(2), 'Error: still flaky', { isError: true }),
    assistantText(T(3), 'fixed it'),
    toolResult(T(4), 'ok now'),
  ]))
  const sc = selfCaughtFailures(ev)
  assert.equal(sc.length, 1)
})

test('a cat -n file Read containing the word "error"/"fail" is NOT a tool error', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    toolResult(T(1), '1\t// judge.mjs\n2\t  throw new Error("bad")\n3\t// # fail 0'),
  ]))
  assert.equal(ev.find(e => e.kind === 'tool_result').isError, false)
})

test('a non-zero Exit code / tool_use_error is a failure; a success line is not', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    toolResult(T(1), 'Exit code 1\nSDK surface check failed'),
    toolResult(T(2), '<tool_use_error>File has not been read yet.</tool_use_error>'),
    toolResult(T(3), 'Task #3 created successfully: First fresh-verifier pass (failure list = plan)'),
    toolResult(T(4), 'Exit code 0\nall good'),
  ]))
  const res = ev.filter(e => e.kind === 'tool_result')
  assert.deepEqual(res.map(r => r.isError), [true, true, false, false])
})

test('selfCaughtFailures: distinct failures in an autonomous (human-free) run each count', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    toolResult(T(1), 'Exit code 1', { isError: true }),
    assistantText(T(2), 'fixing the first'),
    toolResult(T(3), 'ok'),
    toolResult(T(4), 'Exit code 127', { isError: true }),
    assistantText(T(5), 'fixing the second'),
    toolResult(T(6), 'ok'),
  ]))
  const sc = selfCaughtFailures(ev)
  assert.equal(sc.length, 2)
  assert.equal(sc[0].errorTs, T(1))
  assert.equal(sc[1].errorTs, T(4))
})

test('selfCaughtFailures: an error immediately followed by a human message is NOT self-caught', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    toolResult(T(1), 'Error: boom', { isError: true }),
    human(T(2), 'you broke it, fix the import'),
    assistantText(T(3), 'fixing'),
  ]))
  const sc = selfCaughtFailures(ev)
  assert.equal(sc.length, 0)
})

// ---------------------------------------------------------------------------
// verifierActivity
// ---------------------------------------------------------------------------
test('verifierActivity finds Agent/Task spawns whose prompt matches the verifier contract', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantTool(T(1), 'Agent', { description: 'verify rubric', prompt: 'You are a fresh verifier. Grade every RUBRIC.md criterion.' }),
    assistantTool(T(2), 'Agent', { description: 'build ui', prompt: 'Build the panel component.' }),
    assistantTool(T(3), 'Task', { description: 'adversarial check', prompt: 'Adversarially verify finding X — try to refute it.' }),
  ]))
  const va = verifierActivity(ev)
  assert.equal(va.length, 2)
})

// ---------------------------------------------------------------------------
// scaleStats
// ---------------------------------------------------------------------------
test('scaleStats dedupes API calls by requestId keeping max output_tokens', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantText(T(1), 'part 1', { requestId: 'r1', usage: { input_tokens: 10, output_tokens: 5 } }),
    assistantText(T(1), 'part 2', { requestId: 'r1', usage: { input_tokens: 10, output_tokens: 90 } }),
    assistantText(T(2), 'next', { requestId: 'r2', usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 1000 } }),
  ]))
  const s = scaleStats(ev)
  assert.equal(s.apiCalls, 2)
  assert.equal(s.outputTokens, 97)
  assert.equal(s.totalTokens, 10 + 90 + 20 + 7 + 1000)
})

test('scaleStats counts tool calls and subagent spawns', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantTool(T(1), 'Bash', { command: 'ls' }),
    assistantTool(T(2), 'Agent', { prompt: 'explore' }),
    assistantTool(T(3), 'Workflow', { script: 'export const meta...' }),
  ]))
  const s = scaleStats(ev)
  assert.equal(s.toolCalls, 3)
  assert.equal(s.subagentSpawns, 1)
  assert.equal(s.workflowRuns, 1)
})

test('scaleStats reports wall-clock from first to last event', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff'),
    assistantText(T(59), 'end'),
  ]))
  assert.equal(scaleStats(ev).wallClockMs, 59 * 60000)
})

// ---------------------------------------------------------------------------
// buildReport + renderHTML
// ---------------------------------------------------------------------------
test('renderHTML produces a self-contained page with hero numbers, timeline, and interventions', () => {
  const ev = parseTranscript(toLines([
    human(T(0), 'kickoff: build the harness per BRIEF.md'),
    assistantText(T(1), 'working', { requestId: 'r1', usage: { input_tokens: 100, output_tokens: 50 } }),
    toolResult(T(2), 'Error: lint failed', { isError: true }),
    assistantText(T(3), 'fixed', { requestId: 'r2', usage: { input_tokens: 10, output_tokens: 5 } }),
    toolResult(T(4), 'lint clean'),
    human(T(30), 'approved, go ahead'),
    assistantText(T(31), 'shipping', { requestId: 'r3', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]))
  const report = buildReport(ev, { title: 'Test Session' })
  const html = renderHTML(report)
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /<svg/i) // timeline strip
  assert.match(html, /approved, go ahead/) // intervention verbatim
  assert.match(html, /approval-gate/)
  assert.match(html, /self-caught/i)
  assert.ok(!/undefined|NaN/.test(html), 'no undefined/NaN leaks into the page')
})

test('buildReport merges multiple transcripts in time order', () => {
  const ev1 = parseTranscript(toLines([human(T(0), 'kickoff'), assistantText(T(1), 'a')]))
  const ev2 = parseTranscript(toLines([human(T(10), 'follow-up session msg'), assistantText(T(11), 'b')]))
  const report = buildReport([...ev1, ...ev2], { title: 'x' })
  assert.equal(report.interventions.length, 1) // first msg overall is the kickoff
  assert.equal(report.scale.wallClockMs, 11 * 60000)
})

// ---------------------------------------------------------------------------
// Review follow-ups (2026-06-12 adversarial review) — each was a real bug
// ---------------------------------------------------------------------------
test('parseTranscript parses ALL tool_result blocks in a multi-result user entry', () => {
  const lines = toLines([
    human(T(0), 'go'),
    {
      type: 'user', uuid: uid(), timestamp: T(1),
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't-1', content: [{ type: 'text', text: 'ok' }] },
        { type: 'tool_result', tool_use_id: 't-2', is_error: true, content: [{ type: 'text', text: 'Error: boom' }] },
      ] },
    },
  ])
  const ev = parseTranscript(lines)
  const results = ev.filter(e => e.kind === 'tool_result')
  assert.equal(results.length, 2)
  assert.equal(results[1].isError, true)
})

test('longestUnattendedStretch sorts internally and skips null-timestamp humans', () => {
  const shuffled = [
    assistantText(T(30), 'late activity'),
    human(T(40), 'done?'),
    human(null, 'stray no-timestamp message'),
    human(T(0), 'kickoff'),
    assistantText(T(1), 'a'),
  ]
  const ev = parseTranscript(toLines(shuffled))
  const s = longestUnattendedStretch(ev)
  assert.equal(s.ms, 40 * 60000) // T(0) -> T(40), activity at T(1)/T(30) inside
})

test('classifyIntervention: "yes but..." steering is course-correction, not approval-gate', () => {
  assert.equal(classifyIntervention('yes but use port 8091 instead'), 'course-correction')
  assert.equal(classifyIntervention('yes that broke production, roll it back'), 'course-correction')
})

test('classifyIntervention: bare affirmation is approval-gate', () => {
  assert.equal(classifyIntervention('yes'), 'approval-gate')
  assert.equal(classifyIntervention('Yes!'), 'approval-gate')
  assert.equal(classifyIntervention('ok'), 'approval-gate')
})

test('classifyIntervention: negated approval words are not approval-gate', () => {
  assert.equal(classifyIntervention("don't proceed with the deploy yet"), 'course-correction')
  assert.equal(classifyIntervention('stop, do not go ahead'), 'course-correction')
})

test('classifyIntervention: "here\'s why" explanations are course-correction, not new-information', () => {
  assert.equal(classifyIntervention("here's why that won't work — the queue drops events"), 'course-correction')
  assert.equal(classifyIntervention('fyi this approach is wrong, rework it'), 'course-correction')
})

test('buildReport: a null-timestamp event cannot displace the kickoff', () => {
  const ev = parseTranscript(toLines([
    human(null, 'stray'),
    human(T(0), 'the real kickoff'),
    assistantText(T(1), 'a'),
  ]))
  const report = buildReport(ev, { title: 'x' })
  assert.equal(report.kickoff.text, 'the real kickoff')
})

test('slash-command echoes are excluded from human messages; caveat blocks are stripped', () => {
  {
    const lines = [
      human(T(0), '<command-name>/compact</command-name>\n<command-message>compact</command-message>'),
      human(T(1), '<local-command-stdout>Compacted</local-command-stdout>'),
      human(T(2), '<local-command-caveat>Caveat: the messages below…</local-command-caveat>\nreal text after caveat'),
      human(T(3), '<local-command-stdout>Set effort level to ultracode</local-command-stdout>'),
      human(T(4), 'do the thing with the circuit'),
    ]
    const events = parseTranscript(lines.map(l => JSON.stringify(l)).join('\n'))
    const humans = events.filter(e => e.kind === 'human')
    // only the caveat-wrapped real message and the plain message survive;
    // pure command echoes (leading tag) are excluded
    assert.equal(humans.length, 2)
    assert.match(humans[0].text, /real text after caveat/)
    assert.match(humans[1].text, /do the thing/)
  }
})

test('a slash command carrying a human payload (/goal kickoff) is kept; argless echoes are not', () => {
  const lines = [
    human(T(0), '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'),
    human(T(1), '<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>Ship the fleet feature per BRIEF.md</command-args>'),
    human(T(2), '<local-command-stdout>Goal set: Ship the fleet feature</local-command-stdout>'),
    assistantText(T(3), 'on it'),
  ]
  const events = parseTranscript(lines.map(l => JSON.stringify(l)).join('\n'))
  const humans = events.filter(e => e.kind === 'human')
  // only the /goal command (with args) survives — it IS the kickoff
  assert.equal(humans.length, 1)
  assert.match(humans[0].text, /^\/goal Ship the fleet feature per BRIEF\.md$/)

  // and it anchors the report as the kickoff, not an intervention
  const report = buildReport(events)
  assert.ok(report.kickoff)
  assert.match(report.kickoff.text, /\/goal Ship the fleet feature/)
  assert.equal(report.interventions.length, 0)
})
