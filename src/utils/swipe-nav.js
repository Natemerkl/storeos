const EDGE_ZONE = 32;
const SWIPE_THRESHOLD = 80;
const SWIPE_MAX_Y = 60;
const MIN_VELOCITY = 0.3;

const historyStack = [];
let historyIndex = -1;

let touching = false;
let gesture = null;
let startX = 0;
let startY = 0;
let startTime = 0;
let currentX = 0;
let animFrame = null;

let glowEl = null;
let indicatorEl = null;
let getContentEl = null;
let onNavigate = null;

export function pushRoute(path) {
  historyStack.length = historyIndex + 1;
  historyStack.push(path);
  historyIndex = historyStack.length - 1;
}

export function canGoBack() {
  return historyIndex > 0;
}

export function canGoForward() {
  return historyIndex < historyStack.length - 1;
}

export function getPrevPath() {
  return historyStack[historyIndex - 1];
}

export function getNextPath() {
  return historyStack[historyIndex + 1];
}

function setupGlowForGesture(dir) {
  if (dir === 'back') {
    glowEl.style.left = '0';
    glowEl.style.right = 'auto';
    glowEl.style.background = 'linear-gradient(to right, rgba(13,148,136,0.25), transparent)';
    indicatorEl.innerHTML = '←';
    indicatorEl.style.left = '12px';
    indicatorEl.style.right = 'auto';
  } else {
    glowEl.style.right = '0';
    glowEl.style.left = 'auto';
    glowEl.style.background = 'linear-gradient(to left, rgba(13,148,136,0.25), transparent)';
    indicatorEl.innerHTML = '→';
    indicatorEl.style.right = '12px';
    indicatorEl.style.left = 'auto';
  }
  glowEl.style.opacity = '1';
}

function updateGlowProgress(progress, dir) {
  glowEl.style.width = (8 + progress * 48) + 'px';
}

function updateIndicator(progress, dir, dragX) {
  const scale = 0.6 + progress * 0.5;
  indicatorEl.style.opacity = Math.min(progress * 2, 1);
  indicatorEl.style.transform = `translateY(-50%) scale(${scale})`;
  const offset = Math.min(Math.abs(dragX) * 0.4, 48);
  if (dir === 'back') {
    indicatorEl.style.left = (12 + offset) + 'px';
  } else {
    indicatorEl.style.right = (12 + offset) + 'px';
  }
}

function cancelGesture() {
  touching = false;
  gesture = null;
  const contentEl = getContentEl();
  if (contentEl) {
    contentEl.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    contentEl.style.transform = 'translateX(0)';
    contentEl.style.opacity = '1';
  }
  cleanupGesture();
}

function cleanupGesture() {
  touching = false;
  gesture = null;
  glowEl.style.opacity = '0';
  glowEl.style.width = '0';
  indicatorEl.style.opacity = '0';
  indicatorEl.style.transform = 'translateY(-50%) scale(0.6)';
  setTimeout(() => {
    const contentEl = getContentEl();
    if (contentEl) contentEl.style.willChange = '';
  }, 350);
}

function hasHorizontalScroll(el) {
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth) {
      return true;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function onTouchStart(e) {
  const touch = e.touches[0];
  startX = touch.clientX;
  startY = touch.clientY;
  startTime = Date.now();
  currentX = startX;

  if (hasHorizontalScroll(e.target)) {
    gesture = null;
    touching = false;
    return;
  }

  if (startX <= EDGE_ZONE && canGoBack()) {
    gesture = 'back';
    touching = true;
    setupGlowForGesture('back');
  } else if (startX >= window.innerWidth - EDGE_ZONE && canGoForward()) {
    gesture = 'forward';
    touching = true;
    setupGlowForGesture('forward');
  } else {
    gesture = null;
    touching = false;
  }
}

function onTouchMove(e) {
  if (!touching || !gesture) return;

  const touch = e.touches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  currentX = touch.clientX;

  if (Math.abs(dy) > SWIPE_MAX_Y) {
    cancelGesture();
    return;
  }

  e.preventDefault();

  const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
  const dragX = gesture === 'back' ? Math.max(dx, 0) : Math.min(dx, 0);

  const contentEl = getContentEl();
  if (contentEl) {
    contentEl.style.transform = `translateX(${dragX}px)`;
    contentEl.style.transition = 'none';
    contentEl.style.willChange = 'transform';
  }

  updateGlowProgress(progress, gesture);
  updateIndicator(progress, gesture, dragX);
}

function onTouchEnd(e) {
  if (!touching || !gesture) return;

  const dx = currentX - startX;
  const elapsed = Date.now() - startTime;
  const velocity = Math.abs(dx) / elapsed;
  const distance = Math.abs(dx);

  const shouldNavigate = distance >= SWIPE_THRESHOLD || velocity >= MIN_VELOCITY;
  const contentEl = getContentEl();

  if (shouldNavigate) {
    const exitX = gesture === 'back' ? window.innerWidth : -window.innerWidth;
    if (contentEl) {
      contentEl.style.transition = 'transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)';
      contentEl.style.transform = `translateX(${exitX * 0.4}px)`;
      contentEl.style.opacity = '0.5';
    }

    setTimeout(() => {
      cleanupGesture();
      onNavigate(gesture);

      setTimeout(() => {
        const newEl = getContentEl();
        if (newEl) {
          newEl.style.transform = gesture === 'back' ? 'translateX(-30px)' : 'translateX(30px)';
          newEl.style.opacity = '0';
          newEl.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s';
          requestAnimationFrame(() => {
            newEl.style.transform = 'translateX(0)';
            newEl.style.opacity = '1';
          });
        }
      }, 50);
    }, 180);
  } else {
    if (contentEl) {
      contentEl.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s';
      contentEl.style.transform = 'translateX(0)';
      contentEl.style.opacity = '1';
    }
    cleanupGesture();
  }
}

export function initSwipeNav(getContentElFn, onNavigateFn) {
  if (window.innerWidth > 768) return;
  if (!('ontouchstart' in window)) return;

  getContentEl = getContentElFn;
  onNavigate = onNavigateFn;

  glowEl = document.createElement('div');
  glowEl.id = 'swipe-glow';
  glowEl.style.cssText = `
    position: fixed;
    top: 0;
    bottom: 0;
    width: 0;
    z-index: 1000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
  `;
  document.body.appendChild(glowEl);

  indicatorEl = document.createElement('div');
  indicatorEl.id = 'swipe-indicator';
  indicatorEl.style.cssText = `
    position: fixed;
    top: 50%;
    transform: translateY(-50%) scale(0.6);
    z-index: 1001;
    pointer-events: none;
    opacity: 0;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(13,148,136,0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(13,148,136,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s, transform 0.15s;
    font-size: 16px;
    color: #0D9488;
  `;
  indicatorEl.innerHTML = '←';
  document.body.appendChild(indicatorEl);

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
}
