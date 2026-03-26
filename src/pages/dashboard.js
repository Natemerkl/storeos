import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { getDashboardData } from '../utils/db.js'
import { renderIcon } from '../components/icons.js'

export async function render(container) {
  const { currentStore, accountingView } = appStore.getState()
  const isLite = document.body.classList.contains('lite-mode')

  if (isLite) { await renderLite(container); return }

  // Paint skeleton
  container.innerHTML = buildSkeleton(currentStore, accountingView)
  injectSkeletonStyles()

  // Create a "is this render still active" check
  const renderToken = Symbol()
  container._renderToken = renderToken

  const isStale = () => container._renderToken !== renderToken || !document.body.contains(container)

  const data = await getDashboardData()
  if (isStale()) return  // user navigated away

  fillDashboard(container, data, isStale)

  container.querySelector('#btn-refresh')?.addEventListener('click', async () => {
    if (isStale()) return
    const fresh = await getDashboardData(true)
    if (isStale()) return
    fillDashboard(container, fresh, isStale)
  })
}

function buildSkeleton(currentStore, accountingView) {
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // Mobile Telebirr-style header
    return `
      <div class="telebirr-header">
        <div class="telebirr-header-top">
          <div class="telebirr-user">
            <div class="telebirr-avatar">${(currentStore?.name || 'S').charAt(0).toUpperCase()}</div>
            <div>
              <div class="telebirr-name">${currentStore?.name || 'Store 1'}</div>
              <div class="telebirr-store">Wed 14 Megabit 2017 · EN / AM</div>
            </div>
          </div>
          <div class="telebirr-icons">
            <div class="telebirr-icon" id="store-selector-btn">▼</div>
            <div class="telebirr-icon">${renderIcon('search', 14)}</div>
            <div class="telebirr-icon">${renderIcon('alert', 14)}</div>
          </div>
        </div>
        <div class="telebirr-balance-label">
          Total Cash Position (ETB) 
          <div class="telebirr-eye" id="main-balance-eye">o</div>
        </div>
        <div class="telebirr-amount hidden" id="main-balance-amount">* * * * * *</div>
        <div class="telebirr-sub">
          <div class="telebirr-sub-item">
            <div class="telebirr-sub-label">
              Store Till
              <div class="telebirr-eye" id="till-balance-eye">o</div>
            </div>
            <div class="telebirr-sub-amount hidden" id="till-balance-amount">* * * * *</div>
          </div>
          <div class="telebirr-sub-item">
            <div class="telebirr-sub-label right">
              Bank Account
              <div class="telebirr-eye" id="bank-balance-eye">o</div>
            </div>
            <div class="telebirr-sub-amount hidden" id="bank-balance-amount">* * * * *</div>
          </div>
        </div>
      </div>
      <div class="action-grid" id="action-grid">
        ${[1,2,3,4,5,6,7,8].map(() => `
          <div class="action-card">
            <div class="action-icon skeleton" style="width:36px;height:36px;border-radius:10px;margin:0 auto 6px;"></div>
            <div class="action-label skeleton" style="height:12px;width:60%;margin:0 auto;border-radius:4px"></div>
          </div>
        `).join('')}
      </div>
      <div class="scan-button" id="scan-button">
        <div class="scan-icon skeleton" style="width:22px;height:22px;border:2px solid rgba(255,255,255,0.7);border-radius:4px;margin-right:10px;"></div>
        <span class="skeleton" style="height:14px;width:80px;border-radius:4px;">Scan Receipt</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
        <div class="card" id="cash-card">
          <div style="font-weight:600;margin-bottom:1rem">Cash Positions</div>
          <div id="cash-list">
            ${[1,2].map(() => `
              <div style="display:flex;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid var(--border)">
                <div class="skeleton" style="height:13px;width:40%;border-radius:4px"></div>
                <div class="skeleton" style="height:13px;width:22%;border-radius:4px"></div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:1rem">Low Stock Alerts</div>
          <div id="low-stock-list">
            <div class="skeleton" style="height:13px;width:65%;border-radius:4px;margin-bottom:8px"></div>
            <div class="skeleton" style="height:13px;width:45%;border-radius:4px"></div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <div style="font-weight:600;margin-bottom:1rem">Recent Activity</div>
        <div id="activity-list">
          ${[1,2,3].map(() => `
            <div style="display:flex;justify-content:space-between;padding:0.65rem 0;border-bottom:1px solid var(--border)">
              <div class="skeleton" style="height:13px;width:42%;border-radius:4px"></div>
              <div class="skeleton" style="height:13px;width:18%;border-radius:4px"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Desktop layout (unchanged)
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-refresh">
        ${renderIcon('refresh', 14)} Refresh
      </button>
    </div>
    <div class="kpi-grid" id="kpi-grid">
      ${[1,2,3,4].map(() => `
        <div class="kpi-card">
          <div class="skeleton" style="height:11px;width:55%;margin-bottom:8px;border-radius:4px"></div>
          <div class="skeleton" style="height:32px;width:75%;border-radius:4px"></div>
        </div>
      `).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
      <div class="card" id="cash-card">
        <div style="font-weight:600;margin-bottom:1rem">Cash Positions</div>
        <div id="cash-list">
          ${[1,2].map(() => `
            <div style="display:flex;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid var(--border)">
              <div class="skeleton" style="height:13px;width:40%;border-radius:4px"></div>
              <div class="skeleton" style="height:13px;width:22%;border-radius:4px"></div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:1rem">Low Stock Alerts</div>
        <div id="low-stock-list">
          <div class="skeleton" style="height:13px;width:65%;border-radius:4px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:13px;width:45%;border-radius:4px"></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <div style="font-weight:600;margin-bottom:1rem">Recent Activity</div>
      <div id="activity-list">
        ${[1,2,3].map(() => `
          <div style="display:flex;justify-content:space-between;padding:0.65rem 0;border-bottom:1px solid var(--border)">
            <div class="skeleton" style="height:13px;width:42%;border-radius:4px"></div>
            <div class="skeleton" style="height:13px;width:18%;border-radius:4px"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function fillDashboard(container, data, isStale) {
  if (isStale?.()) return

  const get = (id) => container.querySelector(id)
  const isMobile = window.innerWidth <= 768
  const { currentStore, stores, accountingView } = appStore.getState()
  
  if (!get('#kpi-grid') && !get('#action-grid')) return

  const accounts      = data.accounts      || []
  const todaySales    = data.todaySales    || 0
  const todayExpenses = data.todayExpenses || 0
  const items         = data.inventoryItems || []
  const recentSales   = data.recentSales   || []
  const recentExpenses= data.recentExpenses|| []

  const profit = todaySales - todayExpenses
  const invVal = items.reduce((s,i) => s + Number(i.quantity) * Number(i.unit_cost||0), 0)
  const totalCash = accounts.reduce((s,a) => s + Number(a.balance), 0)

  // Mobile layout with action grid and scan button
  if (isMobile) {
    // Fill action grid
    const actionGrid = get('#action-grid')
    if (actionGrid) {
      const actions = [
        { icon: 'store', label: 'Point of Sale', path: '/sales' },
        { icon: 'inventory', label: 'Inventory', path: '/inventory' },
        { icon: 'transactions', label: 'Sales History', path: '/sales-history' },
        { icon: 'transfers', label: 'Cash Transfer', path: '/transfers' },
        { icon: 'transactions', label: 'Transactions', path: '/transactions' },
        { icon: 'expenses', label: 'Expenses', path: '/expenses' },
        { icon: 'credits', label: 'Credits & Debts', path: '/credits' },
        { icon: 'reports', label: 'Reports', path: '/reports' }
      ]
      
      actionGrid.innerHTML = actions.map(action => `
        <div class="action-card" data-path="${action.path}">
          <div class="action-icon">${renderIcon(action.icon, 20)}</div>
          <div class="action-label">${action.label}</div>
        </div>
      `).join('')

      // Add click handlers
      actionGrid.querySelectorAll('.action-card').forEach(card => {
        card.addEventListener('click', () => {
          import('../router.js').then(m => m.navigate(card.dataset.path))
        })
      })
    }

    // Fill scan button
    const scanButton = get('#scan-button')
    if (scanButton) {
      scanButton.innerHTML = `
        <div class="scan-icon">[ ]</div>
        Scan Receipt
      `
      scanButton.addEventListener('click', () => {
        import('../router.js').then(m => m.navigate('/ocr'))
      })
    }

    // Setup eye toggles and balance visibility
    setupBalanceToggles(container, accounts, totalCash)
    
    // Setup store selector
    setupStoreSelector(container, stores, currentStore, accountingView)
    
    // Setup search icon
    setupSearchIcon(container)
    
    // Fill KPI cards (mobile: 2x2 grid showing all 4 cards)
    if (isStale?.()) return
    const kpiGrid = get('#kpi-grid')
    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-label">Today's Sales</div>
          <div class="kpi-value accent">${fmt(todaySales)}</div>
          <div class="kpi-sub">ETB</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Today's Expenses</div>
          <div class="kpi-value">${fmt(todayExpenses)}</div>
          <div class="kpi-sub">ETB</div>
        </div>
        <div class="kpi-card" id="profit-card" style="cursor:pointer">
          <div class="kpi-label">Today's Profit</div>
          <div class="kpi-value ${profit>=0?'accent':''}" style="${profit<0?'color:var(--danger)':''}">
            ${fmt(profit)}
          </div>
          <div class="kpi-sub" style="color:var(--accent);font-size:10px">tap for breakdown</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Inventory Value</div>
          <div class="kpi-value">${fmt(invVal)}</div>
          <div class="kpi-sub">ETB</div>
        </div>
      `
    }
  } else {
    // Desktop layout (unchanged)
    if (isStale?.()) return
    get('#kpi-grid').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Today's Sales</div>
        <div class="kpi-value accent">${fmt(todaySales)}</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Today's Expenses</div>
        <div class="kpi-value">${fmt(todayExpenses)}</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card" id="profit-card" style="cursor:pointer">
        <div class="kpi-label">Today's Profit</div>
        <div class="kpi-value ${profit>=0?'accent':''}" style="${profit<0?'color:var(--danger)':''}">
          ${fmt(profit)}
        </div>
        <div class="kpi-sub" style="color:var(--accent);font-size:10px">click for breakdown</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Inventory Value</div>
        <div class="kpi-value">${fmt(invVal)}</div>
        <div class="kpi-sub">ETB</div>
      </div>
    `
  }

  // Profit card click → breakdown modal
  get('#profit-card')?.addEventListener('click', () => openProfitModal())

  // Fill cash positions (both mobile and desktop) - remove emojis
  if (isStale?.()) return
  const cashEl = get('#cash-list')
  if (cashEl) cashEl.innerHTML = `
    ${accounts.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:500;font-size:13.5px">${a.name}</div>
          <div style="font-size:11.5px;color:var(--muted)">
            ${a.account_type==='till'?'Till':'Bank'} · ${a.stores?.name??''}
          </div>
        </div>
        <div style="font-weight:700;color:var(--accent)">${fmt(a.balance)} ETB</div>
      </div>
    `).join('')}
    <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;font-weight:700">
      <span>Total</span>
      <span style="color:var(--accent)">${fmt(totalCash)} ETB</span>
    </div>
  `

  // Fill low stock alerts (remove emojis)
  if (isStale?.()) return
  const low = items.filter(i => Number(i.quantity) <= Number(i.low_stock_threshold||5))
  const lowEl = get('#low-stock-list')
  if (lowEl) lowEl.innerHTML = low.length === 0
    ? `<div class="empty"><div class="empty-icon">${renderIcon('check',24,'var(--success)')}</div><div class="empty-text">All items stocked</div></div>`
    : low.map(i => `
        <div class="low-stock-item" data-item-id="${i.id}" style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <div style="font-size:13.5px;font-weight:500">${i.item_name}</div>
          <span class="badge ${Number(i.quantity)===0?'badge-red':'badge-yellow'}">${i.quantity} left</span>
        </div>
      `).join('')

    // Add click handlers for low stock items
    lowEl.querySelectorAll('.low-stock-item').forEach(item => {
      item.addEventListener('click', () => {
        const itemId = item.dataset.itemId
        import('../router.js').then(m => m.navigate(`/inventory?item=${itemId}`))
      })
    })

  // Fill recent activity (remove emojis, use colored circles)
  if (isStale?.()) return
  const combined = [
    ...(recentSales||[]).map(s=>({type:'sale',amount:s.total_amount,label:'Sale recorded',date:s.created_at})),
    ...(recentExpenses||[]).map(e=>({type:'expense',amount:e.amount,label:e.description||'Expense',date:e.created_at})),
  ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8)

  const actEl = get('#activity-list')
  if (actEl) actEl.innerHTML = combined.length===0
    ? `<div class="empty"><div class="empty-text">No activity yet</div></div>`
    : combined.map(a=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <span style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;background:${a.type==='sale'?'var(--accent)':'var(--danger)'};color:#fff;">•</span>
            <div>
              <div style="font-size:13.5px;font-weight:500">${a.label}</div>
              <div style="font-size:11.5px;color:var(--muted)">${timeAgo(a.date)}</div>
            </div>
          </div>
          <div style="font-weight:600;color:${a.type==='sale'?'var(--accent)':'var(--danger)'}">
            ${a.type==='sale'?'+':'-'}${fmt(a.amount)} ETB
          </div>
        </div>
      `).join('')

  // Setup refresh button for desktop
  if (!isMobile) {
    container.querySelector('#btn-refresh')?.addEventListener('click', async () => {
      if (isStale()) return
      const fresh = await getDashboardData(true)
      if (isStale()) return
      fillDashboard(container, fresh, isStale)
    })
  }
}

function setupBalanceToggles(container, accounts, totalCash) {
  const mainEye = container.querySelector('#main-balance-eye')
  const tillEye = container.querySelector('#till-balance-eye')
  const bankEye = container.querySelector('#bank-balance-eye')
  const mainAmount = container.querySelector('#main-balance-amount')
  const tillAmount = container.querySelector('#till-balance-amount')
  const bankAmount = container.querySelector('#bank-balance-amount')

  let mainVisible = false
  let tillVisible = false
  let bankVisible = false

  // Calculate sub-amounts
  const tillBalance = accounts.filter(a => a.account_type === 'till').reduce((s, a) => s + Number(a.balance), 0)
  const bankBalance = accounts.filter(a => a.account_type === 'bank').reduce((s, a) => s + Number(a.balance), 0)

  // Main balance toggle
  if (mainEye && mainAmount) {
    mainEye.addEventListener('click', () => {
      mainVisible = !mainVisible
      mainAmount.classList.toggle('hidden', !mainVisible)
      mainEye.textContent = mainVisible ? '👁' : 'o'
      if (mainVisible) {
        mainAmount.textContent = fmt(totalCash)
      } else {
        mainAmount.textContent = '* * * * * *'
      }
    })
  }

  // Till balance toggle
  if (tillEye && tillAmount) {
    tillEye.addEventListener('click', () => {
      tillVisible = !tillVisible
      tillAmount.classList.toggle('hidden', !tillVisible)
      tillEye.textContent = tillVisible ? '👁' : 'o'
      if (tillVisible) {
        tillAmount.textContent = fmt(tillBalance)
      } else {
        tillAmount.textContent = '* * * *'
      }
    })
  }

  // Bank balance toggle
  if (bankEye && bankAmount) {
    bankEye.addEventListener('click', () => {
      bankVisible = !bankVisible
      bankAmount.classList.toggle('hidden', !bankVisible)
      bankEye.textContent = bankVisible ? '👁' : 'o'
      if (bankVisible) {
        bankAmount.textContent = fmt(bankBalance)
      } else {
        bankAmount.textContent = '* * * *'
      }
    })
  }
}

function setupSearchIcon(container) {
  const searchIcon = container.querySelector('.telebirr-icons .telebirr-icon:nth-child(2)')
  if (!searchIcon) return

  searchIcon.addEventListener('click', () => {
    // Trigger global search
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true
    })
    document.dispatchEvent(event)
  })
}

function setupStoreSelector(container, stores, currentStore, accountingView) {
  const selectorBtn = container.querySelector('#store-selector-btn')
  if (!selectorBtn) return

  selectorBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    
    // Remove existing dropdown
    const existing = document.querySelector('.store-selector-dropdown')
    if (existing) existing.remove()

    // Create dropdown
    const dropdown = document.createElement('div')
    dropdown.className = 'store-selector-dropdown'
    dropdown.innerHTML = `
      <div class="store-selector-option ${accountingView === 'joint' ? 'selected' : ''}" data-view="joint">
        <div>All Stores</div>
      </div>
      ${stores.map(store => `
        <div class="store-selector-option ${currentStore?.id === store.id ? 'selected' : ''}" data-store-id="${store.id}">
          <div>${store.name}</div>
        </div>
      `).join('')}
    `

    // Position dropdown
    const rect = selectorBtn.getBoundingClientRect()
    dropdown.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 5}px;
      right: ${window.innerWidth - rect.right}px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      min-width: 150px;
      max-height: 200px;
      overflow-y: auto;
    `

    document.body.appendChild(dropdown)

    // Handle clicks
    dropdown.querySelectorAll('.store-selector-option').forEach(option => {
      option.addEventListener('click', () => {
        const storeId = option.dataset.storeId
        const view = option.dataset.view

        if (view === 'joint') {
          appStore.setState({ accountingView: 'joint' })
        } else if (storeId) {
          const store = stores.find(s => s.id === storeId)
          appStore.setState({ currentStore: store, accountingView: 'single' })
        }

        dropdown.remove()
        // Reload dashboard
        render(container)
      })
    })

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target)) {
          dropdown.remove()
          document.removeEventListener('click', closeDropdown)
        }
      })
    }, 10)
  })
}

