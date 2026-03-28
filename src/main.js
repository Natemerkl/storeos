// ── Suppress Supabase lock noise ──────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || ''
  if (msg.includes('Lock broken') || msg.includes('lock')) {
    e.preventDefault()
  }
})

import './styles/main.css'
import './styles/mobile.css'
import { initRouter, navigate } from './router.js'
import { supabase } from './supabase.js'
import { appStore } from './store.js'
import { renderNav } from './components/nav.js'
import { initMobileNav } from './components/mobile-nav.js'
import { initTableEnhancer } from './utils/mobile-tables.js'
import { initSwipeNav, pushRoute, canGoBack, canGoForward, getPrevPath, getNextPath } from './utils/swipe-nav.js'

const app = document.getElementById('app')
let navEl         = null
let contentEl     = null
let isInitialized = false  // prevents double-init from onAuthStateChange
let isSwipeNavigation = false

// ── Loading screen ─────────────────────────────────────────
function showLoadingScreen() {
  app.innerHTML = `
    <div style="
      position:fixed;inset:0;
      display:flex;align-items:center;justify-content:center;
      flex-direction:column;gap:1rem;
      background:#FAFAFA;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;
    ">
      <div style="
        width:48px;height:48px;background:#0D9488;border-radius:14px;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 8px 24px rgba(13,148,136,0.3);
        animation:lp 1.8s ease-in-out infinite;
      ">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/>
          <path d="M2 7h20"/>
        </svg>
      </div>
      <div style="font-size:1.25rem;font-weight:700;color:#111827;letter-spacing:-0.3px">
        Store<span style="color:#0D9488">OS</span>
      </div>
      <div style="font-size:0.8125rem;color:#9CA3AF">Loading...</div>
      <style>
        @keyframes lp {
          0%,100%{transform:scale(1);box-shadow:0 8px 24px rgba(13,148,136,0.3);}
          50%{transform:scale(1.06);box-shadow:0 12px 32px rgba(13,148,136,0.45);}
        }
      </style>
    </div>
  `
}

// ── Mobile nav ─────────────────────────────────────────────
function hideMobileNav() {
  const nav = document.getElementById('mobile-nav')
  if (nav) nav.classList.add('modal-hidden')
}

function showMobileNav() {
  if (window.innerWidth > 768) return
  const nav = document.getElementById('mobile-nav')
  if (nav) nav.classList.remove('modal-hidden')
}

// ── Build full-screen layout (auth/onboarding) ─────────────
function buildFullScreen() {
  app.innerHTML = ''
  navEl   = null
  contentEl = document.createElement('div')
  contentEl.style.cssText = 'width:100%;min-height:100vh'
  app.appendChild(contentEl)
  hideMobileNav()
}

// ── Build app layout (authenticated pages) ─────────────────
export function buildLayout() {
  // Already built — just re-render nav
  if (document.querySelector('.sidebar') && document.querySelector('.main-content')) {
    if (navEl) renderNav(navEl)
    return
  }

  app.innerHTML = ''

  navEl = document.createElement('aside')
  renderNav(navEl)
  app.appendChild(navEl)

  contentEl = document.createElement('main')
  contentEl.className = 'main-content'
  app.appendChild(contentEl)

  if (!document.getElementById('mobile-nav')) {
    initMobileNav()
  }

  if (!window._tblEnhanced) {
    window._tblEnhanced = true
    initTableEnhancer()
  }

  initSwipeNav(
    () => document.querySelector('.main-content'),
    (direction) => {
      isSwipeNavigation = true
      if (direction === 'back'    && canGoBack())    navigate(getPrevPath())
      if (direction === 'forward' && canGoForward()) navigate(getNextPath())
      setTimeout(() => { isSwipeNavigation = false }, 300)
    }
  )
}

