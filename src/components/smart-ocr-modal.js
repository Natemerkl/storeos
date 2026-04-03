// smart-ocr-modal.js — Complete rewrite for correct DOM injection
import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'

/**
 * Opens the Smart OCR Review modal.
 * 
 * @param {Object} params
 * @param {string} params.rawText - Raw CoT transcription
 * @param {Object} params.parsedData - The parsed_data object from backend (SOURCE OF TRUTH)
 * @param {string} params.sourceImage - Base64 data URL of scanned image
 * @param {Array} params.inventory - Local inventory array for display hints only
 * @param {Array} params.customers - Local customers array for display hints only
 */
export function openSmartOcrModal({ rawText, parsedData, sourceImage, inventory = [], customers = [], accounts = [], logId = null }) {

  // ============================================================
  // STEP 0: Deep-clone parsedData so we never mutate the original
  // ============================================================
  const data = JSON.parse(JSON.stringify(parsedData))

  console.log('[SmartOCR Modal] Opening with data:', {
    vendor: data.vendor,
    customer: data.customer_name,
    date: data.date,
    lineItems: data.line_items?.length,
    transportFee: data.transport_fee,
    total: data.total
  })

  // ============================================================
  // STEP 1: Remove any existing modal
  // ============================================================
  const existingModal = document.getElementById('smart-ocr-modal')
  if (existingModal) existingModal.remove()

  // ============================================================
  // STEP 2: Build the modal HTML
  // ============================================================
  const modal = document.createElement('div')
  modal.id = 'smart-ocr-modal'
  modal.className = 'smart-ocr-modal-overlay'
  modal.innerHTML = buildModalHTML(data, inventory, customers, accounts)
  document.body.appendChild(modal)

  // ============================================================
  // STEP 3: Attach all event listeners
  // ============================================================
  attachEventListeners(modal, data, inventory, customers, accounts, logId)

  // ============================================================
  // STEP 4: Calculate initial totals
  // ============================================================
  recalculateTotals(modal, data)

  // Lock body scroll to prevent background scrolling on mobile
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.width = '100%'
  document.body.style.top = `-${window.scrollY}px`

  // Animate in
  requestAnimationFrame(() => modal.classList.add('active'))
}


// ================================================================
//  HTML BUILDERS
// ================================================================

