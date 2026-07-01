/* education-equiv-lib.mjs — canvas call-sequence equivalence engine for viewer/education.js.
 *
 * Purpose: make the "conciseness refactor" of education.js provably behavior-preserving.
 * It mounts EVERY EDU module in a deterministic stub DOM with a RECORDING 2D context
 * that captures the full ordered sequence of canvas API calls (method + serialized args)
 * AND property writes (fillStyle, font, textAlign, …), then exercises:
 *
 *   mount → 2 rAF frames → theme flip (dark) + refit → 2 rAF frames →
 *   every control's click/input/change handlers → every canvas pointer/mouse/touch
 *   handler → 2 rAF frames → theme flip back (paper) → 1 rAF frame
 *
 * …under BOTH reduced-motion (true/false) passes. All entropy is frozen
 * (Math.random seeded LCG, Date.now/performance.now constant, fixed rAF timestamps,
 * theme-dependent deterministic CSS var colors), so two runs of identical code produce
 * byte-identical op streams. A refactor is accepted only if every module's op stream,
 * final controls-DOM snapshot, and canvas style/attr snapshot hash-match the committed
 * baseline (test/fixtures/education-baseline.json).
 *
 * getContext() returns ONE cached context per canvas — faithful to real browsers,
 * where the 2D context object is a per-canvas singleton.
 */
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const read = f => fs.readFileSync(path.join(VIEWER, f), 'utf8');

export const FIXTURE_PATH = path.join(HERE, 'fixtures', 'education-baseline.json');
export const FULL_DUMP_PATH = process.env.EDU_BASELINE_FULL ||
  path.join(os.tmpdir(), 'education-baseline-full.json');

// ---- serialization -----------------------------------------------------------
function ser(v) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : `<${String(v)}>`;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'undefined') return '<undef>';
  if (t === 'function') return '<fn>';
  if (Array.isArray(v)) return v.map(ser);
  if (t === 'object') return v.__tag || '<obj>';
  return String(v);
}

