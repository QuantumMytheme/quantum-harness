/* QuantumMytheme · viewer engine — dependency-free, classic script (file://-safe).
   A small statevector simulator mirrors bench/quantum-judge/sim.py (qubit 0 = MSB),
   so the figures show what the judge re-derives. Two themes: paper (default), dark. */
'use strict';

/* ----------------------------- complex + sim ----------------------------- */
const C = (re, im) => ({ re, im: im || 0 });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cconj = a => C(a.re, -a.im);
const cabs = a => Math.hypot(a.re, a.im);

const S2 = 1 / Math.sqrt(2);
const GATES = { h: [[C(S2), C(S2)], [C(S2), C(-S2)]], x: [[C(0), C(1)], [C(1), C(0)]], z: [[C(1), C(0)], [C(0), C(-1)]] };

function zero(n) { const v = Array.from({ length: 1 << n }, () => C(0)); v[0] = C(1); return v; }
function apply1q(state, n, U, q) {
  const sh = n - 1 - q;
  for (let i = 0; i < state.length; i++) if (((i >> sh) & 1) === 0) {
    const j = i | (1 << sh), a = state[i], b = state[j];
    state[i] = cadd(cmul(U[0][0], a), cmul(U[0][1], b));
    state[j] = cadd(cmul(U[1][0], a), cmul(U[1][1], b));
  }
  return state;
}
function applyCX(state, n, c, t) {
  const sc = n - 1 - c, st = n - 1 - t;
  for (let i = 0; i < state.length; i++) if (((i >> sc) & 1) === 1 && ((i >> st) & 1) === 0) {
    const j = i | (1 << st), tmp = state[i]; state[i] = state[j]; state[j] = tmp;
  }
  return state;
}
function reducedBloch(state, n, q) {
  const sh = n - 1 - q; let r00 = 0, r11 = 0, r01 = C(0);
  for (let i = 0; i < state.length; i++) if (((i >> sh) & 1) === 0) {
    const j = i | (1 << sh);
    r00 += state[i].re ** 2 + state[i].im ** 2; r11 += state[j].re ** 2 + state[j].im ** 2;
    r01 = cadd(r01, cmul(state[i], cconj(state[j])));
  }
  const bx = 2 * r01.re, by = -2 * r01.im, bz = r00 - r11;
  return { x: bx, y: by, z: bz, len: Math.hypot(bx, by, bz) };
}

/* ------------------------------ theming ---------------------------------- */
const PAL = {
  paper: {
    sphereLine: 'rgba(40,55,110,0.34)', wire: 'rgba(40,55,110,0.16)', wireEq: 'rgba(40,55,110,0.42)',
    sA: 'rgba(40,70,160,0.07)', sB: 'rgba(40,70,160,0.0)',
    faint: 'rgba(91,99,115,0.85)', node: '#15171c', nodeFill: '#ffffff', nodeRing: 'rgba(40,72,158,0.85)',
    edge: 'rgba(40,55,110,0.28)', pass: '#1a7a45', reject: '#b32a1f',
    grid: 'rgba(40,55,110,0.18)', axis: 'rgba(40,55,110,0.28)', regA: 'rgba(40,72,158,0.07)', regB: 'rgba(106,63,176,0.07)',
    curveA: '#6a3fb0', curveB: '#28489e', glow: false, satP: 70, lBase: 30, lSpan: 18,
     amb: 'rgba(40,55,110,0.10)',
  },
  dark: {
    sphereLine: 'rgba(120,150,255,0.28)', wire: 'rgba(125,150,240,0.16)', wireEq: 'rgba(130,160,255,0.42)',
    sA: 'rgba(58,78,170,0.30)', sB: 'rgba(8,10,30,0.03)',
    faint: 'rgba(154,163,212,0.7)', node: '#eaedff', nodeFill: '#0c1030', nodeRing: 'rgba(63,224,230,0.8)',
    edge: 'rgba(120,140,230,0.22)', pass: 'rgba(82,227,164,0.95)', reject: 'rgba(255,90,115,0.95)',
    grid: 'rgba(120,140,230,0.2)', axis: 'rgba(120,140,230,0.15)', regA: 'rgba(63,224,230,0.06)', regB: 'rgba(155,123,255,0.06)',
    curveA: '#9b7bff', curveB: '#3fe0e6', glow: true, satP: 90, lBase: 40, lSpan: 28,
    amb: 'rgba(120,150,255,0.05)',
  },
};
const themeName = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'paper';
const TH = () => PAL[themeName()];
function phaseColor(re, im, a) {
  const t = TH(), hue = ((Math.atan2(im, re) * 180 / Math.PI) + 180 + 360) % 360, mag = Math.min(1, Math.hypot(re, im));
  return `hsla(${hue.toFixed(0)}, ${t.satP}%, ${(t.lBase + t.lSpan * mag).toFixed(0)}%, ${a == null ? 1 : a})`;
}
const reduce = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const moving = () => !reduce && TH().glow;       // ambient motion only in luminous mode
function blur(ctx, color, b) { if (TH().glow) { ctx.shadowColor = color; ctx.shadowBlur = b; } else { ctx.shadowBlur = 0; } }
function fit(cv, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || cv.parentElement.clientWidth;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h };
}

