import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { formatDateShort } from '../utils/format-date.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  // Default date range — current month
  const now        = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
  const today      = now.toISOString().split('T')[0]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Reports</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
    </div>

    <!-- Date range picker -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
        <input type="date" class="form-input" id="from-date" value="${monthStart}" style="max-width:160px">
        <span style="color:var(--muted)">to</span>
        <input type="date" class="form-input" id="to-date" value="${today}" style="max-width:160px">
        <button class="btn btn-primary btn-sm" id="btn-run">Generate Report</button>
        <div style="display:flex;gap:0.5rem;margin-left:auto">
          <button class="btn btn-outline btn-sm" data-preset="today">Today</button>
          <button class="btn btn-outline btn-sm" data-preset="week">This Week</button>
          <button class="btn btn-outline btn-sm" data-preset="month">This Month</button>
        </div>
      </div>
    </div>

    <!-- KPI summary -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1rem">
      <div class="kpi-card">
        <div class="kpi-label">Total Sales</div>
        <div class="kpi-value accent" id="r-sales">—</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Expenses</div>
        <div class="kpi-value" id="r-expenses">—</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Net Profit</div>
        <div class="kpi-value" id="r-profit">—</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Inventory Value</div>
        <div class="kpi-value" id="r-inventory">—</div>
        <div class="kpi-sub">ETB</div>
      </div>
    </div>

    <!-- Charts row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div class="card">
        <div style="font-weight:600;margin-bottom:1rem">Sales vs Expenses</div>
        <canvas id="chart-overview" height="200"></canvas>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:1rem">Expenses by Category</div>
        <canvas id="chart-categories" height="200"></canvas>
      </div>
    </div>

    <!-- Bottom row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="card">
        <div style="font-weight:600;margin-bottom:1rem">Top Selling Items</div>
        <div id="top-items">—</div>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:1rem">Cash Position Summary</div>
        <div id="cash-summary">—</div>
      </div>
    </div>
  `

  // Load Chart.js from CDN
  if (!window.Chart) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  let overviewChart    = null
  let categoriesChart  = null

  // ── Preset buttons ─────────────────────────────────────────
  container.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = new Date()
      const t = n.toISOString().split('T')[0]
      if (btn.dataset.preset === 'today') {
        container.querySelector('#from-date').value = t
        container.querySelector('#to-date').value   = t
      } else if (btn.dataset.preset === 'week') {
        const w = new Date(n - 6 * 86400000).toISOString().split('T')[0]
        container.querySelector('#from-date').value = w
        container.querySelector('#to-date').value   = t
      } else if (btn.dataset.preset === 'month') {
        const m = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`
        container.querySelector('#from-date').value = m
        container.querySelector('#to-date').value   = t
      }
      runReport()
    })
  })

  container.querySelector('#btn-run').addEventListener('click', runReport)

  async function runReport() {
    const from = container.querySelector('#from-date').value
    const to   = container.querySelector('#to-date').value
    if (!from || !to) { alert('Select a date range'); return }

    const [{ data: sales }, { data: expenses }, { data: items }, { data: accounts }] = await Promise.all([
      supabase.from('sales').select('*').in('store_id', storeIds).gte('sale_date', from).lte('sale_date', to),
      supabase.from('expenses').select('*').in('store_id', storeIds).gte('expense_date', from).lte('expense_date', to),
      supabase.from('inventory_items').select('item_name, quantity, unit_cost, selling_price').in('store_id', storeIds),
      supabase.from('cash_accounts').select('*, stores(name)').in('store_id', storeIds),
    ])

    const totalSales    = (sales    || []).reduce((s, r) => s + Number(r.total_amount), 0)
    const totalExpenses = (expenses || []).reduce((s, r) => s + Number(r.amount), 0)
    const netProfit     = totalSales - totalExpenses
    const invValue      = (items    || []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost || 0), 0)

    // KPIs
    container.querySelector('#r-sales').textContent    = fmt(totalSales)
    container.querySelector('#r-expenses').textContent = fmt(totalExpenses)
    const profitEl = container.querySelector('#r-profit')
    profitEl.textContent = fmt(netProfit)
    profitEl.style.color = netProfit >= 0 ? 'var(--accent)' : 'var(--danger)'
    container.querySelector('#r-inventory').textContent = fmt(invValue)

    // ── Overview chart (daily sales vs expenses) ───────────
    const days     = getDayRange(from, to)
    const salesMap = {}
    const expMap   = {}
    days.forEach(d => { salesMap[d] = 0; expMap[d] = 0 });
    (sales    || []).forEach(s => { if (salesMap[s.sale_date]    !== undefined) salesMap[s.sale_date]    += Number(s.total_amount) });
    (expenses || []).forEach(e => { if (expMap[e.expense_date]   !== undefined) expMap[e.expense_date]   += Number(e.amount) })

    if (overviewChart) overviewChart.destroy()
    overviewChart = new window.Chart(container.querySelector('#chart-overview'), {
      type: 'bar',
      data: {
        labels: days.map(d => formatDateShort(d)),
        datasets: [
          { label: 'Sales',    data: days.map(d => salesMap[d]), backgroundColor: '#0d9488' },
          { label: 'Expenses', data: days.map(d => expMap[d]),   backgroundColor: '#f87171' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true } }
      }
    })

    // ── Categories chart ───────────────────────────────────
    const catTotals = {}
    ;(expenses || []).forEach(e => {
      const cat = e.category || 'Uncategorized'
      catTotals[cat] = (catTotals[cat] || 0) + Number(e.amount)
    })
    const catLabels = Object.keys(catTotals)
    const catValues = Object.values(catTotals)

    if (categoriesChart) categoriesChart.destroy()
    if (catLabels.length > 0) {
      categoriesChart = new window.Chart(container.querySelector('#chart-categories'), {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catValues,
            backgroundColor: ['#0d9488','#14b8a6','#f59e0b','#f87171','#6366f1','#22c55e','#64748b'],
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } }
        }
      })
    } else {
      container.querySelector('#chart-categories').parentElement.innerHTML +=
        `<div class="empty"><div class="empty-text">No expense data in range</div></div>`
    }

    // ── Top items ──────────────────────────────────────────
    const topEl = container.querySelector('#top-items')
    const sorted = [...(items || [])].sort((a, b) =>
      Number(b.quantity) * Number(b.selling_price || 0) -
      Number(a.quantity) * Number(a.selling_price || 0)
    ).slice(0, 6)

    if (sorted.length === 0) {
      topEl.innerHTML = `<div class="empty"><div class="empty-text">No inventory data</div></div>`
    } else {
      topEl.innerHTML = sorted.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.55rem 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:500;font-size:13.5px">${i.item_name}</div>
            <div style="font-size:11.5px;color:var(--muted)">Qty: ${i.quantity}</div>
          </div>
          <div style="font-weight:600;color:var(--accent)">
            ${fmt(Number(i.quantity) * Number(i.selling_price || 0))} ETB
          </div>
        </div>
      `).join('')
    }

    // ── Cash summary ───────────────────────────────────────
    const cashEl = container.querySelector('#cash-summary')
    const total  = (accounts || []).reduce((s, a) => s + Number(a.balance), 0)

    cashEl.innerHTML = `
      ${(accounts || []).map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.55rem 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:500;font-size:13.5px">${a.name}</div>
            <div style="font-size:11.5px;color:var(--muted)">${a.account_type === 'till' ? '🏪 Till' : '🏦 Bank'} · ${a.stores?.name ?? ''}</div>
          </div>
          <div style="font-weight:700;color:var(--accent)">${fmt(a.balance)} ETB</div>
        </div>
      `).join('')}
      <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;font-weight:700">
        <span>Total Cash</span>
        <span style="color:var(--accent)">${fmt(total)} ETB</span>
      </div>
    `
  }

  // Run on load with default range
  await runReport()
}

function getDayRange(from, to) {
  const days = []
  const cur  = new Date(from)
  const end  = new Date(to)
  while (cur <= end) {
    days.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}