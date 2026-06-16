# Quantum Runner Skeleton — annotated Managed-Agents host orchestrator (quantum slice)
> Status: Draft · 2026-06-15
> Produces: a copy-to-adapt structure for the run-time host orchestrator that drives a coordinator
> over per-ansatz / per-parameter-subspace effector sub-agents against the quantum-judge bench.
> Derives from: the Managed-Agents pattern (coordinator fans out effectors, each calls a custom
> tool, a host-side judge holds the hidden reference and gates results), genericized to quantum.
> Grounded against the REAL bench at `bench/quantum-judge/` (`sim.py`, `capture.py`,
> `judge_verify.py`, `references/<problem_id>.json`).

> This is **annotated pseudocode in markdown — not runnable code dropped into another repo.** It is
> deliberately structure + rules so a new problem cannot silently drop a verification property when
> it adapts. The ONE thing you change per problem is the **custom tool** (`run_circuit`, its
> `input_schema`) and what the host does on the result; everything else is invariant.

---

## 0 · Invariants you must not break (inlined as comments throughout)

```
// V1 — the HIDDEN REFERENCE is read HOST-SIDE and never enters any session event, message, prompt,
//       custom-tool input, or the container. The sandbox only ever sees a circuit IR and a verdict.
//       Reference = bench/quantum-judge/references/<problem_id>.json (it works like a
//       signing key). For a live contest, hold that dir OUT of the model's repo and point the
//       host judge at it via env QH_REFERENCES_DIR; the model knows the target only CONCEPTUALLY
//       from BRIEF.md / RUBRIC.md.
// V2 — NEVER put permission_policy:{type:"always_ask"} on a custom tool → 400. The gate is the
//       custom-tool authorization boundary (handle agent.custom_tool_use host-side).
// V3 — STREAM FIRST: open the events stream BEFORE sending the kickoff (SSE has no replay).
// V4 — directive coordinator prompt + imperative kickoff COMMAND (never "do not call tools" — a
//       coordinator delegating to a sub-agent IS a tool call; suppressing it kills the fan-out).
// V5 — ANTHROPIC_API_KEY by name only; never printed. Secrets + the held-out references gitignored.
// V6 — capture.py and judge_verify.py share ONE simulator (sim.py). The host computes the CLAIM
//       with the same engine the judge re-derives with, so a circuit that captures clean is
//       guaranteed to reproduce under the judge. Do not let an effector self-report a raw number;
//       the host runs the sim.
```

## 1 · Setup

```
import Anthropic from '@anthropic-ai/sdk'            // beta managed-agents-2026-04-01 auto-set
// fail fast if ANTHROPIC_API_KEY is unset — by NAME only, never read or print the value (V5)
const client = new Anthropic()

// HOST-SIDE bench paths (V1). The host process — NOT the sandbox — is the only thing that touches
// the hidden references. judge_verify.py resolves them from QH_REFERENCES_DIR or the committed
// bench/quantum-judge/references/ default.
const JUDGE_DIR = 'bench/quantum-judge'
const REFS_DIR  = process.env.QH_REFERENCES_DIR || `${JUDGE_DIR}/references`   // held out in a contest
const PROBLEM   = 'ghz3'                              // or 'isingbell2'; one problem per run
const TASK      = 'state_prep'                        // 'state_prep' | 'vqe' | 'populations' | 'architecture' | 'classify'
```

## 2 · Define the custom tool — THE ONE DOMAIN-SPECIFIC SURFACE

