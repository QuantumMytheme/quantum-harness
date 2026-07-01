// Cloudflare Pages advanced-mode worker.
//  1. canonicalize www -> apex (301, path+query preserved).
//  2. /api/github/* — a tiny GitHub OAuth backend so a visitor can mint a run
//     repo from the template WITHOUT pasting a token. The client_secret + the
//     access token stay server-side (the token in an HttpOnly cookie); the page
//     only ever talks to /api/github/*.
//  Everything else is served from the static assets via env.ASSETS.
//
//  SETUP (one-time, by the site owner):
//   - Create a GitHub OAuth App: Settings → Developer settings → OAuth Apps →
//     New. Homepage: https://quantummytheme.com ·
//     Authorization callback URL: https://quantummytheme.com/api/github/callback
//   - In the Pages project (Settings → Environment variables) set
//     GITHUB_CLIENT_ID (plaintext) and GITHUB_CLIENT_SECRET (encrypted), then deploy.
//   Until they're set, /api/github/login replies 503 and the UI falls back to a
//   pasted-token path / the "Use this template" link.

const ORIGIN = "https://quantummytheme.com";
const REDIRECT_URI = ORIGIN + "/api/github/callback";
const TEMPLATE = "QuantumMytheme/quantum-harness";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.quantummytheme.com") {
      url.hostname = "quantummytheme.com"; url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api/submit-config") return submitConfig(env);
    if (url.pathname === "/api/submit-run" && request.method === "POST") return submitRun(request, env);
    if (url.pathname === "/api/replications") {
      if (request.method === "GET") return replicationsGet(url, env);
      if (request.method === "POST") return replicationsPost(request, env);
      return json({ error: "method not allowed" }, 405);
    }
    if (url.pathname.startsWith("/api/github/")) return github(request, url, env);
    return env.ASSETS.fetch(request);
  },
};

function readCookies(req) {
  const out = {}, h = req.headers.get("Cookie") || "";
  h.split(/;\s*/).forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
function cookie(name, val, maxAge) {
  return `${name}=${encodeURIComponent(val)}; Path=/api/github; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(headers || {}) } });
}
const GH_HDR = (token) => ({ "Authorization": "Bearer " + token, "User-Agent": "QuantumMytheme-Pages", "Accept": "application/vnd.github+json" });

async function github(request, url, env) {
  const path = url.pathname;
  const clientId = env.GITHUB_CLIENT_ID, secret = env.GITHUB_CLIENT_SECRET;

  if (path === "/api/github/login") {
    if (!clientId) return new Response("GitHub OAuth is not configured on this deployment.", { status: 503 });
    const state = crypto.randomUUID();
    const auth = new URL("https://github.com/login/oauth/authorize");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("scope", "public_repo");
    auth.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { "Location": auth.toString(), "Set-Cookie": cookie("gh_state", state, 600) } });
  }

  if (path === "/api/github/callback") {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state"), ck = readCookies(request);
    if (!code || !state || state !== ck.gh_state) return new Response("Invalid OAuth state.", { status: 400 });
    if (!clientId || !secret) return new Response("OAuth not configured.", { status: 503 });
    let access = null;
    try {
      const tr = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: secret, code, redirect_uri: REDIRECT_URI }),
      });
      access = (await tr.json()).access_token || null;
    } catch (e) { access = null; }
    const ok = !!access;
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie("gh_state", "", 0));
    if (ok) headers.append("Set-Cookie", cookie("gh_token", access, 3600));
    const html = `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#fff;color:#15171c;padding:32px;text-align:center">
<p>${ok ? "Signed in to GitHub — you can close this window." : "GitHub sign-in failed."}</p>
<script>try{if(window.opener){window.opener.postMessage({qmGitHub:${ok}},"${ORIGIN}");setTimeout(function(){window.close()},400)}else{location.replace("${ORIGIN}/lab?gh=${ok ? 1 : 0}")}}catch(e){location.replace("${ORIGIN}/lab")}</script></body>`;
    return new Response(html, { status: 200, headers });
  }

  if (path === "/api/github/status") {
    // oauthConfigured lets the UI probe availability BEFORE offering "Sign in with
    // GitHub" — when the OAuth app isn't set up, the token path is shown as primary
    // instead of a button that dead-ends in the /login 503.
    const oauthConfigured = !!clientId;
    const ck = readCookies(request);
    if (!ck.gh_token) return json({ signedIn: false, oauthConfigured });
    try {
      const r = await fetch("https://api.github.com/user", { headers: GH_HDR(ck.gh_token) });
      if (!r.ok) return json({ signedIn: false, oauthConfigured }, 200, { "Set-Cookie": cookie("gh_token", "", 0) });
      const u = await r.json();
      return json({ signedIn: true, login: u.login, oauthConfigured });
    } catch (e) { return json({ signedIn: false, oauthConfigured }); }
  }

  if (path === "/api/github/logout") return json({ ok: true }, 200, { "Set-Cookie": cookie("gh_token", "", 0) });

  if (path === "/api/github/create-repo" && request.method === "POST") {
    const ck = readCookies(request);
    if (!ck.gh_token) return json({ error: "not signed in" }, 401);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!name) return json({ error: "missing repo name" }, 400);
    const payload = { name, description: "QuantumMytheme run · " + name, private: !!body.private, include_all_branches: false };
    // no owner → GitHub creates the repo under the signed-in user's own account, which
    // works for everyone; org members opt in by typing QuantumMytheme in the owner field.
    if (body.owner) payload.owner = String(body.owner);
    try {
      const r = await fetch(`https://api.github.com/repos/${TEMPLATE}/generate`, {
        method: "POST",
        headers: { ...GH_HDR(ck.gh_token), "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify(payload),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: out.message || ("HTTP " + r.status) }, r.status);
      return json({ html_url: out.html_url, full_name: out.full_name });
    } catch (e) { return json({ error: String(e) }, 502); }
  }

  return new Response("Not found", { status: 404 });
}

