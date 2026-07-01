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
      case 'sx': return [[[0.5, 0.5], [0.5, -0.5]], [[0.5, -0.5], [0.5, 0.5]]];
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

  function runOps(ops, n) { var S = zeroState(n); ops.forEach(function (op) { applyOp(S, n, op); }); return S; }
  // mirrors bench/quantum-judge/sim.py circuit_depth (greedy layering) + two_qubit_gate_count
  function golfCost(ops, n) {
    var last = [], depth = 0, twoq = 0, q;
    for (q = 0; q < n; q++) last.push(0);
    ops.forEach(function (op) {
      var layer = 0; op.q.forEach(function (qq) { if (last[qq] > layer) layer = last[qq]; }); layer += 1;
      op.q.forEach(function (qq) { last[qq] = layer; });
      if (layer > depth) depth = layer;
      if (op.q.length >= 2) twoq++;
    });
    return { twoq: twoq, depth: depth };
  }

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

  // ---------- CIRCUIT GOLF — beat the frontier by hand (ghz3 + isingbell2 first slice) ----------
  // The golf rules ARE the board's real tie-breaks (SCOREBOARD.md §b): tie the verified
  // metric with FEWER 2-qubit gates — or the same 2q count at LOWER depth — and you'd
  // outrank the current rank 1. Everything live here is the in-browser JS sim (exact,
  // but advisory); only the real judge's verdict counts, and only a public repo the
  // board re-verifies actually ranks.
  var GOLF = {
    ghz3: {
      task: 'state_prep', n: 3,
      native: ['h', 'cx', 'rz', 'rx', 'ry', 'sx', 'x', 'cz'],
      coupling: [[0, 1], [1, 2]],
      maxDepth: 6, maxTwoQ: 2, twoqPinned: true,  // 2q cap host-pinned by the hidden reference (tighter than the brief's 4)
      twoqCost: 0.05, baselineVal: 0.5,
      // self-declared constraints for the bundle — same as the committed rank-1 bundle;
      // the judge merges the reference's tighter host-pinned caps on top.
      constraints: { n_qubits: 3, max_depth: 6, native_gates: ['h', 'cx', 'rz', 'rx', 'ry', 'sx', 'x', 'cz'], coupling_map: [[0, 1], [1, 2]], max_two_qubit_gates: 4 },
      baselineBundle: { fidelity: 0.5, note: 'the best unentangled product state overlaps the GHZ state with fidelity 0.5' },
      minimal: 'The board’s own note: 2 CX is provably minimal for GHZ₃ on this coupling map — only a tie at lower cost could outrank it, and here that is impossible. The golf is to feel why.'
    },
    isingbell2: {
      task: 'vqe', n: 2,
      native: ['h', 'cx', 'rz', 'rx', 'ry', 'cz', 'x'],
      coupling: [[0, 1]],
      maxDepth: 4, maxTwoQ: 2, twoqPinned: false,
      twoqCost: 0, baselineVal: -1.0,
      constraints: { n_qubits: 2, max_depth: 4, native_gates: ['h', 'cx', 'rz', 'rx', 'ry', 'cz', 'x'], coupling_map: [[0, 1]], max_two_qubit_gates: 2 },
      baselineBundle: { energy: -1.0, note: 'best unentangled product state reaches energy -1; the entangled Bell state reaches the true ground -2' },
      minimal: 'Rank 1 reaches gap 0 with one CX at depth 2. A product state (zero 2q gates) cannot reach −2, so the frontier is provably saturated — the golf is to verify that with your own hands.'
    }
  };
  var PARAM_GATES = { rx: 1, ry: 1, rz: 1, rzz: 1 };
  var SYM_2Q = { cz: 1, rzz: 1 };

  function golfMetric(pid, ops) {
    var G = GOLF[pid], R = RUNS[pid];
    var S = runOps(ops, G.n), cost = golfCost(ops, G.n);
    if (G.task === 'state_prep') {
      var fid = fidelity(S, R.target);
      var meets = fid + 1e-12 >= R.threshold && (fid - G.twoqCost * cost.twoq) + 1e-12 >= G.baselineVal;
      return { name: 'fidelity', value: fid, rank1Value: R.claim, tie: Math.abs(fid - R.claim) < 1e-9, better: fid > R.claim + 1e-9, meets: meets, cost: cost };
    }
    var E = expectation(S, G.n, R.terms), gap = E - R.E0;
    var meetsV = gap <= R.gapBudget + 1e-12 && E <= G.baselineVal + 1e-9;
    return { name: 'energy', value: E, gap: gap, rank1Value: R.claim, tie: Math.abs(E - R.claim) < 1e-9, better: E < R.claim - 1e-9, meets: meetsV, cost: cost };
  }
  function golfViolations(pid, ops) {
    var G = GOLF[pid], v = [], coup = {};
    G.coupling.forEach(function (e) { coup[Math.min(e[0], e[1]) + ',' + Math.max(e[0], e[1])] = 1; });
    ops.forEach(function (op, i) {
      var g = op.gate.toLowerCase();
      if (G.native.indexOf(g) < 0) v.push('op ' + (i + 1) + ': ' + g.toUpperCase() + ' is not in the native gate set');
      if (op.q.some(function (q) { return q < 0 || q >= G.n; })) v.push('op ' + (i + 1) + ': qubit index out of range');
      if (op.q.length === 2 && !coup[Math.min(op.q[0], op.q[1]) + ',' + Math.max(op.q[0], op.q[1])]) v.push('op ' + (i + 1) + ': 2q gate on q' + op.q.join(',q') + ' violates the coupling map');
    });
    var cost = golfCost(ops, G.n);
    if (cost.twoq > G.maxTwoQ) v.push('2q-gate count ' + cost.twoq + ' exceeds the cap ' + G.maxTwoQ + (G.twoqPinned ? ' (host-pinned by the hidden reference)' : ''));
    if (cost.depth > G.maxDepth) v.push('depth ' + cost.depth + ' exceeds the budget ' + G.maxDepth);
    return v;
  }
  // rank vs the current rank 1 under the board's real ordering: metric first, then 2q, then depth.
  function golfStatus(pid, ops) {
    var G = GOLF[pid]; if (!G) return null;
    var R = RUNS[pid];
    var m = golfMetric(pid, ops), v = golfViolations(pid, ops), rank1 = golfCost(R.ops, G.n);
    var rank = 'behind';
    if (v.length || !m.meets) rank = 'invalid';
    else if (m.better) rank = 'outrank';
    else if (m.tie) {
      if (m.cost.twoq < rank1.twoq || (m.cost.twoq === rank1.twoq && m.cost.depth < rank1.depth)) rank = 'outrank';
      else if (m.cost.twoq === rank1.twoq && m.cost.depth === rank1.depth) rank = 'tie';
    }
    return { metric: m, cost: m.cost, rank1: rank1, violations: v, rank: rank };
  }
  function cleanOps(ops) { return ops.map(function (op) { var o = { gate: op.gate, q: op.q.slice() }; if (op.params) o.params = op.params.slice(); return o; }); }
  function golfBundle(pid, ops) {
    var G = GOLF[pid], m = golfMetric(pid, ops);
    return {
      schema: 'quantum-harness/proof-bundle@1', problem_id: pid, task: G.task,
      circuit: { n_qubits: G.n, ops: cleanOps(ops) },
      constraints: G.constraints,
      claim: G.task === 'state_prep' ? { fidelity: m.value } : { energy: m.value },
      classical_baseline: G.baselineBundle,
      meta: { author: 'circuit-golf (hand-edited in the browser)', framework: 'json-ir', note: 'claim recomputed by the exact in-browser JS statevector sim; the real judge re-derives it independently' }
    };
  }

  // ---------- IMPOSTOR WORKSHOP — the committed forgery/overfit fixtures, runnable ----------
  // Honest framing: every entry is a COMMITTED adversarial fixture from
  // bench/quantum-judge/ (the judge's own regression bench), labeled as such.
  // The lesson: a design can pass every gate you can SEE and still be wrong —
  // the held-out anti-overfit gate (exit 6) exists exactly for that.
  var EXIT_NAMES = { 0: 'ACCEPT', 2: 'SCHEMA', 3: 'STRUCTURE', 4: 'REPRODUCE', 5: 'PERFORMANCE', 6: 'ANTI-OVERFIT' };
  var IMPOSTORS = {
    'pops-overfit': { file: 'quantum-proof-OVERFIT.json', refId: 'bell_pops2', label: 'Wrong-phase Bell — |Φ⁻⟩ impostor', expect: 6, trap: 'Appends a Z: the Z-basis populations are still 50/50 — it matches everything visible — but the held-out ⟨X₀X₁⟩ is −1, not the +1 the model was never told about.' },
    'qml-overfit': { file: 'quantum-proof-qml-OVERFIT.json', refId: 'qml_sign1', label: 'High-frequency feature map — Ry(7x)', expect: 6, trap: 'sin(7x) happens to nail all four training points (train accuracy 1.0), then oscillates onto the wrong side of the held-out x = ±0.5 — the textbook overfit.' },
    'arch-overfit': { file: 'quantum-proof-arch-OVERFIT.json', refId: 'aiaccel4', label: 'Workload-tuned topology — path, not ring', expect: 6, trap: 'A 0–1–2–3 path tuned to the visible pairs (cost 2); the held-out cross-pairs cost 4 on a path. A ring would have generalized.' },
    'ghz-forged': { file: 'quantum-proof-FORGED.json', refId: 'ghz3', label: 'GHZ₃ with a fabricated fidelity', expect: 4, trap: 'Omits the second CX — the real fidelity is 0.25 — but the bundle claims 1.0. The judge re-simulates and catches the lie.' },
    'h2-forged': { file: 'quantum-proof-h2-FORGED.json', refId: 'h2vqe', label: 'H₂ ansatz with an overclaimed energy', expect: 4, trap: 'The circuit is genuine; the number is not — it claims the exact ground energy the ansatz does not reach.' },
    'noisy-forged': { file: 'quantum-proof-noisy-FORGED.json', refId: 'bellnoisy2', label: 'Bell prep with an inflated noise prediction', expect: 4, trap: 'A perfect ideal circuit, but the on-device prediction is inflated to 0.98 (the density-matrix sim says 0.916) — even noisy predictions are recomputed.' }
  };

  // ---------- LANDSCAPE — tfim3 p=1 QAOA plane, pure sim helpers (UI in lab.js) ----------
  // p=1 QAOA for the TFIM₃ brief: |+++> → rzz(γ) on the chain couplings → rx(β) mixers.
  // Same structure as the rank-1 run-tfim3-qaoa circuit, truncated to one layer.
  function tfim3P1Ops(gamma, beta) {
    return [
      { gate: 'h', q: [0] }, { gate: 'h', q: [1] }, { gate: 'h', q: [2] },
      { gate: 'rzz', q: [0, 1], params: [gamma] }, { gate: 'rzz', q: [1, 2], params: [gamma] },
      { gate: 'rx', q: [0], params: [beta] }, { gate: 'rx', q: [1], params: [beta] }, { gate: 'rx', q: [2], params: [beta] }
    ];
  }
  function tfim3P1Energy(gamma, beta) { return expectation(runOps(tfim3P1Ops(gamma, beta), 3), 3, RUNS.tfim3.terms); }

  // ---------- Replication Census hook: a genuine ACCEPT of a KNOWN committed bundle ----------
  // detail.sha256 = SHA-256 over the RAW bundle bytes exactly as fetched
  // (fetch → arrayBuffer → digest → lowercase hex, 64 chars) — NOT re-serialized JSON;
  // the census module hashes its rows the same way. Strings are UTF-8-encoded only as
  // a fallback for callers that kept just the text.
  function emitVerifyAccept(problemId, bundleBytes) {
    function fire(sha) { try { document.dispatchEvent(new CustomEvent('qm:verify-accept', { detail: { problem_id: problemId, sha256: sha } })); } catch (e) { } }
    try {
      var subtle = (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) || (typeof crypto !== 'undefined' && crypto.subtle);
      var bytes = (typeof bundleBytes === 'string')
        ? (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(bundleBytes) : null)
        : bundleBytes;
      if (subtle && bytes) {
        return subtle.digest('SHA-256', bytes).then(function (buf) {
          fire(Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
        }).catch(function () { fire(null); });
      }
    } catch (e) { }
    fire(null);
    return Promise.resolve();
  }

  // ---------- overlay ----------
  function ensureOverlay() { var o = document.getElementById('qm-overlay'); if (!o) { o = document.createElement('div'); o.className = 'qm-overlay'; o.id = 'qm-overlay'; o.innerHTML = '<div class="qm-scrim" data-close></div>'; document.body.appendChild(o); } return o; }
  function openOverlay(kind, inner) { var o = ensureOverlay(); var old = o.querySelector('.qm-panel'); if (old) old.remove(); var p = document.createElement('div'); p.className = 'qm-panel ' + (kind === 'modal' ? 'qm-modalpanel' : 'qm-drawer'); p.innerHTML = '<button class="qm-close" data-close>esc ✕</button>' + inner; o.appendChild(p); o.classList.toggle('center', kind === 'modal'); o.classList.add('open'); document.body.style.overflow = 'hidden'; return p; }
  function closeOverlay() { var o = document.getElementById('qm-overlay'); if (!o) return; o.classList.remove('open'); document.body.style.overflow = ''; var p = o.querySelector('.qm-panel'); if (p) p.remove(); runnerToken = null; golf = null; }
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
      '<div class="controls" style="margin:14px 0 6px;display:flex;gap:9px;flex-wrap:wrap;"><button class="btn primary" data-runsim="' + pid + '">▸ Run preview</button><button class="btn" data-realjudge="' + pid + '">⚙ Run real judge (WASM)</button>' + (GOLF[pid] ? '<button class="btn" data-golf="' + pid + '">⛳ Golf this circuit</button>' : '') + '</div>' +
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
  // Shared core: run the REAL judge_verify.py (WASM) on an arbitrary bundle string.
  // Used by the committed re-verify path, Circuit Golf's "Prove it", and the Impostor cards.
  async function judgeBundleText(refId, bundleText) {
    var py = await getPyodide();
    var ref = await (await fetch(RAW + 'references/' + refId + '.json')).text();
    py.FS.writeFile('/refs/' + refId + '.json', ref);
    py.globals.set('BUNDLE_JSON', bundleText);
    var code = "import json, importlib\n" +
      "import judge_verify; importlib.reload(judge_verify)\n" +
      "b = json.loads(BUNDLE_JSON)\n" +
      "try:\n  ch = judge_verify.verify(b)\n  res = {'verdict':'ACCEPT','code':0,'checks':ch}\n" +
      "except judge_verify.Reject as r:\n  res = {'verdict':'REJECT','code':r.code,'reason':str(r)}\n" +
      "json.dumps(res)";
    return JSON.parse(py.runPython(code));
  }
  async function runRealJudge(pid) {
    var R = RUNS[pid]; if (!R) return;
    var btn = document.querySelector('[data-realjudge="' + pid + '"]'); if (btn) { btn.disabled = true; btn.textContent = '⚙ running…'; }
    try {
      await getPyodide();
      logw('Fetching reference + proof bundle…\n', true);
      var bundleBuf = await (await fetch(R.bundle)).arrayBuffer();   // raw bytes: hashed as-fetched for the census hook
      var bundle = new TextDecoder().decode(bundleBuf);
      logw('Running judge_verify.verify() …\n', true);
      var out = await judgeBundleText(R.refId, bundle);
      var accept = out.code === 0;
      // Replication Census hook: a genuine in-browser ACCEPT of this KNOWN committed bundle.
      if (accept) emitVerifyAccept(pid, bundleBuf);
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

  // ---------- CIRCUIT GOLF UI (drawer) ----------
  var golf = null;
  function golfAddOptions(G) {
    var opts = [];
    G.native.forEach(function (g) {
      if (g === 'cx') { G.coupling.forEach(function (e) { opts.push(['cx:' + e[0] + ',' + e[1], 'CX q' + e[0] + '→q' + e[1]]); opts.push(['cx:' + e[1] + ',' + e[0], 'CX q' + e[1] + '→q' + e[0]]); }); return; }
      if (SYM_2Q[g]) { G.coupling.forEach(function (e) { opts.push([g + ':' + e[0] + ',' + e[1], g.toUpperCase() + ' q' + e[0] + ',q' + e[1]]); }); return; }
      for (var q = 0; q < G.n; q++) opts.push([g + ':' + q, g.toUpperCase() + (PARAM_GATES[g] ? '(θ)' : '') + ' q' + q]);
    });
    return opts;
  }
  function openGolf(pid) {
    var G = GOLF[pid], R = RUNS[pid]; if (!G || !R) return;
    golf = { pid: pid, ops: cleanOps(R.ops) };
    var opts = golfAddOptions(G).map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    var inner = '<p class="eyebrow">Circuit Golf · in-browser sim · ' + esc(G.task) + '</p><h2 style="font-family:var(--serif);margin:6px 0 3px;">' + esc(R.label) + ' — beat the frontier by hand</h2>' +
      '<p style="font-size:13.5px;color:var(--ink-2);margin:0 0 10px;">The golf rules are the board’s <b>real tie-break rules</b> (SCOREBOARD.md §b): tie the verified metric with <b>fewer 2-qubit gates</b> — or the same 2q count at <b>lower depth</b> — and your design would take rank 1. Every live number below is the exact <b>in-browser JS sim</b> (advisory); the <b>real judge’s verdict is the only authority</b>, and only a public repo the board re-verifies actually ranks.</p>' +
      '<p class="mono" style="font-size:10px;color:var(--faint);margin:0 0 12px;">' + esc(G.minimal) + '</p>' +
      '<p class="eyebrow" style="margin:0 0 6px">Your circuit · add / remove / reorder / tune</p><div id="qm-golf-ops"></div>' +
      '<div class="controls" style="margin:10px 0 6px;align-items:center;"><select class="qm-golfsel" id="qm-golf-addsel">' + opts + '</select><button class="btn" data-golfadd>+ add gate</button><button class="btn" data-golfreset>↺ reset to rank 1</button></div>' +
      '<div id="qm-golf-meter" style="margin-top:12px;"></div>' +
      '<div class="controls" style="margin:14px 0 6px;"><button class="btn primary" data-golfprove>⚖ Prove it — run the real judge (WASM)</button></div>' +
      '<div id="qm-golf-verdict"></div><div id="qm-wasm-out"></div>';
    openOverlay('drawer', inner);
    renderGolfOps(); renderGolfMeter();
  }
  function renderGolfOps() {
    var el = document.getElementById('qm-golf-ops'); if (!el || !golf) return;
    var N = golf.ops.length;
    el.innerHTML = '<div class="qm-oplist">' + (golf.ops.map(function (op, i) {
      var g = op.gate.toLowerCase();
      var mid = PARAM_GATES[g]
        ? '<input type="range" min="-3.1416" max="3.1416" step="0.0001" value="' + (+op.params[0]).toFixed(4) + '" data-golfparam="' + i + '" aria-label="rotation angle"><span class="gv">' + (+op.params[0]).toFixed(3) + '</span>'
        : '<span style="flex:1"></span>';
      return '<div class="qm-golfrow"><span class="gn">' + esc(op.gate.toUpperCase()) + '</span><span style="flex:0 0 52px">q' + op.q.join(',q') + '</span>' + mid +
        '<button class="qm-golfbtn" data-golfup="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="move up">↑</button>' +
        '<button class="qm-golfbtn" data-golfdn="' + i + '"' + (i === N - 1 ? ' disabled' : '') + ' title="move down">↓</button>' +
        '<button class="qm-golfbtn" data-golfdel="' + i + '" title="remove">✕</button></div>';
    }).join('') || '<div class="qm-golfrow"><span style="color:var(--faint)">empty circuit — add gates below</span></div>') + '</div>';
  }
  function renderGolfMeter() {
    var el = document.getElementById('qm-golf-meter'); if (!el || !golf) return;
    var st = golfStatus(golf.pid, golf.ops), m = st.metric, R = RUNS[golf.pid];
    var mline = m.name === 'fidelity'
      ? row('fidelity (in-browser sim)', m.value.toFixed(6) + '  (≥ ' + R.threshold + ')')
      : row('energy (in-browser sim)', m.value.toFixed(6)) + row('gap to E₀', m.gap.toExponential(2) + '  (≤ ' + R.gapBudget + ')');
    var costline = row('your cost', '2q ' + st.cost.twoq + ' · depth ' + st.cost.depth) + row('rank 1 cost', '2q ' + st.rank1.twoq + ' · depth ' + st.rank1.depth);
    var badge, note;
    if (st.rank === 'outrank') { badge = '<span class="qm-gv pass">▲ would outrank rank 1</span>'; note = 'Metric holds at lower cost. If the real judge ACCEPTs and the board re-verifies your public repo, this takes rank 1.'; }
    else if (st.rank === 'tie') { badge = '<span class="qm-gv" style="border-color:var(--accent);color:var(--accent)">= dead heat with rank 1</span>'; note = 'Same metric, same 2q count, same depth — golf it lower to outrank.'; }
    else if (st.rank === 'behind') { badge = '<span class="qm-gv">· behind rank 1</span>'; note = m.tie ? 'Metric ties, but the cost is higher — the tie-breaks rank this below rank 1.' : 'The judge gates would pass, but the metric is behind rank 1.'; }
    else { badge = '<span class="qm-gv fail">✕ would not ACCEPT</span>'; note = st.violations.length ? st.violations.join(' · ') : (m.name === 'fidelity' ? 'fidelity is below the threshold / cost-adjusted baseline gate' : 'energy gap above budget, or worse than the classical baseline'); }
    el.innerHTML = mline + costline + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + badge + '</div><p class="mono" style="font-size:10px;color:var(--ink-2);margin:7px 0 0">' + esc(note) + '</p>';
  }
  function golfAdd() {
    var sel = document.getElementById('qm-golf-addsel'); if (!sel || !golf) return;
    var p = String(sel.value || '').split(':'); if (p.length !== 2) return;
    var op = { gate: p[0], q: p[1].split(',').map(Number) };
    if (PARAM_GATES[p[0]]) op.params = [Math.PI / 2];
    golf.ops.push(op); renderGolfOps(); renderGolfMeter();
  }
  function golfMove(i, d) { if (!golf) return; var j = i + d; if (j < 0 || j >= golf.ops.length) return; var t = golf.ops[i]; golf.ops[i] = golf.ops[j]; golf.ops[j] = t; renderGolfOps(); renderGolfMeter(); }
  function golfDel(i) { if (!golf) return; golf.ops.splice(i, 1); renderGolfOps(); renderGolfMeter(); }
  function golfReset() { if (!golf) return; golf.ops = cleanOps(RUNS[golf.pid].ops); renderGolfOps(); renderGolfMeter(); var v = document.getElementById('qm-golf-verdict'); if (v) v.innerHTML = ''; }
  async function golfProve() {
    if (!golf) return;
    var pid = golf.pid, text = JSON.stringify(golfBundle(pid, golf.ops), null, 2);
    var box = document.getElementById('qm-golf-verdict');
    var btn = document.querySelector('[data-golfprove]'); if (btn) { btn.disabled = true; btn.textContent = '⚖ judging…'; }
    try {
      var out = await judgeBundleText(pid, text);
      var accept = out.code === 0;
      var chips;
      if (accept) chips = [gv('structure', true), gv('reproduce', true), gv('performance', true), gv('anti-overfit', true)];
      else if (out.code === 2) chips = ['<span class="qm-gv fail">✕ schema</span>'];
      else chips = [[3, 'structure'], [4, 'reproduce'], [5, 'performance'], [6, 'anti-overfit']].map(function (g) {
        return g[0] < out.code ? gv(g[1], true) : (g[0] === out.code ? gv(g[1], false) : '<span class="qm-gv">· ' + g[1] + '</span>');
      });
      var head = accept
        ? '<div style="margin-top:10px;font-family:var(--mono);font-weight:700;font-size:14px;color:var(--pass)">✓ ACCEPT · exit 0 · the REAL judge_verify.py, run in your browser</div>'
        : '<div style="margin-top:10px;font-family:var(--mono);font-weight:700;font-size:14px;color:var(--reject)">✕ REJECT · exit ' + out.code + ' · failed the ' + esc(EXIT_NAMES[out.code] || '?') + ' gate</div><p class="mono" style="font-size:11px;color:var(--ink-2);margin:5px 0 0">' + esc(out.reason || '') + '</p>';
      var mint = '';
      if (accept) {
        mint = '<p style="font-size:13px;color:var(--ink-2);margin-top:10px">That is a verdict, <b>not a board entry</b> — the scoreboard only ranks public repos it re-verifies itself. Mint a run repo and commit this exact bundle:</p>' +
          '<div class="qm-cmd"><code>' + esc('bin/new-run.sh run-' + pid + '-golf --remix ' + pid) + '</code><button class="qm-copy" data-copy>copy</button></div>' +
          '<details style="margin-top:8px"><summary class="mono" style="font-size:11px;color:var(--ink-2);cursor:pointer">quantum-proof-' + esc(pid) + '.json — your proof bundle (copy it into the repo)</summary><div class="qm-cmd"><code>' + esc(text) + '</code><button class="qm-copy" data-copy>copy</button></div></details>';
      }
      if (box) box.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' + chips.join('') + '</div>' + head + mint;
      if (btn) { btn.disabled = false; btn.textContent = accept ? '✓ real judge: ACCEPT' : '✕ real judge: exit ' + out.code; }
    } catch (e) {
      if (box) box.innerHTML = '<p class="mono" style="font-size:11px;color:var(--reject)">real judge unavailable (' + esc(e && e.message ? e.message : String(e)) + ') — it needs network for Pyodide + GitHub raw. The live meter above is the exact in-browser sim, but only the judge’s verdict counts.</p>';
      if (btn) { btn.disabled = false; btn.textContent = '⚖ Prove it — run the real judge (WASM)'; }
    }
  }

  // ---------- IMPOSTOR WORKSHOP UI (drawer) ----------
  function openImpostor(key) {
    var T = IMPOSTORS[key]; if (!T) return;
    var inner = '<p class="eyebrow">Impostor Workshop · committed forgery fixture</p><h2 style="font-family:var(--serif);margin:6px 0 3px;">' + esc(T.label) + '</h2>' +
      '<p style="font-size:13.5px;color:var(--ink-2);margin:0 0 8px;"><b>The trap:</b> ' + esc(T.trap) + '</p>' +
      '<p style="font-size:13px;color:var(--ink-2);margin:0 0 8px;">This is a <b>committed adversarial fixture</b> from <span class="mono">bench/quantum-judge/' + esc(T.file) + '</span> — part of the judge’s own regression bench, labeled as such. It is built to pass every gate you can <em>see</em>' + (T.expect === 6 ? '; the held-out anti-overfit gate (exit 6) exists precisely because that is not enough.' : ' from the outside; hermetic re-simulation is what catches the lie.') + '</p>' +
      '<div class="qm-row"><span>documented catch</span><span style="color:var(--reject)">REJECT · exit ' + T.expect + ' · ' + esc(EXIT_NAMES[T.expect]) + '</span></div>' +
      '<div class="controls" style="margin:12px 0 6px;"><button class="btn primary" data-impjudge="' + esc(key) + '">⚖ Run the real judge (WASM)</button></div>' +
      '<div id="qm-imp-out"></div><div id="qm-wasm-out"></div>';
    openOverlay('drawer', inner);
  }
  async function runImpostor(key) {
    var T = IMPOSTORS[key]; if (!T) return;
    var btn = document.querySelector('[data-impjudge="' + key + '"]'); if (btn) { btn.disabled = true; btn.textContent = '⚖ judging…'; }
    var box = document.getElementById('qm-imp-out');
    try {
      logw('Fetching ' + T.file + ' + reference…\n', true);
      var bundle = await (await fetch(RAW + T.file)).text();
      var out = await judgeBundleText(T.refId, bundle);
      var msg = out.code === 0
        ? '<div style="margin-top:8px;font-family:var(--mono);font-weight:700;font-size:14px;color:var(--reject)">⚠ ACCEPT — the judge did NOT catch this committed fixture. That would be a genuine judge blind spot: please open an issue with this page.</div>'
        : '<div style="margin-top:8px;font-family:var(--mono);font-weight:700;font-size:14px;color:var(--pass)">✓ caught · REJECT · exit ' + out.code + ' · the ' + esc(EXIT_NAMES[out.code] || '?') + ' gate</div>' +
          (out.code !== T.expect ? '<p class="mono" style="font-size:11px;color:var(--reject);margin:5px 0 0">note: documented catch is exit ' + T.expect + '</p>' : '') +
          '<p class="mono" style="font-size:11px;color:var(--ink-2);margin:6px 0 0">' + esc(out.reason || '') + '</p>';
      if (box) box.innerHTML = msg;
      if (btn) { btn.disabled = false; btn.textContent = out.code === 0 ? '⚠ not caught' : '✕ exit ' + out.code + ' — caught'; }
    } catch (e) {
      if (box) box.innerHTML = '<p class="mono" style="font-size:11px;color:var(--reject)">real judge unavailable (' + esc(e && e.message ? e.message : String(e)) + ') — it needs network for Pyodide + GitHub raw.</p>';
      if (btn) { btn.disabled = false; btn.textContent = '⚖ Run the real judge (WASM)'; }
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
    var el = e.target.closest('[data-run],[data-runsim],[data-realjudge],[data-kjudge],[data-close],[data-copy],[data-ghlogin],[data-ghcreate],[data-ghlogout],[data-golf],[data-golfadd],[data-golfreset],[data-golfprove],[data-golfup],[data-golfdn],[data-golfdel],[data-impostor],[data-impjudge]'); if (!el) return;
    if (el.hasAttribute('data-close')) { e.preventDefault(); return closeOverlay(); }
    if (el.hasAttribute('data-copy')) { e.preventDefault(); return copyText(el); }
    if (el.hasAttribute('data-run')) { e.preventDefault(); return openRunner(el.getAttribute('data-run')); }
    if (el.hasAttribute('data-golf')) { e.preventDefault(); return openGolf(el.getAttribute('data-golf')); }
    if (el.hasAttribute('data-golfadd')) { e.preventDefault(); return golfAdd(); }
    if (el.hasAttribute('data-golfreset')) { e.preventDefault(); return golfReset(); }
    if (el.hasAttribute('data-golfprove')) { e.preventDefault(); return golfProve(); }
    if (el.hasAttribute('data-golfup')) { e.preventDefault(); return golfMove(+el.getAttribute('data-golfup'), -1); }
    if (el.hasAttribute('data-golfdn')) { e.preventDefault(); return golfMove(+el.getAttribute('data-golfdn'), 1); }
    if (el.hasAttribute('data-golfdel')) { e.preventDefault(); return golfDel(+el.getAttribute('data-golfdel')); }
    if (el.hasAttribute('data-impostor')) { e.preventDefault(); return openImpostor(el.getAttribute('data-impostor')); }
    if (el.hasAttribute('data-impjudge')) { e.preventDefault(); return runImpostor(el.getAttribute('data-impjudge')); }
    if (el.hasAttribute('data-runsim')) { var R = RUNS[el.getAttribute('data-runsim')]; if (R) runSim(R); return; }
    if (el.hasAttribute('data-realjudge')) { e.preventDefault(); return runRealJudge(el.getAttribute('data-realjudge')); }
    if (el.hasAttribute('data-kjudge')) { e.preventDefault(); return runRealKernelJudge(el.getAttribute('data-kjudge')); }
    if (el.hasAttribute('data-ghlogin')) { e.preventDefault(); return githubLogin(); }
    if (el.hasAttribute('data-ghcreate')) { e.preventDefault(); return ghCreate(el.getAttribute('data-ghcreate')); }
    if (el.hasAttribute('data-ghlogout')) { e.preventDefault(); return ghLogout(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t || !t.matches || !t.matches('[data-golfparam]')) return;
    var i = +t.getAttribute('data-golfparam');
    if (!golf || !golf.ops[i] || !golf.ops[i].params) return;
    golf.ops[i].params[0] = +t.value;
    var v = t.parentElement && t.parentElement.querySelector('.gv'); if (v) v.textContent = (+t.value).toFixed(3);
    renderGolfMeter();   // keep the slider itself untouched so dragging never breaks
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeOverlay(); });

  window.QMRunner = { open: openRunner, openOverlay: openOverlay, closeOverlay: closeOverlay, copyText: copyText, esc: esc, RUNS: RUNS, KERNEL_RUNS: KERNEL_RUNS, createRepo: createRepo, runRealJudge: runRealJudge, runRealKernelJudge: runRealKernelJudge, ghWidget: ghWidget, anonSubmitWidget: anonSubmitWidget,
    // in-browser sim primitives (exact; advisory — the judge verdict is the only authority)
    sim: { zeroState: zeroState, applyOp: applyOp, runOps: runOps, fidelity: fidelity, expectation: expectation, cost: golfCost },
    // Circuit Golf (ghz3 + isingbell2 first slice)
    GOLF: GOLF, openGolf: openGolf, golf: { status: golfStatus, metric: golfMetric, violations: golfViolations, bundle: golfBundle, cost: golfCost, addOptions: golfAddOptions },
    // Impostor Workshop (committed forgery fixtures, runnable)
    IMPOSTORS: IMPOSTORS, EXIT_NAMES: EXIT_NAMES, openImpostor: openImpostor, runImpostor: runImpostor,
    // Landscape (tfim3 p=1 QAOA plane — pure helpers; the UI lives in lab.js)
    landscape: { ops: tfim3P1Ops, energyAt: tfim3P1Energy, terms: RUNS.tfim3.terms, E0: RUNS.tfim3.E0 },
    judgeBundleText: judgeBundleText, emitVerifyAccept: emitVerifyAccept };
})();
