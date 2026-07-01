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
  before any write.
