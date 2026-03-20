import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { fuzzyMatch } from '../utils/fuzzy.js'
import { postSaleEntry } from '../utils/accounting.js'
import { renderIcon } from '../components/icons.js'
import { openReceiptModal } from '../components/receipt-modal.js'
import { audit } from '../utils/audit.js'
import { getInventory, invalidateAfterSale } from '../utils/db.js'

// ── View mode: 'grid' or 'list' ──────────────────────────────
let viewMode   = localStorage.getItem('pos-view') || 'grid'
let cart       = []   // [{ item, qty, price, note }]
let allItems   = []
let searchQuery = ''
let customers  = []
let accounts   = []

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  // Load data
  const [items, { data: custs }, { data: accs }] = await Promise.all([
    getInventory(),
    supabase.from('customers').select('id, name, phone').in('store_id', storeIds).order('name'),
    supabase.from('cash_accounts').select('id, name, account_type').in('store_id', storeIds),
  ])

  allItems  = items   || []
  customers = custs   || []
  accounts  = accs    || []

  container.innerHTML = `
    <div class="pos-layout">

      <!-- LEFT: Product browser -->
      <div class="pos-left">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;gap:0.75rem">
          <div class="page-title">Point of Sale</div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <!-- View toggle -->
            <div class="view-toggle">
              <button class="view-btn ${viewMode==='grid'?'active':''}" data-view="grid" title="Grid view">
                ${renderIcon('dashboard', 15)}
              </button>
              <button class="view-btn ${viewMode==='list'?'active':''}" data-view="list" title="List view">
                ${renderIcon('reports', 15)}
              </button>
            </div>
          </div>
        </div>

        <!-- Search -->
        <div class="pos-search-wrap">
          <div class="pos-search-inner">
            ${renderIcon('search', 16, 'var(--muted)')}
            <input
              class="pos-search-input"
              id="pos-search"
              type="text"
              placeholder="Search products..."
              autocomplete="off"
              value="${searchQuery}"
            >
            <button class="pos-search-clear" id="pos-search-clear" style="${searchQuery ? '' : 'display:none'}">
              ${renderIcon('close', 13)}
            </button>
          </div>
        </div>

        <!-- Category filters -->
        <div id="pos-categories" class="pos-categories"></div>

        <!-- Product grid/list -->
        <div id="pos-products" class="pos-products ${viewMode}"></div>
      </div>

      <!-- RIGHT: Cart -->
      <div class="pos-right" id="pos-cart-panel">
        <div class="pos-cart-header">
          <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem">
            ${renderIcon('store', 17)}
            Cart
            <span class="cart-count" id="cart-badge" style="display:none">0</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-clear-cart" style="color:var(--danger)">
            ${renderIcon('close', 14)} Clear
          </button>
        </div>

        <div class="pos-cart-items" id="cart-items">
          <div class="cart-empty">
            ${renderIcon('inventory', 32, 'var(--gray-300)')}
            <div style="margin-top:0.75rem;font-weight:500;color:var(--muted)">Cart is empty</div>
            <div style="font-size:0.8125rem;color:var(--gray-400);margin-top:0.25rem">Add products from the left</div>
          </div>
        </div>

        <!-- Totals -->
        <div class="pos-totals" id="pos-totals" style="display:none">

          <!-- Discount row -->
          <div class="total-row">
            <span class="total-label">Subtotal</span>
            <span class="total-val" id="tot-subtotal">0.00 ETB</span>
          </div>
          <div class="total-row">
            <span class="total-label">
              Discount
              <input type="number" id="discount-input" class="inline-input" min="0" max="100" value="0" placeholder="0"> %
            </span>
            <span class="total-val" id="tot-discount" style="color:var(--danger)">-0.00 ETB</span>
          </div>

          <div class="total-divider"></div>

          <div class="total-row total-final">
            <span>Total</span>
            <span id="tot-final">0.00 ETB</span>
          </div>

          <!-- Profit indicator -->
          <div id="profit-bar" class="profit-bar"></div>

        </div>

        <!-- Checkout form -->
        <div class="pos-checkout" id="pos-checkout" style="display:none">

          <!-- Payment method -->
          <div style="margin-bottom:0.75rem">
            <div class="form-label" style="margin-bottom:0.4rem">Payment</div>
            <div class="pay-methods" id="pay-methods">
              ${['cash','bank_transfer','telebirr','cbe_birr','credit','other'].map(pm => `
                <button class="pay-method-btn ${pm==='cash'?'active':''}" data-pay="${pm}">
                  ${PAY_LABELS[pm]}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Credit customer fields -->
          <div id="credit-fields" style="display:none;margin-bottom:0.75rem">
            <div class="credit-banner">
              ${renderIcon('user', 14)}
              Customer required for credit sale
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
              <div>
                <label class="form-label">Name *</label>
                <input class="form-input" id="credit-name" placeholder="Customer name" list="cust-list">
                <datalist id="cust-list">
                  ${customers.map(c => `<option value="${c.name}">`).join('')}
                </datalist>
              </div>
              <div>
                <label class="form-label">Phone</label>
                <input class="form-input" id="credit-phone" placeholder="09xxxxxxxx">
              </div>
            </div>
          </div>

          <!-- Optional customer (non-credit) -->
          <div id="optional-customer" style="margin-bottom:0.75rem">
            <details>
              <summary class="optional-summary">+ Customer info (optional)</summary>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
                <div>
                  <label class="form-label">Name</label>
                  <input class="form-input" id="opt-cust-name" placeholder="Optional" list="cust-list-2">
                  <datalist id="cust-list-2">
                    ${customers.map(c => `<option value="${c.name}">`).join('')}
                  </datalist>
                </div>
                <div>
                  <label class="form-label">Phone</label>
                  <input class="form-input" id="opt-cust-phone" placeholder="Optional">
                </div>
              </div>
            </details>
          </div>

          <!-- Cash account -->
          <div style="margin-bottom:0.75rem">
            <label class="form-label">Cash Account</label>
            <select class="form-input" id="sale-account">
              ${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
            </select>
          </div>

          <!-- Description -->
          <div style="margin-bottom:0.875rem">
            <label class="form-label">Note (optional)</label>
            <input class="form-input" id="sale-note" placeholder="e.g. delivery, invoice ref...">
          </div>

          <!-- Bulk sale toggle -->
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.875rem">
            <input type="checkbox" id="bulk-toggle" style="width:16px;height:16px;accent-color:var(--accent)">
            <label for="bulk-toggle" style="font-size:0.875rem;font-weight:500;cursor:pointer">
              Bulk sale — skip stock deduction
            </label>
          </div>

          <!-- SELL button -->
          <button class="btn btn-primary btn-sell" id="btn-sell">
            ${renderIcon('check', 18)}
            Complete Sale
          </button>

        </div>
      </div>
    </div>
  `

  // ── Inject POS styles ────────────────────────────────────
  injectPOSStyles()

  // ── Mobile cart FAB ───────────────────────────────────────
  const cartFab = document.createElement('button')
  cartFab.id = 'cart-fab'
  cartFab.style.cssText = `
    display:none;
    position:fixed;
    bottom:90px;
    right:1rem;
    z-index:200;
    width:54px;
    height:54px;
    border-radius:50%;
    background:var(--accent);
    color:#fff;
    border:none;
    cursor:pointer;
    align-items:center;
    justify-content:center;
    box-shadow:0 4px 16px rgba(13,148,136,0.35);
    font-size:1.1rem;
    transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
  `
  cartFab.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center">
      ${renderIcon('store', 22, '#fff')}
      <span id="fab-badge" style="
        position:absolute;top:-8px;right:-8px;
        background:#fff;color:var(--accent);
        font-size:10px;font-weight:800;
        border-radius:999px;padding:1px 5px;
        display:none;min-width:16px;text-align:center;
      ">0</span>
    </div>
  `

  document.body.appendChild(cartFab)

  // Show on mobile only
  if (window.innerWidth <= 768) {
    cartFab.style.display = 'flex'
  }

  window.addEventListener('resize', () => {
    cartFab.style.display = window.innerWidth <= 768 ? 'flex' : 'none'
  })

  const cartPanel = container.querySelector('#pos-cart-panel')
  let cartOpen = false

  function toggleCart(open) {
    cartOpen = open
    cartPanel.classList.toggle('open', open)
    cartFab.style.transform = open ? 'scale(0.9)' : 'scale(1)'
    // Prevent body scroll when cart open
    document.body.style.overflow = open ? 'hidden' : ''
  }

  cartFab.addEventListener('click', () => toggleCart(!cartOpen))

  // Tap header to close on mobile
  container.querySelector('.pos-cart-header').addEventListener('click', () => {
    if (window.innerWidth <= 768 && cartOpen) toggleCart(false)
  })

  // Close on backdrop tap
  cartPanel.addEventListener('click', e => {
    if (e.target === cartPanel && window.innerWidth <= 768) toggleCart(false)
  })

  // Cleanup fab on page leave
  container._cleanup = () => {
    cartFab.remove()
    document.body.style.overflow = ''
  }

  // ── State ────────────────────────────────────────────────
  let activeCategory = ''
  let paymentMethod  = 'cash'
  let discount       = 0

  // ── Render categories ────────────────────────────────────
  function renderCategories() {
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort()
    const el   = container.querySelector('#pos-categories')
    el.innerHTML = `
      <button class="cat-chip ${!activeCategory ? 'active' : ''}" data-cat="">All</button>
      ${cats.map(c => `
        <button class="cat-chip ${activeCategory === c ? 'active' : ''}" data-cat="${c}">${c}</button>
      `).join('')}
    `
    el.querySelectorAll('.cat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat
        renderCategories()
        renderProducts()
      })
    })
  }

  // ── Render products ──────────────────────────────────────
  function renderProducts() {
    const el = container.querySelector('#pos-products')
    el.className = `pos-products ${viewMode}`

    let filtered = allItems

    // Category filter
    if (activeCategory) {
      filtered = filtered.filter(i => i.category === activeCategory)
    }

    // Search with fuzzy ranking
    if (searchQuery) {
      const matched = fuzzyMatch(searchQuery, filtered, { key:'item_name', threshold:0.1, limit:50 })
      // Put matched items first, then rest
      const matchedIds = new Set(matched.map(m => m.id))
      const unmatched  = filtered.filter(i => !matchedIds.has(i.id))
      filtered = [...matched, ...unmatched]
    }

    if (filtered.length === 0) {
      el.innerHTML = `
        <div class="products-empty">
          ${renderIcon('inventory', 32, 'var(--gray-300)')}
          <div style="margin-top:0.75rem;color:var(--muted);font-size:0.875rem">
            ${searchQuery ? `No products matching "${searchQuery}"` : 'No products yet'}
          </div>
        </div>
      `
      return
    }

    if (viewMode === 'grid') {
      el.innerHTML = filtered.map(item => {
        const inCart    = cart.find(c => c.item.id === item.id)
        const outOfStock = Number(item.quantity) <= 0
        return `
          <div class="product-card ${inCart ? 'in-cart' : ''} ${outOfStock ? 'out-of-stock' : ''}"
               data-id="${item.id}">
            <div class="product-card-inner">
              <div class="product-icon-wrap">
                ${renderIcon('inventory', 20, inCart ? 'var(--accent)' : 'var(--gray-400)')}
              </div>
              <div class="product-name">${highlight(item.item_name, searchQuery)}</div>
              <div class="product-cat">${item.category || ''}</div>
              <div class="product-price">${fmt(item.selling_price)} ETB</div>
              ${outOfStock
                ? `<div class="product-stock out">Out of stock</div>`
                : `<div class="product-stock ok">${item.quantity} in stock</div>`
              }
            </div>
            <button class="product-add-btn ${inCart ? 'added' : ''}" data-id="${item.id}">
              ${inCart
                ? renderIcon('check', 14, 'var(--accent)')
                : renderIcon('plus', 14, '#fff')
              }
            </button>
          </div>
        `
      }).join('')
    } else {
      // List / markdown view
      el.innerHTML = `
        <div class="product-list">
          ${filtered.map(item => {
            const inCart     = cart.find(c => c.item.id === item.id)
            const outOfStock = Number(item.quantity) <= 0
            return `
              <div class="product-row ${inCart ? 'in-cart' : ''} ${outOfStock ? 'out-of-stock' : ''}"
                   data-id="${item.id}">
                <div class="product-row-check">
                  <div class="product-row-dot ${inCart ? 'active' : ''}"></div>
                </div>
                <div class="product-row-info">
                  <div class="product-row-name">${highlight(item.item_name, searchQuery)}</div>
                  <div class="product-row-meta">
                    ${item.category ? `<span>${item.category}</span>` : ''}
                    ${item.sku      ? `<span>SKU: ${item.sku}</span>` : ''}
                    <span class="${outOfStock ? 'out-of-stock-text' : 'in-stock-text'}">
                      ${outOfStock ? 'Out of stock' : `${item.quantity} in stock`}
                    </span>
                  </div>
                </div>
                <div class="product-row-price">${fmt(item.selling_price)} ETB</div>
                <button class="product-row-add ${inCart ? 'added' : ''}" data-id="${item.id}">
                  ${inCart ? renderIcon('check', 14, 'var(--accent)') : renderIcon('plus', 14, '#fff')}
                </button>
              </div>
            `
          }).join('')}
        </div>
      `
    }

    // Add to cart listeners
    container.querySelectorAll('[data-id].product-card, [data-id].product-row').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return
        const id = el.dataset.id
        const item = allItems.find(i => i.id === id)
        if (item) addToCart(item)
      })
    })

    container.querySelectorAll('.product-add-btn, .product-row-add').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const id   = btn.dataset.id
        const item = allItems.find(i => i.id === id)
        if (item) addToCart(item)
      })
    })
  }

  // ── Cart operations ──────────────────────────────────────
  function addToCart(item) {
    const existing = cart.find(c => c.item.id === item.id)
    if (existing) {
      existing.qty++
    } else {
      cart.push({
        item,
        qty:   1,
        price: Number(item.selling_price) || 0,
        note:  '',
      })
    }
    renderCart()
    renderProducts()
  }

  function removeFromCart(itemId) {
    cart = cart.filter(c => c.item.id !== itemId)
    renderCart()
    renderProducts()
  }

  function updateCartItem(itemId, field, value) {
    const entry = cart.find(c => c.item.id === itemId)
    if (!entry) return
    entry[field] = value
    updateTotals()
  }

  function renderCart() {
    const itemsEl   = container.querySelector('#cart-items')
    const totalsEl  = container.querySelector('#pos-totals')
    const checkoutEl= container.querySelector('#pos-checkout')
    const badge     = container.querySelector('#cart-badge')

    if (cart.length === 0) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          ${renderIcon('inventory', 32, 'var(--gray-300)')}
          <div style="margin-top:0.75rem;font-weight:500;color:var(--muted)">Cart is empty</div>
          <div style="font-size:0.8125rem;color:var(--gray-400);margin-top:0.25rem">Add products from the left</div>
        </div>
      `
      totalsEl.style.display   = 'none'
      checkoutEl.style.display = 'none'
      badge.style.display      = 'none'
      return
    }

    badge.style.display  = 'inline-flex'
    badge.textContent    = cart.length

    // Sync FAB badge
    const fabBadge = document.getElementById('fab-badge')
    if (fabBadge) {
      fabBadge.style.display = cart.length > 0 ? 'inline-block' : 'none'
      fabBadge.textContent   = cart.length
    }

    // Pulse FAB when item added
    const fab = document.getElementById('cart-fab')
    if (fab && cart.length > 0) {
      fab.style.transform = 'scale(1.2)'
      setTimeout(() => { fab.style.transform = 'scale(1)' }, 200)
    }

    // Auto-open cart on mobile when first item added
    if (cart.length === 1 && window.innerWidth <= 768 && !cartOpen) {
      setTimeout(() => toggleCart(true), 300)
    }

    itemsEl.innerHTML = cart.map(entry => {
      const subtotal = entry.qty * entry.price
      const cost     = Number(entry.item.unit_cost) || 0
      const profit   = entry.price - cost
      const isLoss   = profit < 0

      return `
        <div class="cart-item" data-id="${entry.item.id}">
          <div class="cart-item-top">
            <div class="cart-item-name">${entry.item.item_name}</div>
            <button class="cart-remove" data-remove="${entry.item.id}">
              ${renderIcon('close', 13)}
            </button>
          </div>

          <div class="cart-item-controls">
            <!-- Qty -->
            <div class="qty-control">
              <button class="qty-btn" data-qty-change="${entry.item.id}" data-delta="-1">−</button>
              <input
                type="number"
                class="qty-input"
                value="${entry.qty}"
                min="0.01"
                step="0.01"
                data-qty-input="${entry.item.id}"
              >
              <button class="qty-btn" data-qty-change="${entry.item.id}" data-delta="1">+</button>
            </div>

            <!-- Price -->
            <div class="price-input-wrap">
              <span class="price-prefix">ETB</span>
              <input
                type="number"
                class="price-input ${isLoss ? 'price-loss' : ''}"
                value="${entry.price}"
                min="0"
                step="0.01"
                data-price-input="${entry.item.id}"
                title="Unit selling price"
              >
            </div>

            <!-- Line total -->
            <div class="cart-line-total">
              ${fmt(subtotal)} ETB
            </div>
          </div>

          ${isLoss ? `
            <div class="loss-warning">
              ${renderIcon('alert', 12)} Selling below cost (cost: ${fmt(cost)} ETB)
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    totalsEl.style.display   = 'block'
    checkoutEl.style.display = 'block'

    // Cart item listeners
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.remove))
    })

    container.querySelectorAll('[data-qty-change]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = cart.find(c => c.item.id === btn.dataset.qtyChange)
        if (!entry) return
        const newQty = Math.max(0.01, entry.qty + Number(btn.dataset.delta))
        entry.qty = Math.round(newQty * 100) / 100
        renderCart()
        renderProducts()
      })
    })

    container.querySelectorAll('[data-qty-input]').forEach(input => {
      input.addEventListener('change', () => {
        const val = parseFloat(input.value) || 1
        updateCartItem(input.dataset.qtyInput, 'qty', Math.max(0.01, val))
        renderCart()
      })
    })

    container.querySelectorAll('[data-price-input]').forEach(input => {
      input.addEventListener('input', () => {
        updateCartItem(input.dataset.priceInput, 'price', parseFloat(input.value) || 0)
        // Live update line total and profit warning
        renderCart()
      })
    })

    updateTotals()
  }

  function updateTotals() {
    const subtotal = cart.reduce((s, e) => s + e.qty * e.price, 0)
    const discAmt  = subtotal * (discount / 100)
    const total    = subtotal - discAmt
    const totalCost= cart.reduce((s, e) => s + e.qty * (Number(e.item.unit_cost) || 0), 0)
    const profit   = total - totalCost
    const margin   = total > 0 ? (profit / total * 100) : 0

    const set = (id, val) => { const el = container.querySelector(id); if (el) el.textContent = val }
    set('#tot-subtotal', fmt(subtotal) + ' ETB')
    set('#tot-discount', '-' + fmt(discAmt) + ' ETB')
    set('#tot-final',    fmt(total) + ' ETB')

    // Profit bar
    const profitBar = container.querySelector('#profit-bar')
    if (profitBar) {
      if (profit < 0) {
        profitBar.className = 'profit-bar loss'
        profitBar.innerHTML = `
          ${renderIcon('alert', 13)} Net loss of ${fmt(Math.abs(profit))} ETB on this sale
        `
      } else if (margin < 10) {
        profitBar.className = 'profit-bar low'
        profitBar.innerHTML = `
          ${renderIcon('alert', 13)} Low margin — ${margin.toFixed(1)}% profit
        `
      } else {
        profitBar.className = 'profit-bar ok'
        profitBar.innerHTML = `
          ${renderIcon('check', 13)} ${margin.toFixed(1)}% margin — ${fmt(profit)} ETB profit
        `
      }
    }
  }

  // ── Search ────────────────────────────────────────────────
  const searchInput = container.querySelector('#pos-search')
  const searchClear = container.querySelector('#pos-search-clear')

  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim()
    searchClear.style.display = searchQuery ? '' : 'none'
    renderProducts()
  })

  searchClear.addEventListener('click', () => {
    searchQuery = ''
    searchInput.value = ''
    searchClear.style.display = 'none'
    renderProducts()
    searchInput.focus()
  })

  // ── View toggle ───────────────────────────────────────────
  container.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view
      localStorage.setItem('pos-view', viewMode)
      container.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewMode))
      renderProducts()
    })
  })

  // ── Discount ──────────────────────────────────────────────
  container.querySelector('#discount-input').addEventListener('input', e => {
    discount = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
    updateTotals()
  })

  // ── Clear cart ────────────────────────────────────────────
  container.querySelector('#btn-clear-cart').addEventListener('click', () => {
    if (cart.length === 0) return
    if (!confirm('Clear the entire cart?')) return
    cart = []
    renderCart()
    renderProducts()
  })

  // ── Payment method ────────────────────────────────────────
  container.querySelectorAll('.pay-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      paymentMethod = btn.dataset.pay
      container.querySelectorAll('.pay-method-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === paymentMethod))
      container.querySelector('#credit-fields').style.display    = paymentMethod === 'credit' ? 'block' : 'none'
      container.querySelector('#optional-customer').style.display = paymentMethod === 'credit' ? 'none'  : 'block'
    })
  })

  // ── Sell ──────────────────────────────────────────────────
  container.querySelector('#btn-sell').addEventListener('click', () => handleSell(currentStore))

  async function handleSell(store) {
    if (cart.length === 0) { showToast('Add at least one product', 'error'); return }

    const subtotal   = cart.reduce((s, e) => s + e.qty * e.price, 0)
    const discAmt    = subtotal * (discount / 100)
    const total      = subtotal - discAmt
    const isBulk     = container.querySelector('#bulk-toggle')?.checked
    const accountId  = container.querySelector('#sale-account')?.value
    const note       = container.querySelector('#sale-note')?.value.trim()
    const isCredit   = paymentMethod === 'credit'

    // Validate credit
    if (isCredit) {
      const name = container.querySelector('#credit-name')?.value.trim()
      if (!name) { showToast('Customer name required for credit sale', 'error'); return }
    }

    // Check for loss warning
    const totalCost = cart.reduce((s, e) => s + e.qty * (Number(e.item.unit_cost) || 0), 0)
    if (total < totalCost) {
      if (!confirm(`⚠️ This sale results in a loss of ${fmt(totalCost - total)} ETB. Continue?`)) return
    }

    const btn = container.querySelector('#btn-sell')
    btn.textContent = 'Processing...'
    btn.disabled    = true

    try {
      // 1. Create sale record
      const { data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert({
          store_id:        store?.id,
          cash_account_id: isCredit ? null : (accountId || null),
          sale_date:       new Date().toISOString().split('T')[0],
          total_amount:    total,
          payment_method:  paymentMethod,
          source:          'manual',
          notes:           note || null,
        })
        .select()
        .single()

      if (saleErr) throw saleErr

      // 2. Sale items + stock deduction
      for (const entry of cart) {
        await supabase.from('sale_items').insert({
          sale_id:            sale.id,
          item_id:            entry.item.id,
          item_name_snapshot: entry.item.item_name,
          quantity:           entry.qty,
          unit_price:         entry.price,
        })

        // Deduct stock unless bulk sale
        if (!isBulk) {
          await supabase.from('stock_movements').insert({
            store_id:      store?.id,
            item_id:       entry.item.id,
            movement_type: 'out',
            quantity:      entry.qty,
            source:        'sale',
            reference_id:  sale.id,
          })
        }
      }

      // After all sale items inserted
      await audit.salecompleted(sale, cart.map(e => ({
        name: e.item.item_name, qty: e.qty, price: e.price
      })))

      // 3. Credit sale record
      if (isCredit) {
        const custName  = container.querySelector('#credit-name').value.trim()
        const custPhone = container.querySelector('#credit-phone')?.value.trim() || null

        let customer = customers.find(c => c.name.toLowerCase() === custName.toLowerCase())
        if (!customer) {
          const { data } = await supabase.from('customers').insert({
            store_id: store?.id,
            name:     custName,
            phone:    custPhone,
          }).select().single()
          customer = data
          customers.push(customer)
        }

        await supabase.from('credit_sales').insert({
          store_id:    store?.id,
          sale_id:     sale.id,
          customer_id: customer.id,
          amount_owed: total,
          status:      'unpaid',
        })
      }

      // 4. Post journal entry
      try {
        await postSaleEntry({
          storeId:  store?.id,
          saleId:   sale.id,
          date:     new Date().toISOString().split('T')[0],
          amount:   total,
          isCredit,
        })
      } catch(e) { console.warn('Journal post skipped:', e.message) }

      // 5. Show success
      showSaleSuccess(total, cart.length, sale.id)

      // 6. Reset
      cart = []
      renderCart()
      renderProducts()

      invalidateAfterSale()

      // Reload inventory quantities
      const fresh = await getInventory()
      allItems = fresh || []
      renderProducts()

    } catch(err) {
      console.error('Sale error:', err)
      showToast(`Sale failed: ${err.message}`, 'error')
    } finally {
      btn.innerHTML = `${renderIcon('check', 18)} Complete Sale`
      btn.disabled  = false
    }
  }

  // ── Success overlay ───────────────────────────────────────
  function showSaleSuccess(total, itemCount, saleId) {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.4);
      backdrop-filter:blur(8px);z-index:400;
      display:flex;align-items:center;justify-content:center;
    `
    overlay.innerHTML = `
      <div style="
        background:var(--bg-elevated);border-radius:24px;padding:2.5rem 2rem;
        text-align:center;max-width:320px;width:90%;
        box-shadow:var(--shadow-lg);animation:sale-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);
      ">
        <div style="
          width:64px;height:64px;background:var(--teal-50);border-radius:50%;
          display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;
          color:var(--accent);
        ">
          ${renderIcon('check', 28, 'var(--accent)')}
        </div>
        <div style="font-size:1.25rem;font-weight:700;margin-bottom:0.25rem">Sale Complete!</div>
        <div style="font-size:2rem;font-weight:800;color:var(--accent);letter-spacing:-1px;margin-bottom:0.25rem">
          ${fmt(total)} ETB
        </div>
        <div style="color:var(--muted);font-size:0.875rem;margin-bottom:1.5rem">
          ${itemCount} item${itemCount!==1?'s':''} sold
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          <button style="
            width:100%;padding:0.75rem;
            background:var(--bg-subtle);color:var(--dark);
            border-radius:14px;font-weight:600;font-size:0.9375rem;
            cursor:pointer;border:1.5px solid var(--border);
            display:flex;align-items:center;justify-content:center;gap:0.5rem;
          " id="btn-view-receipt">
            ${renderIcon('reports', 16)} Receipt & Share
          </button>
          <button style="
            width:100%;padding:0.75rem;
            background:var(--accent);color:#fff;border-radius:14px;
            font-weight:600;font-size:0.9375rem;cursor:pointer;border:none;
          " id="success-close">New Sale</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    overlay.querySelector('#btn-view-receipt').addEventListener('click', () => {
      overlay.remove()
      openReceiptModal(saleId)
    })

    overlay.querySelector('#success-close').addEventListener('click', () => overlay.remove())
    setTimeout(() => { if (document.body.contains(overlay)) overlay.remove() }, 6000)
  }

  // ── Init render ───────────────────────────────────────────
  renderCategories()
  renderProducts()
  renderCart()
}

// ── Helpers ──────────────────────────────────────────────────
const PAY_LABELS = {
  cash:          'Cash',
  bank_transfer: 'Bank',
  telebirr:      'Telebirr',
  cbe_birr:      'CBE Birr',
  credit:        'Credit',
  other:         'Other',
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function highlight(text, query) {
  if (!query || !text) return text || ''
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(
    new RegExp(`(${escaped})`, 'gi'),
    `<mark style="background:var(--teal-200);color:var(--teal-900);border-radius:2px;padding:0 1px">$1</mark>`
  )
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-container'; document.body.appendChild(wrap) }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 3500)
}

// ── POS-specific styles ───────────────────────────────────────
function injectPOSStyles() {
  if (document.getElementById('pos-styles')) return
  const style = document.createElement('style')
  style.id = 'pos-styles'
  style.textContent = `
    @keyframes sale-pop {
      from { transform: scale(0.8); opacity: 0; }
      to   { transform: scale(1);   opacity: 1; }
    }

    .pos-layout {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 1.25rem;
      height: calc(100vh - 4rem);
      max-height: 900px;
    }

    .pos-left {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .pos-right {
      display: flex;
      flex-direction: column;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    /* Search */
    .pos-search-wrap {
      margin-bottom: 0.875rem;
    }

    .pos-search-inner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-elevated);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 0.5rem 0.875rem;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .pos-search-inner:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(13,148,136,0.1);
    }

    .pos-search-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9375rem;
      color: var(--dark);
    }

    .pos-search-clear {
      color: var(--muted);
      padding: 2px;
      border-radius: 50%;
      display: flex;
      transition: all 0.15s;
    }

    .pos-search-clear:hover { background: var(--bg-hover); color: var(--dark); }

    /* View toggle */
    .view-toggle {
      display: flex;
      background: var(--bg-subtle);
      border-radius: var(--radius);
      padding: 2px;
      gap: 2px;
    }

    .view-btn {
      padding: 0.3rem 0.5rem;
      border-radius: var(--radius-sm);
      color: var(--muted);
      transition: all 0.15s;
      display: flex;
      align-items: center;
    }

    .view-btn.active {
      background: var(--bg-elevated);
      color: var(--accent);
      box-shadow: var(--shadow-xs);
    }

    /* Categories */
    .pos-categories {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.875rem;
    }

    .cat-chip {
      padding: 0.3rem 0.875rem;
      border-radius: var(--radius-pill);
      font-size: 0.8125rem;
      font-weight: 600;
      border: 1.5px solid var(--border);
      background: var(--bg-elevated);
      color: var(--muted);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .cat-chip:hover { border-color: var(--accent); color: var(--accent); }
    .cat-chip.active {
      background: var(--teal-50);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Product grid */
    .pos-products {
      flex: 1;
      overflow-y: auto;
      padding-right: 2px;
    }

    .pos-products.grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 0.75rem;
      align-content: start;
    }

    .pos-products.list { display: flex; flex-direction: column; }

    .products-empty {
      grid-column: 1/-1;
      text-align: center;
      padding: 3rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* Grid product card */
    .product-card {
      background: var(--bg-elevated);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all 0.18s;
      position: relative;
      overflow: hidden;
    }

    .product-card:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow-sm);
      transform: translateY(-2px);
    }

    .product-card.in-cart {
      border-color: var(--accent);
      background: var(--teal-50);
    }

    .product-card.out-of-stock {
      opacity: 0.5;
      pointer-events: none;
    }

    .product-card-inner {
      padding: 0.875rem 0.75rem;
    }

    .product-icon-wrap {
      width: 36px;
      height: 36px;
      background: var(--bg-subtle);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.5rem;
    }

    .product-card.in-cart .product-icon-wrap {
      background: var(--teal-50);
    }

    .product-name {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--dark);
      line-height: 1.3;
      margin-bottom: 2px;
    }

    .product-cat {
      font-size: 0.6875rem;
      color: var(--muted);
      margin-bottom: 0.4rem;
    }

    .product-price {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--accent);
    }

    .product-stock {
      font-size: 0.6875rem;
      font-weight: 600;
      margin-top: 2px;
    }

    .product-stock.ok  { color: var(--success); }
    .product-stock.out { color: var(--danger);  }

    .product-add-btn {
      position: absolute;
      bottom: 0.5rem;
      right: 0.5rem;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1);
      box-shadow: 0 2px 6px rgba(13,148,136,0.3);
    }

    .product-add-btn.added {
      background: var(--teal-50);
      border: 1.5px solid var(--accent);
    }

    .product-add-btn:hover { transform: scale(1.15); }

    /* List product row */
    .product-list { display: flex; flex-direction: column; gap: 1px; }

    .product-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: var(--radius);
      cursor: pointer;
      transition: all 0.15s;
    }

    .product-row:hover { background: var(--bg-subtle); }
    .product-row.in-cart { background: var(--teal-50); }
    .product-row.out-of-stock { opacity: 0.5; pointer-events: none; }

    .product-row-check {
      width: 16px;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .product-row-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      transition: all 0.15s;
    }

    .product-row-dot.active {
      background: var(--accent);
      border-color: var(--accent);
    }

    .product-row-info { flex: 1; min-width: 0; }

    .product-row-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--dark);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .product-row-meta {
      display: flex;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 1px;
      flex-wrap: wrap;
      align-items: center;
    }

    .product-row-meta span {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
    }

    .product-row-meta span:not(:last-child)::after {
      content: '·';
      margin-left: 0.5rem;
      color: var(--border);
    }

    .in-stock-text  { color: var(--success); font-weight: 600; }
    .out-of-stock-text { color: var(--danger); font-weight: 600; }

    .product-row-price {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--accent);
      white-space: nowrap;
    }

    .product-row-add {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1);
    }

    .product-row-add.added {
      background: var(--teal-50);
      border: 1.5px solid var(--accent);
    }

    .product-row-add:hover { transform: scale(1.15); }

    /* Cart */
    .pos-cart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.125rem;
      border-bottom: 1px solid var(--border);
    }

    .cart-count {
      background: var(--accent);
      color: #fff;
      font-size: 0.6875rem;
      font-weight: 700;
      border-radius: 999px;
      padding: 1px 6px;
    }

    .pos-cart-items {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem;
    }

    .cart-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 160px;
      padding: 2rem;
    }

    .cart-item {
      background: var(--bg-subtle);
      border-radius: var(--radius-lg);
      padding: 0.75rem;
      margin-bottom: 0.625rem;
      border: 1px solid var(--border);
    }

    .cart-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .cart-item-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--dark);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cart-remove {
      color: var(--muted);
      padding: 3px;
      border-radius: 50%;
      display: flex;
      flex-shrink: 0;
      transition: all 0.15s;
    }

    .cart-remove:hover { background: var(--red-50); color: var(--danger); }

    .cart-item-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .qty-control {
      display: flex;
      align-items: center;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .qty-btn {
      padding: 0.3rem 0.5rem;
      font-size: 1rem;
      font-weight: 500;
      color: var(--muted);
      transition: all 0.15s;
      line-height: 1;
    }

    .qty-btn:hover { background: var(--bg-hover); color: var(--dark); }

    .qty-input {
      width: 44px;
      border: none;
      text-align: center;
      font-size: 0.875rem;
      font-weight: 600;
      background: transparent;
      outline: none;
      color: var(--dark);
      padding: 0.3rem 0;
      -moz-appearance: textfield;
    }

    .qty-input::-webkit-outer-spin-button,
    .qty-input::-webkit-inner-spin-button { -webkit-appearance: none; }

    .price-input-wrap {
      display: flex;
      align-items: center;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }

    .price-prefix {
      font-size: 0.75rem;
      color: var(--muted);
      padding: 0 0.375rem;
      white-space: nowrap;
    }

    .price-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--accent);
      padding: 0.35rem 0.375rem 0.35rem 0;
      min-width: 0;
      -moz-appearance: textfield;
    }

    .price-input.price-loss { color: var(--danger); }

    .price-input::-webkit-outer-spin-button,
    .price-input::-webkit-inner-spin-button { -webkit-appearance: none; }

    .cart-line-total {
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--dark);
      white-space: nowrap;
      min-width: 70px;
      text-align: right;
    }

    .loss-warning {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      color: var(--danger);
      margin-top: 0.4rem;
      background: var(--red-50);
      padding: 0.3rem 0.5rem;
      border-radius: var(--radius-sm);
    }

    /* Totals */
    .pos-totals {
      padding: 0.875rem 1.125rem;
      border-top: 1px solid var(--border);
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.25rem 0;
      font-size: 0.875rem;
    }

    .total-label {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--muted);
    }

    .total-val { font-weight: 600; color: var(--dark); }
    .total-divider { border: none; border-top: 1px solid var(--border); margin: 0.4rem 0; }

    .total-final {
      font-size: 1rem;
      font-weight: 700;
      color: var(--dark);
    }

    .inline-input {
      width: 44px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 1px 4px;
      font-size: 0.8125rem;
      text-align: center;
      outline: none;
      background: var(--bg-elevated);
    }

    .inline-input:focus { border-color: var(--accent); }

    .profit-bar {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.35rem 0.5rem;
      border-radius: var(--radius);
      margin-top: 0.5rem;
    }

    .profit-bar.ok   { background: var(--green-50); color: #15803D; }
    .profit-bar.low  { background: var(--amber-50); color: #92400E; }
    .profit-bar.loss { background: var(--red-50);   color: #991B1B; }

    /* Checkout */
    .pos-checkout {
      padding: 0.875rem 1.125rem;
      border-top: 1px solid var(--border);
      background: var(--bg-subtle);
    }

    .pay-methods {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }

    .pay-method-btn {
      padding: 0.3rem 0.75rem;
      border-radius: var(--radius-pill);
      font-size: 0.8125rem;
      font-weight: 600;
      border: 1.5px solid var(--border);
      background: var(--bg-elevated);
      color: var(--muted);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .pay-method-btn:hover { border-color: var(--accent); color: var(--accent); }

    .pay-method-btn.active {
      background: var(--teal-50);
      border-color: var(--accent);
      color: var(--accent);
    }

    .credit-banner {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: #92400E;
      background: var(--amber-50);
      border: 1px solid #FDE68A;
      border-radius: var(--radius);
      padding: 0.5rem 0.75rem;
    }

    .optional-summary {
      font-size: 0.8125rem;
      color: var(--muted);
      cursor: pointer;
      padding: 0.25rem 0;
      font-weight: 500;
      user-select: none;
    }

    .optional-summary:hover { color: var(--dark); }

    .btn-sell {
      width: 100%;
      justify-content: center;
      padding: 0.75rem;
      font-size: 0.9375rem;
      border-radius: var(--radius-lg);
      gap: 0.5rem;
      letter-spacing: -0.1px;
    }

    /* Mobile POS */
    @media (max-width: 768px) {
      .pos-layout {
        grid-template-columns: 1fr;
        height: auto;
        max-height: none;
        gap: 0;
      }

      .pos-left {
        padding-bottom: 80px;
      }

      /* Cart as bottom sheet on mobile */
      .pos-right {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 250;
        border-radius: 24px 24px 0 0;
        border: none;
        border-top: 1px solid var(--border);
        max-height: 85dvh;
        transform: translateY(100%);
        transition: transform 0.35s cubic-bezier(0.32,0.72,0,1);
        background: var(--bg-elevated);
        display: flex !important;
      }

      .pos-right.open {
        transform: translateY(0);
      }

      /* Drag handle */
      .pos-cart-header::before {
        content: '';
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 36px;
        height: 4px;
        background: var(--border);
        border-radius: 999px;
      }

      .pos-cart-header {
        position: relative;
        cursor: pointer;
      }

      .pos-cart-items {
        max-height: 40dvh;
      }

      .pos-products.grid {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      }
    }
  `
  document.head.appendChild(style)
}