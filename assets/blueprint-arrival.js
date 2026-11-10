/* Blueprint welcome: an optional 2.4s decorative pass inside the hero.
 * Static artwork and working links remain available throughout.
 * Returning visitors can replay it without a fullscreen curtain or video. */
(() => {
  'use strict';
  const root = document.querySelector('[data-blueprint-arrival]');
  const artwork = root?.querySelector('[data-arrival-art]');
  const skip = root?.querySelector('[data-arrival-skip]');
  const replay = root?.querySelector('[data-arrival-replay]');
  if (!root || !artwork) return;
  root.dataset.state = 'finished';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin', 'resize', 'pagehide'];
  let finished = true, expiry = null, initialScroll = { x: scrollX, y: scrollY };
  let animations = [], replayHadFocus = false;
  const canAnimate = () => !!root.animate && !motion.matches && !navigator.connection?.saveData;
  const showReplay = () => {
    if (!replay) return;
    const hide = !canAnimate() || !finished || (artwork.complete && !artwork.naturalWidth);
    if (hide && document.activeElement === replay) {
      document.querySelector('.hero-actions a')?.focus({ preventScroll: true });
    }
    replay.hidden = hide;
  };
  const interaction = event => {
    if (event.target instanceof Element && event.target.closest('[data-arrival-skip], [data-arrival-replay]')) return;
    finish('interaction');
  };
  const scroll = () => { if (scrollX !== initialScroll.x || scrollY !== initialScroll.y) finish('scroll'); };
  const background = () => { if (document.hidden) finish('background'); };
  const preference = () => {
    if (motion.matches) finish('motion-preference');
    showReplay();
  };
  const dataSaver = () => {
    if (navigator.connection?.saveData) finish('data-saver');
    showReplay();
  };
  const failedArt = () => finish('image-error');
  function finish(reason = 'complete') {
    if (finished) return;
    const active = document.activeElement;
    const focusWasLostDuringReplay = replayHadFocus && (active === document.body || active === document.documentElement);
    const restoreReplayFocus = active === skip || active === replay || focusWasLostDuringReplay;
    finished = true; clearTimeout(expiry);
    animations.forEach(animation => animation.cancel()); animations = [];
    root.classList.remove('is-active'); root.dataset.state = 'finished';
    root.dataset.finishReason = typeof reason === 'string' ? reason : 'interaction';
    if (skip) skip.hidden = true;
    artwork.removeEventListener('load', start); artwork.removeEventListener('error', failedArt);
    events.forEach(event => window.removeEventListener(event, interaction, true));
    window.removeEventListener('scroll', scroll, true);
    document.removeEventListener('visibilitychange', background);
    showReplay();
    if (restoreReplayFocus) {
      const target = replay && !replay.hidden ? replay : document.querySelector('.hero-actions a');
      target?.focus({ preventScroll: true });
    }
    replayHadFocus = false;
  }
  function animate(element, frames, options) {
    if (!element) return;
    animations.push(element.animate(frames, { fill: 'both', easing: 'cubic-bezier(.2,.75,.25,1)', ...options }));
  }
  function start() {
    if (finished) return;
    if (!canAnimate() || document.hidden || !artwork.naturalWidth) { finish('unavailable'); return; }
    clearTimeout(expiry); root.classList.add('is-active'); root.dataset.state = 'playing';
    if (skip) {
      skip.hidden = false;
      if (replayHadFocus) skip.focus({ preventScroll: true });
    }
    try {
      root.querySelectorAll('[data-trace]').forEach((path, index) => animate(path,
        [{ strokeDasharray: '1', strokeDashoffset: '1', opacity: .15 }, { strokeDasharray: '1', strokeDashoffset: '0', opacity: .82 }],
        { duration: 1200, delay: index * 100 }));
      animate(root.querySelector('.bpb-plan-ghost'), [{ opacity: .12 }, { opacity: .57 }], { duration: 1750, delay: 100 });
      animate(root.querySelector('.bpb-plan-detail'), [{ opacity: .08 }, { opacity: .62 }], { duration: 1500, delay: 350 });
      animate(root.querySelector('.bpb-plan-node'), [{ opacity: .12 }, { opacity: 1 }], { duration: 900, delay: 1100 });
      const stage = root.querySelector('[data-mark-stage]');
      animate(stage, [{ opacity: .62, transform: 'translateY(7px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 1500, delay: 150 });
      const revealTiming = { duration: 1650, delay: 230, easing: 'cubic-bezier(.42,0,.58,1)' };
      animate(artwork, [{ opacity: .24, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0% 0)' }], revealTiming);
      const scan = root.querySelector('[data-arrival-scan]');
      if (stage && scan) {
        const frame = stage.getBoundingClientRect(), image = artwork.getBoundingClientRect();
        const from = image.top - frame.top, to = from + image.height;
        animate(scan, [
          { opacity: 0, transform: `translateY(${from}px)` },
          { opacity: .78, offset: .16 },
          { opacity: .66, offset: .82 },
          { opacity: 0, transform: `translateY(${to}px)` }
        ], revealTiming);
      }
      animate(root.querySelector('.bp-arrival-rule'), [{ opacity: .3, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)' }], { duration: 900, delay: 1080 });
      expiry = setTimeout(() => finish('complete'), 2400);
    } catch { finish('unsupported-motion'); }
  }
  function begin() {
    if (!finished || !canAnimate() || document.hidden) return;
    finished = false;
    replayHadFocus = document.activeElement === replay;
    if (replay) replay.hidden = true;
    initialScroll = { x: scrollX, y: scrollY };
    events.forEach(event => window.addEventListener(event, interaction, { capture: true, passive: true }));
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', background);
    if (artwork.complete && artwork.naturalWidth) start();
    else {
      expiry = setTimeout(() => finish('image-deadline'), 350);
      artwork.addEventListener('load', start, { once: true });
      artwork.addEventListener('error', failedArt, { once: true });
    }
  }
  artwork.addEventListener('load', showReplay);
  artwork.addEventListener('error', showReplay);
  replay?.addEventListener('click', begin);
  skip?.addEventListener('click', () => finish('skip'));
  motion.addEventListener?.('change', preference);
  navigator.connection?.addEventListener?.('change', dataSaver);
  showReplay();
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!canAnimate() || document.hidden || location.hash || navigation?.type === 'back_forward') return;
  const key = 'blueprint-signature-welcome-v1';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, 'seen');
  } catch { return; }
  begin();
})();
