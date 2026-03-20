import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'

const ICONS = {
  inventory: '📦',
  customer:  '👤',
  expense:   '📋',
  sale:      '💚',
}

const TYPE_LABELS = {
  inventory: 'Inventory',
  customer:  'Customer',
  expense:   'Expense',
  sale:      'Sale',
}

export function initSearch() {
  // Create search overlay
  const overlay = document.createElement('div')
  overlay.id = 'search-overlay'
  overlay.style.cssText = `
    display:none;
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.5);
    z-index:500;
    align-items:flex-start;
    justify-content:center;
    padding-top:80px;
  `

  overlay.innerHTML = `
    <div style="
      background:var(--bg);
      border-radius:12px;
      width:100%;
      max-width:620px;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);
      overflow:hidden;
    ">
      <!-- Search input -->
      <div style="display:flex;align-items:center;gap:0.75rem;padding:1rem 1.25rem;border-bottom:1px solid var(--border)">
        <span style="font-size:1.1rem;color:var(--muted)">🔍</span>
        <input
          id="global-search-input"
          type="text"
          placeholder="Search inventory, customers, sales, expenses..."
          autocomplete="off"
          style="
            flex:1;border:none;outline:none;font-size:1rem;
            background:transparent;color:var(--dark);
          "
        >
        <kbd style="
          font-size:11px;color:var(--muted);
          background:var(--bg-light);border:1px solid var(--border);
          border-radius:4px;padding:2px 6px;
        ">ESC</kbd>
      </div>

      <!-- Results -->
      <div id="search-results" style="max-height:420px;overflow-y:auto"></div>

      <!-- Footer -->
      <div id="search-footer" style="
        padding:0.6rem 1.25rem;
        border-top:1px solid var(--border);
        display:flex;gap:1rem;font-size:11.5px;color:var(--muted)
      ">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>ESC close</span>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  let debounceTimer   = null
  let selectedIndex   = -1
  let currentResults  = []

  const input = overlay.querySelector('#global-search-input')
  const resultsEl = overlay.querySelector('#search-results')

  // ── Open / Close ──────────────────────────────────────────
  function open() {
    overlay.style.display = 'flex'
    input.value = ''
    selectedIndex = -1
    currentResults = []
    resultsEl.innerHTML = renderEmpty()
    setTimeout(() => input.focus(), 50)
  }

  function close() {
    overlay.style.display = 'none'
    input.value = ''
    currentResults = []
    selectedIndex = -1
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close()
  })

  // ── Keyboard shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Cmd/Ctrl + K to open
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      overlay.style.display === 'none' ? open() : close()
    }
    if (e.key === 'Escape' && overlay.style.display !== 'none') close()
  })

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1)
      highlightResult()
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, 0)
      highlightResult()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && currentResults[selectedIndex]) {
        openResult(currentResults[selectedIndex])
      }
    }
  })

  // ── Search input ──────────────────────────────────────────
  input.addEventListener('input', e => {
    const query = e.target.value.trim()
    clearTimeout(debounceTimer)

    if (!query) {
      selectedIndex = -1
      currentResults = []
      resultsEl.innerHTML = renderEmpty()
      return
    }

    if (query.length < 2) return

    resultsEl.innerHTML = renderLoading()

    debounceTimer = setTimeout(() => runSearch(query), 220)
  })

  // ── Run search ────────────────────────────────────────────
  async function runSearch(query) {
    const { currentStore, accountingView, stores } = appStore.getState()
    const storeIds = accountingView === 'joint'
      ? stores.map(s => s.id)
      : [currentStore?.id]

    try {
      const { data, error } = await supabase.rpc('global_search', {
        p_store_ids: storeIds,
        p_query:     query,
        p_limit:     20,
      })

      if (error) throw error

      currentResults = data || []
      selectedIndex  = currentResults.length > 0 ? 0 : -1
      renderResults(query)

    } catch (err) {
      // Fallback to simple client-side search if RPC fails
      await fallbackSearch(query, storeIds)
    }
  }

  // ── Fallback search (no RPC) ──────────────────────────────
  async function fallbackSearch(query, storeIds) {
    const q = query.toLowerCase()

    const [{ data: items }, { data: custs }, { data: exps }] = await Promise.all([
      supabase.from('inventory_items').select('id, item_name, category, quantity, selling_price').in('store_id', storeIds).ilike('item_name', `%${q}%`).limit(5),
      supabase.from('customers').select('id, name, phone, credit_balance').in('store_id', storeIds).ilike('name', `%${q}%`).limit(5),
      supabase.from('expenses').select('id, description, category, amount, expense_date').in('store_id', storeIds).or(`description.ilike.%${q}%,category.ilike.%${q}%`).limit(5),
    ])

    currentResults = [
      ...(items||[]).map(i => ({ result_type:'inventory', result_id:i.id, title:i.item_name, subtitle:`${i.category||''} · Qty: ${i.quantity}`, amount:i.selling_price, url:'/inventory' })),
      ...(custs||[]).map(c => ({ result_type:'customer',  result_id:c.id, title:c.name,      subtitle:c.phone||'',                                    amount:c.credit_balance, url:'/credits' })),
      ...(exps||[]).map(e  => ({ result_type:'expense',   result_id:e.id, title:e.description||e.category||'Expense', subtitle:e.expense_date,         amount:e.amount,        url:'/expenses' })),
    ]

    selectedIndex = currentResults.length > 0 ? 0 : -1
    renderResults(query)
  }

  // ── Render results ────────────────────────────────────────
  function renderResults(query) {
    if (!currentResults.length) {
      resultsEl.innerHTML = renderNoResults(query)
      return
    }

    // Group by type
    const groups = {}
    currentResults.forEach(r => {
      if (!groups[r.result_type]) groups[r.result_type] = []
      groups[r.result_type].push(r)
    })

    resultsEl.innerHTML = Object.entries(groups).map(([type, items]) => `
      <div>
        <div style="
          padding:0.4rem 1.25rem;
          font-size:10.5px;font-weight:700;
          color:var(--muted);letter-spacing:1.2px;
          background:var(--bg-light);
          text-transform:uppercase;
        ">${TYPE_LABELS[type] || type}</div>
        ${items.map((r, localIdx) => {
          const globalIdx = currentResults.indexOf(r)
          return `
            <div class="search-result-item" data-idx="${globalIdx}" style="
              display:flex;align-items:center;gap:0.85rem;
              padding:0.75rem 1.25rem;cursor:pointer;
              background:${globalIdx === selectedIndex ? 'var(--accent-lt)' : 'transparent'};
              border-left:2px solid ${globalIdx === selectedIndex ? 'var(--accent)' : 'transparent'};
              transition:background 0.1s;
            ">
              <span style="font-size:1.2rem;width:24px;text-align:center">${ICONS[type] || '◈'}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;font-size:13.5px;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${highlight(r.title, query)}
                </div>
                <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${r.subtitle || ''}
                </div>
              </div>
              ${r.amount != null && r.amount > 0 ? `
                <div style="font-weight:700;font-size:13px;color:var(--accent);white-space:nowrap">
                  ${Number(r.amount).toLocaleString('en-ET', { minimumFractionDigits:2 })} ETB
                </div>
              ` : ''}
              <span style="font-size:10px;color:var(--border)">→</span>
            </div>
          `
        }).join('')}
      </div>
    `).join('')

    // Click handlers
    resultsEl.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        selectedIndex = Number(el.dataset.idx)
        highlightResult()
      })
      el.addEventListener('click', () => {
        openResult(currentResults[Number(el.dataset.idx)])
      })
    })
  }

  function highlightResult() {
    resultsEl.querySelectorAll('.search-result-item').forEach(el => {
      const isSelected = Number(el.dataset.idx) === selectedIndex
      el.style.background   = isSelected ? 'var(--accent-lt)' : 'transparent'
      el.style.borderLeft   = isSelected ? '2px solid var(--accent)' : '2px solid transparent'
      if (isSelected) el.scrollIntoView({ block:'nearest' })
    })
  }

  function openResult(result) {
    close()
    navigate(result.url)
  }

  // ── Highlight matching text ───────────────────────────────
  function highlight(text, query) {
    if (!query || !text) return text || ''
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.replace(
      new RegExp(`(${escaped})`, 'gi'),
      `<mark style="background:var(--accent-lt);color:var(--accent);border-radius:2px;padding:0 2px">$1</mark>`
    )
  }

  // ── Empty / loading states ────────────────────────────────
  function renderEmpty() {
    return `
      <div style="padding:2.5rem 1.25rem;text-align:center;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:0.75rem">🔍</div>
        <div style="font-weight:500;margin-bottom:0.35rem">Search everything</div>
        <div style="font-size:12.5px">Inventory · Customers · Sales · Expenses</div>
        <div style="margin-top:1rem;font-size:12px">
          <kbd style="background:var(--bg-light);border:1px solid var(--border);border-radius:4px;padding:2px 6px">Ctrl+K</kbd>
          to open anytime
        </div>
      </div>
    `
  }

  function renderLoading() {
    return `
      <div style="padding:2rem;text-align:center;color:var(--muted);font-size:13.5px">
        Searching...
      </div>
    `
  }

  function renderNoResults(query) {
    return `
      <div style="padding:2.5rem 1.25rem;text-align:center;color:var(--muted)">
        <div style="font-size:1.5rem;margin-bottom:0.5rem">🤷</div>
        <div style="font-weight:500">No results for "${query}"</div>
        <div style="font-size:12.5px;margin-top:0.35rem">Try a different search term</div>
      </div>
    `
  }

  // Return open function so nav can trigger it
  return { open, close }
}