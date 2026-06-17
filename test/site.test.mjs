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
// 23-slice, two-track curriculum (Part 0 history; Part I classical bit->silicon;
// Part II quantum qubit->hardware; Part III scale; Part IV landmark re-runnable
// experiments; close: your-run), in page order.
const EDU_IDS = [
  'history',
  'bit', 'rules-to-learning', 'machine-learning', 'big-data', 'neural-nets',
  'transformers', 'architectures', 'slm-llm', 'pretrain-posttrain', 'inference-zoo', 'classical-stack',
  'quantum-sim', 'entanglement', 'quantum-algorithms', 'noise-qec', 'hardware-zoo', 'hybrid-quantum',
  'qubit-explorer',
  'chsh', 'teleport', 'qec-code', 'ghz-mermin', 'bv', 'hamming', 'sat3', 'rsa-shor',
  'superdense', 'deutsch-jozsa', 'simon', 'rule110', 'landauer',
  'efficiency',
  'your-run',
]

test('education page exists, is wired, and mounts all 34 module canvases', () => {
  assert.ok(existsSync(v('education.html')), 'viewer/education.html should exist')
  assert.ok(existsSync(v('education.js')), 'viewer/education.js should exist')
  const edu = readFileSync(v('education.html'), 'utf8')
  assert.match(edu, /rel="canonical" href="https:\/\/quantummytheme\.com\/education"/)
  assert.match(edu, /<script src="education\.js">/)
  const mounts = [...edu.matchAll(/data-edu="([a-z0-9-]+)"/g)].map(m => m[1])
  assert.equal(mounts.length, EDU_IDS.length, `expected exactly ${EDU_IDS.length} module canvases`)
  for (const id of EDU_IDS) assert.ok(mounts.includes(id), `education.html should mount a canvas for ${id}`)
})

test('education.js defines an animation for every mounted module', () => {
  const js = readFileSync(v('education.js'), 'utf8')
  for (const id of EDU_IDS) {
    assert.match(js, new RegExp(`EDU\\["${id}"\\]\\s*=`), `education.js should define EDU["${id}"]`)
  }
})

test('overview links to the education page; sitemap lists its canonical URL', () => {
  assert.match(html, /href="education\.html"/)
  assert.match(readFileSync(v('sitemap.xml'), 'utf8'), /<loc>https:\/\/quantummytheme\.com\/education<\/loc>/)
})

// --- field notebook (lab) page ----------------------------------------------
test('field notebook page exists, is wired, linked, and has all 6 sections', () => {
  assert.ok(existsSync(v('lab.html')), 'viewer/lab.html should exist')
  assert.ok(existsSync(v('lab.js')), 'viewer/lab.js should exist')
  const lab = readFileSync(v('lab.html'), 'utf8')
  assert.match(lab, /rel="canonical" href="https:\/\/quantummytheme\.com\/lab"/)
  assert.match(lab, /<script src="lab\.js">/)
  assert.match(html, /href="lab\.html"/) // overview links to it
  assert.match(readFileSync(v('sitemap.xml'), 'utf8'), /<loc>https:\/\/quantummytheme\.com\/lab<\/loc>/)
  const js = readFileSync(v('lab.js'), 'utf8')
  for (const sec of ['front', 'brief', 'field', 'atlas', 'register', 'primer']) {
    assert.match(js, new RegExp(`${sec}:\\s*sec`), `lab.js SECTIONS should include ${sec}`)
  }
})

test('shared in-browser runner + recipe builder wired on both pages', () => {
  assert.ok(existsSync(v('runner.js')), 'viewer/runner.js should exist')
  const runner = readFileSync(v('runner.js'), 'utf8')
  assert.match(runner, /window\.QMRunner\s*=/)
  assert.match(runner, /function expectation/)                                        // JS judge metric
  assert.match(runner, /runRealJudge/)                                                // WASM (Pyodide) real judge
  assert.match(runner, /api\.github\.com\/repos\/QuantumMytheme\/quantum-harness\/generate/) // GitHub repo create
  assert.match(html, /<script src="runner\.js">/)                                     // overview includes it
  const lab = readFileSync(v('lab.html'), 'utf8')
  assert.match(lab, /<script src="runner\.js">/)                                      // notebook includes it
  const js = readFileSync(v('lab.js'), 'utf8')
  assert.match(js, /recipe:\s*secRecipe/)                                             // recipe tab/section
  assert.match(js, /function mintRecipe/)
  assert.ok(existsSync(v('og-lab.png')), 'viewer/og-lab.png (notebook social card) should exist')
  assert.match(lab, /og-lab\.png/)
})

