import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { getDashboardData } from '../utils/db.js'
import { renderIcon } from '../components/icons.js'

export async function render(container) {
  const { currentStore, accountingView } = appStore.getState()
  const isLite = document.body.classList.contains('lite-mode')

  if (isLite) { await renderLite(container); return }

  // ── 1. Paint skeleton instantly ───────────────────────────
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-refresh">
        ${renderIcon('refresh', 14)} Refresh
      </button>
    </div>

    <!-- KPI skeleton -->
    <div class="kpi-grid" id="kpi-grid">
      ${[1,2,3,4].map(() => `
        <div class="kpi-card">
          <div class="skeleton" style="height:12px;width:60%;margin-bottom:8px;border-radius:4px"></div>
          <div class="skeleton" style="height:28px;width:80%;border-radius:4px"></div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
      <div class="card" id="cash-positions">
        <div style="font-weight:600;margin-bottom:1rem">💰 Cash Positions</div>
        <div id="cash-list">
          ${[1,2,3].map(() => `
            <div style="display:flex;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid var(--border)">
              <div class="skeleton" style="height:14px;width:40%;border-radius:4px"></div>
              <div class="skeleton" style="height:14px;width:25%;border-radius:4px"></div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card" id="low-stock-card">
        <div style="font-weight:600;margin-bottom:1rem">⚠️ Low Stock Alerts</div>
        <div id="low-stock-list">
          <div class="skeleton" style="height:14px;width:70%;border-radius:4px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:14px;width:50%;border-radius:4px"></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div style="font-weight:600;margin-bottom:1rem">🕒 Recent Activity</div>
      <div id="activity-list">
        ${[1,2,3].map(() => `
          <div style="display:flex;justify-content:space-between;padding:0.65rem 0;border-bottom:1px solid var(--border)">
            <div class="skeleton" style="height:14px;width:45%;border-radius:4px"></div>
            <div class="skeleton" style="height:14px;width:20%;border-radius:4px"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  // ── 2. Add skeleton styles ────────────────────────────────
  injectSkeletonStyles()

  // ── 3. Load data (cached — usually instant on revisit) ────
  const data = await getDashboardData()
  fillDashboard(container, data)

  // ── 4. Refresh button ─────────────────────────────────────
  container.querySelector('#btn-refresh').addEventListener('click', async () => {
    const fresh = await getDashboardData(true)
    fillDashboard(container, fresh)
  })
}

function fillDashboard(container, data) {
  const { totalCash, todaySales, todayExpenses, accounts,
          inventoryItems, recentSales, recentExpenses } = normalizeData(data)

  const profit = todaySales - todayExpenses
  const invVal = inventoryItems.reduce((s,i) => s + Number(i.quantity) * Number(i.unit_cost||0), 0)

  // KPIs
  container.querySelector('#kpi-grid').innerHTML = `
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
    <div class="kpi-card">
      <div class="kpi-label">Today's Profit</div>
      <div class="kpi-value ${profit >= 0 ? 'accent' : ''}"
           style="${profit < 0 ? 'color:var(--danger)' : ''}">${fmt(profit)}</div>
      <div class="kpi-sub">ETB</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Inventory Value</div>
      <div class="kpi-value">${fmt(invVal)}</div>
      <div class="kpi-sub">ETB</div>
    </div>
  `

  // Cash positions
  const total = accounts.reduce((s,a) => s + Number(a.balance), 0)
  container.querySelector('#cash-list').innerHTML = `
    ${accounts.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:500;font-size:13.5px">${a.name}</div>
          <div style="font-size:11.5px;color:var(--muted)">
            ${a.account_type === 'till' ? '🏪 Till' : '🏦 Bank'} · ${a.stores?.name ?? ''}
          </div>
        </div>
        <div style="font-weight:700;color:var(--accent)">${fmt(a.balance)} ETB</div>
      </div>
    `).join('')}
    <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;font-weight:700">
      <span>Total</span>
      <span style="color:var(--accent)">${fmt(total)} ETB</span>
    </div>
  `

  // Low stock
  const low = inventoryItems.filter(i => Number(i.quantity) <= Number(i.low_stock_threshold || 5))
  container.querySelector('#low-stock-list').innerHTML = low.length === 0
    ? `<div class="empty"><div class="empty-icon">${renderIcon('check', 24, 'var(--success)')}</div><div class="empty-text">All items stocked</div></div>`
    : low.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13.5px;font-weight:500">${i.item_name}</div>
          <span class="badge ${Number(i.quantity) === 0 ? 'badge-red' : 'badge-yellow'}">${i.quantity} left</span>
        </div>
      `).join('')

  // Recent activity
  const combined = [
    ...(recentSales||[]).map(s => ({ type:'sale', amount: s.total_amount, label:'Sale recorded', date: s.created_at })),
    ...(recentExpenses||[]).map(e => ({ type:'expense', amount: e.amount, label: e.description || 'Expense', date: e.created_at })),
  ].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,8)

  container.querySelector('#activity-list').innerHTML = combined.length === 0
    ? `<div class="empty"><div class="empty-text">No activity yet</div></div>`
    : combined.map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <span style="font-size:1.1rem">${a.type === 'sale' ? '💚' : '🔴'}</span>
            <div>
              <div style="font-size:13.5px;font-weight:500">${a.label}</div>
              <div style="font-size:11.5px;color:var(--muted)">${timeAgo(a.date)}</div>
            </div>
          </div>
          <div style="font-weight:600;color:${a.type === 'sale' ? 'var(--accent)' : 'var(--danger)'}">
            ${a.type === 'sale' ? '+' : '-'}${fmt(a.amount)} ETB
          </div>
        </div>
      `).join('')
}

function normalizeData(data) {
  return {
    accounts:       data.accounts       || [],
    todaySales:     data.todaySales      || 0,
    todayExpenses:  data.todayExpenses   || 0,
    inventoryItems: data.inventoryItems  || [],
    recentSales:    data.recentSales     || [],
    recentExpenses: data.recentExpenses  || [],
    totalCash: (data.accounts||[]).reduce((s,a) => s + Number(a.balance), 0),
  }
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