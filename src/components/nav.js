import { navigate } from '../router.js'
import { appStore } from '../store.js'
import { supabase } from '../supabase.js'
import { initSearch } from './search.js'
import { renderIcon } from './icons.js'
import { audit } from '../utils/audit.js'

const NAV_ITEMS = [
  { path:'/dashboard',    icon:'dashboard',    label:'Dashboard',      liteShow: true  },
  { path:'/inventory',    icon:'inventory',    label:'Inventory',      liteShow: false },
  { path:'/transactions', icon:'transactions', label:'Transactions',   liteShow: true  },
  { path:'/expenses',     icon:'expenses',     label:'Expenses',       liteShow: true  },
  { path:'/credits',      icon:'credits',      label:'Credits & Debts',liteShow: false },
  { path:'/transfers',    icon:'transfers',    label:'Transfers',      liteShow: false },
  { path:'/accounting',   icon:'accounting',   label:'Accounting',     liteShow: false },
  { path:'/ocr',          icon:'scan',         label:'Scan Receipt',   liteShow: true  },
  { path:'/reports',      icon:'reports',      label:'Reports',        liteShow: false },
  { path:'/audit',        icon:'reports',      label:'Audit Log',      liteShow: false },
  { path:'/sales',       icon:'store',        label:'Point of Sale',  liteShow: true  },
  { path:'/settings',    icon:'settings',     label:'Settings',       liteShow: false },
]

