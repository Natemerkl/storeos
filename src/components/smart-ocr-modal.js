import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { renderIcon } from './icons.js'
import { fuzzyMatch } from '../utils/fuzzy.js'
import { audit } from '../utils/audit.js'

let modalEl = null

export async function openSmartOCRModal(logId) {
  if (modalEl) modalEl.remove()

  const { currentStore } = appStore.getState()

  const { data: log, error } = await supabase
    .from('ocr_logs').select('*').eq('id', logId).single()

  if (error || !log) { alert('Could not load scan data'); return }

  const [
    { data: accounts },
    { data: inventoryItems },
    { data: customers },
  ] = await Promise.all([
    supabase.from('cash_accounts').select('id, name').eq('store_id', currentStore?.id),
    supabase.from('inventory_items').select('id, item_name, selling_price, unit_cost').eq('store_id', currentStore?.id),
    supabase.from('customers').select('id, name, phone').eq('store_id', currentStore?.id),
  ])

  // ── Parse line items from OCR data ─────────────────────
  const rawItems = log.parsed_data?.line_items || []

  let items = rawItems.map(i => {
    const qty = Number(i.quantity) || 1

    // Price priority: unit_price → back-calculate from total
    let unitPrice = null
    if (Number(i.unit_price) > 0) {
      unitPrice = Number(i.unit_price)
    } else if (Number(i.total) > 0) {
      unitPrice = Number(i.total) / qty
    }

    const matched = inventoryItems?.length
      ? fuzzyMatch(i.description, inventoryItems, { key: 'item_name', threshold: 0.6, limit: 1 })[0]
      : null

    return {
      name:    i.description || '',
      qty:     qty,
      price:   unitPrice,
      total:   unitPrice != null ? qty * unitPrice : null,
      matched: matched || null,
    }
  })

  if (!items.length) {
    items.push({ name: '', qty: 1, price: null, total: null, matched: null })
  }

  let mode      = 'sale'
  let payMethod = 'cash'
  let accountId = accounts?.[0]?.id || ''
  let docDate   = log.parsed_data?.date || new Date().toISOString().split('T')[0]

  // ── Modal shell ─────────────────────────────────────────
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

  function getGrandTotal() {
    return items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0)
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

        <!-- Date + Account -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
          <div>
            <label class="form-label">Date</label>
            <input type="date" class="form-input" id="ocr-date" value="${docDate}">
          </div>
          <div>
            <label class="form-label">Cash Account</label>
            <select class="form-input" id="ocr-account">
              ${(accounts||[]).map(a=>`<option value="${a.id}" ${a.id===accountId?'selected':''}>${a.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Payment (sale only) -->
        ${mode==='sale'?`
          <div style="margin-bottom:1rem">
            <label class="form-label">Payment</label>
            <div style="display:flex;gap:0.375rem;flex-wrap:wrap;margin-top:0.375rem">
              ${['cash','credit','bank_transfer','telebirr','cbe_birr','other'].map(pm=>`
                <button data-pay="${pm}" class="pay-btn" style="
                  padding:0.3rem 0.75rem;border-radius:var(--radius-pill);
                  font-size:0.8125rem;font-weight:600;cursor:pointer;
                  border:1.5px solid ${payMethod===pm?'var(--accent)':'var(--border)'};
                  background:${payMethod===pm?'var(--teal-50)':'var(--bg-elevated)'};
                  color:${payMethod===pm?'var(--accent)':'var(--muted)'};
                ">${PAY_LABELS[pm]||pm}</button>
              `).join('')}
            </div>
          </div>
          <div style="margin-bottom:1rem">
            <details>
              <summary style="font-size:0.8125rem;color:var(--muted);cursor:pointer">
                ▶ + Customer info (optional)
              </summary>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem">
                <div>
                  <label class="form-label">Name</label>
                  <input class="form-input" id="ocr-cust-name" placeholder="Optional" list="ocr-cl">
                  <datalist id="ocr-cl">${(customers||[]).map(c=>`<option value="${c.name}">`).join('')}</datalist>
                </div>
                <div>
                  <label class="form-label">Phone</label>
                  <input class="form-input" id="ocr-cust-phone" placeholder="Optional">
                </div>
              </div>
            </details>
          </div>
        `:''}

        <!-- Line items header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <div style="font-weight:700">Line Items</div>
          <button id="ocr-add-row" class="btn btn-outline btn-sm">+ Add Row</button>
        </div>

        <!-- Items -->
        <div id="ocr-items" style="display:flex;flex-direction:column;gap:0.625rem">
          ${items.map((item,i) => rowHtml(item,i)).join('')}
        </div>

        <!-- Grand total -->
        <div style="
          display:flex;justify-content:space-between;align-items:center;
          margin-top:1.25rem;padding-top:1rem;border-top:1.5px solid var(--border);
        ">
          <span style="font-weight:700">Total</span>
          <span id="ocr-grand-total" style="
            font-size:1.375rem;font-weight:800;color:var(--accent);letter-spacing:-0.5px
          ">${fmt(total)} ETB</span>
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
    const total = qty * price
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
        ${item.matched?`
          <div style="display:inline-flex;align-items:center;gap:0.3rem;margin-top:0.5rem;
            font-size:0.75rem;font-weight:600;color:var(--teal-700);background:var(--teal-50);
            border:1px solid var(--teal-200);border-radius:var(--radius-pill);padding:0.2rem 0.5rem;">
            ${renderIcon('check',11,'var(--teal-700)')} Matched: ${escHtml(item.matched.item_name)}
          </div>
        `:''}
      </div>
    `
  }

  function bind() {
    modal.querySelector('#ocr-close')?.addEventListener('click', close)
    modal.querySelector('#ocr-cancel')?.addEventListener('click', close)
    overlay.addEventListener('click', e => { if (e.target===overlay) close() })

    modal.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => { mode=b.dataset.mode; render() }))
    modal.querySelectorAll('.pay-btn').forEach(b  => b.addEventListener('click', () => { payMethod=b.dataset.pay; render() }))

    modal.querySelector('#ocr-date')?.addEventListener('change', e => { docDate=e.target.value })
    modal.querySelector('#ocr-account')?.addEventListener('change', e => { accountId=e.target.value })

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
        items[i].qty = parseFloat(inp.value) || 0
        updateRow(i)
      })
    })

    // KEY FIX: price inputs update in-place — no re-render = keyboard stays open
    modal.querySelectorAll('.row-price').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.idx)
        if (!items[i]) return
        items[i].price = parseFloat(inp.value) || 0
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
    if (el) el.textContent = fmt(getGrandTotal()) + ' ETB'
  }

  // ── Submit ──────────────────────────────────────────────
  async function submit() {
    const valid = items.filter(i => i.name?.trim())
    if (!valid.length) { showToast('Add at least one item','error'); return }

    const btn = modal.querySelector('#ocr-submit')
    btn.textContent = 'Saving...'
    btn.disabled    = true

    const date     = modal.querySelector('#ocr-date')?.value || docDate
    const accId    = modal.querySelector('#ocr-account')?.value || accountId
    const totalAmt = getGrandTotal()

    try {
      if (mode === 'sale') {
        await doSale(valid, date, accId, totalAmt)
      } else if (mode === 'expense') {
        await doExpense(valid, date, accId, totalAmt)
      } else {
        await doInventory(valid)
      }

      await supabase.from('ocr_logs').update({
        status:            'applied',
        destination_table: mode==='inventory'?'inventory_items':mode,
        user_edited_data:  { items:valid, date, totalAmt, mode },
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

  async function doSale(valid, date, accId, totalAmt) {
    const isCredit  = payMethod === 'credit'
    const custName  = modal.querySelector('#ocr-cust-name')?.value?.trim()
    const custPhone = modal.querySelector('#ocr-cust-phone')?.value?.trim()

    const { data: sale, error } = await supabase.from('sales').insert({
      store_id:        currentStore?.id,
      cash_account_id: isCredit ? null : (accId||null),
      sale_date:       date,
      total_amount:    totalAmt,
      payment_method:  payMethod,
      source:          'ocr',
      ocr_log_id:      logId,
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

    if (isCredit && custName) {
      const { data: existing } = await supabase.from('customers')
        .select('id').eq('store_id', currentStore?.id).ilike('name', custName).maybeSingle()

      let custId = existing?.id
      if (!custId) {
        const { data: nc } = await supabase.from('customers').insert({
          store_id: currentStore?.id, name: custName, phone: custPhone||null,
        }).select('id').single()
        custId = nc?.id
      }

      if (custId) {
        await supabase.from('credit_sales').insert({
          store_id: currentStore?.id, sale_id: sale.id,
          customer_id: custId, amount_owed: totalAmt, status: 'unpaid',
        })
      }
    }
  }

  async function doExpense(valid, date, accId, totalAmt) {
    const { error } = await supabase.from('expenses').insert({
      store_id:        currentStore?.id,
      cash_account_id: accId||null,
      expense_date:    date,
      amount:          totalAmt,
      description:     valid.map(i=>i.name).join(', '),
      source:          'ocr',
      ocr_log_id:      logId,
    })
    if (error) throw error
  }

  async function doInventory(valid) {
    for (const item of valid) {
      const { error } = await supabase.from('inventory_items').insert({
        store_id:      currentStore?.id,
        item_name:     item.name,
        quantity:      item.qty   || 0,
        unit_cost:     item.price || null,
        selling_price: item.price || null,
      })
      if (error) throw error
    }
  }

  function close() {
    if (modalEl) { modalEl.remove(); modalEl = null }
  }

  render()
}

// ── Helpers ──────────────────────────────────────────────────
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