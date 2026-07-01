/* education-equiv.test.mjs — pixel-behavior equivalence net for viewer/education.js.
 *
 * Replays every EDU module (mount, rAF frames, theme flips + refits, every control
 * handler, every canvas pointer handler) in the deterministic recording harness
 * (education-equiv-lib.mjs) and asserts each module's full canvas call sequence,
 * final controls DOM, and canvas style/attrs hash-match the committed baseline.
 *
 * Any refactor of education.js must keep every one of these green. If a DELIBERATE
 * visual change lands, re-baseline with: node test/education-baseline-capture.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { capture, summarize, firstDiff, FIXTURE_PATH, FULL_DUMP_PATH } from './education-equiv-lib.mjs';

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const full = capture();
const now = summarize(full);

let baselineFull = null;
try { baselineFull = JSON.parse(fs.readFileSync(FULL_DUMP_PATH, 'utf8')); } catch { /* debugging aid only */ }

test('education equivalence: module set matches the baseline', () => {
  for (const pass of Object.keys(fixture.passes)) {
    assert.deepEqual(Object.keys(now[pass] || {}).sort(), Object.keys(fixture.passes[pass]).sort(),
      `module set changed in pass "${pass}" — re-baseline deliberately if a module was added/removed`);
  }
});

for (const pass of Object.keys(fixture.passes)) {
  for (const id of Object.keys(fixture.passes[pass])) {
    test(`education equiv [${pass}] ${id}`, () => {
      const want = fixture.passes[pass][id];
      const got = now[pass] && now[pass][id];
      assert.ok(got, `module "${id}" missing from pass "${pass}"`);
      if (got.h !== want.h) {
        let detail = `canvas call sequence changed (${want.ops} -> ${got.ops} ops).`;
        if (baselineFull && baselineFull[pass] && baselineFull[pass][id]) {
          detail += '\n' + firstDiff(baselineFull[pass][id].ops, full[pass][id].ops);
        } else {
          detail += ` (no full baseline dump at ${FULL_DUMP_PATH} — regenerate one from the pre-change code to see the exact op)`;
        }
        assert.fail(detail);
      }
      assert.equal(got.ch, want.ch, 'controls DOM snapshot changed (buttons/sliders/labels/listeners)');
      assert.equal(got.cv, want.cv, 'canvas style/attribute snapshot changed');
      assert.equal(got.ops, want.ops, 'op count changed');
    });
  }
}
