(function () {
  'use strict';
  var root = document.querySelector('[data-building-sequence]');
  if (!root) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var pause = root.querySelector('[data-building-pause]');
  var replay = root.querySelector('[data-building-replay]');
  var traces = Array.from(root.querySelectorAll('.building-trace'));
  var stages = ['setout', 'structure', 'roof', 'detail'];
  var animations = [];
  var visible = true;
  var pausedByUser = false;
  function sync() {
    animations.forEach(function (animation) {
      if (pausedByUser || !visible || document.hidden || reduce.matches) animation.pause();
      else animation.play();
    });
    pause.textContent = reduce.matches ? 'Motion off' : pausedByUser ? 'Resume drawing' : 'Pause drawing';
    pause.setAttribute('aria-pressed', String(pausedByUser || reduce.matches));
    pause.disabled = reduce.matches;
    replay.disabled = reduce.matches;
  }
  function compose() {
    animations.forEach(function (animation) { animation.cancel(); });
    animations = [];
    if (!reduce.matches) {
      traces.forEach(function (path, index) {
        if (!path.animate) return;
        var stage = stages.indexOf(path.parentNode.getAttribute('data-building-stage'));
        var start = .02 + stage * .11 + (index % 3) * .009;
        animations.push(path.animate([
          { strokeDashoffset: 1, opacity: 0, offset: 0 },
          { strokeDashoffset: 1, opacity: 0, offset: start },
          { strokeDashoffset: 0, opacity: 1, offset: start + .14 },
          { strokeDashoffset: 0, opacity: 1, offset: .80 },
          { strokeDashoffset: 0, opacity: 0, offset: 1 }
        ], { duration: 18000, iterations: Infinity, easing: 'ease-in-out' }));
      });
    }
    sync();
  }
  pause.hidden = false;
  replay.hidden = false;
  pause.addEventListener('click', function () { pausedByUser = !pausedByUser; sync(); });
  replay.addEventListener('click', function () {
    pausedByUser = false;
    animations.forEach(function (animation) { animation.currentTime = 0; });
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries.some(function (entry) { return entry.isIntersecting; });
      sync();
    }, { threshold: 0 }).observe(root);
  }
  if (reduce.addEventListener) reduce.addEventListener('change', compose);
  compose();
})();
