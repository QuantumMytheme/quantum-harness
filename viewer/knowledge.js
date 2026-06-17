/* QuantumMytheme · knowledge.js — the platform's single source of truth for what
   each problem IS, what a GOOD result looks like, what the judge gates mean, what
   the quality axes mean, and how a recipe's circuit maps onto a chip topology.
   Dependency-free browser global (window.QMKnowledge). Shared by the scoreboard
   (app.js), the recipe builder (lab.js), and the glossary. CSP-safe. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- the four judge gates (every run passes all four to be on the board) ----
  var GATES = [
    ['STRUCTURE', 'the circuit is well-formed — right qubit count, within the depth and 2-qubit-gate budget, native gates on the chip’s wiring'],
    ['REPRODUCIBILITY', 're-simulating the circuit reproduces the number the submission claims — you cannot just type a result'],
    ['PERFORMANCE', 'the recomputed result clears the target AND beats or ties the best classical baseline'],
    ['ANTI-OVERFIT', 'a hidden held-out check the model was never shown — catches a design that gamed only the visible spec']
  ];

  // ---- the five task types: what they are + what "good" means -----------------
  var TASKS = {
    state_prep: { name: 'State preparation', one: 'build one exact quantum state',
      question: 'Can you steer the qubits into a specific target state?',
      given: 'the target state plus a qubit, connectivity, and gate budget',
      metric: 'fidelity — overlap with the target, 0 to 1',
      good: 'fidelity → 1.000 at the fewest entangling gates; typically ≥ 0.99 to pass', teeth: false },
    vqe: { name: 'Ground-state energy · VQE', one: 'find a system’s lowest energy',
      question: 'What is the lowest energy of this Hamiltonian, and a circuit that reaches it?',
      given: 'the Hamiltonian plus circuit budgets',
      metric: 'energy gap to the true ground state E₀ — lower is better',
      good: 'gap → 0 (you cannot beat zero), and it must beat the best classical baseline', teeth: false },
    populations: { name: 'Measurement distribution', one: 'match an outcome distribution — and a hidden check',
      question: 'Can you reproduce a target distribution AND get the unseen physics right?',
      given: 'the visible outcome distribution; a hidden observable is withheld',
      metric: 'the held-out observable matches (e.g. ⟨X₀X₁⟩ = +1)',
      good: 'right distribution AND the held-out check — the right phase, not just the right counts', teeth: true },
    architecture: { name: 'Chip topology', one: 'design a qubit wiring that routes a workload',
      question: 'What connectivity graph routes the needed interactions cheaply — and still works on unseen ones?',
      given: 'a visible workload and a degree/connectivity budget; a second workload is withheld',
      metric: 'routing cost ≤ budget on both the visible and the held-out workload',
      good: 'a topology that generalizes — a ring beats a path overfit to the visible pairs', teeth: true },
    classify: { name: 'Quantum classifier', one: 'a feature map that generalizes',
      question: 'Can a quantum feature map separate the classes on data it never saw?',
      given: 'a training set; the test set is withheld',
      metric: 'held-out test accuracy',
      good: 'high TEST accuracy — a low-frequency map generalizes, a high-frequency one overfits', teeth: true }
  };

  // ---- the worked problems: the actual question + what good looks like ---------
  var PROBLEMS = {
    ghz3: { task: 'state_prep', n: 3, title: 'GHZ₃ state',
      question: 'Prepare the 3-qubit GHZ state (|000⟩+|111⟩)/√2 on a linear 0–1–2 chip.',
      given: 'the target state, depth ≤ 6, native gates, the 0-1-2 coupling map',
      goal: 'fidelity ≥ 0.99', baseline: '0.5 (best product state)',
      good: 'fidelity 1.000 at two entangling gates — provably optimal', best: 'fid 1.000 · 2q 2 · depth 3' },
    isingbell2: { task: 'vqe', n: 2, title: 'Ising-Bell ground state',
      question: 'Find the ground state of H = −X₀X₁ − Z₀Z₁ (E₀ = −2).',
      given: 'the Hamiltonian and circuit budgets',
      goal: 'energy gap ≤ 0.05', baseline: '−1 (best product state)',
      good: 'gap 0.000 — the Bell state is exactly the ground state', best: 'gap 0.000 · 2q 1' },
    bell_pops2: { task: 'populations', n: 2, title: 'Bell populations · held-out phase',
      question: 'Prepare a state with 50/50 |00⟩,|11⟩ populations — the relative phase is held out.',
      given: 'the Z-basis populations; ⟨X₀X₁⟩ is withheld',
      goal: 'held-out ⟨X₀X₁⟩ = +1', baseline: 'wrong-phase |Φ⁻⟩ matches counts but fails',
      good: 'right populations AND the held-out parity → the true |Φ⁺⟩', best: '⟨X₀X₁⟩ +1.00 · 2q 1' },
    aiaccel4: { task: 'architecture', n: 4, title: 'AI-accelerator routing',
      question: 'Design a 4-qubit coupling map (degree ≤ 2) routing the interactions cheaply — a second workload is held out.',
      given: 'visible workload [[0,1],[2,3]], budget 2; held-out [[0,3],[1,2]]',
      goal: 'routing cost ≤ 2 on both', baseline: '4 (linear chain)',
      good: 'a ring routes both at cost 2; a path overfits and fails the held-out workload', best: 'cost 2 · ring · deg 2' },
    qml_sign1: { task: 'classify', n: 1, title: 'Sign feature map',
      question: 'Build a feature map that classifies sign(sin x) — the test set is held out.',
      given: 'a training set; the test set is withheld',
      goal: 'held-out test accuracy ≥ 0.99', baseline: 'high-freq Ry(7x) memorizes train, fails test',
      good: 'low-frequency Ry(x) generalizes to 100% on the test set', best: 'test 100% · 1 op · 1 qubit' },
    h2vqe: { task: 'vqe', n: 2, title: 'H₂ molecule · VQE',
      question: 'Find the ground-state energy of H₂ (STO-3G), E₀ = −1.8512 Ha.',
      given: 'the molecular Hamiltonian and budgets',
      goal: 'energy gap ≤ 0.005 Ha', baseline: '−1.8302 (mean-field)',
      good: 'gap → 0 — recover the correlation energy past mean-field', best: 'gap 0.0004 Ha · 2q 1' },
    tfim3: { task: 'vqe', n: 3, title: 'Transverse-field Ising · TFIM₃',
      question: 'Find the ground state of a 3-qubit transverse-field Ising model, E₀ = −3.009.',
      given: 'the Hamiltonian and budgets',
      goal: 'energy gap ≤ 0.05', baseline: '−2.72',
      good: 'gap → 0 — two paradigms compete: QAOA (deeper, best gap) vs hardware-efficient (leaner, hardware-validated)', best: 'gap 0.0001 (QAOA) · gap 0.0143 + hardware (HWE)' },
    bellnoisy2: { task: 'state_prep', n: 2, title: 'Bell on a noisy device',
      question: 'Prepare a Bell state AND predict its on-device fidelity under depolarizing noise.',
      given: 'the target plus a stated noise budget; predict the noisy fidelity',
      goal: 'predicted noisy fidelity ≥ 0.90', baseline: 'ideal 1.0 vs noisy ≈ 0.916',
      good: 'a correct, re-verifiable noisy prediction — not an inflated claim', best: 'noisy fid 0.916 (predicted, re-derived)' }
  };

  // ---- the five quality axes (mirror the formulas in scoreboard/build.mjs) -----
  var QUALITY_AXES = [
    ['correctness', 'Correctness', 'passed all four judge gates — the price of being on the board'],
    ['margin', 'Margin', 'how far the verified result clears the bar, toward the ideal'],
    ['efficiency', 'Efficiency', 'circuit / topology economy — fewer 2-qubit gates and depth (for architecture: edges beyond a spanning tree; for classify: feature-map ops + qubits)'],
    ['robustness', 'Robustness', 'verification depth — a real held-out gate and/or a hardware overlay'],
    ['novelty', 'Novelty', 'a distinct approach that adds new knowledge, vs a near-duplicate']
  ];
  var GRADE_NOTE = 'Rank is the single verified primary metric — the leaderboard. Grade is a holistic profile, so a leaner or hardware-validated design can out-grade a run with a slightly better raw number.';

  function gradeColor(grade) {
    var g = (grade || '')[0];
    return g === 'A' ? 'var(--pass)' : g === 'B' ? 'var(--accent)' : g === 'C' ? '#c4880c' : 'var(--reject)';
  }

  // compact profile badge for a table cell: grade pill + 5 mini bars
  function profileBadge(q) {
    if (!q) return '';
    var col = gradeColor(q.grade), bars = QUALITY_AXES.map(function (a) {
      var v = q[a[0]] == null ? 0 : q[a[0]];
      return '<span class="qbar" title="' + esc(a[1]) + ' ' + Math.round(v * 100) + '% — ' + esc(a[2]) + '"><i style="height:' + Math.max(8, v * 100) + '%"></i></span>';
    }).join('');
    return '<span class="qual" title="' + esc(GRADE_NOTE) + '"><span class="qual-grade" style="color:' + col + ';border-color:' + col + '">' + esc(q.grade) + '</span><span class="qual-bars">' + bars + '</span></span>';
  }
  // expanded labelled breakdown (for the problem card / row detail)
  function profileDetail(q) {
    if (!q) return '';
    return '<div class="qprof">' + QUALITY_AXES.map(function (a) {
      var v = q[a[0]] == null ? 0 : q[a[0]], pct = Math.round(v * 100);
      return '<div class="qrow"><span class="qk">' + esc(a[1]) + '</span><span class="qtrack"><i style="width:' + pct + '%"></i></span><span class="qv">' + pct + '</span></div>';
    }).join('') + '<p class="qnote">' + esc(GRADE_NOTE) + '</p></div>';
  }

  function taskOne(task) { var t = TASKS[task]; return t ? t.one : task; }
  function taskChip(task, extra) {
    var t = TASKS[task];
    return '<span class="tk" data-task="' + esc(task) + '" title="' + esc(t ? t.name + ' — ' + t.one : task) + '">' + esc(task) + (extra ? '' : '') + '</span>';
  }

  // a full problem card: what it is, what a good result looks like, current best
  function problemCard(id, q) {
    var p = PROBLEMS[id]; if (!p) return '';
    var t = TASKS[p.task] || {};
    return '<div class="pcard">' +
      '<div class="pcard-h"><span class="tk2" style="border-color:' + taskColor(p.task) + ';color:' + taskColor(p.task) + '">' + esc(p.task) + '</span>' +
        '<h4>' + esc(p.title) + '</h4></div>' +
      '<p class="pq">' + esc(p.question) + '</p>' +
      '<dl class="pdl">' +
        row('the task', t.name + ' — ' + (t.one || '')) +
        row('the model gets', p.given) +
        row('success metric', t.metric || '') +
        row('target', p.goal + (p.baseline ? '  ·  baseline ' + p.baseline : '')) +
        row('what “good” looks like', p.good) +
        (p.best ? row('current best', p.best) : '') +
      '</dl>' + (q ? profileDetail(q) : '') + '</div>';
    function row(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
  }
  var TASK_HUE = { state_prep: 210, vqe: 162, populations: 40, architecture: 280, classify: 330 };
  function taskColor(task) { var h = TASK_HUE[task]; return h == null ? 210 : 'hsl(' + h + ',58%,45%)'; }

  // ---- the design schematic: derive a circuit + a chip topology from a recipe --
  // entanglement pattern over n qubits -> the 2-qubit-gate pairs (couplers)
  function pairs(n, entangle) {
    var ps = [], i;
    if (entangle === 'all') { for (i = 0; i < n; i++) for (var j = i + 1; j < n; j++) ps.push([i, j]); }
    else { for (i = 0; i < n - 1; i++) ps.push([i, i + 1]); if (entangle === 'ring' && n > 2) ps.push([n - 1, 0]); }
    return ps;
  }
  // a representative hardware-efficient ansatz as drawable columns
  function buildAnsatz(target, depth, entangle) {
    var p = PROBLEMS[target], n = p ? p.n : 3, ps = pairs(n, entangle);
    var cols = [{ type: 'init', gate: 'H', qubits: range(n) }];
    var rot = (target === 'h2vqe' || target === 'ghz3') ? 'Ry' : 'Rz';
    for (var d = 0; d < depth; d++) { cols.push({ type: 'cx', pairs: ps.slice() }); cols.push({ type: 'rot', gate: rot, qubits: range(n) }); }
    return { n: n, depth: depth, twoq: ps.length * depth, couplers: ps, cols: cols, rot: rot };
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  // chip coupling-map: node positions + active couplers + the hardware it fits
  function couplingMap(n, entangle) {
    var nodes = [], i;
    for (i = 0; i < n; i++) { var an = -Math.PI / 2 + i / n * Math.PI * 2; nodes.push({ i: i, x: Math.cos(an), y: Math.sin(an) }); }
    var edges = pairs(n, entangle);
    var fits = entangle === 'all'
      ? { name: 'all-to-all', hw: 'trapped-ion · neutral-atom', why: 'any qubit can talk to any other — natural on trapped-ion and neutral-atom machines, expensive to emulate on a fixed superconducting grid' }
      : entangle === 'ring'
        ? { name: 'ring / cycle', hw: 'superconducting · heavy-hex', why: 'every qubit couples to two neighbours in a loop — a good match for fixed 2-D superconducting wiring (heavy-hex, grid)' }
        : { name: 'linear chain', hw: 'superconducting · linear', why: 'a simple line of fixed nearest-neighbour couplers — the easiest pattern to build on superconducting hardware' };
    return { nodes: nodes, edges: edges, fits: fits, degree: maxDegree(n, edges) };
  }
  function maxDegree(n, edges) { var d = new Array(n).fill(0); edges.forEach(function (e) { d[e[0]]++; d[e[1]]++; }); return Math.max.apply(null, d.concat([0])); }

  window.QMKnowledge = {
    GATES: GATES, TASKS: TASKS, PROBLEMS: PROBLEMS, QUALITY_AXES: QUALITY_AXES, GRADE_NOTE: GRADE_NOTE,
    esc: esc, gradeColor: gradeColor, taskColor: taskColor,
    profileBadge: profileBadge, profileDetail: profileDetail,
    taskOne: taskOne, taskChip: taskChip, problemCard: problemCard,
    buildAnsatz: buildAnsatz, couplingMap: couplingMap
  };
})();
