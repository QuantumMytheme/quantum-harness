#!/usr/bin/env node
// quantum-harness MCP server — lets the Claude Desktop app drive the harness in-chat:
// list the open problems, read a BRIEF / the KICKOFF, RE-VERIFY a proof bundle through the
// real numpy judge (exit-code truth, not a chat claim), mint a fresh public run repo in the
// GitHub org, and commit the bundle straight to it via the GitHub API — no Docker, no second
// connector, no local git required.
//
// DEPENDENCY-FREE on purpose: raw JSON-RPC 2.0 over newline-delimited stdio, no SDK, no
// npm install — `node mcp/server.mjs` is the whole thing, in keeping with the harness's
// "numpy is the only dependency" ethos. verify_bundle shells out to the project's own
// bench/quantum-judge/judge_verify.py (numpy only); everything else is pure Node.
//
// Tools: list_problems · get_brief · get_kickoff · verify_bundle · mint_run · commit_run
// Setup + the in-chat flow: ../CLAUDE-DESKTOP.md

import { readFile, readdir, writeFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JUDGE = path.join(ROOT, 'bench', 'judge.py')   // unified router → quantum-judge + kernel-judge, dispatched by task
const REFS = path.join(ROOT, 'bench', 'quantum-judge', 'references')
const KERNEL_REFS = path.join(ROOT, 'bench', 'kernel-judge', 'references')
const TEMPLATE = { owner: 'QuantumMytheme', repo: 'quantum-harness' }
const SERVER = { name: 'quantum-harness', version: '0.1.0' }

// exit code -> the gate that fired (mirrors judge_verify.py's contract).
const GATE = { 0: 'accept', 2: 'schema', 3: 'structure', 4: 'reproducibility', 5: 'performance', 6: 'anti-overfit' }

// Unique-per-call temp path. The stdio loop dispatches tool calls without awaiting, so
// two concurrent verify/commit calls can overlap — a constant name would make one call
// judge (or unlink) the other's bundle. pid + timestamp + random = a real nonce.
const tmpPath = (prefix) =>
  path.join(tmpdir(), `${prefix}-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.json`)

// Human labels for the committed problems. The canonical list is the reference directory;
// this only enriches it with a readable one-liner. Unknown ids fall back to their task.
const LABELS = {
  ghz3:       { task: 'state_prep',   label: 'GHZ₃ — prepare the 3-qubit GHZ state under a linear coupling map' },
  ghz3_he:    { task: 'state_prep',   label: 'GHZ₃ HE — the same GHZ target on the native {rz, rx, cz} set (decompose h/cx yourself)' },
  ghz5_line:  { task: 'state_prep',   label: 'GHZ₅ — the 5-qubit GHZ state on a linear [0-1-2-3-4] chain (cascade, no shortcut couplings)' },
  isingbell2: { task: 'vqe',          label: 'Ising Bell — ground state of H = −X₀X₁ − Z₀Z₁' },
  tfim3:      { task: 'vqe',          label: 'TFIM₃ — transverse-field Ising ground state via QAOA p=2' },
  h2vqe:      { task: 'vqe',          label: 'H₂ — molecular ground-state energy (VQE)' },
  mol4:       { task: 'vqe',          label: 'Mol4 — 4-qubit ring TFIM + NNN Hamiltonian, molecular-style VQE headroom' },
  bell_pops2: { task: 'populations',  label: 'Bell |Φ⁺⟩ — populations with a held-out ⟨XX⟩ check' },
  aiaccel4:   { task: 'architecture', label: 'AI-Accel — route a workload over a coupling map within budget' },
  qml_sign1:  { task: 'classify',     label: 'Sign classifier — a feature map that generalizes to held-out points' },
  bellnoisy2: { task: 'state_prep',   label: 'Bell (noisy) — re-verifiable prediction under a depolarizing channel' },
  kernel2:    { task: 'kernel',       label: 'Fidelity kernel — overlap of two encoded points, with a held-out dissimilar pair' },
  // TPU kernel Oracle-Diff Gate (bench/kernel-judge) — routed by task through bench/judge.py.
  gemm_bf16_tile1: { task: 'kernel-correctness-oracle', label: 'Tiled bf16 GEMM — MXU output vs an fp64 reference within the bf16-derived tolerance (Oracle-Diff Gate)' },
  gemm_int8_tile1: { task: 'kernel-correctness-oracle', label: 'Tiled int8 GEMM — bit-exact integer oracle (Oracle-Diff Gate)' },
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
    description: 'Re-derive a proof bundle from scratch through the unified numpy judge (bench/judge.py) — routed by task to the quantum-circuit judge (structure → reproducibility → performance → anti-overfit) or the TPU kernel Oracle-Diff Gate (structure → reproducibility → anti-overfit) — and return ACCEPT/REJECT with the exit code and per-gate detail. This exit code — not any claim in chat — is the result. Loop here until ACCEPT.',
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
        owner: { type: 'string', description: 'target owner (default: the QuantumMytheme org, so results are easy to source; pass your own login to use your account instead)' },
        remix: { type: 'string', description: 'optional problem_id to tag the repo as a remix of the current frontier' },
        description: { type: 'string', description: 'optional repo description' },
      },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'commit_run',
    description: 'Commit a proof bundle to a run repo via the GitHub Contents API — no Docker, no git, no second connector. By default it re-derives the bundle through the judge first and refuses to commit a REJECT. Needs a GitHub token.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'target run repo as "owner/name" (or pass repo_url)' },
        repo_url: { type: 'string', description: 'alternatively, the run repo clone/html URL' },
        bundle: { type: 'object', description: 'the full proof-bundle JSON object' },
        bundle_path: { type: 'string', description: 'alternatively, a path to a bundle .json file on disk' },
        path: { type: 'string', description: 'file path to write in the repo (default: quantum-proof-<problem_id>.json)' },
        message: { type: 'string', description: 'commit message (default: "Add ACCEPTed proof bundle for <problem_id>")' },
        branch: { type: 'string', description: 'target branch (default: the repo default branch)' },
        verify: { type: 'boolean', description: 'judge the bundle and refuse to commit a REJECT (default: true)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mint_recipe',
    description: 'Mint a FULL-STACK design run repo: create a fresh public repo from the template AND write the RECIPE.json (a hardware + software design from the Scenario Studio) into it, so a model can implement the design and the judge can grade the result. Reports whether the named hardware target is referee-pinned (so an efficiency claim on it is attestable). Needs a GitHub token.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'repo name, e.g. "run-fullstack-tfim3-tpu8t"' },
        recipe: { type: 'object', description: 'the full-stack RECIPE.json (schema "quantummytheme/full-stack-recipe@1") — a hardware half (hardware.chips[]) + a software half (target or ingredients)' },
        owner: { type: 'string', description: 'target owner (default: the QuantumMytheme org, so results are easy to source; pass your own login to use your account instead)' },
        description: { type: 'string', description: 'optional repo description' },
      },
      required: ['name', 'recipe'], additionalProperties: false,
    },
  },
]

