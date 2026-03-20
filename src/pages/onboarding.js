import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { renderIcon } from '../components/icons.js'

const TOTAL_STEPS = 4

export async function render(container) {
  const user = appStore.getState().user

  // Check for saved progress
  const saved     = JSON.parse(sessionStorage.getItem('onboarding-progress') || '{}')
  let   step      = saved.step || 1
  let   ownerData = saved.ownerData || { name: '', email: user?.email || '' }
  let   stores    = saved.stores    || [{ name: '', currency: 'ETB' }]
  let   accounts  = saved.accounts  || []
  let   inventory = saved.inventory || []

  function saveProgress() {
    sessionStorage.setItem('onboarding-progress', JSON.stringify({
      step, ownerData, stores, accounts, inventory
    }))
  }

  container.innerHTML = `
    <div style="
      min-height:100vh;
      background:linear-gradient(160deg,#E8F5F3 0%,#F3F9F8 35%,#F8FAFC 65%,#EEF2FF 100%);
      display:flex;align-items:center;justify-content:center;
      padding:1rem;font-family:var(--font);
    ">
      <div style="width:100%;max-width:560px">

        <!-- Logo -->
        <div style="text-align:center;margin-bottom:2rem">
          <div style="
            display:inline-flex;align-items:center;gap:0.5rem;
            font-size:1.5rem;font-weight:800;color:var(--dark);
            letter-spacing:-0.5px;
          ">
            <div style="
              width:36px;height:36px;background:var(--accent);border-radius:10px;
              display:flex;align-items:center;justify-content:center;
            ">${renderIcon('store', 18, '#fff')}</div>
            Store<span style="color:var(--accent)">OS</span>
          </div>
        </div>

        <!-- Progress bar -->
        <div style="display:flex;gap:0.375rem;margin-bottom:2rem">
          ${Array.from({length: TOTAL_STEPS}, (_,i) => `
            <div style="
              flex:1;height:4px;border-radius:999px;
              background:${i < step ? 'var(--accent)' : 'var(--gray-200)'};
              transition:background 0.3s;
            " id="prog-${i+1}"></div>
          `).join('')}
        </div>

        <!-- Step content -->
        <div id="step-wrap"></div>

      </div>
    </div>
  `

  function updateProgress() {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const el = container.querySelector(`#prog-${i}`)
      if (el) el.style.background = i <= step ? 'var(--accent)' : 'var(--gray-200)'
    }
  }

  // ── STEP 1 — Welcome + Owner info ─────────────────────────
  function renderStep1() {
    container.querySelector('#step-wrap').innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:2rem;
        box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--border);
      ">
        <div style="margin-bottom:1.5rem">
          <div style="
            font-size:1.375rem;font-weight:800;color:var(--dark);
            letter-spacing:-0.4px;margin-bottom:0.35rem;
          ">Welcome to StoreOS 👋</div>
          <div style="font-size:0.9375rem;color:var(--muted);line-height:1.6">
            Let's get your store set up in about 2 minutes.
            You can skip any step and fill it in later from Settings.
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Your Name *</label>
          <input class="form-input" id="owner-name"
            placeholder="e.g. Aymen" value="${ownerData.name}"
            style="font-size:1rem">
        </div>

        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="owner-email"
            value="${ownerData.email}" readonly
            style="background:var(--bg-subtle);color:var(--muted);font-size:1rem">
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1.5rem">
          <button class="btn btn-ghost btn-sm" id="btn-skip-all">
            Skip setup — go to dashboard
          </button>
          <button class="btn btn-primary" id="btn-next-1" style="min-width:120px;justify-content:center">
            Next ${renderIcon('chevronDown', 16)}
          </button>
        </div>
      </div>
    `

    container.querySelector('#btn-next-1').addEventListener('click', () => {
      const name = container.querySelector('#owner-name').value.trim()
      if (!name) { shake('#owner-name'); return }
      ownerData.name = name
      saveProgress()
      step = 2
      updateProgress()
      renderStep2()
    })

    container.querySelector('#btn-skip-all').addEventListener('click', () => {
      if (confirm('Skip setup? You can always configure your store in Settings.')) {
        skipToApp()
      }
    })

    container.querySelector('#owner-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') container.querySelector('#btn-next-1').click()
    })
  }

  // ── STEP 2 — Store names ───────────────────────────────────
  function renderStep2() {
    container.querySelector('#step-wrap').innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:2rem;
        box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--border);
      ">
        <div style="margin-bottom:1.5rem">
          <div style="font-size:1.375rem;font-weight:800;color:var(--dark);letter-spacing:-0.4px;margin-bottom:0.35rem">
            Your Stores
          </div>
          <div style="font-size:0.9375rem;color:var(--muted)">
            Add one or more stores. You can add more later.
          </div>
        </div>

        <div id="stores-list"></div>

        <button class="btn btn-outline btn-sm" id="btn-add-store" style="margin-top:0.5rem;gap:0.4rem">
          ${renderIcon('plus', 14)} Add another store
        </button>

        <div style="display:flex;justify-content:space-between;margin-top:1.5rem">
          <button class="btn btn-ghost btn-sm" id="btn-back-2">← Back</button>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline btn-sm" id="btn-skip-2">Skip</button>
            <button class="btn btn-primary" id="btn-next-2" style="min-width:120px;justify-content:center">
              Next ${renderIcon('chevronDown', 16)}
            </button>
          </div>
        </div>
      </div>
    `

    function renderStoreInputs() {
      const list = container.querySelector('#stores-list')
      list.innerHTML = stores.map((s, i) => `
        <div style="display:flex;gap:0.5rem;margin-bottom:0.625rem;align-items:center">
          <div style="
            width:32px;height:32px;background:var(--teal-50);border-radius:var(--radius);
            display:flex;align-items:center;justify-content:center;flex-shrink:0;
            color:var(--accent);font-size:0.75rem;font-weight:700;
          ">${i + 1}</div>
          <input class="form-input" style="flex:1;margin:0"
            id="store-name-${i}"
            placeholder="${i === 0 ? 'e.g. Main Branch' : `Store ${i + 1} name`}"
            value="${s.name}">
          ${i > 0 ? `
            <button style="
              width:32px;height:32px;border-radius:var(--radius);
              border:1px solid var(--border);background:none;
              display:flex;align-items:center;justify-content:center;
              color:var(--muted);cursor:pointer;flex-shrink:0;
            " data-remove="${i}">${renderIcon('close', 14)}</button>
          ` : ''}
        </div>
      `).join('')

      list.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          stores.splice(Number(btn.dataset.remove), 1)
          renderStoreInputs()
        })
      })
    }

    renderStoreInputs()

    container.querySelector('#btn-add-store').addEventListener('click', () => {
      stores.push({ name: '', currency: 'ETB' })
      renderStoreInputs()
      // Focus new input
      setTimeout(() => {
        const inputs = container.querySelectorAll('[id^="store-name-"]')
        inputs[inputs.length - 1]?.focus()
      }, 50)
    })

    container.querySelector('#btn-back-2').addEventListener('click', () => {
      step = 1; updateProgress(); renderStep1()
    })

    container.querySelector('#btn-skip-2').addEventListener('click', () => {
      if (stores.every(s => !s.name)) stores = [{ name: ownerData.name + "'s Store", currency: 'ETB' }]
      step = 3; updateProgress(); renderStep3()
    })

    container.querySelector('#btn-next-2').addEventListener('click', () => {
      // Read store names
      stores = stores.map((s, i) => ({
        ...s,
        name: container.querySelector(`#store-name-${i}`)?.value.trim() || `Store ${i + 1}`,
      }))

      if (!stores[0].name) { shake('#store-name-0'); return }

      // Init accounts structure
      if (accounts.length === 0) {
        accounts = stores.map(s => ({
          storeName: s.name,
          storeIdx:  stores.indexOf(s),
          items: [
            { name: 'Store Till',   type: 'till', balance: '' },
            { name: 'Bank Account', type: 'bank', balance: '' },
          ]
        }))
      }

      saveProgress()
      step = 3; updateProgress(); renderStep3()
    })
  }

  // ── STEP 3 — Cash balances ─────────────────────────────────
  function renderStep3() {
    // Sync account structure with current stores
    accounts = stores.map((s, si) => {
      const existing = accounts.find(a => a.storeIdx === si)
      return existing
        ? { ...existing, storeName: s.name }
        : { storeName: s.name, storeIdx: si, items: [
            { name: 'Store Till',   type: 'till', balance: '' },
            { name: 'Bank Account', type: 'bank', balance: '' },
          ]}
    })

    container.querySelector('#step-wrap').innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:2rem;
        box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--border);
      ">
        <div style="margin-bottom:1.5rem">
          <div style="font-size:1.375rem;font-weight:800;color:var(--dark);letter-spacing:-0.4px;margin-bottom:0.35rem">
            Cash Balances
          </div>
          <div style="font-size:0.9375rem;color:var(--muted)">
            Enter how much cash you currently have. Skip if you want to start from zero.
          </div>
        </div>

        <div id="accounts-list"></div>

        <div style="display:flex;justify-content:space-between;margin-top:1.5rem">
          <button class="btn btn-ghost btn-sm" id="btn-back-3">← Back</button>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline btn-sm" id="btn-skip-3">Skip — start at 0</button>
            <button class="btn btn-primary" id="btn-next-3" style="min-width:120px;justify-content:center">
              Next ${renderIcon('chevronDown', 16)}
            </button>
          </div>
        </div>
      </div>
    `

    function renderAccountInputs() {
      const list = container.querySelector('#accounts-list')
      list.innerHTML = accounts.map((store, si) => `
        <div style="margin-bottom:1.25rem">
          <div style="
            font-size:0.8125rem;font-weight:700;color:var(--accent);
            text-transform:uppercase;letter-spacing:0.5px;
            margin-bottom:0.625rem;display:flex;align-items:center;gap:0.4rem;
          ">
            ${renderIcon('store', 13, 'var(--accent)')} ${store.storeName}
          </div>

          ${store.items.map((acc, ai) => `
            <div style="
              display:grid;grid-template-columns:1fr 160px auto;
              gap:0.5rem;margin-bottom:0.5rem;align-items:center;
            ">
              <input class="form-input" style="margin:0"
                id="acc-name-${si}-${ai}"
                value="${acc.name}" placeholder="Account name">
              <div style="position:relative">
                <input class="form-input" style="margin:0;padding-right:2.5rem"
                  id="acc-bal-${si}-${ai}" type="number"
                  value="${acc.balance || ''}" min="0" placeholder="0.00">
                <span style="
                  position:absolute;right:0.625rem;top:50%;transform:translateY(-50%);
                  font-size:0.75rem;color:var(--muted);pointer-events:none;
                ">ETB</span>
              </div>
              ${ai > 0 ? `
                <button style="
                  width:36px;height:36px;flex-shrink:0;
                  border-radius:var(--radius);border:1px solid var(--border);
                  background:none;display:flex;align-items:center;justify-content:center;
                  color:var(--muted);cursor:pointer;
                " data-remove-acc="${si}-${ai}">${renderIcon('close', 13)}</button>
              ` : `<div style="width:36px"></div>`}
            </div>
          `).join('')}

          <button class="btn btn-ghost btn-sm" data-add-acc="${si}" style="font-size:0.8125rem;gap:0.3rem;margin-top:0.25rem">
            ${renderIcon('plus', 13)} Add account
          </button>
        </div>
      `).join('')

      list.querySelectorAll('[data-remove-acc]').forEach(btn => {
        const [si, ai] = btn.dataset.removeAcc.split('-').map(Number)
        btn.addEventListener('click', () => {
          accounts[si].items.splice(ai, 1)
          renderAccountInputs()
        })
      })

      list.querySelectorAll('[data-add-acc]').forEach(btn => {
        btn.addEventListener('click', () => {
          accounts[Number(btn.dataset.addAcc)].items.push({ name: '', type: 'bank', balance: '' })
          renderAccountInputs()
        })
      })
    }

    renderAccountInputs()

    container.querySelector('#btn-back-3').addEventListener('click', () => {
      step = 2; updateProgress(); renderStep2()
    })

    container.querySelector('#btn-skip-3').addEventListener('click', () => {
      // Zero out all balances
      accounts = accounts.map(store => ({
        ...store,
        items: store.items.map(acc => ({ ...acc, balance: 0 }))
      }))
      step = 4; updateProgress(); renderStep4()
    })

    container.querySelector('#btn-next-3').addEventListener('click', () => {
      // Read values
      accounts = accounts.map((store, si) => ({
        ...store,
        items: store.items.map((acc, ai) => ({
          name:    container.querySelector(`#acc-name-${si}-${ai}`)?.value.trim() || acc.name,
          type:    acc.type,
          balance: Number(container.querySelector(`#acc-bal-${si}-${ai}`)?.value) || 0,
        }))
      }))
      saveProgress()
      step = 4; updateProgress(); renderStep4()
    })
  }

  // ── STEP 4 — Inventory quick-add ──────────────────────────
  function renderStep4() {
    container.querySelector('#step-wrap').innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:2rem;
        box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--border);
      ">
        <div style="margin-bottom:1.25rem">
          <div style="font-size:1.375rem;font-weight:800;color:var(--dark);letter-spacing:-0.4px;margin-bottom:0.35rem">
            Add Your Products
          </div>
          <div style="font-size:0.9375rem;color:var(--muted)">
            Add a few key items to get started. You can add the rest from Inventory.
          </div>
        </div>

        <!-- Quick add row -->
        <div style="
          display:grid;grid-template-columns:1fr 100px 110px auto;
          gap:0.5rem;margin-bottom:0.75rem;align-items:center;
        ">
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Product</div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Qty</div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Price (ETB)</div>
          <div></div>
        </div>

        <div id="inv-list"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:0.5rem">
          <button class="btn btn-outline btn-sm" id="btn-add-inv" style="gap:0.4rem;justify-content:center">
            ${renderIcon('plus', 14)} Add product
          </button>
          <label class="btn btn-outline btn-sm" style="gap:0.4rem;justify-content:center;cursor:pointer;margin:0">
            ${renderIcon('scan', 14)} Scan Invoice/List
            <input type="file" id="ocr-import-file" hidden accept="image/*">
          </label>
        </div>
        <div id="ocr-import-status" style="display:none;font-size:11px;margin-top:0.5rem;text-align:center;color:var(--muted)"></div>

        <!-- Store selector (if multiple stores) -->
        ${stores.length > 1 ? `
          <div class="form-group" style="margin-top:1rem">
            <label class="form-label">Add inventory to which store?</label>
            <select class="form-input" id="inv-store-select">
              ${stores.map((s, i) => `<option value="${i}">${s.name}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:space-between;margin-top:1.5rem">
          <button class="btn btn-ghost btn-sm" id="btn-back-4">← Back</button>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline btn-sm" id="btn-skip-4">Skip for now</button>
            <button class="btn btn-primary" id="btn-finish" style="min-width:140px;justify-content:center">
              ${renderIcon('check', 16)} Launch StoreOS
            </button>
          </div>
        </div>
      </div>
    `

    if (inventory.length === 0) {
      inventory = [
        { name: '', qty: '', price: '', category: '' },
        { name: '', qty: '', price: '', category: '' },
        { name: '', qty: '', price: '', category: '' },
      ]
    }

    function renderInvRows() {
      const list = container.querySelector('#inv-list')
      list.innerHTML = inventory.map((item, i) => `
        <div style="
          display:grid;grid-template-columns:1fr 100px 110px auto;
          gap:0.5rem;margin-bottom:0.5rem;align-items:center;
        ">
          <input class="form-input" style="margin:0"
            id="inv-name-${i}" value="${item.name}"
            placeholder="Product name">
          <input class="form-input" style="margin:0"
            id="inv-qty-${i}" type="number" min="0"
            value="${item.qty}" placeholder="0">
          <input class="form-input" style="margin:0"
            id="inv-price-${i}" type="number" min="0" step="0.01"
            value="${item.price}" placeholder="0.00">
          <button style="
            width:36px;height:36px;flex-shrink:0;
            border-radius:var(--radius);border:1px solid var(--border);
            background:none;display:flex;align-items:center;justify-content:center;
            color:var(--muted);cursor:pointer;
          " data-remove-inv="${i}">${renderIcon('close', 13)}</button>
        </div>
      `).join('')

      list.querySelectorAll('[data-remove-inv]').forEach(btn => {
        btn.addEventListener('click', () => {
          inventory.splice(Number(btn.dataset.removeInv), 1)
          renderInvRows()
        })
      })
    }

    renderInvRows()

    // OCR import
    container.querySelector('#ocr-import-file').addEventListener('change', async e => {
      const file = e.target.files?.[0]
      if (!file) return

      const statusEl = container.querySelector('#ocr-import-status')
      statusEl.style.display = 'block'
      statusEl.textContent   = 'Uploading and scanning...'

      try {
        // Upload to Supabase storage
        const fileName = `onboarding-${Date.now()}-${file.name}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(fileName, file, { contentType: file.type })

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage
          .from('receipts')
          .getPublicUrl(fileName)

        statusEl.textContent = 'AI is reading your document...'

        // Call OCR edge function
        const { data: ocrResult, error: ocrError } = await supabase.functions
          .invoke('ocr-proxy', { body: { imageUrl: publicUrl, storeId: 'onboarding' } })

        if (ocrError) throw ocrError

        // Parse line items
        const lines = ocrResult?.parsed_data?.line_items || []

        if (lines.length === 0) {
          statusEl.textContent = 'No products detected. Try a clearer image or add manually.'
          return
        }

        // Merge with existing inventory
        const newItems = lines
          .filter(l => l.description && l.description.trim().length > 1)
          .map(l => ({
            name:  l.description.trim(),
            qty:   Number(l.quantity)  || 1,
            price: Number(l.unit_price) || 0,
          }))

        inventory = [...inventory.filter(i => i.name && i.name.trim()), ...newItems]
        renderInvRows()

        statusEl.style.color   = 'var(--accent)'
        statusEl.textContent   = `✓ Added ${newItems.length} products from scan`

      } catch(err) {
        statusEl.style.color = 'var(--danger)'
        statusEl.textContent = `Scan failed: ${err.message}. Add products manually.`
      }
    })

    container.querySelector('#btn-add-inv').addEventListener('click', () => {
      inventory.push({ name: '', qty: '', price: '', category: '' })
      renderInvRows()
      setTimeout(() => {
        const inputs = container.querySelectorAll('[id^="inv-name-"]')
        inputs[inputs.length - 1]?.focus()
      }, 50)
    })

    container.querySelector('#btn-back-4').addEventListener('click', () => {
      step = 3; updateProgress(); renderStep3()
    })

    container.querySelector('#btn-skip-4').addEventListener('click', () => {
      inventory = []
      finishSetup()
    })

    container.querySelector('#btn-finish').addEventListener('click', () => {
      // Read inventory rows
      inventory = inventory
        .map((item, i) => ({
          name:  container.querySelector(`#inv-name-${i}`)?.value.trim() || '',
          qty:   Number(container.querySelector(`#inv-qty-${i}`)?.value)  || 0,
          price: Number(container.querySelector(`#inv-price-${i}`)?.value) || 0,
        }))
        .filter(item => item.name) // only rows with a name

      saveProgress()
      finishSetup()
    })
  }

  // ── Final setup — save everything to Supabase ──────────────
  async function finishSetup() {
    const wrap = container.querySelector('#step-wrap')
    wrap.innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:3rem 2rem;
        box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--border);
        text-align:center;
      ">
        <div style="
          width:64px;height:64px;background:var(--teal-50);border-radius:50%;
          display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;
          color:var(--accent);
        ">${renderIcon('store', 28, 'var(--accent)')}</div>
        <div style="font-size:1.25rem;font-weight:700;margin-bottom:0.5rem">Setting up your store...</div>
        <div style="color:var(--muted);font-size:0.9375rem" id="setup-status">Creating your account</div>
        <div style="
          width:200px;height:4px;background:var(--gray-100);border-radius:999px;
          margin:1.25rem auto 0;overflow:hidden;
        ">
          <div id="setup-bar" style="
            height:100%;background:var(--accent);border-radius:999px;
            width:0%;transition:width 0.4s ease;
          "></div>
        </div>
      </div>
    `

    const setStatus = (msg, pct) => {
      const s = wrap.querySelector('#setup-status')
      const b = wrap.querySelector('#setup-bar')
      if (s) s.textContent = msg
      if (b) b.style.width  = `${pct}%`
    }

    const user = appStore.getState().user

    try {
      setStatus('Creating owner profile...', 15)

      // 1. Create or update owner
      let owner
      const { data: existing } = await supabase
        .from('owners')
        .select('*')
        .eq('email', user.email)
        .single()

      if (existing) {
        await supabase.from('owners').update({ name: ownerData.name }).eq('id', existing.id)
        owner = existing
      } else {
        const { data, error } = await supabase
          .from('owners')
          .insert({ name: ownerData.name, email: user.email })
          .select()
          .single()
        if (error) throw error
        owner = data
      }

      setStatus('Creating stores...', 30)

      // 2. Create stores
      const createdStores = []
      for (const s of stores) {
        const name = s.name || `${ownerData.name}'s Store`
        const { data: store, error } = await supabase
          .from('stores')
          .insert({ owner_id: owner.id, name, currency: 'ETB' })
          .select()
          .single()
        if (error) throw error
        createdStores.push(store)
      }

      setStatus('Setting up cash accounts...', 50)

      // 3. Create cash accounts
      for (let si = 0; si < createdStores.length; si++) {
        const store    = createdStores[si]
        const storeAcc = accounts[si]
        if (!storeAcc) continue

        for (const acc of storeAcc.items) {
          if (!acc.name) continue
          await supabase.from('cash_accounts').insert({
            store_id:     store.id,
            name:         acc.name,
            account_type: acc.type || 'bank',
            balance:      Number(acc.balance) || 0,
          })
        }

        // Seed chart of accounts
        try {
          await supabase.rpc('seed_chart_of_accounts', { p_store_id: store.id })
        } catch(_) {}
      }

      setStatus('Adding inventory items...', 70)

      // 4. Create inventory items
      if (inventory.length > 0) {
        const invStoreId = createdStores[0]?.id
        for (const item of inventory) {
          if (!item.name) continue
          await supabase.from('inventory_items').insert({
            store_id:      invStoreId,
            item_name:     item.name,
            quantity:      item.qty  || 0,
            selling_price: item.price || null,
          })
        }
      }

      setStatus('Almost ready...', 90)

      // 5. Update app state
      appStore.getState().setStores(createdStores)
      appStore.getState().setCurrentStore(createdStores[0])

      // 6. Clear progress
      sessionStorage.removeItem('onboarding-progress')

      setStatus('Done! Welcome to StoreOS 🎉', 100)

      await new Promise(r => setTimeout(r, 800))
      navigate('/dashboard')

    } catch(err) {
      console.error('Setup error:', err)
      wrap.innerHTML = `
        <div style="
          background:#fff;border-radius:24px;padding:2rem;
          box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid var(--red-200,#fecaca);
          text-align:center;
        ">
          <div style="color:var(--danger);font-size:1rem;font-weight:700;margin-bottom:0.5rem">
            Setup failed
          </div>
          <div style="color:var(--muted);font-size:0.875rem;margin-bottom:1.25rem">
            ${err.message}
          </div>
          <button class="btn btn-primary" id="btn-retry">Try Again</button>
        </div>
      `
      wrap.querySelector('#btn-retry').addEventListener('click', finishSetup)
    }
  }

  // ── Skip entirely — use seed data ─────────────────────────
  async function skipToApp() {
    const { data: existingStores } = await supabase.from('stores').select('*').limit(2)
    if (existingStores?.length > 0) {
      appStore.getState().setStores(existingStores)
      appStore.getState().setCurrentStore(existingStores[0])
    }
    sessionStorage.removeItem('onboarding-progress')
    navigate('/dashboard')
  }

  // ── Shake animation for validation ────────────────────────
  function shake(selector) {
    const el = container.querySelector(selector)
    if (!el) return
    el.style.animation = 'none'
    el.style.borderColor = 'var(--danger)'
    el.style.boxShadow  = '0 0 0 3px rgba(239,68,68,0.15)'
    el.offsetHeight
    el.style.animation = 'shake 0.4s ease'
    el.focus()
    setTimeout(() => {
      el.style.borderColor = ''
      el.style.boxShadow   = ''
    }, 2000)
    if (!document.getElementById('shake-style')) {
      const s = document.createElement('style')
      s.id = 'shake-style'
      s.textContent = `@keyframes shake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-6px)}
        40%{transform:translateX(6px)}
        60%{transform:translateX(-4px)}
        80%{transform:translateX(4px)}
      }`
      document.head.appendChild(s)
    }
  }

  // ── Start ─────────────────────────────────────────────────
  updateProgress()
  if (step === 1) renderStep1()
  else if (step === 2) renderStep2()
  else if (step === 3) renderStep3()
  else renderStep4()
}