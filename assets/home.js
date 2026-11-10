(function () {
  'use strict';

  var roleTabs = Array.from(document.querySelectorAll('[data-role-tab]'));
  roleTabs.forEach(function (tab) {
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
    tab.addEventListener('click', function () {
      roleTabs.forEach(function (candidate) {
        candidate.setAttribute('aria-selected', candidate === tab ? 'true' : 'false');
      });
    });
  });

  var frame = document.querySelector('.command-frame');
  if (frame && !frame.classList.contains('building-frame') && window.matchMedia('(pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    frame.addEventListener('pointermove', function (event) {
      var rect = frame.getBoundingClientRect();
      frame.style.setProperty('--pointer-x', (((event.clientX - rect.left) / rect.width) * 100).toFixed(1) + '%');
      frame.style.setProperty('--pointer-y', (((event.clientY - rect.top) / rect.height) * 100).toFixed(1) + '%');
    });
  }
})();
