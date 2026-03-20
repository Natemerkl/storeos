import { navigate } from '../router.js'
import { appStore } from '../store.js'
import { Icons, renderIcon } from './icons.js'
import { supabase } from '../supabase.js'

const MOBILE_ITEMS = [
  { path: '/dashboard',    icon: 'dashboard',    label: 'Home'    },
  { path: '/inventory',    icon: 'inventory',    label: 'Stock'   },
  { path: '/transactions', icon: 'transactions', label: 'Sales'   },
  { path: '/credits',      icon: 'credits',      label: 'Credits' },
  { path: '/accounting',   icon: 'accounting',   label: 'Finance' },
]

const ALL_NAV_ITEMS = [
  { path: '/dashboard',    icon: 'dashboard',    label: 'Dashboard'       },
  { path: '/sales',        icon: 'store',        label: 'Point of Sale'   },
  { path: '/inventory',    icon: 'inventory',    label: 'Inventory'       },
  { path: '/transactions', icon: 'transactions', label: 'Transactions'    },
  { path: '/expenses',     icon: 'expenses',     label: 'Expenses'        },
  { path: '/credits',      icon: 'credits',      label: 'Credits & Debts' },
  { path: '/transfers',    icon: 'transfers',    label: 'Cash Transfers'  },
  { path: '/accounting',   icon: 'accounting',   label: 'Accounting'      },
  { path: '/ocr',          icon: 'scan',         label: 'Scan Receipt'    },
  { path: '/reports',      icon: 'reports',      label: 'Reports'         },
  { path: '/settings',     icon: 'settings',     label: 'Settings'        },
  { path: '/audit',        icon: 'reports',      label: 'Audit Log'       },
]

// Routes where mobile nav must NEVER show
const HIDDEN_ROUTES = new Set(['/auth', '/onboarding'])