function buildModalHTML(data, inventory, customers, accounts = []) {
  const lineItemsHTML = buildLineItemsHTML(data.line_items, inventory)
  const transportFeeValue = parseFloat(data.transport_fee || data.transport?.amount) || 0
  const customerName = data.customer_name || data.customer_header?.name || ''
  const vendor = data.vendor || ''
  const date = data.date || new Date().toISOString().split('T')[0]
  const plateNumber = data.plate_number || data.customer_header?.targa || ''
  const notes = data.notes || ''
  const detectedBank = data.payment_bank || data.payment_method || null
  const needsReview = data.column_detection?.needs_review || false

  // Build account options from real saved accounts
  const tillAccounts = accounts.filter(a => a.account_type === 'till')
  const bankAccounts = accounts.filter(a => a.account_type === 'bank')

  // Pre-select: if AI detected a bank name, try to match it
  let defaultAccountId = tillAccounts[0]?.id || bankAccounts[0]?.id || ''
  if (detectedBank && bankAccounts.length) {
    const match = bankAccounts.find(a =>
      (a.bank_name || a.account_name || '').toLowerCase().includes(detectedBank.toLowerCase())
    )
    if (match) defaultAccountId = match.id
  }

  const accountOptionsHTML = accounts.length
    ? [
        ...tillAccounts.map(a => `<option value="${a.id}" data-type="till" ${defaultAccountId === a.id ? 'selected' : ''}>${escapeHTML(a.account_name)} (Cash)</option>`),
        ...bankAccounts.map(a => `<option value="${a.id}" data-type="bank" ${defaultAccountId === a.id ? 'selected' : ''}>${escapeHTML(a.bank_name || a.account_name)} (Bank)</option>`),
        `<option value="credit" data-type="credit">Credit (no deduction)</option>`,
      ].join('')
    : `<option value="cash">Cash</option>
       <option value="bank_transfer">Bank Transfer</option>
       <option value="credit">Credit</option>`

  return `
    <div class="smart-ocr-modal-content">
      <!-- Header -->
      <div class="smart-ocr-modal-header">
        <div>
          <h2>Smart OCR Review</h2>
          <p class="smart-ocr-subtitle">Confirm extracted data before saving</p>
        </div>
        <button class="smart-ocr-close-btn" id="ocr-modal-close">&times;</button>
      </div>

      ${needsReview ? `
        <div class="smart-ocr-warning-banner">
          &#9888; Column alignment was uncertain. Please verify all quantities and prices.
        </div>
      ` : ''}

      <!-- Scrollable Body -->
      <div class="smart-ocr-modal-body">

        <!-- Mode Selector -->
        <div class="smart-ocr-mode-selector">
          <button class="smart-ocr-mode-btn active" data-mode="sale">&#128722; Sale</button>
          <button class="smart-ocr-mode-btn" data-mode="expense">&#128179; Expense</button>
          <button class="smart-ocr-mode-btn" data-mode="inventory">&#128230; Inventory</button>
        </div>

        <!-- Meta Section -->
        <div class="smart-ocr-meta-section">
          <div class="smart-ocr-meta-row">
            <div class="smart-ocr-field" style="position: relative;">
              <label>Customer Name</label>
              <input type="text" id="ocr-customer-name" value="${escapeHTML(customerName)}" placeholder="Customer name" autocomplete="off">
              <div id="ocr-customer-autocomplete" class="smart-ocr-autocomplete"></div>
              ${data.matched_customer_id ? `<span class="smart-ocr-match-badge">&#10003; Matched</span>` : `<span class="smart-ocr-no-match">No customer match</span>`}
              <input type="hidden" id="ocr-matched-customer-id" value="${data.matched_customer_id || ''}">
            </div>
            <div class="smart-ocr-field" style="position: relative;">
              <label>Plate Number</label>
              <input type="text" id="ocr-plate-number" value="${escapeHTML(plateNumber)}" placeholder="Vehicle plate" autocomplete="off">
              <div id="ocr-plate-autocomplete" class="smart-ocr-autocomplete"></div>
            </div>
          </div>
          <div class="smart-ocr-meta-row">
            <div class="smart-ocr-field" style="position: relative;">
              <label>Vendor / Supplier</label>
              <input type="text" id="ocr-vendor" value="${escapeHTML(vendor)}" placeholder="Vendor" autocomplete="off">
              <div id="ocr-vendor-autocomplete" class="smart-ocr-autocomplete"></div>
            </div>
            <div class="smart-ocr-field">
              <label>Date</label>
              <input type="date" id="ocr-date" value="${date}">
            </div>
          </div>
          <div class="smart-ocr-meta-row">
            <div class="smart-ocr-field">
              <label>Payment Account</label>
              <select id="ocr-payment-method">
                ${accountOptionsHTML}
              </select>
              ${accounts.length === 0 ? `<span style="font-size:11px;color:#e67e22">No accounts found — add one in Settings</span>` : ''}
            </div>
            <div class="smart-ocr-field">
              <label>Notes / Reference</label>
              <input type="text" id="ocr-notes" value="${escapeHTML(notes)}" placeholder="Ref #">
            </div>
          </div>
        </div>

        <!-- Line Items Section -->
        <div class="smart-ocr-section-header">
          <h3>Line Items</h3>
          <button class="smart-ocr-add-row-btn" id="ocr-add-row">+ Add Row</button>
        </div>

        <div id="ocr-line-items-container">
          ${lineItemsHTML}
        </div>

        <!-- Transport Fee Section (SEPARATE from line items) -->
        <div class="smart-ocr-transport-section">
          <div class="smart-ocr-transport-row">
            <label>Transport Fee (tewezeder)</label>
            <div class="smart-ocr-transport-input-wrap">
              <input type="number" id="ocr-transport-fee" value="${transportFeeValue}" min="0" step="1" class="smart-ocr-number-input">
              <span class="smart-ocr-currency">ETB</span>
            </div>
          </div>
        </div>

        <!-- Totals Section -->
        <div class="smart-ocr-totals-section">
          <div class="smart-ocr-total-row">
            <span>Goods Subtotal</span>
            <span id="ocr-goods-subtotal">0.00 ETB</span>
          </div>
          <div class="smart-ocr-total-row">
            <span>Transport Fee</span>
            <span id="ocr-transport-display">0.00 ETB</span>
          </div>
          <div class="smart-ocr-total-row smart-ocr-grand-total">
            <span>Customer Total</span>
            <span id="ocr-grand-total">0.00 ETB</span>
          </div>
          ${data.total ? `
            <div class="smart-ocr-total-row smart-ocr-receipt-total">
              <span>Receipt Total (AI read)</span>
              <span>${formatCurrency(data.total)} ETB</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="smart-ocr-modal-footer">
        <button class="smart-ocr-cancel-btn" id="ocr-modal-cancel">Cancel</button>
        <button class="smart-ocr-confirm-btn" id="ocr-modal-confirm">&#10003; Register Sale</button>
      </div>
    </div>
  `
}


/**
 * ?? CRITICAL FIX #3: Build line item rows from the AI's EXACT data.
 *    Each line_item object has: description, quantity, unit_price, total
 *    We map them 1:1. No re-parsing. No field shuffling.
 */
function buildLineItemsHTML(lineItems, inventory) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return '<p class="smart-ocr-empty">No line items extracted. Add manually.</p>'
  }

  return lineItems.map((item, index) => buildSingleLineItemHTML(item, index, inventory)).join('')
}


