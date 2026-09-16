(function () {
  'use strict';

  var hero = document.querySelector('.hero');
  if (!hero) return;

  var root = hero.querySelector('[data-blueprint-pulse]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'blueprint-pulse-scene';
    root.setAttribute('data-blueprint-pulse', '');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = [
      '<canvas class="blueprint-pulse-canvas" data-blueprint-pulse-canvas></canvas>',
      '<svg class="blueprint-pulse-drawing" viewBox="0 0 1600 820" preserveAspectRatio="xMidYMid slice">',
      '<g class="blueprint-pulse-detail">',
      '<path class="blueprint-pulse-static" d="M92 668H1508M145 105V726M1450 98V716M242 160H1390"/>',
      '<g class="blueprint-pulse-sheetrefs"><circle cx="930" cy="67" r="10"/><text x="930" y="71">A</text><circle cx="1100" cy="67" r="10"/><text x="1100" y="71">B</text><circle cx="1270" cy="67" r="10"/><text x="1270" y="71">C</text><circle cx="1435" cy="67" r="10"/><text x="1435" y="71">D</text></g>',
      '<g class="blueprint-pulse-detailmark"><circle cx="1245" cy="188" r="13"/><text x="1245" y="192">1</text><path d="M1245 175V145H1302"/><text x="1310" y="149">S-301</text></g>',
      '<path class="blueprint-pulse-static blueprint-pulse-titleblock" d="M1288 650H1512V774H1288ZM1288 684H1512M1288 714H1512M1408 650V774M1460 714V774"/>',
      '<text class="blueprint-pulse-label blueprint-pulse-title" x="1302" y="672">ARENA / STABLE WORKS</text>',
      '<text class="blueprint-pulse-label" x="1302" y="704">A-204 // REV R3</text>',
      '<text class="blueprint-pulse-label" x="1420" y="704">CURRENT</text>',
      '<text class="blueprint-pulse-label" x="1302" y="738">ISSUED FOR CONSTRUCTION</text>',
      '<text class="blueprint-pulse-label blueprint-pulse-revision" x="1036" y="548">REV 3 // OUTLET SETOUT // FALL 1:100</text>',
      '<path class="blueprint-pulse-line is-secondary" data-blueprint-trace pathLength="1" d="M160 610L280 492L430 492L430 322L610 322L610 186L760 186"/>',
      '<path class="blueprint-pulse-line is-secondary" data-blueprint-trace pathLength="1" d="M925 138H1436V538H925Z"/>',
      '<path class="blueprint-pulse-line" data-blueprint-trace pathLength="1" d="M972 188H1382V482H972Z"/>',
      '<path class="blueprint-pulse-line is-secondary" data-blueprint-trace pathLength="1" d="M972 292H1382M1108 188V482M1245 188V482"/>',
      '<path class="blueprint-pulse-line is-highlight" data-blueprint-trace pathLength="1" d="M1038 390H1324M1181 247V455"/>',
      '<path class="blueprint-pulse-line is-drainage" data-blueprint-trace pathLength="1" d="M814 612H914V586H1068V558H1240V578H1388"/>',
      '<path class="blueprint-pulse-static is-drainage-ticks" d="M894 606V618M1048 580V592M1220 552V564M1368 572V584"/>',
      '<path class="blueprint-pulse-line" data-blueprint-trace pathLength="1" d="M275 568V434L388 370L503 434V568M315 568V472H462V568"/>',
      '<path class="blueprint-pulse-line is-secondary" data-blueprint-trace pathLength="1" d="M245 582H535M245 594H535M305 594V628M475 594V628"/>',
      '<path class="blueprint-pulse-line is-secondary" data-blueprint-trace pathLength="1" d="M930 112V84M1435 112V84M930 94H1435M902 138H876M902 538H876M886 138V538"/>',
      '<path class="blueprint-pulse-line is-highlight" data-blueprint-trace pathLength="1" d="M648 166L774 166L816 208M648 166L690 124"/>',
      '<text class="blueprint-pulse-label" x="948" y="76">24 000 // ARENA ENVELOPE</text>',
      '<text class="blueprint-pulse-label" x="856" y="350" transform="rotate(-90 856 350)">12 500 // FIELD GRID</text>',
      '<text class="blueprint-pulse-label" x="820" y="644">DRAINAGE RUN // VERIFIED ALIGNMENT</text>',
      '</g>',
      '<path class="blueprint-pulse-line is-secondary blueprint-pulse-core" data-blueprint-trace pathLength="1" d="M48 706H520V610H690V458H842"/>',
      '<path class="blueprint-pulse-line is-highlight blueprint-pulse-core" data-blueprint-trace pathLength="1" d="M742 150H1452V566H1368"/>',
      '<path class="blueprint-pulse-line is-secondary blueprint-pulse-core" data-blueprint-trace pathLength="1" d="M94 286L252 198L410 286M252 198V120"/>',
      '<g class="blueprint-pulse-node is-live"><circle cx="760" cy="186" r="3"/><circle cx="760" cy="186" r="12"/></g>',
      '<g class="blueprint-pulse-node is-live"><circle cx="972" cy="188" r="3"/><circle cx="972" cy="188" r="13"/></g>',
      '<g class="blueprint-pulse-node is-live"><circle cx="1324" cy="390" r="3"/><circle cx="1324" cy="390" r="14"/></g>',
      '<g class="blueprint-pulse-node is-live"><circle cx="1068" cy="558" r="3"/><circle cx="1068" cy="558" r="12"/></g>',
      '<g class="blueprint-pulse-node is-live"><circle cx="388" cy="370" r="3"/><circle cx="388" cy="370" r="12"/></g>',
      '</svg>'
    ].join('');
    hero.insertBefore(root, hero.firstChild);
  }

  var canvas = root.querySelector('[data-blueprint-pulse-canvas]');
  var context = canvas && canvas.getContext ? canvas.getContext('2d', { alpha: true }) : null;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var traceLines = Array.from(root.querySelectorAll('[data-blueprint-trace]'));
  var nodes = [];
  var width = 0;
  var height = 0;
  var ratio = 1;
  var frameId = 0;
  var active = true;
  var startedAt = performance.now();
  var pointer = { x: .68, y: .32, active: false };

  function seeded(index, salt) {
    var value = Math.sin((index + 1) * 91.733 + salt * 13.17) * 43758.5453;
    return value - Math.floor(value);
  }

  function createNodes() {
    var surveyPoints = [
      [.10,.18],[.24,.18],[.38,.18],[.54,.18],[.70,.18],[.86,.18],
      [.16,.34],[.34,.34],[.54,.34],[.72,.34],[.88,.34],
      [.10,.53],[.28,.53],[.46,.53],[.64,.53],[.82,.53],
      [.22,.70],[.42,.70],[.62,.70],[.84,.70]
    ];
    var count = width < 640 ? 8 : width < 980 ? 12 : surveyPoints.length;
    nodes = surveyPoints.slice(0, count).map(function (point, index) {
      return {
        x: point[0], y: point[1],
        phase: seeded(index, 3) * Math.PI * 2,
        speed: .12 + seeded(index, 4) * .08,
        size: .65 + seeded(index, 5) * .7
      };
    });
  }

  function resizeCanvas() {
    if (!canvas || !context) return;
    var rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    createNodes();
    if (reduceMotion) draw(performance.now(), true);
  }

  function pointAt(node, time) {
    var driftX = Math.sin(time * node.speed + node.phase) * .75;
    var driftY = Math.cos(time * node.speed * .82 + node.phase) * .6;
    var pullX = 0;
    var pullY = 0;
    if (pointer.active) {
      var baseX = node.x * width;
      var baseY = node.y * height;
      var dx = pointer.x * width - baseX;
      var dy = pointer.y * height - baseY;
      var distance = Math.sqrt(dx * dx + dy * dy) || 1;
      var force = Math.max(0, 1 - distance / 240) * .8;
      pullX = dx / distance * force;
      pullY = dy / distance * force;
    }
    return { x: node.x * width + driftX + pullX, y: node.y * height + driftY + pullY };
  }

  function draw(now, singleFrame) {
    if (!context || !width || !height) return;
    var time = (now - startedAt) / 1000;
    context.clearRect(0, 0, width, height);
    var points = nodes.map(function (node) { return pointAt(node, time); });

    for (var i = 0; i < points.length; i += 1) {
      for (var j = i + 1; j < points.length; j += 1) {
        var dx = Math.abs(points[i].x - points[j].x);
        var dy = Math.abs(points[i].y - points[j].y);
        var sameDatum = dy < 4 && dx < width * .22;
        var sameGridLine = dx < 4 && dy < height * .22;
        if (!sameDatum && !sameGridLine) continue;
        context.strokeStyle = 'rgba(53,167,255,.075)';
        context.lineWidth = .65;
        context.beginPath();
        context.moveTo(points[i].x, points[i].y);
        context.lineTo(points[j].x, points[j].y);
        context.stroke();
      }
    }

    points.forEach(function (point, index) {
      var node = nodes[index];
      var tick = 3 + node.size;
      context.strokeStyle = 'rgba(111,137,165,.19)';
      context.lineWidth = .6;
      context.beginPath();
      context.moveTo(point.x - tick, point.y); context.lineTo(point.x + tick, point.y);
      context.moveTo(point.x, point.y - tick); context.lineTo(point.x, point.y + tick);
      context.stroke();
      context.fillStyle = 'rgba(53,167,255,.38)';
      context.fillRect(point.x - .8, point.y - .8, 1.6, 1.6);
    });

    if (!singleFrame && active && !document.hidden) frameId = requestAnimationFrame(draw);
  }

  function animateTraces() {
    traceLines.forEach(function (line, index) {
      if (reduceMotion || !line.animate) {
        line.style.strokeDashoffset = '0';
        return;
      }
      // Trace in a drawing-like order: dimensions / envelope / internal detail /
      // field markup / services. The page feels authored rather than randomly alive.
      var phases = [3, 0, 1, 2, 3, 5, 2, 1, 0, 4, 4, 0, 1, 2, 5, 3];
      var phase = phases[index % phases.length];
      var targetOpacity = line.classList.contains('is-highlight') ? .58 : line.classList.contains('is-secondary') ? .24 : .38;
      line.animate([
        { strokeDashoffset: 1, opacity: 0, offset: 0 },
        { strokeDashoffset: 1, opacity: 0, offset: .055 },
        { strokeDashoffset: 0, opacity: targetOpacity, offset: .22 },
        { strokeDashoffset: 0, opacity: targetOpacity, offset: .64 },
        { strokeDashoffset: 0, opacity: .075, offset: .84 },
        { strokeDashoffset: 0, opacity: 0, offset: 1 }
      ], {
        duration: 14800,
        delay: 320 + phase * 760 + (index % 3) * 115,
        iterations: Infinity,
        easing: 'cubic-bezier(.42,0,.18,1)'
      });
    });
  }

  function startCanvas() {
    if (!context || reduceMotion || frameId || !active || document.hidden) return;
    frameId = requestAnimationFrame(draw);
  }

  function stopCanvas() {
    if (!frameId) return;
    cancelAnimationFrame(frameId);
    frameId = 0;
  }

  if (finePointer && hero && !reduceMotion) {
    hero.addEventListener('pointermove', function (event) {
      var rect = hero.getBoundingClientRect();
      pointer.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      pointer.y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      pointer.active = true;
    });
    hero.addEventListener('pointerleave', function () { pointer.active = false; });
  }

  if ('IntersectionObserver' in window && hero) {
    new IntersectionObserver(function (entries) {
      active = entries[0] ? entries[0].isIntersecting : true;
      if (active) startCanvas(); else stopCanvas();
    }, { rootMargin: '160px 0px', threshold: 0 }).observe(hero);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopCanvas(); else startCanvas();
  });

  if ('ResizeObserver' in window) {
    new ResizeObserver(resizeCanvas).observe(root);
  } else {
    window.addEventListener('resize', resizeCanvas, { passive: true });
  }

  animateTraces();
  resizeCanvas();
  if (!reduceMotion) startCanvas();
})();
