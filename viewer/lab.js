/* QuantumMytheme · Field Notebook (lab.js) — self-contained, dependency-free, file://-safe.
   A vanilla recreation of the "Phosphor & Vellum" Dossier design: full-frame lab notebook,
   manila folder tabs, vellum sheets with live canvas animations. No framework. */
(function () {
  'use strict';
  var root = document.getElementById('qm');
  var sheet = document.getElementById('qm-sheet');
  var tabsEl = document.getElementById('qm-tabs');
  if (!root || !sheet) return;

  var ACC = { phosphor: '#5ef2e4', violet: '#9d8cff', amber: '#ffb454' };
  var ACCRGB = { phosphor: [94, 242, 228], violet: [157, 140, 255], amber: [255, 180, 84] };
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var state = { section: 'front', model: 'mythos', filter: 'all', picked: 'ghz3', accent: 'phosphor' };
  function acc() { return ACC[state.accent] || '#5ef2e4'; }
  function accRGB(a) { var c = ACCRGB[state.accent] || ACCRGB.phosphor; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function applyAccent() { root.style.setProperty('--qm-accent', acc()); root.style.setProperty('--qm-accent-glow', accRGB(0.5)); }

  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  // ─────────────────────────── DATA ───────────────────────────
  var TABS = [['front', 'Abstract', '01'], ['brief', 'Method', '02'], ['field', 'Protocol', '03'], ['atlas', 'Results', '04'], ['register', 'Logbook', '05'], ['primer', 'Theory', '06']];

  var GATES = [
    { exit: 3, name: 'Structure', body: 'Respects qubit count, depth, native gates, coupling map, 2-qubit cap.' },
    { exit: 4, name: 'Reproduce', body: 'Re-simulates the claim — fabrication caught.' },
    { exit: 5, name: 'Performance', body: 'Meets threshold and beats the classical baseline.' },
    { exit: 6, name: 'Anti-overfit', body: 'Held-out check the model was never told.' },
  ];
  var MODEL_TAG = { 'built-for': 'color:var(--pteal);background:rgba(14,122,140,.12);', today: 'color:var(--pgreen);background:rgba(63,122,82,.14);', open: 'color:var(--pt2);background:rgba(71,86,106,.12);' };
  var MODELS = [['mythos', 'Claude Mythos', 'built-for', 'Deep exploration — point it at the hardest briefs'], ['fable5', 'Fable 5', 'built-for', 'Long autonomous runs against the rubric'], ['opus', 'Opus 4.8', 'today', 'Runs every worked problem today'], ['byo', 'Bring your own', 'open', 'Any capable model — compare what holds across models']];
  var STEPS = [
    ['1', 'Pick a brief', 'Choose a committed problem from the catalog, or remix the current best.', 'bin/new-run.sh run-ghz3 --remix ghz3'],
    ['2', 'Mint a run repo', 'One click forks a fresh public repo into the QuantumMytheme org.', 'gh repo create --template QuantumMytheme/quantum-harness'],
    ['3', 'Point your model at it', 'Mythos, Fable 5, or any capable model self-corrects against the rubric.', 'claude --kickoff KICKOFF.md'],
    ['4', 'Let the judge grade it', 'A hermetic numpy sim re-simulates — ACCEPT (exit 0) or REJECT.', 'python3 judge_verify.py my-bundle.json'],
    ['5', 'Commit & push', 'Proof bundle, scorecard, and a scrubbed transcript — auto-registers.', 'git push  # the judge is the merge gate'],
  ];
  var BRIEFS = [
    ['ghz3', 'GHZ₃', 'state_prep', '3-qubit GHZ under a linear [0–1–2] coupling map. Threshold fidelity 0.99.', 'ghz3 reference (fid 1.000)'],
    ['isingbell2', 'Ising Bell', 'vqe', 'Ground state of H = −X₀X₁ − Z₀Z₁. True E₀ = −2; baseline −1.', 'isingbell2 (E −2.000)'],
    ['bell_pops2', 'Bell |Φ⁺⟩', 'populations', 'Visible spec is Z-basis 50/50; the judge holds out ⟨X₀X₁⟩ = +1.', 'bell_pops2 (anti-overfit)'],
    ['aiaccel4', 'AI-Accel Ring', 'architecture', 'Route two workloads on one topology within budget.', 'aiaccel4 ring topology'],
    ['h2vqe', 'H₂ molecule', 'vqe', 'Reach the H₂ ground state (E₀ = −1.8512) past the mean-field baseline.', 'h2vqe (gap 4e-4)'],
  ];
  var FILT = [['all', 'All'], ['quantum', 'Quantum chips'], ['classical', 'Classical chips'], ['llm', 'LLM architectures']];
  var GAL = [
    ['ghz3', 'state_prep', 'linear-chain GHZ', 'fidelity 1.000', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['isingbell2', 'vqe', 'Bell ansatz', 'energy −2.000', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['tfim3', 'vqe', 'QAOA p=2', 'energy −3.0089', 'opus-4.8', 'quantum', 'chipQuantum', 'ok'],
    ['h2vqe', 'vqe', 'Ry-CX ansatz', 'E −1.8508 (gap 4e-4)', 'reference', 'quantum', 'chipQuantum', 'ok'],
    ['aiaccel4', 'architecture', 'ring topology', 'routes 2 workloads', 'opus-4.8', 'classical', 'chipClassical', 'ok'],
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

  // ─────────────────────────── TEMPLATES ───────────────────────────
  var BADGE_OK = 'font-family:var(--mono);font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;border-radius:4px;color:var(--pgreen);background:rgba(63,122,82,.15);';
  var BADGE_ERR = 'font-family:var(--mono);font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;border-radius:4px;color:var(--pred);background:rgba(189,74,48,.13);';

  function plateHead(sec, title, meta) {
    return '<div class="qm-plate-head"><div><div class="qm-sec">' + sec + '</div><h2>' + title + '</h2></div>' +
      '<div class="qm-plate-meta">' + meta + '</div></div>';
  }
  function canvas(anim, key, height, seed) {
    return '<canvas class="qm-canvas" data-anim="' + anim + '" data-key="' + key + '"' + (seed != null ? ' data-seed="' + seed + '"' : '') + ' style="height:' + height + 'px;"></canvas>';
  }
  function spark(arr, tone) {
    return arr.map(function (v, i) {
      var last = i === arr.length - 1;
      var bg = last ? (tone === 'err' ? '#bd4a30' : '#0e7a8c') : (tone === 'err' ? 'rgba(189,74,48,.3)' : 'rgba(14,122,140,.28)');
      return '<i style="flex:1;min-width:3px;border-radius:1px 1px 0 0;height:' + Math.max(8, v) + '%;background:' + bg + ';"></i>';
    }).join('');
  }

  function secFront() {
    var feats = [
      ['<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>', 'A reproducible measurement', 'ACCEPT or REJECT from a hermetic simulator — reproducible on a laptop.'],
      ['<circle cx="6" cy="12" r="3.4"/><circle cx="18" cy="7" r="3.4"/><circle cx="18" cy="17" r="3.4"/><line x1="8.8" y1="10.6" x2="15.2" y2="8"/><line x1="8.8" y1="13.4" x2="15.2" y2="16"/>', 'An open, re-verifiable record', 'Every accepted run is public; anyone can recompute the number.'],
      ['<circle cx="12" cy="12" r="9" opacity=".4"/><path d="M12 3 L15 13 L12 11 L9 13 Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>', 'Toward quantum-native inference', 'Hard architecture briefs, scored honestly at scale.'],
    ].map(function (f) {
      return '<div style="display:flex;gap:12px;margin-bottom:18px;align-items:flex-start;">' +
        '<span style="color:var(--pteal);flex:0 0 auto;margin-top:1px;"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' + f[0] + '</svg></span>' +
        '<div><div style="font-family:var(--serif);font-weight:600;font-size:16px;color:var(--pt);line-height:1.2;">' + f[1] + '</div>' +
        '<div style="font-family:var(--serif);font-size:14px;color:var(--pt2);line-height:1.45;margin-top:3px;">' + f[2] + '</div></div></div>';
    }).join('');
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 01 · Abstract', 'Open, reproducible quantum circuit design', 'Open · MIT<br>ed. 2026.06') +
      '<div style="position:relative;margin:34px 6px 40px;transform:rotate(-0.7deg);">' +
        '<div style="position:absolute;top:-13px;left:38px;width:86px;height:25px;background:linear-gradient(180deg,rgba(94,242,228,.20),rgba(94,242,228,.09));border:1px solid rgba(94,242,228,.28);transform:rotate(-5deg);box-shadow:0 1px 4px rgba(0,0,0,.2);z-index:3;"></div>' +
        '<div style="position:absolute;top:-11px;right:44px;width:86px;height:25px;background:linear-gradient(180deg,rgba(94,242,228,.20),rgba(94,242,228,.09));border:1px solid rgba(94,242,228,.28);transform:rotate(4.5deg);box-shadow:0 1px 4px rgba(0,0,0,.2);z-index:3;"></div>' +
        '<div style="background:#faf7ee;padding:13px 13px 0;border:1px solid #d8d2bf;box-shadow:0 16px 34px -12px rgba(0,0,0,.5),0 3px 0 rgba(120,98,54,.12);">' +
          '<div style="border:1px solid #1a2738;background:#0a0e16;overflow:hidden;box-shadow:inset 0 0 70px rgba(0,0,0,.55);">' + canvas('hero', 'hero', 300) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 4px 12px;gap:12px;">' +
            '<span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--pt2);">Fig. 1 — Verified GHZ₃ run · qubits, couplers, statevector, verification sweep</span>' +
            '<span class="qm-figcap" style="white-space:nowrap;">plate i · tipped-in</span></div></div></div>' +
      '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:40px;align-items:start;" class="qm-front-grid">' +
        '<div><h1 style="font-size:33px;line-height:1.2;letter-spacing:-.015em;margin:0 0 16px;text-wrap:balance;">Point Claude <em class="qm-em">Mythos</em> or <em class="qm-em">Fable&nbsp;5</em> — or any capable model — at a hard quantum design problem, and get a verdict a stranger can re-run.</h1>' +
          '<p style="font-size:17px;line-height:1.62;margin:0 0 14px;">QuantumMytheme is a citizen-science platform built on one idea: <b>correctness can be scored without human taste.</b> You fork a one-run prompt harness, point your model\'s tokens at a brief, and a hermetic <span class="qm-mono" style="font-size:14px;">numpy</span> judge re-simulates the circuit and returns ACCEPT or REJECT. The result — and the circuit behind it — becomes a public, re-verifiable artifact.</p>' +
          '<p style="font-size:17px;line-height:1.62;margin:0 0 22px;">The near horizon is an open, ranked library of verified circuits. The far one is the reason it exists: <span style="font-style:italic;color:var(--pt);">native quantum-processing architectures for AI inference</span>, beyond today\'s classical stack.</p>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;"><button class="qm-btn" data-goto="field">Start a run →</button><button class="qm-btn ghost" data-goto="atlas">Explore the Atlas</button></div></div>' +
        '<div style="border-left:1px solid var(--prule);padding-left:26px;">' +
          '<div class="qm-lbl" style="margin-bottom:16px;">What it gives you</div>' + feats +
          '<div style="margin-top:22px;padding-top:18px;border-top:1px dashed var(--prule);font-family:var(--mono);font-size:11px;line-height:1.7;color:var(--pt2);">' +
            '<div style="letter-spacing:.16em;text-transform:uppercase;font-size:9px;color:var(--pf);margin-bottom:8px;">What\'s asked of you</div>' +
            'A capable model (subscription or API) · three commands · report the result back.</div></div></div>' +
      '</section>';
  }

  function secBrief() {
    var rows = GATES.map(function (g) {
      return '<div style="display:flex;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--prule2);">' +
        '<span class="qm-mono" style="font-size:11px;color:var(--pteal);flex:0 0 52px;">exit ' + g.exit + '</span>' +
        '<span class="qm-mono" style="font-size:11px;font-weight:600;color:var(--pt);letter-spacing:.06em;text-transform:uppercase;flex:0 0 116px;">' + g.name + '</span>' +
        '<span style="font-family:var(--serif);font-size:14px;color:var(--pt2);line-height:1.35;">' + g.body + '</span></div>';
    }).join('');
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 02 · Method', 'How a circuit is verified', 'Judge · numpy<br>4 active gates') +
      '<div class="qm-grid2" style="margin-top:24px;"><div>' +
        '<p style="font-size:16.5px;line-height:1.62;margin:0 0 14px;">Every session an agent re-reads a codebase, it pays a <b>20–80k-token rediscovery tax.</b> The harness replaces that with a contract: a <span class="qm-mono" style="font-size:13.5px;">BRIEF</span> states the problem conceptually, a <span class="qm-mono" style="font-size:13.5px;">RUBRIC</span> binds every criterion to a check, and a fresh, non-conflicted judge grades the proof bundle — looping until every gate is green.</p>' +
        '<p style="font-size:16.5px;line-height:1.62;margin:0 0 20px;">The judge is a hermetic statevector simulator that <b>re-simulates the submitted circuit from scratch</b> against ground truth the author never sees. A bundle can <span style="font-style:italic;">claim</span> fidelity 1.0; the judge recomputes it and rejects the lie.</p>' +
        '<div class="qm-lbl" style="letter-spacing:.16em;margin-bottom:10px;">Four active gates</div>' + rows + '</div>' +
      '<div><div class="qm-framed">' + canvas('judge', 'judge', 236) + '</div>' +
        '<div class="qm-figcap" style="margin:10px 0 22px;">Fig. 2 — A bundle traverses the gates · the anti-overfit gate (exit 6) rejects a wrong-phase impostor</div>' +
        '<div style="border:1px solid var(--prule);border-left:3px solid var(--pteal);border-radius:4px;background:#f1efe4;padding:16px 18px;">' +
          '<div style="font-family:var(--ui);font-weight:600;font-size:14.5px;color:var(--pt);margin-bottom:6px;">A simulator-only bench, stated plainly</div>' +
          '<div style="font-family:var(--serif);font-size:14px;line-height:1.5;color:var(--pt2);">The judge proves logical correctness and resource constraints under ideal simulation — not the physics of a fabricated device. Real-hardware overlays are a labeled, partly-re-verifiable layer (density-matrix noisy predictions, counts re-verification); the sim score stays canonical.</div></div></div></div></section>';
  }

  function secField() {
    var models = MODELS.map(function (m) {
      var on = state.model === m[0];
      return '<button data-model="' + m[0] + '" style="text-align:left;cursor:pointer;border:1px solid ' + (on ? 'var(--pteal)' : 'var(--prule)') + ';background:' + (on ? '#faf8f0' : '#f1efe4') + ';border-radius:8px;padding:13px 13px 14px;box-shadow:' + (on ? '0 0 0 2px rgba(14,122,140,.18),0 1px 0 var(--prule)' : '0 1px 0 var(--prule)') + ';">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;"><span style="font-family:var(--serif);font-weight:600;font-size:15.5px;color:var(--pt);">' + m[1] + '</span>' +
        '<span style="font-family:var(--mono);font-size:8px;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border-radius:4px;' + (MODEL_TAG[m[2]] || '') + '">' + m[2] + '</span></div>' +
        '<div style="font-family:var(--serif);font-size:12.5px;line-height:1.4;color:var(--pt2);">' + m[3] + '</div></button>';
    }).join('');
    var steps = STEPS.map(function (s) {
      return '<div style="display:flex;gap:14px;margin-bottom:16px;align-items:flex-start;">' +
        '<span style="flex:0 0 27px;height:27px;border-radius:50%;border:1px solid var(--pteal);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;color:var(--pteal);background:#f1efe4;margin-top:1px;">' + s[0] + '</span>' +
        '<div style="flex:1;"><div style="font-family:var(--serif);font-weight:600;font-size:16px;color:var(--pt);">' + s[1] + '</div>' +
        '<div style="font-family:var(--serif);font-size:13.5px;color:var(--pt2);line-height:1.45;margin:2px 0 6px;">' + s[2] + '</div>' +
        '<code style="display:block;font-family:var(--mono);font-size:11.5px;color:var(--pteal);background:#e9e7d9;border:1px solid var(--prule);border-radius:4px;padding:6px 9px;overflow-x:auto;">' + esc(s[3]) + '</code></div></div>';
    }).join('');
    var pills = BRIEFS.map(function (b) {
      var on = state.picked === b[0];
      return '<button data-brief="' + b[0] + '" style="cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.03em;padding:6px 11px;border-radius:6px;border:1px solid ' + (on ? 'var(--pteal)' : 'var(--prule)') + ';background:' + (on ? 'var(--pteal)' : '#f1efe4') + ';color:' + (on ? '#f4f1e7' : 'var(--pt2)') + ';">' + b[1] + '</button>';
    }).join('');
    var p = BRIEFS.filter(function (b) { return b[0] === state.picked; })[0] || BRIEFS[0];
    var repo = 'run-' + p[0] + '-2026-06-16', cmd = 'bin/new-run.sh ' + repo + ' --remix ' + p[0];
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 03 · Protocol', 'Run your own run', 'Fork · run<br>commit · push') +
      '<div class="qm-lbl" style="margin:24px 0 12px;">1 · Bring a model</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;" class="qm-models">' + models + '</div>' +
      '<div style="display:grid;grid-template-columns:1.1fr 1fr;gap:38px;margin-top:30px;align-items:start;" class="qm-grid2-b"><div>' +
        '<div class="qm-lbl" style="margin-bottom:14px;">2 · The citizen-science loop</div>' + steps + '</div>' +
      '<div><div class="qm-lbl" style="margin-bottom:14px;">3 · One-click new run repo</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px;">' + pills + '</div>' +
        '<div style="border:1px solid var(--folder-edge);border-radius:6px;background:var(--paper);padding:18px 18px 16px;box-shadow:0 1px 0 var(--prule);">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--prule);padding-bottom:10px;margin-bottom:12px;"><span class="qm-lbl" style="letter-spacing:.16em;">Minted repo</span><span class="qm-mono" style="font-size:10px;color:var(--pteal);">' + p[2] + '</span></div>' +
          '<div class="qm-mono" style="font-size:15px;color:var(--pt);font-weight:500;">' + repo + '</div>' +
          '<div style="font-family:var(--serif);font-size:13.5px;color:var(--pt2);line-height:1.45;margin:8px 0 12px;">' + p[3] + '</div>' +
          '<code style="display:block;font-family:var(--mono);font-size:11px;color:var(--pteal);background:#e9e7d9;border:1px solid var(--prule);border-radius:4px;padding:7px 9px;margin-bottom:12px;">' + esc(cmd) + '</code>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;"><span class="qm-mono" style="font-size:10px;color:var(--pt2);">remixes the current best · ' + p[4] + '</span><button class="qm-btn sm">Create repo</button></div></div>' +
        '<div style="margin-top:22px;" class="qm-framed">' + canvas('run', 'run', 184) + '</div>' +
        '<div class="qm-figcap" style="margin-top:9px;">Fig. 3 — Live circuit · H then CX build the Bell state, fidelity climbs to 1.000</div></div></div></section>';
  }

  function secAtlas() {
    var filters = FILT.map(function (f) {
      var on = state.filter === f[0];
      return '<button data-filter="' + f[0] + '" style="cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:7px 13px;border-radius:6px;border:1px solid ' + (on ? 'var(--pteal)' : 'var(--prule)') + ';background:' + (on ? 'var(--pteal)' : 'transparent') + ';color:' + (on ? '#f4f1e7' : 'var(--pt2)') + ';">' + f[1] + '</button>';
    }).join('');
    var cards = GAL.filter(function (g) { return state.filter === 'all' || g[5] === state.filter; }).map(function (g, i) {
      var badge = g[7] === 'ok' ? BADGE_OK : BADGE_ERR, verdict = g[7] === 'ok' ? 'ACCEPT' : 'REJECT';
      return '<div style="border:1px solid var(--prule);border-radius:6px;background:var(--paper);overflow:hidden;box-shadow:0 1px 0 var(--prule);display:flex;flex-direction:column;">' +
        '<div style="border-bottom:1px solid var(--prule);background:var(--paper2);">' + canvas(g[6], 'gal-' + g[0], 128, i) + '</div>' +
        '<div style="padding:13px 14px 14px;flex:1;display:flex;flex-direction:column;">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;"><span class="qm-mono" style="font-size:13px;color:var(--pt);font-weight:500;">' + g[0] + '</span><span class="qm-mono" style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--pf);">' + g[1] + '</span></div>' +
          '<div style="font-family:var(--serif);font-size:14px;color:var(--pt2);margin:4px 0 10px;">' + g[2] + '</div>' +
          '<div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;"><span class="qm-mono" style="font-size:12px;color:var(--pteal);">' + g[3] + '</span><span style="' + badge + '">' + verdict + '</span></div>' +
          '<div class="qm-mono" style="font-size:9px;color:var(--pf);margin-top:8px;letter-spacing:.05em;">' + g[4] + '</div></div></div>';
    }).join('');
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 04 · Results', 'Catalog of verified circuits', 'Chips · topologies<br>architectures') +
      '<p style="font-size:15.5px;line-height:1.55;margin:18px 0 18px;max-width:680px;">Each card is a proof bundle — quantum chips, classical floorplans, and the software architectures people discover by pressure-testing patterns on real models. Load one and re-run the exact simulation the judge ran.</p>' +
      '<div style="display:flex;gap:7px;margin-bottom:22px;flex-wrap:wrap;">' + filters + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;" class="qm-gal">' + cards + '</div></section>';
  }

  function secRegister() {
    var stats = STATS.map(function (s) {
      var trend = s[3] ? '<span style="font-family:var(--mono);font-size:9.5px;padding:1px 6px;border-radius:4px;color:var(--pgreen);background:rgba(63,122,82,.14);">' + s[3] + '</span>' : '';
      return '<div style="border:1px solid var(--prule);border-radius:8px;background:var(--paper);padding:16px 16px 14px;box-shadow:0 1px 0 var(--prule);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;"><span class="qm-lbl" style="font-size:9.5px;letter-spacing:.14em;">' + s[0] + '</span>' + trend + '</div>' +
        '<div style="font-family:var(--serif);font-weight:600;font-size:30px;letter-spacing:-.02em;color:var(--pt);line-height:1;">' + s[1] + '</div>' +
        '<div class="qm-mono" style="font-size:10.5px;color:var(--pf);margin-top:6px;">' + s[2] + '</div>' +
        '<span style="display:flex;align-items:flex-end;gap:3px;height:26px;margin-top:11px;">' + spark(s[4]) + '</span></div>';
    }).join('');
    var head = '<div style="display:grid;grid-template-columns:42px 1.1fr 1.1fr 1fr 1fr 0.9fr 96px;gap:10px;padding:10px 16px;border-bottom:1px solid var(--prule);background:var(--paper2);font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--pf);"><span>#</span><span>Problem</span><span>Paradigm</span><span>Metric</span><span>Author</span><span>Trend</span><span style="text-align:right;">Result</span></div>';
    var rows = REG.map(function (r) {
      var badge = r[5] === 'ok' ? BADGE_OK : BADGE_ERR;
      return '<div style="display:grid;grid-template-columns:42px 1.1fr 1.1fr 1fr 1fr 0.9fr 96px;gap:10px;padding:13px 16px;border-bottom:1px solid var(--prule2);align-items:center;">' +
        '<span style="font-family:var(--serif);font-weight:600;font-size:17px;color:var(--pteal);">' + r[0] + '</span>' +
        '<span><span class="qm-mono" style="display:block;font-size:13px;color:var(--pt);">' + r[1] + '</span><span class="qm-mono" style="display:block;font-size:8.5px;letter-spacing:.04em;color:var(--pf);margin-top:2px;">logged ' + r[8] + '</span></span>' +
        '<span style="font-family:var(--serif);font-size:14px;color:var(--pt2);">' + r[2] + '</span>' +
        '<span class="qm-mono" style="font-size:12.5px;color:var(--pteal);">' + r[3] + '</span>' +
        '<span class="qm-mono" style="font-size:11px;color:var(--pt2);">' + r[4] + '</span>' +
        '<span style="display:flex;align-items:flex-end;gap:2px;height:22px;">' + spark(r[7], r[5]) + '</span>' +
        '<span style="text-align:right;"><span style="' + badge + '">' + r[6] + '</span></span></div>';
    }).join('');
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 05 · Logbook', 'Best results to date, ranked by verified metric', 'Re-verifiable<br>judge = gate') +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0 28px;" class="qm-stats">' + stats + '</div>' +
      '<div style="border:1px solid var(--prule);border-radius:6px;overflow:hidden;background:var(--paper);">' + head + rows + '</div>' +
      '<div class="qm-mono" style="font-size:10px;color:var(--pt2);margin-top:14px;letter-spacing:.03em;">No maintainer scores correctness — the judge is the merge gate. Anyone can re-run <span style="color:var(--pteal);">judge_verify.py</span> on a committed bundle and reproduce the ranking.</div></section>';
  }

  function secPrimer() {
    var arc = ARC.map(function (label, i) {
      var last = i === ARC.length - 1;
      return '<span style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:6px;border:1px solid ' + (last ? 'var(--pteal)' : 'var(--prule)') + ';color:' + (last ? 'var(--pteal)' : 'var(--pt2)') + ';background:' + (last ? 'rgba(14,122,140,.08)' : 'transparent') + ';">' + label + '</span>';
    }).join('');
    return '<section class="qm-sheet"><span class="qm-marginrule"></span>' +
      plateHead('§ 06 · Theory', 'From rules to a quantum coprocessor', 'Background<br>11 ideas') +
      '<p style="font-size:15.5px;line-height:1.55;margin:18px 0 18px;max-width:720px;">A guided arc — how machines stopped following coded rules and started learning, how that scaled into transformers, the silicon underneath, and where quantum processors join as coprocessors. It ends where you take over. The full animated curriculum lives at <a href="/education" style="color:var(--pteal);">quantummytheme.com/education</a>.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:28px;">' + arc + '</div>' +
      '<div class="qm-grid2"><div><div class="qm-framed">' + canvas('bloch', 'bloch', 226) + '</div>' +
        '<div style="font-family:var(--serif);font-weight:600;font-size:16.5px;color:var(--pt);margin:14px 0 4px;">Simulating one qubit</div>' +
        '<p style="font-size:13.5px;line-height:1.5;margin:0;">Each gate is a unitary that rotates the statevector without changing its length. Measurement turns squared magnitudes into outcome probabilities — the same bookkeeping the judge runs to grade a circuit.</p></div>' +
      '<div><div class="qm-framed">' + canvas('attention', 'attn', 226) + '</div>' +
        '<div style="font-family:var(--serif);font-weight:600;font-size:16.5px;color:var(--pt);margin:14px 0 4px;">Attention, in parallel</div>' +
        '<p style="font-size:13.5px;line-height:1.5;margin:0;">Every token compares itself against every other at once — all-pairs matmuls, one-hop paths. An illustrative weight map, not a trained model; it shows why attention maps cleanly onto matrix-multiplying hardware.</p></div></div>' +
      '<div style="margin-top:26px;display:flex;align-items:center;gap:16px;border-top:1px dashed var(--prule);padding-top:20px;flex-wrap:wrap;">' +
        '<span style="font-family:var(--serif);font-style:italic;font-size:18px;color:var(--pt);">Ready to point your own model at a brief?</span>' +
        '<button class="qm-btn sm" data-goto="field">Start a run →</button></div></section>';
  }

  var SECTIONS = { front: secFront, brief: secBrief, field: secField, atlas: secAtlas, register: secRegister, primer: secPrimer };

  // ─────────────────────────── RENDER ───────────────────────────
  function renderTabs() {
    tabsEl.innerHTML = TABS.map(function (t) {
      var on = state.section === t[0];
      return '<button class="qm-tab" data-tab="' + t[0] + '" role="tab" aria-selected="' + on + '"><span class="plate">§ ' + t[2] + '</span>' + t[1] + '</button>';
    }).join('');
  }
  function render() {
    renderTabs();
    sheet.innerHTML = (SECTIONS[state.section] || secFront)();
    registerCanvases();
    drawAllOnce();
  }
  var VALID = { front: 1, brief: 1, field: 1, atlas: 1, register: 1, primer: 1 };
  function sectionFromHash() { var h = (location.hash || '').replace(/^#/, ''); return VALID[h] ? h : null; }
  function setState(patch) {
    for (var k in patch) state[k] = patch[k];
    if (patch.section) { try { history.replaceState(null, '', '#' + patch.section); } catch (e) { location.hash = patch.section; } }
    render();
  }
  window.addEventListener('hashchange', function () { var s = sectionFromHash(); if (s && s !== state.section) setState({ section: s }); });

  // delegated interactions
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-tab],[data-goto],[data-model],[data-brief],[data-filter],[data-accent]');
    if (!el) return;
    if (el.hasAttribute('data-accent')) {
      state.accent = el.getAttribute('data-accent'); applyAccent();
      [].forEach.call(document.querySelectorAll('.qm-accent-pick button'), function (b) { b.setAttribute('aria-pressed', b === el); });
      drawAllOnce(); return;
    }
    if (el.hasAttribute('data-tab')) return setState({ section: el.getAttribute('data-tab') });
    if (el.hasAttribute('data-goto')) return setState({ section: el.getAttribute('data-goto') });
    if (el.hasAttribute('data-model')) return setState({ model: el.getAttribute('data-model') });
    if (el.hasAttribute('data-brief')) return setState({ picked: el.getAttribute('data-brief') });
    if (el.hasAttribute('data-filter')) return setState({ filter: el.getAttribute('data-filter') });
  });

  // ─────────────────────────── ANIMATION ───────────────────────────
  var canvases = {}, cst = {}, t0 = performance.now(), raf = 0;
  function registerCanvases() {
    canvases = {};
    [].forEach.call(sheet.querySelectorAll('canvas[data-anim]'), function (el) { canvases[el.dataset.key] = el; });
  }
  function rr(ctx, x, y, w, h, r) { if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; } ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawOne(el, t) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight;
    if (w === 0 || h === 0) return;
    if (el._w !== w || el._h !== h || el._d !== dpr) { el.width = w * dpr; el.height = h * dpr; el._w = w; el._h = h; el._d = dpr; }
    var ctx = el.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var st = cst[el.dataset.key] || (cst[el.dataset.key] = {}), fn = ANIM[el.dataset.anim];
    if (fn) try { fn(ctx, w, h, t, st, +(el.dataset.seed || 0)); } catch (e) {}
  }
  function drawAllOnce() {
    var t = reduce ? 5.2 : (performance.now() - t0) / 1000;
    for (var k in canvases) { var el = canvases[k]; if (el && el.isConnected && el.offsetParent !== null) drawOne(el, t); }
  }
  function loop(now) {
    var t = (now - t0) / 1000;
    for (var k in canvases) { var el = canvases[k]; if (!el || !el.isConnected) { delete canvases[k]; continue; } if (el.offsetParent === null) continue; drawOne(el, t); }
    raf = requestAnimationFrame(loop);
  }
  window.addEventListener('resize', drawAllOnce);

  // ── animation functions (ported from the design) ──
  var ANIM = {
    hero: function (ctx, w, h, t) {
      var a = acc(), rgb = (ACCRGB[state.accent] || ACCRGB.phosphor).join(',');
      var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0b1320'); g.addColorStop(1, '#070a10');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accRGB(0.05); ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      for (var x = 34; x < w; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (var y = 34; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.setLineDash([]);
      var cx = w * 0.32, cy = h * 0.52, R = Math.min(h * 0.32, 116);
      var nodes = [{ x: cx, y: cy }];
      for (var i = 0; i < 6; i++) { var an = -Math.PI / 2 + i * Math.PI / 3; nodes.push({ x: cx + Math.cos(an) * R, y: cy + Math.sin(an) * R }); }
      var edges = []; for (var j = 1; j <= 6; j++) { edges.push([0, j]); edges.push([j, j % 6 + 1]); }
      var beamT = (t * 0.16) % 1, beamX = beamT * w;
      ctx.lineWidth = 1.3; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -(t * 16) % 8;
      edges.forEach(function (e) { var A = nodes[e[0]], B = nodes[e[1]]; ctx.strokeStyle = 'rgba(150,180,200,0.16)'; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); });
      ctx.setLineDash([]);
      nodes.forEach(function (n, i) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 2 - i * 0.7), passed = n.x < beamX, col = passed ? '110,231,183' : rgb;
        ctx.beginPath(); ctx.arc(n.x, n.y, 7 + pulse * 2, 0, 7);
        ctx.fillStyle = 'rgba(' + col + ',' + (0.22 + pulse * 0.45) + ')';
        ctx.shadowBlur = 16 * pulse; ctx.shadowColor = passed ? '#6ee7b7' : a; ctx.fill(); ctx.shadowBlur = 0;
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(' + col + ',0.85)'; ctx.stroke();
      });
      ctx.strokeStyle = accRGB(0.55); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(beamX, 0); ctx.lineTo(beamX, h); ctx.stroke();
      ctx.fillStyle = accRGB(0.06); ctx.fillRect(0, 0, beamX, h);
      var bx = w * 0.7, bw = (w * 0.26) / 8, btop = cy - R, bbot = cy + R;
      for (var k = 0; k < 8; k++) { var amp = Math.abs(Math.sin(t * 1.3 + k * 0.9)) * Math.exp(-Math.abs(k - 3.5) * 0.22), hh = (bbot - btop) * amp * 0.95; ctx.fillStyle = accRGB(0.14 + amp * 0.5); ctx.fillRect(bx + k * bw, bbot - hh, bw - 3, hh); }
      ctx.fillStyle = 'rgba(180,205,215,0.5)'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.fillText('STATEVECTOR · 2³', bx, btop - 9);
      ctx.fillStyle = 'rgba(180,205,215,0.42)'; ctx.fillText('GHZ₃ · LINEAR [0–1–2]', cx - 56, cy + R + 26);
      if (beamT > 0.84) { var aa = (beamT - 0.84) / 0.16; ctx.globalAlpha = Math.sin(aa * Math.PI); ctx.fillStyle = '#6ee7b7'; ctx.font = '600 15px "JetBrains Mono",monospace'; ctx.fillText('✓ ACCEPT · exit 0', w * 0.5 - 56, 28); ctx.globalAlpha = 1; }
    },
    judge: function (ctx, w, h, t) {
      ctx.fillStyle = '#f4f1e7'; ctx.fillRect(0, 0, w, h);
      var names = ['STRUCTURE', 'REPRODUCE', 'PERFORM', 'ANTI-OVERFIT'], exits = [3, 4, 5, 6], n = 4;
      var pad = 14, bw = (w - pad * 2) / n, by = h * 0.30, bh = h * 0.34;
      var loopN = Math.floor(t / 9), reject = (loopN % 3 === 2), local = (t % 9) / 9, prog = local * (n + 1), failGate = reject ? 3 : -1;
      for (var i = 0; i < n; i++) {
        var bx = pad + i * bw, reached = prog > i + 0.5, isFail = (i === failGate) && reached, passed = reached && !isFail;
        var stroke = passed ? '63,122,82' : (isFail ? '189,74,48' : '197,202,189');
        ctx.strokeStyle = 'rgb(' + stroke + ')'; ctx.lineWidth = reached ? 2 : 1;
        rr(ctx, bx + 6, by, bw - 12, bh, 6); ctx.stroke();
        if (reached) { ctx.fillStyle = 'rgba(' + (isFail ? '189,74,48' : '63,122,82') + ',0.10)'; rr(ctx, bx + 6, by, bw - 12, bh, 6); ctx.fill(); }
        ctx.fillStyle = '#16202b'; ctx.font = '600 9.5px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText(names[i], bx + bw / 2, by + bh / 2 - 1);
        ctx.fillStyle = '#93a0ad'; ctx.font = '9px "JetBrains Mono",monospace'; ctx.fillText('exit ' + exits[i], bx + bw / 2, by + bh / 2 + 14);
        if (passed) { ctx.strokeStyle = '#3f7a52'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + bw / 2 - 8, by - 9); ctx.lineTo(bx + bw / 2 - 3, by - 4); ctx.lineTo(bx + bw / 2 + 8, by - 15); ctx.stroke(); }
        if (isFail) { ctx.strokeStyle = '#bd4a30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + bw / 2 - 7, by - 14); ctx.lineTo(bx + bw / 2 + 7, by - 4); ctx.moveTo(bx + bw / 2 + 7, by - 14); ctx.lineTo(bx + bw / 2 - 7, by - 4); ctx.stroke(); }
      }
      var ty = by + bh + 28;
      ctx.strokeStyle = '#cfd6cd'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pad, ty); ctx.lineTo(w - pad, ty); ctx.stroke(); ctx.setLineDash([]);
      if (!(reject && prog > failGate + 1.2)) { var tx = Math.min(pad + prog * bw, w - pad); ctx.fillStyle = '#0e7a8c'; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, 7); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.font = '600 12px "JetBrains Mono",monospace';
      if (prog > n) { if (reject) { ctx.fillStyle = '#bd4a30'; ctx.fillText('REJECT · exit 6 · failed held-out ⟨X₀X₁⟩', w / 2, h - 12); } else { ctx.fillStyle = '#3f7a52'; ctx.fillText('ACCEPT · exit 0 · all gates green', w / 2, h - 12); } }
      ctx.textAlign = 'left';
    },
    run: function (ctx, w, h, t) {
      ctx.fillStyle = '#f4f1e7'; ctx.fillRect(0, 0, w, h);
      var lt = t % 6, s = Math.SQRT1_2, amp = [[1, 0], [0, 0], [0, 0], [0, 0]];
      if (lt > 1.2) amp = [[s, 0], [0, 0], [s, 0], [0, 0]];
      if (lt > 2.4) { var tmp = amp[2]; amp[2] = amp[3]; amp[3] = tmp; }
      var probs = amp.map(function (c) { return c[0] * c[0] + c[1] * c[1]; });
      var lx = 22, rx = w * 0.5, y0 = h * 0.26, y1 = h * 0.46;
      ctx.strokeStyle = '#16202b'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(rx, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, y1); ctx.lineTo(rx, y1); ctx.stroke();
      ctx.fillStyle = '#93a0ad'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.fillText('q0', 4, y0 + 3); ctx.fillText('q1', 4, y1 + 3);
      var gw = 22, hx = lx + (rx - lx) * 0.34, onH = lt > 1.2;
      ctx.strokeStyle = onH ? '#0e7a8c' : '#cfd6cd'; ctx.fillStyle = onH ? 'rgba(14,122,140,0.13)' : '#ece9db'; ctx.lineWidth = 1.4;
      rr(ctx, hx - gw / 2, y0 - gw / 2, gw, gw, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = onH ? '#0e7a8c' : '#93a0ad'; ctx.font = '600 12px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText('H', hx, y0 + 4); ctx.textAlign = 'left';
      var cxx = lx + (rx - lx) * 0.64, on2 = lt > 2.4;
      ctx.strokeStyle = on2 ? '#0e7a8c' : '#cfd6cd'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cxx, y0); ctx.lineTo(cxx, y1); ctx.stroke();
      ctx.fillStyle = on2 ? '#0e7a8c' : '#cfd6cd'; ctx.beginPath(); ctx.arc(cxx, y0, 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cxx, y1, 9, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxx - 9, y1); ctx.lineTo(cxx + 9, y1); ctx.moveTo(cxx, y1 - 9); ctx.lineTo(cxx, y1 + 9); ctx.stroke();
      var bx = w * 0.6, bw = (w * 0.33) / 4, bbot = h * 0.82, bh = h * 0.52, labels = ['00', '01', '10', '11'];
      for (var k = 0; k < 4; k++) { var hh = probs[k] * bh; ctx.fillStyle = '#0e7a8c'; ctx.globalAlpha = 0.22 + probs[k] * 0.7; ctx.fillRect(bx + k * bw, bbot - hh, bw - 6, hh); ctx.globalAlpha = 1; ctx.fillStyle = '#93a0ad'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText('|' + labels[k] + '⟩', bx + k * bw + (bw - 6) / 2, bbot + 14); ctx.textAlign = 'left'; }
      var re = (amp[0][0] + amp[3][0]) / Math.SQRT2, im = (amp[0][1] + amp[3][1]) / Math.SQRT2, F = re * re + im * im;
      ctx.fillStyle = '#16202b'; ctx.font = '600 13px "JetBrains Mono",monospace'; ctx.fillText('fidelity ' + F.toFixed(3), bx, h * 0.16);
      ctx.fillStyle = F > 0.99 ? '#3f7a52' : '#93a0ad'; ctx.font = '9px "JetBrains Mono",monospace'; ctx.fillText(F > 0.99 ? '≥ threshold 0.99' : 'baseline 0.5', bx, h * 0.16 + 13);
    },
    chipQuantum: function (ctx, w, h, t, st, seed) {
      ctx.fillStyle = '#ece9db'; ctx.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3, N = 5 + (seed % 3), nodes = [];
      for (var i = 0; i < N; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; nodes.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }); }
      ctx.strokeStyle = '#c4ccc2'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -(t * 10) % 7;
      for (var j = 0; j < N; j++) { var A = nodes[j], B = nodes[(j + 1) % N]; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); }
      ctx.setLineDash([]);
      var seg = (t * 0.6 + seed) % N, i0 = Math.floor(seg), f = seg - i0, a0 = nodes[i0], b0 = nodes[(i0 + 1) % N];
      ctx.fillStyle = '#0e7a8c'; ctx.beginPath(); ctx.arc(a0.x + (b0.x - a0.x) * f, a0.y + (b0.y - a0.y) * f, 4, 0, 7); ctx.fill();
      nodes.forEach(function (n, i) { var p = 0.5 + 0.5 * Math.sin(t * 2 - i + seed); ctx.fillStyle = '#f6f3ea'; ctx.strokeStyle = '#0e7a8c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(n.x, n.y, 6 + p, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#0e7a8c'; ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, 7); ctx.fill(); });
    },
    chipClassical: function (ctx, w, h, t, st, seed) {
      ctx.fillStyle = '#ece9db'; ctx.fillRect(0, 0, w, h);
      var N = 6, m = Math.min(w, h) * 0.74, cs = m / N, ox = (w - m) / 2, oy = (h - m) / 2;
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var phase = (r + c) / (2 * N), u = ((t * 0.5 + seed * 0.1 - phase) % 1 + 1) % 1, act = u < 0.18 ? u / 0.18 : Math.max(0, 1 - (u - 0.18) / 0.4);
        ctx.fillStyle = 'rgba(14,122,140,' + (0.08 + 0.66 * act) + ')'; ctx.fillRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
        if (act > 0.6) { ctx.fillStyle = '#bd4a30'; ctx.fillRect(ox + c * cs + cs / 2 - 1.5, oy + r * cs + cs / 2 - 1.5, 3, 3); }
        ctx.strokeStyle = '#cfd6cd'; ctx.lineWidth = 1; ctx.strokeRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
      }
    },
    archLLM: function (ctx, w, h, t, st, seed) {
      ctx.fillStyle = '#ece9db'; ctx.fillRect(0, 0, w, h);
      var layers = [3, 5, 5, 3], padX = 24, padY = 18;
      var cols = layers.map(function (n, li) { var x = padX + li * (w - 2 * padX) / (layers.length - 1), ys = []; for (var i = 0; i < n; i++) ys.push({ x: x, y: padY + (i + 0.5) * (h - 2 * padY) / n }); return ys; });
      var wave = (t * 1.1 + seed) % (layers.length + 0.5);
      for (var li = 0; li < cols.length - 1; li++) { var act = Math.max(0, 1 - Math.abs(li + 0.5 - wave)); cols[li].forEach(function (a) { cols[li + 1].forEach(function (b) { ctx.strokeStyle = 'rgba(14,122,140,' + (0.07 + 0.4 * act) + ')'; ctx.lineWidth = 0.6 + 1.3 * act; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }); }); }
      cols.forEach(function (col, li) { var act = Math.max(0, 1 - Math.abs(li - wave)); col.forEach(function (n) { ctx.fillStyle = 'rgba(14,122,140,' + (0.25 + 0.6 * act) + ')'; ctx.beginPath(); ctx.arc(n.x, n.y, 5 + 2 * act, 0, 7); ctx.fill(); ctx.strokeStyle = '#0e7a8c'; ctx.lineWidth = 1; ctx.stroke(); }); });
    },
    bloch: function (ctx, w, h, t, st) {
      ctx.fillStyle = '#f4f1e7'; ctx.fillRect(0, 0, w, h);
      if (!st.init) { st.a0 = [1, 0]; st.a1 = [0, 0]; st.gi = -1; st.from = null; st.to = null; st.ts = 0; st.init = true; }
      var gates = ['H', 'X', 'S', 'H', 'Z', 'T'], period = 1.6, idx = Math.floor(t / period);
      if (idx !== st.gi) { st.gi = idx; st.from = blochVec(st.a0, st.a1); applyGate(st, gates[((idx % gates.length) + gates.length) % gates.length]); st.to = blochVec(st.a0, st.a1); st.ts = idx * period; }
      var lt = Math.min(1, (t - st.ts) / 0.45), e = lt * lt * (3 - 2 * lt);
      var v = (st.from && st.to) ? [st.from[0] + (st.to[0] - st.from[0]) * e, st.from[1] + (st.to[1] - st.from[1]) * e, st.from[2] + (st.to[2] - st.from[2]) * e] : blochVec(st.a0, st.a1);
      var L = Math.hypot(v[0], v[1], v[2]) || 1; v = [v[0] / L, v[1] / L, v[2] / L];
      var cx = w * 0.7, cy = h * 0.5, R = Math.min(h * 0.36, w * 0.22);
      ctx.strokeStyle = '#cfd6cd'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.32, 0, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#dfe3d9'; ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      var sx = cx + R * v[0], sy = cy - R * v[2] + R * 0.32 * v[1];
      ctx.strokeStyle = '#0e7a8c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.fillStyle = '#0e7a8c'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#93a0ad'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.fillText('|0⟩', cx - 7, cy - R - 6); ctx.fillText('|1⟩', cx - 7, cy + R + 15);
      var p0 = st.a0[0] * st.a0[0] + st.a0[1] * st.a0[1], p1 = st.a1[0] * st.a1[0] + st.a1[1] * st.a1[1];
      var bw = 40, bx = w * 0.08, bbot = cy + R, bh = 2 * R;
      ctx.fillStyle = '#0e7a8c'; ctx.globalAlpha = 0.24 + p0 * 0.6; ctx.fillRect(bx, bbot - p0 * bh, bw, p0 * bh); ctx.globalAlpha = 0.24 + p1 * 0.6; ctx.fillRect(bx + bw + 12, bbot - p1 * bh, bw, p1 * bh); ctx.globalAlpha = 1;
      ctx.fillStyle = '#93a0ad'; ctx.textAlign = 'center'; ctx.fillText('|0⟩', bx + bw / 2, bbot + 14); ctx.fillText('|1⟩', bx + bw + 12 + bw / 2, bbot + 14); ctx.textAlign = 'left';
      ctx.fillStyle = '#bd4a30'; ctx.font = '600 14px "JetBrains Mono",monospace'; ctx.fillText('gate ' + gates[((st.gi % gates.length) + gates.length) % gates.length], bx, cy + R + 34);
    },
    attention: function (ctx, w, h, t, st) {
      ctx.fillStyle = '#f4f1e7'; ctx.fillRect(0, 0, w, h);
      var toks = ['The', 'cat', 'that', 'ran', 'was', 'very', 'fast'], N = 7;
      if (!st.W) { var base = [[3, 1, 0, 0, 1, 0, 0], [1, 3, 0, 1, 0, 0, 0], [1, 1, 3, 0, 0, 0, 0], [0, 1, 0, 3, 1, 0, 0], [0, 2, 0, 1, 3, 0, 0], [0, 0, 0, 1, 1, 3, 1], [0, 1, 0, 2, 2, 1, 3]]; st.W = base.map(function (r) { var ex = r.map(function (v) { return Math.exp(v); }), s = ex.reduce(function (a, b) { return a + b; }, 0); return ex.map(function (v) { return v / s; }); }); st.max = st.W.map(function (r) { return Math.max.apply(null, r); }); }
      var hi = Math.floor(t / 1.5) % N, m = Math.min(w - 70, h - 40), cs = m / N, ox = 56, oy = 22;
      ctx.font = '9px "JetBrains Mono",monospace';
      for (var i = 0; i < N; i++) {
        ctx.fillStyle = i === hi ? '#16202b' : '#93a0ad'; ctx.textAlign = 'right'; ctx.fillText(toks[i], ox - 6, oy + i * cs + cs / 2 + 3);
        ctx.save(); ctx.translate(ox + i * cs + cs / 2, oy - 6); ctx.rotate(-Math.PI / 5); ctx.textAlign = 'left'; ctx.fillStyle = '#93a0ad'; ctx.fillText(toks[i], 0, 0); ctx.restore();
      }
      ctx.textAlign = 'left';
      for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) { var av = st.W[a][b] / st.max[a], dim = (a === hi) ? 1 : 0.28; ctx.fillStyle = 'rgba(14,122,140,' + (av * dim) + ')'; ctx.fillRect(ox + b * cs + 1, oy + a * cs + 1, cs - 2, cs - 2); if (a === hi) { ctx.strokeStyle = '#0e7a8c'; ctx.lineWidth = 0.6; ctx.strokeRect(ox + b * cs + 1, oy + a * cs + 1, cs - 2, cs - 2); } }
      ctx.strokeStyle = '#0e7a8c'; ctx.lineWidth = 2; ctx.strokeRect(ox, oy + hi * cs, N * cs, cs);
      ctx.fillStyle = '#93a0ad'; ctx.font = '9px "JetBrains Mono",monospace'; ctx.fillText('illustrative weights · row attends to columns', ox, oy + N * cs + 16);
    },
  };
  function blochVec(a0, a1) { return [2 * (a0[0] * a1[0] + a0[1] * a1[1]), 2 * (a0[0] * a1[1] - a0[1] * a1[0]), (a0[0] * a0[0] + a0[1] * a0[1]) - (a1[0] * a1[0] + a1[1] * a1[1])]; }
  function applyGate(st, g) {
    var a0 = st.a0, a1 = st.a1, s = Math.SQRT1_2;
    if (g === 'H') { st.a0 = [s * (a0[0] + a1[0]), s * (a0[1] + a1[1])]; st.a1 = [s * (a0[0] - a1[0]), s * (a0[1] - a1[1])]; }
    else if (g === 'X') { st.a0 = a1; st.a1 = a0; }
    else if (g === 'Z') { st.a1 = [-a1[0], -a1[1]]; }
    else if (g === 'S') { st.a1 = [-a1[1], a1[0]]; }
    else if (g === 'T') { st.a1 = [a1[0] * s - a1[1] * s, a1[0] * s + a1[1] * s]; }
  }

  // ─────────────────────────── BOOT ───────────────────────────
  var s0 = sectionFromHash(); if (s0) state.section = s0;
  applyAccent();
  render();
  if (!reduce) raf = requestAnimationFrame(loop);
  else { setTimeout(drawAllOnce, 60); setTimeout(drawAllOnce, 240); }
})();
