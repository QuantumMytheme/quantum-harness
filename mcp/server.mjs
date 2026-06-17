#!/usr/bin/env node
// quantum-harness MCP server — lets the Claude Desktop app drive the harness in-chat:
// list the open problems, read a BRIEF / the KICKOFF, RE-VERIFY a proof bundle through the
// real numpy judge (exit-code truth, not a chat claim), and mint a fresh public run repo in
// the GitHub org. Pair it with the official GitHub MCP for clone/commit/PR.
//
// DEPENDENCY-FREE on purpose: raw JSON-RPC 2.0 over newline-delimited stdio, no SDK, no
// npm install — `node mcp/server.mjs` is the whole thing, in keeping with the harness's
// "numpy is the only dependency" ethos. verify_bundle shells out to the project's own
// bench/quantum-judge/judge_verify.py (numpy only); everything else is pure Node.
//
// Tools: list_problems · get_brief · get_kickoff · verify_bundle · mint_run
// Setup + the in-chat flow: ../CLAUDE-DESKTOP.md

import { readFile, readdir, writeFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JUDGE = path.join(ROOT, 'bench', 'quantum-judge', 'judge_verify.py')
const REFS = path.join(ROOT, 'bench', 'quantum-judge', 'references')
const TEMPLATE = { owner: 'QuantumMytheme', repo: 'quantum-harness' }
const SERVER = { name: 'quantum-harness', version: '0.1.0' }

// exit code -> the gate that fired (mirrors judge_verify.py's contract).
const GATE = { 0: 'accept', 2: 'schema', 3: 'structure', 4: 'reproducibility', 5: 'performance', 6: 'anti-overfit' }

// Human labels for the committed problems. The canonical list is the reference directory;
// this only enriches it with a readable one-liner. Unknown ids fall back to their task.
const LABELS = {
  ghz3:       { task: 'state_prep',   label: 'GHZ₃ — prepare the 3-qubit GHZ state under a linear coupling map' },
  isingbell2: { task: 'vqe',          label: 'Ising Bell — ground state of H = −X₀X₁ − Z₀Z₁' },
  tfim3:      { task: 'vqe',          label: 'TFIM₃ — transverse-field Ising ground state via QAOA p=2' },
  h2vqe:      { task: 'vqe',          label: 'H₂ — molecular ground-state energy (VQE)' },
  bell_pops2: { task: 'populations',  label: 'Bell |Φ⁺⟩ — populations with a held-out ⟨XX⟩ check' },
  aiaccel4:   { task: 'architecture', label: 'AI-Accel — route a workload over a coupling map within budget' },
  qml_sign1:  { task: 'classify',     label: 'Sign classifier — a feature map that generalizes to held-out points' },
  bellnoisy2: { task: 'state_prep',   label: 'Bell (noisy) — re-verifiable prediction under a depolarizing channel' },
}

// ---- tools --------------------------------------------------------------------------------

export const TOOLS = [
  {
    name: 'list_problems',
    description: 'List the open quantum-design problems the judge can grade (problem_id, task type, one-line concept). Start here to pick a run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_brief',
    description: 'Return the BRIEF for a problem — the target stated CONCEPTUALLY (the exact statevector/Hamiltonian/thresholds stay host-side with the judge and are never revealed). Use this as the design spec.',
    inputSchema: {
      type: 'object',
      properties: { problem_id: { type: 'string', description: 'e.g. "ghz3", "h2vqe", "bell_pops2"' } },
      required: ['problem_id'], additionalProperties: false,
    },
  },
  {
    name: 'get_kickoff',
    description: 'Return KICKOFF.md — the one-message run contract (goal, proof-bundle schema, the self-correct-until-ACCEPT loop). Optionally name the problem to anchor it.',
    inputSchema: {
      type: 'object',
      properties: { problem_id: { type: 'string', description: 'optional — the problem this run targets' } },
      additionalProperties: false,
    },
  },
  {
    name: 'verify_bundle',
    description: 'Re-derive a proof bundle from scratch through the real numpy judge (four gates: structure → reproducibility → performance → anti-overfit) and return ACCEPT/REJECT with the exit code and per-gate detail. This exit code — not any claim in chat — is the result. Loop here until ACCEPT.',
    inputSchema: {
      type: 'object',
      properties: {
        bundle: { type: 'object', description: 'the full proof-bundle JSON object (schema "quantum-harness/proof-bundle@1")' },
        bundle_path: { type: 'string', description: 'alternatively, an absolute path to a bundle .json file on disk' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mint_run',
    description: 'Create a fresh PUBLIC run repository from the quantum-harness template — each run gets its own permanent, re-verifiable repo. Needs a GitHub token (GITHUB_TOKEN env / connector config). Then use the GitHub MCP to clone, commit the bundle, and push.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'repo name, e.g. "run-ghz3-2026-06-16"' },
        owner: { type: 'string', description: 'target owner (default: the authenticated user; pass "QuantumMytheme" if you have org access)' },
        remix: { type: 'string', description: 'optional problem_id to tag the repo as a remix of the current frontier' },
        description: { type: 'string', description: 'optional repo description' },
      },
      required: ['name'], additionalProperties: false,
    },
  },
]

// ---- tool implementations ----------------------------------------------------------------

async function listProblems() {
  const files = (await readdir(REFS)).filter(f => f.endsWith('.json'))
  const problems = files.map(f => f.replace(/\.json$/, '')).sort().map(id => ({
    problem_id: id,
    task: LABELS[id]?.task || 'unknown',
    label: LABELS[id]?.label || `${id} (${LABELS[id]?.task || 'task'})`,
  }))
  return json({ problems, count: problems.length, note: 'Pick one, then call get_brief(problem_id).' })
}

async function getBrief({ problem_id }) {
  const meta = LABELS[problem_id]
  if (!meta) {
    const known = Object.keys(LABELS).join(', ')
    return json({ error: `unknown problem_id ${JSON.stringify(problem_id)}`, known }, true)
  }
  const brief = await readFile(path.join(ROOT, 'BRIEF.md'), 'utf8')
  const head =
    `# BRIEF — ${problem_id}\n\n` +
    `**Concept:** ${meta.label}\n` +
    `**Task type:** ${meta.task}\n\n` +
    `You know the target *conceptually* from the line above. The exact target statevector / ` +
    `Hamiltonian / numeric thresholds live host-side with the judge and are NOT revealed — ` +
    `design to the concept and let verify_bundle confirm.\n\n---\n\n`
  return text(head + brief)
}

async function getKickoff({ problem_id } = {}) {
  const kickoff = await readFile(path.join(ROOT, 'KICKOFF.md'), 'utf8')
  const head = problem_id
    ? `> This run targets **${problem_id}** — ${LABELS[problem_id]?.label || problem_id}.\n\n`
    : ''
  return text(head + kickoff)
}

function runJudge(bundlePath) {
  return new Promise(resolve => {
    execFile('python3', [JUDGE, bundlePath, '--json'], { cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) => {
      const out = (stdout || '').trim()
      if (out) {
        try { return resolve({ ok: true, result: JSON.parse(out.split('\n').pop()) }) } catch { /* fall through */ }
      }
      // No parseable verdict — distinguish "no python / no numpy" from a real failure.
      const msg = `${stderr || ''}${err ? `\n${err.message}` : ''}`.trim()
      const missing =
        /ENOENT/.test(msg) || /not found/i.test(msg) ? 'python3 was not found on PATH' :
        /No module named .?numpy/.test(msg) ? 'numpy is not installed (pip install numpy)' : null
      resolve({ ok: false, missing, msg })
    })
  })
}

async function verifyBundle({ bundle, bundle_path }) {
  let bundlePath = bundle_path, tmp = null
  if (!bundlePath) {
    if (!bundle || typeof bundle !== 'object') {
      return json({ error: 'pass either `bundle` (a JSON object) or `bundle_path` (a file path)' }, true)
    }
    tmp = path.join(tmpdir(), `qh-bundle-${process.pid}-${TOOLS.length}.json`)
    await writeFile(tmp, JSON.stringify(bundle))
    bundlePath = tmp
  }
  try {
    const r = await runJudge(bundlePath)
    if (!r.ok) {
      return json({
        error: 'could not run the judge',
        reason: r.missing || r.msg || 'unknown',
        remediation: r.missing
          ? 'The judge needs python3 + numpy. Install numpy (pip install numpy), or verify in-browser at quantummytheme.com/lab (the judge compiled to WebAssembly).'
          : 'Check that the bundle is valid JSON and the repo is intact.',
      }, true)
    }
    const v = r.result
    const gate = GATE[v.code] ?? `exit ${v.code}`
    return json({
      verdict: v.verdict,                 // "ACCEPT" | "REJECT"
      exit_code: v.code,                  // 0 ok · 3 structure · 4 reproducibility · 5 performance · 6 anti-overfit
      failed_gate: v.verdict === 'ACCEPT' ? null : gate,
      problem_id: v.problem_id,
      task: v.task,
      checks: v.checks,                   // per-gate detail on ACCEPT
      reason: v.reason,                   // why, on REJECT
      note: v.verdict === 'ACCEPT'
        ? 'This exit-0 re-derivation IS the proof. Commit the bundle to your run repo.'
        : `Rejected at the ${gate} gate — fix the design and verify again.`,
    })
  } finally {
    if (tmp) await unlink(tmp).catch(() => {})
  }
}

async function mintRun({ name, owner, remix, description }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    return json({
      error: 'no GitHub token',
      remediation: 'Set GITHUB_TOKEN (a token with `public_repo` scope) in the connector config / environment, then retry.',
    }, true)
  }
  const gh = (url, init = {}) => fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'quantum-harness-mcp',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })

  let targetOwner = owner
  if (!targetOwner) {
    const me = await gh('https://api.github.com/user')
    if (!me.ok) return json({ error: `token check failed (HTTP ${me.status})`, remediation: 'Confirm the token is valid and has `public_repo` scope.' }, true)
    targetOwner = (await me.json()).login
  }

  const res = await gh(`https://api.github.com/repos/${TEMPLATE.owner}/${TEMPLATE.repo}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      owner: targetOwner,
      name,
      description: description || `quantum-harness run${remix ? ` — remix of ${remix}` : ''}`,
      private: false,
      include_all_branches: false,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    return json({ error: `repo creation failed (HTTP ${res.status})`, detail: body.slice(0, 400) }, true)
  }
  const repo = await res.json()

  // best-effort: tag remixes so the scoreboard auto-discovers the run.
  if (remix) {
    await gh(`https://api.github.com/repos/${repo.full_name}/topics`, {
      method: 'PUT', body: JSON.stringify({ names: ['quantum-harness-run'] }),
    }).catch(() => {})
  }
  return json({
    repo: repo.full_name,
    url: repo.html_url,
    clone_url: repo.clone_url,
    next: `Use the GitHub MCP to clone ${repo.full_name}, then: pick the BRIEF, design a bundle, verify_bundle until ACCEPT, commit, push.`,
  })
}

