// Autonomy scorecard — Claude Code transcript parsing + autonomy metrics.
// Implemented test-first; see test/scorecard.test.mjs.
//
// JSONL structure notes (empirical, same findings as session-report's analyzer):
// - One API response is split across multiple type:"assistant" entries sharing a
//   requestId; only the last carries final output_tokens, so usage is deduped by
//   requestId keeping the max.
// - type:"user" entries mix real human messages with tool_results, meta-injected
//   text, compact summaries, sidechain traffic, and harness auto-continuations
//   (<task-notification>, <scheduled-wakeup>, <background-task>).
// - Resumed sessions replay prior entries; events are deduped by uuid.

const AUTO_CONTINUATION = /^<(task-notification|scheduled-wakeup|background-task)/
// Slash-command echoes are harness artifacts, not human steering (2026-06-12 fix):
// /compact, /effort etc. echo back as <command-name>/<command-message>/<local-command-stdout>
// entries. A <local-command-caveat> block may wrap a REAL message — strip the block, keep the rest.
const COMMAND_ECHO = /^<(command-name|command-message|local-command-stdout)/
const CAVEAT_BLOCK = /^<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/

// A <command-name> echo is usually harness noise (/compact, /clear, /effort carry no
// human intent). But some slash commands DELIVER the human's message in <command-args> —
// e.g. the kickoff arrives as `/goal <mission brief>`. Dropping those would erase the
// single most important human message (the kickoff), zeroing the whole scorecard. So a
// command echo WITH non-empty <command-args> is reconstructed as "/cmd <args>" and kept;
// argless echoes and <local-command-stdout> output remain excluded.
function commandPayload(t) {
  if (!t.startsWith('<command-name>')) return null
  const name = (t.match(/<command-name>\/?([^<]*)<\/command-name>/) || [])[1]
  const args = (t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1]
  const a = (args || '').trim()
  if (!a) return null
  const n = (name || '').trim()
  return n ? `/${n} ${a}` : a
}
const FAILURE_TEXT = /(^|[^\w])(error|fail(ed|ure|ing)?|exception|traceback|fatal|FAIL)\b/i
const FAILURE_NEGATION = /\b(0|zero|no)\s+(errors?|failures?|failing)\b|\ball\b.*\bpass/i

// Whether a tool_result *without* an explicit is_error flag should count as a failure.
// The naive "does the text contain the word fail/error anywhere" test over-fires badly:
// a file Read in cat -n format (`1\t// throw new Error(...)`), a passing test log
// (`# fail 0`), or a success line (`Task created successfully … failure list`) all match.
// Real tool failures surface the signal at the TOP of the output, so:
//   - line-numbered file reads (cat -n) are file CONTENT, never a tool error;
//   - a non-zero process exit / explicit tool-error wrapper is authoritative;
//   - otherwise require a failure token in the FIRST LINE, not negated, not a success line.
function isErrorText(t) {
  if (typeof t !== 'string' || !t) return false
  if (/^\s*\d+\t/.test(t)) return false // cat -n file Read content
  if (/^(Exit code [1-9]|<tool_use_error>)/.test(t)) return true
  const nl = t.indexOf('\n')
  const firstLine = nl === -1 ? t : t.slice(0, nl)
  if (!FAILURE_TEXT.test(firstLine) || FAILURE_NEGATION.test(firstLine)) return false
  if (/\bsuccess(fully)?\b/i.test(firstLine)) return false
  return true
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

function blockText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
  }
  return ''
}

