import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Load knowledge.js (a browser IIFE that assigns window.QMKnowledge) by handing it a
// fake `window` — allocate()/SUBSTRATES/WORKLOADS are pure, no DOM needed.
const src = readFileSync(fileURLToPath(new URL('../viewer/knowledge.js', import.meta.url)), 'utf8')
const win = {}
new Function('window', 'document', 'getComputedStyle', src)(
  win, { documentElement: { getAttribute: () => null } }, () => ({ getPropertyValue: () => '' }))
const K = win.QMKnowledge

// These tests institutionalize the Scenario Studio's honest thesis so a future edit
// cannot silently regress the message the project stakes its credibility on.

test('Scenario Studio exposes the shared substrate model', () => {
  assert.ok(K && K.allocate && K.SUBSTRATES && K.WORKLOADS, 'knowledge.js should expose allocate/SUBSTRATES/WORKLOADS')
  for (const s of ['cpu', 'gpu', 'tpu', 'qpu']) assert.ok(K.SUBSTRATES[s], `SUBSTRATES.${s}`)
})

test('a quantum chip NEVER accelerates an ML workload — it is idle-with-reason', () => {
  const mlWorkloads = Object.entries(K.WORKLOADS).filter(([, w]) => w.kind === 'ml')
  assert.ok(mlWorkloads.length >= 4, 'expect several ML workloads')
  for (const [id] of mlWorkloads) {
    const a = K.allocate({ cpu: true, gpu: true, tpu: true, qpu: true }, id)
    const qpu = a.roles.find(r => r.substrate === 'qpu')
    assert.equal(qpu.role, 'idle', `${id}: the QPU must be idle for an ML workload, never a matmul/accelerator role`)
    assert.ok(a.honesty.some(h => h.tone === 'incumbent'), `${id}: must flag most-used ≠ best`)
    assert.ok(a.honesty.some(h => h.tone === 'quantum'), `${id}: must flag that quantum does not accelerate it`)
  }
})

test('materials simulation is the ONE genuine home for the quantum chip', () => {
  const m = K.allocate({ cpu: true, tpu: true, qpu: true }, 'materials-sim')
  assert.equal(m.roles.find(r => r.substrate === 'qpu').role, 'quantum-sim')
})

test('TPU is the dense matmul engine when present; GPU is the flexible engine otherwise', () => {
  const both = K.allocate({ cpu: true, gpu: true, tpu: true }, 'transformer-infer')
  assert.equal(both.roles.find(r => r.substrate === 'tpu').role, 'matmul-dense')
  const gpuOnly = K.allocate({ cpu: true, gpu: true }, 'transformer-infer')
  assert.equal(gpuOnly.roles.find(r => r.substrate === 'gpu').role, 'matmul-flex')
})

test('a quantum chip IS genuinely for something — the honest shortlist + quantum workloads', () => {
  assert.ok(Array.isArray(K.QUANTUM_USES) && K.QUANTUM_USES.length >= 4, 'QUANTUM_USES lists the genuine uses')
  const keys = K.QUANTUM_USES.map(u => u.key)
  for (const k of ['simulation', 'cryptanalysis', 'randomness', 'optimization']) assert.ok(keys.includes(k), `QUANTUM_USES.${k}`)
  for (const id of ['cryptanalysis', 'certified-randomness']) {
    const a = K.allocate({ cpu: true, tpu: true, qpu: true }, id)
    assert.equal(a.roles.find(r => r.substrate === 'qpu').role, 'quantum-engine', `${id}: the QPU is the engine`)
    const tpu = a.roles.find(r => r.substrate === 'tpu')
    assert.equal(tpu.role, 'verify', `${id}: classical chips verify/simulate the quantum workload`)
    const noq = K.allocate({ cpu: true, tpu: true }, id)
    assert.ok(noq.honesty.some(h => h.tone === 'gap'), `${id}: without a QPU, flags it honestly (classical sim today)`)
  }
})

test('transformer inference is flagged as most-used, not best, with real alternatives', () => {
  const a = K.allocate({ cpu: true, tpu: true }, 'transformer-infer')
  assert.ok(K.WORKLOADS['transformer-infer'].dominant, 'transformer-infer is the dominant workload')
  assert.ok(a.better.length >= 3, 'must offer candidate better-than-transformer architectures')
  assert.ok(/MoE|SSM|Mamba/i.test(a.better.join(' ')), 'alternatives should include MoE/SSM')
})