function buildSingleLineItemHTML(item, index, inventory) {
  // ============================================================
  // ?? CRITICAL: Read EXACTLY what the AI returned. No remapping.
  // ============================================================
  const description = item.description || ''
  const matchedProductId = item.matched_product_id || ''
  const matchedProductName = item.matched_product_name || ''
  const quantity = parseFloat(item.quantity) || 0
  const unitPrice = parseFloat(item.unit_price) || 0
  const total = parseFloat(item.total) || (quantity * unitPrice)

  // Find inventory match for display hint only (NEVER overwrite AI values)
  let matchBadge = ''
  if (matchedProductId) {
    const inv = inventory.find(p => p.id === matchedProductId)
    const displayName = matchedProductName || (inv ? inv.name : description)
    matchBadge = `<span class="smart-ocr-match-badge" title="Matched: ${escapeHTML(displayName)}">&#10003; ${escapeHTML(displayName)}</span>`
  } else {
    matchBadge = `<span class="smart-ocr-no-match">&#9888; No inventory match</span>`
  }

  console.log(`[SmartOCR Modal] Row ${index}: "${description}" | qty=${quantity} | price=${unitPrice} | total=${total}`)

  return `
    <div class="smart-ocr-line-item" data-index="${index}">
      <div class="smart-ocr-line-item-header">
        <input type="text"
               class="smart-ocr-description-input"
               data-field="description"
               value="${escapeHTML(description)}"
               placeholder="Product description">
        <button class="smart-ocr-remove-row" data-index="${index}" title="Remove">&times;</button>
      </div>
      <input type="hidden" class="smart-ocr-product-id" data-field="matched_product_id" value="${matchedProductId}">

      <div class="smart-ocr-line-item-fields">
        <div class="smart-ocr-field-group">
          <label>QTY</label>
          <input type="number"
                 class="smart-ocr-qty-input smart-ocr-number-input"
                 data-field="quantity"
                 value="${quantity}"
                 min="0"
                 step="1">
        </div>
        <div class="smart-ocr-field-group">
          <label>UNIT PRICE (ETB)</label>
          <input type="number"
                 class="smart-ocr-price-input smart-ocr-number-input"
                 data-field="unit_price"
                 value="${unitPrice}"
                 min="0"
                 step="0.01">
        </div>
        <div class="smart-ocr-field-group">
          <label>TOTAL (ETB)</label>
          <input type="number"
                 class="smart-ocr-total-input smart-ocr-number-input"
                 data-field="total"
                 value="${total}"
                 min="0"
                 step="0.01">
        </div>
      </div>

      <div class="smart-ocr-line-item-footer">
        ${matchBadge}
      </div>
    </div>
  `
}


