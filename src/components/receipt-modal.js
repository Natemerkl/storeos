import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from './icons.js'
import {
  buildReceiptData, buildReceiptHTML,
  printReceipt, downloadPDF, downloadImage,
  shareWhatsApp, shareTelegram, nativeShare,
  buildShareText
} from '../utils/receipt.js'

export async function openReceiptModal(saleId) {
  const { currentStore } = appStore.getState()

  // Load sale data
  const [
    { data: sale },
    { data: saleItems },
  ] = await Promise.all([
    supabase.from('sales').select('*').eq('id', saleId).single(),
    supabase.from('sale_items')
      .select('id, item_name_snapshot, quantity, unit_price, subtotal')
      .eq('sale_id', saleId),
  ])

  console.log('sale items:', saleItems)

  if (!sale) return

  // Load customer + credit if credit sale
  let customer    = null
  let creditRecord = null

  if (sale.customer_id || sale.payment_method === 'credit') {
    const { data: credit } = await supabase
      .from('credit_sales')
      .select('*, customers(*)')
      .eq('sale_id', saleId)
      .single()

    if (credit) {
      customer     = credit.customers
      creditRecord = credit
    }
  }

  const receiptData = buildReceiptData({
    sale,
    saleItems: saleItems || [],
    store:     currentStore,
    customer,
    creditRecord,
  })

  // Build overlay
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;'

  overlay.innerHTML = `
    <div style="
      background:var(--bg-elevated);
      border-radius:var(--radius-xl);
      width:100%;max-width:520px;
      box-shadow:var(--shadow-lg);
      overflow:hidden;
    ">
      <!-- Header -->
      <div style="
        padding:1.125rem 1.25rem;
        border-bottom:1px solid var(--border);
        display:flex;align-items:center;justify-content:space-between;
      ">
        <div>
          <div style="font-weight:700;font-size:1rem">Receipt #${receiptData.id}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">${receiptData.date} · ${receiptData.storeName}</div>
        </div>
        <button class="modal-close" id="receipt-close">
          ${renderIcon('close', 14)}
        </button>
      </div>

      <!-- Receipt preview -->
      <div style="
        max-height:320px;overflow-y:auto;
        padding:1rem 1.25rem;
        background:var(--bg-subtle);
        border-bottom:1px solid var(--border);
        font-family:'Courier New',monospace;font-size:12px;
      ">
        <!-- Mini receipt preview -->
        <div style="text-align:center;margin-bottom:8px">
          <div style="font-size:16px;font-weight:700;letter-spacing:1px">${receiptData.storeName}</div>
          <div style="color:var(--muted);font-size:11px">Receipt #${receiptData.id} · ${receiptData.date}</div>
        </div>

        <div style="border-top:1px dashed var(--border);margin:8px 0"></div>

        ${(receiptData.items||[]).map(i => `
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
            <span>${i.item_name_snapshot || '—'} x${i.quantity}</span>
            <span style="font-weight:600">${Number(i.subtotal || i.quantity * i.unit_price).toLocaleString('en-ET',{minimumFractionDigits:2})} ETB</span>
          </div>
        `).join('')}

        <div style="border-top:1px dashed var(--border);margin:8px 0"></div>

        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px">
          <span>TOTAL</span>
          <span style="color:var(--accent)">${Number(receiptData.total).toLocaleString('en-ET',{minimumFractionDigits:2})} ETB</span>
        </div>

        ${receiptData.isCredit && customer ? `
          <div style="
            margin-top:10px;padding:8px 10px;
            background:#fffbeb;border:1px dashed #f59e0b;border-radius:6px;
            font-size:11px;
          ">
            <div style="font-weight:700;color:#92400e;margin-bottom:4px">CREDIT SALE</div>
            <div>👤 ${customer.name}</div>
            ${customer.phone ? `<div>📞 ${customer.phone}</div>` : ''}
            <div style="font-weight:800;color:#d97706;margin-top:4px">
              Owes: ${Number(receiptData.amountOwed ?? receiptData.total).toLocaleString('en-ET',{minimumFractionDigits:2})} ETB
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Action buttons -->
      <div style="padding:1.125rem 1.25rem">

        <!-- Primary actions -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.625rem;margin-bottom:0.875rem">
          <button class="receipt-action-btn" id="btn-print">
            <div class="action-icon">${renderIcon('reports', 20, 'var(--accent)')}</div>
            <span>Print</span>
          </button>
          <button class="receipt-action-btn" id="btn-pdf">
            <div class="action-icon">${renderIcon('inventory', 20, 'var(--danger)')}</div>
            <span>PDF</span>
          </button>
          <button class="receipt-action-btn" id="btn-image">
            <div class="action-icon">${renderIcon('scan', 20, '#6366F1')}</div>
            <span>Image</span>
          </button>
        </div>

        <!-- Share section -->
        <div style="
          background:var(--bg-subtle);border-radius:var(--radius-lg);
          padding:0.875rem;margin-bottom:0.875rem;
        ">
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);
                      text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.625rem">
            Share via
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">

            <!-- WhatsApp -->
            <button class="share-btn whatsapp" id="btn-whatsapp">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </button>

            <!-- Telegram -->
            <button class="share-btn telegram" id="btn-telegram">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0088cc">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Telegram
            </button>

            <!-- Copy text -->
            <button class="share-btn copy" id="btn-copy">
              ${renderIcon('plus', 16, '#6366F1')}
              Copy Text
            </button>

            <!-- Native share (mobile) -->
            ${navigator.share ? `
              <button class="share-btn native" id="btn-native">
                ${renderIcon('transfers', 16, '#22C55E')}
                Share
              </button>
            ` : ''}
          </div>
        </div>

        <!-- WhatsApp with specific number -->
        ${receiptData.isCredit && customer?.phone ? `
          <button class="btn btn-primary" style="width:100%;justify-content:center;gap:0.5rem" id="btn-whatsapp-direct">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Send to ${customer.name} on WhatsApp
          </button>
        ` : ''}
      </div>
    </div>
  `

  // Inject styles
  if (!document.getElementById('receipt-modal-styles')) {
    const s = document.createElement('style')
    s.id = 'receipt-modal-styles'
    s.textContent = `
      .receipt-action-btn {
        display:flex;flex-direction:column;align-items:center;gap:0.375rem;
        padding:0.75rem 0.5rem;border-radius:var(--radius-lg);
        border:1.5px solid var(--border);background:var(--bg-elevated);
        cursor:pointer;transition:all 0.18s;font-size:0.8125rem;font-weight:600;color:var(--dark);
      }
      .receipt-action-btn:hover {
        border-color:var(--accent);background:var(--teal-50);color:var(--accent);
        transform:translateY(-2px);box-shadow:var(--shadow-sm);
      }
      .action-icon {
        width:40px;height:40px;border-radius:var(--radius);
        background:var(--bg-subtle);display:flex;align-items:center;justify-content:center;
      }
      .share-btn {
        display:inline-flex;align-items:center;gap:0.375rem;
        padding:0.45rem 0.875rem;border-radius:var(--radius-pill);
        border:1.5px solid var(--border);background:var(--bg-elevated);
        cursor:pointer;font-size:0.8125rem;font-weight:600;color:var(--dark);
        transition:all 0.15s;
      }
      .share-btn:hover { transform:translateY(-1px);box-shadow:var(--shadow-xs); }
      .share-btn.whatsapp:hover { border-color:#25D366;background:#f0fdf4; }
      .share-btn.telegram:hover { border-color:#0088cc;background:#eff6ff; }
      .share-btn.copy:hover     { border-color:#6366F1;background:#eef2ff; }
      .share-btn.native:hover   { border-color:#22C55E;background:#f0fdf4; }

      @media (max-width:768px) {
        .receipt-action-btn { padding:0.625rem 0.375rem; }
      }
    `
    document.head.appendChild(s)
  }

  document.body.appendChild(overlay)

  // ── Event listeners ──────────────────────────────────────
  overlay.querySelector('#receipt-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  overlay.querySelector('#btn-print').addEventListener('click', () => {
    printReceipt(receiptData)
  })

  overlay.querySelector('#btn-pdf').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-pdf')
    btn.style.opacity = '0.6'
    await downloadPDF(receiptData)
    btn.style.opacity = '1'
  })

  overlay.querySelector('#btn-image').addEventListener('click', async () => {
    await downloadImage(receiptData, `receipt-${receiptData.id}.png`)
  })

  overlay.querySelector('#btn-whatsapp').addEventListener('click', () => {
    shareWhatsApp(receiptData)
  })

  overlay.querySelector('#btn-telegram').addEventListener('click', () => {
    shareTelegram(receiptData)
  })

  overlay.querySelector('#btn-copy').addEventListener('click', async () => {
    const text = buildShareText(receiptData)
    await navigator.clipboard.writeText(text)
    const btn = overlay.querySelector('#btn-copy')
    const orig = btn.innerHTML
    btn.innerHTML = `${renderIcon('check', 14, 'var(--accent)')} Copied!`
    btn.style.borderColor = 'var(--accent)'
    btn.style.color       = 'var(--accent)'
    setTimeout(() => {
      btn.innerHTML    = orig
      btn.style.borderColor = ''
      btn.style.color       = ''
    }, 2000)
  })

  overlay.querySelector('#btn-native')?.addEventListener('click', async () => {
    const shared = await nativeShare(receiptData)
    if (!shared) shareWhatsApp(receiptData)
  })

  overlay.querySelector('#btn-whatsapp-direct')?.addEventListener('click', () => {
    shareWhatsApp(receiptData, customer?.phone)
  })
}