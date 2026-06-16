import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Launch hygiene for the public domain (quantummytheme.com). These guard the
// viewer's discoverability + sharing metadata and the www->apex redirect shim
// so a future edit can't silently regress them. Pure file checks — no network.
// ---------------------------------------------------------------------------
const v = p => fileURLToPath(new URL(`../viewer/${p}`, import.meta.url))
const html = readFileSync(v('index.html'), 'utf8')

test('viewer declares a canonical URL + Open Graph / Twitter card meta', () => {
  assert.match(html, /rel="canonical" href="https:\/\/quantummytheme\.com\/"/)
  assert.match(html, /property="og:image" content="https:\/\/quantummytheme\.com\/og\.png"/)
  assert.match(html, /property="og:title"/)
  assert.match(html, /property="og:description"/)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
})

test('social card + launch static assets are all present', () => {
  for (const f of ['og.png', 'robots.txt', 'sitemap.xml', '404.html', '_worker.js']) {
    assert.ok(existsSync(v(f)), `viewer/${f} should exist`)
  }
})

test('robots points at the sitemap; sitemap lists the apex', () => {
  assert.match(readFileSync(v('robots.txt'), 'utf8'), /Sitemap:\s*https:\/\/quantummytheme\.com\/sitemap\.xml/)
  assert.match(readFileSync(v('sitemap.xml'), 'utf8'), /<loc>https:\/\/quantummytheme\.com\/<\/loc>/)
})

test('redirect worker canonicalizes www -> apex with a 301 and serves assets', () => {
  const w = readFileSync(v('_worker.js'), 'utf8')
  assert.match(w, /www\.quantummytheme\.com/)
  assert.match(w, /301/)
  assert.match(w, /env\.ASSETS\.fetch/)
})

test('every in-page nav link resolves to a real section id', () => {
  const hrefs = [...html.matchAll(/<a href="#([a-z0-9-]+)"/g)].map(m => m[1])
  assert.ok(hrefs.length >= 3, 'expected several in-page nav links')
  for (const id of hrefs) {
    assert.match(html, new RegExp(`id="${id}"`), `nav points to #${id} but nothing has id="${id}"`)
  }
})

// --- education page ---------------------------------------------------------
const EDU_IDS = [
  'rules-to-learning', 'machine-learning', 'big-data', 'neural-nets', 'transformers',
  'slm-llm', 'pretrain-posttrain', 'inference-zoo', 'classical-stack', 'quantum-sim',
  'hybrid-quantum', 'your-run',
]

test('education page exists, is wired, and mounts all 12 module canvases', () => {
  assert.ok(existsSync(v('education.html')), 'viewer/education.html should exist')
  assert.ok(existsSync(v('education.js')), 'viewer/education.js should exist')
  const edu = readFileSync(v('education.html'), 'utf8')
  assert.match(edu, /rel="canonical" href="https:\/\/quantummytheme\.com\/education\.html"/)
  assert.match(edu, /<script src="education\.js">/)
  const mounts = [...edu.matchAll(/data-edu="([a-z0-9-]+)"/g)].map(m => m[1])
  assert.equal(mounts.length, 12, 'expected exactly 12 module canvases')
  for (const id of EDU_IDS) assert.ok(mounts.includes(id), `education.html should mount a canvas for ${id}`)
})

test('education.js defines an animation for every mounted module', () => {
  const js = readFileSync(v('education.js'), 'utf8')
  for (const id of EDU_IDS) {
    assert.match(js, new RegExp(`EDU\\["${id}"\\]\\s*=`), `education.js should define EDU["${id}"]`)
  }
})

test('overview links to the education page; sitemap lists it', () => {
  assert.match(html, /href="education\.html"/)
  assert.match(readFileSync(v('sitemap.xml'), 'utf8'), /education\.html/)
})
