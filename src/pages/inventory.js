import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { audit } from '../utils/audit.js'
import { getInventory, invalidateAfterInventory } from '../utils/db.js'

// Add autocomplete styles
const autocompleteStyles = `
<style>
.autocomplete-wrapper {
  position: relative;
  width: 100%;
}

.suggestions-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 1000;
  max-height: 220px;
  overflow-y: auto;
}

.suggestions-dropdown.hidden {
  display: none;
}

.suggestion-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #f3f4f6;
}

.suggestion-item:last-child {
  border-bottom: none;
}

.suggestion-item:hover {
  background: #f9fafb;
}

.suggestion-item.create-new {
  color: #0D9488;
  font-weight: 500;
}

.suggestion-name {
  font-weight: 600;
  font-size: 14px;
  color: #111827;
}

.suggestion-sku {
  font-size: 11px;
  color: #9ca3af;
  margin-left: 8px;
}

.suggestion-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.suggestion-meta {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
}

.suggestion-debt {
  font-size: 11px;
  color: #f59e0b;
  margin-left: 8px;
}
</style>
`

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]
  
  // Inject autocomplete styles
  if (!document.querySelector('#autocomplete-styles')) {
    const styleEl = document.createElement('div')
    styleEl.id = 'autocomplete-styles'
    styleEl.innerHTML = autocompleteStyles
    document.head.appendChild(styleEl)
  }

  container.innerHTML = `
    <!-- Header Row -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:16px 0;margin-bottom:16px">
      <div>
        <div style="font-size:22px;font-weight:700;color:var(--dark);margin-bottom:4px">Inventory</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:2px">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
        <div style="font-size:13px;color:var(--muted)" id="header-subtitle">0 units · 0 products</div>
      </div>
      <button class="btn btn-primary" id="btn-add" style="background:var(--accent);border-radius:10px;padding:8px 16px;font-size:14px">+ Add Item</button>
    </div>

    <!-- Stats Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:white;border-radius:12px;padding:14px;border:1px solid #f0f0f0;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:0.05em;margin-bottom:8px">📦 Total Units</div>
        <div style="font-size:20px;font-weight:700;color:#111827" id="stat-total-units">0</div>
        <div style="font-size:12px;color:var(--muted)">units</div>
      </div>
      <div style="background:white;border-radius:12px;padding:14px;border:1px solid #f0f0f0;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:0.05em;margin-bottom:8px">💰 Value</div>
        <div style="font-size:20px;font-weight:700;color:#111827" id="stat-total-value">0</div>
        <div style="font-size:12px;color:var(--muted)">ETB</div>
      </div>
      <div style="background:white;border-radius:12px;padding:14px;border:1px solid #f0f0f0;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:0.05em;margin-bottom:8px">⚠ Low Stock</div>
        <div style="font-size:20px;font-weight:700;color:#111827" id="stat-low-stock">0</div>
        <div style="font-size:12px;color:var(--muted)">items</div>
      </div>
      <div style="background:white;border-radius:12px;padding:14px;border:1px solid #f0f0f0;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:0.05em;margin-bottom:8px">🏷 Potential Revenue</div>
        <div style="font-size:20px;font-weight:700;color:#111827" id="stat-potential-revenue">0</div>
        <div style="font-size:12px;color:var(--muted)">ETB</div>
      </div>
    </div>

    <!-- Tab Bar -->
    <div style="display:flex;gap:0;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:16px">
      <button class="tab-btn" data-tab="today" id="tab-today" style="background:var(--accent);color:white;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:500;border:none">Today <span class="tab-count" id="count-today" style="background:var(--teal-600);color:white;border-radius:12px;padding:2px 6px;font-size:11px;margin-left:4px">(0)</span></button>
      <button class="tab-btn" data-tab="week" id="tab-week" style="background:transparent;color:var(--muted);border-radius:8px;padding:8px 16px;font-size:14px;font-weight:500;border:none">This Week <span class="tab-count" id="count-week" style="background:var(--muted);color:white;border-radius:12px;padding:2px 6px;font-size:11px;margin-left:4px">(0)</span></button>
      <button class="tab-btn" data-tab="all" id="tab-all" style="background:transparent;color:var(--muted);border-radius:8px;padding:8px 16px;font-size:14px;font-weight:500;border:none">All</button>
    </div>

    <!-- Filters -->
    <div style="margin-bottom:16px">
      <input class="form-input" id="search" placeholder="Search items..." style="width:100%;border-radius:10px;border:1px solid #e5e7eb;height:40px;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <select class="form-input" id="filter-category" style="border-radius:10px;border:1px solid #e5e7eb;height:40px">
          <option value="">Category</option>
        </select>
        <select class="form-input" id="filter-stock" style="border-radius:10px;border:1px solid #e5e7eb;height:40px">
          <option value="">Stock Level</option>
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
              <th>Qty / Batches</th>
              <th>Latest Cost</th>
              <th>Selling Price</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="inventory-body">
            <tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
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
          <div class="autocomplete-wrapper">
            <input 
              id="f-name"
              type="text" 
              placeholder="e.g. Coca Cola 500ml"
              autocomplete="off"
              class="form-input"
            />
            <div id="item-suggestions" class="suggestions-dropdown hidden">
            </div>
          </div>
          <input type="hidden" id="item-id-hidden" />
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
            <div class="autocomplete-wrapper">
              <input 
                id="f-supplier"
                type="text" 
                placeholder="Type supplier name..."
                autocomplete="off"
                class="form-input"
              />
              <div id="supplier-suggestions" class="suggestions-dropdown hidden">
              </div>
            </div>
            <input type="hidden" id="supplier-id-hidden" />
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
          <button class="btn btn-primary" id="modal-save">Create Item</button>
        </div>
      </div>
    </div>

    <!-- Add Stock Batch Modal -->
    <div id="batch-modal" class="modal-overlay" style="display:none">
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <div class="modal-title" id="batch-modal-title">Add Stock</div>
          <button class="modal-close" id="batch-modal-close">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Quantity *</label>
            <input class="form-input" id="b-qty" type="number" min="1" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Unit Cost (ETB) *</label>
            <input class="form-input" id="b-cost" type="number" min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Purchase Date *</label>
          <input class="form-input" id="b-date" type="date">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Supplier / Vendor</label>
            <select class="form-input" id="b-vendor"><option value="">No supplier</option></select>
          </div>
          <div class="form-group">
            <label class="form-label">Paid From Account</label>
            <select class="form-input" id="b-account"><option value="">Select account</option></select>
          </div>
        </div>
        <div style="background:var(--bg-subtle);border-radius:10px;padding:0.75rem;margin-bottom:0.75rem">
          <div style="font-size:0.8125rem;font-weight:700;color:var(--muted);margin-bottom:0.625rem;text-transform:uppercase;letter-spacing:0.4px">🚚 Transport / Delivery (optional)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.625rem">
            <div class="form-group" style="margin:0">
              <label class="form-label">Transport Fee (ETB)</label>
              <input type="number" class="form-input" id="b-transport" min="0" placeholder="0.00">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Plate / Targa</label>
              <input class="form-input" id="b-targa" placeholder="e.g. AA-12345" style="text-transform:uppercase">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Delivery Place</label>
              <input class="form-input" id="b-place" placeholder="e.g. Merkato">
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="b-notes" placeholder="Optional notes about this batch">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="batch-cancel">Cancel</button>
          <button class="btn btn-primary" id="batch-save">Add Batch →</button>
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
          <div style="padding:0.5rem 0.75rem;background:var(--teal-50);border:1px solid var(--border);border-radius:8px;font-size:0.8125rem;color:var(--accent);font-weight:600;margin-bottom:0.5rem">
            ➕ To add new stock, use the <strong>[+ Add Stock]</strong> button on the item card
          </div>
          <select class="form-input" id="s-type">
            <option value="out">Stock Out</option>
            <option value="adjustment">Adjustment (deduct qty)</option>
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
          <button class="btn btn-primary" id="stock-save">Save Adjustment</button>
        </div>
      </div>
    </div>
  `

  let allItems = []
  let editingId = null
  let stockItemId = null
  let batchesByItem = {}
  let batchItemId = null
  let batchItemName = ''
  let cashAccounts = []
  let vendors = []
  let invPayMethod = 'cash'
  let invAccountId = ''
  let invTransportPaidNow = true
  let currentTab = localStorage.getItem('inventory_tab') || 'all'
  let tabCounts = { today: 0, week: 0, all: 0 }

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

    // Load batches for batch display
    if (allItems.length > 0) {
      const itemIds = allItems.map(i => i.id)
      const { data: batchData } = await supabase
        .from('inventory_batches')
        .select('id,item_id,batch_number,purchase_date,quantity_received,quantity_remaining,unit_cost,supplier_name,cash_account_name,is_depleted,notes')
        .in('item_id', itemIds)
        .order('purchase_date', { ascending: true })
      const batches = batchData || []
      batchesByItem = {}
      batches.forEach(b => {
        if (!batchesByItem[b.item_id]) batchesByItem[b.item_id] = []
        batchesByItem[b.item_id].push(b)
      })
    }

    // Populate categories
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))]
    const catSelect = container.querySelector('#filter-category')
    if (catSelect) {
      catSelect.innerHTML = `<option value="">All Categories</option>` +
        cats.map(c => `<option value="${c}">${c}</option>`).join('')
    }

    updateSummary()
    await renderTable(allItems)
  }

  function formatCompact(n) {
    if (n >= 1000000) {
      return (n / 1000000).toFixed(1) + 'M'
    } else if (n >= 1000) {
      return (n / 1000).toFixed(1) + 'K'
    }
    return n.toString()
  }

  function formatCurrency(n) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n)
  }

  async function loadCashAccounts() {
    const { currentStore } = appStore.getState()
    const { data: accounts } = await supabase
      .from('cash_accounts')
      .select('id, account_name, account_type, balance')
      .eq('store_id', currentStore?.id)
      .order('account_name', { ascending: true })
    
    const paymentSection = container.querySelector('#inv-payment-section')
    if (!paymentSection) return
    
    paymentSection.innerHTML = `
      <select class="form-input" id="payment-account-select" style="width:100%">
        <option value="">Select account...</option>
        ${accounts?.map(acc => `
          <option value="${acc.id}" data-type="${acc.account_type}">
            ${acc.account_name} 
            (${acc.account_type}) — 
            ${formatCurrency(acc.balance || 0)} ETB
          </option>
        `).join('') || ''}
        <option value="__create_new__">
          ➕ Create new account...
        </option>
      </select>
      <div id="new-account-form" style="display:none;margin-top:0.75rem;padding:0.75rem;background:var(--bg-subtle);border-radius:8px">
        <div style="font-weight:600;margin-bottom:0.5rem">New Account</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
          <input class="form-input" id="new-account-name" placeholder="Account name">
          <select class="form-input" id="new-account-type">
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="mobile">Mobile</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
          <input class="form-input" id="new-account-balance" type="number" min="0" placeholder="Opening balance">
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline btn-sm" id="cancel-new-account">Cancel</button>
            <button class="btn btn-primary btn-sm" id="create-new-account">Create & Select →</button>
          </div>
        </div>
      </div>
    `
    
    // Handle new account creation
    const accountSelect = paymentSection.querySelector('#payment-account-select')
    const newAccountForm = paymentSection.querySelector('#new-account-form')
    
    accountSelect?.addEventListener('change', (e) => {
      if (e.target.value === '__create_new__') {
        newAccountForm.style.display = 'block'
      } else {
        newAccountForm.style.display = 'none'
      }
    })
    
    paymentSection.querySelector('#cancel-new-account')?.addEventListener('click', () => {
      newAccountForm.style.display = 'none'
      accountSelect.value = ''
    })
    
    paymentSection.querySelector('#create-new-account')?.addEventListener('click', async () => {
      const name = paymentSection.querySelector('#new-account-name').value.trim()
      const type = paymentSection.querySelector('#new-account-type').value
      const balance = Number(paymentSection.querySelector('#new-account-balance').value) || 0
      
      if (!name) {
        alert('Account name is required')
        return
      }
      
      try {
        const { data: newAccount } = await supabase
          .from('cash_accounts')
          .insert({
            store_id: currentStore?.id,
            account_name: name,
            account_type: type,
            balance: balance
          })
          .select()
          .single()
        
        // Reload accounts dropdown
        await loadCashAccounts()
        
        // Auto-select the new account
        accountSelect.value = newAccount.id
        
      } catch (err) {
        alert('Error creating account: ' + err.message)
      }
    })
  }

  function updateSummary() {
    const totalValue = allItems.reduce((sum, item) => {
      const qty  = Number(item.total_quantity) || 0
      const cost = Number(item.oldest_batch_cost || item.unit_cost) || 0
      return sum + (qty * cost)
    }, 0)
    const potentialRevenue = allItems.reduce((sum, item) => {
      const qty   = Number(item.total_quantity) || 0
      const price = Number(item.selling_price) || 0
      return sum + (qty * price)
    }, 0)
    const totalItems = allItems.length
    const totalUnits = allItems.reduce((sum, item) => sum + (Number(item.total_quantity) || 0), 0)
    let lowStockCount = 0
    let outOfStockCount = 0
    allItems.forEach(item => {
      const qty       = Number(item.total_quantity) || 0
      const threshold = Number(item.low_stock_threshold) || 5
      if (qty === 0) outOfStockCount++
      else if (qty <= threshold) lowStockCount++
    })

    // Update header subtitle
    const subtitleEl = container.querySelector('#header-subtitle')
    if (subtitleEl) subtitleEl.textContent = `${totalUnits.toLocaleString()} units · ${totalItems} products`

    // Update stats with compact formatting
    const totalUnitsEl = container.querySelector('#stat-total-units')
    if (totalUnitsEl) totalUnitsEl.textContent = totalUnits.toLocaleString()
    
    const totalValueEl = container.querySelector('#stat-total-value')
    if (totalValueEl) totalValueEl.textContent = formatCompact(totalValue)
    
    const lowStockEl = container.querySelector('#stat-low-stock')
    if (lowStockEl) {
      lowStockEl.textContent = lowStockCount
      lowStockEl.style.color = lowStockCount > 0 ? '#F59E0B' : '#111827'
    }
    
    const potentialRevenueEl = container.querySelector('#stat-potential-revenue')
    if (potentialRevenueEl) potentialRevenueEl.textContent = formatCompact(potentialRevenue)
  }

  async function renderTable(items) {
    // Get tbody reference for All tab (may not exist for Today/Week tabs)
    const tbody = container.querySelector('#inventory-body')
    
    // For Today/Week tabs, render cards (table might not exist)
    if (currentTab === 'today' || currentTab === 'week') {
      if (items.length === 0) {
        renderTabEmptyState()
        return
      }
      // Continue with card rendering below
    } else {
      // For All tab, ensure table exists
      if (!tbody) {
        console.error('Table tbody not found for All tab')
        return
      }
      
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No items yet. Add your first item.</div></div></td></tr>`
        return
      }
    }

    // Special card display for Today/This Week tabs
    if (currentTab === 'today' || currentTab === 'week') {
      // Load batch details to check for OCR source
      const itemIds = items.map(i => i.id)
      const { data: batchDetails } = await supabase
        .from('inventory_batches')
        .select('id,item_id,notes,created_at')
        .in('item_id', itemIds)
      
      const batchNotes = {}
      batchDetails?.forEach(b => {
        batchNotes[b.item_id] = b.notes
      })
      
      const cards = items.map(item => {
        const isNewToday = currentTab === 'today'
        const badgeColor = isNewToday ? 'var(--success)' : 'var(--info)'
        const badgeText = isNewToday ? '🟢 NEW' : '🔵 THIS WEEK'
        const batchDate = new Date(item.last_batch_added).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        const isOCR = batchNotes[item.id]?.includes('OCR scan')
        const sourceBadge = isOCR ? '📷 OCR' : '📝 Manual'
        
        const itemName = item.item_name || item.name || 'NO NAME'
        
        return `
          <div data-item-id="${item.id}" style="border:1px solid var(--border);border-radius:12px;background:var(--bg-elevated);padding:1.25rem;min-height:180px;display:flex;flex-direction:column;margin-bottom:1rem;transition:background 0.4s ease">
            <!-- Item Name Header -->
            <div style="font-size:16px;font-weight:600;color:var(--dark);margin-bottom:0.75rem;line-height:1.3">${itemName}</div>
            
            <!-- Badges and Stock Info -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
                <span style="font-weight:700;color:${badgeColor};font-size:0.875rem">${badgeText}</span>
                <span style="font-weight:600;color:var(--accent);font-size:0.75rem;background:var(--teal-50);padding:0.25rem 0.5rem;border-radius:4px">${sourceBadge}</span>
              </div>
              <div style="font-size:0.875rem;color:var(--muted);text-align:right">Total stock: ${item.total_quantity || 0} units</div>
            </div>
            
            <!-- Batch Details -->
            <div style="background:var(--bg-subtle);border-radius:8px;padding:1rem;margin-bottom:1rem;flex:1">
              <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.75rem">✨ Just added — Batch #${item.last_batch_number}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;font-size:0.875rem">
                <div><strong>+${item.last_batch_qty} units</strong> @ ${fmt(item.last_batch_cost)} ETB</div>
                <div style="color:var(--muted)">${batchDate}</div>
              </div>
              ${isOCR ? `<div style="margin-top:0.75rem;font-size:0.75rem;color:var(--accent);font-style:italic">📷 Added via OCR scan</div>` : ''}
            </div>
            
            <!-- Action Buttons -->
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:auto">
              <button class="btn btn-outline btn-sm" data-action="toggle-batches" data-id="${item.id}" style="font-size:0.7rem">▾ All batches</button>
              <button class="btn btn-primary btn-sm" data-action="addstock" data-id="${item.id}" data-name="${item.item_name}" style="font-size:0.7rem">+ Add Stock</button>
              <button class="btn btn-outline btn-sm" data-action="stock" data-id="${item.id}" data-name="${item.item_name}" style="font-size:0.7rem">± Adjust</button>
            </div>
            <!-- Inline batch accordion -->
            <div class="batch-list-container" data-batch-list-for="${item.id}" style="max-height:0;overflow:hidden;transition:max-height 0.35s ease"></div>
          </div>
        `
      }).join('')
      
      // Replace the entire table with cards container
      const tableContainer = tbody?.closest('.table-wrap')
      if (tableContainer) {
        tableContainer.innerHTML = `<div style="display:block">${cards}</div>`
      } else {
        // Find any container to render cards in
        const cardContainer = container.querySelector('.table-wrap') || container.querySelector('.card')
        if (cardContainer) {
          cardContainer.innerHTML = `<div style="display:block">${cards}</div>`
        }
      }
      
      // Add event listeners for card buttons
      container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault()
          e.stopPropagation()
          const { action, id, name } = btn.dataset
          if (action === 'addstock') openBatchModal(id, name)
          if (action === 'stock') openStockModal(id, name)
          if (action === 'toggle-batches') {
            const batchList = container.querySelector(`[data-batch-list-for="${id}"]`)
            if (!batchList) return
            const isExpanded = batchList.style.maxHeight !== '0px' && batchList.style.maxHeight !== ''
            if (isExpanded) {
              batchList.style.maxHeight = '0'
              btn.textContent = '▾ All batches'
            } else {
              btn.textContent = '▴ Hide batches'
              batchList.style.maxHeight = '500px'
              batchList.style.borderTop = '1px solid var(--border)'
              batchList.style.marginTop = '0.5rem'
              batchList.style.paddingTop = '0.5rem'
              batchList.innerHTML = '<div style="padding:0.5rem;color:var(--muted);font-size:0.8rem">Loading...</div>'
              const { data: batches } = await supabase
                .from('inventory_batches')
                .select('*')
                .eq('item_id', id)
                .order('purchase_date', { ascending: true })
              if (!batches?.length) {
                batchList.innerHTML = '<div style="padding:0.5rem;color:var(--muted);font-size:0.8rem">No batches found</div>'
                return
              }
              batchList.innerHTML = batches.map((b, idx) => {
                const isDepleted = b.is_depleted || b.quantity_remaining === 0
                const isFIFO = idx === 0 && !isDepleted
                return `
                  <div style="padding:0.625rem 0.75rem;border-bottom:1px solid #f3f4f6;font-size:0.8125rem;opacity:${isDepleted ? 0.5 : 1}">
                    <div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:3px">
                      <span>Batch #${b.batch_number}
                        ${isFIFO ? '<span style="background:#d1fae5;color:#065f46;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:500">sells first</span>' : ''}
                        ${isDepleted ? '<span style="color:#9ca3af;font-size:10px;margin-left:6px">depleted</span>' : ''}
                      </span>
                      <span style="color:var(--muted);font-weight:400">${b.purchase_date}</span>
                    </div>
                    <div style="display:flex;gap:12px;color:var(--muted)">
                      <span>${b.quantity_remaining} / ${b.quantity_received} units</span>
                      <span>${fmt(b.unit_cost)} ETB/unit</span>
                      ${b.supplier_name ? `<span>· ${b.supplier_name}</span>` : ''}
                    </div>
                  </div>
                `
              }).join('')
            }
          }
        })
      })
      
      return
    }

    // Normal table view for All tab
    if (!tbody) {
      console.error('Table tbody not found for All tab rendering')
      return
    }
    
    const rows = []
    items.forEach(item => {
      const qty        = Number(item.total_quantity) || 0
      const threshold  = Number(item.low_stock_threshold || 5)
      const status     = qty === 0 ? 'out' : qty <= threshold ? 'low' : 'ok'
      const badge      = status === 'out' ? 'badge-red' : status === 'low' ? 'badge-yellow' : 'badge-green'
      const label      = status === 'out' ? 'Out of Stock' : status === 'low' ? 'Low Stock' : 'In Stock'
      const batchCount = Number(item.batch_count) || 0
      const batches    = batchesByItem[item.id] || []
      const costDisplay = item.latest_unit_cost
        ? fmt(item.latest_unit_cost) + ' ETB'
        : (item.unit_cost ? fmt(item.unit_cost) + ' ETB' : '—')

      rows.push(`
        <tr data-item-row="${item.id}">
          <td><strong>${item.item_name}</strong></td>
          <td style="color:var(--muted)">${item.sku || '—'}</td>
          <td>${item.category || '—'}</td>
          <td>
            <strong>${qty}</strong>
            ${batchCount > 1
              ? `<button data-expand-batches="${item.id}" style="margin-left:0.5rem;padding:0.1rem 0.5rem;font-size:0.7rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-subtle);color:var(--muted);cursor:pointer">▾ ${batchCount} batches</button>`
              : `<span style="font-size:0.7rem;color:var(--muted);margin-left:0.25rem">(${batchCount} batch)</span>`}
          </td>
          <td>${costDisplay}</td>
          <td>${item.selling_price ? fmt(item.selling_price) + ' ETB' : '—'}</td>
          <td><span class="badge ${badge}">${label}</span></td>
          <td>
            <div style="display:flex;gap:0.3rem;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" data-action="addstock" data-id="${item.id}" data-name="${item.item_name}" style="font-size:0.7rem;padding:0.25rem 0.5rem">+ Add Stock</button>
              <button class="btn btn-outline btn-sm" data-action="stock" data-id="${item.id}" data-name="${item.item_name}" style="font-size:0.7rem;padding:0.25rem 0.5rem">± Adjust</button>
              <button class="btn btn-outline btn-sm" data-action="edit" data-id="${item.id}" style="font-size:0.7rem;padding:0.25rem 0.5rem">Edit</button>
              <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border);font-size:0.7rem;padding:0.25rem 0.5rem" data-action="delete" data-id="${item.id}">Delete</button>
            </div>
          </td>
        </tr>
      `)

      if (batches.length > 0) {
        rows.push(`
          <tr id="batch-rows-${item.id}" style="display:none">
            <td colspan="9" style="padding:0">
              <div style="background:var(--bg-subtle);border-top:1px solid var(--border);padding:0.75rem 1rem">
                <div style="font-size:0.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.5rem">Batch Details — FIFO Order (oldest sells first)</div>
                ${batches.map((b, idx) => {
                  const isOldest   = idx === 0 && !b.is_depleted && b.quantity_remaining > 0
                  const isDepleted = b.is_depleted || b.quantity_remaining === 0
                  return `
                    <div style="display:flex;align-items:center;gap:1rem;padding:0.5rem 0.75rem;border-radius:8px;margin-bottom:0.25rem;
                      background:${isDepleted ? 'transparent' : 'var(--bg-elevated)'};
                      border:1px solid var(--border);opacity:${isDepleted ? 0.5 : 1}">
                      <div style="min-width:80px">
                        <div style="font-size:0.8125rem;font-weight:700">Batch #${b.batch_number}</div>
                        <div style="font-size:0.7rem;color:var(--muted)">${b.purchase_date}</div>
                      </div>
                      <div style="flex:1;font-size:0.8125rem">
                        <span style="font-weight:600">${b.quantity_remaining}</span>
                        <span style="color:var(--muted)"> / ${b.quantity_received} units</span>
                        <span style="color:var(--muted)"> · Cost: ${fmt(b.unit_cost)} ETB</span>
                        ${b.supplier_name ? `<span style="color:var(--muted)"> · ${b.supplier_name}</span>` : ''}
                      </div>
                      ${isOldest ? `<span style="font-size:0.7rem;font-weight:700;padding:0.15rem 0.5rem;background:var(--teal-50);color:var(--accent);border-radius:4px;white-space:nowrap">Sells First 🟢</span>` : ''}
                      ${isDepleted ? `<span style="font-size:0.7rem;padding:0.15rem 0.5rem;background:var(--bg-subtle);color:var(--muted);border-radius:4px">Depleted</span>` : ''}
                    </div>
                  `
                }).join('')}
              </div>
            </td>
          </tr>
        `)
      }
    })

    tbody.innerHTML = rows.join('')

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id, name } = btn.dataset
        if (action === 'edit')     openEditModal(id)
        if (action === 'stock')    openStockModal(id, name)
        if (action === 'addstock') openBatchModal(id, name)
        if (action === 'delete')   deleteItem(id)
      })
    })

    tbody.querySelectorAll('[data-expand-batches]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId   = btn.dataset.expandBatches
        const batchRow = container.querySelector(`#batch-rows-${itemId}`)
        if (!batchRow) return
        const isHidden = batchRow.style.display === 'none'
        batchRow.style.display = isHidden ? '' : 'none'
        const count = Number(allItems.find(i => i.id === itemId)?.batch_count) || 0
        btn.textContent = isHidden ? `▴ ${count} batches` : `▾ ${count} batches`
      })
    })
  }

  // ── Search & Filter ────────────────────────────────────────
  async function applyFilters() {
    const search   = container.querySelector('#search').value.toLowerCase()
    const category = container.querySelector('#filter-category').value
    const stock    = container.querySelector('#filter-stock').value

    let filtered = allItems.filter(i => {
      const matchSearch = i.item_name.toLowerCase().includes(search) ||
                          (i.sku || '').toLowerCase().includes(search)
      const matchCat    = !category || i.category === category
      const qty         = Number(i.total_quantity) || 0
      const threshold   = Number(i.low_stock_threshold || 5)
      const matchStock  = !stock ||
        (stock === 'out' && qty === 0) ||
        (stock === 'low' && qty > 0 && qty <= threshold) ||
        (stock === 'ok'  && qty > threshold)
      return matchSearch && matchCat && matchStock
    })
    await renderTable(filtered)
  }

  // ── Modal Functions ─────────────────────────────────────────
  function closeAddModal() {
    const modal = container.querySelector('#item-modal')
    if (modal) modal.style.display = 'none'
    // Clear autocomplete suggestions
    hideSuggestions('supplier')
    hideSuggestions('item')
  }

  function openAddModal() {
    // Check if modal exists first
    const modal = container.querySelector('#item-modal')
    if (!modal) {
      console.error('Modal not found in DOM')
      return
    }
    
    editingId = null
    
    const modalTitle = container.querySelector('#modal-title')
    if (modalTitle) modalTitle.textContent = 'Add Item'
    
    // Clear all form fields
    const fName = container.querySelector('#f-name')
    const fSku = container.querySelector('#f-sku')
    const fCategory = container.querySelector('#f-category')
    const fQty = container.querySelector('#f-qty')
    const fCost = container.querySelector('#f-cost')
    const fPrice = container.querySelector('#f-price')
    const fThreshold = container.querySelector('#f-threshold')
    const fSupplier = container.querySelector('#f-supplier')
    
    if (fName) fName.value = ''
    if (fSku) fSku.value = ''
    if (fCategory) fCategory.value = ''
    if (fQty) fQty.value = ''
    if (fCost) fCost.value = ''
    if (fPrice) fPrice.value = ''
    if (fThreshold) fThreshold.value = ''
    if (fSupplier) fSupplier.value = ''
    
    // Clear hidden id fields
    const itemIdHidden = container.querySelector('#item-id-hidden')
    const supplierIdHidden = container.querySelector('#supplier-id-hidden')
    if (itemIdHidden) itemIdHidden.value = ''
    if (supplierIdHidden) supplierIdHidden.value = ''
    
    // Load fresh cash accounts
    loadCashAccounts()
    
    modal.style.display = 'flex'
    if (fName) fName.focus()
  }

  function openEditModal(id) {
    const item = allItems.find(i => i.id === id)
    if (!item) return
    editingId = id
    container.querySelector('#modal-title').textContent = 'Edit Item'
    container.querySelector('#f-name').value = item.item_name || ''
    container.querySelector('#f-sku').value = item.sku || ''
    container.querySelector('#f-category').value = item.category || ''
    container.querySelector('#f-qty').value = item.quantity || ''
    container.querySelector('#f-cost').value = item.unit_cost || ''
    container.querySelector('#f-price').value = item.selling_price || ''
    container.querySelector('#f-threshold').value = item.low_stock_threshold || ''
    container.querySelector('#f-supplier').value = item.supplier || ''
    container.querySelector('#f-transport').value = item.transport_fee || ''
    container.querySelector('#f-targa').value = item.targa || ''
    container.querySelector('#f-place').value = item.delivery_place || ''
    container.querySelector('#modal-save').textContent = 'Update Item'
    container.querySelector('#item-modal').style.display = 'flex'
    setupPaymentSection()
  }

  function closeModal() {
    container.querySelector('#item-modal').style.display = 'none'
  }

  async function saveItem() {
    const name      = container.querySelector('#f-name')?.value.trim()
    const sku       = container.querySelector('#f-sku')?.value.trim()
    const category  = container.querySelector('#f-category')?.value.trim()
    const qty       = Number(container.querySelector('#f-qty')?.value) || 0
    const cost      = Number(container.querySelector('#f-cost')?.value) || 0
    const price     = Number(container.querySelector('#f-price')?.value) || 0
    const threshold = Number(container.querySelector('#f-threshold')?.value) || 5
    const supplier  = container.querySelector('#f-supplier')?.value.trim()
    const transport = Number(container.querySelector('#f-transport')?.value) || 0
    const targa     = container.querySelector('#f-targa')?.value.trim().toUpperCase() || null
    const place     = container.querySelector('#f-place')?.value.trim() || null

    const existingItemId     = container.querySelector('#item-id-hidden')?.value || null
    const existingSupplierId = container.querySelector('#supplier-id-hidden')?.value || null
    // If a vendor was picked from the dropdown, use its exact vendor_name to avoid case mismatches
    const supplierNormalized = existingSupplierId
      ? (vendors.find(v => v.id === existingSupplierId)?.vendor_name || supplier)
      : supplier

    if (!name) { alert('Item name is required'); return }

    const saveBtn = container.querySelector('#modal-save')
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true }

    try {
      let itemId = existingItemId

      if (editingId) {
        // Update existing item metadata only
        const { error } = await supabase.from('inventory_items').update({
          item_name: name, sku, category, selling_price: price,
          low_stock_threshold: threshold, transport_fee: transport, targa, delivery_place: place,
        }).eq('id', editingId)
        if (error) throw error
        itemId = editingId
      } else if (!existingItemId) {
        // Check if an item with this name already exists to prevent duplicates
        const { data: existing } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('store_id', currentStore?.id)
          .ilike('item_name', name)
          .limit(1)
          .maybeSingle()

        if (existing?.id) {
          // Item already exists — use it, don't create a duplicate
          itemId = existing.id
        } else {
          // Truly new item — insert
          const { data: newItem, error } = await supabase
            .from('inventory_items')
            .insert({
              store_id: currentStore?.id,
              item_name: name, sku, category,
              selling_price: price, low_stock_threshold: threshold,
              supplier: supplierNormalized, transport_fee: transport, targa, delivery_place: place,
            })
            .select()
            .single()
          if (error) throw error
          itemId = newItem.id
          await audit.itemCreated(newItem)
        }
      }
      // else: existingItemId — just adding stock to existing item, no insert needed

      // Add initial batch if qty > 0
      if (qty > 0 && itemId) {
        // Create vendor if name typed but no ID selected
        let supplierId = existingSupplierId || null
        if (!supplierId && supplierNormalized) {
          const { data: newVendor } = await supabase
            .from('vendors')
            .insert({ store_id: currentStore?.id, vendor_name: supplierNormalized })
            .select('id').single()
          supplierId = newVendor?.id || null
        }

        const accountSelect  = container.querySelector('#payment-account-select')
        const accountId      = (accountSelect?.value && accountSelect.value !== '__create_new__') ? accountSelect.value : null
        const selectedOption = accountSelect?.options[accountSelect?.selectedIndex]
        const accountName    = accountId ? (selectedOption?.text?.split('(')[0]?.trim() || null) : null

        const { error: batchErr } = await supabase.rpc('add_stock_batch', {
          p_store_id:          currentStore?.id,
          p_item_id:           itemId,
          p_quantity:          qty,
          p_unit_cost:         cost,
          p_purchase_date:     new Date().toISOString().split('T')[0],
          p_supplier_id:       supplierId,
          p_supplier_name:     supplierNormalized || null,
          p_cash_account_id:   accountId,
          p_cash_account_name: accountName,
          p_transport_fee:     transport,
          p_targa:             targa,
          p_delivery_place:    place,
          p_notes:             null,
        })
        if (batchErr) throw batchErr

        // Create expense record if paid from a cash account
        if (accountId) {
          const totalCost = qty * cost + transport
          await supabase.from('expenses').insert({
            store_id:        currentStore?.id,
            cash_account_id: accountId,
            expense_date:    new Date().toISOString().split('T')[0],
            amount:          totalCost,
            category:        'Inventory Purchase',
            description:     `Stock: ${name}${supplierNormalized ? ' from ' + supplierNormalized : ''}`,
            source:          'manual',
            transport_fee:   transport || null,
            targa:           targa,
            delivery_place:  place,
            notes:           `Batch added — ${qty} units @ ${cost} ETB/unit`,
          })
        }

        // Create vendor_purchases record if a supplier is linked
        if (supplierId) {
          await supabase.from('vendor_purchases').insert({
            store_id:           currentStore?.id,
            vendor_id:          supplierId,
            inventory_item_id:  itemId,
            purchase_date:      new Date().toISOString().split('T')[0],
            product_name:       name,
            quantity:           qty,
            unit_cost:          cost,
            total_cost:         qty * cost,
            payment_method:     accountId ? 'bank' : null,
            paid_from_account_id: accountId || null,
          })
        }
      }

      invalidateAfterInventory()
      closeAddModal()
      await loadTabCounts()
      await switchTab('today', itemId)
      window.scrollTo({ top: 0, behavior: 'smooth' })

    } catch (err) {
      alert('Error saving item: ' + err.message)
      console.error(err)
    } finally {
      if (saveBtn) { saveBtn.textContent = editingId ? 'Update Item' : 'Create Item'; saveBtn.disabled = false }
    }
  }

  function setupPaymentSection() {
    const section = container.querySelector('#inv-payment-section')
    section.innerHTML = `
      <select class="form-input" id="inv-pay-method">
        <option value="cash">Cash</option>
        <option value="credit">Credit (from supplier)</option>
      </select>
      <div id="inv-cash-fields" style="margin-top:0.5rem">
        <select class="form-input" id="inv-account">
          <option value="">Select account</option>
        </select>
      </div>
    `

    const payMethod = container.querySelector('#inv-pay-method')
    const cashFields = container.querySelector('#inv-cash-fields')
    const creditFields = container.querySelector('#inv-credit-fields')
    const accountSelect = container.querySelector('#inv-account')

    accountSelect.innerHTML = `<option value="">Select account</option>` +
      cashAccounts.map(a => `<option value="${a.id}">${a.account_name}</option>`).join('')

    payMethod.addEventListener('change', () => {
      const isCredit = payMethod.value === 'credit'
      cashFields.style.display = isCredit ? 'none' : ''
      creditFields.style.display = isCredit ? '' : 'none'
    })

    payMethod.value = invPayMethod
    if (accountSelect) {
      accountSelect.value = invAccountId
    }
    payMethod.dispatchEvent(new Event('change'))
  }

  // ── Stock Movement Modal ───────────────────────────────────
  function openStockModal(id, name) {
    stockItemId = id
    container.querySelector('#stock-modal-title').textContent = `Update Stock — ${name}`
    container.querySelector('#s-qty').value = ''
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

    const saveBtn = container.querySelector('#stock-save')
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true }

    try {
      const { data: movement, error } = await supabase.from('stock_movements').insert({
        store_id:      currentStore?.id,
        item_id:       stockItemId,
        movement_type: type,
        quantity:      qty,
        source:        'manual',
        notes:         notes || null,
      }).select().single()

      if (error) throw error

      const { error: deductErr } = await supabase.rpc('deduct_stock_fifo', {
        p_item_id:  stockItemId,
        p_store_id: currentStore?.id,
        p_quantity: qty,
        p_reason:   type,
      })
      if (deductErr) {
        console.error('FIFO deduct error:', deductErr)
        alert(`Movement recorded but batch deduction failed: ${deductErr.message}`)
      }

      if (movement) {
        const item = allItems.find(i => i.id === stockItemId)
        await audit.stockMoved(movement, item?.item_name || 'Unknown Item')
      }

      invalidateAfterInventory()
      closeStockModal()
      await loadItems()
    } catch (err) {
      alert('Error updating stock: ' + err.message)
      console.error(err)
    } finally {
      if (saveBtn) { saveBtn.textContent = 'Save Adjustment'; saveBtn.disabled = false }
    }
  }

  // ── Add Stock Batch Modal ──────────────────────────────────
  function openBatchModal(id, name) {
    batchItemId   = id
    batchItemName = name
    document.getElementById('batch-modal-title').textContent = `Add Stock — ${name}`
    document.getElementById('b-qty').value       = ''
    document.getElementById('b-cost').value      = ''
    document.getElementById('b-date').value      = new Date().toISOString().split('T')[0]
    document.getElementById('b-notes').value     = ''
    document.getElementById('b-transport').value = ''
    document.getElementById('b-targa').value     = ''
    document.getElementById('b-place').value     = ''
    const vSelect = document.getElementById('b-vendor')
    if (vSelect) {
      vSelect.innerHTML = `<option value="">No supplier</option>` +
        vendors.map(v => `<option value="${v.id}" data-name="${v.vendor_name}">${v.vendor_name}</option>`).join('')
    }
    const aSelect = document.getElementById('b-account')
    if (aSelect) {
      aSelect.innerHTML = `<option value="">Select account</option>` +
        cashAccounts.map(a => `<option value="${a.id}" data-name="${a.account_name}">${a.account_name}</option>`).join('')
      const defaultTill = cashAccounts.find(a => a.account_type === 'till')
      if (defaultTill) aSelect.value = defaultTill.id
    }
    document.getElementById('batch-modal').style.display = 'flex'
  }

  function closeBatchModal() {
    document.getElementById('batch-modal').style.display = 'none'
  }

  async function saveBatchStock() {
    const qty  = Number(document.getElementById('b-qty').value)
    const cost = Number(document.getElementById('b-cost').value)
    const date = document.getElementById('b-date').value
    if (!qty || qty <= 0) { alert('Enter a valid quantity'); return }
    if (cost < 0)          { alert('Enter a valid unit cost'); return }
    if (!date)             { alert('Select a purchase date'); return }

    const vSelect     = document.getElementById('b-vendor')
    const vendorId    = vSelect?.value || null
    const vendorName  = vSelect?.options[vSelect.selectedIndex]?.dataset.name || null
    const aSelect     = document.getElementById('b-account')
    const accountId   = aSelect?.value || null
    const accountName = aSelect?.options[aSelect.selectedIndex]?.dataset.name || null
    const transport   = Number(document.getElementById('b-transport').value) || 0
    const targa       = document.getElementById('b-targa').value.trim().toUpperCase() || null
    const place       = document.getElementById('b-place').value.trim() || null
    const notes       = document.getElementById('b-notes').value.trim() || null

    const saveBtn = document.getElementById('batch-save')
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true }

    try {
      const { error } = await supabase.rpc('add_stock_batch', {
        p_store_id:          currentStore?.id,
        p_item_id:           batchItemId,
        p_quantity:          qty,
        p_unit_cost:         cost,
        p_purchase_date:     date,
        p_supplier_id:       vendorId || null,
        p_supplier_name:     vendorName || null,
        p_cash_account_id:   accountId || null,
        p_cash_account_name: accountName || null,
        p_transport_fee:     transport,
        p_targa:             targa,
        p_delivery_place:    place,
        p_notes:             notes,
      })
      if (error) throw error

      await supabase.from('stock_movements').insert({
        store_id:      currentStore?.id,
        item_id:       batchItemId,
        movement_type: 'in',
        quantity:      qty,
        unit_cost:     cost,
        source:        'manual',
        notes:         `Batch added. Cost: ${cost} ETB${notes ? ' | ' + notes : ''}`,
      })

      // Record expense if paid from a cash account
      if (accountId) {
        const totalCost = qty * cost + transport
        await supabase.from('expenses').insert({
          store_id:        currentStore?.id,
          cash_account_id: accountId,
          expense_date:    date,
          amount:          totalCost,
          category:        'Inventory Purchase',
          description:     `Stock: ${batchItemName}${vendorName ? ' from ' + vendorName : ''}`,
          source:          'manual',
          transport_fee:   transport || null,
          targa:           targa,
          delivery_place:  place,
          notes:           `Batch added — ${qty} units @ ${cost} ETB/unit${notes ? ' | ' + notes : ''}`,
        })
      }

      // Create vendor_purchases record if a supplier is linked
      if (vendorId) {
        await supabase.from('vendor_purchases').insert({
          store_id:             currentStore?.id,
          vendor_id:            vendorId,
          inventory_item_id:    batchItemId,
          purchase_date:        date,
          product_name:         batchItemName,
          quantity:             qty,
          unit_cost:            cost,
          total_cost:           qty * cost,
          payment_method:       accountId ? 'bank' : null,
          paid_from_account_id: accountId || null,
        })
      }

      invalidateAfterInventory()
      closeBatchModal()
      await loadTabCounts()
      await loadTabData()
    } catch (err) {
      alert('Error adding batch: ' + err.message)
      console.error(err)
    } finally {
      if (saveBtn) { saveBtn.textContent = 'Add Batch →'; saveBtn.disabled = false }
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
    await loadTabData()
  }

  // ── Tab Functions ────────────────────────────────────────────
  async function loadTabCounts() {
    const { data } = await supabase.rpc('get_inventory_tab_counts', {
      p_store_id: currentStore?.id
    }).single()
    
    tabCounts = {
      today: data?.today_count || 0,
      week: data?.week_count || 0,
      all: data?.all_count || 0
    }
    
    // Update tab counts in the new pill-style tabs
    const todayCount = container.querySelector('#count-today')
    if (todayCount) todayCount.textContent = `(${tabCounts.today})`
    
    const weekCount = container.querySelector('#count-week')
    if (weekCount) weekCount.textContent = `(${tabCounts.week})`
    
    const allCount = container.querySelector('#count-all')
    if (allCount) allCount.textContent = `(${tabCounts.all})`
  }

  async function loadTabData() {
    if (currentTab === 'all') {
      // Restore table structure if it was replaced by cards
      const tableContainer = container.querySelector('.table-wrap')
      if (tableContainer && !tableContainer.querySelector('table')) {
        tableContainer.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Qty / Batches</th>
                <th>Latest Cost</th>
                <th>Selling Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="inventory-body">
              <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
            </tbody>
          </table>
        `
      }
      await loadItems()
      return
    }

    const dateFilter = currentTab === 'today' 
      ? 'ib.created_at::date = CURRENT_DATE'
      : 'ib.created_at >= date_trunc(\'week\', NOW())'

    // Use RPC for complex query with DISTINCT ON and JOIN
    const { data: items } = await supabase.rpc('get_items_with_recent_batches', {
      p_store_id: currentStore?.id,
      p_tab_filter: currentTab
    })
    
    allItems = items || []
    
    // Load batches for these items
    if (allItems.length > 0) {
      const itemIds = allItems.map(i => i.id)
      const { data: batchData } = await supabase
        .from('inventory_batches')
        .select('id,item_id,batch_number,purchase_date,quantity_received,quantity_remaining,unit_cost,supplier_name,cash_account_name,is_depleted,notes')
        .in('item_id', itemIds)
        .order('purchase_date', { ascending: true })
      const batches = batchData || []
      batchesByItem = {}
      batches.forEach(b => {
        if (!batchesByItem[b.item_id]) batchesByItem[b.item_id] = []
        batchesByItem[b.item_id].push(b)
      })
    }

    updateSummary()
    await renderTable(allItems)
  }

  async function switchTab(tab, highlightItemId = null) {
    currentTab = tab
    localStorage.setItem('inventory_tab', tab)
    
    // Update button styles for new pill design
    container.querySelectorAll('.tab-btn').forEach(btn => {
      const countSpan = btn.querySelector('.tab-count')
      if (btn.dataset.tab === tab) {
        btn.style.background = 'var(--accent)'
        btn.style.color = 'white'
        if (countSpan) {
          countSpan.style.background = 'var(--teal-600)'
          countSpan.style.color = 'white'
        }
      } else {
        btn.style.background = 'transparent'
        btn.style.color = 'var(--muted)'
        if (countSpan) {
          countSpan.style.background = 'var(--muted)'
          countSpan.style.color = 'white'
        }
      }
    })
    
    await loadTabData()

    if (highlightItemId) {
      setTimeout(() => {
        const card = container.querySelector(`[data-item-id="${highlightItemId}"]`)
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
          card.style.background = '#d1fae5'
          setTimeout(() => { card.style.background = '' }, 2000)
        }
      }, 350)
    }
  }

  function renderTabEmptyState() {
    const emptyMessage = currentTab === 'today' 
      ? '📦 No stock added today'
      : '📦 No stock added this week'
    const subMessage = currentTab === 'today'
      ? 'Use [+ Add Stock] on any item to record a new batch'
      : ''
    
    const tableWrap = container.querySelector('.table-wrap')
    if (tableWrap) {
      tableWrap.innerHTML = `
        <div style="text-align:center;padding:3rem">
          <div style="font-size:1.5rem;margin-bottom:0.5rem">${emptyMessage}</div>
          ${subMessage ? `<div style="color:var(--muted);font-size:0.875rem">${subMessage}</div>` : ''}
        </div>
      `
    }
  }

  // ── Autocomplete Functionality ──────────────────────────────────
  function hideSuggestions(type) {
    const id = type === 'supplier' ? 'supplier-suggestions' : 'item-suggestions'
    document.getElementById(id)?.classList.add('hidden')
  }

  // Supplier autocomplete
  const supplierInput = container.querySelector('#f-supplier')
  if (supplierInput) {
    supplierInput.addEventListener('input', async (e) => {
      const query = e.target.value.trim()
      if (query.length < 1) {
        hideSuggestions('supplier')
        return
      }
      
      const { currentStore } = appStore.getState()
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, vendor_name, outstanding_balance')
        .eq('store_id', currentStore?.id)
        .ilike('vendor_name', `%${query}%`)
        .limit(5)
      
      const suggestions = container.querySelector('#supplier-suggestions')
      
      if (!vendors?.length) {
        suggestions.innerHTML = `
          <div class="suggestion-item create-new">
            ➕ Add "${query}" as new supplier
          </div>
        `
      } else {
        suggestions.innerHTML = vendors.map(v => `
          <div class="suggestion-item" 
               data-id="${v.id}" 
               data-name="${v.vendor_name}">
            <span class="suggestion-name">${v.vendor_name}</span>
            ${v.outstanding_balance > 0 
              ? `<span class="suggestion-debt">
                  Owes ${formatCurrency(v.outstanding_balance)} ETB
                 </span>` 
              : ''}
          </div>
        `).join('') + `
          <div class="suggestion-item create-new">
            ➕ Add "${query}" as new supplier
          </div>`
      }
      
      suggestions.classList.remove('hidden')
      
      // Handle selection
      suggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          if (item.classList.contains('create-new')) {
            supplierInput.value = query
            container.querySelector('#supplier-id-hidden').value = ''
          } else {
            supplierInput.value = item.dataset.name
            container.querySelector('#supplier-id-hidden').value = item.dataset.id
          }
          hideSuggestions('supplier')
        })
      })
    })
  }

  // Item name autocomplete
  const itemNameInput = container.querySelector('#f-name')
  if (itemNameInput) {
    itemNameInput.addEventListener('input', async (e) => {
      const query = e.target.value.trim()
      if (query.length < 1) {
        hideSuggestions('item')
        return
      }
      
      const { currentStore } = appStore.getState()
      const { data: items } = await supabase
        .from('inventory_items')
        .select(`
          id, item_name, sku, category,
          total_quantity, selling_price, latest_unit_cost
        `)
        .eq('store_id', currentStore?.id)
        .ilike('item_name', `%${query}%`)
        .limit(6)
      
      const suggestions = container.querySelector('#item-suggestions')
      
      if (!items?.length) {
        suggestions.innerHTML = `
          <div class="suggestion-item create-new">
            ➕ Create new item "${query}"
          </div>
        `
      } else {
        suggestions.innerHTML = items.map(item => `
          <div class="suggestion-item"
               data-id="${item.id}"
               data-name="${item.item_name}"
               data-sku="${item.sku || ''}"
               data-category="${item.category || ''}"
               data-selling="${item.selling_price || ''}"
               data-cost="${item.latest_unit_cost || ''}">
            <div class="suggestion-main">
              <span class="suggestion-name">
                ${item.item_name}
              </span>
              ${item.sku 
                ? `<span class="suggestion-sku">
                    ${item.sku}
                   </span>` 
                : ''}
            </div>
            <div class="suggestion-meta">
              ${item.total_quantity} in stock
              ${item.latest_unit_cost 
                ? `· Last cost: ${formatCurrency(item.latest_unit_cost)} ETB` 
                : ''}
            </div>
          </div>
        `).join('') + ` 
          <div class="suggestion-item create-new">
            ➕ Add stock to different item
          </div>
        `
      }
      
      suggestions.classList.remove('hidden')
      
      // On select: autofill the form
      suggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          if (item.classList.contains('create-new')) {
            itemNameInput.value = query
            container.querySelector('#item-id-hidden').value = ''
            hideSuggestions('item')
            return
          }
          
          // Autofill all matching fields
          itemNameInput.value = item.dataset.name
          container.querySelector('#item-id-hidden').value = item.dataset.id
          
          // Fill SKU if exists and field is empty
          const skuField = container.querySelector('#f-sku')
          if (skuField && !skuField.value && item.dataset.sku)
            skuField.value = item.dataset.sku
          
          // Fill category if field is empty
          const catField = container.querySelector('#f-category')
          if (catField && !catField.value && item.dataset.category)
            catField.value = item.dataset.category
          
          // Fill selling price if field is empty
          const priceField = container.querySelector('#f-price')
          if (priceField && !priceField.value && item.dataset.selling)
            priceField.value = item.dataset.selling
          
          hideSuggestions('item')
        })
      })
    })
  }

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      hideSuggestions('supplier')
      hideSuggestions('item')
    }
  })

  // ── Event Listeners ────────────────────────────────────────────
  const addBtn = container.querySelector('#btn-add')
  if (addBtn) addBtn.addEventListener('click', openAddModal)
  
  const modalClose = container.querySelector('#modal-close')
  if (modalClose) modalClose.addEventListener('click', closeAddModal)
  
  const modalCancel = container.querySelector('#modal-cancel')
  if (modalCancel) modalCancel.addEventListener('click', closeAddModal)
  
  const modal = container.querySelector('#item-modal')
  if (modal) modal.addEventListener('click', e => { if (e.target.id === 'item-modal') closeAddModal() })
  
  const modalSave = container.querySelector('#modal-save')
  if (modalSave) modalSave.addEventListener('click', saveItem)
  
  const searchInput = container.querySelector('#search')
  if (searchInput) searchInput.addEventListener('input', applyFilters)
  
  const filterCategory = container.querySelector('#filter-category')
  if (filterCategory) filterCategory.addEventListener('change', applyFilters)
  
  const filterStock = container.querySelector('#filter-stock')
  if (filterStock) filterStock.addEventListener('change', applyFilters)

  // Batch modal event listeners
  const batchModalClose = document.getElementById('batch-modal-close')
  if (batchModalClose) batchModalClose.addEventListener('click', closeBatchModal)
  
  const batchCancel = document.getElementById('batch-cancel')
  if (batchCancel) batchCancel.addEventListener('click', closeBatchModal)
  
  const batchSave = document.getElementById('batch-save')
  if (batchSave) batchSave.addEventListener('click', saveBatchStock)

  // Tab event listeners
  const tabToday = container.querySelector('#tab-today')
  if (tabToday) tabToday.addEventListener('click', () => switchTab('today'))
  
  const tabWeek = container.querySelector('#tab-week')
  if (tabWeek) tabWeek.addEventListener('click', () => switchTab('week'))
  
  const tabAll = container.querySelector('#tab-all')
  if (tabAll) tabAll.addEventListener('click', () => switchTab('all'))

  // ── Init ───────────────────────────────────────────────────
  await loadTabCounts()
  switchTab(currentTab)

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