test('every page carries the same top-bar nav (no links drop off across pages)', () => {
  // The canonical link set + order, shared by index / education / lab. Guards against
  // the brandbar diverging per page (the "some links drop off" regression).
  const CANON = ['Why', 'Platform', 'Bench', 'Learn', 'Scoreboard', 'Run yours', 'Notebook']
  const indexIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]))

  for (const page of ['index.html', 'education.html', 'lab.html']) {
    const src = readFileSync(v(page), 'utf8')
    const bar = src.slice(src.indexOf('class="brandbar"'))
    const nav = bar.slice(bar.indexOf('<nav'), bar.indexOf('</nav>')) // the brandbar's own nav, not page sub-navs
    const links = [...nav.matchAll(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
      .map(m => ({ href: m[1], label: m[2].replace(/[↗\s]+$/, '').trim() }))

    assert.deepEqual(links.map(l => l.label), CANON, `${page} top-bar labels/order`)

    // every cross-page anchor must resolve to a real section id on the homepage
    for (const { href } of links) {
      const anchor = href.match(/(?:index\.html)?#([\w-]+)$/)
      if (anchor) assert.ok(indexIds.has(anchor[1]), `${page} link #${anchor[1]} resolves on the homepage`)
      else if (/\.html$/.test(href)) assert.ok(existsSync(v(href)), `${page} link ${href} exists`)
    }
  }
  // the current page is marked active on its own nav
  assert.match(readFileSync(v('education.html'), 'utf8'), /<a href="education\.html" aria-current="page">Learn<\/a>/)
  assert.match(readFileSync(v('lab.html'), 'utf8'), /<a href="lab\.html" aria-current="page">Notebook/)
})

test('recipe builder has the device variables, forecaster + the circuit↦chip design schematic', () => {
  const js = readFileSync(v('lab.js'), 'utf8')
  // design variables
  for (const p of ['backend', 'noise', 'twoq', 'shots']) assert.match(js, new RegExp(`${p}:`), `recipe param ${p}`)
  assert.match(js, /BACKENDS\s*=/)                       // ideal / noisy-sim / real-QPU toggle
  assert.match(js, /bellnoisy2/)                          // the added 7th ingredient
  // the heuristic goal/metric forecaster
  assert.match(js, /function predict\(/)
  assert.match(js, /function predictHTML\(/)
  assert.match(js, /GOALS\s*=/)
  assert.match(js, /predicted ACCEPT/)
  assert.match(js, /id="recipe-forecast"/)
  // the design schematic — a real circuit + the chip topology it needs (replaces the decorative 3-D blend)
  assert.match(js, /buildAnsatz/)                        // derives the circuit from the recipe
  assert.match(js, /couplingMap/)                        // derives the chip topology
  assert.match(js, /CIRCUIT · the ansatz/)
  assert.match(js, /CHIP · the topology/)
  assert.match(js, /id="recipe-pcard"/)                  // the problem card (what a good result looks like)
  assert.doesNotMatch(js, /blend the constellation/)     // the decorative 3-D viz is gone
})

test('knowledge.js is the shared source of truth, wired on both pages', () => {
  assert.ok(existsSync(v('knowledge.js')), 'viewer/knowledge.js should exist')
  const k = readFileSync(v('knowledge.js'), 'utf8')
  assert.match(k, /window\.QMKnowledge\s*=/)
  for (const sym of ['TASKS', 'PROBLEMS', 'QUALITY_AXES', 'profileBadge', 'problemCard', 'buildAnsatz', 'couplingMap'])
    assert.match(k, new RegExp(sym), `knowledge.js should define ${sym}`)
  assert.match(html, /<script src="knowledge\.js">/)                                   // index.html
  assert.match(readFileSync(v('lab.html'), 'utf8'), /<script src="knowledge\.js">/)    // lab.html
})

test('scoreboard carries a holistic quality grade + 5 axes, sortable/filterable', () => {
  const sb = readFileSync(v('scoreboard-data.js'), 'utf8')
  const data = JSON.parse(sb.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''))
  assert.ok(data.rows.length >= 6, 'expected several scored runs')
  for (const r of data.rows) {
    assert.ok(r.quality, `${r.problem_id} should carry a quality profile`)
    assert.match(r.quality.grade, /^[A-F][+-]?$/, `${r.problem_id} grade is a letter`)
    for (const ax of ['correctness', 'margin', 'efficiency', 'robustness', 'novelty'])
      assert.equal(typeof r.quality[ax], 'number', `${r.problem_id}.quality.${ax} is numeric`)
  }
  // the board exposes the quality column, sort/filter tools, and a legend
  assert.match(html, /id="sb-tools"/)
  assert.match(html, /id="sb-legend"/)
  assert.match(html, /Quality/)
  const app = readFileSync(v('app.js'), 'utf8')
  assert.match(app, /profileBadge/)                      // renders the quality badge
  assert.match(app, /data-sbsort/)                       // sort control
  assert.match(app, /data-sbfilter/)                     // filter control
  assert.match(app, /problemCard/)                       // clickable problem card
})

test('long pages get the margin-index rail (railnav), wired + theme-aware + mobile-safe', () => {
  assert.ok(existsSync(v('railnav.js')), 'viewer/railnav.js should exist')
  const rail = readFileSync(v('railnav.js'), 'utf8')
  assert.match(rail, /class\s*=\s*'railnav'|className = 'railnav'/)   // builds the rail
  assert.match(rail, /aria-current/)                                  // scroll-spy marks the active section
  assert.match(rail, /scrollIntoView/)                               // click-to-jump
  assert.match(rail, /prefers-reduced-motion/)                       // motion-safe

  // included on the two long scroll pages, not on the tabbed notebook
  assert.match(html, /<script src="railnav\.js">/)
  assert.match(readFileSync(v('education.html'), 'utf8'), /<script src="railnav\.js">/)
  assert.doesNotMatch(readFileSync(v('lab.html'), 'utf8'), /railnav\.js/)

  // homepage sections carry curated rail labels
  assert.match(html, /<header class="hero" data-rail="Abstract">/)
  for (const lbl of ['Why', 'Platform', 'Judge', 'Scoreboard', 'Run']) {
    assert.match(html, new RegExp(`data-rail="${lbl}"`), `index section labelled ${lbl}`)
  }

  // styled + hidden on narrow viewports
  const css = readFileSync(v('style.css'), 'utf8')
  assert.match(css, /\.railnav\s*\{/)
  assert.match(css, /max-width:\s*1180px\s*\)\s*\{\s*\.railnav\s*\{\s*display:\s*none/)
})

test('homepage advertises the full platform, not just the bench', () => {
  // Guards against the front page drifting back to a stale "just a repo" pitch:
  // the overview must surface the notebook, the in-browser/WASM judge, the recipe builder,
  // and the curriculum, and the metrics must match the real judge + measurement suites.
  assert.match(html, /id="platform"/)                       // the "explore the platform" hub section
  assert.match(html, /field notebook/i)                     // notebook is named in prose
  assert.match(html, /WebAssembly/)                          // the real judge runs in-page as WASM
  assert.match(html, /recipe builder/i)                      // recipe builder is surfaced
  assert.match(html, /href="lab\.html#recipe"/)             // and deep-linked
  assert.match(html, /href="education\.html"/)              // curriculum is linked from the hero/hub
  assert.match(html, /8\/8 exit 0/)                          // scoreboard prose matches verify.py
  assert.match(html, /38\/38/)                               // judge suite metric is current
  // measurement badge: an all-green N/N from the current era — not a brittle literal that
  // goes stale every time a test is added (the very drift that produced the old build).
  const meas = html.match(/<b>(\d+)\/(\d+)<\/b><span>measurement<\/span>/)
  assert.ok(meas, 'measurement metric badge present')
  assert.equal(meas[1], meas[2], 'measurement badge shows all checks passing (N/N)')
  assert.ok(Number(meas[1]) >= 95, 'measurement badge reflects the current-era suite, not an old stale build')
  assert.doesNotMatch(html, /Phase 2 of the platform/)      // old footer tagline is gone
})
