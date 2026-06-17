/* QuantumMytheme · education.js — self-contained, dependency-free, file://-safe.
   Each curriculum animation is EDU["<id>"] = function (canvas, controls, K) { ... }.
   K is the shared toolkit; the harness below mounts each module lazily the first
   time its canvas scrolls into view, and pauses its loop when it scrolls away. */
(function () {
  'use strict';
  var docEl = document.documentElement;

  // ---- theme + reduced motion ------------------------------------------------
  function dark() { return docEl.getAttribute('data-theme') === 'dark'; }
  function cssVar(name) { return getComputedStyle(docEl).getPropertyValue(name).trim(); }
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var themeSubs = [];
  function onTheme(cb) { themeSubs.push(cb); }
  if (window.MutationObserver) {
    new MutationObserver(function () {
      for (var i = 0; i < themeSubs.length; i++) { try { themeSubs[i](); } catch (e) {} }
    }).observe(docEl, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // ---- per-canvas toolkit ----------------------------------------------------
  function makeK(canvas) {
    var recs = [];
    function fit() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 600;
      var h = canvas.clientHeight || 340;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx: ctx, w: w, h: h };
    }
    function schedule(rec) {
      function step(t) { if (!rec.on) return; try { rec.fn(t); } catch (e) {} rec.id = requestAnimationFrame(step); }
      rec.id = requestAnimationFrame(step);
    }
    return {
      fit: fit,
      v: cssVar,
      dark: dark,
      reduced: reduced,
      onTheme: onTheme,
      C: function (re, im) { return { re: re, im: im || 0 }; },
      cadd: function (a, b) { return { re: a.re + b.re, im: a.im + b.im }; },
      cmul: function (a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; },
      cconj: function (a) { return { re: a.re, im: -a.im }; },
      cabs: function (a) { return Math.hypot(a.re, a.im); },
      loop: function (fn) {
        var rec = { fn: fn, id: 0, on: true };
        recs.push(rec);
        schedule(rec);
        return function () { rec.on = false; cancelAnimationFrame(rec.id); };
      },
      _pause: function () { for (var i = 0; i < recs.length; i++) { var r = recs[i]; if (r.on) { r.on = false; cancelAnimationFrame(r.id); } } },
      _resume: function () { for (var i = 0; i < recs.length; i++) { var r = recs[i]; if (!r.on) { r.on = true; schedule(r); } } }
    };
  }

  // ============================ MODULE ANIMATIONS ============================
  var EDU = {};
    // ───── rules-to-learning ─────
  EDU["rules-to-learning"] = function (canvas, controls, K) {
  // ---- one-time deterministic setup ----------------------------------------
  var fit = K.fit();
  var W = Math.max(1, fit.w), H = Math.max(1, fit.h);

  // hidden 'true' wavy boundary, in CSS px. Re-derived from W,H each refit.
  function yb(x, w, h) { return (h * 0.5) + 46 * Math.sin(x / Math.max(1, w) * 3.2); }

  // seeded LCG -> 28 fixed points, label assigned FROM yb (so the learned
  // boundary is, by construction, consistent with every label).
  function makeData(w, h) {
    var seed = 12345;
    var rng = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    var pts = [], i;
    for (i = 0; i < 28; i++) {
      var px = 26 + rng() * (w - 52);
      var py = 26 + rng() * (h - 52);
      var b = yb(px, w, h);
      if (rng() < 0.32) { py = b + (rng() - 0.5) * 30; } // small margin near boundary
      var cls = (py < b) ? 0 : 1; // 0 = class A, 1 = class B
      pts.push({ x: px, y: py, cls: cls, wrong: false });
    }
    return pts;
  }

  // 4 horizontals + 3 risers = 7 axis-aligned staircase strokes crudely
  // approximating the boundary — the hand-written rulebook.
  function makeStaircase(w, h) {
    var segs = [];
    var cols = [0, w * 0.27, w * 0.52, w * 0.78, w];
    var prevY = null, k;
    for (k = 0; k < 4; k++) {
      var xa = cols[k], xb = cols[k + 1], xm = (xa + xb) * 0.5;
      var ya = yb(xm, w, h);
      ya = Math.round(ya / 24) * 24; // quantize -> deliberately crude staircase
      if (prevY !== null) segs.push({ x0: xa, y0: prevY, x1: xa, y1: ya, v: true });
      segs.push({ x0: xa, y0: ya, x1: xb, y1: ya, v: false });
      prevY = ya;
    }
    return segs;
  }

  // the staircase's threshold (its horizontal run) at a given x
  function stairY(p, segs, h) {
    var i, s;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!s.v && p.x >= Math.min(s.x0, s.x1) && p.x <= Math.max(s.x0, s.x1)) return s.y0;
    }
    return h * 0.5;
  }
  function staircaseClass(p, segs, h) { return (p.y < stairY(p, segs, h)) ? 0 : 1; }

  var data, stairs, wrong;
  // GUARANTEE exactly 3 honest "rule errors": points the staircase puts on the
  // WRONG side while the learned boundary yb classifies them CORRECTLY. Take any
  // natural disagreements first; if fewer than 3, deterministically nudge spare
  // points into the gap between the staircase line and yb (which always sits on
  // the staircase-wrong / yb-correct side) and relabel from yb so the data stays
  // consistent with the learned boundary.
  function rebuild() {
    data = makeData(W, H);
    stairs = makeStaircase(W, H);
    var picks = [], i;
    for (i = 0; i < data.length; i++) {
      if (staircaseClass(data[i], stairs, H) !== data[i].cls) picks.push(i);
    }
    for (i = 0; i < data.length && picks.length < 3; i++) {
      if (picks.indexOf(i) >= 0) continue;
      var p = data[i], b = yb(p.x, W, H), sy = stairY(p, stairs, H);
      if (Math.abs(sy - b) < 8) continue; // need a usable gap to land in
      var mid = (b + sy) * 0.5;
      p.y = mid; p.cls = (mid < b) ? 0 : 1; // relabel from yb -> still consistent
      if (staircaseClass(p, stairs, H) !== p.cls) picks.push(i);
    }
    for (i = 0; i < data.length; i++) data[i].wrong = false;
    wrong = picks.slice(0, 3);
    for (i = 0; i < wrong.length; i++) data[wrong[i]].wrong = true;
  }
  rebuild();

  function nearest(x, y) {
    var best = null, bd = Infinity, i;
    for (i = 0; i < data.length; i++) {
      var dx = data[i].x - x, dy = data[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = data[i]; }
    }
    return best || { x: x, y: y };
  }

  // ---- controls -------------------------------------------------------------
  var modeChip = document.createElement("span");
  modeChip.className = "chip";
  modeChip.textContent = "learning…";
  var replayBtn = document.createElement("button");
  replayBtn.className = "btn"; replayBtn.type = "button"; replayBtn.textContent = "replay";
  var hint = document.createElement("span");
  hint.className = "chip";
  hint.textContent = "hover / click canvas: rules ↔ learned";
  controls.appendChild(modeChip);
  controls.appendChild(replayBtn);
  controls.appendChild(hint);

  // ---- timeline state -------------------------------------------------------
  var t = 0, last = 0, holdUntil = 0, stop = null;
  var snapMode = null; // null = animating; 'rules' / 'learned' = static toggle

  function smooth(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  // ---- drawing --------------------------------------------------------------
  function colors() {
    return {
      bg: K.v("bg") || "#fff", ink: K.v("ink") || "#111", faint: K.v("faint") || "#888",
      A: K.v("accent") || "#28489e", B: K.v("accent-2") || "#6a3fb0", reject: K.v("reject") || "#b32a1f",
      mono: K.v("mono") || "monospace"
    };
  }

  function draw(ctx, tt, now, forced) {
    var c = colors();
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    var showRules, segAlpha, segMelt, ptAlpha, boundaryProg, ringsOn, corrected;
    if (forced === "rules") {
      showRules = true; segAlpha = 1; segMelt = 0; ptAlpha = 1;
      boundaryProg = 0; ringsOn = true; corrected = false;
    } else if (forced === "learned") {
      showRules = false; segAlpha = 0; segMelt = 1; ptAlpha = 1;
      boundaryProg = 1; ringsOn = false; corrected = true;
    } else {
      // RULES [0,0.4]  DISSOLVE [0.4,0.6]  LEARN [0.6,1]
      segAlpha = (tt > 0.4) ? clamp01((0.6 - tt) / 0.2) : clamp01(tt / 0.1);
      segMelt = (tt <= 0.4) ? 0 : smooth(clamp01((tt - 0.4) / 0.2));
      showRules = segAlpha > 0.001;
      // points (and their misclassification rings) fade in DURING the RULES phase
      // so the rulebook's errors are visible while the rules are the focus.
      ptAlpha = clamp01((tt - 0.08) / 0.1);
      boundaryProg = clamp01((tt - 0.6) / 0.35);
      ringsOn = tt < 1;     // rings persist through RULES + DISSOLVE, drop once learned
      corrected = tt >= 1;
    }

    // (1)+(2) staircase, melting toward nearest data points
    if (showRules) {
      ctx.save();
      ctx.globalAlpha = segAlpha;
      ctx.strokeStyle = c.ink; ctx.lineWidth = 2;
      var i;
      for (i = 0; i < stairs.length; i++) {
        var s = stairs[i];
        var jx = Math.sin(i * 1.7 + now / 300) * 1.5, jy = Math.sin(i * 2.3 + now / 300) * 1.5;
        var x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1;
        if (segMelt > 0) {
          var n0 = nearest(x0, y0), n1 = nearest(x1, y1);
          x0 += (n0.x - x0) * segMelt; y0 += (n0.y - y0) * segMelt;
          x1 += (n1.x - x1) * segMelt; y1 += (n1.y - y1) * segMelt;
        }
        ctx.beginPath(); ctx.moveTo(x0 + jx, y0 + jy); ctx.lineTo(x1 + jx, y1 + jy); ctx.stroke();
      }
      ctx.globalAlpha = segAlpha * 0.9;
      ctx.fillStyle = c.faint; ctx.font = "11px " + c.mono;
      var hcount = 0;
      for (i = 0; i < stairs.length && hcount < 2; i++) {
        if (!stairs[i].v) {
          var lab = hcount === 0 ? "IF x<a → A" : "ELSE → B";
          var lx = (stairs[i].x0 + stairs[i].x1) * 0.5;
          ctx.fillText(lab, Math.max(4, Math.min(lx, W - 84)), stairs[i].y0 - 6);
          hcount++;
        }
      }
      ctx.restore();
    }

    // (3) the 28 points (drawn from RULES phase onward), with rule-error rings
    if (ptAlpha > 0) {
      var pi;
      for (pi = 0; pi < data.length; pi++) {
        var p = data[pi];
        ctx.save();
        ctx.globalAlpha = ptAlpha;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = (p.cls === 0) ? c.A : c.B; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = c.bg; ctx.stroke();
        if (p.wrong && ringsOn) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
          ctx.strokeStyle = c.reject; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.restore();
      }
    }

    // (4) learned boundary, progressively revealed with a settling wobble
    if (boundaryProg > 0) {
      var xMax = W * boundaryProg, wob = 6 * (1 - boundaryProg);
      ctx.save();
      ctx.strokeStyle = c.faint; ctx.lineWidth = 2.5;
      ctx.beginPath();
      var started = false, x;
      for (x = 0; x <= xMax; x += 6) {
        var y = yb(x, W, H) + Math.sin(x / 26 + now / 400) * wob;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (corrected) {
      ctx.save();
      ctx.globalAlpha = 0.9; ctx.fillStyle = c.faint; ctx.font = "11px " + c.mono;
      ctx.fillText("fit corrected " + wrong.length + " rule errors", 8, H - 8);
      ctx.restore();
    }
  }

  // ---- loop control ---------------------------------------------------------
  function startTimeline() {
    snapMode = null; t = 0; last = 0; holdUntil = 0;
    modeChip.textContent = "learning…";
    if (stop) { stop(); stop = null; }
    stop = K.loop(function (now) {
      var f = K.fit(); // refit each frame (cheap) so resize/dpr changes track
      if (f.w !== W || f.h !== H) { W = Math.max(1, f.w); H = Math.max(1, f.h); rebuild(); }
      var ctx = f.ctx;
      if (last === 0) last = now;
      var dt = (now - last) / 1400; last = now;
      if (dt < 0) dt = 0; if (dt > 0.1) dt = 0.1; // clamp jumps (e.g. after pause/resume)
      if (t < 1) { t = Math.min(1, t + dt); if (t >= 1) holdUntil = now + 600; }
      draw(ctx, t, now, null);
      if (t >= 1 && now >= holdUntil) {
        modeChip.textContent = "learned";
        if (stop) { stop(); stop = null; }
      }
    });
  }

  function showStatic(mode) {
    snapMode = mode;
    if (stop) { stop(); stop = null; }
    modeChip.textContent = (mode === "rules") ? "rules" : "learned";
    var f = K.fit(); W = Math.max(1, f.w); H = Math.max(1, f.h);
    draw(f.ctx, mode === "rules" ? 0 : 1, nowMs(), mode);
  }

  // ---- interaction ----------------------------------------------------------
  // click: if currently on 'rules', replay the dissolve->learn animation;
  // otherwise (learned / mid-animation) snap to the static 'rules' view.
  function flip() {
    if (snapMode === "rules") startTimeline();
    else showStatic("rules");
  }

  canvas.style.cursor = "pointer";
  canvas.addEventListener("click", function () {
    if (K.reduced) showStatic(snapMode === "rules" ? "learned" : "rules");
    else flip();
  });
  canvas.addEventListener("mouseenter", function () { if (snapMode === "rules") showStatic("learned"); });
  canvas.addEventListener("mouseleave", function () { if (snapMode === "learned") showStatic("rules"); });
  replayBtn.addEventListener("click", function () { if (K.reduced) showStatic("learned"); else startTimeline(); });

  // ---- theme + reduced motion ----------------------------------------------
  K.onTheme(function () {
    var f = K.fit(); W = Math.max(1, f.w); H = Math.max(1, f.h);
    rebuild(); // geometry tracks the box
    // running animation will repaint itself; static states must repaint here
    if (K.reduced || snapMode) {
      var sm = snapMode || "learned";
      draw(f.ctx, sm === "rules" ? 0 : 1, nowMs(), sm);
    }
  });

  // ---- boot -----------------------------------------------------------------
  if (K.reduced) { snapMode = "learned"; modeChip.textContent = "learned"; draw(fit.ctx, 1, 0, "learned"); }
  else startTimeline();
};

  // ───── machine-learning ─────
  EDU["machine-learning"] = function (canvas, controls, K) {
  // ===================================================================
  // "Learning a boundary" — supervised learning / overfitting demo.
  // A flexibility slider morphs a single-valued boundary y=yb(x) from the
  // smooth true rule (low frequency, best generalizer) to a jagged curve
  // that threads individual TRAIN points — including ~13% label NOISE.
  // trainAcc climbs to 100% while testAcc peaks at moderate flexibility
  // then falls once the wiggles start chasing noise. The whole layout is
  // built from a FIXED seed whose sweep was verified to show that turnover.
  // ===================================================================

  // ---- deterministic PRNG (mulberry32) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function smoothstep(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // standard-normal sampler (Box-Muller) sharing one spare value
  var gSpare = null;
  function grand(rng) {
    if (gSpare !== null) { var g = gSpare; gSpare = null; return g; }
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    var R = Math.sqrt(-2 * Math.log(u));
    gSpare = R * Math.sin(2 * Math.PI * v);
    return R * Math.cos(2 * Math.PI * v);
  }

  // fixed class colors (also distinguished by SHAPE) — readable on white & dark
  var COL_A = "#2563eb";   // class A (blue), circle
  var COL_B = "#e0533d";   // class B (warm red), triangle

  // ---- geometry: generate against a reference box, map to live size ----
  var REFW = 600, REFH = 300, PAD = 16;

  // true low-frequency rule: A below the baseline sinusoid, B above.
  function sRef(x) { return 0.5 * REFH - 0.34 * REFH * Math.sin(2 * Math.PI * x / REFW); }

  // ---- generate points once (FIXED seed; verified to show the turnover) ----
  var SEED = 2808, NTOT = 120, NTRAIN = 80, FLIP = 0.13;
  var rng = mulberry32(SEED);
  var pts = [];
  for (var i = 0; i < NTOT; i++) {
    var x = rng() * REFW, b = sRef(x);
    var cls = rng() < 0.5 ? 0 : 1;        // pick class, then place y on its side
    var off = Math.abs(grand(rng)) * 0.09 * REFH + 6;  // most points sit near the boundary
    var y = cls === 0 ? b - off : b + off;
    if (y < 5) y = 5; if (y > REFH - 5) y = REFH - 5;
    pts.push({ x: x, y: y, cls: cls, isTrain: i < NTRAIN, flipped: false });
  }
  // label NOISE: flip ~13% (the noise a wiggly curve chases)
  var nFlip = Math.round(FLIP * NTOT), idx = [];
  for (var k = 0; k < NTOT; k++) idx.push(k);
  for (var s = NTOT - 1; s > 0; s--) { var j = Math.floor(rng() * (s + 1)); var tmp = idx[s]; idx[s] = idx[j]; idx[j] = tmp; }
  for (var f = 0; f < nFlip; f++) { var p = pts[idx[f]]; p.cls = 1 - p.cls; p.flipped = true; }

  var trainPts = pts.filter(function (q) { return q.isTrain; });
  var testPts = pts.filter(function (q) { return !q.isTrain; });

  // ---- boundary model: per-x-bin threshold (the spec's "simpler implementation") ----
  // The boundary is single-valued y=yb(x). Split x into B bins; each bin's height is
  // the threshold that best classifies the TRAIN points inside it (predict A if y<thr,
  // else B; ties resolved toward the smooth prior sRef). B grows 1 -> ~1.6*NTRAIN with
  // flexibility t, so at high t nearly every bin holds <=1 train point and the curve
  // threads each one (train -> 100%, chasing the flips); at low t a single bin gives
  // the smooth rule (the best generalizer). Same low-frequency-generalizes /
  // high-frequency-overfits mechanism as the harness's Ry(x) vs Ry(7x) classify gate.
  var BMIN = 1, BMAX = Math.round(NTRAIN * 1.6), MARGIN = 4;
  function Bof(t) { return Math.max(BMIN, Math.round(BMIN + smoothstep(t) * (BMAX - BMIN))); }

  function fitBins(B) {
    var thr = new Array(B), bk = [];
    for (var bi0 = 0; bi0 < B; bi0++) bk.push([]);
    for (var jj = 0; jj < trainPts.length; jj++) {
      var pp = trainPts[jj], bi = Math.floor(pp.x / REFW * B);
      if (bi < 0) bi = 0; if (bi >= B) bi = B - 1;
      bk[bi].push(pp);
    }
    for (var b2 = 0; b2 < B; b2++) {
      var cx = (b2 + 0.5) / B * REFW, prior = sRef(cx), inBin = bk[b2];
      if (inBin.length === 0) { thr[b2] = prior; continue; }
      // candidate thresholds: just past each point's labelled side, plus extremes + prior
      var cands = [-20, REFH + 20, prior];
      for (var c = 0; c < inBin.length; c++) { cands.push(inBin[c].y - MARGIN); cands.push(inBin[c].y + MARGIN); }
      var best = prior, bestErr = Infinity, bestDist = Infinity;
      for (var ci = 0; ci < cands.length; ci++) {
        var T = cands[ci], err = 0;
        for (var m = 0; m < inBin.length; m++) { if (((inBin[m].y < T) ? 0 : 1) !== inBin[m].cls) err++; }
        var dist = Math.abs(T - prior);
        if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) < 1e-9 && dist < bestDist - 1e-9)) {
          bestErr = err; best = T; bestDist = dist;
        }
      }
      thr[b2] = best;
    }
    return thr;
  }

  // cache fitted bins per B so dragging the slider is cheap
  var binCache = {};
  function binsFor(t) { var B = Bof(t); if (!binCache[B]) binCache[B] = fitBins(B); return { B: B, thr: binCache[B] }; }

  // threshold of the bin a given x falls in (the actual classifier — step function)
  function thrAt(xRef, bf) {
    var b = Math.floor(xRef / REFW * bf.B);
    if (b < 0) b = 0; if (b >= bf.B) b = bf.B - 1;
    return bf.thr[b];
  }
  function accuracy(arr, bf) {
    if (!arr.length) return 0;
    var ok = 0;
    for (var a = 0; a < arr.length; a++) { if (((arr[a].y < thrAt(arr[a].x, bf)) ? 0 : 1) === arr[a].cls) ok++; }
    return ok / arr.length;
  }

  // ---- sweep test accuracy across t to mark the "best generalization" point ----
  var bestT = 0, bestTest = -1;
  for (var st = 0; st <= 1.0001; st += 0.02) {
    var ta = accuracy(testPts, binsFor(st));
    if (ta > bestTest + 1e-9) { bestTest = ta; bestT = st; }
  }

  // ============================ CONTROLS ============================
  controls.innerHTML = "";
  var row = document.createElement("div");
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.alignItems = "center";
  row.style.gap = "14px";
  controls.appendChild(row);

  var lblWrap = document.createElement("label");
  lblWrap.className = "chip";
  lblWrap.style.display = "flex";
  lblWrap.style.alignItems = "center";
  lblWrap.style.gap = "8px";
  var lblTxt = document.createElement("span");
  lblTxt.textContent = "flexibility";
  var slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0"; slider.max = "1"; slider.step = "0.01"; slider.value = "0.3";
  slider.style.verticalAlign = "middle";
  lblWrap.appendChild(lblTxt);
  lblWrap.appendChild(slider);
  row.appendChild(lblWrap);

  var togWrap = document.createElement("label");
  togWrap.className = "chip";
  togWrap.style.display = "flex";
  togWrap.style.alignItems = "center";
  togWrap.style.gap = "6px";
  var toggle = document.createElement("input");
  toggle.type = "checkbox";
  var togTxt = document.createElement("span");
  togTxt.textContent = "show held-out test points";
  togWrap.appendChild(toggle);
  togWrap.appendChild(togTxt);
  row.appendChild(togWrap);

  // ============================ STATE / FIT ============================
  var fitState = K.fit();
  var ctx = fitState.ctx, W = fitState.w, H = fitState.h;
  var userControlled = false;
  var t = 0.3;
  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  slider.addEventListener("input", function () {
    userControlled = true;
    t = parseFloat(slider.value);
    if (K.reduced) draw(now());
  });
  toggle.addEventListener("change", function () {
    if (K.reduced) draw(now());
  });

  // map reference coords -> live canvas (with padding)
  function mx(xr) { return PAD + (xr / REFW) * (W - 2 * PAD); }
  function my(yr) { return PAD + (yr / REFH) * (H - 2 * PAD); }

  // boundary polyline (in live px) from the bin thresholds — the SAME function that
  // classifies the points, so the drawn line literally is the decision boundary.
  function boundaryPoly(bf) {
    var poly = [], step = REFW / 240;
    for (var xr = 0; xr <= REFW + 0.001; xr += step) poly.push([mx(xr), my(thrAt(xr, bf))]);
    return poly;
  }

  // ============================ DRAW ============================
  function drawPoint(p, cx, cy, r, inkOutline) {
    var col = (p.cls === 0) ? COL_A : COL_B;
    if (!p.isTrain) {
      // held-out test: hollow SQUARE so it reads as "unseen"
      var s2 = r * 1.15;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.rect(cx - s2, cy - s2, s2 * 2, s2 * 2);
      ctx.stroke();
      return;
    }
    // train: solid, class shape (circle vs triangle), ink outline for theme contrast
    ctx.beginPath();
    if (p.cls === 0) {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else {
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r * 1.05, cy + r * 0.85);
      ctx.lineTo(cx - r * 1.05, cy + r * 0.85);
      ctx.closePath();
    }
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = inkOutline;
    ctx.stroke();
  }

  function bar(x, y, w, h, frac, col, bg, ink) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.globalAlpha = 1;
  }

  function draw(tMs) {
    // ensure cached size is valid (refit if a prior fit returned 0)
    if (!W || !H) { var fs0 = K.fit(); ctx = fs0.ctx; W = fs0.w; H = fs0.h; }

    // idle auto-sweep until the user touches the slider
    if (!userControlled && !K.reduced) {
      t = 0.5 + 0.5 * Math.sin(tMs * 0.0004);
      slider.value = t.toFixed(2);
    }

    var ink = K.v("--ink") || (K.dark() ? "#eaedff" : "#15171c");
    var ink2 = K.v("--ink-2") || ink;
    var faint = K.v("--faint") || ink2;
    var bg = K.v("--bg") || (K.dark() ? "#0f1115" : "#ffffff");
    var rule = K.v("--rule") || faint;

    var bf = binsFor(t);
    var poly = boundaryPoly(bf);

    ctx.clearRect(0, 0, W, H);

    // faint region fills: above boundary (smaller y / top) = class A (blue),
    // below boundary (larger y / bottom) = class B (red) — matches y<thr -> A.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, PAD, W - 2 * PAD, H - 2 * PAD);
    ctx.clip();
    ctx.globalAlpha = 0.08;
    // region A = above the boundary line, up to the top (my(0))
    ctx.fillStyle = COL_A;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var pa = 1; pa < poly.length; pa++) ctx.lineTo(poly[pa][0], poly[pa][1]);
    ctx.lineTo(mx(REFW), my(0));
    ctx.lineTo(mx(0), my(0));
    ctx.closePath();
    ctx.fill();
    // region B = below the boundary line, down to the bottom (my(REFH))
    ctx.fillStyle = COL_B;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var pb = 1; pb < poly.length; pb++) ctx.lineTo(poly[pb][0], poly[pb][1]);
    ctx.lineTo(mx(REFW), my(REFH));
    ctx.lineTo(mx(0), my(REFH));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // boundary polyline in resolved ink (clipped to the plot)
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD - 1, PAD - 1, W - 2 * PAD + 2, H - 2 * PAD + 2);
    ctx.clip();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var pc = 1; pc < poly.length; pc++) ctx.lineTo(poly[pc][0], poly[pc][1]);
    ctx.stroke();
    ctx.restore();

    // points (train always; test only when toggled on)
    var showTest = toggle.checked;
    for (var i3 = 0; i3 < pts.length; i3++) {
      var pt = pts[i3];
      if (!pt.isTrain && !showTest) continue;
      drawPoint(pt, mx(pt.x), my(pt.y), 4.2, ink);
    }

    // ---- scoring & readouts (computed from the drawn boundary) ----
    var trainAcc = accuracy(trainPts, bf);
    var testAcc = accuracy(testPts, bf);

    ctx.textBaseline = "alphabetic";

    // translucent backing so the readout stays legible over the region fills
    ctx.globalAlpha = K.dark() ? 0.55 : 0.80;
    ctx.fillStyle = bg;
    ctx.fillRect(PAD + 2, PAD + 2, 168, 58);
    ctx.globalAlpha = 1;

    var panelX = PAD + 8, panelY = PAD + 6;
    ctx.font = "12px " + (K.v("--mono") || "monospace");
    ctx.fillStyle = ink;
    ctx.fillText("train acc  " + (trainAcc * 100).toFixed(0) + "%", panelX, panelY + 11);
    bar(panelX, panelY + 16, 120, 6, trainAcc, COL_A, rule, ink);
    ctx.fillStyle = ink;
    ctx.fillText("test acc   " + (testAcc * 100).toFixed(0) + "%", panelX, panelY + 39);
    bar(panelX, panelY + 44, 120, 6, testAcc, COL_B, rule, ink);

    // flexibility scale with the "best generalization" guide along the bottom
    var scaleY = H - PAD - 12;
    var scaleX0 = PAD + 8, scaleW = Math.max(60, Math.min(220, W - 2 * PAD - 16));

    ctx.globalAlpha = K.dark() ? 0.5 : 0.74;
    ctx.fillStyle = bg;
    ctx.fillRect(PAD + 2, scaleY - 26, scaleW + 12, 44);
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scaleX0, scaleY);
    ctx.lineTo(scaleX0 + scaleW, scaleY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // best-generalization tick + label
    var bgx = scaleX0 + bestT * scaleW;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = faint;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bgx, scaleY - 9);
    ctx.lineTo(bgx, scaleY + 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = faint;
    ctx.font = "10px " + (K.v("--mono") || "monospace");
    ctx.fillText("best generalization", clamp(bgx - 52, scaleX0, scaleX0 + scaleW - 96), scaleY - 12);

    // current-t marker + label
    var curx = scaleX0 + clamp(t, 0, 1) * scaleW;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(curx, scaleY, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink2;
    ctx.fillText("flexibility", scaleX0, scaleY + 16);
  }

  // theme change: refit canvas + re-read colors on the next frame
  K.onTheme(function () {
    var fs = K.fit();
    ctx = fs.ctx; W = fs.w; H = fs.h;
    if (K.reduced) draw(0);
  });

  if (K.reduced) {
    // one representative static frame: moderate flexibility near best generalization
    userControlled = true;
    t = clamp(bestT, 0.2, 0.8);
    slider.value = t.toFixed(2);
    toggle.checked = true;
    draw(0);
    return;
  }

  K.loop(function (tMs) { draw(tMs); });
};

  // ───── big-data ─────
  EDU["big-data"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, w = f.w, h = f.h;

  // ---- deterministic RNG (mulberry32) so layout is stable across reloads ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- fixed geometry, rebuilt only on resize -------------------------------
  var N = 420;          // data points
  var Kk = 5;           // hand-tuned knobs
  var M = 24;           // learned-lattice nodes
  var pts, knobs, nodes, edges;
  var topB, midB, botB; // band rects in CSS px

  function bands() {
    var pad = 6;
    var H = h - pad * 2, y = pad;
    topB = { y0: y, y1: y + H * 0.40 };
    midB = { y0: topB.y1, y1: topB.y1 + H * 0.35 };
    botB = { y0: midB.y1, y1: y + H };
  }

  function build() {
    bands();
    var r = mulberry32(0x9E3779B1);
    var padX = 14, innerW = Math.max(10, w - padX * 2);

    // DATA: scatter across the whole top band
    pts = [];
    for (var i = 0; i < N; i++) {
      pts.push({
        x: padX + r() * innerW,
        y: topB.y0 + 6 + r() * Math.max(0, topB.y1 - topB.y0 - 12),
        r: 1 + r() * 1,
        born: r()
      });
    }

    // FEATURES — left third: hand-tuned knobs
    knobs = [];
    var leftW = innerW * 0.30;
    var midY = (midB.y0 + midB.y1) / 2;
    var knobR = Math.max(4, Math.min(14, (midB.y1 - midB.y0) * 0.20));
    for (var k = 0; k < Kk; k++) {
      var kx = padX + leftW * ((k + 0.5) / Kk);
      knobs.push({ x: kx, y: midY, r: knobR, ang: r() * Math.PI * 2 });
    }

    // FEATURES — right/overlapping: learned-representation lattice
    nodes = [];
    var latX0 = padX + innerW * 0.34, latX1 = padX + innerW;
    var latW = latX1 - latX0;
    var latY0 = midB.y0 + 6, latY1 = midB.y1 - 6;
    var latH = Math.max(1, latY1 - latY0);
    var cols = 6, rows = Math.ceil(M / cols);
    for (var n = 0; n < M; n++) {
      var c = n % cols, rw = Math.floor(n / cols);
      nodes.push({
        bx: latX0 + latW * ((c + 0.5) / cols),
        by: latY0 + latH * ((rw + 0.5) / Math.max(1, rows)),
        x: 0, y: 0,
        ph: r() * Math.PI * 2,
        amp: 1.2 + r() * 1.6
      });
    }
    // edges between nearby nodes
    edges = [];
    var near = latW / cols * 1.55;
    for (var a = 0; a < M; a++) {
      for (var b = a + 1; b < M; b++) {
        var dx = nodes[a].bx - nodes[b].bx, dy = nodes[a].by - nodes[b].by;
        if (Math.hypot(dx, dy) < near) {
          edges.push({ a: a, b: b, threshold: 0.2 + r() * 0.8 });
        }
      }
    }
  }
  build();

  // ---- color helpers (re-read each frame so both themes track) --------------
  function col(name, fb) { var v = K.v(name); return v || fb; }
  function withA(cssColor, a) {
    // accept #rgb / #rrggbb / rgb()/rgba(); return rgba string at alpha a
    var s = (cssColor || '').trim();
    var rr = 0, gg = 0, bb = 0, m;
    if (s.charAt(0) === '#') {
      if (s.length === 4) { rr = parseInt(s[1] + s[1], 16); gg = parseInt(s[2] + s[2], 16); bb = parseInt(s[3] + s[3], 16); }
      else if (s.length >= 7) { rr = parseInt(s.substr(1, 2), 16); gg = parseInt(s.substr(3, 2), 16); bb = parseInt(s.substr(5, 2), 16); }
    } else {
      m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) { rr = +m[0]; gg = +m[1]; bb = +m[2]; }
    }
    return 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a + ')';
  }

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // ---- the figure -----------------------------------------------------------
  function draw(timeMs, t) {
    var ink = col('--ink', K.dark() ? '#eaedff' : '#15171c');
    var acc = col('--accent', K.dark() ? '#3fe0e6' : '#28489e');
    var mono = col('--mono', 'monospace');

    ctx.clearRect(0, 0, w, h); // transparent: host surface shows through
    ctx.lineCap = 'round';
    ctx.textBaseline = 'alphabetic';

    var e = t * t * (3 - 2 * t); // smoothstep

    // === DATA BAND: dots fade in as e passes their born threshold ===========
    ctx.fillStyle = ink;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (e <= p.born) continue;
      var a = clamp((e - p.born) / 0.05, 0, 1);
      ctx.globalAlpha = a * 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // === FEATURES BAND ======================================================
    // hand-tuned knobs (fade out over first half) — tinted with ink
    var ka = clamp(1 - 2 * e, 0, 1);
    if (ka > 0.001) {
      ctx.strokeStyle = withA(ink, ka * 0.9);
      ctx.fillStyle = withA(ink, ka * 0.12);
      ctx.lineWidth = 1.4;
      for (var k = 0; k < knobs.length; k++) {
        var kn = knobs[k];
        ctx.beginPath();
        ctx.arc(kn.x, kn.y, kn.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // tick from center to rim at fixed per-knob angle
        ctx.beginPath();
        ctx.moveTo(kn.x, kn.y);
        ctx.lineTo(kn.x + Math.cos(kn.ang) * kn.r, kn.y + Math.sin(kn.ang) * kn.r);
        ctx.stroke();
      }
    }

    // learned-representation lattice — tinted with accent
    var tt = timeMs * 0.001;
    for (var n = 0; n < nodes.length; n++) {
      var nd = nodes[n];
      nd.x = nd.bx + Math.sin(tt * 0.9 + nd.ph) * nd.amp;
      nd.y = nd.by + Math.cos(tt * 0.7 + nd.ph) * nd.amp;
    }
    // edges light up progressively
    ctx.lineWidth = 1;
    for (var j = 0; j < edges.length; j++) {
      var ed = edges[j];
      var ea = clamp((e - ed.threshold) * 3, 0, 0.5);
      if (ea <= 0.001) continue;
      ctx.strokeStyle = withA(acc, ea);
      ctx.beginPath();
      ctx.moveTo(nodes[ed.a].x, nodes[ed.a].y);
      ctx.lineTo(nodes[ed.b].x, nodes[ed.b].y);
      ctx.stroke();
    }
    var nodeA = clamp(e * 1.4, 0, 1);
    if (nodeA > 0.001) {
      ctx.fillStyle = withA(acc, nodeA);
      for (var n2 = 0; n2 < nodes.length; n2++) {
        ctx.beginPath();
        ctx.arc(nodes[n2].x, nodes[n2].y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // === ERROR BAND: descending curve falls as scale grows ==================
    var padX = 14, innerW = Math.max(10, w - padX * 2);
    var ey0 = botB.y0 + 8, ey1 = botB.y1 - 16;
    var eh = Math.max(1, ey1 - ey0);
    function err(x) { return 0.9 * Math.pow(1 - x, 1.6) + 0.06; } // ~[0.06,0.96]
    function px(x) { return padX + x * innerW; }
    function py(v) { return ey1 - v * eh; }

    // faint axis baseline
    ctx.strokeStyle = withA(ink, 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px(0), ey1);
    ctx.lineTo(px(1), ey1);
    ctx.stroke();

    // curve over [0, e]
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    var steps = 60;
    for (var st = 0; st <= steps; st++) {
      var xx = (st / steps) * e;
      var X = px(xx), Y = py(err(xx));
      if (st === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();

    // moving leading dot at x=e
    ctx.fillStyle = acc;
    ctx.beginPath();
    ctx.arc(px(e), py(err(e)), 3, 0, Math.PI * 2);
    ctx.fill();

    // === LABELS (mono, ink) =================================================
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ink;
    ctx.font = '11px ' + mono;
    ctx.fillText('more data →', px(0), topB.y1 - 4);
    ctx.fillText('hand-tuned → learned', padX, midB.y0 + 12);
    ctx.fillText('error', px(0), ey0);
    ctx.globalAlpha = 1;
  }

  // ---- timing / state -------------------------------------------------------
  var DUR = 9000;
  var t = 0;
  var last = -1;        // sentinel: no previous timestamp yet
  var scrubbing = false;

  // ---- pointer scrub: map x -> t, pause loop while hovered ------------------
  function setFromPointer(clientX) {
    var rect = canvas.getBoundingClientRect();
    var x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    t = x;
  }
  canvas.addEventListener('pointerenter', function () { if (!K.reduced) scrubbing = true; });
  canvas.addEventListener('pointermove', function (ev) {
    if (!K.reduced) { scrubbing = true; setFromPointer(ev.clientX); draw(ev.timeStamp || 0, t); }
  });
  canvas.addEventListener('pointerdown', function (ev) {
    if (!K.reduced) { scrubbing = true; setFromPointer(ev.clientX); draw(ev.timeStamp || 0, t); }
  });
  canvas.addEventListener('pointerleave', function () { scrubbing = false; last = -1; });

  // ---- theme + resize via K -------------------------------------------------
  K.onTheme(function () {
    var ff = K.fit(); ctx = ff.ctx; w = ff.w; h = ff.h; build();
    if (K.reduced) draw(0, 0.7);
  });

  if (K.reduced) {
    // representative mid-state: knobs faded, lattice formed, error well down
    draw(0, 0.7);
    return;
  }

  K.loop(function (now) {
    // re-fit if the CSS box changed (covers resize without a separate observer)
    if (Math.abs((canvas.clientWidth || w) - w) > 1) {
      var ff = K.fit(); ctx = ff.ctx; w = ff.w; h = ff.h; build();
    }
    if (!scrubbing) {
      if (last < 0) last = now;
      var dt = (now - last) / DUR;
      last = now;
      if (dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05; // clamp: avoid a lurch after off-screen pause/stall
      t = (t + dt) % 1;
    }
    draw(now, t);
  });
};

  // ───── neural-nets ─────
  EDU["neural-nets"] = function (canvas, controls, K) {
  // ---- network shape & deterministic init ----------------------------------
  var layers = [3, 5, 5, 2];
  var L = layers.length;
  var maxN = Math.max.apply(null, layers); // widest column, governs vertical spacing
  var lr = 0.08, speed = 1.2; // layers per second

  // small LCG so weights/biases are deterministic across reloads
  var seed = 0x6d2b79f5;
  function rnd() { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; }
  function r11() { return rnd() * 2 - 1; } // [-1,1]

  // w[l][i][j]: weight from neuron i in layer l to neuron j in layer l+1
  var w = [], b = [];
  for (var l = 0; l < L - 1; l++) {
    var Wl = [];
    for (var i = 0; i < layers[l]; i++) {
      var row = [];
      for (var j = 0; j < layers[l + 1]; j++) row.push(r11());
      Wl.push(row);
    }
    w.push(Wl);
  }
  // biases per layer (layer 0 has none used)
  for (var l2 = 0; l2 < L; l2++) {
    var bl = [];
    for (var k = 0; k < layers[l2]; k++) bl.push(l2 === 0 ? 0 : r11() * 0.4);
    b.push(bl);
  }
  // fixed input vector
  var input = [0.8, -0.5, 0.35];
  // training targets beside the two outputs
  var target = [0.6, -0.7];

  // ---- forward pass --------------------------------------------------------
  var a = []; // a[l][i] activations
  function forward() {
    a = [];
    a[0] = input.slice();
    for (var l = 1; l < L; l++) {
      var col = [];
      for (var j = 0; j < layers[l]; j++) {
        var s = b[l][j];
        for (var i = 0; i < layers[l - 1]; i++) s += a[l - 1][i] * w[l - 1][i][j];
        col.push(Math.tanh(s));
      }
      a[l] = col;
    }
  }
  function loss() {
    var s = 0, out = a[L - 1];
    for (var j = 0; j < out.length; j++) { var d = out[j] - target[j]; s += d * d; }
    return s;
  }
  // crude one-step gradient descent on output-layer weights+biases plus a
  // light nudge to earlier layers, recompute, so the displayed loss ticks down
  function trainStep() {
    var out = a[L - 1];
    // output layer error / gradient (tanh derivative = 1 - a^2)
    var delta = []; // per output neuron
    for (var j = 0; j < layers[L - 1]; j++) {
      var oj = out[j];
      delta[j] = 2 * (oj - target[j]) * (1 - oj * oj);
    }
    // last weight matrix w[L-2][i][j] and bias b[L-1][j]
    var li = L - 2;
    for (var i = 0; i < layers[li]; i++)
      for (var j2 = 0; j2 < layers[li + 1]; j2++)
        w[li][i][j2] -= lr * delta[j2] * a[li][i];
    for (var j3 = 0; j3 < layers[L - 1]; j3++) b[L - 1][j3] -= lr * delta[j3];
    // backprop one more layer for visible movement upstream
    if (L >= 3) {
      var lj = L - 3;
      var d2 = [];
      for (var k = 0; k < layers[lj + 1]; k++) {
        var sum = 0;
        for (var m = 0; m < layers[L - 1]; m++) sum += delta[m] * w[lj + 1][k][m];
        var ak = a[lj + 1][k];
        d2[k] = sum * (1 - ak * ak);
      }
      for (var p = 0; p < layers[lj]; p++)
        for (var q = 0; q < layers[lj + 1]; q++)
          w[lj][p][q] -= lr * d2[q] * a[lj][p];
      for (var q2 = 0; q2 < layers[lj + 1]; q2++) b[lj + 1][q2] -= lr * d2[q2];
    }
    forward();
  }
  forward();

  // ---- geometry ------------------------------------------------------------
  var fit = K.fit(), ctx = fit.ctx, W = fit.w, H = fit.h;
  function pos(l, i) {
    var padX = 46, padY = 28;
    var x = padX + l * (W - 2 * padX) / Math.max(L - 1, 1);
    var n = layers[l];
    var usable = Math.max(0, H - 2 * padY);
    // even spacing using the WIDEST column as the unit, so every column fits and
    // shorter columns center (using layers[0] would overflow the 5-neuron columns)
    var gap = usable / Math.max(maxN - 1, 1);
    var colH = (n - 1) * gap;
    var y = (n === 1) ? H / 2 : (padY + (usable - colH) / 2 + i * gap);
    return { x: x, y: y };
  }
  function rNeuron() { return Math.max(9, Math.min(15, W / 42)); }

  // ---- color helpers (linear-RGB mix vs live --bg) -------------------------
  function parseColor(str) {
    str = (str || '').trim();
    if (str.charAt(0) === '#') {
      var hex = str.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      var n = parseInt(hex, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    var m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      // handle both 'rgb(r, g, b)' and modern 'rgb(r g b / a)' forms
      var p = m[1].split(/[,\/\s]+/).filter(function (s) { return s.length; });
      return { r: +p[0] || 0, g: +p[1] || 0, b: +p[2] || 0 };
    }
    return { r: 128, g: 128, b: 128 };
  }
  function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linToSrgb(c) { c = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255); }
  function mixLin(c0, c1, t) {
    var r = linToSrgb(srgbToLin(c0.r) * (1 - t) + srgbToLin(c1.r) * t);
    var g = linToSrgb(srgbToLin(c0.g) * (1 - t) + srgbToLin(c1.g) * t);
    var b = linToSrgb(srgbToLin(c0.b) * (1 - t) + srgbToLin(c1.b) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // cached theme colors, re-read on theme change. Strings keep a fallback because
  // ACCs/ACC2s/BGs are used directly as canvas styles (an empty string is ignored).
  var BG, ACC, ACC2, INK2, ACCs, ACC2s, BGs;
  function readColors() {
    BGs = K.v('--bg') || (K.dark() ? '#06070f' : '#ffffff');
    ACCs = K.v('--accent') || '#3957c4';
    ACC2s = K.v('--accent-2') || '#3fe0e6';
    INK2 = K.v('--ink-2') || '#8a93a6';
    BG = parseColor(BGs);
    ACC = parseColor(ACCs);
    ACC2 = parseColor(ACC2s);
  }
  readColors();

  // ---- animation state -----------------------------------------------------
  var wave = 0;            // 0 .. L-1
  var phase = 'forward';   // 'forward' | 'hold' | 'back'
  var holdUntil = 0, backStart = 0;
  var trainMode = false;
  var hover = -1, hoverL = -1; // hovered neuron index within layer hoverL
  var last = 0;

  function activeOf(l) { return Math.max(0, Math.min(1, wave - l + 1)); }

  // ---- controls ------------------------------------------------------------
  if (controls) {
    var trainBtn = document.createElement('button');
    trainBtn.className = 'btn';
    trainBtn.type = 'button';
    trainBtn.textContent = 'Train one step';
    trainBtn.addEventListener('click', function (e) {
      e.preventDefault();
      trainMode = true;
      trainStep();
      restart(); // replay the pass so the lower loss is visible
      if (K.reduced) draw(0); // no loop in reduced motion; redraw the static frame
    });
    controls.appendChild(trainBtn);

    var resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset weights';
    resetBtn.addEventListener('click', function (e) {
      e.preventDefault();
      seed = 0x6d2b79f5; w = []; b = [];
      for (var l = 0; l < L - 1; l++) { var Wl = []; for (var i = 0; i < layers[l]; i++) { var rw = []; for (var j = 0; j < layers[l + 1]; j++) rw.push(r11()); Wl.push(rw); } w.push(Wl); }
      for (var l2 = 0; l2 < L; l2++) { var bl = []; for (var k = 0; k < layers[l2]; k++) bl.push(l2 === 0 ? 0 : r11() * 0.4); b.push(bl); }
      trainMode = false; forward(); restart();
      if (K.reduced) draw(0);
    });
    controls.appendChild(resetBtn);

    var hint = document.createElement('span');
    hint.className = 'chip';
    hint.textContent = 'click canvas: replay · hover a neuron: value';
    controls.appendChild(hint);
  }

  function restart() {
    wave = 0; phase = 'forward'; last = 0;
  }

  // ---- pointer interaction -------------------------------------------------
  function localXY(ev) {
    var rect = canvas.getBoundingClientRect();
    var t = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
    var cx = t.clientX - rect.left;
    var cy = t.clientY - rect.top;
    return { x: cx, y: cy };
  }
  function pickNeuron(x, y) {
    var rN = rNeuron();
    for (var l = 0; l < L; l++) for (var i = 0; i < layers[l]; i++) {
      var p = pos(l, i);
      if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) <= (rN + 4) * (rN + 4)) return { l: l, i: i };
    }
    return null;
  }
  canvas.addEventListener('click', function () { restart(); if (K.reduced) draw(0); });
  canvas.addEventListener('mousemove', function (ev) {
    var p = localXY(ev), hit = pickNeuron(p.x, p.y);
    if (hit) { hoverL = hit.l; hover = hit.i; } else { hoverL = -1; hover = -1; }
    if (K.reduced) draw(0);
  });
  canvas.addEventListener('mouseleave', function () { hoverL = -1; hover = -1; if (K.reduced) draw(0); });
  canvas.style.cursor = 'pointer';

  K.onTheme(function () { var f = K.fit(); ctx = f.ctx; W = f.w; H = f.h; readColors(); if (K.reduced) draw(0); });

  // ---- drawing -------------------------------------------------------------
  function draw(now) {
    // bg
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BGs;
    ctx.fillRect(0, 0, W, H);

    var rN = rNeuron();
    var backT = (phase === 'back') ? Math.max(0, Math.min(1, (now - backStart) / 600)) : 0;

    // ---- edges ----
    for (var l = 0; l < L - 1; l++) {
      var srcReady = activeOf(l);
      var tgtReady = activeOf(l + 1);
      for (var i = 0; i < layers[l]; i++) {
        var pa = pos(l, i);
        var sAct = srcReady * Math.abs(a[l][i]);
        for (var j = 0; j < layers[l + 1]; j++) {
          var pb = pos(l + 1, j);
          var wij = w[l][i][j], aw = Math.abs(wij);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.lineWidth = 0.4 + 2.4 * aw * sAct * tgtReady;
          var col = wij >= 0 ? ACCs : ACC2s;
          var alpha = 0.12 + 0.6 * aw * sAct;
          // backward gradient pulse: a right->left ink-2 tint sweep
          if (phase === 'back') {
            // layers light up from right to left as backT advances
            var lightFront = (L - 1) - backT * (L - 1);
            if (l + 1 >= lightFront - 0.6 && l + 1 <= lightFront + 0.6) {
              col = INK2; alpha = Math.max(alpha, 0.55);
              ctx.lineWidth = Math.max(ctx.lineWidth, 1.4);
            }
          }
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.strokeStyle = col;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // ---- neurons ----
    for (var l3 = 0; l3 < L; l3++) {
      var act = activeOf(l3);
      for (var n = 0; n < layers[l3]; n++) {
        var p = pos(l3, n);
        var mag = Math.abs(a[l3][n]);
        var t = act * mag; // 0..1 mix from bg toward accent
        ctx.beginPath();
        ctx.arc(p.x, p.y, rN, 0, Math.PI * 2);
        ctx.fillStyle = mixLin(BG, ACC, Math.max(0, Math.min(1, t)));
        ctx.shadowBlur = 18 * act * mag;
        ctx.shadowColor = ACCs;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = (hoverL === l3 && hover === n) ? 2.2 : 1;
        ctx.strokeStyle = (hoverL === l3 && hover === n) ? ACCs : INK2;
        ctx.stroke();
      }
    }

    // ---- target dots + loss in training mode ----
    ctx.font = '11px ' + (K.v('--mono') || 'monospace');
    ctx.textBaseline = 'middle';
    if (trainMode) {
      ctx.fillStyle = INK2;
      ctx.textAlign = 'left';
      for (var o = 0; o < layers[L - 1]; o++) {
        var po = pos(L - 1, o);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(po.x + rN + 12, po.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = (target[o] >= 0) ? ACCs : ACC2s;
        ctx.fill();
        ctx.fillStyle = INK2;
        ctx.fillText('target ' + target[o].toFixed(2), po.x + rN + 20, po.y);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = INK2;
      ctx.fillText('loss = ' + loss().toFixed(4), 8, H - 12);
    } else {
      ctx.fillStyle = INK2;
      ctx.textAlign = 'left';
      ctx.fillText('forward pass', 8, H - 12);
    }

    // ---- hover activation readout ----
    if (hoverL >= 0 && hover >= 0) {
      var ph = pos(hoverL, hover);
      var label = 'a = ' + a[hoverL][hover].toFixed(3);
      ctx.font = '11px ' + (K.v('--mono') || 'monospace');
      ctx.textAlign = 'center';
      ctx.fillStyle = INK2;
      ctx.fillText(label, ph.x, ph.y - rN - 8);
    }
    ctx.textAlign = 'left';
  }

  // ---- step / loop ---------------------------------------------------------
  function step(now) {
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (phase === 'forward') {
      wave += dt * speed;
      if (wave >= L - 1) { wave = L - 1; phase = 'hold'; holdUntil = now + 800; }
    } else if (phase === 'hold') {
      if (now >= holdUntil) {
        if (trainMode) { phase = 'back'; backStart = now; }
        else restart();
      }
    } else if (phase === 'back') {
      if (now - backStart >= 600) restart();
    }
    draw(now);
  }

  if (K.reduced) {
    // one representative static frame: full forward pass resolved
    wave = L - 1; draw(0);
  } else {
    K.loop(step);
  }
};

  // ───── transformers ─────
  EDU["transformers"] = function (canvas, controls, K) {
  // --- DATA: 7 tokens + a hand-authored (NOT trained) score table -----------
  var toks = ['The', 'cat', 'that', 'ran', 'was', 'very', 'fast'];
  var N = toks.length;
  // s[i][j] = how much token i (query) looks at token j (key). Story:
  // 'was'(4) -> 'cat'(1) strongest; 'fast'(6) -> 'was'(4) & 'ran'(3); diagonal moderate.
  var s = [
    /*The */ [1.6, 0.4, 0.2, 0.1, 0.2, 0.1, 0.2],
    /*cat */ [0.6, 1.8, 0.5, 0.4, 0.7, 0.1, 0.3],
    /*that*/ [0.3, 1.6, 1.2, 1.0, 0.3, 0.1, 0.2],
    /*ran */ [0.2, 1.7, 0.6, 1.4, 0.4, 0.1, 0.3],
    /*was */ [0.2, 2.4, 0.3, 0.5, 1.3, 0.2, 0.4],
    /*very*/ [0.1, 0.3, 0.1, 0.2, 0.4, 1.0, 1.9],
    /*fast*/ [0.2, 0.5, 0.2, 1.6, 1.8, 0.9, 1.3]
  ];
  // softmax each row -> W; then a[i][j] = W/rowMax (display intensity)
  var W = [], A = [];
  for (var i = 0; i < N; i++) {
    var ex = [], sum = 0;
    for (var j = 0; j < N; j++) { var e = Math.exp(s[i][j]); ex.push(e); sum += e; }
    var row = [], rmax = 0;
    for (j = 0; j < N; j++) { var wv = ex[j] / sum; row.push(wv); if (wv > rmax) rmax = wv; }
    W.push(row);
    var arow = [];
    for (j = 0; j < N; j++) arow.push(rmax > 0 ? row[j] / rmax : 0);
    A.push(arow);
  }

  // --- controls -------------------------------------------------------------
  var modeBtn = document.createElement('button');
  modeBtn.className = 'btn';
  var mode = 'parallel'; // or 'recurrent'
  function syncBtn() {
    modeBtn.textContent = (mode === 'parallel') ? 'Mode: parallel (attention)' : 'Mode: recurrent (chain)';
    modeBtn.setAttribute('aria-pressed', mode === 'recurrent' ? 'true' : 'false');
  }
  syncBtn();
  var note = document.createElement('span');
  note.className = 'chip';
  note.textContent = 'illustrative weights — not a trained model';

  // --- layout / geometry (computed each fit) --------------------------------
  var f = K.fit(), ctx = f.ctx, w = f.w, h = f.h;
  var chip = [];     // {x,y,w,h,cx,bx,by} per token (top strip)
  var gx, gy, gridW, cell; // grid origin + size
  var pad = 14;
  var leftLab = 36;  // room for left row labels

  function relayout(c) {
    var topY = 22, chipH = 22;
    c.font = '12px ' + (K.v('--mono') || 'monospace');
    // natural text widths; chip width = text + padPerChip (clamped to fit)
    var txt = [], natTotal = 0;
    for (var k = 0; k < N; k++) { var tw = c.measureText(toks[k]).width; txt.push(tw); natTotal += tw; }
    var availStrip = Math.max(40, w - pad * 2 - leftLab);
    // choose chip padding (up to 18) and inter-chip gap (up to ~40) that fit
    var minGap = 6, pad2 = 18;
    // total if we use full padding + minGap between chips
    var needed = natTotal + pad2 * N + minGap * (N - 1);
    var scale = 1;
    if (needed > availStrip) {
      // first shrink chip padding toward a small floor
      var floorPad = 6;
      var over = needed - availStrip;
      var slack = (pad2 - floorPad) * N;
      if (over <= slack) { pad2 = pad2 - over / N; }
      else { pad2 = floorPad; }
      // recompute; if still over, uniformly scale text+padding so strip fits
      needed = natTotal + pad2 * N + minGap * (N - 1);
      if (needed > availStrip) {
        scale = (availStrip - minGap * (N - 1)) / (natTotal + pad2 * N);
        if (scale < 0.4) scale = 0.4; // never collapse to nothing
      }
    }
    var widths = [], wTotal = 0;
    for (k = 0; k < N; k++) { var cw = (txt[k] + pad2) * scale; if (cw < 14) cw = 14; widths.push(cw); wTotal += cw; }
    var gap = (N > 1) ? (availStrip - wTotal) / (N - 1) : 0;
    if (gap < 2) gap = 2;
    var x = pad + leftLab;
    chip = [];
    for (k = 0; k < N; k++) {
      var ww = widths[k];
      chip.push({ x: x, y: topY, w: ww, h: chipH, cx: x + ww / 2, bx: x + ww / 2, by: topY + chipH });
      x += ww + gap;
    }
    var colLabH = 16;
    gy = topY + chipH + 18 + colLabH;
    var bottomPad = 26;                 // leave room for recurrent caption
    var availH = h - gy - bottomPad;
    var availW = w - pad * 2 - leftLab;
    gridW = Math.max(40, Math.min(availH, availW));
    cell = gridW / N;
    gx = pad + leftLab;
  }
  relayout(ctx);

  // --- hover + eased display state ------------------------------------------
  var hover = -1;        // hovered token index, -1 none
  var dispCell = [];     // displayed cell intensity, eased
  var dispBond = [];     // displayed bond strength, eased
  for (i = 0; i < N; i++) { dispCell.push(new Array(N).fill(0)); dispBond.push(new Array(N).fill(0.08)); }
  var pulse = 0;         // recurrent traveling-dot progress
  var pulseTarget = 0;
  var needFrame = true;  // wake the loop

  function targetCell(ri, rj) {
    if (hover < 0) return A[ri][rj] * 0.85;        // rest: show full structure
    if (ri !== hover) return A[ri][rj] * 0.18;     // dim non-hovered rows
    return A[ri][rj];
  }
  function targetBond(ri, rj) {
    if (ri !== hover) return 0.08;                 // faint at rest / non-hover rows
    return 0.2 + 0.8 * A[ri][rj];
  }

  // --- hit testing ----------------------------------------------------------
  function hitTest(mx, my) {
    for (var k = 0; k < N; k++) {
      var ck = chip[k];
      if (mx >= ck.x && mx <= ck.x + ck.w && my >= ck.y && my <= ck.y + ck.h) return k;
    }
    if (mode === 'parallel' && mx >= gx && mx <= gx + gridW && my >= gy && my <= gy + gridW) {
      var r = Math.floor((my - gy) / cell);
      if (r >= 0 && r < N) return r;
    }
    return -1;
  }
  function locate(ev) {
    var rect = canvas.getBoundingClientRect();
    var rw = rect.width || w, rh = rect.height || h;
    var sx = rw ? (w / rw) : 1, sy = rh ? (h / rh) : 1; // CSS-px space even if box scaled
    var cx = ((ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left) * sx;
    var cy = ((ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top) * sy;
    var nh = hitTest(cx, cy);
    if (nh !== hover) { hover = nh; pulseTarget = hover < 0 ? 0 : hover; needFrame = true; }
  }
  canvas.addEventListener('mousemove', locate);
  canvas.addEventListener('mouseleave', function () { if (hover !== -1) { hover = -1; pulseTarget = 0; needFrame = true; } });
  canvas.addEventListener('touchstart', function (ev) { locate(ev); }, { passive: true });
  canvas.addEventListener('touchmove', function (ev) { locate(ev); if (ev.cancelable) ev.preventDefault(); }, { passive: false });
  modeBtn.addEventListener('click', function () {
    mode = (mode === 'parallel') ? 'recurrent' : 'parallel';
    syncBtn(); needFrame = true;
  });
  controls.appendChild(modeBtn);
  controls.appendChild(note);

  // --- drawing helpers ------------------------------------------------------
  function rr(c, x, y, ww, hh, r) {
    if (r > hh / 2) r = hh / 2; if (r > ww / 2) r = ww / 2;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + ww, y, x + ww, y + hh, r);
    c.arcTo(x + ww, y + hh, x, y + hh, r);
    c.arcTo(x, y + hh, x, y, r);
    c.arcTo(x, y, x + ww, y, r);
    c.closePath();
  }
  function hexA(hex, a) {
    hex = (hex || '').trim();
    var r, g, b;
    if (/^#([0-9a-f]{3})$/i.test(hex)) {
      r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16);
    } else if (/^#([0-9a-f]{6})$/i.test(hex)) {
      r = parseInt(hex.substr(1, 2), 16); g = parseInt(hex.substr(3, 2), 16); b = parseInt(hex.substr(5, 2), 16);
    } else {
      return hex; // already rgb()/named — caller falls back to globalAlpha
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function draw() {
    var c = ctx;
    var BG = K.v('--bg') || (K.dark() ? '#06070f' : '#ffffff');
    var INK = K.v('--ink') || (K.dark() ? '#eaedff' : '#15171c');
    var INK2 = K.v('--ink-2') || INK;
    var ACC = K.v('--accent') || (K.dark() ? '#3fe0e6' : '#28489e');
    var mono = K.v('--mono') || 'monospace';
    var accHex = /^#/.test(ACC);

    c.clearRect(0, 0, w, h);
    c.fillStyle = BG;
    c.fillRect(0, 0, w, h);

    // ease displayed values toward targets
    var moving = false;
    for (var ri = 0; ri < N; ri++) {
      for (var rj = 0; rj < N; rj++) {
        var tc = targetCell(ri, rj), tb = targetBond(ri, rj);
        var dc = tc - dispCell[ri][rj]; if (Math.abs(dc) > 0.002) { dispCell[ri][rj] += dc * 0.22; moving = true; } else dispCell[ri][rj] = tc;
        var db = tb - dispBond[ri][rj]; if (Math.abs(db) > 0.002) { dispBond[ri][rj] += db * 0.22; moving = true; } else dispBond[ri][rj] = tb;
      }
    }
    var dp = pulseTarget - pulse; if (Math.abs(dp) > 0.01) { pulse += dp * 0.14; moving = true; } else pulse = pulseTarget;

    // --- top chip strip -----------------------------------------------------
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '12px ' + mono;
    for (var k = 0; k < N; k++) {
      var ch = chip[k];
      rr(c, ch.x, ch.y, ch.w, ch.h, 6);
      c.fillStyle = (K.dark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)');
      c.fill();
      if (hover === k) { c.lineWidth = 2; c.strokeStyle = ACC; c.stroke(); }
      else { c.lineWidth = 1; c.strokeStyle = hexA(INK, 0.18); c.stroke(); }
      c.fillStyle = INK;
      c.fillText(toks[k], ch.cx, ch.y + ch.h / 2);
    }

    if (mode === 'parallel') drawParallel(c, INK, INK2, ACC, mono, accHex);
    else drawRecurrent(c, INK, INK2, ACC, mono);

    if (moving) needFrame = true;
  }

  function drawParallel(c, INK, INK2, ACC, mono, accHex) {
    // labels
    c.font = '11px ' + mono; c.fillStyle = INK2;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    for (var j = 0; j < N; j++) c.fillText(toks[j], gx + cell * (j + 0.5), gy - 4);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (var i = 0; i < N; i++) c.fillText(toks[i], gx - 4, gy + cell * (i + 0.5));

    // heat cells
    for (i = 0; i < N; i++) {
      for (j = 0; j < N; j++) {
        var a = dispCell[i][j];
        if (a > 0.001) {
          if (accHex) { c.fillStyle = hexA(ACC, a); c.globalAlpha = 1; }
          else { c.fillStyle = ACC; c.globalAlpha = a; }
          c.fillRect(gx + j * cell, gy + i * cell, cell, cell);
          c.globalAlpha = 1;
        }
      }
    }
    // grid lines
    c.strokeStyle = hexA(INK, 0.15); c.lineWidth = 1;
    for (i = 0; i <= N; i++) {
      c.beginPath(); c.moveTo(gx, gy + i * cell); c.lineTo(gx + gridW, gy + i * cell); c.stroke();
      c.beginPath(); c.moveTo(gx + i * cell, gy); c.lineTo(gx + i * cell, gy + gridW); c.stroke();
    }
    // hovered row border
    if (hover >= 0) { c.strokeStyle = ACC; c.lineWidth = 2; c.strokeRect(gx, gy + hover * cell, gridW, cell); }

    // bonds: hovered row fans out; at rest every row drawn faintly
    for (i = 0; i < N; i++) {
      if (hover >= 0 && i !== hover) continue;
      for (j = 0; j < N; j++) {
        var bonda = dispBond[i][j];
        if (bonda <= 0.01) continue;
        var ai = A[i][j];
        if (accHex) { c.strokeStyle = hexA(ACC, bonda); c.globalAlpha = 1; }
        else { c.strokeStyle = ACC; c.globalAlpha = bonda; }
        c.lineWidth = 1 + 4 * ai;
        var s0 = chip[i], s1 = chip[j];
        if (i === j) {
          var lx = s0.cx, ly = s0.y;
          c.beginPath();
          c.moveTo(lx - 5, ly);
          c.bezierCurveTo(lx - 10, ly - 16, lx + 10, ly - 16, lx + 5, ly);
          c.stroke();
        } else {
          c.beginPath();
          c.moveTo(s0.bx, s0.by);
          var mx = (s0.bx + s1.cx) / 2;
          var my = Math.max(s0.by, s1.y) + 26 + Math.abs(j - i) * 2;
          c.quadraticCurveTo(mx, my, s1.cx, s1.y);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
    }
  }

  function drawRecurrent(c, INK, INK2, ACC, mono) {
    var midY = gy + gridW / 2;
    c.strokeStyle = hexA(INK, 0.4); c.lineWidth = 1.5; c.fillStyle = hexA(INK, 0.4);
    for (var i = 0; i < N - 1; i++) {
      var a = chip[i], b = chip[i + 1];
      c.beginPath(); c.moveTo(a.cx + 6, midY); c.lineTo(b.cx - 10, midY); c.stroke();
      c.beginPath();
      c.moveTo(b.cx - 10, midY); c.lineTo(b.cx - 16, midY - 4); c.lineTo(b.cx - 16, midY + 4); c.closePath(); c.fill();
    }
    for (i = 0; i < N; i++) {
      var ch = chip[i];
      c.beginPath(); c.arc(ch.cx, midY, 6, 0, Math.PI * 2);
      c.fillStyle = (hover >= 0 && i <= Math.round(pulse)) ? ACC : hexA(INK, 0.25);
      c.fill();
    }
    if (hover >= 0) {
      var ip = Math.max(0, Math.min(N - 1, pulse));
      var lo = Math.floor(ip), hi = Math.min(N - 1, lo + 1), fr = ip - lo;
      var px = chip[lo].cx + (chip[hi].cx - chip[lo].cx) * fr;
      c.beginPath(); c.arc(px, midY, 5, 0, Math.PI * 2);
      c.fillStyle = ACC; c.fill();
      c.strokeStyle = hexA(ACC, 0.4); c.lineWidth = 6; c.stroke(); c.lineWidth = 1;
      c.fillStyle = INK2; c.font = '11px ' + mono; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText('reaching "' + toks[hover] + '" costs ' + hover + ' sequential step' + (hover === 1 ? '' : 's'), w / 2, midY + 22);
    } else {
      c.fillStyle = INK2; c.font = '11px ' + mono; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText('hover a token: a pulse must travel step-by-step to reach it', w / 2, midY + 22);
    }
  }

  // --- theme + loop ---------------------------------------------------------
  K.onTheme(function () {
    var nf = K.fit(); ctx = nf.ctx; w = nf.w; h = nf.h; relayout(ctx); needFrame = true; if (K.reduced) draw();
  });

  if (K.reduced) {
    hover = -1;
    for (var ii = 0; ii < N; ii++) for (var jj = 0; jj < N; jj++) { dispCell[ii][jj] = targetCell(ii, jj); dispBond[ii][jj] = targetBond(ii, jj); }
    draw();
    return;
  }

  K.loop(function () {
    if (canvas.clientWidth && Math.abs(canvas.clientWidth - w) > 1) {
      var nf = K.fit(); ctx = nf.ctx; w = nf.w; h = nf.h; relayout(ctx); needFrame = true;
    }
    if (!needFrame) return;
    needFrame = false;
    draw();
  });
};

  // ───── slm-llm ─────
  EDU["slm-llm"] = function (canvas, controls, K) {
  var fit = K.fit(), ctx = fit.ctx, W = fit.w, H = fit.h;

  // ---- state -------------------------------------------------------------
  var s = 0.35;            // model size 0..1
  var dragging = false;
  var auto = !K.reduced;   // gentle idle sweep until first interaction
  var dir = 1;
  var TASK = 0.62;         // required capability ("task bar")
  var cur = [0, 0, 0];     // eased displayed meter values

  // ---- math --------------------------------------------------------------
  var capNorm = 1 - Math.exp(-2.4);
  function capability(x) { return (1 - Math.exp(-2.4 * x)) / capNorm; } // concave, diminishing
  function cost(x) { return 0.06 + 0.94 * x; }                          // ~linear
  function latency(x) { return 0.10 + 0.80 * x * x * 0.5 + 0.40 * x; }  // slightly super-linear
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rightSizedS() {
    for (var i = 0; i <= 80; i++) { var x = i / 80; if (capability(x) >= TASK) return x; }
    return 1;
  }
  var rsS = rightSizedS();

  // ---- controls ----------------------------------------------------------
  function mkLabel(txt) {
    var el = document.createElement('label');
    el.className = 'chip'; el.style.marginRight = '8px'; el.textContent = txt;
    return el;
  }
  var sizeWrap = mkLabel('model size');
  var range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.001';
  range.value = String(s);
  range.style.verticalAlign = 'middle'; range.style.marginLeft = '6px';
  range.setAttribute('aria-label', 'Model size from 0 to 1');
  sizeWrap.appendChild(range);

  var playBtn = document.createElement('button');
  playBtn.className = 'btn'; playBtn.type = 'button';
  function syncPlay() { playBtn.textContent = auto ? 'Pause sweep' : 'Auto-sweep'; }
  syncPlay();
  if (K.reduced) { playBtn.disabled = true; }

  if (controls) { controls.appendChild(sizeWrap); controls.appendChild(playBtn); }

  function setSize(v, byUser) {
    s = clamp(v, 0, 1);
    range.value = String(s);
    if (byUser && auto) { auto = false; syncPlay(); }
  }
  range.addEventListener('input', function () { setSize(parseFloat(range.value), true); });
  playBtn.addEventListener('click', function () {
    if (K.reduced) return;
    auto = !auto; syncPlay();
  });

  // ---- canvas pointer (drag thumb / click track) -------------------------
  function trackGeom() { return { x0: 16, w: Math.max(40, W - 16 - 32), y: H - 26 }; }
  function pointerToS(clientX) {
    var r = canvas.getBoundingClientRect(), g = trackGeom();
    return clamp((clientX - r.left - g.x0) / g.w, 0, 1);
  }
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
    setSize(pointerToS(e.clientX), true);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (dragging) { setSize(pointerToS(e.clientX), true); e.preventDefault(); }
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  // ---- theme: refit + recache geometry on toggle -------------------------
  K.onTheme(function () { var f = K.fit(); ctx = f.ctx; W = f.w; H = f.h; if (K.reduced) draw(); });

  // ---- drawing helpers ---------------------------------------------------
  function rr(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // translucency via globalAlpha so it is robust for any CSS color format
  function fillA(color, a) { var p = ctx.globalAlpha; ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = p; }
  function fillRectA(color, a, x, y, w, h) { var p = ctx.globalAlpha; ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = p; }
  function strokeA(color, a, lw) { var p = ctx.globalAlpha; ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); ctx.globalAlpha = p; }

  // ---- main draw ---------------------------------------------------------
  function draw() {
    var bg = K.v('--bg'), ink = K.v('--ink'), ink2 = K.v('--ink-2');
    var accent = K.v('--accent'), accent2 = K.v('--accent-2');
    var mono = K.v('--mono') || 'monospace';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // targets + easing
    var tgt = [capability(s), cost(s), latency(s)];
    for (var i = 0; i < 3; i++) {
      if (K.reduced) cur[i] = tgt[i];
      else cur[i] += (tgt[i] - cur[i]) * 0.18;
    }

    // ----- VERTICAL LAYOUT ZONES (fits ~340px) ---------------------------
    // [plot] top | [3 meters] middle | [model cloud + data band + slider] bottom
    var plotX0 = 16, plotW = Math.max(40, W - 32);
    var topPad = 12, plotH = 84;                       // plot: y 12..96
    var meterTop = topPad + plotH + 16;                // ~112
    var meterGap = 30, barH = 13;
    var meterY = [meterTop, meterTop + meterGap, meterTop + 2 * meterGap]; // 112,142,172
    var g = trackGeom();                               // slider at y = H-26 (~314)
    var midY = (meterY[2] + barH + g.y) / 2 - 4;       // model-cloud center, between meters & slider

    // ===== top plot: diminishing-returns capability curve ================
    var taskY = topPad + (1 - TASK) * plotH;
    var N = 80;

    // shade area under the curve (the region that clears the bar fills first)
    ctx.beginPath();
    ctx.moveTo(plotX0, topPad + plotH);
    for (var k = 0; k <= N; k++) {
      var xs = k / N;
      ctx.lineTo(plotX0 + xs * plotW, topPad + (1 - capability(xs)) * plotH);
    }
    ctx.lineTo(plotX0 + plotW, topPad + plotH);
    ctx.closePath();
    fillA(accent, 0.07);

    // the curve
    ctx.beginPath();
    for (var c = 0; c <= N; c++) {
      var cx2 = c / N;
      var x = plotX0 + cx2 * plotW;
      var y = topPad + (1 - capability(cx2)) * plotH;
      if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    strokeA(accent, 1, 1.5);

    // task bar dashed line + label
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(plotX0, taskY); ctx.lineTo(plotX0 + plotW, taskY);
    strokeA(ink2, 0.6, 1);
    ctx.restore();
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('required capability', plotX0 + 2, taskY - 4);

    // moving dot on the curve at current s
    var dotX = plotX0 + s * plotW;
    var dotY = topPad + (1 - capability(s)) * plotH;
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = bg; ctx.stroke();

    // ===== three meters (eased) ==========================================
    var barX = 92, Wbar = Math.max(40, W - 92 - 56);
    var labels = ['capability', 'cost', 'latency'];
    var fills = [accent, accent2, accent2];
    var fillAlpha = [1, 1, 0.7];
    ctx.textBaseline = 'middle';
    for (var m = 0; m < 3; m++) {
      var my = meterY[m];
      ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'left';
      ctx.fillText(labels[m], 12, my + barH / 2);
      rr(barX, my, Wbar, barH, barH / 2); fillA(ink2, 0.15);
      var val = clamp(cur[m], 0, 1.2);
      var fw = Math.max(barH, Math.min(Wbar, val * Wbar));
      rr(barX, my, fw, barH, barH / 2); fillA(fills[m], fillAlpha[m]);
      var tag = (m === 0)
        ? (Math.round(cur[0] * 100) + '%')
        : ((Math.round((1 + 15 * cur[m]) * 10) / 10) + 'x');
      ctx.fillStyle = ink; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
      ctx.fillText(tag, barX + Wbar + 6, my + barH / 2);
    }
    ctx.textBaseline = 'alphabetic';

    // ===== model dot-cloud + training-data band ==========================
    var cxc = W * 0.30;                                 // cloud sits left of center
    var n = Math.round(4 + s * 60);
    var cols = Math.ceil(Math.sqrt(n));
    var rows = Math.ceil(n / cols);
    var gap = 6, blockW = (cols - 1) * gap, blockH = (rows - 1) * gap;
    var startX = cxc - blockW / 2, startY = midY - blockH / 2 - 5;
    ctx.fillStyle = ink;
    var placed = 0, prevA = ctx.globalAlpha;
    ctx.globalAlpha = 0.35 + 0.5 * s;
    for (var ry = 0; ry < rows && placed < n; ry++) {
      for (var cxi = 0; cxi < cols && placed < n; cxi++) {
        ctx.beginPath();
        ctx.arc(startX + cxi * gap, startY + ry * gap, 2, 0, Math.PI * 2);
        ctx.fill();
        placed++;
      }
    }
    ctx.globalAlpha = prevA;
    var bandW = 36 + s * (W * 0.30), bandY = midY + blockH / 2 + 5;
    rr(cxc - bandW / 2, bandY, bandW, 7, 3.5); fillA(accent, 0.28);
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('training data', cxc, bandY + 18);
    ctx.textAlign = 'left';

    // ===== slider track + right-sized band + thumb =======================
    var bandX0 = g.x0 + rsS * g.w;
    var bandX1 = g.x0 + Math.min(1, rsS + 0.12) * g.w;
    fillRectA(accent, 0.10, bandX0, g.y - 14, bandX1 - bandX0, 22);
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('right-sized', (bandX0 + bandX1) / 2, g.y - 17);
    ctx.textAlign = 'left';

    ctx.beginPath();
    ctx.moveTo(g.x0, g.y); ctx.lineTo(g.x0 + g.w, g.y);
    ctx.lineCap = 'round';
    strokeA(ink2, 0.25, 4);
    ctx.lineCap = 'butt';

    var thumbX = g.x0 + s * g.w;
    ctx.beginPath(); ctx.arc(thumbX, g.y, 9, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
    ctx.beginPath(); ctx.arc(thumbX, g.y, 9, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = bg; ctx.stroke();

    ctx.fillStyle = ink; ctx.font = '11px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('size ' + (Math.round(s * 100) / 100).toFixed(2), thumbX, g.y - 13);
    ctx.textAlign = 'left';
  }

  // ---- run ---------------------------------------------------------------
  if (K.reduced) {
    s = rsS; range.value = String(s);   // representative static frame: the right-sized model
    draw();
    return;
  }
  K.loop(function () {
    if (auto && !dragging) {
      s += 0.004 * dir;
      if (s >= 0.98) { s = 0.98; dir = -1; }
      else if (s <= 0.05) { s = 0.05; dir = 1; }
      range.value = String(s);
    }
    draw();
  });
};

  // ───── pretrain-posttrain ─────
  EDU["pretrain-posttrain"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;

  // ---- palette (re-read each frame so both themes track) -------------------
  function pal() {
    return {
      bg: K.v('--bg') || (K.dark() ? '#06070f' : '#ffffff'),
      ink: K.v('--ink') || (K.dark() ? '#eaedff' : '#15171c'),
      faint: K.v('--faint') || (K.dark() ? '#3a4060' : '#c9ccd6'),
      rule: K.v('--rule') || (K.dark() ? '#2a3050' : '#d8dbe4'),
      a1: K.v('--accent') || (K.dark() ? '#3fe0e6' : '#28489e'),
      a2: K.v('--accent-2') || (K.dark() ? '#9b7bff' : '#6a3fb0')
    };
  }

  // ---- roundRect feature-detect + fallback ---------------------------------
  var hasRR = typeof ctx.roundRect === 'function';
  function rrect(c, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (hasRR) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---- geometry (recomputed on theme/refit) --------------------------------
  var bx, mouthX, divX, midZone, baseY, lanes, comb, outX, outY;
  function layout() {
    bx = W * 0.30;        // left third ends ~here (corpus -> funnel begins)
    mouthX = W * 0.50;    // funnel mouth / base-model blob
    divX = W * 0.62;      // stage boundary divider
    midZone = W * 0.30;   // where chips start funneling toward center
    baseY = H * 0.5;
    outX = W * 0.92;      // assistant output node
    outY = baseY;
    // 5 evenly spaced horizontal lanes on the post-training side
    var nL = 5, pad = H * 0.16, span = H - pad * 2;
    lanes = [];
    for (var i = 0; i < nL; i++) lanes.push(pad + span * (i + 0.5) / nL);
    // comb of 7 short vertical ticks at the divider
    comb = 7;
  }
  layout();

  // ---- particles (fixed count, recycled) -----------------------------------
  var N = 120, P = [];
  function spawn(p, freshX) {
    p.x = freshX ? -W * 0.05 * Math.random() : Math.random() * divX;
    p.y0 = H * 0.10 + Math.random() * H * 0.80; // diffuse corpus y
    p.y = p.y0;
    p.w = 7 + Math.random() * 7;
    p.h = 3.5 + Math.random() * 2.5;
    p.useA2 = Math.random() < 0.5; // hue picks accent or accent-2
    p.lane = (Math.random() * 5) | 0; // target lane after refinement
    p.snap = 0; // 0..1 easing of y toward its lane (post-training)
    return p;
  }
  for (var i = 0; i < N; i++) P.push(spawn({}, false));

  function easeIO(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ---- interaction: pause post-training reshaping --------------------------
  // paused => right side stays diffuse (base model alone). resumed => snaps to lanes.
  var paused = false, hoverLeft = false;
  function setPaused(v) { paused = v; }

  canvas.style.cursor = 'pointer';
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label',
    'Pretraining funnels a broad corpus into a base model; post-training reshapes it into ordered behavior. Hover or tap the left half to see the base model alone.');

  function ptr(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0];
    var cx = (t ? t.clientX : e.clientX) - r.left;
    // map from CSS-display pixels into our CSS-pixel coordinate space
    return r.width ? cx * (W / r.width) : cx;
  }
  // pointer/focus listeners drive the interaction (NOT resize/theme listeners)
  canvas.addEventListener('mousemove', function (e) {
    hoverLeft = ptr(e) < W * 0.5; setPaused(hoverLeft);
  });
  canvas.addEventListener('mouseleave', function () { hoverLeft = false; setPaused(false); });
  canvas.addEventListener('focus', function () { setPaused(true); });
  canvas.addEventListener('blur', function () { if (!hoverLeft) setPaused(false); });
  canvas.addEventListener('touchstart', function (e) {
    if (ptr(e) < W * 0.5) { setPaused(!paused); e.preventDefault(); }
  }, { passive: false });

  // small caption chip in controls
  var cap = null;
  if (controls) {
    cap = document.createElement('span');
    cap.className = 'chip';
    controls.appendChild(cap);
  }

  // ---- expanding rings emitted when a chip reaches the assistant node ------
  var rings = [];

  // hex (#rrggbb / #rgb) -> rgba string; pass through if already rgb()/hsl()
  function hexA(col, a) {
    col = (col || '').trim();
    var r, g, b;
    if (col.charAt(0) === '#') {
      if (col.length === 4) {
        r = parseInt(col[1] + col[1], 16); g = parseInt(col[2] + col[2], 16); b = parseInt(col[3] + col[3], 16);
      } else {
        r = parseInt(col.substr(1, 2), 16); g = parseInt(col.substr(3, 2), 16); b = parseInt(col.substr(5, 2), 16);
      }
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    var m = col.match(/^rgba?\(([^)]+)\)/);
    if (m) { var pp = m[1].split(',').slice(0, 3).join(','); return 'rgba(' + pp + ',' + a + ')'; }
    return col; // fallback: best-effort opaque
  }

  // ---- one frame -----------------------------------------------------------
  var PERIOD = 14000;
  function frame(tMs, dt) {
    var c = pal();
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, H);

    var pulse = 0.5 + 0.5 * Math.sin((tMs / PERIOD) * Math.PI * 2);

    // --- stage labels (low alpha) -------------------------------------------
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c.ink;
    ctx.font = '11px ' + (K.v('--mono') || 'monospace');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillText('pretraining', divX * 0.5, H - 8);
    ctx.fillText('post-training', (divX + W) * 0.5, H - 8);
    ctx.restore();

    // --- funnel (narrowing rightward) ---------------------------------------
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c.rule;
    ctx.lineWidth = 1.2;
    var fL = bx, fR = mouthX, openH = H * 0.62, mouthH = H * 0.13;
    ctx.beginPath();
    ctx.moveTo(fL, baseY - openH / 2);
    ctx.lineTo(fR, baseY - mouthH / 2);
    ctx.moveTo(fL, baseY + openH / 2);
    ctx.lineTo(fR, baseY + mouthH / 2);
    ctx.stroke();
    ctx.restore();

    // --- thin vertical stage divider at 0.62W -------------------------------
    ctx.save();
    ctx.strokeStyle = c.rule;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX + 0.5, H * 0.06);
    ctx.lineTo(divX + 0.5, H * 0.88);
    ctx.stroke();
    ctx.restore();

    // --- refinement comb of ticks at the divider (accent-2) -----------------
    ctx.save();
    ctx.strokeStyle = c.a2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    var pTop = H * 0.14, pBot = H * 0.86;
    for (var ci = 0; ci < comb; ci++) {
      var cy = pTop + (pBot - pTop) * ci / (comb - 1);
      ctx.beginPath();
      ctx.moveTo(divX - 5, cy);
      ctx.lineTo(divX + 5, cy);
      ctx.stroke();
    }
    ctx.restore();

    // --- chips --------------------------------------------------------------
    var dscale = dt / 16.67; // normalize speed to ~60fps
    for (var k = 0; k < N; k++) {
      var p = P[k];

      // accelerate as it converges toward the funnel mouth
      var distToMouth = mouthX > 0 ? Math.max(0, Math.min(1, (mouthX - p.x) / mouthX)) : 0;
      var speed = (0.6 + (1 - distToMouth) * 2.6) * dscale;
      p.x += speed;

      // funnel: lerp y toward centerline as x crosses the middle zone
      if (p.x > midZone && p.x <= divX) {
        var denom = (divX - midZone) || 1;
        var ft = Math.max(0, Math.min(1, (p.x - midZone) / denom));
        p.y = p.y0 + (baseY - p.y0) * easeIO(ft);
      } else if (p.x <= midZone) {
        p.y = p.y0;
      }

      // post-training: past the divider, snap toward an ordered lane
      var inPost = p.x > divX;
      if (inPost) {
        var target = paused ? 0 : 1; // paused => stay diffuse (no snap)
        p.snap += (target - p.snap) * 0.12 * dscale;
        var laneY = lanes[p.lane];
        var diffuseY = baseY + (p.y0 - baseY) * 0.55; // still-ish base-model spread
        p.y = diffuseY + (laneY - diffuseY) * easeIO(p.snap);
      }

      // arrival -> emit ring + recycle
      if (p.x >= outX) {
        if (inPost && p.snap > 0.4) rings.push({ x: outX, y: outY, r: 6, a: 0.5 });
        spawn(p, true);
        continue;
      }

      // draw chip
      var a2on = inPost && !paused; // forced accent-2 + brighter on right
      var col = a2on ? c.a2 : (p.useA2 ? c.a2 : c.a1);
      var alpha = a2on ? (0.35 + 0.5 * p.snap) : 0.35;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      rrect(ctx, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.h / 2);
      ctx.fill();
      ctx.restore();
    }

    // --- base-model blob (soft radial disc, pulsing) at funnel mouth --------
    ctx.save();
    var br = (H * 0.16) * (0.85 + 0.25 * Math.sin((tMs / 1000) * Math.PI * 2 * 0.5));
    br = Math.max(1, br);
    var g = ctx.createRadialGradient(mouthX, baseY, 0, mouthX, baseY, br);
    g.addColorStop(0, hexA(c.a1, 0.5));
    g.addColorStop(1, hexA(c.a1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mouthX, baseY, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- expanding rings from assistant output ------------------------------
    for (var ri = rings.length - 1; ri >= 0; ri--) {
      var rg = rings[ri];
      rg.r += 0.9 * dscale;
      rg.a -= 0.012 * dscale;
      if (rg.a <= 0) { rings.splice(ri, 1); continue; }
      ctx.save();
      ctx.globalAlpha = rg.a;
      ctx.strokeStyle = c.a2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- assistant output node (filled circle, accent-2) --------------------
    ctx.save();
    ctx.fillStyle = c.a2;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(outX, outY, 6.5 + pulse * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- live caption -------------------------------------------------------
    if (cap) cap.textContent = paused
      ? 'base model only — post-training paused'
      : 'pretraining → base model → post-training (ordered behavior)';
  }

  // ---- refit on theme toggle (re-read cached ctx/size + geometry) ----------
  K.onTheme(function () {
    var ff = K.fit(); ctx = ff.ctx; W = ff.w; H = ff.h;
    hasRR = typeof ctx.roundRect === 'function';
    layout();
  });

  // ---- run -----------------------------------------------------------------
  if (K.reduced) {
    // single representative static frame: chips mid-funnel + a populated,
    // already-ordered right side so the 'before vs after' reads at rest.
    paused = false;
    for (var s = 0; s < N; s++) {
      var pp2 = P[s];
      if (s % 2 === 0) {
        // place half the chips across the post-training side, in their lanes
        pp2.x = divX + (((s / 2) % 9) + 0.5) / 9 * (outX - divX);
        pp2.snap = 1;
        pp2.y = lanes[pp2.lane];
      } else {
        // the rest mid-funnel, converging on the centerline
        pp2.x = midZone + ((((s - 1) / 2) % 8) + 0.5) / 8 * (divX - midZone);
        var ft0 = Math.max(0, Math.min(1, (pp2.x - midZone) / ((divX - midZone) || 1)));
        pp2.y = pp2.y0 + (baseY - pp2.y0) * easeIO(ft0);
      }
    }
    frame(PERIOD * 0.5, 16.67);
    return;
  }
  var last = 0;
  K.loop(function (tMs) {
    var dt = last ? Math.min(50, tMs - last) : 16.67;
    last = tMs;
    frame(tMs, dt);
  });
};

  // ───── inference-zoo ─────
  EDU["inference-zoo"] = function (canvas, controls, K) {
  var fit = K.fit(), ctx = fit.ctx, w = fit.w, h = fit.h;

  // ---- layout (all sizes derive from canvas size) --------------------------
  var nodes, agent, paths;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function font(px) { return clamp(px, 9, 14); }

  function build() {
    var mx = w * 0.14, my = h * 0.14;          // ~14% margins for axis labels
    var x0 = mx, x1 = w - mx, y0 = my, y1 = h - my;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var nw = Math.min(150, w * 0.34);
    var nh = nw * 0.3;
    // quadrant centers
    var qxL = (x0 + cx) / 2, qxR = (cx + x1) / 2;
    var qyT = (y0 + cy) / 2, qyB = (cy + y1) / 2;
    nodes = [
      { x: qxR, y: qyT, label: 'Frontier LLM', sub: 'cloud, general', key: 'cloud-general' },
      { x: qxL, y: qyT, label: 'On-device assistant', sub: 'general, small', key: 'on-device-general' },
      { x: qxR, y: qyB, label: 'Cloud specialist', sub: 'e.g. transcription', key: 'cloud-specialist' },
      { x: qxL, y: qyB, label: 'Embedded model', sub: 'offline, one job', key: 'embedded' }
    ];
    for (var i = 0; i < nodes.length; i++) { nodes[i].w = nw; nodes[i].h = nh; nodes[i].i = i; }
    agent = { x: cx, y: cy, r: clamp(w * 0.045, 14, 34), label: 'Tools / Retrieval / Agents', key: 'agent' };

    // curved connectors: agent -> each archetype, plus hybrid handoff
    paths = [];
    function bez(a, b, bow) {
      var mxp = (a.x + b.x) / 2, myp = (a.y + b.y) / 2;
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      // perpendicular bow for a gentle curve
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y,
               qx: mxp + (-dy / len) * bow, qy: myp + (dx / len) * bow };
    }
    for (var k = 0; k < nodes.length; k++) {
      paths.push({ b: bez(agent, nodes[k], nw * 0.12), from: 'agent', to: nodes[k].key, dash: 0 });
    }
    // hybrid handoff: cloud-general -> on-device-general (top edge)
    paths.push({ b: bez(nodes[0], nodes[1], -nh * 1.6), from: 'cloud-general', to: 'on-device-general', dash: 0, hybrid: true });

    return { x0: x0, x1: x1, y0: y0, y1: y1, cx: cx, cy: cy };
  }
  var box = build();

  // ---- captions ------------------------------------------------------------
  var tradeoff = {
    'cloud-general': 'broad ability, needs a network and a data-center model',
    'on-device-general': 'data stays on the device, but less capable than a cloud model',
    'cloud-specialist': 'narrow scope, efficient and accurate at one task',
    'embedded': 'runs with no connection, fixed scope',
    'agent': 'wires models to tools and retrieval — most real systems live here'
  };

  // ---- interaction state ---------------------------------------------------
  var hoverKey = null;        // pointer-driven
  var cycleKey = null;        // idle auto-cycle
  var lastInput = -1e9;       // timestamp (s) of last pointer interaction
  var lastCycle = 0;
  var cycleOrder = ['cloud-general', 'on-device-general', 'cloud-specialist', 'embedded', 'agent'];
  var cycleIdx = 0;

  function activeKey(now) {
    if (hoverKey) return hoverKey;
    if (now - lastInput < 3) return null;     // recently interacted, nothing pinned
    return cycleKey;
  }
  function pathActive(p, key) {
    if (!key) return false;
    if (key === 'agent') return p.from === 'agent';        // agent lights all its spokes
    return p.from === key || p.to === key;
  }
  function nodeActive(n, key) { return key === n.key; }

  // ---- hit testing ---------------------------------------------------------
  function hit(px, py) {
    if (Math.hypot(px - agent.x, py - agent.y) <= agent.r + 4) return 'agent';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (px >= n.x - n.w / 2 && px <= n.x + n.w / 2 && py >= n.y - n.h / 2 && py <= n.y + n.h / 2) return n.key;
    }
    return null;
  }

  function pointerMove(e) {
    var r = canvas.getBoundingClientRect();
    var px = (e.clientX - r.left), py = (e.clientY - r.top);
    var k = hit(px, py);
    hoverKey = k;
    lastInput = perfS();
    canvas.style.cursor = k ? 'pointer' : 'default';
  }
  function pointerLeave() { hoverKey = null; lastInput = perfS(); canvas.style.cursor = 'default'; }
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerdown', pointerMove);
  canvas.addEventListener('pointerleave', pointerLeave);

  // a single timebase shared with the loop (so reduced-motion path works too)
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  function perfS() { var n = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); return (n - t0) / 1000; }

  // ---- drawing -------------------------------------------------------------
  function roundRect(c, x, y, ww, hh, rad) {
    var r = Math.min(rad, ww / 2, hh / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + ww, y, x + ww, y + hh, r);
    c.arcTo(x + ww, y + hh, x, y + hh, r);
    c.arcTo(x, y + hh, x, y, r);
    c.arcTo(x, y, x + ww, y, r);
    c.closePath();
  }

  function draw(tSec, motion) {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), accent = K.v('--accent'),
        rule = K.v('--rule'), bg = K.v('--bg');

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var key = activeKey(tSec);

    // axes
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(box.x0, box.cy); ctx.lineTo(box.x1, box.cy);
    ctx.moveTo(box.cx, box.y0); ctx.lineTo(box.cx, box.y1);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // axis captions
    var af = font(w * 0.018);
    ctx.font = af + 'px ' + (K.v('--mono') || 'monospace');
    ctx.fillStyle = ink2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';   ctx.fillText('ON-DEVICE / OFFLINE', 2, box.cy - af * 0.9);
    ctx.textAlign = 'right';  ctx.fillText('CLOUD', w - 2, box.cy - af * 0.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';    ctx.fillText('GENERAL', box.cx, 2);
    ctx.textBaseline = 'bottom'; ctx.fillText('PURPOSEFUL', box.cx, h - Math.max(af + 4, h * 0.06));

    // paths (behind nodes)
    for (var p = 0; p < paths.length; p++) {
      var pa = paths[p], b = pa.b, act = pathActive(pa, key);
      ctx.beginPath();
      ctx.moveTo(b.ax, b.ay);
      ctx.quadraticCurveTo(b.qx, b.qy, b.bx, b.by);
      if (act) {
        ctx.strokeStyle = accent; ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
        if (motion) { pa.dash -= 0.6; ctx.setLineDash([5, 4]); ctx.lineDashOffset = pa.dash; }
        else ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = rule; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // archetype nodes
    var bob = motion ? 1.5 : 0;
    var lf = font(w * 0.021), sf = font(w * 0.021 - 2.5);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var dy = bob * Math.sin(tSec * 0.6 + i);
      var act2 = nodeActive(n, key);
      roundRect(ctx, n.x - n.w / 2, n.y - n.h / 2 + dy, n.w, n.h, n.h * 0.32);
      ctx.fillStyle = bg; ctx.fill();
      ctx.strokeStyle = act2 ? accent : rule; ctx.lineWidth = act2 ? 2 : 1; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = lf + 'px ' + (K.v('--sans') || 'sans-serif');
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      ctx.fillText(n.label, n.x, n.y + dy - sf * 0.55);
      ctx.font = sf + 'px ' + (K.v('--sans') || 'sans-serif');
      ctx.fillStyle = ink2;
      ctx.fillText(n.sub, n.x, n.y + dy + lf * 0.6);
    }

    // central agent node
    var aAct = (key === 'agent');
    var adyMotion = motion ? 1.2 * Math.sin(tSec * 0.6 + 4) : 0;
    ctx.beginPath();
    ctx.arc(agent.x, agent.y + adyMotion, agent.r, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = aAct ? accent : rule; ctx.lineWidth = aAct ? 2 : 1; ctx.stroke();
    // small glyph (node + spokes) inside the circle
    ctx.strokeStyle = aAct ? accent : ink2; ctx.lineWidth = 1; ctx.globalAlpha = aAct ? 1 : 0.8;
    var gr = agent.r * 0.42;
    ctx.beginPath();
    for (var s = 0; s < 4; s++) {
      var ang = Math.PI / 4 + s * Math.PI / 2;
      ctx.moveTo(agent.x, agent.y + adyMotion);
      ctx.lineTo(agent.x + Math.cos(ang) * gr, agent.y + adyMotion + Math.sin(ang) * gr);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(agent.x, agent.y + adyMotion, gr * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = aAct ? accent : ink2; ctx.fill();
    ctx.globalAlpha = 1;
    // agent label under the circle
    ctx.font = font(w * 0.02) + 'px ' + (K.v('--mono') || 'monospace');
    ctx.fillStyle = aAct ? accent : ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(agent.label, agent.x, agent.y + adyMotion + agent.r + 3);

    // bottom trade-off caption
    if (key && tradeoff[key]) {
      ctx.font = font(w * 0.021) + 'px ' + (K.v('--sans') || 'sans-serif');
      ctx.fillStyle = ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(tradeoff[key], box.cx, h - 2);
    }
  }

  // ---- run -----------------------------------------------------------------
  K.onTheme(function () {
    var f = K.fit(); ctx = f.ctx; w = f.w; h = f.h; box = build();
    if (K.reduced) { cycleKey = null; draw(0, false); }
  });

  if (K.reduced) {
    // static representative frame: agent node + all paths shown faintly, no motion
    // (spec: reduced motion shows the grid at rest, no highlighted spokes)
    cycleKey = null;
    draw(0, false);
    return;
  }

  K.loop(function (tMs) {
    var tSec = (tMs - t0) / 1000;
    // idle auto-cycle every 2.2s after 3s of no input
    if (tSec - lastInput >= 3) {
      if (tSec - lastCycle >= 2.2 || cycleKey === null) {
        cycleKey = cycleOrder[cycleIdx % cycleOrder.length];
        cycleIdx++;
        lastCycle = tSec;
      }
    } else {
      lastCycle = tSec;              // keep cycle from firing the instant idle resumes
      cycleIdx = 0;
      cycleKey = null;
    }
    draw(tSec, true);
  });
};

  // ───── classical-stack ─────
  EDU["classical-stack"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;

  // ---- helpers --------------------------------------------------------------
  function easeInOutQuad(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function fract(x) { return x - Math.floor(x); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function clamp01(u) { return u < 0 ? 0 : (u > 1 ? 1 : u); }
  function rr(x, y, w, h, r) {
    if (w < 0) w = 0; if (h < 0) h = 0;
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  // mix two CSS colors (a -> b by u); hardened to fall back to b on non-hex input.
  function mix(a, b, u) {
    function hx(c) {
      if (typeof c !== 'string') return null;
      c = c.trim().replace('#', '');
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      if (c.length !== 6 || /[^0-9a-fA-F]/.test(c)) return null;
      return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
    }
    var A = hx(a), B = hx(b);
    if (!A || !B) return b; // non-hex theme value: degrade gracefully, never NaN
    return 'rgb(' + Math.round(lerp(A[0], B[0], u)) + ',' + Math.round(lerp(A[1], B[1], u)) + ',' + Math.round(lerp(A[2], B[2], u)) + ')';
  }

  // ---- pipeline model -------------------------------------------------------
  var STAGES = ['SOURCE', 'IR', 'ISA', 'ACCEL'];
  var STAGE_DETAIL = {
    SOURCE: 'Python / CUDA',
    IR: 'hardware-neutral op graph',
    ISA: 'accelerator instructions (e.g. PTX/SASS)',
    ACCEL: 'matmul on silicon'
  };
  var boxes = [];          // {cx,cy,x,y,w,h}
  var glow = [0, 0, 0, 0]; // per-stage lowering glow (0..1), decays
  var sparks = [];         // dissolve particles entering the grid
  var N = 8;

  var t = 0;               // pipeline token progress in [0,1)
  var last = -1;           // last timestamp (seconds)
  var lastLit = -1;        // last pipeline box the token "arrived" at (for glow)
  var spawnedThisCycle = false; // gate dissolve sparks to once per pipeline pass
  var vertical = false;

  // pointer interaction state
  var frozenStage = -1;    // pipeline stage index the token is parked at (-1 none)
  var hoverCell = { r: -1, c: -1 };

  // grid geometry (computed in layout)
  var grid = { x: 0, y: 0, size: 0, cell: 0, gap: 2 };

  function layout() {
    vertical = W < 560;
    var padX = 18, padY = 16;
    var pipeW, pipeH, gridX, gridY, gridSide;

    if (!vertical) {
      N = 8;
      pipeW = W * 0.62;
      pipeH = H;
      gridSide = Math.max(0, Math.min(W * 0.38 - padX * 2, H - padY * 2 - 22));
      gridX = pipeW + (W * 0.38 - gridSide) / 2;
      gridY = (H - gridSide) / 2 - 6;
    } else {
      N = 6;
      pipeW = W; pipeH = H * 0.52;
      gridSide = Math.max(0, Math.min(W - padX * 2, H * 0.48 - padY - 22));
      gridX = (W - gridSide) / 2;
      gridY = pipeH + (H * 0.48 - gridSide - 22) / 2 + 6;
    }

    // pipeline boxes along a baseline
    boxes = [];
    if (!vertical) {
      var bw = Math.min(96, (pipeW - padX * 2) / STAGES.length - 10);
      var bh = 42;
      var baseY = pipeH * 0.42;
      var slot = (pipeW - padX * 2) / STAGES.length;
      for (var i = 0; i < STAGES.length; i++) {
        var cx = padX + slot * i + slot / 2;
        boxes.push({ cx: cx, cy: baseY, x: cx - bw / 2, y: baseY - bh / 2, w: bw, h: bh });
      }
    } else {
      var bw2 = Math.min(104, W - padX * 2);
      var bh2 = 30;
      var slotY = (pipeH - padY * 2) / STAGES.length;
      var cxv = W / 2;
      for (var j = 0; j < STAGES.length; j++) {
        var cyv = padY + slotY * j + slotY / 2;
        boxes.push({ cx: cxv, cy: cyv, x: cxv - bw2 / 2, y: cyv - bh2 / 2, w: bw2, h: bh2 });
      }
    }

    var gap = 2;
    var cell = N > 0 ? (gridSide - gap * (N - 1)) / N : 0;
    grid = { x: gridX, y: gridY, size: gridSide, cell: Math.max(0, cell), gap: gap };
  }
  layout();

  function refit() {
    var ff = K.fit(); ctx = ff.ctx; W = ff.w; H = ff.h; layout();
  }
  K.onTheme(refit);

  // ---- arrows ---------------------------------------------------------------
  function arrow(ax, ay, bx, by, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    var ang = Math.atan2(by - ay, bx - ax), hs = 4.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - hs * Math.cos(ang - 0.5), by - hs * Math.sin(ang - 0.5));
    ctx.lineTo(bx - hs * Math.cos(ang + 0.5), by - hs * Math.sin(ang + 0.5));
    ctx.closePath(); ctx.fill();
  }

  // ---- token position from t ------------------------------------------------
  function tokenPos(tt) {
    var seg = Math.min(STAGES.length - 2, Math.floor(tt * 3));
    if (seg < 0) seg = 0;
    var local = easeInOutQuad(clamp01(fract(tt * 3)));
    var a = boxes[seg], b = boxes[seg + 1];
    return { x: lerp(a.cx, b.cx, local), y: lerp(a.cy, b.cy, local), seg: seg };
  }
  // which box index is the token currently "inside"/at (for deterministic glow)
  function nearestBox(px, py) {
    var idx = 0, best = 1e9;
    for (var i = 0; i < boxes.length; i++) {
      var d = Math.abs(px - boxes[i].cx) + Math.abs(py - boxes[i].cy);
      if (d < best) { best = d; idx = i; }
    }
    return { idx: idx, d: best };
  }

  // ---- main draw ------------------------------------------------------------
  function frame(nowMs) {
    var now = (nowMs || 0) / 1000;
    var dt = last < 0 ? 0 : Math.min(0.05, now - last);
    last = now;

    var ink = K.v('--ink'), faint = K.v('--faint'), rule = K.v('--rule');
    var accent = K.v('--accent'), accent2 = K.v('--accent-2'), bg = K.v('--stage-bg');
    var mono = K.v('--mono') || 'monospace';

    // advance token unless a stage is frozen by hover
    var running = (frozenStage < 0);
    if (running && !K.reduced) {
      var prevT = t;
      t = fract(t + dt * 0.18);
      if (t < prevT) { spawnedThisCycle = false; lastLit = -1; } // wrapped: new pass
      // light a box's lowering glow as the token ARRIVES at a box center.
      var p = tokenPos(t);
      var nb = nearestBox(p.x, p.y);
      // "arrived" if the token is within the box's own half-extent of its center
      var box = boxes[nb.idx];
      var inside = Math.abs(p.x - box.cx) <= box.w / 2 + 1 && Math.abs(p.y - box.cy) <= box.h / 2 + 1;
      if (inside && nb.idx !== lastLit) { glow[nb.idx] = 1; lastLit = nb.idx; }
    }
    // decay glows (~0.5s)
    for (var gi = 0; gi < glow.length; gi++) glow[gi] = Math.max(0, glow[gi] - dt / 0.5);

    // background
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // ---- PIPELINE ----
    // connectors first
    for (var c = 0; c < boxes.length - 1; c++) {
      var A = boxes[c], B = boxes[c + 1];
      if (!vertical) arrow(A.x + A.w, A.cy, B.x - 4, B.cy, accent);
      else arrow(A.cx, A.y + A.h, B.cx, B.y - 4, accent);
    }
    // boxes
    for (var k = 0; k < boxes.length; k++) {
      var bx = boxes[k];
      var g = glow[k];
      ctx.lineWidth = 1 + g * 0.6;
      ctx.strokeStyle = g > 0.01 ? mix(rule, accent, Math.min(1, g)) : rule;
      rr(bx.x, bx.y, bx.w, bx.h, 5); ctx.stroke();
      if (g > 0.01) { // expanding halo
        ctx.save(); ctx.globalAlpha = g * 0.5;
        ctx.strokeStyle = accent; ctx.lineWidth = 1;
        var pad = (1 - g) * 8 + 2;
        rr(bx.x - pad, bx.y - pad, bx.w + pad * 2, bx.h + pad * 2, 5 + pad); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = faint;
      ctx.font = '11px ' + mono;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(STAGES[k], bx.cx, bx.cy);
    }

    // token (or frozen / static)
    var tp;
    if (frozenStage >= 0) {
      tp = { x: boxes[frozenStage].cx, y: boxes[frozenStage].cy };
    } else if (K.reduced) {
      tp = tokenPos(0.5); // frozen mid-pipeline per reduced-motion spec
    } else {
      tp = tokenPos(t);
    }
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 4.5, 0, Math.PI * 2); ctx.fill();

    // dissolve into grid when token reaches ACCEL (once per pass)
    if (running && !K.reduced && t > 0.985 && !spawnedThisCycle) {
      spawnedThisCycle = true;
      var target = boxes[STAGES.length - 1];
      for (var s = 0; s < 4; s++) {
        var tcl = Math.floor(Math.random() * N), trw = Math.floor(Math.random() * N);
        sparks.push({
          x: target.cx, y: target.cy,
          tx: grid.x + tcl * (grid.cell + grid.gap) + grid.cell / 2,
          ty: grid.y + trw * (grid.cell + grid.gap) + grid.cell / 2,
          life: 1
        });
      }
    }
    // update + draw sparks
    for (var si = sparks.length - 1; si >= 0; si--) {
      var sp = sparks[si];
      sp.life -= dt / 0.6;
      if (sp.life <= 0) { sparks.splice(si, 1); continue; }
      var u = 1 - sp.life;
      var sx = lerp(sp.x, sp.tx, u), sy = lerp(sp.y, sp.ty, u);
      ctx.save(); ctx.globalAlpha = sp.life * 0.7; ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // frozen-stage detail label
    if (frozenStage >= 0) {
      var lab = STAGE_DETAIL[STAGES[frozenStage]];
      ctx.fillStyle = ink;
      ctx.font = '11px ' + mono;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var ly = boxes[frozenStage].y + boxes[frozenStage].h + 8;
      ctx.fillText(lab, boxes[frozenStage].cx, ly);
    }

    // ---- MATMUL GRID ----
    var time = K.reduced ? 0 : now;
    for (var r = 0; r < N; r++) {
      for (var cc = 0; cc < N; cc++) {
        var cellX = grid.x + cc * (grid.cell + grid.gap);
        var cellY = grid.y + r * (grid.cell + grid.gap);
        var phase = (r + cc) / (2 * N);
        var a;
        if (K.reduced) {
          a = (Math.abs((r + cc) - (N - 1)) <= 1) ? 0.85 : 0; // static lit diagonal
        } else {
          var u2 = fract(time * 0.5 - phase);
          a = u2 < 0.18 ? (u2 / 0.18) : Math.max(0, 1 - (u2 - 0.18) / 0.4);
        }
        // hovered row/col dot-product highlight
        if (hoverCell.r >= 0 && (hoverCell.r === r || hoverCell.c === cc)) {
          ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = accent2;
          ctx.fillRect(cellX, cellY, grid.cell, grid.cell); ctx.restore();
        }
        // base activation fill
        ctx.save(); ctx.globalAlpha = 0.12 + 0.7 * a; ctx.fillStyle = accent;
        ctx.fillRect(cellX, cellY, grid.cell, grid.cell); ctx.restore();
        // rest outline
        ctx.strokeStyle = rule; ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, cellY + 0.5, grid.cell - 1, grid.cell - 1);
        // firing MAC: bright inner square
        if (a > 0.6) {
          ctx.save(); ctx.globalAlpha = Math.min(1, (a - 0.6) / 0.4); ctx.fillStyle = accent2;
          var ins = grid.cell * 0.34;
          ctx.fillRect(cellX + (grid.cell - ins) / 2, cellY + (grid.cell - ins) / 2, ins, ins);
          ctx.restore();
        }
        // hovered exact cell ring
        if (hoverCell.r === r && hoverCell.c === cc) {
          ctx.strokeStyle = accent2; ctx.lineWidth = 1.5;
          ctx.strokeRect(cellX + 0.75, cellY + 0.75, grid.cell - 1.5, grid.cell - 1.5);
        }
      }
    }
    // caption strip
    ctx.fillStyle = faint;
    ctx.font = '10px ' + mono;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('matrix multiply (MAC array)', grid.x + grid.size / 2, grid.y + grid.size + 6);
  }

  // ---- pointer interaction --------------------------------------------------
  function locate(px, py) {
    // grid hit-test
    if (grid.size > 0 && px >= grid.x && px <= grid.x + grid.size && py >= grid.y && py <= grid.y + grid.size) {
      var cc = Math.floor((px - grid.x) / (grid.cell + grid.gap));
      var rw = Math.floor((py - grid.y) / (grid.cell + grid.gap));
      if (cc >= 0 && cc < N && rw >= 0 && rw < N) {
        hoverCell.r = rw; hoverCell.c = cc; frozenStage = -1; return;
      }
    }
    hoverCell.r = -1; hoverCell.c = -1;
    // pipeline box hit-test
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4) {
        frozenStage = i; return;
      }
    }
    frozenStage = -1;
  }
  function pointerXY(e) {
    var rct = canvas.getBoundingClientRect();
    var src = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: src.clientX - rct.left, y: src.clientY - rct.top };
  }
  function clearHover() { hoverCell.r = -1; hoverCell.c = -1; frozenStage = -1; }
  if (!K.reduced) {
    canvas.addEventListener('pointermove', function (e) { var p = pointerXY(e); locate(p.x, p.y); });
    canvas.addEventListener('pointerleave', clearHover);
    canvas.addEventListener('touchstart', function (e) { var p = pointerXY(e); locate(p.x, p.y); }, { passive: true });
    canvas.addEventListener('touchend', clearHover);
  }

  if (K.reduced) { frame(0); return; }
  K.loop(frame);
};

  // ───── quantum-sim ─────
  EDU["quantum-sim"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; });
  var S2 = 1 / Math.sqrt(2);
  var a0 = K.C(1, 0), a1 = K.C(0, 0);                 // true single-qubit state
  function gate(name) {
    var t = Math.PI / 2;                                // Rx(pi/2)
    var M = {
      H: [[K.C(S2), K.C(S2)], [K.C(S2), K.C(-S2)]],
      X: [[K.C(0), K.C(1)], [K.C(1), K.C(0)]],
      Z: [[K.C(1), K.C(0)], [K.C(0), K.C(-1)]],
      S: [[K.C(1), K.C(0)], [K.C(0), K.C(0, 1)]],
      T: [[K.C(1), K.C(0)], [K.C(0), K.C(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))]],
      Rx: [[K.C(Math.cos(t / 2), 0), K.C(0, -Math.sin(t / 2))], [K.C(0, -Math.sin(t / 2)), K.C(Math.cos(t / 2), 0)]]
    };
    return M[name];
  }
  function apply(m) {
    var n0 = K.cadd(K.cmul(m[0][0], a0), K.cmul(m[0][1], a1));
    var n1 = K.cadd(K.cmul(m[1][0], a0), K.cmul(m[1][1], a1));
    a0 = n0; a1 = n1;
  }
  function blochOf() {
    var p = K.cmul(K.cconj(a0), a1);
    return { x: 2 * p.re, y: 2 * p.im, z: K.cabs(a0) * K.cabs(a0) - K.cabs(a1) * K.cabs(a1) };
  }
  var disp = blochOf(), lastU = { x: 0, y: 0, z: 1 };
  var dp0 = 1, dp1 = 0;
  function hue(re, im) { return ((Math.atan2(im, re) * 180 / Math.PI) + 360) % 360; }
  function phaseCol(re, im, al) { return 'hsla(' + hue(re, im).toFixed(0) + ',72%,' + (K.dark() ? 62 : 46) + '%,' + al + ')'; }

  // ---- controls ----
  function btn(label, primary, fn) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = primary ? 'btn primary' : 'btn'; b.textContent = label;
    b.addEventListener('click', function () { fn(); if (K.reduced) snap(); });
    controls.appendChild(b); return b;
  }
  ['H', 'X', 'Z', 'S', 'T', 'Rx'].forEach(function (g) { btn(g, false, function () { apply(gate(g)); }); });
  btn('Reset', true, function () { a0 = K.C(1, 0); a1 = K.C(0, 0); });

  function snap() { var b = blochOf(); disp = b; dp0 = K.cabs(a0) * K.cabs(a0); dp1 = K.cabs(a1) * K.cabs(a1); render(); }

  function render() {
    var ink = K.v('--ink'), faint = K.v('--faint'), rule = K.v('--rule-2'), ink2 = K.v('--ink-2'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // ===== left: phase-coloured amplitude bars =====
    var padL = 20, barW = Math.min(46, (W * 0.40) / 3), gap = barW * 0.7;
    var baseY = H - 54, topY = 36, maxH = baseY - topY;
    var x0 = padL + gap, x1 = x0 + barW + gap * 1.5;
    var heights = [Math.max(2, dp0 * maxH), Math.max(2, dp1 * maxH)];
    var amps = [a0, a1], labels = ['|0⟩', '|1⟩'], probs = [dp0, dp1];
    ctx.font = '12px ' + mono;
    for (var i = 0; i < 2; i++) {
      var bx = i === 0 ? x0 : x1, h = heights[i];
      ctx.fillStyle = phaseCol(amps[i].re, amps[i].im, 0.9);
      ctx.fillRect(bx, baseY - h, barW, h);
      ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, baseY - h + 0.5, barW - 1, h - 1);
      ctx.fillStyle = ink; ctx.textAlign = 'center';
      ctx.fillText(labels[i], bx + barW / 2, baseY + 18);
      ctx.fillStyle = ink2;
      ctx.fillText((probs[i] * 100).toFixed(0) + '%', bx + barW / 2, baseY - h - 7);
    }
    // baseline + caption
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(padL, baseY + 0.5); ctx.lineTo(x1 + barW + gap, baseY + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = faint; ctx.textAlign = 'left'; ctx.font = '10.5px ' + mono;
    ctx.fillText('amplitudes  (height = probability, hue = phase)', padL, topY - 14);

    // ===== right: Bloch sphere =====
    var cx = W * 0.74, cy = H * 0.48, r = Math.min(W * 0.20, H * 0.36);
    // outline + equator ellipse + vertical axis
    ctx.strokeStyle = rule; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.32);
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); ctx.globalAlpha = 1;
    // pole / axis labels
    ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('|0⟩', cx, cy - r - 8); ctx.fillText('|1⟩', cx, cy + r + 16);
    ctx.textAlign = 'left'; ctx.fillText('|+⟩', cx + r + 6, cy + 4);

    // normalized arrow (stays on the surface)
    var L = Math.hypot(disp.x, disp.y, disp.z);
    var u = L < 0.05 ? lastU : { x: disp.x / L, y: disp.y / L, z: disp.z / L };
    if (L >= 0.05) lastU = u;
    var sx = cx + r * u.x, sy = cy - r * u.z + r * 0.32 * u.y;
    // shadow dot on equator plane
    ctx.fillStyle = faint; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx + r * u.x, cy + r * 0.32 * u.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    // the state arrow
    var acc = K.v('--accent');
    ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = '3px'; // center dot
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fillStyle = faint; ctx.fill();
  }

  function tick() {
    var b = blochOf();
    disp.x += (b.x - disp.x) * 0.16; disp.y += (b.y - disp.y) * 0.16; disp.z += (b.z - disp.z) * 0.16;
    var p0 = K.cabs(a0) * K.cabs(a0), p1 = K.cabs(a1) * K.cabs(a1);
    dp0 += (p0 - dp0) * 0.2; dp1 += (p1 - dp1) * 0.2;
    render();
  }
  if (K.reduced) { snap(); } else { K.loop(tick); }
};

  // ───── hybrid-quantum ─────
  EDU["hybrid-quantum"] = function (canvas, controls, K) {
  // ---- toy variational landscape (mirrors isingbell2: Emin = -2) ----
  var Emin = -2, topt0 = Math.PI / 4, topt1 = Math.PI / 4;
  function Eclean(t0, t1) {
    return Emin + 1.0 * (1 - Math.cos(t0 - topt0)) + 1.0 * (1 - Math.cos(t1 - topt1));
  }
  function grad(t0, t1) {
    var eps = 1e-4;
    var g0 = (Eclean(t0 + eps, t1) - Eclean(t0 - eps, t1)) / (2 * eps);
    var g1 = (Eclean(t0, t1 + eps) - Eclean(t0, t1 - eps)) / (2 * eps);
    return [g0, g1];
  }

  // ---- state ----
  var theta = [2.6, -1.7];          // start away from the minimum
  var iter = 0;
  var lr = 0.35;                    // step size (slider value)
  // The slider (0.05..0.9) is scaled into the descent so its top end crosses
  // the gradient-descent stability bound (eff-step ~ 2/L, L=1 here): low/mid lr
  // settles cleanly to -2, while the top of the range stalls ABOVE the floor --
  // the spec's "step size matters" lesson, made visible on this 1-cos cost.
  var GAIN = 2.3;
  var running = true;
  var noiseOn = false;
  var noiseAmp = 0.08;
  var converged = false;
  var hist = [];                    // {iter, e} measured-energy history
  function pushHist() {
    var e = Eclean(theta[0], theta[1]);
    var plotted = noiseOn ? e + (Math.random() - 0.5) * noiseAmp : e;
    hist.push({ iter: iter, eClean: e, e: plotted });
    if (hist.length > 80) hist.shift();
  }
  pushHist();

  function doStep() {
    if (converged) return;
    var g = grad(theta[0], theta[1]);
    theta[0] -= lr * GAIN * g[0];
    theta[1] -= lr * GAIN * g[1];
    iter++;
    pushHist();
    if (Math.abs(Eclean(theta[0], theta[1]) - Emin) < 0.01) converged = true;
  }

  // ---- loop traversal state (dot advancing clockwise) ----
  var lapT = 0;            // 0..1 around the ring
  var LAP_MS = 2500;
  var lastTs = 0;

  // ---- controls ----
  var runBtn = document.createElement('button');
  runBtn.className = 'btn';
  runBtn.type = 'button';
  runBtn.textContent = 'Pause';
  runBtn.addEventListener('click', function () {
    running = !running;
    runBtn.textContent = running ? 'Pause' : 'Run';
  });

  var stepBtn = document.createElement('button');
  stepBtn.className = 'btn';
  stepBtn.type = 'button';
  stepBtn.textContent = 'Step';
  stepBtn.addEventListener('click', function () { doStep(); lapT = 0; });

  var resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', function () {
    theta = [2.6, -1.7]; iter = 0; converged = false; hist = []; pushHist(); lapT = 0;
  });

  var stepWrap = document.createElement('label');
  stepWrap.style.display = 'inline-flex';
  stepWrap.style.alignItems = 'center';
  stepWrap.style.gap = '6px';
  var stepTxt = document.createElement('span');
  stepTxt.className = 'chip';
  stepTxt.textContent = 'step ' + lr.toFixed(2);
  var stepRange = document.createElement('input');
  stepRange.type = 'range';
  stepRange.min = '0.05'; stepRange.max = '0.9'; stepRange.step = '0.01';
  stepRange.value = String(lr);
  stepRange.setAttribute('aria-label', 'optimizer step size');
  stepRange.addEventListener('input', function () {
    lr = parseFloat(stepRange.value);
    stepTxt.textContent = 'step ' + lr.toFixed(2);
    // Changing the step size re-arms the descent so a higher step can be seen to
    // overshoot even after a previous run settled -- the "step size matters" point.
    converged = false;
  });
  stepWrap.appendChild(stepTxt);
  stepWrap.appendChild(stepRange);

  var noiseWrap = document.createElement('label');
  noiseWrap.style.display = 'inline-flex';
  noiseWrap.style.alignItems = 'center';
  noiseWrap.style.gap = '6px';
  var noiseChk = document.createElement('input');
  noiseChk.type = 'checkbox';
  noiseChk.addEventListener('change', function () { noiseOn = noiseChk.checked; });
  var noiseTxt = document.createElement('span');
  noiseTxt.className = 'chip';
  noiseTxt.textContent = 'measurement noise';
  noiseWrap.appendChild(noiseChk);
  noiseWrap.appendChild(noiseTxt);

  if (controls) {
    controls.appendChild(runBtn);
    controls.appendChild(stepBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(stepWrap);
    controls.appendChild(noiseWrap);
  }

  // ---- sizing ----
  var fitR = K.fit();
  var ctx = fitR.ctx, W = fitR.w, H = fitR.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- helpers ----
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---- drawing the loop ----
  function draw(ts) {
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs; lastTs = ts;
    if (running && !converged) {
      lapT += dt / LAP_MS;
      while (lapT >= 1) { lapT -= 1; doStep(); }
    }

    var ink = K.v('--ink') || '#15171c';
    var ink2 = K.v('--ink-2') || ink;
    var accent = K.v('--accent') || '#28489e';
    var accent2 = K.v('--accent-2') || '#6a3fb0';
    var pass = K.v('--pass') || '#1a9d6a';
    var rule = K.v('--rule') || ink2;
    var bg = K.v('--bg');
    var stage = K.v('--stage-bg') || bg;
    var mono = K.v('--mono') || 'monospace';
    var isDark = K.dark();
    var nodeFill = stage || (isDark ? '#15171c' : '#ffffff');

    ctx.clearRect(0, 0, W, H);

    var loopH = H * 0.58;
    var plotY0 = loopH + 6;
    var plotH = H - plotY0 - 6;

    // ===== LOOP region =====
    var cx = W / 2;
    var cy = loopH * 0.52;
    var R = Math.min(W * 0.30, loopH * 0.40);
    R = Math.max(R, 40);

    // node centers: top=optimizer, right=circuit (the two labeled nodes)
    var nodes = [
      { ang: -Math.PI / 2, label: 'CLASSICAL', sub: 'OPTIMIZER', kind: 'opt' },   // top
      { ang: 0, label: 'QUANTUM', sub: 'CIRCUIT', kind: 'qc' },                    // right
    ];
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].x = cx + R * Math.cos(nodes[i].ang);
      nodes[i].y = cy + R * Math.sin(nodes[i].ang);
    }

    // which quarter is the dot in? lapT 0..1 maps clockwise from top.
    var seg = Math.floor(lapT * 4) % 4;

    // ring as four quarter arcs (clockwise). draw inactive then active.
    function arcSeg(s, color, width, dash, dashOff) {
      var a0 = -Math.PI / 2 + s * (Math.PI / 2);
      var a1 = a0 + Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1, false);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      if (dash) { ctx.setLineDash([5, 6]); ctx.lineDashOffset = dashOff; }
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    var dashOff = -(ts * 0.06);
    for (var s = 0; s < 4; s++) {
      var active = (s === seg) && running && !converged;
      var col = converged ? pass : (active ? accent : rule);
      arcSeg(s, col, active || converged ? 2 : 1, active, dashOff);
    }

    // arc captions
    ctx.font = clamp(W * 0.018, 9, 12) + 'px ' + mono;
    ctx.fillStyle = ink2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // descending right arc (top->right): theta (parameters)
    var pr = { x: cx + R * Math.cos(-Math.PI / 4), y: cy + R * Math.sin(-Math.PI / 4) };
    ctx.fillText('theta (params)', pr.x + 34, pr.y - 4);
    // ascending left arc (left->top): E = <psi|H|psi>
    var pl = { x: cx + R * Math.cos(-3 * Math.PI / 4), y: cy + R * Math.sin(-3 * Math.PI / 4) };
    ctx.fillText('E = <H>', pl.x - 30, pl.y - 4);

    // arrowheads to show direction (clockwise)
    function arrowAt(ang, color) {
      var ax = cx + R * Math.cos(ang), ay = cy + R * Math.sin(ang);
      var tang = ang + Math.PI / 2; // clockwise tangent
      var sz = 6;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(tang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-sz, -sz * 0.6);
      ctx.lineTo(-sz, sz * 0.6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }
    arrowAt(-Math.PI / 4, converged ? pass : ink2);
    arrowAt(-3 * Math.PI / 4, converged ? pass : ink2);

    // moving dot along the ring
    var dotAng = -Math.PI / 2 + lapT * Math.PI * 2;
    var dx = cx + R * Math.cos(dotAng), dy = cy + R * Math.sin(dotAng);
    if (isDark) { ctx.shadowColor = converged ? pass : accent; ctx.shadowBlur = 10; }
    ctx.beginPath();
    ctx.arc(dx, dy, 5, 0, Math.PI * 2);
    ctx.fillStyle = converged ? pass : accent;
    ctx.fill();
    ctx.shadowBlur = 0;

    // light up the node the dot is currently entering
    var topActive = (seg === 3) || (lapT < 0.02);
    var rightActive = (seg === 0);

    // draw nodes
    function drawNode(n, lit) {
      var nw = clamp(W * 0.20, 84, 150);
      var nh = nw * 0.42;
      var x = n.x - nw / 2, y = n.y - nh / 2;
      var litCol = converged ? pass : accent;
      if (isDark && lit) { ctx.shadowColor = litCol; ctx.shadowBlur = 8; }
      roundRect(ctx, x, y, nw, nh, 6);
      ctx.fillStyle = nodeFill;
      ctx.fill();
      ctx.lineWidth = lit ? 2 : 1;
      ctx.strokeStyle = lit ? litCol : ink;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // glyph area on left, text on right
      ctx.strokeStyle = lit ? litCol : ink;
      ctx.fillStyle = lit ? litCol : ink;
      ctx.lineWidth = 1.2;
      if (n.kind === 'opt') {
        // three stacked sliders
        for (var k = 0; k < 3; k++) {
          var sy = n.y - nh * 0.22 + k * (nh * 0.22);
          ctx.beginPath();
          ctx.moveTo(x + nh * 0.28, sy);
          ctx.lineTo(x + nh * 0.78, sy);
          ctx.stroke();
          var knob = x + nh * 0.28 + (nh * 0.5) * (0.3 + 0.4 * k);
          ctx.beginPath();
          ctx.arc(knob, sy, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // two qubit lines + box gate + control dot
        var ly1 = n.y - nh * 0.16, ly2 = n.y + nh * 0.16;
        ctx.beginPath();
        ctx.moveTo(x + nh * 0.25, ly1); ctx.lineTo(x + nh * 0.85, ly1);
        ctx.moveTo(x + nh * 0.25, ly2); ctx.lineTo(x + nh * 0.85, ly2);
        ctx.stroke();
        // box gate on line 1
        ctx.strokeRect(x + nh * 0.42, ly1 - nh * 0.10, nh * 0.20, nh * 0.20);
        // control dot on line 2 + connector
        ctx.beginPath();
        ctx.arc(x + nh * 0.52, ly2, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + nh * 0.52, ly1 + nh * 0.10);
        ctx.lineTo(x + nh * 0.52, ly2);
        ctx.stroke();
      }

      // labels to the right of glyph
      var tx = x + nh * 0.95;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = lit ? litCol : ink;
      ctx.font = clamp(W * 0.017, 8, 11) + 'px ' + mono;
      ctx.fillText(n.label, tx, n.y - nh * 0.16);
      ctx.fillStyle = ink2;
      ctx.fillText(n.sub, tx, n.y + nh * 0.16);
    }
    drawNode(nodes[0], topActive || converged);
    drawNode(nodes[1], rightActive);

    // ===== ENERGY PLOT region =====
    if (plotH > 24) {
      var pad = clamp(W * 0.06, 30, 56);
      var px0 = pad, px1 = W - 12;
      var pyTop = plotY0 + 4, pyBot = H - 16;
      var pw = px1 - px0, ph = pyBot - pyTop;

      // y-range
      var maxE = Emin + 0.1;
      for (var h = 0; h < hist.length; h++) maxE = Math.max(maxE, hist[h].e);
      var loE = Emin - 0.12, hiE = maxE + 0.05;
      function yOf(e) { return pyBot - (e - loE) / (hiE - loE) * ph; }

      // baseline frame (x axis)
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(px0, pyBot); ctx.lineTo(px1, pyBot);
      ctx.moveTo(px0, pyTop); ctx.lineTo(px0, pyBot);
      ctx.stroke();

      // ground-state reference line
      var gy = yOf(Emin);
      ctx.strokeStyle = pass;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px0, gy); ctx.lineTo(px1, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pass;
      ctx.font = clamp(W * 0.016, 8, 10) + 'px ' + mono;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('ground state E = -2', px0 + 4, gy - 2);

      // history polyline
      var n = hist.length;
      if (n > 1) {
        var xOf = function (k) { return px0 + (n === 1 ? 0 : (k / (n - 1)) * pw); };
        ctx.beginPath();
        for (var k = 0; k < n; k++) {
          var xx = xOf(k), yy = yOf(hist[k].e);
          if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = converged ? pass : accent;
        ctx.stroke();

        // latest point dot
        var lx = xOf(n - 1), ly = yOf(hist[n - 1].e);
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = converged ? pass : accent2;
        ctx.fill();
      }

      // numeric annotation of current clean energy
      var curE = Eclean(theta[0], theta[1]);
      ctx.font = clamp(W * 0.02, 9, 13) + 'px ' + mono;
      ctx.fillStyle = converged ? pass : ink;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      var msg = converged
        ? 'converged: ground state reached'
        : 'iter ' + iter + '   E = ' + curE.toFixed(3);
      ctx.fillText(msg, px1, pyTop - 2);
    }
  }

  // ---- run ----
  if (K.reduced) {
    // one representative static frame: drive a few steps, no loop
    for (var w = 0; w < 18; w++) doStep();
    running = false;
    draw(0);
  } else {
    K.loop(function (t) { draw(t); });
  }
};

  // ───── your-run ─────
  EDU["your-run"] = function (canvas, controls, K) {
  var fit = K.fit(), ctx = fit.ctx, W = fit.w, H = fit.h;
  var cssW = canvas.clientWidth, cssH = canvas.clientHeight;

  function refit() { var f = K.fit(); ctx = f.ctx; W = f.w; H = f.h; cssW = canvas.clientWidth; cssH = canvas.clientHeight; }

  function pal() {
    var ink = K.v('--ink') || (K.dark() ? '#eaedff' : '#15171c');
    var paper = K.v('--bg') || (K.dark() ? '#06070f' : '#ffffff');
    var acc = K.v('--accent') || '#1bb39a';
    var faint = K.v('--faint') || ink;
    return { ink: ink, paper: paper, acc: acc, faint: faint };
  }

  // accept "#abc" / "#aabbcc" or "rgb(...)" forms; alpha-wrap to rgba()
  function rgba(col, a) {
    col = col || '';
    if (col.charAt(0) === '#') {
      var hex = col.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      var n = parseInt(hex, 16);
      if (isNaN(n) || hex.length !== 6) return 'rgba(0,0,0,' + a + ')';
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var m = col.match(/(\d+(?:\.\d+)?)/g);
    if (m && m.length >= 3) return 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + a + ')';
    return 'rgba(0,0,0,' + a + ')';
  }
  function clamp01(u) { return u < 0 ? 0 : u > 1 ? 1 : u; }
  function easeOut(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }

  var GATES = ['STRUCTURE', 'REPRO', 'PERF', 'ANTI-OVERFIT'];
  var gateState, sparks, trail, newRowScore, passedAll, passedAllAt;

  function resetCycle() {
    gateState = [-1, -1, -1, -1];
    sparks = [];
    trail = [];
    passedAll = false;
    passedAllAt = 0;
    newRowScore = (0.90 + Math.random() * 0.095);
  }
  resetCycle();

  var rows = [
    { tag: 'tfim3 · qaoa', s: 0.971 },
    { tag: 'isingbell2', s: 0.958 },
    { tag: 'ghz4 · hwe', s: 0.944 },
    { tag: 'tfim3 · hwe', s: 0.921 }
  ];

  var hoverX = null;
  function onMove(e) { var r = canvas.getBoundingClientRect(); hoverX = (e.clientX - r.left); }
  function onLeave() { hoverX = null; }
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  var DUR = 4200, HOLD = 1200, FADE = 600, SLIDE = 700, start = 0;

  K.onTheme(refit);

  function geom() {
    var splitX = W * 0.62;
    var laneX0 = 26, laneX1 = splitX - 22;
    var laneW = Math.max(1, laneX1 - laneX0);
    var laneY = H * 0.42;
    var gx = [];
    for (var i = 0; i < 4; i++) gx.push(laneX0 + (i + 0.5) * (laneW / 4));
    return { splitX: splitX, laneX0: laneX0, laneX1: laneX1, laneW: laneW, laneY: laneY, gx: gx };
  }

  function roundRect(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function emitSparks(x, y, nowMs) {
    var n = 7;
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      sparks.push({ x: x, y: y, dx: Math.cos(ang), dy: Math.sin(ang), birth: nowMs });
    }
  }

  function drawLane(g, p) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(p.ink, 0.28);
    ctx.beginPath();
    ctx.moveTo(g.laneX0, g.laneY);
    ctx.lineTo(g.laneX1, g.laneY);
    ctx.stroke();

    ctx.font = '11px ' + (K.v('--mono') || 'monospace');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(p.faint, 0.85);
    ctx.fillText('HERMETIC JUDGE', g.laneX0, 22);
    ctx.fillText('SCOREBOARD', g.splitX + 14, 22);
  }

  // passedFn(i) -> boolean: whether gate i is latched green
  function drawGates(g, p, passedFn) {
    var barW = 30, barH = 64;
    for (var i = 0; i < 4; i++) {
      var bx = g.gx[i] - barW / 2, by = g.laneY - barH / 2;
      var passed = passedFn(i);
      roundRect(bx, by, barW, barH, 7);
      if (passed) { ctx.fillStyle = rgba(p.acc, 0.92); ctx.fill(); }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = passed ? p.acc : rgba(p.ink, 0.55);
      ctx.stroke();
      if (passed) {
        ctx.strokeStyle = p.paper;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(g.gx[i] - 7, g.laneY + 1);
        ctx.lineTo(g.gx[i] - 1.5, g.laneY + 7);
        ctx.lineTo(g.gx[i] + 8, g.laneY - 7);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.font = '11px ' + (K.v('--mono') || 'monospace');
      ctx.textAlign = 'center';
      ctx.fillStyle = passed ? p.acc : rgba(p.ink, 0.7);
      var ly = by + barH + 14;
      if (GATES[i] === 'ANTI-OVERFIT') {
        ctx.fillText('ANTI-', g.gx[i], ly);
        ctx.fillText('OVERFIT', g.gx[i], ly + 12);
      } else {
        ctx.fillText(GATES[i], g.gx[i], ly);
      }
    }
    ctx.textAlign = 'left';
  }

  function drawToken(x, y, p) {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = p.acc;
    ctx.fill();
    ctx.strokeStyle = p.paper;
    ctx.fillStyle = p.paper;
    ctx.lineWidth = 1.3;
    var pts = [[x - 4, y - 3], [x + 1, y + 3], [x + 5, y - 2]];
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.stroke();
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // slide in [0,1] (new row docking), fade in [0,1] (1=opaque)
  function drawScoreboard(g, p, slide, fade, showNew) {
    var panelX = g.splitX + 14, panelW = Math.max(1, W - panelX - 22);
    var rowH = 24, gap = 8, baseY = 36;

    ctx.font = '10.5px ' + (K.v('--mono') || 'monospace');
    ctx.textBaseline = 'middle';

    for (var i = 0; i < rows.length; i++) {
      var targetIdx = showNew ? i + 1 : i;
      var idx = i + (targetIdx - i) * slide;
      var ry = baseY + idx * (rowH + gap);
      var rowFade = showNew ? fade : 1;
      var a = 0.35 * rowFade;
      roundRect(panelX, ry, panelW, rowH, 6);
      ctx.fillStyle = rgba(p.ink, a * 0.12);
      ctx.fill();
      ctx.strokeStyle = rgba(p.ink, a);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rgba(p.ink, 0.55 * rowFade);
      ctx.textAlign = 'left';
      ctx.fillText('#' + (Math.round(idx) + 1) + '  ' + rows[i].tag, panelX + 9, ry + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(rows[i].s.toFixed(3), panelX + panelW - 9, ry + rowH / 2);
    }

    if (showNew) {
      var fromY = baseY + (rows.length + 1) * (rowH + gap) + 30;
      var toY = baseY;
      var ny = fromY + (toY - fromY) * slide;
      roundRect(panelX, ny, panelW, rowH, 6);
      ctx.fillStyle = rgba(p.acc, 0.14 * fade);
      ctx.fill();
      ctx.strokeStyle = rgba(p.acc, fade);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      roundRect(panelX, ny, 4, rowH, 2);
      ctx.fillStyle = rgba(p.acc, fade);
      ctx.fill();
      ctx.fillStyle = rgba(p.acc, fade);
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px ' + (K.v('--mono') || 'monospace');
      ctx.fillText('+', panelX + 10, ny + rowH / 2);
      ctx.fillStyle = rgba(p.ink, fade);
      ctx.font = '10.5px ' + (K.v('--mono') || 'monospace');
      ctx.fillText('#1  your-run', panelX + 22, ny + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(newRowScore.toFixed(3), panelX + panelW - 9, ny + rowH / 2);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  function draw(nowMs) {
    if (!start) start = nowMs;
    if (canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) refit();
    if (W < 2 || H < 2) return;
    var p = pal();
    var g = geom();

    ctx.clearRect(0, 0, W, H);

    var elapsed = nowMs - start;
    var frozen = (hoverX != null);
    var t;
    if (frozen) {
      t = clamp01((hoverX - g.laneX0) / g.laneW);
    } else {
      t = elapsed / DUR; if (t > 1) t = 1;
    }

    var tokenX = g.laneX0 + t * g.laneW;
    var tokenY = g.laneY;

    for (var i = 0; i < 4; i++) {
      if (gateState[i] < 0 && tokenX >= g.gx[i] - 0.5) {
        gateState[i] = nowMs;
        emitSparks(g.gx[i], g.laneY, nowMs);
      }
    }
    var allGreen = gateState[3] >= 0;
    if (allGreen && !passedAll) { passedAll = true; passedAllAt = nowMs; }

    drawLane(g, p);
    drawGates(g, p, function (i) { return gateState[i] >= 0; });

    // sparks
    for (var s = sparks.length - 1; s >= 0; s--) {
      var sp = sparks[s];
      var age = (nowMs - sp.birth) / 400;
      if (age >= 1) { sparks.splice(s, 1); continue; }
      var sa = 1 - age;
      ctx.strokeStyle = rgba(p.acc, sa);
      ctx.lineWidth = 1.5;
      var d = 6 + age * 16;
      ctx.beginPath();
      ctx.moveTo(sp.x + sp.dx * 6, sp.y + sp.dy * 6);
      ctx.lineTo(sp.x + sp.dx * d, sp.y + sp.dy * d);
      ctx.stroke();
    }

    // trail
    if (!frozen) { trail.push({ x: tokenX, y: tokenY, age: 0 }); }
    for (var k = trail.length - 1; k >= 0; k--) {
      trail[k].age += 0.06;
      if (trail[k].age > 1) { trail.splice(k, 1); continue; }
      ctx.fillStyle = rgba(p.acc, (1 - trail[k].age) * 0.4);
      ctx.beginPath();
      ctx.arc(trail[k].x, trail[k].y, 5 * (1 - trail[k].age) + 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    drawToken(tokenX, tokenY, p);

    // scoreboard slide/fade driven by the all-green sub-clock
    var slide = 0, fade = 1;
    if (allGreen) {
      var since = nowMs - passedAllAt;
      slide = easeOut(since / SLIDE);
      if (since > SLIDE + HOLD) fade = clamp01(1 - easeOut((since - SLIDE - HOLD) / FADE));
    }
    drawScoreboard(g, p, slide, fade, allGreen);

    if (frozen) {
      ctx.font = '10.5px ' + (K.v('--mono') || 'monospace');
      ctx.fillStyle = rgba(p.faint, 0.8);
      ctx.textAlign = 'center';
      var latched = 0; for (var q = 0; q < 4; q++) if (gateState[q] >= 0) latched++;
      ctx.fillText('paused · ' + latched + '/4 latched', g.splitX * 0.5, H - 8);
      ctx.textAlign = 'left';
    }

    if (!frozen && passedAll) {
      var done = nowMs - passedAllAt;
      if (done > (SLIDE + HOLD + FADE)) { start = nowMs; resetCycle(); }
    }
  }

  // ---- reduced motion: one representative completed frame -------------------
  if (K.reduced) {
    if (canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) refit();
    if (W < 2 || H < 2) return;
    var p0 = pal(), g0 = geom();
    ctx.clearRect(0, 0, W, H);
    drawLane(g0, p0);
    drawGates(g0, p0, function () { return true; });           // all four green
    drawToken(g0.laneX1, g0.laneY, p0);                        // token parked at lane end
    drawScoreboard(g0, p0, 1, 1, true);                        // new row docked, fully opaque
    return;
  }

  K.loop(draw);
};
  // ==========================================================================

  // ============ PART V: the efficiency frontier (North Star) ============

// ───── efficiency (the North Star: where machine intelligence gets more efficient) ─────
  EDU["efficiency"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  // DATA — every lever, adversarially verified, with the baseline it was measured against + source.
  // mult = verified efficiency multiplier (× vs its stated baseline); headline = the marketed number (if inflated).
  var LEVERS = [
    { name: 'Quantization (INT4/8)', cat: 'arch', mult: 6, measures: 'memory', val: '4–8× memory', base: 'vs FP16 · ~lossless (INT8 1–3%)', mat: 0, src: 'arXiv:2411.02355 (>500k evals)' },
    { name: 'Sparse MoE', cat: 'arch', mult: 18, measures: 'active params', val: '~5–20× sparsity', base: 'DeepSeek-V3 671B total / 37B active', mat: 0, src: 'arXiv:2412.19437' },
    { name: 'Speculative decoding', cat: 'arch', mult: 2.2, headline: 6.5, measures: 'throughput', val: '~1.8–2.5× (prod), lossless', base: 'vs autoregressive · 3–6.5× academic', mat: 0, src: 'EAGLE-3 / vLLM' },
    { name: 'Distillation', cat: 'arch', mult: 10, measures: 'params', val: 'small model from big teacher', base: 'Gemma 2 2.6B/9B from 27B', mat: 0, src: 'arXiv:2408.00118' },
    { name: 'SSM / Mamba hybrid', cat: 'arch', mult: 3.3, measures: 'memory', val: '>70% long-context memory cut', base: 'IBM Granite 4.0 (9:1 Mamba:Tf)', mat: 0, src: 'IBM 2025' },
    { name: 'Retrieval (RETRO)', cat: 'arch', mult: 25, measures: 'params', val: '~25× fewer params', base: '7.5B+DB ≈ GPT-3 175B on the Pile', mat: 1, src: 'arXiv:2112.04426' },
    { name: 'BitNet b1.58 (ternary)', cat: 'arch', mult: 12, measures: 'energy (est.)', val: '~12× energy, ~6.5× memory', base: '~2B scale only · estimate', mat: 1, src: 'arXiv:2504.12285' },
    { name: 'Mixture-of-Depths', cat: 'arch', mult: 2, measures: 'FLOPs', val: '~50% FLOPs / forward pass', base: 'research · equal-FLOP match', mat: 2, src: 'arXiv:2404.02258' },
    { name: 'Test-time compute', cat: 'arch', mult: 0.5, measures: 'NOT a win', val: 'trades energy for quality', base: 'more tokens per query — the honest counter-example', mat: 0, src: 'DeepSeek-R1' },
    { name: 'Analog in-memory (IBM PCM)', cat: 'sub', mult: 12.4, measures: 'TOPS/W', val: '~12.4 TOPS/W (measured)', base: '14nm chip · near-digital accuracy · inference-only', mat: 1, src: 'Nature 2023' },
    { name: 'Near-memory (IBM NorthPole)', cat: 'sub', mult: 25, measures: 'FPS/W', val: '25× frames/joule', base: 'vs 12nm V100 (ResNet-50) · capped to on-chip SRAM', mat: 1, src: 'Science 2023' },
    { name: 'Neuromorphic (Loihi 2)', cat: 'sub', mult: 15, headline: 100, measures: 'TOPS/W', val: '~15 TOPS/W', base: '“100×” is vs a Jetson Orin + i9 — NOT a datacenter GPU', mat: 1, src: 'Intel Hala Point' },
    { name: 'Photonic (Lightmatter)', cat: 'sub', mult: 0.82, measures: 'TOPS/W', val: '~0.82 TOPS/W', base: 'feasibility proven · not a present win — the bet is interconnect', mat: 1, src: 'Nature 2025' },
    { name: 'Thermodynamic (Normal)', cat: 'sub', mult: 2, headline: 1000, measures: 'energy (claim)', val: '“1,000×” — proof of concept', base: '8-cell RLC sampler, PCB-level · unvalidated at scale', mat: 2, src: 'Nature Comms 2025' },
    { name: 'Thermodynamic (Extropic)', cat: 'sub', mult: 2, headline: 10000, measures: 'energy (claim)', val: '“10,000×” — unvalidated', base: 'per-op extrapolation · X0 test chip only', mat: 3, src: 'Extropic 2025' },
    { name: 'Quantum → today’s LLMs', cat: 'q', mult: 1, measures: 'no path', val: 'no near/mid-term advantage', base: 'read-in/out wall · dequantization · barren plateaus', mat: 3, src: 'Aaronson 2015 · Tang 2018' },
    { name: 'Quantum → better classical chips', cat: 'q', mult: 1, measures: 'indirect · 10–20 yr', val: 'simulate materials → better classical hardware', base: 'fault-tolerant · FeMoco ~4M physical qubits', mat: 3, src: 'Feynman · resource estimates' }
  ];
  var MAT = ['shipping', 'demonstrated', 'research', 'speculative'];
  var CATNAME = { arch: 'classical architecture', sub: 'post-CMOS substrate', q: 'quantum' };
  var filter = 'all', headline = false, sel = LEVERS[1], hitmap = [];
  function catColor(c) { return c === 'arch' ? K.v('--accent') : c === 'sub' ? K.v('--accent-2') : K.v('--faint'); }

  function mk(label, fn, group) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.setAttribute('data-g', group || ''); b.addEventListener('click', function () { fn(); sync(); draw(); }); controls.appendChild(b); return b; }
  var flbl = document.createElement('span'); flbl.className = 'chip'; flbl.textContent = 'show'; controls.appendChild(flbl);
  var fbtns = {};
  [['all', 'all'], ['arch', 'architectures'], ['sub', 'substrates'], ['q', 'quantum']].forEach(function (o) { fbtns[o[0]] = mk(o[1], function () { filter = o[0]; }, 'f'); });
  var hb = mk('headline vs verified', function () { headline = !headline; }, 'h');
  function sync() { for (var k in fbtns) fbtns[k].setAttribute('aria-pressed', filter === k ? 'true' : 'false'); hb.setAttribute('aria-pressed', headline ? 'true' : 'false'); }
  sync();

  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, hit = nearest(px, py); if (hit && hit !== sel) { sel = hit; draw(); } });
  function nearest(px, py) { var best = null, bd = 18; for (var i = 0; i < hitmap.length; i++) { var d = Math.hypot(px - hitmap[i].x, py - hitmap[i].y); if (d < bd) { bd = d; best = hitmap[i].l; } } return best; }

  function vis(l) { return filter === 'all' || filter === l.cat; }
  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace', sans = K.v('--sans') || 'sans-serif';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic'; hitmap = [];
    var px0 = 56, px1 = W - 16, py0 = 30, py1 = Math.min(H * 0.58, H - 150);
    // y = log multiplier (0.5× .. 10000×)
    var lo = Math.log10(0.5), hi = Math.log10(10000);
    function Y(m) { return py1 - (Math.log10(m) - lo) / (hi - lo) * (py1 - py0); }
    function X(mat, jit) { return px0 + (mat + 0.5) / MAT.length * (px1 - px0) + jit; }
    // axes + maturity bands
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py1); ctx.lineTo(px1, py1); ctx.stroke();
    ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'right';
    [1, 10, 100, 1000, 10000].forEach(function (g) { var yy = Y(g); ctx.fillText(g + '×', px0 - 5, yy + 3); ctx.strokeStyle = rule; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(px0, yy); ctx.lineTo(px1, yy); ctx.stroke(); ctx.globalAlpha = 1; });
    ctx.save(); ctx.translate(14, (py0 + py1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('efficiency gain (× vs its baseline)', 0, 0); ctx.restore();
    ctx.textAlign = 'center'; ctx.font = '9px ' + mono;
    for (var m = 0; m < MAT.length; m++) ctx.fillText(MAT[m], X(m, 0), py1 + 14);
    ctx.fillText('maturity →', px1 - 30, py1 + 28);
    // "1× = no change" line
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px0, Y(1)); ctx.lineTo(px1, Y(1)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // points
    var perMat = {}; LEVERS.forEach(function (l) { perMat[l.mat] = (perMat[l.mat] || 0); });
    var idxMat = {};
    LEVERS.forEach(function (l) {
      if (!vis(l)) return;
      idxMat[l.mat] = (idxMat[l.mat] || 0); var jit = ((idxMat[l.mat] % 3) - 1) * 16; idxMat[l.mat]++;
      var shown = (headline && l.headline) ? l.headline : l.mult;
      var x = X(l.mat, jit), y = Y(shown), on = sel === l, col = catColor(l.cat);
      hitmap.push({ x: x, y: y, l: l });
      if (headline && l.headline) { ctx.strokeStyle = reject; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x, Y(l.mult)); ctx.lineTo(x, Y(l.headline)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ctx.fillStyle = col; ctx.globalAlpha = on ? 1 : 0.78; ctx.beginPath(); ctx.arc(x, y, on ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      if (on) { ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke(); }
    });
    // legend
    ctx.font = '9.5px ' + mono; ctx.textAlign = 'left'; var lx = px0 + 6, ly = py0 + 10;
    [['arch', 'architectures (shipping the real wins)'], ['sub', 'post-CMOS substrates (real but narrow)'], ['q', 'quantum (not an LLM lever)']].forEach(function (c, i) { ctx.fillStyle = catColor(c[0]); ctx.beginPath(); ctx.arc(lx + 4, ly + i * 14 - 3, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = ink2; ctx.fillText(c[1], lx + 14, ly + i * 14); });

    // selected detail card
    var dy = py1 + 30, dx = px0 - 40;
    if (sel) {
      ctx.fillStyle = catColor(sel.cat); ctx.font = '600 13px ' + mono; ctx.textAlign = 'left'; ctx.fillText(sel.name, dx, dy);
      ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.fillText(CATNAME[sel.cat] + '  ·  ' + (sel.mat < MAT.length ? MAT[sel.mat] : '') + (sel.measures === 'no path' || sel.measures === 'NOT a win' ? '' : '  ·  measures: ' + sel.measures), dx, dy + 14);
      ctx.fillStyle = ink; ctx.font = '600 12px ' + mono; ctx.fillText('as measured:  ' + sel.val, dx, dy + 31);
      ctx.fillStyle = sel.cat === 'q' || sel.measures === 'NOT a win' ? reject : ink2; ctx.font = '11px ' + sans;
      wrap('baseline:  ' + sel.base, dx, dy + 48, W - dx - 16, 13);
      ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.fillText('source: ' + sel.src, dx, dy + 79);
    }
    // floors footer
    var fy = H - 10;
    ctx.fillStyle = faint; ctx.font = '8.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('the hard floors:  Landauer kT·ln2 ≈ 2.8 zJ/bit  ·  brain ~6 J/word  ·  today’s LLM ~1.8 J/token  ·  CMOS ~10⁶× above Landauer  ·  moving a bit ~50× the math  ·  doubling slowed 1.6→2.6 yr (Koomey)', dx, fy);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};


  // ============ EXPANSION: landmark experiments · queries, thermodynamics, universality ============

// ───── deutsch-jozsa (constant or balanced in one query) ─────
  EDU["deutsch-jozsa"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h, N = 3, DIM = 8;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var FUNCS = [['constant 0', function () { return 0; }, 'constant'], ['constant 1', function () { return 1; }, 'constant'],
               ['balanced · x₀', function (x) { return (x >> 2) & 1; }, 'balanced'], ['balanced · parity', function (x) { return ((x >> 2) ^ (x >> 1) ^ x) & 1; }, 'balanced']];
  var fi = 2;
  function Had(st, q) { var o = st.slice(), s = 1 / Math.sqrt(2), m = 1 << (N - 1 - q); for (var i = 0; i < DIM; i++) { if (i & m) continue; var j = i | m; o[i] = K.C((st[i].re + st[j].re) * s, (st[i].im + st[j].im) * s); o[j] = K.C((st[i].re - st[j].re) * s, (st[i].im - st[j].im) * s); } return o; }
  function run() { var st = []; for (var i = 0; i < DIM; i++) st.push(K.C(i === 0 ? 1 : 0, 0)); for (var q = 0; q < N; q++) st = Had(st, q);
    for (var x = 0; x < DIM; x++) if (FUNCS[fi][1](x) & 1) st[x] = K.C(-st[x].re, -st[x].im); for (var q2 = 0; q2 < N; q2++) st = Had(st, q2); return st; }

  var lab = document.createElement('span'); lab.className = 'chip'; lab.textContent = 'oracle f'; controls.appendChild(lab);
  var fbtn = []; FUNCS.forEach(function (fn, i) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = fn[0]; b.addEventListener('click', function () { fi = i; sync(); draw(); }); controls.appendChild(b); fbtn.push(b); });
  function sync() { fbtn.forEach(function (b, i) { b.setAttribute('aria-pressed', i === fi ? 'true' : 'false'); }); }
  sync();

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'), acc = K.v('--accent'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var st = run(), p0 = st[0].re * st[0].re + st[0].im * st[0].im, isConst = p0 > 0.5;
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Is the black-box function constant or balanced?  One quantum query decides — measure the n qubits after Hⁿ·oracle·Hⁿ.', 14, 22);
    // amplitude bars over the 8 outcomes
    var x0 = 30, bw = (W * 0.5 - 40) / DIM, baseY = H - 60, maxH = baseY - 70;
    for (var i = 0; i < DIM; i++) { var pr = st[i].re * st[i].re + st[i].im * st[i].im, bx = x0 + i * bw, h = Math.max(1, pr * maxH);
      ctx.fillStyle = i === 0 ? acc : ink2; ctx.globalAlpha = i === 0 ? 1 : 0.55; ctx.fillRect(bx, baseY - h, bw * 0.74, h); ctx.globalAlpha = 1;
      ctx.fillStyle = faint; ctx.font = '8px ' + mono; ctx.textAlign = 'center'; ctx.fillText('|' + i.toString(2).padStart(3, '0') + '⟩', bx + bw * 0.37, baseY + 12); }
    ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.textAlign = 'left'; ctx.fillText('measurement outcome probabilities', x0, 56);
    // verdict
    var rx = W * 0.62, ry = 80;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono; ctx.fillStyle = faint; ctx.fillText('outcome after one query:', rx, ry);
    ctx.fillStyle = ink; ctx.font = '600 14px ' + mono; ctx.fillText('P(measure |000⟩) = ' + (p0 * 100).toFixed(0) + '%', rx, ry + 24);
    ctx.fillStyle = isConst ? pass : acc; ctx.font = '600 16px ' + mono; ctx.fillText(isConst ? 'all-zeros → CONSTANT' : 'nonzero → BALANCED', rx, ry + 50);
    ctx.fillStyle = ink2; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    wrap('Interference makes every balanced function steer away from |000⟩ and every constant one land exactly on it — settled in a single query, where a classical computer might need 2ⁿ⁻¹+1.', rx, ry + 76, W - rx - 16, 14);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};

  // ───── simon (a hidden period found in O(n) queries) ─────
  EDU["simon"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h, NQ = 6, N = 3, DIM = 64;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var s = 5;                                                // hidden period (n=3), nonzero
  function fval(x) { var y = x ^ s; return Math.min(x, y); }    // 2-to-1 with period s
  var ys = [], solved = null, queries = 0;
  function Had(st, q) { var o = st.slice(), sq = 1 / Math.sqrt(2), m = 1 << (NQ - 1 - q); for (var i = 0; i < DIM; i++) { if (i & m) continue; var j = i | m; o[i] = K.C((st[i].re + st[j].re) * sq, (st[i].im + st[j].im) * sq); o[j] = K.C((st[i].re - st[j].re) * sq, (st[i].im - st[j].im) * sq); } return o; }
  function dot(a, b) { var c = 0, t = a & b; while (t) { c ^= (t & 1); t >>= 1; } return c; }
  function query() {
    var st = []; for (var i = 0; i < DIM; i++) st.push(K.C(i === 0 ? 1 : 0, 0));
    st = Had(st, 0); st = Had(st, 1); st = Had(st, 2);            // Hⁿ on input (qubits 0,1,2 = high bits)
    var o = []; for (i = 0; i < DIM; i++) o.push(K.C(0, 0));    // oracle: out ⊕= f(in)
    for (i = 0; i < DIM; i++) { var x = i >> 3, out = i & 7; o[(x << 3) | (out ^ fval(x))] = st[i]; } st = o;
    // measure output register → collapse input to {x0, x0⊕s}
    var pr = new Array(8).fill(0); for (i = 0; i < DIM; i++) pr[i & 7] += st[i].re * st[i].re + st[i].im * st[i].im;
    var rnd = Math.random(), acc = 0, mo = 0; for (i = 0; i < 8; i++) { acc += pr[i]; if (rnd <= acc) { mo = i; break; } }
    var nrm = Math.sqrt(pr[mo]) || 1; for (i = 0; i < DIM; i++) st[i] = ((i & 7) === mo) ? K.C(st[i].re / nrm, st[i].im / nrm) : K.C(0, 0);
    st = Had(st, 0); st = Had(st, 1); st = Had(st, 2);            // Hⁿ on input
    var pin = new Array(8).fill(0); for (i = 0; i < DIM; i++) pin[i >> 3] += st[i].re * st[i].re + st[i].im * st[i].im;
    rnd = Math.random(); acc = 0; var y = 0; for (i = 0; i < 8; i++) { acc += pin[i]; if (rnd <= acc) { y = i; break; } }
    queries++;
    if (y !== 0 && ys.indexOf(y) < 0) ys.push(y);
    // candidate s: nonzero, orthogonal to every collected y
    var cand = []; for (var c = 1; c < 8; c++) { var ok = true; for (var k = 0; k < ys.length; k++) if (dot(ys[k], c)) { ok = false; break; } if (ok) cand.push(c); }
    solved = (cand.length === 1) ? cand[0] : null;
  }
  function mk(t, fn, primary) { var b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'btn primary' : 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(); draw(); }); controls.appendChild(b); return b; }
  mk('Run query', function () { query(); }, true);
  mk('Reset', function () { ys = []; solved = null; queries = 0; });
  mk('New secret', function () { s = 1 + ((s + 2) % 7); ys = []; solved = null; queries = 0; });

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'), acc = K.v('--accent'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('A 2-to-1 function hides a period s (f(x)=f(x⊕s)). Each quantum query returns a y with y·s=0 — a few pin s down.', 14, 22);
    // constraints
    var x0 = 24, y0 = 56;
    ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.fillText('queries: ' + queries + '   ·   classical would need ~' + Math.round(Math.pow(2, N / 2)) + '+', x0, y0);
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.fillText('equations collected (each: y·s = 0):', x0, y0 + 24);
    for (var i = 0; i < Math.max(1, ys.length); i++) { var yy = y0 + 44 + i * 20;
      if (i < ys.length) { ctx.fillStyle = ink; ctx.font = '600 13px ' + mono; ctx.fillText('y' + (i + 1) + ' = ' + ys[i].toString(2).padStart(3, '0'), x0 + 6, yy); }
      else { ctx.fillStyle = faint; ctx.font = '11px ' + mono; ctx.fillText('(press “Run query”)', x0 + 6, yy); } }
    // result
    var rx = W * 0.56, ry = 70;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono; ctx.fillStyle = faint; ctx.fillText('recovered period', rx, ry);
    if (solved != null) { ctx.fillStyle = pass; ctx.font = '600 22px ' + mono; ctx.fillText('s = ' + solved.toString(2).padStart(3, '0'), rx, ry + 28);
      ctx.fillStyle = solved === s ? pass : K.v('--reject'); ctx.font = '11px ' + (K.v('--sans') || 'sans-serif'); ctx.fillText(solved === s ? '✓ matches the hidden secret' : '✗', rx, ry + 50); }
    else { ctx.fillStyle = ink2; ctx.font = '14px ' + mono; ctx.fillText(ys.length + ' / ' + (N - 1) + ' independent equations', rx, ry + 26);
      ctx.fillStyle = faint; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif'); ctx.fillText('need ' + (N - 1) + ' to solve for s', rx, ry + 48); }
    ctx.fillStyle = faint; ctx.font = '9.5px ' + (K.v('--sans') || 'sans-serif'); wrap('An exponential separation in the query model — and the trick (interference then linear algebra) that directly inspired Shor.', rx, ry + 78, W - rx - 16, 13);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};

  // ───── superdense (two classical bits on one qubit) ─────
  EDU["superdense"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h, DIM = 4;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var b1 = 1, b2 = 0;                                       // Alice's two bits
  var S2 = 1 / Math.sqrt(2);
  function X(st, q) { var o = st.slice(), m = q === 0 ? 2 : 1; for (var i = 0; i < DIM; i++) o[i ^ m] = st[i]; return o; }
  function Z(st, q) { var o = st.slice(), m = q === 0 ? 2 : 1; for (var i = 0; i < DIM; i++) o[i] = (i & m) ? K.C(-st[i].re, -st[i].im) : st[i]; return o; }
  function H0(st) { var o = st.slice(); o[0] = K.C((st[0].re + st[2].re) * S2, (st[0].im + st[2].im) * S2); o[2] = K.C((st[0].re - st[2].re) * S2, (st[0].im - st[2].im) * S2);
    o[1] = K.C((st[1].re + st[3].re) * S2, (st[1].im + st[3].im) * S2); o[3] = K.C((st[1].re - st[3].re) * S2, (st[1].im - st[3].im) * S2); return o; }
  function CX01(st) { var o = st.slice(); o[2] = st[3]; o[3] = st[2]; return o; }   // control q0, target q1
  function decode() {
    var st = [K.C(S2, 0), K.C(0, 0), K.C(0, 0), K.C(S2, 0)];     // |Φ+⟩
    if (b2) st = X(st, 0); if (b1) st = Z(st, 0);                // Alice encodes on qubit 0: Z^{b1} X^{b2}
    st = CX01(st); st = H0(st);                                 // Bob's Bell measurement
    var pr = st.map(function (a) { return a.re * a.re + a.im * a.im; }), best = 0; for (var i = 1; i < 4; i++) if (pr[i] > pr[best]) best = i;
    return { out: best, gate: (b1 ? 'Z' : '') + (b2 ? 'X' : '') || 'I' };
  }
  function tg(t, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(b); draw(); }); controls.appendChild(b); return b; }
  var lab = document.createElement('span'); lab.className = 'chip'; lab.textContent = 'Alice sends'; controls.appendChild(lab);
  var bb1 = tg('b₁=' + b1, function () { b1 ^= 1; bb1.textContent = 'b₁=' + b1; });
  var bb2 = tg('b₂=' + b2, function () { b2 ^= 1; bb2.textContent = 'b₂=' + b2; });

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'), acc = K.v('--accent'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var res = decode(), recovered = res.out, rb1 = (recovered >> 1) & 1, rb2 = recovered & 1, ok = rb1 === b1 && rb2 === b2;
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Sharing one entangled pair, Alice sends TWO classical bits by transmitting just ONE qubit — teleportation, in reverse.', 14, 22);
    var midY = H * 0.5, ax = W * 0.16, bx = W * 0.84;
    // Alice
    ctx.fillStyle = ink; ctx.font = '600 12px ' + mono; ctx.textAlign = 'center'; ctx.fillText('ALICE', ax, midY - 70);
    ctx.font = '11px ' + mono; ctx.fillStyle = ink2; ctx.fillText('wants to send', ax, midY - 48);
    ctx.fillStyle = acc; ctx.font = '600 20px ' + mono; ctx.fillText(b1 + '' + b2, ax, midY - 24);
    ctx.fillStyle = faint; ctx.font = '11px ' + mono; ctx.fillText('applies  ' + res.gate, ax, midY + 4);
    ctx.fillText('to her qubit', ax, midY + 20);
    // channel: one qubit travels
    ctx.strokeStyle = acc; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ax + 44, midY); ctx.lineTo(bx - 44, midY); ctx.stroke();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(bx - 44, midY); ctx.lineTo(bx - 54, midY - 5); ctx.lineTo(bx - 54, midY + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.fillText('1 qubit →', (ax + bx) / 2, midY - 10);
    ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.fillText('(2nd qubit already shared, entangled)', (ax + bx) / 2, midY + 18);
    // Bob
    ctx.fillStyle = ink; ctx.font = '600 12px ' + mono; ctx.fillText('BOB', bx, midY - 70);
    ctx.font = '11px ' + mono; ctx.fillStyle = ink2; ctx.fillText('Bell-measures, reads', bx, midY - 48);
    ctx.fillStyle = ok ? pass : K.v('--reject'); ctx.font = '600 20px ' + mono; ctx.fillText(rb1 + '' + rb2 + (ok ? '  ✓' : ''), bx, midY - 22);
    ctx.fillStyle = faint; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif'); ctx.textAlign = 'center';
    wrap('Alice’s gate rotates the shared Bell state into one of four orthogonal Bell states; Bob tells them apart with a single measurement — 2 bits per qubit.', W / 2, H - 28, W * 0.66, 14);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), lines = [], line = ''; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { lines.push(line); line = words[i] + ' '; } else line = t; } lines.push(line); ctx.textAlign = 'center'; for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], x, y - (lines.length - 1 - k) * lh); }
  draw();
};

  // ───── landauer (the energy cost of forgetting a bit) ─────
  EDU["landauer"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var kB = 1.380649e-23, LN2 = Math.LN2, T = 300, reversible = false;
  function energyJ() { return kB * T * LN2; }
  var lab = document.createElement('label'); lab.className = 'chip'; lab.style.marginRight = '8px'; lab.textContent = 'temperature T ';
  var range = document.createElement('input'); range.type = 'range'; range.min = '1'; range.max = '1000'; range.step = '1'; range.value = String(T); range.style.marginLeft = '6px';
  range.addEventListener('input', function () { T = parseInt(range.value, 10); draw(); }); lab.appendChild(range); controls.appendChild(lab);
  var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'btn'; mb.textContent = 'show reversible'; mb.addEventListener('click', function () { reversible = !reversible; mb.textContent = reversible ? 'show erase (irreversible)' : 'show reversible'; draw(); }); controls.appendChild(mb);

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'), acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Forgetting is physical: erasing one bit must dump at least kT·ln2 of heat. Reversible logic has no such floor.', 14, 22);
    var cx = W * 0.27, cy = H * 0.5, r = 26;
    if (!reversible) {
      // erasure: two possible states (0 or 1) → one state (0); entropy k·ln2 lost
      ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'center';
      ctx.fillText('ERASE: unknown bit → 0', cx, cy - 66);
      [['0', cx - 40, cy - 30], ['1', cx + 40, cy - 30]].forEach(function (q) { ctx.strokeStyle = faint; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(q[1], q[2], 16, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = ink2; ctx.font = '600 13px ' + mono; ctx.fillText(q[0], q[1], q[2] + 4); });
      ctx.strokeStyle = faint; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx - 40, cy - 12); ctx.lineTo(cx, cy + 26); ctx.moveTo(cx + 40, cy - 12); ctx.lineTo(cx, cy + 26); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = acc; ctx.strokeStyle = acc; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(cx, cy + 42, 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = acc; ctx.font = '600 14px ' + mono; ctx.fillText('0', cx, cy + 46);
      ctx.fillStyle = reject; ctx.font = '10px ' + mono; ctx.fillText('↯ heat ≥ kT·ln2', cx, cy + 80);
      ctx.fillText('entropy −k·ln2', cx, cy + 94);
    } else {
      // reversible: CNOT, bijective, no info lost
      ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'center'; ctx.fillText('REVERSIBLE: CNOT (a, b) → (a, a⊕b)', cx, cy - 66);
      ctx.fillStyle = pass; ctx.font = '12px ' + mono;
      ctx.fillText('00 → 00', cx, cy - 30); ctx.fillText('01 → 01', cx, cy - 8); ctx.fillText('10 → 11', cx, cy + 14); ctx.fillText('11 → 10', cx, cy + 36);
      ctx.fillStyle = pass; ctx.font = '10px ' + mono; ctx.fillText('bijective — nothing forgotten', cx, cy + 64);
      ctx.fillText('no fundamental energy floor', cx, cy + 78);
    }
    // energy readout
    var E = energyJ(), eV = E / 1.602176634e-19, rx = W * 0.56;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono; ctx.fillStyle = faint; ctx.fillText('Landauer limit at T = ' + T + ' K', rx, 70);
    ctx.fillStyle = ink; ctx.font = '600 17px ' + mono; ctx.fillText('kT·ln2 = ' + E.toExponential(2) + ' J', rx, 96);
    ctx.fillStyle = ink2; ctx.font = '12px ' + mono; ctx.fillText('= ' + (eV * 1000).toFixed(1) + ' meV  =  ' + eV.toExponential(2) + ' eV', rx, 116);
    ctx.fillStyle = faint; ctx.font = '10px ' + (K.v('--sans') || 'sans-serif');
    wrap('At room temperature that is ~18 meV per erased bit — and today’s chips still spend thousands of times more. This is why reversible (and quantum, which is unitary and reversible) computing is the deep-efficiency frontier.', rx, 144, W - rx - 16, 14);
    ctx.fillStyle = ink2; ctx.font = '9.5px ' + mono; ctx.fillText('Landauer 1961 · Bennett 1973 · confirmed Bérut et al. 2012', rx, H - 16);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};

  // ───── rule110 (universal computation from one tiny rule) ─────
  EDU["rule110"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(); });
  var ruleN = 110, initMode = 'single', cols = 0, rows = 0, grid = null, t0 = 0, shown = 0;
  function ruleBit(n, lcr) { return (n >> lcr) & 1; }       // lcr = 4·L+2·C+R
  function seedRng(a) { var s = a >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function build() {
    var cell = Math.max(3, Math.round(W / 180)); cols = Math.floor((W - 8) / cell); rows = Math.floor((H - 8) / cell);
    grid = []; var first = new Array(cols).fill(0), rng = seedRng(7);
    if (initMode === 'single') first[cols - 2] = 1; else for (var i = 0; i < cols; i++) first[i] = rng() < 0.5 ? 1 : 0;
    grid.push(first);
    for (var r = 1; r < rows; r++) { var prev = grid[r - 1], row = new Array(cols);
      for (var c = 0; c < cols; c++) { var L = prev[(c - 1 + cols) % cols], C = prev[c], R = prev[(c + 1) % cols]; row[c] = ruleBit(ruleN, 4 * L + 2 * C + R); }
      grid.push(row); }
    return cell;
  }
  var cellPx = build();

  function mk(t, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(); cellPx = build(); shown = 0; t0 = 0; if (K.reduced) draw(); }); controls.appendChild(b); return b; }
  var rlab = document.createElement('span'); rlab.className = 'chip'; rlab.textContent = 'rule'; controls.appendChild(rlab);
  var rbtn = {}; [110, 30, 90, 184].forEach(function (n) { rbtn[n] = mk(String(n), function () { ruleN = n; sync(); }); });
  mk('single seed', function () { initMode = 'single'; });
  mk('random seed', function () { initMode = 'random'; });
  function sync() { for (var n in rbtn) rbtn[n].setAttribute('aria-pressed', (+n === ruleN) ? 'true' : 'false'); }
  sync();

  function draw(t) {
    var ink = K.v('--ink'), faint = K.v('--faint'), acc = K.v('--accent'), bg = K.v('--stage-bg') || K.v('--bg'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (K.reduced) shown = rows; else { if (!t0) t0 = t; shown = Math.min(rows, Math.floor((t - t0) / 45) + 1); }
    var ox = (W - cols * cellPx) / 2, oy = 4;
    ctx.fillStyle = ruleN === 110 ? acc : ink;
    for (var r = 0; r < shown; r++) for (var c = 0; c < cols; c++) if (grid[r][c]) ctx.fillRect(ox + c * cellPx, oy + r * cellPx, cellPx - 0.5, cellPx - 0.5);
    // caption
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Rule ' + ruleN + (ruleN === 110 ? ' — proven Turing-complete (Cook 2004): a universal computer from one 8-bit rule.' : ' — an elementary cellular automaton.'), 10, H - 8);
  }
  if (K.reduced) draw(0); else K.loop(draw);
};


  // ============ EXPANSION: landmark experiments · nonlocality + one-query ============

// ───── ghz-mermin (all-versus-nothing nonlocality — a single-shot contradiction) ─────
  EDU["ghz-mermin"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var S2 = 1 / Math.sqrt(2);
  // |GHZ⟩ = (|000⟩+|111⟩)/√2 over 8 amplitudes, index = 4b0+2b1+b2
  function ghz() { var st = []; for (var i = 0; i < 8; i++) st.push(K.C(0, 0)); st[0] = K.C(S2, 0); st[7] = K.C(S2, 0); return st; }
  function bit(i, q) { return (i >> (2 - q)) & 1; }
  function applyP(st, P) {                                  // P = ['X'|'Y'|'Z'] per qubit
    var s = st.slice();
    for (var q = 0; q < 3; q++) { var m = 1 << (2 - q), o = [], p = P[q]; for (var i = 0; i < 8; i++) o.push(K.C(0, 0));
      for (var i2 = 0; i2 < 8; i2++) { var b = bit(i2, q), a = s[i2];
        if (p === 'X') o[i2 ^ m] = a;
        else if (p === 'Y') o[i2 ^ m] = K.cmul(b ? K.C(0, -1) : K.C(0, 1), a);
        else o[i2] = b ? K.C(-a.re, -a.im) : a; }
      s = o; }
    return s;
  }
  function expect(P) { var g = ghz(), ps = applyP(g, P), e = 0; for (var i = 0; i < 8; i++) e += g[i].re * ps[i].re + g[i].im * ps[i].im; return Math.round(e); }
  var ROWS = [['XXX', ['X', 'X', 'X']], ['XYY', ['X', 'Y', 'Y']], ['YXY', ['Y', 'X', 'Y']], ['YYX', ['Y', 'Y', 'X']]];
  // local-hidden-variable assignment: definite ±1 for each of X1,X2,X3,Y1,Y2,Y3
  var lhv = { X1: 1, X2: 1, X3: 1, Y1: 1, Y2: 1, Y3: -1 };
  function classicalRow(name) { var v = 1; for (var k = 0; k < 3; k++) v *= lhv[name[k] + (k + 1)]; return v; }

  function mkb(key) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = key + '=' + (lhv[key] > 0 ? '+1' : '−1'); b.addEventListener('click', function () { lhv[key] = -lhv[key]; b.textContent = key + '=' + (lhv[key] > 0 ? '+1' : '−1'); draw(); }); controls.appendChild(b); return b; }
  var lab = document.createElement('span'); lab.className = 'chip'; lab.textContent = 'pre-set local values'; controls.appendChild(lab);
  ['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3'].forEach(mkb);

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('|GHZ⟩ = (|000⟩ + |111⟩)/√2.  Try to pre-assign definite ±1 values that reproduce all four quantum results at once.', 14, 22);

    var x0 = 24, col1 = 220, col2 = 330, col3 = 440, y0 = 56, rh = 30;
    ctx.font = '10px ' + mono; ctx.fillStyle = faint; ctx.textAlign = 'left';
    ctx.fillText('measurement', x0, y0); ctx.textAlign = 'center';
    ctx.fillText('your local values', col1, y0); ctx.fillText('quantum', col2, y0); ctx.fillText('match?', col3, y0);
    var prodC = 1, prodQ = 1, mism = 0;
    for (var r = 0; r < 4; r++) {
      var name = ROWS[r][0], cv = classicalRow(name), qv = expect(ROWS[r][1]), yy = y0 + (r + 1) * rh, ok = cv === qv;
      if (!ok) mism++; prodC *= cv; prodQ *= qv;
      ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.font = '600 13px ' + mono; ctx.fillText('⟨' + name.split('').join('') + '⟩', x0, yy);
      ctx.textAlign = 'center'; ctx.fillStyle = ink2; ctx.font = '13px ' + mono; ctx.fillText(cv > 0 ? '+1' : '−1', col1, yy);
      ctx.fillStyle = qv > 0 ? ink : acc; ctx.fillText(qv > 0 ? '+1' : '−1', col2, yy);
      ctx.fillStyle = ok ? pass : reject; ctx.font = '600 13px ' + mono; ctx.fillText(ok ? '✓' : '✗', col3, yy);
    }
    // product row
    var py = y0 + 5 * rh + 10;
    ctx.strokeStyle = rule; ctx.beginPath(); ctx.moveTo(x0, py - 18); ctx.lineTo(col3 + 30, py - 18); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = faint; ctx.font = '11px ' + mono; ctx.fillText('product of all four', x0, py);
    ctx.textAlign = 'center'; ctx.fillStyle = ink2; ctx.font = '600 13px ' + mono; ctx.fillText(prodC > 0 ? '+1' : '−1', col1, py);
    ctx.fillStyle = reject; ctx.fillText(prodQ > 0 ? '+1' : '−1', col2, py);
    ctx.fillStyle = reject; ctx.fillText('✗', col3, py);

    // verdict
    ctx.textAlign = 'left'; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif'); ctx.fillStyle = reject;
    wrap('Every local assignment forces the product to +1 (each value appears twice), but quantum mechanics demands −1. No pre-set values can match all four — local realism fails in a single shot, no inequality, no statistics.', x0, py + 26, W - x0 - 16, 15);
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};

  // ───── bv (Bernstein–Vazirani — one query recovers the whole secret) ─────
  EDU["bv"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var n = 5, s = parseInt('10110', 2);                     // hidden string (n bits)
  function popcnt(x) { var c = 0; while (x) { c ^= (x & 1); x >>= 1; } return c; }    // parity
  function runBV() {                                        // returns recovered index (= s)
    var DIM = 1 << n, st = []; for (var i = 0; i < DIM; i++) st.push(K.C(i === 0 ? 1 : 0, 0));
    function H(q) { var o = st.slice(), sq = 1 / Math.sqrt(2), m = 1 << (n - 1 - q);
      for (var i = 0; i < DIM; i++) { if (i & m) continue; var j = i | m; o[i] = K.C((st[i].re + st[j].re) * sq, (st[i].im + st[j].im) * sq); o[j] = K.C((st[i].re - st[j].re) * sq, (st[i].im - st[j].im) * sq); } st = o; }
    for (var q = 0; q < n; q++) H(q);                       // H^n → uniform superposition
    for (var x = 0; x < DIM; x++) if (popcnt(s & x)) st[x] = K.C(-st[x].re, -st[x].im);   // phase oracle (−1)^{s·x}
    for (var q2 = 0; q2 < n; q2++) H(q2);                   // H^n → |s⟩
    var best = 0, bp = 0; for (var i2 = 0; i2 < DIM; i2++) { var p = st[i2].re * st[i2].re + st[i2].im * st[i2].im; if (p > bp) { bp = p; best = i2; } }
    return { rec: best, prob: bp, amps: st };
  }
  function bits(v) { var a = []; for (var i = n - 1; i >= 0; i--) a.push((v >> i) & 1); return a; }

  var lab = document.createElement('span'); lab.className = 'chip'; lab.textContent = 'hidden string s'; controls.appendChild(lab);
  var sbtn = [];
  for (var i = 0; i < n; i++) (function (i) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; var bitpos = n - 1 - i;
    b.textContent = String((s >> bitpos) & 1); b.addEventListener('click', function () { s ^= (1 << bitpos); b.textContent = String((s >> bitpos) & 1); draw(); }); controls.appendChild(b); sbtn.push(b); })(i);

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var res = runBV(), recOK = res.rec === s;
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('A hidden n-bit string s. Classically you must query one bit at a time (n queries). Quantum: one query.', 14, 22);

    // circuit sketch: n wires, H — oracle — H — measure
    var top = 50, wireGap = Math.min(30, (H * 0.42) / n), x0 = 60, x1 = W * 0.52;
    var stages = ['H', 'Uₛ', 'H', '↗'], sx = [x0 + 40, (x0 + x1) / 2, x1 - 70, x1 - 24];
    for (var q = 0; q < n; q++) { var y = top + q * wireGap;
      ctx.strokeStyle = rule; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'right'; ctx.fillText('q' + q, x0 - 6, y + 3);
      for (var g = 0; g < 3; g++) { ctx.fillStyle = K.v('--panel'); ctx.strokeStyle = g === 1 ? acc : faint; ctx.lineWidth = 1.2;
        var bx = sx[g] - 9, by = y - 8; rr(bx, by, 18, 16, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = g === 1 ? acc : ink; ctx.font = '9px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(stages[g], sx[g], y); ctx.textBaseline = 'alphabetic'; }
    }
    // oracle bracket label
    ctx.fillStyle = acc; ctx.font = '9px ' + mono; ctx.textAlign = 'center'; ctx.fillText('oracle  (−1)^{s·x}', (x0 + x1) / 2, top + n * wireGap + 6);

    // result panel (right)
    var rx = x1 + 30;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = faint; ctx.fillText('after ONE query, measure:', rx, top + 4);
    var bs = bits(res.rec), cw = 24;
    for (var k = 0; k < n; k++) { var cx = rx + k * (cw + 4), yy = top + 16;
      ctx.fillStyle = acc; ctx.globalAlpha = 0.12; rr(cx, yy, cw, cw, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = acc; ctx.lineWidth = 1.4; rr(cx, yy, cw, cw, 4); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = '600 14px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(bs[k]), cx + cw / 2, yy + cw / 2); ctx.textBaseline = 'alphabetic'; }
    ctx.fillStyle = pass; ctx.font = '600 12px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('recovered s = ' + bits(s).join('') + (recOK ? '  ✓  (prob ' + (res.prob * 100).toFixed(0) + '%)' : ''), rx, top + 16 + cw + 22);
    ctx.fillStyle = ink2; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    wrap('Hadamards spread every input at once; the oracle stamps each with the phase (−1)^{s·x}; a second layer of Hadamards focuses all of it onto the single answer |s⟩. One oracle call, n bits — where a classical computer needs n.', rx, top + 16 + cw + 48, W - rx - 16, 14);
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('quantum: 1 query     classical: ' + n + ' queries', rx, H - 14);
  }
  function rr(x, y, w, h, rad) { ctx.beginPath(); if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rad); return; } ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath(); }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};


  // ============ EXPANSION: landmark experiments · classical + bridge ============

// ───── hamming (Hamming(7,4) — the syndrome spells the error position) ─────
  EDU["hamming"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  // positions 1..7: parity at 1,2,4 · data at 3,5,6,7
  var d = { 3: 1, 5: 0, 6: 1, 7: 1 }, err = 0;            // err = flipped position (0 = none)
  function encode() {                                      // 1-indexed codeword [_, b1..b7]
    var p1 = d[3] ^ d[5] ^ d[7], p2 = d[3] ^ d[6] ^ d[7], p4 = d[5] ^ d[6] ^ d[7];
    return [0, p1, p2, d[3], p4, d[5], d[6], d[7]];
  }
  function received() { var c = encode(); if (err) c[err] ^= 1; return c; }
  function syndrome(r) { var c1 = r[1] ^ r[3] ^ r[5] ^ r[7], c2 = r[2] ^ r[3] ^ r[6] ^ r[7], c4 = r[4] ^ r[5] ^ r[6] ^ r[7];
    return { c1: c1, c2: c2, c4: c4, pos: c1 + 2 * c2 + 4 * c4 }; }

  function mkb(t, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(); draw(); }); controls.appendChild(b); return b; }
  var dlbl = document.createElement('span'); dlbl.className = 'chip'; dlbl.textContent = 'data bits'; controls.appendChild(dlbl);
  var dbtn = {};
  [3, 5, 6, 7].forEach(function (p) { dbtn[p] = mkb('d' + p + '=' + d[p], function () { d[p] ^= 1; dbtn[p].textContent = 'd' + p + '=' + d[p]; err = 0; }); });
  mkb('clear error', function () { err = 0; });

  var cellHit = [];
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointerdown', function (e) { var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    for (var i = 0; i < cellHit.length; i++) { var c = cellHit[i]; if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.w) { err = (err === c.pos) ? 0 : c.pos; draw(); return; } } });

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), panel = K.v('--panel'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic'; cellHit = [];
    var r = received(), syn = syndrome(r), isParity = { 1: 1, 2: 1, 4: 1 };

    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('4 data bits → 7-bit codeword (3 parity).  Click any bit to flip it; the 3 checks find it.', 14, 22);

    // seven bit cells
    var cw = Math.min(46, (W - 60) / 9), gap = cw * 0.32, x0 = 30, cy = 64;
    for (var p = 1; p <= 7; p++) {
      var x = x0 + (p - 1) * (cw + gap), flipped = err === p, par = isParity[p];
      ctx.fillStyle = flipped ? reject : (par ? acc : panel); ctx.globalAlpha = flipped ? 0.18 : (par ? 0.10 : 1);
      rr(x, cy, cw, cw, 5); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = flipped ? reject : (par ? acc : faint); ctx.lineWidth = flipped ? 2.2 : 1.3; rr(x, cy, cw, cw, 5); ctx.stroke();
      ctx.fillStyle = flipped ? reject : ink; ctx.font = '600 16px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(r[p]), x + cw / 2, cy + cw / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = par ? acc : faint; ctx.font = '9px ' + mono; ctx.fillText((par ? 'p' : 'd') + p, x + cw / 2, cy - 6);
      cellHit.push({ x: x, y: cy, w: cw, pos: p });
    }

    // three parity-check rows
    var checks = [['c₁  {1,3,5,7}', [1, 3, 5, 7], syn.c1], ['c₂  {2,3,6,7}', [2, 3, 6, 7], syn.c2], ['c₄  {4,5,6,7}', [4, 5, 6, 7], syn.c4]];
    var ry0 = cy + cw + 26;
    ctx.font = '10px ' + mono;
    for (var k = 0; k < 3; k++) {
      var yy = ry0 + k * 26, ch = checks[k];
      // tick marks under covered positions
      for (var j = 0; j < ch[1].length; j++) { var pp = ch[1][j], xx = x0 + (pp - 1) * (cw + gap) + cw / 2;
        ctx.fillStyle = ch[2] ? reject : faint; ctx.globalAlpha = ch[2] ? 1 : 0.5; ctx.beginPath(); ctx.arc(xx, yy, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = ch[2] ? reject : ink2; ctx.textAlign = 'left'; ctx.fillText(ch[0], x0 + 7 * (cw + gap) + 8, yy + 3);
      ctx.fillStyle = ch[2] ? reject : pass; ctx.fillText(ch[2] ? '✗ parity broken' : '✓', x0 + 7 * (cw + gap) + 116, yy + 3);
    }

    // syndrome + verdict
    var sx = W * 0.62, sy = 70;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono; ctx.fillStyle = faint; ctx.fillText('syndrome  c₄c₂c₁', sx, sy);
    ctx.fillStyle = ink; ctx.font = '600 17px ' + mono; ctx.fillText(syn.c4 + '' + syn.c2 + '' + syn.c1 + '  =  ' + syn.pos, sx, sy + 24);
    ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    if (syn.pos === 0) { ctx.fillStyle = ink2; ctx.fillText('0 → no error', sx, sy + 48); }
    else { ctx.fillStyle = pass; ctx.fillText('→ bit ' + syn.pos + ' flipped — flip it back to correct', sx, sy + 48);
      ctx.font = '600 12px ' + mono; ctx.fillText('codeword recovered ✓', sx, sy + 70); }
    ctx.fillStyle = faint; ctx.font = '9.5px ' + (K.v('--sans') || 'sans-serif'); wrap('The three parity checks, read as a binary number, give the error’s position directly — the classical cousin of the qubit code’s syndrome.', sx, sy + 96, W - sx - 16, 13);
  }
  function rr(x, y, w, h, rad) { ctx.beginPath(); if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rad); return; } ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath(); }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};

  // ───── sat3 (random 3-SAT — the satisfiability phase transition) ─────
  EDU["sat3"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var n = 12, K_INST = 10, A_LO = 2, A_HI = 7, seedBase = 9;
  var curve = [], alpha = 4.27;

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function randInstance(m, rnd) { var cl = []; for (var c = 0; c < m; c++) { var lits = [], used = {}; while (lits.length < 3) { var v = (rnd() * n) | 0; if (used[v]) continue; used[v] = 1; lits.push({ v: v, neg: rnd() < 0.5 }); } cl.push(lits); } return cl; }
  function solve(cl) {                                     // brute force with early-exit; returns {sat, cost}
    var cost = 0;
    for (var a = 0; a < (1 << n); a++) { cost++; var ok = true;
      for (var i = 0; i < cl.length; i++) { var c = cl[i], sat = false;
        for (var j = 0; j < 3; j++) { var lit = c[j], val = (a >> lit.v) & 1; if (lit.neg ? !val : val) { sat = true; break; } }
        if (!sat) { ok = false; break; } }
      if (ok) return { sat: true, cost: cost }; }
    return { sat: false, cost: cost };
  }
  function build() {
    curve = []; var steps = 16;
    for (var s = 0; s <= steps; s++) {
      var al = A_LO + (A_HI - A_LO) * s / steps, m = Math.round(al * n), satN = 0, cost = 0, rnd = rng(seedBase * 131 + s);
      for (var k = 0; k < K_INST; k++) { var res = solve(randInstance(m, rnd)); if (res.sat) satN++; cost += res.cost; }
      curve.push({ alpha: al, p: satN / K_INST, cost: cost / K_INST });
    }
  }
  build();
  var maxCost = curve.reduce(function (a, b) { return Math.max(a, b.cost); }, 1);

  var lab = document.createElement('label'); lab.className = 'chip'; lab.style.marginRight = '8px'; lab.textContent = 'ratio m/n ';
  var range = document.createElement('input'); range.type = 'range'; range.min = String(A_LO); range.max = String(A_HI); range.step = '0.1'; range.value = String(alpha); range.style.marginLeft = '6px';
  range.addEventListener('input', function () { alpha = parseFloat(range.value); draw(); }); lab.appendChild(range); controls.appendChild(lab);
  var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn'; rb.textContent = 'resample'; rb.addEventListener('click', function () { seedBase = (seedBase * 7 + 3) % 9973; build(); maxCost = curve.reduce(function (a, b) { return Math.max(a, b.cost); }, 1); draw(); }); controls.appendChild(rb);

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), acc2 = K.v('--accent-2'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Random 3-SAT (' + n + ' variables, K=' + K_INST + ' per point), solved by brute force. As clauses pile up, satisfiability collapses.', 14, 20);

    var px0 = 48, px1 = W - 20, py0 = 36, py1 = H - 46;
    function X(al) { return px0 + (al - A_LO) / (A_HI - A_LO) * (px1 - px0); }
    function Yp(p) { return py1 - p * (py1 - py0); }           // P(SAT) 0..1
    // axes
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py1); ctx.lineTo(px1, py1); ctx.stroke();
    ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'right'; ctx.fillText('1', px0 - 4, py0 + 4); ctx.fillText('0', px0 - 4, py1 + 3);
    ctx.textAlign = 'center'; ctx.fillText('clause / variable ratio  α = m/n →', (px0 + px1) / 2, H - 10);
    // threshold ~4.27
    var tx = X(4.27); ctx.strokeStyle = ink2; ctx.globalAlpha = 0.4; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(tx, py0); ctx.lineTo(tx, py1); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'left'; ctx.fillText('phase transition ≈ 4.27', tx + 4, py0 + 10);
    // effort curve (easy-hard-easy), faint, scaled into lower band
    ctx.strokeStyle = acc2; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.beginPath();
    curve.forEach(function (pt, i) { var x = X(pt.alpha), y = py1 - (pt.cost / maxCost) * (py1 - py0) * 0.9; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = acc2; ctx.font = '9px ' + mono; ctx.textAlign = 'left'; ctx.fillText('solve effort (easy → hard → easy)', px0 + 6, py0 + 22);
    // P(SAT) curve
    ctx.strokeStyle = acc; ctx.lineWidth = 2.4; ctx.beginPath();
    curve.forEach(function (pt, i) { var x = X(pt.alpha), y = Yp(pt.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    curve.forEach(function (pt) { ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(X(pt.alpha), Yp(pt.p), 2.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = acc; ctx.font = '9px ' + mono; ctx.fillText('P(satisfiable)', px0 + 6, py0 + 10);

    // current α marker + readout (interpolate P from curve)
    var pAt = 1; for (var i = 0; i < curve.length - 1; i++) { if (alpha >= curve[i].alpha && alpha <= curve[i + 1].alpha) { var t = (alpha - curve[i].alpha) / (curve[i + 1].alpha - curve[i].alpha); pAt = curve[i].p + t * (curve[i + 1].p - curve[i].p); break; } }
    var mx = X(alpha);
    ctx.strokeStyle = ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(mx, py0); ctx.lineTo(mx, py1); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(mx, Yp(pAt), 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px ' + mono; ctx.textAlign = mx > W * 0.6 ? 'right' : 'left'; var tox = mx > W * 0.6 ? mx - 8 : mx + 8;
    ctx.fillStyle = ink; ctx.fillText('α = ' + alpha.toFixed(1) + '  ·  P(SAT) ≈ ' + (pAt * 100).toFixed(0) + '%', tox, py0 + 30);
  }
  if (K.reduced) draw(); else draw();
};

  // ───── rsa-shor (RSA, and the one hard step a quantum computer speeds up) ─────
  EDU["rsa-shor"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a; }
  function modpow(b, e, m) { var r = 1; b %= m; while (e > 0) { if (e & 1) r = (r * b) % m; b = (b * b) % m; e >>= 1; } return r; }
  function egcd(a, b) { if (!b) return [a, 1, 0]; var r = egcd(b, a % b); return [r[0], r[2], r[1] - Math.floor(a / b) * r[2]]; }
  function modinv(a, m) { var r = egcd((a % m + m) % m, m); return r[0] === 1 ? ((r[1] % m) + m) % m : -1; }
  function totient(p, q) { return (p - 1) * (q - 1); }

  var SEMIS = [[3, 5], [3, 7], [3, 11], [5, 7]];           // N = 15, 21, 33, 35
  var ni = 2, p = SEMIS[ni][0], q = SEMIS[ni][1], N = p * q, e = 7, d = 1, msg = 7, base = 2;
  function setupKeys() { p = SEMIS[ni][0]; q = SEMIS[ni][1]; N = p * q; var phi = totient(p, q);
    var es = [7, 5, 11, 13, 3]; e = 3; for (var i = 0; i < es.length; i++) if (gcd(es[i], phi) === 1) { e = es[i]; break; }
    d = modinv(e, phi); if (msg >= N) msg = N - 1;
    base = 2; for (var a = 2; a < N; a++) { if (gcd(a, N) === 1 && factorVia(a).ok) { base = a; break; } } }   // default to a base that successfully factors; "try base a" surfaces the unlucky ones
  function period(a) { if (gcd(a, N) !== 1) return 0; var x = a % N, r = 1; while (x !== 1 && r < N * 2) { x = (x * a) % N; r++; } return (x === 1) ? r : 0; }
  function factorVia(a) { var rr = period(a); if (rr === 0 || rr % 2 !== 0) return { r: rr, ok: false };
    var t = modpow(a, rr / 2, N); if (t === N - 1) return { r: rr, ok: false, trivial: true };
    var fp = gcd(t - 1, N), fq = gcd(t + 1, N); return { r: rr, ok: true, half: t, p: fp, q: fq }; }
  setupKeys();

  function mkbtns(labelTxt, items, getCur, set) { var s = document.createElement('span'); s.className = 'chip'; s.textContent = labelTxt; controls.appendChild(s);
    items.forEach(function (it) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = it.t; b.setAttribute('data-k', it.v);
      b.addEventListener('click', function () { set(it.v); draw(); }); controls.appendChild(b); }); }
  mkbtns('N = p·q', SEMIS.map(function (s, i) { return { t: (s[0] * s[1]) + '', v: i }; }), function () { return ni; }, function (v) { ni = v; setupKeys(); });
  var ml = document.createElement('label'); ml.className = 'chip'; ml.style.marginLeft = '8px'; ml.textContent = 'message ';
  var mr = document.createElement('input'); mr.type = 'range'; mr.min = '2'; mr.max = '34'; mr.step = '1'; mr.value = String(msg); mr.style.marginLeft = '6px';
  mr.addEventListener('input', function () { msg = Math.min(N - 1, parseInt(mr.value, 10)); draw(); }); ml.appendChild(mr); controls.appendChild(ml);
  var ab = document.createElement('button'); ab.type = 'button'; ab.className = 'btn'; ab.textContent = 'try base a'; ab.addEventListener('click', function () { do { base = 2 + ((base) % (N - 2)); } while (gcd(base, N) !== 1); draw(); }); controls.appendChild(ab);

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), acc2 = K.v('--accent-2'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var splitX = Math.round(W * 0.46);
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(splitX, 30); ctx.lineTo(splitX, H - 40); ctx.stroke();

    // ===== RSA (left) =====
    ctx.textAlign = 'left'; ctx.font = '600 10.5px ' + mono; ctx.fillStyle = faint; ctx.fillText('RSA · encrypt with a public key', 14, 18);
    var c = modpow(msg, e, N), back = modpow(c, d, N);
    ctx.font = '12px ' + mono; ctx.fillStyle = ink2; var ly = 44, lh = 22;
    function line(s, col) { ctx.fillStyle = col || ink2; ctx.fillText(s, 16, ly); ly += lh; }
    line('N = ' + p + ' × ' + q + ' = ' + N, ink);
    line('public  (N, e) = (' + N + ', ' + e + ')');
    line('private  d = ' + d + '   (e·d ≡ 1 mod φ)');
    line('encrypt   ' + msg + '^' + e + ' mod ' + N + ' = ' + c, acc);
    line('decrypt   ' + c + '^' + d + ' mod ' + N + ' = ' + back + (back === msg ? '  ✓' : ''), back === msg ? pass : reject);
    ctx.fillStyle = faint; ctx.font = '9.5px ' + (K.v('--sans') || 'sans-serif'); wrap('Security rests on one thing: factoring N back into p·q. Easy here; for a 2048-bit N, the best classical method would outlast the universe.', 16, ly + 6, splitX - 30, 13);

    // ===== factor via period-finding (right) =====
    var rx = splitX + 16;
    ctx.textAlign = 'left'; ctx.font = '600 10.5px ' + mono; ctx.fillStyle = faint; ctx.fillText('Break it · factor N by period-finding', rx, 18);
    var res = factorVia(base), r = res.r;
    ctx.font = '11px ' + mono; ctx.fillStyle = ink2;
    ctx.fillText('base a = ' + base + '   ·   look at  a^x mod ' + N, rx, 40);
    // sequence a^x mod N as a row of cells, one period highlighted
    var seq = [], x = 1; for (var i = 0; i <= Math.min(r || 8, 11); i++) { seq.push(x); x = (x * base) % N; }
    var cw = Math.min(30, (W - rx - 20) / Math.max(8, seq.length)), sy = 54;
    for (var s = 0; s < seq.length; s++) { var cx = rx + s * (cw + 4), inPer = r && s < r;
      ctx.strokeStyle = inPer ? acc : rule; ctx.lineWidth = inPer ? 1.6 : 1; rr(cx, sy, cw, cw * 0.82, 4); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = '10px ' + mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(seq[s]), cx + cw / 2, sy + cw * 0.41); ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = faint; ctx.font = '8px ' + mono; ctx.fillText('x=' + s, cx + cw / 2, sy + cw * 0.82 + 9); }
    ctx.textAlign = 'left'; var fy = sy + cw + 30;
    if (r) { ctx.fillStyle = acc; ctx.font = '11px ' + mono; ctx.fillText('period r = ' + r + '  (a^r ≡ 1 mod ' + N + ')', rx, fy); fy += 20;
      if (res.ok) { ctx.fillStyle = ink2; ctx.fillText('a^(r/2) = ' + res.half + '   gcd(' + (res.half - 1) + ', ' + N + ') = ' + res.p, rx, fy); fy += 18;
        ctx.fillText('                gcd(' + (res.half + 1) + ', ' + N + ') = ' + res.q, rx, fy); fy += 20;
        ctx.fillStyle = pass; ctx.font = '600 13px ' + mono; ctx.fillText('N = ' + res.p + ' × ' + res.q + '  — cracked', rx, fy); }
      else { ctx.fillStyle = reject; ctx.font = '11px ' + mono; ctx.fillText(res.trivial ? 'a^(r/2) ≡ −1 — unlucky base, press “try base a”' : 'odd period — press “try base a”', rx, fy); } }
    else { ctx.fillStyle = reject; ctx.fillText('gcd(a,N) ≠ 1 — press “try base a”', rx, fy); }
    ctx.fillStyle = faint; ctx.font = '9.5px ' + (K.v('--sans') || 'sans-serif'); wrap('The one hard step is finding the period r. Shor’s quantum algorithm finds it efficiently; turning r into the factors (the gcd) is ordinary classical math.', rx, H - 30, W - rx - 16, 13);
  }
  function rr(x, y, w, h, rad) { ctx.beginPath(); if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rad); return; } ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath(); }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var t = line + words[i] + ' '; if (ctx.measureText(t).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = t; } ctx.fillText(line, x, yy); }
  draw();
};


  // ===================== EXPANSION: landmark re-runnable experiments =====================

// ───── chsh (Bell / CHSH inequality — S climbs past 2 to 2√2) ─────
  EDU["chsh"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(); });
  var SQ = 1 / Math.sqrt(2), T2 = 2 * SQ;                 // Tsirelson bound 2√2 ≈ 2.828
  var psi = [SQ, 0, 0, SQ];                                // |Φ+⟩ amplitudes, index = 2·b0 + b1 (real)
  function Mmat(th) { var c = Math.cos(th), s = Math.sin(th); return [[c, s], [s, -c]]; }   // cosθ·Z + sinθ·X
  function corr(a, b) {                                     // ⟨Φ+| M(a)⊗M(b) |Φ+⟩, summed from the statevector
    var A = Mmat(a), B = Mmat(b), e = 0;
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) e += psi[i] * A[i >> 1][j >> 1] * B[i & 1][j & 1] * psi[j];
    return e;
  }
  var a0 = 0, a1 = Math.PI / 2;                            // Alice's two fixed settings: 0°, 90°
  var phi = Math.PI / 4;                                    // Bob's angle (slider) — optimal at 45°
  var dispS = 2;

  var lab = document.createElement('label'); lab.className = 'chip'; lab.style.marginRight = '8px';
  lab.textContent = 'Bob angle φ ';
  var range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '90'; range.step = '1'; range.value = '45';
  range.style.marginLeft = '6px'; range.setAttribute('aria-label', 'Bob measurement angle'); lab.appendChild(range);
  range.addEventListener('input', function () { phi = parseFloat(range.value) * Math.PI / 180; if (K.reduced) draw(); });
  controls.appendChild(lab);
  function mkb(t, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(); if (K.reduced) draw(); }); controls.appendChild(b); return b; }
  mkb('Optimal (45°)', function () { phi = Math.PI / 4; range.value = '45'; });
  mkb('Aligned (0°)', function () { phi = 0; range.value = '0'; });

  function Svalue() { var b = phi, bp = -phi; return corr(a0, b) + corr(a0, bp) + corr(a1, b) - corr(a1, bp); }

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var S = Svalue();
    if (K.reduced) dispS = S; else dispS += (S - dispS) * 0.18;
    var deg = Math.round(phi * 180 / Math.PI);

    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Bell state |Φ⁺⟩  ·  Alice measures at 0° and 90°  ·  Bob at ' + deg + '° and −' + deg + '°', 14, 22);

    // four correlators E(a,b) as small signed bars
    var pairs = [['E(0°, b)', a0, phi], ['E(0°, b′)', a0, -phi], ['E(90°, b)', a1, phi], ['E(90°, b′)', a1, -phi]];
    var bx = 24, by0 = 56, bw = 150, rowH = 26;
    ctx.font = '10.5px ' + mono;
    for (var i = 0; i < 4; i++) {
      var e = corr(pairs[i][1], pairs[i][2]), y = by0 + i * rowH, mid = bx + bw / 2;
      ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mid, y - 8); ctx.lineTo(mid, y + 8); ctx.stroke();
      ctx.fillStyle = e >= 0 ? acc : reject;
      ctx.fillRect(mid, y - 5, e * (bw / 2), 10);
      ctx.fillStyle = ink2; ctx.textAlign = 'left'; ctx.fillText(pairs[i][0], bx, y - 12);
      ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.fillText((e >= 0 ? '+' : '') + e.toFixed(3), bx + bw + 46, y + 4);
    }
    ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('S = E(0,b) + E(0,b′) + E(90,b) − E(90,b′)', bx, by0 + 4 * rowH + 6);

    // big S + verdict
    var violated = Math.abs(dispS) > 2.0001;
    ctx.textAlign = 'left'; ctx.fillStyle = violated ? pass : ink2; ctx.font = '600 30px ' + mono;
    ctx.fillText('S = ' + dispS.toFixed(3), W * 0.52, 70);
    ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    ctx.fillStyle = violated ? pass : faint;
    ctx.fillText(violated ? 'beyond 2 — no local-hidden-variable theory can explain this' : 'within ±2 — explainable by local realism', W * 0.52, 90);

    // number line from −2√2 .. +2√2
    var nlx0 = W * 0.52, nlx1 = W - 24, nly = H - 56, lo = -T2, hi = T2;
    function X(v) { return nlx0 + (v - lo) / (hi - lo) * (nlx1 - nlx0); }
    // classical band [−2,2] vs quantum-only zones
    ctx.fillStyle = faint; ctx.globalAlpha = 0.12; ctx.fillRect(X(-2), nly - 9, X(2) - X(-2), 18); ctx.globalAlpha = 1;
    ctx.fillStyle = pass; ctx.globalAlpha = 0.12; ctx.fillRect(X(2), nly - 9, X(T2) - X(2), 18); ctx.fillRect(X(-T2), nly - 9, X(-2) - X(-T2), 18); ctx.globalAlpha = 1;
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nlx0, nly); ctx.lineTo(nlx1, nly); ctx.stroke();
    [[-2, 'classical −2'], [2, '+2'], [T2, '2√2'], [-T2, '−2√2']].forEach(function (t) {
      ctx.strokeStyle = ink2; ctx.globalAlpha = 0.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(t[0]), nly - 11); ctx.lineTo(X(t[0]), nly + 11); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'center'; ctx.fillText(t[1], X(t[0]), nly + 22);
    });
    ctx.fillStyle = violated ? pass : ink; ctx.beginPath(); ctx.arc(X(dispS), nly, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('classical limit |S| ≤ 2   ·   quantum (Tsirelson) |S| ≤ 2√2', nlx0, nly - 18);
  }
  if (K.reduced) draw(); else K.loop(draw);
};

  // ───── teleport (quantum teleportation — recover |ψ⟩, fidelity 1) ─────
  EDU["teleport"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) render(); });
  var N = 3, DIM = 8;
  function bit(i, q) { return (i >> (N - 1 - q)) & 1; }
  function H1(st, q) { var o = st.slice(), s = 1 / Math.sqrt(2), m = 1 << (N - 1 - q);
    for (var i = 0; i < DIM; i++) { if (i & m) continue; var j = i | m;
      o[i] = { re: (st[i].re + st[j].re) * s, im: (st[i].im + st[j].im) * s };
      o[j] = { re: (st[i].re - st[j].re) * s, im: (st[i].im - st[j].im) * s }; } return o; }
  function X1(st, q) { var o = st.slice(), m = 1 << (N - 1 - q); for (var i = 0; i < DIM; i++) o[i ^ m] = st[i]; return o; }
  function Z1(st, q) { var o = st.slice(), m = 1 << (N - 1 - q); for (var i = 0; i < DIM; i++) o[i] = (i & m) ? { re: -st[i].re, im: -st[i].im } : st[i]; return o; }
  function CX(st, c, t) { var o = st.slice(), mc = 1 << (N - 1 - c), mt = 1 << (N - 1 - t); for (var i = 0; i < DIM; i++) o[i] = (i & mc) ? st[i ^ mt] : st[i]; return o; }
  function measure(st, q, rnd) { var m = 1 << (N - 1 - q), p1 = 0;
    for (var i = 0; i < DIM; i++) if (i & m) p1 += st[i].re * st[i].re + st[i].im * st[i].im;
    var b = rnd <= p1 ? 1 : 0, norm = Math.sqrt(b ? p1 : 1 - p1) || 1, o = st.slice();
    for (var k = 0; k < DIM; k++) { var bb = (k & m) ? 1 : 0; o[k] = (bb === b) ? { re: st[k].re / norm, im: st[k].im / norm } : { re: 0, im: 0 }; }
    return [b, o]; }
  // message |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩
  var theta = 1.1, mphi = 0.6, m0 = 0, m1 = 0, stage = 0, anim = 0, fidelity = 1, outBloch = { x: 0, y: 0, z: 1 };
  function msgAmp() { var c = Math.cos(theta / 2), s = Math.sin(theta / 2); return [{ re: c, im: 0 }, { re: s * Math.cos(mphi), im: s * Math.sin(mphi) }]; }
  function blochOf(a0, a1) { var p = { re: a0.re * a1.re + a0.im * a1.im, im: a0.re * a1.im - a0.im * a1.re };
    return { x: 2 * p.re, y: 2 * p.im, z: (a0.re * a0.re + a0.im * a0.im) - (a1.re * a1.re + a1.im * a1.im) }; }
  function run(rnd0, rnd1) {
    var msg = msgAmp(), st = []; for (var i = 0; i < DIM; i++) st.push({ re: 0, im: 0 });
    st[0] = msg[0]; st[4] = msg[1];                        // |ψ⟩ on q0, |00⟩ on q1q2
    st = H1(st, 1); st = CX(st, 1, 2);                     // Bell pair q1,q2
    st = CX(st, 0, 1); st = H1(st, 0);                     // Alice's Bell-basis rotation
    var r0 = measure(st, 0, rnd0); m0 = r0[0]; st = r0[1];
    var r1 = measure(st, 1, rnd1); m1 = r1[0]; st = r1[1];
    if (m1) st = X1(st, 2);                                // Bob: X^{m1}
    if (m0) st = Z1(st, 2);                                // Bob: Z^{m0}
    // extract Bob's qubit (q2) from the definite (m0,m1) block
    var base = (m0 << 2) | (m1 << 1), a0 = st[base], a1 = st[base | 1];
    outBloch = blochOf(a0, a1);
    var mb = blochOf(msg[0], msg[1]);
    fidelity = (1 + (outBloch.x * mb.x + outBloch.y * mb.y + outBloch.z * mb.z)) / 2;
  }
  function go() { run(Math.random(), Math.random()); stage = 1; anim = 0; }
  run(0, 0);                                                // initial: outcome 00

  function mk(t, fn, primary) { var b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'btn primary' : 'btn'; b.textContent = t; b.addEventListener('click', function () { fn(); if (K.reduced) render(); }); controls.appendChild(b); return b; }
  mk('Run teleport', function () { go(); }, true);
  var tl = document.createElement('label'); tl.className = 'chip'; tl.style.margin = '0 8px'; tl.textContent = 'message θ ';
  var tr = document.createElement('input'); tr.type = 'range'; tr.min = '0'; tr.max = '180'; tr.step = '1'; tr.value = String(Math.round(theta * 180 / Math.PI)); tr.style.marginLeft = '6px';
  tr.addEventListener('input', function () { theta = parseFloat(tr.value) * Math.PI / 180; run(m0, m0 ? 1 : 0); stage = 0; if (K.reduced) render(); }); tl.appendChild(tr); controls.appendChild(tl);

  function drawBloch(cx, cy, r, b, col, ink, faint, rule, label) {
    ctx.strokeStyle = rule; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.32); ctx.strokeStyle = faint; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    var L = Math.hypot(b.x, b.y, b.z) || 1, u = { x: b.x / L, y: b.y / L, z: b.z / L };
    var sx = cx + r * u.x, sy = cy - r * u.z + r * 0.32 * u.y;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = '11px ' + (K.v('--mono') || 'monospace'); ctx.textAlign = 'center'; ctx.fillText(label, cx, cy + r + 20);
  }
  var dispOut = { x: 0, y: 0, z: 1 };
  function render() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), acc2 = K.v('--accent-2'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var msg = msgAmp(), mb = blochOf(msg[0], msg[1]);
    var shown = (stage >= 1) ? outBloch : { x: 0, y: 0, z: 1 };
    if (K.reduced) dispOut = shown; else { dispOut.x += (shown.x - dispOut.x) * 0.15; dispOut.y += (shown.y - dispOut.y) * 0.15; dispOut.z += (shown.z - dispOut.z) * 0.15; }

    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Alice has an unknown qubit |ψ⟩. With a shared Bell pair + 2 classical bits, Bob rebuilds it — exactly.', 14, 22);

    var r = Math.min(W * 0.13, 64), ay = H * 0.46;
    drawBloch(W * 0.18, ay, r, mb, acc, ink2, faint, rule, "Alice's message |ψ⟩");
    drawBloch(W * 0.82, ay, r, dispOut, pass, ink2, faint, rule, "Bob's qubit");

    // channel in the middle: entanglement + classical bits
    var mx0 = W * 0.18 + r + 14, mx1 = W * 0.82 - r - 14, my = ay;
    ctx.strokeStyle = acc2; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(mx0, my + 26); ctx.lineTo(mx1, my + 26); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.textAlign = 'center'; ctx.fillText('shared entanglement', (mx0 + mx1) / 2, my + 42);
    if (stage >= 1) {
      ctx.fillStyle = ink2; ctx.font = '600 11px ' + mono; ctx.fillText('2 classical bits:  m₀=' + m0 + '  m₁=' + m1 + '  →', (mx0 + mx1) / 2, my - 30);
      ctx.fillStyle = acc; ctx.font = '10px ' + mono; ctx.fillText('Bob applies  ' + (m0 ? 'Z' : '·') + ' ' + (m1 ? 'X' : '·'), (mx0 + mx1) / 2, my - 14);
      ctx.fillStyle = pass; ctx.font = '600 12px ' + mono; ctx.fillText('fidelity = ' + fidelity.toFixed(3), (mx0 + mx1) / 2, my + 64);
    } else {
      ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.fillText('press “Run teleport”', (mx0 + mx1) / 2, my - 16);
    }
  }
  function tick() { if (stage === 1) { anim++; if (anim > 30) stage = 2; } render(); }
  if (K.reduced) { stage = 1; run(0, 0); render(); } else K.loop(tick);
};

  // ───── qec-code (3-qubit bit-flip code — syndrome localizes & corrects) ─────
  EDU["qec-code"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; draw(); });
  var N = 3, DIM = 8;
  function bit(i, q) { return (i >> (N - 1 - q)) & 1; }
  function CX(st, c, t) { var o = st.slice(), mc = 1 << (N - 1 - c), mt = 1 << (N - 1 - t); for (var i = 0; i < DIM; i++) o[i] = (i & mc) ? st[i ^ mt] : st[i]; return o; }
  function X1(st, q) { var o = st.slice(), m = 1 << (N - 1 - q); for (var i = 0; i < DIM; i++) o[i ^ m] = st[i]; return o; }
  function Z1(st, q) { var o = st.slice(), m = 1 << (N - 1 - q); for (var i = 0; i < DIM; i++) o[i] = (i & m) ? { re: -st[i].re, im: -st[i].im } : st[i]; return o; }
  function expZZ(st, qa, qb) { var e = 0; for (var i = 0; i < DIM; i++) { var p = st[i].re * st[i].re + st[i].im * st[i].im; e += p * ((bit(i, qa) === bit(i, qb)) ? 1 : -1); } return e; }
  var theta = 1.05, errQ = 0, errType = 'X';               // a representative logical state; error on q0 by default

  function encoded() {                                     // α|000⟩ + β|111⟩
    var c = Math.cos(theta / 2), s = Math.sin(theta / 2), st = []; for (var i = 0; i < DIM; i++) st.push({ re: 0, im: 0 });
    st[0] = { re: c, im: 0 }; st[4] = { re: s, im: 0 };     // |ψ⟩ on q0
    st = CX(st, 0, 1); st = CX(st, 0, 2); return st;
  }
  function syndrome(st) { var s1 = expZZ(st, 0, 1) < 0 ? 1 : 0, s2 = expZZ(st, 1, 2) < 0 ? 1 : 0;
    // (s1,s2): 00→none, 10→q0, 11→q1, 01→q2
    var q = (s1 && !s2) ? 0 : (s1 && s2) ? 1 : (!s1 && s2) ? 2 : -1;
    return { s1: s1, s2: s2, q: q }; }

  function mk(t, fn, on) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; if (on) b.setAttribute('aria-pressed', 'true'); b.textContent = t; b.addEventListener('click', function () { fn(); draw(); }); controls.appendChild(b); return b; }
  var ebtns = {};
  controls.appendChild(Object.assign(document.createElement('span'), { className: 'chip', textContent: 'flip' }));
  ['none', '0', '1', '2'].forEach(function (e) { ebtns[e] = mk(e === 'none' ? 'no error' : 'q' + e, function () { errQ = e === 'none' ? -1 : parseInt(e, 10); sync(); }); });
  var typeBtn = mk('X error', function () { errType = errType === 'X' ? 'Z' : 'X'; typeBtn.textContent = errType + ' error'; sync(); });
  function sync() { for (var e in ebtns) ebtns[e].setAttribute('aria-pressed', ((e === 'none' && errQ < 0) || e === String(errQ)) ? 'true' : 'false'); }
  sync();

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        acc = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var st = encoded();
    if (errQ >= 0) st = errType === 'X' ? X1(st, errQ) : Z1(st, errQ);
    var syn = syndrome(st), undetected = errQ >= 0 && syn.q < 0;
    var corrected = st; if (syn.q >= 0) corrected = X1(st, syn.q);

    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('Encode  |ψ⟩ → α|000⟩ + β|111⟩.  A bit-flip can be found and undone without ever reading the logical state.', 14, 22);

    // three data qubits
    var cy = H * 0.42, qx = [W * 0.24, W * 0.42, W * 0.60], r = 22;
    for (var q = 0; q < 3; q++) {
      var x = qx[q], hit = errQ === q;
      ctx.fillStyle = hit ? (errType === 'X' ? reject : acc) : K.v('--panel'); ctx.globalAlpha = hit ? 0.18 : 1;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = hit ? (errType === 'X' ? reject : acc) : faint; ctx.lineWidth = hit ? 2.2 : 1.4; ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = '600 12px ' + mono; ctx.textAlign = 'center'; ctx.fillText('q' + q, x, cy + 4);
      if (hit) { ctx.fillStyle = errType === 'X' ? reject : acc; ctx.font = '10px ' + mono; ctx.fillText(errType + ' error', x, cy - r - 8); }
    }
    // stabilizer brackets Z0Z1 and Z1Z2
    function stab(xa, xb, val, label, yoff) {
      var y = cy + r + 16 + yoff;
      ctx.strokeStyle = val ? reject : faint; ctx.globalAlpha = val ? 1 : 0.5; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(xa, cy + r + 4); ctx.lineTo(xa, y); ctx.lineTo(xb, y); ctx.lineTo(xb, cy + r + 4); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = val ? reject : ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
      ctx.fillText(label + ' = ' + (val ? '−1' : '+1'), (xa + xb) / 2, y + 14);
    }
    stab(qx[0], qx[1], syn.s1, 'Z₀Z₁', 0);
    stab(qx[1], qx[2], syn.s2, 'Z₁Z₂', 30);

    // syndrome readout + verdict
    var rx = W * 0.70, ry = H * 0.30;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = faint; ctx.fillText('syndrome', rx, ry);
    ctx.fillStyle = ink; ctx.font = '600 16px ' + mono; ctx.fillText('(' + syn.s1 + ', ' + syn.s2 + ')', rx, ry + 22);
    ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    if (errQ < 0) { ctx.fillStyle = ink2; ctx.fillText('no error · syndrome 0,0', rx, ry + 46); }
    else if (undetected) { ctx.fillStyle = acc; wrap('a Z (phase) error commutes with Z-checks → syndrome 0,0, undetected. The 9-qubit code is needed for phase errors.', rx, ry + 46, W - rx - 16, 15); }
    else { ctx.fillStyle = pass; ctx.fillText('→ points to q' + syn.q + ' · apply X to correct', rx, ry + 46);
      ctx.font = '600 12px ' + mono; ctx.fillText('logical |ψ⟩ recovered ✓', rx, ry + 70); }
  }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; ctx.textAlign = 'left'; for (var i = 0; i < words.length; i++) { var test = line + words[i] + ' '; if (ctx.measureText(test).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = test; } ctx.fillText(line, x, yy); }
  draw();
};


  // ===================== EXPANSION: foundations + quantum track =====================

