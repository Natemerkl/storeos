import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { fuzzyMatch } from '../utils/fuzzy.js'
import { postSaleEntry } from '../utils/accounting.js'
import { renderIcon } from '../components/icons.js'
import { openReceiptModal } from '../components/receipt-modal.js'
import { audit } from '../utils/audit.js'
import { getInventory, invalidateAfterSale } from '../utils/db.js'
import { checkSaleAgainstInventory } from '../utils/inventory-resolver.js'
import { openInventoryResolverModal } from '../components/inventory-resolver-modal.js'

function sanitizeNumericInput(value) {
  const s = String(value == null ? '' : value)
  return s.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')
}

let viewMode    = localStorage.getItem('pos-view') || 'grid'
let cart        = []
let allItems    = []
let searchQuery = ''
let customers   = []
let accounts    = []
let posTransport = { fee: 0, targa: '', place: '', paidNow: true }

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  const [items, { data: custs }, { data: accs }] = await Promise.all([
    getInventory(),
    supabase.from('customers').select('id, name, phone').in('store_id', storeIds).order('name'),
    supabase.from('cash_accounts').select('id, account_name, account_type, bank_name').in('store_id', storeIds).order('account_name'),
  ])

  allItems  = items  || []
  customers = custs  || []
  accounts  = accs   || []
  
  console.log('POS: Loaded accounts:', accounts)

  container.innerHTML = `
    <div class="pos-layout">

      <!-- LEFT: Product browser -->
      <div class="pos-left">
        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:1rem;gap:0.75rem">
          <div class="page-title">Point of Sale</div>
          <div class="view-toggle">
            <button class="view-btn ${viewMode==='grid'?'active':''}" data-view="grid">
              ${renderIcon('dashboard', 15)}
            </button>
            <button class="view-btn ${viewMode==='list'?'active':''}" data-view="list">
              ${renderIcon('reports', 15)}
            </button>
          </div>
        </div>

        <div class="pos-search-wrap">
          <div class="pos-search-inner">
            ${renderIcon('search', 16, 'var(--muted)')}
            <input class="pos-search-input" id="pos-search" type="text"
              placeholder="Search products..." autocomplete="off" value="${searchQuery}">
            <button class="pos-search-clear" id="pos-search-clear"
              style="${searchQuery?'':'display:none'}">
              ${renderIcon('close', 13)}
            </button>
          </div>
        </div>

        <div id="pos-categories" class="pos-categories"></div>
        <div id="pos-products" class="pos-products ${viewMode}"></div>
      </div>

      <!-- RIGHT: Cart (desktop) -->
      <div class="pos-right" id="pos-cart-panel">
        <div class="pos-cart-header">
          <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem">
            ${renderIcon('store', 17)} Cart
            <span class="cart-count" id="cart-badge" style="display:none">0</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-clear-cart"
            style="color:var(--danger)">
            ${renderIcon('close', 14)} Clear
          </button>
        </div>

        <div class="pos-cart-items" id="cart-items">
          <div class="cart-empty">
            ${renderIcon('inventory', 32, 'var(--gray-300)')}
            <div style="margin-top:0.75rem;font-weight:500;color:var(--muted)">Cart is empty</div>
            <div style="font-size:0.8125rem;color:var(--gray-400);margin-top:0.25rem">
              Add products from the left
            </div>
          </div>
        </div>

        <div class="pos-totals" id="pos-totals" style="display:none">
          <div class="total-row">
            <span class="total-label">Subtotal</span>
            <span class="total-val" id="tot-subtotal">0.00 ETB</span>
          </div>
          <div class="total-row">
            <span class="total-label">
              Discount
              <input type="number" id="discount-input" class="inline-input"
                min="0" max="100" value="0"> %
            </span>
            <span class="total-val" id="tot-discount" style="color:var(--danger)">
              -0.00 ETB
            </span>
          </div>
          <div class="total-divider"></div>
          <div class="total-row total-final">
            <span>Total</span>
            <span id="tot-final">0.00 ETB</span>
          </div>
          <div id="profit-bar" class="profit-bar"></div>
        </div>

        <div class="pos-checkout" id="pos-checkout" style="display:none">
          <div style="margin-bottom:0.75rem">
            <div class="form-label" style="margin-bottom:0.4rem">Payment</div>
            <div id="pos-payment-section"></div>
          </div>
          <div id="credit-fields" style="display:none;margin-bottom:0.75rem">
            <div class="credit-banner">
              ${renderIcon('user', 14)} Customer required for credit sale
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
              <div>
                <label class="form-label">Name *</label>
                <input class="form-input" id="credit-name" placeholder="Customer name"
                  list="cust-list">
                <datalist id="cust-list">
                  ${customers.map(c=>`<option value="${c.name}">`).join('')}
                </datalist>
              </div>
              <div>
                <label class="form-label">Phone</label>
                <input class="form-input" id="credit-phone" placeholder="09xxxxxxxx">
              </div>
            </div>
          </div>
          <div id="optional-customer" style="margin-bottom:0.75rem">
            <details>
              <summary class="optional-summary">+ Customer info (optional)</summary>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
                <div>
                  <label class="form-label">Name</label>
                  <input class="form-input" id="opt-cust-name" placeholder="Optional"
                    list="cust-list-2">
                  <datalist id="cust-list-2">
                    ${customers.map(c=>`<option value="${c.name}">`).join('')}
                  </datalist>
                </div>
                <div>
                  <label class="form-label">Phone</label>
                  <input class="form-input" id="opt-cust-phone" placeholder="Optional">
                </div>
              </div>
            </details>
          </div>
          <div style="margin-bottom:0.875rem">
            <label class="form-label">Note (optional)</label>
            <input class="form-input" id="sale-note"
              placeholder="e.g. delivery, invoice ref...">
          </div>
          <div style="margin-bottom:0.875rem">
            <label class="form-label">Phone Number (optional)</label>
            <input class="form-input" id="sale-phone"
              placeholder="09xxxxxxxx">
          </div>
          <div style="background:var(--bg-subtle);border-radius:10px;padding:0.625rem 0.75rem;margin-bottom:0.875rem">
            <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.5rem">ðŸšš Transport / Delivery (optional)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
              <div>
                <label class="form-label" style="font-size:0.75rem">Fee (ETB)</label>
                <input type="number" class="form-input" id="pos-transport-fee" min="0" placeholder="0.00" step="0.01" inputmode="decimal">
              </div>
              <div>
                <label class="form-label" style="font-size:0.75rem">Plate / Targa</label>
                <input class="form-input" id="pos-transport-targa" placeholder="AA-12345" style="font-family:monospace;text-transform:uppercase">
              </div>
            </div>
            <div style="margin-bottom:0.5rem">
              <label class="form-label" style="font-size:0.75rem">Delivery Place</label>
              <input class="form-input" id="pos-transport-place" placeholder="e.g. Merkato">
            </div>
            <div id="pos-transport-pay-row" style="display:none">
              <div style="font-size:0.75rem;font-weight:600;color:var(--muted);margin-bottom:0.25rem">Transport Payment</div>
              <div style="display:flex;gap:0.375rem">
                <button type="button" id="pos-tp-yes" style="padding:0.2rem 0.625rem;border-radius:var(--radius-pill);font-size:0.75rem;font-weight:600;cursor:pointer;border:1.5px solid var(--accent);background:var(--teal-50);color:var(--accent)">Paid Now</button>
                <button type="button" id="pos-tp-no" style="padding:0.2rem 0.625rem;border-radius:var(--radius-pill);font-size:0.75rem;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--bg-elevated);color:var(--muted)">Owe Driver</button>
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.875rem">
            <input type="checkbox" id="bulk-toggle"
              style="width:16px;height:16px;accent-color:var(--accent)">
            <label for="bulk-toggle"
              style="font-size:0.875rem;font-weight:500;cursor:pointer">
              Bulk sale â€” skip stock deduction
            </label>
          </div>
          <div style="position:sticky;bottom:0;background:var(--bg-subtle);
            padding-top:0.75rem;margin:-0.875rem -1.125rem 0;
            padding:0.75rem 1.125rem 0;border-top:1px solid var(--border);margin-top:0.5rem">
            <button class="btn btn-primary btn-sell" id="btn-sell">
              ${renderIcon('check', 18)} Complete Sale
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- â”€â”€ MOBILE CART SHEET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
    <!-- Trigger button â€” sticky above nav -->
    <div id="mobile-cart-trigger" style="display:none">
      <button id="btn-open-cart" aria-label="Open cart">
        <div style="position:relative">
          ${renderIcon('store', 22, '#fff')}
          <span id="mobile-cart-count" style="
            position:absolute;top:-8px;right:-10px;
            background:#fff;color:var(--accent);
            font-size:11px;font-weight:800;
            border-radius:999px;
            padding:1px 5px;min-width:18px;
            text-align:center;line-height:1.4;
            display:none;
          ">0</span>
        </div>
        <span id="mobile-cart-total" style="font-weight:700;font-size:0.9375rem">
          0.00 ETB
        </span>
        <div style="
          display:flex;align-items:center;gap:4px;
          background:rgba(255,255,255,0.2);
          border-radius:var(--radius-pill);
          padding:4px 10px;font-size:0.8125rem;font-weight:600;
        ">
          Checkout ${renderIcon('check', 13, '#fff')}
        </div>
      </button>
    </div>

    <!-- Mobile cart bottom sheet overlay -->
    <div id="mobile-cart-overlay" style="
      display:none;position:fixed;inset:0;
      background:rgba(0,0,0,0.4);
      backdrop-filter:blur(4px);
      z-index:240;
    "></div>

    <!-- Mobile cart sheet -->
    <div id="mobile-cart-sheet" style="
      display:none;
      position:fixed;bottom:0;left:0;right:0;
      z-index:250;
      background:var(--bg-elevated);
      border-radius:24px 24px 0 0;
      max-height:92dvh;
      overflow-y:auto;
      transform:translateY(100%);
      transition:transform 0.35s cubic-bezier(0.32,0.72,0,1);
      padding-bottom:calc(env(safe-area-inset-bottom,0px) + 1rem);
    ">
      <!-- Drag handle -->
      <div style="padding:12px 0 0;text-align:center;flex-shrink:0">
        <div style="width:36px;height:4px;background:var(--gray-200);
          border-radius:999px;display:inline-block;"></div>
      </div>

      <!-- Sheet header -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:12px 20px 16px;
        border-bottom:1px solid var(--border);
      ">
        <div style="font-weight:700;font-size:1.125rem;
          display:flex;align-items:center;gap:0.5rem;">
          ${renderIcon('store', 20)} Cart
          <span id="sheet-badge" style="
            background:var(--accent);color:#fff;
            font-size:0.75rem;font-weight:700;
            border-radius:999px;padding:1px 7px;
            display:none;
          ">0</span>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <button class="btn btn-ghost btn-sm" id="sheet-clear"
            style="color:var(--danger)">
            ${renderIcon('close', 13)} Clear
          </button>
          <button id="btn-close-cart" style="
            width:32px;height:32px;border-radius:50%;
            background:var(--bg-subtle);
            display:flex;align-items:center;justify-content:center;
            color:var(--muted);border:none;cursor:pointer;
          ">${renderIcon('close', 15)}</button>
        </div>
      </div>

      <!-- Cart items -->
      <div id="sheet-items" style="padding:12px 16px;"></div>

      <!-- Totals + checkout inside sheet -->
      <div id="sheet-checkout" style="
        padding:0 16px 16px;
        display:none;
      ">
        <!-- Subtotal / discount -->
        <div style="
          background:var(--bg-subtle);border-radius:14px;
          padding:12px 14px;margin-bottom:12px;
        ">
          <div style="display:flex;justify-content:space-between;
            font-size:0.875rem;color:var(--muted);margin-bottom:6px;">
            <span>Subtotal</span>
            <span id="sheet-subtotal" style="font-weight:600;color:var(--dark)">
              0.00 ETB
            </span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;
            font-size:0.875rem;color:var(--muted);">
            <span style="display:flex;align-items:center;gap:6px">
              Discount
              <input type="number" id="sheet-discount"
                class="inline-input" min="0" max="100" value="0"> %
            </span>
            <span id="sheet-discount-amt" style="font-weight:600;color:var(--danger)">
              -0.00 ETB
            </span>
          </div>
          <div style="border-top:1px solid var(--border);margin:8px 0;"></div>
          <div style="display:flex;justify-content:space-between;
            font-size:1.0625rem;font-weight:800;">
            <span>Total</span>
            <span id="sheet-total" style="color:var(--accent);letter-spacing:-0.3px">
              0.00 ETB
            </span>
          </div>
          <div id="sheet-profit-bar" style="margin-top:8px"></div>
        </div>

        <!-- Payment method -->
        <div style="margin-bottom:12px">
          <div class="form-label" style="margin-bottom:6px">Payment</div>
          <div id="sheet-payment-section"></div>
        </div>

        <!-- Credit fields (mobile) -->
        <div id="sheet-credit-fields" style="display:none;margin-bottom:12px">
          <div class="credit-banner">
            ${renderIcon('user', 14)} Customer required for credit sale
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
            <div>
              <label class="form-label">Name *</label>
              <input class="form-input" id="sheet-credit-name" placeholder="Customer name"
                list="sheet-cust-list">
              <datalist id="sheet-cust-list">
                ${customers.map(c=>`<option value="${c.name}">`).join('')}
              </datalist>
            </div>
            <div>
              <label class="form-label">Phone</label>
              <input class="form-input" id="sheet-credit-phone" placeholder="09xxxxxxxx">
            </div>
          </div>
        </div>

        <!-- Note -->
        <div style="margin-bottom:12px">
          <label class="form-label">Note (optional)</label>
          <input class="form-input" id="sheet-note"
            placeholder="e.g. delivery, invoice ref...">
        </div>

        <!-- Transport / Delivery (mobile) -->
        <div style="background:var(--bg-subtle);border-radius:10px;padding:0.625rem 0.75rem;margin-bottom:12px">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.5rem">Transport / Delivery (optional)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
            <div>
              <label class="form-label" style="font-size:0.75rem">Fee (ETB)</label>
              <input type="number" class="form-input" id="sheet-transport-fee" min="0" placeholder="0.00" step="0.01" inputmode="decimal">
            </div>
            <div>
              <label class="form-label" style="font-size:0.75rem">Plate / Targa</label>
              <input class="form-input" id="sheet-transport-targa" placeholder="AA-12345" style="font-family:monospace;text-transform:uppercase">
            </div>
          </div>
          <div style="margin-bottom:0.5rem">
            <label class="form-label" style="font-size:0.75rem">Delivery Place</label>
            <input class="form-input" id="sheet-transport-place" placeholder="e.g. Merkato">
          </div>
          <div id="sheet-transport-pay-row" style="display:none">
            <div style="font-size:0.75rem;font-weight:600;color:var(--muted);margin-bottom:0.25rem">Transport Payment</div>
            <div style="display:flex;gap:0.375rem">
              <button type="button" id="sheet-tp-yes" style="padding:0.2rem 0.625rem;border-radius:var(--radius-pill);font-size:0.75rem;font-weight:600;cursor:pointer;border:1.5px solid var(--accent);background:var(--teal-50);color:var(--accent)">Paid Now</button>
              <button type="button" id="sheet-tp-no" style="padding:0.2rem 0.625rem;border-radius:var(--radius-pill);font-size:0.75rem;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--bg-elevated);color:var(--muted)">Owe Driver</button>
            </div>
          </div>
        </div>

        <!-- Bulk toggle -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <input type="checkbox" id="sheet-bulk"
            style="width:16px;height:16px;accent-color:var(--accent)">
          <label for="sheet-bulk"
            style="font-size:0.875rem;font-weight:500;cursor:pointer">
            Bulk sale â€” skip stock deduction
          </label>
        </div>

        <!-- Complete sale button -->
        <button id="sheet-sell" class="btn btn-primary"
          style="width:100%;justify-content:center;font-size:1rem;
            min-height:52px;border-radius:16px;gap:0.5rem;">
          ${renderIcon('check', 20)} Complete Sale
        </button>
      </div>
    </div>
  `

  injectPOSStyles()

  let activeCategory = ''
  let paymentMethod  = accounts.find(a=>a.account_type==='till') ? 'cash' : (accounts.find(a=>a.account_type==='bank') ? 'bank_transfer' : 'credit')
  let posAccountId   = accounts.find(a=>a.account_type==='till')?.id || accounts.find(a=>a.account_type==='bank')?.id || ''
  let sheetPayMethod = paymentMethod
  let sheetAccountId = posAccountId
  let discount       = 0
  let sheetDiscount  = 0
  let cartOpen       = false

  // â”€â”€ Mobile cart sheet visibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const trigger       = container.querySelector('#mobile-cart-trigger')
  const cartSheet     = document.getElementById('mobile-cart-sheet') ||
                        container.querySelector('#mobile-cart-sheet')
  const cartOverlay   = container.querySelector('#mobile-cart-overlay')

  function isMobile() { return window.innerWidth <= 768 }

  function openCartSheet() {
    if (!isMobile()) return
    cartOpen = true
    const sheet   = document.getElementById('mobile-cart-sheet')
    const overlay = container.querySelector('#mobile-cart-overlay')
    if (sheet)   { sheet.style.display   = 'block'; requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)' }) }
    if (overlay) { overlay.style.display = 'block' }
    document.body.style.overflow = 'hidden'
  }

  function closeCartSheet() {
    cartOpen = false
    const sheet   = document.getElementById('mobile-cart-sheet')
    const overlay = container.querySelector('#mobile-cart-overlay')
    if (sheet) {
      sheet.style.transform = 'translateY(100%)'
      setTimeout(() => { if (sheet) sheet.style.display = 'none' }, 350)
    }
    if (overlay) overlay.style.display = 'none'
    document.body.style.overflow = ''
  }

  container.querySelector('#btn-open-cart')?.addEventListener('click', openCartSheet)
  container.querySelector('#btn-close-cart')?.addEventListener('click', closeCartSheet)
  container.querySelector('#mobile-cart-overlay')?.addEventListener('click', closeCartSheet)

  window.addEventListener('resize', () => {
    if (!isMobile()) closeCartSheet()
    updateTrigger()
  })

  container._cleanup = () => {
    document.body.style.overflow = ''
  }

  // â”€â”€ Categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderCategories() {
    const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort()
    const el   = container.querySelector('#pos-categories')
    el.innerHTML = `
      <button class="cat-chip ${!activeCategory?'active':''}" data-cat="">All</button>
      ${cats.map(c => `
        <button class="cat-chip ${activeCategory===c?'active':''}" data-cat="${c}">
          ${c}
        </button>
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

  // â”€â”€ Products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function getItemPrice(item) {
    return Number(item.selling_price) > 0 ? Number(item.selling_price) :
           Number(item.unit_cost)     > 0 ? Number(item.unit_cost)     : 0
  }

  function renderProducts() {
    const el = container.querySelector('#pos-products')
    el.className = `pos-products ${viewMode}`

    let filtered = allItems
    if (activeCategory) filtered = filtered.filter(i => i.category === activeCategory)

    if (searchQuery) {
      const matched    = fuzzyMatch(searchQuery, filtered, { key:'item_name', threshold:0.1, limit:50 })
      const matchedIds = new Set(matched.map(m => m.id))
      filtered = [...matched, ...filtered.filter(i => !matchedIds.has(i.id))]
    }

    if (!filtered.length) {
      el.innerHTML = `
        <div class="products-empty">
          ${renderIcon('inventory', 32, 'var(--gray-300)')}
          <div style="margin-top:0.75rem;color:var(--muted);font-size:0.875rem">
            ${searchQuery ? `No results for "${searchQuery}"` : 'No products yet'}
          </div>
        </div>
      `
      return
    }

    if (viewMode === 'grid') {
      el.innerHTML = filtered.map(item => {
        const inCart     = cart.find(c => c.item.id === item.id)
        const outOfStock = Number(item.quantity) <= 0
        const price      = getItemPrice(item)
        const isLow      = !outOfStock && Number(item.quantity) <= Number(item.low_stock_threshold || 5)

        // Category color accent
        const catColors = {
          default: { bg: '#F0FDFA', border: '#99F6E4', dot: '#0D9488' },
        }
        const accent = catColors.default

        return `
          <div class="product-card ${inCart?'in-cart':''} ${outOfStock?'out-of-stock':''}"
            data-id="${item.id}" style="
              position:relative;cursor:pointer;
              background:var(--bg-elevated);
              border:1px solid var(--border);
              border-radius:16px;padding:0.875rem;
              margin-bottom:0.5rem;
              transition:border-color 0.15s;
              ${outOfStock ? 'opacity:0.55;pointer-events:none;' : ''}
            ">
            <!-- Top color bar -->
            <div style="height:3px;background:${inCart ? 'var(--accent)' : outOfStock ? 'var(--gray-200)' : accent.border};"></div>

            <div style="padding:12px 12px 10px">

              <!-- Name â€” full, wraps to 2 lines max -->
              <div style="
                font-weight:700;font-size:0.875rem;
                color:${outOfStock ? 'var(--muted)' : 'var(--dark)'};
                line-height:1.35;
                display:-webkit-box;-webkit-line-clamp:2;
                -webkit-box-orient:vertical;overflow:hidden;
                min-height:2.4em;margin-bottom:6px;
                letter-spacing:-0.1px;
              ">${highlight(item.item_name, searchQuery)}</div>

              <!-- Category -->
              ${item.category ? `
                <div style="
                  font-size:0.6875rem;font-weight:600;
                  color:var(--muted);margin-bottom:8px;
                  text-transform:uppercase;letter-spacing:0.4px;
                ">${item.category}</div>
              ` : '<div style="margin-bottom:8px"></div>'}

              <!-- Price â€” large and prominent -->
              <div style="
                font-size:${price > 99999 ? '0.9375rem' : '1.0625rem'};
                font-weight:800;
                color:${outOfStock ? 'var(--muted)' : inCart ? 'var(--accent)' : 'var(--dark)'};
                letter-spacing:-0.3px;
                line-height:1;margin-bottom:6px;
              ">
                ${price > 0 ? fmt(price) : ''}
                ${price > 0 ? '<span style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-left:2px">ETB</span>' : ''}
              </div>

              <!-- Stock badge -->
              <div style="
                display:inline-flex;align-items:center;gap:3px;
                font-size:0.6875rem;font-weight:600;
                padding:2px 7px;border-radius:999px;
                background:${outOfStock ? 'var(--red-50)' : isLow ? 'var(--amber-50)' : 'var(--green-50)'};
                color:${outOfStock ? '#991B1B' : isLow ? '#92400E' : '#15803D'};
              ">
                <div style="width:5px;height:5px;border-radius:50%;flex-shrink:0;
                  background:${outOfStock ? '#EF4444' : isLow ? '#F59E0B' : '#22C55E'};"></div>
                ${outOfStock ? 'Out of stock' : isLow ? item.quantity + ' left' : item.quantity + ' in stock'}
              </div>
            </div>

            <!-- Add button â€” bottom right -->
            <button class="product-add-btn ${inCart?'added':''}" data-id="${item.id}"
              style="
                position:absolute;bottom:10px;right:10px;
                width:30px;height:30px;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);
                background:${inCart ? 'var(--teal-50)' : 'var(--accent)'};
                border:${inCart ? '1.5px solid var(--accent)' : 'none'};
                box-shadow:${inCart ? 'none' : '0 3px 8px rgba(13,148,136,0.35)'};
                cursor:pointer;
              ">
              ${inCart
                ? renderIcon('check', 14, 'var(--accent)')
                : renderIcon('plus', 14, '#fff')
              }
            </button>

            <!-- Cart quantity indicator (if in cart) -->
            ${inCart ? `
              <div style="
                position:absolute;top:8px;right:8px;
                background:var(--accent);color:#fff;
                font-size:0.6875rem;font-weight:800;
                border-radius:999px;padding:1px 6px;
                min-width:18px;text-align:center;
                box-shadow:0 1px 4px rgba(13,148,136,0.3);
              ">${inCart.qty}</div>
            ` : ''}
          </div>
        `
      }).join('')
    } else {
      el.innerHTML = `
        <div class="product-list">
          ${filtered.map(item => {
            const inCart     = cart.find(c => c.item.id === item.id)
            const outOfStock = Number(item.quantity) <= 0
            const price      = getItemPrice(item)
            return `
              <div class="product-row ${inCart?'in-cart':''} ${outOfStock?'out-of-stock':''}"
                data-id="${item.id}">
                <div class="product-row-check">
                  <div class="product-row-dot ${inCart?'active':''}"></div>
                </div>
                <div class="product-row-info">
                  <div class="product-row-name">${highlight(item.item_name, searchQuery)}</div>
                  <div class="product-row-meta">
                    ${item.category ? `<span>${item.category}</span>` : ''}
                    <span class="${outOfStock?'out-of-stock-text':'in-stock-text'}">
                      ${outOfStock ? 'Out of stock' : item.quantity + ' in stock'}
                    </span>
                  </div>
                </div>
                <div class="product-row-price">
                  ${price > 0 ? fmt(price) + ' ETB' : ''}
                </div>
                <button class="product-row-add ${inCart?'added':''}" data-id="${item.id}">
                  ${inCart ? renderIcon('check',14,'var(--accent)') : renderIcon('plus',14,'#fff')}
                </button>
              </div>
            `
          }).join('')}
        </div>
      `
    }

    container.querySelectorAll('[data-id].product-card, [data-id].product-row').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return
        const item = allItems.find(i => i.id === el.dataset.id)
        if (item) addToCart(item)
      })
    })

    container.querySelectorAll('.product-add-btn, .product-row-add').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const item = allItems.find(i => i.id === btn.dataset.id)
        if (item) addToCart(item)
      })
    })
  }

  // â”€â”€ Cart operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function addToCart(item) {
    const existing  = cart.find(c => c.item.id === item.id)
    const unitPrice = getItemPrice(item)

    if (existing) {
      existing.qty++
    } else {
      cart.push({ item, qty: 1, price: unitPrice })
    }

    renderCart()
    renderProducts()

    // On mobile auto-open sheet on first item
    if (isMobile() && cart.length === 1) {
      setTimeout(() => openCartSheet(), 300)
    }
  }

  function removeFromCart(itemId) {
    cart = cart.filter(c => c.item.id !== itemId)
    renderCart()
    renderProducts()
  }

  // â”€â”€ Render cart â€” desktop + mobile sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderCart() {
    renderDesktopCart()
    renderMobileSheet()
    updateTrigger()
  }

  function renderDesktopCart() {
    if (isMobile()) return

    const itemsEl    = container.querySelector('#cart-items')
    const totalsEl   = container.querySelector('#pos-totals')
    const checkoutEl = container.querySelector('#pos-checkout')
    const badge      = container.querySelector('#cart-badge')

    if (!cart.length) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          ${renderIcon('inventory', 32, 'var(--gray-300)')}
          <div style="margin-top:0.75rem;font-weight:500;color:var(--muted)">Cart is empty</div>
          <div style="font-size:0.8125rem;color:var(--gray-400);margin-top:0.25rem">
            Add products from the left
          </div>
        </div>
      `
      totalsEl.style.display   = 'none'
      checkoutEl.style.display = 'none'
      badge.style.display      = 'none'
      return
    }

    badge.style.display = 'inline-flex'
    badge.textContent   = cart.length

    itemsEl.innerHTML = cart.map(entry => {
      const cost   = Number(entry.item.unit_cost) || 0
      const isLoss = entry.price > 0 && cost > 0 && entry.price < cost
      const total  = entry.qty * entry.price

      return `
        <div class="cart-item" data-cart-id="${entry.item.id}" style="
          background:var(--bg-elevated);
          border:1px solid var(--border);
          border-radius:12px;padding:0.875rem;
          margin-bottom:0.5rem;
          transition:border-color 0.15s;
          ${isLoss ? 'border-color:#FECACA;background:var(--red-50);' : ''}
        ">
          <!-- Row 1: Name + remove -->
          <div style="display:flex;align-items:flex-start;
            justify-content:space-between;gap:0.5rem;margin-bottom:0.625rem">
            <div style="font-weight:600;font-size:0.9375rem;
              color:var(--dark);flex:1;min-width:0;
              line-height:1.3;">
              ${entry.item.item_name}
            </div>
            <button class="cart-remove" data-remove="${entry.item.id}"
              style="flex-shrink:0;margin-top:1px">
              ${renderIcon('close', 12)}
            </button>
          </div>

          <!-- Row 2: Qty control -->
          <div style="display:flex;align-items:center;
            justify-content:space-between;gap:0.75rem;margin-bottom:0.625rem">
            <div style="font-size:0.75rem;font-weight:600;
              color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">
              Qty
            </div>
            <div class="qty-control" style="flex-shrink:0">
              <button class="qty-btn" data-qty-dec="${entry.item.id}">-</button>
              <input type="number" class="qty-input" value="${entry.qty}"
                min="0.01" step="0.01" data-qty-input="${entry.item.id}"
                inputmode="decimal">
              <button class="qty-btn" data-qty-inc="${entry.item.id}">+</button>
            </div>
          </div>

          <!-- Row 3: Unit price + line total side by side -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
            <div>
              <div style="font-size:0.6875rem;font-weight:700;
                color:${isLoss?'var(--danger)':'var(--muted)'};
                text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px">
                Unit Price
              </div>
              <div class="price-input-wrap">
                <span class="price-prefix">ETB</span>
                <input type="number"
                  class="price-input ${isLoss?'price-loss':''}"
                  value="${entry.price}"
                  min="0" step="0.01"
                  data-price-input="${entry.item.id}"
                  inputmode="decimal">
              </div>
            </div>
            <div>
              <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
                text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px">
                Total
              </div>
              <div data-total-id="${entry.item.id}" style="
                height:38px;border-radius:8px;
                background:var(--bg-subtle);border:1px solid var(--border);
                display:flex;align-items:center;justify-content:flex-end;
                padding:0 0.625rem;
                font-size:0.9375rem;font-weight:700;
                color:${isLoss?'var(--danger)':'var(--dark)'};
              ">
                ${fmt(total)} <span style="font-size:0.6875rem;font-weight:600;
                  color:var(--muted);margin-left:3px">ETB</span>
              </div>
              <div data-margin-id="${entry.item.id}" style="font-size:0.75rem;font-weight:600;margin-top:4px;text-align:right">
                ${(()=>{
                  const p = total - (entry.qty*cost);
                  const m = total > 0 ? (p/total*100) : 0;
                  return p < 0 ? `<span style="color:var(--danger)">${fmt(p)} ETB (${m.toFixed(1)}%)</span>` : `<span style="color:#15803D">+${fmt(p)} ETB (${m.toFixed(1)}%)</span>`;
                })()}
              </div>
            </div>
          </div>

          ${isLoss ? `
            <div class="loss-warning" style="margin-top:0.5rem">
              ${renderIcon('alert',11)} Below cost (${fmt(cost)} ETB)
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    totalsEl.style.display   = 'block'
    checkoutEl.style.display = 'block'

    attachDesktopCartListeners()
    updateDesktopTotals()
  }

  function attachDesktopCartListeners() {
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.remove))
    })
    container.querySelectorAll('[data-qty-dec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = cart.find(c => c.item.id === btn.dataset.qtyDec)
        if (!entry) return
        entry.qty = Math.max(0.01, Math.round((entry.qty - 1) * 100) / 100)
        const inp = container.querySelector(`[data-qty-input="${entry.item.id}"]`)
        if (inp) inp.value = entry.qty
        updateLineTotal(entry.item.id)
        updateDesktopTotals()
      })
    })
    container.querySelectorAll('[data-qty-inc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = cart.find(c => c.item.id === btn.dataset.qtyInc)
        if (!entry) return
        entry.qty = Math.round((entry.qty + 1) * 100) / 100
        const inp = container.querySelector(`[data-qty-input="${entry.item.id}"]`)
        if (inp) inp.value = entry.qty
        updateLineTotal(entry.item.id)
        updateDesktopTotals()
      })
    })
    container.querySelectorAll('[data-qty-input]').forEach(inp => {
      const n = inp.cloneNode(true); inp.parentNode.replaceChild(n, inp)
      n.addEventListener('change', () => {
        const entry = cart.find(c => c.item.id === n.dataset.qtyInput)
        if (!entry) return
        const qClean = sanitizeNumericInput(n.value)
        if (n.value !== qClean) n.value = qClean
        entry.qty = Math.max(0.01, parseFloat(qClean) || 1)
        n.value = entry.qty
        updateLineTotal(entry.item.id)
        updateDesktopTotals()
      })
    })
    container.querySelectorAll('[data-price-input]').forEach(inp => {
      const n = inp.cloneNode(true); inp.parentNode.replaceChild(n, inp)
      n.addEventListener('input', () => {
        const entry = cart.find(c => c.item.id === n.dataset.priceInput)
        if (!entry) return
        const pClean = sanitizeNumericInput(n.value)
        if (n.value !== pClean) n.value = pClean
        entry.price = parseFloat(pClean) || 0
        updateLineTotal(entry.item.id)
        updateDesktopTotals()
        const cost   = Number(entry.item.unit_cost) || 0
        n.classList.toggle('price-loss', entry.price > 0 && cost > 0 && entry.price < cost)
      })
    })
  }

  function updateLineTotal(itemId) {
    const entry   = cart.find(c => c.item.id === itemId)
    if (!entry) return
    const totalEl = container.querySelector(`[data-total-id="${itemId}"]`)
    const cost    = Number(entry.item.unit_cost) || 0
    const total   = entry.qty * entry.price
    if (totalEl) totalEl.textContent = fmt(total) + ' ETB'
    const marginEl = container.querySelector(`[data-margin-id="${itemId}"]`)
    if (marginEl) {
      const p = total - (entry.qty * cost)
      const m = total > 0 ? (p/total*100) : 0
      marginEl.innerHTML = p < 0 ? `<span style="color:var(--danger)">${fmt(p)} ETB (${m.toFixed(1)}%)</span>` : `<span style="color:#15803D">+${fmt(p)} ETB (${m.toFixed(1)}%)</span>`
    }
  }

  function updateDesktopTotals() {
    const subtotal  = cart.reduce((s, e) => s + e.qty * e.price, 0)
    const discAmt   = subtotal * (discount / 100)
    const total     = subtotal - discAmt
    const totalCost = cart.reduce((s, e) => s + e.qty * (Number(e.item.unit_cost)||0), 0)
    const profit    = total - totalCost
    const margin    = total > 0 ? profit/total*100 : 0

    const set = (id, val) => { const el = container.querySelector(id); if (el) el.textContent = val }
    set('#tot-subtotal', fmt(subtotal) + ' ETB')
    set('#tot-discount', '-' + fmt(discAmt) + ' ETB')
    set('#tot-final',    fmt(total) + ' ETB')

    const pb = container.querySelector('#profit-bar')
    if (pb) {
      if (profit < 0) {
        pb.className = 'profit-bar loss'
        pb.innerHTML = `${renderIcon('alert',13)} Net loss of ${fmt(Math.abs(profit))} ETB (${margin.toFixed(1)}%)`
      } else if (margin < 10) {
        pb.className = 'profit-bar low'
        pb.innerHTML = `${renderIcon('alert',13)} Low margin: ${margin.toFixed(1)}% â€” ${fmt(profit)} ETB`
      } else {
        pb.className = 'profit-bar ok'
        pb.innerHTML = `${renderIcon('check',13)} ${margin.toFixed(1)}% margin â€” ${fmt(profit)} ETB`
      }
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Mobile sheet render Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function renderMobileSheet() {
    const sheetItems    = document.getElementById('sheet-items')
    const sheetCheckout = document.getElementById('sheet-checkout')
    const sheetBadge    = document.getElementById('sheet-badge')

    if (!sheetItems) return

    if (!cart.length) {
      sheetItems.innerHTML = `
        <div style="text-align:center;padding:2rem 1rem;color:var(--muted)">
          <div style="margin-bottom:0.75rem">${renderIcon('inventory', 32, 'var(--gray-300)')}</div>
          <div style="font-weight:500">Cart is empty</div>
          <div style="font-size:0.8125rem;margin-top:0.25rem;color:var(--gray-400)">
            Tap products to add them
          </div>
        </div>
      `
      if (sheetCheckout) sheetCheckout.style.display = 'none'
      if (sheetBadge)    sheetBadge.style.display    = 'none'
      return
    }

    if (sheetBadge) {
      sheetBadge.style.display = 'inline-flex'
      sheetBadge.textContent   = cart.length
    }

    sheetItems.innerHTML = cart.map(entry => {
      const cost   = Number(entry.item.unit_cost) || 0
      const isLoss = entry.price > 0 && cost > 0 && entry.price < cost
      const total  = entry.qty * entry.price

      return `
        <div style="
          display:flex;flex-direction:column;
          padding:12px;margin-bottom:8px;
          background:var(--bg-subtle);
          border:1px solid var(--border);
          border-radius:14px;
        " data-sheet-item="${entry.item.id}">
          <!-- Name + remove -->
          <div style="display:flex;align-items:center;
            justify-content:space-between;margin-bottom:10px">
            <div style="font-weight:600;font-size:0.9375rem;flex:1;
              min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${entry.item.item_name}
            </div>
            <button data-sheet-remove="${entry.item.id}" style="
              width:28px;height:28px;border-radius:50%;
              background:var(--red-50);
              display:flex;align-items:center;justify-content:center;
              color:var(--danger);border:none;cursor:pointer;
              flex-shrink:0;margin-left:8px;
            ">${renderIcon('close', 12, 'var(--danger)')}</button>
          </div>

          <!-- Qty + Price + Total in a row -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            <!-- Qty -->
            <div style="display:flex;flex-direction:column;gap:3px">
              <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
                text-transform:uppercase;letter-spacing:0.5px">QTY</div>
              <div style="display:flex;align-items:center;
                background:var(--bg-elevated);border:1px solid var(--border);
                border-radius:8px;overflow:hidden;height:40px">
                <button data-sheet-dec="${entry.item.id}"
                  style="width:32px;height:40px;display:flex;align-items:center;
                    justify-content:center;color:var(--muted);
                    font-size:1.125rem;border:none;background:none;cursor:pointer;
                    -webkit-tap-highlight-color:transparent;flex-shrink:0">-</button>
                <input type="number"
                  data-sheet-qty="${entry.item.id}"
                  value="${entry.qty}"
                  min="0.01" step="0.01" inputmode="decimal"
                  style="flex:1;border:none;text-align:center;font-size:0.9375rem;
                    font-weight:700;background:transparent;outline:none;
                    min-width:0;width:100%;color:var(--dark);
                    -moz-appearance:textfield;">
                <button data-sheet-inc="${entry.item.id}"
                  style="width:32px;height:40px;display:flex;align-items:center;
                    justify-content:center;color:var(--muted);
                    font-size:1.125rem;border:none;background:none;cursor:pointer;
                    -webkit-tap-highlight-color:transparent;flex-shrink:0">+</button>
              </div>
            </div>

            <!-- Price -->
            <div style="display:flex;flex-direction:column;gap:3px">
              <div style="font-size:0.6875rem;font-weight:700;
                color:${isLoss?'var(--danger)':'var(--muted)'};
                text-transform:uppercase;letter-spacing:0.5px">
                PRICE
              </div>
              <input type="number"
                data-sheet-price="${entry.item.id}"
                value="${entry.price > 0 ? entry.price : ''}"
                placeholder="0.00"
                min="0" step="0.01" inputmode="decimal"
                style="height:40px;border:1.5px solid ${isLoss?'var(--danger)':'var(--border)'};
                  border-radius:8px;text-align:center;
                  font-size:0.9375rem;font-weight:700;
                  color:${isLoss?'var(--danger)':'var(--accent)'};
                  background:var(--bg-elevated);outline:none;
                  width:100%;box-sizing:border-box;
                  -moz-appearance:textfield;
                  -webkit-user-select:text;user-select:text;">
            </div>

            <!-- Total -->
            <div style="display:flex;flex-direction:column;gap:3px">
              <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
                text-transform:uppercase;letter-spacing:0.5px">TOTAL</div>
              <div data-sheet-total="${entry.item.id}"
                style="height:40px;border-radius:8px;
                  background:var(--bg-hover);
                  display:flex;align-items:center;justify-content:center;
                  font-size:0.875rem;font-weight:700;color:var(--dark);
                  padding:0 6px;text-align:center;">
                ${fmt(total)}
              </div>
              <div data-sheet-margin="${entry.item.id}" style="font-size:0.6875rem;font-weight:600;margin-top:2px;text-align:center">
                ${(()=>{
                  const p = total - (entry.qty*cost);
                  const m = total > 0 ? (p/total*100) : 0;
                  return p < 0 ? `<span style="color:var(--danger)">${fmt(p)} ETB (${m.toFixed(0)}%)</span>` : `<span style="color:#15803D">+${fmt(p)} ETB (${m.toFixed(0)}%)</span>`;
                })()}
              </div>
            </div>
          </div>

          ${isLoss ? `
            <div style="display:flex;align-items:center;gap:4px;
              margin-top:8px;font-size:0.75rem;color:var(--danger);
              background:var(--red-50);padding:4px 8px;border-radius:6px;">
              ${renderIcon('alert',11,'var(--danger)')} Below cost (${fmt(cost)} ETB)
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    if (sheetCheckout) {
      sheetCheckout.style.display = 'block'
      updateSheetTotals()
    }

    attachSheetListeners()
  }

  function attachSheetListeners() {
    // Remove
    document.querySelectorAll('[data-sheet-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.sheetRemove))
    })

    // Dec
    document.querySelectorAll('[data-sheet-dec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = cart.find(c => c.item.id === btn.dataset.sheetDec)
        if (!entry) return
        if (entry.qty <= 1) { removeFromCart(entry.item.id); return }
        entry.qty = Math.max(0.01, Math.round((entry.qty - 1)*100)/100)
        const inp = document.querySelector(`[data-sheet-qty="${entry.item.id}"]`)
        if (inp) inp.value = entry.qty
        updateSheetLineTotal(entry.item.id)
        updateSheetTotals()
        if (!isMobile()) renderDesktopCart()
      })
    })

    // Inc
    document.querySelectorAll('[data-sheet-inc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = cart.find(c => c.item.id === btn.dataset.sheetInc)
        if (!entry) return
        entry.qty = Math.round((entry.qty + 1)*100)/100
        const inp = document.querySelector(`[data-sheet-qty="${entry.item.id}"]`)
        if (inp) inp.value = entry.qty
        updateSheetLineTotal(entry.item.id)
        updateSheetTotals()
        if (!isMobile()) renderDesktopCart()
      })
    })

    // Qty input
    document.querySelectorAll('[data-sheet-qty]').forEach(inp => {
      inp.addEventListener('change', () => {
        const entry = cart.find(c => c.item.id === inp.dataset.sheetQty)
        if (!entry) return
        entry.qty = Math.max(0.01, parseFloat(inp.value) || 1)
        inp.value = entry.qty
        updateSheetLineTotal(entry.item.id)
        updateSheetTotals()
        if (!isMobile()) renderDesktopCart()
      })
    })

    // Price input â€” no re-render, keyboard stays open
    document.querySelectorAll('[data-sheet-price]').forEach(inp => {
      inp.addEventListener('input', () => {
        const entry = cart.find(c => c.item.id === inp.dataset.sheetPrice)
        if (!entry) return
        entry.price = parseFloat(inp.value) || 0
        updateSheetLineTotal(entry.item.id)
        updateSheetTotals()
        if (!isMobile()) renderDesktopCart()
      })
    })
  }

  function updateSheetLineTotal(itemId) {
    const entry   = cart.find(c => c.item.id === itemId)
    if (!entry) return
    const total   = entry.qty * entry.price
    const totalEl = document.querySelector(`[data-sheet-total="${itemId}"]`)
    if (totalEl) totalEl.textContent = fmt(total)
    const marginEl = document.querySelector(`[data-sheet-margin="${itemId}"]`)
    if (marginEl) {
      const cost = Number(entry.item.unit_cost) || 0
      const p = total - (entry.qty * cost)
      const m = total > 0 ? (p/total*100) : 0
      marginEl.innerHTML = p < 0 ? `<span style="color:var(--danger)">${fmt(p)} ETB (${m.toFixed(0)}%)</span>` : `<span style="color:#15803D">+${fmt(p)} ETB (${m.toFixed(0)}%)</span>`
    }
  }

  function updateSheetTotals() {
    const subtotal  = cart.reduce((s, e) => s + e.qty * e.price, 0)
    const discAmt   = subtotal * (sheetDiscount / 100)
    const total     = subtotal - discAmt
    const totalCost = cart.reduce((s, e) => s + e.qty * (Number(e.item.unit_cost)||0), 0)
    const profit    = total - totalCost
    const margin    = total > 0 ? profit/total*100 : 0

    const set = id => { const el = document.getElementById(id); return el }
    const ss = set('sheet-subtotal');    if(ss) ss.textContent = fmt(subtotal) + ' ETB'
    const sd = set('sheet-discount-amt');if(sd) sd.textContent = '-' + fmt(discAmt) + ' ETB'
    const st = set('sheet-total');       if(st) st.textContent = fmt(total) + ' ETB'

    const pb = document.getElementById('sheet-profit-bar')
    if (pb) {
      if (profit < 0) {
        pb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;font-size:0.75rem;
          font-weight:600;color:#991B1B;background:var(--red-50);padding:6px 8px;
          border-radius:8px;">${renderIcon('alert',12)} Net loss of ${fmt(Math.abs(profit))} ETB (${margin.toFixed(1)}%)</div>`
      } else if (margin < 10) {
        pb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;font-size:0.75rem;
          font-weight:600;color:#92400E;background:var(--amber-50);padding:6px 8px;
          border-radius:8px;">${renderIcon('alert',12)} Low margin: ${margin.toFixed(1)}% â€” ${fmt(profit)} ETB</div>`
      } else {
        pb.innerHTML = `<div style="display:flex;align-items:center;gap:4px;font-size:0.75rem;
          font-weight:600;color:#15803D;background:var(--green-50);padding:6px 8px;
          border-radius:8px;">${renderIcon('check',12)} ${margin.toFixed(1)}% margin â€” ${fmt(profit)} ETB</div>`
      }
    }
  }

  // Update the trigger bar at bottom
  function updateTrigger() {
    if (!trigger) return
    if (!isMobile()) { trigger.style.display = 'none'; return }
    trigger.style.display = cart.length > 0 ? 'block' : 'none'

    const count = document.getElementById('mobile-cart-count')
    const total = document.getElementById('mobile-cart-total')
    if (count) {
      count.style.display = cart.length > 0 ? 'inline-block' : 'none'
      count.textContent   = cart.length
    }
    if (total) {
      const t = cart.reduce((s, e) => s + e.qty * e.price, 0)
      total.textContent = fmt(t) + ' ETB'
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Search Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  container.querySelector('#pos-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim()
    container.querySelector('#pos-search-clear').style.display = searchQuery ? '' : 'none'
    renderProducts()
  })
  container.querySelector('#pos-search-clear').addEventListener('click', () => {
    searchQuery = ''
    container.querySelector('#pos-search').value = ''
    container.querySelector('#pos-search-clear').style.display = 'none'
    renderProducts()
    container.querySelector('#pos-search').focus()
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ View toggle Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  container.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view
      localStorage.setItem('pos-view', viewMode)
      container.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view===viewMode))
      renderProducts()
    })
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Discount (desktop) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  container.querySelector('#discount-input')?.addEventListener('input', e => {
    discount = Math.min(100, Math.max(0, parseFloat(e.target.value)||0))
    updateDesktopTotals()
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Discount (mobile sheet) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  document.getElementById('sheet-discount')?.addEventListener('input', e => {
    sheetDiscount = Math.min(100, Math.max(0, parseFloat(e.target.value)||0))
    updateSheetTotals()
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Clear cart Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  container.querySelector('#btn-clear-cart')?.addEventListener('click', () => {
    if (!cart.length) return
    if (!confirm('Clear the entire cart?')) return
    cart = []; renderCart(); renderProducts()
  })
  document.getElementById('sheet-clear')?.addEventListener('click', () => {
    if (!cart.length) return
    if (!confirm('Clear the entire cart?')) return
    cart = []; renderCart(); renderProducts(); closeCartSheet()
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Payment method (desktop) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  container.querySelectorAll('.pay-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      paymentMethod = btn.dataset.pay
      container.querySelectorAll('.pay-method-btn').forEach(b => b.classList.toggle('active', b.dataset.pay===paymentMethod))
      container.querySelector('#credit-fields').style.display     = paymentMethod==='credit' ? 'block' : 'none'
      container.querySelector('#optional-customer').style.display = paymentMethod==='credit' ? 'none'  : 'block'
      updateAccountDropdowns()
    })
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Payment method (mobile sheet) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  document.querySelectorAll('.sheet-pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sheetPayMethod = btn.dataset.pay
      document.querySelectorAll('.sheet-pay-btn').forEach(b => {
        b.style.borderColor  = b.dataset.pay===sheetPayMethod ? 'var(--accent)' : 'var(--border)'
        b.style.background   = b.dataset.pay===sheetPayMethod ? 'var(--teal-50)' : 'var(--bg-elevated)'
        b.style.color        = b.dataset.pay===sheetPayMethod ? 'var(--accent)' : 'var(--muted)'
      })
      const cf = document.getElementById('sheet-credit-fields')
      if (cf) cf.style.display = sheetPayMethod==='credit' ? 'block' : 'none'
      updateAccountDropdowns()
    })
  })

  // Ã¢â€â‚¬Ã¢â€â‚¬ Sell (desktop) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function wireTransport(feeId, targaId, placeId, payRowId, yesId, noId) {
    const get = id => document.querySelector(id)
    const feeEl = get(feeId), payRow = get(payRowId), tpYes = get(yesId), tpNo = get(noId)
    if (feeEl) feeEl.addEventListener('input', e => {
      posTransport.fee = Number(e.target.value) || 0
      if (payRow) payRow.style.display = posTransport.fee > 0 ? 'block' : 'none'
    })
    const tEl = get(targaId)
    if (tEl) tEl.addEventListener('input', e => { posTransport.targa = e.target.value.toUpperCase() })
    const pEl = get(placeId)
    if (pEl) pEl.addEventListener('input', e => { posTransport.place = e.target.value })
    if (tpYes) tpYes.addEventListener('click', () => {
      posTransport.paidNow = true
      tpYes.style.borderColor = 'var(--accent)'; tpYes.style.background = 'var(--teal-50)'; tpYes.style.color = 'var(--accent)'
      if (tpNo) { tpNo.style.borderColor = 'var(--border)'; tpNo.style.background = 'var(--bg-elevated)'; tpNo.style.color = 'var(--muted)' }
    })
    if (tpNo) tpNo.addEventListener('click', () => {
      posTransport.paidNow = false
      tpNo.style.borderColor = 'var(--accent)'; tpNo.style.background = 'var(--teal-50)'; tpNo.style.color = 'var(--accent)'
      if (tpYes) { tpYes.style.borderColor = 'var(--border)'; tpYes.style.background = 'var(--bg-elevated)'; tpYes.style.color = 'var(--muted)' }
    })
  }
  wireTransport('#pos-transport-fee','#pos-transport-targa','#pos-transport-place','#pos-transport-pay-row','#pos-tp-yes','#pos-tp-no')
  wireTransport('#sheet-transport-fee','#sheet-transport-targa','#sheet-transport-place','#sheet-transport-pay-row','#sheet-tp-yes','#sheet-tp-no')

  container.querySelector('#btn-sell')?.addEventListener('click', () => handleSell({
    pmField:       '#pos-checkout .pay-method-btn.active',
    noteField:     '#sale-note',
    accountField:  '#sale-account',
    bulkField:     '#bulk-toggle',
    creditName:    '#credit-name',
    creditPhone:   '#credit-phone',
    getPayMethod:  () => paymentMethod,
    getAccountId:  () => posAccountId,
    getDiscount:   () => discount,
  }))

  // Ã¢â€â‚¬Ã¢â€â‚¬ Sell (mobile sheet) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  document.getElementById('sheet-sell')?.addEventListener('click', () => handleSell({
    noteField:     '#sheet-note',
    bulkField:     '#sheet-bulk',
    creditName:    '#sheet-credit-name',
    creditPhone:   '#sheet-credit-phone',
    getPayMethod:  () => sheetPayMethod,
    getAccountId:  () => sheetAccountId,
    getDiscount:   () => sheetDiscount,
    onSuccess:     closeCartSheet,
  }))

  async function handleSell({ noteField, bulkField, creditName, creditPhone, getPayMethod, getAccountId, getDiscount, onSuccess }) {
    if (!cart.length) { showToast('Add at least one product', 'error'); return }

    const pm        = getPayMethod()
    const disc      = getDiscount()
    const subtotal  = cart.reduce((s, e) => s + e.qty * e.price, 0)
    const discAmt   = subtotal * (disc / 100)
    const total     = subtotal - discAmt
    const isBulk    = document.querySelector(bulkField)?.checked
    const accountId = getAccountId ? getAccountId() : ''
    const note      = document.querySelector(noteField)?.value?.trim()
    const isCredit  = pm === 'credit'

    // Enhanced validation
    if (total <= 0) { showToast('Total amount must be greater than 0', 'error'); return }
    if (isCredit && !document.querySelector(creditName)?.value?.trim()) {
      showToast('Credit sales require a customer', 'error'); return
    }
    if (!isCredit && !accountId) {
      showToast('Please select a payment account', 'error'); return
    }

    const totalCost = cart.reduce((s, e) => s + e.qty * (Number(e.item.unit_cost)||0), 0)
    if (total < totalCost) {
      if (!confirm(`Ã¢Å¡Â Ã¯Â¸Â This sale results in a loss of ${fmt(totalCost - total)} ETB. Continue?`)) return
    }

    // Disable sell button
    const sellBtn = document.querySelector('#btn-sell') || document.querySelector('#sheet-sell')
    if (sellBtn) { sellBtn.textContent = 'Processing...'; sellBtn.disabled = true }

    try {
      const { data: sale, error: saleErr } = await supabase.from('sales').insert({
        store_id:        currentStore?.id,
        cash_account_id: isCredit ? null : (accountId||null),
        sale_date:       new Date().toISOString().split('T')[0],
        total_amount:    total,
        payment_method:  pm,
        source:          'manual',
        notes:           note || null,
        transport_fee:   posTransport.fee > 0 ? posTransport.fee : null,
        targa:           posTransport.targa || null,
        delivery_place:  posTransport.place || null,
      }).select().single()

      if (saleErr) throw saleErr

      for (const entry of cart) {
        await supabase.from('sale_items').insert({
          sale_id:            sale.id,
          item_id:            entry.item.id,
          item_name_snapshot: entry.item.item_name,
          quantity:           entry.qty,
          unit_price:         entry.price,
        })
        if (!isBulk) {
          await supabase.from('stock_movements').insert({
            store_id:      currentStore?.id,
            item_id:       entry.item.id,
            movement_type: 'out',
            quantity:      entry.qty,
            source:        'sale',
            reference_id:  sale.id,
          })
        }
      }

      await audit.salecompleted(sale, cart.map(e => ({ name:e.item.item_name, qty:e.qty, price:e.price })))

      if (isCredit) {
        const custName  = document.querySelector(creditName)?.value?.trim()
        const custPhone = document.querySelector(creditPhone)?.value?.trim() || null
        let customer    = customers.find(c => c.name.toLowerCase() === custName.toLowerCase())
        if (!customer) {
          const { data } = await supabase.from('customers').insert({
            store_id: currentStore?.id, name: custName, phone: custPhone,
          }).select().single()
          customer = data; customers.push(customer)
        }
        await supabase.from('credit_sales').insert({
          store_id: currentStore?.id, sale_id: sale.id,
          customer_id: customer.id, amount_owed: total, status: 'unpaid',
        })
      }

      if (posTransport.fee > 0) {
        await supabase.from('transport_fees').insert({
          store_id:             currentStore?.id,
          entity_type:          'sale',
          entity_id:            sale.id,
          amount:               posTransport.fee,
          paid_now:             posTransport.paidNow,
          paid_from_account_id: posTransport.paidNow ? (accountId||null) : null,
          charge_customer:      false,
        })
        if (posTransport.paidNow) {
          await supabase.from('expenses').insert({
            store_id:        currentStore?.id,
            cash_account_id: accountId||null,
            expense_date:    new Date().toISOString().split('T')[0],
            amount:          posTransport.fee,
            category:        'transport_fee',
            description:     'Transport fee (POS sale)',
            source:          'manual',
          })
        } else {
          await supabase.from('vendor_debts').insert({
            store_id:    currentStore?.id,
            vendor_name: 'Transport Driver',
            amount_owed: posTransport.fee,
            amount_paid: 0,
            status:      'unpaid',
            notes:       'Transport fee from POS sale',
          })
        }
      }

      try {
        await postSaleEntry({ storeId:currentStore?.id, saleId:sale.id, date:new Date().toISOString().split('T')[0], amount:total, isCredit })
      } catch(e) { console.warn('Journal:', e.message) }

      if (onSuccess) onSuccess()
      showSaleSuccess(total, cart.length, sale.id)

      // Check inventory resolution in background
      const saleItemsForCheck = cart.map(e => ({
        item_name_snapshot: e.item.item_name,
        quantity:           e.qty,
        unit_price:         e.price,
      }))
      const storeId = currentStore?.id

      setTimeout(async () => {
        const resolutions = await checkSaleAgainstInventory(saleItemsForCheck, storeId)
        if (resolutions.length > 0) {
          openInventoryResolverModal(resolutions, sale.id, () => {
            // Refresh inventory after resolution
            getInventory().then(fresh => { allItems = fresh || []; renderProducts() })
          })
        }
      }, 1500) // wait 1.5s so success screen is visible first

      posTransport = { fee: 0, targa: '', place: '', paidNow: true }
      cart = []; renderCart(); renderProducts()
      invalidateAfterSale()
      const fresh = await getInventory()
      allItems = fresh || []; renderProducts()

    } catch(err) {
      console.error('Sale error:', err)
      showToast(`Sale failed: ${err.message}`, 'error')
    } finally {
      const b1 = container.querySelector('#btn-sell')
      const b2 = document.querySelector('#sheet-sell')
      if (b1) { b1.innerHTML = `${renderIcon('check',18)} Complete Sale`; b1.disabled = false }
      if (b2) { b2.innerHTML = `${renderIcon('check',20)} Complete Sale`; b2.disabled = false }
    }
  }

  function showSaleSuccess(total, itemCount, saleId) {
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.4);
      backdrop-filter:blur(8px);
      z-index:400;
      display:flex;align-items:center;justify-content:center;padding:1rem;`
    overlay.innerHTML = `
      <div style="background:var(--bg-elevated);border-radius:24px;padding:2.5rem 2rem;
        text-align:center;max-width:320px;width:100%;box-shadow:var(--shadow-lg);
        animation:sale-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);">
        <div style="width:64px;height:64px;background:var(--teal-50);border-radius:50%;
          display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
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
          <button style="width:100%;padding:0.75rem;background:var(--bg-subtle);
            color:var(--dark);border-radius:14px;font-weight:600;cursor:pointer;
            border:1.5px solid var(--border);display:flex;align-items:center;
            justify-content:center;gap:0.5rem;" id="btn-view-receipt">
            ${renderIcon('reports', 16)} Receipt & Share
          </button>
          <button class="btn btn-primary" id="success-close" style="width:100%;padding:0.75rem;
            background:var(--accent);color:#fff;border-radius:14px;font-weight:600;cursor:pointer;border:none;">
            New Sale
          </button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    overlay.querySelector('#btn-view-receipt').addEventListener('click', () => { overlay.remove(); openReceiptModal(saleId) })
    overlay.querySelector('#success-close').addEventListener('click', () => overlay.remove())
    setTimeout(() => { if (document.body.contains(overlay)) overlay.remove() }, 6000)
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Smart payment UI Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function renderPOSPaymentUI(prefix) {
    const isSheet  = prefix === 'sheet'
    const pm       = isSheet ? sheetPayMethod : paymentMethod
    const accId    = isSheet ? sheetAccountId : posAccountId
    const tills    = accounts.filter(a => a.account_type === 'till')
    const banks    = accounts.filter(a => a.account_type === 'bank')
    return `
      <div style="display:flex;gap:0.375rem;flex-wrap:wrap;margin-bottom:0.375rem">
        ${['cash','credit'].map(p => `
          <button data-pay="${p}" class="${prefix}-pay-btn" style="
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
              ? tills.map(a => `<button data-till="${a.id}" class="${prefix}-till-btn" style="
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
        ${banks.map(a => `<button data-bank="${a.id}" class="${prefix}-bank-btn" style="
          padding:0.3rem 0.875rem;border-radius:var(--radius-pill);
          font-size:0.8125rem;font-weight:600;cursor:pointer;
          border:1.5px solid ${pm==='bank_transfer'&&accId===a.id?'var(--accent)':'var(--border)'};
          background:${pm==='bank_transfer'&&accId===a.id?'var(--teal-50)':'var(--bg-elevated)'};
          color:${pm==='bank_transfer'&&accId===a.id?'var(--accent)':'var(--muted)'};
        ">${a.bank_name||a.account_name}</button>`).join('')}
        <button id="${prefix}-add-bank-btn" style="
          width:26px;height:26px;border-radius:50%;
          background:var(--bg-subtle);color:var(--muted);
          display:flex;align-items:center;justify-content:center;
          border:1px solid var(--border);cursor:pointer;font-size:1rem;font-weight:700;flex-shrink:0;
        " title="Add bank account">+</button>
      </div>
    `
  }

  function injectPaymentUI(prefix) {
    const isSheet = prefix === 'sheet'
    const section = isSheet
      ? document.getElementById('sheet-payment-section')
      : container.querySelector('#pos-payment-section')
    if (!section) return
    section.innerHTML = renderPOSPaymentUI(prefix)

    section.querySelectorAll(`.${prefix}-pay-btn`).forEach(b => b.addEventListener('click', () => {
      const p = b.dataset.pay
      if (isSheet) {
        sheetPayMethod = p
        if (p === 'cash') sheetAccountId = accounts.find(a => a.account_type==='till')?.id || ''
        else if (p === 'credit') sheetAccountId = ''
        const cf = document.getElementById('sheet-credit-fields')
        if (cf) cf.style.display = p==='credit' ? 'block' : 'none'
      } else {
        paymentMethod = p
        if (p === 'cash') posAccountId = accounts.find(a => a.account_type==='till')?.id || ''
        else if (p === 'credit') posAccountId = ''
        const cf = container.querySelector('#credit-fields')
        const oc = container.querySelector('#optional-customer')
        if (cf) cf.style.display = p==='credit' ? 'block' : 'none'
        if (oc) oc.style.display = p==='credit' ? 'none'  : 'block'
      }
      injectPaymentUI(prefix)
    }))

    section.querySelectorAll(`.${prefix}-till-btn`).forEach(b => b.addEventListener('click', () => {
      if (isSheet) sheetAccountId = b.dataset.till
      else posAccountId = b.dataset.till
      injectPaymentUI(prefix)
    }))

    section.querySelectorAll(`.${prefix}-bank-btn`).forEach(b => b.addEventListener('click', () => {
      if (isSheet) { sheetPayMethod = 'bank_transfer'; sheetAccountId = b.dataset.bank }
      else { paymentMethod = 'bank_transfer'; posAccountId = b.dataset.bank }
      injectPaymentUI(prefix)
    }))

    section.querySelector(`#${prefix}-add-bank-btn`)?.addEventListener('click', () => openPOSAddBankModal(prefix))
  }

  async function openPOSAddBankModal(prefix) {
    const ov = document.createElement('div')
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:500;padding:1rem;'
    const bm = document.createElement('div')
    bm.style.cssText = 'background:var(--bg-elevated);border-radius:16px;width:100%;max-width:400px;box-shadow:var(--shadow-lg);border:1px solid var(--border);overflow:hidden;'
    bm.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;background:var(--dark);">
        <div style="font-weight:700;color:#fff;font-size:0.9375rem">Add Bank Account</div>
        <button id="bm-close" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);cursor:pointer;border:none;">${renderIcon('close',14)}</button>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:0.875rem">
        <div><label class="form-label">Account Name *</label><input class="form-input" id="bm-name" placeholder="e.g. CBE Account"></div>
        <div><label class="form-label">Type</label>
          <select class="form-input" id="bm-type">
            <option value="till">ðŸª Till (Cash in store)</option>
            <option value="bank">ðŸ¦ Bank Account</option>
          </select>
        </div>
        <div id="bm-bank-fields" style="display:none;flex-direction:column;gap:0.625rem">
          <div><label class="form-label">Bank Name</label><input class="form-input" id="bm-bank-name" placeholder="e.g. Commercial Bank of Ethiopia"></div>
          <div><label class="form-label">Account Number</label><input class="form-input" id="bm-acc-num" placeholder="e.g. 1000123456789"></div>
        </div>
        <div><label class="form-label">Opening Balance (ETB)</label><input class="form-input" type="number" id="bm-balance" value="0" min="0" step="0.01" inputmode="decimal"></div>
        <div style="display:flex;gap:0.625rem;margin-top:0.25rem">
          <button class="btn btn-outline" id="bm-cancel" style="flex:1;justify-content:center">Cancel</button>
          <button class="btn btn-primary" id="bm-save" style="flex:2;justify-content:center">Save Account</button>
        </div>
      </div>`
    ov.appendChild(bm); document.body.appendChild(ov)
    const close = () => ov.remove()
    bm.querySelector('#bm-close').addEventListener('click', close)
    bm.querySelector('#bm-cancel').addEventListener('click', close)
    ov.addEventListener('click', e => { if (e.target===ov) close() })
    const typeSelect = bm.querySelector('#bm-type')
    const bankFields = bm.querySelector('#bm-bank-fields')
    typeSelect.addEventListener('change', () => { bankFields.style.display = typeSelect.value==='bank' ? 'flex' : 'none' })
    bm.querySelector('#bm-save').addEventListener('click', async () => {
      const name = bm.querySelector('#bm-name').value.trim()
      if (!name) { showToast('Account name is required','error'); return }
      const type = typeSelect.value
      const saveBtn = bm.querySelector('#bm-save')
      saveBtn.textContent = 'Saving...'; saveBtn.disabled = true
      const { data: na, error } = await supabase.from('cash_accounts').insert({
        store_id: currentStore?.id, account_name: name, account_type: type,
        balance: Number(bm.querySelector('#bm-balance').value)||0,
        bank_name: type==='bank' ? (bm.querySelector('#bm-bank-name').value.trim()||null) : null,
        account_number: type==='bank' ? (bm.querySelector('#bm-acc-num').value.trim()||null) : null,
      }).select('id,account_name,account_type,bank_name').single()
      if (error) { showToast('Failed: '+error.message,'error'); saveBtn.textContent='Save Account'; saveBtn.disabled=false; return }
      accounts.push(na)
      if (prefix==='sheet') { sheetPayMethod = na.account_type==='bank'?'bank_transfer':'cash'; sheetAccountId = na.id }
      else { paymentMethod = na.account_type==='bank'?'bank_transfer':'cash'; posAccountId = na.id }
      showToast('Account created','success'); close(); injectPaymentUI(prefix)
    })
  }

  injectPaymentUI('pos')
  injectPaymentUI('sheet')

  renderCategories()
  renderProducts()
  renderCart()
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const PAY_LABELS = {
  cash:'Cash', bank_transfer:'Bank', telebirr:'Telebirr',
  cbe_birr:'CBE Birr', credit:'Credit', other:'Other',
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET',{minimumFractionDigits:2,maximumFractionDigits:2})
}

function highlight(text, query) {
  if (!query || !text) return text || ''
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${escaped})`, 'gi'),
    `<mark style="background:var(--teal-200);color:var(--teal-900);border-radius:2px;padding:0 1px">$1</mark>`)
}

