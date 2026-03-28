import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from '../components/icons.js'
import { formatDate } from '../utils/format-date.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Suppliers & Vendors</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-add-vendor">
        ${renderIcon('plus', 14)} Add Supplier
      </button>
    </div>

    <!-- Summary Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1rem">
      <div class="kpi-card">
        <div class="kpi-label">Total Suppliers</div>
        <div class="kpi-value" id="total-vendors">0</div>
        <div class="kpi-sub">active</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding</div>
        <div class="kpi-value" id="total-outstanding" style="color:var(--danger)">0</div>
        <div class="kpi-sub">ETB owed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">This Month</div>
        <div class="kpi-value" id="month-amount">0.00</div>
        <div class="kpi-sub">ETB spent</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Over 60 Days</div>
        <div class="kpi-value" id="overdue-60" style="color:var(--danger)">0</div>
        <div class="kpi-sub">ETB overdue</div>
      </div>
    </div>

    <!-- Search & Filter -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
        <input class="form-input" id="search" placeholder="Search suppliers..." style="max-width:260px">
        <button class="btn btn-outline btn-sm" id="btn-refresh">
          ${renderIcon('refresh', 14)} Refresh
        </button>
      </div>
    </div>

    <!-- Vendors Table -->
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Supplier Name</th>
              <th>Contact Person</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Outstanding Balance</th>
              <th>Aging</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="vendors-body">
            <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Vendor Modal -->
    <div id="vendor-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="modal-title">Add Supplier</div>
          <button class="modal-close" id="modal-close">${renderIcon('close', 14)}</button>
        </div>
        <div class="form-group">
          <label class="form-label">Supplier Name *</label>
          <input class="form-input" id="f-name" placeholder="e.g. ABC Distributors">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Contact Person</label>
            <input class="form-input" id="f-contact" placeholder="Optional">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" id="f-phone" placeholder="Optional">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" class="form-input" id="f-email" placeholder="Optional">
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input class="form-input" id="f-address" placeholder="Optional">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="f-notes" rows="3" placeholder="Optional notes"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save Supplier</button>
        </div>
      </div>
    </div>

    <!-- Supplier Detail Modal -->
    <div id="supplier-detail-modal" class="modal-overlay" style="display:none">
      <div class="modal" style="max-width:900px">
        <div class="modal-header">
          <div class="modal-title" id="detail-title">Supplier Details</div>
          <button class="modal-close" id="detail-close">${renderIcon('close', 14)}</button>
        </div>
        <div id="detail-content">
          <div style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>
        </div>
      </div>
    </div>
  `

  let allVendors = []
  let allPurchases = []
  let allVendorDebts = []
  let allVendorPayments = []
  let allStockMovements = []
  let cashAccounts = []
  let editingId = null

  // ── Load Data ──────────────────────────────────────────────
  async function loadVendors() {
    const [{ data: vendors }, { data: purchases }, { data: vendorDebts }, { data: stockMovements }] = await Promise.all([
      supabase.from('vendors').select('*').in('store_id', storeIds).order('vendor_name'),
      supabase.from('vendor_purchases').select('*').in('store_id', storeIds).order('purchase_date', { ascending: false }),
      supabase.from('vendor_debts').select('*').in('store_id', storeIds).order('created_at', { ascending: false }),
      supabase.from('stock_movements').select('*').in('store_id', storeIds).eq('source', 'credit').order('created_at', { ascending: false })
    ])

    // Load vendor payments
    const { data: vendorPayments } = await supabase.from('vendor_payments').select('*')
    allVendorPayments = vendorPayments || []

    // Load cash accounts for payment modal
    const { data: accounts } = await supabase.from('cash_accounts').select('*').in('store_id', storeIds)
    cashAccounts = accounts || []

    allVendors = vendors || []
    allPurchases = purchases || []
    allVendorDebts = vendorDebts || []
    allStockMovements = stockMovements || []

    updateSummary()
    applyFilters()
  }

  function updateSummary() {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    
    const monthPurchases = allPurchases.filter(p => p.purchase_date >= monthStart)
    const monthAmount = monthPurchases.reduce((s, p) => s + Number(p.total_cost), 0)

    // Calculate outstanding balances and aging
    let totalOutstanding = 0
    let overdue60Days = 0
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))
    const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000))

    allVendorDebts.forEach(debt => {
      if (debt.status !== 'paid') {
        const remaining = Number(debt.amount_owed) - Number(debt.amount_paid)
        totalOutstanding += remaining
        
        if (new Date(debt.created_at) < sixtyDaysAgo) {
          overdue60Days += remaining
        }
      }
    })

    container.querySelector('#total-vendors').textContent = allVendors.length
    container.querySelector('#total-outstanding').textContent = fmt(totalOutstanding)
    container.querySelector('#month-amount').textContent = fmt(monthAmount)
    container.querySelector('#overdue-60').textContent = fmt(overdue60Days)
  }

  function applyFilters() {
    const search = container.querySelector('#search').value.toLowerCase()
    
    const filtered = allVendors.filter(v => {
      return v.vendor_name.toLowerCase().includes(search) ||
             (v.contact_person || '').toLowerCase().includes(search) ||
             (v.phone || '').toLowerCase().includes(search)
    })

    renderTable(filtered)
  }

  function renderTable(vendors) {
    const tbody = container.querySelector('#vendors-body')
    if (vendors.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No suppliers yet. Add your first supplier.</div></div></td></tr>`
      return
    }

    tbody.innerHTML = vendors.map(v => {
      const debts = allVendorDebts.filter(d => d.vendor_name === v.vendor_name)
      const outstanding = debts.reduce((s, d) => s + (Number(d.amount_owed) - Number(d.amount_paid)), 0)
      const aging = getAging(debts)

      return `
        <tr>
          <td><strong>${v.vendor_name}</strong></td>
          <td>${v.contact_person || '—'}</td>
          <td>${v.phone || '—'}</td>
          <td style="color:var(--muted);font-size:0.875rem">${v.email || '—'}</td>
          <td style="font-weight:600;color:${outstanding > 0 ? 'var(--danger)' : 'var(--accent)'}">
            ${outstanding > 0 ? fmt(outstanding) + ' ETB' : '✓ Paid'}
          </td>
          <td>${aging}</td>
          <td>
            <div style="display:flex;gap:0.4rem">
              <button class="btn btn-outline btn-sm" data-action="detail" data-id="${v.id}" data-name="${v.vendor_name}">
                ${renderIcon('eye', 13)} Details
              </button>
              <button class="btn btn-outline btn-sm" data-action="edit" data-id="${v.id}">Edit</button>
              <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border)" data-action="delete" data-id="${v.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
    }).join('')

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id, name } = btn.dataset
        if (action === 'edit') openEditModal(id)
        if (action === 'delete') deleteVendor(id)
        if (action === 'detail') openSupplierDetail(id, name)
      })
    })
  }

  function getAging(debts) {
    if (debts.length === 0) return '<span class="badge badge-green">No Debt</span>'
    
    const now = new Date()
    let hasUnder30 = false
    let has30to60 = false
    let hasOver60 = false
    
    debts.forEach(debt => {
      if (debt.status === 'paid') return
      const daysOld = Math.floor((now - new Date(debt.created_at)) / (1000 * 60 * 60 * 24))
      if (daysOld < 30) hasUnder30 = true
      else if (daysOld < 60) has30to60 = true
      else hasOver60 = true
    })

    let badges = []
    if (hasUnder30) badges.push('<span class="badge badge-green">&lt;30d</span>')
    if (has30to60) badges.push('<span class="badge badge-yellow">30-60d</span>')
    if (hasOver60) badges.push('<span class="badge badge-red">&gt;60d</span>')
    
    return badges.join(' ')
  }

  // ── Supplier Detail Modal ───────────────────────────────────
  async function openSupplierDetail(vendorId, vendorName) {
    const modal = container.querySelector('#supplier-detail-modal')
    const titleEl = container.querySelector('#detail-title')
    const contentEl = container.querySelector('#detail-content')

    titleEl.textContent = `Supplier Details — ${vendorName}`
    modal.style.display = 'flex'

    const vendor = allVendors.find(v => v.id === vendorId)
    const debts = allVendorDebts.filter(d => d.vendor_name === vendorName)
    const payments = allVendorPayments.filter(p => {
      // Find vendor by name since payments use vendor_id
      const paymentVendor = allVendors.find(v => v.id === p.vendor_id)
      return paymentVendor?.vendor_name === vendorName
    })
    
    // Fetch full stock movements with inventory details
    const { data: stockMovementsWithDetails } = await supabase
      .from('stock_movements')
      .select(`
        *,
        inventory_items!inner(
          item_name,
          sku,
          category,
          selling_price,
          supplier,
          unit_cost,
          quantity,
          extra_fields
        )
      `)
      .in('reference_id', debts.map(d => d.id))

    // Fetch payments with cash account details
    const { data: paymentsWithAccounts } = await supabase
      .from('vendor_payments')
      .select(`
        *,
        cash_accounts(
          account_name,
          account_type,
          balance,
          bank_name,
          account_number
        )
      `)
      .eq('vendor_id', vendorId)

    const creditPurchases = stockMovementsWithDetails || []
    const enrichedPayments = paymentsWithAccounts || []

    const outstanding = debts.reduce((s, d) => s + (Number(d.amount_owed) - Number(d.amount_paid)), 0)
    const totalPurchased = creditPurchases.reduce((s, p) => s + (Number(p.quantity) * Number(p.unit_cost || 0)), 0)
    const totalPaid = enrichedPayments.reduce((s, p) => s + Number(p.payment_amount), 0)
    const aging = calculateAgingBreakdown(debts)

    // Find last activity date
    const allDates = [
      ...creditPurchases.map(p => new Date(p.created_at)),
      ...enrichedPayments.map(p => new Date(p.payment_date)),
      ...debts.map(d => new Date(d.created_at))
    ]
    const lastActivity = allDates.length > 0 ? new Date(Math.max(...allDates)) : null

    contentEl.innerHTML = `
      <!-- Supplier Header -->
      <div style="background:var(--bg-subtle);border-radius:12px;padding:1.25rem;margin-bottom:1.25rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
          <div>
            <h3 style="margin:0 0 0.5rem 0;color:var(--dark)">${vendorName}</h3>
            ${vendor?.contact_person ? `<div style="color:var(--muted);font-size:0.875rem">Contact: ${vendor.contact_person}</div>` : ''}
            ${vendor?.phone ? `<div style="color:var(--muted);font-size:0.875rem">📞 ${vendor.phone}</div>` : ''}
            ${vendor?.email ? `<div style="color:var(--muted);font-size:0.875rem">📧 ${vendor.email}</div>` : ''}
            ${vendor?.address ? `<div style="color:var(--muted);font-size:0.875rem">📍 ${vendor.address}</div>` : ''}
          </div>
          <button class="btn btn-primary btn-sm" id="pay-supplier-btn" data-vendor-name="${vendorName}">
            ${renderIcon('creditCard', 14)} Pay Supplier
          </button>
        </div>
        
        <!-- Financial Summary -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem">
          <div>
            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Outstanding Balance</div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--danger)">${fmt(outstanding)} ETB</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Total Purchased</div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--dark)">${fmt(totalPurchased)} ETB</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Total Paid</div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--accent)">${fmt(totalPaid)} ETB</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Last Activity</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--dark)">${lastActivity ? lastActivity.toLocaleDateString() : '—'}</div>
          </div>
        </div>
      </div>

      <!-- Aging Breakdown -->
      ${aging.total > 0 ? `
        <div style="background:var(--bg-subtle);border-radius:12px;padding:1.25rem;margin-bottom:1.25rem">
          <div style="font-weight:600;margin-bottom:1rem;color:var(--dark)">Aging Breakdown</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem">
            <div style="text-align:center;padding:1rem;background:#F0FDF4;border:1px solid #22C55E;border-radius:8px">
              <div style="font-size:1.25rem;font-weight:700;color:#22C55E">${fmt(aging.under30)}</div>
              <div style="font-size:0.75rem;color:#166534">&lt; 30 days</div>
            </div>
            <div style="text-align:center;padding:1rem;background:#FFFBEB;border:1px solid #F59E0B;border-radius:8px">
              <div style="font-size:1.25rem;font-weight:700;color:#D97706">${fmt(aging.thirtyTo60)}</div>
              <div style="font-size:0.75rem;color:#92400E">30-60 days</div>
            </div>
            <div style="text-align:center;padding:1rem;background:#FEF2F2;border:1px solid #EF4444;border-radius:8px">
              <div style="font-size:1.25rem;font-weight:700;color:#DC2626">${fmt(aging.over60)}</div>
              <div style="font-size:0.75rem;color:#991B1B">&gt; 60 days</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Tabs -->
      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;border-bottom:2px solid var(--border)">
        <button class="detail-tab-btn active" data-tab="debts" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid var(--accent);margin-bottom:-2px;color:var(--accent)">
          Vendor Debts (${debts.length})
        </button>
        <button class="detail-tab-btn" data-tab="payments" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--muted)">
          Payment History (${payments.length})
        </button>
        <button class="detail-tab-btn" data-tab="credit" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--muted)">
          Credit Purchases (${creditPurchases.length})
        </button>
      </div>

      <!-- Tab Content -->
      <div id="detail-tab-content" style="max-height:400px;overflow-y:auto">
        ${renderDebtsTab(debts)}
      </div>
    `

    // Tab switching
    const tabBtns = modal.querySelectorAll('.detail-tab-btn')
    const tabContent = modal.querySelector('#detail-tab-content')
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => {
          b.style.borderBottom = '2px solid transparent'
          b.style.color = 'var(--muted)'
        })
        btn.style.borderBottom = '2px solid var(--accent)'
        btn.style.color = 'var(--accent)'
        
        const tab = btn.dataset.tab
        if (tab === 'debts') tabContent.innerHTML = renderDebtsTab(debts)
        if (tab === 'payments') tabContent.innerHTML = renderPaymentsTab(enrichedPayments)
        if (tab === 'credit') tabContent.innerHTML = renderCreditPurchasesTab(creditPurchases)
      })
    })

    // Pay supplier button
    modal.querySelector('#pay-supplier-btn').addEventListener('click', () => {
      openPaySupplierModal(vendorName, outstanding)
    })

    // Close modal
    modal.querySelector('#detail-close').addEventListener('click', () => {
      modal.style.display = 'none'
    })
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none' })
  }

  function calculateAgingBreakdown(debts) {
    const now = new Date()
    const breakdown = { under30: 0, thirtyTo60: 0, over60: 0, total: 0 }
    
    debts.forEach(debt => {
      if (debt.status === 'paid') return
      const remaining = Number(debt.amount_owed) - Number(debt.amount_paid)
      const daysOld = Math.floor((now - new Date(debt.created_at)) / (1000 * 60 * 60 * 24))
      
      breakdown.total += remaining
      if (daysOld < 30) breakdown.under30 += remaining
      else if (daysOld < 60) breakdown.thirtyTo60 += remaining
      else breakdown.over60 += remaining
    })
    
    return breakdown
  }

  function renderDebtsTab(debts) {
    if (!debts.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No vendor debts found</div>'

    return debts.map(debt => {
      const remaining = Number(debt.amount_owed) - Number(debt.amount_paid)
      const status = remaining <= 0.01 ? 'paid' : Number(debt.amount_paid) > 0 ? 'partial' : 'unpaid'
      const daysOld = Math.floor((new Date() - new Date(debt.created_at)) / (1000 * 60 * 60 * 24))
      
      return `
        <div style="border:1px solid var(--border);border-radius:12px;margin-bottom:1rem;background:var(--bg-elevated)">
          <div style="padding:1rem;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:600;color:var(--dark);margin-bottom:0.25rem">
                ${new Date(debt.created_at).toLocaleDateString()}
              </div>
              <div style="font-size:0.875rem;color:var(--muted)">
                ${daysOld} days ago • ${debt.notes || 'No notes'}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:1.0625rem;color:var(--danger)">${fmt(remaining)} ETB</div>
              <div style="font-size:0.75rem;color:var(--muted)">Remaining</div>
              <span class="badge ${status==='paid' ? 'badge-green' : status==='partial' ? 'badge-yellow' : 'badge-red'}" style="margin-top:0.25rem">
                ${status}
              </span>
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  function renderPaymentsTab(payments) {
    if (!payments.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No payments recorded</div>'

    return payments.map(payment => {
      const account = payment.cash_accounts
      const paymentDate = new Date(payment.payment_date)
      
      return `
        <div style="border:1px solid var(--border);border-radius:12px;margin-bottom:1rem;background:var(--bg-elevated)">
          <div style="padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
              <div style="font-weight:600;color:var(--dark)">💳 Payment</div>
              <div style="font-weight:700;color:var(--accent);font-size:1.0625rem">${fmt(payment.payment_amount)} ETB</div>
            </div>
            
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;font-size:0.875rem">
              <div><strong>Date:</strong> ${paymentDate.toLocaleDateString()} at ${paymentDate.toLocaleTimeString()}</div>
              <div><strong>Method:</strong> ${payment.payment_method || '—'}</div>
              <div><strong>Paid from:</strong> ${account?.account_name || '—'}</div>
              <div><strong>Account Type:</strong> ${account?.account_type || '—'}</div>
              <div><strong>Bank:</strong> ${account?.bank_name || '—'}</div>
              <div><strong>Account #:</strong> ${account?.account_number || '—'}</div>
              <div><strong>Current Balance:</strong> ${account?.balance ? fmt(account.balance) + ' ETB' : '—'}</div>
              <div><strong>Payment ID:</strong> <span style="font-family:monospace;color:var(--muted);font-size:0.75rem">${payment.id}</span></div>
            </div>
            
            ${payment.notes ? `
              <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
                <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem"><strong>Notes:</strong></div>
                <div style="font-size:0.875rem">${payment.notes}</div>
              </div>
            ` : ''}
            
            <div style="margin-top:0.75rem;font-size:0.75rem;color:var(--muted)">
              Created: ${new Date(payment.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  function renderCreditPurchasesTab(creditPurchases) {
    if (!creditPurchases.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No credit purchases found</div>'

    return creditPurchases.map(purchase => {
      const item = purchase.inventory_items
      const createdDate = new Date(purchase.created_at)
      const totalValue = Number(purchase.quantity) * Number(purchase.unit_cost || 0)
      
      return `
        <div style="border:1px solid var(--border);border-radius:12px;margin-bottom:1rem;background:var(--bg-elevated)">
          <div style="padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
              <div style="font-weight:600;color:var(--dark)">📦 Stock Purchase</div>
              <div style="font-weight:700;color:var(--accent);font-size:1.0625rem">${fmt(totalValue)} ETB</div>
            </div>
            
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;font-size:0.875rem">
              <div><strong>Date:</strong> ${createdDate.toLocaleDateString()} at ${createdDate.toLocaleTimeString()}</div>
              <div><strong>Item:</strong> ${item?.item_name || '—'}</div>
              <div><strong>SKU:</strong> ${item?.sku || '—'}</div>
              <div><strong>Category:</strong> ${item?.category || '—'}</div>
              <div><strong>Quantity:</strong> ${purchase.quantity} units</div>
              <div><strong>Unit Cost:</strong> ${fmt(purchase.unit_cost || 0)} ETB</div>
              <div><strong>Total Value:</strong> ${fmt(totalValue)} ETB</div>
              <div><strong>Movement:</strong> ${purchase.movement_type || '—'}</div>
              <div><strong>Source:</strong> ${purchase.source || '—'}</div>
              <div><strong>Reference ID:</strong> <span style="font-family:monospace;color:var(--muted);font-size:0.75rem">${purchase.reference_id || '—'}</span></div>
              <div><strong>Current Stock:</strong> ${item?.quantity || '—'} units</div>
              <div><strong>Current Unit Cost:</strong> ${item?.unit_cost ? fmt(item.unit_cost) + ' ETB' : '—'}</div>
              <div><strong>Selling Price:</strong> ${item?.selling_price ? fmt(item.selling_price) + ' ETB' : '—'}</div>
              <div><strong>Supplier:</strong> ${item?.supplier || '—'}</div>
              <div><strong>Stock Movement ID:</strong> <span style="font-family:monospace;color:var(--muted);font-size:0.75rem">${purchase.id}</span></div>
            </div>
            
            ${purchase.notes ? `
              <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
                <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem"><strong>Notes:</strong></div>
                <div style="font-size:0.875rem">${purchase.notes}</div>
              </div>
            ` : ''}
            
            ${item?.extra_fields ? `
              <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
                <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem"><strong>Extra Fields:</strong></div>
                <div style="font-size:0.875rem;font-family:monospace;color:var(--muted)">${JSON.stringify(item.extra_fields, null, 2)}</div>
              </div>
            ` : ''}
            
            <div style="margin-top:0.75rem;font-size:0.75rem;color:var(--muted)">
              Created: ${createdDate.toLocaleString()}
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  // ── Pay Supplier Modal ─────────────────────────────────────
  function openPaySupplierModal(vendorName, outstandingAmount) {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.display = 'flex'

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Pay Supplier — ${vendorName}</div>
          <button class="modal-close" id="pay-close">${renderIcon('close', 14)}</button>
        </div>
        
        <div style="background:var(--bg-light);border-radius:var(--radius);padding:0.75rem;margin-bottom:1rem">
          <div style="font-size:12px;color:var(--muted)">Outstanding Balance</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--danger)">
            ${fmt(outstandingAmount)} ETB
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Payment Amount (ETB) *</label>
          <input type="number" class="form-input" id="pay-amount" max="${outstandingAmount}" placeholder="0.00">
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
            <button class="btn btn-outline btn-sm" id="pay-full">Pay Full (${fmt(outstandingAmount)} ETB)</button>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Cash Account *</label>
          <select class="form-input" id="pay-account">
            <option value="">Select cash account</option>
            ${cashAccounts.map(a => `<option value="${a.id}">${a.account_name} (${a.account_type === 'till' ? 'Till' : 'Bank'})</option>`).join('')}
          </select>
        </div>
        
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-input" id="pay-method">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="check">Check</option>
          </select>
        </div>
        
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="pay-notes" placeholder="Optional notes">
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="pay-cancel">Cancel</button>
          <button class="btn btn-primary" id="pay-confirm">✓ Process Payment</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    // Event listeners
    overlay.querySelector('#pay-full').addEventListener('click', () => {
      overlay.querySelector('#pay-amount').value = outstandingAmount
    })

    const close = () => overlay.remove()
    overlay.querySelector('#pay-close').addEventListener('click', close)
    overlay.querySelector('#pay-cancel').addEventListener('click', close)

    overlay.querySelector('#pay-confirm').addEventListener('click', async () => {
      const amount = Number(overlay.querySelector('#pay-amount').value)
      const account = overlay.querySelector('#pay-account').value
      const method = overlay.querySelector('#pay-method').value
      const notes = overlay.querySelector('#pay-notes').value.trim()

      if (!amount || amount <= 0) { alert('Enter a valid amount'); return }
      if (!account) { alert('Select a cash account'); return }
      if (amount > outstandingAmount + 0.01) { alert(`Cannot exceed outstanding balance of ${fmt(outstandingAmount)} ETB`); return }

      const confirmBtn = overlay.querySelector('#pay-confirm')
      confirmBtn.disabled = true
      confirmBtn.textContent = 'Processing...'

      try {
        // Find vendor ID
        const vendor = allVendors.find(v => v.vendor_name === vendorName)
        if (!vendor) throw new Error('Vendor not found')

        // Record payment
        await supabase.from('vendor_payments').insert({
          vendor_id: vendor.id,
          payment_amount: amount,
          payment_method: method,
          cash_account_id: account,
          notes: notes || null
        })

        // Update vendor outstanding balance
        const newBalance = Math.max(0, Number(vendor.outstanding_balance || 0) - amount)
        await supabase.from('vendors').update({ outstanding_balance: newBalance }).eq('id', vendor.id)

        // Update cash account balance (debit)
        const { data: accountData } = await supabase.from('cash_accounts').select('balance').eq('id', account).single()
        if (accountData) {
          await supabase.from('cash_accounts').update({ balance: Number(accountData.balance) - amount }).eq('id', account)
        }

        // Update vendor debts (waterfall payment)
        const vendorDebts = allVendorDebts.filter(d => d.vendor_name === vendorName && d.status !== 'paid').sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        let remainingToPay = amount

        for (const debt of vendorDebts) {
          if (remainingToPay <= 0.001) break
          const canPay = Number(debt.amount_owed) - Number(debt.amount_paid)
          if (canPay <= 0.001) continue
          
          const paying = Math.min(remainingToPay, canPay)
          const newPaid = Number(debt.amount_paid) + paying
          const newStatus = newPaid >= Number(debt.amount_owed) - 0.01 ? 'paid' : 'partial'
          
          await supabase.from('vendor_debts').update({ amount_paid: newPaid, status: newStatus }).eq('id', debt.id)
          remainingToPay -= paying
        }

        close()
        await loadVendors()
        
        // Show success message
        const successDiv = document.createElement('div')
        successDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--accent);color:white;padding:1rem;border-radius:8px;z-index:9999'
        successDiv.textContent = `Payment of ${fmt(amount)} ETB processed successfully`
        document.body.appendChild(successDiv)
        setTimeout(() => successDiv.remove(), 3000)

      } catch (error) {
        console.error('Payment error:', error)
        alert('Error processing payment: ' + error.message)
        confirmBtn.disabled = false
        confirmBtn.textContent = '✓ Process Payment'
      }
    })
  }

  // ── Modals ─────────────────────────────────────────────────
  function openAddModal() {
    editingId = null
    container.querySelector('#modal-title').textContent = 'Add Supplier'
    container.querySelector('#f-name').value = ''
    container.querySelector('#f-contact').value = ''
    container.querySelector('#f-phone').value = ''
    container.querySelector('#f-email').value = ''
    container.querySelector('#f-address').value = ''
    container.querySelector('#f-notes').value = ''
    container.querySelector('#vendor-modal').style.display = 'flex'
  }

  function openEditModal(id) {
    const vendor = allVendors.find(v => v.id === id)
    if (!vendor) return
    editingId = id
    container.querySelector('#modal-title').textContent = 'Edit Supplier'
    container.querySelector('#f-name').value = vendor.vendor_name || ''
    container.querySelector('#f-contact').value = vendor.contact_person || ''
    container.querySelector('#f-phone').value = vendor.phone || ''
    container.querySelector('#f-email').value = vendor.email || ''
    container.querySelector('#f-address').value = vendor.address || ''
    container.querySelector('#f-notes').value = vendor.notes || ''
    container.querySelector('#vendor-modal').style.display = 'flex'
  }

  function closeModal() {
    container.querySelector('#vendor-modal').style.display = 'none'
  }

  async function saveVendor() {
    const name = container.querySelector('#f-name').value.trim()
    if (!name) { alert('Supplier name is required'); return }

    const payload = {
      store_id: currentStore?.id,
      vendor_name: name,
      contact_person: container.querySelector('#f-contact').value.trim() || null,
      phone: container.querySelector('#f-phone').value.trim() || null,
      email: container.querySelector('#f-email').value.trim() || null,
      address: container.querySelector('#f-address').value.trim() || null,
      notes: container.querySelector('#f-notes').value.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (editingId) {
      const { error } = await supabase.from('vendors').update(payload).eq('id', editingId)
      if (error) { alert('Error updating supplier'); console.error(error); return }
    } else {
      const { error } = await supabase.from('vendors').insert(payload)
      if (error) { alert('Error adding supplier'); console.error(error); return }
    }

    closeModal()
    await loadVendors()
  }

  async function deleteVendor(id) {
    const vendor = allVendors.find(v => v.id === id)
    const debts = allVendorDebts.filter(d => d.vendor_name === vendor.vendor_name)
    
    if (debts.length > 0) {
      if (!confirm(`This supplier has ${debts.length} debt(s) recorded. Delete anyway?`)) return
    } else {
      if (!confirm('Delete this supplier?')) return
    }

    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { alert('Error deleting supplier'); return }
    await loadVendors()
  }

  // ── Event Listeners ────────────────────────────────────────
  container.querySelector('#btn-add-vendor').addEventListener('click', openAddModal)
  container.querySelector('#modal-close').addEventListener('click', closeModal)
  container.querySelector('#modal-cancel').addEventListener('click', closeModal)
  container.querySelector('#modal-save').addEventListener('click', saveVendor)
  container.querySelector('#search').addEventListener('input', applyFilters)
  container.querySelector('#btn-refresh').addEventListener('click', loadVendors)

  // Close modals on overlay click
  container.querySelector('#vendor-modal').addEventListener('click', e => {
    if (e.target.id === 'vendor-modal') closeModal()
  })

  // ── Init ───────────────────────────────────────────────────
  await loadVendors()
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
