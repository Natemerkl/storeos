import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from '../components/icons.js'
import { formatDate } from '../utils/format-date.js'

console.log('sales-history.js loaded successfully!')

let currentPage = 1
const pageSize = 20
let allSales = []
let filteredSales = []
let cashAccounts = []
let expandedSales = new Set()

export async function render(container) {
  console.log('sales-history render function called!')
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  // Default date range - last 30 days
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000))
  const defaultFrom = thirtyDaysAgo.toISOString().split('T')[0]
  const defaultTo = today.toISOString().split('T')[0]

  // Load cash accounts
  const { data: accounts } = await supabase
    .from('cash_accounts')
    .select('id, account_name')
    .in('store_id', storeIds)
  
  cashAccounts = accounts || []

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Sales History</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center">
        <input type="date" class="form-input" id="filter-from" value="${defaultFrom}" style="max-width:160px">
        <span style="color:var(--muted);font-size:13px">to</span>
        <input type="date" class="form-input" id="filter-to" value="${defaultTo}" style="max-width:160px">
        
        <select class="form-input" id="filter-account" style="max-width:160px">
          <option value="">All Payment Methods</option>
          ${cashAccounts.map(a => `<option value="${a.id}">${a.account_name}</option>`).join('')}
        </select>
        
        <input type="text" class="form-input" id="filter-search" placeholder="Search..." style="max-width:200px">
        
        <button class="btn btn-outline btn-sm" id="btn-clear-filters">Clear</button>
      </div>
    </div>

    <!-- Sales list -->
    <div class="card">
      <div id="sales-list">
        <div style="text-align:center;padding:2rem;color:var(--muted)">
          Loading sales...
        </div>
      </div>
      
      <!-- Load more button -->
      <div id="load-more-container" style="text-align:center;padding:1rem;display:none">
        <button class="btn btn-outline" id="btn-load-more">Load More</button>
      </div>
    </div>
  `

  // Load initial sales
  await loadSales()
  renderSales()

  // Event listeners
  container.querySelector('#filter-from').addEventListener('change', applyFilters)
  container.querySelector('#filter-to').addEventListener('change', applyFilters)
  container.querySelector('#filter-account').addEventListener('change', applyFilters)
  container.querySelector('#filter-search').addEventListener('input', applyFilters)
  container.querySelector('#btn-clear-filters').addEventListener('click', clearFilters)
  container.querySelector('#btn-load-more').addEventListener('click', loadMore)
}

async function loadSales() {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]
  console.log('Loading sales for store IDs:', storeIds)

  // First load basic sales with cash accounts
  const { data: sales, error } = await supabase
    .from('sales')
    .select(`
      id,
      store_id,
      cash_account_id,
      sale_date,
      payment_method,
      total_amount,
      source,
      ocr_log_id,
      notes,
      created_at,
      customer_id,
      customer_note,
      cash_accounts(account_name)
    `)
    .in('store_id', storeIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error loading sales:', error)
    return
  }

  console.log('Loaded sales:', sales)

  // Load store names separately
  const { data: storeData } = await supabase
    .from('stores')
    .select('id, name')
    .in('id', storeIds)

  console.log('Loaded store data:', storeData)

  // Load customer data for sales that have customers
  const customerIds = sales?.filter(s => s.customer_id).map(s => s.customer_id) || []
  const { data: customerData } = await supabase
    .from('customers')
    .select('id, name, phone')
    .in('id', customerIds)

  console.log('Loaded customer data:', customerData)

  // Attach store and customer data
  if (sales) {
    sales.forEach(sale => {
      sale.stores = storeData?.find(s => s.id === sale.store_id)
      sale.customers = customerData?.find(c => c.id === sale.customer_id)
    })
  }

  // Then load sale items for each sale
  if (sales && sales.length > 0) {
    const saleIds = sales.map(s => s.id)
    console.log('Loading items for sale IDs:', saleIds)
    const { data: items, error: itemsError } = await supabase
      .from('sale_items')
      .select(`
        sale_id,
        item_name_snapshot,
        quantity,
        unit_price,
        subtotal
      `)
      .in('sale_id', saleIds)

    if (itemsError) {
      console.error('Error loading sale items:', itemsError)
    } else {
      console.log('Loaded sale items:', items)
      
      // Group items by sale_id
      const itemsBySale = (items || []).reduce((acc, item) => {
        if (!acc[item.sale_id]) acc[item.sale_id] = []
        acc[item.sale_id].push(item)
        return acc
      }, {})

      console.log('Items grouped by sale:', itemsBySale)

      // Attach items to sales
      sales.forEach(sale => {
        sale.sale_items = itemsBySale[sale.id] || []
        console.log('Sale', sale.id, 'has items:', sale.sale_items)
      })
    }
  }

  allSales = sales || []
  console.log('Final allSales data:', allSales)
  applyFilters()
}

function applyFilters() {
  const fromDate = document.querySelector('#filter-from')?.value
  const toDate = document.querySelector('#filter-to')?.value
  const accountId = document.querySelector('#filter-account')?.value
  const searchText = document.querySelector('#filter-search')?.value.toLowerCase()

  filteredSales = allSales.filter(sale => {
    const saleDate = sale.created_at?.split('T')[0]
    const dateMatch = (!fromDate || saleDate >= fromDate) && (!toDate || saleDate <= toDate)
    const accountMatch = !accountId || sale.cash_account_id === accountId
    const searchMatch = !searchText || 
      sale.id.toString().includes(searchText) ||
      sale.total_amount.toString().includes(searchText) ||
      sale.cash_accounts?.account_name?.toLowerCase().includes(searchText)

    return dateMatch && accountMatch && searchMatch
  })

  currentPage = 1
  expandedSales.clear()
  renderSales()
}

function clearFilters() {
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000))
  
  document.querySelector('#filter-from').value = thirtyDaysAgo.toISOString().split('T')[0]
  document.querySelector('#filter-to').value = today.toISOString().split('T')[0]
  document.querySelector('#filter-account').value = ''
  document.querySelector('#filter-search').value = ''
  
  applyFilters()
}

function renderSales() {
  const container = document.querySelector('#sales-list')
  const loadMoreContainer = document.querySelector('#load-more-container')
  
  if (!container) return

  const startIndex = 0
  const endIndex = currentPage * pageSize
  const salesToShow = filteredSales.slice(startIndex, endIndex)

  if (salesToShow.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--muted)">
        ${renderIcon('store', 32, 'var(--gray-300)')}
        <div style="margin-top:0.75rem">No sales found</div>
      </div>
    `
    loadMoreContainer.style.display = 'none'
    return
  }

  container.innerHTML = salesToShow.map(sale => {
    const isExpanded = expandedSales.has(sale.id)
    const date = new Date(sale.created_at)
    const dateTime = formatDate(date) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    
    // Get product names for display
    const productNames = sale.sale_items?.map(item => item.item_name_snapshot).filter(Boolean) || []
    const productDisplay = productNames.length > 0 
      ? productNames.length === 1 
        ? productNames[0]
        : productNames[0] + ' +' + (productNames.length - 1) + ' more'
      : 'No items'
    
    let html = '<div class="sale-item" data-sale-id="' + sale.id + '" style="'
    html += 'border:1px solid var(--border);'
    html += 'border-radius:12px;'
    html += 'margin-bottom:0.75rem;'
    html += 'overflow:hidden;'
    html += 'background:var(--bg-elevated);'
    html += 'transition:all 0.2s;'
    html += '">'
    
    // Main sale info - always visible
    html += '<div class="sale-header" style="'
    html += 'padding:1rem;'
    html += 'cursor:pointer;'
    html += 'display:flex;'
    html += 'align-items:center;'
    html += 'justify-content:space-between;'
    html += 'gap:1rem;'
    html += '" onclick="toggleSaleItems(\'' + sale.id + '\')">'
    
    html += '<div style="flex:1;min-width:0">'
    html += '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">'
    html += '<span style="font-weight:600;color:var(--dark)">' + productDisplay + '</span>'
    html += '<span style="font-size:0.875rem;color:var(--muted)">' + dateTime + '</span>'
    html += '</div>'
    html += '<div style="display:flex;align-items:center;gap:0.5rem">'
    html += '<span class="badge badge-grey">' + (sale.cash_accounts?.account_name || 'Unknown') + '</span>'
    html += '<span style="font-weight:700;color:var(--accent);font-size:1.0625rem">'
    html += fmt(sale.total_amount) + ' ETB'
    html += '</span>'
    html += '</div>'
    html += '</div>'
    
    html += '<div style="display:flex;align-items:center;gap:0.5rem">'
    html += '<button class="btn btn-outline btn-sm" onclick="shareReceipt(\'' + sale.id + '\'); event.stopPropagation();">'
    html += renderIcon('share', 13) + ' Share'
    html += '</button>'
    html += '<div style="'
    html += 'width:24px;height:24px;'
    html += 'display:flex;align-items:center;justify-content:center;'
    html += 'transform:rotate(' + (isExpanded ? '180deg' : '0deg') + ');'
    html += 'transition:transform 0.2s;'
    html += 'color:var(--muted);'
    html += '">'
    html += renderIcon('chevronDown', 16)
    html += '</div>'
    html += '</div>'
    html += '</div>'
    
    // Sale items - expandable
    html += '<div id="sale-items-' + sale.id + '" style="'
    html += 'display:' + (isExpanded ? 'block' : 'none') + ';'
    html += 'border-top:1px solid var(--border);'
    html += 'background:var(--bg-subtle);'
    html += '">'
    html += '<div style="padding:1rem">'
    html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--muted)">Sale Items</div>'
    html += '<div id="items-loading-' + sale.id + '" style="text-align:center;padding:1rem;color:var(--muted)">'
    html += 'Loading items...'
    html += '</div>'
    html += '</div>'
    html += '</div>'
    html += '</div>'
    
    return html
  }).join('')

  // Show/hide load more button
  const hasMore = endIndex < filteredSales.length
  loadMoreContainer.style.display = hasMore ? 'block' : 'none'
}

