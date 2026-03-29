import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { postTransferEntry } from '../utils/accounting.js'
import { audit } from '../utils/audit.js'
import { invalidateAfterTransfer } from '../utils/db.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Cash Transfers</div>
        <div class="page-sub">Move money between accounts</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-new-transfer">+ New Transfer</button>
    </div>

    <!-- Account balances overview -->
    <div id="accounts-grid" class="kpi-grid" style="margin-bottom:1.5rem">
      <div class="kpi-card"><div class="kpi-label">Loading accounts...</div></div>
    </div>

    <!-- Transfer form card -->
    <div class="card" style="max-width:520px;margin-bottom:1.5rem" id="transfer-form-card">
      <div style="font-weight:700;font-size:1rem;margin-bottom:1rem">New Transfer</div>

      <div class="form-group">
        <label class="form-label">From Account *</label>
        <select class="form-input" id="from-account"></select>
      </div>

      <!-- Arrow indicator -->
      <div style="text-align:center;font-size:1.5rem;color:var(--accent);margin:0.5rem 0">↓</div>

      <div class="form-group">
        <label class="form-label">To Account *</label>
        <select class="form-input" id="to-account"></select>
      </div>

      <div class="form-group">
        <label class="form-label">Amount (ETB) *</label>
        <input type="number" class="form-input" id="transfer-amount" min="0.01" placeholder="0.00">
        <div id="balance-warning" style="display:none;color:var(--danger);font-size:12px;margin-top:4px">
          ⚠️ Amount exceeds available balance
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="form-input" id="transfer-notes" placeholder="e.g. Daily cash deposit to bank">
      </div>

      <div style="display:flex;gap:0.75rem">
        <button class="btn btn-outline" id="btn-cancel-transfer" style="flex:1;justify-content:center">Clear</button>
        <button class="btn btn-primary" id="btn-confirm-transfer" style="flex:2;justify-content:center">
          ⇄ Confirm Transfer
        </button>
      </div>
    </div>

    <!-- Transfer history -->
    <div class="card">
      <div style="font-weight:600;margin-bottom:1rem">Transfer History</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody id="transfer-history">
            <tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `

  let accounts = []

  async function loadAccounts() {
    const { data } = await supabase
      .from('cash_accounts')
      .select('id, account_name, account_type, balance, store_id, stores(name)')
      .in('store_id', storeIds)
      .order('account_type')

    accounts = data || []

    // Render account cards
    const grid = container.querySelector('#accounts-grid')
    grid.innerHTML = accounts.map(a => `
      <div class="kpi-card" style="border-left:3px solid ${a.account_type === 'till' ? 'var(--accent)' : 'var(--dark)'}">
        <div class="kpi-label">${a.account_name}</div>
        <div class="kpi-value ${a.account_type === 'till' ? 'accent' : ''}">${fmt(a.balance)}</div>
        <div class="kpi-sub">
          ${a.account_type === 'till' ? '🏪 Till' : '🏦 Bank'}
          ${accountingView === 'joint' ? ` · ${a.stores?.name}` : ''}
        </div>
      </div>
    `).join('')

    // Populate dropdowns
    const fromSel = container.querySelector('#from-account')
    const toSel   = container.querySelector('#to-account')

    const options = accounts.map(a =>
      `<option value="${a.id}" data-balance="${a.balance}">${a.account_name} (${fmt(a.balance)} ETB)</option>`
    ).join('')

    fromSel.innerHTML = options
    toSel.innerHTML   = options

    // Default: if first is till, set second to bank
    if (accounts.length >= 2) {
      toSel.selectedIndex = 1
    }
  }

  async function loadHistory() {
    const { data: transfers } = await supabase
      .from('cash_transfers')
      .select(`
        *,
        from_account:from_account_id(account_name),
        to_account:to_account_id(account_name)
      `)
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })
      .limit(50)

    const tbody = container.querySelector('#transfer-history')

    if (!transfers || transfers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-text">No transfers yet</div></div></td></tr>`
      return
    }

    tbody.innerHTML = transfers.map(t => `
      <tr>
        <td>${new Date(t.created_at).toLocaleDateString()}</td>
        <td>
          <span style="color:var(--danger)">↑</span>
          ${t.from_account?.account_name || '—'}
        </td>
        <td>
          <span style="color:var(--accent)">↓</span>
          ${t.to_account?.account_name || '—'}
        </td>
        <td style="font-weight:700">${fmt(t.amount)} ETB</td>
        <td style="color:var(--muted)">${t.notes || '—'}</td>
      </tr>
    `).join('')
  }

  // ── Balance warning ───────────────────────────────────────
  container.querySelector('#transfer-amount').addEventListener('input', e => {
    const amount     = Number(e.target.value) || 0
    const fromId     = container.querySelector('#from-account').value
    const fromAcc    = accounts.find(a => a.id === fromId)
    const warning    = container.querySelector('#balance-warning')
    if (fromAcc && amount > Number(fromAcc.balance)) {
      warning.style.display = 'block'
      warning.textContent   = `⚠️ Available balance: ${fmt(fromAcc.balance)} ETB`
    } else {
      warning.style.display = 'none'
    }
  })

  container.querySelector('#from-account').addEventListener('change', () => {
    container.querySelector('#transfer-amount').dispatchEvent(new Event('input'))
  })

  // ── Clear form ────────────────────────────────────────────
  container.querySelector('#btn-cancel-transfer').addEventListener('click', () => {
    container.querySelector('#transfer-amount').value = ''
    container.querySelector('#transfer-notes').value  = ''
    container.querySelector('#balance-warning').style.display = 'none'
  })

  // ── Confirm transfer ──────────────────────────────────────
  container.querySelector('#btn-confirm-transfer').addEventListener('click', async () => {
    const fromId  = container.querySelector('#from-account').value
    const toId    = container.querySelector('#to-account').value
    const amount  = Number(container.querySelector('#transfer-amount').value)
    const notes   = container.querySelector('#transfer-notes').value.trim()

    if (!fromId || !toId)         { alert('Select both accounts'); return }
    if (fromId === toId)          { alert('From and To accounts must be different'); return }
    if (!amount || amount <= 0)   { alert('Enter a valid amount'); return }

    const fromAcc = accounts.find(a => a.id === fromId)
    if (fromAcc && amount > Number(fromAcc.balance)) {
      if (!confirm(`⚠️ This will overdraw ${fromAcc.account_name}. Continue?`)) return
    }

    const btn = container.querySelector('#btn-confirm-transfer')
    btn.textContent = 'Processing...'
    btn.disabled    = true

    const { data, error } = await supabase.from('cash_transfers').insert({
      store_id:        currentStore?.id,
      from_account_id: fromId,
      to_account_id:   toId,
      amount,
      notes: notes || null,
    }).select().single()

    if (error) {
      alert(`Transfer failed: ${error.message}`)
      btn.textContent = '⇄ Confirm Transfer'
      btn.disabled    = false
      return
    }

    // After successful transfer insert, post journal entry
    if (data) {
      const fromAccObj = accounts.find(a => a.id === fromId)
      const toAccObj   = accounts.find(a => a.id === toId)

      // Audit log
      await audit.transferCreated(data, fromAccObj?.account_name, toAccObj?.account_name)

      try {
        await postTransferEntry({
          storeId:    currentStore?.id,
          transferId: data.id,
          date:       new Date().toISOString().split('T')[0],
          amount,
          fromType:   fromAccObj?.account_type,
          toType:     toAccObj?.account_type,
        })
      } catch(e) { console.warn('Journal post failed:', e.message) }
    }

    invalidateAfterTransfer()
    btn.textContent = '⇄ Confirm Transfer'
    btn.disabled    = false
    container.querySelector('#transfer-amount').value = ''
    container.querySelector('#transfer-notes').value  = ''

    await Promise.all([loadAccounts(), loadHistory()])
  })

  await Promise.all([loadAccounts(), loadHistory()])
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}