import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from '../components/icons.js'
import { formatDate } from '../utils/format-date.js'
import { initDateRangeSelector } from '../components/date-range-selector.js'

console.log('sales-history.js loaded successfully!')

let currentPage = 1
const pageSize = 20
let allSales = []
let filteredSales = []
let cashAccounts = []
let expandedSales = new Set()
let isLoading = true
let totalCount = 0
let dateRangeListener = null

export async function render(container) {
  console.log('sales-history render function called!')
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

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
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.625rem;align-items:center">
        <div id="date-range-container" style="grid-column:1/-1"></div>
        
        <select class="form-input" id="filter-type" style="font-size:0.875rem">
          <option value="">All Types</option>
          <option value="pos">POS</option>
          <option value="ocr">OCR</option>
          <option value="credit">Credit</option>
        </select>
        
        <select class="form-input" id="filter-account" style="font-size:0.875rem">
          <option value="">All Payment Methods</option>
          ${cashAccounts.map(a => `<option value="${a.id}">${a.account_name}</option>`).join('')}
        </select>
        
        <input type="text" class="form-input" id="filter-search" placeholder="Search..." style="font-size:0.875rem;grid-column:span 2">
        
        <button class="btn btn-outline btn-sm" id="btn-clear-filters" style="font-size:0.875rem">Clear</button>
      </div>
    </div>

    <!-- Sales list -->
    <div class="card">
      <div id="sales-count" style="padding:0.75rem 1rem;border-bottom:1px solid var(--border);display:none">
        <span style="font-weight:600;color:var(--dark)">Total Sales: </span>
        <span style="color:var(--muted)">${totalCount}</span>
      </div>
      <div id="sales-list">
        ${renderSkeletonLoader()}
      </div>
      
      <!-- Load more button -->
      <div id="load-more-container" style="text-align:center;padding:1rem;display:none">
        <button class="btn btn-outline" id="btn-load-more">Load More</button>
      </div>
    </div>
  `

  // Initialize date range selector
  const dateRangeContainer = container.querySelector('#date-range-container')
  initDateRangeSelector(dateRangeContainer)

  // Load initial sales
  await loadSales()
  renderSales()

  // Event listeners
  container.querySelector('#filter-type').addEventListener('change', applyFilters)
  container.querySelector('#filter-account').addEventListener('change', applyFilters)
  container.querySelector('#filter-search').addEventListener('input', applyFilters)
  container.querySelector('#btn-clear-filters').addEventListener('click', clearFilters)
  container.querySelector('#btn-load-more').addEventListener('click', loadMore)
  
  // Remove old date range listener if exists
  if (dateRangeListener) {
    window.removeEventListener('dateRangeChanged', dateRangeListener)
  }
  
  // Listen for date range changes - reload data from server
  dateRangeListener = async () => {
    currentPage = 1
    expandedSales.clear()
    await loadSales()
  }
  window.addEventListener('dateRangeChanged', dateRangeListener)
}

function renderSkeletonLoader() {
  return `
    <div style="padding:1rem">
      ${Array(5).fill(0).map(() => `
        <div style="margin-bottom:1rem">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem">
            <div style="width:40px;height:40px;background:var(--gray-200);border-radius:8px;animation:pulse 1.5s ease-in-out infinite"></div>
            <div style="flex:1">
              <div style="width:60%;height:16px;background:var(--gray-200);border-radius:4px;margin-bottom:0.5rem;animation:pulse 1.5s ease-in-out infinite"></div>
              <div style="width:40%;height:12px;background:var(--gray-200);border-radius:4px;animation:pulse 1.5s ease-in-out infinite"></div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
    </style>
  `
}

async function loadSales() {
  isLoading = true
  const container = document.querySelector('#sales-list')
  if (container) {
    container.innerHTML = renderSkeletonLoader()
  }
  
  const { currentStore, accountingView, stores, dateRange } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]
  console.log('Loading sales for store IDs:', storeIds)
  console.log('Date range:', dateRange)

  // Build query - start with base query
  let query = supabase
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
      transport_fee,
      delivery_place,
      targa,
      payment_bank,
      cash_accounts(account_name),
      customers(name, phone),
      stores!inner(name),
      credit_sales!left(
        customer_id,
        amount_owed,
        status,
        customers(
          name,
          phone
        )
      ),
      sale_items(
        item_name_snapshot,
        quantity,
        unit_price,
        subtotal
      )
    `, { count: 'exact' })
    .in('store_id', storeIds)

  // Apply date range filters only if they exist
  if (dateRange?.startDate) {
    query = query.gte('created_at', `${dateRange.startDate}T00:00:00Z`)
  }
  if (dateRange?.endDate) {
    query = query.lte('created_at', `${dateRange.endDate}T23:59:59Z`)
  }

  // Execute query
  const { data: sales, error, count } = await query.order('created_at', { ascending: false })

  if (error) {
    console.error('Error loading sales:', error)
    isLoading = false
    if (container) {
      container.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--accent)">
          ${renderIcon('alertCircle', 32, 'var(--accent)')}
          <div style="margin-top:0.75rem">Error loading sales</div>
        </div>
      `
    }
    return
  }

  console.log('Loaded sales:', sales?.length || 0, 'records')
  allSales = sales || []
  totalCount = count || 0
  isLoading = false
  applyFilters()
}

