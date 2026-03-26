import { loadPage } from './main.js'

const routes = {
  '/':              'dashboard',
  '/dashboard':     'dashboard',
  '/inventory':     'inventory',
  '/transactions':  'transactions',
  '/expenses':      'expenses',
  '/credits':       'credits',
  '/transfers':     'cash-transfer',
  '/accounting':    'accounting',
  '/ocr':           'ocr-scanner',
  '/ocr/review':    'ocr-editor',
  '/reports':       'reports',
  '/auth':          'auth',
  '/onboarding':    'onboarding',
  '/settings':      'settings',
  '/audit':         'audit',
  '/sales':         'sales',
  '/sales-history': 'sales-history',
  '/suppliers':     'suppliers',
}

export function initRouter() {
  // Handle browser back/forward
  window.addEventListener('popstate', () => handleRoute())

  // Handle initial load
  handleRoute()
}

export function navigate(path) {
  if (window.location.pathname === path) return // no-op if same page
  window.history.pushState({}, '', path)
  handleRoute()
}

function handleRoute() {
  const path = window.location.pathname
  const page = routes[path]

  if (!page) {
    // Unknown route — go to dashboard
    window.history.replaceState({}, '', '/dashboard')
    loadPage('dashboard')
    return
  }

  loadPage(page)
}