export function parseTranscript(text) {
  const events = []
  const seen = new Set()
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.uuid) {
      if (seen.has(e.uuid)) continue
      seen.add(e.uuid)
    }
    const ts = e.timestamp || null

    if (e.type === 'user') {
      if (e.isMeta || e.isCompactSummary || e.isSidechain) continue
      const content = e.message && e.message.content
      const first = Array.isArray(content) ? content[0] : null
      if (first && first.type === 'tool_result') {
        // parallel tool calls bundle ALL their results into one user entry —
        // parse every block, not just the first (missing later blocks would
        // undercount self-caught failures and model activity)
        content.forEach((block, i) => {
          if (!block || block.type !== 'tool_result') return
          const t = blockText(block.content)
          const isError = block.is_error === true || isErrorText(t)
          events.push({ kind: 'tool_result', ts, uuid: i === 0 ? e.uuid : null, text: t, isError })
        })
        continue
      }
      const t = blockText(content)
      if (!t) continue
      if (AUTO_CONTINUATION.test(t)) continue
      if (COMMAND_ECHO.test(t)) {
        // keep command echoes that carry a real human payload (e.g. /goal kickoff)
        const payload = commandPayload(t)
        if (payload) events.push({ kind: 'human', ts, uuid: e.uuid, text: payload })
        continue
      }
      const stripped = t.replace(CAVEAT_BLOCK, '')
      if (!stripped || COMMAND_ECHO.test(stripped)) continue
      if (stripped.startsWith('[Request interrupted')) continue
      events.push({ kind: 'human', ts, uuid: e.uuid, text: stripped })
      continue
    }

    if (e.type === 'assistant') {
      const msg = e.message || {}
      const toolUses = Array.isArray(msg.content)
        ? msg.content
            .filter(b => b && b.type === 'tool_use')
            .map(b => ({ id: b.id, name: b.name, input: b.input || {} }))
        : []
      events.push({
        kind: 'assistant',
        ts,
        uuid: e.uuid,
        requestId: e.requestId || null,
        usage: msg.usage || null,
        text: blockText(msg.content),
        toolUses,
      })
    }
    // other types (summary, system, queue markers…) are ignored
  }
  return events
}

// --------------------------------------------------------------------------
// Interventions
// --------------------------------------------------------------------------

// Misclassifying steering as approval-gate would understate human steering —
// the dishonest direction — so the approval patterns are deliberately narrow:
// no bare "yes" (catches "yes but…"), and negations veto the whole class.
const APPROVAL = /\b(approved?|approval|lgtm|ship it|go ahead|proceed|confirm(ed)?|do it|sounds good|sgtm)\b/i
const PURE_AFFIRMATION = /^\s*(yes|yep|yeah|ok(ay)?|sure)[!.?]*\s*$/i
const NEGATION = /\b(don'?t|do not|never|stop|hold (off|on)|wait)\b/i
const NEW_INFO = /(https?:\/\/|\b(sk_live_|sk_test_|ghp_|cfut_|api[_-]?key|bearer )\S*|\bthe (key|token|url|password|account|port|secret) is\b)/i

export function classifyIntervention(text) {
  const t = String(text)
  if (PURE_AFFIRMATION.test(t)) return 'approval-gate'
  if (t.length < 200 && APPROVAL.test(t) && !NEGATION.test(t) && !NEW_INFO.test(t)) return 'approval-gate'
  if (NEW_INFO.test(t)) return 'new-information'
  return 'course-correction'
}

export function interventions(events, { overrides = {} } = {}) {
  const humans = events.filter(e => e.kind === 'human')
  return humans.slice(1).map((h, i) => {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, i) ||
      (h.uuid && Object.prototype.hasOwnProperty.call(overrides, h.uuid))
    const cls = overrides[h.uuid] ?? overrides[i] ?? classifyIntervention(h.text)
    return { ts: h.ts, text: h.text, class: cls, overridden }
  })
}

// --------------------------------------------------------------------------
// Longest unattended stretch
// --------------------------------------------------------------------------

const ms = ts => (ts ? Date.parse(ts) : NaN)

export function longestUnattendedStretch(events) {
  // sort-defensive: callers may pass unmerged/unordered events, and a single
  // null-timestamp human must not silently zero the result
  const humans = events
    .filter(e => e.kind === 'human' && !Number.isNaN(ms(e.ts)) && e.ts)
    .sort((a, b) => ms(a.ts) - ms(b.ts))
  const activity = events
    .filter(e => e.kind !== 'human' && e.ts && !Number.isNaN(ms(e.ts)))
    .sort((a, b) => ms(a.ts) - ms(b.ts))
  let best = { ms: 0, fromTs: null, toTs: null, openEnded: false }

  const hasActivityBetween = (a, b) =>
    activity.some(e => ms(e.ts) > a && (b === null || ms(e.ts) < b))

  for (let i = 0; i < humans.length; i++) {
    const from = ms(humans[i].ts)
    const next = i + 1 < humans.length ? ms(humans[i + 1].ts) : null
    if (next !== null) {
      if (hasActivityBetween(from, next) && next - from > best.ms) {
        best = { ms: next - from, fromTs: humans[i].ts, toTs: humans[i + 1].ts, openEnded: false }
      }
    } else {
      // tail: last human -> last activity
      const tailEnd = Math.max(...activity.map(e => ms(e.ts)).filter(t => t > from), from)
      if (tailEnd > from && tailEnd - from > best.ms) {
        const toEv = activity.find(e => ms(e.ts) === tailEnd)
        best = { ms: tailEnd - from, fromTs: humans[i].ts, toTs: toEv ? toEv.ts : null, openEnded: true }
      }
    }
  }
  return best
}