function showToast(msg, type='info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`; t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-container'; document.body.appendChild(wrap) }
  wrap.appendChild(t); setTimeout(() => t.remove(), 3500)
}

function injectPOSStyles() {
  if (document.getElementById('pos-styles')) return
  const style = document.createElement('style')
  style.id = 'pos-styles'
  style.textContent = `
    @keyframes sale-pop { from{transform:scale(0.8);opacity:0} to{transform:scale(1);opacity:1} }

    .pos-layout {
      display: grid;
      grid-template-columns: 1fr 420px;
      gap: 1.25rem;
      /* No fixed height â€” use min-height so it can grow */
      min-height: calc(100vh - 6rem);
      align-items: start;
    }
    .pos-left { display:flex;flex-direction:column;min-height:0;overflow:hidden; }
    .pos-right {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .pos-search-wrap { margin-bottom:0.875rem; }
    .pos-search-inner { display:flex;align-items:center;gap:0.5rem;background:var(--bg-elevated);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:0.5rem 0.875rem;transition:border-color 0.15s,box-shadow 0.15s; }
    .pos-search-inner:focus-within { border-color:var(--accent);box-shadow:0 0 0 3px rgba(13,148,136,0.1); }
    .pos-search-input { flex:1;border:none;outline:none;background:transparent;font-size:0.9375rem;color:var(--dark); }
    .pos-search-clear { color:var(--muted);padding:2px;border-radius:50%;display:flex;transition:all 0.15s; }
    .pos-search-clear:hover { background:var(--bg-hover);color:var(--dark); }

    .view-toggle { display:flex;background:var(--bg-subtle);border-radius:var(--radius);padding:2px;gap:2px; }
    .view-btn { padding:0.3rem 0.5rem;border-radius:var(--radius-sm);color:var(--muted);transition:all 0.15s;display:flex;align-items:center; }
    .view-btn.active { background:var(--bg-elevated);color:var(--accent);box-shadow:var(--shadow-xs); }

    .pos-categories { display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.875rem; }
    .cat-chip { padding:0.3rem 0.875rem;border-radius:var(--radius-pill);font-size:0.8125rem;font-weight:600;border:1.5px solid var(--border);background:var(--bg-elevated);color:var(--muted);cursor:pointer;transition:all 0.15s;white-space:nowrap; }
    .cat-chip:hover { border-color:var(--accent);color:var(--accent); }
    .cat-chip.active { background:var(--teal-50);border-color:var(--accent);color:var(--accent); }

    .pos-products { flex:1;overflow-y:auto;padding-right:2px; }
    .pos-products.grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:0.875rem;align-content:start; }
    .pos-products.list { display:flex;flex-direction:column; }
    .products-empty { grid-column:1/-1;text-align:center;padding:3rem 1.5rem;display:flex;flex-direction:column;align-items:center; }

    .product-card:hover { border-color:var(--accent) !important;box-shadow:var(--shadow-sm);transform:translateY(-2px); }
    .product-add-btn:hover { transform:scale(1.15) !important; }

    .product-list { display:flex;flex-direction:column;gap:1px; }
    .product-row { display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.75rem;border-radius:var(--radius);cursor:pointer;transition:all 0.15s; }
    .product-row:hover { background:var(--bg-subtle); }
    .product-row.in-cart { background:var(--teal-50); }
    .product-row.out-of-stock { opacity:0.5;pointer-events:none; }
    .product-row-check { width:16px;display:flex;align-items:center;flex-shrink:0; }
    .product-row-dot { width:8px;height:8px;border-radius:50%;border:1.5px solid var(--border);transition:all 0.15s; }
    .product-row-dot.active { background:var(--accent);border-color:var(--accent); }
    .product-row-info { flex:1;min-width:0; }
    .product-row-name { font-size:0.875rem;font-weight:600;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .product-row-meta { display:flex;gap:0.5rem;font-size:0.75rem;color:var(--muted);margin-top:1px;flex-wrap:wrap; }
    .in-stock-text { color:var(--success);font-weight:600; }
    .out-of-stock-text { color:var(--danger);font-weight:600; }
    .product-row-price { font-size:0.9375rem;font-weight:700;color:var(--accent);white-space:nowrap; }
    .product-row-add { width:26px;height:26px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1); }
    .product-row-add.added { background:var(--teal-50);border:1.5px solid var(--accent); }

    .pos-cart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.125rem;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 5;
      background: var(--bg-elevated);
      flex-shrink: 0;
    }
    .cart-count { background:var(--accent);color:#fff;font-size:0.6875rem;font-weight:700;border-radius:999px;padding:1px 6px; }
    .pos-cart-items {
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0.75rem;
      /* No flex:1 â€” let content determine height */
    }
    .cart-empty { display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:160px;padding:2rem; }
    .cart-item { background:var(--bg-subtle);border-radius:var(--radius-lg);padding:0.75rem;margin-bottom:0.625rem;border:1px solid var(--border); }
    .cart-item-top { display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem; }
    .cart-item-name { font-size:0.875rem;font-weight:600;color:var(--dark);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .cart-remove { color:var(--muted);padding:3px;border-radius:50%;display:flex;flex-shrink:0;transition:all 0.15s; }
    .cart-remove:hover { background:var(--red-50);color:var(--danger); }
    .cart-item-controls { display:flex;align-items:center;gap:0.5rem; }
    .qty-control { display:flex;align-items:center;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden; }
    .qty-btn { padding:0.3rem 0.5rem;font-size:1rem;font-weight:500;color:var(--muted);transition:all 0.15s;line-height:1; }
    .qty-btn:hover { background:var(--bg-hover);color:var(--dark); }
    .qty-input { width:44px;border:none;text-align:center;font-size:0.875rem;font-weight:600;background:transparent;outline:none;color:var(--dark);padding:0.3rem 0;-moz-appearance:textfield; }
    .qty-input::-webkit-outer-spin-button,.qty-input::-webkit-inner-spin-button { -webkit-appearance:none; }
    .price-input-wrap { display:flex;align-items:center;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;flex:1;min-width:0; }
    .price-prefix { font-size:0.75rem;color:var(--muted);padding:0 0.375rem;white-space:nowrap; }
    .price-input { flex:1;border:none;outline:none;background:transparent;font-size:0.875rem;font-weight:600;color:var(--accent);padding:0.35rem 0.375rem 0.35rem 0;min-width:0;-moz-appearance:textfield;-webkit-user-select:text;user-select:text; }
    .price-input.price-loss { color:var(--danger); }
    .price-input::-webkit-outer-spin-button,.price-input::-webkit-inner-spin-button { -webkit-appearance:none; }
    .cart-line-total { font-size:0.875rem;font-weight:700;color:var(--dark);white-space:nowrap;min-width:70px;text-align:right; }
    .loss-warning { display:flex;align-items:center;gap:0.3rem;font-size:0.75rem;color:var(--danger);margin-top:0.4rem;background:var(--red-50);padding:0.3rem 0.5rem;border-radius:var(--radius-sm); }

    .pos-totals {
      padding: 0.875rem 1.125rem;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .total-row { display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0;font-size:0.875rem; }
    .total-label { display:flex;align-items:center;gap:0.35rem;color:var(--muted); }
    .total-val { font-weight:600;color:var(--dark); }
    .total-divider { border:none;border-top:1px solid var(--border);margin:0.4rem 0; }
    .total-final { font-size:1rem;font-weight:700;color:var(--dark); }
    .inline-input { width:44px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:1px 4px;font-size:0.8125rem;text-align:center;outline:none;background:var(--bg-elevated); }
    .inline-input:focus { border-color:var(--accent); }
    .profit-bar { display:flex;align-items:center;gap:0.3rem;font-size:0.75rem;font-weight:600;padding:0.35rem 0.5rem;border-radius:var(--radius);margin-top:0.5rem; }
    .profit-bar.ok   { background:var(--green-50);color:#15803D; }
    .profit-bar.low  { background:var(--amber-50);color:#92400E; }
    .profit-bar.loss { background:var(--red-50);  color:#991B1B; }
    .pos-checkout {
      padding: 0.875rem 1.125rem 1.25rem;
      border-top: 1px solid var(--border);
      background: var(--bg-subtle);
      flex-shrink: 0;
    }
    .pay-methods { display:flex;gap:0.375rem;flex-wrap:wrap; }
    .pay-method-btn { padding:0.3rem 0.75rem;border-radius:var(--radius-pill);font-size:0.8125rem;font-weight:600;border:1.5px solid var(--border);background:var(--bg-elevated);color:var(--muted);cursor:pointer;transition:all 0.15s;white-space:nowrap; }
    .pay-method-btn:hover { border-color:var(--accent);color:var(--accent); }
    .pay-method-btn.active { background:var(--teal-50);border-color:var(--accent);color:var(--accent); }
    .credit-banner { display:flex;align-items:center;gap:0.4rem;font-size:0.8125rem;font-weight:600;color:#92400E;background:var(--amber-50);border:1px solid #FDE68A;border-radius:var(--radius);padding:0.5rem 0.75rem; }
    .optional-summary { font-size:0.8125rem;color:var(--muted);cursor:pointer;padding:0.25rem 0;font-weight:500;user-select:none; }
    .btn-sell { width:100%;justify-content:center;padding:0.75rem;font-size:0.9375rem;border-radius:var(--radius-lg);gap:0.5rem; }

    /* Mobile cart trigger bar */
    #mobile-cart-trigger {
      display: none;
      position: fixed;
      bottom: calc(var(--mobile-nav-total, 70px) + 8px);
      left: 12px;
      right: 12px;
      z-index: 220;
    }

    #mobile-cart-trigger button {
      width: 100%;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 16px;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(13,148,136,0.35);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    #mobile-cart-trigger button:active {
      transform: scale(0.97);
    }

    /* Sheet qty input */
    [data-sheet-qty]::-webkit-inner-spin-button,
    [data-sheet-qty]::-webkit-outer-spin-button { -webkit-appearance: none; }
    [data-sheet-price]::-webkit-inner-spin-button,
    [data-sheet-price]::-webkit-outer-spin-button { -webkit-appearance: none; }

    @media (max-width: 768px) {
      .pos-layout { display:flex !important;flex-direction:column !important;height:auto !important;max-height:none !important;gap:0 !important; }
      .pos-left { overflow:visible !important;padding-bottom:120px !important; }
      .pos-right { display:none !important; }
      .pos-products { overflow:visible !important;max-height:none !important; }
      .pos-products.grid { grid-template-columns:repeat(2,1fr) !important; }
      #mobile-cart-trigger { display:block; }
    }
  `
  document.head.appendChild(style)
}
