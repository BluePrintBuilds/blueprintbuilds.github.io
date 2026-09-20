/* Approved Blueprint welcome: one 2.4s decorative pass inside the hero.
 * Static artwork and working links are present before this script runs.
 * No fullscreen curtain, authentication, video load or returning-user delay. */
(() => {
  'use strict';
  const root = document.querySelector('[data-blueprint-arrival]');
  const artwork = root?.querySelector('[data-arrival-art]');
  if (!root || !artwork) return;
  root.dataset.state = 'finished';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!root.animate || motion.matches || navigator.connection?.saveData || document.hidden || location.hash || navigation?.type === 'back_forward') return;
  const key = 'blueprint-signature-welcome-v1';
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, 'seen'); } catch { return; }
  const skip = root.querySelector('[data-arrival-skip]');
  const animations = [], initialScroll = { x: scrollX, y: scrollY };
  let finished = false, expiry = null;
  const interaction = event => {
    if (event.target instanceof Element && event.target.closest('[data-arrival-skip]')) return;
    finish('interaction');
  };
  const scroll = () => { if (scrollX !== initialScroll.x || scrollY !== initialScroll.y) finish('scroll'); };
  const background = () => { if (document.hidden) finish('background'); };
  const preference = () => finish('motion-preference');
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin', 'resize', 'pagehide'];
  function finish(reason = 'complete') {
    if (finished) return;
    finished = true; clearTimeout(expiry);
    animations.forEach(animation => animation.cancel());
    root.classList.remove('is-active'); root.dataset.state = 'finished';
    root.dataset.finishReason = typeof reason === 'string' ? reason : 'interaction';
    if (skip) { skip.hidden = true; skip.removeEventListener('click', finish); }
    artwork.removeEventListener('load', start); artwork.removeEventListener('error', failedArt);
    events.forEach(event => window.removeEventListener(event, interaction, true));
    window.removeEventListener('scroll', scroll, true);
    document.removeEventListener('visibilitychange', background);
    motion.removeEventListener?.('change', preference);
    navigator.connection?.removeEventListener?.('change', dataSaver);
  }
  const failedArt = () => finish('image-error');
  const dataSaver = () => { if (navigator.connection?.saveData) finish('data-saver'); };
  function animate(element, frames, options) {
    if (!element) return;
    animations.push(element.animate(frames, { fill: 'both', easing: 'cubic-bezier(.2,.75,.25,1)', ...options }));
  }
  function start() {
    if (finished || motion.matches || document.hidden || !artwork.naturalWidth) return;
    clearTimeout(expiry); root.classList.add('is-active'); root.dataset.state = 'playing';
    if (skip) skip.hidden = false;
    try {
      root.querySelectorAll('[data-trace]').forEach((path, index) => animate(path,
        [{ strokeDasharray: '1', strokeDashoffset: '1', opacity: .15 }, { strokeDasharray: '1', strokeDashoffset: '0', opacity: .82 }],
        { duration: 1200, delay: index * 100 }));
      animate(root.querySelector('[data-mark-stage]'), [{ opacity: .68, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 1500, delay: 150 });
      animate(artwork, [{ opacity: .28, clipPath: 'inset(0 0 70% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0% 0)' }], { duration: 1450, delay: 230 });
      animate(root.querySelector('.bp-arrival-rule'), [{ opacity: .3, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)' }], { duration: 900, delay: 1080 });
      expiry = setTimeout(() => finish('complete'), 2400);
    } catch { finish('unsupported-motion'); }
  }
  events.forEach(event => window.addEventListener(event, interaction, { capture: true, passive: true }));
  window.addEventListener('scroll', scroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', background);
  motion.addEventListener?.('change', preference);
  navigator.connection?.addEventListener?.('change', dataSaver);
  skip?.addEventListener('click', finish);
  if (artwork.complete && artwork.naturalWidth) start();
  else {
    expiry = setTimeout(() => finish('image-deadline'), 350);
    artwork.addEventListener('load', start, { once: true });
    artwork.addEventListener('error', failedArt, { once: true });
  }
})();
