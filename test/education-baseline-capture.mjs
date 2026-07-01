/* education-baseline-capture.mjs — (re)capture the canvas call-sequence baseline for
 * viewer/education.js. Run this ONLY when a deliberate, reviewed visual change lands:
 *
 *   node test/education-baseline-capture.mjs
 *
 * Writes:
 *   test/fixtures/education-baseline.json   (committed — per-module sequence hashes)
 *   $TMPDIR/education-baseline-full.json    (local debugging aid — full op streams,
 *                                            used by education-equiv.test.mjs to print
 *                                            the exact first divergent op on failure)
 *
 * Captures twice and verifies the two runs are identical before writing, so a
 * nondeterministic harness can never be baselined.
 */
import fs from 'node:fs';
import path from 'node:path';
import { capture, summarize, FIXTURE_PATH, FULL_DUMP_PATH } from './education-equiv-lib.mjs';

const full1 = capture();
const full2 = capture();
const sum1 = summarize(full1);
const sum2 = summarize(full2);

if (JSON.stringify(sum1) !== JSON.stringify(sum2)) {
  console.error('FATAL: two capture runs differ — the harness is nondeterministic; refusing to baseline.');
  for (const pass of Object.keys(sum1)) {
    for (const id of Object.keys(sum1[pass])) {
      if (JSON.stringify(sum1[pass][id]) !== JSON.stringify(sum2[pass][id])) console.error(`  differs: [${pass}] ${id}`);
    }
  }
  process.exit(1);
}

fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
fs.writeFileSync(FIXTURE_PATH, JSON.stringify({
  note: 'Per-module canvas call-sequence hashes for viewer/education.js. Regenerate ONLY on a deliberate visual change: node test/education-baseline-capture.mjs',
  passes: sum1,
}, null, 1) + '\n');
fs.writeFileSync(FULL_DUMP_PATH, JSON.stringify(full1));

let modules = 0, ops = 0;
for (const pass of Object.keys(full1)) {
  for (const id of Object.keys(full1[pass])) { modules++; ops += full1[pass][id].ops.length; }
}
console.log(`baseline captured: ${Object.keys(sum1.rm).length} modules x ${Object.keys(sum1).length} passes, ${ops} total ops (deterministic across 2 runs)`);
console.log(`  fixture:   ${FIXTURE_PATH}`);
console.log(`  full dump: ${FULL_DUMP_PATH}`);