export function initMobileNav() {

  // ── Create elements ──────────────────────────────────────
  const nav = document.createElement('div')
  nav.className = 'mobile-nav'
  nav.id = 'mobile-nav'
  // Force hidden via inline style — CSS alone isn't enough during init race
  nav.style.display = 'none'

  const fab = document.createElement('button')
  fab.className = 'fab-camera'
  fab.id = 'fab-camera'
  fab.setAttribute('aria-label', 'Scan receipt')
  fab.innerHTML = Icons.camera?.(24) || ''
  // Force hidden via inline style
  fab.style.display = 'none'

  // ── Drawer ───────────────────────────────────────────────
  const drawer = document.createElement('div')
  drawer.id = 'mobile-drawer'
  drawer.style.cssText = `
    position:fixed;inset:0;z-index:500;pointer-events:none;
  `
  drawer.innerHTML = `
    <div id="drawer-backdrop" style="
      position:absolute;inset:0;
      background:rgba(0,0,0,0);
      transition:background 0.3s ease;
    "></div>
    <div id="drawer-panel" style="
      position:absolute;top:0;right:0;bottom:0;
      width:min(320px,85vw);
      background:var(--sidebar-bg);
      transform:translateX(100%);
      transition:transform 0.35s cubic-bezier(0.32,0.72,0,1);
      display:flex;flex-direction:column;
      box-shadow:-20px 0 60px rgba(0,0,0,0.25);
      overflow:hidden;
    ">
      <!-- Header -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:calc(var(--safe-top,0px) + 20px) 20px 16px;
        border-bottom:1px solid rgba(255,255,255,0.07);
        flex-shrink:0;
      ">
        <div style="
          display:flex;align-items:center;gap:8px;
          font-size:1.1rem;font-weight:700;color:#fff;
        ">
          <div style="
            width:28px;height:28px;background:var(--accent);border-radius:8px;
            display:flex;align-items:center;justify-content:center;
          ">${renderIcon('store', 14, '#fff')}</div>
          Store<span style="color:var(--teal-500,#14B8A6)">OS</span>
        </div>
        <button id="drawer-close" aria-label="Close menu" style="
          width:36px;height:36px;border-radius:50%;
          background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.1);
          display:flex;align-items:center;justify-content:center;
          color:rgba(255,255,255,0.7);cursor:pointer;
          -webkit-tap-highlight-color:transparent;
        ">${renderIcon('close', 16)}</button>
      </div>

      <!-- Store switcher -->
      <div id="drawer-store-switcher" style="
        padding:12px 20px;
        border-bottom:1px solid rgba(255,255,255,0.07);
        flex-shrink:0;
      "></div>

      <!-- Nav items -->
      <nav style="
        flex:1;overflow-y:auto;padding:8px 12px;
        -webkit-overflow-scrolling:touch;
      ">
        <div style="
          font-size:10px;font-weight:700;
          color:rgba(255,255,255,0.28);
          letter-spacing:1.2px;text-transform:uppercase;
          padding:12px 8px 6px;
        ">Menu</div>
        ${ALL_NAV_ITEMS.map(item => `
          <div class="drawer-nav-item"
            data-path="${item.path}"
            role="button"
            tabindex="0"
            aria-label="${item.label}"
            style="
              display:flex;align-items:center;gap:10px;
              padding:10px;border-radius:10px;
              color:rgba(255,255,255,0.58);
              font-size:0.9rem;font-weight:500;
              margin-bottom:2px;cursor:pointer;
              transition:background 0.15s,color 0.15s;
              min-height:44px;
              -webkit-tap-highlight-color:transparent;
              touch-action:manipulation;
            ">
            <div style="
              width:20px;height:20px;
              display:flex;align-items:center;justify-content:center;
              flex-shrink:0;
            ">${Icons[item.icon]?.(17) || ''}</div>
            <span>${item.label}</span>
          </div>
        `).join('')}
      </nav>

      <!-- Footer -->
      <div style="
        padding:12px 20px;
        padding-bottom:calc(var(--safe-bottom,0px) + 16px);
        border-top:1px solid rgba(255,255,255,0.07);
        flex-shrink:0;
      ">
        <!-- Mode toggle -->
        <div id="drawer-mode-toggle"
          role="button" tabindex="0"
          aria-label="Toggle Lite/Pro mode"
          style="
            display:flex;align-items:center;justify-content:space-between;
            padding:10px 12px;border-radius:10px;
            background:rgba(255,255,255,0.05);
            cursor:pointer;margin-bottom:8px;
            min-height:44px;
            -webkit-tap-highlight-color:transparent;
            touch-action:manipulation;
          ">
          <span style="
            font-size:0.875rem;font-weight:500;
            color:rgba(255,255,255,0.6);
          ">Lite Mode</span>
          <div id="drawer-mode-pill" style="
            width:40px;height:22px;border-radius:999px;
            background:rgba(255,255,255,0.15);
            position:relative;transition:background 0.2s;
          ">
            <div id="drawer-mode-dot" style="
              position:absolute;top:3px;left:3px;
              width:16px;height:16px;border-radius:50%;
              background:#fff;transition:transform 0.2s;
              box-shadow:0 1px 3px rgba(0,0,0,0.2);
            "></div>
          </div>
        </div>

        <!-- Sign out -->
        <button id="drawer-signout"
          aria-label="Sign out"
          style="
            display:flex;align-items:center;gap:8px;
            padding:10px 12px;border-radius:10px;
            color:rgba(255,255,255,0.4);
            font-size:0.875rem;font-weight:500;
            cursor:pointer;border:none;background:none;
            width:100%;min-height:44px;
            transition:all 0.15s;
            -webkit-tap-highlight-color:transparent;
            touch-action:manipulation;
          ">
          ${renderIcon('logout', 16, 'currentColor')}
          Sign out
        </button>
      </div>
    </div>
  `

  // Append everything to body
  document.body.appendChild(drawer)
  document.body.appendChild(nav)
  document.body.appendChild(fab)

  // ── Visibility control ───────────────────────────────────
  // This is the ONLY function that shows/hides the nav
  function updateVisibility() {
    const path   = window.location.pathname
    const hidden = HIDDEN_ROUTES.has(path)
    const mobile = window.innerWidth <= 768
    const show   = !hidden && mobile

    nav.style.display = show ? 'block' : 'none'
    fab.style.display = show ? 'flex'  : 'none'

    // Also close drawer if we're on a hidden route
    if (hidden && drawerOpen) closeDrawer()
  }

  // ── Render bottom nav items ──────────────────────────────
  function renderNav() {
    const path = window.location.pathname
    nav.innerHTML = `
      <div class="mobile-nav-glass">
        ${MOBILE_ITEMS.map(item => `
          <div
            class="mobile-nav-item ${path === item.path ? 'active' : ''}"
            data-path="${item.path}"
            role="button"
            tabindex="0"
            aria-label="${item.label}"
            aria-current="${path === item.path ? 'page' : 'false'}"
          >
            <div class="m-icon">${Icons[item.icon]?.(22) || ''}</div>
            <span class="m-label">${item.label}</span>
          </div>
        `).join('')}

        <!-- Hamburger menu button -->
        <div
          class="mobile-nav-item"
          id="nav-menu-btn"
          role="button"
          tabindex="0"
          aria-label="Open menu"
          aria-expanded="false"
          aria-haspopup="true"
        >
          <div class="m-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
              <line x1="4" y1="7"  x2="20" y2="7"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <line x1="4" y1="17" x2="20" y2="17"/>
            </svg>
          </div>
          <span class="m-label">Menu</span>
        </div>
      </div>
    `

    // Nav item tap handlers
    nav.querySelectorAll('.mobile-nav-item[data-path]').forEach(el => {
      el.addEventListener('click', () => {
        navigate(el.dataset.path)
        nav.querySelectorAll('.mobile-nav-item[data-path]').forEach(i => {
          const active = i.dataset.path === el.dataset.path
          i.classList.toggle('active', active)
          i.setAttribute('aria-current', active ? 'page' : 'false')
        })
      })
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          el.click()
        }
      })
    })

    // Hamburger tap
    nav.querySelector('#nav-menu-btn')?.addEventListener('click', () => {
      drawerOpen ? closeDrawer() : openDrawer()
    })
  }

  // ── Drawer open / close ──────────────────────────────────
  let drawerOpen = false

  function openDrawer() {
    drawerOpen = true
    drawer.style.pointerEvents = 'all'
    drawer.querySelector('#drawer-backdrop').style.background = 'rgba(0,0,0,0.5)'
    drawer.querySelector('#drawer-panel').style.transform     = 'translateX(0)'
    nav.querySelector('#nav-menu-btn')?.setAttribute('aria-expanded', 'true')

    // Highlight current route
    const path = window.location.pathname
    drawer.querySelectorAll('.drawer-nav-item').forEach(el => {
      const active = el.dataset.path === path
      el.style.background = active ? 'rgba(13,148,136,0.18)' : ''
      el.style.color      = active ? 'var(--teal-500,#14B8A6)' : 'rgba(255,255,255,0.58)'
    })

    updateModeToggle()
    updateDrawerStoreSwitcher()
    if (navigator.vibrate) navigator.vibrate(8)
  }

  function closeDrawer() {
    drawerOpen = false
    drawer.style.pointerEvents = 'none'
    drawer.querySelector('#drawer-backdrop').style.background = 'rgba(0,0,0,0)'
    drawer.querySelector('#drawer-panel').style.transform     = 'translateX(100%)'
    nav.querySelector('#nav-menu-btn')?.setAttribute('aria-expanded', 'false')
  }

  function updateModeToggle() {
    const isLite = document.body.classList.contains('lite-mode')
    const pill   = drawer.querySelector('#drawer-mode-pill')
    const dot    = drawer.querySelector('#drawer-mode-dot')
    if (pill) pill.style.background = isLite ? 'var(--accent)' : 'rgba(255,255,255,0.15)'
    if (dot)  dot.style.transform   = isLite ? 'translateX(18px)' : 'translateX(0)'
  }

  function updateDrawerStoreSwitcher() {
    const { stores, currentStore, accountingView } = appStore.getState()
    const el = drawer.querySelector('#drawer-store-switcher')
    if (!el || !stores?.length) return

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <select aria-label="Select store" style="
          flex:1;
          background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.12);
          border-radius:10px;
          padding:10px 12px;
          color:rgba(255,255,255,0.8);
          font-size:0.875rem;
          outline:none;cursor:pointer;
          min-height:44px;
          -webkit-appearance:none;
        " id="drawer-store-select">
          ${stores.map(s => `
            <option value="${s.id}"
              ${currentStore?.id === s.id ? 'selected' : ''}
              style="background:#111827">
              ${s.name}
            </option>
          `).join('')}
          <option value="joint"
            ${accountingView === 'joint' ? 'selected' : ''}
            style="background:#111827">
            Joint View
          </option>
        </select>

        <button id="drawer-add-store" aria-label="Add new store" style="
          width:44px;height:44px;flex-shrink:0;
          border-radius:10px;
          background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.12);
          display:flex;align-items:center;justify-content:center;
          color:rgba(255,255,255,0.6);cursor:pointer;
          -webkit-tap-highlight-color:transparent;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5"  y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
    `

    el.querySelector('#drawer-store-select').addEventListener('change', e => {
      const val    = e.target.value
      const stores = appStore.getState().stores
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

    el.querySelector('#drawer-add-store').addEventListener('click', () => {
      closeDrawer()
      setTimeout(() => {
        import('./add-store-modal.js').then(({ openAddStoreModal }) => {
          openAddStoreModal(newStore => {
            appStore.getState().setCurrentStore(newStore)
            navigate(window.location.pathname)
          })
        })
      }, 350)
    })
  }

  // ── Drawer events ────────────────────────────────────────
  drawer.querySelector('#drawer-backdrop').addEventListener('click', closeDrawer)
  drawer.querySelector('#drawer-close').addEventListener('click', closeDrawer)

  drawer.querySelectorAll('.drawer-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      navigate(el.dataset.path)
      closeDrawer()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        el.click()
      }
    })
    el.addEventListener('mouseenter', () => {
      if (el.dataset.path !== window.location.pathname) {
        el.style.background = 'rgba(255,255,255,0.07)'
        el.style.color      = 'rgba(255,255,255,0.9)'
      }
    })
    el.addEventListener('mouseleave', () => {
      if (el.dataset.path !== window.location.pathname) {
        el.style.background = ''
        el.style.color      = 'rgba(255,255,255,0.58)'
      }
    })
  })

  drawer.querySelector('#drawer-mode-toggle').addEventListener('click', () => {
    const isLite = document.body.classList.contains('lite-mode')
    document.body.classList.toggle('lite-mode', !isLite)
    localStorage.setItem('storeos-mode', !isLite ? 'lite' : 'pro')
    updateModeToggle()
    if (navigator.vibrate) navigator.vibrate([5, 30, 5])
  })

  drawer.querySelector('#drawer-signout').addEventListener('click', async () => {
    closeDrawer()
    await supabase.auth.signOut()
  })

  // ── FAB camera ───────────────────────────────────────────
  fab.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(10)

    const input   = document.createElement('input')
    input.type    = 'file'
    input.accept  = 'image/*'
    input.capture = 'environment'
    input.style.cssText = 'position:fixed;top:-9999px;opacity:0;pointer-events:none'
    document.body.appendChild(input)

    input.addEventListener('change', e => {
      document.body.removeChild(input)
      if (!e.target.files?.[0]) return
      const file   = e.target.files[0]
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          sessionStorage.setItem('pending_scan_name', file.name)
          sessionStorage.setItem('pending_scan_type', file.type)
          sessionStorage.setItem('pending_scan_data', ev.target.result)
        } catch (_) {}
        navigate('/ocr')
      }
      reader.readAsDataURL(file)
    })

    input.click()
  })

  // ── Route & resize listeners ─────────────────────────────
  // Called on every navigation — this is what keeps nav hidden on auth
  window.addEventListener('popstate', () => {
    updateVisibility()
    renderNav()
    if (drawerOpen) closeDrawer()
  })

  window.addEventListener('resize', updateVisibility)

  // ── Apply saved mode ─────────────────────────────────────
  if (localStorage.getItem('storeos-mode') === 'lite') {
    document.body.classList.add('lite-mode')
  }

  // ── Init — render then check visibility ──────────────────
  renderNav()
  // Run AFTER renderNav so DOM exists
  updateVisibility()

  return { renderNav, updateVisibility }
}

// ── Consume pending scan from FAB ────────────────────────────
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