```
// run_circuit is the quantum actuation verb. An effector hands the host a CIRCUIT IR (the same
// shape capture.py consumes); the host runs it on sim.py and grades it with judge_verify.py.
// DO NOT add permission_policy here (V2). The gate is the host-side handler in §5.
// NOTE: run_circuit (n_qubits+ops) covers the CIRCUIT tasks (state_prep|vqe|populations). The
// architecture task submits a topology bundle ({architecture,constraints,claim.routing_cost}) and
// classify submits a feature-map bundle ({feature_map,readout,claim.train_accuracy}); give those a
// matching tool shape (see the bench README for the bundle schemas). The host-side gate is identical.
const runCircuitTool = {
  type: 'custom',
  name: 'run_circuit',
  description:
    'Submit a candidate quantum circuit IR for the current problem. The HOST runs it on the '
    + 'hermetic numpy statevector simulator and returns the judge verdict (ACCEPT / REJECT + the '
    + 'gate that failed). You never see the hidden reference; only the host does.',
  input_schema: { type: 'object',
    properties: {
      // exactly the circuit.json shape capture.py reads (n_qubits + ops[{gate,q,params?}]),
      // plus the constraints/baseline the bundle declares:
      n_qubits:            { type: 'integer' },
      ops: { type: 'array', items: { type: 'object', properties: {
               gate:   { type: 'string' },   // x y z h s sdg t tdg sx sxdg rx ry rz p cx cz cy
               q:      { type: 'array', items: { type: 'integer' } },   // swap crz cp rzz ccx
               params: { type: 'array', items: { type: 'number' } } },
             required: ['gate', 'q'] } },
      constraints:         { type: 'object' },   // n_qubits,max_depth,native_gates,coupling_map,max_two_qubit_gates
      classical_baseline:  { type: 'object' },   // {fidelity|energy, note}
      ansatz_label:        { type: 'string' },   // which subspace this effector owns (for the record)
    },
    required: ['n_qubits', 'ops'] },
}
```

## 3 · Create the roster ONCE, reuse by id

```
// effectors = one PER ANSATZ / PER PARAMETER-SUBSPACE. Each explores its slice of the design space
// (e.g. different gate decompositions, different parameter seeds for a VQE ansatz, different
// coupling-map-legal layouts) and submits ONE circuit via run_circuit. Low-effort haiku.
const effectorAnsatzA = await client.beta.agents.create({ name: 'ansatz-A', model: 'claude-haiku-4-5',
  system: 'You own ONE ansatz family for the stated problem. Build a single circuit IR that respects '
        + 'the declared constraints (n_qubits, max_depth, native_gates, coupling_map, '
        + 'max_two_qubit_gates), call run_circuit EXACTLY ONCE with it, report the host verdict, stop. '
        + 'Call no other tool.',
  tools: [runCircuitTool] })                          // the custom tool lives on the SUB-AGENT
// … create the rest of the roster: one effector per ansatz / parameter-subspace
// (≤20 entries, ≤25 concurrent threads, ONE delegation level — effectors do not spawn sub-agents)

// coordinator: high-effort opus, DIRECTIVE prompt (V4), agent toolset + multiagent roster.
const coordinator = await client.beta.agents.create({ name: 'qc-coordinator', model: 'claude-opus-4-8',
  system: 'You are the coordinator for a quantum circuit-design problem. When the user gives the '
        + 'go-ahead, immediately delegate one ansatz / parameter-subspace to EACH sub-agent '
        + '(delegating to a sub-agent is how you act — do it directly, do not just describe a plan). '
        + 'Partition the design space so effectors do not duplicate. When all report back, pick the '
        + 'circuit(s) the host ACCEPTED and write a short summary. Be concise.',
  tools: [{ type: 'agent_toolset_20260401' }],
  multiagent: { type: 'coordinator', agents: [effectorAnsatzA.id, /* …per-ansatz effector ids */] } })

// persist { coordinator.id, coordinator.version, …effector ids } to a gitignored file; reuse next run
```

## 4 · Create the environment, then open the session and STREAM FIRST

```
// The sandbox gets the AUTHORING side only: sim.py + capture.py + BRIEF.md + RUBRIC.md. It does NOT
// get references/ in a live contest (V1) — the host runs the judge out-of-band.
const env = await client.beta.environments.create({
  name: `qc-${PROBLEM}`, config: { type: 'cloud', networking: { type: 'unrestricted' } } })
//  ^ SECURITY NOTE: V1 keeps the hidden reference out of the sandbox, but unrestricted egress is the
//    real exfiltration surface — tighten networking / use self_hosted for a held-out contest.

const session = await client.beta.sessions.create({
  agent: { type: 'agent', id: coordinator.id, version: coordinator.version },
  environment_id: env.id, title: `quantum ${PROBLEM} ${TASK}` })

const stream = await client.beta.sessions.events.stream(session.id)   // V3: BEFORE the kickoff
// kickoff is an imperative COMMAND, not a data dump (V4) — the conceptual target only, never the ref:
await client.beta.sessions.events.send(session.id, { events: [{ type: 'user.message',
  content: [{ type: 'text', text:
    `Go — delegate now. Problem ${PROBLEM} (${TASK}). Target per BRIEF.md/RUBRIC.md. Give each `
  + `sub-agent a distinct ansatz / parameter-subspace; each calls run_circuit once.` }] }] })
```