// ================================================================
//  EVENT LISTENERS
// ================================================================

function attachEventListeners(modal, data, inventory, customers, accounts = [], logId = null) {

  // Close button
  modal.querySelector('#ocr-modal-close')?.addEventListener('click', () => closeModal(modal))
  modal.querySelector('#ocr-modal-cancel')?.addEventListener('click', () => closeModal(modal))

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(modal)
  })

  // Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal(modal)
      document.removeEventListener('keydown', escHandler)
    }
  }
  document.addEventListener('keydown', escHandler)

  // Add row button
  modal.querySelector('#ocr-add-row')?.addEventListener('click', () => {
    const container = modal.querySelector('#ocr-line-items-container')
    const emptyMsg = container.querySelector('.smart-ocr-empty')
    if (emptyMsg) emptyMsg.remove()

    const newIndex = container.querySelectorAll('.smart-ocr-line-item').length
    const newItem = {
      description: '',
      matched_product_id: null,
      matched_product_name: null,
      quantity: 1,
      unit_price: 0,
      total: 0
    }
    const html = buildSingleLineItemHTML(newItem, newIndex, inventory)
    container.insertAdjacentHTML('beforeend', html)

    // Reattach listeners for the new row
    attachRowListeners(modal, container.lastElementChild)
    recalculateTotals(modal, data)
  })

  // Attach listeners to all existing rows
  modal.querySelectorAll('.smart-ocr-line-item').forEach(row => {
    attachRowListeners(modal, row)
  })

  // Mode selector
  const modeLabels = { sale: 'Register Sale', expense: 'Register Expense', inventory: 'Add to Inventory' }
  modal.querySelectorAll('.smart-ocr-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.smart-ocr-mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const confirmBtn = modal.querySelector('#ocr-modal-confirm')
      if (confirmBtn) confirmBtn.innerHTML = `&#10003; ${modeLabels[btn.dataset.mode] || 'Register Sale'}`
    })
  })

  // Transport fee change
  modal.querySelector('#ocr-transport-fee')?.addEventListener('input', () => {
    recalculateTotals(modal, data)
  })

  // Autocomplete for Customer Name
  setupAutocomplete(
    modal.querySelector('#ocr-customer-name'),
    modal.querySelector('#ocr-customer-autocomplete'),
    async (query) => {
      const { currentStore } = appStore.getState()
      if (!currentStore?.id || !query) return []
      const { data } = await supabase
        .from('customers')
        .select('id, name, plate_number')
        .eq('store_id', currentStore.id)
        .ilike('name', `%${query}%`)
        .limit(10)
      return data || []
    },
    (item) => item.name,
    (item) => {
      modal.querySelector('#ocr-customer-name').value = item.name
      modal.querySelector('#ocr-matched-customer-id').value = item.id
      if (item.plate_number) {
        modal.querySelector('#ocr-plate-number').value = item.plate_number
      }
    }
  )

  // Autocomplete for Plate Number
  setupAutocomplete(
    modal.querySelector('#ocr-plate-number'),
    modal.querySelector('#ocr-plate-autocomplete'),
    async (query) => {
      const { currentStore } = appStore.getState()
      if (!currentStore?.id || !query) return []
      const { data } = await supabase
        .from('customers')
        .select('id, name, plate_number')
        .eq('store_id', currentStore.id)
        .not('plate_number', 'is', null)
        .ilike('plate_number', `%${query}%`)
        .limit(10)
      return data || []
    },
    (item) => `${item.plate_number} - ${item.name}`,
    (item) => {
      modal.querySelector('#ocr-plate-number').value = item.plate_number
      modal.querySelector('#ocr-customer-name').value = item.name
      modal.querySelector('#ocr-matched-customer-id').value = item.id
    }
  )

  // Autocomplete for Vendor
  setupAutocomplete(
    modal.querySelector('#ocr-vendor'),
    modal.querySelector('#ocr-vendor-autocomplete'),
    async (query) => {
      const { currentStore } = appStore.getState()
      if (!currentStore?.id || !query) return []
      const { data } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('store_id', currentStore.id)
        .ilike('name', `%${query}%`)
        .limit(10)
      return data || []
    },
    (item) => item.name,
    (item) => {
      modal.querySelector('#ocr-vendor').value = item.name
    }
  )

  // Confirm / Register Sale
  modal.querySelector('#ocr-modal-confirm')?.addEventListener('click', async () => {
    const finalData = collectFinalData(modal, data)
    const btn = modal.querySelector('#ocr-modal-confirm')

    const valid = finalData.line_items.filter(i => i.description?.trim() || i.total > 0)
    if (!valid.length) { showToast('Add at least one line item', 'error'); return }

    btn.disabled = true
    btn.textContent = 'Saving...'

    try {
      const { currentStore } = appStore.getState()
      const storeId = currentStore?.id

      if (finalData.mode === 'sale') {
        await doSale(finalData, valid, storeId, logId)
      } else if (finalData.mode === 'expense') {
        await doExpense(finalData, valid, storeId, logId)
      } else if (finalData.mode === 'inventory') {
        await doInventory(finalData, valid, storeId, logId)
      }

      if (logId) {
        await supabase.from('ocr_logs').update({
          status: 'applied',
          destination_table: finalData.mode === 'inventory' ? 'inventory_items' : finalData.mode,
        }).eq('id', logId)
      }

      showToast('Saved successfully', 'success')
      closeModal(modal)
      setTimeout(() => navigate(window.location.pathname), 400)

    } catch (err) {
      console.error('[SmartOCR Modal] Save error:', err)
      showToast(`Failed: ${err.message}`, 'error')
      btn.disabled = false
      btn.innerHTML = '&#10003; ' + ({ sale: 'Register Sale', expense: 'Register Expense', inventory: 'Add to Inventory' }[finalData.mode] || 'Register Sale')
    }
  })
}


