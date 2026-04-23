function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// Pull-to-refresh
(function () {
  const THRESHOLD = 80;
  let startY = 0;
  let pulling = false;
  let indicator = null;

  function getIndicator() {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ptr-indicator';
      document.body.prepend(indicator);
    }
    return indicator;
  }

  document.addEventListener('touchstart', e => {
    const screen = document.querySelector('.screen.active');
    if (!screen) return;
    if (screen.scrollTop === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { pulling = false; return; }
    const pct = Math.min(dy / THRESHOLD, 1);
    const ind = getIndicator();
    ind.style.opacity = pct;
    ind.style.transform = `translateY(${Math.min(dy * 0.4, 40)}px)`;
    ind.textContent = pct >= 1 ? '↑ Release to refresh' : '↓ Pull to refresh';
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!pulling) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - startY;
    const ind = getIndicator();
    ind.style.opacity = 0;
    ind.style.transform = '';
    if (dy >= THRESHOLD) location.reload();
  });
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
  Router.go('home');
});
