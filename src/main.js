import './styles/main.css'
import { initRouter, navigate } from './router.js'
import { supabase } from './supabase.js'
import { appStore } from './store.js'
import { renderNav } from './components/nav.js'
import { initMobileNav } from './components/mobile-nav.js'

const app = document.getElementById('app')
let navEl     = null
let contentEl = null

export async function loadPage(pageName) {
  const fullScreen = ['auth', 'onboarding']

  if (fullScreen.includes(pageName)) {
    // Remove sidebar for full-screen pages
    app.innerHTML = ''
    navEl     = null
    contentEl = document.createElement('div')
    contentEl.style.width = '100%'
    app.appendChild(contentEl)
    const module = await import(`./pages/${pageName}.js`)
    module.render(contentEl)
    return
  }

  // Ensure layout exists
  if (!navEl || !document.body.contains(navEl)) {
    buildLayout()
  }

  contentEl.innerHTML = ''
  const module = await import(`./pages/${pageName}.js`)
  module.render(contentEl)

  // Update active nav
  if (navEl) {
    navEl.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === window.location.pathname)
    })
  }
}

export function buildLayout() {
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
  initRouter()
}

async function init() {
  // Apply saved mode
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    appStore.getState().setUser(session.user)
    await loadUserData(session.user)
  } else {
    buildFullScreen()
    initRouter()
    navigate('/auth')
  }
}

// Auth state listener
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    // Only load if user wasn't already set to avoid double-loading
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
    buildFullScreen()
    navigate('/auth')
  }
})

init()