function applyFilters() {
  const typeId = document.querySelector('#filter-type')?.value
  const accountId = document.querySelector('#filter-account')?.value
  const searchText = document.querySelector('#filter-search')?.value?.toLowerCase() || ''

  filteredSales = allSales.filter(sale => {
    // Type filter
    let typeMatch = true
    if (typeId === 'pos') {
      typeMatch = sale.source === 'manual' && sale.payment_method !== 'credit'
    } else if (typeId === 'ocr') {
      typeMatch = sale.source === 'ocr'
    } else if (typeId === 'credit') {
      typeMatch = sale.payment_method === 'credit'
    }
    
    // Account filter - convert both to strings for comparison
    const accountMatch = !accountId || (sale.cash_account_id && String(sale.cash_account_id) === String(accountId))
    
    // Search filter
    const customerName = sale.customers?.name || sale.credit_sales?.[0]?.customers?.name
    const searchMatch = !searchText || 
      sale.id.toString().includes(searchText) ||
      sale.total_amount.toString().includes(searchText) ||
      sale.cash_accounts?.account_name?.toLowerCase().includes(searchText) ||
      customerName?.toLowerCase().includes(searchText)

    return typeMatch && accountMatch && searchMatch
  })

  currentPage = 1
  expandedSales.clear()
  renderSales()
}

async function clearFilters() {
  const { setDateRange } = appStore.getState()
  
  // Clear date range to show all time
  setDateRange({
    startDate: null,
    endDate: null,
    preset: 'alltime'
  })
  
  const filterType = document.querySelector('#filter-type')
  const filterAccount = document.querySelector('#filter-account')
  const filterSearch = document.querySelector('#filter-search')
  
  if (filterType) filterType.value = ''
  if (filterAccount) filterAccount.value = ''
  if (filterSearch) filterSearch.value = ''
  
  // Reload data from server with no date range (all time)
  currentPage = 1
  expandedSales.clear()
  await loadSales()
}

