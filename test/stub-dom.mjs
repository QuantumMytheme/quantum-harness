// Shared stub-DOM harness for loading viewer/runner.js (a browser IIFE) under
// node — extends the fake-window pattern used by test/studio.test.mjs. The stub
// is deliberately tiny: enough DOM for runner.js to boot (style injection,
// delegated listeners) and for overlay/drawer smoke tests. Setting innerHTML
// registers any id="…" it contains as a reachable pseudo-element, so code that
// later does document.getElementById(...).innerHTML = … can be observed.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function makeStubDom() {
  const byId = new Map()
  function el(tag) {
    const e = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], style: {}, attrs: {}, _inner: '', textContent: '',
      disabled: false, value: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId.set(String(v), this) },
      getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null },
      hasAttribute(k) { return k in this.attrs },
      appendChild(c) { this.children.push(c); return c },
      remove() {},
      querySelector() { return null },
      querySelectorAll() { return [] },
      addEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 } },
    }
    Object.defineProperty(e, 'id', {
      get() { return e.attrs.id || '' },
      set(v) { e.attrs.id = String(v); byId.set(String(v), e) },
    })
    Object.defineProperty(e, 'innerHTML', {
      get() { return e._inner },
      set(html) {
        e._inner = String(html)
        // register any id="…" inside as a reachable pseudo-element
        for (const m of e._inner.matchAll(/\bid="([^"]+)"/g)) {
          if (!byId.has(m[1])) byId.set(m[1], el('div'))
        }
      },
    })
    return e
  }
  const events = []
  const doc = {
    documentElement: el('html'),
    head: el('head'),
    body: el('body'),
    createElement: (t) => el(t),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(ev) { events.push(ev); return true },
    _events: events,
    _el: el,
  }
  doc.documentElement.getAttribute = () => null
  const win = { document: doc, crypto: globalThis.crypto, location: { origin: 'https://example.test' } }
  return { win, doc, events }
}

export function loadRunner() {
  const src = readFileSync(fileURLToPath(new URL('../viewer/runner.js', import.meta.url)), 'utf8')
  const { win, doc, events } = makeStubDom()
  // runner.js boot path touches: window.QMRunner, document.documentElement,
  // window.matchMedia (guarded), createElement('style'), head.appendChild,
  // document.addEventListener. getComputedStyle only runs at render time.
  new Function('window', 'document', 'getComputedStyle', 'navigator', src)(
    win, doc, () => ({ getPropertyValue: () => '' }), { clipboard: { writeText() {} } })
  if (!win.QMRunner) throw new Error('runner.js did not attach window.QMRunner')
  return { QMRunner: win.QMRunner, win, doc, events }
}
