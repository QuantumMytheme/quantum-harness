// Cloudflare Pages advanced-mode worker.
// Sole job: canonicalize www -> apex with a 301 (path + query preserved).
// Pages `_redirects` can't match on host, so this thin shim handles it; every
// other request (apex, *.pages.dev preview URLs) is served straight from the
// static assets via env.ASSETS — the site stays fully static otherwise.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.quantummytheme.com") {
      url.hostname = "quantummytheme.com";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
