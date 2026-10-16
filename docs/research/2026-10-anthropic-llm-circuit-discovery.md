# External finding: LLM-driven circuit discovery under an automated judge (Anthropic, 2026-10-16)

**Sources**
- Blog post: [Designing more efficient quantum circuits with Claude](https://www.anthropic.com/research/designing-efficient-quantum-circuits) (Anthropic Science, 2026-10-16)
- Paper: Gu, Kemeny, Yelin, Lukin, *Discovering state-of-the-art quantum circuits with large language models*, [arXiv:2610.22367](https://arxiv.org/abs/2610.22367)
- Neither the post nor the arXiv page links code or data. Check the PDF before assuming any exists.

Everything below comes from those two pages as read on 2026-10-16. We have not reproduced any of it.

## What they did

They gave Claude a plain-language spec for each of **eight** circuit-design tasks. The tasks span chemistry, optimization, physics simulation, number theory, and numerical computing. Claude wrote designs in Python. An **independent automated evaluator** checked each design for correctness and scored it. Claude revised its designs from that feedback in a closed loop, with no human input between rounds. The paper describes this as an evolutionary framework.

They picked only tasks with **one definite output per input**, so an ordinary computer can check correctness. The post scores designs on qubits × gates as a runtime proxy. The paper reports Toffoli and qubit counts.

## Headline results (as reported)

| Task | Result |
| --- | --- |
| All 8 tasks | Fewer qubits **and** fewer gates than the best published design. The paper says Toffoli and qubit counts drop on 7 of 8 tasks, and the 8th improves the Toffoli/qubit trade-off. |
| Elliptic-curve point addition / prime-field modular inversion | A new **reversible divsteps** architecture that decodes branch history from the numerical pairs instead of storing it. One point uses **12% more qubits and 17× fewer gates** than the smallest prior design. A store-versus-decode threshold traces a family of designs that extends the Pareto frontier. The decoding formula comes from new algebraic identities, was checked by large-scale simulation, and was formalized in **Lean**. The run took **53 h** from a one-paragraph brief. |
| DQI Reed–Solomon decoder | Replaced extended Euclid with **Berlekamp–Massey**, which runs a fixed gate sequence. Recomputes temporaries instead of storing them. Reserves **19 qubits**, against 665 for a worst-case reserve and up to 840 for a naive reversible version. **~12× fewer gates** than Google's construction (Khattar et al. 2025). The design fails about 1 run in 10,000, measured over 403M sampled decodes, which is within the allowed error. |

**Limitations the authors state:** Claude was conservative. It second-guessed good improvements and preferred well-known approaches. Humans had to supply countermeasures by hand: parallel exploration of different approaches and occasional prompts to widen the search. The study covers only eight primitives, and only classically checkable ones. The metric is a proxy, and depth is not reported.

## Why this matters for quantum-harness

This is an external, large-scale demonstration of the loop this repo is built around: **BRIEF → capable model → hermetic judge → iterate until ACCEPT**. The methods map directly onto our pieces:

| Their method | Our equivalent | Gap |
| --- | --- | --- |
| Independent evaluator scores correctness and cost | `bench/quantum-judge/judge_verify.py` (exits 3/4/5/6) | none in principle |
| Only tasks with one definite output per input | Hidden references, re-simulation (exit 4) | We verify by **statevector**, which caps us at small n. Their tasks are **reversible classical arithmetic**, checkable on basis states at any width. |
| Qubits × gates / Toffoli count as the score | `thresholds.two_qubit_cost`, cost-adjusted fidelity, 2q budgets | No Toffoli/T-count or qubit-×-gate metric yet |
| Rare-failure designs allowed within an error budget (DQI decoder, 1e-4) | none | No sampled-failure-rate gate |
| Lean proof of the key identity | none | Out of scope for now; a possible future proof-attachment field |
| Parallel divergent exploration to beat model conservatism | KICKOFF / BRIEF prompting | Worth adding to KICKOFF.md as explicit instructions |

## Proposed follow-ups

These are tracked as IMPROVEMENTS item 13.

1. **`reversible` task type.** The circuit is over {X, CX, CCX}. The judge checks it on sampled basis inputs against a classical reference function, plus every input when n is small. This needs no statevector, so it scales to the widths these papers use. The score is Toffoli count, qubit count, and their product. Start problems: n-bit ripple adder, modular add, and a small modular inversion.
2. **Rare-failure gate.** A reference may declare `max_failure_rate`. The judge samples M inputs with a seeded RNG and rejects (exit 5) when the observed rate's upper confidence bound exceeds the declared rate. This is the DQI pattern.
3. **Pareto scoreboard column.** Report designs as (qubits, Toffolis) points rather than a single winner, as in their Table 1.
4. **KICKOFF anti-conservatism clause.** Tell the model to explore several qualitatively different approaches in parallel and to widen the search when it plateaus. The authors found they needed this by hand.

Honesty note: none of the paper's circuits are on our scoreboard. Do not cite them as verified by this judge until a bundle reproduces them here.