function renderSales() {
  const container = document.querySelector('#sales-list')
  const loadMoreContainer = document.querySelector('#load-more-container')
  const salesCountContainer = document.querySelector('#sales-count')
  
  if (!container) return

  // Show loading state
  if (isLoading) {
    container.innerHTML = renderSkeletonLoader()
    loadMoreContainer.style.display = 'none'
    salesCountContainer.style.display = 'none'
    return
  }

  // Show total count
  salesCountContainer.style.display = 'block'
  salesCountContainer.querySelector('span:last-child').textContent = totalCount

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
    html += 'padding:0.875rem;'
    html += 'cursor:pointer;'
    html += 'display:flex;'
    html += 'align-items:flex-start;'
    html += 'justify-content:space-between;'
    html += 'gap:0.75rem;'
    html += '" onclick="toggleSaleItems(\'' + sale.id + '\')">'
    
    html += '<div style="flex:1;min-width:0;overflow:hidden">'
    html += '<div style="margin-bottom:0.5rem">'
    html += '<div style="font-weight:600;color:var(--dark);font-size:0.9375rem;margin-bottom:0.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + productDisplay + '</div>'
    html += '<div style="font-size:0.8125rem;color:var(--muted)">' + dateTime + '</div>'
    html += '</div>'
    const customerName = sale.customers?.name || sale.credit_sales?.[0]?.customers?.name
    
    html += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.375rem;margin-bottom:0.5rem">'
    html += '<span class="badge badge-grey" style="font-size:0.75rem">' + (sale.cash_accounts?.account_name || (sale.payment_method === 'credit' ? 'Credit Account' : 'Unknown')) + '</span>'
    html += '<span class="badge badge-' + (sale.source === 'ocr' ? 'blue' : sale.payment_method === 'credit' ? 'orange' : 'green') + '" style="font-size:0.75rem">'
    html += (sale.source === 'ocr' ? 'OCR' : sale.payment_method === 'credit' ? 'Credit' : 'POS') + '</span>'
    if (customerName) {
      html += '<span class="badge badge-blue" style="font-size:0.75rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + customerName + '</span>'
    }
    html += '</div>'
    html += '<div style="font-weight:700;color:var(--accent);font-size:1.125rem">'
    html += fmt(sale.total_amount) + ' ETB'
    html += '</div>'
    html += '</div>'
    
    html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem;flex-shrink:0">'
    html += '<button class="btn btn-outline btn-sm" style="padding:0.375rem 0.625rem;font-size:0.8125rem;white-space:nowrap" onclick="shareReceipt(\'' + sale.id + '\'); event.stopPropagation();">'
    html += renderIcon('share', 12) + ' Share'
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
    
    if (isExpanded && sale.sale_items && sale.sale_items.length > 0) {
      html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Sale Details</div>'
      
      // Customer Information Section
      const customerName = sale.customers?.name || sale.credit_sales?.[0]?.customers?.name
      const customerPhone = sale.customers?.phone || sale.credit_sales?.[0]?.customers?.phone
      
      if (customerName || sale.customer_note) {
        html += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Customer Information</div>'
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        if (customerName) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Name</div><div style="font-weight:500">' + customerName + '</div></div>'
        }
        if (customerPhone) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Phone</div><div style="font-weight:500">' + customerPhone + '</div></div>'
        }
        if (sale.credit_sales?.[0]) {
          const creditInfo = sale.credit_sales[0]
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Credit Status</div><div style="font-weight:500">' + creditInfo.status + '</div></div>'
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Amount Owed</div><div style="font-weight:600;color:var(--accent)">' + fmt(creditInfo.amount_owed) + ' ETB</div></div>'
        }
        if (sale.customer_note) {
          html += '<div style="grid-column:1/-1"><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Customer Note</div><div style="font-weight:500">' + sale.customer_note + '</div></div>'
        }
        
        html += '</div></div>'
      }
      
      // Delivery Information Section
      if (sale.targa || sale.delivery_place || sale.transport_fee && parseFloat(sale.transport_fee) > 0) {
        html += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
        html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Delivery Information</div>'
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        if (sale.targa) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Plate Number</div><div style="font-weight:500">' + sale.targa + '</div></div>'
        }
        if (sale.delivery_place) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Delivery Place</div><div style="font-weight:500">' + sale.delivery_place + '</div></div>'
        }
        if (sale.transport_fee && parseFloat(sale.transport_fee) > 0) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Transport Fee</div><div style="font-weight:600;color:var(--accent)">' + fmt(sale.transport_fee) + ' ETB</div></div>'
        }
        
        html += '</div></div>'
      }
      
      // Payment Information Section
      html += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-bottom:1rem;border:1px solid var(--border)">'
      html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Payment Information</div>'
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
      
      html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Payment Method</div><div style="font-weight:500">' + (sale.payment_method || 'Unknown') + '</div></div>'
      if (sale.payment_bank) {
        html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Bank</div><div style="font-weight:500">' + sale.payment_bank + '</div></div>'
      }
      html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Account</div><div style="font-weight:500">' + (sale.cash_accounts?.account_name || (sale.payment_method === 'credit' ? 'Credit Account' : 'Unknown')) + '</div></div>'
      html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Total Amount</div><div style="font-weight:600;color:var(--accent)">' + fmt(sale.total_amount) + ' ETB</div></div>'
      
      html += '</div></div>'
      
      // Sale Items Section
      html += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;border:1px solid var(--border)">'
      html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Sale Items (' + sale.sale_items.length + ')</div>'
      
      html += sale.sale_items.map(item => 
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
      
      html += '</div>'
      
      // Additional Information Section
      if (sale.notes || sale.ocr_log_id) {
        html += '<div style="background:var(--bg-elevated);border-radius:8px;padding:1rem;margin-top:1rem;border:1px solid var(--border)">'
        html += '<div style="font-weight:600;margin-bottom:0.75rem;color:var(--dark)">Additional Information</div>'
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem">'
        
        html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Sale ID</div><div style="font-weight:500;font-family:monospace;font-size:0.8125rem">' + sale.id + '</div></div>'
        html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Store</div><div style="font-weight:500">' + (sale.stores?.name || 'Unknown') + '</div></div>'
        html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Source</div><div style="font-weight:500">' + (sale.source || 'Unknown') + '</div></div>'
        html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Created At</div><div style="font-weight:500">' + new Date(sale.created_at).toLocaleString() + '</div></div>'
        
        if (sale.ocr_log_id) {
          html += '<div><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">OCR Processed</div><div style="font-weight:500">Yes</div></div>'
        }
        
        if (sale.notes) {
          html += '<div style="grid-column:1/-1"><div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Notes</div><div style="font-weight:500">' + sale.notes + '</div></div>'
        }
        
        html += '</div></div>'
      }
    } else if (isExpanded) {
      html += '<div style="color:var(--muted)">No items found</div>'
    } else {
      html += '<div style="color:var(--muted)">Tap to view details</div>'
    }
    
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
  
  if (isExpanded) {
    expandedSales.delete(saleId)
  } else {
    expandedSales.add(saleId)
  }
  
  renderSales()
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
  receiptText += `Payment: ${sale.payment_method || 'Unknown'}\n`
  
  if (sale.payment_bank) {
    receiptText += `Bank: ${sale.payment_bank}\n`
  }
  
  receiptText += `Account: ${sale.cash_accounts?.account_name || (sale.payment_method === 'credit' ? 'Credit Account' : 'Unknown')}\n`
  
    const customerName = sale.customers?.name || sale.credit_sales?.[0]?.customers?.name
    
    if (sale.customers?.name) {
      receiptText += `Name: ${sale.customers.name}\n`
      if (sale.customers?.phone) {
        receiptText += `Phone: ${sale.customers.phone}\n`
      }
    } else if (customerName) {
      receiptText += `Name: ${customerName}\n`
      if (customerPhone) {
        receiptText += `Phone: ${customerPhone}\n`
      }
      const creditInfo = sale.credit_sales[0]
      receiptText += `Credit Status: ${creditInfo.status}\n`
      receiptText += `Amount Owed: ${fmt(creditInfo.amount_owed)} ETB\n`
    }
  
  if (sale.customer_note) {
    receiptText += `Customer Note: ${sale.customer_note}\n`
  }
  
  if (sale.targa || sale.delivery_place || (sale.transport_fee && parseFloat(sale.transport_fee) > 0)) {
    receiptText += `\n🚚 Delivery Information\n`
    receiptText += `-------------------\n`
    if (sale.targa) {
      receiptText += `Plate Number: ${sale.targa}\n`
    }
    if (sale.delivery_place) {
      receiptText += `Delivery Place: ${sale.delivery_place}\n`
    }
    if (sale.transport_fee && parseFloat(sale.transport_fee) > 0) {
      receiptText += `Transport Fee: ${fmt(sale.transport_fee)} ETB\n`
    }
  }
  
  receiptText += `\n📦 Sale Items\n`
  receiptText += `------------\n`

  if (items && items.length > 0) {
    items.forEach(item => {
      const itemTotal = item.subtotal || (item.unit_price * item.quantity)
      receiptText += `${item.item_name_snapshot || 'Unknown'}\n`
      receiptText += `  ${item.quantity} x ${fmt(item.unit_price)} = ${fmt(itemTotal)} ETB\n`
    })
  }

  receiptText += `\n----------------\n`
  receiptText += `TOTAL: ${fmt(sale.total_amount)} ETB\n`
  
  if (sale.transport_fee && parseFloat(sale.transport_fee) > 0) {
    receiptText += `Transport Fee: ${fmt(sale.transport_fee)} ETB\n`
    receiptText += `Grand Total: ${fmt(parseFloat(sale.total_amount) + parseFloat(sale.transport_fee))} ETB\n`
  }
  
  if (sale.notes) {
    receiptText += `\n📝 Notes: ${sale.notes}\n`
  }
  
  if (sale.ocr_log_id) {
    receiptText += `\n🔍 OCR Processed: Yes\n`
  }
  
  receiptText += `Source: ${sale.source || 'Unknown'}\n`
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