function attachRowListeners(modal, row) {
  if (!row) return

  // Remove row button
  row.querySelector('.smart-ocr-remove-row')?.addEventListener('click', () => {
    row.remove()
    recalculateTotals(modal)
  })

  // Auto-recalc: when qty or price changes, update row total
  const qtyInput = row.querySelector('.smart-ocr-qty-input')
  const priceInput = row.querySelector('.smart-ocr-price-input')
  const totalInput = row.querySelector('.smart-ocr-total-input')

  const autoCalcRow = () => {
    const qty = parseFloat(qtyInput?.value) || 0
    const price = parseFloat(priceInput?.value) || 0
    if (totalInput) {
      totalInput.value = (qty * price).toFixed(2)
    }
    recalculateTotals(modal)
  }

  qtyInput?.addEventListener('input', autoCalcRow)
  priceInput?.addEventListener('input', autoCalcRow)
  totalInput?.addEventListener('input', () => recalculateTotals(modal))
}


// ================================================================
//  TOTALS CALCULATION
// ================================================================

function recalculateTotals(modal, data) {
  const rows = modal.querySelectorAll('.smart-ocr-line-item')
  let goodsSubtotal = 0

  rows.forEach(row => {
    const totalInput = row.querySelector('.smart-ocr-total-input')
    goodsSubtotal += parseFloat(totalInput?.value) || 0
  })

  const transportFee = parseFloat(modal.querySelector('#ocr-transport-fee')?.value) || 0
  const grandTotal = goodsSubtotal + transportFee

  const subtotalEl = modal.querySelector('#ocr-goods-subtotal')
  const transportDisplayEl = modal.querySelector('#ocr-transport-display')
  const grandTotalEl = modal.querySelector('#ocr-grand-total')

  if (subtotalEl) subtotalEl.textContent = `${formatCurrency(goodsSubtotal)} ETB`
  if (transportDisplayEl) transportDisplayEl.textContent = `${formatCurrency(transportFee)} ETB`
  if (grandTotalEl) grandTotalEl.textContent = `${formatCurrency(grandTotal)} ETB`
}


