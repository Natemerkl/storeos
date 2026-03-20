// Global error handler — catches silent white pages
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
  if (e.reason?.message?.includes('Lock broken') ||
      e.reason?.message?.includes('lock')) {
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
let navEl     = null
let contentEl = null
let layoutBuilt = false

// ── Hide mobile nav explicitly ─────────────────────────────
function hideMobileNav() {
  const mobileNav = document.getElementById('mobile-nav')
  const fabCamera = document.getElementById('fab-camera')
  const drawer    = document.getElementById('mobile-drawer')
  if (mobileNav) mobileNav.style.display = 'none'
  if (fabCamera) fabCamera.style.display = 'none'
  // Don't hide drawer — it has pointer-events:none by default
}

// ── Show mobile nav (only on mobile screen size) ───────────
function showMobileNav() {
  if (window.innerWidth > 768) return
  const mobileNav = document.getElementById('mobile-nav')
  const fabCamera = document.getElementById('fab-camera')
  if (mobileNav) mobileNav.style.display = 'block'
  if (fabCamera) fabCamera.style.display = 'flex'
}

export async function loadPage(pageName) {
  const fullScreenPages = ['auth', 'onboarding']

  if (fullScreenPages.includes(pageName)) {
    // Full screen pages — no sidebar, no mobile nav
    app.innerHTML = ''
    layoutBuilt = false
    navEl     = null
    contentEl = document.createElement('div')
    contentEl.style.width = '100%'
    app.appendChild(contentEl)

    // Explicitly hide mobile nav — this is the critical fix
    hideMobileNav()

    const module = await import(`./pages/${pageName}.js`)
    module.render(contentEl)
    return
  }

  // Normal pages — ensure layout exists
  if (!document.querySelector('.sidebar')) {
    buildLayout()
  }

  // Show mobile nav on normal pages
  showMobileNav()

  contentEl.innerHTML = ''
  const module = await import(`./pages/${pageName}.js`)
  module.render(contentEl)

  // Update active nav item
  if (navEl) {
    navEl.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === window.location.pathname)
    })
  }
}

export function buildLayout() {
  // Check if layout actually exists in DOM
  const navExists     = document.querySelector('.sidebar')
  const contentExists = document.querySelector('.main-content')

  if (navExists && contentExists) {
    // Already built — just refresh nav
    if (navEl) renderNav(navEl)
    return
  }

  layoutBuilt = true
  app.innerHTML = ''

  navEl = document.createElement('aside')
  renderNav(navEl)
  app.appendChild(navEl)

  contentEl = document.createElement('main')
  contentEl.className = 'main-content'
  app.appendChild(contentEl)

  // Init mobile nav once — it starts hidden via inline style
  if (!document.getElementById('mobile-nav')) {
    initMobileNav()
  }
}

export function buildFullScreen() {
  layoutBuilt = false
  app.innerHTML = ''
  navEl     = null
  contentEl = document.createElement('div')
  contentEl.style.width = '100%'
  app.appendChild(contentEl)
}

async function loadUserData(user) {
  const { data: owner } = await supabase
    .from('owners')
    .select('*')
    .eq('email', user.email)
    .single()

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

  if (!stores || stores.length === 0) {
    buildFullScreen()
    initRouter()
    navigate('/onboarding')
    return
  }

  appStore.getState().setStores(stores)
  appStore.getState().setCurrentStore(stores[0])
  buildLayout()

  // Replace /auth in history so back button doesn't return to auth
  if (window.location.pathname === '/auth') {
    window.history.replaceState({}, '', '/dashboard')
  }

  initRouter()
}

async function init() {
  // Apply saved mode before anything renders
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  // Wait for auth to stabilize — fixes Supabase lock race condition
  await new Promise(r => setTimeout(r, 100))

  let session = null
  try {
    const { data } = await supabase.auth.getSession()
    session = data?.session
  } catch (e) {
    // Lock error — retry once after short delay
    await new Promise(r => setTimeout(r, 500))
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session
    } catch (e2) {
      console.warn('Auth session error:', e2.message)
    }
  }

  if (!session) {
    buildFullScreen()
    initRouter()
    navigate('/auth')
    return
  }

  appStore.getState().setUser(session.user)
  await loadUserData(session.user)
}

// Auth state change listener
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    // Only load if user wasn't already set — avoid double-loading
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
    // Hide mobile nav before navigating to auth
    hideMobileNav()
    buildFullScreen()
    navigate('/auth')
  }
})

init()