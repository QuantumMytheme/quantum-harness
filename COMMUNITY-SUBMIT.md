# Anonymous community submissions (no GitHub sign-in)

Let a visitor **without a GitHub account** submit a full-stack design as a run repo in
the **QuantumMytheme** org — using a **server-side token**, not their (or your) GitHub
session. This is **off by default** and only turns on when you provision the secrets
below. Until then the mint dialog shows only the signed-in / template paths.

## Why it's built the careful way

Anonymous writes into your org are an abuse vector, so the endpoint is **fail-closed**
and guarded:

- **Least-privilege server token, never in code.** The write is done with `MINT_TOKEN`,
  a Cloudflare **encrypted secret** — a *fine-grained* PAT scoped to the QuantumMytheme
  org with only **Administration: write** (create repo) + **Contents: write** (write
  `RECIPE.json`). It is never your personal OAuth session and never appears in the repo.
- **Bot protection.** Every submission must pass a **Cloudflare Turnstile** challenge
  (verified server-side via `siteverify`). No Turnstile secret → anonymous submit is
  disabled.
- **Rate limiting.** With a KV binding (`SUBMIT_RATE`), submissions are capped **per-IP
  (5/day)** and **globally (300/day)**.
- **Validation + namespacing.** The body must be a valid full-stack `RECIPE.json`
  (`hardware.chips[]` + a software half); repos are created **from the template only**,
  named `community-*`, and tagged `community-submission` + `quantum-harness-run` so they
  are easy to find and moderate.
- **The judge is still the gate.** A submitted design is *implemented* by a model and
  *graded* by the hermetic judge before it scores — anonymous submission creates the
  design repo, it does not put an unverified result on the board.

## One-time setup (site owner)

1. **Create a fine-grained PAT** (github.com → Settings → Developer settings →
   Fine-grained tokens): resource owner **QuantumMytheme**, repository access **All**
   (or a chosen set), permissions **Administration: Read and write** + **Contents: Read
   and write**. Short expiry. Copy it once.
2. **Create a Turnstile widget** (Cloudflare dash → Turnstile → Add site, hostname
   `quantummytheme.com`). Note the **site key** (public) and **secret key**. (The
   `turnstile-spin` skill can scaffold this.)
3. **Set the Pages secrets/vars** (Pages project → Settings → Environment variables):
   - `MINT_TOKEN` — **encrypted** — the fine-grained PAT from step 1.
   - `TURNSTILE_SECRET` — **encrypted** — the Turnstile secret key.
   - `TURNSTILE_SITEKEY` — **plaintext** — the Turnstile site key.
4. *(Optional but recommended)* Bind a **KV namespace** named `SUBMIT_RATE` for the
   per-IP / global daily caps.
5. Redeploy. `/api/submit-config` now returns `{ enabled: true, sitekey }` and the mint
   dialog shows **"…or submit to QuantumMytheme without a GitHub account."**

To turn it off, delete `MINT_TOKEN` (or `TURNSTILE_SECRET`) and redeploy.

## Endpoints (in `viewer/_worker.js`)

- `GET /api/submit-config` → `{ enabled, sitekey }` — the UI reads this to decide whether
  to show the anonymous path (fail-closed).
- `POST /api/submit-run` `{ recipe, name, turnstile_token }` → creates
  `QuantumMytheme/community-<name>` from the template, writes `RECIPE.json`, tags it, and
  returns `{ repo, url, attestable }`. Verifies Turnstile, rate-limits, and validates
  before any write. If the `RECIPE.json` write itself fails (the design would otherwise
  be silently lost in an empty shell repo), the just-created repo is **deleted and the
  request fails with a 502** — no junk `community-*` repos, no false "✓ submitted", and
  the rate-limit slot is not consumed.

---

# Replication Census — "replicated in-browser ×N"

An anonymous, Turnstile-gated, rate-limited **counter** of successful in-browser
re-verifications. When a visitor re-runs the real judge in their browser (the lab's
Pyodide runner) and it ACCEPTs a committed bundle, they can click **"Record it"** and the
bundle's public counter ticks: scoreboard rows then show a subtle
**"replicated in-browser ×N · <date>"** chip.

## What it is — and, more importantly, what it is NOT

- **It is NOT verification.** The judge verdict is the authority — anyone can re-run the
  judge themselves; the census merely counts that people did. The chip's hover text says
  exactly this: *"anonymous in-browser re-runs; the judge verdict is the authority."*
- **It is distinct from "reproduced ×N (attested)".** That's the separate PR-based
  attestation layer in `scoreboard/` where a named person commits a reproduction. The
  census is the complementary lightweight anonymous tier, and is always worded
  **"replicated in-browser ×N"** so the two are never conflated.
- **It can be inflated — but only as far as the caps allow.** It's an anonymous counter
  behind Turnstile with a per-IP daily cap (5) and a global daily cap (500). Treat the
  number as "how much friendly traffic re-ran this", not as evidence. Counts are coarse:
  a concurrent-click race can *drop* an increment (KV is last-write-wins), never
  over-count.

## What's stored (in the `SUBMIT_RATE` KV namespace, distinct `repl` key prefixes)

| Key | Value | Lifetime |
|---|---|---|
| `repl:<sha256>` | `{"n": <count>, "last": "YYYY-MM-DD"}` — count + last date **only** | persistent |
| `repl-day:<ip>:<day>` | per-IP daily-cap counter — the **only transient PII**, never joined to a bundle hash | expires in 48 h |
| `repl-day:all:<day>` | global daily-cap counter | expires in 48 h |

No accounts, no names, no user agents, no per-replication log — a hash, a count, a date.

## Endpoints (in `viewer/_worker.js`)

- `GET /api/replications` → `{ enabled, sitekey, counts }` — also the UI's enabled-probe.
  With `?hashes=<sha256>,<sha256>,…` (≤ 30) returns `counts: { <sha256>: { n, last } }`
  for the recorded ones. Cached 5 minutes. **When Turnstile or the KV binding is missing
  it returns `{ enabled: false }`** and `viewer/census.js` renders nothing at all.
- `POST /api/replications` `{ sha256, problem_id, turnstile_token }` → verifies Turnstile,
  validates the sha256 shape + `problem_id` against the known problem set, enforces the
  caps, increments the counter, returns `{ ok, sha256, n, last }`. **Fail-closed: 503**
  with provisioning instructions when unconfigured.

## One-time setup (site owner)

1. **Turnstile**: reuse (or create) the widget from the anonymous-submit setup above —
   `TURNSTILE_SECRET` (encrypted) + `TURNSTILE_SITEKEY` (plaintext) on the Pages project.
2. **KV**: bind the `SUBMIT_RATE` KV namespace (required for the census — it holds the
   counters, not just the caps).
3. Redeploy. `GET /api/replications` flips to `{ enabled: true }`; until then the site
   shows no census UI anywhere (dark-safe).

Note the census needs **no `MINT_TOKEN`** — it never writes to GitHub.
