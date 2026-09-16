/* Original Blueprint artwork, slowly resolving on a drawing sheet.
 * Decorative, skippable, once per tab session. No biometric/verification claim. */
(() => {
  'use strict';
  const root = document.querySelector('[data-blueprint-arrival]');
  const artwork = root?.querySelector('[data-arrival-art]');
  if (!root || !artwork || !root.animate) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (motion.matches || navigator.connection?.saveData || document.hidden
      || location.hash || navigation?.type === 'back_forward') return;
  const key = 'blueprint-arrival-seen-v2';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { return; }
  const initialScroll = { x: scrollX, y: scrollY };
  const onScroll = () => { if (scrollX !== initialScroll.x || scrollY !== initialScroll.y) finish(); };
  const onInteraction = event => {
    if (event.target instanceof Element && event.target.closest('[data-arrival-skip]')
        && (event.type === 'pointerdown' || (event.type === 'keydown' && ['Enter', ' '].includes(event.key)))) return;
    finish();
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'resize', 'pagehide'];
  const image = new Image();
  const animations = [];
  let finished = false;
  let expiry;
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(expiry);
    animations.forEach(animation => animation.cancel());
    root.classList.remove('is-active');
    root.dataset.state = 'finished';
    image.onload = image.onerror = null;
    events.forEach(event => window.removeEventListener(event, onInteraction, true));
    window.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('visibilitychange', finish);
    motion.removeEventListener('change', finish);
    root.querySelector('[data-arrival-skip]').removeEventListener('click', finish);
  }
  function animate(element, frames) {
    const animation = element.animate(frames, { duration: 4800, easing: 'linear', fill: 'both' });
    animations.push(animation);
    return animation;
  }
  async function start() {
    try { await image.decode(); } catch { finish(); return; }
    if (finished || motion.matches || document.hidden) return;
    clearTimeout(expiry);
    artwork.style.backgroundImage = 'url("' + image.src + '")';
    root.classList.add('is-active');
    root.dataset.state = 'playing';
    // Registration first, ink gathering slowly, a quiet hold, then a dissolve.
    animate(root.querySelector('.bp-arrival-rule'), [
      { transform: 'scaleX(.04)', opacity: 0, offset: 0 },
      { transform: 'scaleX(1)', opacity: 1, offset: .28 },
      { transform: 'scaleX(1)', opacity: 1, offset: 1 },
    ]);
    animate(artwork, [
      { opacity: 0, offset: 0 }, { opacity: .03, offset: .12 },
      { opacity: .2, offset: .32 }, { opacity: 1, offset: .58 },
      { opacity: 1, offset: 1 },
    ]);
    animate(root.querySelector('.bp-arrival-copy'), [
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .24 },
      { opacity: 1, offset: .6 }, { opacity: 1, offset: 1 },
    ]);
    const curtain = animate(root, [
      { opacity: 0, offset: 0 }, { opacity: 1, offset: .07 },
      { opacity: 1, offset: .79 }, { opacity: 0, offset: 1 },
    ]);
    curtain.finished.then(finish, finish);
    expiry = setTimeout(finish, 5200);
  }
  events.forEach(event => window.addEventListener(event, onInteraction, { capture: true, passive: true }));
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', finish);
  motion.addEventListener('change', finish);
  root.querySelector('[data-arrival-skip]').addEventListener('click', finish);
  // Optional art is requested only after preference/session checks. It never
  // delays the document and a slow image never produces a late interruption.
  expiry = setTimeout(finish, 450);
  image.decoding = 'async';
  image.onload = start;
  image.onerror = finish;
  image.src = '/assets/blueprint-identity-master.webp';
})();
