#!/usr/bin/env node
// qh-push — mint (optional) + verify + commit a proof bundle to a run repo, using the harness's
// own MCP tools over the GitHub API. No Docker, no git, no second connector. Cross-platform.
//
//   node bin/qh-push.mjs --bundle ghz3.json --repo you/run-ghz3-2026-06-16
//   node bin/qh-push.mjs --bundle ghz3.json --mint run-ghz3-2026-06-16      # create repo, then commit
//
// Auth: GITHUB_TOKEN (or GH_TOKEN) in the environment, or --token. The token only ever reaches
// api.github.com (see SECURITY.md). commit_run re-verifies through the judge and refuses a REJECT.

import { callTool } from '../mcp/server.mjs'

const args = parseArgs(process.argv.slice(2))
if (args.help || !args.bundle) { usage(); process.exit(args.help ? 0 : 1) }
if (args.token) process.env.GITHUB_TOKEN = String(args.token)
if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) die('no token — set GITHUB_TOKEN / GH_TOKEN, or pass --token.')

let repo = args.repo
if (args.mint) {
  const r = unwrap(await callTool('mint_run', { name: String(args.mint), owner: args.owner, remix: args.remix }), 'mint_run')
  repo = r.repo
  console.log(`minted     ${r.repo}  ${r.url}`)
}
if (!repo) die('need --repo owner/name (or --mint <name>).')

const c = unwrap(await callTool('commit_run', {
  repo,
  bundle_path: String(args.bundle),
  path: args.path,
  message: args.message,
  branch: args.branch,
  verify: !args['no-verify'],
}), 'commit_run')
console.log(`committed  ${c.repo}/${c.path}  ->  ${c.url || c.branch}`)

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '-h' || t === '--help') { a.help = true; continue }
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) a[key] = true
      else { a[key] = next; i++ }
    }
  }
  return a
}
function unwrap(res, tool) {
  let obj
  try { obj = JSON.parse(res.content[0].text) } catch { die(`${tool}: could not parse response`) }
  if (res.isError) {
    const extra = obj.detail || obj.reason || obj.remediation || ''
    die(`${tool}: ${obj.error || 'failed'}${extra ? ` — ${extra}` : ''}`)
  }
  return obj
}
function die(m) { console.error(`qh-push: ${m}`); process.exit(1) }
function usage() {
  console.log(`qh-push — commit a proof bundle to a run repo (no Docker, no git)

  node bin/qh-push.mjs --bundle <file> (--repo owner/name | --mint <name>) [options]

Options:
  --bundle <file>     ACCEPTed proof-bundle .json (required)
  --repo owner/name   existing run repo to commit to
  --mint <name>       create the run repo from the template first, then commit
  --owner <login>     owner for --mint (default: the token's user)
  --path <file>       path in the repo (default: quantum-proof-<problem_id>.json)
  --branch <name>     target branch (default: the repo default branch)
  --message <msg>     commit message
  --no-verify         skip the judge re-verification (not recommended)
  --token <pat>       GitHub token (else GITHUB_TOKEN / GH_TOKEN)
`)
}
