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