// --------------------------------------------------------------------------
// Self-caught failures
// --------------------------------------------------------------------------

export function selfCaughtFailures(events) {
  const episodes = []
  let open = null // { errorTs, lastErrorTs, preview }
  for (const e of events) {
    if (e.kind === 'tool_result' && e.isError) {
      // a NEW failure after the model already recovered from the open one is a distinct
      // episode — otherwise a fully-autonomous run (no human messages to act as episode
      // boundaries) would collapse every failure of the whole session into one.
      if (open && open.resolved) {
        episodes.push(open)
        open = null
      }
      if (!open) {
        open = { errorTs: e.ts, lastErrorTs: e.ts, preview: trim1(e.text), resolved: false, fixTs: null }
      } else {
        open.lastErrorTs = e.ts
      }
      continue
    }
    if (e.kind === 'human') {
      // a human arrived; if the open episode was never touched by the model, it
      // was human-caught, not self-caught — drop it.
      if (open) {
        if (open.resolved) episodes.push(open)
        open = null
      }
      continue
    }
    if (e.kind === 'assistant' && open) {
      // model acted after the error and before any human message
      if (!open.resolved) {
        open.resolved = true
        open.fixTs = e.ts
      }
    }
  }
  if (open && open.resolved) episodes.push(open)
  return episodes
}

function trim1(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > 160 ? s.slice(0, 157) + '…' : s
}

// --------------------------------------------------------------------------
// Verifier activity
// --------------------------------------------------------------------------

const VERIFIER = /verif(y|ier|ication)|rubric|grade|grading|adversar|refute|judge|critic/i

export function verifierActivity(events) {
  const out = []
  for (const e of events) {
    if (e.kind !== 'assistant') continue
    for (const t of e.toolUses) {
      if (t.name === 'Agent' || t.name === 'Task') {
        const hay = `${t.input.description || ''} ${t.input.prompt || ''} ${t.input.subagent_type || ''}`
        if (VERIFIER.test(hay)) out.push({ ts: e.ts, tool: t.name, preview: trim1(t.input.description || t.input.prompt) })
      } else if (t.name === 'Workflow') {
        const hay = `${t.input.script || ''} ${t.input.name || ''}`
        if (VERIFIER.test(hay)) out.push({ ts: e.ts, tool: 'Workflow', preview: trim1(t.input.name || 'workflow') })
      }
    }
  }
  return out
}

// --------------------------------------------------------------------------
// Scale stats
// --------------------------------------------------------------------------

export function scaleStats(events) {
  const byRequest = new Map()
  let toolCalls = 0
  let subagentSpawns = 0
  let workflowRuns = 0
  let humanMessages = 0
  let firstTs = null
  let lastTs = null

  for (const e of events) {
    if (e.ts) {
      const t = ms(e.ts)
      if (!Number.isNaN(t)) {
        if (firstTs === null || t < firstTs) firstTs = t
        if (lastTs === null || t > lastTs) lastTs = t
      }
    }
    if (e.kind === 'human') humanMessages++
    if (e.kind !== 'assistant') continue
    for (const t of e.toolUses) {
      toolCalls++
      if (t.name === 'Agent' || t.name === 'Task') subagentSpawns++
      if (t.name === 'Workflow') workflowRuns++
    }
    if (e.usage) {
      const key = e.requestId || e.uuid || `anon-${byRequest.size}`
      const prev = byRequest.get(key)
      if (!prev || (e.usage.output_tokens || 0) >= (prev.output_tokens || 0)) {
        byRequest.set(key, e.usage)
      }
    }
  }

  let outputTokens = 0
  let totalTokens = 0
  for (const u of byRequest.values()) {
    outputTokens += u.output_tokens || 0
    totalTokens +=
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.output_tokens || 0)
  }

  return {
    apiCalls: byRequest.size,
    outputTokens,
    totalTokens,
    toolCalls,
    subagentSpawns,
    workflowRuns,
    humanMessages,
    wallClockMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : 0,
    firstTs: firstTs !== null ? new Date(firstTs).toISOString() : null,
    lastTs: lastTs !== null ? new Date(lastTs).toISOString() : null,
  }
}

