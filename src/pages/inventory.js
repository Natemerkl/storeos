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
          <label class="form-label">Paid from Account</label>
          <select class="form-input" id="f-paid-account">
            <option value="">— Not specified —</option>
          </select>
        </div>
        <div id="new-account-form" style="display:none;background:var(--bg-subtle);padding:0.75rem;border-radius:8px;margin-top:0.5rem">
          <div style="font-weight:600;font-size:0.875rem;margin-bottom:0.5rem;color:var(--accent)">💳 Create New Account</div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label class="form-label">Account Name *</label>
            <input class="form-input" id="new-acc-name" placeholder="e.g. CBE Main Account">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
            <div class="form-group">
              <label class="form-label">Account Number</label>
              <input class="form-input" id="new-acc-number" placeholder="Optional">
            </div>
            <div class="form-group">
              <label class="form-label">Account Type</label>
              <select class="form-input" id="new-acc-type">
                <option value="bank">Bank</option>
                <option value="till">Cash/Till</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0.5rem">
            <label class="form-label">Starting Balance (ETB)</label>
            <input class="form-input" id="new-acc-balance" type="number" min="0" placeholder="0.00" step="0.01">
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
            <input type="checkbox" id="new-acc-calculate" style="width:16px;height:16px;accent-color:var(--accent)">
            <label for="new-acc-calculate" style="font-size:0.875rem;cursor:pointer">Auto-calculate balance from transactions</label>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline btn-sm" id="cancel-new-account" style="flex:1">Cancel</button>
            <button class="btn btn-primary btn-sm" id="save-new-account" style="flex:1">Save Account</button>
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

    // Populate categories
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))]
    const catSelect = container.querySelector('#filter-category')
    if (catSelect) {
      catSelect.innerHTML = `<option value="">All Categories</option>` +
        cats.map(c => `<option value="${c}">${c}</option>`).join('')
    }

    renderTable(allItems)
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
    populateCashAccountsDropdown()
    populateVendorList()
    container.querySelector('#f-paid-account').value = ''
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
    populateCashAccountsDropdown()
    populateVendorList()
    container.querySelector('#f-paid-account').value = item.paid_from_account_id || ''
    container.querySelector('#item-modal').style.display = 'flex'
  }

  function closeModal() {
    container.querySelector('#item-modal').style.display = 'none'
  }

  function populateVendorList() {
    const datalist = container.querySelector('#vendor-list')
    if (datalist) {
      datalist.innerHTML = vendors.map(v => `<option value="${v.vendor_name}">`).join('')
    }
  }

  function populateCashAccountsDropdown() {
    const select = container.querySelector('#f-paid-account')
    console.log('Inventory: Populating dropdown with', cashAccounts.length, 'accounts')
    select.innerHTML = `<option value="">— Not specified —</option>` +
      cashAccounts.map(acc => `<option value="${acc.id}">${acc.account_name}</option>`).join('') +
      `<option value="__new__" style="color:var(--accent);font-weight:600">+ Create New Account</option>`
    
    // Remove old listener by cloning
    const newSelect = select.cloneNode(true)
    select.parentNode.replaceChild(newSelect, select)
    
    newSelect.addEventListener('change', () => {
      const newAccForm = container.querySelector('#new-account-form')
      if (newSelect.value === '__new__') {
        newAccForm.style.display = 'block'
      } else {
        newAccForm.style.display = 'none'
      }
    })
  }

  async function createNewAccount() {
    const name = container.querySelector('#new-acc-name').value.trim()
    if (!name) { alert('Account name is required'); return }

    const accountNumber = container.querySelector('#new-acc-number').value.trim() || null
    const accountType = container.querySelector('#new-acc-type').value
    const balance = Number(container.querySelector('#new-acc-balance').value) || 0
    const autoCalculate = container.querySelector('#new-acc-calculate').checked

    const { data: newAccount, error } = await supabase.from('cash_accounts').insert({
      store_id: currentStore?.id,
      account_name: name,
      account_number: accountNumber,
      account_type: accountType,
      balance: autoCalculate ? 0 : balance,
    }).select().single()

    if (error) { alert('Error creating account'); console.error(error); return }

    cashAccounts.push(newAccount)
    populateCashAccountsDropdown()
    container.querySelector('#f-paid-account').value = newAccount.id
    container.querySelector('#new-account-form').style.display = 'none'
    
    container.querySelector('#new-acc-name').value = ''
    container.querySelector('#new-acc-number').value = ''
    container.querySelector('#new-acc-balance').value = ''
    container.querySelector('#new-acc-calculate').checked = false
  }

  container.querySelector('#save-new-account')?.addEventListener('click', createNewAccount)
  container.querySelector('#cancel-new-account')?.addEventListener('click', () => {
    container.querySelector('#new-account-form').style.display = 'none'
    container.querySelector('#f-paid-account').value = ''
  })

  async function saveItem() {
    const name = container.querySelector('#f-name').value.trim()
    if (!name) { alert('Item name is required'); return }

    const paidAccountId = container.querySelector('#f-paid-account').value || null
    const paidAccountName = paidAccountId 
      ? cashAccounts.find(acc => acc.id === paidAccountId)?.account_name || null
      : null

    const payload = {
      store_id:            currentStore?.id,
      item_name:           name,
      sku:                 container.querySelector('#f-sku').value.trim()      || null,
      category:            container.querySelector('#f-category').value.trim() || null,
      quantity:            Number(container.querySelector('#f-qty').value)     || 0,
      unit_cost:           Number(container.querySelector('#f-cost').value)    || null,
      selling_price:       Number(container.querySelector('#f-price').value)   || null,
      low_stock_threshold: Number(container.querySelector('#f-threshold').value) || 5,
      supplier:            container.querySelector('#f-supplier').value.trim() || null,
      paid_from_account_id:   paidAccountId,
      paid_from_account_name: paidAccountName,
    }

    const supplierName = container.querySelector('#f-supplier').value.trim()
    const quantity = Number(container.querySelector('#f-qty').value) || 0
    const unitCost = Number(container.querySelector('#f-cost').value) || 0

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
        
        // Track vendor purchase if supplier is specified
        if (supplierName && quantity > 0 && unitCost > 0) {
          await trackVendorPurchase(newItem.id, supplierName, name, quantity, unitCost, paidAccountId)
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
  async function trackVendorPurchase(itemId, vendorName, productName, quantity, unitCost, accountId) {
    // Find or create vendor
    let vendor = vendors.find(v => v.vendor_name.toLowerCase() === vendorName.toLowerCase())
    
    if (!vendor) {
      const { data: newVendor, error: vendorError } = await supabase.from('vendors').insert({
        store_id: currentStore?.id,
        vendor_name: vendorName,
      }).select().single()
      
      if (vendorError) {
        console.error('Error creating vendor:', vendorError)
        return
      }
      vendor = newVendor
      vendors.push(newVendor)
    }
    
    // Record purchase
    const totalCost = quantity * unitCost
    const { error: purchaseError } = await supabase.from('vendor_purchases').insert({
      store_id: currentStore?.id,
      vendor_id: vendor.id,
      inventory_item_id: itemId,
      product_name: productName,
      quantity: quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
      paid_from_account_id: accountId,
    })
    
    if (purchaseError) {
      console.error('Error recording vendor purchase:', purchaseError)
    }
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