#!/usr/bin/env node
// Autonomy scorecard CLI — computes the session autonomy evidence page from
// raw Claude Code transcripts. Judges can rerun this; nothing is hand-written.
//
// usage: node bin/autonomy-scorecard.mjs <transcript.jsonl...> \
//          [--out autonomy-scorecard.html] [--title "..."] [--tags tags.json]
//
// --tags: optional hand-tag override file mapping intervention index (0-based)
//         or message uuid -> class (approval-gate | new-information |
//         course-correction). Overrides are marked "hand-tagged" in the output.

import fs from 'node:fs'
import { parseTranscript, buildReport, renderHTML } from '../lib/scorecard.mjs'

const argv = process.argv.slice(2)
function flag(name, dflt) {
  const i = argv.indexOf(name)
  if (i === -1) return dflt
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}

const out = flag('--out', 'autonomy-scorecard.html')
const title = flag('--title', 'Autonomy Scorecard')
const tagsPath = flag('--tags', null)
const files = argv.filter(a => !a.startsWith('--'))

if (files.length === 0) {
  console.error('usage: autonomy-scorecard.mjs <transcript.jsonl...> [--out file.html] [--title "..."] [--tags tags.json]')
  process.exit(2)
}

const overrides = tagsPath ? JSON.parse(fs.readFileSync(tagsPath, 'utf8')) : {}

const events = []
for (const f of files) {
  events.push(...parseTranscript(fs.readFileSync(f, 'utf8')))
}

const report = buildReport(events, { title, overrides })
fs.writeFileSync(out, renderHTML(report))

const iv = report.interventions
console.log(`${out}`)
console.log(
  `  ${iv.length} interventions (${iv.filter(i => i.class === 'approval-gate').length} approval-gate) · ` +
    `longest unattended ${Math.round(report.stretch.ms / 60000)}m · ` +
    `${report.selfCaught.length} self-caught failures · ` +
    `${report.scale.subagentSpawns + report.scale.workflowRuns} agents orchestrated`
)