// ───── bit (what is a bit? — logic-gate playground) ─────
  EDU["bit"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(0); });

  var A = 1, B = 0;                       // input bits
  var gate = 'AND';                       // AND OR XOR NAND
  var adder = false;                      // half-adder mode
  var GATES = { AND: function (a, b) { return a && b ? 1 : 0; },
                OR:  function (a, b) { return a || b ? 1 : 0; },
                XOR: function (a, b) { return a !== b ? 1 : 0; },
                NAND:function (a, b) { return a && b ? 0 : 1; } };

  // ---- controls ----
  function mk(label, fn, cls) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = label;
    b.addEventListener('click', function () { fn(b); if (K.reduced) draw(0); });
    controls.appendChild(b); return b;
  }
  var aBtn = mk('A = 1', function () { A ^= 1; aBtn.textContent = 'A = ' + A; });
  var bBtn = mk('B = 0', function () { B ^= 1; bBtn.textContent = 'B = ' + B; });
  var sep = document.createElement('span'); sep.className = 'chip'; sep.textContent = 'gate'; controls.appendChild(sep);
  var gbtns = {};
  ['AND', 'OR', 'XOR', 'NAND'].forEach(function (g) {
    gbtns[g] = mk(g, function () { gate = g; syncGates(); });
  });
  var adderBtn = mk('Half-adder', function () { adder = !adder; syncGates(); }, '');
  function syncGates() {
    for (var g in gbtns) gbtns[g].setAttribute('aria-pressed', (!adder && gate === g) ? 'true' : 'false');
    for (var g2 in gbtns) gbtns[g2].disabled = adder;
    adderBtn.setAttribute('aria-pressed', adder ? 'true' : 'false');
  }
  syncGates();

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // draw a wire with optional travelling pulses when it carries a 1
  function wire(x0, y0, x1, y1, on, t, col, faint) {
    ctx.strokeStyle = on ? col : faint; ctx.globalAlpha = on ? 1 : 0.55;
    ctx.lineWidth = on ? 2.4 : 1.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalAlpha = 1;
    if (on && !K.reduced) {
      var len = Math.hypot(x1 - x0, y1 - y0);
      for (var k = 0; k < 3; k++) {
        var ph = ((t * 0.09 + k / 3) % 1);
        var px = x0 + (x1 - x0) * ph, py = y0 + (y1 - y0) * ph;
        ctx.fillStyle = col; ctx.globalAlpha = 0.9 * Math.sin(Math.PI * ph);
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }
  // a switch glyph that glows when its bit is 1
  function node(x, y, label, val, col, faint, ink) {
    var on = !!val, r = 19;
    ctx.fillStyle = on ? col : K.v('--panel'); ctx.globalAlpha = on ? 0.16 : 1;
    rr(x - r, y - r, r * 2, r * 2, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = on ? col : faint; ctx.lineWidth = on ? 2 : 1.3; rr(x - r, y - r, r * 2, r * 2, 7); ctx.stroke();
    ctx.fillStyle = on ? col : faint; ctx.font = '600 17px ' + (K.v('--mono') || 'monospace');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(val | 0), x, y + 1);
    ctx.fillStyle = ink; ctx.font = '12px ' + (K.v('--mono') || 'monospace'); ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x, y - r - 7);
  }
  // a gate body (trapezoidal) with name + output
  function gateBody(cx, cy, name, col, faint, ink) {
    var gw = 78, gh = 64;
    ctx.fillStyle = K.v('--panel'); rr(cx - gw / 2, cy - gh / 2, gw, gh, 9); ctx.fill();
    ctx.strokeStyle = faint; ctx.lineWidth = 1.4; rr(cx - gw / 2, cy - gh / 2, gw, gh, 9); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = '600 14px ' + (K.v('--mono') || 'monospace');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, cx, cy);
  }

  function draw(t) {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'),
        col = K.v('--accent'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = faint; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('a bit is one switch · 0 or 1 · wire switches together and you get logic', 14, 22);

    var ax = W * 0.13, ay = H * 0.34, by = H * 0.60;
    var gx = W * 0.49, gy = (ay + by) / 2;
    var ox = W * 0.84;

    if (!adder) {
      var out = GATES[gate](A, B);
      wire(ax + 19, ay, gx - 40, gy - 14, A === 1, t, col, faint);
      wire(ax + 19, by, gx - 40, gy + 14, B === 1, t, col, faint);
      wire(gx + 40, gy, ox - 22, gy, out === 1, t, col, faint);
      gateBody(gx, gy, gate, col, faint, ink);
      node(ax, ay, 'A', A, col, faint, ink2);
      node(ax, by, 'B', B, col, faint, ink2);
      node(ox, gy, gate === 'NAND' ? 'OUT' : 'OUT', out, col, faint, ink2);
      // truth table
      truth(faint, ink, ink2, col, mono, [['OUT', GATES[gate]]]);
      ctx.fillStyle = ink2; ctx.font = '12px ' + mono; ctx.textAlign = 'center';
      ctx.fillText(A + ' ' + gate + ' ' + B + ' = ' + out, gx, H - 96);
    } else {
      var sum = GATES.XOR(A, B), carry = GATES.AND(A, B);
      var gxorY = gy - 30, gandY = gy + 30;
      wire(ax + 19, ay, gx - 40, gxorY - 12, A === 1, t, col, faint);
      wire(ax + 19, by, gx - 40, gxorY + 12, B === 1, t, col, faint);
      wire(ax + 19, ay, gx - 40, gandY - 12, A === 1, t, col, faint);
      wire(ax + 19, by, gx - 40, gandY + 12, B === 1, t, col, faint);
      wire(gx + 40, gxorY, ox - 22, gxorY, sum === 1, t, col, faint);
      wire(gx + 40, gandY, ox - 22, gandY, carry === 1, t, col, faint);
      gateBody(gx, gxorY, 'XOR', col, faint, ink);
      gateBody(gx, gandY, 'AND', col, faint, ink);
      node(ax, ay, 'A', A, col, faint, ink2);
      node(ax, by, 'B', B, col, faint, ink2);
      node(ox, gxorY, 'SUM', sum, col, faint, ink2);
      node(ox, gandY, 'CARRY', carry, col, faint, ink2);
      truth(faint, ink, ink2, col, mono, [['SUM', GATES.XOR], ['CARRY', GATES.AND]]);
      ctx.fillStyle = ink2; ctx.font = '12px ' + mono; ctx.textAlign = 'center';
      ctx.fillText('half-adder: ' + A + ' + ' + B + ' = ' + (carry * 2 + sum) + '  (carry ' + carry + ', sum ' + sum + ')', gx, H - 96);
    }
  }

  // truth table strip across the bottom; current (A,B) row highlighted
  function truth(faint, ink, ink2, col, mono, cols) {
    var rows = [[0, 0], [0, 1], [1, 0], [1, 1]];
    var x0 = 14, y0 = H - 80, cw = 36, rh = 17;
    ctx.font = '11px ' + mono; ctx.textBaseline = 'middle';
    var headers = ['A', 'B'].concat(cols.map(function (c) { return c[0]; }));
    ctx.textAlign = 'center';
    for (var h = 0; h < headers.length; h++) { ctx.fillStyle = faint; ctx.fillText(headers[h], x0 + cw * (h + 0.5), y0); }
    for (var r = 0; r < rows.length; r++) {
      var cur = rows[r][0] === A && rows[r][1] === B, yy = y0 + rh * (r + 1);
      if (cur) { ctx.fillStyle = col; ctx.globalAlpha = 0.12; ctx.fillRect(x0, yy - rh / 2, cw * headers.length, rh); ctx.globalAlpha = 1; }
      var vals = [rows[r][0], rows[r][1]].concat(cols.map(function (c) { return c[1](rows[r][0], rows[r][1]); }));
      for (var v = 0; v < vals.length; v++) {
        ctx.fillStyle = cur ? (v >= 2 ? col : ink) : ink2;
        ctx.fillText(String(vals[v]), x0 + cw * (v + 0.5), yy);
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  if (K.reduced) draw(0); else K.loop(draw);
};

  // ───── architectures (beyond attention: SSMs & hybrids) ─────
  EDU["architectures"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(0); });

  // sequence length n in "k tokens": slider 1..256
  var n = 64, sel = 'attention';
  var ARCH = {
    rnn:       { name: 'RNN / LSTM',        cost: 'lin', idea: 'reads one token at a time through a single hidden state', cx: 'O(n) work, but sequential — hard to parallelize' },
    attention: { name: 'Transformer',       cost: 'quad', idea: 'every token attends to every other, in parallel', cx: 'O(n²) compute & memory in sequence length' },
    ssm:       { name: 'SSM · Mamba',       cost: 'lin', idea: 'a selective state space scans the sequence in linear time', cx: '~O(n) work, O(1) memory per step at inference' },
    hybrid:    { name: 'Hybrid',            cost: 'both', idea: 'interleaves a few attention layers with many SSM layers', cx: 'mostly linear, attention only where it pays' },
    moe:       { name: 'Mixture-of-Experts',cost: 'moe', idea: 'routes each token to a few of many expert sub-networks', cx: 'more parameters, ~same active compute per token' }
  };
  var ORDER = ['rnn', 'attention', 'ssm', 'hybrid', 'moe'];

  function mk(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', function () { fn(); if (K.reduced) draw(0); }); controls.appendChild(b); return b; }
  var abtn = {};
  var lbl = document.createElement('span'); lbl.className = 'chip'; lbl.textContent = 'architecture'; controls.appendChild(lbl);
  ORDER.forEach(function (k) { abtn[k] = mk(ARCH[k].name, function () { sel = k; sync(); }); });
  var slab = document.createElement('label'); slab.className = 'chip'; slab.style.marginLeft = '8px'; slab.textContent = 'context';
  var range = document.createElement('input'); range.type = 'range'; range.min = '4'; range.max = '256'; range.step = '1'; range.value = String(n);
  range.style.marginLeft = '6px'; range.setAttribute('aria-label', 'context length'); slab.appendChild(range); controls.appendChild(slab);
  range.addEventListener('input', function () { n = parseInt(range.value, 10); if (K.reduced) draw(0); });
  function sync() { ORDER.forEach(function (k) { abtn[k].setAttribute('aria-pressed', sel === k ? 'true' : 'false'); }); }
  sync();

  function draw(t) {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule'),
        col = K.v('--accent'), col2 = K.v('--accent-2'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';

    // ---- plot: cost vs sequence length ----
    var px0 = 56, px1 = W - 20, py0 = 26, py1 = H * 0.62;
    var nmax = 256;
    function X(nn) { return px0 + (nn / nmax) * (px1 - px0); }
    var ymax = 1.0;                                   // normalised: attention(nmax)=1
    function Yq(nn) { return (nn / nmax) * (nn / nmax); }    // n^2 normalised
    function Yl(nn) { return (nn / nmax); }                  // n normalised
    function Y(v) { return py1 - v * (py1 - py0); }
    // axes
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py1); ctx.lineTo(px1, py1); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
    ctx.save(); ctx.translate(16, (py0 + py1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText('compute / memory', 0, 0); ctx.restore();
    ctx.textAlign = 'right'; ctx.fillText('sequence length →', px1, py1 + 14);

    var showQ = sel === 'attention' || sel === 'hybrid' || sel === 'moe';
    var showL = sel === 'rnn' || sel === 'ssm' || sel === 'hybrid';
    // quadratic curve (attention)
    function curve(fn, c, alpha, lw) {
      ctx.strokeStyle = c; ctx.globalAlpha = alpha; ctx.lineWidth = lw; ctx.beginPath();
      for (var i = 0; i <= 120; i++) { var nn = (i / 120) * nmax; var x = X(nn), y = Y(fn(nn)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    curve(Yq, col, showQ ? 1 : 0.22, showQ ? 2 : 1.2);
    curve(Yl, col2, showL ? 1 : 0.22, showL ? 2 : 1.2);
    // labels on curves
    ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillStyle = col; ctx.globalAlpha = showQ ? 1 : 0.5; ctx.fillText('attention  ~n²', X(nmax * 0.62) + 4, Y(Yq(nmax * 0.62)) - 4); ctx.globalAlpha = 1;
    ctx.fillStyle = col2; ctx.globalAlpha = showL ? 1 : 0.5; ctx.fillText('SSM / RNN  ~n', X(nmax) - 90, Y(Yl(nmax)) - 8); ctx.globalAlpha = 1;

    // current-n marker
    var mq = Y(Yq(n)), ml = Y(Yl(n));
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(n), py0); ctx.lineTo(X(n), py1); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showQ) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(n), mq, 4.5, 0, Math.PI * 2); ctx.fill(); }
    if (showL) { ctx.fillStyle = col2; ctx.beginPath(); ctx.arc(X(n), ml, 4.5, 0, Math.PI * 2); ctx.fill(); }
    // ratio readout
    var ratio = Yq(n) / Math.max(1e-6, Yl(n));        // = n/nmax ... actually n^2/n = n -> relative
    var rel = n;                                        // attention does ~n× the work of linear at length n
    ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('at length n = ' + n + ' :  attention ≈ ' + n + '× the work of a linear-time model', px0 + 6, py0 + 12);

    // ---- lineage ribbon ----
    var ry = H * 0.80, rx0 = 40, rx1 = W - 40, gap = (rx1 - rx0) / (ORDER.length - 1);
    ctx.strokeStyle = rule; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(rx0, ry); ctx.lineTo(rx1 - (ORDER.length > 4 ? gap : 0), ry); ctx.stroke();
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i], x = rx0 + gap * i, on = sel === k;
      var isMoe = k === 'moe';
      ctx.fillStyle = on ? col : K.v('--panel'); ctx.globalAlpha = on ? 0.16 : 1;
      ctx.beginPath(); ctx.arc(x, ry, on ? 9 : 6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = on ? col : faint; ctx.lineWidth = on ? 2 : 1.3; ctx.beginPath(); ctx.arc(x, ry, on ? 9 : 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = on ? ink : faint; ctx.font = (on ? '600 ' : '') + '10.5px ' + mono; ctx.textAlign = 'center';
      ctx.fillText(ARCH[k].name, x, ry + 22);
    }
    // selected blurb
    var a = ARCH[sel];
    ctx.fillStyle = ink; ctx.font = '13px ' + (K.v('--sans') || 'sans-serif'); ctx.textAlign = 'center';
    ctx.fillText(a.idea, W / 2, ry - 26);
    ctx.fillStyle = col; ctx.font = '11px ' + mono;
    ctx.fillText(a.cx, W / 2, ry - 8);
  }

  if (K.reduced) draw(0); else K.loop(draw);
};

  // ───── entanglement (two-qubit statevector + Bell) ─────
  EDU["entanglement"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) snap(); });
  var S2 = 1 / Math.sqrt(2);
  // statevector over |00>,|01>,|10>,|11>; index = 2*b0 + b1 (qubit0 = leftmost)
  var st = [K.C(1, 0), K.C(0, 0), K.C(0, 0), K.C(0, 0)];
  var disp = [1, 0, 0, 0];
  var measured = -1, measFlash = 0;

  function reset() { st = [K.C(1, 0), K.C(0, 0), K.C(0, 0), K.C(0, 0)]; measured = -1; }
  function H1q(mask) {                                // Hadamard on the qubit selected by mask (2 = q0, 1 = q1)
    var o = st.slice();
    for (var i = 0; i < 4; i++) {
      if (i & mask) continue;
      var j = i | mask;
      o[i] = { re: (st[i].re + st[j].re) * S2, im: (st[i].im + st[j].im) * S2 };
      o[j] = { re: (st[i].re - st[j].re) * S2, im: (st[i].im - st[j].im) * S2 };
    }
    st = o; measured = -1;
  }
  function X1q(mask) { var o = st.slice(); for (var i = 0; i < 4; i++) o[i ^ mask] = st[i]; st = o; measured = -1; }
  function Z1q(mask) { for (var i = 0; i < 4; i++) if (i & mask) st[i] = { re: -st[i].re, im: -st[i].im }; measured = -1; }
  function CNOT() { var t = st[2]; st[2] = st[3]; st[3] = t; measured = -1; }   // control q0(bit2), flip q1: swap 10<->11
  function bell() { reset(); H1q(2); CNOT(); }
  function prob(i) { return st[i].re * st[i].re + st[i].im * st[i].im; }
  // concurrence for a pure 2-qubit state: C = 2|a00*a11 - a01*a10|
  function concurrence() {
    var d = { re: st[0].re * st[3].re - st[0].im * st[3].im - (st[1].re * st[2].re - st[1].im * st[2].im),
              im: st[0].re * st[3].im + st[0].im * st[3].re - (st[1].re * st[2].im + st[1].im * st[2].re) };
    return 2 * Math.hypot(d.re, d.im);
  }
  function measure() {
    var rnd = Math.random(), acc = 0, pick = 0;
    for (var i = 0; i < 4; i++) { acc += prob(i); if (rnd <= acc) { pick = i; break; } }
    for (var j = 0; j < 4; j++) st[j] = (j === pick) ? K.C(1, 0) : K.C(0, 0);
    measured = pick; measFlash = 1;
  }

  function mk(label, fn, primary) { var b = document.createElement('button'); b.type = 'button';
    b.className = primary ? 'btn primary' : 'btn'; b.textContent = label;
    b.addEventListener('click', function () { fn(); if (K.reduced) snap(); }); controls.appendChild(b); return b; }
  mk('H₀', function () { H1q(2); }); mk('H₁', function () { H1q(1); });
  mk('X₀', function () { X1q(2); }); mk('CNOT 0→1', function () { CNOT(); });
  mk('Bell pair', function () { bell(); }, true);
  mk('Measure', function () { measure(); });
  mk('Reset', function () { reset(); });

  function snap() { for (var i = 0; i < 4; i++) disp[i] = prob(i); render(); }
  function hue(re, im) { return ((Math.atan2(im, re) * 180 / Math.PI) + 360) % 360; }
  function phaseCol(re, im, al) { var p = re * re + im * im; if (p < 1e-6) return 'hsla(0,0%,60%,' + (al * 0.3) + ')';
    return 'hsla(' + hue(re, im).toFixed(0) + ',72%,' + (K.dark() ? 62 : 46) + '%,' + al + ')'; }

  function render() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        col = K.v('--accent'), pass = K.v('--pass'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';

    // amplitude bars
    var labels = ['|00⟩', '|01⟩', '|10⟩', '|11⟩'];
    var padL = 26, barW = Math.min(54, (W * 0.52) / 4), gap = barW * 0.55;
    var baseY = H - 60, topY = 40, maxH = baseY - topY;
    ctx.font = '10.5px ' + mono; ctx.textAlign = 'left'; ctx.fillStyle = faint;
    ctx.fillText('two qubits → four amplitudes  (height = probability, hue = phase)', padL, topY - 16);
    for (var i = 0; i < 4; i++) {
      var bx = padL + gap + i * (barW + gap), h = Math.max(2, disp[i] * maxH);
      ctx.fillStyle = phaseCol(st[i].re, st[i].im, measured === i ? 1 : 0.9);
      ctx.fillRect(bx, baseY - h, barW, h);
      ctx.strokeStyle = (measured === i) ? col : rule; ctx.lineWidth = (measured === i) ? 2 : 1;
      ctx.strokeRect(bx + 0.5, baseY - h + 0.5, barW - 1, h - 1);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = '12px ' + mono; ctx.fillText(labels[i], bx + barW / 2, baseY + 18);
      ctx.fillStyle = ink2; ctx.font = '10.5px ' + mono; ctx.fillText((disp[i] * 100).toFixed(0) + '%', bx + barW / 2, baseY - h - 6);
    }
    ctx.strokeStyle = faint; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(padL, baseY + 0.5); ctx.lineTo(padL + 4 * (barW + gap), baseY + 0.5); ctx.stroke(); ctx.globalAlpha = 1;

    // right column: entanglement readout + correlation
    var rx = W * 0.74;
    var C = concurrence();
    var ent = C > 0.02;
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = faint; ctx.fillText('entanglement', rx, topY + 4);
    ctx.fillStyle = ent ? pass : ink2; ctx.font = '600 15px ' + mono;
    ctx.fillText(ent ? 'ENTANGLED' : 'separable', rx, topY + 26);
    // concurrence bar
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.fillText('concurrence  C = ' + C.toFixed(2), rx, topY + 46);
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.strokeRect(rx, topY + 52, 140, 8);
    ctx.fillStyle = ent ? pass : faint; ctx.fillRect(rx, topY + 52, Math.max(0, Math.min(1, C)) * 140, 8);
    // correlation note
    ctx.fillStyle = ink2; ctx.font = '11px ' + (K.v('--sans') || 'sans-serif');
    var note = ent ? 'measuring one qubit instantly fixes the other' : 'the two qubits are independent';
    wrap(note, rx, topY + 84, 150, 15);
    if (measured >= 0) {
      var b0 = measured >> 1, b1 = measured & 1;
      ctx.fillStyle = col; ctx.font = '600 12px ' + mono;
      ctx.fillText('measured:  q0=' + b0 + '  q1=' + b1, rx, topY + 132);
    }
  }
  function wrap(text, x, y, w, lh) {
    var words = text.split(' '), line = '', yy = y;
    for (var i = 0; i < words.length; i++) {
      var test = line + words[i] + ' ';
      if (ctx.measureText(test).width > w && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; }
      else line = test;
    }
    ctx.fillText(line, x, yy);
  }
  function tick() { for (var i = 0; i < 4; i++) disp[i] += (prob(i) - disp[i]) * 0.2; if (measFlash > 0) measFlash *= 0.92; render(); }
  if (K.reduced) snap(); else K.loop(tick);
};

  // ───── quantum-algorithms (Grover interference) ─────
  EDU["quantum-algorithms"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(); });

  var N = 16, marked = 5, amp = [], step = 0, running = false, lastStep = 0;
  function reset() { amp = []; for (var i = 0; i < N; i++) amp.push(1 / Math.sqrt(N)); step = 0; }
  function optimal() { return Math.max(1, Math.round(Math.PI / 4 * Math.sqrt(N))); }
  function grover() {
    amp[marked] = -amp[marked];                                   // oracle
    var mean = 0; for (var i = 0; i < N; i++) mean += amp[i]; mean /= N;
    for (var j = 0; j < N; j++) amp[j] = 2 * mean - amp[j];        // diffusion
    step++;
  }
  reset();

  function mk(label, fn, primary) { var b = document.createElement('button'); b.type = 'button';
    b.className = primary ? 'btn primary' : 'btn'; b.textContent = label;
    b.addEventListener('click', function () { fn(); if (K.reduced) draw(); }); controls.appendChild(b); return b; }
  mk('Grover step', function () { grover(); });
  var runBtn = mk('Run', function () { running = !running; runBtn.textContent = running ? 'Pause' : 'Run'; }, true);
  mk('Reset', function () { reset(); running = false; runBtn.textContent = 'Run'; });
  var nsel = document.createElement('label'); nsel.className = 'chip'; nsel.style.marginLeft = '8px'; nsel.textContent = 'N';
  var sel = document.createElement('select'); sel.className = 'btn';
  [8, 16, 32, 64].forEach(function (v) { var o = document.createElement('option'); o.value = String(v); o.textContent = String(v); if (v === N) o.selected = true; sel.appendChild(o); });
  sel.addEventListener('change', function () { N = parseInt(sel.value, 10); marked = Math.min(marked, N - 1); reset(); }); nsel.appendChild(sel); controls.appendChild(nsel);

  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointerdown', function (e) {
    var r = canvas.getBoundingClientRect(), px = e.clientX - r.left;
    var x0 = 20, x1 = W - 20, bw = (x1 - x0) / N, idx = Math.floor((px - x0) / bw);
    if (idx >= 0 && idx < N) { marked = idx; reset(); if (K.reduced) draw(); }
  });

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        col = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';

    var x0 = 20, x1 = W - 20, bw = (x1 - x0) / N;
    var midY = H * 0.60, scale = H * 0.34;                 // amplitude 0 axis at midY
    // mean
    var mean = 0; for (var i = 0; i < N; i++) mean += amp[i]; mean /= N;
    // zero axis + mean line
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, midY); ctx.lineTo(x1, midY); ctx.stroke();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x0, midY - mean * scale); ctx.lineTo(x1, midY - mean * scale); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // bars (height = amplitude, sign matters: above = +, below = −)
    for (var k = 0; k < N; k++) {
      var bx = x0 + k * bw, h = amp[k] * scale, isM = k === marked;
      ctx.fillStyle = isM ? col : (amp[k] < 0 ? reject : ink2);
      ctx.globalAlpha = isM ? 1 : (amp[k] < 0 ? 0.55 : 0.7);
      ctx.fillRect(bx + bw * 0.16, midY - Math.max(h, 0), bw * 0.68, Math.abs(h) || 1);
      if (h < 0) ctx.fillRect(bx + bw * 0.16, midY, bw * 0.68, -h);
      ctx.globalAlpha = 1;
    }
    // marked label
    ctx.fillStyle = col; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('marked', x0 + marked * bw + bw / 2, H - 10);

    // readout
    var pM = amp[marked] * amp[marked], opt = optimal();
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = faint; ctx.fillText('amplitude amplification · wrong answers cancel, the marked one grows', x0, 22);
    ctx.fillStyle = ink; ctx.fillText('step ' + step + ' / ~' + opt + ' optimal', x0, 40);
    ctx.fillStyle = pM > 0.5 ? pass : ink2;
    ctx.fillText('P(marked) = ' + (pM * 100).toFixed(1) + '%', x0 + 160, 40);
    if (step > opt + 1 && pM < 0.5) { ctx.fillStyle = reject; ctx.fillText('overshot — kept iterating past the optimum', x0 + 320, 40); }
    ctx.fillStyle = faint; ctx.textAlign = 'right';
    ctx.fillText('classical: ~N/2 checks   ·   Grover: ~√N', x1, 22);
  }

  function loop() {
    if (running && !K.reduced) { lastStep++; if (lastStep % 45 === 0) { if (step < optimal() + 4) grover(); else { running = false; runBtn.textContent = 'Run'; } } }
    draw();
  }
  if (K.reduced) draw(); else K.loop(loop);
};