// ---- ANONYMOUS submission to the QuantumMytheme org ------------------------------------
//  Lets a visitor WITHOUT a GitHub sign-in submit a full-stack RECIPE.json as a run repo,
//  using a SERVER-SIDE least-privilege token (never the operator's OAuth session, never in
//  code). FAIL-CLOSED and abuse-guarded — off unless the operator provisions BOTH secrets:
//    - MINT_TOKEN       (encrypted secret): a fine-grained PAT with Administration:write +
//                        Contents:write scoped to the QuantumMytheme org. Least privilege.
//    - TURNSTILE_SECRET (encrypted secret) + TURNSTILE_SITEKEY (plaintext): a Cloudflare
//                        Turnstile widget, so every submission is a human-passed challenge.
//    - (optional) SUBMIT_RATE: a KV namespace binding for per-IP + global daily caps.
//  Anonymous repos are named `community-*` and tagged `community-submission` for moderation.
function submitConfig(env) {
  const enabled = !!(env.MINT_TOKEN && env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY);
  return json({ enabled, sitekey: enabled ? env.TURNSTILE_SITEKEY : null });
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip || undefined }),
    });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

function validateRecipeWorker(r) {
  const errors = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) { errors.push("recipe must be a JSON object"); return { ok: false, errors, attestable: false }; }
  if (!r.hardware || !Array.isArray(r.hardware.chips) || r.hardware.chips.length === 0) errors.push("hardware.chips[] is required — the hardware half");
  if (!r.target && !Array.isArray(r.ingredients)) errors.push("a software half is required — target or ingredients");
  const attestable = !!(r.hardware && Array.isArray(r.hardware.chips) && r.hardware.chips.some((c) => c && c.pinned));
  return { ok: errors.length === 0, errors, attestable };
}

