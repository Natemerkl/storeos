import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { fuzzyMatch, extractMetaFromText, parseProductLine } from '../utils/fuzzy.js'
import { learnFromSession, getPreferredPayment, getLearnedColumns } from '../utils/patterns.js'
import { navigate } from '../router.js'

export async function openSmartOCRModal(log, onComplete) {
  const { currentStore } = appStore.getState()

  const [
    { data: inventory },
    { data: accounts },
    { data: customers },
    preferredPayment,
    learnedSale,
    learnedInventory,
  ] = await Promise.all([
    supabase.from('inventory_items').select('id, item_name, selling_price, unit_cost, quantity').eq('store_id', currentStore?.id),
    supabase.from('cash_accounts').select('id, name, account_type').eq('store_id', currentStore?.id),
    supabase.from('customers').select('id, name, phone, credit_balance').eq('store_id', currentStore?.id),
    getPreferredPayment(),
    getLearnedColumns('sale'),
    getLearnedColumns('inventory'),
  ])

  // Parse OCR into line items — preserve quantities from OCR
  const extracted  = extractMetaFromText(log.raw_text || '')
  const rawLines   = (log.raw_text || '').split('\n').map(l => l.trim()).filter(Boolean)

  const parsedItems = log.parsed_data?.line_items?.length
    ? log.parsed_data.line_items.map(i => {
        const parsed = parseProductLine(`${i.description} ${i.quantity || ''} ${i.unit_price || ''}`)
        return {
          confirmedName:  i.description || parsed?.name || '',
          // ✅ FIX: preserve OCR quantity, never default to 1 if OCR gave us a number
          confirmedQty:   Number(i.quantity)  || Number(parsed?.quantity)  || 1,
          confirmedPrice: Number(i.unit_price) || Number(parsed?.unitPrice) || null,
          confirmedTotal: i.unit_price && i.quantity
            ? Number(i.quantity) * Number(i.unit_price)
            : Number(parsed?.total) || null,
          matched: null,
          raw: i.description,
        }
      })
    : rawLines.slice(1, 10)
        .map(l => parseProductLine(l))
        .filter(p => p?.name?.length > 1)
        .map(p => ({
          confirmedName:  p.name,
          confirmedQty:   p.quantity  || 1,
          confirmedPrice: p.unitPrice || null,
          confirmedTotal: p.total     || null,
          matched: null,
          raw: p.raw,
        }))

  // State
  let destination     = 'sale'
  let paymentMethod   = preferredPayment || 'cash'
  let isCredit        = paymentMethod === 'credit'
  let lineItems       = parsedItems.length > 0
    ? parsedItems
    : [{ confirmedName:'', confirmedQty:1, confirmedPrice:null, confirmedTotal:null, matched:null }]

  // Extra learned fields
  const extraFields = {}
  if (learnedSale?.columns?.includes('vehicle_plate')) extraFields.vehicle_plate = ''
  if (learnedSale?.columns?.includes('customer_note')) extraFields.customer_note = ''

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.style.cssText = 'display:flex;align-items:flex-start;overflow-y:auto;padding:1rem'

  function buildHTML() {
    // Only show auto-detected section if we have meaningful distinct data
    const detectedItems = []
    // ✅ FIX: only show customer name if it's actually an Ethiopian name pattern
    if (extracted.customerName) detectedItems.push(`👤 ${extracted.customerName}`)
    // ✅ FIX: only show plate if we have plate-context word, not just any number
    if (extracted.plate) detectedItems.push(`🚗 Plate: ${extracted.plate}`)
    // ✅ FIX: phone is separate from everything else
    if (extracted.phone) detectedItems.push(`📞 ${extracted.phone}`)

    return `
      <div style="
        background:var(--bg);border-radius:var(--radius);
        width:100%;max-width:640px;margin:auto;
        box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;
      ">
        <!-- Header -->
        <div style="background:var(--dark);padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="color:#fff;font-weight:700;font-size:1rem">Smart OCR Review</div>
            <div style="color:rgba(255,255,255,0.45);font-size:12px">Confirm extracted data before saving</div>
          </div>
          <button id="ocr-modal-close" style="color:rgba(255,255,255,0.5);font-size:1.2rem;padding:0.25rem">✕</button>
        </div>

        <div style="padding:1.25rem">
          <!-- Destination tabs -->
          <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem">
            <button class="dest-tab btn ${destination==='sale'      ? 'btn-primary':'btn-outline'}" data-dest="sale">💚 Sale</button>
            <button class="dest-tab btn ${destination==='expense'   ? 'btn-primary':'btn-outline'}" data-dest="expense">📋 Expense</button>
            <button class="dest-tab btn ${destination==='inventory' ? 'btn-primary':'btn-outline'}" data-dest="inventory">📦 Inventory</button>
          </div>

          <!-- Doc details -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
            <div class="form-group" style="margin:0">
              <label class="form-label">Date</label>
              <input type="date" class="form-input" id="sm-date" value="${extracted.date || new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Cash Account</label>
              <select class="form-input" id="sm-account">
                ${(accounts||[]).map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Payment method — sale only -->
          <div id="payment-section" style="margin-bottom:1rem;${destination!=='sale'?'display:none':''}">
            <div class="form-label" style="margin-bottom:0.5rem">Payment Method</div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
              ${['cash','credit','bank_transfer','telebirr','cbe_birr','other'].map(pm => `
                <button class="pay-btn btn btn-sm ${paymentMethod===pm?'btn-primary':'btn-outline'}"
                        data-pay="${pm}" style="font-size:12px">
                  ${{cash:'💵 Cash',credit:'📒 Credit',bank_transfer:'🏦 Bank',
                     telebirr:'📱 Telebirr',cbe_birr:'📱 CBE Birr',other:'Other'}[pm]}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Credit customer -->
          <div id="credit-section" style="display:${isCredit?'block':'none'};margin-bottom:1rem">
            <div style="background:#fef9c3;border:1px solid #f59e0b;border-radius:var(--radius);padding:0.75rem">
              <div style="font-weight:600;font-size:13px;margin-bottom:0.5rem">📒 Credit Sale — Customer Required</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
                <div>
                  <label class="form-label">Customer Name *</label>
                  <input class="form-input" id="sm-customer-name"
                    value="${extracted.customerName || ''}"
                    placeholder="Full name" list="customer-list">
                  <datalist id="customer-list">
                    ${(customers||[]).map(c=>`<option value="${c.name}">`).join('')}
                  </datalist>
                </div>
                <div>
                  <label class="form-label">Phone</label>
                  <input class="form-input" id="sm-customer-phone"
                    value="${extracted.phone || ''}" placeholder="09xxxxxxxx">
                </div>
              </div>
            </div>
          </div>

          <!-- Optional customer info — all sale types except credit (credit has its own) -->
          <div id="optional-customer-section" style="display:${isCredit?'none':'block'};margin-bottom:1rem">
            <details>
              <summary style="cursor:pointer;font-size:13px;color:var(--muted);user-select:none;padding:0.4rem 0">
                + Customer info (optional)
              </summary>
              <div style="margin-top:0.75rem;display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
                <div>
                  <label class="form-label">Customer Name</label>
                  <input class="form-input" id="sm-opt-customer-name"
                    value="${extracted.customerName || ''}"
                    placeholder="Optional" list="customer-list-opt">
                  <datalist id="customer-list-opt">
                    ${(customers||[]).map(c=>`<option value="${c.name}">`).join('')}
                  </datalist>
                </div>
                <div>
                  <label class="form-label">Phone</label>
                  <input class="form-input" id="sm-opt-customer-phone"
                    value="${extracted.phone || ''}" placeholder="Optional">
                </div>
                <div>
                  <label class="form-label">Vehicle Plate</label>
                  <input class="form-input" id="sm-opt-plate"
                    value="${extracted.plate || ''}" placeholder="Optional">
                </div>
                <div>
                  <label class="form-label">Note</label>
                  <input class="form-input" id="sm-opt-note" placeholder="Optional">
                </div>
              </div>
            </details>
          </div>

          <!-- Inventory credit toggle -->
          <div id="inv-credit-section" style="display:${destination==='inventory'?'block':'none'};margin-bottom:1rem">
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:var(--bg-light);border-radius:var(--radius);border:1px solid var(--border)">
              <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:13.5px">
                <input type="checkbox" id="inv-credit-toggle" style="width:16px;height:16px">
                Purchased on credit (vendor owes)
              </label>
            </div>
            <div id="vendor-section" style="display:none;margin-top:0.5rem">
              <label class="form-label">Vendor / Supplier Name *</label>
              <input class="form-input" id="inv-vendor" placeholder="Supplier name">
            </div>
          </div>

          <!-- Auto-detected — only meaningful distinct items -->
          ${detectedItems.length > 0 ? `
            <div style="background:var(--accent-lt);border:1px solid var(--accent);border-radius:var(--radius);padding:0.6rem 0.85rem;margin-bottom:1rem;font-size:12.5px">
              <div style="font-weight:600;margin-bottom:0.3rem;color:var(--accent)">⚡ Auto-detected from scan</div>
              <div style="display:flex;gap:1rem;flex-wrap:wrap;color:var(--dark)">
                ${detectedItems.join('')}
              </div>
            </div>
          ` : ''}

          <!-- Line items -->
          <div style="font-weight:600;margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
            <span>Line Items</span>
            <button class="btn btn-outline btn-sm" id="btn-add-line">+ Add Row</button>
          </div>

          <div id="line-items-container"></div>

          <!-- Total -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:var(--bg-light);border-radius:var(--radius);margin-top:0.75rem">
            <span style="font-weight:600">Total</span>
            <span style="font-size:1.2rem;font-weight:700;color:var(--accent)" id="sm-total">0.00 ETB</span>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:0.75rem;margin-top:1.25rem">
            <button class="btn btn-outline" id="btn-sm-cancel" style="flex:1;justify-content:center">Cancel</button>
            <button class="btn btn-primary" id="btn-sm-apply" style="flex:2;justify-content:center;font-size:1rem">
              ✓ ${destination==='sale' ? 'Register Sale' : destination==='expense' ? 'Save Expense' : 'Add to Inventory'}
            </button>
          </div>
        </div>
      </div>
    `
  }

  function mount() {
    overlay.innerHTML = buildHTML()
    attachEvents()
    renderLineItems()
  }

  // ── Line items renderer ───────────────────────────────────
  function renderLineItems() {
    const container = overlay.querySelector('#line-items-container')
    if (!container) return

    container.innerHTML = lineItems.map((item, i) => {
      const matches = inventory?.length && item.confirmedName
        ? fuzzyMatch(item.confirmedName, inventory, { key:'item_name', limit:4 })
        : []

      return `
        <div style="
          border:1px solid ${item.matched ? 'var(--accent)' : 'var(--border)'};
          border-radius:var(--radius);padding:0.75rem;margin-bottom:0.75rem;
          background:${item.matched ? 'var(--accent-lt)' : 'var(--bg)'}
        " data-line="${i}">
          <!-- Name row -->
          <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.35rem">
            <input class="form-input line-name" style="flex:1;font-weight:${item.matched?'600':'400'}"
              value="${item.confirmedName}" placeholder="Product name" data-idx="${i}">
            ${item.matched
              ? `<span style="font-size:11px;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px;white-space:nowrap">✓ matched</span>`
              : ''}
            <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border);flex-shrink:0" data-remove="${i}">✕</button>
          </div>

          <!-- Fuzzy suggestions — only if not matched -->
          ${!item.matched && matches.length > 0 ? `
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.5rem">
              <span style="font-size:11px;color:var(--muted);align-self:center">Match:</span>
              ${matches.map(m => `
                <button class="match-btn" data-idx="${i}" data-item='${JSON.stringify({
                  id:    m.id,
                  name:  m.item_name,
                  price: Number(m.selling_price || m.unit_cost || 0),
                })}' style="
                  font-size:11.5px;padding:3px 10px;border-radius:999px;
                  border:1px solid var(--accent);background:var(--accent-lt);
                  color:var(--accent);cursor:pointer;white-space:nowrap;
                ">
                  ${m.item_name} · ${Number(m.selling_price || 0).toLocaleString()} ETB
                </button>
              `).join('')}
            </div>
          ` : ''}

          <!-- Qty / Price / Total -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem">
            <div>
              <label class="form-label" style="font-size:10px">QTY</label>
              <input class="form-input line-qty" type="number" min="0.01" step="0.01"
                value="${item.confirmedQty || 1}" data-idx="${i}" style="font-size:13px">
            </div>
            <div>
              <label class="form-label" style="font-size:10px">UNIT PRICE (ETB)</label>
              <input class="form-input line-price" type="number" min="0" step="0.01"
                value="${item.confirmedPrice !== null ? item.confirmedPrice : ''}"
                placeholder="0.00" data-idx="${i}" style="font-size:13px">
            </div>
            <div>
              <label class="form-label" style="font-size:10px">TOTAL (ETB)</label>
              <input class="form-input line-total" type="number" min="0" step="0.01"
                value="${item.confirmedTotal !== null ? item.confirmedTotal : ''}"
                placeholder="0.00" data-idx="${i}"
                style="font-size:13px;font-weight:600;background:var(--bg-light)">
            </div>
          </div>
        </div>
      `
    }).join('')

    attachLineListeners()
    updateTotal()
  }

  function attachLineListeners() {
    // ✅ FIX: match button preserves existing OCR quantity
    overlay.querySelectorAll('.match-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx      = Number(btn.dataset.idx)
        const item     = JSON.parse(btn.dataset.item)
        const existQty = lineItems[idx].confirmedQty || 1  // keep OCR quantity

        lineItems[idx].matched        = item
        lineItems[idx].confirmedName  = item.name
        lineItems[idx].confirmedPrice = item.price
        // ✅ Use existing qty from OCR, recalculate total
        lineItems[idx].confirmedQty   = existQty
        lineItems[idx].confirmedTotal = existQty * item.price
        renderLineItems()
      })
    })

    overlay.querySelectorAll('.line-name').forEach(input => {
      input.addEventListener('input', e => {
        const idx = Number(e.target.dataset.idx)
        lineItems[idx].confirmedName = e.target.value
        lineItems[idx].matched       = null
        // Debounce re-render for suggestions
        clearTimeout(input._t)
        input._t = setTimeout(() => renderLineItems(), 400)
      })
    })

    overlay.querySelectorAll('.line-qty').forEach(input => {
      input.addEventListener('input', e => {
        const idx   = Number(e.target.dataset.idx)
        const qty   = parseFloat(e.target.value) || 0
        const price = lineItems[idx].confirmedPrice || 0
        lineItems[idx].confirmedQty   = qty
        lineItems[idx].confirmedTotal = price > 0 ? qty * price : lineItems[idx].confirmedTotal
        const totalInput = overlay.querySelector(`.line-total[data-idx="${idx}"]`)
        if (totalInput && price > 0) totalInput.value = (qty * price).toFixed(2)
        updateTotal()
      })
    })

    overlay.querySelectorAll('.line-price').forEach(input => {
      input.addEventListener('input', e => {
        const idx   = Number(e.target.dataset.idx)
        const price = parseFloat(e.target.value) || 0
        const qty   = lineItems[idx].confirmedQty || 1
        lineItems[idx].confirmedPrice = price
        lineItems[idx].confirmedTotal = qty * price
        const totalInput = overlay.querySelector(`.line-total[data-idx="${idx}"]`)
        if (totalInput) totalInput.value = (qty * price).toFixed(2)
        updateTotal()
      })
    })

    overlay.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        lineItems.splice(Number(btn.dataset.remove), 1)
        if (lineItems.length === 0) addEmptyRow()
        else renderLineItems()
      })
    })
  }

  function updateTotal() {
    const total = lineItems.reduce((s, i) => s + (Number(i.confirmedTotal) || 0), 0)
    const el = overlay.querySelector('#sm-total')
    if (el) el.textContent = `${total.toLocaleString('en-ET', { minimumFractionDigits:2 })} ETB`
  }

  function addEmptyRow() {
    lineItems.push({ confirmedName:'', confirmedQty:1, confirmedPrice:null, confirmedTotal:null, matched:null })
    renderLineItems()
  }

  // ── Events ────────────────────────────────────────────────
  function attachEvents() {
    overlay.querySelector('#ocr-modal-close').addEventListener('click', () => overlay.remove())
    overlay.querySelector('#btn-sm-cancel').addEventListener('click', () => overlay.remove())
    overlay.querySelector('#btn-add-line').addEventListener('click', addEmptyRow)

    // Destination
    overlay.querySelectorAll('.dest-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        destination = btn.dataset.dest
        mount()
      })
    })

    // Payment
    overlay.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        paymentMethod = btn.dataset.pay
        isCredit      = paymentMethod === 'credit'
        overlay.querySelectorAll('.pay-btn').forEach(b => {
          b.classList.toggle('btn-primary', b.dataset.pay === paymentMethod)
          b.classList.toggle('btn-outline',  b.dataset.pay !== paymentMethod)
        })
        overlay.querySelector('#credit-section').style.display          = isCredit ? 'block' : 'none'
        overlay.querySelector('#optional-customer-section').style.display = isCredit ? 'none'  : 'block'
      })
    })

    // Inventory credit toggle
    overlay.querySelector('#inv-credit-toggle')?.addEventListener('change', e => {
      overlay.querySelector('#vendor-section').style.display = e.target.checked ? 'block' : 'none'
    })

    // Apply
    overlay.querySelector('#btn-sm-apply').addEventListener('click', handleApply)
  }

  // ── Apply handler ─────────────────────────────────────────
  async function handleApply() {
    const date    = overlay.querySelector('#sm-date').value
    const account = overlay.querySelector('#sm-account').value
    const total   = lineItems.reduce((s, i) => s + (Number(i.confirmedTotal) || 0), 0)

    if (!total && destination !== 'inventory') { alert('Add at least one item with a price'); return }
    if (isCredit && !overlay.querySelector('#sm-customer-name')?.value.trim()) {
      alert('Customer name is required for credit sales'); return
    }

    const btn = overlay.querySelector('#btn-sm-apply')
    btn.textContent = 'Saving...'
    btn.disabled    = true

    try {
      if (destination === 'sale')      await applySale({ date, account, total })
      else if (destination === 'expense') await applyExpense({ date, account, total })
      else                             await applyInventory()

      // ✅ Learn from this session
      await learnFromSession({
        destination,
        lineItems,
        paymentMethod,
        extraFields: {},
      })

      await supabase.from('ocr_logs').update({
        status:            'applied',
        destination_table: destination,
      }).eq('id', log.id)

      overlay.remove()
      sessionStorage.removeItem('ocr_log_id')
      if (onComplete) onComplete()
      else navigate('/dashboard')

    } catch (err) {
      console.error('Apply error:', err)
      alert(`Error: ${err.message}`)
      btn.textContent = `✓ ${destination === 'sale' ? 'Register Sale' : destination === 'expense' ? 'Save Expense' : 'Add to Inventory'}`
      btn.disabled = false
    }
  }

  async function applySale({ date, account, total }) {
    const { data: sale, error } = await supabase.from('sales').insert({
      store_id:        currentStore?.id,
      cash_account_id: isCredit ? null : (account || null),
      sale_date:       date,
      total_amount:    total,
      payment_method:  isCredit ? 'credit' : paymentMethod,
      source:          'ocr',
      ocr_log_id:      log.id,
    }).select().single()
    if (error) throw error

    for (const item of lineItems) {
      if (!item.confirmedName) continue
      await supabase.from('sale_items').insert({
        sale_id:            sale.id,
        item_id:            item.matched?.id || null,
        item_name_snapshot: item.confirmedName,
        quantity:           item.confirmedQty  || 1,
        unit_price:         item.confirmedPrice || 0,
      })
    }

    if (isCredit) {
      const custName  = overlay.querySelector('#sm-customer-name').value.trim()
      const custPhone = overlay.querySelector('#sm-customer-phone')?.value.trim() || null
      let customer    = customers?.find(c => c.name.toLowerCase() === custName.toLowerCase())
      if (!customer) {
        const { data } = await supabase.from('customers').insert({
          store_id: currentStore?.id,
          name:     custName,
          phone:    custPhone,
        }).select().single()
        customer = data
      }
      await supabase.from('credit_sales').insert({
        store_id:    currentStore?.id,
        sale_id:     sale.id,
        customer_id: customer.id,
        amount_owed: total,
        status:      'unpaid',
      })
    }

    // Save optional customer note even for non-credit sales
    const optName  = overlay.querySelector('#sm-opt-customer-name')?.value.trim()
    const optPhone = overlay.querySelector('#sm-opt-customer-phone')?.value.trim()
    const optPlate = overlay.querySelector('#sm-opt-plate')?.value.trim()
    const optNote  = overlay.querySelector('#sm-opt-note')?.value.trim()

    if (optName && !isCredit) {
      let customer = customers?.find(c => c.name.toLowerCase() === optName.toLowerCase())
      if (!customer) {
        await supabase.from('customers').insert({
          store_id: currentStore?.id,
          name:     optName,
          phone:    optPhone || null,
          notes:    [optPlate ? `Plate: ${optPlate}` : '', optNote].filter(Boolean).join(' · ') || null,
        })
      }
    }
  }

  async function applyExpense({ date, account, total }) {
    await supabase.from('expenses').insert({
      store_id:        currentStore?.id,
      cash_account_id: account || null,
      expense_date:    date,
      amount:          total,
      description:     lineItems.map(i => i.confirmedName).filter(Boolean).join(', '),
      source:          'ocr',
      ocr_log_id:      log.id,
    })
  }

  async function applyInventory() {
    const isOnCredit = overlay.querySelector('#inv-credit-toggle')?.checked
    const vendor     = overlay.querySelector('#inv-vendor')?.value.trim()

    for (const item of lineItems) {
      if (!item.confirmedName) continue
      if (item.matched?.id) {
        await supabase.from('stock_movements').insert({
          store_id:      currentStore?.id,
          item_id:       item.matched.id,
          movement_type: 'in',
          quantity:      item.confirmedQty || 1,
          unit_cost:     item.confirmedPrice || null,
          source:        'ocr',
        })
      } else {
        await supabase.from('inventory_items').insert({
          store_id:  currentStore?.id,
          item_name: item.confirmedName,
          quantity:  item.confirmedQty  || 0,
          unit_cost: item.confirmedPrice || null,
        })
      }
    }

    if (isOnCredit && vendor) {
      const total = lineItems.reduce((s, i) => s + (Number(i.confirmedTotal) || 0), 0)
      await supabase.from('vendor_debts').insert({
        store_id:    currentStore?.id,
        vendor_name: vendor,
        amount_owed: total,
      })
    }
  }

  document.body.appendChild(overlay)
  mount()
}