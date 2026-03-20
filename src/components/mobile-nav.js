import { navigate } from '../router.js'
import { appStore } from '../store.js'
import { Icons, renderIcon } from './icons.js'
import { supabase } from '../supabase.js'

const MOBILE_ITEMS = [
  { path:'/dashboard',    icon:'dashboard',    label:'Home'    },
  { path:'/inventory',    icon:'inventory',    label:'Stock'   },
  { path:'/transactions', icon:'transactions', label:'Sales'   },
  { path:'/credits',      icon:'credits',      label:'Credits' },
  { path:'/accounting',   icon:'accounting',   label:'Finance' },
]

const ALL_NAV_ITEMS = [
  { path:'/dashboard',    icon:'dashboard',    label:'Dashboard'       },
  { path:'/sales',        icon:'store',        label:'Point of Sale'   },
  { path:'/inventory',    icon:'inventory',    label:'Inventory'       },
  { path:'/transactions', icon:'transactions', label:'Transactions'    },
  { path:'/expenses',     icon:'expenses',     label:'Expenses'        },
  { path:'/credits',      icon:'credits',      label:'Credits & Debts' },
  { path:'/transfers',    icon:'transfers',    label:'Cash Transfers'  },
  { path:'/accounting',   icon:'accounting',   label:'Accounting'      },
  { path:'/ocr',          icon:'scan',         label:'Scan Receipt'    },
  { path:'/reports',      icon:'reports',      label:'Reports'         },
  { path:'/settings',     icon:'settings',     label:'Settings'        },
]


