#!/usr/bin/env node
// selftest — prove the connector actually works on THIS machine, the same way Claude Desktop
// launches it: spawn `node server.mjs`, speak JSON-RPC 2.0 over stdio, and re-derive a known-good
// bundle through the real numpy judge. Pure Node, no shell — runs identically on Windows/macOS/Linux.
//
//   node mcp/selftest.mjs        # prints PASS/FAIL, exits 0 (ok) or 1 (problem)
//
// This is the cross-platform replacement for the old `printf … | node` snippet (which can't run
// on Windows) — and it catches the class of bug where the stdio loop never starts, e.g. a
// POSIX-only entry-point guard that silently no-ops on Windows.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const BUNDLE = 'bench/quantum-judge/quantum-proof-h2.json'   // resolved by the judge against repo root
const TIMEOUT_MS = 30_000

let failures = 0
const pass = m => console.log(`  PASS  ${m}`)
const fail = m => { console.log(`  FAIL  ${m}`); failures++ }

console.log('quantum-harness connector self-test\n')

// 1) runtime
const nodeMajor = Number(process.versions.node.split('.')[0])
nodeMajor >= 18
  ? pass(`Node ${process.versions.node} (>= 18)`)
  : fail(`Node ${process.versions.node} is too old — the connector needs Node >= 18`)

// 2) drive the server over stdio, exactly like the Desktop app does
const responses = await driveServer([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_bundle', arguments: { bundle_path: BUNDLE } } },
])

const init = responses.find(r => r.id === 1)
init?.result?.serverInfo?.name === 'quantum-harness'
  ? pass('initialize handshake — the stdio server started and answered')
  : fail('no initialize response — the stdio server never answered (entry-point / startup bug?)')

const list = responses.find(r => r.id === 2)
const tools = list?.result?.tools?.map(t => t.name) ?? []
tools.length ? pass(`tools/list -> ${tools.join(', ')}`) : fail('tools/list returned nothing')

const ver = responses.find(r => r.id === 3)
let verdict = null
try { verdict = JSON.parse(ver.result.content[0].text).verdict } catch { /* leave null */ }
if (verdict === 'ACCEPT') pass('verify_bundle ACCEPT — the numpy judge ran and re-derived the bundle')
else if (ver && /python|numpy/i.test(JSON.stringify(ver))) fail('the judge could not run — install python3 + numpy (pip install numpy)')
else fail(`verify_bundle did not ACCEPT (got: ${verdict ?? 'no/invalid response'})`)

console.log('')
if (failures) { console.log(`SELFTEST FAILED — ${failures} check(s) failed.`); process.exit(1) }
console.log('SELFTEST PASSED — the connector is ready for Claude Desktop.')
process.exit(0)

function driveServer(messages) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = '', done = false
    const out = []
    const finish = () => { if (done) return; done = true; clearTimeout(timer); try { child.kill() } catch { /* ignore */ } resolve(out) }
    const timer = setTimeout(() => { console.log(`  ....  (timed out after ${TIMEOUT_MS / 1000}s waiting for the server)`); finish() }, TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (line) { try { out.push(JSON.parse(line)) } catch { /* ignore non-JSON */ } }
      }
      if (out.some(r => r.id === 3)) finish()   // got the final reply — done early
    })
    child.on('error', e => { console.log(`  FAIL  could not spawn node: ${e.message}`); finish() })
    child.on('close', () => finish())
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n')
    child.stdin.end()
  })
}
