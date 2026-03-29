import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { postSaleEntry, postExpenseEntry } from '../utils/accounting.js'
import { openReceiptModal } from '../components/receipt-modal.js'
import { renderIcon } from '../components/icons.js'
import { getTransactions, invalidateAfterSale, invalidateAfterExpense } from '../utils/db.js'
import { formatDate } from '../utils/format-date.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Transactions</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-outline btn-sm" id="btn-add-expense">+ Expense</button>
        <button class="btn btn-primary btn-sm" id="btn-add-sale">+ Sale</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center">
        <select class="form-input" id="filter-type" style="max-width:160px">
          <option value="">All Types</option>
          <option value="sale">Sales</option>
          <option value="expense">Expenses</option>
        </select>
        <input type="date" class="form-input" id="filter-from" style="max-width:160px">
        <span style="color:var(--muted);font-size:13px">to</span>
        <input type="date" class="form-input" id="filter-to" style="max-width:160px">
        <button class="btn btn-outline btn-sm" id="btn-clear">Clear</button>
      </div>
    </div>

    <!-- Summary bar -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1rem">
      <div class="kpi-card">
        <div class="kpi-label">Total Sales</div>
        <div class="kpi-value accent" id="sum-sales">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Expenses</div>
        <div class="kpi-value" id="sum-expenses">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Net</div>
        <div class="kpi-value" id="sum-net">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
    </div>

    <!-- Ledger table -->
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th>Payment</th>
              <th>Amount</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody id="tx-body">
            <tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Sale Modal -->
    <div id="sale-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Record Sale</div>
          <button class="modal-close" id="sale-modal-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-input" id="sale-date">
        </div>
        <div class="form-group">
          <label class="form-label">Total Amount (ETB) *</label>
          <input type="number" class="form-input" id="sale-amount" min="0" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-input" id="sale-payment">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Cash Account</label>
          <select class="form-input" id="sale-account"></select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="sale-notes" placeholder="Optional notes">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="sale-cancel">Cancel</button>
          <button class="btn btn-primary" id="sale-save">Save Sale</button>
        </div>
      </div>
    </div>

    <!-- Expense Modal -->
    <div id="expense-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Record Expense</div>
          <button class="modal-close" id="expense-modal-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-input" id="exp-date">
        </div>
        <div class="form-group">
          <label class="form-label">Amount (ETB) *</label>
          <input type="number" class="form-input" id="exp-amount" min="0" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="form-input" id="exp-category" placeholder="e.g. Rent, Utilities, Supplies">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="exp-desc" placeholder="What was this expense for?">
        </div>
        <div class="form-group">
          <label class="form-label">Cash Account</label>
          <select class="form-input" id="exp-account"></select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="exp-cancel">Cancel</button>
          <button class="btn btn-primary" id="exp-save">Save Expense</button>
        </div>
      </div>
    </div>
  `

  // Set default dates
  const today = new Date().toISOString().split('T')[0]
  container.querySelector('#sale-date').value = today
  container.querySelector('#exp-date').value  = today

  // Load cash accounts for dropdowns
  const { data: accounts } = await supabase
    .from('cash_accounts')
    .select('id, account_name, account_type')
    .in('store_id', storeIds)

  const accountOptions = (accounts || []).map(a =>
    `<option value="${a.id}">${a.account_name}</option>`
  ).join('')

  container.querySelector('#sale-account').innerHTML = accountOptions
  container.querySelector('#exp-account').innerHTML  = accountOptions

  // ── Load transactions ──────────────────────────────────────
  let allTx = []

  async function loadTransactions() {
    const { sales, expenses } = await getTransactions()

    allTx = [
      ...(sales    || []).map(s => ({ ...s, _type: 'sale',    _amount: Number(s.total_amount), _date: s.sale_date,     _desc: s.notes || 'Sale' })),
      ...(expenses || []).map(e => ({ ...e, _type: 'expense', _amount: Number(e.amount),       _date: e.expense_date,  _desc: e.description || e.category || 'Expense' })),
    ].sort((a, b) => new Date(b._date) - new Date(a._date))

    applyFilters()
  }

  function applyFilters() {
    const type     = container.querySelector('#filter-type').value
    const from     = container.querySelector('#filter-from').value
    const to       = container.querySelector('#filter-to').value

    let filtered = allTx.filter(tx => {
      const matchType = !type || tx._type === type
      const matchFrom = !from || tx._date >= from
      const matchTo   = !to   || tx._date <= to
      return matchType && matchFrom && matchTo
    })

    renderTable(filtered)
    renderSummary(filtered)
  }

  function renderSummary(items) {
    const sales    = items.filter(t => t._type === 'sale').reduce((s, t) => s + t._amount, 0)
    const expenses = items.filter(t => t._type === 'expense').reduce((s, t) => s + t._amount, 0)
    const net      = sales - expenses

    container.querySelector('#sum-sales').textContent    = fmt(sales)
    container.querySelector('#sum-expenses').textContent = fmt(expenses)
    const netEl = container.querySelector('#sum-net')
    netEl.textContent  = fmt(net)
    netEl.style.color  = net >= 0 ? 'var(--accent)' : 'var(--danger)'
  }

  function renderTable(items) {
    const tbody = container.querySelector('#tx-body')
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-text">No transactions found</div></div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(tx => `
      <tr>
        <td>${formatDate(tx._date)}</td>
        <td>
          <span class="badge ${tx._type === 'sale' ? 'badge-green' : 'badge-red'}">
            ${tx._type === 'sale' ? 'Sale' : 'Expense'}
          </span>
        </td>
        <td>${tx._desc}</td>
        <td style="color:var(--muted)">${tx.payment_method || tx.category || '—'}</td>
        <td style="font-weight:600;color:${tx._type === 'sale' ? 'var(--accent)' : 'var(--danger)'}">
          ${tx._type === 'sale' ? '+' : '-'}${fmt(tx._amount)} ETB
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="badge badge-grey">${tx.source || 'manual'}</span>
            ${tx._type === 'sale' ? `
              <button class="btn btn-outline btn-sm" data-receipt="${tx.id}">
                ${renderIcon('reports', 13)} Receipt
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('')

    // Attach receipt listeners
    container.querySelectorAll('[data-receipt]').forEach(btn => {
      btn.addEventListener('click', () => openReceiptModal(btn.dataset.receipt))
    })
  }

  // ── Filters ────────────────────────────────────────────────
  container.querySelector('#filter-type').addEventListener('change', applyFilters)
  container.querySelector('#filter-from').addEventListener('change', applyFilters)
  container.querySelector('#filter-to').addEventListener('change', applyFilters)
  container.querySelector('#btn-clear').addEventListener('click', () => {
    container.querySelector('#filter-type').value = ''
    container.querySelector('#filter-from').value = ''
    container.querySelector('#filter-to').value   = ''
    applyFilters()
  })

  // ── Sale Modal ─────────────────────────────────────────────
  container.querySelector('#btn-add-sale').addEventListener('click', () => {
    container.querySelector('#sale-modal').style.display = 'flex'
  })
  container.querySelector('#sale-modal-close').addEventListener('click', () => {
    container.querySelector('#sale-modal').style.display = 'none'
  })
  container.querySelector('#sale-cancel').addEventListener('click', () => {
    container.querySelector('#sale-modal').style.display = 'none'
  })
  container.querySelector('#sale-save').addEventListener('click', async () => {
    const amount = Number(container.querySelector('#sale-amount').value)
    if (!amount || amount <= 0) { alert('Enter a valid amount'); return }

    const { data: sale, error } = await supabase.from('sales').insert({
      store_id:        currentStore?.id,
      cash_account_id: container.querySelector('#sale-account').value || null,
      sale_date:       container.querySelector('#sale-date').value,
      total_amount:    amount,
      payment_method:  container.querySelector('#sale-payment').value,
      notes:           container.querySelector('#sale-notes').value || null,
      source:          'manual',
    }).select().single()

    if (error) { alert('Error saving sale'); console.error(error); return }

    // After successful sale insert, post journal entry
    if (sale) {
      try {
        await postSaleEntry({
          storeId:   currentStore?.id,
          saleId:    sale.id,
          date:      sale.sale_date,
          amount:    sale.total_amount,
          isCredit:  sale.payment_method === 'credit',
        })
      } catch(e) { console.warn('Journal post failed:', e.message) }
    }

    invalidateAfterSale()
    container.querySelector('#sale-modal').style.display = 'none'
    container.querySelector('#sale-amount').value = ''
    container.querySelector('#sale-notes').value  = ''
    await loadTransactions()
  })

  // ── Expense Modal ──────────────────────────────────────────
  container.querySelector('#btn-add-expense').addEventListener('click', () => {
    container.querySelector('#expense-modal').style.display = 'flex'
  })
  container.querySelector('#expense-modal-close').addEventListener('click', () => {
    container.querySelector('#expense-modal').style.display = 'none'
  })
  container.querySelector('#exp-cancel').addEventListener('click', () => {
    container.querySelector('#expense-modal').style.display = 'none'
  })
  container.querySelector('#exp-save').addEventListener('click', async () => {
    const amount = Number(container.querySelector('#exp-amount').value)
    if (!amount || amount <= 0) { alert('Enter a valid amount'); return }

    const { data: exp, error } = await supabase.from('expenses').insert({
      store_id:        currentStore?.id,
      cash_account_id: container.querySelector('#exp-account').value || null,
      expense_date:    container.querySelector('#exp-date').value,
      amount:          amount,
      category:        container.querySelector('#exp-category').value || null,
      description:     container.querySelector('#exp-desc').value     || null,
      source:          'manual',
    }).select().single()

    if (error) { alert('Error saving expense'); console.error(error); return }

    // After successful expense insert, post journal entry
    if (exp) {
      try {
        await postExpenseEntry({
          storeId:    currentStore?.id,
          expenseId:  exp.id,
          date:       exp.expense_date,
          amount:     exp.amount,
          category:   exp.category,
        })
      } catch(e) { console.warn('Journal post failed:', e.message) }
    }

    invalidateAfterExpense()
    container.querySelector('#expense-modal').style.display = 'none'
    container.querySelector('#exp-amount').value   = ''
    container.querySelector('#exp-category').value = ''
    container.querySelector('#exp-desc').value     = ''
    await loadTransactions()
  })

  await loadTransactions()
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}