## 5 · The event loop (the gate lives here)

```
for await (const ev of stream) {
  if (!ev || !ev.type) continue                       // guard: some events arrive empty/{}

  switch (ev.type) {
    case 'session.thread_created':       /* register thread; parent=null is primary */ break
    case 'agent.thread_message_sent':    /* coord → effector: record the ansatz delegation */ break
    case 'agent.thread_message_received':/* effector → coord: record the report */ break
    case 'agent.message':                /* coordinator summary thread */ break

    case 'agent.custom_tool_use': {
      // ev = { id:'sevt_…', session_thread_id:'sthr_…', name:'run_circuit', input }
      // === THE VERIFY GATE — host-side, holds the hidden reference (V1) ===
      const result = await runAndJudge(ev)             // build bundle, run sim, run judge_verify.py
      const reply  = { type: 'user.custom_tool_result',
                       custom_tool_use_id: ev.id,       // NOTE: custom_tool_use_id, NOT tool_use_id
                       content: [{ type: 'text', text: JSON.stringify(result) }],
                       session_thread_id: ev.session_thread_id }
      if (result.verdict === 'REJECT') reply.is_error = true   // feed the failing gate back so the
      await client.beta.sessions.events.send(session.id, { events: [reply] })  // effector self-corrects
      break
    }

    case 'session.status_idle':
      if (ev.stop_reason?.type === 'requires_action') continue   // waiting on us — handled above
      /* end_turn → request one final summary, then land evidence (§6), then terminate */ break
  }
  // safety cap: break on a max event count / wall-clock budget
}
```

### `runAndJudge(ev)` — the host-side bench call (the load-bearing verification property)

```
async function runAndJudge(ev) {
  const i = ev.input

  // 1) Write the effector's circuit IR to a temp circuit.json (n_qubits, ops, constraints,
  //    classical_baseline) — exactly the shape capture.py reads.
  const circuitPath = writeTemp({ n_qubits: i.n_qubits, ops: i.ops,
    constraints: i.constraints || {}, classical_baseline: i.classical_baseline || {} })

  // 2) capture.py runs the circuit on sim.py and emits a well-formed proof bundle with an HONEST
  //    self-reported claim (fidelity for state_prep, energy for vqe). The host computes the claim
  //    with the SAME engine the judge re-derives with (V6), so no effector can fabricate a number.
  //    Bundle schema: "quantum-harness/proof-bundle@1".
  const bundle = exec(`python3 ${JUDGE_DIR}/capture.py ${circuitPath} ${PROBLEM} --task ${TASK}`)
  const bundlePath = writeTemp(bundle)

  // 3) judge_verify.py re-simulates deterministically against the HIDDEN reference and returns an
  //    exit code. The host runs it with QH_REFERENCES_DIR pointed at the held-out refs (V1).
  //    FOUR active gates (each can REJECT with its own code); anti-overfit fires for problems
  //    whose reference declares a `holdout` block (a held-out observable/target the model was
  //    NEVER told). For problems with no holdout block (ghz3, isingbell2) anti-overfit ALSO
  //    holds by construction (ground truth lives only in the hidden reference; the IR can't
  //    embed a target), so exit 6 is simply not triggered for them. → exit codes:
  //      0 ACCEPT | 2 schema | 3 STRUCTURE (n_qubits/depth/native-gates/coupling-map/2q-cap)
  //      4 REPRODUCIBILITY (claimed != recomputed — anti-fabrication)
  //      5 PERFORMANCE (meet threshold AND beat/tie classical baseline)
  //      6 ANTI-OVERFIT (held-out generalization check — fires when the problem declares a held-out check)
  const { code, stdout } = exec(
    `QH_REFERENCES_DIR=${REFS_DIR} python3 ${JUDGE_DIR}/judge_verify.py ${bundlePath} --json`)

  // 4) Return ONLY the verdict + which gate failed (NEVER the reference contents — V1). On REJECT
  //    the effector sees the failing gate name and can self-correct on a later run.
  // codes the judge actually returns: 0,2,3,4,5,6. 6 (anti-overfit) fires when the problem
  // declares a held-out check (e.g. bell_pops2 held-out observable, aiaccel4 held-out workload,
  // qml_sign1 held-out test set).
  const GATE = { 2:'schema', 3:'structure', 4:'reproducibility', 5:'performance', 6:'anti-overfit (held-out)' }
  return code === 0
    ? { verdict: 'ACCEPT', problem: PROBLEM, task: TASK, checks: JSON.parse(stdout).checks }
    : { verdict: 'REJECT', gate: GATE[code] || 'unknown', code, reason: JSON.parse(stdout).reason }
}
```

