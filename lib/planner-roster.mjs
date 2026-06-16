// Dynamic-agent roster — parses a Claude Code session's subagent tree
// (<projectDir>/<sessionId>/subagents/) plus the main transcript, and joins
// them into a roster of workflows + direct Agent-tool spawns.
// Implemented test-first; see test/planner-roster.test.mjs.
//
// On-disk structure notes (empirical, fixtures copied from a real session):
// - subagents/ holds agent-<id>.jsonl + agent-<id>.meta.json ({agentType,
//   description?, toolUseId?}) for direct Agent-tool spawns.
// - subagents/workflows/wf_*/ holds journal.jsonl ({type:'started',key,agentId}
//   and {type:'result',key,agentId,result} lines — older journals may say
//   `value` instead of `result`; the roster only needs key/agentId) plus one
//   agent-<id>.jsonl transcript per workflow agent.
// - The main transcript binds Workflow tool_use blocks to run dirs via the
//   launch tool_result: toolUseResult.runId, or the "Transcript dir: …" text.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const readText = p => {
  if (!p) return null
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

const listDir = (p, kind) => {
  if (!p) return []
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter(d => (kind === 'dir' ? d.isDirectory() : d.isFile()))
      .map(d => d.name)
      .sort()
  } catch {
    return []
  }
}

const readJSON = p => {
  const raw = readText(p)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

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

// --------------------------------------------------------------------------
// Workflow script meta — tolerant extraction
// --------------------------------------------------------------------------

// slice a balanced {…} or […] region, skipping over quoted strings so braces
// and brackets inside titles/details/prompts can't unbalance the scan
function balancedSlice(s, openIdx, open, close) {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === open) depth++
    else if (c === close && --depth === 0) return s.slice(openIdx, i + 1)
  }
  return s.slice(openIdx)
}

const strField = (src, field) => {
  const m = new RegExp(`${field}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*?)\\1`).exec(src)
  return m ? m[2].replace(/\\(.)/g, '$1') : null
}

