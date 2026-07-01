/* QuantumMytheme · frontier.js — the Wanted Board + the Frontier Atlas.
   Renders window.SCOREBOARD_DATA.coverage (gaps-in-the-map, with copyable mint
   commands) and window.SCOREBOARD_DATA.frontier (per-problem Pareto scatter of
   verified metric vs primary resource cost) into #frontier-root.
   Dependency-free, CSP-clean (no inline handlers), theme-aware via CSS variables.
   Honesty rules: a gap is "untried" — never "impossible", never "easy"; dominated
   points stay visible (the board is a record, not a highlight reel); an emulated
   overlay is never presented as hardware. */
'use strict';

(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const sig = v => Number(Number(v).toPrecision(3));

  /* ------------------------------ wanted board ---------------------------- */
  const GAP_ICON = { 'first-run': '∅', 'model-run': '◇', 'classical-baseline': '⊞', hardware: '⚛' };
  function wantedHTML(coverage) {
    const open = coverage.filter(c => c.gaps.length);
    const filled = coverage.length - open.length;
    const cells = open.reduce((n, c) => n + c.gaps.length, 0);
    let h = '<div class="sec-head"><p class="eyebrow">Frontier · open problems</p>'
      + '<h2>The wanted board — where your run would matter</h2>'
      + '<p class="lead">Every problem the judges know about — including the ones nobody has attempted — and exactly '
      + 'which cells are still empty: no model-authored run, no classical-baseline row, no real-device hardware overlay. '
      + `Today that is <b>${cells} open cell${cells === 1 ? '' : 's'} across ${open.length} problem${open.length === 1 ? '' : 's'}</b>`
      + (filled ? ` (${filled} fully covered)` : '')
      + '. Each gap carries the exact mint command: paste it, point your model at the BRIEF, and the judge grades the '
      + 'same for everyone. A gap means <b>untried</b> — it says nothing about whether it is hard or easy.</p></div>';
    h += '<div class="wanted-grid">';
    for (const c of coverage) {
      const tried = c.paradigms_tried.length
        ? c.paradigms_tried.map(p => `<span class="ptag">${esc(p)}</span>`).join(' ')
        : '<span class="dimnum">none yet</span>';
      h += `<div class="wanted-card${c.runs ? '' : ' untried'}" data-pid="${esc(c.problem_id)}">`
        + `<div class="wanted-head"><b class="mono">${esc(c.problem_id)}</b><span class="tk">${esc(c.task)}</span>`
        + `<span class="wanted-src">${esc(c.source)}</span></div>`
        + `<div class="wanted-tried"><span class="sb-tlabel">tried</span> ${tried}</div>`;
      if (c.gaps.length) {
        h += '<ul class="gap-list">' + c.gaps.map(g =>
          `<li class="gap-line"><span class="gap-kind">${GAP_ICON[g.kind] || '·'} ${esc(g.kind)}</span>`
          + `<span class="gap-label">${esc(g.label)}</span>`
          + `<span class="gap-cmd"><code class="mint">${esc(g.command)}</code>`
          + `<button class="copybtn" type="button" data-copy="${esc(g.command)}" aria-label="copy mint command">copy</button></span></li>`
        ).join('') + '</ul>';
      } else {
        h += '<p class="gap-none">all tracked cells filled — beat the current best instead</p>';
      }
      h += '</div>';
    }
    h += '</div>';
    h += '<p class="figcap"><b>Board rules.</b> A cell is <b>untried</b> until a judge-ACCEPTed bundle fills it — the label never claims '
      + 'a gap is winnable or trivial, only that nobody has posted a verified design yet. Commands mint a public run repo under '
      + '<em>your own</em> GitHub login (<span class="mono">bin/new-run.sh</span>); a claimed cell only lands on the board through the '
      + 'same fail-closed re-verification gate as every other row.</p>';
    return h;
  }

  /* ------------------------------ frontier atlas --------------------------- */
  const plots = [];   // { canvas, cap, f, pid, pts:[{x,y,p}] } for hover/click/redraw

  function atlasHTML(frontier) {
    const pids = Object.keys(frontier);
    const multi = pids.filter(p => frontier[p].points.length >= 2);
    const single = pids.length - multi.length;
    let h = '<div class="fr-head"><h3>Frontier atlas — verified metric vs resource cost</h3>'
      + '<p class="lead">Rank collapses each board to one number; the real scientific object is the tradeoff curve. '
      + 'Each verified run is a point; the stepped line is the Pareto frontier (no other run is at least as good on both axes); '
      + 'grey points are dominated but stay visible — the board is a record, not a highlight reel.'
      + (single ? ` ${single} board${single === 1 ? ' is' : 's are'} still a single point — see the wanted board above.` : '')
      + '</p></div>';
    if (!multi.length) {
      h += '<p class="note">No board has two verified entries yet — the first contested problem draws the first frontier.</p>';
      return h;
    }
    for (const pid of multi) {
      const f = frontier[pid];
      const dirNote = f.dir === 'lower' ? 'lower is better' : 'higher is better';
      h += `<div class="panel fr-panel" data-frpid="${esc(pid)}">`
        + `<div class="fr-title"><b class="mono">${esc(pid)}</b><span class="tk">${esc(f.task)}</span>`
        + `<span class="dimnum">${esc(f.metricName)} (${dirNote}) vs ${esc(f.costLabel)}</span></div>`
        + `<canvas class="stage fr-canvas" data-frplot="${esc(pid)}" height="240"></canvas>`
        + `<p class="fr-hover mono" data-frcap="${esc(pid)}">hover a point · click to open its run repo</p>`
        + '<p class="fr-pts">' + f.points.map((p, i) =>
          `<a href="${esc(p.run_repo)}" data-frpt="${i}" class="${p.dominated ? 'fr-dom' : 'fr-front'}">`
          + `${esc(p.paradigm)} · ${esc(f.metricName)} ${sig(p.metric)} · ${p.cost} ${esc(f.costLabel)}${p.dominated ? ' (dominated)' : ''} ↗</a>`
        ).join(' ') + '</p>'
        + `<p class="figcap">${esc(f.gap)}</p>`
        + '</div>';
    }
    return h;
  }

  function drawPlot(pl) {
    const cv = pl.canvas, f = pl.f;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || cv.parentElement.clientWidth, h = 240;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const col = {
      accent: cssVar('--accent') || '#28489e', faint: cssVar('--faint') || '#727a89',
      rule: cssVar('--rule') || '#e2e5ec', ink: cssVar('--ink') || '#15171c',
    };
    const P = { l: 56, r: 18, t: 14, b: 30 };
    const pts = f.points;
    const xs = pts.map(p => p.cost), ys = pts.map(p => p.metric);
    // log-scale the metric when all values are positive and the spread is wide
    const log = ys.every(v => v > 0) && Math.max(...ys) / Math.min(...ys) > 20;
    const ty = v => log ? Math.log10(v) : v;
    let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 1; x1 += 1; }
    let y0 = Math.min(...ys.map(ty)), y1 = Math.max(...ys.map(ty)); if (y0 === y1) { y0 -= 1; y1 += 1; }
    const padX = (x1 - x0) * 0.12, padY = (y1 - y0) * 0.14;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const sx = v => P.l + (v - x0) / (x1 - x0) * (w - P.l - P.r);
    // better metric points UP regardless of direction
    const frac = v => (ty(v) - y0) / (y1 - y0);
    const sy = v => f.dir === 'lower'
      ? P.t + frac(v) * (h - P.t - P.b)          // low (better) value near the top
      : h - P.b - frac(v) * (h - P.t - P.b);     // high (better) value near the top
    // axes
    ctx.strokeStyle = col.rule; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.l, P.t); ctx.lineTo(P.l, h - P.b); ctx.lineTo(w - P.r, h - P.b); ctx.stroke();
    ctx.fillStyle = col.faint; ctx.font = '10.5px ui-monospace, monospace';
    // x ticks at integer costs
    for (let c = Math.ceil(x0); c <= Math.floor(x1); c++) {
      ctx.fillText(String(c), sx(c) - 3, h - P.b + 16);
      ctx.strokeStyle = col.rule; ctx.beginPath(); ctx.moveTo(sx(c), h - P.b); ctx.lineTo(sx(c), h - P.b + 4); ctx.stroke();
    }
    ctx.fillText(f.costLabel, w - P.r - ctx.measureText(f.costLabel).width, h - 8);
    // y labels at the data values
    for (const v of [...new Set(ys)]) {
      const lbl = String(sig(v));
      ctx.fillText(lbl, P.l - 8 - ctx.measureText(lbl).width, sy(v) + 3.5);
    }
    ctx.save(); ctx.translate(12, P.t + 4); ctx.rotate(-Math.PI / 2);
    const yl = `${f.metricName}${log ? ' (log)' : ''} — better ↑`;
    ctx.fillText(yl, -(h - P.t - P.b) / 2 - ctx.measureText(yl).width / 2, 0); ctx.restore();
    // frontier stepped line through the non-dominated set, sorted by cost
    const front = pts.filter(p => !p.dominated).slice().sort((a, b) => a.cost - b.cost);
    if (front.length > 1) {
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(sx(front[0].cost), sy(front[0].metric));
      for (let i = 1; i < front.length; i++) {
        ctx.lineTo(sx(front[i].cost), sy(front[i - 1].metric));   // step across
        ctx.lineTo(sx(front[i].cost), sy(front[i].metric));       // step up/down
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // points: frontier = accent, dominated = grey; reference baselines hollow
    pl.pts = pts.map((p, i) => {
      const x = sx(p.cost), y = sy(p.metric);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832);
      if (p.dominated) { ctx.fillStyle = col.faint; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; }
      else if (p.reference) { ctx.fillStyle = 'transparent'; ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.fillStyle = col.accent; ctx.fill(); }
      if (i === pl.hover) { ctx.strokeStyle = col.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832); ctx.stroke(); }
      return { x, y, p, i };
    });
  }

  function nearest(pl, ev) {
    const r = pl.canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = 14;
    for (const q of pl.pts || []) { const d = Math.hypot(q.x - mx, q.y - my); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  function wirePlot(pl) {
    const cap = pl.cap, f = pl.f;
    pl.canvas.addEventListener('mousemove', ev => {
      const q = nearest(pl, ev);
      pl.canvas.style.cursor = q ? 'pointer' : 'default';
      const nh = q ? q.i : -1;
      if (nh !== pl.hover) { pl.hover = nh; drawPlot(pl); }
      cap.textContent = q
        ? `${q.p.paradigm} · ${q.p.model || 'unknown model'} · ${f.metricName} ${sig(q.p.metric)} at ${q.p.cost} ${f.costLabel}${q.p.dominated ? ' · dominated' : ' · on the frontier'} — click to open the run repo`
        : 'hover a point · click to open its run repo';
    });
    pl.canvas.addEventListener('mouseleave', () => { pl.hover = -1; drawPlot(pl); cap.textContent = 'hover a point · click to open its run repo'; });
    pl.canvas.addEventListener('click', ev => {
      const q = nearest(pl, ev);
      if (q && q.p.run_repo) window.open(q.p.run_repo, '_blank', 'noopener');
    });
  }

  /* ------------------------------ copy + boot ------------------------------ */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.copybtn');
    if (!btn) return;
    const cmd = btn.getAttribute('data-copy') || '';
    const done = ok => { btn.textContent = ok ? 'copied ✓' : 'select + copy'; setTimeout(() => { btn.textContent = 'copy'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(() => done(true), () => done(false));
    else done(false);
  });

  function boot() {
    const root = document.getElementById('frontier-root');
    const d = window.SCOREBOARD_DATA;
    if (!root || !d || !d.coverage || !d.frontier) return;
    root.innerHTML = wantedHTML(d.coverage) + atlasHTML(d.frontier);
    for (const cv of root.querySelectorAll('[data-frplot]')) {
      const pid = cv.getAttribute('data-frplot');
      const pl = { canvas: cv, cap: root.querySelector(`[data-frcap="${pid}"]`), f: d.frontier[pid], pid, hover: -1 };
      plots.push(pl); drawPlot(pl); wirePlot(pl);
    }
    window.addEventListener('resize', () => plots.forEach(drawPlot));   // also fired on theme toggle
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