## 6 · Land the evidence

```
// Write the run record: coordinator + per-ansatz sub_agents, threads, every run_circuit submission,
// its proof bundle, and the judge verdict (ACCEPT/REJECT + gate). Keep the ACCEPTED bundle(s) — the
// best circuit per the rubric (highest fidelity / lowest energy under the constraints).
//
// ANTI-CHEAT REGRESSION (must hold for the evidence to be trustworthy): the committed adversarial
// fixture bench/quantum-judge/quantum-proof-FORGED.json (omits the 2nd CX, claims fidelity 1.0 but
// truly 0.25) MUST be rejected with exit 4 (reproducibility); and the anti-overfit demonstrators
// MUST be rejected with exit 6 — quantum-proof-OVERFIT.json (a |Phi-> impostor matching the visible
// populations but flipping the held-out <X0X1>), quantum-proof-arch-OVERFIT.json (a topology that
// routes the visible workload but blows the held-out workload budget), and
// quantum-proof-qml-OVERFIT.json (an Ry(7x) feature map that fits the train set but fails the
// held-out test set). The bench self-test `python3 bench/quantum-judge/test_judge.py` is 29/29 —
// accept the five worked examples (ghz3 state_prep, isingbell2 vqe, bell_pops2 populations,
// aiaccel4 architecture, qml_sign1 classify), reject every class of forgery AND each
// held-out-overfit impostor. Run it before trusting a run's verdicts.
//
// Emit a public proof bundle the panel renders; SIMULATED actuation stays labelled SIMULATED.
```

## 7 · Measurement (kept verbatim — domain-agnostic)

```
// The autonomy scorecard is fed the SESSION TRANSCRIPT, not the circuits. Same measurement binaries:
//   node --test test/*.test.mjs                          // scorecard + transcript scrub + planner tests
//   bin/autonomy-scorecard.mjs <transcript>              // intervention class, longest unattended
//                                                        // stretch, self-caught failures, timeline
//   bin/prepare-transcript.mjs <transcript>              // scrub secrets before publishing
// A run is "green" when judge_verify.py ACCEPTs (exit 0) the landed bundle AND the model looped to
// that state with minimal intervention — that loop is what the scorecard measures.
```

## 8 · Going from one problem to many / from circuits to architecture

- **New problem (same task):** add `references/<problem_id>.json` (target_statevector or
  hamiltonian_terms + thresholds/tolerance), set `PROBLEM`, restate the target conceptually in
  `BRIEF.md`/`RUBRIC.md`. The orchestrator, the `run_circuit` tool, and the gate are unchanged.
- **New task family:** `state_prep`, `vqe`, `populations`, `architecture`, and `classify` all exist
  today, each with its own per-task verifier in the judge (state-based circuits for the first three,
  a topology graph for `architecture`, a feature-map classifier for `classify`). Adding another swaps
  in a new per-task verifier — the host loop stays put; circuit tasks reuse the `run_circuit` surface
  while topology/classifier tasks submit their own bundle shape (see §2).
- The trust chain (hidden reference held host-side, one shared simulator for capture + judge, the
  four-active-gate verdict with the held-out anti-overfit gate live, the FORGED-bundle and
  OVERFIT-bundle regressions) is invariant; only the problem/task content moves.
```