const IMPL = {
  list_problems: listProblems,
  get_brief: getBrief,
  get_kickoff: getKickoff,
  verify_bundle: verifyBundle,
  mint_run: mintRun,
}

// ---- MCP content helpers -----------------------------------------------------------------

function text(s) { return { content: [{ type: 'text', text: s }] } }
function json(obj, isError = false) { return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError } }

export async function callTool(name, args = {}) {
  const fn = IMPL[name]
  if (!fn) return json({ error: `unknown tool ${name}` }, true)
  try {
    return await fn(args || {})
  } catch (e) {
    return json({ error: `${name} failed`, detail: String(e && e.message || e) }, true)
  }
}

// ---- JSON-RPC 2.0 message handling -------------------------------------------------------

const PROTOCOL = '2024-11-05'

export async function handleMessage(msg) {
  if (msg == null || msg.jsonrpc !== '2.0') return null
  const { id, method, params } = msg
  const reply = result => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, result })
  const fail = (code, message) => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: (params && params.protocolVersion) || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // notifications get no response
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const r = await callTool(params?.name, params?.arguments)
      return reply(r)
    }
    default:
      return fail(-32601, `method not found: ${method}`)
  }
}

// ---- stdio transport (only when run directly) --------------------------------------------

function main() {
  let buf = ''
  let pending = 0
  let ended = false
  const drainAndExit = () => { if (ended && pending === 0) process.exit(0) }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      pending++
      handleMessage(msg)
        .then(res => { if (res) process.stdout.write(JSON.stringify(res) + '\n') })
        .catch(() => {})
        .finally(() => { pending--; drainAndExit() }) // don't exit while a tool call is in flight
    }
  })
  process.stdin.on('end', () => { ended = true; drainAndExit() })
}

if (import.meta.url === `file://${process.argv[1]}`) main()