/* ------------------------------ 1 · ambient ------------------------------ */
function ambient() {
  const cv = document.getElementById('ambient'); if (!cv) return;
  const ctx = cv.getContext('2d'); let W = 0, H = 0, pts = [];
  function size() {
    if (cv.clientWidth === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pts = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.28, sp: 0.08 + Math.random() * 0.16, ph: Math.random() * 6.28, r: 1 + Math.random() * 1.6 }));
  }
  window.addEventListener('resize', size);
  let t = 0;
  (function loop() {
    if (themeName() !== 'dark') { requestAnimationFrame(loop); return; }
    if (!pts.length) size();
    t += 0.006; ctx.clearRect(0, 0, W, H);
    for (const p of pts) { p.x += Math.cos(p.a) * p.sp; p.y += Math.sin(p.a * 1.3) * p.sp; if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20; if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20; }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy); if (d < 130) { ctx.strokeStyle = `rgba(120,150,255,${0.05 * (1 - d / 130)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); } }
    for (const p of pts) { ctx.fillStyle = phaseColor(Math.cos(p.ph + t), Math.sin(p.ph + t), 0.55); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill(); }
    requestAnimationFrame(loop);
  })();
}

/* --------------------------- 2 · judge pipeline -------------------------- */
const BUNDLES = [
  { id: 'poc', label: 'GHZ-3 · state_prep · genuine', verdict: 'ACCEPT', gates: [{ p: 1, d: 'depth 3 ≤ 6, native gates, edges on the coupling map' }, { p: 1, d: 'fidelity 1.000 = claimed' }, { p: 1, d: '1.000 ≥ 0.99 threshold, beats 0.5 baseline' }, { p: 1, d: 'no held-out check — holds by construction', byc: 1 }] },
  { id: 'forged', label: 'GHZ-3 · FORGED (fabricated result)', verdict: 'REJECT', gates: [{ p: 1, d: 'circuit is well-formed' }, { p: 0, d: 'claims fidelity 1.000 — judge recomputes 0.250' }, null, null] },
  { id: 'pops', label: 'bell_pops2 · populations · genuine', verdict: 'ACCEPT', gates: [{ p: 1, d: 'valid 2-qubit circuit' }, { p: 1, d: 'populations [.5,0,0,.5] = claimed' }, { p: 1, d: 'matches the target distribution' }, { p: 1, d: 'held-out ⟨X₀X₁⟩ = +1.00 ✓' }] },
  { id: 'overfit', label: 'bell_pops2 · OVERFIT (wrong phase)', verdict: 'REJECT', gates: [{ p: 1, d: 'valid 2-qubit circuit' }, { p: 1, d: 'populations [.5,0,0,.5] = claimed' }, { p: 1, d: 'matches the visible spec' }, { p: 0, d: 'held-out ⟨X₀X₁⟩ = −1.00 ≠ +1.00 — gamed the visible spec' }] },
  { id: 'arch', label: 'aiaccel4 · architecture · ring', verdict: 'ACCEPT', gates: [{ p: 1, d: 'degree ≤ 2, connected, valid graph' }, { p: 1, d: 'routing cost 2 = claimed' }, { p: 1, d: '2 ≤ budget 2, beats baseline 4' }, { p: 1, d: 'held-out workload routes at cost 2 ✓' }] },
  { id: 'archX', label: 'aiaccel4 · architecture · OVERFIT path', verdict: 'REJECT', gates: [{ p: 1, d: 'degree ≤ 2, connected, valid graph' }, { p: 1, d: 'routing cost 2 = claimed' }, { p: 1, d: '2 ≤ budget 2 on the visible workload' }, { p: 0, d: 'held-out routing cost 4 > budget 2 — overfit the workload' }] },
  { id: 'qml', label: 'qml_sign1 · classify · Ry(x)', verdict: 'ACCEPT', gates: [{ p: 1, d: 'feature map is well-formed' }, { p: 1, d: 'train accuracy 1.00 = claimed' }, { p: 1, d: '1.00 ≥ training threshold' }, { p: 1, d: 'held-out test accuracy 1.00 ✓' }] },
  { id: 'qmlX', label: 'qml_sign1 · classify · OVERFIT Ry(7x)', verdict: 'REJECT', gates: [{ p: 1, d: 'feature map is well-formed' }, { p: 1, d: 'train accuracy 1.00 = claimed' }, { p: 1, d: '1.00 ≥ training threshold' }, { p: 0, d: 'held-out test accuracy 0.00 — overfit the training data' }] },
];
const GATE_EXIT = ['exit 3', 'exit 4', 'exit 5', 'exit 6'];
function pipeline() {
  const sel = document.getElementById('bundleSel'), run = document.getElementById('runBtn'), verdictEl = document.getElementById('verdict');
  const gates = [...document.querySelectorAll('.gate')];
  BUNDLES.forEach((b, i) => { const o = document.createElement('option'); o.value = i; o.textContent = b.label; sel.appendChild(o); });
  const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
  let running = false;
  async function play() {
    if (running) return; running = true; run.disabled = true;
    const b = BUNDLES[+sel.value];
    gates.forEach(g => { g.className = 'gate'; g.querySelector('.gdetail').textContent = '—'; });
    verdictEl.className = 'verdict'; verdictEl.textContent = 'running…';
    for (let i = 0; i < 4; i++) {
      const g = gates[i], info = b.gates[i];
      g.classList.add('active'); await wait(520); g.classList.remove('active');
      if (!info) { g.querySelector('.gdetail').textContent = 'not reached'; continue; }
      g.querySelector('.gdetail').textContent = info.d;
      if (info.byc) g.classList.add('byc');
      g.classList.add(info.p ? 'pass' : 'reject'); await wait(260);
      if (!info.p) break;
    }
    verdictEl.classList.add(b.verdict === 'ACCEPT' ? 'accept' : 'reject');
    verdictEl.textContent = b.verdict === 'ACCEPT' ? 'ACCEPT · exit 0' : 'REJECT · ' + GATE_EXIT[b.gates.findIndex(g => g && !g.p)];
    running = false; run.disabled = false;
  }
  run.addEventListener('click', play);
  sel.addEventListener('change', () => { gates.forEach(g => g.className = 'gate'); verdictEl.className = 'verdict'; verdictEl.textContent = 'ready'; });
  setTimeout(play, 500);
}

/* ----------------------------- 3 · Bloch 3D ------------------------------ */
function blochSection() {
  const cv = document.getElementById('bloch'); if (!cv) return;
  const bars = document.getElementById('bars'), stepsEl = document.getElementById('blochSteps'), ro = document.getElementById('blochReadout');
  const STEPS = [
    { label: '|000⟩ — separable', apply: n => zero(n) },
    { label: 'H q0 — superposition', apply: n => apply1q(zero(n), n, GATES.h, 0) },
    { label: 'CX 0,1 — entangling', apply: n => applyCX(apply1q(zero(n), n, GATES.h, 0), n, 0, 1) },
    { label: 'CX 1,2 — GHZ state', apply: n => applyCX(applyCX(apply1q(zero(n), n, GATES.h, 0), n, 0, 1), n, 1, 2) },
  ];
  const N = 3; let step = 0, cur = { x: 0, y: 0, z: 1 }, target = { x: 0, y: 0, z: 1 }, yaw = 0.6, state = STEPS[0].apply(N);
  STEPS.forEach((_, i) => { const d = document.createElement('span'); d.className = 'dot'; stepsEl.appendChild(d); });
  function setStep(i) {
    step = i; state = STEPS[i].apply(N);
    const b = reducedBloch(state, N, 0); target = { x: b.x, y: b.y, z: b.z };
    [...stepsEl.children].forEach((d, k) => d.classList.toggle('on', k === i)); drawBars(); readout(b);
  }
  function readout(b) {
    const probs = state.map(a => a.re ** 2 + a.im ** 2);
    const top = probs.map((p, i) => [p, i]).filter(x => x[0] > 1e-6).map(x => '|' + x[1].toString(2).padStart(N, '0') + '⟩').join('  ');
    ro.innerHTML =
      `<div class="row"><span>step</span><b>${STEPS[step].label}</b></div>` +
      `<div class="row"><span>qubit-0 Bloch length</span><b style="color:${b.len > 0.5 ? 'var(--accent)' : 'var(--reject)'}">${b.len.toFixed(3)}</b></div>` +
      `<div class="row"><span>qubit 0</span><b>${b.len > 0.5 ? 'pure (on surface)' : 'mixed (entangled)'}</b></div>` +
      `<div class="row"><span>support</span><b>${top}</b></div>`;
  }
  function project(p, R, cx, cy) {
    const pitch = 0.42;
    let x = p.x * Math.cos(yaw) + p.y * Math.sin(yaw), y = -p.x * Math.sin(yaw) + p.y * Math.cos(yaw); const z = p.z;
    const y2 = y * Math.cos(pitch) - z * Math.sin(pitch), z2 = y * Math.sin(pitch) + z * Math.cos(pitch);
    return { sx: cx + x * R, sy: cy - z2 * R, depth: y2 };
  }
  function drawSphere() {
    const t = TH(), { ctx, w, h } = fit(cv, 360); ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) * 0.38;
    const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    sg.addColorStop(0, t.sA); sg.addColorStop(0.7, themeName() === 'dark' ? 'rgba(20,26,70,0.16)' : 'rgba(40,70,160,0.03)'); sg.addColorStop(1, t.sB);
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = t.sphereLine; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    for (let lo = 0; lo < Math.PI; lo += Math.PI / 6) { ctx.beginPath(); for (let a = 0; a <= 6.2933; a += 0.15) { const p = project({ x: Math.sin(a) * Math.cos(lo), y: Math.sin(a) * Math.sin(lo), z: Math.cos(a) }, R, cx, cy); a === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy); } ctx.strokeStyle = t.wire; ctx.lineWidth = 1; ctx.stroke(); }
    for (let la = -Math.PI / 2 + Math.PI / 6; la < Math.PI / 2; la += Math.PI / 6) { ctx.beginPath(); for (let a = 0; a <= 6.2933; a += 0.15) { const p = project({ x: Math.cos(la) * Math.cos(a), y: Math.cos(la) * Math.sin(a), z: Math.sin(la) }, R, cx, cy); a === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy); } ctx.strokeStyle = la === 0 ? t.wireEq : t.wire; ctx.lineWidth = la === 0 ? 1.3 : 1; ctx.stroke(); }
    const top = project({ x: 0, y: 0, z: 1 }, R, cx, cy), bot = project({ x: 0, y: 0, z: -1 }, R, cx, cy);
    ctx.fillStyle = t.faint; ctx.font = '12px ui-monospace, monospace'; ctx.fillText('|0⟩', top.sx - 9, top.sy - 10); ctx.fillText('|1⟩', bot.sx - 9, bot.sy + 20);
    cur.x += (target.x - cur.x) * 0.12; cur.y += (target.y - cur.y) * 0.12; cur.z += (target.z - cur.z) * 0.12;
    const len = Math.hypot(cur.x, cur.y, cur.z), tip = project(cur, R, cx, cy), o = project({ x: 0, y: 0, z: 0 }, R, cx, cy);
    const col = len > 0.02 ? phaseColor(cur.x, cur.y, 1) : t.reject;
    ctx.strokeStyle = col; ctx.lineWidth = 2.6; blur(ctx, col, 16);
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(tip.sx, tip.sy); ctx.stroke();
    blur(ctx, col, 22); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tip.sx, tip.sy, len > 0.02 ? 6 : 7, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
    if (len < 0.06) { ctx.fillStyle = t.reject; ctx.font = '11px ui-monospace, monospace'; ctx.fillText('maximally mixed', cx - 44, cy + 2); }
    if (moving()) yaw += 0.0045;
    requestAnimationFrame(drawSphere);
  }
  function drawBars() {
    const t = TH(), { ctx, w, h } = fit(bars, 150); ctx.clearRect(0, 0, w, h);
    const n2 = state.length, bw = (w - 20) / n2, base = h - 26;
    for (let i = 0; i < n2; i++) {
      const a = state[i], mag = cabs(a), x = 10 + i * bw, bh = mag * (base - 10);
      ctx.fillStyle = mag > 1e-6 ? phaseColor(a.re, a.im, 0.95) : (themeName() === 'dark' ? 'rgba(120,140,230,0.12)' : 'rgba(40,55,110,0.08)');
      if (mag > 1e-6) blur(ctx, phaseColor(a.re, a.im, 1), 14);
      ctx.fillRect(x + 3, base - bh, bw - 6, bh); ctx.shadowBlur = 0;
      ctx.fillStyle = t.faint; ctx.font = '9px ui-monospace, monospace'; ctx.fillText('|' + i.toString(2).padStart(N, '0') + '⟩', x + 1, h - 10);
    }
  }
  setStep(1); drawSphere();
  document.getElementById('blochNext').addEventListener('click', () => setStep((step + 1) % STEPS.length));
  document.getElementById('blochPrev').addEventListener('click', () => setStep((step + STEPS.length - 1) % STEPS.length));
  window.addEventListener('resize', drawBars);
}

/* ---------------------------- 4 · topology graph ------------------------- */
function topologySection() {
  const cv = document.getElementById('topo'); if (!cv) return;
  const ro = document.getElementById('topoReadout'); const N = 4;
  const EDGES = { ring: [[0, 1], [1, 2], [2, 3], [3, 0]], path: [[0, 1], [1, 2], [2, 3]] };
  const VIS = [[0, 1], [2, 3]], HELD = [[0, 3], [1, 2]];
  let mode = 'ring', show = 'held', tphase = 0;
  const pos = (i, w, h) => { const a = -Math.PI / 2 + i * Math.PI / 2, R = Math.min(w, h) * 0.32; return { x: w / 2 + Math.cos(a) * R, y: h / 2 + Math.sin(a) * R }; };
  function adj() { const m = Array.from({ length: N }, () => []); for (const [a, b] of EDGES[mode]) { m[a].push(b); m[b].push(a); } return m; }
  function path(a, b) { const m = adj(), prev = Array(N).fill(-1), seen = Array(N).fill(false), q = [a]; seen[a] = true; while (q.length) { const u = q.shift(); if (u === b) break; for (const v of m[u]) if (!seen[v]) { seen[v] = true; prev[v] = u; q.push(v); } } const p = []; let c = b; while (c !== -1) { p.unshift(c); c = prev[c]; } return p[0] === a ? p : []; }
  function cost(wl) { return wl.reduce((s, [a, b]) => s + Math.max(0, path(a, b).length - 1), 0); }
  function draw() {
    const t = TH(), { ctx, w, h } = fit(cv, 380); ctx.clearRect(0, 0, w, h);
    const P = Array.from({ length: N }, (_, i) => pos(i, w, h));
    for (const [a, b] of EDGES[mode]) { ctx.strokeStyle = t.edge; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke(); }
    const wl = show === 'vis' ? VIS : HELD, budget = 2, c = cost(wl), over = c > budget;
    wl.forEach((pair, idx) => {
      const route = path(pair[0], pair[1]); if (route.length < 2) return;
      const col = over ? t.reject : t.pass;
      ctx.strokeStyle = col; ctx.lineWidth = 3.4; blur(ctx, col, 12);
      ctx.beginPath(); ctx.moveTo(P[route[0]].x, P[route[0]].y); for (let k = 1; k < route.length; k++) ctx.lineTo(P[route[k]].x, P[route[k]].y); ctx.stroke(); ctx.shadowBlur = 0;
      const segLen = route.length - 1, tt = (tphase + idx * 0.5) % 1, seg = Math.min(segLen - 1, Math.floor(tt * segLen)), f = tt * segLen - seg, A = P[route[seg]], B = P[route[seg + 1]];
      ctx.fillStyle = themeName() === 'dark' ? '#fff' : col; blur(ctx, col, 16); ctx.beginPath(); ctx.arc(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, 4.5, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
    });
    P.forEach((p, i) => {
      ctx.fillStyle = t.nodeFill; ctx.strokeStyle = t.nodeRing; ctx.lineWidth = 2; blur(ctx, t.nodeRing, 14);
      ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = t.node; ctx.font = '600 14px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('q' + i, p.x, p.y);
    });
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ro.innerHTML =
      `<div class="row"><span>topology</span><b>${mode}</b></div>` +
      `<div class="row"><span>workload</span><b>${show === 'vis' ? 'visible [0-1],[2-3]' : 'held-out [0-3],[1-2]'}</b></div>` +
      `<div class="row"><span>routing cost</span><b style="color:${over ? 'var(--reject)' : 'var(--pass)'}">${c} / budget ${budget}</b></div>` +
      `<div class="row"><span>verdict</span><b style="color:${over ? 'var(--reject)' : 'var(--pass)'}">${over ? 'REJECT · anti-overfit exit 6' : 'within budget ✓'}</b></div>`;
    if (moving()) tphase = (tphase + 0.008) % 1;
    requestAnimationFrame(draw);
  }
  draw();
  const mBtns = document.querySelectorAll('[data-mode]'), wBtns = document.querySelectorAll('[data-wl]');
  mBtns.forEach(btn => btn.addEventListener('click', () => { mode = btn.dataset.mode; mBtns.forEach(b => b.setAttribute('aria-pressed', b === btn)); }));
  wBtns.forEach(btn => btn.addEventListener('click', () => { show = btn.dataset.wl; wBtns.forEach(b => b.setAttribute('aria-pressed', b === btn)); }));
}

/* ---------------------------- 5 · classifier ----------------------------- */
function classifierSection() {
  const cv = document.getElementById('clf'); if (!cv) return;
  const slider = document.getElementById('scale'), ro = document.getElementById('clfReadout'), tag = document.getElementById('scaleTag');
  const TRAIN = [[-2, 0], [-1, 0], [1, 1], [2, 1]], TEST = [[-0.5, 0], [0.5, 1]];
  const f = (s, x) => Math.sin(s * x), pred = (s, x) => f(s, x) > 0 ? 1 : 0, acc = (s, set) => set.filter(([x, y]) => pred(s, x) === y).length / set.length;
  function draw() {
    const t = TH(), scale = parseFloat(slider.value), { ctx, w, h } = fit(cv, 320); ctx.clearRect(0, 0, w, h);
    const padX = 24, padY = 18, X0 = -3, X1 = 3, sx = x => padX + (x - X0) / (X1 - X0) * (w - 2 * padX), sy = v => h / 2 - v * (h / 2 - padY);
    const stepN = 240;
    for (let i = 0; i < stepN; i++) { const x = X0 + (i + 0.5) / stepN * (X1 - X0); ctx.fillStyle = pred(scale, x) === 1 ? t.regA : t.regB; ctx.fillRect(sx(X0 + i / stepN * (X1 - X0)), padY, (w - 2 * padX) / stepN + 1, h - 2 * padY); }
    ctx.strokeStyle = t.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padX, h / 2); ctx.lineTo(w - padX, h / 2); ctx.stroke();
    ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(sx(0), padY); ctx.lineTo(sx(0), h - padY); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i <= 360; i++) { const x = X0 + i / 360 * (X1 - X0); i === 0 ? ctx.moveTo(sx(x), sy(f(scale, x))) : ctx.lineTo(sx(x), sy(f(scale, x))); }
    const grad = ctx.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, t.curveA); grad.addColorStop(1, t.curveB);
    ctx.strokeStyle = grad; ctx.lineWidth = 2.4; blur(ctx, t.curveB, 10); ctx.stroke(); ctx.shadowBlur = 0;
    function dot(x, y, r, test) { const ok = pred(scale, x) === y, col = ok ? t.pass : t.reject; ctx.fillStyle = col; blur(ctx, col, 12); ctx.beginPath(); ctx.arc(sx(x), sy(f(scale, x)), r, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0; if (test) { ctx.strokeStyle = themeName() === 'dark' ? '#fff' : '#15171c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(x), sy(f(scale, x)), r + 3, 0, 6.2832); ctx.stroke(); } }
    TRAIN.forEach(([x, y]) => dot(x, y, 7, false)); TEST.forEach(([x, y]) => dot(x, y, 5, true));
    const trA = acc(scale, TRAIN), teA = acc(scale, TEST), pass = teA >= 0.99 && trA >= 0.99;
    tag.textContent = 'scale = ' + scale.toFixed(1);
    ro.innerHTML =
      `<div class="row"><span>feature map</span><b>Ry(${scale.toFixed(1)}·x) → ⟨X⟩</b></div>` +
      `<div class="row"><span>train accuracy</span><b style="color:${trA >= 0.99 ? 'var(--pass)' : 'var(--reject)'}">${(trA * 100).toFixed(0)}%</b></div>` +
      `<div class="row"><span>held-out test accuracy</span><b style="color:${teA >= 0.99 ? 'var(--pass)' : 'var(--reject)'}">${(teA * 100).toFixed(0)}%</b></div>` +
      `<div class="row"><span>verdict</span><b style="color:${pass ? 'var(--pass)' : 'var(--reject)'}">${pass ? 'ACCEPT · exit 0' : 'REJECT · anti-overfit exit 6'}</b></div>`;
  }
  draw(); slider.addEventListener('input', draw); window.addEventListener('resize', draw);
}

/* ------------------------------- theme UI -------------------------------- */
function setupTheme() {
  const btn = document.getElementById('themeToggle'), lbl = document.getElementById('themeLabel');
  const sync = () => { lbl.textContent = themeName() === 'dark' ? 'Paper mode' : 'Luminous mode'; };
  sync();
  btn.addEventListener('click', () => {
    if (themeName() === 'dark') { document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', 'dark'); }
    try { localStorage.setItem('qh-theme', themeName()); } catch (e) {}
    sync();
    window.dispatchEvent(new Event('resize')); // re-size ambient + redraw on-demand canvases
  });
}

/* ----------------------------- scoreboard -------------------------------- */
/* rank = the verified primary metric (the leaderboard). grade = a holistic
   quality profile from knowledge.js, so the board sorts/filters by either. */
let sbSort = 'grade', sbFilter = 'all';
const SB_SORTS = [['grade', 'Grade'], ['margin', 'Margin'], ['efficiency', 'Efficiency'], ['robustness', 'Robustness'], ['metric', 'Rank']];
function sbVal(r, key) {
  if (key === 'metric') return -(r.rank || 1);
  const q = r.quality || {};
  return key === 'grade' ? (q.score || 0) : (q[key] || 0);
}
function findRun(pid, para) {
  const d = window.SCOREBOARD_DATA; if (!d) return null;
  return d.rows.find(r => r.problem_id === pid && r.paradigm_short === para) || d.rows.find(r => r.problem_id === pid) || null;
}
function proofLinks(r, esc) {
  let h = `<a href="${esc(r.bundleUrl)}">bundle ↗</a>`;
  // ALL hardware reports are listed (the schema is an array — never truncated to
  // the first), each with its sim-vs-hw delta shown inline, not tooltip-only.
  // An emulated/synthetic backend is labeled noisy-sim — never presented as hardware.
  const reports = r.hardware_reports || (r.hardware ? [r.hardware] : []);
  for (const hw of reports) {
    const dTxt = hw.delta != null ? ` Δ ${hw.delta_pct != null ? hw.delta_pct + '%' : hw.delta}` : '';
    const dTitle = hw.delta != null
      ? ` · sim ${hw.sim_value} vs measured ${hw.value} → Δ ${hw.delta > 0 ? '+' : ''}${hw.delta}${hw.delta_pct != null ? ' (' + hw.delta_pct + '%)' : ''}`
      : '';
    if (hw.emulated || hw.label === 'noisy-sim')
      h += ` <a class="hwlink simlink" href="${esc(hw.url)}" title="EMULATED backend — a noisy simulation, not a device run · ${esc(hw.backend)} · ${esc(hw.metric)} ${esc(hw.value)}${esc(dTitle)}">≈ noisy-sim${esc(dTxt)} ↗</a>`;
    else h += ` <a class="hwlink" href="${esc(hw.url)}" title="hardware overlay · ${esc(hw.backend)} · ${esc(hw.metric)} ${esc(hw.value)}${esc(dTitle)}">⚛ ${esc(hw.backend)}${esc(dTxt)} ↗</a>`;
  }
  if (window.QMRunner && window.QMRunner.RUNS[r.problem_id]) h += ` · <a href="#" data-run="${esc(r.problem_id)}" title="re-run this circuit in your browser">▸ run</a>`;
  // reproduced ×N — attested, trusted-but-labeled credibility display; NEVER changes rank
  if (r.reproduced) h += ` <span class="repro" title="reproduced ×${r.reproduced}: ${esc(r.reproduced_by.join(', '))} re-ran the judge on this exact bundle (sha256-pinned attestation in scoreboard/attestations/) and it ACCEPTed. Attested and labeled — it never changes rank; or re-run it yourself: ${esc(r.reverify)}">↺ reproduced ×${r.reproduced}</span>`;
  h += ` <button class="citebtn" type="button" title="export a citation pinned to this bundle's sha256 + the exact re-verify command">cite</button>`;
  return h;
}

/* ---------------------------- cite-this-run ------------------------------- */
/* Exports BibTeX + CSL-JSON pinned to the committed bundle's sha256 (raw file
   bytes, lowercase hex) plus the exact offline re-verify command — the citation
   IS the reproduction instructions. HONESTY: when a bundle's bytes are not
   committed in this repo (external run repo), the hash is null and the export
   says "hash unavailable — re-verify from the run repo" rather than faking one. */
const HASH_UNAVAILABLE = 'hash unavailable — re-verify from the run repo';
function citeStrings(r) {
  const pin = r.bundle_sha256 ? `sha256:${r.bundle_sha256}` : HASH_UNAVAILABLE;
  const year = (r.verified_at || '').slice(0, 4) || 'n.d.';
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const key = `quantummytheme_${slug(r.problem_id)}_${slug(r.paradigm_short)}`;
  const title = `${r.problem_id}: ${r.paradigm_short} — judge-verified ${r.task} design (${r.metricName} ${r.metricValue})`;
  const note = `Machine-verified by a re-runnable four-gate judge (exit 0), not peer review. Proof bundle ${pin}. Re-verify offline: ${r.reverify}. Model provenance (never a ranking key): ${r.model}.`;
  const bibtex = `@misc{${key},
  title        = {{${title}}},
  author       = {{QuantumMytheme scoreboard contributors}},
  year         = {${year}},
  howpublished = {\\url{${r.bundleUrl}}},
  note         = {${note}}
}`;
  const dp = (r.verified_at || '').split('-').map(Number).filter(Number.isFinite);
  const csl = JSON.stringify({
    id: key.replace(/_/g, '-'), type: 'dataset', title,
    URL: r.bundleUrl,
    ...(dp.length === 3 ? { issued: { 'date-parts': [dp] } } : {}),
    note,
  }, null, 2);
  return { bibtex, csl, reverify: r.reverify, pin };
}
function openCiteModal(r) {
  const K = window.QMKnowledge, R = window.QMRunner;
  if (!R) return;
  const esc = (K && K.esc) || R.esc || (s => String(s));
  const c = citeStrings(r);
  const block = (label, text) =>
    `<div class="citeblock"><div class="citehead"><b>${esc(label)}</b><button class="citecopy" type="button">copy</button></div>` +
    `<pre><code>${esc(text)}</code></pre></div>`;
  R.openOverlay('modal', '<div class="cite-modal">' +
    `<h3>Cite this run — <span class="mono">${esc(r.problem_id)}</span> · ${esc(r.paradigm_short)}</h3>` +
    `<p class="lead">Pinned to the exact proof bundle: <span class="mono citepin">${esc(c.pin)}</span>. ` +
    'The citation carries the re-verify command, so citing it means anyone can recheck it — verified by a re-runnable judge, not peer review.</p>' +
    block('BibTeX', c.bibtex) + block('CSL-JSON', c.csl) + block('Re-verify (offline, numpy only)', c.reverify) +
    '</div>');
}
document.addEventListener('click', (e) => {
  const copy = e.target.closest('.citecopy');
  if (copy) {
    const code = copy.closest('.citeblock').querySelector('code');
    const done = ok => { copy.textContent = ok ? 'copied ✓' : 'select + copy'; setTimeout(() => { copy.textContent = 'copy'; }, 1600); };
    if (code && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code.textContent).then(() => done(true), () => done(false));
    else done(false);
    return;
  }
  const btn = e.target.closest('.citebtn');
  if (!btn) return;
  const row = btn.closest('.sb-row');
  if (!row) return;
  const run = findRun(row.getAttribute('data-pid'), row.getAttribute('data-para'));
  if (run) openCiteModal(run);
});
// structured lineage (entry-declared remix_of): descent chain + ingredient credit
function lineageTags(r, esc) {
  let h = '';
  if (r.remix_of && r.remix_of.length)
    h += `<span class="lineage" title="declared in the entry's remix_of field">⟲ remix of ${r.remix_of.map(x => `<a href="https://github.com/${esc(x)}">${esc(x.split('/').pop())}</a>`).join(', ')}</span>`;
  if (r.remixed_by) h += `<span class="lineage" title="verified runs that declare this run as an ingredient">→ remixed by ${r.remixed_by}</span>`;
  return h;
}
function renderScoreboard() {
  const d = window.SCOREBOARD_DATA, body = document.getElementById('sb-body'), K = window.QMKnowledge;
  if (!d || !d.rows || !body) return;
  const esc = K ? K.esc : (s => s);
  const tools = document.getElementById('sb-tools');
  if (tools) {
    const tasks = ['all', ...Array.from(new Set(d.rows.map(r => r.task)))];
    tools.innerHTML =
      '<div class="sb-tool"><span class="sb-tlabel">sort by</span>' + SB_SORTS.map(s => `<button class="sb-chip${sbSort === s[0] ? ' on' : ''}" data-sbsort="${s[0]}">${s[1]}</button>`).join('') + '</div>' +
      '<div class="sb-tool"><span class="sb-tlabel">task</span>' + tasks.map(t => `<button class="sb-chip${sbFilter === t ? ' on' : ''}" data-sbfilter="${t}">${esc(t)}</button>`).join('') + '</div>';
  }
  let rows = d.rows.filter(r => sbFilter === 'all' || r.task === sbFilter);
  rows = rows.slice().sort((a, b) => (sbVal(b, sbSort) - sbVal(a, sbSort)) || ((a.rank || 1) - (b.rank || 1)));
  body.innerHTML = rows.length ? rows.map(r => {
    const q = r.quality, taskCell = K ? K.taskChip(r.task) : r.task;
    return '<tr class="sb-row" data-pid="' + esc(r.problem_id) + '" data-para="' + esc(r.paradigm_short) + '">' +
      `<td><b>${esc(r.problem_id)}</b> ${taskCell}${r.rank > 1 ? ` <span class="dimnum">#${r.rank}</span>` : ''}</td>` +
      `<td><span class="ptag">${esc(r.paradigm_short)}</span>${lineageTags(r, esc)}</td>` +
      `<td class="num">${esc(r.metricName)} <b>${esc(r.metricValue)}</b><span class="sub">${esc(r.metricSub)}</span></td>` +
      `<td>${K && q ? K.profileBadge(q) : ''}</td>` +
      `<td class="num">${esc(r.costLabel)}</td>` +
      `<td><span class="mtag">${esc(r.model)}</span></td>` +
      `<td>${proofLinks(r, esc)}</td>` +
      '</tr>';
  }).join('') : '<tr><td colspan="7" class="dimnum">no runs match this filter</td></tr>';
  const leg = document.getElementById('sb-legend');
  if (leg && K) leg.innerHTML =
    '<p class="sb-legtitle"><b>How to read quality.</b> ' + esc(K.GRADE_NOTE) + ' Click any row for the problem and its full breakdown.</p>' +
    '<div class="sb-axes">' + K.QUALITY_AXES.map(a => `<span class="sb-axis"><b>${esc(a[1])}</b> — ${esc(a[2])}</span>`).join('') + '</div>';
  const why = document.getElementById('sb-why');
  if (why) why.innerHTML = d.rows.map(r => `<li><b>${esc(r.problem_id)}</b> — ${esc(r.why)}</li>`).join('');
  const meta = document.getElementById('sb-meta');
  if (meta) meta.textContent = `· ${d.count} entr${d.count === 1 ? 'y' : 'ies'}, generated ${d.generated}`;
}
/* ------------------------- paradigm league ------------------------------- */
/* Corpus-level (paradigm × task) rollup — SCOREBOARD.md §(c)'s comparative
   question. HONESTY: any row with n < 3 is greyed and badged "anecdote, not
   evidence" — small-n must never masquerade as a finding; and rows group by
   (paradigm × task), so no cross-task ranking is ever shown. */
function renderLeague() {
  const d = window.SCOREBOARD_DATA, el = document.getElementById('sb-league'), K = window.QMKnowledge;
  if (!el || !d || !d.paradigms || !d.paradigms.length) return;
  const esc = K ? K.esc : (s => String(s));
  const untestedCell = p => {
    if (!p.untested_problems.length) return '<span class="dimnum">none — every board of this task entered</span>';
    return `<span class="league-untested" title="same-task problems this paradigm has not entered — untried, not settled">${p.untested_problems.map(u => `<span class="mono">${esc(u)}</span>`).join(', ')}</span>`;
  };
  const rows = d.paradigms.map(p => {
    const anec = !p.evidence;
    return `<tr class="league-row${anec ? ' anecdote' : ''}">` +
      `<td><span class="ptag">${esc(p.paradigm)}</span></td>` +
      `<td>${K ? K.taskChip(p.task) : esc(p.task)}</td>` +
      `<td class="num">${p.n}</td>` +
      `<td class="num">${p.rank1_count}/${p.boards.length} <span class="sub">${p.boards.map(esc).join(', ')}</span></td>` +
      `<td class="num">${p.mean_margin.toFixed(2)}</td>` +
      `<td class="num">${p.mean_efficiency.toFixed(2)}</td>` +
      `<td>${untestedCell(p)}</td>` +
      `<td>${anec
        ? `<span class="anecbadge" title="fewer than 3 verified runs — a mean over n=${p.n} is an anecdote, not evidence; the numbers are shown greyed so small-n never masquerades as a finding">n=${p.n} — anecdote, not evidence</span>`
        : `<span class="evbadge" title="3 or more verified runs — enough to call a pattern worth scrutinizing">n=${p.n}</span>`}</td>` +
      '</tr>';
  }).join('');
  el.innerHTML =
    '<h3>Paradigm league — which design idea wins where</h3>' +
    '<p class="lead">Every verified run, rolled up by <b>paradigm family × task</b> (SCOREBOARD.md §c). ' +
    'Mean margin and mean efficiency reuse the quality axes above. <b>No cross-task ranking is shown</b> — different tasks are different games. ' +
    'A greyed row means <b>n &lt; 3: an anecdote, not evidence</b>; the untested column is the paradigm’s open cells on the wanted board below.</p>' +
    '<div class="panel results-wrap"><table class="results league-table">' +
    '<thead><tr><th>Paradigm</th><th>Task</th><th>Runs</th><th>Rank-1 / boards</th><th>Mean margin</th><th>Mean efficiency</th><th>Untested problems (same task)</th><th>Evidence</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>` +
    '<p class="figcap"><b>Reading rule.</b> A cell only becomes a finding when a paradigm has n ≥ 3 verified runs on a task — ' +
    'until then it renders greyed as an anecdote. Fill an untested cell (the wanted board has the exact mint command) and the sample grows.</p>';
}

/* ------------------------ frontier changelog ------------------------------ */
/* Timeline of the last ~10 typed ledger events (window.SCOREBOARD_DATA.changelog,
   newest first) + a link to the Atom feed. Dates are each entry's verified_at —
   the ledger never invents timestamps at build time. */
function renderChangelog() {
  const d = window.SCOREBOARD_DATA, el = document.getElementById('sb-changelog'), K = window.QMKnowledge;
  if (!el || !d || !d.changelog || !d.changelog.length) return;
  const esc = K ? K.esc : (s => String(s));
  const chip = t => `<span class="chtype chtype-${esc(String(t).toLowerCase().replace(/_/g, ''))}">${esc(String(t).replace(/_/g, ' '))}</span>`;
  const items = d.changelog.map(e =>
    `<li class="chlog-item">` +
    `<span class="chdate mono">${esc(e.date || '—')}</span>${chip(e.type)}` +
    (e.problem_id ? ` <b class="mono">${esc(e.problem_id)}</b>` : '') +
    ` <span class="chdetail">${esc(e.detail)}</span>` +
    (e.genesis ? ` <span class="chgen" title="backfilled from the board state when the ledger was created — the true event order predates the ledger">genesis</span>` : '') +
    (e.run_repo ? ` <a href="${esc(e.run_repo)}">run ↗</a>` : '') +
    `</li>`).join('');
  el.innerHTML =
    '<h3>Frontier changelog — what moved, and when</h3>' +
    '<p class="lead">Typed events appended by the scoreboard build whenever the verified frontier moves: a rank-1 dethroned, ' +
    'a Pareto expansion, a new paradigm or board, a runner-up closing the gap. Append-only, every number judge-emitted. ' +
    '<a href="feed.xml" type="application/atom+xml">Subscribe — Atom feed ↗</a></p>' +
    `<ol class="chlog">${items}</ol>` +
    '<p class="figcap"><b>Dates, honestly.</b> Each event is dated by the triggering entry\'s <span class="mono">verified_at</span> ' +
    '(the submitter\'s last judge re-run) — never by the build clock. The full append-only ledger is ' +
    '<a href="https://github.com/QuantumMytheme/quantum-harness/blob/main/scoreboard/frontier-history.json">scoreboard/frontier-history.json ↗</a>.</p>';
}

// scoreboard interactions: sort / filter / open the problem + quality card
document.addEventListener('click', (e) => {
  const sortBtn = e.target.closest('[data-sbsort]');
  if (sortBtn) { sbSort = sortBtn.getAttribute('data-sbsort'); renderScoreboard(); return; }
  const filtBtn = e.target.closest('[data-sbfilter]');
  if (filtBtn) { sbFilter = filtBtn.getAttribute('data-sbfilter'); renderScoreboard(); return; }
  const row = e.target.closest('.sb-row');
  if (row && !e.target.closest('a') && !e.target.closest('button') && window.QMKnowledge && window.QMRunner) {
    const run = findRun(row.getAttribute('data-pid'), row.getAttribute('data-para'));
    if (run) window.QMRunner.openOverlay('modal', '<div class="pcard-modal">' + window.QMKnowledge.problemCard(run.problem_id, run.quality) + '</div>');
  }
});

/* -------------------------------- boot ----------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  setupTheme(); ambient(); pipeline(); blochSection(); topologySection(); classifierSection(); renderScoreboard(); renderLeague(); renderChangelog();
  const y = document.getElementById('year'); if (y) y.textContent = '2026';
});