// ================================================================
//  DATA COLLECTION (for save)
// ================================================================

function collectFinalData(modal, originalData) {
  const rows = modal.querySelectorAll('.smart-ocr-line-item')
  const lineItems = []

  rows.forEach(row => {
    lineItems.push({
      description: row.querySelector('[data-field="description"]')?.value?.trim() || '',
      matched_product_id: row.querySelector('[data-field="matched_product_id"]')?.value || null,
      quantity: parseFloat(row.querySelector('[data-field="quantity"]')?.value) || 0,
      unit_price: parseFloat(row.querySelector('[data-field="unit_price"]')?.value) || 0,
      total: parseFloat(row.querySelector('[data-field="total"]')?.value) || 0
    })
  })

  const activeMode = modal.querySelector('.smart-ocr-mode-btn.active')?.dataset.mode || 'sale'
  const paySelect = modal.querySelector('#ocr-payment-method')
  const selectedOption = paySelect?.options[paySelect.selectedIndex]
  const accountId = paySelect?.value || null
  const accountType = selectedOption?.dataset.type || 'cash'
  const isCredit = accountId === 'credit'

  return {
    customer_name: modal.querySelector('#ocr-customer-name')?.value?.trim() || '',
    matched_customer_id: modal.querySelector('#ocr-matched-customer-id')?.value || null,
    plate_number: modal.querySelector('#ocr-plate-number')?.value?.trim() || '',
    vendor: modal.querySelector('#ocr-vendor')?.value?.trim() || '',
    date: modal.querySelector('#ocr-date')?.value || '',
    payment_method: isCredit ? 'credit' : accountType === 'bank' ? 'bank_transfer' : 'cash',
    cash_account_id: isCredit ? null : accountId,
    notes: modal.querySelector('#ocr-notes')?.value?.trim() || '',
    transport_fee: parseFloat(modal.querySelector('#ocr-transport-fee')?.value) || 0,
    line_items: lineItems,
    mode: activeMode,
    scan_mode: originalData.scan_mode || 'pro',
    raw_text: originalData.raw_text || ''
  }
}


// ================================================================
//  AUTOCOMPLETE HELPER
// ================================================================

