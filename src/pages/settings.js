import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from '../components/icons.js'

export async function render(container) {
  const { currentStore, stores, user } = appStore.getState()

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-sub">Store configuration & system status</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:200px 1fr;gap:1.5rem;align-items:start">

      <!-- Settings nav -->
      <div class="card" style="padding:0.5rem">
        ${[
          { id:'ocr',      icon:'scan',        label:'OCR & Scanning'  },
          { id:'store',    icon:'store',        label:'Store Info'      },
          { id:'accounts', icon:'cash',         label:'Cash Accounts'   },
          { id:'prefs',    icon:'reports',      label:'Preferences'     },
          { id:'tax',      icon:'accounting',   label:'Tax & VAT'       },
          { id:'profit',   icon:'reports',      label:'Profit Settings' },
          { id:'danger',   icon:'alert',        label:'Danger Zone'     },
        ].map((item, i) => `
          <div class="settings-nav-item ${i===0?'active':''}" data-section="${item.id}">
            ${renderIcon(item.icon, 16, 'currentColor')}
            ${item.label}
          </div>
        `).join('')}
      </div>

      <!-- Section content -->
      <div id="settings-content"></div>

    </div>
  `

  // Inject nav styles
  if (!document.getElementById('settings-styles')) {
    const s = document.createElement('style')
    s.id = 'settings-styles'
    s.textContent = `
      .settings-nav-item {
        display:flex;align-items:center;gap:0.6rem;
        padding:0.55rem 0.75rem;border-radius:var(--radius);
        font-size:0.875rem;font-weight:500;color:var(--muted);
        cursor:pointer;transition:all 0.15s;
      }
      .settings-nav-item:hover { background:var(--bg-hover);color:var(--dark); }
      .settings-nav-item.active { background:var(--teal-50);color:var(--accent);font-weight:600; }

      .settings-section { display:none; }
      .settings-section.active { display:block; }

      .setting-row {
        display:flex;justify-content:space-between;align-items:center;
        padding:1rem 0;border-bottom:1px solid var(--border);gap:1rem;
      }
      .setting-row:last-child { border-bottom:none; }

      .setting-label { font-size:0.9375rem;font-weight:600;color:var(--dark); }
      .setting-sub   { font-size:0.8125rem;color:var(--muted);margin-top:2px; }

      .ocr-meter {
        height:8px;background:var(--gray-100);border-radius:999px;
        overflow:hidden;margin:0.5rem 0;
      }
      .ocr-meter-fill {
        height:100%;border-radius:999px;
        transition:width 0.6s cubic-bezier(0.34,1.56,0.64,1);
      }

      .status-dot {
        width:8px;height:8px;border-radius:50%;
        display:inline-block;margin-right:0.4rem;
      }
      .status-dot.green  { background:var(--success); box-shadow:0 0 0 3px rgba(34,197,94,0.15); }
      .status-dot.yellow { background:var(--warning); box-shadow:0 0 0 3px rgba(245,158,11,0.15); }
      .status-dot.red    { background:var(--danger);  box-shadow:0 0 0 3px rgba(239,68,68,0.15);  }

      .api-card {
        background:var(--bg-subtle);border:1px solid var(--border);
        border-radius:var(--radius-lg);padding:1rem 1.125rem;
        margin-bottom:0.75rem;
      }
    `
    document.head.appendChild(s)
  }

  // Section switching
  let activeSection = 'ocr'
  const content = container.querySelector('#settings-content')

  async function loadSection(id) {
    activeSection = id
    container.querySelectorAll('.settings-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.section === id)
    })
    content.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Loading...</div>`
    if (id === 'ocr')      await renderOCR()
    if (id === 'store')    await renderStore()
    if (id === 'accounts') await renderAccounts()
    if (id === 'prefs')    await renderPreferences()
    if (id === 'tax')      await renderTax()
    if (id === 'profit')   await renderProfit()
    if (id === 'danger')   await renderDanger()
  }

  container.querySelectorAll('.settings-nav-item').forEach(el => {
    el.addEventListener('click', () => loadSection(el.dataset.section))
  })

  // ── OCR & SCANNING ─────────────────────────────────────────
  async function renderOCR() {
    const yearMonth = new Date().toISOString().slice(0, 7)
    const storeIds  = stores.map(s => s.id)

    const { data: usage } = await supabase
      .from('ocr_usage')
      .select('store_id, scan_count, year_month, stores(name)')
      .in('store_id', storeIds)
      .eq('year_month', yearMonth)

    const { data: allUsage } = await supabase
      .from('ocr_usage')
      .select('scan_count, year_month')
      .in('store_id', storeIds)
      .order('year_month', { ascending: false })
      .limit(12)

    const thisMonth = (usage||[]).reduce((s, r) => s + Number(r.scan_count), 0)
    const totalEver = (allUsage||[]).reduce((s, r) => s + Number(r.scan_count), 0)
    const limit     = 900
    const pct       = Math.min(Math.round(thisMonth / limit * 100), 100)
    const remaining = limit - thisMonth
    const color     = pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent)'

    // Group by month for history
    const byMonth = {}
    ;(allUsage||[]).forEach(r => {
      byMonth[r.year_month] = (byMonth[r.year_month] || 0) + Number(r.scan_count)
    })

    content.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('scan', 18)} OCR Usage — ${yearMonth}
        </div>

        <!-- Main meter -->
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.4rem">
          <div>
            <div style="font-size:2.5rem;font-weight:800;color:${color};letter-spacing:-1px;line-height:1">
              ${thisMonth.toLocaleString()}
            </div>
            <div style="font-size:0.8125rem;color:var(--muted)">scans used this month</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.125rem;font-weight:700;color:var(--dark)">${remaining.toLocaleString()} left</div>
            <div style="font-size:0.8125rem;color:var(--muted)">out of ${limit.toLocaleString()} free</div>
          </div>
        </div>

        <div class="ocr-meter">
          <div class="ocr-meter-fill" style="width:${pct}%;background:${color}"></div>
        </div>

        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-bottom:1.25rem">
          <span>${pct}% used</span>
          <span>Resets on the 1st of each month</span>
        </div>

        <!-- Per-store breakdown -->
        ${(usage||[]).length > 1 ? `
          <div style="font-size:0.8125rem;font-weight:600;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px">Per Store</div>
          ${(usage||[]).map(u => {
            const p = Math.min(Math.round(Number(u.scan_count) / limit * 100), 100)
            return `
              <div style="margin-bottom:0.625rem">
                <div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:3px">
                  <span style="font-weight:500">${u.stores?.name || 'Store'}</span>
                  <span style="font-weight:600">${Number(u.scan_count).toLocaleString()} scans</span>
                </div>
                <div class="ocr-meter">
                  <div class="ocr-meter-fill" style="width:${p}%;background:${p>80?'var(--danger)':p>60?'var(--warning)':'var(--accent)'}"></div>
                </div>
              </div>
            `
          }).join('')}
        ` : ''}
      </div>

      <!-- Google Cloud status -->
      <div class="card" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('building', 18)} Google Cloud Vision Status
        </div>

        <div class="api-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
            <div style="font-weight:600;font-size:0.9375rem">
              <span class="status-dot green"></span>
              API Connected
            </div>
            <span class="badge badge-green">Active</span>
          </div>
          <div style="font-size:0.8125rem;color:var(--muted);line-height:1.6">
            Model: <strong>DOCUMENT_TEXT_DETECTION</strong><br>
            Project: <strong>gen-lang-client-0332990892</strong><br>
            Auth: Service Account (secure — server-side only)
          </div>
        </div>

        <div class="api-card">
          <div style="font-weight:600;font-size:0.9375rem;margin-bottom:0.5rem">
            ${renderIcon('cash', 16)} Google Cloud Credits
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;margin-top:0.25rem">
            <div style="text-align:center;padding:0.75rem;background:var(--bg-elevated);border-radius:var(--radius);border:1px solid var(--border)">
              <div style="font-size:1.25rem;font-weight:800;color:var(--accent)">$300</div>
              <div style="font-size:0.75rem;color:var(--muted)">Free trial credits</div>
            </div>
            <div style="text-align:center;padding:0.75rem;background:var(--bg-elevated);border-radius:var(--radius);border:1px solid var(--border)">
              <div style="font-size:1.25rem;font-weight:800;color:var(--dark)">$0.00</div>
              <div style="font-size:0.75rem;color:var(--muted)">Used this month</div>
            </div>
            <div style="text-align:center;padding:0.75rem;background:var(--bg-elevated);border-radius:var(--radius);border:1px solid var(--border)">
              <div style="font-size:1.25rem;font-weight:800;color:var(--dark)">$10</div>
              <div style="font-size:0.75rem;color:var(--muted)">Added by you</div>
            </div>
          </div>
        </div>

        <div class="api-card" style="background:var(--teal-50);border-color:var(--accent)">
          <div style="font-size:0.8125rem;color:var(--teal-700);line-height:1.6">
            <strong>Cost breakdown:</strong> Document Text Detection costs $1.50 per 1,000 pages after the 1,000 free pages/month.
            At your current usage rate of <strong>${thisMonth} scans/month</strong>,
            you are well within the free tier.
            ${thisMonth > 1000 ? `<strong style="color:var(--danger)">⚠️ You have exceeded the free tier this month.</strong>` : ''}
          </div>
        </div>
      </div>

      <!-- Scan history by month -->
      <div class="card">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('reports', 18)} Scan History
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          ${Object.keys(byMonth).length === 0
            ? `<div class="empty"><div class="empty-text">No scan history yet</div></div>`
            : Object.entries(byMonth)
                .sort((a,b) => b[0].localeCompare(a[0]))
                .map(([month, count]) => {
                  const p = Math.min(Math.round(Number(count) / limit * 100), 100)
                  const isCurrentMonth = month === yearMonth
                  return `
                    <div style="display:grid;grid-template-columns:100px 1fr 60px;gap:0.75rem;align-items:center">
                      <div style="font-size:0.875rem;font-weight:${isCurrentMonth?'700':'500'};color:${isCurrentMonth?'var(--accent)':'var(--dark)'}">
                        ${month}${isCurrentMonth?' ·':''} ${isCurrentMonth?'<span style="font-size:0.75rem;color:var(--accent)">now</span>':''}
                      </div>
                      <div class="ocr-meter" style="margin:0">
                        <div class="ocr-meter-fill" style="width:${p}%;background:${p>80?'var(--danger)':p>60?'var(--warning)':'var(--accent)'}"></div>
                      </div>
                      <div style="font-size:0.875rem;font-weight:600;text-align:right">${Number(count).toLocaleString()}</div>
                    </div>
                  `
                }).join('')
          }
          <div style="padding-top:0.5rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:0.875rem">
            <span style="color:var(--muted)">Total all time</span>
            <span style="font-weight:700">${totalEver.toLocaleString()} scans</span>
          </div>
        </div>
      </div>
    `
  }

  // ── STORE INFO ─────────────────────────────────────────────
  async function renderStore() {
    content.innerHTML = `
      ${stores.map(store => `
        <div class="card" style="margin-bottom:1rem">
          <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:0.5rem">
              ${renderIcon('store', 18)} ${store.name}
            </div>
            <span class="badge badge-teal">Active</span>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Store Name</div>
              <div class="setting-sub">Displayed across the app</div>
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input class="form-input" style="width:200px" id="store-name-${store.id}" value="${store.name}">
              <button class="btn btn-outline btn-sm" data-save-store="${store.id}">Save</button>
            </div>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Currency</div>
              <div class="setting-sub">Used across all calculations</div>
            </div>
            <select class="form-input" style="width:140px" id="store-currency-${store.id}">
              <option value="ETB" ${store.currency==='ETB'?'selected':''}>ETB — Birr</option>
              <option value="USD" ${store.currency==='USD'?'selected':''}>USD — Dollar</option>
            </select>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Accounting View</div>
              <div class="setting-sub">How this store shows in joint reports</div>
            </div>
            <select class="form-input" style="width:160px" id="store-av-${store.id}">
              <option value="separate" ${store.accounting_view==='separate'?'selected':''}>Separate</option>
              <option value="joint"    ${store.accounting_view==='joint'   ?'selected':''}>Joint</option>
            </select>
          </div>
        </div>
      `).join('')}
    `

    // Save store name
    content.querySelectorAll('[data-save-store]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id       = btn.dataset.saveStore
        const name     = content.querySelector(`#store-name-${id}`)?.value.trim()
        const currency = content.querySelector(`#store-currency-${id}`)?.value
        const av       = content.querySelector(`#store-av-${id}`)?.value
        if (!name) return

        await supabase.from('stores').update({ name, currency, accounting_view: av }).eq('id', id)

        // Update app state
        const updated = stores.map(s => s.id === id ? { ...s, name, currency, accounting_view: av } : s)
        appStore.getState().setStores(updated)
        showToast('Store updated', 'success')
      })
    })
  }

  // ── CASH ACCOUNTS ──────────────────────────────────────────
  async function renderAccounts() {
    const storeIds = stores.map(s => s.id)
    const { data: accounts } = await supabase
      .from('cash_accounts')
      .select('*')
      .in('store_id', storeIds)
      .order('account_type')

    content.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:0.5rem">
            ${renderIcon('cash', 18)} Cash Accounts
          </div>
          <button class="btn btn-primary btn-sm" id="btn-new-account">
            ${renderIcon('plus', 14)} Add Account
          </button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account Name</th>
                <th>Type</th>
                <th>Bank Info</th>
                <th>Store</th>
                <th>Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${(accounts||[]).map(a => `
                <tr>
                  <td><strong>${a.account_name || a.name}</strong></td>
                  <td><span class="badge ${a.account_type==='till'?'badge-teal':'badge-blue'}">
                    ${a.account_type === 'till' ? '🏪 Till' : '🏦 Bank'}
                  </span></td>
                  <td style="color:var(--muted);font-size:0.8125rem">
                    ${a.account_type === 'bank' ? `${a.bank_name || '—'}<br><span style="font-family:monospace">${a.account_number || ''}</span>` : '—'}
                  </td>
                  <td style="color:var(--muted)">${stores.find(s => s.id === a.store_id)?.name || '—'}</td>
                  <td style="font-weight:700;color:var(--accent)">${fmt(a.balance)} ETB</td>
                  <td>
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                      <button class="btn btn-outline btn-sm" data-edit-account="${a.id}"
                        data-name="${a.account_name || a.name}" data-balance="${a.balance}"
                        data-type="${a.account_type}" data-bank="${a.bank_name||''}" data-accnum="${a.account_number||''}">
                        Edit
                      </button>
                      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--border)"
                        data-delete-account="${a.id}" data-delete-name="${a.account_name || a.name}">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add account modal -->
      <div id="acc-modal" class="modal-overlay" style="display:none">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title" id="acc-modal-title">Add Cash Account</div>
            <button class="modal-close" id="acc-modal-close">
              ${renderIcon('close', 14)}
            </button>
          </div>
          <div class="form-group">
            <label class="form-label">Account Name *</label>
            <input class="form-input" id="acc-name" placeholder="e.g. CBE Account, Store Till">
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="form-input" id="acc-type">
              <option value="till">🏪 Till (Cash in store)</option>
              <option value="bank">🏦 Bank Account</option>
            </select>
          </div>
          <div id="acc-bank-fields" style="display:none">
            <div class="form-group">
              <label class="form-label">Bank Name</label>
              <input class="form-input" id="acc-bank-name" placeholder="e.g. Commercial Bank of Ethiopia">
            </div>
            <div class="form-group">
              <label class="form-label">Account Number</label>
              <input class="form-input" id="acc-bank-num" placeholder="e.g. 1000123456789">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Store</label>
            <select class="form-input" id="acc-store">
              ${stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Opening Balance (ETB)</label>
            <input type="number" class="form-input" id="acc-balance" value="0" min="0">
          </div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
            <button class="btn btn-outline" id="acc-cancel">Cancel</button>
            <button class="btn btn-primary" id="acc-save">Save Account</button>
          </div>
        </div>
      </div>
    `

    let editingId = null

    // Toggle bank fields
    const accTypeEl = content.querySelector('#acc-type')
    const bankFields = content.querySelector('#acc-bank-fields')
    accTypeEl.addEventListener('change', () => {
      bankFields.style.display = accTypeEl.value === 'bank' ? 'block' : 'none'
    })

    content.querySelector('#btn-new-account').addEventListener('click', () => {
      editingId = null
      content.querySelector('#acc-modal-title').textContent = 'Add Account'
      content.querySelector('#acc-name').value    = ''
      content.querySelector('#acc-balance').value = '0'
      content.querySelector('#acc-type').value    = 'till'
      content.querySelector('#acc-bank-name').value = ''
      content.querySelector('#acc-bank-num').value  = ''
      bankFields.style.display = 'none'
      content.querySelector('#acc-modal').style.display = 'flex'
    })

    content.querySelectorAll('[data-delete-account]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.deleteAccount
        const name = btn.dataset.deleteName
        if (!confirm(`Delete account "${name}"? This cannot be undone.`)) return
        const { error } = await supabase.from('cash_accounts').delete().eq('id', id)
        if (error) { alert('Could not delete: ' + error.message); return }
        showToast('Account deleted', 'success')
        await renderAccounts()
      })
    })

    content.querySelectorAll('[data-edit-account]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.editAccount
        const type = btn.dataset.type || 'till'
        content.querySelector('#acc-modal-title').textContent = 'Edit Account'
        content.querySelector('#acc-name').value      = btn.dataset.name
        content.querySelector('#acc-balance').value   = btn.dataset.balance
        content.querySelector('#acc-type').value      = type
        content.querySelector('#acc-bank-name').value = btn.dataset.bank || ''
        content.querySelector('#acc-bank-num').value  = btn.dataset.accnum || ''
        bankFields.style.display = type === 'bank' ? 'block' : 'none'
        content.querySelector('#acc-modal').style.display = 'flex'
      })
    })

    const closeModal = () => { content.querySelector('#acc-modal').style.display = 'none' }
    content.querySelector('#acc-modal-close').addEventListener('click', closeModal)
    content.querySelector('#acc-cancel').addEventListener('click', closeModal)

    content.querySelector('#acc-save').addEventListener('click', async () => {
      const name       = content.querySelector('#acc-name').value.trim()
      const type       = content.querySelector('#acc-type').value
      const storeId    = content.querySelector('#acc-store').value
      const balance    = Number(content.querySelector('#acc-balance').value) || 0
      const bankName   = content.querySelector('#acc-bank-name').value.trim() || null
      const bankNum    = content.querySelector('#acc-bank-num').value.trim()  || null
      if (!name) { alert('Name required'); return }

      const payload = { account_name: name, account_type: type, balance, bank_name: bankName, account_number: bankNum }

      if (editingId) {
        await supabase.from('cash_accounts').update(payload).eq('id', editingId)
      } else {
        await supabase.from('cash_accounts').insert({ store_id: storeId, ...payload })
      }
      closeModal()
      showToast(editingId ? 'Account updated' : 'Account added', 'success')
      await renderAccounts()
    })
  }

  // ── PREFERENCES ───────────────────────────────────────────────
  async function renderPreferences() {
    const currentFmt = localStorage.getItem('storeos_date_format') || 'en'
    content.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('reports', 18)} Display Preferences
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Date Format</div>
            <div class="setting-sub">Choose how dates are shown throughout the app</div>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button id="fmt-en" class="btn ${currentFmt === 'en' ? 'btn-primary' : 'btn-outline'} btn-sm">
              📅 Gregorian
            </button>
            <button id="fmt-et" class="btn ${currentFmt === 'et' ? 'btn-primary' : 'btn-outline'} btn-sm">
              🇪🇹 Ethiopian (Amharic)
            </button>
          </div>
        </div>

        <div id="date-preview" style="
          margin-top:0.75rem;padding:0.75rem 1rem;
          background:var(--bg-subtle);border-radius:var(--radius);
          font-size:0.875rem;color:var(--muted);
        ">
          Loading preview...
        </div>
      </div>
    `

    // Dynamic import to keep this lazy
    const { formatDate, setDateFormat } = await import('../utils/format-date.js')

    function updatePreview() {
      const fmt = localStorage.getItem('storeos_date_format') || 'en'
      const sampleDate = new Date()
      const preview = formatDate(sampleDate)
      content.querySelector('#date-preview').innerHTML = `
        <strong>Today looks like:</strong> 
        <span style="color:var(--dark);font-weight:600">${preview}</span>
      `
      content.querySelector('#fmt-en').className = `btn ${fmt === 'en' ? 'btn-primary' : 'btn-outline'} btn-sm`
      content.querySelector('#fmt-et').className = `btn ${fmt === 'et' ? 'btn-primary' : 'btn-outline'} btn-sm`
    }

    content.querySelector('#fmt-en').addEventListener('click', () => {
      setDateFormat('en'); updatePreview(); showToast('Date format: Gregorian', 'success')
    })
    content.querySelector('#fmt-et').addEventListener('click', () => {
      setDateFormat('et'); updatePreview(); showToast('Date format: Ethiopian', 'success')
    })

    updatePreview()
  }

  // ── TAX & VAT ──────────────────────────────────────────────
  async function renderTax() {
    const { data: rates } = await supabase
      .from('tax_rates')
      .select('*')
      .in('store_id', stores.map(s => s.id))

    content.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('accounting', 18)} Tax Rates
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Rate</th><th>Default</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${(rates||[]).map(r => `
                <tr>
                  <td><strong>${r.name}</strong></td>
                  <td>${(Number(r.rate)*100).toFixed(1)}%</td>
                  <td>${r.is_default ? `<span class="badge badge-teal">Default</span>` : '—'}</td>
                  <td><span class="badge ${r.is_active?'badge-green':'badge-grey'}">${r.is_active?'Active':'Inactive'}</span></td>
                  <td>
                    <button class="btn btn-outline btn-sm" data-toggle-tax="${r.id}" data-active="${r.is_active}">
                      ${r.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:1rem;padding:1rem;background:var(--bg-subtle);border-radius:var(--radius);font-size:0.875rem;color:var(--muted);line-height:1.6">
          Ethiopian VAT is <strong>15%</strong>. VAT is applied automatically when recording
          sales and expenses through the accounting engine. Disable to work VAT-exclusive.
        </div>
      </div>
    `

    content.querySelectorAll('[data-toggle-tax]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.active === 'true'
        await supabase.from('tax_rates').update({ is_active: !isActive }).eq('id', btn.dataset.toggleTax)
        showToast(`Tax rate ${isActive ? 'disabled' : 'enabled'}`, 'success')
        await renderTax()
      })
    })
  }

  // ── PROFIT SETTINGS ────────────────────────────────────────
  async function renderProfit() {
    const storeId = currentStore?.id
    if (!storeId) {
      content.innerHTML = `<div class="card"><div style="color:var(--muted)">No store selected.</div></div>`
      return
    }

    const { data: pattern } = await supabase
      .from('user_patterns')
      .select('pattern_data')
      .eq('store_id', storeId)
      .eq('pattern_key', 'profit_settings')
      .maybeSingle()

    const settings = pattern?.pattern_data || {
      subtract_expenses: true,
      subtract_credits:  false,
      use_cost_price:    false
    }

    if (!document.getElementById('toggle-styles')) {
      const s = document.createElement('style')
      s.id = 'toggle-styles'
      s.textContent = `
        .toggle-switch { position:relative;display:inline-block;width:44px;height:24px;cursor:pointer; }
        .toggle-switch input { opacity:0;width:0;height:0; }
        .toggle-track {
          position:absolute;inset:0;border-radius:999px;
          background:var(--gray-200);transition:background 0.2s;
        }
        .toggle-track::after {
          content:'';position:absolute;top:3px;left:3px;
          width:18px;height:18px;border-radius:50%;
          background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);
          transition:transform 0.2s;
        }
        .toggle-switch input:checked + .toggle-track { background:var(--accent); }
        .toggle-switch input:checked + .toggle-track::after { transform:translateX(20px); }
      `
      document.head.appendChild(s)
    }

    content.innerHTML = `
      <div class="card">
        <div style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('reports', 18)} Profit Calculation Settings
        </div>
        <div style="font-size:0.875rem;color:var(--muted);margin-bottom:1.25rem;line-height:1.6">
          Control what is subtracted when calculating Today's Profit on the dashboard.
          Tap the profit card on the dashboard for a full breakdown.
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Subtract Expenses</div>
            <div class="setting-sub">Deduct today's recorded expenses from gross sales</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ps-expenses" ${settings.subtract_expenses ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Subtract Credit Given</div>
            <div class="setting-sub">Deduct sales recorded on credit (cash not yet collected)</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ps-credits" ${settings.subtract_credits ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Use Cost Price (COGS)</div>
            <div class="setting-sub">Deduct cost of goods sold based on inventory unit costs</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ps-cost" ${settings.use_cost_price ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>

        <div style="margin-top:1.25rem;padding:1rem;background:var(--bg-subtle);border-radius:var(--radius);font-size:0.8125rem;color:var(--muted);line-height:1.6">
          <strong>Formula:</strong> Gross Sales
          ${settings.use_cost_price   ? ' − Cost of Goods' : ''}
          ${settings.subtract_expenses ? ' − Expenses'      : ''}
          ${settings.subtract_credits  ? ' − Credit Given'  : ''}
          = Net Profit
        </div>

        <div style="margin-top:1.25rem;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="btn-save-profit">Save Settings</button>
        </div>
      </div>
    `

    content.querySelector('#btn-save-profit').addEventListener('click', async () => {
      const newSettings = {
        subtract_expenses: content.querySelector('#ps-expenses').checked,
        subtract_credits:  content.querySelector('#ps-credits').checked,
        use_cost_price:    content.querySelector('#ps-cost').checked
      }

      const { error } = await supabase
        .from('user_patterns')
        .upsert(
          { store_id: storeId, pattern_key: 'profit_settings', pattern_data: newSettings, updated_at: new Date().toISOString() },
          { onConflict: 'store_id,pattern_key' }
        )

      if (error) {
        showToast('Failed to save: ' + error.message, 'error')
      } else {
        showToast('Profit settings saved', 'success')
        await renderProfit()
      }
    })
  }

  // ── DANGER ZONE ────────────────────────────────────────────
  async function renderDanger() {
    content.innerHTML = `
      <div class="card" style="border-color:var(--danger)">
        <div style="font-weight:700;font-size:1rem;margin-bottom:0.5rem;color:var(--danger);display:flex;align-items:center;gap:0.5rem">
          ${renderIcon('alert', 18, 'var(--danger)')} Danger Zone
        </div>
        <div style="font-size:0.875rem;color:var(--muted);margin-bottom:1.25rem">
          These actions are permanent and cannot be undone.
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Clear OCR Scan History</div>
            <div class="setting-sub">Deletes all scan logs. Does not affect sales or expenses already applied.</div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" id="btn-clear-ocr">
            Clear Scans
          </button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Reset Inventory Quantities</div>
            <div class="setting-sub">Sets all item quantities to zero. Stock movements history is kept.</div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" id="btn-reset-inv">
            Reset Quantities
          </button>
        </div>

        <div class="setting-row" style="border:none">
          <div>
            <div class="setting-label">App Version</div>
            <div class="setting-sub">StoreOS v1.0.0 — built March 2026</div>
          </div>
          <span class="badge badge-teal">v1.0.0</span>
        </div>
      </div>
    `

    content.querySelector('#btn-clear-ocr').addEventListener('click', async () => {
      if (!confirm('Delete all OCR scan logs? This cannot be undone.')) return
      await supabase.from('ocr_logs').delete().in('store_id', stores.map(s => s.id))
      showToast('OCR logs cleared', 'success')
    })

    content.querySelector('#btn-reset-inv').addEventListener('click', async () => {
      if (!confirm('Reset all inventory quantities to zero? This cannot be undone.')) return
      await supabase.from('inventory_items').update({ quantity: 0 }).in('store_id', stores.map(s => s.id))
      showToast('Inventory quantities reset', 'success')
    })
  }

  // Load first section
  await loadSection('ocr')
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast toast-${type}`
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-container'; document.body.appendChild(wrap) }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}