export function renderNav(container) {
  const { stores, currentStore } = appStore.getState()
  const path  = window.location.pathname
  const isPro = !document.body.classList.contains('lite-mode')

  container.className = 'sidebar'

  container.innerHTML = `
    <!-- Logo -->
    <div class="sidebar-logo">
      <div class="logo-mark">
        ${renderIcon('store', 14, '#fff')}
      </div>
      Store<span>OS</span>
    </div>

    <!-- Collapse toggle -->
    <button id="sidebar-collapse" style="
      position:absolute;top:1.25rem;right:-12px;
      width:24px;height:24px;border-radius:50%;
      background:var(--bg-elevated);border:1.5px solid var(--border);
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;z-index:10;color:var(--muted);
      box-shadow:var(--shadow-xs);
      transition:all 0.2s;
    ">${renderIcon('chevronDown', 13)}</button>

    <!-- Mode toggle -->
    <div class="mode-toggle-wrap">
      <button class="mode-toggle-btn" id="mode-toggle-btn">
        <div class="mode-label ${!isPro ? 'active' : ''}">
          ${renderIcon('sun', 13, 'currentColor')}
          Lite
        </div>
        <div class="mode-pill">
          <div class="mode-pip ${!isPro ? 'active' : ''}" data-mode="lite">L</div>
          <div class="mode-pip ${isPro  ? 'active' : ''}" data-mode="pro">P</div>
        </div>
        <div class="mode-label ${isPro ? 'active' : ''}">
          Pro
          ${renderIcon('zap', 13, 'currentColor')}
        </div>
      </button>
    </div>

    <!-- Search -->
    <button class="sidebar-search" id="nav-search-btn">
      ${renderIcon('search', 14, 'currentColor')}
      <span>Search...</span>
      <span class="search-hint">⌘K</span>
    </button>

    <!-- Store switcher -->
    <div class="store-switcher">
      ${renderIcon('building', 13, 'rgba(255,255,255,0.4)')}
      <select id="store-select">
        ${stores.map(s => `
          <option value="${s.id}" ${currentStore?.id === s.id ? 'selected' : ''}>${s.name}</option>
        `).join('')}
        <option value="joint">Joint View</option>
      </select>
      <button id="btn-add-store-nav" style="
        flex-shrink:0;width:20px;height:20px;
        border-radius:50%;background:rgba(255,255,255,0.1);
        display:flex;align-items:center;justify-content:center;
        color:rgba(255,255,255,0.5);transition:all 0.15s;
        border:1px solid rgba(255,255,255,0.1);
      " title="Add new store">
        ${renderIcon('plus', 11, 'currentColor')}
      </button>
    </div>

    <!-- Navigation -->
    <nav class="nav-section">
      <div class="nav-label">Menu</div>
      ${NAV_ITEMS.map(item => `
        <div class="nav-item ${path === item.path ? 'active' : ''} ${!item.liteShow ? 'lite-hidden-nav' : ''}"
             data-path="${item.path}">
          <div class="nav-icon-wrap">
            ${renderIcon(item.icon, 17, 'currentColor')}
          </div>
          ${item.label}
        </div>
      `).join('')}
    </nav>

    <!-- Sidebar bottom stats -->
    <div class="sidebar-bottom">
      <div class="sb-row" id="sb-clock-row">
        <div class="sb-icon-wrap">${renderIcon('dashboard', 13, 'currentColor')}</div>
        <div>
          <div class="sb-val" id="sb-time">--:--</div>
          <div class="sb-sub" id="sb-date">Loading...</div>
        </div>
      </div>

      <div class="sb-divider"></div>

      <div class="sb-row">
        <div class="sb-icon-wrap">${renderIcon('scan', 13, 'currentColor')}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between">
            <div class="sb-label">OCR Scans</div>
            <div class="sb-val" id="sb-ocr-count">—/900</div>
          </div>
          <div class="sb-progress-bar">
            <div class="sb-progress-fill" id="sb-ocr-bar" style="width:0%"></div>
          </div>
          <div class="sb-sub" id="sb-ocr-sub">This month</div>
        </div>
      </div>

      <div class="sb-divider"></div>

      <div class="sb-row">
        <div class="sb-icon-wrap">${renderIcon('cash', 13, 'currentColor')}</div>
        <div>
          <div class="sb-label">Total Cash</div>
          <div class="sb-val accent" id="sb-cash">—</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding:0.5rem 0">
        <div>
          <div class="sb-label">Sales</div>
          <div class="sb-val" style="color:#4ADE80;font-size:0.8rem" id="sb-sales">—</div>
        </div>
        <div>
          <div class="sb-label">Expenses</div>
          <div class="sb-val" style="color:#F87171;font-size:0.8rem" id="sb-expenses">—</div>
        </div>
      </div>

      <div class="sb-divider"></div>

      <!-- Logout -->
      <button class="sidebar-logout" id="btn-logout">
        ${renderIcon('logout', 15, 'currentColor')}
        Sign out
      </button>
    </div>
  `

  // ── Nav clicks ───────────────────────────────────────────
  container.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.path))
  })

  // Sidebar collapse
  const collapseBtn = container.querySelector('#sidebar-collapse')
  const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true'

  function applyCollapse(collapsed) {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '224px')
    container.style.overflow = collapsed ? 'hidden' : ''

    // Hide labels and non-essential elements
    container.querySelectorAll('.nav-item').forEach(el => {
      const label = el.childNodes[el.childNodes.length - 1]
      if (label && label.nodeType === 3) {
        el.style.justifyContent = collapsed ? 'center' : ''
        el.title = collapsed ? el.textContent.trim() : ''
      }
    })

    container.querySelector('.sidebar-logo').style.opacity         = collapsed ? '0' : '1'
    container.querySelector('.sidebar-search').style.display       = collapsed ? 'none' : ''
    container.querySelector('.store-switcher').style.display       = collapsed ? 'none' : ''
    container.querySelector('.nav-label').style.display            = collapsed ? 'none' : ''
    container.querySelector('.mode-toggle-wrap').style.display     = collapsed ? 'none' : ''
    container.querySelector('.sidebar-bottom').style.display       = collapsed ? 'none' : ''

    // Rotate chevron
    collapseBtn.style.transform = collapsed
      ? 'rotate(-90deg) translateY(4px)'
      : 'rotate(90deg) translateY(4px)'

    localStorage.setItem('sidebar-collapsed', collapsed)
  }

  applyCollapse(isCollapsed)
  collapseBtn.addEventListener('click', () => {
    applyCollapse(localStorage.getItem('sidebar-collapsed') !== 'true')
  })

  // ── Store switcher ───────────────────────────────────────
  container.querySelector('#store-select').addEventListener('change', e => {
    const val = e.target.value
    const { stores } = appStore.getState()
    if (val === 'joint') {
      appStore.getState().setAccountingView('joint')
      appStore.getState().setCurrentStore(null)
    } else {
      appStore.getState().setCurrentStore(stores.find(s => s.id === val))
      appStore.getState().setAccountingView('separate')
    }
    navigate(window.location.pathname)
  })

  container.querySelector('#btn-add-store-nav')?.addEventListener('click', () => {
    import('./add-store-modal.js').then(({ openAddStoreModal }) => {
      openAddStoreModal(newStore => {
        appStore.getState().setCurrentStore(newStore)
        navigate(window.location.pathname)
      })
    })
  })

  // ── Mode toggle ───────────────────────────────────────────
  container.querySelector('#mode-toggle-btn').addEventListener('click', () => {
    const currentlyPro = !document.body.classList.contains('lite-mode')
    setMode(!currentlyPro)
  })

  container.querySelectorAll('.mode-pip').forEach(pip => {
    pip.addEventListener('click', e => {
      e.stopPropagation()
      setMode(pip.dataset.mode === 'pro')
    })
  })

  function setMode(pro) {
    localStorage.setItem('storeos-mode', pro ? 'pro' : 'lite')
    document.body.classList.toggle('lite-mode', !pro)
    // Re-render nav to update pip states
    renderNav(container)
    // Re-render current page
    navigate(window.location.pathname)
  }

  // ── Search ────────────────────────────────────────────────
  const search = initSearch()
  container.querySelector('#nav-search-btn').addEventListener('click', () => search.open())

  // ── Logout ────────────────────────────────────────────────
  container.querySelector('#btn-logout')?.addEventListener('click', async () => {
    await audit.logout()
    await supabase.auth.signOut()
    navigate('/auth')
  })

  // ── Live clock ────────────────────────────────────────────
  function updateClock() {
    const now  = new Date()
    const time = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
    const date = now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
    const t = document.getElementById('sb-time')
    const d = document.getElementById('sb-date')
    if (t) t.textContent = time
    if (d) d.textContent = date
  }
  updateClock()
  const clockTimer = setInterval(updateClock, 10000)

  // ── Live stats ────────────────────────────────────────────
  async function loadStats() {
    const { currentStore, accountingView, stores: allStores } = appStore.getState()
    const storeIds = accountingView === 'joint'
      ? allStores.map(s => s.id)
      : [currentStore?.id].filter(Boolean)

    if (!storeIds.length) return

    const today     = new Date().toISOString().split('T')[0]
    const yearMonth = new Date().toISOString().slice(0, 7)

    const [{ data: accounts }, { data: sales }, { data: expenses }, { data: usage }] = await Promise.all([
      supabase.from('cash_accounts').select('balance').in('store_id', storeIds),
      supabase.from('sales').select('total_amount').in('store_id', storeIds).eq('sale_date', today),
      supabase.from('expenses').select('amount').in('store_id', storeIds).eq('expense_date', today),
      supabase.from('ocr_usage').select('scan_count').in('store_id', storeIds).eq('year_month', yearMonth),
    ])

    const totalCash  = (accounts||[]).reduce((s,a) => s + Number(a.balance), 0)
    const todaySales = (sales||[]).reduce((s,r) => s + Number(r.total_amount), 0)
    const todayExp   = (expenses||[]).reduce((s,r) => s + Number(r.amount), 0)
    const scans      = (usage||[]).reduce((s,r) => s + Number(r.scan_count), 0)
    const pct        = Math.min(Math.round(scans / 900 * 100), 100)

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
    const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val }

    set('sb-cash',     fmt(totalCash) + ' ETB')
    set('sb-sales',    fmt(todaySales))
    set('sb-expenses', fmt(todayExp))
    set('sb-ocr-count', `${scans}/900`)
    set('sb-ocr-sub',   `${900 - scans} scans left`)
    setStyle('sb-ocr-bar', 'width', `${pct}%`)
    setStyle('sb-ocr-bar', 'background', pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent)')
  }

  loadStats()
  const statsTimer = setInterval(loadStats, 30000)

  // Cleanup
  container._cleanup = () => {
    clearInterval(clockTimer)
    clearInterval(statsTimer)
  }
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}