function setupAutocomplete(inputEl, dropdownEl, fetchFn, displayFn, selectFn) {
  if (!inputEl || !dropdownEl) return

  let debounceTimer = null
  let currentItems = []

  inputEl.addEventListener('input', async (e) => {
    const query = e.target.value.trim()
    
    clearTimeout(debounceTimer)
    
    if (query.length < 2) {
      dropdownEl.innerHTML = ''
      dropdownEl.style.display = 'none'
      return
    }

    debounceTimer = setTimeout(async () => {
      try {
        currentItems = await fetchFn(query)
        
        if (currentItems.length === 0) {
          dropdownEl.innerHTML = '<div class="smart-ocr-autocomplete-item smart-ocr-autocomplete-empty">No matches found</div>'
          dropdownEl.style.display = 'block'
          return
        }

        dropdownEl.innerHTML = currentItems
          .map((item, idx) => `
            <div class="smart-ocr-autocomplete-item" data-index="${idx}">
              ${escapeHTML(displayFn(item))}
            </div>
          `).join('')
        
        dropdownEl.style.display = 'block'

        // Add click handlers
        dropdownEl.querySelectorAll('.smart-ocr-autocomplete-item').forEach(itemEl => {
          itemEl.addEventListener('click', () => {
            const idx = parseInt(itemEl.dataset.index)
            if (idx >= 0 && currentItems[idx]) {
              selectFn(currentItems[idx])
              dropdownEl.innerHTML = ''
              dropdownEl.style.display = 'none'
            }
          })
        })
      } catch (err) {
        console.error('Autocomplete error:', err)
        dropdownEl.innerHTML = ''
        dropdownEl.style.display = 'none'
      }
    }, 300)
  })

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
      dropdownEl.innerHTML = ''
      dropdownEl.style.display = 'none'
    }
  })

  // Close dropdown on blur
  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      dropdownEl.innerHTML = ''
      dropdownEl.style.display = 'none'
    }, 200)
  })
}


// ================================================================
//  UTILITIES
// ================================================================

function closeModal(modal) {
  modal.classList.remove('active')
  
  // Restore body scroll and position
  const scrollY = document.body.style.top
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.width = ''
  document.body.style.top = ''
  if (scrollY) {
    window.scrollTo(0, parseInt(scrollY || '0') * -1)
  }
  
  setTimeout(() => modal.remove(), 300)
}

function escapeHTML(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-ET', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount || 0)
}

// ================================================================
//  SAVE FUNCTIONS
// ================================================================

async function doSale(d, items, storeId, logId) {
  const isCredit = d.payment_method === 'credit'
  const goodsTotal = items.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const grandTotal = goodsTotal + (d.transport_fee || 0)

  // Find or create customer FIRST (required for credit sales)
  let custId = null
  if (d.customer_name) {
    custId = d.matched_customer_id || null
    if (!custId) {
      const { data: existing } = await supabase.from('customers')
        .select('id').eq('store_id', storeId).ilike('name', d.customer_name).maybeSingle()
      custId = existing?.id
      if (!custId) {
        const { data: nc } = await supabase.from('customers')
          .insert({ 
            store_id: storeId, 
            name: d.customer_name,
            plate_number: d.plate_number || null 
          }).select('id').single()
        custId = nc?.id
      }
    }
  }

  // Insert sale with customer_id included from the start
  const { data: sale, error: saleErr } = await supabase.from('sales').insert({
    store_id:        storeId,
    customer_id:     custId || null,
    cash_account_id: isCredit ? null : (d.cash_account_id || null),
    sale_date:       d.date,
    total_amount:    grandTotal,
    payment_method:  d.payment_method,
    source:          'ocr',
    ocr_log_id:      logId || null,
    transport_fee:   d.transport_fee > 0 ? d.transport_fee : null,
    notes:           d.notes || null,
    plate_number:    d.plate_number || null,
  }).select('id').single()
  if (saleErr) throw saleErr

  for (const item of items) {
    await supabase.from('sale_items').insert({
      sale_id:            sale.id,
      item_name_snapshot: item.description,
      quantity:           item.quantity  || 1,
      unit_price:         item.unit_price || 0,
    })
  }

  // Create credit_sales record if needed
  if (isCredit && custId) {
    await supabase.from('credit_sales').insert({
      store_id:    storeId,
      sale_id:     sale.id,
      customer_id: custId,
      amount_owed: grandTotal,
      status:      'unpaid',
    })
  }

  // Transport fee expense
  if (d.transport_fee > 0 && !isCredit) {
    await supabase.from('expenses').insert({
      store_id:        storeId,
      cash_account_id: d.cash_account_id || null,
      expense_date:    d.date,
      amount:          d.transport_fee,
      category:        'transport_fee',
      description:     'Transport fee (OCR scan)',
      source:          'ocr',
      ocr_log_id:      logId || null,
    })
  }
}

