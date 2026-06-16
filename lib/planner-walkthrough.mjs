// Session walkthrough extractor — judges + post-mortem narrative support.
// Implemented test-first; see test/planner-walkthrough.test.mjs.
//
// Pure function over parseTranscript events (lib/scorecard.mjs); no parsing of
// its own. Chapters = the human messages (the day's table of contents);
// workflow/agent launches = the orchestration beats; toolMix = fixed-width
// time buckets showing how the tool palette shifted across the day
// (early Read/Grep -> build Edit/Write -> verify Bash -> ship wrangler).

const ms = ts => (ts ? Date.parse(ts) : NaN)

const TITLE_MAX = 80

function title(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1) + '…' : s
}

// tolerant `field: 'value'` extractor — any quote style, loose spacing
function metaField(src, field) {
  const m = String(src).match(new RegExp(`\\b${field}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`))
  return m ? m[2] : null
}

function workflowMeta(script, input) {
  // scope to the meta object literal when present; the non-greedy block can
  // stop early on nested braces, so any miss falls back to the whole script
  const s = String(script || '')
  const block = s.match(/\bmeta\s*=\s*\{([\s\S]*?)\}/)
  const pick = f => (block ? metaField(block[1], f) : null) ?? metaField(s, f)
  return {
    name: pick('name') ?? (typeof input.name === 'string' ? input.name : null),
    description: pick('description') ?? (typeof input.description === 'string' ? input.description : null),
  }
}

function orderEvents(events) {
  // standalone callers may pass merged/unordered multi-file streams: sort
  // (null-ts to the end, like buildReport) then dedupe replayed uuids
  const seen = new Set()
  return [...events]
    .sort((a, b) => {
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
}

const sortCounts = counts =>
  Object.entries(counts).sort(([an, ac], [bn, bc]) => bc - ac || (an < bn ? -1 : an > bn ? 1 : 0))

export function walkthrough(events, { bucketMinutes = 30 } = {}) {
  const merged = orderEvents(events)

  const chapters = []
  const workflowLaunches = []
  const agentLaunches = []
  const toolTotalsMap = {}
  const uses = [] // [tMs|NaN, name]
  let firstTs = null
  let lastTs = null

  for (const e of merged) {
    const t = ms(e.ts)
    if (!Number.isNaN(t)) {
      if (firstTs === null || t < firstTs) firstTs = t
      if (lastTs === null || t > lastTs) lastTs = t
    }
    if (e.kind === 'human') {
      chapters.push({ ts: e.ts, title: title(e.text), idx: chapters.length })
      continue
    }
    if (e.kind !== 'assistant') continue
    for (const u of e.toolUses) {
      toolTotalsMap[u.name] = (toolTotalsMap[u.name] || 0) + 1
      uses.push([t, u.name])
      if (u.name === 'Workflow' || (u.name === 'TaskCreate' && typeof u.input.script === 'string')) {
        workflowLaunches.push({ ts: e.ts, ...workflowMeta(u.input.script, u.input) })
      } else if (u.name === 'Agent') {
        agentLaunches.push({
          ts: e.ts,
          description: typeof u.input.description === 'string' ? u.input.description : null,
          subagent_type: typeof u.input.subagent_type === 'string' ? u.input.subagent_type : null,
        })
      }
    }
  }

  // buckets anchor at session start (not the first tool use) so bucket 0 is
  // literally "the first N minutes of the day"; kept contiguous through the
  // last bucketable use so renderers get an unbroken axis
  const toolMix = []
  if (firstTs !== null) {
    const bucketMs = bucketMinutes * 60000
    const stamped = uses.filter(([t]) => !Number.isNaN(t))
    if (stamped.length > 0) {
      const lastIdx = Math.max(...stamped.map(([t]) => Math.floor((t - firstTs) / bucketMs)))
      for (let i = 0; i <= lastIdx; i++) {
        toolMix.push({ bucketStart: new Date(firstTs + i * bucketMs).toISOString(), bucketMinutes, counts: {}, top3: [] })
      }
      for (const [t, name] of stamped) {
        const c = toolMix[Math.floor((t - firstTs) / bucketMs)].counts
        c[name] = (c[name] || 0) + 1
      }
      for (const b of toolMix) b.top3 = sortCounts(b.counts).slice(0, 3).map(([name]) => name)
    }
  }

  return {
    chapters,
    workflowLaunches,
    agentLaunches,
    toolMix,
    toolTotals: Object.fromEntries(sortCounts(toolTotalsMap)),
    stats: {
      wallClockMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : 0,
      firstTs: firstTs !== null ? new Date(firstTs).toISOString() : null,
      lastTs: lastTs !== null ? new Date(lastTs).toISOString() : null,
      humanCount: chapters.length,
      workflowCount: workflowLaunches.length,
      agentCount: agentLaunches.length,
    },
  }
}
