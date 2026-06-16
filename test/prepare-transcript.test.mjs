import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrubLine, scrubText, partitionLines, prepare } from '../lib/prepare-transcript.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(here, '..', 'bin', 'prepare-transcript.mjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'))

// --------------------------------------------------------------------------
// Redaction
// --------------------------------------------------------------------------

test('scrubLine redacts long sk_live_ values and counts them', () => {
  const { line, counts } = scrubLine('the key is sk_live_AbCdEf1234567890XyZ ok')
  assert.equal(line, 'the key is [REDACTED:sk_live_] ok')
  assert.equal(counts.sk_live_, 1)
})

test('bare prefixes and short fixtures are NOT redacted', () => {
  const src = 'mention sk_live_ in prose and a short fixture sk_live_abc123 here'
  const { line, counts } = scrubLine(src)
  assert.equal(line, src)
  assert.equal(counts.sk_live_ ?? 0, 0)
})

test('every token kind is redacted with its own marker', () => {
  const cases = [
    ['sk_test_abcdefgh12345', '[REDACTED:sk_test_]', 'sk_test_'],
    ['sk-ant-api03-AbC-123xyz', '[REDACTED:sk-ant-]', 'sk-ant-'],
    ['ghp_AbCdEfGh123456', '[REDACTED:ghp_]', 'ghp_'],
    ['github_pat_11ABCDEF0_abcdef', '[REDACTED:github_pat_]', 'github_pat_'],
    ['cfut_TestFixtureabcdef', '[REDACTED:cfut_]', 'cfut_'],
    ['AKIAIOSFODNN7EXAMPLE', '[REDACTED:AKIA]', 'AKIA'],
  ]
  for (const [token, marker, kind] of cases) {
    const { line, counts } = scrubLine(`x ${token} y`)
    assert.equal(line, `x ${marker} y`, `${kind} marker`)
    assert.equal(counts[kind], 1, `${kind} count`)
  }
})

test('Bearer tokens of 20+ chars are redacted, keeping the Bearer marker', () => {
  const { line, counts } = scrubLine('Authorization: Bearer abcdefghij.KLMNOP-qrstuv_123')
  assert.equal(line, 'Authorization: Bearer [REDACTED:bearer]')
  assert.equal(counts.bearer, 1)
  // short bearer (under 20 chars) stays
  const short = scrubLine('Authorization: Bearer shorttoken123')
  assert.equal(short.line, 'Authorization: Bearer shorttoken123')
})

test('AKIA requires exactly 16 trailing [0-9A-Z] chars', () => {
  const short = scrubLine('AKIAIOSFODNN7EXAMP') // AKIA + 14
  assert.equal(short.line, 'AKIAIOSFODNN7EXAMP')
  const full = scrubLine('AKIAIOSFODNN7EXAMPLE') // AKIA + 16
  assert.equal(full.line, '[REDACTED:AKIA]')
})

test('PEM private-key blocks inside JSON strings are redacted and the JSON still parses', () => {
  const obj = {
    type: 'user',
    message: {
      content: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\nhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
    },
  }
  const raw = JSON.stringify(obj) // PEM newlines become literal \n escapes on one line
  const { line, counts } = scrubLine(raw)
  assert.equal(counts.pem, 1)
  assert.ok(line.includes('[REDACTED:pem]'))
  assert.ok(!line.includes('MIIEvQIBADANBgkq'))
  const parsed = JSON.parse(line)
  assert.equal(parsed.message.content, '[REDACTED:pem]')
})

test('RSA/OPENSSH PEM variants are also redacted', () => {
  const { line } = scrubLine('-----BEGIN RSA PRIVATE KEY-----\\nQUJD\\n-----END RSA PRIVATE KEY-----')
  assert.equal(line, '[REDACTED:pem]')
})

test('github_pat_ tokens are not double-counted as ghp_', () => {
  const { counts } = scrubLine('token github_pat_11ABCDEF0_abcdefGHIJ')
  assert.equal(counts.github_pat_, 1)
  assert.equal(counts.ghp_ ?? 0, 0)
})

test('scrubText preserves line count and per-line JSON validity', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'use sk_live_AbCdEf1234567890 now' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'cfut_TestFixtureabcdef and ghp_AbCdEfGh123456' }] } }),
    JSON.stringify({ type: 'user', message: { content: 'clean line' } }),
  ]
  const { text, counts } = scrubText(lines.join('\n') + '\n')
  const out = text.split('\n').filter(l => l !== '')
  assert.equal(out.length, 3)
  for (const l of out) JSON.parse(l) // throws if structure broken
  assert.equal(counts.sk_live_, 1)
  assert.equal(counts.cfut_, 1)
  assert.equal(counts.ghp_, 1)
  assert.ok(!text.includes('sk_live_AbCdEf1234567890'))
})

test('scrubText counts multiple occurrences of the same kind', () => {
  const { counts } = scrubText('cfut_aaaaaaaa11\ncfut_bbbbbbbb22 cfut_cccccccc33\n')
  assert.equal(counts.cfut_, 3)
})

