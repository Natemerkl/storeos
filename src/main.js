// ── Global error handlers ──────────────────────────────────
window.addEventListener('error', (e) => {
  console.error('Global error:', e.message)
  setTimeout(() => {
    const app = document.getElementById('app')
    if (app && app.children.length === 0) {
      const reloaded = sessionStorage.getItem('error-reload')
      if (!reloaded) {
        sessionStorage.setItem('error-reload', '1')
        window.location.reload()
      }
    }
  }, 2000)
})

window.addEventListener('unhandledrejection', (e) => {
  if (
    e.reason?.message?.includes('Lock broken') ||
    e.reason?.message?.includes('lock') ||
    e.reason?.message?.includes('Failed to fetch')
  ) {
    e.preventDefault()
    return
  }
  console.error('Unhandled rejection:', e.reason)
})

import './styles/main.css'
import { initRouter, navigate } from './router.js'
import { supabase } from './supabase.js'
import { appStore } from './store.js'
import { renderNav } from './components/nav.js'
import { initMobileNav } from './components/mobile-nav.js'

const app = document.getElementById('app')
let navEl        = null
let contentEl    = null
let layoutBuilt  = false
let routerInited = false

// ── Loading screen ─────────────────────────────────────────
function showLoadingScreen() {
  app.innerHTML = `
    <div id="app-loader" style="
      position:fixed;inset:0;
      display:flex;align-items:center;justify-content:center;
      flex-direction:column;gap:1rem;
      background:#FAFAFA;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;
    ">
      <div style="
        width:48px;height:48px;
        background:#0D9488;border-radius:14px;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 8px 24px rgba(13,148,136,0.3);
        animation:logo-pulse 1.8s ease-in-out infinite;
      ">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/>
          <path d="M2 7h20"/>
        </svg>
      </div>
      <div style="font-size:1.25rem;font-weight:700;color:#111827;letter-spacing:-0.3px;">
        Store<span style="color:#0D9488">OS</span>
      </div>
      <div style="font-size:0.8125rem;color:#6B7280">Loading...</div>
      <style>
        @keyframes logo-pulse {
          0%,100% { transform:scale(1);   box-shadow:0 8px 24px rgba(13,148,136,0.3); }
          50%      { transform:scale(1.06);box-shadow:0 12px 32px rgba(13,148,136,0.45); }
        }
      </style>
    </div>
  `
}

// ── Mobile nav visibility ──────────────────────────────────
function hideMobileNav() {
  const mobileNav = document.getElementById('mobile-nav')
  const fabCamera = document.getElementById('fab-camera')
  if (mobileNav) mobileNav.style.display = 'none'
  if (fabCamera) fabCamera.style.display = 'none'
}

function showMobileNav() {
  if (window.innerWidth > 768) return
  const mobileNav = document.getElementById('mobile-nav')
  const fabCamera = document.getElementById('fab-camera')
  if (mobileNav) mobileNav.style.display = 'block'
  if (fabCamera) fabCamera.style.display = 'flex'
}

// ── Load page ──────────────────────────────────────────────
export async function loadPage(pageName) {
  const fullScreenPages = ['auth', 'onboarding']

  if (fullScreenPages.includes(pageName)) {
    app.innerHTML = ''
    layoutBuilt   = false
    navEl         = null
    contentEl     = document.createElement('div')
    contentEl.style.width = '100%'
    app.appendChild(contentEl)
    hideMobileNav()

    try {
      const module = await import(`./pages/${pageName}.js`)
      module.render(contentEl)
    } catch(err) {
      console.error(`Failed to load page: ${pageName}`, err)
      handleChunkError(pageName)
    }
    return
  }

  // Normal page — ensure layout in DOM
  if (!document.querySelector('.sidebar')) {
    buildLayout()
  }

  showMobileNav()

  // Clear content safely
  if (contentEl && document.body.contains(contentEl)) {
    contentEl.innerHTML = ''
  } else {
    // contentEl lost — rebuild
    buildLayout()
  }

  try {
    const module = await import(`./pages/${pageName}.js`)
    // Double-check container still valid before rendering
    if (contentEl && document.body.contains(contentEl)) {
      module.render(contentEl)
    }
  } catch(err) {
    console.error(`Failed to load page: ${pageName}`, err)
    handleChunkError(pageName)
    return
  }

  // Update active nav
  if (navEl && document.body.contains(navEl)) {
    navEl.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === window.location.pathname)
    })
  }
}