async function loadMore() {
  currentPage++
  renderSales()
}

window.toggleSaleItems = async function(saleId) {
  console.log('toggleSaleItems called with saleId:', saleId)
  const isExpanded = expandedSales.has(saleId)
  console.log('isExpanded:', isExpanded)
  
  if (isExpanded) {
    expandedSales.delete(saleId)
    console.log('Collapsing sale')
    renderSales()
  } else {
    expandedSales.add(saleId)
    console.log('Expanding sale')
    
    // Find the sale with its items (already loaded)
    const sale = allSales.find(s => s.id === saleId)
    console.log('Found sale:', sale)
    const itemsContainer = document.getElementById(`items-loading-${saleId}`)
    console.log('Items container:', itemsContainer)
    
    if (itemsContainer && sale) {
      const items = sale.sale_items || []
      console.log('Sale items:', items)
      
      if (!items || items.length === 0) {
        itemsContainer.innerHTML = '<div style="color:var(--muted)">No items found</div>'
      } else {
        // Build comprehensive sale details using string concatenation
        let detailsHtml = '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        detailsHtml += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Sale Details</div>'
        detailsHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Store</div><div style="font-weight:500">' + (sale.stores?.name || 'Unknown') + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Payment Method</div><div style="font-weight:500">' + (sale.payment_method || 'Unknown') + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Source</div><div style="font-weight:500">' + (sale.source || 'Unknown') + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Sale Date</div><div style="font-weight:500">' + (sale.sale_date || 'Unknown') + '</div></div>'
        
        detailsHtml += '</div></div>'

        // Customer Information
        detailsHtml += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        detailsHtml += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Customer Information</div>'
        detailsHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Name</div><div style="font-weight:500">' + (sale.customers?.name || 'No customer') + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Phone</div><div style="font-weight:500">' + (sale.customers?.phone || 'Not provided') + '</div></div>'
        
        if (sale.customer_note) {
          detailsHtml += '<div style="grid-column:1/-1"><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Customer Note</div><div style="font-weight:500">' + sale.customer_note + '</div></div>'
        }
        
        detailsHtml += '</div></div>'

        // Account Information
        detailsHtml += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        detailsHtml += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Account Information</div>'
        detailsHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Cash Account</div><div style="font-weight:500">' + (sale.cash_accounts?.account_name || 'Unknown') + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Total Amount</div><div style="font-weight:600;color:var(--accent)">' + fmt(sale.total_amount) + ' ETB</div></div>'
        
        detailsHtml += '</div></div>'

        // Additional Information
        detailsHtml += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        detailsHtml += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Additional Information</div>'
        detailsHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Sale ID</div><div style="font-weight:500;font-family:monospace;font-size:0.8125rem">' + sale.id + '</div></div>'
        detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Created At</div><div style="font-weight:500">' + new Date(sale.created_at).toLocaleString() + '</div></div>'
        
        if (sale.ocr_log_id) {
          detailsHtml += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">OCR Processed</div><div style="font-weight:500">Yes</div></div>'
        }
        
        if (sale.notes) {
          detailsHtml += '<div style="grid-column:1/-1"><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Notes</div><div style="font-weight:500">' + sale.notes + '</div></div>'
        }
        
        detailsHtml += '</div></div>'

        // Items List
        detailsHtml += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;border:1px solid var(--border)">'
        detailsHtml += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Sale Items (' + items.length + ')</div>'

        const itemsHtml = items.map(item => 
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1">' +
              '<div style="font-weight:500">' + (item.item_name_snapshot || 'Unknown Item') + '</div>' +
              '<div style="font-size:0.875rem;color:var(--muted)">Qty: ' + item.quantity + ' × ' + fmt(item.unit_price) + ' ETB</div>' +
            '</div>' +
            '<div style="font-weight:600;color:var(--dark)">' +
              fmt(item.subtotal || (item.unit_price * item.quantity)) + ' ETB' +
            '</div>' +
          '</div>'
        ).join('')

        detailsHtml += itemsHtml + '</div>'
        console.log('Setting innerHTML')
        itemsContainer.innerHTML = detailsHtml
      }
    } else {
      console.log('Missing itemsContainer or sale')
    }
    
    renderSales()
  }
}