// --------------------------------------------------------------------------
// Size guard / splitting
// --------------------------------------------------------------------------

test('partitionLines splits at line boundaries, parts under maxBytes', () => {
  const lines = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
  const parts = partitionLines(lines, 100)
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0], [lines[0], lines[1]]) // 41+41=82 <= 100
  assert.deepEqual(parts[1], [lines[2]])
  // every line survives exactly once, in order
  assert.deepEqual(parts.flat(), lines)
})

test('partitionLines never splits a single oversized line', () => {
  const lines = ['x'.repeat(500), 'y'.repeat(10)]
  const parts = partitionLines(lines, 100)
  assert.deepEqual(parts.flat(), lines)
  assert.deepEqual(parts[0], [lines[0]]) // oversize line is its own part
})

// --------------------------------------------------------------------------
// prepare() — end-to-end file handling + scrub-report.json
// --------------------------------------------------------------------------

test('prepare writes a scrubbed file (same basename) + scrub-report.json, no split under limit', () => {
  const dir = tmp()
  const input = path.join(dir, 'session.jsonl')
  fs.writeFileSync(
    input,
    [
      JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'key sk_live_AbCdEf1234567890 and cfut_TestFixtureabcdef' } }),
      JSON.stringify({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'ok' }] } }),
    ].join('\n') + '\n'
  )
  const outDir = path.join(dir, 'out')
  const report = prepare({ inputs: [input], outDir })

  const outFile = path.join(outDir, 'session.jsonl')
  assert.ok(fs.existsSync(outFile), 'scrubbed file written')
  const scrubbed = fs.readFileSync(outFile, 'utf8')
  assert.ok(!scrubbed.includes('sk_live_AbCdEf1234567890'))
  assert.ok(scrubbed.includes('[REDACTED:sk_live_]'))
  assert.ok(scrubbed.includes('[REDACTED:cfut_]'))

  // report shape
  assert.equal(report.split, false)
  assert.equal(report.files.length, 1)
  assert.equal(report.files[0].input, path.resolve(input))
  assert.deepEqual(report.files[0].outputs, [path.resolve(outFile)])
  assert.ok(Array.isArray(report.redactions))
  const byKind = Object.fromEntries(report.redactions.map(r => [r.kind, r.count]))
  assert.equal(byKind.sk_live_, 1)
  assert.equal(byKind.cfut_, 1)

  // scrub-report.json on disk matches
  const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'scrub-report.json'), 'utf8'))
  assert.deepEqual(onDisk, report)
})

test('prepare splits oversized outputs into -part1/-part2 at line boundaries and flags split', () => {
  const dir = tmp()
  const input = path.join(dir, 'big.jsonl')
  const lines = Array.from({ length: 6 }, (_, i) =>
    JSON.stringify({ type: 'user', uuid: `u${i}`, message: { content: 'z'.repeat(60) } })
  )
  fs.writeFileSync(input, lines.join('\n') + '\n')
  const outDir = path.join(dir, 'out')
  const report = prepare({ inputs: [input], outDir, maxBytes: 300 })

  assert.equal(report.split, true)
  const outputs = report.files[0].outputs
  assert.ok(outputs.length >= 2, 'split into multiple parts')
  assert.equal(path.basename(outputs[0]), 'big-part1.jsonl')
  assert.equal(path.basename(outputs[1]), 'big-part2.jsonl')
  // concatenation of parts == all original lines, in order, each still valid JSON
  const rejoined = outputs
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('')
    .split('\n')
    .filter(l => l !== '')
  assert.deepEqual(rejoined, lines)
  for (const f of outputs) {
    assert.ok(fs.statSync(f).size <= 300, `${path.basename(f)} under maxBytes`)
  }
})

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

test('CLI scrubs transcripts into --out-dir and prints the scrub-report path', () => {
  const dir = tmp()
  const input = path.join(dir, 't.jsonl')
  fs.writeFileSync(
    input,
    JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'token ghp_AbCdEfGh123456 here' } }) + '\n'
  )
  const outDir = path.join(dir, 'scrubbed')
  const stdout = execFileSync('node', [BIN, input, '--out-dir', outDir], { encoding: 'utf8' })
  assert.match(stdout, /scrub-report\.json/)
  const scrubbed = fs.readFileSync(path.join(outDir, 't.jsonl'), 'utf8')
  assert.ok(!scrubbed.includes('ghp_AbCdEfGh123456'))
  assert.ok(scrubbed.includes('[REDACTED:ghp_]'))
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'scrub-report.json'), 'utf8'))
  assert.equal(report.redactions.find(r => r.kind === 'ghp_').count, 1)
})

test('CLI exits non-zero with usage when files or --out-dir are missing', () => {
  for (const args of [[], [path.join(tmp(), 'nope.jsonl')]]) {
    let failed = false
    try {
      execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      failed = true
      assert.match(String(e.stderr), /usage/i)
    }
    assert.ok(failed, `should exit non-zero for args: ${JSON.stringify(args)}`)
  }
})