// ---- recording 2D context ------------------------------------------------------
function makeRecCtx(log) {
  const store = {};
  let gradN = 0;
  return new Proxy(store, {
    get(t, p) {
      if (typeof p !== 'string') return undefined;
      if (p === '__isRecCtx') return true;
      if (p === 'measureText') return s => ({ width: String(s).length * 6 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createConicGradient') {
        return (...a) => {
          const tag = `<grad${gradN++}>`;
          log.push(['call', p, ser(a)]);
          return { __tag: tag, addColorStop: (o, c) => log.push(['call', `${tag}.addColorStop`, [ser(o), ser(c)]]) };
        };
      }
      if (p === 'createPattern') return () => { log.push(['call', p, ['<pattern-src>']]); return { __tag: '<pattern>' }; };
      if (p === 'getImageData') return (...a) => { log.push(['call', p, ser(a)]); return { data: [], width: 0, height: 0 }; };
      if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (Object.prototype.hasOwnProperty.call(t, p)) return t[p]; // read back a previously-set property
      return (...a) => { log.push(['call', p, ser(a)]); };
    },
    set(t, p, v) { t[p] = v; log.push(['set', p, ser(v)]); return true; },
  });
}

// ---- stub elements -------------------------------------------------------------
const PROPS = ['className', 'textContent', 'type', 'min', 'max', 'step', 'value', 'title',
  'disabled', 'checked', 'id', 'name', 'htmlFor', 'innerHTML', 'tabIndex', 'placeholder'];

function makeEl(tag) {
  const state = { tag: String(tag || ''), props: {}, attrs: {}, style: {}, cls: [], listeners: {}, children: [] };
  const e = {
    __state: state,
    dataset: {},
    style: state.style,
    classList: {
      add: (...c) => c.forEach(x => { if (!state.cls.includes(x)) state.cls.push(x); }),
      remove: (...c) => { state.cls = state.cls.filter(x => !c.includes(x)); },
      toggle: (c, force) => {
        const has = state.cls.includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) state.cls.push(c);
        if (!want && has) state.cls = state.cls.filter(x => x !== c);
        return want;
      },
      contains: c => state.cls.includes(c),
    },
    appendChild(ch) { state.children.push(ch); return ch; },
    insertBefore(ch) { state.children.push(ch); return ch; },
    removeChild(ch) { state.children = state.children.filter(x => x !== ch); return ch; },
    addEventListener(t, fn) { (state.listeners[t] = state.listeners[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { state.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(state.attrs, k) ? state.attrs[k] : null; },
    removeAttribute(k) { delete state.attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}, blur() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }),
  };
  for (const k of PROPS) {
    Object.defineProperty(e, k, {
      get() { return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : (k === 'value' ? '0' : ''); },
      set(v) { state.props[k] = v; },
      enumerable: true,
    });
  }
  return e;
}

function snapEl(e) {
  const s = e.__state;
  if (!s) return '<foreign>';
  const listeners = {};
  for (const k of Object.keys(s.listeners).sort()) listeners[k] = s.listeners[k].length;
  return { t: s.tag, p: s.props, a: s.attrs, st: s.style, cls: s.cls, l: listeners, c: s.children.map(snapEl) };
}

// ---- events ---------------------------------------------------------------------
function mkEvent(type, target, x, y) {
  return {
    type, target, currentTarget: target,
    preventDefault() {}, stopPropagation() {},
    clientX: x, clientY: y, offsetX: x, offsetY: y, movementX: 2, movementY: 1,
    pointerId: 1, buttons: 1, button: 0, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    key: 'ArrowRight', deltaY: 1,
    touches: [{ clientX: x, clientY: y, pageX: x, pageY: y }],
    changedTouches: [{ clientX: x, clientY: y, pageX: x, pageY: y }],
  };
}

// ---- one full deterministic pass --------------------------------------------------
function runPass(reducedMotion) {
  const eduSrc = read('education.js');
  const knowSrc = read('knowledge.js');
  const ids = [...new Set([...eduSrc.matchAll(/EDU\["([^"]+)"\]\s*=/g)].map(m => m[1]))]
    .filter(id => /^[a-z0-9-]+$/.test(id));

  const logs = {};          // id -> op stream
  const controlsByld = {};  // id -> controls element
  const canvasById = {};    // id -> canvas stub

  function makeCanvas(id) {
    const log = logs[id] = [];
    const controls = controlsByld[id] = makeEl('div');
    const style = {};
    const ctx = makeRecCtx(log);
    const state = { attrs: {}, listeners: {} };
    const c = {
      __canvasState: state,
      style,
      clientWidth: 760, clientHeight: 340,
      getAttribute: a => (a === 'data-edu' ? id : (Object.prototype.hasOwnProperty.call(state.attrs, a) ? state.attrs[a] : null)),
      setAttribute(k, v) { state.attrs[k] = String(v); },
      removeAttribute(k) { delete state.attrs[k]; },
      getContext: () => ctx,                               // browser-faithful: one ctx per canvas
      addEventListener(t, fn) { (state.listeners[t] = state.listeners[t] || []).push(fn); },
      removeEventListener() {},
      setPointerCapture() {}, releasePointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 760, height: 340, right: 760, bottom: 340 }),
      parentElement: { clientWidth: 760, querySelector: sel => (sel === '.controls' ? controls : null) },
      __edu: null,
    };
    let w = 0, h = 0;
    Object.defineProperty(c, 'width', { get: () => w, set(v) { w = v; log.push(['set', 'canvas.width', ser(v)]); } });
    Object.defineProperty(c, 'height', { get: () => h, set(v) { h = v; log.push(['set', 'canvas.height', ser(v)]); } });
    canvasById[id] = c;
    return c;
  }
  const canvases = ids.map(makeCanvas);

  // deterministic, theme-sensitive CSS "colors": distinct per var name AND per theme,
  // so a helper that swaps '--ink' for '--ink-2' (or misses a theme refit) is caught.
  const docEl = {
    _attrs: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    style: {},
  };
  function cssColor(name) {
    if (/mono/.test(name)) return 'monospace';
    if (/sans/.test(name)) return 'sans-serif';
    if (/serif/.test(name)) return 'serif';
    const s = (docEl._attrs['data-theme'] || 'paper') + '|' + name;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return '#' + ('000000' + (h & 0xffffff).toString(16)).slice(-6);
  }

  // rAF queue, pumped manually with fixed timestamps
  let rafId = 0;
  let rafQ = new Map();
  function pump(t) {
    const q = [...rafQ.values()];
    rafQ.clear();
    for (const cb of q) { try { cb(t); } catch (e) { /* module loops swallow */ } }
  }

  let moCb = null;
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    devicePixelRatio: 1,
    requestAnimationFrame: cb => { rafQ.set(++rafId, cb); return rafId; },
    cancelAnimationFrame: id => { rafQ.delete(id); },
    performance: { now: () => 100000 },
    getComputedStyle: () => ({ getPropertyValue: cssColor }),
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {}, addListener() {}, removeEventListener() {} }),
  };
  sandbox.MutationObserver = class { constructor(cb) { moCb = cb; } observe() {} disconnect() {} };
  sandbox.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ target: el, isIntersecting: true }]); } unobserve() {} disconnect() {} };
  sandbox.document = {
    documentElement: docEl, readyState: 'complete',
    getElementById: () => null, addEventListener() {},
    createElement: makeEl, createElementNS: (_, tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll: sel => (sel === 'canvas[data-edu]' ? canvases : []),
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  // freeze entropy INSIDE the context (its intrinsics are separate from the host's)
  vm.runInContext(`
    Math.random = (function () { var s = 987654321; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    Date.now = function () { return 1750000000000; };
  `, ctx);

  let bootErr = null;
  try {
    vm.runInContext(knowSrc, ctx, { filename: 'knowledge.js' });
    vm.runInContext(eduSrc, ctx, { filename: 'education.js' });
  } catch (e) { bootErr = e; }
  if (bootErr) throw new Error('education.js failed to boot in the equivalence sandbox: ' + bootErr.message);

  const mark = m => { for (const id of ids) logs[id].push(['phase', m]); };

  mark('raf-1'); pump(1000); pump(1016);
  mark('theme-dark'); docEl.setAttribute('data-theme', 'dark'); if (moCb) moCb([]);
  mark('raf-2'); pump(2000); pump(2016);

  mark('controls');
  const fireTree = (el, log) => {
    const s = el.__state; if (!s) return;
    for (const t of ['click', 'input', 'change']) {
      for (const fn of (s.listeners[t] || [])) {
        log.push(['evt', `${s.tag}:${t}`]);
        try { fn(mkEvent(t, el, 180, 120)); } catch (e) { log.push(['evt-threw', t, String(e && e.message)]); }
      }
    }
    for (const ch of s.children) fireTree(ch, log);
  };
  for (const id of ids) fireTree(controlsByld[id], logs[id]);

  mark('canvas-events');
  const CANVAS_EVENTS = ['pointerenter', 'mousemove', 'pointermove', 'touchstart', 'touchmove',
    'pointerdown', 'pointerup', 'click', 'touchend', 'pointercancel', 'pointerleave', 'mouseleave',
    'focus', 'blur', 'change'];
  for (const id of ids) {
    const st = canvasById[id].__canvasState;
    for (const t of CANVAS_EVENTS) {
      for (const fn of (st.listeners[t] || [])) {
        logs[id].push(['evt', `canvas:${t}`]);
        try { fn(mkEvent(t, canvasById[id], 300, 170)); } catch (e) { logs[id].push(['evt-threw', t, String(e && e.message)]); }
      }
    }
  }

  mark('raf-3'); pump(3000); pump(3016);
  mark('theme-paper'); docEl.removeAttribute('data-theme'); if (moCb) moCb([]);
  mark('raf-4'); pump(4000);

  const out = {};
  for (const id of ids) {
    out[id] = {
      ops: logs[id],
      controls: snapEl(controlsByld[id]),
      canvas: { style: canvasById[id].style, attrs: canvasById[id].__canvasState.attrs },
    };
  }
  return out;
}

// ---- public API --------------------------------------------------------------------
export function capture() {
  return { rm: runPass(true), anim: runPass(false) };
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export function summarize(full) {
  const out = {};
  for (const pass of Object.keys(full)) {
    out[pass] = {};
    for (const id of Object.keys(full[pass])) {
      const r = full[pass][id];
      out[pass][id] = {
        ops: r.ops.length,
        h: sha(JSON.stringify(r.ops)),
        ch: sha(JSON.stringify(r.controls)),
        cv: sha(JSON.stringify(r.canvas)),
      };
    }
  }
  return out;
}

// first divergence between two op streams, with context — for debugging failures
export function firstDiff(a, b, context = 3) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      const lo = Math.max(0, i - context);
      const fmt = (ops, j) => (j < ops.length ? JSON.stringify(ops[j]) : '<end>');
      const lines = [`first divergence at op ${i} (baseline ${a.length} ops, current ${b.length} ops)`];
      for (let j = lo; j <= Math.min(i + context, n - 1); j++) {
        lines.push(`  [${j}]${j === i ? ' <<<' : ''} baseline: ${fmt(a, j)}`);
        lines.push(`  [${j}]${j === i ? ' <<<' : ''} current : ${fmt(b, j)}`);
      }
      return lines.join('\n');
    }
  }
  return 'no op-level divergence found (difference must be in controls/canvas snapshot)';
}
