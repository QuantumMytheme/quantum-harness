/* QuantumMytheme · Field Notebook (lab.js) — a tabbed SPA on the site's paper
   design system (style.css), theme-aware (paper default / luminous toggle).
   Self-contained, dependency-free, file://-safe. Includes a real in-browser
   statevector runner (recomputes the judge's metric) and a submission flow. */
(function () {
  'use strict';
  var root = document.documentElement;
  var sheet = document.getElementById('qm-sheet');
  var tabsEl = document.getElementById('qm-tabs');
  var overlay = document.getElementById('qm-overlay');
  if (!sheet || !tabsEl) return;

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  function rv(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  function hexRGB(h) { h = (h || '').trim(); if (h[0] === '#') { if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; } var m = h.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [40, 72, 158]; }
  function C() { var a = rv('--accent'); return { bg: rv('--stage-bg') || rv('--bg'), ink: rv('--ink'), ink2: rv('--ink-2'), faint: rv('--faint'), rule: rv('--rule'), rule2: rv('--rule-2'), accent: a, argb: hexRGB(a).join(','), accent2: rv('--accent-2') || a, pass: rv('--pass'), reject: rv('--reject') }; }
  function accA(c, a) { return 'rgba(' + c.argb + ',' + a + ')'; }
  function MONOF(px) { return px + 'px ' + (rv('--mono') || 'monospace'); }

  var state = { section: 'front', model: 'mythos', filter: 'all', picked: 'ghz3' };

  // ─────────────────────────── DATA ───────────────────────────
  var TABS = [['front', 'Abstract', '01'], ['brief', 'Method', '02'], ['field', 'Protocol', '03'], ['atlas', 'Results', '04'], ['register', 'Logbook', '05'], ['primer', 'Theory', '06'], ['recipe', 'Recipe', '07']];
  var GATES = [
    { exit: 3, name: 'Structure', body: 'Respects qubit count, depth, native gates, coupling map, 2-qubit cap.' },
    { exit: 4, name: 'Reproduce', body: 'Re-simulates the claim — fabrication caught.' },
    { exit: 5, name: 'Performance', body: 'Meets threshold and beats the classical baseline.' },
    { exit: 6, name: 'Anti-overfit', body: 'Held-out check the model was never told.' },
  ];
  var MODELS = [['mythos', 'Claude Mythos', 'built for', 'Deep exploration — point it at the hardest briefs'], ['fable5', 'Fable 5', 'built for', 'Long autonomous runs against the rubric'], ['opus', 'Opus 4.8', 'today', 'Runs every worked problem today'], ['byo', 'Bring your own', 'open', 'Any capable model — compare what holds']];
  var STEPS = [
    ['1', 'Pick a brief', 'Choose a committed problem, or remix the current best.', 'bin/new-run.sh run-ghz3 --remix ghz3'],
    ['2', 'Mint a run repo', 'One click forks a fresh public repo into the QuantumMytheme org.', 'gh repo create --template QuantumMytheme/quantum-harness'],
    ['3', 'Point your model at it', 'Mythos, Fable 5, or any capable model self-corrects against the rubric.', 'claude --kickoff KICKOFF.md'],
    ['4', 'Let the judge grade it', 'A hermetic numpy sim re-simulates — ACCEPT (exit 0) or REJECT.', 'python3 judge_verify.py my-bundle.json'],
    ['5', 'Commit & push', 'Proof bundle, scorecard, scrubbed transcript — auto-registers.', 'git push  # the judge is the merge gate'],
  ];
  var BRIEFS = [
    ['ghz3', 'GHZ₃', 'state_prep', '3-qubit GHZ under a linear [0–1–2] coupling map.', 'ghz3 reference (fid 1.000)'],
    ['isingbell2', 'Ising Bell', 'vqe', 'Ground state of H = −X₀X₁ − Z₀Z₁. True E₀ = −2.', 'isingbell2 (E −2.000)'],
    ['bell_pops2', 'Bell |Φ⁺⟩', 'populations', 'Z-basis 50/50; the judge holds out ⟨X₀X₁⟩ = +1.', 'bell_pops2 (anti-overfit)'],
    ['aiaccel4', 'AI-Accel Ring', 'architecture', 'Route two workloads on one topology within budget.', 'aiaccel4 ring topology'],
    ['h2vqe', 'H₂ molecule', 'vqe', 'Reach the H₂ ground state past the mean-field baseline.', 'h2vqe (gap 4e-4)'],
  ];
  var FILT = [['all', 'All'], ['quantum', 'Quantum chips'], ['classical', 'Classical chips'], ['llm', 'LLM architectures']];
  var GAL = [
    ['ghz3', 'state_prep', 'linear-chain GHZ', 'fidelity 1.000', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['isingbell2', 'vqe', 'Bell ansatz', 'energy −2.000', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['tfim3', 'vqe', 'QAOA p=2', 'energy −3.0089', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['h2vqe', 'vqe', 'Ry-CX ansatz', 'gap 4e-4', 'reference', 'quantum', 'chipQuantum', 'ok'],
    ['aiaccel4', 'architecture', 'ring topology', 'routes 2 · cost 2', 'opus-4.8', 'classical', 'chipClassical', 'ok'],
    ['qml_sign1', 'classify', 'Ry(x) feature map', 'test acc 1.00', 'opus-4.8', 'llm', 'archLLM', 'ok'],
  ];
  var STATS = [
    ['Accepted bundles', '8', 'phase 1 preview', '▲ live', [20, 35, 30, 48, 60, 75, 90]],
    ['Open problems', '8', 'state·vqe·pops·arch·classify', '', [40, 40, 60, 60, 80, 80, 100]],
    ['Judge regression', '38/38', 'forgeries rejected', 'green', [38, 38, 38, 38, 38, 38, 38]],
    ['Re-verifiable', '100%', 'recompute it yourself', '', [90, 92, 95, 96, 98, 99, 100]],
  ];
  var REG = [
    [1, 'tfim3', 'QAOA p=2', 'E −3.0089', 'opus-4.8', 'ok', 'ACCEPT', [20, 30, 28, 40, 52, 66, 90], '2026·06·14'],
    [2, 'tfim3', '1-layer HWE', 'gap 0.0143', 'opus-4.8', 'ok', 'ACCEPT', [18, 22, 30, 28, 40, 44, 60], '2026·06·11'],
    [1, 'h2vqe', 'Ry-CX ansatz', 'gap 4e-4', 'reference', 'ok', 'ACCEPT', [22, 30, 44, 55, 66, 78, 92], '2026·06·16'],
    [1, 'ghz3', 'linear GHZ', 'fid 1.000', 'opus-4.8', 'ok', 'ACCEPT', [40, 55, 60, 70, 80, 90, 98], '2026·05·29'],
    [1, 'bell_pops2', '|Φ⁺⟩', '⟨X₀X₁⟩ +1', 'opus-4.8', 'ok', 'ACCEPT', [25, 35, 48, 60, 72, 80, 92], '2026·06·07'],
    ['—', 'bell_pops2', '|Φ⁻⟩ impostor', 'exit 6', '—', 'err', 'REJECT', [60, 40, 30, 20, 12, 8, 4], '2026·06·07'],
  ];
  var ARC = ['Rules', 'Learning', 'Scale', 'Networks', 'Attention', 'Tradeoffs', 'Two stages', 'Silicon', 'Statevector', 'Hybrid', 'Your run'];

  // committed circuits + reference data — the runner re-simulates these and
  // recomputes the judge's exact metric. (public worked examples / references)
  // ─────────────────────────── TEMPLATES ───────────────────────────
  function head(secLabel, title, meta) { return '<div class="lab-head"><div><p class="eyebrow">' + secLabel + '</p><h2>' + title + '</h2></div><div class="rmeta">' + meta + '</div></div>'; }
  function stage(anim, key, height, seed) { return '<canvas class="lab-stage" data-anim="' + anim + '" data-key="' + key + '"' + (seed != null ? ' data-seed="' + seed + '"' : '') + ' style="height:' + height + 'px;"></canvas>'; }
  function sparkHTML(arr, tone) { var c = C(); return arr.map(function (v, i) { var last = i === arr.length - 1, col = last ? (tone === 'err' ? c.reject : c.accent) : (tone === 'err' ? accA({ argb: hexRGB(c.reject).join(',') }, 0.3) : accA(c, 0.28)); return '<i style="height:' + Math.max(8, v) + '%;background:' + col + ';"></i>'; }).join(''); }

  function secFront() {
    var feats = [
      ['A reproducible measurement', 'ACCEPT or REJECT from a hermetic simulator — reproducible on a laptop.'],
      ['An open, re-verifiable record', 'Every accepted run is public; anyone can recompute the number.'],
      ['Toward quantum-native inference', 'Hard architecture briefs, scored honestly at scale.'],
    ].map(function (f) { return '<div style="display:flex;gap:11px;margin-bottom:16px;align-items:flex-start;"><span style="color:var(--accent);flex:0 0 auto;margin-top:3px;">▸</span><div><div style="font-weight:700;color:var(--ink);font-size:15px;">' + f[0] + '</div><div style="color:var(--ink-2);font-size:14px;line-height:1.45;margin-top:2px;">' + f[1] + '</div></div></div>'; }).join('');
    return '<div class="lab-sheet">' + head('§ 01 · Abstract', 'Open, reproducible quantum circuit design', 'Open · MIT<br>ed. 2026.06') +
      '<div class="panel" style="padding:12px;margin-bottom:28px;"><canvas class="lab-stage" data-anim="hero" data-key="hero" style="height:280px;"></canvas>' +
      '<p class="figcap" style="margin:10px 4px 2px;"><b>Fig 1.</b> A verified GHZ₃ run — qubits, couplers, the statevector, and the verification sweep resolving to ACCEPT.</p></div>' +
      '<div class="lab-grid-15"><div><h1 style="margin:0 0 16px;">Point Claude <span class="ket">Mythos</span> or <span class="ket">Fable 5</span> — or any capable model — at a hard quantum design problem, and get a verdict a stranger can re-run.</h1>' +
        '<p>QuantumMytheme is a citizen-science platform built on one idea: <b>correctness can be scored without human taste.</b> You fork a one-run prompt harness, point your model\'s tokens at a brief, and a hermetic <span class="mono">numpy</span> judge re-simulates the circuit and returns ACCEPT or REJECT — a public, re-verifiable artifact.</p>' +
        '<p style="margin-top:12px;">The near horizon is an open, ranked library of verified circuits. The far one is the reason it exists: <em>native quantum-processing architectures for AI inference</em>, beyond today\'s classical stack.</p>' +
        '<div class="controls" style="margin-top:20px;"><button class="btn primary" data-submit>Start a run →</button><button class="btn" data-goto="atlas">Explore the catalog</button></div></div>' +
        '<div style="border-left:1px solid var(--rule);padding-left:24px;"><p class="eyebrow" style="margin-bottom:14px;">What it gives you</p>' + feats +
          '<div style="margin-top:18px;padding-top:16px;border-top:1px dashed var(--rule);font-family:var(--mono);font-size:11px;line-height:1.7;color:var(--ink-2);"><span class="eyebrow" style="font-size:9px;">What\'s asked of you</span><br>A capable model · three commands · report the result back.</div></div></div></div>';
  }

  function secBrief() {
    var rows = GATES.map(function (g) { return '<div style="display:flex;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule);"><span class="mono" style="font-size:11px;color:var(--accent);flex:0 0 50px;">exit ' + g.exit + '</span><span class="mono" style="font-size:11px;font-weight:600;color:var(--ink);letter-spacing:.05em;text-transform:uppercase;flex:0 0 112px;">' + g.name + '</span><span style="font-size:14px;color:var(--ink-2);line-height:1.35;">' + g.body + '</span></div>'; }).join('');
    return '<div class="lab-sheet">' + head('§ 02 · Method', 'How a circuit is verified', 'Judge · numpy<br>4 active gates') +
      '<div class="lab-grid2"><div><p>Every session an agent re-reads a codebase, it pays a <b>20–80k-token rediscovery tax.</b> The harness replaces that with a contract: a <span class="mono">BRIEF</span> states the problem, a <span class="mono">RUBRIC</span> binds every criterion to a check, and a fresh, non-conflicted judge grades the proof bundle — looping until every gate is green.</p>' +
        '<p style="margin-top:12px;">The judge is a hermetic statevector simulator that <b>re-simulates the submitted circuit from scratch</b> against ground truth the author never sees. A bundle can <em>claim</em> fidelity 1.0; the judge recomputes it and rejects the lie.</p>' +
        '<p class="eyebrow" style="margin:18px 0 8px;">Four active gates</p>' + rows + '</div>' +
        '<div><div class="panel" style="padding:6px;">' + stage('judge', 'judge', 236) + '</div><p class="figcap" style="margin:9px 0 18px;"><b>Fig 2.</b> A bundle traverses the gates; the anti-overfit gate (exit 6) rejects a wrong-phase impostor.</p>' +
          '<div class="panel" style="border-left:3px solid var(--accent);padding:14px 16px;"><div style="font-weight:700;color:var(--ink);margin-bottom:5px;">A simulator-only bench, stated plainly</div><div style="font-size:14px;line-height:1.5;color:var(--ink-2);">The judge proves logical correctness and resource constraints under ideal simulation. Real-hardware overlays are a labeled, partly-re-verifiable layer (density-matrix noisy predictions, counts re-verification); the sim score stays canonical.</div></div></div></div></div>';
  }

  function secField() {
    var models = MODELS.map(function (m) { var on = state.model === m[0]; return '<button class="btn" data-model="' + m[0] + '" aria-pressed="' + on + '" style="display:block;text-align:left;padding:12px 13px;height:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><span style="font-weight:700;color:var(--ink);font-size:15px;">' + m[1] + '</span><span class="chip" style="font-size:8px;">' + m[2] + '</span></div><div style="font-size:12.5px;color:var(--ink-2);line-height:1.4;">' + m[3] + '</div></button>'; }).join('');
    var steps = STEPS.map(function (s) { return '<div style="display:flex;gap:13px;margin-bottom:15px;align-items:flex-start;"><span class="qm-step-num" style="flex:0 0 26px;height:26px;border-radius:50%;border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;color:var(--accent);margin-top:1px;">' + s[0] + '</span><div style="flex:1;"><div style="font-weight:700;color:var(--ink);font-size:15.5px;">' + s[1] + '</div><div style="font-size:13.5px;color:var(--ink-2);line-height:1.4;margin:2px 0 6px;">' + s[2] + '</div><code style="display:block;font-family:var(--mono);font-size:11.5px;color:var(--accent);background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:6px 9px;">' + esc(s[3]) + '</code></div></div>'; }).join('');
    var pills = BRIEFS.map(function (b) { var on = state.picked === b[0]; return '<button class="chip" data-brief="' + b[0] + '" style="cursor:pointer;' + (on ? 'border-color:var(--accent);color:#fff;background:var(--accent);' : '') + '">' + b[1] + '</button>'; }).join('');
    var p = BRIEFS.filter(function (b) { return b[0] === state.picked; })[0] || BRIEFS[0], repo = 'run-' + p[0] + '-2026-06-16', cmd = 'bin/new-run.sh ' + repo + ' --remix ' + p[0];
    return '<div class="lab-sheet">' + head('§ 03 · Protocol', 'Run your own run', 'Fork · run<br>commit · push') +
      '<p class="eyebrow" style="margin-bottom:12px;">1 · Bring a model</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;" class="lab-models">' + models + '</div>' +
      '<div class="lab-grid2" style="margin-top:28px;"><div><p class="eyebrow" style="margin-bottom:12px;">2 · The citizen-science loop</p>' + steps + '</div>' +
      '<div><p class="eyebrow" style="margin-bottom:12px;">3 · One-click new run repo</p><div class="controls" style="margin-bottom:14px;">' + pills + '</div>' +
        '<div class="panel" style="padding:16px;"><div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--rule);padding-bottom:9px;margin-bottom:11px;"><span class="eyebrow" style="font-size:9px;">Minted repo</span><span class="mono" style="font-size:10px;color:var(--accent);">' + p[2] + '</span></div>' +
          '<div class="mono" style="font-size:15px;color:var(--ink);font-weight:500;">' + repo + '</div><div style="font-size:13.5px;color:var(--ink-2);line-height:1.4;margin:7px 0 11px;">' + p[3] + '</div>' +
          '<code style="display:block;font-family:var(--mono);font-size:11px;color:var(--accent);background:var(--bg-elev,var(--bg));border:1px solid var(--rule);border-radius:4px;padding:7px 9px;margin-bottom:12px;">' + esc(cmd) + '</code>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;"><span class="mono" style="font-size:10px;color:var(--ink-2);">remixes the current best · ' + p[4] + '</span><button class="btn primary" data-submit-brief="' + p[0] + '" style="font-size:12.5px;padding:8px 14px;">Start submission →</button></div></div>' +
        '<div class="panel" style="padding:6px;margin-top:18px;">' + stage('run', 'run', 184) + '</div><p class="figcap" style="margin-top:8px;"><b>Fig 3.</b> Live circuit · H then CX build the Bell state, fidelity climbs to 1.000.</p></div></div></div>';
  }

  function secAtlas() {
    var filters = FILT.map(function (f) { var on = state.filter === f[0]; return '<button class="chip" data-filter="' + f[0] + '" style="cursor:pointer;' + (on ? 'border-color:var(--accent);color:#fff;background:var(--accent);' : '') + '">' + f[1] + '</button>'; }).join('');
    var cards = GAL.filter(function (g) { return state.filter === 'all' || g[5] === state.filter; }).map(function (g, i) {
      var runnable = !!window.QMRunner.RUNS[g[0]], badge = g[7] === 'ok' ? 'badge-ok' : 'badge-err', verdict = g[7] === 'ok' ? 'ACCEPT' : 'REJECT';
      return '<button class="lab-gcard" ' + (runnable ? 'data-run="' + g[0] + '"' : 'disabled') + '><canvas data-anim="' + g[6] + '" data-key="gal-' + g[0] + '" data-seed="' + i + '" style="height:120px;"></canvas>' +
        '<div style="padding:12px 13px 13px;flex:1;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;align-items:baseline;"><span class="mono" style="font-size:13px;color:var(--ink);font-weight:500;">' + g[0] + '</span><span class="mono" style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);">' + g[1] + '</span></div>' +
        '<div style="font-size:14px;color:var(--ink-2);margin:4px 0 9px;">' + g[2] + '</div>' +
        '<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;"><span class="mono" style="font-size:12px;color:var(--accent);">' + g[3] + '</span><span class="' + badge + '">' + verdict + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;"><span class="mono" style="font-size:9px;color:var(--faint);">' + g[4] + '</span>' + (runnable ? '<span class="lab-runhint">re-run ▸</span>' : '') + '</div></div></button>';
    }).join('');
    return '<div class="lab-sheet">' + head('§ 04 · Results', 'Catalog of verified circuits', 'Chips · topologies<br>architectures') +
      '<p style="max-width:680px;">Each card is a proof bundle — quantum chips, classical floorplans, and software architectures discovered by pressure-testing patterns. <b>Click a card to re-run the exact simulation the judge ran</b> in your browser and recompute the metric.</p>' +
      '<div class="controls" style="margin:18px 0;">' + filters + '</div><div class="lab-gal">' + cards + '</div></div>';
  }

  function secRegister() {
    var stats = STATS.map(function (s) { var trend = s[3] ? '<span class="mono" style="font-size:9.5px;padding:1px 6px;border-radius:4px;color:var(--pass);background:color-mix(in srgb,var(--pass) 14%,transparent);">' + s[3] + '</span>' : ''; return '<div class="panel" style="padding:15px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span class="eyebrow" style="font-size:9.5px;">' + s[0] + '</span>' + trend + '</div><div style="font-family:var(--serif);font-weight:700;font-size:29px;letter-spacing:-.02em;color:var(--ink);line-height:1;">' + s[1] + '</div><div class="mono" style="font-size:10.5px;color:var(--faint);margin-top:6px;">' + s[2] + '</div><span class="spark" style="margin-top:10px;">' + sparkHTML(s[4]) + '</span></div>'; }).join('');
    var rows = REG.map(function (r) { var badge = r[5] === 'ok' ? 'badge-ok' : 'badge-err'; return '<div class="lab-trow"><span style="font-family:var(--serif);font-weight:700;font-size:16px;color:var(--accent);">' + r[0] + '</span><span><span class="mono" style="display:block;font-size:13px;color:var(--ink);">' + r[1] + '</span><span class="mono" style="display:block;font-size:8.5px;color:var(--faint);margin-top:2px;">logged ' + r[8] + '</span></span><span style="font-size:14px;color:var(--ink-2);">' + r[2] + '</span><span class="mono" style="font-size:12.5px;color:var(--accent);">' + r[3] + '</span><span class="mono" style="font-size:11px;color:var(--ink-2);">' + r[4] + '</span><span class="spark">' + sparkHTML(r[7], r[5]) + '</span><span style="text-align:right;"><span class="' + badge + '">' + r[6] + '</span></span></div>'; }).join('');
    return '<div class="lab-sheet">' + head('§ 05 · Logbook', 'Best results to date, ranked by verified metric', 'Re-verifiable<br>judge = gate') +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0 26px;" class="lab-stats">' + stats + '</div>' +
      '<div class="lab-tablewrap"><div class="lab-trow h"><span>#</span><span>Problem</span><span>Paradigm</span><span>Metric</span><span>Author</span><span>Trend</span><span style="text-align:right;">Result</span></div>' + rows + '</div>' +
      '<p class="mono" style="font-size:10px;color:var(--ink-2);margin-top:14px;">No maintainer scores correctness — the judge is the merge gate. Anyone can re-run <span style="color:var(--accent);">judge_verify.py</span> on a committed bundle and reproduce the ranking.</p></div>';
  }

  function secPrimer() {
    var arc = ARC.map(function (label, i) { var last = i === ARC.length - 1; return '<span class="chip" style="' + (last ? 'border-color:var(--accent);color:var(--accent);' : '') + '">' + label + '</span>'; }).join('');
    return '<div class="lab-sheet">' + head('§ 06 · Theory', 'From rules to a quantum coprocessor', 'Background<br>11 ideas') +
      '<p style="max-width:720px;">A guided arc — how machines stopped following coded rules and started learning, how that scaled into transformers, the silicon underneath, and where quantum processors join as coprocessors. The full animated curriculum lives at <a href="/education">quantummytheme.com/education</a>.</p>' +
      '<div class="controls" style="margin:16px 0 24px;">' + arc + '</div>' +
      '<div class="lab-grid2"><div><div class="panel" style="padding:6px;">' + stage('bloch', 'bloch', 224) + '</div><div style="font-weight:700;color:var(--ink);font-size:16px;margin:12px 0 4px;">Simulating one qubit</div><p style="font-size:13.5px;">Each gate is a unitary that rotates the statevector without changing its length. Measurement turns squared magnitudes into outcome probabilities — the same bookkeeping the judge runs.</p></div>' +
      '<div><div class="panel" style="padding:6px;">' + stage('attention', 'attn', 224) + '</div><div style="font-weight:700;color:var(--ink);font-size:16px;margin:12px 0 4px;">Attention, in parallel</div><p style="font-size:13.5px;">Every token compares itself against every other at once — all-pairs matmuls, one-hop paths. An illustrative weight map; it shows why attention maps cleanly onto matrix-multiplying hardware.</p></div></div>' +
      '<div style="margin-top:24px;border-top:1px dashed var(--rule);padding-top:18px;" class="controls"><span style="font-family:var(--serif);font-style:italic;font-size:17px;color:var(--ink);">Ready to point your own model at a brief?</span><button class="btn primary" data-submit>Start a run →</button></div></div>';
  }

  // ─────────────────────────── RECIPE BUILDER (§07) ───────────────────────────
  var recipe = { ings: { tfim3: 65, h2vqe: 40 }, target: 'tfim3', hi: null, params: { depth: 2, entangle: 'linear', optimizer: 'qaoa', novelty: 45, backend: 'noisy', noise: 0.5, twoq: 6, shots: 2048 } };
  var INGREDIENTS = [
    ['ghz3', 'GHZ₃', 'linear entanglement ladder', 'state_prep'],
    ['isingbell2', 'Ising Bell', 'minimal Bell ansatz', 'vqe'],
    ['tfim3', 'TFIM₃ QAOA', 'rzz couplers + rx mixers', 'vqe'],
    ['h2vqe', 'H₂ VQE', 'hardware-efficient Ry–CX', 'vqe'],
    ['aiaccel4', 'AI-Accel ring', 'ring coupling topology', 'architecture'],
    ['qml_sign1', 'Sign map', 'low-frequency feature map', 'classify'],
    ['bellnoisy2', 'Bell (noisy)', 'depolarizing-aware prep', 'state_prep'],
  ];
  var TARGETS = [['tfim3', 'TFIM₃ ground state'], ['h2vqe', 'H₂ ground state'], ['isingbell2', 'Ising Bell'], ['ghz3', 'GHZ₃ prep'], ['aiaccel4', 'AI-Accel routing']];
  var ENTANGLE = [['linear', 'Linear'], ['ring', 'Ring'], ['all', 'All-to-all']];
  var OPT = [['qaoa', 'QAOA'], ['gradient', 'Gradient'], ['cobyla', 'COBYLA']];

  function ingName(id) { var ing = INGREDIENTS.filter(function (x) { return x[0] === id; })[0]; return ing ? ing[1] : id; }
  function mixList() { var ids = Object.keys(recipe.ings); var tot = ids.reduce(function (a, k) { return a + recipe.ings[k]; }, 0) || 1; return ids.map(function (k) { return { id: k, name: ingName(k), pct: recipe.ings[k] / tot * 100 }; }); }
  function recipeHash() { var s = recipe.target + '|' + Object.keys(recipe.ings).sort().map(function (k) { return k + ':' + Math.round(recipe.ings[k]); }).join(',') + '|d' + recipe.params.depth + '|' + recipe.params.entangle + '|' + recipe.params.optimizer + '|n' + recipe.params.novelty + '|' + recipe.params.backend + '|nz' + recipe.params.noise + '|tq' + recipe.params.twoq + '|sh' + recipe.params.shots; var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36).slice(0, 6); }
  function recipeRepo() { return 'run-' + recipe.target + '-mix-' + recipeHash(); }
  function recipeCmd() { var ings = Object.keys(recipe.ings); return 'bin/new-run.sh ' + recipeRepo() + (ings.length ? ' --remix ' + ings.join(',') : ''); }
  function recipeJSON() { var p = predict(); return JSON.stringify({ target: recipe.target, ingredients: mixList().map(function (m) { return { run: m.id, ratio: +(m.pct / 100).toFixed(2) }; }), ansatz: { depth: recipe.params.depth, entanglement: recipe.params.entangle, optimizer: recipe.params.optimizer, novelty: +(recipe.params.novelty / 100).toFixed(2) }, device: { backend: recipe.params.backend, noise_pct: recipe.params.noise, two_qubit_budget: recipe.params.twoq, shots: recipe.params.shots }, forecast: p ? { metric: p.g.label, predicted: +p.value.toFixed(4), goal: p.g.goal, accept_pct: p.accPct, note: 'heuristic estimate — the judge is the source of truth' } : null }, null, 2); }

  // ── new design variables + a transparent (heuristic) goal/metric forecaster ──
  var BACKENDS = [['ideal', 'Ideal'], ['noisy', 'Noisy-sim'], ['qpu', 'Real-QPU']];
  var TASK_HUE = { state_prep: 210, vqe: 162, populations: 40, architecture: 280, classify: 330 };
  var GOALS = {
    tfim3:      { metric: 'gap',  label: 'energy gap to E₀', goal: 0.005, span: 0.06, lo: 0,   hi: 0.06, fmt: function (v) { return v.toFixed(4) + ' Ha'; } },
    h2vqe:      { metric: 'gap',  label: 'energy gap to E₀', goal: 0.005, span: 0.05, lo: 0,   hi: 0.05, fmt: function (v) { return v.toFixed(4) + ' Ha'; } },
    isingbell2: { metric: 'gap',  label: 'energy gap to E₀', goal: 0.02,  span: 0.12, lo: 0,   hi: 0.12, fmt: function (v) { return v.toFixed(3) + ' Ha'; } },
    ghz3:       { metric: 'fid',  label: 'state fidelity',   goal: 0.99,  span: 0.40, lo: 0.5, hi: 1,    fmt: function (v) { return v.toFixed(4); } },
    aiaccel4:   { metric: 'cost', label: 'routing cost',     goal: 6,     span: 8,    lo: 0,   hi: 16,   fmt: function (v) { return Math.round(v) + ' hops'; } },
  };
  function rdark() { return root.getAttribute('data-theme') === 'dark'; }
  function ingTask(id) { var x = INGREDIENTS.filter(function (g) { return g[0] === id; })[0]; return x ? x[3] : 'vqe'; }
  function hueOf(id) { var hh = TASK_HUE[ingTask(id)]; return hh == null ? 210 : hh; }
  function ingColor(id, a) { return 'hsla(' + hueOf(id) + ',' + (rdark() ? 72 : 64) + '%,' + (rdark() ? 62 : 46) + '%,' + (a == null ? 1 : a) + ')'; }
  function fam(task) { return ({ state_prep: 'state', populations: 'state', vqe: 'energy', architecture: 'arch', classify: 'ml' })[task] || task; }
  function affinity(id, tgt) { if (id === tgt) return 1; var a = ingTask(id), b = ingTask(tgt); if (a === b) return 0.62; if (fam(a) === fam(b)) return 0.4; return 0.22; }
  function gates2q() { var p = window.QMKnowledge && window.QMKnowledge.PROBLEMS[recipe.target], n = p ? p.n : 3, d = recipe.params.depth, per = recipe.params.entangle === 'all' ? n * (n - 1) / 2 : recipe.params.entangle === 'ring' && n > 2 ? n : (n - 1); return d * Math.max(0, per); }
  function predict() {
    var g = GOALS[recipe.target]; if (!g) return null;
    var P = recipe.params, mix = mixList(), aff = 0;
    if (mix.length) mix.forEach(function (m) { aff += (m.pct / 100) * affinity(m.id, recipe.target); }); else aff = 0.28;
    var q = 0.12 + 0.5 * aff;
    var optGood = (P.optimizer === 'qaoa' && (recipe.target === 'tfim3' || recipe.target === 'isingbell2')) || (P.optimizer === 'gradient' && (recipe.target === 'h2vqe' || recipe.target === 'ghz3'));
    q += optGood ? 0.12 : 0.05;
    q += 0.12 * (1 - Math.abs(P.depth - 3) / 3);
    q += P.entangle === 'all' ? 0.08 : P.entangle === 'ring' ? 0.05 : 0.02;
    q += (P.novelty / 100) * 0.04;
    q = Math.max(0.02, Math.min(0.99, q));
    var g2 = gates2q(), over = g2 > P.twoq;
    var noiseEff = P.backend === 'ideal' ? 0 : (P.noise / 100) * g2 * (P.backend === 'qpu' ? 1.3 : 1);
    var band = g.span * (0.4 / Math.sqrt(P.shots / 256)) * (1 + P.novelty / 140) + g.span * 0.015;
    var value, margin;
    if (g.metric === 'fid') { value = Math.max(0, Math.min(1, 0.6 + q * 0.44 - noiseEff * 1.0)); margin = value - g.goal; }
    else if (g.metric === 'cost') { value = g.goal + (1 - q) * g.span * 0.7 + noiseEff * 5; margin = g.goal - value; }
    else { value = Math.max(0.0002, g.span * Math.pow(1 - q, 1.5) + noiseEff * 0.18); margin = g.goal - value; }
    var z = margin / (band + 1e-6), acc = 1 / (1 + Math.exp(-z * 1.3));
    if (over) acc *= 0.12;
    var accPct = Math.round(acc * 100);
    var holdout = recipe.target === 'aiaccel4';
    var overfit = holdout ? Math.min(0.95, (P.novelty / 100) * 0.4 + (P.depth >= 4 ? 0.3 : 0)) : 0;
    var meets = g.metric === 'fid' ? value >= g.goal : value <= g.goal;
    return { g: g, value: value, band: band, meets: meets, accPct: accPct, g2: g2, over: over, holdout: holdout, overfit: overfit, verdict: over ? 'reject' : accPct >= 60 ? 'accept' : accPct >= 38 ? 'border' : 'reject' };
  }
  function vColor(v) { return v === 'accept' ? 'var(--pass)' : v === 'border' ? '#c4880c' : 'var(--reject)'; }
  function pchip(label, ok, txt) { var col = ok === true ? 'var(--pass)' : ok === false ? 'var(--reject)' : '#c4880c'; return '<span style="display:inline-flex;gap:5px;align-items:center;font-family:var(--mono);font-size:10px;border:1px solid var(--rule-2);border-radius:5px;padding:3px 8px"><span style="width:7px;height:7px;border-radius:50%;background:' + col + '"></span>' + label + ' <span style="color:var(--faint)">' + txt + '</span></span>'; }
  function predictHTML() {
    var p = predict(); if (!p) return '<p class="mono" style="color:var(--faint)">pick a target to forecast</p>';
    var g = p.g, vc = vColor(p.verdict), vlabel = p.verdict === 'accept' ? 'LIKELY ACCEPT' : p.verdict === 'border' ? 'BORDERLINE' : 'LIKELY REJECT';
    function X(v) { return Math.max(0, Math.min(100, (v - g.lo) / (g.hi - g.lo) * 100)); }
    var gx = X(g.goal), vx = X(p.value), bl = X(p.value - p.band), bh = X(p.value + p.band);
    var goalTxt = (g.metric === 'fid' ? 'goal ≥ ' : 'goal ≤ ') + g.fmt(g.goal);
    var gauge = '<div style="position:relative;height:30px;margin:10px 0 4px;border-radius:6px;background:var(--panel);border:1px solid var(--rule);overflow:hidden">' +
      '<div style="position:absolute;left:' + Math.min(bl, bh) + '%;width:' + Math.max(1.5, Math.abs(bh - bl)) + '%;top:0;bottom:0;background:' + vc + ';opacity:.18"></div>' +
      '<div style="position:absolute;left:' + gx + '%;top:-2px;bottom:-2px;width:2px;background:var(--ink)"></div>' +
      '<div style="position:absolute;left:' + vx + '%;top:50%;width:11px;height:11px;border-radius:50%;background:' + vc + ';transform:translate(-50%,-50%);box-shadow:0 0 0 3px var(--bg)"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--faint)"><span>' + g.fmt(g.lo) + '</span><span style="color:var(--ink)">▲ ' + goalTxt + '</span><span>' + g.fmt(g.hi) + '</span></div>';
    return '<div style="display:flex;justify-content:space-between;align-items:baseline"><p class="eyebrow" style="margin:0">Forecast · heuristic</p><span class="mono" style="font-size:9px;color:var(--faint)">the judge decides</span></div>' +
      '<div style="display:flex;align-items:baseline;gap:9px;margin-top:8px;flex-wrap:wrap"><span style="font-family:var(--mono);font-size:23px;color:var(--ink);font-weight:600">' + g.fmt(p.value) + '</span><span class="mono" style="font-size:10.5px;color:var(--faint)">± ' + g.fmt(p.band) + ' · ' + g.label + '</span></div>' +
      gauge +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:12px"><div><div style="font-family:var(--mono);font-size:29px;font-weight:600;color:' + vc + ';line-height:1">' + p.accPct + '%</div><div class="mono" style="font-size:9px;color:var(--faint)">predicted ACCEPT</div></div>' +
      '<div style="font-family:var(--mono);font-size:11px;font-weight:600;color:' + vc + ';border:1px solid ' + vc + ';border-radius:6px;padding:5px 10px">' + vlabel + '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">' +
        pchip('STRUCTURE', !p.over, p.over ? p.g2 + ' > ' + recipe.params.twoq + ' 2q' : p.g2 + ' ≤ ' + recipe.params.twoq + ' 2q') +
        pchip('PERFORM', p.meets, p.meets ? 'meets goal' : 'short of goal') +
        (p.holdout ? pchip('ANTI-OVERFIT', p.overfit < 0.4, (p.overfit * 100).toFixed(0) + '% risk') : '') + '</div>';
  }
  function updateForecast() { var el = document.getElementById('recipe-forecast'); if (el) el.innerHTML = predictHTML(); }
  function setHi(id) { if (recipe.hi === id) return; recipe.hi = id; [].forEach.call(sheet.querySelectorAll('[data-ing]'), function (el) { var on = el.getAttribute('data-ing') === id; el.style.boxShadow = on ? '0 0 0 2px ' + ingColor(el.getAttribute('data-ing'), 0.9) : ''; }); }
  var recipeHits = [];

  function toggleIngredient(id) { if (id in recipe.ings) delete recipe.ings[id]; else recipe.ings[id] = 50; render(); }
  function setRParam(spec) { var p = spec.split(':'); if (p[0] === 'target') recipe.target = p[1]; else recipe.params[p[0]] = p[1]; render(); }
  function recipeOutHTML() {
    var mix = mixList();
    var rows = mix.length ? mix.map(function (m) { return '<span class="chip" style="border-color:' + ingColor(m.id, 0.9) + ';color:' + ingColor(m.id, 1) + '">' + m.name + ' · ' + m.pct.toFixed(0) + '%</span>'; }).join('') : '<span class="mono" style="color:var(--faint)">no ingredients yet — toggle some above</span>';
    var fp = predict(); if (fp) rows += '<span class="chip" style="border-color:' + vColor(fp.verdict) + ';color:' + vColor(fp.verdict) + '">⌁ forecast · ' + fp.accPct + '% ACCEPT</span>';
    return '<div class="lab-head" style="margin-bottom:14px"><div><p class="eyebrow">Recipe output</p><h2 style="font-size:20px">' + recipeRepo() + '</h2></div><div class="rmeta">' + Object.keys(recipe.ings).length + ' ingredients · target ' + recipe.target + '<br>depth ' + recipe.params.depth + ' · ' + recipe.params.entangle + ' · ' + recipe.params.optimizer + '</div></div>' +
      '<div class="controls" style="margin-bottom:14px">' + rows + '</div>' +
      '<div class="qm-cmd"><code>' + esc(recipeCmd()) + '</code><button class="qm-copy" data-copy>copy</button></div>' +
      '<div class="controls" style="margin-top:12px"><button class="btn primary" data-recipe-mint>Mint recipe → repo →</button><button class="btn" data-submit>Open submission flow</button></div>';
  }
  function updateRecipeOutput() { var el = document.getElementById('recipe-out'); if (el) el.innerHTML = recipeOutHTML(); }
  function secRecipe() {
    var P = recipe.params;
    var ings = INGREDIENTS.map(function (ing) { var on = ing[0] in recipe.ings, hc = ingColor(ing[0], 0.9);
      return '<button class="lab-gcard" data-ing="' + ing[0] + '" style="padding:12px 13px;transition:box-shadow .15s;' + (on ? 'border-color:' + hc + ';' : '') + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="mono" style="font-size:13px;color:var(--ink);font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + hc + ';margin-right:6px;vertical-align:middle"></span>' + ing[1] + '</span><span class="chip" style="font-size:8px;border-color:' + ingColor(ing[0], 0.5) + ';color:' + hc + '">' + ing[3] + '</span></div><div style="font-size:13px;color:var(--ink-2);margin-top:4px">' + ing[2] + '</div>' +
        (on ? '<div class="ratio-row" style="margin-top:8px;display:flex;align-items:center;gap:8px"><span class="mono" style="font-size:10px;color:' + hc + '">ratio</span><input type="range" min="5" max="100" value="' + recipe.ings[ing[0]] + '" data-ratio="' + ing[0] + '" style="flex:1"></div>' : '<div class="mono" style="font-size:9px;color:var(--faint);margin-top:8px">click to add</div>') + '</button>';
    }).join('');
    var targets = TARGETS.map(function (tg) { return '<button class="chip" data-rparam="target:' + tg[0] + '" style="cursor:pointer;' + (recipe.target === tg[0] ? 'border-color:var(--accent);color:#fff;background:var(--accent);' : '') + '">' + tg[1] + '</button>'; }).join('');
    var ent = ENTANGLE.map(function (e) { return '<button data-rparam="entangle:' + e[0] + '" aria-pressed="' + (P.entangle === e[0]) + '">' + e[1] + '</button>'; }).join('');
    var opt = OPT.map(function (o) { return '<button data-rparam="optimizer:' + o[0] + '" aria-pressed="' + (P.optimizer === o[0]) + '">' + o[1] + '</button>'; }).join('');
    var back = BACKENDS.map(function (b) { return '<button data-rparam="backend:' + b[0] + '" aria-pressed="' + (P.backend === b[0]) + '">' + b[1] + '</button>'; }).join('');
    function slider(name, label, mn, mx, st, val, unit) { return '<p class="eyebrow" style="margin:12px 0 7px">' + label + ' · ' + val + (unit || '') + '</p><input type="range" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + val + '" data-rslider="' + name + '" style="width:100%">'; }
    return '<div class="lab-sheet">' + head('§ 07 · Recipe', 'Combine prior runs into a new recipe', 'Ingredients · ratios<br>device · forecast') +
      '<p style="max-width:760px">Pick verified runs as <b>ingredients</b>, set their <b>ratios</b>, tune the <b>ansatz &amp; device</b>, and read the <b>design schematic</b> — the actual circuit your recipe builds and the chip topology it needs — beside a <b>forecast</b> of whether the judge will ACCEPT. The <b>problem card</b> spells out what a good result looks like. The recipe rides to your model in <span class="mono">RECIPE.json</span>; it molds a fresh circuit from the mix.</p>' +
      '<div class="lab-grid2" style="margin-top:20px"><div><p class="eyebrow" style="margin-bottom:12px">Ingredients · select &amp; weight</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + ings + '</div>' +
        '<div id="recipe-pcard" style="margin-top:16px">' + (window.QMKnowledge ? window.QMKnowledge.problemCard(recipe.target) : '') + '</div></div>' +
      '<div><p class="eyebrow" style="margin-bottom:10px">Target problem</p><div class="controls" style="margin-bottom:8px">' + targets + '</div>' +
        slider('depth', 'Ansatz depth', 1, 5, 1, P.depth, '') +
        '<p class="eyebrow" style="margin:12px 0 7px">Entanglement</p><div class="qm-pathtab">' + ent + '</div>' +
        '<p class="eyebrow" style="margin:11px 0 7px">Optimizer</p><div class="qm-pathtab">' + opt + '</div>' +
        '<p class="eyebrow" style="margin:11px 0 7px">Backend</p><div class="qm-pathtab">' + back + '</div>' +
        slider('noise', 'Device noise', 0, 5, 0.25, P.noise, '%') +
        slider('twoq', '2-qubit budget', 1, 12, 1, P.twoq, ' gates') +
        slider('shots', 'Shots', 256, 8192, 256, P.shots, '') +
        slider('novelty', 'Novelty', 0, 100, 1, P.novelty, '%') +
      '</div></div>' +
      '<div class="lab-grid2" style="margin-top:22px;align-items:stretch"><div class="panel" style="padding:6px 6px 8px"><p class="eyebrow" style="margin:6px 8px 2px">Design schematic · circuit ↦ chip</p>' + stage('recipe', 'recipe', 248) + '</div>' +
      '<div class="panel" style="padding:16px 18px"><div id="recipe-forecast">' + predictHTML() + '</div></div></div>' +
      '<div id="recipe-out" style="margin-top:26px;border-top:1px solid var(--rule);padding-top:22px">' + recipeOutHTML() + '</div></div>';
  }

  function mintRecipe() {
    var repo = recipeRepo();
    var inner = '<p class="eyebrow">Recipe → repository</p><h2 style="font-family:var(--serif);margin:6px 0 4px">' + repo + '</h2>' +
      '<p style="font-size:14px;color:var(--ink-2)">A unique run blended from ' + Object.keys(recipe.ings).length + ' verified ingredient(s), targeting <b>' + recipe.target + '</b>. The kickoff hands the model your recipe; it molds a new circuit from the mix.</p>' +
      '<p class="eyebrow" style="margin-top:14px">RECIPE.json</p><div class="qm-cmd"><code>' + esc(recipeJSON()) + '</code><button class="qm-copy" data-copy>copy</button></div>' +
      '<p class="eyebrow" style="margin-top:12px">Mint the repo</p>' + cmdBlock('gh repo create QuantumMytheme/' + repo + ' --template QuantumMytheme/quantum-harness --public --clone') + cmdBlock(recipeCmd()) +
      '<p style="margin-top:6px"><a class="btn" href="https://github.com/QuantumMytheme/quantum-harness/generate" target="_blank" rel="noopener">Use this template ↗</a></p>' + window.QMRunner.ghWidget(repo);
    window.QMRunner.openOverlay('modal', inner);
  }

  var SECTIONS = { front: secFront, brief: secBrief, field: secField, atlas: secAtlas, register: secRegister, primer: secPrimer, recipe: secRecipe };

  // ─────────────────────────── RENDER ───────────────────────────
  function renderTabs() { tabsEl.innerHTML = TABS.map(function (t) { var on = state.section === t[0]; return '<button class="lab-tab" data-tab="' + t[0] + '" role="tab" aria-selected="' + on + '"><span class="pl">§ ' + t[2] + '</span>' + t[1] + '</button>'; }).join(''); }
  var VALID = { front: 1, brief: 1, field: 1, atlas: 1, register: 1, primer: 1, recipe: 1 };
  function sectionFromHash() { var h = (location.hash || '').replace(/^#/, ''); return VALID[h] ? h : null; }
  function render() { renderTabs(); sheet.innerHTML = (SECTIONS[state.section] || secFront)(); registerCanvases(); drawAllOnce(); }
  function setState(patch) { for (var k in patch) state[k] = patch[k]; if (patch.section) { try { history.replaceState(null, '', '#' + patch.section); } catch (e) { location.hash = patch.section; } window.scrollTo(0, 0); } render(); }
  window.addEventListener('hashchange', function () { var s = sectionFromHash(); if (s && s !== state.section) setState({ section: s }); });

  // ─────────────────────────── INTERACTIONS ───────────────────────────
  document.addEventListener('click', function (e) {
    if (e.target.closest('.ratio-row')) return;            // clicking a ratio slider must not toggle its parent ingredient (replaces an inline onclick — CSP-safe)
    var el = e.target.closest('[data-tab],[data-goto],[data-model],[data-brief],[data-filter],[data-submit],[data-submit-brief],[data-path],[data-subbrief],[data-ing],[data-recipe-mint],[data-rparam]');
    if (!el) return;
    // runner / overlay / copy / github actions are owned by runner.js (window.QMRunner)
    if (el.hasAttribute('data-ing')) return toggleIngredient(el.getAttribute('data-ing'));
    if (el.hasAttribute('data-recipe-mint')) return mintRecipe();
    if (el.hasAttribute('data-rparam')) return setRParam(el.getAttribute('data-rparam'));
    if (el.hasAttribute('data-submit')) return openSubmit(state.picked);
    if (el.hasAttribute('data-submit-brief')) return openSubmit(el.getAttribute('data-submit-brief'));
    if (el.hasAttribute('data-path')) { sub.path = el.getAttribute('data-path'); return renderSubmit(); }
    if (el.hasAttribute('data-subbrief')) { sub.brief = el.getAttribute('data-subbrief'); return renderSubmit(); }
    if (el.hasAttribute('data-tab')) return setState({ section: el.getAttribute('data-tab') });
    if (el.hasAttribute('data-goto')) return setState({ section: el.getAttribute('data-goto') });
    if (el.hasAttribute('data-model')) return setState({ model: el.getAttribute('data-model') });
    if (el.hasAttribute('data-brief')) return setState({ picked: el.getAttribute('data-brief') });
    if (el.hasAttribute('data-filter')) return setState({ filter: el.getAttribute('data-filter') });
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.matches) return;
    if (t.matches('[data-ratio]')) { recipe.ings[t.getAttribute('data-ratio')] = +t.value; updateRecipeOutput(); updateForecast(); }
    else if (t.matches('[data-rslider]')) { recipe.params[t.getAttribute('data-rslider')] = +t.value; updateRecipeOutput(); updateForecast(); }
  });
  document.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('[data-rslider]')) { recipe.params[e.target.getAttribute('data-rslider')] = +e.target.value; render(); } });
  // highlight: hovering an ingredient card lights it up; hovering the schematic clears the highlight
  sheet.addEventListener('mousemove', function (e) {
    var cv = e.target.closest && e.target.closest('canvas[data-key="recipe"]');
    if (cv) { var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, hit = null; recipeHits.forEach(function (p) { if (Math.hypot(mx - p.x, my - p.y) <= p.r + 5) hit = p.id; }); setHi(hit); return; }
    var card = e.target.closest && e.target.closest('[data-ing]'); setHi(card ? card.getAttribute('data-ing') : null);
  });
  sheet.addEventListener('mouseleave', function () { setHi(null); });

  // ─────────────────────────── SUBMISSION FLOW ───────────────────────────
  var sub = { brief: 'ghz3', path: 'web' };
  function cmdBlock(cmd) { return '<div class="qm-cmd"><code>' + esc(cmd) + '</code><button class="qm-copy" data-copy>copy</button></div>'; }
  function openSubmit(brief) { sub.brief = brief || 'ghz3'; sub.path = 'web'; window.QMRunner.openOverlay('modal', '<div id="qm-sub"></div>'); renderSubmit(); }
  function renderSubmit() {
    var c = document.getElementById('qm-sub'); if (!c) return;
    var b = BRIEFS.filter(function (x) { return x[0] === sub.brief; })[0] || BRIEFS[0];
    var repo = 'run-' + b[0] + '-2026-06-16';
    var pills = BRIEFS.map(function (x) { var on = sub.brief === x[0]; return '<button class="chip" data-subbrief="' + x[0] + '" style="cursor:pointer;' + (on ? 'border-color:var(--accent);color:#fff;background:var(--accent);' : '') + '">' + x[1] + '</button>'; }).join('');
    var modelName = (MODELS.filter(function (m) { return m[0] === state.model; })[0] || MODELS[0])[1];
    var pathTabs = '<div class="qm-pathtab"><button data-path="web" aria-pressed="' + (sub.path === 'web') + '">Web (Use this template)</button><button data-path="cli" aria-pressed="' + (sub.path === 'cli') + '">CLI (gh)</button></div>';
    var createBody = sub.path === 'web'
      ? '<p>Open the template generator and name the repo <span class="mono">' + repo + '</span> under the <span class="mono">QuantumMytheme</span> org (public):</p>' +
        '<div class="qm-cmd"><code>github.com/QuantumMytheme/quantum-harness → "Use this template" → Create a new repository</code><button class="qm-copy" data-copy>copy</button></div>' +
        '<p style="margin-top:8px;"><a class="btn primary" href="https://github.com/QuantumMytheme/quantum-harness/generate" target="_blank" rel="noopener">Open template generator ↗</a></p>'
      : cmdBlock('gh repo create QuantumMytheme/' + repo + ' --template QuantumMytheme/quantum-harness --public --clone') +
        '<p style="margin-top:6px;font-size:13px;color:var(--ink-2);">Then scaffold the run (optionally remixing the current best):</p>' +
        cmdBlock('cd ' + repo + ' && bin/new-run.sh ' + repo + ' --remix ' + b[0]);
    c.innerHTML =
      '<p class="eyebrow">Submission flow</p><h2 style="font-family:var(--serif);margin:6px 0 4px;">Start a verified run</h2>' +
      '<p style="font-size:14px;color:var(--ink-2);margin:0 0 14px;">Pick a brief, set up before GitHub, mint the repo, run your model, and let the judge merge it. Every command is copy-ready.</p>' +
      '<div class="controls" style="margin-bottom:18px;">' + pills + '</div>' +
      '<div class="qm-step"><span class="num">0</span><div><h4>Before you start · prerequisites</h4>' +
        '<ul class="qm-checklist"><li><span class="mk">▸</span><span>A <b>GitHub account</b> (the run repo lives in the public QuantumMytheme org or your own).</span></li>' +
        '<li><span class="mk">▸</span><span>A <b>capable model</b> — your pick: <b>' + modelName + '</b> (subscription or API). Mythos / Fable 5 / Opus 4.8 / bring your own.</span></li>' +
        '<li><span class="mk">▸</span><span><b>Python 3 + numpy</b> to judge locally (the bench is numpy-only, no QPU):</span></li></ul>' +
        cmdBlock('python3 -m pip install numpy') +
        '<p style="font-size:12.5px;">Optional but recommended — the <b>GitHub CLI</b> for one-command repo creation:</p>' + cmdBlock('gh auth login') + '</div></div>' +
      '<div class="qm-step"><span class="num">1</span><div><h4>Create your run repo</h4><p>Two paths — both fork the template <span class="mono">QuantumMytheme/quantum-harness</span> into a fresh public repo.</p>' + pathTabs + createBody + window.QMRunner.ghWidget(repo) + '</div></div>' +
      '<div class="qm-step"><span class="num">2</span><div><h4>Point your model at the brief</h4><p>Run the kickoff with <b>' + modelName + '</b> (or paste <span class="mono">KICKOFF.md</span> into your model). It self-corrects against the rubric until every gate is green.</p>' + cmdBlock('claude --kickoff KICKOFF.md   # brief: ' + b[0]) + '</div></div>' +
      '<div class="qm-step"><span class="num">3</span><div><h4>Judge it — locally and in the browser</h4><p>The hermetic numpy judge re-simulates the circuit and returns ACCEPT (exit 0) or REJECT. You can also <a href="#" data-run="' + (window.QMRunner.RUNS[b[0]] ? b[0] : 'ghz3') + '">re-run a reference circuit in the browser ▸</a>.</p>' + cmdBlock('python3 bench/quantum-judge/judge_verify.py quantum-proof-' + b[0] + '.json') + '</div></div>' +
      '<div class="qm-step"><span class="num">4</span><div><h4>Commit &amp; push — the judge is the merge gate</h4><p>Push the proof bundle, scorecard, and a scrubbed transcript; it auto-registers on the public board.</p>' + cmdBlock('git add -A && git commit -m "' + b[0] + ' run" && git push') + '</div></div>';
  }

  // ─────────────────────────── ANIMATION LOOP ───────────────────────────
  var canvases = {}, cst = {}, t0 = performance.now(), raf = 0;
  function registerCanvases() { canvases = {}; [].forEach.call(sheet.querySelectorAll('canvas[data-anim]'), function (el) { canvases[el.dataset.key] = el; }); }
  function rr(ctx, x, y, w, h, r) { if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; } ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawOne(el, t) { var dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; if (el._w !== w || el._h !== h || el._d !== dpr) { el.width = w * dpr; el.height = h * dpr; el._w = w; el._h = h; el._d = dpr; } var ctx = el.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); var st = cst[el.dataset.key] || (cst[el.dataset.key] = {}), fn = ANIM[el.dataset.anim]; if (fn) try { fn(ctx, w, h, t, st, +(el.dataset.seed || 0)); } catch (e) { } }
  function drawAllOnce() { var t = reduce ? 5.2 : (performance.now() - t0) / 1000; for (var k in canvases) { var el = canvases[k]; if (el && el.isConnected && el.offsetParent !== null) drawOne(el, t); } }
  function loop(now) { var t = (now - t0) / 1000; for (var k in canvases) { var el = canvases[k]; if (!el || !el.isConnected) { delete canvases[k]; continue; } if (el.offsetParent === null) continue; drawOne(el, t); } raf = requestAnimationFrame(loop); }
  window.addEventListener('resize', drawAllOnce);

  var ANIM = {
    hero: function (ctx, w, h, t) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accA(c, 0.07); ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      for (var x = 34; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (var y = 34; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.setLineDash([]);
      var cx = w * 0.30, cy = h * 0.52, R = Math.min(h * 0.32, 108), nodes = [{ x: cx, y: cy }];
      for (var i = 0; i < 6; i++) { var an = -Math.PI / 2 + i * Math.PI / 3; nodes.push({ x: cx + Math.cos(an) * R, y: cy + Math.sin(an) * R }); }
      var edges = []; for (var j = 1; j <= 6; j++) { edges.push([0, j]); edges.push([j, j % 6 + 1]); }
      var beamT = (t * 0.16) % 1, beamX = beamT * w, prgb = hexRGB(c.pass).join(',');
      ctx.lineWidth = 1.3; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -(t * 16) % 8;
      edges.forEach(function (e) { ctx.strokeStyle = c.rule2; ctx.beginPath(); ctx.moveTo(nodes[e[0]].x, nodes[e[0]].y); ctx.lineTo(nodes[e[1]].x, nodes[e[1]].y); ctx.stroke(); });
      ctx.setLineDash([]);
      nodes.forEach(function (n, i) { var pulse = 0.5 + 0.5 * Math.sin(t * 2 - i * 0.7), passed = n.x < beamX, col = passed ? prgb : c.argb; ctx.beginPath(); ctx.arc(n.x, n.y, 6 + pulse * 2, 0, 7); ctx.fillStyle = 'rgba(' + col + ',' + (0.18 + pulse * 0.5) + ')'; ctx.shadowBlur = 12 * pulse; ctx.shadowColor = passed ? c.pass : c.accent; ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.stroke(); });
      ctx.strokeStyle = accA(c, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(beamX, 0); ctx.lineTo(beamX, h); ctx.stroke();
      ctx.fillStyle = accA(c, 0.05); ctx.fillRect(0, 0, beamX, h);
      var bx = w * 0.72, bw = (w * 0.24) / 8, btop = cy - R, bbot = cy + R;
      for (var k = 0; k < 8; k++) { var amp = Math.abs(Math.sin(t * 1.3 + k * 0.9)) * Math.exp(-Math.abs(k - 3.5) * 0.22), hh = (bbot - btop) * amp * 0.95; ctx.fillStyle = accA(c, 0.14 + amp * 0.5); ctx.fillRect(bx + k * bw, bbot - hh, bw - 3, hh); }
      ctx.fillStyle = c.faint; ctx.font = MONOF(9.5); ctx.fillText('STATEVECTOR · 2³', bx, btop - 8); ctx.fillText('GHZ₃ · LINEAR [0–1–2]', cx - 52, cy + R + 24);
      if (beamT > 0.84) { var aa = (beamT - 0.84) / 0.16; ctx.globalAlpha = Math.sin(aa * Math.PI); ctx.fillStyle = c.pass; ctx.font = '600 14px ' + (rv('--mono') || 'monospace'); ctx.fillText('✓ ACCEPT · exit 0', w * 0.46, 24); ctx.globalAlpha = 1; }
    },
    judge: function (ctx, w, h, t) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var names = ['STRUCTURE', 'REPRODUCE', 'PERFORM', 'ANTI-OVERFIT'], exits = [3, 4, 5, 6], n = 4, prgb = hexRGB(c.pass).join(','), xrgb = hexRGB(c.reject).join(',');
      var pad = 14, bw = (w - pad * 2) / n, by = h * 0.30, bh = h * 0.34, loopN = Math.floor(t / 9), reject = (loopN % 3 === 2), local = (t % 9) / 9, prog = local * (n + 1), failGate = reject ? 3 : -1;
      for (var i = 0; i < n; i++) {
        var bx = pad + i * bw, reached = prog > i + 0.5, isFail = (i === failGate) && reached, passed = reached && !isFail;
        ctx.strokeStyle = passed ? c.pass : (isFail ? c.reject : c.rule2); ctx.lineWidth = reached ? 2 : 1; rr(ctx, bx + 6, by, bw - 12, bh, 6); ctx.stroke();
        if (reached) { ctx.fillStyle = 'rgba(' + (isFail ? xrgb : prgb) + ',0.1)'; rr(ctx, bx + 6, by, bw - 12, bh, 6); ctx.fill(); }
        ctx.fillStyle = c.ink; ctx.font = '600 ' + MONOF(9.5).slice(4); ctx.textAlign = 'center'; ctx.fillText(names[i], bx + bw / 2, by + bh / 2 - 1);
        ctx.fillStyle = c.faint; ctx.font = MONOF(9); ctx.fillText('exit ' + exits[i], bx + bw / 2, by + bh / 2 + 14);
        if (passed) { ctx.strokeStyle = c.pass; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + bw / 2 - 8, by - 9); ctx.lineTo(bx + bw / 2 - 3, by - 4); ctx.lineTo(bx + bw / 2 + 8, by - 15); ctx.stroke(); }
        if (isFail) { ctx.strokeStyle = c.reject; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + bw / 2 - 7, by - 14); ctx.lineTo(bx + bw / 2 + 7, by - 4); ctx.moveTo(bx + bw / 2 + 7, by - 14); ctx.lineTo(bx + bw / 2 - 7, by - 4); ctx.stroke(); }
      }
      var ty = by + bh + 28; ctx.strokeStyle = c.rule; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pad, ty); ctx.lineTo(w - pad, ty); ctx.stroke(); ctx.setLineDash([]);
      if (!(reject && prog > failGate + 1.2)) { var tx = Math.min(pad + prog * bw, w - pad); ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, 7); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.font = '600 12px ' + (rv('--mono') || 'monospace');
      if (prog > n) { if (reject) { ctx.fillStyle = c.reject; ctx.fillText('REJECT · exit 6 · failed held-out ⟨X₀X₁⟩', w / 2, h - 12); } else { ctx.fillStyle = c.pass; ctx.fillText('ACCEPT · exit 0 · all gates green', w / 2, h - 12); } }
      ctx.textAlign = 'left';
    },
    run: function (ctx, w, h, t) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var lt = t % 6, s = Math.SQRT1_2, amp = [[1, 0], [0, 0], [0, 0], [0, 0]];
      if (lt > 1.2) amp = [[s, 0], [0, 0], [s, 0], [0, 0]]; if (lt > 2.4) { var tmp = amp[2]; amp[2] = amp[3]; amp[3] = tmp; }
      var probs = amp.map(function (cc) { return cc[0] * cc[0] + cc[1] * cc[1]; });
      var lx = 22, rx = w * 0.5, y0 = h * 0.26, y1 = h * 0.46;
      ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(rx, y0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(lx, y1); ctx.lineTo(rx, y1); ctx.stroke();
      ctx.fillStyle = c.faint; ctx.font = MONOF(10); ctx.fillText('q0', 4, y0 + 3); ctx.fillText('q1', 4, y1 + 3);
      var gw = 22, hx = lx + (rx - lx) * 0.34, onH = lt > 1.2; ctx.strokeStyle = onH ? c.accent : c.rule2; ctx.fillStyle = onH ? accA(c, 0.13) : c.bg; ctx.lineWidth = 1.4; rr(ctx, hx - gw / 2, y0 - gw / 2, gw, gw, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = onH ? c.accent : c.faint; ctx.font = '600 12px ' + (rv('--mono') || 'monospace'); ctx.textAlign = 'center'; ctx.fillText('H', hx, y0 + 4); ctx.textAlign = 'left';
      var cxx = lx + (rx - lx) * 0.64, on2 = lt > 2.4; ctx.strokeStyle = on2 ? c.accent : c.rule2; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cxx, y0); ctx.lineTo(cxx, y1); ctx.stroke();
      ctx.fillStyle = on2 ? c.accent : c.rule2; ctx.beginPath(); ctx.arc(cxx, y0, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(cxx, y1, 9, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cxx - 9, y1); ctx.lineTo(cxx + 9, y1); ctx.moveTo(cxx, y1 - 9); ctx.lineTo(cxx, y1 + 9); ctx.stroke();
      var bx = w * 0.6, bw = (w * 0.33) / 4, bbot = h * 0.82, bh = h * 0.52, labels = ['00', '01', '10', '11'];
      for (var k = 0; k < 4; k++) { var hh = probs[k] * bh; ctx.fillStyle = accA(c, 0.22 + probs[k] * 0.6); ctx.fillRect(bx + k * bw, bbot - hh, bw - 6, hh); ctx.fillStyle = c.faint; ctx.font = MONOF(10); ctx.textAlign = 'center'; ctx.fillText('|' + labels[k] + '⟩', bx + k * bw + (bw - 6) / 2, bbot + 14); ctx.textAlign = 'left'; }
      var re = (amp[0][0] + amp[3][0]) / Math.SQRT2, im = (amp[0][1] + amp[3][1]) / Math.SQRT2, F = re * re + im * im;
      ctx.fillStyle = c.ink; ctx.font = '600 13px ' + (rv('--mono') || 'monospace'); ctx.fillText('fidelity ' + F.toFixed(3), bx, h * 0.16);
      ctx.fillStyle = F > 0.99 ? c.pass : c.faint; ctx.font = MONOF(9); ctx.fillText(F > 0.99 ? '≥ threshold 0.99' : 'baseline 0.5', bx, h * 0.16 + 13);
    },
    chipQuantum: function (ctx, w, h, t, st, seed) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3, N = 5 + (seed % 3), nodes = [];
      for (var i = 0; i < N; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; nodes.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }); }
      ctx.strokeStyle = c.rule2; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -(t * 10) % 7;
      for (var j = 0; j < N; j++) { ctx.beginPath(); ctx.moveTo(nodes[j].x, nodes[j].y); ctx.lineTo(nodes[(j + 1) % N].x, nodes[(j + 1) % N].y); ctx.stroke(); }
      ctx.setLineDash([]); var seg = (t * 0.6 + seed) % N, i0 = Math.floor(seg), f = seg - i0, a0 = nodes[i0], b0 = nodes[(i0 + 1) % N];
      ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(a0.x + (b0.x - a0.x) * f, a0.y + (b0.y - a0.y) * f, 4, 0, 7); ctx.fill();
      nodes.forEach(function (n, i) { var p = 0.5 + 0.5 * Math.sin(t * 2 - i + seed); ctx.fillStyle = c.bg; ctx.strokeStyle = c.accent; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(n.x, n.y, 5 + p, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, 7); ctx.fill(); });
    },
    chipClassical: function (ctx, w, h, t, st, seed) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var N = 6, m = Math.min(w, h) * 0.74, cs = m / N, ox = (w - m) / 2, oy = (h - m) / 2;
      for (var r = 0; r < N; r++) for (var cc = 0; cc < N; cc++) { var phase = (r + cc) / (2 * N), u = ((t * 0.5 + seed * 0.1 - phase) % 1 + 1) % 1, act = u < 0.18 ? u / 0.18 : Math.max(0, 1 - (u - 0.18) / 0.4); ctx.fillStyle = accA(c, 0.08 + 0.6 * act); ctx.fillRect(ox + cc * cs + 1, oy + r * cs + 1, cs - 2, cs - 2); if (act > 0.6) { ctx.fillStyle = c.accent2; ctx.fillRect(ox + cc * cs + cs / 2 - 1.5, oy + r * cs + cs / 2 - 1.5, 3, 3); } ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.strokeRect(ox + cc * cs + 1, oy + r * cs + 1, cs - 2, cs - 2); }
    },
    archLLM: function (ctx, w, h, t, st, seed) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var layers = [3, 5, 5, 3], padX = 22, padY = 16, cols = layers.map(function (n, li) { var x = padX + li * (w - 2 * padX) / (layers.length - 1), ys = []; for (var i = 0; i < n; i++) ys.push({ x: x, y: padY + (i + 0.5) * (h - 2 * padY) / n }); return ys; }), wave = (t * 1.1 + seed) % (layers.length + 0.5);
      for (var li = 0; li < cols.length - 1; li++) { var act = Math.max(0, 1 - Math.abs(li + 0.5 - wave)); cols[li].forEach(function (a) { cols[li + 1].forEach(function (b) { ctx.strokeStyle = accA(c, 0.07 + 0.4 * act); ctx.lineWidth = 0.6 + 1.3 * act; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }); }); }
      cols.forEach(function (col, li) { var act = Math.max(0, 1 - Math.abs(li - wave)); col.forEach(function (n) { ctx.fillStyle = accA(c, 0.25 + 0.6 * act); ctx.beginPath(); ctx.arc(n.x, n.y, 4 + 2 * act, 0, 7); ctx.fill(); ctx.strokeStyle = c.accent; ctx.lineWidth = 1; ctx.stroke(); }); });
    },
    bloch: function (ctx, w, h, t, st) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      if (!st.init) { st.a0 = [1, 0]; st.a1 = [0, 0]; st.gi = -1; st.from = null; st.to = null; st.ts = 0; st.init = true; }
      var gates = ['H', 'X', 'S', 'H', 'Z', 'T'], period = 1.6, idx = Math.floor(t / period);
      if (idx !== st.gi) { st.gi = idx; st.from = bv(st.a0, st.a1); ag(st, gates[((idx % 6) + 6) % 6]); st.to = bv(st.a0, st.a1); st.ts = idx * period; }
      var lt = Math.min(1, (t - st.ts) / 0.45), e = lt * lt * (3 - 2 * lt), v = (st.from && st.to) ? [st.from[0] + (st.to[0] - st.from[0]) * e, st.from[1] + (st.to[1] - st.from[1]) * e, st.from[2] + (st.to[2] - st.from[2]) * e] : bv(st.a0, st.a1), L = Math.hypot(v[0], v[1], v[2]) || 1; v = [v[0] / L, v[1] / L, v[2] / L];
      var cx = w * 0.7, cy = h * 0.5, R = Math.min(h * 0.36, w * 0.22);
      ctx.strokeStyle = c.rule2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.32, 0, 0, 7); ctx.stroke();
      ctx.strokeStyle = c.rule; ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      var sx = cx + R * v[0], sy = cy - R * v[2] + R * 0.32 * v[1]; ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke(); ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
      ctx.fillStyle = c.faint; ctx.font = MONOF(10); ctx.fillText('|0⟩', cx - 7, cy - R - 6); ctx.fillText('|1⟩', cx - 7, cy + R + 15);
      var p0 = st.a0[0] * st.a0[0] + st.a0[1] * st.a0[1], p1 = st.a1[0] * st.a1[0] + st.a1[1] * st.a1[1], bw = 38, bx = w * 0.08, bbot = cy + R, bh = 2 * R;
      ctx.fillStyle = accA(c, 0.24 + p0 * 0.5); ctx.fillRect(bx, bbot - p0 * bh, bw, p0 * bh); ctx.fillStyle = accA(c, 0.24 + p1 * 0.5); ctx.fillRect(bx + bw + 12, bbot - p1 * bh, bw, p1 * bh);
      ctx.fillStyle = c.faint; ctx.textAlign = 'center'; ctx.fillText('|0⟩', bx + bw / 2, bbot + 14); ctx.fillText('|1⟩', bx + bw + 12 + bw / 2, bbot + 14); ctx.textAlign = 'left';
      ctx.fillStyle = c.accent2; ctx.font = '600 13px ' + (rv('--mono') || 'monospace'); ctx.fillText('gate ' + gates[((st.gi % 6) + 6) % 6], bx, cy + R + 32);
    },
    attention: function (ctx, w, h, t, st) {
      var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      var toks = ['The', 'cat', 'that', 'ran', 'was', 'very', 'fast'], N = 7;
      if (!st.W) { var base = [[3, 1, 0, 0, 1, 0, 0], [1, 3, 0, 1, 0, 0, 0], [1, 1, 3, 0, 0, 0, 0], [0, 1, 0, 3, 1, 0, 0], [0, 2, 0, 1, 3, 0, 0], [0, 0, 0, 1, 1, 3, 1], [0, 1, 0, 2, 2, 1, 3]]; st.W = base.map(function (r) { var ex = r.map(function (v) { return Math.exp(v); }), s = ex.reduce(function (a, b) { return a + b; }, 0); return ex.map(function (v) { return v / s; }); }); st.max = st.W.map(function (r) { return Math.max.apply(null, r); }); }
      var hi = Math.floor(t / 1.5) % N, m = Math.min(w - 70, h - 40), cs = m / N, ox = 54, oy = 20;
      ctx.font = MONOF(9);
      for (var i = 0; i < N; i++) { ctx.fillStyle = i === hi ? c.ink : c.faint; ctx.textAlign = 'right'; ctx.fillText(toks[i], ox - 6, oy + i * cs + cs / 2 + 3); ctx.save(); ctx.translate(ox + i * cs + cs / 2, oy - 6); ctx.rotate(-Math.PI / 5); ctx.textAlign = 'left'; ctx.fillStyle = c.faint; ctx.fillText(toks[i], 0, 0); ctx.restore(); }
      ctx.textAlign = 'left';
      for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) { var av = st.W[a][b] / st.max[a], dim = (a === hi) ? 1 : 0.28; ctx.fillStyle = accA(c, av * dim); ctx.fillRect(ox + b * cs + 1, oy + a * cs + 1, cs - 2, cs - 2); if (a === hi) { ctx.strokeStyle = c.accent; ctx.lineWidth = 0.6; ctx.strokeRect(ox + b * cs + 1, oy + a * cs + 1, cs - 2, cs - 2); } }
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.strokeRect(ox, oy + hi * cs, N * cs, cs);
      ctx.fillStyle = c.faint; ctx.font = MONOF(9); ctx.fillText('illustrative weights · row attends to columns', ox, oy + N * cs + 16);
    },
    // DESIGN SCHEMATIC — the actual circuit the recipe builds + the chip it needs.
    recipe: function (ctx, w, h, t) {
      var KN = window.QMKnowledge; var c = C(); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      recipeHits = [];
      if (!KN) return;
      var P = recipe.params, ans = KN.buildAnsatz(recipe.target, P.depth, P.entangle), chip = KN.couplingMap(ans.n, P.entangle);
      var hue = KN.taskColor((KN.PROBLEMS[recipe.target] || {}).task || 'vqe');
      var splitX = Math.round(w * 0.60);
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 ' + MONOF(10); ctx.textAlign = 'left'; ctx.fillStyle = c.faint;
      ctx.fillText('CIRCUIT · the ansatz your recipe builds', 12, 16);
      ctx.fillText('CHIP · the topology it needs', splitX + 14, 16);
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(splitX, 24); ctx.lineTo(splitX, h - 32); ctx.stroke();

      // ===== CIRCUIT (left) =====
      var n = ans.n, top = 36, botPad = 36, span = h - top - botPad;
      var wy = function (q) { return n === 1 ? top + span / 2 : top + q * (span / (n - 1)); };
      var cx0 = 44, cx1 = splitX - 18, colN = ans.cols.length, colGap = (cx1 - cx0) / Math.max(1, colN);
      var colX = function (i) { return cx0 + (i + 0.5) * colGap; };
      ctx.strokeStyle = c.rule2; ctx.lineWidth = 1.2;
      for (var q = 0; q < n; q++) { ctx.beginPath(); ctx.moveTo(cx0 - 16, wy(q)); ctx.lineTo(cx1 + 6, wy(q)); ctx.stroke();
        ctx.fillStyle = c.faint; ctx.font = MONOF(9.5); ctx.textAlign = 'right'; ctx.fillText('q' + q, cx0 - 20, wy(q) + 3); }
      if (!reduce) { var ph = (t * 0.18) % 1, px = (cx0 - 16) + (cx1 + 6 - (cx0 - 16)) * ph;
        for (q = 0; q < n; q++) { ctx.fillStyle = accA(c, 0.5 * Math.sin(Math.PI * ph)); ctx.beginPath(); ctx.arc(px, wy(q), 2.4, 0, 7); ctx.fill(); } }
      ans.cols.forEach(function (col, ci) {
        var x = colX(ci);
        if (col.type === 'cx') {
          col.pairs.forEach(function (pr) {
            var ya = wy(pr[0]), yb = wy(pr[1]);
            ctx.strokeStyle = hue; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, ya); ctx.lineTo(x, yb); ctx.stroke();
            ctx.fillStyle = hue; ctx.beginPath(); ctx.arc(x, ya, 3.4, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.arc(x, yb, 6, 0, 7); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - 6, yb); ctx.lineTo(x + 6, yb); ctx.moveTo(x, yb - 6); ctx.lineTo(x, yb + 6); ctx.stroke();
          });
        } else {
          col.qubits.forEach(function (qb) {
            var yy = wy(qb), bw = 22, bh = 15;
            ctx.fillStyle = col.type === 'init' ? accA(c, 0.10) : c.bg; rr(ctx, x - bw / 2, yy - bh / 2, bw, bh, 3); ctx.fill();
            ctx.strokeStyle = col.type === 'init' ? c.accent : c.rule2; ctx.lineWidth = 1.1; rr(ctx, x - bw / 2, yy - bh / 2, bw, bh, 3); ctx.stroke();
            ctx.fillStyle = c.ink; ctx.font = '600 ' + MONOF(9); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(col.gate, x, yy); ctx.textBaseline = 'alphabetic';
          });
        }
      });
      ctx.fillStyle = c.ink2; ctx.font = MONOF(10); ctx.textAlign = 'left';
      ctx.fillText('depth ' + ans.depth + '  ·  ' + ans.twoq + ' two-qubit gates  ·  ' + ans.rot + ' rotations', cx0 - 16, h - 14);

      // ===== CHIP (right) =====
      var ox = (splitX + w) / 2 + 4, oy = (24 + h - 32) / 2 - 6, R = Math.min((w - splitX) * 0.28, span * 0.42);
      chip.edges.forEach(function (e) {
        var a = chip.nodes[e[0]], b = chip.nodes[e[1]];
        ctx.strokeStyle = hue; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(ox + a.x * R, oy + a.y * R); ctx.lineTo(ox + b.x * R, oy + b.y * R); ctx.stroke(); ctx.globalAlpha = 1;
      });
      chip.nodes.forEach(function (nd) {
        var x = ox + nd.x * R, y = oy + nd.y * R;
        ctx.fillStyle = c.bg; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = hue; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = c.ink; ctx.font = '600 ' + MONOF(9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('q' + nd.i, x, y); ctx.textBaseline = 'alphabetic';
      });
      ctx.fillStyle = c.ink2; ctx.font = MONOF(10); ctx.textAlign = 'left';
      ctx.fillText(chip.fits.name + '  ·  degree ' + chip.degree, splitX + 14, h - 28);
      ctx.fillStyle = c.faint; ctx.font = MONOF(9); ctx.fillText('fits: ' + chip.fits.hw, splitX + 14, h - 14);
    },
  };
  function bv(a0, a1) { return [2 * (a0[0] * a1[0] + a0[1] * a1[1]), 2 * (a0[0] * a1[1] - a0[1] * a1[0]), (a0[0] * a0[0] + a0[1] * a0[1]) - (a1[0] * a1[0] + a1[1] * a1[1])]; }
  function ag(st, g) { var a0 = st.a0, a1 = st.a1, s = Math.SQRT1_2; if (g === 'H') { st.a0 = [s * (a0[0] + a1[0]), s * (a0[1] + a1[1])]; st.a1 = [s * (a0[0] - a1[0]), s * (a0[1] - a1[1])]; } else if (g === 'X') { st.a0 = a1; st.a1 = a0; } else if (g === 'Z') { st.a1 = [-a1[0], -a1[1]]; } else if (g === 'S') { st.a1 = [-a1[1], a1[0]]; } else if (g === 'T') { st.a1 = [a1[0] * s - a1[1] * s, a1[0] * s + a1[1] * s]; } }

  // ─────────────────────────── THEME TOGGLE ───────────────────────────
  (function wireTheme() {
    var btn = document.getElementById('themeToggle'); if (!btn) return; var label = document.getElementById('themeLabel');
    function sync() { var d = root.getAttribute('data-theme') === 'dark'; if (label) label.textContent = d ? 'Paper mode' : 'Luminous mode'; }
    btn.addEventListener('click', function () { var d = !(root.getAttribute('data-theme') === 'dark'); if (d) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme'); try { localStorage.setItem('qh-theme', d ? 'dark' : 'paper'); } catch (e) { } sync(); drawAllOnce(); });
    if (window.MutationObserver) new MutationObserver(drawAllOnce).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
  })();

  // ─────────────────────────── BOOT ───────────────────────────
  var s0 = sectionFromHash(); if (s0) state.section = s0;
  render();
  if (!reduce) raf = requestAnimationFrame(loop); else { setTimeout(drawAllOnce, 60); setTimeout(drawAllOnce, 240); }
  try { var qs = new URLSearchParams(location.search);
    if (qs.get('run') && window.QMRunner.RUNS[qs.get('run')]) setTimeout(function () { window.QMRunner.open(qs.get('run')); }, 120);
    else if (qs.has('submit')) setTimeout(function () { openSubmit(qs.get('submit') || state.picked); }, 120);
  } catch (e) { }
})();
