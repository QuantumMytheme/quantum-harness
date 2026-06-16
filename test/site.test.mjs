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
