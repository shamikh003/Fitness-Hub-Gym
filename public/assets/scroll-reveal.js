/* Scroll reveals enhance the page without hiding content when JavaScript is unavailable. */
(() => {
  'use strict';
  const root = document.getElementById('viewPublic');
  if (!root || !('IntersectionObserver' in window) || !Element.prototype.animate) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet();
  const active = new Map();
  const selector = 'section[id] h2, section[id] h2 + p, .card-glow, .calc-panel, #admissionForm';
  const observer = new IntersectionObserver(entries => {
    const entering = entries.filter(entry => entry.isIntersecting);
    entering.forEach((entry, index) => {
      const element = entry.target;
      observer.unobserve(element);
      if (reducedMotion.matches) return;
      const phone = window.matchMedia('(max-width: 639px)').matches;
      const animation = element.animate([
        { opacity: 0, translate: phone ? '0 12px' : '0 26px' },
        { opacity: 1, translate: '0 0' }
      ], {
        duration: phone ? 400 : 650,
        delay: Math.min(index * (phone ? 35 : 65), phone ? 100 : 195),
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards'
      });
      active.set(element, animation);
      animation.finished.then(() => active.delete(element)).catch(() => active.delete(element));
    });
  }, { threshold: 0, rootMargin: '0px 0px -32px 0px' });

  function register(container) {
    const elements = [...container.querySelectorAll(selector)];
    if (container.matches?.(selector)) elements.unshift(container);
    elements.forEach(element => {
      if (seen.has(element)) return;
      seen.add(element);
      observer.observe(element);
    });
  }
  register(root);
  // Schedule filters replace cards; observe the new cards as well.
  const schedule = document.getElementById('scheduleGrid');
  if (schedule) new MutationObserver(() => {
    for (const [element, animation] of active) {
      if (!element.isConnected) { animation.cancel(); active.delete(element); }
    }
    register(schedule);
  }).observe(schedule, { childList: true });

  const trainers = document.querySelector('#trainers .grid');
  if (trainers) new MutationObserver(() => register(trainers)).observe(trainers, {childList:true});

  root.addEventListener('focusin', event => {
    for (const [element, animation] of active) {
      if (element.contains(event.target)) animation.finish();
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      for (const animation of active.values()) animation.finish();
      active.clear();
    }
  });
})();