// ---- tool implementations ----------------------------------------------------------------

async function listProblems() {
  const scan = async dir => (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
  const ids = [...await scan(REFS), ...await scan(KERNEL_REFS)]
  const problems = [...new Set(ids)].sort().map(id => ({
    problem_id: id,
    task: LABELS[id]?.task || 'unknown',
    label: LABELS[id]?.label || `${id} (${LABELS[id]?.task || 'task'})`,
  }))
  return json({ problems, count: problems.length, note: 'Pick one, then call get_brief(problem_id). Quantum problems design a circuit; kernel-correctness-oracle problems attest a TPU kernel bundle.' })
}

const KERNEL_TASKS = new Set(['kernel-correctness-oracle', 'roofline-attest'])

async function getBrief({ problem_id }) {
  const meta = LABELS[problem_id]
  if (!meta) {
    const known = Object.keys(LABELS).join(', ')
    return json({ error: `unknown problem_id ${JSON.stringify(problem_id)}`, known }, true)
  }
  const isKernel = KERNEL_TASKS.has(meta.task)
  const briefFile = isKernel ? path.join(ROOT, 'bench', 'kernel-judge', 'BRIEF.md') : path.join(ROOT, 'BRIEF.md')
  const brief = await readFile(briefFile, 'utf8')
  const intro = isKernel
    ? `You know the target *conceptually* from the line above. The exact input seeds, the held-out ` +
      `seed, and the pinned roofline constants live host-side with the judge and are NOT revealed — ` +
      `design a correct/efficient kernel bundle and let verify_bundle confirm.`
    : `You know the target *conceptually* from the line above. The exact target statevector / ` +
      `Hamiltonian / numeric thresholds live host-side with the judge and are NOT revealed — ` +
      `design to the concept and let verify_bundle confirm.`
  const head =
    `# BRIEF — ${problem_id}\n\n` +
    `**Concept:** ${meta.label}\n` +
    `**Task type:** ${meta.task}\n\n` + intro + `\n\n---\n\n`
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
  // python3 on macOS/Linux, python on Windows — try both (QH_PYTHON overrides).
  const PY = process.env.QH_PYTHON ? [process.env.QH_PYTHON] : ['python3', 'python']
  return new Promise(resolve => {
    const attempt = i => {
      execFile(PY[i], [JUDGE, bundlePath, '--json'], { cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) => {
        const out = (stdout || '').trim()
        if (out) {
          try { return resolve({ ok: true, result: JSON.parse(out.split('\n').pop()) }) } catch { /* fall through */ }
        }
        const msg = `${stderr || ''}${err ? `\n${err.message}` : ''}`.trim()
        const notFound = /ENOENT/.test(msg) || /not found/i.test(msg)
        if (notFound && i + 1 < PY.length) return attempt(i + 1) // this interpreter is absent — try the next
        const missing =
          notFound ? `${PY.join('/')} was not found on PATH` :
          /No module named .?numpy/.test(msg) ? 'numpy is not installed (pip install numpy)' : null
        resolve({ ok: false, missing, msg })
      })
    }
    attempt(0)
  })
}

async function verifyBundle({ bundle, bundle_path }) {
  let bundlePath = bundle_path, tmp = null
  if (!bundlePath) {
    if (!bundle || typeof bundle !== 'object') {
      return json({ error: 'pass either `bundle` (a JSON object) or `bundle_path` (a file path)' }, true)
    }
    tmp = tmpPath('qh-bundle')
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

// Shared GitHub API client — every request is Bearer-authed to api.github.com and nowhere else.
function ghFetch(token, url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'quantum-harness-mcp',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

// New runs land in the QuantumMytheme ORG by default, so every result is easy to
// source (the scoreboard discovers repos tagged in one place). If the caller lacks
// org access, we fall back to their own account — still discoverable via the run topic.
const DEFAULT_OWNER = TEMPLATE.owner   // "QuantumMytheme"

async function generateFromTemplate(gh, owner, name, description) {
  const wanted = owner || DEFAULT_OWNER
  const body = who => JSON.stringify({ owner: who, name, description, private: false, include_all_branches: false })
  const url = `https://api.github.com/repos/${TEMPLATE.owner}/${TEMPLATE.repo}/generate`
  const res = await gh(url, { method: 'POST', body: body(wanted) })
  if (res.ok || owner) return { res, owner: wanted, fellBack: false }   // explicit owner: no fallback
  // default (org) failed with a permission/not-found → retry under the authenticated user
  if ([403, 404, 422].includes(res.status)) {
    const me = await gh('https://api.github.com/user')
    if (me.ok) {
      const login = (await me.json()).login
      if (login && login !== wanted) {
        return { res: await gh(url, { method: 'POST', body: body(login) }), owner: login, fellBack: true }
      }
    }
  }
  return { res, owner: wanted, fellBack: false }
}

async function mintRun({ name, owner, remix, description }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    return json({
      error: 'no GitHub token',
      remediation: 'Set GITHUB_TOKEN (a token with `public_repo` scope) in the connector config / environment, then retry.',
    }, true)
  }
  const gh = (url, init = {}) => ghFetch(token, url, init)

  const gen = await generateFromTemplate(gh, owner, name, description || `quantum-harness run${remix ? ` — remix of ${remix}` : ''}`)
  if (!gen.res.ok) {
    const body = await gen.res.text()
    return json({ error: `repo creation failed (HTTP ${gen.res.status}) under ${gen.owner}`, detail: body.slice(0, 400),
      remediation: 'Confirm the token can create repos in the QuantumMytheme org, or pass owner:"<your-login>" to use your account.' }, true)
  }
  const repo = await gen.res.json()

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
    owner: gen.owner,
    ...(gen.fellBack ? { note: `The QuantumMytheme org was not accessible, so this landed under ${gen.owner} — it still registers on the board via its topic.` } : {}),
    next: `Use the GitHub MCP to clone ${repo.full_name}, then: pick the BRIEF, design a bundle, verify_bundle until ACCEPT, commit, push.`,
  })
}

async function commitRun({ repo, repo_url, bundle, bundle_path, path: filePath, message, branch, verify = true }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    return json({
      error: 'no GitHub token',
      remediation: 'Set GITHUB_TOKEN (a token that can write repo contents) in the connector config / environment, then retry.',
    }, true)
  }

  let slug = repo
  if (!slug && repo_url) {
    const m = repo_url.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
    if (m) slug = `${m[1]}/${m[2]}`
  }
  if (!slug || !slug.includes('/')) {
    return json({ error: 'pass `repo` as "owner/name" (or a GitHub `repo_url`)' }, true)
  }
  const [owner, name] = slug.split('/')

  let bundleText, bundleObj
  if (bundle && typeof bundle === 'object') {
    bundleObj = bundle
    bundleText = JSON.stringify(bundle, null, 2)
  } else if (bundle_path) {
    bundleText = await readFile(bundle_path, 'utf8')
    try { bundleObj = JSON.parse(bundleText) } catch { return json({ error: 'bundle_path is not valid JSON' }, true) }
  } else {
    return json({ error: 'pass either `bundle` (a JSON object) or `bundle_path` (a file path)' }, true)
  }

  // The exit code is the truth: by default re-derive the bundle and refuse to commit a REJECT.
  if (verify) {
    const tmp = tmpPath('qh-commit')
    await writeFile(tmp, bundleText)
    try {
      const r = await runJudge(tmp)
      if (!r.ok) return json({ error: 'could not run the judge to verify before commit', reason: r.missing || r.msg || 'unknown' }, true)
      if (r.result.verdict !== 'ACCEPT') {
        return json({
          error: `refusing to commit a REJECT (failed the ${GATE[r.result.code] ?? `exit ${r.result.code}`} gate)`,
          judge: r.result,
          hint: 'Fix the design, verify_bundle until ACCEPT, then commit — or pass verify:false to override.',
        }, true)
      }
    } finally { await unlink(tmp).catch(() => {}) }
  }

  const problemId = bundleObj.problem_id || 'run'
  const target = filePath || `quantum-proof-${problemId}.json`
  const enc = target.split('/').map(encodeURIComponent).join('/')
  const msg = message || `Add ACCEPTed proof bundle for ${problemId}`

  let ref = branch
  if (!ref) {
    const repoRes = await ghFetch(token, `https://api.github.com/repos/${owner}/${name}`)
    if (!repoRes.ok) return json({ error: `repo lookup failed (HTTP ${repoRes.status})`, remediation: 'Confirm the repo exists and the token can read it.' }, true)
    ref = (await repoRes.json()).default_branch
  }

  // If the file already exists on the branch, its blob sha is required to update it.
  let sha
  const getRes = await ghFetch(token, `https://api.github.com/repos/${owner}/${name}/contents/${enc}?ref=${encodeURIComponent(ref)}`)
  if (getRes.ok) { const cur = await getRes.json(); if (cur && cur.sha) sha = cur.sha }

  const putRes = await ghFetch(token, `https://api.github.com/repos/${owner}/${name}/contents/${enc}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: msg,
      content: Buffer.from(bundleText, 'utf8').toString('base64'),
      branch: ref,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!putRes.ok) {
    const body = await putRes.text()
    return json({ error: `commit failed (HTTP ${putRes.status})`, detail: body.slice(0, 400) }, true)
  }
  const out = await putRes.json()
  return json({
    repo: `${owner}/${name}`,
    path: target,
    branch: ref,
    commit: out.commit?.sha,
    url: out.content?.html_url,
    note: 'Committed via the GitHub Contents API — no Docker, no git, no second connector.',
  })
}

// A full-stack RECIPE.json = a HARDWARE half (chips you'd run on) + a SOFTWARE half
// (the design). `attestable` is true when it names a referee-pinned chip, so an
// efficiency claim on it can be verified — the judge remains the source of truth.
function validateRecipe(r) {
  const errors = []
  if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push('recipe must be a JSON object'); return { ok: false, errors, attestable: false } }
  const hw = r.hardware
  if (!hw || !Array.isArray(hw.chips) || hw.chips.length === 0) errors.push('hardware.chips[] is required — the hardware half of the full stack')
  if (!r.target && !Array.isArray(r.ingredients)) errors.push('a software half is required — set `target` or `ingredients`')
  const attestable = !!(hw && Array.isArray(hw.chips) && hw.chips.some(c => c && c.pinned))
  return { ok: errors.length === 0, errors, attestable }
}

async function mintRecipe({ name, recipe, owner, description }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    return json({ error: 'no GitHub token', remediation: 'Set GITHUB_TOKEN (a token with `public_repo` scope) in the connector config / environment, then retry.' }, true)
  }
  const v = validateRecipe(recipe)
  if (!v.ok) {
    return json({ error: 'invalid RECIPE.json', problems: v.errors, hint: 'A full-stack recipe needs a hardware half (hardware.chips[]) and a software half (target or ingredients).' }, true)
  }
  const gh = (url, init = {}) => ghFetch(token, url, init)

  const gen = await generateFromTemplate(gh, owner, name, description || `full-stack design · ${name}`)
  if (!gen.res.ok) {
    const body = await gen.res.text()
    return json({ error: `repo creation failed (HTTP ${gen.res.status}) under ${gen.owner}`, detail: body.slice(0, 400),
      remediation: 'Confirm the token can create repos in the QuantumMytheme org, or pass owner:"<your-login>" to use your account.' }, true)
  }
  const repo = await gen.res.json()

  // write the RECIPE.json (hardware + software) into the fresh repo
  const content = Buffer.from(JSON.stringify(recipe, null, 2), 'utf8').toString('base64')
  const put = await gh(`https://api.github.com/repos/${repo.full_name}/contents/RECIPE.json`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'Add full-stack RECIPE.json (hardware + software design)', content, branch: repo.default_branch }),
  })
  const wrote = put.ok
  // tag it so the scoreboard auto-discovers the run
  await gh(`https://api.github.com/repos/${repo.full_name}/topics`, { method: 'PUT', body: JSON.stringify({ names: ['quantum-harness-run'] }) }).catch(() => {})

  return json({
    repo: repo.full_name,
    url: repo.html_url,
    owner: gen.owner,
    ...(gen.fellBack ? { note: `The QuantumMytheme org was not accessible, so this landed under ${gen.owner} — still discoverable via its topic.` } : {}),
    recipe_path: wrote ? 'RECIPE.json' : null,
    wrote_recipe: wrote,
    attestable: v.attestable,
    next: `Point your model at ${repo.full_name}: implement the RECIPE.json design, verify_bundle until ACCEPT, then commit. ` +
      (v.attestable
        ? 'The hardware names a referee-pinned generation, so an efficiency (roofline) claim on it is attestable — not just correctness.'
        : 'Note: the named hardware is not referee-pinned, so only correctness is attestable, not an efficiency claim.'),
  })
}

const IMPL = {
  list_problems: listProblems,
  get_brief: getBrief,
  get_kickoff: getKickoff,
  verify_bundle: verifyBundle,
  mint_run: mintRun,
  commit_run: commitRun,
  mint_recipe: mintRecipe,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