async function renderLite(container) {
  const { currentStore, stores, accountingView } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  // Show skeleton first
  container.innerHTML = `
    <div style="padding-top:0.5rem">
      <div style="font-size:1.6rem;font-weight:800;letter-spacing:-0.5px;margin-bottom:1.25rem">
        ${currentStore?.name || 'My Store'}
      </div>
      <div class="card" style="margin-bottom:1rem;text-align:center;padding:1.5rem">
        <div style="font-size:12px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.4rem">Total Cash</div>
        <div class="skeleton" style="height:44px;width:60%;border-radius:6px;margin:0 auto 0.5rem"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
        <div class="card" style="text-align:center;padding:1rem">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:0.3rem">TODAY IN</div>
          <div class="skeleton" style="height:28px;width:70%;border-radius:4px;margin:0 auto"></div>
        </div>
        <div class="card" style="text-align:center;padding:1rem">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:0.3rem">TODAY OUT</div>
          <div class="skeleton" style="height:28px;width:70%;border-radius:4px;margin:0 auto"></div>
        </div>
      </div>
    </div>
  `
  injectSkeletonStyles()

  const today = new Date().toISOString().split('T')[0]

  const [{ data: accounts }, { data: sales }, { data: expenses }, { data: items }] = await Promise.all([
    supabase.from('cash_accounts').select('balance').in('store_id', storeIds),
    supabase.from('sales').select('total_amount').in('store_id', storeIds).eq('sale_date', today),
    supabase.from('expenses').select('amount').in('store_id', storeIds).eq('expense_date', today),
    supabase.from('inventory_items').select('item_name,quantity,low_stock_threshold').in('store_id', storeIds),
  ])

  const totalCash  = (accounts||[]).reduce((s,a) => s + Number(a.balance), 0)
  const todaySales = (sales||[]).reduce((s,r) => s + Number(r.total_amount), 0)
  const todayExp   = (expenses||[]).reduce((s,r) => s + Number(r.amount), 0)
  const low        = (items||[]).filter(i => Number(i.quantity) <= Number(i.low_stock_threshold || 5))

  container.innerHTML = `
    <div style="padding-top:0.5rem">
      <div style="font-size:1.6rem;font-weight:800;letter-spacing:-0.5px;margin-bottom:1.25rem;
                  font-family:var(--font-display)">
        ${currentStore?.name || 'My Store'}
      </div>
      <div class="card" style="margin-bottom:1rem;text-align:center;padding:1.5rem">
        <div style="font-size:12px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:0.4rem">Total Cash</div>
        <div style="font-size:2.4rem;font-weight:800;color:var(--accent);letter-spacing:-1px">${fmt(totalCash)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:0.2rem">ETB</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
        <div class="card" style="text-align:center;padding:1rem">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:0.3rem">TODAY IN</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">${fmt(todaySales)}</div>
        </div>
        <div class="card" style="text-align:center;padding:1rem">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:0.3rem">TODAY OUT</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--danger)">${fmt(todayExp)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
        <button class="btn btn-primary" style="justify-content:center;padding:1rem;font-size:1rem;border-radius:16px" data-nav="/sales">+ Sale</button>
        <button class="btn btn-outline" style="justify-content:center;padding:1rem;font-size:1rem;border-radius:16px" data-nav="/expenses">+ Expense</button>
      </div>
      <div class="card" id="lite-alerts">
        <div style="font-weight:600;margin-bottom:0.75rem;font-size:13.5px">⚠️ Low Stock</div>
        ${low.length === 0
          ? `<span style="color:var(--accent);font-size:13px">✓ All items stocked</span>`
          : low.map(i => `
              <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">
                <span style="font-size:13px">${i.item_name}</span>
                <span class="badge ${Number(i.quantity)===0?'badge-red':'badge-yellow'}">${i.quantity} left</span>
              </div>
            `).join('')
        }
      </div>
    </div>
  `

  container.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      import('../router.js').then(m => m.navigate(btn.dataset.nav))
    })
  })
}