// ───── noise-qec (physical vs logical qubits) ─────
  EDU["noise-qec"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(0); });

  var d = 5;                 // code distance (odd)
  var p = 0.003;             // physical error rate
  var P_TH = 0.01;           // surface-code threshold ~1%
  function physical(dd) { return 2 * dd * dd - 1; }                       // surface-code patch
  function logicalErr(dd, pp) { return 0.03 * Math.pow(pp / P_TH, (dd + 1) / 2); }  // below threshold: shrinks with d

  // deterministic flicker field, reseeded each draw region
  var seed = 7; function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  function mkSlider(label, min, max, step, val, fmt, onin) {
    var l = document.createElement('label'); l.className = 'chip'; l.style.marginRight = '10px';
    var span = document.createElement('span'); span.textContent = label + ' '; l.appendChild(span);
    var r = document.createElement('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
    r.style.marginLeft = '6px'; r.setAttribute('aria-label', label); l.appendChild(r);
    var out = document.createElement('b'); out.style.marginLeft = '8px'; out.textContent = fmt(val); l.appendChild(out);
    r.addEventListener('input', function () { onin(parseFloat(r.value)); out.textContent = fmt(parseFloat(r.value)); if (K.reduced) draw(0); });
    controls.appendChild(l); return r;
  }
  mkSlider('code distance d', 3, 11, 2, d, function (v) { return String(v | 0); }, function (v) { d = v | 0; });
  mkSlider('physical error', 0.001, 0.03, 0.001, p, function (v) { return (v * 100).toFixed(1) + '%'; }, function (v) { p = v; });

  function draw(t) {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        col = K.v('--accent'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';

    // ---- left: the surface-code patch (one logical qubit) ----
    var gx = 30, gy = 44, gw = Math.min(W * 0.42, H - 80);
    var lat = 2 * d - 1;                                  // lattice side
    var cell = gw / lat;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.6;
    ctx.strokeRect(gx - 6, gy - 6, gw + 12, gw + 12); ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.font = '10.5px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('1 logical qubit', gx - 6, gy - 12);
    seed = (d * 131 + Math.round(p * 1000) * 17 + (K.reduced ? 0 : Math.floor(t / 700))) & 0x7fffffff;
    for (var iy = 0; iy < lat; iy++) for (var ix = 0; ix < lat; ix++) {
      var isData = (ix % 2 === 0 && iy % 2 === 0);
      var cxp = gx + (ix + 0.5) * cell, cyp = gy + (iy + 0.5) * cell;
      var err = isData && rng() < p * 8;                  // amplify for visibility
      ctx.beginPath(); ctx.arc(cxp, cyp, isData ? cell * 0.20 : cell * 0.12, 0, Math.PI * 2);
      if (err) { ctx.fillStyle = reject; ctx.fill(); }
      else { ctx.fillStyle = isData ? faint : rule; ctx.globalAlpha = isData ? 0.8 : 0.45; ctx.fill(); ctx.globalAlpha = 1; }
    }
    ctx.fillStyle = ink2; ctx.font = '11px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('d = ' + d + '  →  ' + physical(d) + ' physical qubits', gx + gw / 2, gy + gw + 26);

    // ---- right: logical-error vs distance plot ----
    var pxl = W * 0.56, pxr = W - 24, pyt = 50, pyb = H - 60;
    var below = p < P_TH;
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(pxl, pyt); ctx.lineTo(pxl, pyb); ctx.lineTo(pxr, pyb); ctx.stroke();
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.textAlign = 'center';
    ctx.fillText('code distance →', (pxl + pxr) / 2, pyb + 16);
    ctx.save(); ctx.translate(pxl - 30, (pyt + pyb) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('logical error (log)', 0, 0); ctx.restore();
    // log-y from 1e0 down to 1e-12
    function Y(le) { var l = Math.max(-12, Math.min(0, Math.log10(Math.max(1e-13, le)))); return pyt + (-l / 12) * (pyb - pyt); }
    function Xd(dd) { return pxl + ((dd - 3) / (11 - 3)) * (pxr - pxl); }
    ctx.strokeStyle = below ? pass : reject; ctx.lineWidth = 2; ctx.beginPath();
    for (var dd = 3; dd <= 11; dd += 0.25) { var x = Xd(dd), y = Y(logicalErr(dd, p)); if (dd === 3) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    // current-d dot
    ctx.fillStyle = below ? pass : reject; ctx.beginPath(); ctx.arc(Xd(d), Y(logicalErr(d, p)), 4.5, 0, Math.PI * 2); ctx.fill();

    // ---- readout ----
    var le = logicalErr(d, p);
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = faint; ctx.fillText('threshold p_th ≈ 1% · below it, more physical qubits → exponentially fewer logical errors', pxl, pyt - 18);
    ctx.fillStyle = below ? pass : reject; ctx.font = '600 12px ' + mono;
    ctx.fillText(below ? 'BELOW threshold — error correction helps' : 'ABOVE threshold — bigger codes make it WORSE', pxl, pyb + 34);
    ctx.fillStyle = ink2; ctx.font = '11px ' + mono;
    ctx.fillText('logical error / cycle ≈ ' + le.toExponential(1), pxl, pyb + 50);
  }
  if (K.reduced) draw(0); else K.loop(draw);
};

  // ───── hardware-zoo (quantum hardware modalities) ─────
  EDU["hardware-zoo"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, w = f.w, h = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; w = r.w; h = r.h; });

  // DATA — modality nodes; x = qubit-count axis (0 few .. 1 many), y = gate-fidelity axis (0 lower .. 1 higher)
  // (reconciled against the verified 2026 hardware facts)
  var MOD = [
    { key: 'sc', label: 'Superconducting', x: 0.82, y: 0.42, ex: 'IBM Heron/Condor · Google Willow',
      tip: 'fast gates, fixed on a chip; most qubits today, but shorter coherence — runs near absolute zero' },
    { key: 'ion', label: 'Trapped-ion', x: 0.30, y: 0.88, ex: 'Quantinuum H2 · IonQ',
      tip: 'highest gate fidelity and all-to-all connectivity, but fewer qubits and slower gates' },
    { key: 'atom', label: 'Neutral-atom', x: 0.72, y: 0.66, ex: 'Atom Computing · QuEra',
      tip: 'hundreds–thousands of atoms held by lasers, reconfigurable; fidelity improving fast' },
    { key: 'phot', label: 'Photonic', x: 0.22, y: 0.50, ex: 'PsiQuantum · Xanadu',
      tip: 'qubits are photons — room temperature and network-native, but still early' }
  ];
  var hover = null, cyc = 0, lastIn = -1e9, t0 = 0;
  function ts() { return t0; }

  function hit(px, py) {
    for (var i = 0; i < MOD.length; i++) { var n = MOD[i]; var nx = mx(n.x), ny = my(n.y);
      if (Math.hypot(px - nx, py - ny) < Math.min(w, h) * 0.12) return n.key; }
    return null;
  }
  function mx(x) { return w * 0.13 + x * (w * 0.74); }
  function my(y) { return h * 0.84 - y * (h * 0.66); }
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); hover = hit(e.clientX - r.left, e.clientY - r.top); lastIn = ts(); canvas.style.cursor = hover ? 'pointer' : 'default'; });
  canvas.addEventListener('pointerleave', function () { hover = null; });

  function active() { if (hover) return hover; if (ts() - lastIn < 3) return null; return MOD[cyc % MOD.length].key; }

  function draw(tSec) {
    t0 = tSec || 0;
    if (!hover && ts() - lastIn >= 3) cyc = Math.floor(ts() / 2.6);
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule'),
        col = K.v('--accent'), mono = K.v('--mono') || 'monospace', sans = K.v('--sans') || 'sans-serif';
    ctx.clearRect(0, 0, w, h);
    // axes
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(mx(0) - 20, my(0) + 8); ctx.lineTo(mx(1) + 20, my(0) + 8);
    ctx.moveTo(mx(0) - 20, my(0) + 8); ctx.lineTo(mx(0) - 20, my(1) - 10); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = faint; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('FEWER QUBITS', mx(0) - 18, my(0) + 22); ctx.textAlign = 'right'; ctx.fillText('MORE QUBITS', mx(1) + 18, my(0) + 22);
    ctx.save(); ctx.translate(mx(0) - 34, my(0.5)); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('HIGHER FIDELITY →', 0, 0); ctx.restore();
    var key = active();
    for (var i = 0; i < MOD.length; i++) {
      var n = MOD[i], on = key === n.key, nx = mx(n.x), ny = my(n.y), r = on ? 13 : 9;
      ctx.fillStyle = col; ctx.globalAlpha = on ? 0.18 : 0.10; ctx.beginPath(); ctx.arc(nx, ny, r + 6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = on ? col : K.v('--panel'); ctx.beginPath(); ctx.arc(nx, ny, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = on ? col : faint; ctx.lineWidth = on ? 2 : 1.4; ctx.stroke();
      ctx.fillStyle = on ? ink : ink2; ctx.font = (on ? '600 ' : '') + '12px ' + mono; ctx.textAlign = 'center';
      ctx.fillText(n.label, nx, ny - r - 8);
      ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.fillText(n.ex, nx, ny + r + 16);
    }
    // tip box for active node
    var act = null; for (var j = 0; j < MOD.length; j++) if (MOD[j].key === key) act = MOD[j];
    if (act) {
      ctx.fillStyle = ink2; ctx.font = '12.5px ' + sans; ctx.textAlign = 'center';
      wrap(act.tip, w / 2, h - 14, w * 0.7, 15);
    }
  }
  function wrap(text, x, y, mw, lh) {
    var words = text.split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) { var test = line + words[i] + ' '; if (ctx.measureText(test).width > mw && line) { lines.push(line); line = words[i] + ' '; } else line = test; }
    lines.push(line);
    for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], x, y - (lines.length - 1 - k) * lh);
  }
  if (K.reduced) { draw(0); } else K.loop(function (ms) { draw(ms / 1000); });
};

  // ───── qubit-explorer (theoretical vs real qubit counts — two linked panels) ─────
  EDU["qubit-explorer"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; if (K.reduced) draw(); });

  // DATA — real machines (physical qubit counts; reconciled with verified 2026 facts)
  var CHIPS = [
    { n: 56, name: 'Quantinuum H2', mod: 'ion' },
    { n: 105, name: 'Google Willow', mod: 'sc' },
    { n: 156, name: 'IBM Heron r2', mod: 'sc' },
    { n: 1121, name: 'IBM Condor', mod: 'sc' },
    { n: 1180, name: 'Atom Computing', mod: 'atom' }
  ];
  // milestones on the physical-qubit axis (illustrative resource scales)
  var MILES = [
    { n: 100, label: 'today’s chips' },
    { n: 1e4, label: 'first error-corrected qubits' },
    { n: 1e5, label: 'chemistry beyond classical' },
    { n: 2e6, label: 'break RSA-2048' }
  ];
  var OVERHEAD = 1000;       // ~physical per logical for a deep fault-tolerant algorithm (illustrative)
  var SIM_WALL = 50;         // ~ exact-statevector classical frontier (qubits)

  // n from slider, log scale 1 .. 1e7
  var sliderV = 200;         // -> n ~ 100
  function nOf(v) { return Math.max(1, Math.round(Math.pow(10, v / 100))); }
  var n = nOf(sliderV);

  var lab = document.createElement('label'); lab.className = 'chip'; lab.style.marginRight = '8px';
  var span = document.createElement('span'); span.textContent = 'qubits'; lab.appendChild(span);
  var range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '700'; range.step = '1'; range.value = String(sliderV);
  range.style.marginLeft = '6px'; range.style.width = '220px'; range.setAttribute('aria-label', 'number of qubits'); lab.appendChild(range);
  var out = document.createElement('b'); out.style.marginLeft = '8px'; out.textContent = n.toLocaleString(); lab.appendChild(out);
  range.addEventListener('input', function () { sliderV = parseInt(range.value, 10); n = nOf(sliderV); out.textContent = n.toLocaleString(); if (K.reduced) draw(); });
  controls.appendChild(lab);

  function log10(x) { return Math.log(x) / Math.LN10; }
  function memLog10(nn) { return nn * log10(2) + log10(16); }       // log10(bytes) for 2^n complex128
  function human(L) {                                               // L = log10(bytes)
    var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    if (L > 80) return '10^' + Math.round(L) + ' bytes — more than the atoms in the universe';
    var idx = Math.max(0, Math.min(units.length - 1, Math.floor(L / 3)));
    var m = Math.pow(10, L - idx * 3);
    return (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString()) + ' ' + units[idx];
  }

  // x: log10(n) in [0,7]
  function X(nn, x0, x1) { return x0 + (log10(nn) / 7) * (x1 - x0); }

  function draw() {
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        col = K.v('--accent'), col2 = K.v('--accent-2'), pass = K.v('--pass'), reject = K.v('--reject'), mono = K.v('--mono') || 'monospace';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var x0 = 54, x1 = W - 20;
    var aT = 24, aB = H * 0.46;            // panel A (memory wall)
    var bT = H * 0.56, bB = H - 42;        // panel B (logical yield)

    // ===== shared x ticks (powers of ten) =====
    ctx.font = '9.5px ' + mono; ctx.textAlign = 'center'; ctx.fillStyle = faint;
    for (var e = 0; e <= 7; e++) { var x = x0 + (e / 7) * (x1 - x0); ctx.fillText('10' + sup(e), x, bB + 16); }

    // ===== PANEL A: memory wall =====
    // simulable / not-simulable regions
    var wallX = X(Math.pow(10, 1) /*dummy*/, x0, x1); // placeholder, set properly below
    wallX = x0 + (log10(SIM_WALL) / 7) * (x1 - x0);
    ctx.fillStyle = pass; ctx.globalAlpha = 0.07; ctx.fillRect(x0, aT, wallX - x0, aB - aT);
    ctx.fillStyle = reject; ctx.globalAlpha = 0.07; ctx.fillRect(wallX, aT, x1 - wallX, aB - aT); ctx.globalAlpha = 1;
    ctx.strokeStyle = reject; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(wallX, aT); ctx.lineTo(wallX, aB); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = pass; ctx.font = '9.5px ' + mono; ctx.textAlign = 'left'; ctx.fillText('classically simulable', x0 + 4, aT + 12);
    ctx.fillStyle = reject; ctx.textAlign = 'right'; ctx.fillText('statevector too big to store — no classical machine can hold it', x1 - 4, aT + 12);
    // memory curve (y = log10 bytes mapped 0..20)
    function aY(L) { return aB - Math.max(0, Math.min(20, L)) / 20 * (aB - aT); }
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); var started = false;
    for (var nn = 1; nn <= 70; nn++) { var L = memLog10(nn); if (L > 20) break; var xx = X(nn, x0, x1), yy = aY(L); if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy); }
    ctx.stroke();
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'left'; ctx.fillText('memory to simulate (2ⁿ amplitudes)', x0 + 4, aB - 6);
    ctx.fillStyle = faint; ctx.textAlign = 'left'; ctx.fillText('A', x0 - 44, aT + 10);

    // ===== PANEL B: physical → logical =====
    // logical line: logical = n / OVERHEAD, plotted log10 on y 0..4
    function bY(Llog) { return bB - Math.max(0, Math.min(4, Llog)) / 4 * (bB - bT); }
    ctx.strokeStyle = col2; ctx.lineWidth = 2; ctx.beginPath(); var st2 = false;
    for (var p2 = 0; p2 <= 7; p2 += 0.1) { var nv = Math.pow(10, p2); var lg = nv / OVERHEAD; if (lg < 1) continue; var xx2 = x0 + (p2 / 7) * (x1 - x0), yy2 = bY(log10(lg)); if (!st2) { ctx.moveTo(xx2, yy2); st2 = true; } else ctx.lineTo(xx2, yy2); }
    ctx.stroke();
    ctx.fillStyle = ink2; ctx.font = '10px ' + mono; ctx.textAlign = 'left';
    ctx.fillText('error-corrected (logical) qubits ≈ physical / ' + OVERHEAD, x0 + 4, bT + 12);
    ctx.fillStyle = faint; ctx.fillText('B', x0 - 44, bT + 10);
    // milestones
    for (var m = 0; m < MILES.length; m++) {
      var mx2 = X(MILES[m].n, x0, x1);
      ctx.strokeStyle = faint; ctx.globalAlpha = 0.35; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(mx2, bT + 16); ctx.lineTo(mx2, bB); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = faint; ctx.font = '9px ' + mono; ctx.save(); ctx.translate(mx2 + 3, bB - 4); ctx.rotate(-Math.PI / 2.2); ctx.textAlign = 'left'; ctx.fillText(MILES[m].label, 0, 0); ctx.restore();
    }

    // ===== real chips (vertical markers across both panels) =====
    for (var c = 0; c < CHIPS.length; c++) {
      var cx = X(CHIPS[c].n, x0, x1);
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.32; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, aT); ctx.lineTo(cx, bB); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(cx, aB, 3, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(cx, aB + 6); ctx.rotate(-Math.PI / 3); ctx.fillStyle = ink2; ctx.font = '8.5px ' + mono; ctx.textAlign = 'left'; ctx.fillText(CHIPS[c].name + ' · ' + CHIPS[c].n, 0, 0); ctx.restore();
    }

    // ===== playhead at current n =====
    var nx = X(n, x0, x1);
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(nx, aT); ctx.lineTo(nx, bB); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(nx, aT - 2); ctx.lineTo(nx - 4, aT - 9); ctx.lineTo(nx + 4, aT - 9); ctx.closePath(); ctx.fill();

    // ===== readout =====
    var L = memLog10(n), simulable = n <= SIM_WALL, logical = Math.floor(n / OVERHEAD);
    ctx.textAlign = 'left'; ctx.font = '11px ' + mono;
    ctx.fillStyle = ink; ctx.fillText(n.toLocaleString() + ' qubits', x0, H - 8);
    ctx.fillStyle = simulable ? pass : reject; ctx.fillText('sim mem: ' + human(L) + (simulable ? '  (simulable)' : '  (beyond classical)'), x0 + 130, H - 8);
    ctx.fillStyle = logical >= 1 ? pass : faint; ctx.textAlign = 'right';
    ctx.fillText(logical >= 1 ? ('≈ ' + logical.toLocaleString() + ' logical qubits') : 'not enough for 1 logical qubit', x1, H - 8);
  }
  function sup(d) { var m = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷' }; return m[d] || ''; }
  if (K.reduced) draw(); else K.loop(draw);
};

  // ───── history (timeline of inventions) ─────
  EDU["history"] = function (canvas, controls, K) {
  var f = K.fit(), ctx = f.ctx, W = f.w, H = f.h;
  K.onTheme(function () { var r = K.fit(); ctx = r.ctx; W = r.w; H = r.h; });

  // DATA — milestones (reconciled with verified facts). lane 'c' = classical (above), 'q' = quantum (below).
  var EV = [
    { y: 1936, lane: 'c', t: 'Turing machine', d: 'a formal model of universal computation' },
    { y: 1945, lane: 'c', t: 'Stored-program / ENIAC', d: 'the von Neumann architecture: code and data in one memory' },
    { y: 1947, lane: 'c', t: 'The transistor', d: 'Bell Labs builds a switch with no moving parts — the bit’s physical home' },
    { y: 1948, lane: 'c', t: 'Shannon’s "bit"', d: 'information theory names the unit of information' },
    { y: 1958, lane: 'c', t: 'Integrated circuit', d: 'many transistors on one chip' },
    { y: 1965, lane: 'c', t: 'Moore’s Law', d: 'transistor counts double roughly every two years' },
    { y: 1971, lane: 'c', t: 'The microprocessor', d: 'a whole CPU on a single chip (Intel 4004)' },
    { y: 1981, lane: 'q', t: 'Feynman’s proposal', d: 'simulate quantum physics with a quantum computer' },
    { y: 1985, lane: 'q', t: 'Universal quantum computer', d: 'Deutsch formalises a quantum Turing machine' },
    { y: 1994, lane: 'q', t: 'Shor’s algorithm', d: 'factor large numbers exponentially faster — a threat to RSA' },
    { y: 1996, lane: 'q', t: 'Grover’s search', d: 'a provable quadratic speedup for unstructured search' },
    { y: 1995, lane: 'q', t: 'Quantum error correction', d: 'codes that protect quantum information from noise' },
    { y: 1999, lane: 'q', t: 'First superconducting qubit', d: 'a qubit on a chip — the lineage behind IBM’s and Google’s machines' },
    { y: 2016, lane: 'q', t: 'A quantum computer on the cloud', d: 'IBM puts a 5-qubit machine online — the NISQ era of open experiment begins' },
    { y: 2012, lane: 'c', t: 'Deep learning (AlexNet)', d: 'learned features beat hand-tuned ones at scale' },
    { y: 2017, lane: 'c', t: 'The transformer', d: '"Attention Is All You Need" — the architecture behind modern LLMs' },
    { y: 2019, lane: 'q', t: 'Beyond-classical claim', d: 'Google’s Sycamore samples a task no classical computer matched (disputed)' },
    { y: 2024, lane: 'q', t: 'Below threshold', d: 'a bigger code finally lowers the logical error rate (Google Willow)' }
  ];
  EV.sort(function (a, b) { return a.y - b.y; });
  var minY = 1930, maxY = 2027;
  var hover = null, lastIn = -1e9, t0 = 0, cyc = 0;
  function X(y) { return 40 + (y - minY) / (maxY - minY) * (W - 70); }

  function hit(px, py) {
    var best = null, bd = 22;
    for (var i = 0; i < EV.length; i++) { var ex = X(EV[i].y), ey = EV[i].lane === 'c' ? H * 0.40 : H * 0.60;
      var dd = Math.hypot(px - ex, py - ey); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); hover = hit(e.clientX - r.left, e.clientY - r.top); lastIn = t0; canvas.style.cursor = hover != null ? 'pointer' : 'default'; });
  canvas.addEventListener('pointerleave', function () { hover = null; });

  function draw(tSec) {
    t0 = tSec || 0;
    var ink = K.v('--ink'), ink2 = K.v('--ink-2'), faint = K.v('--faint'), rule = K.v('--rule-2'),
        col = K.v('--accent'), col2 = K.v('--accent-2'), mono = K.v('--mono') || 'monospace', sans = K.v('--sans') || 'sans-serif';
    ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
    var axisY = H * 0.5;
    // axis + decade ticks
    ctx.strokeStyle = rule; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(X(minY), axisY); ctx.lineTo(X(maxY), axisY); ctx.stroke();
    ctx.fillStyle = faint; ctx.font = '9.5px ' + mono; ctx.textAlign = 'center';
    for (var yr = 1940; yr <= 2020; yr += 20) { var x = X(yr); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x, axisY - 4); ctx.lineTo(x, axisY + 4); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(String(yr), x, axisY + 18); }
    ctx.textAlign = 'left'; ctx.fillStyle = faint; ctx.fillText('CLASSICAL', 40, H * 0.14); ctx.fillText('QUANTUM', 40, H * 0.92);

    var act = hover;
    if (act == null && t0 - lastIn >= 3) { cyc = Math.floor(t0 / 2.2) % EV.length; act = cyc; }

    for (var i = 0; i < EV.length; i++) {
      var e = EV[i], ex = X(e.y), up = e.lane === 'c', ey = up ? H * 0.40 : H * 0.60, on = act === i;
      ctx.strokeStyle = on ? (up ? col : col2) : rule; ctx.globalAlpha = on ? 0.8 : 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex, axisY); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = on ? (up ? col : col2) : faint; ctx.beginPath(); ctx.arc(ex, ey, on ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
      if (!on) { ctx.fillStyle = ink2; ctx.font = '8.5px ' + mono; ctx.textAlign = 'center';
        ctx.fillText(String(e.y), ex, up ? ey - 8 : ey + 14); }
    }
    // callout for active event
    if (act != null) {
      var e2 = EV[act], ex2 = X(e2.y), up2 = e2.lane === 'c';
      var bw = Math.min(240, W * 0.5), bh = 54, bx = Math.max(10, Math.min(W - bw - 10, ex2 - bw / 2));
      var by = up2 ? H * 0.40 - bh - 16 : H * 0.60 + 16;
      ctx.fillStyle = K.v('--panel'); ctx.strokeStyle = up2 ? col : col2; ctx.lineWidth = 1.4;
      rr(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = up2 ? col : col2; ctx.font = '600 12px ' + mono; ctx.textAlign = 'left';
      ctx.fillText(e2.y + '  ·  ' + e2.t, bx + 10, by + 18);
      ctx.fillStyle = ink2; ctx.font = '11px ' + sans; wrap(e2.d, bx + 10, by + 34, bw - 20, 14);
    }
  }
  function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wrap(text, x, y, mw, lh) { var words = text.split(' '), line = '', yy = y; for (var i = 0; i < words.length; i++) { var test = line + words[i] + ' '; if (ctx.measureText(test).width > mw && line) { ctx.fillText(line, x, yy); line = words[i] + ' '; yy += lh; } else line = test; } ctx.fillText(line, x, yy); }
  if (K.reduced) draw(0); else K.loop(function (ms) { draw(ms / 1000); });
};


  // ---- lazy mount ------------------------------------------------------------
  function mountAll() {
    var canvases = document.querySelectorAll('canvas[data-edu]');
    var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var st = entries[i].target.__edu; if (!st) continue;
        if (entries[i].isIntersecting) {
          if (!st.mounted) { st.mount(); st.mounted = true; } else { st.k._resume(); }
        } else if (st.mounted) { st.k._pause(); }
      }
    }, { rootMargin: '150px 0px' }) : null;

    for (var i = 0; i < canvases.length; i++) {
      (function (canvas) {
        var id = canvas.getAttribute('data-edu');
        var fn = EDU[id];
        var controls = canvas.parentElement.querySelector('.controls');
        var k = makeK(canvas);
        var st = { mounted: false, k: k, mount: function () { if (fn) { try { fn(canvas, controls, k); } catch (e) {} } } };
        canvas.__edu = st;
        if (io) io.observe(canvas); else { st.mount(); st.mounted = true; }
      })(canvases[i]);
    }
  }

  // ---- theme toggle (matches the overview page) ------------------------------
  function wireTheme() {
    var btn = document.getElementById('themeToggle'); if (!btn) return;
    var label = document.getElementById('themeLabel');
    function sync() { if (label) label.textContent = dark() ? 'Paper mode' : 'Luminous mode'; }
    btn.addEventListener('click', function () {
      var d = !dark();
      if (d) docEl.setAttribute('data-theme', 'dark'); else docEl.removeAttribute('data-theme');
      try { localStorage.setItem('qh-theme', d ? 'dark' : 'paper'); } catch (e) {}
      sync();
    });
    sync();
  }

  function boot() { wireTheme(); mountAll(); }
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
