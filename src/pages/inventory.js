import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { audit } from '../utils/audit.js'
import { getInventory, invalidateAfterInventory } from '../utils/db.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Inventory</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-add">+ Add Item</button>
    </div>

    <!-- Inventory Summary -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1rem">
      <div class="kpi-card">
        <div class="kpi-label">Total Inventory Value</div>
        <div class="kpi-value" id="sum-total-value">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Items</div>
        <div class="kpi-value" id="sum-total-items">0</div>
        <div class="kpi-sub">unique products</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Units</div>
        <div class="kpi-value" id="sum-total-units">0</div>
        <div class="kpi-sub">in stock</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Potential Revenue</div>
        <div class="kpi-value" id="sum-potential-revenue">0.00</div>
        <div class="kpi-sub">ETB (at selling price)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Low Stock Items</div>
        <div class="kpi-value" id="sum-low-stock" style="color:var(--warning)">0</div>
        <div class="kpi-sub">need reorder</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Out of Stock</div>
        <div class="kpi-value" id="sum-out-stock" style="color:var(--danger)">0</div>
        <div class="kpi-sub">items</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
        <input class="form-input" id="search" placeholder="Search items..." style="max-width:260px">
        <select class="form-input" id="filter-category" style="max-width:180px">
          <option value="">All Categories</option>
        </select>
        <select class="form-input" id="filter-stock" style="max-width:160px">
          <option value="">All Stock Levels</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
          <option value="ok">In Stock</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item Name</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Qty</th>
              <th>Unit Cost</th>
              <th>Selling Price</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="inventory-body">
            <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <div id="item-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="modal-title">Add Item</div>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Item Name *</label>
          <input class="form-input" id="f-name" placeholder="e.g. Coca Cola 500ml">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">SKU</label>
            <input class="form-input" id="f-sku" placeholder="e.g. CC-500">
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <input class="form-input" id="f-category" placeholder="e.g. Beverages">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Quantity</label>
            <input class="form-input" id="f-qty" type="number" min="0" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Unit Cost (ETB)</label>
            <input class="form-input" id="f-cost" type="number" min="0" placeholder="0.00">
          </div>
          <div class="form-group">
            <label class="form-label">Selling Price (ETB)</label>
            <input class="form-input" id="f-price" type="number" min="0" placeholder="0.00">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Low Stock Threshold</label>
            <input class="form-input" id="f-threshold" type="number" min="0" placeholder="5">
          </div>
          <div class="form-group">
            <label class="form-label">Supplier</label>
            <input class="form-input" id="f-supplier" placeholder="Supplier name" list="vendor-list">
            <datalist id="vendor-list">
              <!-- Populated dynamically -->
            </datalist>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Payment</label>
          <div id="inv-payment-section" style="margin-top:0.375rem"></div>
        </div>
        <div id="inv-credit-fields" style="display:none;margin-top:0.25rem;margin-bottom:0.25rem">
          <div style="padding:0.5rem 0.75rem;background:var(--amber-50);border:1px solid #FDE68A;border-radius:8px;font-size:0.8125rem;font-weight:600;color:#92400E">
            Supplier field (above) required — amount owed = qty × unit cost
          </div>
        </div>
        <div style="background:var(--bg-subtle);border-radius:10px;padding:0.75rem;margin-top:0.25rem">
          <div style="font-size:0.8125rem;font-weight:700;color:var(--muted);margin-bottom:0.625rem;text-transform:uppercase;letter-spacing:0.4px">🚚 Transport / Delivery (optional)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.625rem">
            <div class="form-group" style="margin:0">
              <label class="form-label">Transport Fee (ETB)</label>
              <input type="number" class="form-input" id="f-transport" min="0" placeholder="0.00">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Plate / Targa</label>
              <input class="form-input" id="f-targa" placeholder="e.g. AA-12345" style="font-family:monospace;text-transform:uppercase">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Delivery Place</label>
              <input class="form-input" id="f-place" placeholder="e.g. Merkato">
            </div>
          </div>
          <div id="inv-transport-pay-row" style="margin-top:0.5rem;display:none">
            <div style="font-size:0.75rem;font-weight:600;color:var(--muted);margin-bottom:0.25rem">Transport Payment</div>
            <div style="display:flex;gap:0.375rem">
              <button type="button" id="inv-tp-yes" style="padding:0.25rem 0.75rem;border-radius:var(--radius-pill);font-size:0.8125rem;font-weight:600;cursor:pointer;border:1.5px solid var(--accent);background:var(--teal-50);color:var(--accent)">Paid Now</button>
              <button type="button" id="inv-tp-no" style="padding:0.25rem 0.75rem;border-radius:var(--radius-pill);font-size:0.8125rem;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--bg-elevated);color:var(--muted)">Owe Driver</button>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save Item</button>
        </div>
      </div>
    </div>

    <!-- Stock Movement Modal -->
    <div id="stock-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="stock-modal-title">Update Stock</div>
          <button class="modal-close" id="stock-modal-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Movement Type</label>
          <select class="form-input" id="s-type">
            <option value="in">Stock In</option>
            <option value="out">Stock Out</option>
            <option value="adjustment">Adjustment (set exact qty)</option>
            <option value="loss">Loss / Damage</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Quantity</label>
          <input class="form-input" id="s-qty" type="number" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="s-notes" placeholder="Optional notes">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="stock-cancel">Cancel</button>
          <button class="btn btn-primary" id="stock-save">Update Stock</button>
        </div>
      </div>
    </div>
  `

  let allItems = []
  let editingId = null
  let stockItemId = null
  let cashAccounts = []
  let vendors = []
  let invPayMethod = 'cash'
  let invAccountId = ''
  let invTransportPaidNow = true

  // ── Load data ──────────────────────────────────────────────
  async function loadItems() {
    const data = await getInventory()
    allItems = data || []

    // Load cash accounts for current store
    const { data: accounts } = await supabase
      .from('cash_accounts')
      .select('*')
      .eq('store_id', currentStore?.id)
      .order('account_name')
    cashAccounts = accounts || []
    console.log('Inventory: Loaded cash accounts:', cashAccounts)

    // Load vendors for current store
    const { data: vendorData } = await supabase
      .from('vendors')
      .select('*')
      .eq('store_id', currentStore?.id)
      .order('vendor_name')
    vendors = vendorData || []
    console.log('Inventory: Loaded vendors:', vendors)

    console.log('Populating vendor datalist...')
    // Populate categories
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))]
    const catSelect = container.querySelector('#filter-category')
    if (catSelect) {
      catSelect.innerHTML = `<option value="">All Categories</option>` +
        cats.map(c => `<option value="${c}">${c}</option>`).join('')
    }

    updateSummary()
    renderTable(allItems)
  }

  function updateSummary() {
    // Calculate total inventory value (quantity × unit_cost)
    const totalValue = allItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0
      const cost = Number(item.unit_cost) || 0
      return sum + (qty * cost)
    }, 0)

    // Calculate potential revenue (quantity × selling_price)
    const potentialRevenue = allItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0
      const price = Number(item.selling_price) || 0
      return sum + (qty * price)
    }, 0)

    // Total unique items
    const totalItems = allItems.length

    // Total units in stock
    const totalUnits = allItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)

    // Count stock status
    let lowStockCount = 0
    let outOfStockCount = 0
    allItems.forEach(item => {
      const qty = Number(item.quantity) || 0
      const threshold = Number(item.low_stock_threshold) || 5
      if (qty === 0) {
        outOfStockCount++
      } else if (qty <= threshold) {
        lowStockCount++
      }
    })

    // Update UI
    const setValue = (id, value) => {
      const el = container.querySelector(`#${id}`)
      if (el) el.textContent = value
    }

    setValue('sum-total-value', fmt(totalValue))
    setValue('sum-total-items', totalItems)
    setValue('sum-total-units', totalUnits)
    setValue('sum-potential-revenue', fmt(potentialRevenue))
    setValue('sum-low-stock', lowStockCount)
    setValue('sum-out-stock', outOfStockCount)
  }

  function renderTable(items) {
    const tbody = container.querySelector('#inventory-body')
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No items yet. Add your first item.</div></div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(item => {
      const qty       = Number(item.quantity)
      const threshold = Number(item.low_stock_threshold || 5)
      const status    = qty === 0 ? 'out' : qty <= threshold ? 'low' : 'ok'
      const badge     = status === 'out' ? 'badge-red' : status === 'low' ? 'badge-yellow' : 'badge-green'
      const label     = status === 'out' ? 'Out of Stock' : status === 'low' ? 'Low Stock' : 'In Stock'
      const accountBadge = item.paid_from_account_name 
        ? `<span class="badge" style="background:var(--primary-light);color:var(--primary);font-size:0.7rem;margin-left:0.3rem">💳 ${item.paid_from_account_name}</span>` 
        : ''

      return `
        <tr>
          <td><strong>${item.item_name}</strong>${accountBadge}</td>
          <td style="color:var(--muted)">${item.sku || '—'}</td>
          <td>${item.category || '—'}</td>
          <td><strong>${qty}</strong></td>
          <td>${item.unit_cost ? fmt(item.unit_cost) + ' ETB' : '—'}</td>
          <td>${item.selling_price ? fmt(item.selling_price) + ' ETB' : '—'}</td>
          <td><span class="badge ${badge}">${label}</span></td>
          <td>
            <div style="display:flex;gap:0.4rem">
              <button class="btn btn-outline btn-sm" data-action="stock" data-id="${item.id}" data-name="${item.item_name}">± Stock</button>
              <button class="btn btn-outline btn-sm" data-action="edit" data-id="${item.id}">Edit</button>
              <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border)" data-action="delete" data-id="${item.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
    }).join('')

    // Row action listeners
    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id, name } = btn.dataset
        if (action === 'edit')   openEditModal(id)
        if (action === 'stock')  openStockModal(id, name)
        if (action === 'delete') deleteItem(id)
      })
    })
  }

  // ── Search & Filter ────────────────────────────────────────
  function applyFilters() {
    const search   = container.querySelector('#search').value.toLowerCase()
    const category = container.querySelector('#filter-category').value
    const stock    = container.querySelector('#filter-stock').value

    let filtered = allItems.filter(i => {
      const matchSearch = i.item_name.toLowerCase().includes(search) ||
                          (i.sku || '').toLowerCase().includes(search)
      const matchCat    = !category || i.category === category
      const qty         = Number(i.quantity)
      const threshold   = Number(i.low_stock_threshold || 5)
      const matchStock  = !stock ||
        (stock === 'out' && qty === 0) ||
        (stock === 'low' && qty > 0 && qty <= threshold) ||
        (stock === 'ok'  && qty > threshold)
      return matchSearch && matchCat && matchStock
    })
    renderTable(filtered)
  }

  container.querySelector('#search').addEventListener('input', applyFilters)
  container.querySelector('#filter-category').addEventListener('change', applyFilters)
  container.querySelector('#filter-stock').addEventListener('change', applyFilters)

  // ── Add / Edit Modal ───────────────────────────────────────
  function openAddModal() {
    editingId = null
    container.querySelector('#modal-title').textContent = 'Add Item'
    container.querySelector('#f-name').value      = ''
    container.querySelector('#f-sku').value       = ''
    container.querySelector('#f-category').value  = ''
    container.querySelector('#f-qty').value       = ''
    container.querySelector('#f-cost').value      = ''
    container.querySelector('#f-price').value     = ''
    container.querySelector('#f-threshold').value = '5'
    container.querySelector('#f-supplier').value  = ''
    invPayMethod = cashAccounts.find(a=>a.account_type==='till') ? 'cash' : (cashAccounts.find(a=>a.account_type==='bank') ? 'bank_transfer' : 'credit')
    invAccountId = cashAccounts.find(a=>a.account_type==='till')?.id || cashAccounts.find(a=>a.account_type==='bank')?.id || ''
    injectInvPaymentUI()
    populateVendorList()
    container.querySelector('#inv-credit-fields').style.display = 'none'
    container.querySelector('#f-transport').value = ''
    container.querySelector('#f-targa').value     = ''
    container.querySelector('#f-place').value     = currentStore?.name || ''
    invTransportPaidNow = true
    wireTransportToggle()
    container.querySelector('#item-modal').style.display = 'flex'
  }

  function openEditModal(id) {
    const item = allItems.find(i => i.id === id)
    if (!item) return
    editingId = id
    container.querySelector('#modal-title').textContent     = 'Edit Item'
    container.querySelector('#f-name').value      = item.item_name      || ''
    container.querySelector('#f-sku').value       = item.sku            || ''
    container.querySelector('#f-category').value  = item.category       || ''
    container.querySelector('#f-qty').value       = item.quantity       ?? ''
    container.querySelector('#f-cost').value      = item.unit_cost      ?? ''
    container.querySelector('#f-price').value     = item.selling_price  ?? ''
    container.querySelector('#f-threshold').value = item.low_stock_threshold ?? 5
    container.querySelector('#f-supplier').value  = item.supplier       || ''
    if (item.paid_from_account_id) {
      const acc = cashAccounts.find(a => a.id === item.paid_from_account_id)
      if (acc) { invPayMethod = acc.account_type === 'till' ? 'cash' : 'bank_transfer'; invAccountId = acc.id }
    } else {
      invPayMethod = 'cash'; invAccountId = cashAccounts.find(a=>a.account_type==='till')?.id || ''
    }
    injectInvPaymentUI()
    populateVendorList()
    container.querySelector('#inv-credit-fields').style.display = 'none'
    container.querySelector('#f-transport').value = item.transport_fee  || ''
    container.querySelector('#f-targa').value     = item.targa          || ''
    container.querySelector('#f-place').value     = item.delivery_place || ''
    invTransportPaidNow = item.transport_paid_now !== false
    wireTransportToggle()
    if (Number(item.transport_fee) > 0) container.querySelector('#inv-transport-pay-row').style.display = 'block'
    container.querySelector('#item-modal').style.display = 'flex'
  }

  function closeModal() {
    container.querySelector('#item-modal').style.display = 'none'
  }

  function wireTransportToggle() {
    const tfInput = container.querySelector('#f-transport')
    const payRow  = container.querySelector('#inv-transport-pay-row')
    if (!tfInput || !payRow) return

    const syncBtns = () => {
      const yes = container.querySelector('#inv-tp-yes')
      const no  = container.querySelector('#inv-tp-no')
      if (!yes || !no) return
      yes.style.borderColor = invTransportPaidNow ? 'var(--accent)' : 'var(--border)'
      yes.style.background  = invTransportPaidNow ? 'var(--teal-50)' : 'var(--bg-elevated)'
      yes.style.color       = invTransportPaidNow ? 'var(--accent)' : 'var(--muted)'
      no.style.borderColor  = invTransportPaidNow ? 'var(--border)' : 'var(--accent)'
      no.style.background   = invTransportPaidNow ? 'var(--bg-elevated)' : 'var(--teal-50)'
      no.style.color        = invTransportPaidNow ? 'var(--muted)' : 'var(--accent)'
    }

    tfInput.addEventListener('input', () => {
      payRow.style.display = Number(tfInput.value) > 0 ? 'block' : 'none'
    })
    container.querySelector('#inv-tp-yes')?.addEventListener('click', () => { invTransportPaidNow = true;  syncBtns() })
    container.querySelector('#inv-tp-no')?.addEventListener('click',  () => { invTransportPaidNow = false; syncBtns() })
  }

  function populateVendorList() {
    const datalist = container.querySelector('#vendor-list')
    if (datalist) {
      datalist.innerHTML = vendors.map(v => `<option value="${v.vendor_name}">`).join('')
    }
  }

  function renderInvPaymentUI() {
    const pm    = invPayMethod
    const accId = invAccountId
    const tills = cashAccounts.filter(a => a.account_type === 'till')
    const banks = cashAccounts.filter(a => a.account_type === 'bank')
    return `
      <div style="display:flex;gap:0.375rem;flex-wrap:wrap;margin-bottom:0.375rem">
        ${['cash','credit'].map(p => `
          <button type="button" data-inv-pay="${p}" style="
            padding:0.3rem 0.875rem;border-radius:var(--radius-pill);
            font-size:0.8125rem;font-weight:600;cursor:pointer;
            border:1.5px solid ${pm===p?'var(--accent)':'var(--border)'};
            background:${pm===p?'var(--teal-50)':'var(--bg-elevated)'};
            color:${pm===p?'var(--accent)':'var(--muted)'};
          ">${p==='cash'?'Cash':'Credit'}</button>
        `).join('')}
      </div>
      ${pm === 'cash' ? `
        <div style="margin-bottom:0.375rem;padding:0.5rem 0.625rem;
          background:var(--bg-subtle);border-radius:10px;border:1px solid var(--border);">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
            text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.25rem">Cash Account</div>
          <div style="display:flex;gap:0.375rem;flex-wrap:wrap">
            ${tills.length
              ? tills.map(a => `<button type="button" data-inv-till="${a.id}" style="
                  padding:0.25rem 0.625rem;border-radius:var(--radius-pill);
                  font-size:0.8125rem;font-weight:600;cursor:pointer;
                  border:1.5px solid ${accId===a.id?'var(--accent)':'var(--border)'};
                  background:${accId===a.id?'var(--teal-50)':'var(--bg-elevated)'};
                  color:${accId===a.id?'var(--accent)':'var(--muted)'};
                ">${a.account_name}</button>`).join('')
              : '<span style="font-size:0.8125rem;color:var(--muted)">No till accounts</span>'
            }
          </div>
        </div>
      ` : ''}
      <div style="display:flex;gap:0.375rem;flex-wrap:wrap;align-items:center">
        ${banks.map(a => `<button type="button" data-inv-bank="${a.id}" style="
          padding:0.3rem 0.875rem;border-radius:var(--radius-pill);
          font-size:0.8125rem;font-weight:600;cursor:pointer;
          border:1.5px solid ${pm==='bank_transfer'&&accId===a.id?'var(--accent)':'var(--border)'};
          background:${pm==='bank_transfer'&&accId===a.id?'var(--teal-50)':'var(--bg-elevated)'};
          color:${pm==='bank_transfer'&&accId===a.id?'var(--accent)':'var(--muted)'};
        ">${a.bank_name||a.account_name}</button>`).join('')}
        <button type="button" id="inv-add-bank-btn" style="
          width:26px;height:26px;border-radius:50%;
          background:var(--bg-subtle);color:var(--muted);
          display:flex;align-items:center;justify-content:center;
          border:1px solid var(--border);cursor:pointer;font-size:1rem;font-weight:700;flex-shrink:0;
        " title="Add account">+</button>
      </div>
    `
  }

  function injectInvPaymentUI() {
    const section = container.querySelector('#inv-payment-section')
    if (!section) return
    section.innerHTML = renderInvPaymentUI()
    const creditFields = container.querySelector('#inv-credit-fields')

    section.querySelectorAll('[data-inv-pay]').forEach(b => b.addEventListener('click', () => {
      invPayMethod = b.dataset.invPay
      if (invPayMethod === 'cash') invAccountId = cashAccounts.find(a=>a.account_type==='till')?.id || ''
      else if (invPayMethod === 'credit') invAccountId = ''
      if (creditFields) creditFields.style.display = invPayMethod === 'credit' ? 'block' : 'none'
      injectInvPaymentUI()
    }))

    section.querySelectorAll('[data-inv-till]').forEach(b => b.addEventListener('click', () => {
      invAccountId = b.dataset.invTill
      injectInvPaymentUI()
    }))

    section.querySelectorAll('[data-inv-bank]').forEach(b => b.addEventListener('click', () => {
      invPayMethod = 'bank_transfer'; invAccountId = b.dataset.invBank
      injectInvPaymentUI()
    }))

    section.querySelector('#inv-add-bank-btn')?.addEventListener('click', openInvAddBankModal)
  }

  async function openInvAddBankModal() {
    const ov = document.createElement('div')
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:500;padding:1rem;'
    const bm = document.createElement('div')
    bm.style.cssText = 'background:var(--bg-elevated);border-radius:16px;width:100%;max-width:400px;box-shadow:var(--shadow-lg);border:1px solid var(--border);overflow:hidden;'
    bm.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;background:var(--dark);">
        <div style="font-weight:700;color:#fff;font-size:0.9375rem">Add Account</div>
        <button id="ibm-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;color:rgba(255,255,255,0.7);font-size:1rem">✕</button>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:0.875rem">
        <div><label class="form-label">Account Name *</label><input class="form-input" id="ibm-name" placeholder="e.g. CBE Account"></div>
        <div><label class="form-label">Type</label>
          <select class="form-input" id="ibm-type">
            <option value="till">🏪 Till (Cash in store)</option>
            <option value="bank">🏦 Bank Account</option>
          </select>
        </div>
        <div id="ibm-bank-fields" style="display:none;flex-direction:column;gap:0.625rem">
          <div><label class="form-label">Bank Name</label><input class="form-input" id="ibm-bank-name" placeholder="e.g. Commercial Bank of Ethiopia"></div>
          <div><label class="form-label">Account Number</label><input class="form-input" id="ibm-acc-num" placeholder="Optional"></div>
        </div>
        <div><label class="form-label">Opening Balance (ETB)</label><input class="form-input" type="number" id="ibm-balance" value="0" min="0" step="0.01"></div>
        <div style="display:flex;gap:0.625rem">
          <button class="btn btn-outline" id="ibm-cancel" style="flex:1;justify-content:center">Cancel</button>
          <button class="btn btn-primary" id="ibm-save" style="flex:2;justify-content:center">Save Account</button>
        </div>
      </div>`
    ov.appendChild(bm); document.body.appendChild(ov)
    const close = () => ov.remove()
    bm.querySelector('#ibm-close').addEventListener('click', close)
    bm.querySelector('#ibm-cancel').addEventListener('click', close)
    ov.addEventListener('click', e => { if (e.target===ov) close() })
    const typeSelect = bm.querySelector('#ibm-type')
    const bankFields = bm.querySelector('#ibm-bank-fields')
    typeSelect.addEventListener('change', () => { bankFields.style.display = typeSelect.value==='bank' ? 'flex' : 'none' })
    bm.querySelector('#ibm-save').addEventListener('click', async () => {
      const name = bm.querySelector('#ibm-name').value.trim()
      if (!name) { alert('Account name is required'); return }
      const type = typeSelect.value
      const saveBtn = bm.querySelector('#ibm-save'); saveBtn.textContent = 'Saving...'; saveBtn.disabled = true
      const { data: na, error } = await supabase.from('cash_accounts').insert({
        store_id: currentStore?.id, account_name: name, account_type: type,
        balance: Number(bm.querySelector('#ibm-balance').value)||0,
        bank_name: type==='bank' ? (bm.querySelector('#ibm-bank-name').value.trim()||null) : null,
        account_number: type==='bank' ? (bm.querySelector('#ibm-acc-num').value.trim()||null) : null,
      }).select().single()
      if (error) { alert('Failed: '+error.message); saveBtn.textContent='Save Account'; saveBtn.disabled=false; return }
      cashAccounts.push(na)
      invPayMethod = na.account_type==='bank' ? 'bank_transfer' : 'cash'
      invAccountId = na.id
      close(); injectInvPaymentUI()
    })
  }

  async function saveItem() {
    const name = container.querySelector('#f-name').value.trim()
    if (!name) { alert('Item name is required'); return }

    const isCredit = invPayMethod === 'credit'
    const paidAccountId = (!isCredit && invAccountId) ? invAccountId : null
    const paidAccountName = paidAccountId
      ? cashAccounts.find(acc => acc.id === paidAccountId)?.account_name || null
      : null
    const supplierName = container.querySelector('#f-supplier').value.trim()
    const quantity = Number(container.querySelector('#f-qty').value) || 0
    const unitCost = Number(container.querySelector('#f-cost').value) || 0

    if (isCredit && !supplierName) {
      alert('Supplier name is required for credit purchases'); return
    }

    const payload = {
      store_id:            currentStore?.id,
      item_name:           name,
      sku:                 container.querySelector('#f-sku').value.trim()      || null,
      category:            container.querySelector('#f-category').value.trim() || null,
      quantity:            quantity,
      unit_cost:           unitCost || null,
      selling_price:       Number(container.querySelector('#f-price').value)   || null,
      low_stock_threshold: Number(container.querySelector('#f-threshold').value) || 5,
      supplier:            supplierName || null,
      paid_from_account_id:   paidAccountId,
      paid_from_account_name: paidAccountName,
    }

    if (editingId) {
      const originalItem = allItems.find(i => i.id === editingId)
      const { data: updatedItem, error } = await supabase.from('inventory_items').update(payload).eq('id', editingId).select().single()
      if (error) { alert('Error updating item'); console.error(error); return }
      if (updatedItem) await audit.itemUpdated(originalItem, updatedItem)
    } else {
      const { data: newItem, error } = await supabase.from('inventory_items').insert(payload).select().single()
      if (error) { alert('Error adding item'); console.error(error); return }
      if (newItem) {
        await audit.itemCreated(newItem)
        if (supplierName && quantity > 0 && unitCost > 0) {
          let vendorDebtId = null
          if (isCredit) {
            const amountOwed = quantity * unitCost
            const { data: debt } = await supabase.from('vendor_debts').insert({
              store_id: currentStore?.id,
              vendor_name: supplierName,
              amount_owed: amountOwed,
              amount_paid: 0,
              status: 'unpaid',
              notes: name,
            }).select('id').single()
            vendorDebtId = debt?.id || null
          }
          await trackVendorPurchase(newItem.id, supplierName, name, quantity, unitCost, paidAccountId, vendorDebtId)
        }

        // Handle transport fee
        const transportFee  = Number(container.querySelector('#f-transport').value) || 0
        const targa         = container.querySelector('#f-targa').value.trim().toUpperCase() || null
        const deliveryPlace = container.querySelector('#f-place').value.trim() || null
        if (transportFee > 0) {
          await supabase.from('transport_fees').insert({
            store_id:        currentStore?.id,
            entity_type:     'inventory',
            entity_id:       newItem.id,
            amount:          transportFee,
            paid_now:        invTransportPaidNow,
            charge_customer: false,
            payable_settled: invTransportPaidNow,
            worker_name:     targa,
          })
          if (!invTransportPaidNow) {
            await supabase.from('vendor_debts').insert({
              store_id:    currentStore?.id,
              vendor_name: 'Driver' + (targa ? ` (${targa})` : ''),
              amount_owed: transportFee,
              amount_paid: 0,
              status:      'unpaid',
              notes:       `Transport for ${name}${deliveryPlace ? ' → ' + deliveryPlace : ''}`,
            })
          }
        }
      }
    }

    invalidateAfterInventory()
    closeModal()
    await loadItems()
  }

  container.querySelector('#btn-add').addEventListener('click', openAddModal)
  container.querySelector('#modal-close').addEventListener('click', closeModal)
  container.querySelector('#modal-cancel').addEventListener('click', closeModal)
  container.querySelector('#modal-save').addEventListener('click', saveItem)

  // ── Stock Movement Modal ───────────────────────────────────
  function openStockModal(id, name) {
    stockItemId = id
    container.querySelector('#stock-modal-title').textContent = `Update Stock — ${name}`
    container.querySelector('#s-qty').value   = ''
    container.querySelector('#s-notes').value = ''
    container.querySelector('#stock-modal').style.display = 'flex'
  }

  function closeStockModal() {
    container.querySelector('#stock-modal').style.display = 'none'
  }

  async function saveStockMovement() {
    const qty   = Number(container.querySelector('#s-qty').value)
    const type  = container.querySelector('#s-type').value
    const notes = container.querySelector('#s-notes').value.trim()

    if (!qty || qty <= 0) { alert('Enter a valid quantity'); return }

    const { data: movement, error } = await supabase.from('stock_movements').insert({
      store_id:      currentStore?.id,
      item_id:       stockItemId,
      movement_type: type,
      quantity:      qty,
      source:        'manual',
      notes:         notes || null,
    }).select().single()

    if (error) { alert('Error updating stock'); console.error(error); return }

    if (movement) {
      const item = allItems.find(i => i.id === stockItemId)
      await audit.stockMoved(movement, item?.item_name || 'Unknown Item')
    }

    invalidateAfterInventory()
    closeStockModal()
    await loadItems()
  }

  container.querySelector('#stock-modal-close').addEventListener('click', closeStockModal)
  container.querySelector('#stock-cancel').addEventListener('click', closeStockModal)
  container.querySelector('#stock-save').addEventListener('click', saveStockMovement)

  // ── Vendor Purchase Tracking ───────────────────────────────
  async function trackVendorPurchase(itemId, vendorName, productName, quantity, unitCost, accountId, vendorDebtId = null) {
    let vendor = vendors.find(v => v.vendor_name.toLowerCase() === vendorName.toLowerCase())
    if (!vendor) {
      const { data: newVendor, error: vendorError } = await supabase.from('vendors').insert({
        store_id: currentStore?.id, vendor_name: vendorName,
      }).select().single()
      if (vendorError) { console.error('Error creating vendor:', vendorError); return }
      vendor = newVendor; vendors.push(newVendor)
    }
    const { error: purchaseError } = await supabase.from('vendor_purchases').insert({
      store_id: currentStore?.id,
      vendor_id: vendor.id,
      inventory_item_id: itemId,
      purchase_date: new Date().toISOString().split('T')[0],
      product_name: productName,
      quantity: quantity,
      unit_cost: unitCost,
      total_cost: quantity * unitCost,
      paid_from_account_id: accountId,
      vendor_debt_id: vendorDebtId,
    })
    if (purchaseError) console.error('Error recording vendor purchase:', purchaseError)
  }

  // ── Delete ─────────────────────────────────────────────────
  async function deleteItem(id) {
    if (!confirm('Delete this item? This cannot be undone.')) return
    const item = allItems.find(i => i.id === id)
    const { error } = await supabase.from('inventory_items').delete().eq('id', id)
    if (error) { alert('Error deleting item'); return }
    if (item) await audit.itemDeleted(item)
    invalidateAfterInventory()
    await loadItems()
  }

  // ── Init ───────────────────────────────────────────────────
  await loadItems()

  // Check if there's an item ID in the URL query params
  const urlParams = new URLSearchParams(window.location.search)
  const itemId = urlParams.get('item')
  if (itemId && allItems.length > 0) {
    // Auto-open edit modal for the specified item
    setTimeout(() => openEditModal(itemId), 300)
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}