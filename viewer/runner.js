/* QuantumMytheme · runner.js — a SHARED in-browser circuit runner used by both
   the overview (scoreboard rows) and the field notebook (gallery cards).
   - Instant preview: a dependency-free JS statevector simulator recomputes the
     judge's metric live (offline, file://-safe).
   - Real judge: on demand it loads Pyodide (WASM) and runs the ACTUAL
     bench/quantum-judge/judge_verify.py + numpy in the browser — no server, never
     leave the page. Exposes window.QMRunner.
   Styling reads the host page's style.css tokens, so it themes with paper/luminous. */
(function () {
  'use strict';
  if (window.QMRunner) return;
  var root = document.documentElement;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var RAW = 'https://raw.githubusercontent.com/QuantumMytheme/quantum-harness/main/bench/quantum-judge/';
  var PY = ['sim.py', 'graph.py', 'density_matrix.py', 'judge_verify.py'];
  var KRAW = 'https://raw.githubusercontent.com/QuantumMytheme/quantum-harness/main/bench/kernel-judge/';
  // committed TPU-kernel bundles the real judge can verify in-browser (an honest ACCEPT + one forgery per class)
  var KERNEL_RUNS = {
    'gemm-ok':       { label: 'bf16 GEMM — honest', refId: 'gemm_bf16_tile1', bundle: 'bundle-gemm-bf16-OK.json', expect: 'ACCEPT' },
    'gemm-swapped':  { label: 'bf16 GEMM — swapped output', refId: 'gemm_bf16_tile1', bundle: 'bundle-gemm-bf16-SWAPPED.json', expect: 'REJECT · 4' },
    'gemm-inputfit': { label: 'bf16 GEMM — overfit held-out', refId: 'gemm_bf16_tile1', bundle: 'bundle-gemm-bf16-INPUTFIT.json', expect: 'REJECT · 6' },
    'roofline-ok':   { label: 'roofline — honest coordinate', refId: 'roofline_gemm_v5e', bundle: 'bundle-roofline-OK.json', expect: 'ACCEPT' },
    'roofline-lie':  { label: 'roofline — inflated %-of-peak', refId: 'roofline_gemm_v5e', bundle: 'bundle-roofline-PEAKLIE.json', expect: 'REJECT · 4' },
    'roofline-v6e':  { label: 'roofline — TPU v6e (Trillium)', refId: 'roofline_gemm_v6e', bundle: 'bundle-roofline-v6e-OK.json', expect: 'ACCEPT' }
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function rv(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  function hexRGB(h) { h = (h || '').trim(); if (h[0] === '#') { if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; } var m = h.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [40, 72, 158]; }
  function C() { var a = rv('--accent'); return { bg: rv('--stage-bg') || rv('--bg'), ink: rv('--ink'), ink2: rv('--ink-2'), faint: rv('--faint'), rule: rv('--rule'), rule2: rv('--rule-2'), accent: a, argb: hexRGB(a).join(','), accent2: rv('--accent-2') || a, pass: rv('--pass'), reject: rv('--reject') }; }
  function accA(c, a) { return 'rgba(' + c.argb + ',' + a + ')'; }
  function MONOF(px) { return px + 'px ' + (rv('--mono') || 'monospace'); }
  function fit(cv) { var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 480, h = cv.clientHeight || 180; cv.width = w * dpr; cv.height = h * dpr; var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx: ctx, w: w, h: h }; }

  // ---------- injected CSS (uses style.css vars; themes automatically) ----------
  var css = '.qm-overlay{position:fixed;inset:0;z-index:60;display:none}.qm-overlay.open{display:flex}.qm-overlay.center{align-items:center;justify-content:center}' +
    '.qm-scrim{position:absolute;inset:0;background:rgba(10,12,18,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}html[data-theme="dark"] .qm-scrim{background:rgba(2,3,8,.72)}' +
    '.qm-panel{position:relative;background:var(--bg);color:var(--ink);border:1px solid var(--rule)}' +
    '.qm-drawer{width:min(560px,96vw);margin-left:auto;height:100%;overflow-y:auto;border-left:1px solid var(--rule);box-shadow:-18px 0 50px -20px rgba(0,0,0,.5);padding:24px 26px 44px;animation:qmSlide .3s cubic-bezier(.2,.7,.2,1)}' +
    '.qm-modalpanel{width:min(780px,94vw);max-height:92vh;overflow-y:auto;border-radius:6px;box-shadow:0 30px 70px -22px rgba(0,0,0,.5);padding:28px 30px 34px;animation:qmRise .3s cubic-bezier(.2,.7,.2,1)}' +
    '@keyframes qmSlide{from{transform:translateX(30px);opacity:.3}to{transform:none;opacity:1}}@keyframes qmRise{from{transform:translateY(16px);opacity:.3}to{transform:none;opacity:1}}' +
    '.qm-close{position:absolute;top:13px;right:14px;border:1px solid var(--rule-2);background:var(--bg);color:var(--ink-2);font-family:var(--mono);font-size:11px;border-radius:5px;padding:5px 9px;cursor:pointer;z-index:2}.qm-close:hover{border-color:var(--accent);color:var(--accent)}' +
    '.qm-cmd{display:flex;align-items:flex-start;gap:8px;background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:7px 9px;margin:7px 0}.qm-cmd code{flex:1;font-family:var(--mono);font-size:12px;color:var(--accent);white-space:pre-wrap;word-break:break-word;line-height:1.5}' +
    '.qm-copy{flex:0 0 auto;border:1px solid var(--rule-2);background:var(--bg);color:var(--ink-2);font-family:var(--mono);font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:4px 7px;cursor:pointer}.qm-copy:hover{border-color:var(--accent);color:var(--accent)}' +
    '.qm-step{display:flex;gap:13px;padding:15px 0;border-bottom:1px solid var(--rule)}.qm-step:last-child{border-bottom:none}.qm-step .num{flex:0 0 27px;height:27px;border-radius:50%;border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;color:var(--accent)}.qm-step h4{font-family:var(--serif);font-weight:700;font-size:16px;color:var(--ink);margin:1px 0 4px}.qm-step p{font-size:13.5px;line-height:1.45;color:var(--ink-2);margin:0 0 4px}' +
    '.qm-checklist{list-style:none;padding:0;margin:8px 0 0}.qm-checklist li{display:flex;gap:9px;align-items:flex-start;padding:6px 0;font-size:13.5px;color:var(--ink-2)}.qm-checklist li b{color:var(--ink)}.qm-checklist .mk{color:var(--accent);flex:0 0 auto}' +
    '.qm-oplist{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);border:1px solid var(--rule);border-radius:4px;overflow:hidden}.qm-oprow{display:flex;gap:10px;padding:5px 11px;border-bottom:1px solid var(--rule)}.qm-oprow:last-child{border-bottom:none}.qm-oprow.on{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink)}.qm-oprow .gn{color:var(--accent);flex:0 0 64px;font-weight:600}' +
    '.qm-gv{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px;border-radius:5px;border:1px solid var(--rule-2);color:var(--faint)}.qm-gv.pass{border-color:var(--pass);color:var(--pass)}.qm-gv.fail{border-color:var(--reject);color:var(--reject)}' +
    '.qm-pathtab{display:flex;gap:6px;margin:4px 0 10px;flex-wrap:wrap}.qm-pathtab button{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;padding:6px 11px;border-radius:6px;border:1px solid var(--rule-2);background:transparent;color:var(--ink-2);cursor:pointer}.qm-pathtab button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}' +
    '.qm-wasm{margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--ink-2);border:1px dashed var(--rule);border-radius:4px;padding:9px 11px;white-space:pre-wrap;line-height:1.5;max-height:180px;overflow:auto}.qm-row{display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:12.5px}.qm-row span:first-child{color:var(--faint)}.qm-row span:last-child{color:var(--ink);font-weight:600}' +
    '.qm-tok{width:100%;font-family:var(--mono);font-size:12px;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;background:var(--bg);color:var(--ink);margin:6px 0}@media (prefers-reduced-motion:reduce){.qm-drawer,.qm-modalpanel{animation:none}}';
  var st = document.createElement('style'); st.id = 'qm-runner-css'; st.textContent = css; document.head.appendChild(st);

  // ---------- simulator (statevector) ----------
  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
  function cadd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  var S2 = Math.SQRT1_2;
  function gate1(name, p) {
    switch (name) {
      case 'h': return [[[S2, 0], [S2, 0]], [[S2, 0], [-S2, 0]]];
      case 'x': return [[[0, 0], [1, 0]], [[1, 0], [0, 0]]];
      case 'y': return [[[0, 0], [0, -1]], [[0, 1], [0, 0]]];
      case 'z': return [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]];
      case 's': return [[[1, 0], [0, 0]], [[0, 0], [0, 1]]];
      case 't': return [[[1, 0], [0, 0]], [[0, 0], [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)]]];
      case 'rx': { var cx = Math.cos(p / 2), sx = Math.sin(p / 2); return [[[cx, 0], [0, -sx]], [[0, -sx], [cx, 0]]]; }
      case 'ry': { var cy = Math.cos(p / 2), sy = Math.sin(p / 2); return [[[cy, 0], [-sy, 0]], [[sy, 0], [cy, 0]]]; }
      case 'rz': { var cz = Math.cos(p / 2), sz = Math.sin(p / 2); return [[[cz, -sz], [0, 0]], [[0, 0], [cz, sz]]]; }
    }
    return [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
  }
  function apply1(S, n, U, q) { var sh = n - 1 - q; for (var i = 0; i < S.length; i++) { if (i & (1 << sh)) continue; var j = i | (1 << sh), a = S[i], b = S[j]; S[i] = cadd(cmul(U[0][0], a), cmul(U[0][1], b)); S[j] = cadd(cmul(U[1][0], a), cmul(U[1][1], b)); } }
  function applyCX(S, n, c, t) { var sc = n - 1 - c, stt = n - 1 - t; for (var i = 0; i < S.length; i++) { if ((i & (1 << sc)) && !(i & (1 << stt))) { var j = i | (1 << stt), tmp = S[i]; S[i] = S[j]; S[j] = tmp; } } }
  function applyRzz(S, n, a, b, th) { var sa = n - 1 - a, sb = n - 1 - b; for (var i = 0; i < S.length; i++) { var za = (i & (1 << sa)) ? -1 : 1, zb = (i & (1 << sb)) ? -1 : 1, ang = -th / 2 * za * zb; S[i] = cmul(S[i], [Math.cos(ang), Math.sin(ang)]); } }
  function applyCZ(S, n, a, b) { var sa = n - 1 - a, sb = n - 1 - b; for (var i = 0; i < S.length; i++) { if ((i & (1 << sa)) && (i & (1 << sb))) S[i] = [-S[i][0], -S[i][1]]; } }
  function applyOp(S, n, op) { var nm = op.gate.toLowerCase(), q = op.q, p = (op.params && op.params[0]) || 0; if (nm === 'cx' || nm === 'cnot') applyCX(S, n, q[0], q[1]); else if (nm === 'cz') applyCZ(S, n, q[0], q[1]); else if (nm === 'rzz') applyRzz(S, n, q[0], q[1], p); else apply1(S, n, gate1(nm, p), q[0]); }
  function zeroState(n) { var v = []; for (var i = 0; i < (1 << n); i++) v.push([0, 0]); v[0] = [1, 0]; return v; }
  function fidelity(S, target) { var re = 0, im = 0; for (var i = 0; i < S.length; i++) { re += target[i][0] * S[i][0] + target[i][1] * S[i][1]; im += target[i][0] * S[i][1] - target[i][1] * S[i][0]; } return re * re + im * im; }
  function expectation(S, n, terms) { var total = 0; terms.forEach(function (t) { var ps = t.pauli.toLowerCase(), cp = S.map(function (c) { return [c[0], c[1]]; }); for (var q = 0; q < ps.length; q++) { if (ps[q] !== 'i') apply1(cp, n, gate1(ps[q], 0), q); } var re = 0; for (var i = 0; i < S.length; i++) re += S[i][0] * cp[i][0] + S[i][1] * cp[i][1]; total += t.coeff * re; }); return total; }
  function routingCost(n, edges, workload) { var adj = {}; for (var i = 0; i < n; i++) adj[i] = []; edges.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); }); function dist(a, b) { var seen = {}, q = [[a, 0]]; seen[a] = 1; while (q.length) { var cur = q.shift(); if (cur[0] === b) return cur[1]; adj[cur[0]].forEach(function (nb) { if (!seen[nb]) { seen[nb] = 1; q.push([nb, cur[1] + 1]); } }); } return Infinity; } var tot = 0; workload.forEach(function (p) { tot += dist(p[0], p[1]); }); return tot; }
  function classifyAcc(R, points) { var n = R.fmap.n_qubits, correct = 0; points.forEach(function (d) { var stv = zeroState(n); R.fmap.ops.forEach(function (op) { var th = ('feature' in op) ? (op.scale || 1) * d.x[op.feature] : (op.params && op.params[0]) || 0; applyOp(stv, n, { gate: op.gate, q: op.q, params: [th] }); }); if ((expectation(stv, n, [{ coeff: 1, pauli: R.readout.pauli }]) > R.readout.bias ? 1 : 0) === d.y) correct++; }); return correct / points.length; }

  // ---------- RUNS: committed circuits + reference + raw-URL bundle/ref ----------
  var GH = 'https://raw.githubusercontent.com/QuantumMytheme/quantum-harness/main/bench/quantum-judge/';
  var RUNS = {
    ghz3: { task: 'state_prep', n: 3, label: 'GHZ₃ · state prep', ops: [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }, { gate: 'cx', q: [1, 2] }], target: [[S2, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [S2, 0]], threshold: 0.99, claim: 1.0, bundle: GH + 'quantum-proof-poc.json', refId: 'ghz3' },
    isingbell2: { task: 'vqe', n: 2, label: 'Ising Bell · vqe', ops: [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }], terms: [{ coeff: -1, pauli: 'XX' }, { coeff: -1, pauli: 'ZZ' }], E0: -2.0, gapBudget: 0.05, claim: -2.0, bundle: GH + 'quantum-proof-vqe.json', refId: 'isingbell2' },
    tfim3: { task: 'vqe', n: 3, label: 'TFIM₃ · QAOA p=2', ops: [{ gate: 'h', q: [0] }, { gate: 'h', q: [1] }, { gate: 'h', q: [2] }, { gate: 'rzz', q: [0, 1], params: [0.534059] }, { gate: 'rzz', q: [1, 2], params: [0.534059] }, { gate: 'rx', q: [0], params: [1.285052] }, { gate: 'rx', q: [1], params: [1.285052] }, { gate: 'rx', q: [2], params: [1.285052] }, { gate: 'rzz', q: [0, 1], params: [0.927035] }, { gate: 'rzz', q: [1, 2], params: [0.927035] }, { gate: 'rx', q: [0], params: [0.609611] }, { gate: 'rx', q: [1], params: [0.609611] }, { gate: 'rx', q: [2], params: [0.609611] }], terms: [{ coeff: -1, pauli: 'ZZI' }, { coeff: -1, pauli: 'IZZ' }, { coeff: -0.8, pauli: 'XII' }, { coeff: -0.8, pauli: 'IXI' }, { coeff: -0.8, pauli: 'IIX' }], E0: -3.0090221197813234, gapBudget: 0.05, claim: -3.0089189812867385, bundle: 'https://raw.githubusercontent.com/QuantumMytheme/run-tfim3-qaoa/main/quantum-proof-tfim3.json', refId: 'tfim3' },
    h2vqe: { task: 'vqe', n: 2, label: 'H₂ · molecular vqe', ops: [{ gate: 'ry', q: [0], params: [-0.20943951023931984] }, { gate: 'ry', q: [1], params: [3.0368728984701328] }, { gate: 'cx', q: [0, 1] }, { gate: 'ry', q: [0], params: [-3.141592653589793] }, { gate: 'ry', q: [1], params: [-3.036872898470133] }], terms: [{ coeff: -0.4804, pauli: 'II' }, { coeff: 0.3435, pauli: 'ZI' }, { coeff: -0.4347, pauli: 'IZ' }, { coeff: 0.5716, pauli: 'ZZ' }, { coeff: 0.091, pauli: 'YY' }, { coeff: 0.091, pauli: 'XX' }], E0: -1.851199124123644, gapBudget: 0.005, claim: -1.8507944127891642, bundle: GH + 'quantum-proof-h2.json', refId: 'h2vqe' },
    bell_pops2: { task: 'populations', n: 2, label: 'Bell |Φ⁺⟩ · populations', ops: [{ gate: 'h', q: [0] }, { gate: 'cx', q: [0, 1] }], popTarget: [0.5, 0, 0, 0.5], holdout: { pauli: 'XX', expected: 1.0 }, claim: [0.5, 0, 0, 0.5], bundle: GH + 'quantum-proof-pops.json', refId: 'bell_pops2' },
    aiaccel4: { task: 'architecture', n: 4, label: 'AI-Accel · topology', edges: [[0, 1], [1, 2], [2, 3], [3, 0]], workload: [[0, 1], [2, 3]], holdout: [[0, 3], [1, 2]], budget: 2, claim: 2, bundle: GH + 'quantum-proof-arch.json', refId: 'aiaccel4' },
    qml_sign1: { task: 'classify', n: 1, label: 'Sign classifier · feature map', fmap: { n_qubits: 1, ops: [{ gate: 'ry', q: [0], feature: 0, scale: 1.0 }] }, readout: { pauli: 'X', bias: 0 }, train: [{ x: [-2], y: 0 }, { x: [-1], y: 0 }, { x: [1], y: 1 }, { x: [2], y: 1 }], test: [{ x: [-0.5], y: 0 }, { x: [0.5], y: 1 }], trainMin: 1.0, testMin: 0.99, claim: 1.0, bundle: GH + 'quantum-proof-qml.json', refId: 'qml_sign1' },
  };

  // ---------- overlay ----------
  function ensureOverlay() { var o = document.getElementById('qm-overlay'); if (!o) { o = document.createElement('div'); o.className = 'qm-overlay'; o.id = 'qm-overlay'; o.innerHTML = '<div class="qm-scrim" data-close></div>'; document.body.appendChild(o); } return o; }
  function openOverlay(kind, inner) { var o = ensureOverlay(); var old = o.querySelector('.qm-panel'); if (old) old.remove(); var p = document.createElement('div'); p.className = 'qm-panel ' + (kind === 'modal' ? 'qm-modalpanel' : 'qm-drawer'); p.innerHTML = '<button class="qm-close" data-close>esc ✕</button>' + inner; o.appendChild(p); o.classList.toggle('center', kind === 'modal'); o.classList.add('open'); document.body.style.overflow = 'hidden'; return p; }
  function closeOverlay() { var o = document.getElementById('qm-overlay'); if (!o) return; o.classList.remove('open'); document.body.style.overflow = ''; var p = o.querySelector('.qm-panel'); if (p) p.remove(); runnerToken = null; }
  function copyText(btn) { var code = btn.parentElement.querySelector('code'); var txt = code ? code.textContent : btn.getAttribute('data-copy'); try { navigator.clipboard.writeText(txt); } catch (e) { } var old = btn.textContent; btn.textContent = 'copied'; setTimeout(function () { btn.textContent = old; }, 1100); }

  // ---------- runner UI ----------
  function gv(label, ok) { return '<span class="qm-gv ' + (ok ? 'pass' : 'fail') + '">' + (ok ? '✓' : '✕') + ' ' + label + '</span>'; }
  function row(k, v) { return '<div class="qm-row"><span>' + k + '</span><span>' + v + '</span></div>'; }
  function verdictBox(gates, accept) { return '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">' + gates.join('') + '</div><div style="margin-top:12px;font-family:var(--mono);font-weight:700;font-size:14px;color:' + (accept ? 'var(--pass)' : 'var(--reject)') + ';">' + (accept ? '✓ ACCEPT · exit 0 · reproduced locally' : '✕ REJECT') + '</div>'; }

  function openRunner(pid) {
    var R = RUNS[pid]; if (!R) return;
    var design;
    if (R.task === 'architecture') design = '<div class="qm-row"><span>coupling map</span><span>' + JSON.stringify(R.edges) + '</span></div><div class="qm-row"><span>workload</span><span>' + JSON.stringify(R.workload) + '</span></div>';
    else if (R.task === 'classify') design = '<div class="qm-row"><span>feature map</span><span>Ry(' + (R.fmap.ops[0].scale || 1) + '·x) → ⟨' + R.readout.pauli + '⟩</span></div>';
    else design = '<div class="qm-oplist" style="margin:4px 0 12px;">' + R.ops.map(function (op, i) { return '<div class="qm-oprow" data-op="' + i + '"><span class="gn">' + op.gate.toUpperCase() + '</span><span>q' + op.q.join(',q') + (op.params ? ' (' + op.params.map(function (x) { return (+x).toFixed(3); }).join(',') + ')' : '') + '</span></div>'; }).join('') + '</div>';
    var inner = '<p class="eyebrow">In-browser runner · ' + R.task + '</p><h2 style="font-family:var(--serif);margin:6px 0 3px;">' + R.label + '</h2>' +
      '<p style="font-size:13.5px;color:var(--ink-2);margin:0 0 14px;">A JS statevector simulator recomputes the metric instantly. Or run the <b>real</b> <span class="mono">judge_verify.py</span> + numpy here via WebAssembly — no server, never leave the page.</p>' +
      design + '<div class="panel" style="padding:6px;"><canvas id="qm-run-cv" class="lab-stage" style="display:block;width:100%;height:180px;background:var(--stage-bg);"></canvas></div>' +
      '<div class="controls" style="margin:14px 0 6px;display:flex;gap:9px;flex-wrap:wrap;"><button class="btn primary" data-runsim="' + pid + '">▸ Run preview</button><button class="btn" data-realjudge="' + pid + '">⚙ Run real judge (WASM)</button></div>' +
      '<div id="qm-run-out" style="margin-top:8px;"></div><div id="qm-wasm-out"></div>';
    openOverlay('drawer', inner);
    var cv = document.getElementById('qm-run-cv');
    if (cv) { if (R.task === 'architecture') drawTopo(cv, R, -1); else if (R.task === 'classify') drawPoints(cv, R, false); else drawSV(cv, zeroState(R.n), R.n, 0, R.ops.length); }
  }

  var runnerToken = null;
  function runSim(R) {
    var cv = document.getElementById('qm-run-cv'), out = document.getElementById('qm-run-out'); if (!cv || !out) return;
    if (R.task === 'architecture') { drawTopo(cv, R, 1); finishArch(R, out); return; }
    if (R.task === 'classify') { drawPoints(cv, R, true); finishClassify(R, out); return; }
    out.innerHTML = ''; var stv = zeroState(R.n), i = 0; runnerToken = { live: true }; var tok = runnerToken;
    (function step() {
      if (!tok.live) return;
      [].forEach.call(document.querySelectorAll('.qm-oprow'), function (r, idx) { r.classList.toggle('on', idx === i); });
      drawSV(cv, stv, R.n, i, R.ops.length);
      if (i < R.ops.length) { applyOp(stv, R.n, R.ops[i]); i++; setTimeout(step, reduce ? 0 : 320); }
      else { [].forEach.call(document.querySelectorAll('.qm-oprow'), function (r) { r.classList.remove('on'); }); drawSV(cv, stv, R.n, R.ops.length, R.ops.length); finishStatevec(R, stv, out); }
    })();
  }
  function finishStatevec(R, stv, out) {
    var gates = [gv('structure', true)], accept = true, html = '';
    if (R.task === 'state_prep') { var fid = fidelity(stv, R.target), repro = Math.abs(fid - R.claim) < 1e-6, perf = fid + 1e-12 >= R.threshold; html += row('recomputed fidelity', fid.toFixed(6)) + row('claimed', R.claim.toFixed(6)) + row('threshold', '≥ ' + R.threshold); gates.push(gv('reproduce', repro), gv('performance', perf)); accept = repro && perf; }
    else if (R.task === 'vqe') { var E = expectation(stv, R.n, R.terms), gap = E - R.E0, repro2 = Math.abs(E - R.claim) < 1e-6, perf2 = gap <= R.gapBudget + 1e-12; html += row('recomputed energy', E.toFixed(6)) + row('claimed', R.claim.toFixed(6)) + row('E₀ (exact)', R.E0.toFixed(6)) + row('gap', gap.toExponential(2) + '  (≤ ' + R.gapBudget + ')'); gates.push(gv('reproduce', repro2), gv('performance', perf2)); accept = repro2 && perf2; }
    else { var probs = stv.map(function (c) { return c[0] * c[0] + c[1] * c[1]; }); var reproP = probs.every(function (p, i) { return Math.abs(p - R.claim[i]) < 1e-6; }); var perfP = probs.every(function (p, i) { return Math.abs(p - R.popTarget[i]) < 1e-3; }); var xx = expectation(stv, R.n, [{ coeff: 1, pauli: R.holdout.pauli }]), anti = Math.abs(xx - R.holdout.expected) < 0.02; html += row('populations', '[' + probs.map(function (p) { return p.toFixed(2); }).join(', ') + ']') + row('held-out ⟨' + R.holdout.pauli + '⟩', xx.toFixed(4) + '  (= ' + R.holdout.expected + ')'); gates.push(gv('reproduce', reproP), gv('performance', perfP), gv('anti-overfit', anti)); accept = reproP && perfP && anti; }
    out.innerHTML = html + verdictBox(gates, accept);
  }
  function finishArch(R, out) { var cost = routingCost(R.n, R.edges, R.workload), hcost = routingCost(R.n, R.edges, R.holdout), perf = cost <= R.budget, anti = hcost <= R.budget; out.innerHTML = row('routing cost (visible)', cost + '  (≤ ' + R.budget + ')') + row('held-out workload', hcost + '  (≤ ' + R.budget + ')') + verdictBox([gv('structure', true), gv('reproduce', cost === R.claim), gv('performance', perf), gv('anti-overfit', anti)], perf && anti && cost === R.claim); }
  function finishClassify(R, out) { var tr = classifyAcc(R, R.train), te = classifyAcc(R, R.test), perf = tr >= R.trainMin, anti = te >= R.testMin; out.innerHTML = row('train accuracy', (tr * 100).toFixed(0) + '%  (≥ ' + (R.trainMin * 100) + '%)') + row('held-out test accuracy', (te * 100).toFixed(0) + '%  (≥ ' + (R.testMin * 100) + '%)') + verdictBox([gv('structure', true), gv('reproduce', Math.abs(tr - R.claim) < 1e-9), gv('performance', perf), gv('anti-overfit', anti)], perf && anti); }

  function drawSV(cv, state, n, opIdx, total) { var c = C(), f = fit(cv), ctx = f.ctx, w = f.w, h = f.h, N = state.length; ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h); var bw = (w - 36) / N, bbot = h - 24, bh = h - 52; for (var i = 0; i < N; i++) { var p = state[i][0] * state[i][0] + state[i][1] * state[i][1], hh = p * bh; ctx.fillStyle = accA(c, 0.25 + p * 0.6); ctx.fillRect(18 + i * bw, bbot - hh, bw - 4, hh); ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.strokeRect(18 + i * bw + 0.5, bbot - bh + 0.5, bw - 4, bh); ctx.fillStyle = c.faint; ctx.font = MONOF(N > 4 ? 8 : 9); ctx.textAlign = 'center'; ctx.fillText('|' + i.toString(2).padStart(n, '0') + '⟩', 18 + i * bw + (bw - 4) / 2, bbot + 13); ctx.textAlign = 'left'; } ctx.fillStyle = c.ink; ctx.font = MONOF(10); ctx.fillText(opIdx >= total ? 'final statevector · probabilities' : 'applying gate ' + (opIdx + 1) + ' / ' + total, 18, 15); }
  function drawTopo(cv, R, phase) { var c = C(), f = fit(cv), ctx = f.ctx, w = f.w, h = f.h, cx = w / 2, cy = h / 2, Rd = Math.min(w, h) * 0.32, pts = []; ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h); for (var i = 0; i < R.n; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / R.n; pts.push({ x: cx + Math.cos(a) * Rd, y: cy + Math.sin(a) * Rd }); } ctx.strokeStyle = c.rule2; ctx.lineWidth = 1.4; R.edges.forEach(function (e) { ctx.beginPath(); ctx.moveTo(pts[e[0]].x, pts[e[0]].y); ctx.lineTo(pts[e[1]].x, pts[e[1]].y); ctx.stroke(); }); if (phase > 0) { ctx.strokeStyle = c.accent; ctx.lineWidth = 2.4; R.workload.forEach(function (e) { ctx.beginPath(); ctx.moveTo(pts[e[0]].x, pts[e[0]].y); ctx.lineTo(pts[e[1]].x, pts[e[1]].y); ctx.stroke(); }); } pts.forEach(function (n, i) { ctx.fillStyle = c.bg; ctx.strokeStyle = c.accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(n.x, n.y, 11, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = c.ink; ctx.font = MONOF(11); ctx.textAlign = 'center'; ctx.fillText('q' + i, n.x, n.y + 4); ctx.textAlign = 'left'; }); ctx.fillStyle = c.faint; ctx.font = MONOF(9); ctx.fillText(phase > 0 ? 'workload routed on the ring' : 'ring topology', 12, 15); }
  function drawPoints(cv, R, run) { var c = C(), f = fit(cv), ctx = f.ctx, w = f.w, h = f.h, y = h * 0.54, all = R.train.concat(R.test); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(w - 20, y); ctx.stroke(); ctx.strokeStyle = c.rule2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(w / 2, 18); ctx.lineTo(w / 2, h - 18); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = c.faint; ctx.font = MONOF(9); ctx.fillText('x < 0 → class 0', 22, h - 10); ctx.textAlign = 'right'; ctx.fillText('class 1 ← x > 0', w - 22, h - 10); ctx.textAlign = 'left'; all.forEach(function (d) { var px = w / 2 + d.x[0] * (w * 0.18), isTest = R.test.indexOf(d) >= 0, pred = d.y; if (run) { var stv = zeroState(1); applyOp(stv, 1, { gate: 'ry', q: [0], params: [d.x[0]] }); pred = expectation(stv, 1, [{ coeff: 1, pauli: 'X' }]) > 0 ? 1 : 0; } ctx.fillStyle = pred === 1 ? c.accent : c.accent2; ctx.globalAlpha = isTest ? 0.55 : 1; ctx.beginPath(); ctx.arc(px, y, isTest ? 6 : 7, 0, 7); ctx.fill(); if (isTest) { ctx.globalAlpha = 1; ctx.strokeStyle = c.ink; ctx.lineWidth = 1; ctx.stroke(); } ctx.globalAlpha = 1; }); ctx.fillStyle = c.ink; ctx.font = MONOF(10); ctx.fillText(run ? 'predicted labels · ⟨X⟩ = sin(x)' : 'data · hollow = held-out test', 18, 15); }

  // ---------- WASM real judge (Pyodide) ----------
  var pyReady = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function logw(msg, append) { var el = document.getElementById('qm-wasm-out'); if (!el) return; var box = el.querySelector('.qm-wasm'); if (!box) { el.innerHTML = '<div class="qm-wasm"></div>'; box = el.querySelector('.qm-wasm'); } box.textContent = append ? (box.textContent + msg) : msg; box.scrollTop = box.scrollHeight; }
  async function getPyodide() {
    if (pyReady) return pyReady;
    pyReady = (async function () {
      logw('Loading Pyodide (WebAssembly Python)…\n');
      if (!window.loadPyodide) await loadScript('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
      var py = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
      logw('Installing numpy…\n', true);
      await py.loadPackage('numpy');
      logw('Fetching the real judge (sim.py, judge_verify.py)…\n', true);
      py.FS.mkdir('/judge'); py.FS.mkdir('/refs');
      for (var i = 0; i < PY.length; i++) { var src = await (await fetch(RAW + PY[i])).text(); py.FS.writeFile('/judge/' + PY[i], src); }
      py.runPython("import sys, os; sys.path.insert(0,'/judge'); os.environ['QH_REFERENCES_DIR']='/refs'");
      // the TPU kernel judge (pure numpy) shares this interpreter — its own refs dir.
      try {
        py.FS.mkdir('/krefs');
        var ksrc = await (await fetch(KRAW + 'judge_kernel.py')).text();
        py.FS.writeFile('/judge/judge_kernel.py', ksrc);
        py.runPython("os.environ['QK_REFERENCES_DIR']='/krefs'");
      } catch (e) { /* kernel judge optional; quantum judge still works */ }
      return py;
    })();
    return pyReady;
  }
  async function runRealJudge(pid) {
    var R = RUNS[pid]; if (!R) return;
    var btn = document.querySelector('[data-realjudge="' + pid + '"]'); if (btn) { btn.disabled = true; btn.textContent = '⚙ running…'; }
    try {
      var py = await getPyodide();
      logw('Fetching reference + proof bundle…\n', true);
      var ref = await (await fetch(RAW + 'references/' + R.refId + '.json')).text();
      var bundle = await (await fetch(R.bundle)).text();
      py.FS.writeFile('/refs/' + R.refId + '.json', ref);
      py.globals.set('BUNDLE_JSON', bundle);
      logw('Running judge_verify.verify() …\n', true);
      var code = "import json, importlib\n" +
        "import judge_verify; importlib.reload(judge_verify)\n" +
        "b = json.loads(BUNDLE_JSON)\n" +
        "try:\n  ch = judge_verify.verify(b)\n  res = {'verdict':'ACCEPT','code':0,'checks':ch}\n" +
        "except judge_verify.Reject as r:\n  res = {'verdict':'REJECT','code':r.code,'reason':str(r)}\n" +
        "json.dumps(res)";
      var out = JSON.parse(py.runPython(code));
      var accept = out.code === 0;
      var summary = accept
        ? '✓ ACCEPT · exit 0 — the REAL numpy judge, run in your browser via WebAssembly.\n\n' + JSON.stringify(out.checks, null, 1)
        : '✕ REJECT · exit ' + out.code + '\n' + (out.reason || '');
      logw('— judge_verify.py result —\n' + summary, false);
      if (btn) { btn.textContent = accept ? '✓ real judge: ACCEPT' : '✕ real judge: exit ' + out.code; btn.disabled = false; }
    } catch (e) {
      logw('\nWASM judge unavailable (' + (e && e.message ? e.message : e) + ').\nThe instant JS preview above is exact and offline; the real judge needs network for Pyodide + GitHub raw.', true);
      if (btn) { btn.textContent = '⚙ Run real judge (WASM)'; btn.disabled = false; }
    }
  }

  // ---------- WASM real KERNEL judge (Oracle-Diff Gate + Roofline Notary) ----------
  function klogw(msg, append) { var el = document.getElementById('qm-kwasm-out') || document.getElementById('qm-wasm-out'); if (!el) return; var box = el.querySelector('.qm-wasm'); if (!box) { el.innerHTML = '<div class="qm-wasm"></div>'; box = el.querySelector('.qm-wasm'); } box.textContent = append ? (box.textContent + msg) : msg; box.scrollTop = box.scrollHeight; }
  async function runRealKernelJudge(key) {
    var K = KERNEL_RUNS[key]; if (!K) return;
    var btn = document.querySelector('[data-kjudge="' + key + '"]'); if (btn) { btn.disabled = true; btn.textContent = '⚙ running…'; }
    try {
      var py = await getPyodide();
      klogw('Fetching ' + K.bundle + ' + reference…\n', true);
      var ref = await (await fetch(KRAW + 'references/' + K.refId + '.json')).text();
      var bundle = await (await fetch(KRAW + K.bundle)).text();
      py.FS.writeFile('/krefs/' + K.refId + '.json', ref);
      py.globals.set('KBUNDLE_JSON', bundle);
      klogw('Running judge_kernel.verify() …\n', true);
      var code = "import json, importlib\n" +
        "import judge_kernel; importlib.reload(judge_kernel)\n" +
        "b = json.loads(KBUNDLE_JSON)\n" +
        "try:\n  ch = judge_kernel.verify(b)\n  res = {'verdict':'ACCEPT','code':0,'checks':ch}\n" +
        "except judge_kernel.Reject as r:\n  res = {'verdict':'REJECT','code':r.code,'reason':str(r)}\n" +
        "json.dumps(res)";
      var out = JSON.parse(py.runPython(code));
      var accept = out.code === 0;
      var summary = accept
        ? '✓ ACCEPT · exit 0 — the REAL numpy kernel judge, in your browser via WebAssembly.\n\n' + JSON.stringify(out.checks, null, 1)
        : '✕ REJECT · exit ' + out.code + '\n' + (out.reason || '');
      klogw('— judge_kernel.py · ' + K.label + ' —\n' + summary, false);
      if (btn) { btn.textContent = accept ? '✓ ACCEPT' : '✕ exit ' + out.code; btn.disabled = false; }
    } catch (e) {
      klogw('\nWASM kernel judge unavailable (' + (e && e.message ? e.message : e) + ').\nNeeds network for Pyodide + GitHub raw; the judge itself is numpy-only.', true);
      if (btn) { btn.textContent = '⚙ verify (WASM)'; btn.disabled = false; }
    }
  }

  // ---------- GitHub: create a run repo from the template (no leaving the page) ----------
  async function createRepo(opts) {
    // opts: {token, owner, name, private}  → POST .../generate
    // no owner → GitHub creates it under the token's own account (works for everyone;
    // org members can type QuantumMytheme explicitly).
    var payload = { name: opts.name, description: 'QuantumMytheme run · ' + opts.name, include_all_branches: false, 'private': !!opts['private'] };
    if (opts.owner) payload.owner = opts.owner;
    var r = await fetch('https://api.github.com/repos/QuantumMytheme/quantum-harness/generate', {
      method: 'POST',
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + opts.token, 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify(payload)
    });
    var body = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((body && body.message) || ('HTTP ' + r.status));
    return body; // {html_url, full_name, ...}
  }

  // ---------- GitHub OAuth (via the Cloudflare Pages worker) ----------
  // oauthConfigured: null = unknown (probe pending), true/false from /api/github/status.
  var ghAuth = { signedIn: false, login: null, oauthConfigured: null };
  function ghBoxHTML(name) {
    if (ghAuth.signedIn) {
      return '<p class="eyebrow" style="margin:14px 0 6px">Create it from here · signed in as ' + esc(ghAuth.login || '?') + '</p>' +
        '<input class="qm-tok" id="qm-ghowner" placeholder="owner / org (blank = your account' + (ghAuth.login ? ', ' + esc(ghAuth.login) : '') + '; org members may enter QuantumMytheme)">' +
        '<div class="controls" style="margin-top:6px"><button class="btn primary" data-ghcreate="' + esc(name) + '">Create repo →</button> <button class="btn" data-ghlogout>sign out</button></div>' +
        '<div id="qm-ghresult" class="mono" style="font-size:11px;margin-top:8px;color:var(--ink-2)"></div>';
    }
    var tokenInputs = '<input class="qm-tok" id="qm-ghowner" placeholder="owner / org (blank = your account; org members may enter QuantumMytheme)"><input class="qm-tok" id="qm-ghtoken" type="password" placeholder="GitHub token · public_repo scope">';
    if (ghAuth.oauthConfigured === false) {
      // OAuth is not set up on this deployment — don't lead with a button that 503s.
      return '<p class="eyebrow" style="margin:14px 0 6px">Create it from here (optional) · via a token</p>' +
        '<p class="mono" style="font-size:10px;color:var(--faint);margin:0 0 6px">GitHub OAuth is not configured on this deployment, so the token path is the working one here (or use the template link above).</p>' +
        tokenInputs +
        '<div class="controls" style="margin-top:6px"><button class="btn primary" data-ghcreate="' + esc(name) + '">Create via token →</button></div>' +
        '<div id="qm-ghresult" class="mono" style="font-size:11px;margin-top:8px;color:var(--ink-2)"></div>';
    }
    return '<p class="eyebrow" style="margin:14px 0 6px">Create it from here (optional)</p>' +
      '<div class="controls"><button class="btn primary" data-ghlogin>Sign in with GitHub</button></div>' +
      '<p class="mono" style="font-size:10px;color:var(--faint);margin-top:6px">OAuth — nothing to paste. (Falls back to a token if OAuth is not configured on this deployment.)</p>' +
      '<details style="margin-top:8px"><summary class="mono" style="font-size:11px;color:var(--ink-2);cursor:pointer">…or use a personal access token</summary>' +
      tokenInputs +
      '<div class="controls" style="margin-top:6px"><button class="btn" data-ghcreate="' + esc(name) + '">Create via token →</button></div></details>' +
      '<div id="qm-ghresult" class="mono" style="font-size:11px;margin-top:8px;color:var(--ink-2)"></div>';
  }
  function ghWidget(name) { setTimeout(refreshGhAuth, 30); return '<div id="qm-ghbox" data-repo="' + esc(name) + '">' + ghBoxHTML(name) + '</div>'; }
  function rerenderGhBox() { var box = document.getElementById('qm-ghbox'); if (box) box.innerHTML = ghBoxHTML(box.getAttribute('data-repo')); }
  function refreshGhAuth() {
    return fetch('/api/github/status', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) {
      var wasIn = ghAuth.signedIn, wasCfg = ghAuth.oauthConfigured;
      ghAuth = { signedIn: !!s.signedIn, login: s.login || null, oauthConfigured: ('oauthConfigured' in s) ? !!s.oauthConfigured : null };
      if (ghAuth.signedIn !== wasIn || ghAuth.oauthConfigured !== wasCfg) rerenderGhBox();
    }).catch(function () { });
  }
  function githubLogin() {
    var pop = window.open('/api/github/login', 'qm-gh', 'width=680,height=760');
    function onMsg(e) { if (e.origin !== location.origin) return; if (e.data && typeof e.data.qmGitHub !== 'undefined') { window.removeEventListener('message', onMsg); refreshGhAuth(); } }
    window.addEventListener('message', onMsg);
    var n = 0, iv = setInterval(function () { n++; refreshGhAuth(); if (ghAuth.signedIn || n > 40 || (pop && pop.closed)) clearInterval(iv); }, 1500);
  }
  function ghLogout() { fetch('/api/github/logout', { method: 'POST', credentials: 'same-origin' }).then(function () { ghAuth = { signedIn: false, login: null }; rerenderGhBox(); }); }
  function ghCreate(name) {
    var res = document.getElementById('qm-ghresult'), ownerEl = document.getElementById('qm-ghowner'), tokEl = document.getElementById('qm-ghtoken');
    // blank owner = the caller's own account (works for everyone); typing QuantumMytheme is the member opt-in.
    var owner = (ownerEl && ownerEl.value.trim()) || '', token = tokEl && tokEl.value.trim();
    if (res) res.textContent = 'Creating ' + name + '…';
    var p;
    if (ghAuth.signedIn && !token) {
      p = fetch('/api/github/create-repo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, owner: owner }) })
        .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status)); return b; }); });
    } else if (token) {
      p = createRepo({ token: token, owner: owner, name: name, 'private': false });
    } else { if (res) res.innerHTML = '<span style="color:var(--reject)">Sign in with GitHub above, or paste a token.</span>'; return; }
    p.then(function (out) { if (res) res.innerHTML = '✓ created → <a href="' + out.html_url + '" target="_blank" rel="noopener">' + esc(out.full_name || name) + ' ↗</a>'; })
      .catch(function (err) {
        if (!res) return;
        var m = err.message || String(err), tip = ' — check repo-create rights for that owner.';
        if (/OAuth App access restrictions|access to your organization/i.test(m)) {
          var o = owner || 'the org';
          tip = '<br><span class="note" style="display:inline-block;margin-top:7px">This org restricts OAuth Apps. As an owner, approve this app at ' +
            '<span class="mono">github.com/organizations/' + esc(o) + '/settings/oauth_application_policy</span> — ' +
            'or clear the owner field to create it under your own account (it still registers on the board).</span>';
        }
        res.innerHTML = '<span style="color:var(--reject)">' + esc(m) + '</span>' + tip;
      });
  }

  // ---------- anonymous submit to the org (no GitHub sign-in; Turnstile-gated) ----------
  var anonState = { recipe: null, name: '', token: null, sitekey: null };
  function anonSubmitWidget(recipeJson, defaultName) {
    anonState.recipe = recipeJson; anonState.name = defaultName || 'design';
    setTimeout(initAnonSubmit, 30);
    return '<div id="qm-anon"></div>';
  }
  function initAnonSubmit() {
    var box = document.getElementById('qm-anon'); if (!box) return;
    fetch('/api/submit-config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg || !cfg.enabled) { box.innerHTML = ''; return; }     // fail-closed: hidden unless the deployment enables it
      anonState.sitekey = cfg.sitekey; anonState.token = null;
      box.innerHTML = '<div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--rule)">' +
        '<p class="eyebrow" style="margin-bottom:6px">…or submit to QuantumMytheme without a GitHub account</p>' +
        '<p class="mono" style="font-size:10px;color:var(--faint);margin-bottom:8px">Creates a public <span style="color:var(--accent)">community-*</span> repo in the org from this design — human-verified, rate-limited, moderated.</p>' +
        '<div id="qm-ts"></div>' +
        '<div class="controls" style="margin-top:8px"><button class="btn primary" id="qm-anon-go" disabled>Submit to QuantumMytheme →</button></div>' +
        '<div id="qm-anon-result" class="mono" style="font-size:11px;margin-top:8px;color:var(--ink-2)"></div>';
      var go = document.getElementById('qm-anon-go'); if (go) go.addEventListener('click', doAnonSubmit);
      loadTurnstile(renderTurnstile);
    }).catch(function () { box.innerHTML = ''; });
  }
  function loadTurnstile(cb) {
    if (window.turnstile) return cb();
    if (document.getElementById('qm-ts-script')) { var iv = setInterval(function () { if (window.turnstile) { clearInterval(iv); cb(); } }, 120); return; }
    var s = document.createElement('script'); s.id = 'qm-ts-script'; s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = cb; document.head.appendChild(s);
  }
  function renderTurnstile() {
    var el = document.getElementById('qm-ts'); if (!el || !window.turnstile || !anonState.sitekey || el.dataset.rendered) return;
    el.dataset.rendered = '1';
    try {
      window.turnstile.render(el, { sitekey: anonState.sitekey, theme: 'auto',
        callback: function (t) { anonState.token = t; var b = document.getElementById('qm-anon-go'); if (b) b.disabled = false; },
        'expired-callback': function () { anonState.token = null; var b = document.getElementById('qm-anon-go'); if (b) b.disabled = true; } });
    } catch (e) { }
  }
  function doAnonSubmit() {
    var res = document.getElementById('qm-anon-result'), btn = document.getElementById('qm-anon-go');
    if (!anonState.token) { if (res) res.innerHTML = '<span style="color:var(--reject)">complete the challenge first</span>'; return; }
    var recipe; try { recipe = JSON.parse(anonState.recipe); } catch (e) { if (res) res.textContent = 'could not parse the RECIPE.json'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'submitting…'; }
    if (res) res.textContent = 'creating community-' + anonState.name + '…';
    fetch('/api/submit-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipe: recipe, name: anonState.name, turnstile_token: anonState.token }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (o) {
        if (o.ok && o.b.url) { res.innerHTML = '✓ submitted → <a href="' + o.b.url + '" target="_blank" rel="noopener">' + esc(o.b.repo) + ' ↗</a>' + (o.b.attestable ? ' <span style="color:var(--pass)">· efficiency-attestable</span>' : ''); }
        else {
          res.innerHTML = '<span style="color:var(--reject)">' + esc((o.b && o.b.error) || 'submission failed') + '</span>';
          if (btn) { btn.disabled = false; btn.textContent = 'Submit to QuantumMytheme →'; }
          if (window.turnstile) { try { window.turnstile.reset(); } catch (e) { } } anonState.token = null;
        }
      })
      .catch(function (e) { if (res) res.innerHTML = '<span style="color:var(--reject)">' + esc(String(e)) + '</span>'; if (btn) { btn.disabled = false; btn.textContent = 'Submit to QuantumMytheme →'; } });
  }

  // ---------- global handlers (work on any page) ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-run],[data-runsim],[data-realjudge],[data-kjudge],[data-close],[data-copy],[data-ghlogin],[data-ghcreate],[data-ghlogout]'); if (!el) return;
    if (el.hasAttribute('data-close')) { e.preventDefault(); return closeOverlay(); }
    if (el.hasAttribute('data-copy')) { e.preventDefault(); return copyText(el); }
    if (el.hasAttribute('data-run')) { e.preventDefault(); return openRunner(el.getAttribute('data-run')); }
    if (el.hasAttribute('data-runsim')) { var R = RUNS[el.getAttribute('data-runsim')]; if (R) runSim(R); return; }
    if (el.hasAttribute('data-realjudge')) { e.preventDefault(); return runRealJudge(el.getAttribute('data-realjudge')); }
    if (el.hasAttribute('data-kjudge')) { e.preventDefault(); return runRealKernelJudge(el.getAttribute('data-kjudge')); }
    if (el.hasAttribute('data-ghlogin')) { e.preventDefault(); return githubLogin(); }
    if (el.hasAttribute('data-ghcreate')) { e.preventDefault(); return ghCreate(el.getAttribute('data-ghcreate')); }
    if (el.hasAttribute('data-ghlogout')) { e.preventDefault(); return ghLogout(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeOverlay(); });

  window.QMRunner = { open: openRunner, openOverlay: openOverlay, closeOverlay: closeOverlay, copyText: copyText, esc: esc, RUNS: RUNS, KERNEL_RUNS: KERNEL_RUNS, createRepo: createRepo, runRealJudge: runRealJudge, runRealKernelJudge: runRealKernelJudge, ghWidget: ghWidget, anonSubmitWidget: anonSubmitWidget };
})();