export function parseWorkflowScriptMeta(script) {
  const s = String(script ?? '')
  const at = s.indexOf('export const meta')
  const none = { name: null, description: null, phases: [] }
  if (at === -1) return none
  const open = s.indexOf('{', at)
  if (open === -1) return none
  const block = balancedSlice(s, open, '{', '}')
  const phases = []
  const pm = /phases\s*:\s*\[/.exec(block)
  if (pm) {
    const arr = balancedSlice(block, pm.index + pm[0].length - 1, '[', ']')
    for (const t of arr.matchAll(/title\s*:\s*(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      phases.push(t[2].replace(/\\(.)/g, '$1'))
    }
  }
  return { name: strField(block, 'name'), description: strField(block, 'description'), phases }
}

// --------------------------------------------------------------------------
// Journal + main transcript parsing
// --------------------------------------------------------------------------

export function parseJournal(text) {
  const started = []
  const results = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const rec = { key: e.key ?? null, agentId: e.agentId ?? null }
    if (e.type === 'started') started.push(rec)
    else if (e.type === 'result') results.push(rec)
  }
  return { started, results }
}

export function parseMainTranscript(text) {
  const workflows = [] // { toolUseId, name, description, phases }
  const agents = [] // { toolUseId, description, subagentType }
  const bindings = {} // runId -> toolUseId
  const seen = new Set() // resumed sessions replay entries; dedupe by tool_use id

  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const content = e.message && e.message.content
    if (!Array.isArray(content)) continue

    if (e.type === 'assistant') {
      for (const b of content) {
        if (!b || b.type !== 'tool_use' || !b.id || seen.has(b.id)) continue
        const input = b.input || {}
        if (b.name === 'Workflow') {
          seen.add(b.id)
          workflows.push({ toolUseId: b.id, ...parseWorkflowScriptMeta(input.script) })
        } else if (b.name === 'Agent' || b.name === 'Task') {
          seen.add(b.id)
          agents.push({
            toolUseId: b.id,
            description: input.description ?? null,
            subagentType: input.subagent_type ?? null,
          })
        }
      }
      continue
    }

    if (e.type === 'user') {
      let first = true
      for (const b of content) {
        if (!b || b.type !== 'tool_result' || !b.tool_use_id) continue
        // toolUseResult is entry-level, so trust its runId only for the first
        // result block; every block also gets the text-path fallback
        const tur = e.toolUseResult
        let runId = first && tur && typeof tur === 'object' && tur.runId ? tur.runId : null
        first = false
        if (!runId) {
          const m = /workflows[\\/](wf_[\w-]+)/.exec(blockText(b.content))
          if (m) runId = m[1]
        }
        if (runId && !bindings[runId]) bindings[runId] = b.tool_use_id
      }
    }
  }
  return { workflows, agents, bindings }
}

// --------------------------------------------------------------------------
// Roster assembly
// --------------------------------------------------------------------------

function workflowAgent(dir, id, started, hasResult) {
  const a = { id, started, hasResult }
  const meta = readJSON(join(dir, `agent-${id}.meta.json`))
  if (meta && typeof meta.description === 'string' && meta.description) a.label = meta.description
  return a
}

export function sessionRoster({ transcriptPath, subagentsDir } = {}) {
  const txText = readText(transcriptPath)
  const tx = txText === null ? { workflows: [], agents: [], bindings: {} } : parseMainTranscript(txText)
  const metaByToolUse = new Map(tx.workflows.map(w => [w.toolUseId, w]))
  const runByToolUse = {}
  for (const [runId, tid] of Object.entries(tx.bindings)) runByToolUse[tid] = runId

  const workflows = []
  const usedToolUse = new Set()
  const wfRoot = subagentsDir ? join(subagentsDir, 'workflows') : null

  for (const runId of listDir(wfRoot, 'dir')) {
    const dir = join(wfRoot, runId)
    const journal = parseJournal(readText(join(dir, 'journal.jsonl')) ?? '')
    const resultKeys = new Set(journal.results.map(r => r.key).filter(Boolean))
    const resultAgents = new Set(journal.results.map(r => r.agentId).filter(Boolean))

    const agents = []
    const have = new Set()
    for (const s of journal.started) {
      if (!s.agentId || have.has(s.agentId)) continue
      have.add(s.agentId)
      const hasResult = (s.key !== null && resultKeys.has(s.key)) || resultAgents.has(s.agentId)
      agents.push(workflowAgent(dir, s.agentId, true, hasResult))
    }
    // result-only agents (journal head truncated/lost)
    for (const r of journal.results) {
      if (!r.agentId || have.has(r.agentId)) continue
      have.add(r.agentId)
      agents.push(workflowAgent(dir, r.agentId, false, true))
    }
    // on-disk transcripts a stub journal never mentioned (crashed runs)
    for (const f of listDir(dir, 'file')) {
      const m = /^agent-(.+)\.jsonl$/.exec(f)
      if (!m || have.has(m[1])) continue
      have.add(m[1])
      agents.push(workflowAgent(dir, m[1], false, false))
    }

    const tid = tx.bindings[runId]
    const meta = tid ? metaByToolUse.get(tid) : null
    if (tid) usedToolUse.add(tid)
    workflows.push({
      runId,
      name: meta ? meta.name : null,
      description: meta ? meta.description : null,
      phases: meta ? meta.phases : [],
      agents,
      agentCount: agents.length,
      resultCount: agents.filter(a => a.hasResult).length,
    })
  }

  // transcript workflows with no run dir on disk (never launched, crashed
  // before mkdir, or dir cleaned) — keep them, with the bound runId if known
  for (const w of tx.workflows) {
    if (usedToolUse.has(w.toolUseId)) continue
    workflows.push({
      runId: runByToolUse[w.toolUseId] ?? null,
      name: w.name,
      description: w.description,
      phases: w.phases,
      agents: [],
      agentCount: 0,
      resultCount: 0,
    })
  }

  // direct Agent-tool spawns: meta.json is authoritative, the transcript's
  // Agent tool_use (matched by toolUseId) fills gaps
  const agentByToolUse = new Map(tx.agents.map(a => [a.toolUseId, a]))
  const directAgents = []
  const ids = new Set()
  for (const f of listDir(subagentsDir, 'file')) {
    const m = /^agent-(.+?)\.(jsonl|meta\.json)$/.exec(f)
    if (m) ids.add(m[1])
  }
  for (const id of [...ids].sort()) {
    const meta = readJSON(join(subagentsDir, `agent-${id}.meta.json`)) || {}
    const fromTx = meta.toolUseId ? agentByToolUse.get(meta.toolUseId) : null
    directAgents.push({
      id,
      agentType: meta.agentType ?? (fromTx ? fromTx.subagentType : null),
      description: meta.description ?? (fromTx ? fromTx.description : null),
    })
  }

  return {
    workflows,
    directAgents,
    totals: {
      workflows: workflows.length,
      // every agent the session orchestrated: workflow agents + direct spawns
      agents: directAgents.length + workflows.reduce((n, w) => n + w.agentCount, 0),
    },
  }
}
