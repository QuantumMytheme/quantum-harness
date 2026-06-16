// Transcript scrubber — redacts secret VALUES from Claude Code JSONL
// transcripts while preserving JSONL structure (rubric S6, checklist E7).
// Implemented test-first; see test/prepare-transcript.test.mjs.
//
// Design notes:
// - Lines are scrubbed individually so the line count (and thus JSONL
//   structure) can never change. Markers contain no quotes/backslashes, so
//   substituting them inside JSON string values keeps every line parseable.
// - Kind labels keep the secret's own prefix (e.g. [REDACTED:cfut_]) so the
//   scorecard's new-information classifier still fires on scrubbed
//   transcripts — scrubbing must not silently reclassify interventions.
// - Bare prefixes in prose (e.g. "sk_live_" with <8 trailing word chars) are
//   deliberately NOT redacted: they are vocabulary, not secrets.
// - Patterns are ordered so the more specific token wins (github_pat_ before
//   ghp_) and Bearer runs last so an already-redacted token isn't re-counted
//   (the marker's brackets fall outside Bearer's character class).

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

export const PATTERNS = [
  { kind: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, sub: '[REDACTED:pem]' },
  { kind: 'github_pat_', re: /github_pat_[\w_]{8,}/g, sub: '[REDACTED:github_pat_]' },
  { kind: 'sk_live_', re: /sk_live_\w{8,}/g, sub: '[REDACTED:sk_live_]' },
  { kind: 'sk_test_', re: /sk_test_\w{8,}/g, sub: '[REDACTED:sk_test_]' },
  { kind: 'sk-ant-', re: /sk-ant-[\w-]{8,}/g, sub: '[REDACTED:sk-ant-]' },
  { kind: 'ghp_', re: /ghp_\w{8,}/g, sub: '[REDACTED:ghp_]' },
  { kind: 'cfut_', re: /cfut_\w{8,}/g, sub: '[REDACTED:cfut_]' },
  { kind: 'AKIA', re: /AKIA[0-9A-Z]{16}/g, sub: '[REDACTED:AKIA]' },
  { kind: 'bearer', re: /Bearer [A-Za-z0-9._\-]{20,}/g, sub: 'Bearer [REDACTED:bearer]' },
]

export function scrubLine(line) {
  const counts = {}
  let out = String(line)
  for (const { kind, re, sub } of PATTERNS) {
    out = out.replace(re, () => {
      counts[kind] = (counts[kind] || 0) + 1
      return sub
    })
  }
  return { line: out, counts }
}

export function scrubText(text) {
  const raw = String(text).split('\n')
  if (raw.length && raw[raw.length - 1] === '') raw.pop() // trailing newline
  const counts = {}
  const lines = raw.map(l => {
    const r = scrubLine(l)
    for (const [k, n] of Object.entries(r.counts)) counts[k] = (counts[k] || 0) + n
    return r.line
  })
  return { text: lines.join('\n') + (lines.length ? '\n' : ''), lines, counts }
}

// Split at line boundaries so every part stays <= maxBytes; a single line
// larger than maxBytes becomes its own part (a JSONL line cannot be split
// without destroying the structure the scrubber promises to preserve).
export function partitionLines(lines, maxBytes) {
  const parts = []
  let cur = []
  let curBytes = 0
  for (const line of lines) {
    const b = Buffer.byteLength(line, 'utf8') + 1 // + newline
    if (cur.length > 0 && curBytes + b > maxBytes) {
      parts.push(cur)
      cur = []
      curBytes = 0
    }
    cur.push(line)
    curBytes += b
  }
  if (cur.length) parts.push(cur)
  return parts
}

export function prepare({ inputs, outDir, maxBytes = DEFAULT_MAX_BYTES }) {
  fs.mkdirSync(outDir, { recursive: true })
  const totals = Object.fromEntries(PATTERNS.map(p => [p.kind, 0]))
  const files = []
  let anySplit = false
  const usedNames = new Set()

  for (const input of inputs) {
    const base = path.basename(input)
    if (usedNames.has(base)) throw new Error(`duplicate input basename would overwrite output: ${base}`)
    usedNames.add(base)

    const { text, lines, counts } = scrubText(fs.readFileSync(input, 'utf8'))
    for (const [k, n] of Object.entries(counts)) totals[k] += n
    const bytes = Buffer.byteLength(text, 'utf8')

    let outputs
    if (bytes > maxBytes) {
      anySplit = true
      const ext = path.extname(base)
      const stem = ext ? base.slice(0, -ext.length) : base
      outputs = partitionLines(lines, maxBytes).map((part, i) => {
        const f = path.join(outDir, `${stem}-part${i + 1}${ext}`)
        fs.writeFileSync(f, part.join('\n') + '\n')
        return path.resolve(f)
      })
    } else {
      const f = path.join(outDir, base)
      fs.writeFileSync(f, text)
      outputs = [path.resolve(f)]
    }

    files.push({ input: path.resolve(input), outputs, lines: lines.length, bytes })
  }

  const report = {
    files,
    redactions: PATTERNS.map(p => ({ kind: p.kind, count: totals[p.kind] })),
    split: anySplit,
  }
  fs.writeFileSync(path.join(outDir, 'scrub-report.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}