async function submitRun(request, env) {
  // fail-closed: anonymous minting is OFF unless a server token AND bot-protection exist.
  if (!env.MINT_TOKEN || !env.TURNSTILE_SECRET) {
    return json({ error: "anonymous submission is not enabled on this deployment",
      how: "The site owner provisions a least-privilege MINT_TOKEN (fine-grained PAT: Administration:write + Contents:write on QuantumMytheme) and a Turnstile TURNSTILE_SECRET/TURNSTILE_SITEKEY as Cloudflare secrets. Until then, sign in with GitHub or use the template link." }, 503);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const body = await request.json().catch(() => ({}));

  // 1. bot protection — required
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile_token, ip))) {
    return json({ error: "bot-protection check failed — complete the challenge and retry" }, 403);
  }

  // 2. rate limit (per-IP + global daily) when a KV namespace is bound
  const day = new Date().toISOString().slice(0, 10);
  let ipN = 0, allN = 0;
  if (env.SUBMIT_RATE) {
    ipN = parseInt((await env.SUBMIT_RATE.get(`ip:${ip}:${day}`)) || "0", 10);
    allN = parseInt((await env.SUBMIT_RATE.get(`all:${day}`)) || "0", 10);
    if (ipN >= 5) return json({ error: "daily submission limit reached for your address — try tomorrow, or sign in with GitHub" }, 429);
    if (allN >= 300) return json({ error: "the community submission queue is full for today" }, 429);
  }

  // 3. validate the full-stack RECIPE.json
  const recipe = body.recipe;
  const v = validateRecipeWorker(recipe);
  if (!v.ok) return json({ error: "invalid RECIPE.json", problems: v.errors }, 400);

  const base = String(body.name || ("run-" + (recipe.target || "design"))).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 56) || "design";
  const name = "community-" + base;
  const gh = (u, init) => fetch(u, { ...init, headers: { ...GH_HDR(env.MINT_TOKEN), "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" } });

  // 4. create the repo under the org from the template, write RECIPE.json, tag for discovery
  const res = await gh(`https://api.github.com/repos/${TEMPLATE}/generate`, {
    method: "POST",
    body: JSON.stringify({ owner: "QuantumMytheme", name, description: "community full-stack design · " + name, private: false, include_all_branches: false }),
  });
  const repo = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: repo.message || ("repo creation failed (HTTP " + res.status + ")") }, res.status === 422 ? 409 : 502);

  // The RECIPE.json IS the submission — an anonymous submitter can't repair an empty
  // repo, so a failed write means the design would be silently lost. Check the PUT
  // (fetch does not throw on 4xx/5xx), and on failure roll the repo back + fail honestly.
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 2))));
  const put = await gh(`https://api.github.com/repos/${repo.full_name}/contents/RECIPE.json`, {
    method: "PUT", body: JSON.stringify({ message: "Add community full-stack RECIPE.json (hardware + software)", content, branch: repo.default_branch }),
  }).catch(() => null);
  if (!put || !put.ok) {
    await gh(`https://api.github.com/repos/${repo.full_name}`, { method: "DELETE" }).catch(() => {}); // MINT_TOKEN has Administration:write
    return json({ error: "could not write RECIPE.json into the new repo (HTTP " + (put ? put.status : "network") + ") — the submission was rolled back, nothing was kept. Please retry." }, 502);
  }
  await gh(`https://api.github.com/repos/${repo.full_name}/topics`, {
    method: "PUT", body: JSON.stringify({ names: ["quantum-harness-run", "community-submission"] }),
  }).catch(() => {});

  if (env.SUBMIT_RATE) {
    await env.SUBMIT_RATE.put(`ip:${ip}:${day}`, String(ipN + 1), { expirationTtl: 172800 }).catch(() => {});
    await env.SUBMIT_RATE.put(`all:${day}`, String(allN + 1), { expirationTtl: 172800 }).catch(() => {});
  }

  return json({ ok: true, repo: repo.full_name, url: repo.html_url, attestable: v.attestable });
}

// ---- REPLICATION CENSUS — "replicated in-browser ×N" -----------------------------------
//  An anonymous, Turnstile-gated, rate-limited COUNTER of successful in-browser
//  re-verifications of a committed bundle. HONESTY: this is NOT verification — the judge
//  verdict is the authority — and it is deliberately named "replicated in-browser ×N" so
//  it is never conflated with the PR-based "reproduced ×N (attested)" layer in scoreboard/.
//  Storage (SUBMIT_RATE KV, distinct key prefixes so it never collides with submit-run):
//    repl:<sha256>          → {"n": <count>, "last": "YYYY-MM-DD"}   (count + last date ONLY)
//    repl-day:<ip>:<day>    → per-IP daily cap counter, expires in 48h (the only transient
//                             PII; never joined to a bundle hash)
//    repl-day:all:<day>     → global daily cap counter, expires in 48h
//  Fail-closed: OFF unless the operator provisions TURNSTILE_SECRET + TURNSTILE_SITEKEY
//  AND binds the SUBMIT_RATE KV namespace. GET degrades to {enabled:false}; POST 503s.
const CENSUS_SHA_RE = /^[a-f0-9]{64}$/;
const CENSUS_PROBLEMS = new Set([
  // quantum problems (bench/quantum-judge references / scoreboard rows)
  "ghz3", "isingbell2", "bell_pops2", "aiaccel4", "qml_sign1", "h2vqe", "tfim3",
  "bellnoisy2", "ghz3_he", "ghz5_line",
  // TPU-kernel problems (bench/kernel-judge references / scoreboard rows)
  "gemm_bf16_tile1", "gemm_int8_tile1", "roofline_8t_bf16", "roofline_gemm_8t",
  "roofline_gemm_TPU7x", "roofline_gemm_v5e", "roofline_gemm_v5p", "roofline_gemm_v6e",
  "roofline_unpinned",
]);
const CENSUS_IP_DAILY_CAP = 5;
const CENSUS_GLOBAL_DAILY_CAP = 500;

