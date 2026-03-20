// ── Receipt & Document Generator ─────────────────────────────
// Formats: Print (browser), PDF download, PNG image, WhatsApp, Telegram

const STORE_CONFIG = {
  name:    'StoreOS',
  tagline: 'Your trusted store',
  footer:  'Thank you for your business!',
}

// ── Build receipt data structure ──────────────────────────────
export function buildReceiptData({ sale, saleItems, store, customer, creditRecord }) {
  return {
    id:            sale.id?.slice(-8).toUpperCase(),
    date:          sale.sale_date,
    time:          new Date(sale.created_at).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }),
    storeName:     store?.name || STORE_CONFIG.name,
    paymentMethod: sale.payment_method,
    isCredit:      sale.payment_method === 'credit',
    items:         saleItems || [],
    subtotal:      saleItems?.reduce((s, i) => s + Number(i.subtotal || (i.quantity * i.unit_price)), 0) || Number(sale.total_amount),
    total:         Number(sale.total_amount),
    notes:         sale.notes || null,
    customer:      customer || null,
    amountOwed:    creditRecord ? Number(creditRecord.amount_owed) - Number(creditRecord.amount_paid) : null,
  }
}

// ── HTML receipt template ─────────────────────────────────────
export function buildReceiptHTML(data, opts = {}) {
  const { compact = false, forImage = false } = opts

  const payLabel = {
    cash: 'Cash', bank_transfer: 'Bank Transfer',
    telebirr: 'Telebirr', cbe_birr: 'CBE Birr',
    credit: 'Credit', other: 'Other'
  }[data.paymentMethod] || data.paymentMethod

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Receipt #${data.id}</title>
      <style>
        * { box-sizing:border-box; margin:0; padding:0; }
        body {
          font-family: 'Courier New', Courier, monospace;
          background: #fff;
          color: #111;
          padding: ${compact ? '0' : '20px'};
        }
        .receipt {
          width: ${forImage ? '400px' : '100%'};
          max-width: 420px;
          margin: 0 auto;
          background: #fff;
          ${forImage ? 'padding:24px;' : ''}
        }
        .header {
          text-align: center;
          border-bottom: 2px dashed #ddd;
          padding-bottom: 14px;
          margin-bottom: 14px;
        }
        .store-name {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 1px;
          font-family: Arial, sans-serif;
        }
        .receipt-id {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }
        .date-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .items-table th {
          text-align: left;
          font-size: 10px;
          color: #888;
          padding: 4px 0;
          border-bottom: 1px dashed #ddd;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .items-table td {
          padding: 5px 0;
          vertical-align: top;
          border-bottom: 1px solid #f5f5f5;
        }
        .items-table td:last-child { text-align: right; font-weight: 600; }
        .items-table td:nth-child(2) { text-align: center; color: #666; }
        .item-name { font-weight: 500; }
        .totals {
          border-top: 2px dashed #ddd;
          padding-top: 10px;
          margin-top: 4px;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          font-size: 13px;
        }
        .total-row.final {
          font-size: 18px;
          font-weight: 800;
          padding-top: 8px;
          border-top: 1px dashed #ddd;
          margin-top: 4px;
        }
        .payment-badge {
          display: inline-block;
          background: #f0f9f8;
          color: #0d9488;
          border: 1px solid #0d9488;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          margin-top: 8px;
        }
        .credit-box {
          background: #fffbeb;
          border: 1.5px solid #f59e0b;
          border-radius: 8px;
          padding: 10px 12px;
          margin-top: 12px;
          font-size: 13px;
        }
        .credit-box .credit-title {
          font-weight: 700;
          font-size: 12px;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
        .credit-row {
          display: flex;
          justify-content: space-between;
          padding: 2px 0;
        }
        .amount-owed {
          font-size: 20px;
          font-weight: 800;
          color: #d97706;
        }
        .footer {
          text-align: center;
          margin-top: 18px;
          padding-top: 14px;
          border-top: 2px dashed #ddd;
          font-size: 11px;
          color: #999;
          line-height: 1.8;
        }
        .barcode-line {
          font-size: 28px;
          letter-spacing: 3px;
          margin: 6px 0 2px;
          color: #222;
        }
        @media print {
          body { padding: 0; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <!-- Header -->
        <div class="header">
          <div class="store-name">${data.storeName}</div>
          <div class="receipt-id">Receipt #${data.id}</div>
          <div class="date-row">
            <span>${data.date}</span>
            <span>${data.time}</span>
          </div>
        </div>

        <!-- Items -->
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${(data.items||[]).map(item => `
              <tr>
                <td class="item-name">${item.item_name_snapshot || item.description || '—'}</td>
                <td>${Number(item.quantity).toLocaleString()}</td>
                <td>${fmt(item.unit_price)} ETB</td>
                <td>${fmt(item.subtotal || item.quantity * item.unit_price)} ETB</td>
              </tr>
            `).join('')}
            ${data.items?.length === 0 ? `
              <tr><td colspan="4" style="text-align:center;color:#999;padding:8px 0">Sale total only</td></tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="totals">
          ${data.subtotal !== data.total ? `
            <div class="total-row">
              <span>Subtotal</span>
              <span>${fmt(data.subtotal)} ETB</span>
            </div>
            <div class="total-row" style="color:#d97706">
              <span>Discount</span>
              <span>-${fmt(data.subtotal - data.total)} ETB</span>
            </div>
          ` : ''}
          <div class="total-row final">
            <span>TOTAL</span>
            <span>${fmt(data.total)} ETB</span>
          </div>
        </div>

        <!-- Payment -->
        <div style="text-align:center">
          <span class="payment-badge">${payLabel}</span>
        </div>

        <!-- Credit box -->
        ${data.isCredit && data.customer ? `
          <div class="credit-box">
            <div class="credit-title">Credit Sale</div>
            <div class="credit-row">
              <span>Customer</span>
              <span style="font-weight:700">${data.customer.name}</span>
            </div>
            ${data.customer.phone ? `
              <div class="credit-row">
                <span>Phone</span>
                <span>${data.customer.phone}</span>
              </div>
            ` : ''}
            <div class="credit-row" style="margin-top:6px;padding-top:6px;border-top:1px dashed #f59e0b">
              <span style="font-weight:700">Amount Owed</span>
              <span class="amount-owed">${fmt(data.amountOwed ?? data.total)} ETB</span>
            </div>
          </div>
        ` : ''}

        <!-- Notes -->
        ${data.notes ? `
          <div style="margin-top:10px;font-size:12px;color:#666;text-align:center;font-style:italic">
            Note: ${data.notes}
          </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer">
          <div class="barcode-line">|||||||||||||||||||</div>
          <div>${data.id}</div>
          <div style="margin-top:6px">${STORE_CONFIG.footer}</div>
          <div>Powered by StoreOS</div>
        </div>
      </div>
    </body>
    </html>
  `
}

// ── Print ─────────────────────────────────────────────────────
export function printReceipt(data) {
  const html = buildReceiptHTML(data)
  const win  = window.open('', '_blank', 'width=500,height=700')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 500)
}

// ── Download PDF ──────────────────────────────────────────────
export async function downloadPDF(data) {
  // Use browser print-to-PDF via hidden iframe
  return new Promise((resolve) => {
    const html    = buildReceiptHTML(data, { compact: true })
    const iframe  = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none'
    document.body.appendChild(iframe)

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        setTimeout(() => {
          document.body.removeChild(iframe)
          resolve()
        }, 1000)
      }, 300)
    }

    iframe.srcdoc = html
  })
}

// ── Download as PNG image ─────────────────────────────────────
export async function downloadImage(data, filename = 'receipt.png') {
  // Render receipt in hidden div, capture as canvas
  const html = buildReceiptHTML(data, { forImage: true })

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    // Use html2canvas if available, else fallback to blob URL
    if (window.html2canvas) {
      const canvas = await window.html2canvas(container.querySelector('.receipt'), {
        scale: 2, backgroundColor: '#fff', useCORS: true,
      })
      const link    = document.createElement('a')
      link.download = filename
      link.href     = canvas.toDataURL('image/png')
      link.click()
    } else {
      // Fallback — open as HTML page for screenshot
      const blob = new Blob([html], { type: 'text/html' })
      const url  = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  } finally {
    document.body.removeChild(container)
  }
}

// ── Build share text ──────────────────────────────────────────
export function buildShareText(data) {
  const payLabel = {
    cash:'Cash', bank_transfer:'Bank Transfer', telebirr:'Telebirr',
    cbe_birr:'CBE Birr', credit:'Credit', other:'Other'
  }[data.paymentMethod] || data.paymentMethod

  const lines = [
    `🧾 *Receipt from ${data.storeName}*`,
    `📅 ${data.date} at ${data.time}`,
    `🔖 #${data.id}`,
    ``,
    `*Items:*`,
    ...(data.items||[]).map(i =>
      `• ${i.item_name_snapshot || i.description} x${i.quantity} — ${fmt(i.unit_price)} ETB`
    ),
    ``,
    `━━━━━━━━━━━━━━━━`,
    `💰 *Total: ${fmt(data.total)} ETB*`,
    `💳 Payment: ${payLabel}`,
  ]

  if (data.isCredit && data.customer) {
    lines.push(``)
    lines.push(`📒 *Credit Sale*`)
    lines.push(`👤 Customer: ${data.customer.name}`)
    if (data.customer.phone) lines.push(`📞 ${data.customer.phone}`)
    lines.push(`⚠️ *Amount owed: ${fmt(data.amountOwed ?? data.total)} ETB*`)
  }

  if (data.notes) lines.push(``, `📝 ${data.notes}`)
  lines.push(``, `_Sent via StoreOS_`)

  return lines.join('\n')
}

// ── Share via WhatsApp ────────────────────────────────────────
export function shareWhatsApp(data, phone = null) {
  const text    = encodeURIComponent(buildShareText(data))
  const phoneNo = phone ? phone.replace(/[^0-9]/g, '') : ''
  const url     = phoneNo
    ? `https://wa.me/${phoneNo.startsWith('0') ? '251' + phoneNo.slice(1) : phoneNo}?text=${text}`
    : `https://wa.me/?text=${text}`
  window.open(url, '_blank')
}

// ── Share via Telegram ────────────────────────────────────────
export function shareTelegram(data) {
  const text = encodeURIComponent(buildShareText(data))
  window.open(`https://t.me/share/url?url=&text=${text}`, '_blank')
}

// ── Native share (mobile) ─────────────────────────────────────
export async function nativeShare(data) {
  if (!navigator.share) return false
  try {
    await navigator.share({
      title: `Receipt #${data.id} — ${data.storeName}`,
      text:  buildShareText(data),
    })
    return true
  } catch(e) {
    return false
  }
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}