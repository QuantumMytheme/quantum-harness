// railnav.js — a measured margin index for long pages. A thin ruler fixed to the right
// edge: one numbered tick per section, the current section's name shown as a small mono
// index-tab, a hairline spine, scroll-spy + click-to-jump. Auto-discovers sections (a hero
// + every <section id>), reads each label from data-rail / .eyebrow / heading. Dependency-
// free, CSP-safe, theme-aware (styles in style.css read the theme vars). Hidden on narrow
// viewports and when there are too few sections to be worth it.
(function () {
  'use strict';
  if (window.__railnav || document.querySelector('.railnav')) return;
  window.__railnav = true;

  function clean(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    s = s.split(/\s+[·|—–]\s+/)[0].trim();          // drop trailing qualifiers ("Scoreboard · the frontier")
    return s.length > 20 ? s.slice(0, 19).trim() + '…' : s;
  }
  function labelFor(el) {
    if (el.dataset && el.dataset.rail) return el.dataset.rail;
    var eb = el.querySelector && el.querySelector('.eyebrow');
    if (eb && eb.textContent.trim()) return clean(eb.textContent);
    var h = el.querySelector && el.querySelector('h1,h2,h3');
    return clean((h && h.textContent) || el.id || '');
  }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function build() {
    var targets = [];
    var hero = document.querySelector('header.hero');
    if (hero) { if (!hero.id) hero.id = 'top'; targets.push({ el: hero, label: hero.dataset.rail || 'Top' }); }
    Array.prototype.forEach.call(document.querySelectorAll('section[id]'), function (s) {
      targets.push({ el: s, label: labelFor(s) });
    });
    if (targets.length < 3) return;

    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var nav = document.createElement('nav');
    nav.className = 'railnav';
    nav.setAttribute('aria-label', 'Sections');
    targets.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rail-item';
      b.setAttribute('aria-label', 'Jump to ' + t.label);
      b.innerHTML = '<span class="rail-label"><span class="rail-num">' +
        (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>' + esc(t.label) +
        '</span><span class="rail-tick" aria-hidden="true"></span>';
      b.addEventListener('click', function () {
        t.el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      });
      t.btn = b;
      nav.appendChild(b);
    });
    document.body.appendChild(nav);

    var ticking = false;
    function spy() {
      var line = innerHeight * 0.32, active = 0;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].el.getBoundingClientRect().top <= line) active = i;
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = targets.length - 1; // bottom → last
      targets.forEach(function (t, i) {
        if (i === active) t.btn.setAttribute('aria-current', 'true');
        else t.btn.removeAttribute('aria-current');
      });
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; spy(); });
    }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    spy();
  }

  if (document.readyState !== 'loading') build();
  else addEventListener('DOMContentLoaded', build);
})();
