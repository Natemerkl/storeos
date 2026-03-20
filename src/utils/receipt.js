import { jsPDF } from 'jspdf'

/**
 * Builds a structured receipt object from database records
 */
export function buildReceiptData({ sale, saleItems, store, customer, creditRecord }) {
  const date = new Date(sale.sale_date || sale.created_at).toLocaleDateString('en-ET', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return {
    id: sale.id.slice(0, 8).toUpperCase(),
    date,
    storeName: store?.name || 'StoreOS',
    storePhone: store?.phone || '',
    storeAddress: store?.address || '',
    items: saleItems.map(item => ({
      ...item,
      item_name: item.item_name_snapshot || 'Item',
      subtotal: Number(item.subtotal || item.quantity * item.unit_price)
    })),
    total: Number(sale.total_amount),
    paymentMethod: sale.payment_method || 'cash',
    isCredit: sale.payment_method === 'credit',
    customerName: customer?.name || '',
    customerPhone: customer?.phone || '',
    amountOwed: Number(creditRecord?.amount_owed || 0)
  }
}

/**
 * Generates HTML for a thermal printer receipt
 */
export function buildReceiptHTML(data, opts = {}) {
  const { width = '300px' } = opts
  const divider = '<div style="border-top:1px dashed #000;margin:10px 0"></div>'

  return `
    <div style="
      width:${width};
      padding:20px;
      background:#fff;
      color:#000;
      font-family:'Courier New', Courier, monospace;
      font-size:12px;
      line-height:1.4;
    ">
      <!-- Header -->
      <div style="text-align:center;margin-bottom:15px">
        <div style="font-size:18px;font-weight:bold;margin-bottom:4px">${data.storeName.toUpperCase()}</div>
        ${data.storeAddress ? `<div style="font-size:10px">${data.storeAddress}</div>` : ''}
        ${data.storePhone ? `<div style="font-size:10px">Tel: ${data.storePhone}</div>` : ''}
        <div style="margin-top:8px;font-size:11px">Receipt #${data.id}</div>
        <div style="font-size:11px">${data.date}</div>
      </div>

      ${divider}

      <!-- Items Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
        <thead>
          <tr style="text-align:left;border-bottom:1px dashed #000">
            <th style="padding:4px 0">Item</th>
            <th style="padding:4px 0;text-align:right">Qty</th>
            <th style="padding:4px 0;text-align:right">Price</th>
            <th style="padding:4px 0;text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map(item => `
            <tr>
              <td style="padding:4px 0">${item.item_name}</td>
              <td style="padding:4px 0;text-align:right">${item.quantity}</td>
              <td style="padding:4px 0;text-align:right">${item.unit_price.toLocaleString()}</td>
              <td style="padding:4px 0;text-align:right">${item.subtotal.toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${divider}

      <!-- Totals -->
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;margin-top:5px">
        <span>TOTAL</span>
        <span>${data.total.toLocaleString()} ETB</span>
      </div>
      <div style="font-size:10px;margin-top:4px">
        Payment: ${data.paymentMethod.toUpperCase()}
      </div>

      <!-- Credit Box -->
      ${data.isCredit ? `
        <div style="margin-top:15px;padding:10px;border:1px solid #000;border-style:dashed">
          <div style="font-weight:bold;margin-bottom:4px">CREDIT RECORD</div>
          <div>Customer: ${data.customerName}</div>
          ${data.customerPhone ? `<div>Phone: ${data.customerPhone}</div>` : ''}
          <div style="font-weight:bold;margin-top:6px">Owes: ${data.amountOwed.toLocaleString()} ETB</div>
        </div>
      ` : ''}

      ${divider}

      <!-- Footer -->
      <div style="text-align:center;margin-top:20px;font-size:10px">
        Thank you for your business!<br>
        StoreOS - Smart Store Management
      </div>
    </div>
  `
}

/**
 * Prints the receipt using a hidden iframe
 */
export function printReceipt(data) {
  const html = buildReceiptHTML(data)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(`
    <html>
      <head><title>Print Receipt</title></head>
      <body style="margin:0" onload="window.print();window.close()">
        ${html}
      </body>
    </html>
  `)
  doc.close()

  // Remove iframe after print dialog closes
  setTimeout(() => document.body.removeChild(iframe), 1000)
}

/**
 * Downloads receipt as PDF using jsPDF
 */
export async function downloadPDF(data) {
  const doc = new jsPDF({
    unit: 'mm',
    format: [80, 200] // Thermal paper width 80mm
  })

  let y = 10
  const margin = 5
  const width = 70

  // Header
  doc.setFont('courier', 'bold')
  doc.setFontSize(14)
  doc.text(data.storeName.toUpperCase(), 40, y, { align: 'center' })
  y += 6
  
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  if (data.storeAddress) {
    doc.text(data.storeAddress, 40, y, { align: 'center' })
    y += 4
  }
  doc.text(`Receipt #${data.id}`, 40, y, { align: 'center' })
  y += 4
  doc.text(data.date, 40, y, { align: 'center' })
  y += 6

  doc.text('------------------------------------------', 40, y, { align: 'center' })
  y += 6

  // Items
  doc.setFontSize(8)
  doc.text('Item', margin, y)
  doc.text('Qty', 45, y, { align: 'right' })
  doc.text('Total', 75, y, { align: 'right' })
  y += 4
  doc.text('------------------------------------------', 40, y, { align: 'center' })
  y += 5

  data.items.forEach(item => {
    doc.text(item.item_name.substring(0, 20), margin, y)
    doc.text(item.quantity.toString(), 45, y, { align: 'right' })
    doc.text(item.subtotal.toLocaleString(), 75, y, { align: 'right' })
    y += 4
  })

  y += 2
  doc.text('------------------------------------------', 40, y, { align: 'center' })
  y += 6

  // Totals
  doc.setFontSize(10)
  doc.setFont('courier', 'bold')
  doc.text('TOTAL', margin, y)
  doc.text(`${data.total.toLocaleString()} ETB`, 75, y, { align: 'right' })
  y += 6

  doc.setFontSize(8)
  doc.setFont('courier', 'normal')
  doc.text(`Payment: ${data.paymentMethod.toUpperCase()}`, margin, y)
  y += 10

  // Credit
  if (data.isCredit) {
    doc.setDrawColor(0)
    doc.setLineDash([1, 1])
    doc.rect(margin, y, 70, 15)
    doc.text('CREDIT RECORD', margin + 2, y + 4)
    doc.text(`Customer: ${data.customerName}`, margin + 2, y + 8)
    doc.text(`Owes: ${data.amountOwed.toLocaleString()} ETB`, margin + 2, y + 12)
    y += 20
  }

  doc.text('Thank you for your business!', 40, y, { align: 'center' })
  y += 4
  doc.text('StoreOS - Smart Management', 40, y, { align: 'center' })

  doc.save(`receipt-${data.id}.pdf`)
}

/**
 * Downloads receipt as Image
 */
export async function downloadImage(data, filename) {
  // If html2canvas is not available, we can't easily do this in pure JS
  // We'll check if it's available, otherwise fallback to alert
  if (typeof html2canvas === 'undefined') {
    // Try to load it dynamically if possible, or just warn
    const script = document.createElement('script')
    script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js'
    document.head.appendChild(script)
    
    script.onload = () => executeDownload()
    script.onerror = () => alert('Image download requires html2canvas library.')
  } else {
    executeDownload()
  }

  function executeDownload() {
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-9999px'
    container.innerHTML = buildReceiptHTML(data)
    document.body.appendChild(container)

    html2canvas(container.firstElementChild).then(canvas => {
      const link = document.createElement('a')
      link.download = filename
      link.href = canvas.toDataURL()
      link.click()
      document.body.removeChild(container)
    })
  }
}

/**
 * Builds plain text for sharing
 */
export function buildShareText(data) {
  let text = `🧾 *RECEIPT FROM ${data.storeName.toUpperCase()}*\n`
  text += `--------------------------------\n`
  text += `Receipt: #${data.id}\n`
  text += `Date: ${data.date}\n`
  text += `--------------------------------\n\n`

  data.items.forEach(item => {
    text += `• ${item.item_name} x${item.quantity}\n`
    text += `  @ ${item.unit_price.toLocaleString()} = ${item.subtotal.toLocaleString()} ETB\n`
  })

  text += `\n--------------------------------\n`
  text += `*TOTAL: ${data.total.toLocaleString()} ETB*\n`
  text += `Payment: ${data.paymentMethod.toUpperCase()}\n`

  if (data.isCredit) {
    text += `\n*CREDIT RECORD*\n`
    text += `Customer: ${data.customerName}\n`
    text += `*Owes: ${data.amountOwed.toLocaleString()} ETB*\n`
  }

  text += `\nThank you for your business!\n`
  text += `_Generated by StoreOS_`
  
  return text
}

/**
 * Shares via WhatsApp
 */
export function shareWhatsApp(data, phone = '') {
  const text = encodeURIComponent(buildShareText(data))
  const cleanPhone = phone ? phone.replace(/\D/g, '') : ''
  const url = `https://wa.me/${cleanPhone}?text=${text}`
  window.open(url, '_blank')
}

/**
 * Shares via Telegram
 */
export function shareTelegram(data) {
  const text = encodeURIComponent(buildShareText(data))
  const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${text}`
  window.open(url, '_blank')
}

/**
 * Native mobile share
 */
export async function nativeShare(data) {
  if (!navigator.share) return false
  
  try {
    await navigator.share({
      title: `Receipt from ${data.storeName}`,
      text: buildShareText(data),
      url: window.location.origin
    })
    return true
  } catch (err) {
    console.warn('Native share failed:', err)
    return false
  }
}