// --------------------------------------------------------------------------
// Report assembly
// --------------------------------------------------------------------------

export function buildReport(events, { title = 'Autonomy Scorecard', overrides = {} } = {}) {
  // merge order + cross-file dedupe (resumed sessions replay history)
  const seen = new Set()
  const merged = [...events]
    .sort((a, b) => {
      // no-timestamp events sort to the END so they can never displace the kickoff
      const ta = ms(a.ts)
      const tb = ms(b.ts)
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
      if (Number.isNaN(ta)) return 1
      if (Number.isNaN(tb)) return -1
      return ta - tb
    })
    .filter(e => {
      if (!e.uuid) return true
      if (seen.has(e.uuid)) return false
      seen.add(e.uuid)
      return true
    })

  const humans = merged.filter(e => e.kind === 'human')
  return {
    title,
    generatedAt: new Date().toISOString(),
    kickoff: humans[0] ? { ts: humans[0].ts, text: humans[0].text } : null,
    interventions: interventions(merged, { overrides }),
    stretch: longestUnattendedStretch(merged),
    selfCaught: selfCaughtFailures(merged),
    verifiers: verifierActivity(merged),
    scale: scaleStats(merged),
    timeline: buildTimeline(merged),
  }
}

function buildTimeline(events, buckets = 240) {
  const stamped = events.filter(e => e.ts && !Number.isNaN(ms(e.ts)))
  if (stamped.length === 0) return { buckets: [], humans: [], startTs: null, endTs: null }
  const t0 = Math.min(...stamped.map(e => ms(e.ts)))
  const t1 = Math.max(...stamped.map(e => ms(e.ts)))
  const span = Math.max(1, t1 - t0)
  const act = new Array(buckets).fill(0)
  for (const e of stamped) {
    if (e.kind === 'human') continue
    const i = Math.min(buckets - 1, Math.floor(((ms(e.ts) - t0) / span) * buckets))
    act[i]++
  }
  const humans = stamped
    .filter(e => e.kind === 'human')
    .map((h, i) => ({
      frac: (ms(h.ts) - t0) / span,
      ts: h.ts,
      kickoff: i === 0,
      class: i === 0 ? 'kickoff' : classifyIntervention(h.text),
    }))
  return { buckets: act, humans, startTs: new Date(t0).toISOString(), endTs: new Date(t1).toISOString() }
}