async function doExpense(d, items, storeId, logId) {
  const isCredit = d.payment_method === 'credit'
  const total = items.reduce((s, i) => s + (Number(i.total) || 0), 0) + (d.transport_fee || 0)
  const description = items.map(i => i.description).filter(Boolean).join(', ') || d.vendor || 'OCR Expense'

  const { error } = await supabase.from('expenses').insert({
    store_id:        storeId,
    cash_account_id: isCredit ? null : (d.cash_account_id || null),
    expense_date:    d.date,
    amount:          total,
    description,
    source:          'ocr',
    ocr_log_id:      logId || null,
    transport_fee:   d.transport_fee > 0 ? d.transport_fee : null,
    notes:           d.notes || null,
  })
  if (error) throw error

  if (isCredit && d.vendor) {
    await supabase.from('vendor_debts').insert({
      store_id:    storeId,
      vendor_name: d.vendor,
      amount_owed: total,
      amount_paid: 0,
      status:      'unpaid',
      notes:       'Expense from OCR scan',
    })
  }
}

async function doInventory(d, items, storeId, logId) {
  const isCredit = d.payment_method === 'credit'

  for (const item of items) {
    // Find or create inventory item
    let itemId = item.matched_product_id || null

    if (!itemId) {
      const { data: existing } = await supabase.from('inventory_items')
        .select('id').eq('store_id', storeId).ilike('item_name', item.description).maybeSingle()
      itemId = existing?.id
    }

    if (!itemId) {
      const { data: newItem, error: newErr } = await supabase.from('inventory_items').insert({
        store_id:      storeId,
        item_name:     item.description,
        unit_cost:     item.unit_price || null,
        selling_price: item.unit_price || null,
        supplier:      d.vendor || null,
      }).select('id').single()
      if (newErr) throw newErr
      itemId = newItem.id
    }

    const { error } = await supabase.rpc('add_stock_batch', {
      p_store_id:          storeId,
      p_item_id:           itemId,
      p_quantity:          item.quantity || 1,
      p_unit_cost:         item.unit_price || 0,
      p_purchase_date:     d.date,
      p_supplier_id:       null,
      p_supplier_name:     d.vendor || null,
      p_cash_account_id:   (!isCredit && d.cash_account_id) ? d.cash_account_id : null,
      p_cash_account_name: null,
      p_transport_fee:     d.transport_fee || 0,
      p_targa:             null,
      p_delivery_place:    null,
      p_notes:             'Added via OCR scan',
    })
    if (error) throw error
  }
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'toast-container'
    document.body.appendChild(wrap)
  }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}

// ================================================================
//  LEGACY SHIM — called by ocr-scanner.js with a log ID
// ================================================================
export async function openSmartOCRModal(logId) {
  const { currentStore } = appStore.getState()

  const { data: log, error } = await supabase
    .from('ocr_logs').select('*').eq('id', logId).single()

  if (error || !log) { alert('Could not load scan data'); return }

  const [{ data: inventoryItems }, { data: customers }, { data: accounts }] = await Promise.all([
    supabase.from('inventory_items').select('id, item_name, selling_price, unit_cost').eq('store_id', currentStore?.id),
    supabase.from('customers').select('id, name').eq('store_id', currentStore?.id),
    supabase.from('cash_accounts').select('id, account_name, account_type, bank_name, balance').eq('store_id', currentStore?.id),
  ])

  openSmartOcrModal({
    rawText:    log.parsed_data?.raw_text || '',
    parsedData: log.parsed_data || {},
    sourceImage: log.image_url || '',
    inventory:  (inventoryItems || []).map(i => ({ id: i.id, name: i.item_name, unit_price: i.selling_price })),
    customers:  customers || [],
    accounts:   accounts || [],
    logId,
  })
}