// ── Handle chunk load failure ──────────────────────────────
function handleChunkError(pageName) {
  const key = `chunk-retry-${pageName}`
  if (!sessionStorage.getItem(key)) {
    // First failure — reload to bust Vercel cache
    sessionStorage.setItem(key, '1')
    window.location.reload()
  } else {
    // Second failure — show error, don't loop
    sessionStorage.removeItem(key)
    if (contentEl && document.body.contains(contentEl)) {
      contentEl.innerHTML = `
        <div style="
          display:flex;flex-direction:column;align-items:center;
          justify-content:center;min-height:60vh;gap:1rem;
          color:#6B7280;text-align:center;padding:2rem;
        ">
          <div style="font-size:2rem">⚠️</div>
          <div style="font-weight:600;color:#111827;font-size:1rem">Page failed to load</div>
          <div style="font-size:0.875rem">Check your connection and try again</div>
          <button onclick="window.location.reload()" style="
            padding:0.5rem 1.25rem;border-radius:8px;
            background:#0D9488;color:#fff;border:none;
            font-size:0.875rem;font-weight:600;cursor:pointer;
            margin-top:0.5rem;
          ">Reload App</button>
        </div>
      `
    }
  }
}

// ── Build layout ───────────────────────────────────────────
export function buildLayout() {
  const navExists     = document.querySelector('.sidebar')
  const contentExists = document.querySelector('.main-content')

  if (navExists && contentExists) {
    if (navEl) renderNav(navEl)
    return
  }

  layoutBuilt   = true
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
}

export function buildFullScreen() {
  layoutBuilt   = false
  app.innerHTML = ''
  navEl         = null
  contentEl     = document.createElement('div')
  contentEl.style.width = '100%'
  app.appendChild(contentEl)
}

// ── Load user data ─────────────────────────────────────────
async function loadUserData(user) {
  try {
    const { data: owner } = await supabase
      .from('owners')
      .select('*')
      .eq('email', user.email)
      .maybeSingle()

    if (!owner) {
      buildFullScreen()
      if (!routerInited) { initRouter(); routerInited = true }
      navigate('/onboarding')
      return
    }

    const { data: stores } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', owner.id)

    if (!stores || stores.length === 0) {
      buildFullScreen()
      if (!routerInited) { initRouter(); routerInited = true }
      navigate('/onboarding')
      return
    }

    appStore.getState().setStores(stores)
    appStore.getState().setCurrentStore(stores[0])
    buildLayout()

    // Fix URL if stuck on /auth or /
    if (window.location.pathname === '/auth' ||
        window.location.pathname === '/') {
      window.history.replaceState({}, '', '/dashboard')
    }

    if (!routerInited) { initRouter(); routerInited = true }

  } catch(err) {
    console.error('loadUserData error:', err)
    buildFullScreen()
    if (!routerInited) { initRouter(); routerInited = true }
    navigate('/auth')
  }
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  // Show loading immediately — no blank page ever
  showLoadingScreen()

  // Wait for Supabase auth lock to stabilize
  await new Promise(r => setTimeout(r, 150))

  let session = null
  try {
    const { data } = await supabase.auth.getSession()
    session = data?.session
  } catch(e) {
    await new Promise(r => setTimeout(r, 600))
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session
    } catch(e2) {
      console.warn('Auth session error:', e2.message)
    }
  }

  if (!session) {
    buildFullScreen()
    if (!routerInited) { initRouter(); routerInited = true }
    navigate('/auth')
    return
  }

  appStore.getState().setUser(session.user)
  await loadUserData(session.user)
}

// ── Auth state change ──────────────────────────────────────
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    const currentUser = appStore.getState().user
    if (!currentUser || currentUser.id !== session.user.id) {
      appStore.getState().setUser(session.user)
      await loadUserData(session.user)
    }
  }

  if (event === 'SIGNED_OUT') {
    appStore.getState().setUser(null)
    appStore.getState().setStores([])
    appStore.getState().setCurrentStore(null)
    routerInited = false
    hideMobileNav()
    buildFullScreen()
    initRouter()
    routerInited = true
    navigate('/auth')
  }
})

init()