// ── Load a page ────────────────────────────────────────────
export async function loadPage(pageName) {
  const isFullScreen = ['auth', 'onboarding'].includes(pageName)

  if (isFullScreen) {
    buildFullScreen()
  } else {
    if (!document.querySelector('.sidebar')) buildLayout()
    showMobileNav()
    if (contentEl && document.body.contains(contentEl)) {
      contentEl.innerHTML = ''
    } else {
      buildLayout()
    }
  }

  try {
    const mod = await import(`./pages/${pageName}.js`)
    // Verify container still valid before rendering
    if (contentEl && document.body.contains(contentEl)) {
      mod.render(contentEl)

      if (!isSwipeNavigation) {
        contentEl.style.opacity   = '0'
        contentEl.style.transform = 'translateY(6px)'
        contentEl.style.transition = 'opacity 0.2s, transform 0.2s'
        requestAnimationFrame(() => {
          contentEl.style.opacity   = '1'
          contentEl.style.transform = 'translateY(0)'
          setTimeout(() => {
            if (contentEl && document.body.contains(contentEl)) {
              contentEl.style.transform = ''
              contentEl.style.transition = ''
            }
          }, 220)
        })
      }
    }
  } catch(err) {
    console.error('loadPage error:', pageName, err)
    // Retry once on chunk error
    const key = `retry-${pageName}`
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.reload()
    } else {
      sessionStorage.removeItem(key)
      if (contentEl && document.body.contains(contentEl)) {
        contentEl.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;
            justify-content:center;min-height:60vh;gap:1rem;padding:2rem;text-align:center">
            <div style="font-size:1.5rem">⚠️</div>
            <div style="font-weight:600;font-size:1rem">Failed to load page</div>
            <button onclick="location.reload()" style="
              padding:0.5rem 1.25rem;border-radius:8px;background:#0D9488;
              color:#fff;border:none;font-weight:600;cursor:pointer">
              Reload
            </button>
          </div>`
      }
    }
    return
  }

  // Update sidebar active state
  if (navEl && document.body.contains(navEl)) {
    navEl.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === window.location.pathname)
    })
  }
}

// ── Go to authenticated app ────────────────────────────────
async function goToApp(user) {
  try {
    const { data: owner } = await supabase
      .from('owners')
      .select('*')
      .eq('email', user.email)
      .maybeSingle()

    if (!owner) {
      buildFullScreen()
      initRouter()
      navigate('/onboarding')
      return
    }

    const { data: stores } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', owner.id)

    if (!stores?.length) {
      buildFullScreen()
      initRouter()
      navigate('/onboarding')
      return
    }

    appStore.getState().setStores(stores)
    appStore.getState().setCurrentStore(stores[0])

    buildLayout()
    showMobileNav()

    // Fix URL if stuck on /auth or /
    const path = window.location.pathname
    if (path === '/auth' || path === '/') {
      window.history.replaceState({}, '', '/dashboard')
    }

    initRouter()

  } catch(err) {
    console.error('goToApp error:', err)
    buildFullScreen()
    initRouter()
    navigate('/auth')
  }
}

// ── Go to auth page ────────────────────────────────────────
function goToAuth() {
  buildFullScreen()
  initRouter()
  navigate('/auth')
}

// ── Service Worker Registration ───────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration.scope);
        })
        .catch((error) => {
          console.log('SW registration failed:', error);
        });
    });
  }
}

// ── Main init — runs once on page load ─────────────────────
async function init() {
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  showLoadingScreen()

  // Race session check against 3s timeout
  let session = null
  try {
    const timeout = new Promise(r => setTimeout(() => r(null), 3000))
    const result  = await Promise.race([
      supabase.auth.getSession().then(r => r.data?.session),
      timeout
    ])
    session = result || null
  } catch(e) {
    console.warn('Session check failed:', e.message)
    session = null
  }

  isInitialized = true

  if (!session) {
    goToAuth()
    return
  }

  appStore.getState().setUser(session.user)
  await goToApp(session.user)
  pushRoute(window.location.pathname)
}

// Register service worker after init
registerServiceWorker()

// ── Auth state listener ─────────────────────────────────────
// Only handles changes AFTER init completes
supabase.auth.onAuthStateChange(async (event, session) => {
  // Ignore events during initial load — init() handles that
  if (!isInitialized) return

  if (event === 'SIGNED_IN' && session) {
    const current = appStore.getState().user
    // Only re-route if different user
    if (!current || current.id !== session.user.id) {
      appStore.getState().setUser(session.user)
      await goToApp(session.user)
    }
  }

  if (event === 'SIGNED_OUT') {
    appStore.getState().setUser(null)
    appStore.getState().setStores([])
    appStore.getState().setCurrentStore(null)
    hideMobileNav()
    goToAuth()
  }
})

init()