export function initMobileNav() {

  // ── Bottom Nav ───────────────────────────────────────────────
  const nav = document.createElement('div')
  nav.className = 'mobile-nav'
  nav.id = 'mobile-nav'

  // ── FAB Camera ───────────────────────────────────────────────
  const fab = document.createElement('button')
  fab.className = 'fab-camera'
  fab.id = 'fab-camera'
  fab.setAttribute('aria-label', 'Scan receipt')
  fab.innerHTML = Icons.camera?.(24) || ''

  // ── Sidebar drawer ────────────────────────────────────────────
  const drawer = document.createElement('div')
  drawer.id = 'mobile-drawer'
  drawer.style.cssText = `
    position:fixed;inset:0;z-index:500;
    pointer-events:none;
  `
  drawer.innerHTML = `
    <!-- Backdrop -->
    <div id="drawer-backdrop" style="
      position:absolute;inset:0;
      background:rgba(0,0,0,0);
      backdrop-filter:blur(0px);
      transition:background 0.3s,backdrop-filter 0.3s;
    "></div>

    <!-- Panel -->
    <div id="drawer-panel" style="
      position:absolute;top:0;right:0;bottom:0;
      width:min(320px,85vw);
      background:var(--sidebar-bg);
      transform:translateX(100%);
      transition:transform 0.35s cubic-bezier(0.32,0.72,0,1);
      display:flex;flex-direction:column;
      overflow:hidden;
      box-shadow:-20px 0 60px rgba(0,0,0,0.2);
    ">
      <!-- Drawer header -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:1.25rem 1.25rem 0.75rem;
        border-bottom:1px solid rgba(255,255,255,0.07);
      ">
        <div style="
          display:flex;align-items:center;gap:0.5rem;
          font-size:1.1rem;font-weight:700;color:#fff;letter-spacing:-0.3px;
        ">
          <div style="
            width:28px;height:28px;background:var(--accent);border-radius:8px;
            display:flex;align-items:center;justify-content:center;
          ">${renderIcon('store', 14, '#fff')}</div>
          Store<span style="color:var(--teal-500,#14B8A6)">OS</span>
        </div>
        <button id="drawer-close" style="
          width:32px;height:32px;border-radius:50%;
          background:rgba(255,255,255,0.08);
          display:flex;align-items:center;justify-content:center;
          color:rgba(255,255,255,0.6);cursor:pointer;border:none;
          transition:all 0.15s;
        ">${renderIcon('close', 15)}</button>
      </div>

      <!-- Store switcher -->
      <div id="drawer-store-switcher" style="
        padding:0.75rem 1.25rem;
        border-bottom:1px solid rgba(255,255,255,0.07);
      "></div>

      <!-- Nav items -->
      <nav style="flex:1;overflow-y:auto;padding:0.5rem 0.75rem">
        <div style="
          font-size:0.625rem;font-weight:700;color:rgba(255,255,255,0.28);
          letter-spacing:1.2px;text-transform:uppercase;
          padding:0.75rem 0.5rem 0.35rem;
        ">Menu</div>
        ${ALL_NAV_ITEMS.map(item => `
          <div class="drawer-nav-item" data-path="${item.path}" style="
            display:flex;align-items:center;gap:0.625rem;
            padding:0.6rem 0.625rem;border-radius:var(--radius);
            color:rgba(255,255,255,0.58);font-size:0.9rem;font-weight:500;
            margin-bottom:1px;cursor:pointer;transition:all 0.15s;
          ">
            <div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${Icons[item.icon]?.(17) || ''}
            </div>
            ${item.label}
          </div>
        `).join('')}
      </nav>

      <!-- Drawer footer -->
      <div style="
        padding:0.875rem 1.25rem;
        border-top:1px solid rgba(255,255,255,0.07);
        display:flex;flex-direction:column;gap:0.5rem;
      ">
        <!-- Mode toggle -->
        <div id="drawer-mode-toggle" style="
          display:flex;align-items:center;justify-content:space-between;
          padding:0.5rem 0.625rem;border-radius:var(--radius);
          background:rgba(255,255,255,0.05);cursor:pointer;
        ">
          <span style="font-size:0.875rem;font-weight:500;color:rgba(255,255,255,0.6)">
            Lite Mode
          </span>
          <div id="drawer-mode-pill" style="
            width:36px;height:20px;border-radius:999px;
            background:rgba(255,255,255,0.15);position:relative;
            transition:background 0.2s;
          ">
            <div style="
              position:absolute;top:2px;left:2px;
              width:16px;height:16px;border-radius:50%;
              background:#fff;transition:transform 0.2s;
              box-shadow:0 1px 3px rgba(0,0,0,0.2);
            " id="drawer-mode-dot"></div>
          </div>
        </div>

        <!-- Sign out -->
        <button id="drawer-signout" style="
          display:flex;align-items:center;gap:0.5rem;
          padding:0.5rem 0.625rem;border-radius:var(--radius);
          color:rgba(255,255,255,0.35);font-size:0.875rem;font-weight:500;
          cursor:pointer;border:none;background:none;width:100%;
          transition:all 0.15s;
        ">
          ${renderIcon('logout', 15, 'currentColor')}
          Sign out
        </button>
      </div>
    </div>
  `

  document.body.appendChild(drawer)
  document.body.appendChild(nav)
  document.body.appendChild(fab)

  // ── Hide on auth/onboarding pages ──────────────────────────
  const HIDDEN_ROUTES = ['/auth', '/onboarding']

  function shouldHide() {
    return HIDDEN_ROUTES.includes(window.location.pathname)
  }

  function updateVisibility() {
    const hidden = shouldHide()
    nav.style.display = hidden ? 'none' : (window.innerWidth <= 768 ? 'block' : 'none')
    fab.style.display = hidden ? 'none' : (window.innerWidth <= 768 ? 'flex'  : 'none')
  }

  // ── Render bottom nav ────────────────────────────────────────
  function renderNav() {
    const path = window.location.pathname
    nav.innerHTML = `
      <div class="mobile-nav-glass">
        ${MOBILE_ITEMS.map(item => `
          <div class="mobile-nav-item ${path === item.path ? 'active' : ''}" data-path="${item.path}">
            <div class="m-icon">${Icons[item.icon]?.(22) || ''}</div>
            <span class="m-label">${item.label}</span>
          </div>
        `).join('')}

        <!-- Menu button — inside nav bar, right side -->
        <div class="mobile-nav-item" id="nav-menu-btn">
          <div class="m-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <line x1="4" y1="18" x2="20" y2="18"/>
            </svg>
          </div>
          <span class="m-label">Menu</span>
        </div>
      </div>
    `

    nav.querySelectorAll('.mobile-nav-item[data-path]').forEach(el => {
      el.addEventListener('click', () => {
        navigate(el.dataset.path)
        nav.querySelectorAll('.mobile-nav-item').forEach(i => {
          i.classList.toggle('active', i.dataset.path === el.dataset.path)
        })
      })
    })

    nav.querySelector('#nav-menu-btn').addEventListener('click', () => {
      drawerOpen ? closeDrawer() : openDrawer()
    })
  }

  // ── Drawer open/close ────────────────────────────────────────
  let drawerOpen = false

  function openDrawer() {
    drawerOpen = true
    drawer.style.pointerEvents = 'all'
    drawer.querySelector('#drawer-backdrop').style.background      = 'rgba(0,0,0,0.45)'
    drawer.querySelector('#drawer-backdrop').style.backdropFilter  = 'blur(4px)'
    drawer.querySelector('#drawer-panel').style.transform          = 'translateX(0)'

    // Update store switcher
    updateDrawerStoreSwitcher()

    // Update active nav items
    const path = window.location.pathname
    drawer.querySelectorAll('.drawer-nav-item').forEach(el => {
      const active = el.dataset.path === path
      el.style.background = active ? 'rgba(13,148,136,0.18)' : ''
      el.style.color      = active ? 'var(--teal-500,#14B8A6)' : 'rgba(255,255,255,0.58)'
    })

    // Update mode toggle
    const isLite = document.body.classList.contains('lite-mode')
    drawer.querySelector('#drawer-mode-pill').style.background = isLite ? 'var(--accent)' : 'rgba(255,255,255,0.15)'
    drawer.querySelector('#drawer-mode-dot').style.transform   = isLite ? 'translateX(16px)' : 'translateX(0)'

    // Haptic
    if (navigator.vibrate) navigator.vibrate(8)
  }

  function closeDrawer() {
    drawerOpen = false
    drawer.style.pointerEvents = 'none'
    drawer.querySelector('#drawer-backdrop').style.background      = 'rgba(0,0,0,0)'
    drawer.querySelector('#drawer-backdrop').style.backdropFilter  = 'blur(0px)'
    drawer.querySelector('#drawer-panel').style.transform          = 'translateX(100%)'
  }

  function updateDrawerStoreSwitcher() {
    const { stores, currentStore, accountingView } = appStore.getState()
    const el = drawer.querySelector('#drawer-store-switcher')
    if (!el || !stores?.length) return

    el.innerHTML = `
      <select style="
        width:100%;background:rgba(255,255,255,0.07);
        border:1px solid rgba(255,255,255,0.1);
        border-radius:var(--radius);padding:0.45rem 0.75rem;
        color:rgba(255,255,255,0.75);font-size:0.875rem;
        outline:none;cursor:pointer;
      " id="drawer-store-select">
        ${stores.map(s => `
          <option value="${s.id}" ${currentStore?.id === s.id ? 'selected' : ''} style="background:#111827">
            ${s.name}
          </option>
        `).join('')}
        <option value="joint" ${accountingView === 'joint' ? 'selected' : ''} style="background:#111827">
          Joint View
        </option>
      </select>
    `

    el.querySelector('#drawer-store-select').addEventListener('change', e => {
      const val = e.target.value
      const { stores } = appStore.getState()
      if (val === 'joint') {
        appStore.getState().setAccountingView('joint')
        appStore.getState().setCurrentStore(null)
      } else {
        appStore.getState().setCurrentStore(stores.find(s => s.id === val))
        appStore.getState().setAccountingView('separate')
      }
      closeDrawer()
      navigate(window.location.pathname)
    })
  }

  // ── Drawer events ────────────────────────────────────────────
  drawer.querySelector('#drawer-backdrop').addEventListener('click', closeDrawer)
  drawer.querySelector('#drawer-close').addEventListener('click', closeDrawer)

  // Nav item clicks — navigate and auto-close
  drawer.querySelectorAll('.drawer-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      navigate(el.dataset.path)
      closeDrawer()
    })

    // Hover effect
    el.addEventListener('mouseenter', () => {
      if (el.dataset.path !== window.location.pathname) {
        el.style.background = 'rgba(255,255,255,0.07)'
        el.style.color      = 'rgba(255,255,255,0.88)'
      }
    })
    el.addEventListener('mouseleave', () => {
      if (el.dataset.path !== window.location.pathname) {
        el.style.background = ''
        el.style.color      = 'rgba(255,255,255,0.58)'
      }
    })
  })

  // Mode toggle
  drawer.querySelector('#drawer-mode-toggle').addEventListener('click', () => {
    const isLite = document.body.classList.contains('lite-mode')
    document.body.classList.toggle('lite-mode', !isLite)
    localStorage.setItem('storeos-mode', !isLite ? 'lite' : 'pro')
    drawer.querySelector('#drawer-mode-pill').style.background = !isLite ? 'var(--accent)' : 'rgba(255,255,255,0.15)'
    drawer.querySelector('#drawer-mode-dot').style.transform   = !isLite ? 'translateX(16px)' : 'translateX(0)'
    if (navigator.vibrate) navigator.vibrate([5, 30, 5])
  })

  // Sign out
  drawer.querySelector('#drawer-signout').addEventListener('click', async () => {
    closeDrawer()
    await supabase.auth.signOut()
  })

  // Sign out hover
  const signoutBtn = drawer.querySelector('#drawer-signout')
  signoutBtn.addEventListener('mouseenter', () => {
    signoutBtn.style.background = 'rgba(239,68,68,0.12)'
    signoutBtn.style.color      = '#FCA5A5'
  })
  signoutBtn.addEventListener('mouseleave', () => {
    signoutBtn.style.background = ''
    signoutBtn.style.color      = 'rgba(255,255,255,0.35)'
  })

  // ── FAB Camera ───────────────────────────────────────────────
  fab.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (navigator.vibrate) navigator.vibrate(10)

    fab.style.transform = 'translateX(-50%) scale(0.85)'
    setTimeout(() => { fab.style.transform = '' }, 150)

    // Must create input fresh each time on iOS
    const input   = document.createElement('input')
    input.type    = 'file'
    input.accept  = 'image/*'
    input.capture = 'environment'
    input.style.cssText = 'position:fixed;top:-9999px;opacity:0'
    document.body.appendChild(input)

    input.addEventListener('change', e => {
      if (!e.target.files?.[0]) {
        document.body.removeChild(input)
        return
      }
      const file   = e.target.files[0]
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          sessionStorage.setItem('pending_scan_name', file.name)
          sessionStorage.setItem('pending_scan_type', file.type)
          sessionStorage.setItem('pending_scan_data', ev.target.result)
        } catch(_) {}
        document.body.removeChild(input)
        navigate('/ocr')
      }
      reader.readAsDataURL(file)
    })

    input.click()
  })

  // ── Route change listener ────────────────────────────────────
  window.addEventListener('popstate', () => {
    updateVisibility()
    renderNav()
    if (drawerOpen) closeDrawer()
  })

  window.addEventListener('resize', updateVisibility)

  // Apply saved mode
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  // ── Init ─────────────────────────────────────────────────────
  renderNav()
  updateVisibility()

  // Also re-check after any dynamic navigation
  document.addEventListener('click', () => {
    setTimeout(updateVisibility, 50)
  })

  return { renderNav, updateVisibility }
}

export function consumePendingScan() {
  const data = sessionStorage.getItem('pending_scan_data')
  const name = sessionStorage.getItem('pending_scan_name')
  const type = sessionStorage.getItem('pending_scan_type')
  if (!data) return null
  sessionStorage.removeItem('pending_scan_data')
  sessionStorage.removeItem('pending_scan_name')
  sessionStorage.removeItem('pending_scan_type')
  const arr   = data.split(',')
  const bstr  = atob(arr[1])
  const u8arr = new Uint8Array(bstr.length)
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i)
  return new File([u8arr], name || 'scan.jpg', { type: type || 'image/jpeg' })
}