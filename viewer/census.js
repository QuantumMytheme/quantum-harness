/* census.js — Replication Census: "replicated in-browser ×N".
   Self-contained, CSP-clean (no inline handlers, no eval). An anonymous,
   Turnstile-gated, rate-limited COUNTER of successful in-browser re-verifications
   of committed bundles.

   HONESTY: the census is NOT verification — the judge verdict is the authority.
   It is deliberately worded "replicated in-browser ×N" so it is never conflated
   with the PR-based "reproduced ×N (attested)" badge from scoreboard/.

   DARK-SAFE: if GET /api/replications says {enabled:false} (Turnstile or the
   SUBMIT_RATE KV binding not provisioned), this module renders NOTHING — no
   affordance after a verify, no chips on the board, no styles injected.

   Inputs it builds on (read-only, owned by other modules):
     - document event 'qm:verify-accept' {detail:{problem_id, sha256}} fired by the
       lab runner after a GENUINE in-browser re-verification of a committed bundle.
     - scoreboard rows 'tr.sb-row[data-pid]' rendered by app.js, and
       window.QMRunner.RUNS[pid].bundle for the bundle URL to hash. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;

  var API = '/api/replications';
  var SHA_RE = /^[a-f0-9]{64}$/;
  var HONESTY = 'anonymous in-browser re-runs; the judge verdict is the authority';

  // ---------- tiny utils -----------------------------------------------------------
  function ss(key, val) { // sessionStorage that tolerates absence / private mode
    try {
      if (arguments.length === 2) { sessionStorage.setItem(key, val); return val; }
      return sessionStorage.getItem(key);
    } catch (e) { return null; }
  }

  var styleDone = false;
  function ensureStyle() { // injected lazily: a disabled census leaves ZERO trace in the DOM
    if (styleDone || !document.head) return;
    styleDone = true;
    var st = document.createElement('style');
    st.id = 'qm-census-style';
    st.textContent =
      '.qm-census-chip{display:inline-block;margin-left:8px;padding:1px 7px;border:1px solid var(--rule,#d7d2c8);border-radius:10px;font-size:.68rem;font-weight:400;color:var(--ink-dim,#6d6a63);white-space:nowrap;vertical-align:middle;cursor:help}' +
      '.qm-census-toast{position:fixed;right:18px;bottom:18px;z-index:2600;max-width:340px;background:var(--paper,#fdfcf9);border:1px solid var(--rule,#d7d2c8);border-radius:6px;box-shadow:0 16px 44px -16px rgba(0,0,0,.35);padding:14px 16px 12px;font-size:.85rem;line-height:1.45}' +
      '.qm-census-toast .qm-census-x{position:absolute;top:4px;right:8px;border:0;background:none;font-size:1rem;line-height:1;color:var(--ink-dim,#6d6a63);cursor:pointer;padding:4px}' +
      '.qm-census-toast .qm-census-btn{margin-top:8px;padding:5px 12px;border:1px solid var(--ink,#15171c);background:var(--ink,#15171c);color:var(--paper,#fdfcf9);border-radius:4px;font-size:.8rem;cursor:pointer}' +
      '.qm-census-toast .qm-census-btn[disabled]{opacity:.6;cursor:default}' +
      '.qm-census-toast .qm-census-fine{margin-top:8px;font-size:.68rem;color:var(--ink-dim,#6d6a63)}' +
      '.qm-census-toast .qm-census-slot{margin-top:8px}';
    document.head.appendChild(st);
  }

  // ---------- enabled probe (one fetch per page, shared) ----------------------------
  var probeP = null;
  function probe() {
    if (!probeP) {
      probeP = fetch(API)
        .then(function (r) { return r.json(); })
        .catch(function () { return { enabled: false }; });
    }
    return probeP;
  }

  // ---------- bundle hashing (matches the verifier: SHA-256 of the bundle bytes) ----
  function hashBundle(url) {
    var cached = ss('qm-census-sha:' + url);
    if (cached && SHA_RE.test(cached)) return Promise.resolve(cached);
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return crypto.subtle.digest('SHA-256', buf); })
      .then(function (dig) {
        var h = Array.prototype.map.call(new Uint8Array(dig), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        ss('qm-census-sha:' + url, h);
        return h;
      });
  }

  function bundleFor(pid) {
    var R = (typeof window !== 'undefined' && window.QMRunner && window.QMRunner.RUNS) || {};
    return (R[pid] && R[pid].bundle) || null;
  }

  // ---------- scoreboard decoration -------------------------------------------------
  function decorateRows(rows) {
    probe().then(function (cfg) {
      if (!cfg || !cfg.enabled) return; // dark-safe: disabled → render NOTHING
      var jobs = [];
      Array.prototype.forEach.call(rows, function (row) {
        var pid = row.getAttribute && row.getAttribute('data-pid');
        var url = pid && bundleFor(pid);
        if (!url) return;
        jobs.push(hashBundle(url)
          .then(function (h) { return { row: row, h: h }; })
          .catch(function () { return null; }));
      });
      if (!jobs.length) return;
      Promise.all(jobs).then(function (list) {
        list = list.filter(Boolean);
        var hashes = [];
        list.forEach(function (it) { if (hashes.indexOf(it.h) < 0) hashes.push(it.h); });
        if (!hashes.length) return;
        return fetch(API + '?hashes=' + hashes.join(','))
          .then(function (r) { return r.json(); })
          .then(function (out) {
            if (!out || !out.enabled || !out.counts) return;
            list.forEach(function (it) {
              var c = out.counts[it.h];
              if (!c || !c.n) return;
              var td = it.row.querySelector && it.row.querySelector('td');
              if (!td) return;
              if (it.row.querySelector('.qm-census-chip')) return; // idempotent
              ensureStyle();
              var chip = document.createElement('span');
              chip.className = 'qm-census-chip';
              chip.title = HONESTY + ' — an anonymous counter, distinct from "reproduced ×N (attested)"';
              chip.textContent = 'replicated in-browser ×' + c.n + (c.last ? ' · ' + c.last : '');
              td.appendChild(chip);
            });
          });
      }).catch(function () { /* decoration is best-effort */ });
    }).catch(function () { /* dark-safe */ });
  }

  function startDecorate() {
    var tries = 0;
    (function tick() {
      var rows = document.querySelectorAll ? document.querySelectorAll('tr.sb-row[data-pid]') : [];
      if (rows && rows.length) { decorateRows(rows); return; }
      if (++tries < 6) setTimeout(tick, 500); // rows render client-side; give app.js a moment
    })();
  }

  // ---------- "Record your replication?" affordance ---------------------------------
  function loadTurnstile(cb) { // shares the loader id with runner.js — one script, ever
    if (window.turnstile) return cb();
    if (document.getElementById('qm-ts-script')) {
      var iv = setInterval(function () { if (window.turnstile) { clearInterval(iv); cb(); } }, 120);
      setTimeout(function () { clearInterval(iv); cb(); }, 8000);
      return;
    }
    var s = document.createElement('script');
    s.id = 'qm-ts-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = cb;
    document.head.appendChild(s);
  }

  function offer(pid, sha, sitekey) {
    if (ss('qm-census-done:' + sha)) return;          // already recorded this session
    if (document.getElementById('qm-census-toast')) return; // one affordance at a time
    ensureStyle();

    var t = document.createElement('div');
    t.id = 'qm-census-toast';
    t.className = 'qm-census-toast';
    t.setAttribute('role', 'status');

    var x = document.createElement('button');
    x.type = 'button'; x.className = 'qm-census-x'; x.textContent = '×';
    x.setAttribute('aria-label', 'dismiss');
    x.addEventListener('click', function () { if (t.parentNode) t.parentNode.removeChild(t); });

    var msg = document.createElement('div');
    msg.className = 'qm-census-msg';
    msg.textContent = 'Judge accepted — you just re-verified ' + pid + ' in your browser. Record your replication?';

    var slot = document.createElement('div');
    slot.className = 'qm-census-slot';

    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'qm-census-btn'; btn.textContent = 'Record it';
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = 'loading check…';
      t.setAttribute('data-busy', '1');
      loadTurnstile(function () {
        if (!window.turnstile) { msg.textContent = 'could not load the bot check — nothing was recorded.'; return; }
        btn.style.display = 'none';
        window.turnstile.render(slot, {
          sitekey: sitekey, theme: 'auto',
          callback: function (token) { record(pid, sha, token, t, msg, slot); },
        });
      });
    });

    var fine = document.createElement('div');
    fine.className = 'qm-census-fine';
    fine.title = HONESTY;
    fine.textContent = 'Anonymous, rate-limited counter — not verification; the judge verdict is the authority.';

    t.appendChild(x); t.appendChild(msg); t.appendChild(slot); t.appendChild(btn); t.appendChild(fine);
    document.body.appendChild(t);
    // non-blocking: quietly leaves if ignored (unless the visitor started the flow)
    setTimeout(function () {
      if (t.parentNode && !t.getAttribute('data-busy')) t.parentNode.removeChild(t);
    }, 45000);
  }

  function record(pid, sha, token, t, msg, slot) {
    msg.textContent = 'recording…';
    fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem_id: pid, sha256: sha, turnstile_token: token }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (slot.parentNode) slot.parentNode.removeChild(slot);
        if (res.ok && res.j && res.j.ok) {
          ss('qm-census-done:' + sha, '1');
          msg.textContent = 'recorded — this bundle now replicated in-browser ×' + res.j.n + '.';
          setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 8000);
        } else {
          msg.textContent = (res.j && res.j.error) || 'could not record — nothing was stored.';
          setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 10000);
        }
      })
      .catch(function () {
        if (slot.parentNode) slot.parentNode.removeChild(slot);
        msg.textContent = 'network error — nothing was recorded.';
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 8000);
      });
  }

  // ---------- wiring ----------------------------------------------------------------
  document.addEventListener('qm:verify-accept', function (ev) {
    var d = (ev && ev.detail) || {};
    var sha = String(d.sha256 || '').toLowerCase();
    if (!d.problem_id || !SHA_RE.test(sha)) return; // only genuine, well-formed verifications
    probe().then(function (cfg) {
      if (cfg && cfg.enabled && cfg.sitekey) offer(String(d.problem_id), sha, cfg.sitekey);
      // disabled → never show the affordance (dark-safe)
    }).catch(function () { /* dark-safe */ });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDecorate);
  else startDecorate();
})();
