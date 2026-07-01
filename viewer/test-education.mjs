/* test-education.mjs — headless smoke test for the live site's canvas modules.

   Mounts EVERY education.js EDU[...] module (and exercises a theme toggle) against a
   mock DOM + a recording 2D-context, and asserts each one renders without throwing
   and without emitting a non-finite (NaN/Infinity) coordinate. Also sanity-checks the
   Scenario Studio's allocate() logic in knowledge.js. This is the committed, repeatable
   replacement for the throwaway harness — run it before any push that touches viewer/.

   It cannot see an exception the site deliberately swallows at mount, but a module that
   throws on setup draws ~nothing (caught by the min-draw assertion), and a geometry bug
   emits a non-finite coordinate (caught by the NaN assertion) — the two failure modes
   that have actually broken figures before.

   Run:  node viewer/test-education.mjs   (exit 0 = all green)
*/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(HERE, f), 'utf8');

const PASS = '\x1b[32m[PASS]\x1b[0m', FAIL = '\x1b[31m[FAIL]\x1b[0m';
let failures = 0;
function check(name, ok, detail = '') { if (!ok) failures++; if (!ok) console.log(`  ${FAIL} ${name}${detail ? '  — ' + detail : ''}`); }

// ---- discover every module id from the source -------------------------------
const eduSrc = read('education.js');
const ids = [...new Set([...eduSrc.matchAll(/EDU\["([^"]+)"\]\s*=/g)].map(m => m[1]))]
  .filter(id => /^[a-z0-9-]+$/.test(id));   // exclude the "<id>" placeholder in the header comment

// ---- a recording 2D context: counts draws, flags non-finite coordinates ------
const stats = {};
function makeCtx(id) {
  const st = stats[id] = { calls: 0, nan: 0 };
  const num = v => typeof v === 'number';
  const rec = (...a) => { st.calls++; if (a.some(v => num(v) && !isFinite(v))) st.nan++; };
  const grad = { addColorStop() {} };
  return new Proxy({}, { get(_, p) {
    if (p === 'measureText') return t => ({ width: String(t).length * 6 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => grad;
    if (p === 'getImageData') return () => ({ data: [] });
    if (p === 'setLineDash' || p === 'save' || p === 'restore' || p === 'setTransform' || p === 'scale' ||
        p === 'translate' || p === 'rotate' || p === 'beginPath' || p === 'closePath' || p === 'clip' ||
        p === 'fill' || p === 'stroke' || p === 'drawImage') return () => { st.calls++; };
    if (typeof p !== 'string') return () => {};
    return (...args) => rec(...args);           // fillText/rect/moveTo/lineTo/arc/… record coords
  } });
}
function el() {
  const e = { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [],
    textContent: '', type: '', min: '', max: '', step: '', value: '0', className: '',
    appendChild() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {} };
  return e;
}
function makeCanvas(id) {
  const controls = el();
  const c = { getAttribute: a => (a === 'data-edu' ? id : null), __edu: null, width: 0, height: 0,
    clientWidth: 760, clientHeight: 340, style: {}, getContext: () => makeCtx(id),
    addEventListener() {}, removeEventListener() {},
    parentElement: { clientWidth: 760, querySelector: sel => (sel === '.controls' ? controls : null) } };
  return c;
}
const canvases = ids.map(makeCanvas);

// ---- mock browser globals ----------------------------------------------------
const docEl = { _attrs: {}, getAttribute(k) { return this._attrs[k] || null; },
  setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; }, style: {} };
const sandbox = {
  console,
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0,           // do NOT run — reduced-motion path draws statically; avoids reschedule loops
  cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ getPropertyValue: name => (/mono/.test(name) ? 'monospace' : /sans/.test(name) ? 'sans-serif' : /serif/.test(name) ? 'serif' : '#123456') }),
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout: () => 0, clearTimeout: () => {},
};
let moCb = null;
sandbox.MutationObserver = class { constructor(cb) { moCb = cb; } observe() {} disconnect() {} };
sandbox.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(elm) { this.cb([{ target: elm, isIntersecting: true }]); } unobserve() {} disconnect() {} };
sandbox.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {}, removeEventListener() {} }); // reduced-motion on
sandbox.document = {
  documentElement: docEl, readyState: 'complete',
  getElementById: () => null, addEventListener() {}, createElement: el, createElementNS: el,
  querySelector: () => null,
  querySelectorAll: sel => (sel === 'canvas[data-edu]' ? canvases : []),
};
sandbox.window = sandbox;

// ---- run knowledge.js then education.js in the sandbox -----------------------
const ctx = vm.createContext(sandbox);
let bootErr = null;
try {
  vm.runInContext(read('knowledge.js'), ctx, { filename: 'knowledge.js' });
  vm.runInContext(eduSrc, ctx, { filename: 'education.js' });   // IIFE + boot() → mounts all via the IO stub
  if (moCb) { docEl.setAttribute('data-theme', 'dark'); moCb([]); }  // exercise the theme-toggle redraw path
} catch (e) { bootErr = e; }

console.log('education/site smoke test\n');
console.log(`  discovered ${ids.length} education modules; mounted + theme-toggled headlessly`);
check('education.js + knowledge.js boot without throwing', !bootErr, bootErr && bootErr.message);

let mounted = 0, nan = 0, empty = [];
for (const id of ids) {
  const s = stats[id] || { calls: 0, nan: 0 };
  if (s.calls > 0) mounted++; else empty.push(id);
  if (s.nan > 0) { nan++; check(`module "${id}" emits only finite coordinates`, false, `${s.nan} non-finite`); }
}
check(`all ${ids.length} modules drew (none threw on mount)`, empty.length === 0, empty.length ? 'no draws: ' + empty.join(', ') : '');
check('no module emitted a non-finite coordinate', nan === 0);

// ---- Scenario Studio allocate() sanity --------------------------------------
const K = sandbox.window.QMKnowledge;
check('knowledge.js exposes allocate() + SUBSTRATES + WORKLOADS', !!(K && K.allocate && K.SUBSTRATES && K.WORKLOADS));
if (K && K.allocate) {
  const t = K.allocate({ tpu: true, qpu: true, cpu: true }, 'transformer-infer');
  const tpuDense = t.roles.find(r => r.substrate === 'tpu' && r.role === 'matmul-dense');
  const qpuIdle = t.roles.find(r => r.substrate === 'qpu' && r.role === 'idle');
  const incumbent = t.honesty.some(h => h.tone === 'incumbent');
  const quantumFlag = t.honesty.some(h => h.tone === 'quantum');
  check('transformer+TPU+QPU: TPU is the dense matmul engine', !!tpuDense);
  check('transformer+QPU: the quantum chip is idle (does not accelerate inference)', !!qpuIdle);
  check('transformer: flags most-used≠best AND the quantum reality', incumbent && quantumFlag);
  const m = K.allocate({ tpu: true, qpu: true, cpu: true }, 'materials-sim');
  const qpuSim = m.roles.find(r => r.substrate === 'qpu' && r.role === 'quantum-sim');
  check('materials-sim: the quantum chip becomes the simulation co-processor', !!qpuSim);
}

const total = failures === 0;
console.log(`\n  ${mounted}/${ids.length} modules rendered · ${failures} failing check(s)`);
console.log(total ? `\n${PASS.replace('PASS', 'OK')} education/site smoke test green` : `\n${FAIL} smoke test found problems`);
process.exit(total ? 0 : 1);
