import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from './icons.js'
import { navigate } from '../router.js'

export function openAddStoreModal(onSuccess) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.style.display = 'flex'

  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <div class="modal-title">Add New Store</div>
        <button class="modal-close" id="add-store-close">
          ${renderIcon('close', 14)}
        </button>
      </div>

      <!-- Error -->
      <div id="add-store-error" style="
        display:none;background:var(--red-50);color:#991B1B;
        border:1px solid #FECACA;border-radius:var(--radius);
        padding:0.625rem 0.875rem;font-size:0.875rem;margin-bottom:1rem;
      "></div>

      <!-- Store name -->
      <div class="form-group">
        <label class="form-label">Store Name *</label>
        <input class="form-input" id="new-store-name"
          placeholder="e.g. Branch 2, Warehouse, Online Store"
          style="font-size:1rem">
        <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">
          This name appears in the store switcher and all reports
        </div>
      </div>

      <!-- Currency -->
      <div class="form-group">
        <label class="form-label">Currency</label>
        <select class="form-input" id="new-store-currency">
          <option value="ETB" selected>ETB — Ethiopian Birr</option>
          <option value="USD">USD — US Dollar</option>
          <option value="EUR">EUR — Euro</option>
        </select>
      </div>

      <!-- Accounting view -->
      <div class="form-group">
        <label class="form-label">Accounting View</label>
        <select class="form-input" id="new-store-av">
          <option value="separate" selected>Separate — independent books</option>
          <option value="joint">Joint — combined with other stores</option>
        </select>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">
          Separate keeps this store's financials independent.
          Joint merges into combined reports.
        </div>
      </div>

      <!-- Cash accounts -->
      <div class="form-group">
        <label class="form-label">Initial Cash Accounts</label>
        <div id="new-store-accounts">
          <div style="display:grid;grid-template-columns:1fr 140px;gap:0.5rem;margin-bottom:0.5rem">
            <input class="form-input" value="Store Till" id="acc-name-0" placeholder="Account name">
            <div style="position:relative">
              <input class="form-input" type="number" id="acc-bal-0"
                placeholder="0.00" min="0" style="padding-right:2.5rem">
              <span style="position:absolute;right:0.625rem;top:50%;transform:translateY(-50%);font-size:0.75rem;color:var(--muted)">ETB</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 140px;gap:0.5rem;margin-bottom:0.5rem">
            <input class="form-input" value="Bank Account" id="acc-name-1" placeholder="Account name">
            <div style="position:relative">
              <input class="form-input" type="number" id="acc-bal-1"
                placeholder="0.00" min="0" style="padding-right:2.5rem">
              <span style="position:absolute;right:0.625rem;top:50%;transform:translateY(-50%);font-size:0.75rem;color:var(--muted)">ETB</span>
            </div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-add-acc" style="gap:0.3rem;margin-top:0.25rem">
          ${renderIcon('plus', 13)} Add account
        </button>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:0.625rem;margin-top:1.25rem">
        <button class="btn btn-outline" id="btn-store-cancel" style="flex:1;justify-content:center">
          Cancel
        </button>
        <button class="btn btn-primary" id="btn-store-save" style="flex:2;justify-content:center">
          ${renderIcon('store', 16)} Create Store
        </button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  let extraAccounts = []

  // Add extra account row
  overlay.querySelector('#btn-add-acc').addEventListener('click', () => {
    const idx = 2 + extraAccounts.length
    extraAccounts.push({ name: '', balance: 0 })

    const row = document.createElement('div')
    row.style.cssText = 'display:grid;grid-template-columns:1fr 140px auto;gap:0.5rem;margin-bottom:0.5rem'
    row.innerHTML = `
      <input class="form-input" id="acc-name-${idx}" placeholder="Account name">
      <div style="position:relative">
        <input class="form-input" type="number" id="acc-bal-${idx}"
          placeholder="0.00" min="0" style="padding-right:2.5rem">
        <span style="position:absolute;right:0.625rem;top:50%;transform:translateY(-50%);font-size:0.75rem;color:var(--muted)">ETB</span>
      </div>
      <button style="
        width:36px;height:36px;border-radius:var(--radius);
        border:1px solid var(--border);background:none;
        display:flex;align-items:center;justify-content:center;
        color:var(--muted);cursor:pointer;flex-shrink:0;
      " data-remove-row="${idx}">${renderIcon('close', 13)}</button>
    `
    overlay.querySelector('#new-store-accounts').appendChild(row)

    row.querySelector(`[data-remove-row]`).addEventListener('click', () => row.remove())
  })

  // Close
  const close = () => overlay.remove()
  overlay.querySelector('#add-store-close').addEventListener('click', close)
  overlay.querySelector('#btn-store-cancel').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  // Save
  overlay.querySelector('#btn-store-save').addEventListener('click', async () => {
    const name     = overlay.querySelector('#new-store-name').value.trim()
    const currency = overlay.querySelector('#new-store-currency').value
    const av       = overlay.querySelector('#new-store-av').value
    const errorEl  = overlay.querySelector('#add-store-error')
    const saveBtn  = overlay.querySelector('#btn-store-save')

    if (!name) {
      errorEl.textContent = 'Store name is required'
      errorEl.style.display = 'block'
      overlay.querySelector('#new-store-name').focus()
      return
    }

    saveBtn.textContent = 'Creating...'
    saveBtn.disabled    = true
    errorEl.style.display = 'none'

    try {
      // Get owner
      const user = appStore.getState().user
      const { data: owner, error: ownerErr } = await supabase
        .from('owners')
        .select('id')
        .eq('email', user.email)
        .single()

      if (ownerErr || !owner) throw new Error('Owner not found. Please sign in again.')

      // Create store
      const { data: store, error: storeErr } = await supabase
        .from('stores')
        .insert({
          owner_id:        owner.id,
          name:            name,
          currency:        currency,
          accounting_view: av,
        })
        .select()
        .single()

      if (storeErr) throw storeErr

      // Collect all account rows
      const accountRows = []

      // Default 2 accounts
      const n0 = overlay.querySelector('#acc-name-0')?.value.trim()
      const b0 = Number(overlay.querySelector('#acc-bal-0')?.value) || 0
      if (n0) accountRows.push({ account_name: n0, type: 'till', balance: b0 })

      const n1 = overlay.querySelector('#acc-name-1')?.value.trim()
      const b1 = Number(overlay.querySelector('#acc-bal-1')?.value) || 0
      if (n1) accountRows.push({ account_name: n1, type: 'bank', balance: b1 })

      // Extra accounts
      overlay.querySelectorAll('[id^="acc-name-"]').forEach(input => {
        const idx = input.id.replace('acc-name-', '')
        if (Number(idx) < 2) return
        const n = input.value.trim()
        const b = Number(overlay.querySelector(`#acc-bal-${idx}`)?.value) || 0
        if (n) accountRows.push({ account_name: n, type: 'bank', balance: b })
      })

      // Create cash accounts
      for (const acc of accountRows) {
        await supabase.from('cash_accounts').insert({
          store_id:     store.id,
          account_name: acc.account_name,
          account_type: acc.type,
          balance:      acc.balance,
        })
      }

      // Seed chart of accounts
      try {
        await supabase.rpc('seed_chart_of_accounts', { p_store_id: store.id })
      } catch(_) {}

      // Update app state
      const currentStores = appStore.getState().stores
      const updatedStores = [...currentStores, store]
      appStore.getState().setStores(updatedStores)

      close()

      // Success toast
      const toast = document.createElement('div')
      toast.className = 'toast toast-success'
      toast.textContent = `✓ ${name} created successfully`
      let wrap = document.querySelector('.toast-container')
      if (!wrap) {
        wrap = document.createElement('div')
        wrap.className = 'toast-container'
        document.body.appendChild(wrap)
      }
      wrap.appendChild(toast)
      setTimeout(() => toast.remove(), 3000)

      if (onSuccess) onSuccess(store)

    } catch(err) {
      console.error('Create store error:', err)
      errorEl.textContent   = err.message
      errorEl.style.display = 'block'
      saveBtn.innerHTML     = `${renderIcon('store', 16)} Create Store`
      saveBtn.disabled      = false
    }
  })

  // Auto focus
  setTimeout(() => overlay.querySelector('#new-store-name')?.focus(), 100)
}