function censusEnabled(env) {
  return !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY && env.SUBMIT_RATE);
}

async function replicationsGet(url, env) {
  // 5-minute public cache: counts are coarse by design and this keeps KV reads cheap.
  const cache = { "Cache-Control": "public, max-age=300" };
  if (!censusEnabled(env)) return json({ enabled: false }, 200, cache);
  const hashes = String(url.searchParams.get("hashes") || "")
    .split(",").map((s) => s.trim().toLowerCase())
    .filter((h) => CENSUS_SHA_RE.test(h))
    .slice(0, 30); // batch bound — the whole board is ~a dozen rows
  const counts = {};
  await Promise.all(hashes.map(async (h) => {
    const raw = await env.SUBMIT_RATE.get("repl:" + h).catch(() => null);
    if (!raw) return;
    try {
      const rec = JSON.parse(raw);
      if (rec && Number.isFinite(rec.n) && rec.n > 0) counts[h] = { n: rec.n, last: String(rec.last || "") };
    } catch (e) { /* corrupt record → treat as uncounted */ }
  }));
  return json({ enabled: true, sitekey: env.TURNSTILE_SITEKEY, counts }, 200, cache);
}

async function replicationsPost(request, env) {
  // fail-closed, same pattern as submitRun: the census is OFF unless bot-protection AND
  // the KV namespace both exist. No partial mode — a Turnstile-less counter is spammable.
  if (!censusEnabled(env)) {
    return json({ error: "the replication census is not enabled on this deployment",
      how: "The site owner provisions a Cloudflare Turnstile widget (TURNSTILE_SECRET encrypted + TURNSTILE_SITEKEY plaintext env vars) and binds a KV namespace named SUBMIT_RATE on the Pages project, then redeploys. Until then, in-browser re-runs still verify — they just aren't counted." }, 503);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const body = await request.json().catch(() => ({}));

  // 1. validate the claim shape BEFORE spending a Turnstile verification
  const sha = String(body.sha256 || "").toLowerCase();
  if (!CENSUS_SHA_RE.test(sha)) return json({ error: "sha256 must be 64 lowercase hex characters (the SHA-256 of the verified bundle bytes)" }, 400);
  const pid = String(body.problem_id || "");
  if (!CENSUS_PROBLEMS.has(pid)) return json({ error: "unknown problem_id — the census only counts re-runs of known harness problems" }, 400);

  // 2. bot protection — required (reuses the submit-run verifier)
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile_token, ip))) {
    return json({ error: "bot-protection check failed — complete the challenge and retry" }, 403);
  }

  // 3. rate limits: per-IP daily cap + global daily cap (both keys expire in 48h)
  const day = new Date().toISOString().slice(0, 10);
  const ipN = parseInt((await env.SUBMIT_RATE.get(`repl-day:${ip}:${day}`)) || "0", 10);
  if (ipN >= CENSUS_IP_DAILY_CAP) return json({ error: "daily replication-record limit reached for your address — your re-runs still verify, they just aren't counted again until tomorrow" }, 429);
  const allN = parseInt((await env.SUBMIT_RATE.get(`repl-day:all:${day}`)) || "0", 10);
  if (allN >= CENSUS_GLOBAL_DAILY_CAP) return json({ error: "the replication census is full for today — try again tomorrow" }, 429);

  // 4. increment the counter. KV is last-write-wins, so two simultaneous clicks can drop
  //    an increment — acceptable for an honest COARSE counter (never over-counts).
  let rec = { n: 0, last: day };
  try {
    const raw = await env.SUBMIT_RATE.get("repl:" + sha);
    if (raw) { const p = JSON.parse(raw); if (p && Number.isFinite(p.n) && p.n >= 0) rec = p; }
  } catch (e) { /* corrupt record → restart the count rather than fail the request */ }
  rec.n = (rec.n | 0) + 1; rec.last = day;
  await env.SUBMIT_RATE.put("repl:" + sha, JSON.stringify(rec));
  await env.SUBMIT_RATE.put(`repl-day:${ip}:${day}`, String(ipN + 1), { expirationTtl: 172800 }).catch(() => {});
  await env.SUBMIT_RATE.put(`repl-day:all:${day}`, String(allN + 1), { expirationTtl: 172800 }).catch(() => {});

  return json({ ok: true, sha256: sha, n: rec.n, last: rec.last });
}
