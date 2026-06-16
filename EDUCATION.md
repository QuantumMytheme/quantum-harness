# Education — from machine learning to quantum, and into the harness

> **Status: roadmap (content design for the platform's education layer).** Nothing
> here ships today. The harness in this repo is the *foundation* this curriculum
> builds toward; see [PLATFORM-VISION.md](./PLATFORM-VISION.md) for the platform
> phases and [README.md](./README.md) for the engine itself.

The thesis: you can't appreciate *why* native quantum-processing architectures matter
until you understand the full arc of how we got here. The education layer is a guided,
**highly-animated** progression — not static slides. Every stage is an interactive
"slice" of a model or a machine you can open up, step through, and watch compute. It
starts at the origins of machine learning and ends with the learner **running this
harness themselves against a live model.** The same `sim.py` that *grades* submissions
is the same `sim.py` that *teaches* — what you learn on is what you're judged on.

---

## Track I — Classical machine intelligence

1. **How we got to machine learning.** Hand-written rules and expert systems →
   statistical learning → the data + compute inflection that made learned models win.
2. **Big data.** Why the *scale* of data changed what was learnable; the data pipeline
   from collection to features to training sets.
3. **Small vs large language models.** n-grams → RNN/LSTM → the scaling story. **SLMs**
   (purposeful, on-device, cheap, task-built) versus **LLMs** (general, expensive,
   broad). Why both exist and when each is the right tool.
4. **Transformers.** Attention — the architecture that ate the field. Animated attention
   maps, tokenization, embeddings, and the layer stack you can step through.
5. **The modern inference zoo.** Encoder/decoder, mixture-of-experts, diffusion,
   retrieval-augmented, multimodal. **Hybrids** (a model wired to tools/retrieval) and
   **offline / on-device** models. Which are *purposeful* (built for one job) versus
   *general*, and why most real systems are hybrids.
6. **Pretraining vs post-training.** Most models have **both**: pretraining (next-token
   on a huge corpus) builds raw capability; post-training (SFT, RLHF/RLAIF, distillation)
   shapes behavior. Animated so the learner sees the two stages do different things.

## Track II — The machines underneath

7. **Highly-animated slices of the models.** Open a transformer and watch a single token
   flow through it — a forward pass, attention lighting up, a sampled output appearing.
   The model stops being a black box.
8. **Actual modern computers.** What a classical CPU / GPU / TPU physically does to run
   that forward pass: the memory hierarchy, matrix multiply, and the
   **intermediate-representation (IR) → classical-hardware** path. This is the punchline
   of Track II — today's inference is a **hybrid IR / classical stack**, and that is the
   thing quantum aims to move beyond.

## Track III — Toward quantum

9. **Simulations of quantum computers.** Qubits, superposition, entanglement, gates,
   measurement — taught on the **exact statevector simulator this repo ships** (`sim.py`).
   The learner runs the same simulator the judge runs: watch a statevector evolve
   gate-by-gate, a Bloch vector rotate, amplitudes update.
10. **Hybrid classical / quantum computers.** The VQE / QAOA pattern — a classical
    optimizer in a loop driving a quantum circuit. The committed `isingbell2` worked
    problem (find the ground state of `H = -X₀X₁ - Z₀Z₁`) is the first hands-on hybrid
    example: a real, gradeable, classical-drives-quantum task.
11. **…and then the harness.** This is where QuantumMytheme's template comes in — the
    bridge from "I understand quantum simulation" to "I am designing quantum
    architectures and getting them verified."

---

## The culmination — run it yourself

After the arc, the learner does the one thing the whole platform exists for:

- **Fork the template harness** (this repo).
- **Pick or write a BRIEF** — a concrete, simulator-verifiable quantum design problem.
- **Point their *own* capable model at it** — their Claude subscription, or their token /
  API credits. Model-agnostic by design: Opus 4.8 and Fable 5 today, and ready for the
  next-generation models you're anticipating (**"Mythos"**) the day they ship.
  The judge does not care *who* produced a bundle; it only re-simulates the circuit.
- **Inject the parameters they want to study** into the public repo's BRIEF and
  constraints — qubit count, depth budget, native gate set, coupling map, ansatz family,
  optimizer, seeds — and run an experiment that is theirs.
- **Submit the proof bundle, get a machine-checkable verdict,** and have it land in the
  public directory next to everyone else's, scored by the same gate.

That is the citizen-science loop: **bring your own model + credits, inject your
parameters, run against the bench.**

### Why "easy to run against your own subscription" is real, not aspirational

The harness is already built to make this frictionless:

- The template ships **`.claude/settings.json`** (bench commands pre-allowlisted) and
  **`requirements.txt`** (numpy only) so a fresh fork runs immediately — no setup wall.
- The learner brings **their own model access** (Claude Code subscription, or API/token
  credits). The harness never holds anyone's credits or keys; it only *structures the
  run* and *verifies the output*. Your subscription is the fuel, never part of the trust
  path.
- **Parameter injection = editing the BRIEF / constraints / references** — the exact
  five-step recipe in [RERUN.md](./RERUN.md).
- **Phase 3** of the platform adds an optional hosted "Run" button that drives a learner's
  fork with their subscription for them — but the local path above works today, by hand,
  on a laptop.

## Animation principles

Every stage is interactive and visual — no static slides. Attention heatmaps you can
hover, a token you can follow through the layers, a statevector rotating on the Bloch
sphere, a circuit's amplitudes updating one gate at a time. The teaching artifact and the
grading artifact are the **same code**, so nothing taught is ever hand-wavy: if the
animation shows it, the judge can verify it.

---

> Reminder: this is a forward-looking content roadmap. The harness in this repo is real
> and runs today; the curriculum above is the education layer it is designed to power.
