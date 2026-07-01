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
    const ck = readCookies(request);
    if (!ck.gh_token) return json({ signedIn: false });
    try {
      const r = await fetch("https://api.github.com/user", { headers: GH_HDR(ck.gh_token) });
      if (!r.ok) return json({ signedIn: false }, 200, { "Set-Cookie": cookie("gh_token", "", 0) });
      const u = await r.json();
      return json({ signedIn: true, login: u.login });
    } catch (e) { return json({ signedIn: false }); }
  }

  if (path === "/api/github/logout") return json({ ok: true }, 200, { "Set-Cookie": cookie("gh_token", "", 0) });

  if (path === "/api/github/create-repo" && request.method === "POST") {
    const ck = readCookies(request);
    if (!ck.gh_token) return json({ error: "not signed in" }, 401);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!name) return json({ error: "missing repo name" }, 400);
    const payload = { name, description: "QuantumMytheme run · " + name, private: !!body.private, include_all_branches: false };
    // default new runs to the QuantumMytheme org so results are easy to source
    payload.owner = body.owner ? String(body.owner) : "QuantumMytheme";
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