window.shareReceipt = async function(saleId) {
  console.log('shareReceipt called with saleId:', saleId)
  const sale = allSales.find(s => s.id === saleId)
  console.log('Found sale for receipt:', sale)
  if (!sale) return

  // Use already loaded items
  const items = sale.sale_items || []
  console.log('Items for receipt:', items)

  const date = new Date(sale.created_at)
  const dateTime = formatDate(date) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  let receiptText = `🧾 SALE RECEIPT\n`
  receiptText += `================\n`
  receiptText += `Receipt #: ${sale.id}\n`
  receiptText += `Date: ${dateTime}\n`
  receiptText += `Store: ${sale.stores?.name || 'Unknown'}\n`
  receiptText += `Payment: ${sale.payment_method || 'Unknown'} (${sale.cash_accounts?.account_name || 'Unknown'})\n`
  
  if (sale.customers?.name) {
    receiptText += `Customer: ${sale.customers.name}\n`
    if (sale.customers?.phone) {
      receiptText += `Phone: ${sale.customers.phone}\n`
    }
  }
  
  if (sale.customer_note) {
    receiptText += `Customer Note: ${sale.customer_note}\n`
  }
  
  receiptText += `Source: ${sale.source || 'Unknown'}\n`
  receiptText += `----------------\n`

  if (items && items.length > 0) {
    items.forEach(item => {
      const itemTotal = item.subtotal || (item.unit_price * item.quantity)
      receiptText += `${item.item_name_snapshot || 'Unknown'}\n`
      receiptText += `  ${item.quantity} x ${fmt(item.unit_price)} = ${fmt(itemTotal)} ETB\n`
    })
  }

  receiptText += `----------------\n`
  receiptText += `TOTAL: ${fmt(sale.total_amount)} ETB\n`
  
  if (sale.notes) {
    receiptText += `Notes: ${sale.notes}\n`
  }
  
  receiptText += `================\n`
  receiptText += `Thank you for your purchase! 🛍️`

  console.log('Receipt text generated:', receiptText)

  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(receiptText)
    console.log('Receipt copied to clipboard')
    
    // Show success message
    const button = document.querySelector(`[onclick="shareReceipt(${saleId})"]`)
    console.log('Share button found:', button)
    if (button) {
      const originalText = button.innerHTML
      button.innerHTML = `${renderIcon('check', 13)} Copied!`
      button.style.color = 'var(--accent)'
      
      setTimeout(() => {
        button.innerHTML = originalText
        button.style.color = ''
      }, 2000)
    }
  } catch (err) {
    console.error('Failed to copy receipt:', err)
    alert('Failed to copy receipt to clipboard')
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
