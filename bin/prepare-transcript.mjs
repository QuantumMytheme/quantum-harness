#!/usr/bin/env node
// Transcript scrubber CLI — prepares Claude Code JSONL transcripts for
// judge-facing artifacts: redacts secret values (preserving JSONL structure),
// splits oversized outputs at line boundaries, and emits scrub-report.json.
//
// usage: node bin/prepare-transcript.mjs <transcript.jsonl...> --out-dir DIR \
//          [--max-bytes N]   (N defaults to 50MB; override is for testing)

import path from 'node:path'
import { prepare, DEFAULT_MAX_BYTES } from '../lib/prepare-transcript.mjs'

const argv = process.argv.slice(2)
function flag(name, dflt) {
  const i = argv.indexOf(name)
  if (i === -1) return dflt
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}

const outDir = flag('--out-dir', null)
const maxBytes = Number(flag('--max-bytes', DEFAULT_MAX_BYTES))
const files = argv.filter(a => !a.startsWith('--'))

if (!outDir || files.length === 0 || !Number.isFinite(maxBytes) || maxBytes <= 0) {
  console.error('usage: prepare-transcript.mjs <transcript.jsonl...> --out-dir DIR [--max-bytes N]')
  process.exit(2)
}

const report = prepare({ inputs: files, outDir, maxBytes })

const total = report.redactions.reduce((s, r) => s + r.count, 0)
const detail = report.redactions
  .filter(r => r.count > 0)
  .map(r => `${r.kind}=${r.count}`)
  .join(' ')
console.log(path.join(outDir, 'scrub-report.json'))
console.log(
  `  ${total} redaction${total === 1 ? '' : 's'} across ${report.files.length} file(s)` +
    `${report.split ? ' (split for size)' : ''}${detail ? ': ' + detail : ''}`
)