async function openProfitModal() {
  const { currentStore } = appStore.getState()
  const storeId = currentStore?.id
  if (!storeId) return

  const today = new Date().toISOString().split('T')[0]

  // Load profit settings from user_patterns
  const { data: pattern } = await supabase
    .from('user_patterns')
    .select('pattern_data')
    .eq('store_id', storeId)
    .eq('pattern_key', 'profit_settings')
    .maybeSingle()

  const settings = pattern?.pattern_data || {
    subtract_expenses: true,
    subtract_credits:  false,
    use_cost_price:    false
  }

  // Build and show modal with loading state
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.style.cssText = 'display:flex;'
  overlay.innerHTML = `
    <div class="modal" style="min-width:340px;max-width:460px;width:100%">
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('reports', 18)} Today's Profit Breakdown
        </div>
        <button class="modal-close" id="profit-modal-close">${renderIcon('close', 14)}</button>
      </div>
      <div id="profit-modal-body" style="padding:0.25rem 0">
        <div style="text-align:center;padding:2rem;color:var(--muted)">Calculating...</div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const closeModal = () => overlay.remove()
  overlay.querySelector('#profit-modal-close').addEventListener('click', closeModal)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal() })

  // Call DB function
  const { data, error } = await supabase.rpc('calculate_profit', {
    p_store_id: storeId,
    p_date:     today,
    p_settings: settings
  })

  const body = overlay.querySelector('#profit-modal-body')
  if (!body) return

  if (error || !data) {
    body.innerHTML = `
      <div style="color:var(--danger);padding:1.25rem;text-align:center;font-size:0.875rem">
        ${error?.message || 'Failed to calculate profit.'}
      </div>
    `
    return
  }

  const grossSales   = Number(data.gross_sales   || 0)
  const cogs         = Number(data.cogs          || 0)
  const expenses     = Number(data.expenses      || 0)
  const creditGiven  = Number(data.credit_given  || 0)
  const netProfit    = Number(data.net_profit     || 0)
  const used         = data.settings_used || {}

  const divider = (label, amount, color, prefix) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:0.75rem 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.875rem;color:var(--muted)">${label}</span>
      <span style="font-weight:600;color:${color}">${prefix}${fmt(amount)} ETB</span>
    </div>
  `

  const activeToggles = [
    used.use_cost_price    ? 'cost price' : '',
    used.subtract_expenses ? 'expenses'   : '',
    used.subtract_credits  ? 'credits'    : ''
  ].filter(Boolean)

  body.innerHTML = `
    <div style="padding:0 0 0.5rem">
      ${divider('Gross Sales', grossSales, 'var(--accent)', '+')}
      ${used.use_cost_price    ? divider('Cost of Goods Sold', cogs,        'var(--danger)', '−') : ''}
      ${used.subtract_expenses ? divider('Expenses',           expenses,    'var(--danger)', '−') : ''}
      ${used.subtract_credits  ? divider('Credit Given',       creditGiven, 'var(--danger)', '−') : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 0 0">
        <span style="font-size:1rem;font-weight:700;color:var(--dark)">Net Profit</span>
        <span style="font-size:1.375rem;font-weight:800;color:${netProfit>=0?'var(--accent)':'var(--danger)'}">
          ${fmt(netProfit)} ETB
        </span>
      </div>
      <div style="margin-top:1rem;padding:0.75rem;background:var(--bg-subtle);
                  border-radius:var(--radius);font-size:0.8125rem;color:var(--muted);line-height:1.6">
        ${activeToggles.length
          ? `Subtracting: <strong>${activeToggles.join(', ')}</strong>.`
          : 'Showing gross sales only.'}
        Configure in <strong>Settings → Profit Settings</strong>.
      </div>
    </div>
  `
}

function injectSkeletonStyles() {
  if (document.getElementById('skeleton-styles')) return
  const s = document.createElement('style')
  s.id = 'skeleton-styles'
  s.textContent = `
    .skeleton {
      background: linear-gradient(90deg, var(--gray-100) 25%, var(--gray-50) 50%, var(--gray-100) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `
  document.head.appendChild(s)
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function timeAgo(dateStr) {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  < 1)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
