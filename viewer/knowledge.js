/* QuantumMytheme · knowledge.js — the bench's source of truth for what each problem
   IS, what a GOOD result looks like, what the judge gates mean, what the quality axes
   mean, and how a recipe's circuit maps onto a chip topology. The bench is the
   verifiable-quantum-design wedge of a broader verifiable-efficiency referee; the
   efficiency-frontier map (and where quantum does and doesn't fit) lives in /education
   (Part V, the North Star). Note: the "efficiency" quality axis here is circuit economy
   (gates/depth), NOT the platform-wide efficiency thesis. Dependency-free browser global
   (window.QMKnowledge). Shared by the scoreboard (app.js), the recipe builder (lab.js),
   and the glossary. CSP-safe. */
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
      good: 'high TEST accuracy — a low-frequency map generalizes, a high-frequency one overfits', teeth: true },
    kernel: { name: 'Fidelity kernel', one: 'a state-overlap similarity measure between two points',
      question: 'Does your encoding actually distinguish near points from far points — or does it ignore its input?',
      given: 'a visible near-pair (must read as similar); a held-out far-pair is withheld',
      metric: 'overlap |<phi(x)|phi(y)>|^2 between the two independently re-simulated encoded states',
      good: 'high kernel on the near pair AND low kernel on the held-out far pair — a constant map that ignores its input fails the held-out check', teeth: true }
  };

  // ---- the worked problems: the actual question + what good looks like ---------
  var PROBLEMS = {
    ghz3: { task: 'state_prep', n: 3, title: 'GHZ₃ state',
      question: 'Prepare the 3-qubit GHZ state (|000⟩+|111⟩)/√2 on a linear 0–1–2 chip.',
      given: 'the target state, depth ≤ 6, native gates, the 0-1-2 coupling map',
      goal: 'fidelity ≥ 0.99', baseline: '0.5 (best product state)',
      good: 'fidelity 1.000 at two entangling gates — provably optimal', best: 'fid 1.000 · 2q 2 · depth 3' },
    ghz3_he: { task: 'state_prep', n: 3, title: 'GHZ₃ · hardware-efficient',
      question: 'Prepare the same 3-qubit GHZ state using ONLY the native gates {rz, rx, cz} — decompose h and cx yourself.',
      given: 'the target state, native set {rz, rx, cz}, depth ≤ 12, the 0-1-2 coupling map',
      goal: 'fidelity ≥ 0.99 with zero non-native gates', baseline: '0.5 (best product state)',
      good: 'h = rz·rx·rz and cx = (I⊗H)·cz·(I⊗H) up to global phase — fidelity 1.000 at 2 cz', best: 'fid 1.000 · 2q 2 · depth 11' },
    ghz5_line: { task: 'state_prep', n: 5, title: 'GHZ₅ · linear chain',
      question: 'Prepare the 5-qubit GHZ state (|00000⟩+|11111⟩)/√2 on a linear 0–1–2–3–4 chip.',
      given: 'the target state, the sparse line coupling map (pinned host-side), 2q budget 4',
      goal: 'fidelity ≥ 0.99 with every 2q gate on a coupled pair', baseline: '0.5 (best product state)',
      good: 'the cascade h q0; cx 0-1, 1-2, 2-3, 3-4 — a direct cx 0,4 shortcut is rejected', best: 'fid 1.000 · 2q 4 · depth 5' },
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
      question: 'Find the electronic ground-state energy of H₂’s reduced 2-qubit Hamiltonian (STO-3G; nuclear repulsion excluded), E₀ = −1.8512 Ha.',
      given: 'the molecular (electronic, 2-qubit) Hamiltonian and budgets',
      goal: 'energy gap ≤ 0.005 Ha', baseline: '−1.8302 (mean-field)',
      good: 'gap → 0 — recover the correlation energy past mean-field', best: 'gap 0.0004 Ha · 2q 1' },
    mol4: { task: 'vqe', n: 4, title: 'Mol4 · 4-qubit ring VQE',
      question: 'Find the ground state of a 4-qubit ring TFIM + next-nearest-neighbor ZZ Hamiltonian (a numerically-defined, H₂-style molecular headroom problem), E₀ = −5.2311.',
      given: 'the Hamiltonian (conceptually) and circuit budgets',
      goal: 'energy gap ≤ 0.02', baseline: '−5.1565 (mean-field product state)',
      good: 'a 3-RY-layer, 2-CX-ring ansatz reaches gap 0.0105 — past the 0.0746 mean-field gap into genuine ring-correlation energy', best: 'gap 0.0105 · 2q 8 · depth 11' },
    tfim3: { task: 'vqe', n: 3, title: 'Transverse-field Ising · TFIM₃',
      question: 'Find the ground state of a 3-qubit transverse-field Ising model, E₀ = −3.009.',
      given: 'the Hamiltonian and budgets',
      goal: 'energy gap ≤ 0.05', baseline: '−2.72',
      good: 'gap → 0 — two paradigms compete: QAOA (deeper, best gap) vs hardware-efficient (leaner, with an emulated-noise overlay)', best: 'gap 0.0001 (QAOA) · gap 0.0143 + emulated-noise overlay (HWE)' },
    bellnoisy2: { task: 'state_prep', n: 2, title: 'Bell on a noisy device',
      question: 'Prepare a Bell state AND predict its on-device fidelity under depolarizing noise.',
      given: 'the target plus a stated noise budget; predict the noisy fidelity',
      goal: 'predicted noisy fidelity ≥ 0.90', baseline: 'ideal 1.0 vs noisy ≈ 0.916',
      good: 'a correct, re-verifiable noisy prediction — not an inflated claim', best: 'noisy fid 0.916 (predicted, re-derived)' },
    kernel2: { task: 'kernel', n: 2, title: 'Fidelity kernel · held-out far pair',
      question: 'Build a 2-feature angle-encoding map whose overlap kernel calls a near pair similar — a far pair is held out.',
      given: 'a visible near-pair (kernel ≥ 0.9 required); a held-out far-pair is withheld (kernel ≤ 0.1 required)',
      goal: 'held-out kernel ≤ 0.1 while the visible kernel ≥ 0.9', baseline: 'input-ignoring map (scale 0) scores kernel 1.0 on both — passes the visible pair by accident, fails the held-out one',
      good: 'per-feature Ry(x_i) genuinely separates near (kernel 0.999) from far (kernel 0.003) — no ancilla/SWAP-test register needed', best: 'near 0.999 · far 0.003 · 2 ops · 2 qubits' }
  };

  // ---- the five quality axes (mirror the formulas in scoreboard/build.mjs) -----
  var QUALITY_AXES = [
    ['correctness', 'Correctness', 'passed all four judge gates — the price of being on the board'],
    ['margin', 'Margin', 'how far the verified result clears the bar, toward the ideal'],
    ['efficiency', 'Efficiency', 'circuit / topology economy — fewer 2-qubit gates and depth (for architecture: edges beyond a spanning tree; for classify: feature-map ops + qubits)'],
    ['robustness', 'Robustness', 'verification depth — a real held-out gate and/or a hardware overlay (real-device or emulated, as labelled)'],
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
  var TASK_HUE = { state_prep: 210, vqe: 162, populations: 40, architecture: 280, classify: 330, kernel: 20 };
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

  // ---- Scenario Studio: given the hardware you HAVE, the honest best-architecture allocation.
  // Numbers + sources are consistent with /education Part V (the North Star). The load-bearing
  // honesty: (a) transformers are the MOST-USED GPU workload but NOT the best possible architecture;
  // (b) a quantum chip does NOT accelerate transformer inference — its honest role is quantum
  // simulation (materials -> better classical chips), fault-tolerant and a decade-plus out.
  var SUBSTRATES = {
    cpu: { name: 'CPU', tag: 'latency-optimized, branchy',
      good: 'orchestration & control flow, tokenization, sampling, sparse/irregular ops, serving glue, data prep',
      weak: 'not the matmul engine — low dense-linear-algebra throughput per watt',
      note: 'huge cache, few fast cores — great at the glue, wrong tool for the bulk matmuls' },
    gpu: { name: 'GPU', tag: 'massively-parallel SIMT',
      good: 'training, large-batch inference, prefill, irregular/dynamic parallelism, flexible matmul — the ecosystem default',
      weak: 'higher power; its flexibility costs efficiency vs a systolic array on regular dense matmul',
      note: 'the incumbent for transformer inference — why "classic GPU inference" ≈ transformers today' },
    tpu: { name: 'TPU', tag: 'sequential + wide systolic MXU',
      good: 'large REGULAR dense matmuls kept VMEM-resident; best perf/W when the shape fills the 128×128 MXU and clears the ridge',
      weak: 'sequential + irregular/branchy work maps poorly; needs tile-aligned shapes',
      fact: 'roofline ridge ~240 ops/byte (v5e); VMEM-resident drops it to ~11; int8 ~2× peak',
      src: '/education Part V · roofline',
      note: 'wins the dense matmul when the workload fits it — otherwise the GPU is more forgiving' },
    qpu: { name: 'Quantum chip', tag: 'simulation co-processor — NOT an accelerator',
      good: 'simulating strongly-correlated quantum systems (chemistry/materials → better catalysts and classical chips)',
      weak: 'does NOT accelerate LLM/transformer inference: the O(N) data read-in wall, costly read-out (an amplitude-encoded answer takes repeated sampling to extract — up to O(N)), dequantization, and barren plateaus close that door',
      fact: 'a catalyst like FeMoco needs ~4M physical qubits, fault-tolerant — 10–20 yr out',
      src: '/education Part V · quantum-lever · Aaronson 2015 · Tang 2018',
      note: 'the honest lever for BETTER CLASSICAL CHIPS, not for running today’s models faster' }
  };

  var ROLE_LABEL = {
    'matmul-dense': 'dense matmul engine', 'matmul-flex': 'matmul engine (flexible)',
    'orchestrate': 'orchestration & control', 'support': 'prefill / irregular / overflow',
    'quantum-sim': 'quantum-simulation co-processor', 'quantum-engine': 'quantum engine (the genuine workload)',
    'verify': 'classical simulation / verification', 'idle': 'no role in this workload'
  };

  // What a quantum chip is GENUINELY for — the honest answer to "not ML acceleration, so what?"
  // A special-purpose engine that earns its place only where the classical cost is exponential.
  var QUANTUM_USES = [
    { key: 'simulation', name: 'Simulating quantum systems', maturity: 'the flagship — small instances today, hard cases fault-tolerant (10–20 yr)',
      what: 'Chemistry & materials whose classical cost is 2ⁿ: catalysts (nitrogen fixation / FeMoco), battery electrolytes, high-Tc superconductors — and the materials for better classical chips.',
      demonstrates: 'This IS what the bench’s VQE tasks are — h2vqe (a molecule’s electronic ground-state energy), isingbell2 / tfim3 (condensed-matter models).',
      src: 'Feynman 1982 · FeMoco ~4M physical qubits (resource estimates)' },
    { key: 'cryptanalysis', name: 'Breaking today’s public-key crypto', maturity: 'real but far — ~millions of physical qubits, a decade+',
      what: 'Shor’s algorithm factors integers / solves discrete-log in polynomial time → breaks RSA and elliptic-curve crypto. The impact is NOW: it is why the world is migrating to post-quantum cryptography (NIST ML-KEM / ML-DSA).',
      demonstrates: 'The /education RSA→Shor slice runs the bridge live.',
      src: 'Shor 1994 · Gidney–Ekerå 2021 · NIST PQC 2024' },
    { key: 'randomness', name: 'Certified / verifiable randomness', maturity: 'a demonstrated near-term niche',
      what: 'Random-circuit sampling yields entropy a third party can certify was genuinely quantum — a randomness beacon no classical box can fake.',
      demonstrates: 'The TPU XEB-Referee (docs/roadmap/TPU-NATIVE-ARCHITECTURES.md) is the classical verifier for exactly this.',
      src: 'Aaronson certified randomness · Google RCS 2023/2025' },
    { key: 'optimization', name: 'Optimization & sampling', maturity: 'caveat — no broadly-proven advantage',
      what: 'QAOA / annealing for combinatorial problems, and quantum-advantage sampling as a benchmark of raw quantum power. Treat any speedup claim as unproven until it clears a referee at iso-quality.',
      demonstrates: 'The bench’s tfim3 QAOA run is a verifiable instance; the honesty gate is the point.',
      src: 'Farhi 2014 (QAOA) · dequantization (Tang 2018)' }
  ];

  // Real, known chips — so the public experiments with actual hardware, not abstract classes.
  // Each maps to a substrate class {cpu,gpu,tpu,qpu}. Specs are vendor-quoted / widely-cited
  // context; the Roofline Notary pins per-chip constants for six TPU generations
  // (v5e, v5p, v6e, Ironwood/TPU7x, 8t, 8i — see bench/kernel-judge/judge_kernel.py PINNED),
  // marked pinned:true below. Everything else is vendor-quoted, not referee-pinned — labelled so.
  var CHIPS = [
    { id: 'epyc', name: 'AMD EPYC (Turin)', cls: 'cpu', spec: 'up to 192 cores · big L3 · AVX-512', note: 'orchestration, retrieval, sparse/branchy work', src: 'AMD' },
    { id: 'xeon', name: 'Intel Xeon (Emerald Rapids)', cls: 'cpu', spec: 'AMX matrix tiles · bf16/int8', note: 'CPU with a small matrix unit — glue + light inference', src: 'Intel' },
    { id: 'graviton', name: 'AWS Graviton4 (Arm)', cls: 'cpu', spec: '96 cores · cloud-efficient', note: 'serving + orchestration at low power', src: 'AWS' },
    { id: 'apple-m', name: 'Apple M-series', cls: 'cpu', spec: 'unified memory · on-device NPU', note: 'on-device inference + glue', src: 'Apple' },
    { id: 'h100', name: 'NVIDIA H100', cls: 'gpu', spec: '~990 TFLOP/s bf16 dense · 80GB HBM3 ~3.35 TB/s', note: 'the training/inference workhorse', src: 'NVIDIA (vendor)' },
    { id: 'a100', name: 'NVIDIA A100', cls: 'gpu', spec: '~312 TFLOP/s bf16 · 80GB HBM2e ~2 TB/s', note: 'prior-gen workhorse', src: 'NVIDIA (vendor)' },
    { id: 'b200', name: 'NVIDIA B200 (Blackwell)', cls: 'gpu', spec: '~2.2 PFLOP/s bf16 dense · 192GB HBM3e ~8 TB/s', note: 'current flagship', src: 'NVIDIA (vendor)' },
    { id: 'mi300x', name: 'AMD MI300X', cls: 'gpu', spec: '~1.3 PFLOP/s bf16 · 192GB HBM3 ~5.3 TB/s', note: 'large-memory accelerator', src: 'AMD (vendor)' },
    { id: 'groq', name: 'Groq LPU', cls: 'gpu', spec: 'SRAM-only · deterministic · ultra-low latency', note: 'specialized inference — latency, not batch', src: 'Groq' },
    { id: 'cerebras', name: 'Cerebras WSE-3', cls: 'gpu', spec: 'wafer-scale · ~900k cores · ~44GB on-chip SRAM', note: 'weights on-chip — no HBM wall if the model fits', src: 'Cerebras' },
    { id: 'tpu-v5e', name: 'Google TPU v5e', cls: 'tpu', spec: '~197 TFLOP/s bf16 · HBM ~0.82 TB/s · ridge ~240 ops/byte', note: 'the generation the Roofline Notary PINS (verified)', src: '/education Part V', pinned: true },
    { id: 'tpu-v5p', name: 'Google TPU v5p', cls: 'tpu', spec: '459 TFLOP/s bf16 · HBM ~2.77 TB/s · 128×128 MXU · ridge ~166', note: 'high-end training TPU — pinned in the referee', src: 'Google Cloud · scaling-book', pinned: true },
    { id: 'tpu-v6e', name: 'Google TPU v6e (Trillium)', cls: 'tpu', spec: '918 TFLOP/s bf16 · HBM ~1.64 TB/s · 256×256 MXU · ridge ~560', note: 'current-gen TPU — pinned in the referee', src: 'Google Cloud · scaling-book', pinned: true },
    { id: 'ironwood', name: 'Google Ironwood (TPU v7 / TPU7x)', cls: 'tpu', spec: '~2.3 PFLOP/s bf16 · int8 ~4.6 POP/s · HBM 192GB ~7.4 TB/s · 256×256 MXU · ridge ~311', note: '7th-gen — pinned in the referee', src: 'scaling-book · Google · Ironwood', pinned: true },
    { id: 'tpu-8t', name: 'Google TPU 8t (8th-gen · training)', cls: 'tpu', spec: '12.6 PFLOP/s FP4 · HBM 216GB ~6.53 TB/s · 128 MB VMEM · SparseCore + LLM-Decoder', note: '8th-gen “agentic era” — pinned for FP4 (bf16 peak + MXU not disclosed)', src: 'Google Cloud deep-dive 2025', pinned: true },
    { id: 'tpu-8i', name: 'Google TPU 8i (8th-gen · inference)', cls: 'tpu', spec: '10.1 PFLOP/s FP4 · HBM 288GB ~8.6 TB/s · 384 MB VMEM · Collectives-Accel Engine', note: '8th-gen inference — pinned for FP4 (bf16 peak + MXU not disclosed)', src: 'Google Cloud deep-dive 2025', pinned: true },
    { id: 'willow', name: 'Google Willow', cls: 'qpu', spec: '105 superconducting qubits · below-threshold QEC', note: 'error-correction milestone (2024)', src: 'Google 2024' },
    { id: 'ibm-heron', name: 'IBM Heron r2', cls: 'qpu', spec: '156 superconducting qubits', note: 'utility-scale superconducting', src: 'IBM 2024' },
    { id: 'quantinuum-h2', name: 'Quantinuum H2', cls: 'qpu', spec: '56 trapped-ion qubits · very high fidelity', note: 'trapped-ion, all-to-all', src: 'Quantinuum 2024' },
    { id: 'atom', name: 'Atom Computing', cls: 'qpu', spec: '1000+ neutral-atom qubits', note: 'neutral-atom scale', src: 'Atom 2023' },
    { id: 'ionq', name: 'IonQ Forte', cls: 'qpu', spec: 'trapped-ion · ~36 algorithmic qubits', note: 'trapped-ion', src: 'IonQ' }
  ];
  // Real TPU pods — for the "pretend you have Google's largest chip farm" what-if. Aspirational,
  // NOT something a visitor actually has; ExaFLOPS are vendor peak (mixed precision).
  // pinned:true here means the pod's PER-CHIP constants are referee-pinned (lab.js renders it
  // as "per-chip pinned"); pod-scale totals (chips/exaflops/HBM) are vendor-quoted, never refereed.
  var PODS = [
    { id: '8t-virgo', name: 'TPU 8t · Virgo cluster', cls: 'tpu', chips: 134000, exaflops: 1700, hbm: '~28 PB', note: 'Google’s LARGEST — the Virgo network links 134,000+ 8t chips (47 Pb/s bisectional), scaling toward 1M+ in a single cluster', src: 'Google Cloud deep-dive 2025', pinned: true },
    { id: '8t-superpod', name: 'TPU 8t superpod', cls: 'tpu', chips: 9600, exaflops: 121, hbm: '2 PB', note: 'a single 8th-gen “agentic era” training superpod', src: 'Google Cloud deep-dive 2025', pinned: true },
    { id: 'ironwood-pod', name: 'Ironwood (v7) superpod', cls: 'tpu', chips: 9216, exaflops: 42.5, hbm: '~1.77 PB', note: '7th-gen superpod (per-chip pinned in the referee)', src: 'Google 2025', pinned: true },
    { id: 'v5p-pod', name: 'TPU v5p pod', cls: 'tpu', chips: 8960, exaflops: 4.1, hbm: '~840 TB', note: '8,960-chip v5p pod (bf16 peak)', src: 'Google', pinned: true }
  ];
  function pod(id) { for (var i = 0; i < PODS.length; i++) if (PODS[i].id === id) return PODS[i]; return null; }
  function chipsByClass() { var g = { cpu: [], gpu: [], tpu: [], qpu: [] }; CHIPS.forEach(function (c) { (g[c.cls] || (g[c.cls] = [])).push(c); }); return g; }
  function chip(id) { for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i].id === id) return CHIPS[i]; return null; }
  function haveFromChips(chips) { var h = {}; CHIPS.forEach(function (c) { if (chips && chips[c.id]) h[c.cls] = true; }); return h; }

  // engine = preference order among matmul substrates for this workload; quantum = 'none'|'genuine'.
  var WORKLOADS = {
    'transformer-infer': { name: 'Transformer inference', kind: 'ml', dominant: true, engine: ['tpu', 'gpu'], quantum: 'none',
      note: 'The most-used classical GPU workload today. Decode is MEMORY-bound (batch-1 arithmetic intensity ~1–2 ops/byte, far left of the ~240 ridge) — bandwidth-bound, so the matmul array idles between weight loads.',
      incumbent: 'A dense transformer is the incumbent — chosen by ecosystem momentum, not proven optimal.',
      better: ['Sparse MoE — ~18× fewer active FLOPs/token (DeepSeek-V3)', 'SSM / Mamba hybrid — ~3.3× (IBM Granite 4.0); cuts latency, not energy/token', 'Quantization INT4/8 — ~6× memory (arXiv:2411.02355)', 'Speculative decoding — ~2.2× latency (EAGLE-3)'] },
    'transformer-train': { name: 'Transformer training', kind: 'ml', engine: ['tpu', 'gpu'], quantum: 'none',
      note: 'Large regular matmuls at high batch — compute-bound and a good fit for a systolic array, but the GPU’s flexibility helps with dynamic shapes and research iteration.',
      incumbent: 'Dense transformer pretraining is the default — expensive and not obviously optimal.',
      better: ['Sparse-MoE pretraining — train more capacity per FLOP', 'Distillation — ~10× cheaper inference downstream (Gemma 2)', 'Mixture-of-Depths — ~2× FLOPs (arXiv:2404.02258)'] },
    'moe-infer': { name: 'Sparse-MoE inference', kind: 'ml', engine: ['tpu', 'gpu'], quantum: 'none',
      note: 'Only a few experts fire per token — routing is dynamic/irregular. Intensity still lives left of the ridge at low batch; batching across tokens is what actually crosses it.',
      incumbent: 'MoE already beats a dense transformer on active-FLOPs — a better architecture, verifiably.',
      better: ['Expert batching to raise arithmetic intensity', 'Int4 weight-only for the resident expert bank', 'A referee-verified MoE-vs-dense energy/token comparison'] },
    'ssm-infer': { name: 'SSM / state-space inference', kind: 'ml', engine: ['tpu', 'gpu'], quantum: 'none',
      note: 'A recurrent O(1)-state scan — cuts latency vs attention, but the data-dependent gating is VPU-heavy, not pure matmul. Honest: it cuts latency, not necessarily energy/token.',
      incumbent: 'An SSM/hybrid is a candidate BETTER-than-transformer architecture — but the win must be proven, not assumed.',
      better: ['Pin the state dim to the MXU width (128/256)', 'Hybrid attention+SSM for recall + throughput', 'Prove the iso-quality tokens/s vs a tuned transformer in the referee'] },
    'diffusion-infer': { name: 'Image / diffusion inference', kind: 'ml', engine: ['gpu', 'tpu'], quantum: 'none',
      note: 'Iterative denoising — many forward passes through a U-Net/DiT. Compute-heavy per step at batch, memory-bound at low batch; the step count, not the chip, dominates cost.',
      incumbent: 'A transformer/U-Net backbone run for many steps is the norm — the step count is the real inefficiency, not obviously optimal.',
      better: ['Consistency / distilled few-step models — cut steps 10–50×', 'Latent-space compute (smaller resolution)', 'Quantization INT4/8 of the backbone'] },
    'finetune-lora': { name: 'Fine-tuning / LoRA', kind: 'ml', engine: ['gpu', 'tpu'], quantum: 'none',
      note: 'Low-rank adapters over a frozen base — the cost is the base model’s forward/backward matmuls; GPU flexibility helps research iteration, TPU wins the big regular matmuls at scale.',
      incumbent: 'Full fine-tuning is wasteful; LoRA/PEFT is already a better-than-full approach — the question is how much further.',
      better: ['QLoRA — int4 frozen base, ~6× memory', 'Adapter merging / multi-task LoRA', 'Distill the fine-tune into a smaller base'] },
    'rag-serving': { name: 'Retrieval-augmented serving', kind: 'ml', engine: ['gpu', 'tpu'], quantum: 'none',
      note: 'A vector search (CPU/GPU) feeds a smaller model’s forward pass — retrieval shrinks the model you must run at all. The CPU does the index + orchestration; the accelerator runs the (smaller) model.',
      incumbent: 'Bolting RAG onto a large model is common; a trained-retrieval smaller model is the more efficient design.',
      better: ['RETRO-style trained retrieval — ~25× (arXiv:2112.04426)', 'A smaller model + a better index', 'KV / prefix cache across requests'] },
    'materials-sim': { name: 'Materials / chemistry simulation', kind: 'science', engine: ['tpu', 'gpu'], quantum: 'genuine',
      note: 'The ONE place a quantum chip is the honest lever: strongly-correlated systems whose classical cost is 2ⁿ. Today you approximate them classically (tensor-network contraction) on TPU/GPU; a fault-tolerant QPU is the future engine.',
      incumbent: 'Classical tensor-network / DFT approximations are the incumbent — a real QPU would surpass them, a decade-plus out.',
      better: ['Tensor-network contraction on the MXU today', 'A QPU co-processor for the exact-correlation core (fault-tolerant, 10–20 yr)'] },
    'combinatorial-opt': { name: 'Combinatorial optimization', kind: 'science', engine: ['gpu', 'tpu'], quantum: 'caveat',
      note: 'Mostly a classical GPU/CPU workload (branch-and-bound, GPU heuristics). Quantum/annealing samplers exist but have no broadly-proven advantage — treat any speedup claim as unproven until refereed.',
      incumbent: 'Classical solvers are the incumbent and usually the right answer.',
      better: ['GPU-accelerated heuristics / simulated annealing', 'A quantum sampler ONLY with a refereed, iso-quality advantage — not a headline'] },
    'cryptanalysis': { name: 'Breaking public-key crypto (Shor)', kind: 'quantum', engine: ['qpu'], quantum: 'genuine',
      maturity: '~millions of physical qubits, a decade+ out',
      note: 'Shor factors integers / solves discrete-log in polynomial time — breaking RSA & elliptic-curve crypto. The impact is NOW: it is why post-quantum cryptography (NIST ML-KEM / ML-DSA) is being rolled out today.' },
    'certified-randomness': { name: 'Certified quantum randomness', kind: 'quantum', engine: ['qpu'], quantum: 'genuine',
      maturity: 'a demonstrated near-term niche',
      note: 'Random-circuit sampling yields entropy a third party can certify was genuinely quantum — a beacon no classical box can fake. A classical machine (the TPU XEB-Referee) does the verification.' },
    'classical-data': { name: 'Data / serving / orchestration', kind: 'systems', engine: ['cpu'], quantum: 'none',
      note: 'Control flow, tokenization, retrieval, batching, and serving glue — a CPU workload. Keep the accelerators fed; don’t burn a matmul engine on branchy code.',
      incumbent: 'The CPU is the right tool here — no accelerator needed for the glue.',
      better: ['Overlap CPU orchestration with accelerator compute', 'Retrieval (RETRO-style) — ~25× (arXiv:2112.04426) to shrink the model that has to run'] }
  };

  // Given have = {cpu,gpu,tpu,qpu booleans} and a workload id, return the honest allocation.
  function allocate(have, workloadId) {
    have = have || {};
    var w = WORKLOADS[workloadId] || WORKLOADS['transformer-infer'];
    var isQuantum = w.kind === 'quantum';
    var engine = isQuantum ? null : (w.engine.filter(function (s) { return have[s]; })[0] || null);
    var orchestrator = have.cpu ? 'cpu' : null;
    var roles = [];
    ['tpu', 'gpu', 'cpu', 'qpu'].forEach(function (s) {
      if (!have[s]) return;
      var role;
      if (s === 'qpu') role = (w.quantum === 'genuine') ? (isQuantum ? 'quantum-engine' : 'quantum-sim') : 'idle';
      else if (isQuantum) role = (s === 'cpu') ? 'orchestrate' : 'verify';   // classical chips verify/simulate a quantum workload
      else if (s === engine) role = (s === 'tpu') ? 'matmul-dense' : 'matmul-flex';
      else if (s === 'cpu' && orchestrator === 'cpu') role = 'orchestrate';
      else role = 'support';
      roles.push({ substrate: s, role: role, label: ROLE_LABEL[role], sub: SUBSTRATES[s] });
    });

    var honesty = [];
    if (w.kind === 'ml') honesty.push({ tone: 'incumbent', text: w.incumbent + ' Most-used is not the same as best possible — that gap is exactly what this platform exists to close.' });
    if (have.qpu && w.quantum === 'none')
      honesty.push({ tone: 'quantum', text: 'You selected a quantum chip, but it does NOT accelerate ' + w.name.toLowerCase() + ' — the O(N) data read-in wall, costly read-out (repeated sampling, up to O(N)), dequantization, and barren plateaus close that door. Its honest role is materials simulation, a different workload entirely.' });
    if (have.qpu && w.quantum === 'caveat')
      honesty.push({ tone: 'quantum', text: 'A quantum/annealing sampler MIGHT help here, but no broadly-proven advantage exists — treat any speedup as unproven until it clears the referee at iso-quality.' });
    if (have.qpu && w.quantum === 'genuine' && !isQuantum)
      honesty.push({ tone: 'quantum', text: 'This is the honest home for a quantum chip — but fault-tolerant scale is 10–20 yr out; today the simulation runs classically on your TPU/GPU.' });
    if (isQuantum) {
      if (have.qpu) honesty.push({ tone: 'quantum', text: 'This genuinely needs a quantum chip — ' + (w.maturity || 'special-purpose') + '. ' + w.note });
      else honesty.push({ tone: 'gap', text: 'No quantum chip selected. Today this runs as a classical simulation / verification on TPU/GPU (what this bench does); a fault-tolerant QPU is the future engine — ' + (w.maturity || '') + '.' });
    }
    if (w.kind === 'ml' && !engine)
      honesty.push({ tone: 'gap', text: 'You have no matmul accelerator selected — a GPU or TPU carries the bulk compute for ' + w.name.toLowerCase() + '.' });

    var prove = (w.kind === 'ml')
      ? 'Think a different architecture wins on your hardware? Prove it: design it, run it, and let the referee re-derive an iso-quality energy/token (or tokens/s) verdict a stranger can reproduce — that is the whole point of the bench.'
      : isQuantum
        ? 'Any quantum-advantage claim here must be REFEREED — a classical verifier (this bench, or the TPU XEB-Referee) re-derives it from first principles. An unverified speedup is a headline, not a result.'
        : 'Any efficiency or advantage claim here should be refereed — re-derived from first principles, not asserted.';

    return { workload: w, roles: roles, engine: engine, honesty: honesty, better: w.better || [], prove: prove, quantumUses: QUANTUM_USES };
  }

  window.QMKnowledge = {
    GATES: GATES, TASKS: TASKS, PROBLEMS: PROBLEMS, QUALITY_AXES: QUALITY_AXES, GRADE_NOTE: GRADE_NOTE,
    SUBSTRATES: SUBSTRATES, WORKLOADS: WORKLOADS, ROLE_LABEL: ROLE_LABEL, allocate: allocate, QUANTUM_USES: QUANTUM_USES,
    CHIPS: CHIPS, chipsByClass: chipsByClass, chip: chip, haveFromChips: haveFromChips, PODS: PODS, pod: pod,
    esc: esc, gradeColor: gradeColor, taskColor: taskColor,
    profileBadge: profileBadge, profileDetail: profileDetail,
    taskOne: taskOne, taskChip: taskChip, problemCard: problemCard,
    buildAnsatz: buildAnsatz, couplingMap: couplingMap
  };
})();
