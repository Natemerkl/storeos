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
        <div class="kpi-label">Total Purchases</div>
        <div class="kpi-value" id="total-purchases">0</div>
        <div class="kpi-sub">all time</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">This Month</div>
        <div class="kpi-value" id="month-amount">0.00</div>
        <div class="kpi-sub">ETB spent</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Top Supplier</div>
        <div class="kpi-value" id="top-vendor" style="font-size:1rem">—</div>
        <div class="kpi-sub">by volume</div>
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
              <th>Total Purchases</th>
              <th>Total Spent</th>
              <th>Last Purchase</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="vendors-body">
            <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
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

    <!-- Purchase History Modal -->
    <div id="history-modal" class="modal-overlay" style="display:none">
      <div class="modal" style="max-width:800px">
        <div class="modal-header">
          <div class="modal-title" id="history-title">Purchase History</div>
          <button class="modal-close" id="history-close">${renderIcon('close', 14)}</button>
        </div>
        <div id="history-content">
          <div style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>
        </div>
      </div>
    </div>
  `

  let allVendors = []
  let allPurchases = []
  let editingId = null

  // ── Load Data ──────────────────────────────────────────────
  async function loadVendors() {
    const [{ data: vendors }, { data: purchases }] = await Promise.all([
      supabase.from('vendors').select('*').in('store_id', storeIds).order('vendor_name'),
      supabase.from('vendor_purchases').select('*').in('store_id', storeIds).order('purchase_date', { ascending: false })
    ])

    allVendors = vendors || []
    allPurchases = purchases || []

    updateSummary()
    applyFilters()
  }

  function updateSummary() {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    
    const monthPurchases = allPurchases.filter(p => p.purchase_date >= monthStart)
    const monthAmount = monthPurchases.reduce((s, p) => s + Number(p.total_cost), 0)

    // Count purchases per vendor
    const vendorCounts = {}
    allPurchases.forEach(p => {
      vendorCounts[p.vendor_id] = (vendorCounts[p.vendor_id] || 0) + 1
    })
    const topVendorId = Object.entries(vendorCounts).sort((a,b) => b[1]-a[1])[0]?.[0]
    const topVendor = allVendors.find(v => v.id === topVendorId)

    container.querySelector('#total-vendors').textContent = allVendors.length
    container.querySelector('#total-purchases').textContent = allPurchases.length
    container.querySelector('#month-amount').textContent = fmt(monthAmount)
    container.querySelector('#top-vendor').textContent = topVendor?.vendor_name || '—'
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
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No suppliers yet. Add your first supplier.</div></div></td></tr>`
      return
    }

    tbody.innerHTML = vendors.map(v => {
      const purchases = allPurchases.filter(p => p.vendor_id === v.id)
      const totalSpent = purchases.reduce((s, p) => s + Number(p.total_cost), 0)
      const lastPurchase = purchases[0]?.purchase_date || null

      return `
        <tr>
          <td><strong>${v.vendor_name}</strong></td>
          <td>${v.contact_person || '—'}</td>
          <td>${v.phone || '—'}</td>
          <td style="color:var(--muted);font-size:0.875rem">${v.email || '—'}</td>
          <td><span class="badge badge-grey">${purchases.length} orders</span></td>
          <td style="font-weight:600;color:var(--accent)">${fmt(totalSpent)} ETB</td>
          <td>${lastPurchase ? formatDate(lastPurchase) : '—'}</td>
          <td>
            <div style="display:flex;gap:0.4rem">
              <button class="btn btn-outline btn-sm" data-action="history" data-id="${v.id}" data-name="${v.vendor_name}">
                ${renderIcon('reports', 13)} History
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
        if (action === 'history') openHistoryModal(id, name)
      })
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
    const purchases = allPurchases.filter(p => p.vendor_id === id)
    
    if (purchases.length > 0) {
      if (!confirm(`This supplier has ${purchases.length} purchase(s) recorded. Delete anyway?`)) return
    } else {
      if (!confirm('Delete this supplier?')) return
    }

    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { alert('Error deleting supplier'); return }
    await loadVendors()
  }

  // ── Purchase History Modal ─────────────────────────────────
  async function openHistoryModal(vendorId, vendorName) {
    container.querySelector('#history-title').textContent = `Purchase History — ${vendorName}`
    container.querySelector('#history-modal').style.display = 'flex'
    
    const purchases = allPurchases.filter(p => p.vendor_id === vendorId)
    const totalSpent = purchases.reduce((s, p) => s + Number(p.total_cost), 0)
    const totalQty = purchases.reduce((s, p) => s + Number(p.quantity), 0)

    if (purchases.length === 0) {
      container.querySelector('#history-content').innerHTML = `
        <div class="empty">
          <div class="empty-icon">📋</div>
          <div class="empty-text">No purchase history yet</div>
        </div>
      `
      return
    }

    container.querySelector('#history-content').innerHTML = `
      <!-- Summary -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
        <div style="text-align:center;padding:1rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:1.5rem;font-weight:800;color:var(--accent)">${purchases.length}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">Total Orders</div>
        </div>
        <div style="text-align:center;padding:1rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:1.5rem;font-weight:800;color:var(--accent)">${fmt(totalQty)}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">Total Items</div>
        </div>
        <div style="text-align:center;padding:1rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:1.5rem;font-weight:800;color:var(--accent)">${fmt(totalSpent)}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">Total Spent (ETB)</div>
        </div>
      </div>

      <!-- Purchase List -->
      <div style="font-weight:700;margin-bottom:0.75rem">Purchase History</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit Cost</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${purchases.map(p => `
              <tr>
                <td>${formatDate(p.purchase_date)}</td>
                <td><strong>${p.product_name}</strong></td>
                <td>${fmt(p.quantity)}</td>
                <td>${fmt(p.unit_cost)} ETB</td>
                <td style="font-weight:600;color:var(--accent)">${fmt(p.total_cost)} ETB</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  function closeHistoryModal() {
    container.querySelector('#history-modal').style.display = 'none'
  }

  // ── Event Listeners ────────────────────────────────────────
  container.querySelector('#btn-add-vendor').addEventListener('click', openAddModal)
  container.querySelector('#modal-close').addEventListener('click', closeModal)
  container.querySelector('#modal-cancel').addEventListener('click', closeModal)
  container.querySelector('#modal-save').addEventListener('click', saveVendor)
  container.querySelector('#history-close').addEventListener('click', closeHistoryModal)
  container.querySelector('#search').addEventListener('input', applyFilters)
  container.querySelector('#btn-refresh').addEventListener('click', loadVendors)

  // Close modals on overlay click
  container.querySelector('#vendor-modal').addEventListener('click', e => {
    if (e.target.id === 'vendor-modal') closeModal()
  })
  container.querySelector('#history-modal').addEventListener('click', e => {
    if (e.target.id === 'history-modal') closeHistoryModal()
  })

  // ── Init ───────────────────────────────────────────────────
  await loadVendors()
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
