import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { renderIcon } from './icons.js'
import { fuzzyMatch } from '../utils/fuzzy.js'
import { audit } from '../utils/audit.js'
import { checkSaleAgainstInventory } from '../utils/inventory-resolver.js'
import { openInventoryResolverModal } from '../components/inventory-resolver-modal.js'

let modalEl = null

function sanitizeNumericInput(value) {
  const s = String(value == null ? '' : value)
  return s.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')
}

export async function openSmartOCRModal(logId) {
  if (modalEl) modalEl.remove()

  const { currentStore } = appStore.getState()

  const { data: log, error } = await supabase
    .from('ocr_logs').select('*').eq('id', logId).single()

  if (error || !log) { alert('Could not load scan data'); return }

  const [
    { data: _accounts },
    { data: inventoryItems },
    { data: customers },
  ] = await Promise.all([
    supabase.from('cash_accounts').select('id, account_name, account_type, bank_name').eq('store_id', currentStore?.id),
    supabase.from('inventory_items').select('id, item_name, selling_price, unit_cost').eq('store_id', currentStore?.id),
    supabase.from('customers').select('id, name, phone').eq('store_id', currentStore?.id),
  ])

  let accounts = _accounts || []

  // â”€â”€ Extract OCR extras stored in parsed_data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const customerHeader = log.parsed_data?.customer_header || {}
  const transport      = log.parsed_data?.transport       || {}
  const paymentBank    = log.parsed_data?.payment_bank    || null

  // â”€â”€ Parse line items from OCR data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const rawItems = log.parsed_data?.line_items || []

  let items = rawItems.map(i => {
    const qty     = Number(i.quantity)  || 1
    const aiPrice = Number(i.unit_price)   // keep 0 distinct from null
    const aiTotal = Number(i.total)

    // Price priority: unit_price â†’ back-calculate from total
    const price = aiPrice > 0
      ? aiPrice
      : (aiTotal > 0 ? aiTotal / qty : null)

    // Preserve AI total exactly -- never discard what Gemini computed
    const total = aiTotal > 0
      ? aiTotal
      : (price != null ? qty * price : null)

    // Use matched_product_id from Gemini first; only fuzzy-match if absent
    let matched = null
    if (i.matched_product_id && inventoryItems?.length) {
      matched = inventoryItems.find(ii => ii.id === i.matched_product_id) || null
    }
    if (!matched && inventoryItems?.length) {
      matched = fuzzyMatch(i.description, inventoryItems, { key: 'item_name', threshold: 0.6, limit: 1 })[0] || null
    }

    return {
      name: i.description || '',
      qty,
      price,
      total,
      matched,
    }
  })

  if (!items.length) {
    items.push({ name: '', qty: 1, price: null, total: null, matched: null })
  }

  const _tillAccounts = accounts.filter(a => a.account_type === 'till')
  const _bankAccounts  = accounts.filter(a => a.account_type === 'bank')

  let mode      = 'sale'
  let payMethod = _tillAccounts.length ? 'cash' : (_bankAccounts.length ? 'bank_transfer' : 'credit')
  let accountId = _tillAccounts.length ? _tillAccounts[0].id : (_bankAccounts.length ? _bankAccounts[0].id : '')
  let docDate   = log.parsed_data?.date || new Date().toISOString().split('T')[0]

  // â”€â”€ Pre-fill payment account from detected bank â”€â”€â”€â”€â”€â”€â”€â”€
  if (paymentBank) {
    const bankMatch = accounts.find(a => a.account_type === 'bank' &&
      (a.bank_name||'').toUpperCase().includes(paymentBank.toUpperCase()))
    if (bankMatch) { payMethod = 'bank_transfer'; accountId = bankMatch.id }
  }

  // â”€â”€ Customer / transport state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let custName            = customerHeader.name  || ''
  let custTarga           = customerHeader.targa || ''
  let custPlace           = customerHeader.place || ''
  let saveCustomerCheck   = false
  let rememberPlaceCheck  = false
  const matchedCustomer   = (customers||[]).find(c =>
    custName && c.name.toLowerCase() === custName.toLowerCase()) || null

  let transportAmt        = Number(transport?.amount) || Number(log.parsed_data?.transport_fee) || 0
  let transportWorker     = transport?.worker_note    || ''
  let transportPaidNow    = !!(transport?.detected)
  let transportChargeCust = false

  // â”€â”€ Modal shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const overlay = document.createElement('div')
  overlay.className  = 'modal-overlay'
  overlay.style.zIndex = '300'

  const modal = document.createElement('div')
  modal.style.cssText = `
    background:var(--bg-elevated);border-radius:20px;
    width:100%;max-width:640px;max-height:92vh;
    overflow-y:auto;box-shadow:var(--shadow-lg);
    border:1px solid var(--border);
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  modalEl = overlay

  function getGoodsTotal() {
    return items.reduce((s, i) => s + (Number(i.qty)||0) * (Number(i.price)||0), 0)
  }
  function getGrandTotal() { return getGoodsTotal() }
  function getCustomerTotal() {
    const g = getGoodsTotal()
    if (mode === 'sale' && transportAmt > 0 && transportChargeCust) return g + transportAmt
    return g
  }
  function getEstimatedProfit() {
    let p = items.reduce((s, i) => {
      const cost = i.matched?.unit_cost || 0
      return s + ((Number(i.price)||0) - cost) * (Number(i.qty)||0)
    }, 0)
    if (transportAmt > 0 && transportPaidNow && !transportChargeCust) p -= transportAmt
    return p
  }
  function transportStatusMsg() {
    if (!transportAmt || transportAmt <= 0) return ''
    if (mode === 'sale') {
      if (!transportPaidNow && !transportChargeCust) return '🏦 You\'ll record this as a payable to the driver'
      if (!transportPaidNow &&  transportChargeCust) return '📋 Added to customer\'s credit — you\'ll pay driver later'
      if ( transportPaidNow && !transportChargeCust) return 'You paid transport now - not billed to customer'
      if ( transportPaidNow &&  transportChargeCust) return '🔄 You pay now — customer owes you back. Tracked for recovery.'
    } else {
      return transportPaidNow ? 'Transport paid now' : 'Transport will be paid later'
    }
    return ''
  }

  function render() {
    const total = getGrandTotal()
    modal.innerHTML = `
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:1.25rem 1.5rem;background:var(--dark);
        border-radius:20px 20px 0 0;position:sticky;top:0;z-index:10;
      ">
        <div>
          <div style="font-weight:700;color:#fff">Smart OCR Review</div>
          <div style="font-size:0.8125rem;color:rgba(255,255,255,0.4);margin-top:2px">
            Confirm extracted data before saving
          </div>
        </div>
        <button id="ocr-close" style="
          width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);
          display:flex;align-items:center;justify-content:center;
          color:rgba(255,255,255,0.6);cursor:pointer;border:none;
        ">${renderIcon('close', 16)}</button>
      </div>

      <div style="padding:1.5rem">

        <!-- Mode -->
        <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem">
          ${[['sale','Sale','transactions'],['expense','Expense','expenses'],['inventory','Inventory','inventory']].map(([k,l,ic]) => `
            <button data-mode="${k}" class="mode-btn" style="
              display:flex;align-items:center;gap:0.375rem;
              padding:0.5rem 1rem;border-radius:var(--radius-pill);
              font-size:0.875rem;font-weight:600;cursor:pointer;
              border:1.5px solid ${mode===k?'var(--accent)':'var(--border)'};
              background:${mode===k?'var(--teal-50)':'var(--bg-elevated)'};
              color:${mode===k?'var(--accent)':'var(--muted)'};
            ">${renderIcon(ic,14,mode===k?'var(--accent)':'var(--muted)')} ${l}</button>
          `).join('')}
        </div>

        <!-- Customer / Delivery Header -->
        <div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:12px;padding:0.875rem;margin-bottom:1rem">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.5rem">
            ${mode === 'sale' ? 'Customer' : 'Vendor'} &amp; Delivery Info
            ${matchedCustomer ? '<span style="color:var(--accent);font-weight:700;margin-left:0.5rem">âœ“ Returning customer</span>' : ''}
            ${payMethod === 'credit' ? '<span style="color:var(--danger);font-weight:700;margin-left:0.5rem">(required for credit)</span>' : ''}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
              <div style="font-size:0.6875rem;font-weight:600;color:${payMethod==='credit'?'var(--danger)':'var(--muted)'};margin-bottom:3px">👤 ${mode === 'sale' ? 'Name' : 'Vendor Name'}${payMethod==='credit'?' *':''}</div>
              <input class="form-input" id="ocr-cust-name" value="${escHtml(custName)}" placeholder="${mode === 'sale' ? 'Customer' : 'Vendor'} name${payMethod==='credit'?' (required)':''}"
                list="ocr-cust-list" style="font-weight:600;border-color:${payMethod==='credit'&&!custName?'var(--danger)':''}">
              <datalist id="ocr-cust-list">${(customers||[]).map(c=>`<option value="${escHtml(c.name)}">`)}</datalist>
            </div>
            <div style="flex:1;min-width:80px">
              <div style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-bottom:3px">🚗 Targa</div>
              <input class="form-input" id="ocr-cust-targa" value="${escHtml(custTarga)}" placeholder="Plate"
                style="font-weight:700;text-transform:uppercase;font-family:monospace;letter-spacing:1px">
            </div>
            <div style="flex:1;min-width:100px">
              <div style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-bottom:3px">
              <div style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-bottom:3px">📍 Place</div>
              <input class="form-input" id="ocr-cust-place" value="${escHtml(custPlace)}" placeholder="Delivery place">
            </div>
          </div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;font-weight:500;cursor:pointer">
              <input type="checkbox" id="ocr-save-customer" ${saveCustomerCheck?'checked':''}> Save / update customer
            </label>
            <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;font-weight:500;cursor:pointer">
              <input type="checkbox" id="ocr-remember-place" ${rememberPlaceCheck?'checked':''}> Remember delivery place
            </label>
          </div>
        </div>

        <!-- Date -->
        <div style="margin-bottom:1rem">
          <label class="form-label">Date</label>
          <input type="date" class="form-input" id="ocr-date" value="${docDate}">
        </div>

        <!-- Payment (all modes) -->
        <div style="margin-bottom:1rem">
          <label class="form-label">Payment</label>

          <!-- Row 1: Cash + Credit -->
          <div style="display:flex;gap:0.375rem;flex-wrap:wrap;margin-top:0.375rem;margin-bottom:0.5rem">
            ${['cash','credit'].map(pm => `
              <button data-pay="${pm}" class="pay-btn" style="
                padding:0.3rem 0.875rem;border-radius:var(--radius-pill);
                font-size:0.8125rem;font-weight:600;cursor:pointer;
                border:1.5px solid ${payMethod===pm?'var(--accent)':'var(--border)'};
                background:${payMethod===pm?'var(--teal-50)':'var(--bg-elevated)'};
                color:${payMethod===pm?'var(--accent)':'var(--muted)'};
              ">${PAY_LABELS[pm]}</button>
            `).join('')}
          </div>

          <!-- Till sub-selector (only when Cash selected) -->
          ${(() => {
            const tills = accounts.filter(a => a.account_type === 'till')
            if (payMethod !== 'cash') return ''
            return `
              <div style="
                margin-bottom:0.5rem;padding:0.625rem 0.75rem;
                background:var(--bg-subtle);border-radius:10px;border:1px solid var(--border);
              ">
                <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
                  text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.375rem">Cash Account</div>
                <div style="display:flex;gap:0.375rem;flex-wrap:wrap">
                  ${tills.length > 0
                    ? tills.map(a => `
                        <button data-till="${a.id}" class="till-btn" style="
                          padding:0.3rem 0.75rem;border-radius:var(--radius-pill);
                          font-size:0.8125rem;font-weight:600;cursor:pointer;
                          border:1.5px solid ${accountId===a.id?'var(--accent)':'var(--border)'};
                          background:${accountId===a.id?'var(--teal-50)':'var(--bg-elevated)'};
                          color:${accountId===a.id?'var(--accent)':'var(--muted)'};
                        ">${escHtml(a.account_name)}</button>
                      `).join('')
                    : `<span style="font-size:0.8125rem;color:var(--muted)">No till accounts — add one in Settings</span>`
                  }
                </div>
              </div>
            `
          })()}

          <!-- Bank accounts row -->
          <div style="display:flex;gap:0.375rem;flex-wrap:wrap;align-items:center">
            ${(() => {
              const banks = accounts.filter(a => a.account_type === 'bank')
              const active = payMethod === 'bank_transfer'
              return banks.map(a => `
                <button data-bank="${a.id}" class="bank-btn" style="
                  padding:0.3rem 0.875rem;border-radius:var(--radius-pill);
                  font-size:0.8125rem;font-weight:600;cursor:pointer;
                  border:1.5px solid ${active && accountId===a.id?'var(--accent)':'var(--border)'};
                  background:${active && accountId===a.id?'var(--teal-50)':'var(--bg-elevated)'};
                  color:${active && accountId===a.id?'var(--accent)':'var(--muted)'};
                ">${escHtml(a.bank_name || a.account_name)}</button>
              `).join('')
            })()}
            <button id="ocr-add-bank" style="
              width:28px;height:28px;border-radius:50%;
              background:var(--bg-subtle);color:var(--muted);
              display:flex;align-items:center;justify-content:center;
              border:1px solid var(--border);cursor:pointer;
              font-size:1.125rem;font-weight:700;flex-shrink:0;
            " title="Add bank account">+</button>
          </div>
        </div>

        <!-- Transport Fee -->
        ${(() => {
          if (!transportAmt && !transport?.detected) return ''
          const tMsg = transportStatusMsg()
          const showCharge = mode === 'sale'
          return `
            <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:12px;padding:0.875rem;margin-bottom:1rem">
              <div style="font-size:0.6875rem;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.5rem">
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
                <div style="flex:1;min-width:110px">
                  <div style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-bottom:3px">Amount (ETB)</div>
                  <input type="number" class="form-input" id="ocr-transport-amt" value="${transportAmt||''}" placeholder="0.00" min="0" step="0.01" inputmode="decimal">
                </div>
                <div style="flex:2;min-width:140px">
                  <div style="font-size:0.6875rem;font-weight:600;color:var(--muted);margin-bottom:3px">Worker / Driver</div>
                  <input class="form-input" id="ocr-transport-worker" value="${escHtml(transportWorker)}" placeholder="Optional">
                </div>
              </div>
              <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:${tMsg?'0.5rem':'0'}">
                <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;font-weight:600;cursor:pointer">
                  <input type="checkbox" id="ocr-transport-paid" ${transportPaidNow?'checked':''}> Paid Now?
                </label>
                ${showCharge ? `
                  <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;font-weight:600;cursor:pointer">
                    <input type="checkbox" id="ocr-transport-charge" ${transportChargeCust?'checked':''}> Charge Customer?
                  </label>
                ` : ''}
              </div>
              ${tMsg ? `<div style="font-size:0.8125rem;font-weight:600;color:#92400E;padding:0.375rem 0.5rem;background:rgba(255,255,255,0.7);border-radius:6px">${tMsg}</div>` : ''}
            </div>
          `
        })()}

        <!-- Line items header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <div style="font-weight:700">Line Items</div>
          <button id="ocr-add-row" class="btn btn-outline btn-sm">+ Add Row</button>
        </div>

        <!-- Items -->
        <div id="ocr-items" style="display:flex;flex-direction:column;gap:0.625rem">
          ${items.map((item,i) => rowHtml(item,i)).join('')}
        </div>

        <!-- Totals -->
        <div style="margin-top:1.25rem;padding-top:1rem;border-top:1.5px solid var(--border)">
          <div style="display:flex;justify-content:space-between;font-size:0.875rem;color:var(--muted);margin-bottom:0.375rem">
            <span>Goods Subtotal</span><span>${fmt(getGoodsTotal())} ETB</span>
          </div>
          ${transportAmt > 0 ? `
            <div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:0.375rem;color:#92400E;font-weight:600">
              <span>Transport ${mode==='sale'&&transportChargeCust?'(billed to customer)':transportPaidNow?'(you pay)':'(payable)'}</span>
              <span>+${fmt(transportAmt)} ETB</span>
            </div>
          ` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:0.625rem;border-top:1px solid var(--border)">
            <span style="font-weight:700">${mode==='sale'?'Customer Total':mode==='expense'?'Expense Total':'Inventory Cost'}</span>
            <span id="ocr-grand-total" style="
              font-size:1.375rem;font-weight:800;color:var(--accent);letter-spacing:-0.5px
            ">${fmt(getCustomerTotal())} ETB</span>
          </div>
          ${mode==='sale' ? `
            <div style="display:flex;justify-content:space-between;font-size:0.8125rem;font-weight:700;margin-top:0.375rem;color:${getEstimatedProfit()>=0?'var(--accent)':'var(--danger)'}">
              <span>Est. Profit</span>
              <span>${getEstimatedProfit()>=0?'+':''}${fmt(getEstimatedProfit())} ETB</span>
            </div>
          ` : ''}
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:0.75rem;margin-top:1.25rem">
          <button class="btn btn-outline" id="ocr-cancel" style="flex:1;justify-content:center">Cancel</button>
          <button class="btn btn-primary" id="ocr-submit" style="flex:2;justify-content:center;font-size:1rem">
            ${renderIcon('check',18)}
            Register ${mode==='sale'?'Sale':mode==='expense'?'Expense':'Inventory'}
          </button>
        </div>
      </div>
    `
    bind()
  }

  function rowHtml(item, i) {
    const qty   = Number(item.qty)   || 1
    const price = Number(item.price) || 0
    const total = Number(item.total) || (qty * price)  // prefer stored AI total over recalculation
    return `
      <div data-row="${i}" style="
        background:var(--bg-subtle);border:1px solid var(--border);
        border-radius:12px;padding:0.875rem;
      ">
        <div style="display:flex;gap:0.5rem;margin-bottom:0.625rem">
          <input type="text" class="form-input row-name" data-idx="${i}"
            value="${escHtml(item.name)}" placeholder="Product name"
            style="flex:1;font-weight:500">
          <button class="row-del btn btn-ghost btn-sm" data-idx="${i}"
            style="color:var(--danger);flex-shrink:0">
            ${renderIcon('close',13)}
          </button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem">
          <div>
            <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
              text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">QTY</div>
            <input type="number" class="form-input row-qty" data-idx="${i}"
              value="${qty}" min="0.01" step="0.01" inputmode="decimal"
              style="font-weight:600;text-align:center">
          </div>
          <div>
            <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
              text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">UNIT PRICE (ETB)</div>
            <input type="number" class="form-input row-price" data-idx="${i}"
              value="${price>0?price:''}" placeholder="0.00" min="0" step="0.01" inputmode="decimal"
              style="font-weight:600;color:var(--accent)">
          </div>
          <div>
            <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);
              text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">TOTAL (ETB)</div>
            <input type="number" class="form-input row-total" data-idx="${i}"
              value="${total>0?total:''}" placeholder="0.00" readonly
              style="font-weight:700;background:var(--bg-hover)">
          </div>
        </div>
        ${(() => {
          const tags = []
          if (item.matched) {
            tags.push(`<div style="display:inline-flex;align-items:center;gap:0.3rem;margin-top:0.5rem;font-size:0.75rem;font-weight:600;color:var(--teal-700);background:var(--teal-50);border:1px solid var(--teal-200);border-radius:var(--radius-pill);padding:0.2rem 0.5rem;">${renderIcon('check',11,'var(--teal-700)')} Matched: ${escHtml(item.matched.item_name)}</div>`)
            if (mode === 'sale') {
              const cost   = Number(item.matched.unit_cost) || 0
              const margin = cost > 0 ? ((Number(item.price)||0) - cost) * (Number(item.qty)||1) : null
              if (margin !== null) {
                const pct  = cost > 0 && Number(item.price) > 0 ? (((Number(item.price)-cost)/Number(item.price))*100).toFixed(1) : ''
                const col  = margin >= 0 ? '#15803d' : 'var(--danger)'
                tags.push(`<div style="display:inline-flex;align-items:center;gap:0.25rem;margin-top:0.25rem;font-size:0.75rem;font-weight:600;color:${col};">${margin>=0?'Margin':'LOSS'}: ${margin>=0?'+':''}${fmt(margin)} ETB${pct?' ('+pct+'%)':''}</div>`)
              }
            }
          } else if (mode === 'sale') {
            tags.push(`<div style="font-size:0.75rem;color:var(--muted);margin-top:0.375rem">âš  No inventory match</div>`)
          }
          return tags.join('')
        })()}
      </div>
    `
  }

  function bind() {
    modal.querySelector('#ocr-close')?.addEventListener('click', close)
    modal.querySelector('#ocr-cancel')?.addEventListener('click', close)
    overlay.addEventListener('click', e => { if (e.target===overlay) close() })

    modal.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => { mode=b.dataset.mode; render() }))

    modal.querySelectorAll('.pay-btn').forEach(b => b.addEventListener('click', () => {
      payMethod = b.dataset.pay
      if (payMethod === 'cash') {
        const firstTill = accounts.find(a => a.account_type === 'till')
        accountId = firstTill ? firstTill.id : ''
      } else if (payMethod === 'credit') {
        accountId = ''
      }
      render()
    }))

    modal.querySelectorAll('.till-btn').forEach(b => b.addEventListener('click', () => {
      accountId = b.dataset.till
      render()
    }))

    modal.querySelectorAll('.bank-btn').forEach(b => b.addEventListener('click', () => {
      payMethod  = 'bank_transfer'
      accountId  = b.dataset.bank
      render()
    }))

    modal.querySelector('#ocr-add-bank')?.addEventListener('click', openAddBankModal)
    modal.querySelector('#ocr-date')?.addEventListener('change', e => { docDate=e.target.value })
    modal.querySelector('#ocr-cust-name')?.addEventListener('input',  e => { custName  = e.target.value })
    modal.querySelector('#ocr-cust-targa')?.addEventListener('input', e => { custTarga = e.target.value.toUpperCase() })
    modal.querySelector('#ocr-cust-place')?.addEventListener('input', e => { custPlace = e.target.value })
    modal.querySelector('#ocr-save-customer')?.addEventListener('change',  e => { saveCustomerCheck  = e.target.checked })
    modal.querySelector('#ocr-remember-place')?.addEventListener('change', e => { rememberPlaceCheck = e.target.checked })
    modal.querySelector('#ocr-transport-amt')?.addEventListener('input', e => {
      const clean = sanitizeNumericInput(e.target.value)
      if (e.target.value !== clean) e.target.value = clean
      transportAmt = Number(clean) || 0; render()
    })
    modal.querySelector('#ocr-transport-worker')?.addEventListener('input', e => { transportWorker = e.target.value })
    modal.querySelector('#ocr-transport-paid')?.addEventListener('change', e => {
      transportPaidNow = e.target.checked; render()
    })
    modal.querySelector('#ocr-transport-charge')?.addEventListener('change', e => {
      transportChargeCust = e.target.checked; render()
    })

    modal.querySelector('#ocr-add-row')?.addEventListener('click', () => {
      items.push({ name:'', qty:1, price:null, total:null, matched:null })
      const container = modal.querySelector('#ocr-items')
      const div = document.createElement('div')
      div.innerHTML = rowHtml(items[items.length-1], items.length-1)
      container.appendChild(div.firstElementChild)
      bindRows()
    })

    modal.querySelector('#ocr-submit')?.addEventListener('click', submit)

    bindRows()
  }

  function bindRows() {
    modal.querySelectorAll('.row-del').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.idx)
        items.splice(i, 1)
        if (!items.length) items.push({ name:'',qty:1,price:null,total:null,matched:null })
        modal.querySelector('#ocr-items').innerHTML = items.map((it,idx)=>rowHtml(it,idx)).join('')
        bindRows()
        refreshTotal()
      })
    })

    modal.querySelectorAll('.row-name').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.idx)
        if (items[i]) items[i].name = inp.value
      })
    })

    modal.querySelectorAll('.row-qty').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.idx)
        if (!items[i]) return
        const clean = sanitizeNumericInput(inp.value)
        if (inp.value !== clean) inp.value = clean
        items[i].qty = parseFloat(clean) || 0
        updateRow(i)
      })
    })

    modal.querySelectorAll('.row-price').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.idx)
        if (!items[i]) return
        const clean = sanitizeNumericInput(inp.value)
        if (inp.value !== clean) inp.value = clean
        items[i].price = parseFloat(clean) || 0
        updateRow(i)
      })
    })
  }

  function updateRow(i) {
    const qty   = Number(items[i].qty)   || 0
    const price = Number(items[i].price) || 0
    const total = qty * price
    items[i].total = total

    // Update total field in-place
    const totalInp = modal.querySelector(`.row-total[data-idx="${i}"]`)
    if (totalInp) totalInp.value = total > 0 ? total.toFixed(2) : ''

    refreshTotal()
  }

  function refreshTotal() {
    const el = modal.querySelector('#ocr-grand-total')
    if (el) el.textContent = fmt(getCustomerTotal()) + ' ETB'
  }

  // â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function submit() {
    const valid = items.filter(i => i.name?.trim())
    if (!valid.length) { showToast('Add at least one item','error'); return }

    const isCredit = payMethod === 'credit'

    // Read live input values before submit
    custName    = modal.querySelector('#ocr-cust-name')?.value?.trim()  || custName

    if (isCredit && !custName) {
      showToast(`${mode === 'sale' ? 'Customer' : 'Vendor'} name is required for credit transactions`, 'error')
      modal.querySelector('#ocr-cust-name')?.focus()
      return
    }
    custTarga   = (modal.querySelector('#ocr-cust-targa')?.value?.trim() || custTarga).toUpperCase()
    custPlace   = modal.querySelector('#ocr-cust-place')?.value?.trim()  || custPlace
    transportAmt    = Number(modal.querySelector('#ocr-transport-amt')?.value)    || transportAmt
    transportWorker = modal.querySelector('#ocr-transport-worker')?.value?.trim() || transportWorker

    const btn = modal.querySelector('#ocr-submit')
    btn.textContent = 'Saving...'
    btn.disabled    = true

    const date     = modal.querySelector('#ocr-date')?.value || docDate
    const accId    = accountId
    const totalAmt = getGoodsTotal()

    try {
      let saleId = null, creditSaleId = null
      if (mode === 'sale') {
        const res = await doSale(valid, date, accId, totalAmt, isCredit, custName, null)
        saleId = res?.saleId; creditSaleId = res?.creditSaleId
      } else if (mode === 'expense') {
        await doExpense(valid, date, accId, totalAmt, isCredit, custName, null)
      } else {
        await doInventory(valid, date, accId, totalAmt, isCredit, custName, null)
      }

      // â”€â”€ Transport fee handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (transportAmt > 0) {
        const tfPayload = {
          store_id:              currentStore?.id,
          entity_type:          mode,
          entity_id:            saleId || logId,
          credit_sale_id:       creditSaleId || null,
          amount:               transportAmt,
          worker_name:          transportWorker || null,
          paid_now:             transportPaidNow,
          paid_from_account_id: transportPaidNow ? (accId || null) : null,
          charge_customer:      mode === 'sale' ? transportChargeCust : false,
        }
        const { data: tfRow } = await supabase.from('transport_fees').insert(tfPayload).select('id').single()

        if (transportPaidNow) {
          await supabase.from('expenses').insert({
            store_id:        currentStore?.id,
            cash_account_id: accId || null,
            expense_date:    date,
            amount:          transportAmt,
            category:        'transport_fee',
            description:     `Transport${transportWorker ? ' – ' + transportWorker : ''}`,
            source:          'ocr',
            ocr_log_id:      logId,
          })
        } else if (!transportChargeCust) {
          await supabase.from('vendor_debts').insert({
            store_id:    currentStore?.id,
            vendor_name: transportWorker || 'Transport Driver',
            amount_owed: transportAmt,
            amount_paid: 0,
            status:      'unpaid',
            notes:       'Transport fee from OCR scan',
          })
        }

        if (mode === 'sale' && transportChargeCust && creditSaleId) {
          await supabase.from('credit_sales').update({
            transport_fee:            transportAmt,
            transport_charge_customer: true,
          }).eq('id', creditSaleId)
        }
      }

      // â”€â”€ Plate history upsert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (custTarga) {
        await supabase.from('plate_history').upsert({
          plate_number:    custTarga,
          entity_type:     mode,
          entity_id:       saleId || logId,
          customer_name:   custName  || null,
          last_seen_place: custPlace || null,
          last_seen_at:    new Date().toISOString(),
        }, { onConflict: 'plate_number' })
      }

      // â”€â”€ Customer memory upsert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (saveCustomerCheck && custName) {
        const { data: existCust } = await supabase.from('customers')
          .select('id').eq('store_id', currentStore?.id).ilike('name', custName).maybeSingle()
        const custPayload = {
          store_id:  currentStore?.id,
          name:      custName,
          last_targa: custTarga  || null,
          ...(rememberPlaceCheck && custPlace ? { default_place: custPlace } : {}),
        }
        if (existCust?.id) {
          await supabase.from('customers').update(custPayload).eq('id', existCust.id)
        } else {
          await supabase.from('customers').insert(custPayload)
        }
      }

      await supabase.from('ocr_logs').update({
        status:            'applied',
        destination_table: mode==='inventory'?'inventory_items':mode,
        user_edited_data:  { items:valid, date, totalAmt, mode, custName },
      }).eq('id', logId)

      try { await audit.action('ocr_applied', { logId, mode, totalAmt }) } catch(_){}

      showToast('Saved successfully', 'success')
      close()
      setTimeout(() => navigate(window.location.pathname), 500)

    } catch(err) {
      console.error('OCR submit:', err)
      showToast(`Failed: ${err.message}`, 'error')
      btn.innerHTML = `${renderIcon('check',18)} Register ${mode==='sale'?'Sale':mode==='expense'?'Expense':'Inventory'}`
      btn.disabled  = false
    }
  }

  async function doSale(valid, date, accId, totalAmt, isCredit, partnerName, partnerPhone) {
    const customerTotal = getCustomerTotal()
    const { data: sale, error } = await supabase.from('sales').insert({
      store_id:        currentStore?.id,
      cash_account_id: isCredit ? null : (accId||null),
      sale_date:       date,
      total_amount:    customerTotal,
      payment_method:  payMethod,
      source:          'ocr',
      ocr_log_id:      logId,
      transport_fee:   transportAmt > 0 ? transportAmt : null,
      delivery_place:  custPlace  || null,
      targa:           custTarga  || null,
      payment_bank:    paymentBank || null,
    }).select().single()

    if (error) throw error

    for (const item of valid) {
      await supabase.from('sale_items').insert({
        sale_id:            sale.id,
        item_name_snapshot: item.name,
        quantity:           item.qty   || 1,
        unit_price:         item.price || 0,
      })
    }

    const saleItemsForCheck = valid.map(i => ({
      item_name_snapshot: i.name,
      quantity:           i.qty  || 1,
      unit_price:         i.price || 0,
    }))

    setTimeout(async () => {
      const resolutions = await checkSaleAgainstInventory(saleItemsForCheck, currentStore?.id)
      if (resolutions.length > 0) {
        openInventoryResolverModal(resolutions, sale.id)
      }
    }, 1500)

    const name = partnerName || custName
    let custId = null, cSaleId = null
    if (name) {
      const { data: existing } = await supabase.from('customers')
        .select('id').eq('store_id', currentStore?.id).ilike('name', name).maybeSingle()
      custId = existing?.id
      if (!custId) {
        const { data: nc } = await supabase.from('customers').insert({
          store_id: currentStore?.id, name, phone: partnerPhone || null,
        }).select('id').single()
        custId = nc?.id
      }
    }

    if (custId) {
      await supabase.from('sales').update({ customer_id: custId }).eq('id', sale.id)
    }

    if (isCredit && custId) {
      const { data: cs } = await supabase.from('credit_sales').insert({
        store_id:                  currentStore?.id,
        sale_id:                   sale.id,
        customer_id:               custId,
        amount_owed:               customerTotal,
        status:                    'unpaid',
        transport_fee:             transportAmt > 0 && transportChargeCust ? transportAmt : 0,
        transport_charge_customer: mode === 'sale' && transportChargeCust,
      }).select('id').single()
      cSaleId = cs?.id
    }

    return { saleId: sale.id, creditSaleId: cSaleId }
  }

  async function doExpense(valid, date, accId, totalAmt, isCredit, vendorName, vendorPhone) {
    const { error } = await supabase.from('expenses').insert({
      store_id:        currentStore?.id,
      cash_account_id: isCredit ? null : (accId||null),
      expense_date:    date,
      amount:          totalAmt,
      description:     valid.map(i=>i.name).join(', '),
      source:          'ocr',
      ocr_log_id:      logId,
      transport_fee:   transportAmt > 0 ? transportAmt : null,
      targa:           custTarga  || null,
      delivery_place:  custPlace  || null,
    })
    if (error) throw error

    if (isCredit && vendorName) {
      await supabase.from('vendor_debts').insert({
        store_id: currentStore?.id,
        vendor_name: vendorName,
        amount_owed: totalAmt,
        amount_paid: 0,
        status: 'unpaid',
        notes: 'Expense logged from OCR scanner'
      })
    }
  }

  async function doInventory(valid, date, accId, totalAmt, isCredit, vendorName, vendorPhone) {
    const accName = accId ? (accounts.find(a => a.id === accId)?.account_name || null) : null

    for (const item of valid) {
      let matched = (inventoryItems || []).find(ii =>
        ii.item_name.toLowerCase() === item.name.toLowerCase()
      ) || (inventoryItems?.length
        ? fuzzyMatch(item.name, inventoryItems, { key: 'item_name', threshold: 0.7, limit: 1 })[0]
        : null)

      let itemId = matched?.id || null

      if (!itemId) {
        // Live DB check to prevent duplicates if OCR is run multiple times
        const { data: dbItem } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('store_id', currentStore?.id)
          .ilike('item_name', item.name)
          .limit(1)
          .maybeSingle()
        itemId = dbItem?.id || null
      }

      if (!itemId) {
        const { data: newItem, error: newErr } = await supabase.from('inventory_items').insert({
          store_id:      currentStore?.id,
          item_name:     item.name,
          unit_cost:     item.price || null,
          selling_price: item.price || null,
          supplier:      vendorName || null,
        }).select('id').single()
        if (newErr) throw newErr
        itemId = newItem.id
        // Update in-memory list so subsequent items in this run also find it
        if (inventoryItems) inventoryItems.push({ id: itemId, item_name: item.name })
      }

      const { error } = await supabase.rpc('add_stock_batch', {
        p_store_id:          currentStore?.id,
        p_item_id:           itemId,
        p_quantity:          item.qty || 1,
        p_unit_cost:         item.price || 0,
        p_purchase_date:     date,
        p_supplier_id:       null,
        p_supplier_name:     vendorName || null,
        p_cash_account_id:   (!isCredit && accId) ? accId : null,
        p_cash_account_name: (!isCredit && accId) ? accName : null,
        p_transport_fee:     transportAmt || 0,
        p_targa:             custTarga || null,
        p_delivery_place:    custPlace || null,
        p_notes:             'Added via OCR scan',
      })
      if (error) throw error
    }

    if (isCredit && vendorName) {
      await supabase.from('vendor_debts').insert({
        store_id:    currentStore?.id,
        vendor_name: vendorName,
        amount_owed: totalAmt,
        amount_paid: 0,
        status:      'unpaid',
        notes:       'Inventory Purchase logged from OCR scanner',
      })
    } else if (accId && !isCredit && totalAmt > 0) {
      await supabase.from('expenses').insert({
        store_id:        currentStore?.id,
        cash_account_id: accId,
        expense_date:    date,
        amount:          totalAmt,
        description:     ('Inventory Purchase' + (vendorName ? ' from ' + vendorName : '')).trim(),
        source:          'ocr',
        ocr_log_id:      logId,
      })
    }
  }

  async function openAddBankModal() {
    const bankOverlay = document.createElement('div')
    bankOverlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
      z-index:500;padding:1rem;
    `

    const bankModal = document.createElement('div')
    bankModal.style.cssText = `
      background:var(--bg-elevated);border-radius:16px;
      width:100%;max-width:400px;
      box-shadow:var(--shadow-lg);border:1px solid var(--border);
      overflow:hidden;
    `

    bankModal.innerHTML = `
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:1rem 1.25rem;background:var(--dark);
      ">
        <div style="font-weight:700;color:#fff;font-size:0.9375rem">Add Payment Account</div>
        <button id="bm-close" style="
          width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);
          display:flex;align-items:center;justify-content:center;
          color:rgba(255,255,255,0.7);cursor:pointer;border:none;
        ">${renderIcon('close', 14)}</button>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:0.875rem">
        <div>
          <label class="form-label">Account Name *</label>
          <input class="form-input" id="bm-name" placeholder="e.g. Main Till, CBE Account">
        </div>
        <div>
          <label class="form-label">Type</label>
          <select class="form-input" id="bm-type">
            <option value="till">
            <option value="bank">🏦 Bank Account</option>
          </select>
        </div>
        <div id="bm-bank-fields" style="display:none;flex-direction:column;gap:0.625rem">
          <div>
            <label class="form-label">Bank Name</label>
            <input class="form-input" id="bm-bank-name" placeholder="e.g. Commercial Bank of Ethiopia">
          </div>
          <div>
            <label class="form-label">Account Number</label>
            <input class="form-input" id="bm-acc-num" placeholder="e.g. 1000123456789">
          </div>
        </div>
        <div>
          <label class="form-label">Opening Balance (ETB)</label>
          <input class="form-input" type="number" id="bm-balance" value="0" min="0" step="0.01" inputmode="decimal">
        </div>
        <div style="display:flex;gap:0.625rem;margin-top:0.25rem">
          <button class="btn btn-outline" id="bm-cancel" style="flex:1;justify-content:center">Cancel</button>
          <button class="btn btn-primary" id="bm-save" style="flex:2;justify-content:center">Save Account</button>
        </div>
      </div>
    `

    bankOverlay.appendChild(bankModal)
    document.body.appendChild(bankOverlay)

    const closeBank = () => bankOverlay.remove()
    bankModal.querySelector('#bm-close').addEventListener('click', closeBank)
    bankModal.querySelector('#bm-cancel').addEventListener('click', closeBank)
    bankOverlay.addEventListener('click', e => { if (e.target === bankOverlay) closeBank() })

    const typeSelect  = bankModal.querySelector('#bm-type')
    const bankFields  = bankModal.querySelector('#bm-bank-fields')
    typeSelect.addEventListener('change', () => {
      bankFields.style.display = typeSelect.value === 'bank' ? 'flex' : 'none'
    })

    bankModal.querySelector('#bm-save').addEventListener('click', async () => {
      const name = bankModal.querySelector('#bm-name').value.trim()
      if (!name) { showToast('Account name is required', 'error'); return }

      const type     = typeSelect.value
      const balance  = Number(bankModal.querySelector('#bm-balance').value) || 0
      const bankName = type === 'bank' ? (bankModal.querySelector('#bm-bank-name').value.trim() || null) : null
      const bankNum  = type === 'bank' ? (bankModal.querySelector('#bm-acc-num').value.trim()  || null) : null

      const saveBtn = bankModal.querySelector('#bm-save')
      saveBtn.textContent = 'Saving...'
      saveBtn.disabled    = true

      const { data: newAccount, error } = await supabase.from('cash_accounts').insert({
        store_id:       currentStore?.id,
        account_name:   name,
        account_type:   type,
        balance,
        bank_name:      bankName,
        account_number: bankNum,
      }).select('id, account_name, account_type, bank_name').single()

      if (error) {
        showToast('Failed to create account: ' + error.message, 'error')
        saveBtn.textContent = 'Save Account'
        saveBtn.disabled    = false
        return
      }

      accounts  = [...accounts, newAccount]
      accountId = newAccount.id
      payMethod = newAccount.account_type === 'bank' ? 'bank_transfer' : 'cash'
      showToast('Account created', 'success')
      closeBank()
      render()
    })
  }

  function close() {
    if (modalEl) { modalEl.remove(); modalEl = null }
  }

  render()
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PAY_LABELS = {
  cash:'Cash', credit:'Credit', bank_transfer:'Bank',
  telebirr:'Telebirr', cbe_birr:'CBE Birr', other:'Other',
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET',{minimumFractionDigits:2,maximumFractionDigits:2})
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function showToast(msg, type='info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) { wrap=document.createElement('div'); wrap.className='toast-container'; document.body.appendChild(wrap) }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 3500)
}