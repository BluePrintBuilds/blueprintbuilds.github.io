(function () {
  'use strict';

  var root = document.documentElement;
  if (root.dataset.bpMotionReady === 'true') return;
  root.dataset.bpMotionReady = 'true';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var traceSelectors = [
    '.feature-card',
    '.system-card',
    '.product-device',
    '.record-core',
    '.fragment-cloud',
    '.role-screen',
    '.security-stack > div',
    '.access-panel',
    '.story-moment',
    '.story-finale'
  ];
  var traceTargets = [];
  var seen = new Set();

  traceSelectors.forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (element) {
      if (seen.has(element)) return;
      seen.add(element);
      element.classList.add('bp-trace-card');
      var frame = document.createElement('span');
      frame.className = 'bp-trace-frame';
      frame.setAttribute('aria-hidden', 'true');
      element.appendChild(frame);
      traceTargets.push(element);
    });
  });

  var sectionDefs = [
    ['.product-reality', '01 // CURRENT PRODUCT'],
    ['.plan-desk', '02 // PLAN DESK'],
    ['.live-record', '03 // LIVE BUILD RECORD'],
    ['.client-clarity', '04 // CLIENT CLARITY'],
    ['.security', '05 // PRIVATE BY DESIGN']
  ];
  var measures = [];
  var sections = [];

  sectionDefs.forEach(function (definition) {
    var section = document.querySelector(definition[0]);
    if (!section) return;
    var shell = Array.from(section.children).find(function (child) { return child.classList && child.classList.contains('shell'); });
    if (!shell) return;

    var measure = document.createElement('div');
    measure.className = 'bp-section-measure';
    measure.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    label.textContent = definition[1];
    var line = document.createElement('i');
    var system = document.createElement('b');
    system.textContent = 'BLUEPRINT // MEASURED SYSTEM';
    measure.append(label, line, system);
    shell.insertBefore(measure, shell.firstChild);
    measures.push(measure);
    sections.push(section);
  });

  var chain = document.querySelector('.system-cards');
  if (chain) {
    chain.classList.add('bp-signal-chain');
    var runner = document.createElement('span');
    runner.className = 'bp-signal-runner';
    runner.setAttribute('aria-hidden', 'true');
    chain.appendChild(runner);
  }

  document.querySelectorAll('.status-live, .live-dot, .product-reality-rail i').forEach(function (element) {
    element.classList.add('bp-live-state');
  });

  function showElement(element) {
    element.classList.add('bp-motion-in');
    if (element.classList.contains('bp-section-measure')) element.classList.add('bp-motion-visible');
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    traceTargets.forEach(showElement);
    measures.forEach(showElement);
    if (chain) chain.classList.add('bp-motion-visible');
    sections.forEach(function (section) { section.classList.add('bp-section-active'); });
  } else {
    var itemObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        showElement(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: .16, rootMargin: '0px 0px -8% 0px' });

    traceTargets.forEach(function (element) { itemObserver.observe(element); });
    measures.forEach(function (element) { itemObserver.observe(element); });
  }

  if (!reduceMotion && 'IntersectionObserver' in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('bp-section-active', entry.isIntersecting);
      });
    }, { threshold: .12, rootMargin: '-12% 0px -44% 0px' });
    sections.forEach(function (section) { sectionObserver.observe(section); });

    if (chain) {
      var chainObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          chain.classList.toggle('bp-motion-visible', entry.isIntersecting);
        });
      }, { threshold: .12 });
      chainObserver.observe(chain);
    }
  }

  function syncVisibility() {
    root.classList.toggle('bp-page-hidden', document.hidden);
  }
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