// --------------------------------------------------------------------------
// HTML rendering — fully static, no client JS; judges can re-derive it with
// one command, which is the point.
// --------------------------------------------------------------------------

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function humanizeMs(v) {
  if (!v || v <= 0) return '0m'
  const h = Math.floor(v / 3600000)
  const m = Math.round((v % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.round(v / 1000)}s`
}

const fmtTok = n =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n)

// Anthropic house palette (chartkit.py THEME) — white ground, ink, single
// terracotta accent, warm grays for secondary data, hairlines in grid only.
const C = {
  bg: '#FFFFFF',
  ink: '#101010',
  ink_soft: '#3D3833',
  terra: '#D87254',
  terra_deep: '#B5481F',
  warm: '#B4A799',
  dash: '#BCB3AA',
  grid: '#ECE7E2',
  axis: '#6B645D',
  caption: '#938A81',
  sage: '#7A8B6F', // status dot only — approval-gate = the HITL design working
  amber: '#C99B3F', // status dot only — new-information
}
const FONT = `"Hanken Grotesk",Inter,"Liberation Sans",Arial,sans-serif`

// Status is always dot + word, never color alone (accessibility + print).
const CLASS_DOT = {
  kickoff: C.ink,
  'approval-gate': C.sage,
  'new-information': C.amber,
  'course-correction': C.terra_deep,
}

// Sub-minute precision is below the resolution of an autonomy report —
// milliseconds are non-data-ink.
const fmtTs = s => String(s || '').replace(/\.\d{3}Z$/, 'Z').replace('T', ' ')

// Within a table column, a date repeated on every row is redundant ink:
// show it on first occurrence and whenever it changes, time-only otherwise.
const mkTsFmt = () => {
  let prevDate = null
  return ts => {
    const full = fmtTs(ts)
    const m = full.match(/^(\d{4}-\d{2}-\d{2}) (.+)$/)
    if (!m) return full
    if (m[1] === prevDate) return m[2]
    prevDate = m[1]
    return full
  }
}

function timelineSVG(tl) {
  const W = 960
  const H = 84
  const baseY = 58 // hairline axis; activity bars grow up from it (zero baseline)
  const maxBarH = 36
  if (!tl.buckets.length) return `<svg width="${W}" height="${H}"></svg>`
  const n = tl.buckets.length
  const bw = W / n
  const maxC = Math.max(1, ...tl.buckets)
  // bar height proportional to events per interval — lie factor 1.0, unlike a
  // binary "activity present" band
  const rects = tl.buckets
    .map((c, i) => {
      if (c <= 0) return ''
      const h = Math.max(1.5, (c / maxC) * maxBarH)
      return `<rect x="${(i * bw).toFixed(2)}" y="${(baseY - h).toFixed(2)}" width="${Math.max(bw, 0.8).toFixed(2)}" height="${h.toFixed(2)}" fill="${C.dash}"/>`
    })
    .join('')
  const marks = tl.humans
    .map(h => {
      const x = (h.frac * W).toFixed(2)
      return h.kickoff
        ? `<path d="M ${x} 6 l 7 4.5 l -7 4.5 z" fill="${C.ink}"/>`
        : `<line x1="${x}" y1="18" x2="${x}" y2="${baseY}" stroke="${C.terra}" stroke-width="1.5"/>`
    })
    .join('')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="session timeline: activity density with human touchpoints" style="max-width:100%">
  ${rects}
  <line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="${C.grid}" stroke-width="1"/>
  ${marks}
  <text x="0" y="${H - 8}" font-family='${FONT}' font-size="11" fill="${C.axis}">${esc(fmtTs(tl.startTs))}</text>
  <text x="${W}" y="${H - 8}" font-family='${FONT}' font-size="11" fill="${C.axis}" text-anchor="end">${esc(fmtTs(tl.endTs))}</text>
</svg>`
}

export function renderHTML(report) {
  const r = report
  const iv = r.interventions
  const counts = { 'approval-gate': 0, 'new-information': 0, 'course-correction': 0 }
  for (const i of iv) counts[i.class] = (counts[i.class] || 0) + 1
  const steering = iv.length - (counts['approval-gate'] || 0)

  // status = small colored dot + the word, in ink — never a filled pill
  const cls = c =>
    `<span class="cls"><span class="dot" style="background:${CLASS_DOT[c] || C.axis}"></span>${esc(c)}</span>`

  const ivTs = mkTsFmt()
  const ivRows = iv.length
    ? iv
        .map(
          i => `<tr><td class="ts">${esc(ivTs(i.ts))}</td><td>${cls(i.class)}${i.overridden ? ' <span class="ov">hand-tagged</span>' : ''}</td><td class="msg">${esc(i.text)}</td></tr>`
        )
        .join('\n')
    : '<tr><td colspan="3" class="empty">none — zero human messages after kickoff</td></tr>'

  const scErrTs = mkTsFmt()
  const scFixTs = mkTsFmt()
  const scRows = r.selfCaught.length
    ? r.selfCaught
        .map(
          s => `<tr><td class="ts">${esc(scErrTs(s.errorTs))}</td><td class="msg"><span class="dot" style="background:${C.terra_deep}"></span>${esc(s.preview)}</td><td class="ts">${esc(scFixTs(s.fixTs))}</td></tr>`
        )
        .join('\n')
    : '<tr><td colspan="3" class="empty">none detected</td></tr>'

  const vTs = mkTsFmt()
  const vRows = r.verifiers.length
    ? r.verifiers.map(v => `<tr><td class="ts">${esc(vTs(v.ts))}</td><td class="tool">${esc(v.tool)}</td><td class="msg">${esc(v.preview)}</td></tr>`).join('\n')
    : '<tr><td colspan="3" class="empty">none detected</td></tr>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(r.title)}</title>
<style>
  body{font:15px/1.5 ${FONT};color:${C.ink_soft};background:${C.bg};max-width:1000px;margin:40px auto;padding:0 20px}
  h1{font-size:24px;font-weight:700;color:${C.ink};letter-spacing:-0.01em;margin:0 0 4px}
  .sub{color:${C.caption};font-size:13px;margin:0 0 8px}
  .hero{display:flex;gap:56px;flex-wrap:wrap;margin:30px 0 38px}
  .stat .n{font-size:48px;font-weight:700;line-height:1;color:${C.ink};font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
  .stat.key .n{color:${C.terra}}
  .stat .l{color:${C.caption};font-size:12px;line-height:1.4;margin-top:7px;max-width:210px}
  h2{font-size:14px;font-weight:700;color:${C.ink};margin:36px 0 6px}
  h2 .cap{font-weight:400;font-size:12.5px;color:${C.caption}}
  .fig{color:${C.caption};font-size:12px;margin:2px 0 0}
  table{border-collapse:collapse;width:100%;margin:4px 0 10px}
  th{text-align:left;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:${C.caption};padding:4px 16px 5px 0}
  td{text-align:left;padding:8px 16px 8px 0;vertical-align:top}
  tr+tr td{border-top:1px solid ${C.grid}}
  .ts{white-space:nowrap;color:${C.caption};font-size:12px;font-variant-numeric:tabular-nums}
  .msg{color:${C.ink};word-break:break-word}
  .cls{white-space:nowrap;font-size:12.5px;color:${C.ink_soft}}
  .tool{font-size:12.5px;color:${C.ink_soft};white-space:nowrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:baseline}
  .ov{font-size:11px;font-style:italic;color:${C.caption}}
  .empty{color:${C.caption};font-style:italic}
  .scale{color:${C.caption};font-size:13px;margin:10px 0 4px}
  .scale b{font-weight:600;color:${C.ink_soft};font-variant-numeric:tabular-nums}
  footer{margin-top:40px;border-top:1px solid ${C.grid};padding-top:12px;color:${C.caption};font-size:12px;line-height:1.55}
  code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${C.axis}}
</style></head><body>
<h1>${esc(r.title)}</h1>
<p class="sub">Autonomy scorecard — computed from the raw session transcript, not narrated. Generated ${esc(fmtTs(r.generatedAt))}.</p>

<div class="hero">
  <div class="stat key"><div class="n">${iv.length}</div><div class="l">human messages after kickoff (${steering} steering + ${counts['approval-gate'] || 0} approval-gate)</div></div>
  <div class="stat"><div class="n">${humanizeMs(r.stretch.ms)}</div><div class="l">longest unattended stretch${r.stretch.openEnded ? ' (still open at end)' : ''}</div></div>
  <div class="stat"><div class="n">${r.selfCaught.length}</div><div class="l">failures self-caught &amp; fixed before any human pointed them out</div></div>
  <div class="stat"><div class="n">${r.scale.subagentSpawns + r.scale.workflowRuns}</div><div class="l">agents orchestrated (${r.scale.subagentSpawns} subagents, ${r.scale.workflowRuns} workflows)</div></div>
</div>

<h2>Timeline</h2>
${timelineSVG(r.timeline)}
<p class="fig">Gray bars: model/tool events per interval (height proportional to count). Terracotta ticks: human touchpoints — classified in the table below. Solid triangle: kickoff.</p>

<div class="scale"><b>${esc(fmtTok(r.scale.totalTokens))}</b> tokens (<b>${esc(fmtTok(r.scale.outputTokens))}</b> output) · <b>${r.scale.apiCalls}</b> API calls · <b>${r.scale.toolCalls}</b> tool calls · <b>${humanizeMs(r.scale.wallClockMs)}</b> wall-clock</div>

<h2>Every human intervention, verbatim <span class="cap">— approval-gate is the product's HITL design working, not steering</span></h2>
<table><tr><th>when</th><th>class</th><th>message</th></tr>
${ivRows}
</table>

<h2>Self-caught failures <span class="cap">— error tool-results the model detected and acted on before the next human message</span></h2>
<table><tr><th>error at</th><th>what broke</th><th>model acted at</th></tr>
${scRows}
</table>

<h2>Verifier activity <span class="cap">— sub-agents / workflows spawned to grade, verify, or adversarially check the work</span></h2>
<table><tr><th>when</th><th>tool</th><th>what</th></tr>
${vRows}
</table>

<footer>Methodology: parsed from Claude Code transcript JSONL (uuid-deduped; API usage deduped by requestId keeping max output_tokens; meta/sidechain/auto-continuation entries excluded). Approval-gate messages are HITL design working, counted separately from steering. An error episode still unresolved when the transcript ends is NOT counted as self-caught. Regenerate: <code>node bin/autonomy-scorecard.mjs &lt;transcript.jsonl…&gt;</code></footer>
</body></html>
`
}
