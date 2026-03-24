import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { audit } from '../utils/audit.js'
import { getTransactions, invalidateAfterExpense } from '../utils/db.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Expenses</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-add">+ Add Expense</button>
    </div>

    <!-- Summary -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1rem">
      <div class="kpi-card">
        <div class="kpi-label">This Month</div>
        <div class="kpi-value" id="sum-month">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">This Week</div>
        <div class="kpi-value" id="sum-week">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Today</div>
        <div class="kpi-value" id="sum-today">0.00</div>
        <div class="kpi-sub">ETB</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Top Category</div>
        <div class="kpi-value" id="sum-top" style="font-size:1rem">—</div>
        <div class="kpi-sub">this month</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
        <input class="form-input" id="search" placeholder="Search expenses..." style="max-width:240px">
        <select class="form-input" id="filter-category" style="max-width:180px">
          <option value="">All Categories</option>
        </select>
        <input type="date" class="form-input" id="filter-from" style="max-width:155px">
        <input type="date" class="form-input" id="filter-to"   style="max-width:155px">
        <button class="btn btn-outline btn-sm" id="btn-clear">Clear</button>
      </div>
    </div>

    <!-- Category chips -->
    <div id="category-chips" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem"></div>

    <!-- Table -->
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Account</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="exp-body">
            <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <div id="exp-modal" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" id="modal-title">Add Expense</div>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Date</label>
            <input type="date" class="form-input" id="f-date">
          </div>
          <div class="form-group">
            <label class="form-label">Amount (ETB) *</label>
            <input type="number" class="form-input" id="f-amount" min="0" placeholder="0.00">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label class="form-label">Category</label>
            <input class="form-input" id="f-category" placeholder="e.g. Rent, Utilities">
          </div>
          <div class="form-group">
            <label class="form-label">Paid from Account *</label>
            <select class="form-input" id="f-account" required>
              <option value="">— Select account —</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" id="f-desc" placeholder="What was this expense for?">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="f-notes" placeholder="Optional notes">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
          <button class="btn btn-outline" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save Expense</button>
        </div>
      </div>
    </div>
  `

  const today     = new Date().toISOString().split('T')[0]
  container.querySelector('#f-date').value = today

  // Load cash accounts
  const { data: accounts } = await supabase
    .from('cash_accounts')
    .select('id, name, account_type, balance')
    .in('store_id', storeIds)

  container.querySelector('#f-account').innerHTML =
    '<option value="">— Select account —</option>' +
    (accounts || []).map(a =>
      `<option value="${a.id}">${a.account_type === 'bank' ? '🏦' : '🏪'} ${a.name} (${fmt(a.balance)} ETB)</option>`
    ).join('')

  let allExpenses = []
  let editingId   = null
  let activeCategory = ''

  // ── Load ───────────────────────────────────────────────────
  async function loadExpenses() {
    const { expenses } = await getTransactions()
    allExpenses = expenses || []

    // Categories
    const cats = [...new Set(allExpenses.map(e => e.category).filter(Boolean))]
    const catSelect = container.querySelector('#filter-category')
    if (catSelect) {
      catSelect.innerHTML = `<option value="">All Categories</option>` +
        cats.map(c => `<option value="${c}">${c}</option>`).join('')
    }

    // Category chips
    const chipsEl = container.querySelector('#category-chips')
    if (chipsEl) {
      chipsEl.innerHTML = cats.map(c => `
        <span class="badge ${activeCategory === c ? 'badge-teal' : 'badge-grey'}"
              style="cursor:pointer" data-cat="${c}">${c}</span>
      `).join('')

      chipsEl.querySelectorAll('[data-cat]').forEach(chip => {
        chip.addEventListener('click', () => {
          activeCategory = activeCategory === chip.dataset.cat ? '' : chip.dataset.cat
          loadExpenses()
        })
      })
    }

    updateSummary()
    applyFilters()
  }

  function updateSummary() {
    const now       = new Date()
    const todayStr  = now.toISOString().split('T')[0]
    const weekAgo   = new Date(now - 7  * 86400000).toISOString().split('T')[0]
    const monthStart= `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`

    const todayAmt  = allExpenses.filter(e => e.expense_date === todayStr).reduce((s,e) => s + Number(e.amount), 0)
    const weekAmt   = allExpenses.filter(e => e.expense_date >= weekAgo).reduce((s,e) => s + Number(e.amount), 0)
    const monthAmt  = allExpenses.filter(e => e.expense_date >= monthStart).reduce((s,e) => s + Number(e.amount), 0)

    // Top category this month
    const catTotals = {}
    allExpenses.filter(e => e.expense_date >= monthStart).forEach(e => {
      if (e.category) catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount)
    })
    const topCat = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0]?.[0] || '—'

    container.querySelector('#sum-today').textContent = fmt(todayAmt)
    container.querySelector('#sum-week').textContent  = fmt(weekAmt)
    container.querySelector('#sum-month').textContent = fmt(monthAmt)
    container.querySelector('#sum-top').textContent   = topCat
  }

  function applyFilters() {
    const search   = container.querySelector('#search').value.toLowerCase()
    const category = container.querySelector('#filter-category').value || activeCategory
    const from     = container.querySelector('#filter-from').value
    const to       = container.querySelector('#filter-to').value

    const filtered = allExpenses.filter(e => {
      const matchSearch = (e.description || '').toLowerCase().includes(search) ||
                          (e.category    || '').toLowerCase().includes(search)
      const matchCat  = !category || e.category === category
      const matchFrom = !from || e.expense_date >= from
      const matchTo   = !to   || e.expense_date <= to
      return matchSearch && matchCat && matchFrom && matchTo
    })

    renderTable(filtered)
  }

  function renderTable(items) {
    const tbody = container.querySelector('#exp-body')
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No expenses found</div></div></td></tr>`
      return
    }

    tbody.innerHTML = items.map(e => `
      <tr>
        <td>${e.expense_date}</td>
        <td>${e.category ? `<span class="badge badge-grey">${e.category}</span>` : '—'}</td>
        <td>${e.description || '—'}</td>
        <td style="font-weight:600;color:var(--danger)">-${fmt(e.amount)} ETB</td>
        <td><span class="badge ${e.cash_accounts?.account_type === 'bank' ? 'badge-blue' : 'badge-teal'}">
          ${e.cash_accounts ? (e.cash_accounts.account_type === 'bank' ? '🏦 ' : '🏪 ') + e.cash_accounts.name : '—'}
        </span></td>
        <td><span class="badge badge-grey">${e.source || 'manual'}</span></td>
        <td>
          <div style="display:flex;gap:0.4rem">
            <button class="btn btn-outline btn-sm" data-action="edit" data-id="${e.id}">Edit</button>
            <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border)" data-action="delete" data-id="${e.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('')

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id } = btn.dataset
        if (action === 'edit')   openEditModal(id)
        if (action === 'delete') deleteExpense(id)
      })
    })
  }

  // ── Filters ────────────────────────────────────────────────
  container.querySelector('#search').addEventListener('input', applyFilters)
  container.querySelector('#filter-category').addEventListener('change', applyFilters)
  container.querySelector('#filter-from').addEventListener('change', applyFilters)
  container.querySelector('#filter-to').addEventListener('change', applyFilters)
  container.querySelector('#btn-clear').addEventListener('click', () => {
    container.querySelector('#search').value          = ''
    container.querySelector('#filter-category').value = ''
    container.querySelector('#filter-from').value     = ''
    container.querySelector('#filter-to').value       = ''
    activeCategory = ''
    loadExpenses()
  })

  // ── Modal ──────────────────────────────────────────────────
  function openAddModal() {
    editingId = null
    container.querySelector('#modal-title').textContent = 'Add Expense'
    container.querySelector('#f-date').value     = today
    container.querySelector('#f-amount').value   = ''
    container.querySelector('#f-category').value = ''
    container.querySelector('#f-desc').value     = ''
    container.querySelector('#f-notes').value    = ''
    container.querySelector('#exp-modal').style.display = 'flex'
  }

  function openEditModal(id) {
    const e = allExpenses.find(x => x.id === id)
    if (!e) return
    editingId = id
    container.querySelector('#modal-title').textContent = 'Edit Expense'
    container.querySelector('#f-date').value     = e.expense_date || today
    container.querySelector('#f-amount').value   = e.amount       || ''
    container.querySelector('#f-category').value = e.category     || ''
    container.querySelector('#f-desc').value     = e.description  || ''
    container.querySelector('#f-notes').value    = e.notes        || ''
    if (e.cash_account_id) container.querySelector('#f-account').value = e.cash_account_id
    container.querySelector('#exp-modal').style.display = 'flex'
  }

  function closeModal() {
    container.querySelector('#exp-modal').style.display = 'none'
  }

  async function saveExpense() {
    const amount    = Number(container.querySelector('#f-amount').value)
    const accountId = container.querySelector('#f-account').value
    if (!amount || amount <= 0) { alert('Enter a valid amount'); return }
    if (!accountId) { alert('Please select which account this expense came from'); return }

    const payload = {
      store_id:        currentStore?.id,
      cash_account_id: accountId,
      expense_date:    container.querySelector('#f-date').value,
      amount,
      category:        container.querySelector('#f-category').value || null,
      description:     container.querySelector('#f-desc').value     || null,
      notes:           container.querySelector('#f-notes').value    || null,
      source:          'manual',
    }

    if (editingId) {
      const oldExpense = allExpenses.find(e => e.id === editingId)
      const { data: updatedExpense, error } = await supabase.from('expenses').update(payload).eq('id', editingId).select().single()
      if (error) { alert('Error updating expense'); console.error(error); return }
      if (updatedExpense) await audit.expenseUpdated(oldExpense, updatedExpense)

      // Adjust balance: add back old amount, deduct new amount
      if (oldExpense?.cash_account_id) {
        const { data: oldAcc } = await supabase.from('cash_accounts').select('balance').eq('id', oldExpense.cash_account_id).single()
        if (oldAcc) await supabase.from('cash_accounts').update({ balance: Number(oldAcc.balance) + Number(oldExpense.amount) }).eq('id', oldExpense.cash_account_id)
      }
      const { data: newAcc } = await supabase.from('cash_accounts').select('balance').eq('id', accountId).single()
      if (newAcc) await supabase.from('cash_accounts').update({ balance: Number(newAcc.balance) - amount }).eq('id', accountId)
    } else {
      const { data: exp, error } = await supabase.from('expenses').insert(payload).select().single()
      if (error) { alert('Error saving expense'); console.error(error); return }
      if (exp) await audit.expenseCreated(exp)

      // Deduct from cash account
      const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', accountId).single()
      if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) - amount }).eq('id', accountId)
    }

    invalidateAfterExpense()
    closeModal()
    await loadExpenses()
  }

  async function deleteExpense(id) {
    if (!confirm('Delete this expense?')) return
    const expense = allExpenses.find(e => e.id === id)
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { alert('Error deleting expense'); return }
    if (expense) await audit.expenseDeleted(expense)
    invalidateAfterExpense()
    await loadExpenses()
  }

  container.querySelector('#btn-add').addEventListener('click', openAddModal)
  container.querySelector('#modal-close').addEventListener('click', closeModal)
  container.querySelector('#modal-cancel').addEventListener('click', closeModal)
  container.querySelector('#modal-save').addEventListener('click', saveExpense)

  await loadExpenses()
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}