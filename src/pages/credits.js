import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { postCreditPaymentEntry, postVendorPaymentEntry } from '../utils/accounting.js'
import { audit } from '../utils/audit.js'
import { invalidateAfterSale, invalidateAfterExpense } from '../utils/db.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  await loadAccounts(storeIds)

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Credits & Debts</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
    </div>

    <!-- Tab switcher -->
    <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;border-bottom:2px solid var(--border);padding-bottom:0">
      <button class="tab-btn" data-tab="receivable" style="
        padding:0.6rem 1.25rem;font-size:14px;font-weight:600;
        border:none;background:none;cursor:pointer;
        border-bottom:2px solid var(--accent);margin-bottom:-2px;
        color:var(--accent)
      ">📒 Credit Sales (Owed to You)</button>
      <button class="tab-btn" data-tab="payable" style="
        padding:0.6rem 1.25rem;font-size:14px;font-weight:600;
        border:none;background:none;cursor:pointer;
        color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;
      ">🏦 Vendor Debts (You Owe)</button>
      <button class="tab-btn" data-tab="customers" style="
        padding:0.6rem 1.25rem;font-size:14px;font-weight:600;
        border:none;background:none;cursor:pointer;
        color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;
      ">👥 Customers</button>
    </div>

    <div id="tab-content"></div>

    <!-- Payment modal -->
    <div id="payment-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="payment-modal-title">Record Payment</div>
          <button class="modal-close" id="payment-modal-close">✕</button>
        </div>
        <div id="payment-modal-body"></div>
      </div>
    </div>
  `

  let activeTab = 'receivable'

  // ── Tab switching ─────────────────────────────────────────
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab
      container.querySelectorAll('.tab-btn').forEach(b => {
        const active = b.dataset.tab === activeTab
        b.style.color       = active ? 'var(--accent)' : 'var(--muted)'
        b.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent'
      })
      loadTab()
    })
  })

  async function loadTab() {
    const el = container.querySelector('#tab-content')
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Loading...</div>`
    if (activeTab === 'receivable') await renderReceivable(el, storeIds)
    if (activeTab === 'payable')    await renderPayable(el, storeIds)
    if (activeTab === 'customers')  await renderCustomers(el, storeIds)
  }

  // ── RECEIVABLE — Credit sales owed to store ───────────────
  async function renderReceivable(el, storeIds) {
    const { data: credits } = await supabase
      .from('credit_sales')
      .select(`
        *,
        customers(id, name, phone, credit_balance),
        sales(sale_date, total_amount, notes)
      `)
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })

    const totalOwed    = (credits||[]).filter(c => c.status !== 'paid').reduce((s,c) => s + Number(c.amount_owed) - Number(c.amount_paid), 0)
    const totalPaid    = (credits||[]).reduce((s,c) => s + Number(c.amount_paid), 0)
    const overdue      = (credits||[]).filter(c => c.status !== 'paid' && c.due_date && new Date(c.due_date) < new Date()).length

    el.innerHTML = `
      <!-- Summary -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.25rem">
        <div class="kpi-card">
          <div class="kpi-label">Total Outstanding</div>
          <div class="kpi-value" style="color:var(--warning)">${fmt(totalOwed)}</div>
          <div class="kpi-sub">ETB owed to you</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Collected</div>
          <div class="kpi-value accent">${fmt(totalPaid)}</div>
          <div class="kpi-sub">ETB received</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Overdue</div>
          <div class="kpi-value" style="color:var(--danger)">${overdue}</div>
          <div class="kpi-sub">past due date</div>
        </div>
      </div>

      <!-- Filter -->
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          <input class="form-input" id="search-credits" placeholder="Search customer..." style="max-width:220px">
          <select class="form-input" id="filter-status" style="max-width:160px">
            <option value="">All Status</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      <!-- Table -->
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Sale Date</th>
                <th>Total Sale</th>
                <th>Paid</th>
                <th>Remaining</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="credits-body">
              ${renderCreditRows(credits || [])}
            </tbody>
          </table>
        </div>
      </div>
    `

    // Search & filter
    const filterFn = () => {
      const search = el.querySelector('#search-credits').value.toLowerCase()
      const status = el.querySelector('#filter-status').value
      const filtered = (credits||[]).filter(c => {
        const matchName   = (c.customers?.name || '').toLowerCase().includes(search)
        const matchStatus = !status || c.status === status
        return matchName && matchStatus
      })
      el.querySelector('#credits-body').innerHTML = renderCreditRows(filtered)
      attachCreditActions(el)
    }

    el.querySelector('#search-credits').addEventListener('input', filterFn)
    el.querySelector('#filter-status').addEventListener('change', filterFn)
    attachCreditActions(el)
  }

  function renderCreditRows(credits) {
    if (!credits.length) return `<tr><td colspan="7"><div class="empty"><div class="empty-text">No credit sales found</div></div></td></tr>`

    // Group by customer_id so the same customer shows as one unified row
    const groups = {}
    for (const c of credits) {
      const key = c.customer_id || 'unknown'
      if (!groups[key]) groups[key] = { customer: c.customers, items: [] }
      groups[key].items.push(c)
    }

    return Object.values(groups).map(g => {
      const totalOwed  = g.items.reduce((s, c) => s + Number(c.amount_owed), 0)
      const totalPaid  = g.items.reduce((s, c) => s + Number(c.amount_paid), 0)
      const remaining  = totalOwed - totalPaid
      const pct        = totalOwed > 0 ? Math.round((totalPaid / totalOwed) * 100) : 0
      const allPaid    = remaining <= 0.01
      const status     = allPaid ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid'
      const isOverdue  = !allPaid && g.items.some(c => c.status !== 'paid' && c.due_date && new Date(c.due_date) < new Date())
      const salesCount = g.items.length
      const latestDate = g.items.map(c => c.sales?.sale_date).filter(Boolean).sort().reverse()[0] || '—'
      // Oldest unpaid first for waterfall payment
      const unpaidIds  = g.items
        .filter(c => c.status !== 'paid')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(c => c.id)

      return `
        <tr>
          <td>
            <div style="font-weight:600">${g.customer?.name || '—'}</div>
            <div style="font-size:11.5px;color:var(--muted)">${g.customer?.phone || ''}</div>
          </td>
          <td>
            ${latestDate}
            ${salesCount > 1 ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${salesCount} sales</div>` : ''}
          </td>
          <td>${fmt(totalOwed)} ETB</td>
          <td>
            <div>${fmt(totalPaid)} ETB</div>
            <div style="height:4px;background:var(--border);border-radius:999px;margin-top:4px;width:80px">
              <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:999px"></div>
            </div>
          </td>
          <td style="font-weight:700;color:${remaining > 0 ? 'var(--warning)' : 'var(--accent)'}">
            ${remaining > 0 ? fmt(remaining) + ' ETB' : '✓ Paid'}
          </td>
          <td>
            <span class="badge ${status==='paid' ? 'badge-green' : status==='partial' ? 'badge-yellow' : isOverdue ? 'badge-red' : 'badge-grey'}">
              ${isOverdue && status !== 'paid' ? 'Overdue' : status}
            </span>
          </td>
          <td>
            <div style="display:flex;gap:0.4rem">
              ${!allPaid ? `
                <button class="btn btn-primary btn-sm" data-action="pay-credit"
                  data-ids="${encodeURIComponent(JSON.stringify(unpaidIds))}"
                  data-name="${g.customer?.name || '—'}"
                  data-remaining="${remaining}">
                  + Payment
                </button>
              ` : ''}
              <button class="btn btn-outline btn-sm" data-action="view-history" data-customer-id="${g.customer?.id}">History</button>
            </div>
          </td>
        </tr>
      `
    }).join('')
  }

  function attachCreditActions(el) {
    el.querySelectorAll('[data-action="pay-credit"]').forEach(btn => {
      btn.addEventListener('click', () => openPaymentModal({
        type:      'credit',
        ids:       JSON.parse(decodeURIComponent(btn.dataset.ids)),
        name:      btn.dataset.name,
        remaining: Number(btn.dataset.remaining),
        onDone:    loadTab,
      }))
    })
    el.querySelectorAll('[data-action="view-history"]').forEach(btn => {
      btn.addEventListener('click', () => openCustomerHistory(btn.dataset.customerId))
    })
  }

  // ── PAYABLE — Vendor debts store owes ─────────────────────
  async function renderPayable(el, storeIds) {
    const { data: debts } = await supabase
      .from('vendor_debts')
      .select('*, vendor_purchases(*)')
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })

    const totalOwed  = (debts||[]).filter(d => d.status !== 'paid').reduce((s,d) => s + Number(d.amount_owed) - Number(d.amount_paid), 0)
    const totalPaid  = (debts||[]).reduce((s,d) => s + Number(d.amount_paid), 0)

    el.innerHTML = `
      <!-- Summary -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;margin-bottom:1.25rem">
        <div class="kpi-card">
          <div class="kpi-label">Total You Owe</div>
          <div class="kpi-value" style="color:var(--danger)">${fmt(totalOwed)}</div>
          <div class="kpi-sub">ETB to vendors</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Paid</div>
          <div class="kpi-value accent">${fmt(totalPaid)}</div>
          <div class="kpi-sub">ETB paid to vendors</div>
        </div>
      </div>

      <!-- Add manual debt -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
        <button class="btn btn-primary btn-sm" id="btn-add-debt">+ Add Vendor Debt</button>
      </div>

      <!-- Table -->
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Date</th>
                <th>Total Owed</th>
                <th>Paid</th>
                <th>Remaining</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="debts-body">
              ${renderDebtRows(debts || [])}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add debt modal -->
      <div id="add-debt-modal" class="modal-overlay" style="display:none">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">Add Vendor Debt</div>
            <button class="modal-close" id="add-debt-close">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Vendor / Supplier Name *</label>
            <input class="form-input" id="debt-vendor" placeholder="Supplier name">
          </div>
          <div class="form-group">
            <label class="form-label">Amount Owed (ETB) *</label>
            <input type="number" class="form-input" id="debt-amount" min="0" placeholder="0.00">
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <input class="form-input" id="debt-notes" placeholder="What was purchased?">
          </div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
            <button class="btn btn-outline" id="debt-cancel">Cancel</button>
            <button class="btn btn-primary" id="debt-save">Save Debt</button>
          </div>
        </div>
      </div>
    `

    attachDebtActions(el, storeIds)

    el.querySelector('#btn-add-debt').addEventListener('click', () => {
      el.querySelector('#add-debt-modal').style.display = 'flex'
    })
    el.querySelector('#add-debt-close').addEventListener('click', () => {
      el.querySelector('#add-debt-modal').style.display = 'none'
    })
    el.querySelector('#debt-cancel').addEventListener('click', () => {
      el.querySelector('#add-debt-modal').style.display = 'none'
    })
    el.querySelector('#debt-save').addEventListener('click', async () => {
      const vendor = el.querySelector('#debt-vendor').value.trim()
      const amount = Number(el.querySelector('#debt-amount').value)
      const notes  = el.querySelector('#debt-notes').value.trim()
      if (!vendor || !amount) { alert('Vendor name and amount required'); return }
      await supabase.from('vendor_debts').insert({
        store_id:    currentStore?.id,
        vendor_name: vendor,
        amount_owed: amount,
        notes:       notes || null,
      })
      el.querySelector('#add-debt-modal').style.display = 'none'
      await loadTab()
    })
  }

  function renderDebtRows(debts) {
    if (!debts.length) return `<tr><td colspan="7"><div class="empty"><div class="empty-text">No vendor debts</div></div></td></tr>`
    return debts.map(d => {
      const remaining  = Number(d.amount_owed) - Number(d.amount_paid)
      const pct        = d.amount_owed > 0 ? Math.round((Number(d.amount_paid) / Number(d.amount_owed)) * 100) : 0
      const purchases  = d.vendor_purchases || []
      const productsRow = purchases.length ? `
        <tr>
          <td colspan="7" style="padding:0;border-top:none">
            <div style="padding:0.375rem 1rem 0.625rem 1.5rem;background:var(--bg-subtle);border-bottom:1px solid var(--border)">
              <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.3rem">Products</div>
              <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
                ${purchases.map(p => `
                  <span style="font-size:0.8125rem;padding:0.2rem 0.625rem;
                    background:var(--bg-elevated);border:1px solid var(--border);
                    border-radius:var(--radius-pill);white-space:nowrap">
                    ${p.product_name} &times; ${p.quantity} &bull; ${fmt(p.unit_cost)} ETB each
                  </span>
                `).join('')}
              </div>
            </div>
          </td>
        </tr>
      ` : ''
      return `
        <tr>
          <td><div style="font-weight:600">${d.vendor_name}</div>${d.notes ? `<div style="font-size:0.75rem;color:var(--muted)">${d.notes}</div>` : ''}</td>
          <td>${new Date(d.created_at).toLocaleDateString()}</td>
          <td>${fmt(d.amount_owed)} ETB</td>
          <td>
            <div>${fmt(d.amount_paid)} ETB</div>
            <div style="height:4px;background:var(--border);border-radius:999px;margin-top:4px;width:80px">
              <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:999px"></div>
            </div>
          </td>
          <td style="font-weight:700;color:${remaining > 0 ? 'var(--danger)' : 'var(--accent)'}">
            ${remaining > 0 ? fmt(remaining) + ' ETB' : '&#10003; Paid'}
          </td>
          <td>
            <span class="badge ${d.status==='paid' ? 'badge-green' : d.status==='partial' ? 'badge-yellow' : 'badge-red'}">
              ${d.status}
            </span>
          </td>
          <td>
            <div style="display:flex;gap:0.4rem">
              ${d.status !== 'paid' ? `
                <button class="btn btn-primary btn-sm" data-action="pay-debt" data-id="${d.id}" data-name="${d.vendor_name}" data-remaining="${remaining}">
                  + Pay
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
        ${productsRow}
      `
    }).join('')
  }

  function attachDebtActions(el) {
    el.querySelectorAll('[data-action="pay-debt"]').forEach(btn => {
      btn.addEventListener('click', () => openPaymentModal({
        type:      'debt',
        id:        btn.dataset.id,
        name:      btn.dataset.name,
        remaining: Number(btn.dataset.remaining),
        onDone:    loadTab,
      }))
    })
  }

  // ── CUSTOMERS tab ─────────────────────────────────────────
  async function renderCustomers(el, storeIds) {
    const { data: custs } = await supabase
      .from('customers')
      .select(`*, credit_sales(amount_owed, amount_paid, status)`)
      .in('store_id', storeIds)
      .order('name')

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <input class="form-input" id="search-customers" placeholder="Search customers..." style="max-width:260px">
        <button class="btn btn-primary btn-sm" id="btn-add-customer">+ Add Customer</button>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Total Credit</th>
                <th>Outstanding</th>
                <th>Sales</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="customers-body">
              ${renderCustomerRows(custs || [])}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add customer modal -->
      <div id="add-cust-modal" class="modal-overlay" style="display:none">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">Add Customer</div>
            <button class="modal-close" id="add-cust-close">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label class="form-label">Name *</label>
              <input class="form-input" id="cust-name" placeholder="Full name">
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-input" id="cust-phone" placeholder="09xxxxxxxx">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <input class="form-input" id="cust-notes" placeholder="Optional notes">
          </div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
            <button class="btn btn-outline" id="cust-cancel">Cancel</button>
            <button class="btn btn-primary" id="cust-save">Save</button>
          </div>
        </div>
      </div>
    `

    el.querySelector('#search-customers').addEventListener('input', e => {
      const s = e.target.value.toLowerCase()
      const filtered = (custs||[]).filter(c => c.name.toLowerCase().includes(s) || (c.phone||'').includes(s))
      el.querySelector('#customers-body').innerHTML = renderCustomerRows(filtered)
      attachCustomerActions(el)
    })

    el.querySelector('#btn-add-customer').addEventListener('click', () => {
      el.querySelector('#add-cust-modal').style.display = 'flex'
    })
    el.querySelector('#add-cust-close').addEventListener('click', () => {
      el.querySelector('#add-cust-modal').style.display = 'none'
    })
    el.querySelector('#cust-cancel').addEventListener('click', () => {
      el.querySelector('#add-cust-modal').style.display = 'none'
    })
    el.querySelector('#cust-save').addEventListener('click', async () => {
      const name = el.querySelector('#cust-name').value.trim()
      if (!name) { alert('Name required'); return }
      await supabase.from('customers').insert({
        store_id: currentStore?.id,
        name,
        phone: el.querySelector('#cust-phone').value.trim() || null,
        notes: el.querySelector('#cust-notes').value.trim() || null,
      })
      el.querySelector('#add-cust-modal').style.display = 'none'
      await loadTab()
    })

    attachCustomerActions(el)
  }

  function renderCustomerRows(custs) {
    if (!custs.length) return `<tr><td colspan="6"><div class="empty"><div class="empty-text">No customers yet</div></div></td></tr>`
    return custs.map(c => {
      const totalCredit = (c.credit_sales||[]).reduce((s,cs) => s + Number(cs.amount_owed), 0)
      const outstanding = (c.credit_sales||[]).filter(cs => cs.status !== 'paid').reduce((s,cs) => s + Number(cs.amount_owed) - Number(cs.amount_paid), 0)
      const salesCount  = (c.credit_sales||[]).length
      return `
        <tr>
          <td>
            <div style="font-weight:600">${c.name}</div>
            ${(c.last_targa || c.plate_number) ? `<div style="font-size:0.75rem;color:var(--muted);font-family:monospace;margin-top:2px">🚗 ${c.last_targa || c.plate_number}</div>` : ''}
            ${c.default_place ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:1px">📍 ${c.default_place}</div>` : ''}
          </td>
          <td style="color:var(--muted)">${c.phone || '—'}</td>
          <td>${fmt(totalCredit)} ETB</td>
          <td style="font-weight:700;color:${outstanding > 0 ? 'var(--warning)' : 'var(--accent)'}">
            ${outstanding > 0 ? fmt(outstanding) + ' ETB' : '✓ Clear'}
          </td>
          <td>${salesCount} credit sale${salesCount !== 1 ? 's' : ''}</td>
          <td>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" data-action="lend-cash" data-id="${c.id}" data-name="${c.name}">
                + Lend
              </button>
              ${outstanding > 0 ? `
              <button class="btn btn-outline btn-sm" style="color:var(--accent);border-color:var(--accent)" data-action="pay-customer" data-id="${c.id}" data-name="${c.name}">
                Pay
              </button>` : ''}
              <button class="btn btn-outline btn-sm" data-action="plate-history" data-id="${c.id}" data-name="${c.name}" data-plate="${c.plate_number||''}">
                🚗 Plate
              </button>
              <button class="btn btn-outline btn-sm" data-action="view-cust-history" data-id="${c.id}" data-name="${c.name}">
                History
              </button>
            </div>
          </td>
        </tr>
      `
    }).join('')
  }

  function attachCustomerActions(el) {
    el.querySelectorAll('[data-action="view-cust-history"]').forEach(btn => {
      btn.addEventListener('click', () => openCustomerHistory(btn.dataset.id, btn.dataset.name))
    })
    el.querySelectorAll('[data-action="lend-cash"]').forEach(btn => {
      btn.addEventListener('click', () => openLendModal(btn.dataset.id, btn.dataset.name))
    })
    el.querySelectorAll('[data-action="plate-history"]').forEach(btn => {
      btn.addEventListener('click', () => openPlateModal(btn.dataset.id, btn.dataset.name, btn.dataset.plate))
    })
    el.querySelectorAll('[data-action="pay-customer"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabBtn = container.querySelector('.tab-btn[data-tab="receivable"]')
        if (tabBtn) tabBtn.click()
        setTimeout(() => {
          const searchInput = container.querySelector('#search-credits')
          if (searchInput) {
            searchInput.value = btn.dataset.name
            searchInput.dispatchEvent(new Event('input'))
          }
        }, 100)
      })
    })
  }

  // ── Plate History Modal ───────────────────────────────
  async function openPlateModal(entityId, entityName, currentPlate) {
    // Load history from generic plate_history table
    const { data: history } = await supabase
      .from('plate_history')
      .select('*')
      .eq('entity_type', 'customer')
      .eq('entity_id', entityId)
      .order('changed_at', { ascending: false })
      .limit(10)

    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.display = 'flex'

    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <div class="modal-title">🚗 Plate Numbers — ${entityName}</div>
          <button class="modal-close" id="plate-close">✕</button>
        </div>

        <div style="margin-bottom:1rem">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.4px">Current Plate</div>
          <div style="font-size:1.5rem;font-weight:800;font-family:monospace;color:var(--dark);letter-spacing:2px">
            ${currentPlate || '— None saved'}
          </div>
        </div>

        <div style="font-size:0.8125rem;font-weight:600;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.4px">Update Plate Number</div>
        <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem">
          <input class="form-input" id="new-plate" placeholder="e.g. AA 12345" style="font-family:monospace;font-weight:700;letter-spacing:1px;text-transform:uppercase">
          <input class="form-input" id="plate-notes" placeholder="Note (optional)" style="flex:1.5">
          <button class="btn btn-primary" id="plate-save">Save</button>
        </div>

        <div style="font-size:0.8125rem;font-weight:600;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.4px">History</div>
        <div style="max-height:240px;overflow-y:auto">
          ${(history||[]).length === 0
            ? '<div class="empty"><div class="empty-text">No plate history yet</div></div>'
            : (history||[]).map(h => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-family:monospace;font-weight:700;font-size:1rem;letter-spacing:1px">${h.plate_number}</div>
                  ${h.notes ? `<div style="font-size:0.75rem;color:var(--muted)">${h.notes}</div>` : ''}
                </div>
                <div style="font-size:0.75rem;color:var(--muted);text-align:right">
                  ${new Date(h.changed_at).toLocaleString('en-ET', { dateStyle:'medium', timeStyle:'short' })}
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    // Auto-uppercase plate input
    overlay.querySelector('#new-plate').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase()
    })

    overlay.querySelector('#plate-close').addEventListener('click', () => overlay.remove())

    overlay.querySelector('#plate-save').addEventListener('click', async () => {
      const newPlate = overlay.querySelector('#new-plate').value.trim().toUpperCase()
      const notes    = overlay.querySelector('#plate-notes').value.trim() || null
      if (!newPlate) { alert('Enter a plate number'); return }

      const saveBtn = overlay.querySelector('#plate-save')
      saveBtn.disabled = true; saveBtn.textContent = 'Saving...'

      // Insert history record
      await supabase.from('plate_history').insert({
        entity_type:  'customer',
        entity_id:    entityId,
        plate_number: newPlate,
        notes,
      })

      // Update snapshot on customer record
      await supabase.from('customers').update({ plate_number: newPlate }).eq('id', entityId)

      overlay.remove()
      showToast(`Plate updated to ${newPlate}`, 'success')
      loadTab() // Refresh list
    })
  }

  // ── Lend Modal ──────────────────────────────────────────────
  function openLendModal(customerId, customerName) {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.display = 'flex'

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Lend to ${customerName}</div>
          <button class="modal-close" id="lend-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Amount Lent (ETB) *</label>
          <input type="number" class="form-input" id="lend-amount" placeholder="0.00" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input" id="lend-type">
            <option value="product">Product/Goods Loan</option>
            <option value="cash">Cash Loan (deducts from account)</option>
          </select>
        </div>
        <div class="form-group" id="lend-account-group" style="display:none">
          <label class="form-label">Cash Account to Deduct From</label>
          <select class="form-input" id="lend-account">
            ${(accounts||[]).map(a => `<option value="${a.id}">${a.account_name} (${a.account_type === 'till' ? 'Till' : 'Bank'})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="lend-notes" placeholder="e.g. borrowed 500 ETB cash">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="lend-cancel">Cancel</button>
          <button class="btn btn-primary" id="lend-save">✓ Save Loan</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    overlay.querySelector('#lend-type').addEventListener('change', e => {
      overlay.querySelector('#lend-account-group').style.display = e.target.value === 'cash' ? 'block' : 'none'
    })

    const close = () => overlay.remove()
    overlay.querySelector('#lend-close').addEventListener('click', close)
    overlay.querySelector('#lend-cancel').addEventListener('click', close)

    overlay.querySelector('#lend-save').addEventListener('click', async () => {
      const amount = Number(overlay.querySelector('#lend-amount').value)
      const type = overlay.querySelector('#lend-type').value
      const accountId = overlay.querySelector('#lend-account').value
      const notes = overlay.querySelector('#lend-notes').value.trim()

      if (!amount || amount <= 0) { alert('Enter valid amount'); return }
      const saveBtn = overlay.querySelector('#lend-save')
      saveBtn.disabled = true; saveBtn.textContent = 'Saving...'

      const currentStore = appStore.getState().currentStore
      const { error: creditErr } = await supabase.from('credit_sales').insert({
        store_id: currentStore?.id,
        customer_id: customerId,
        amount_owed: amount,
        amount_paid: 0,
        status: 'unpaid'
      })

      if (creditErr) {
        alert('Error saving loan: ' + creditErr.message)
        saveBtn.disabled = false; saveBtn.textContent = '✓ Save Loan'
        return
      }

      if (type === 'cash' && accountId) {
        // Safe deduction
        const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', accountId).single()
        if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) - amount }).eq('id', accountId)
      }

      close()
      loadTab()
    })
  }

  // ── Payment modal ─────────────────────────────────────────
  function openPaymentModal({ type, id, ids, name, remaining, onDone }) {
    const modal     = container.querySelector('#payment-modal')
    const titleEl   = container.querySelector('#payment-modal-title')
    const bodyEl    = container.querySelector('#payment-modal-body')

    titleEl.textContent = type === 'credit'
      ? `Record Payment — ${name}`
      : `Pay Vendor — ${name}`

    bodyEl.innerHTML = `
      <div style="background:var(--bg-light);border-radius:var(--radius);padding:0.75rem;margin-bottom:1rem">
        <div style="font-size:12px;color:var(--muted)">Remaining balance</div>
        <div style="font-size:1.4rem;font-weight:700;color:${type==='credit'?'var(--warning)':'var(--danger)'}">
          ${fmt(remaining)} ETB
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Amount Received (ETB) *</label>
        <input type="number" class="form-input" id="pay-amount" max="${remaining}" placeholder="0.00">
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline btn-sm" id="pay-full">Pay Full (${fmt(remaining)} ETB)</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Cash Account</label>
        <select class="form-input" id="pay-account">
          ${(accounts||[]).map(a => `<option value="${a.id}">${a.account_name} (${a.account_type === 'till' ? 'Till' : 'Bank'})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="form-input" id="pay-notes" placeholder="Optional">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
        <button class="btn btn-outline" id="pay-cancel">Cancel</button>
        <button class="btn btn-primary" id="pay-confirm">✓ Confirm Payment</button>
      </div>
    `

    modal.style.display = 'flex'

    bodyEl.querySelector('#pay-full').addEventListener('click', () => {
      bodyEl.querySelector('#pay-amount').value = remaining
    })
    container.querySelector('#payment-modal-close').addEventListener('click', () => {
      modal.style.display = 'none'
    })
    bodyEl.querySelector('#pay-cancel').addEventListener('click', () => {
      modal.style.display = 'none'
    })
    bodyEl.querySelector('#pay-confirm').addEventListener('click', async () => {
      const amount  = Number(bodyEl.querySelector('#pay-amount').value)
      const account = bodyEl.querySelector('#pay-account').value
      const notes   = bodyEl.querySelector('#pay-notes').value.trim()

      if (!amount || amount <= 0) { alert('Enter a valid amount'); return }
      if (amount > remaining + 0.01) { alert(`Cannot exceed remaining balance of ${fmt(remaining)} ETB`); return }

      if (type === 'credit') {
        // Waterfall: apply payment oldest-first across all unpaid credits for this customer
        const creditIds = ids || [id]
        let leftToApply = amount
        let firstRecord = null
        const date = new Date().toISOString().split('T')[0]

        for (const cid of creditIds) {
          if (leftToApply <= 0.001) break
          const { data: rec } = await supabase.from('credit_sales').select('amount_paid, amount_owed').eq('id', cid).single()
          if (!rec) continue
          if (!firstRecord) firstRecord = rec
          const canApply  = Number(rec.amount_owed) - Number(rec.amount_paid)
          if (canApply <= 0.001) continue
          const applying  = Math.min(leftToApply, canApply)
          const newPaid   = Number(rec.amount_paid) + applying
          const newStatus = newPaid >= Number(rec.amount_owed) - 0.01 ? 'paid' : 'partial'
          await supabase.from('credit_sales').update({ amount_paid: newPaid, status: newStatus }).eq('id', cid)
          leftToApply -= applying
        }

        // Record payment in payment_history table
        await supabase.from('payment_history').insert({
          customer_id: (await supabase.from('credit_sales').select('customer_id').eq('id', creditIds[0]).single()).data?.customer_id,
          credit_sale_id: creditIds[0], // Primary credit sale this payment was applied to
          payment_amount: amount,
          payment_date: date,
          payment_method: 'cash',
          cash_account_id: account,
          notes: notes || null
        })

        // Update customer credit_balance
        const customerId = (await supabase.from('credit_sales').select('customer_id').eq('id', creditIds[0]).single()).data?.customer_id
        if (customerId) {
          await supabase.rpc('update_customer_credit', { 
            customer_id: customerId, 
            payment_amount: amount 
          })
        }

        // ── Transport fee recovery (proportional) ────────────────────
        try {
          const { data: pendingTfs } = await supabase.from('transport_fees')
            .select('*').in('credit_sale_id', creditIds)
            .eq('charge_customer', true).eq('fully_recovered', false)
          for (const tf of (pendingTfs || [])) {
            if (!tf.credit_sale_id) continue
            const { data: cs } = await supabase.from('credit_sales')
              .select('amount_owed, amount_paid, transport_fee, transport_recovered').eq('id', tf.credit_sale_id).single()
            if (!cs || !Number(cs.transport_fee)) continue
            const appliedToThis = Math.min(amount, Number(cs.amount_owed)) // payment applied to this sale
            const recoverRatio = Number(cs.amount_owed) > 0 ? appliedToThis / Number(cs.amount_owed) : 0
            const toRecover = Math.min(
              Number(tf.amount) - Number(tf.recovered_amount),
              Number(tf.amount) * recoverRatio
            )
            if (toRecover <= 0.001) continue
            const newRecovered = Number(tf.recovered_amount) + toRecover
            const fullyRecovered = newRecovered >= Number(tf.amount) - 0.01
            await supabase.from('transport_fees').update({
              recovered_amount: newRecovered,
              fully_recovered:  fullyRecovered,
              ...(fullyRecovered ? { recovered_at: new Date().toISOString() } : {}),
            }).eq('id', tf.id)
            await supabase.from('credit_sales').update({
              transport_recovered: Number(cs.transport_recovered || 0) + toRecover,
            }).eq('id', tf.credit_sale_id)
          }
        } catch(tfErr) { console.warn('Transport recovery failed:', tfErr.message) }

        // Credit cash account (money coming IN)
        if (account) {
          const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', account).single()
          if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) + amount }).eq('id', account)
        }

        modal.style.display = 'none'
        invalidateAfterSale()

        if (firstRecord) await audit.creditPaymentReceived(firstRecord, amount, name)
        try {
          await postCreditPaymentEntry({
            storeId:  currentStore?.id,
            creditId: (ids || [id])[0],
            date,
            amount,
          })
        } catch(e) { console.warn('Journal post failed:', e.message) }

      } else {
        // Single vendor debt
        const { data: record } = await supabase.from('vendor_debts').select('amount_paid, amount_owed').eq('id', id).single()
        const newPaid   = Number(record.amount_paid) + amount
        const newStatus = newPaid >= Number(record.amount_owed) - 0.01 ? 'paid' : 'partial'
        await supabase.from('vendor_debts').update({ amount_paid: newPaid, status: newStatus }).eq('id', id)

        // Debit cash account (money going OUT)
        if (account) {
          const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', account).single()
          if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) - amount }).eq('id', account)
        }

        modal.style.display = 'none'
        invalidateAfterExpense()

        await audit.vendorPaymentMade(record, amount, name)
        try {
          await postVendorPaymentEntry({
            storeId: currentStore?.id,
            debtId:  id,
            date:    new Date().toISOString().split('T')[0],
            amount,
          })
        } catch(e) { console.warn('Journal post failed:', e.message) }
      }

      await onDone()
    })
  }

  // ── Customer history modal ──────────────────────────────
  async function openCustomerHistory(customerId, customerName) {
    const [{ data: customer }, { data: credits }, { data: payments }, { data: tfs }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).single(),
      supabase.from('credit_sales')
        .select(`
          *,
          sales!inner(
            sale_date, 
            total_amount, 
            payment_method,
            sale_items(
              item_name_snapshot,
              quantity,
              unit_price,
              subtotal
            )
          )
        `)
        .eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('payment_history')
        .select('*')
        .eq('customer_id', customerId).order('payment_date', { ascending: false }),
      supabase.from('transport_fees').select('*').eq('charge_customer', true)
        .in('credit_sale_id', (await supabase.from('credit_sales').select('id').eq('customer_id', customerId)).data?.map(c => c.id) || []),
    ])

    const histOverlay = document.createElement('div')
    histOverlay.className = 'modal-overlay'
    histOverlay.style.display = 'flex'

    const totalOwed        = (credits||[]).reduce((s,c) => s + Number(c.amount_owed), 0)
    const totalPaid        = (credits||[]).reduce((s,c) => s + Number(c.amount_paid), 0)
    const outstanding      = totalOwed - totalPaid
    const totalTransport   = (tfs||[]).reduce((s,t) => s + Number(t.amount), 0)
    const recoveredTransport = (tfs||[]).reduce((s,t) => s + Number(t.recovered_amount), 0)
    const pendingTransport = totalTransport - recoveredTransport
    const creditLimit     = Number(customer?.credit_limit || 0)
    const currentBalance   = Number(customer?.credit_balance || 0)
    const utilizationPct   = creditLimit > 0 ? Math.round((currentBalance / creditLimit) * 100) : 0

    histOverlay.innerHTML = `
      <div class="modal" style="max-width:680px">
        <div class="modal-header">
          <div class="modal-title">📒 ${customerName || 'Customer'} — Credit Account</div>
          <button class="modal-close" id="hist-close">✕</button>
        </div>

        <!-- Customer Header -->
        <div style="background:var(--bg-subtle);border-radius:12px;padding:1.25rem;margin-bottom:1.25rem">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
            <div>
              <h3 style="margin:0 0 0.5rem 0;color:var(--dark)">${customerName || 'Customer'}</h3>
              ${customer?.phone ? `<div style="color:var(--muted);font-size:0.875rem">📞 ${customer.phone}</div>` : ''}
              ${(customer?.last_targa || customer?.default_place) ? `
                <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:0.5rem;font-size:0.8125rem">
                  ${customer.last_targa ? `<span>🚗 <b style="font-family:monospace">${customer.last_targa}</b></span>` : ''}
                  ${customer.default_place ? `<span>📍 ${customer.default_place}</span>` : ''}
                </div>
              ` : ''}
            </div>
            <button class="btn btn-primary btn-sm" id="record-payment-btn" data-customer-id="${customerId}" data-customer-name="${customerName}">
              + Record Payment
            </button>
          </div>
          
          <!-- Credit Stats -->
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">
            <div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Current Balance</div>
              <div style="font-size:1.5rem;font-weight:700;color:var(--warning)">${fmt(currentBalance)} ETB</div>
            </div>
            <div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.25rem">Credit Limit</div>
              <div style="font-size:1.5rem;font-weight:700;color:var(--dark)">${fmt(creditLimit)} ETB</div>
            </div>
          </div>
          
          <!-- Progress Bar -->
          ${creditLimit > 0 ? `
            <div style="margin-top:1rem">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                <span style="font-size:0.75rem;color:var(--muted)">Credit Utilization</span>
                <span style="font-size:0.75rem;font-weight:600;color:${utilizationPct > 80 ? 'var(--danger)' : utilizationPct > 60 ? 'var(--warning)' : 'var(--accent)'}">${utilizationPct}%</span>
              </div>
              <div style="height:8px;background:var(--border);border-radius:999px;overflow:hidden">
                <div style="height:100%;width:${utilizationPct}%;background:${utilizationPct > 80 ? 'var(--danger)' : utilizationPct > 60 ? 'var(--warning)' : 'var(--accent)'};transition:width 0.3s"></div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem;border-bottom:2px solid var(--border)">
          <button class="history-tab-btn active" data-tab="sales" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid var(--accent);margin-bottom:-2px;color:var(--accent)">
            Credit Sales (${credits?.length || 0})
          </button>
          <button class="history-tab-btn" data-tab="payments" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--muted)">
            Payment History (${payments?.length || 0})
          </button>
          ${pendingTransport > 0 ? `
            <button class="history-tab-btn" data-tab="transport" style="padding:0.5rem 1rem;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--muted)">
              Transport Fees
            </button>
          ` : ''}
        </div>

        <!-- Tab Content -->
        <div id="history-tab-content" style="max-height:400px;overflow-y:auto">
          ${renderCreditSalesTab(credits || [], tfs || [])}
        </div>
      </div>
    `

    document.body.appendChild(histOverlay)

    // Tab switching
    const tabBtns = histOverlay.querySelectorAll('.history-tab-btn')
    const tabContent = histOverlay.querySelector('#history-tab-content')
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => {
          b.style.color = 'var(--muted)'
          b.style.borderBottom = '2px solid transparent'
        })
        btn.style.color = 'var(--accent)'
        btn.style.borderBottom = '2px solid var(--accent)'
        
        const tab = btn.dataset.tab
        if (tab === 'sales') tabContent.innerHTML = renderCreditSalesTab(credits || [], tfs || [])
        if (tab === 'payments') tabContent.innerHTML = renderPaymentsTab(payments || [])
        if (tab === 'transport') tabContent.innerHTML = renderTransportTab(tfs || [])
      })
    })

    // Close modal
    histOverlay.querySelector('#hist-close').addEventListener('click', () => histOverlay.remove())
    histOverlay.addEventListener('click', e => { if (e.target === histOverlay) histOverlay.remove() })

    // Record payment button
    histOverlay.querySelector('#record-payment-btn').addEventListener('click', () => {
      openPaymentModal({
        type: 'credit',
        ids: (credits || []).filter(c => c.status !== 'paid').sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(c => c.id),
        name: customerName,
        remaining: outstanding,
        onDone: () => {
          histOverlay.remove()
          loadTab()
        }
      })
    })
  }

  function renderCreditSalesTab(credits, transportFees) {
    if (!credits.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No credit sales found</div>'

    return credits.map(credit => {
      const remaining = Number(credit.amount_owed) - Number(credit.amount_paid)
      const status = remaining <= 0.01 ? 'paid' : Number(credit.amount_paid) > 0 ? 'partial' : 'unpaid'
      const transportFee = transportFees.find(tf => tf.credit_sale_id === credit.id)
      const items = credit.sales?.sale_items || []
      
      return `
        <div style="border:1px solid var(--border);border-radius:12px;margin-bottom:1rem;background:var(--bg-elevated)">
          <!-- Header -->
          <div style="padding:1rem;display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">
            <div>
              <div style="font-weight:600;color:var(--dark);margin-bottom:0.25rem">
                ${credit.sales?.sale_date || new Date(credit.created_at).toLocaleDateString()}
              </div>
              <div style="font-size:0.875rem;color:var(--muted)">
                ${items.length} item${items.length !== 1 ? 's' : ''} • ${credit.sales?.payment_method || 'credit'}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:1.0625rem;color:var(--accent)">${fmt(credit.amount_owed)} ETB</div>
              <div style="font-size:0.75rem;color:var(--muted)">Total Sale</div>
              <span class="badge ${status==='paid' ? 'badge-green' : status==='partial' ? 'badge-yellow' : 'badge-grey'}" style="margin-top:0.25rem">
                ${status}
              </span>
            </div>
          </div>
          
          <!-- Expandable Details -->
          <div style="display:none;border-top:1px solid var(--border)">
            <div style="padding:1rem">
              <!-- Payment Status -->
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1rem">
                <div style="text-align:center;padding:0.75rem;background:var(--bg-subtle);border-radius:8px">
                  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem">Total Sale</div>
                  <div style="font-weight:600">${fmt(credit.amount_owed)} ETB</div>
                </div>
                <div style="text-align:center;padding:0.75rem;background:var(--bg-subtle);border-radius:8px">
                  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem">Paid</div>
                  <div style="font-weight:600;color:var(--accent)">${fmt(credit.amount_paid)} ETB</div>
                </div>
                <div style="text-align:center;padding:0.75rem;background:var(--bg-subtle);border-radius:8px">
                  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem">Remaining</div>
                  <div style="font-weight:600;color:${remaining > 0 ? 'var(--warning)' : 'var(--accent)'}">
                    ${remaining > 0 ? fmt(remaining) + ' ETB' : '✓ Paid'}
                  </div>
                </div>
              </div>
              
              <!-- Line Items -->
              ${items.length > 0 ? `
                <div style="margin-bottom:1rem">
                  <div style="font-weight:600;margin-bottom:0.5rem;color:var(--dark)">Line Items</div>
                  ${items.map(item => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--border)">
                      <div>
                        <div style="font-weight:500">${item.item_name_snapshot || 'Unknown Item'}</div>
                        <div style="font-size:0.8125rem;color:var(--muted)">Qty: ${item.quantity} × ${fmt(item.unit_price)} ETB</div>
                      </div>
                      <div style="font-weight:600">${fmt(item.subtotal || (item.unit_price * item.quantity))} ETB</div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              
              <!-- Transport Fee -->
              ${transportFee ? `
                <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:0.75rem">
                  <div style="font-weight:600;color:#92400E;margin-bottom:0.25rem">🚚 Transport Fee</div>
                  <div style="display:flex;justify-content:space-between">
                    <span>Fee: ${fmt(transportFee.amount)} ETB</span>
                    <span>Recovered: ${fmt(transportFee.recovered_amount || 0)} ETB</span>
                  </div>
                </div>
              ` : ''}
              
              <!-- Notes -->
              ${credit.notes ? `
                <div style="margin-top:0.75rem">
                  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem">Notes</div>
                  <div style="font-style:italic;color:var(--dark)">${credit.notes}</div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  function renderPaymentsTab(payments) {
    if (!payments.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No payments recorded</div>'

    let runningBalance = 0
    return payments.map(payment => {
      runningBalance += Number(payment.payment_amount)
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:600">${new Date(payment.payment_date).toLocaleDateString()}</div>
            <div style="font-size:0.8125rem;color:var(--muted)">${payment.payment_method}</div>
            ${payment.notes ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:0.25rem">${payment.notes}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:var(--accent);font-size:1.0625rem">+${fmt(payment.payment_amount)} ETB</div>
            <div style="font-size:0.75rem;color:var(--muted)">Balance: ${fmt(runningBalance)} ETB</div>
          </div>
        </div>
      `
    }).join('')
  }

  function renderTransportTab(transportFees) {
    if (!transportFees.length) return '<div style="text-align:center;padding:2rem;color:var(--muted)">No transport fees</div>'

    return transportFees.map(tf => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600">${fmt(tf.amount)} ETB</div>
          <div style="font-size:0.8125rem;color:var(--muted)">${tf.worker_name || 'Unknown'}</div>
          ${tf.note ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:0.25rem">${tf.note}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-weight:600;color:${tf.fully_recovered ? 'var(--accent)' : 'var(--warning)'}">
            ${tf.fully_recovered ? '✓ Recovered' : fmt(tf.amount - (tf.recovered_amount || 0)) + ' ETB'}
          </div>
          <div style="font-size:0.75rem;color:var(--muted)">
            ${fmt(tf.recovered_amount || 0)} / ${fmt(tf.amount)}
          </div>
        </div>
      </div>
    `).join('')
  }

  // Init
  await loadTab()
}

// ── Accounts loaded for payment modal ─────────────────────────
let accounts = []
async function loadAccounts(storeIds) {
  const { data } = await supabase.from('cash_accounts').select('id, account_name, account_type').in('store_id', storeIds)
  accounts = data || []
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-container'; document.body.appendChild(wrap) }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}
