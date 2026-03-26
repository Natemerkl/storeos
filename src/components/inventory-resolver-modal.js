import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from './icons.js'
import { applyResolutions } from '../utils/inventory-resolver.js'

let modalEl = null

/**
 * Open the inventory resolution modal
 * @param {Array}  resolutions  - from checkSaleAgainstInventory()
 * @param {string} saleId       - the sale record ID
 * @param {Function} onDone     - callback when all resolved
 */
export async function openInventoryResolverModal(resolutions, saleId, onDone) {
    if (!resolutions?.length) { if (onDone) onDone(); return }
    if (modalEl) modalEl.remove()

    const { stores, currentStore } = appStore.getState()

    // Load inventory for search / matching
    const { data: allInventory } = await supabase
        .from('inventory_items')
        .select('id, item_name, quantity, unit_cost, selling_price')
        .eq('store_id', currentStore?.id)

    // Each resolution starts with decision = null
    const items = resolutions.map(r => ({ ...r }))

    // ── Build modal ──────────────────────────────────────────
    const overlay = document.createElement('div')
    overlay.style.cssText = `
    position:fixed;inset:0;z-index:350;
    background:rgba(0,0,0,0.45);
    backdrop-filter:blur(4px);
    display:flex;align-items:flex-end;
    justify-content:center;
  `

    const modal = document.createElement('div')
    modal.style.cssText = `
    background:var(--bg-elevated);
    border-radius:24px 24px 0 0;
    width:100%;max-width:640px;
    max-height:92dvh;overflow-y:auto;
    box-shadow:var(--shadow-lg);
    padding-bottom:calc(env(safe-area-inset-bottom,0px) + 1rem);
  `

    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    modalEl = overlay

    function fmt(n) {
        return Number(n || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    function allResolved() {
        return items.every(i => i.decision !== null)
    }

    // ── Render ───────────────────────────────────────────────
    function render() {
        const resolved = items.filter(i => i.decision !== null).length
        const total = items.length

        modal.innerHTML = `
      <!-- Drag handle -->
      <div style="padding:12px 0 0;text-align:center">
        <div style="width:36px;height:4px;background:var(--gray-200);
          border-radius:999px;display:inline-block;"></div>
      </div>

      <!-- Header -->
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <div style="width:36px;height:36px;border-radius:10px;
            background:var(--amber-50);border:1px solid #FDE68A;
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${renderIcon('inventory', 18, '#92400E')}
          </div>
          <div>
            <div style="font-weight:700;font-size:1rem;color:var(--dark)">
              Inventory not tracked
            </div>
            <div style="font-size:0.8125rem;color:var(--muted);margin-top:1px">
              ${resolved} of ${total} items resolved
            </div>
          </div>
        </div>

        <!-- Progress bar -->
        <div style="height:4px;background:var(--gray-100);border-radius:999px;
          margin-top:10px;overflow:hidden;">
          <div style="height:100%;border-radius:999px;background:var(--accent);
            width:${total > 0 ? Math.round(resolved / total * 100) : 0}%;
            transition:width 0.3s ease;"></div>
        </div>
      </div>

      <!-- Items -->
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:12px">
        ${items.map((item, i) => itemHtml(item, i)).join('')}
      </div>

      <!-- Actions -->
      <div style="padding:0 16px 8px;display:flex;gap:10px;
        border-top:1px solid var(--border);padding-top:16px;">
        <button id="res-skip-all" class="btn btn-outline"
          style="flex:1;justify-content:center">
          Skip remaining
        </button>
        <button id="res-apply" class="btn btn-primary"
          style="flex:2;justify-content:center;font-size:1rem;min-height:48px;
            border-radius:14px;gap:0.5rem;"
          ${!allResolved() ? 'disabled' : ''}>
          ${renderIcon('check', 18)}
          Apply ${resolved} of ${total}
        </button>
      </div>
    `

        bindAll()
    }

    // ── Item HTML ────────────────────────────────────────────
    function itemHtml(item, i) {
        const isResolved = item.decision !== null
        const hasFuzzy = item.fuzzyMatches?.length > 0

        let borderColor = 'var(--border)'
        let bgColor = 'var(--bg-subtle)'
        if (item.decision === 'skip') { borderColor = 'var(--border)'; bgColor = 'var(--gray-50)' }
        if (item.decision === 'match') { borderColor = 'var(--teal-200)'; bgColor = 'var(--teal-50)' }
        if (item.decision === 'create') { borderColor = '#A7F3D0'; bgColor = '#F0FDF4' }

        return `
      <div data-item="${i}" style="
        border:1.5px solid ${borderColor};border-radius:16px;
        background:${bgColor};padding:14px;
        transition:all 0.2s;
      ">
        <!-- Item header -->
        <div style="display:flex;align-items:flex-start;
          justify-content:space-between;gap:8px;margin-bottom:10px">
          <div>
            <div style="font-weight:700;font-size:0.9375rem;color:var(--dark)">
              ${escHtml(item.soldName)}
            </div>
            <div style="font-size:0.8125rem;color:var(--muted);margin-top:2px">
              Sold: <strong>${item.soldQty}</strong> units
              ${item.soldPrice > 0 ? `· at ${fmt(item.soldPrice)} ETB` : ''}
            </div>
          </div>
          ${isResolved ? `
            <span style="
              display:inline-flex;align-items:center;gap:4px;
              font-size:0.75rem;font-weight:600;white-space:nowrap;
              padding:3px 10px;border-radius:999px;
              background:${item.decision === 'skip' ? 'var(--gray-100)' : item.decision === 'match' ? 'var(--teal-50)' : '#DCFCE7'};
              color:${item.decision === 'skip' ? 'var(--muted)' : item.decision === 'match' ? 'var(--teal-700)' : '#15803D'};
              border:1px solid ${item.decision === 'skip' ? 'var(--border)' : item.decision === 'match' ? 'var(--teal-200)' : '#86EFAC'};
            ">
              ${item.decision === 'skip' ? renderIcon('close', 10, 'currentColor') + '  Skipped' : ''}
              ${item.decision === 'match' ? renderIcon('check', 10, 'currentColor') + '  Matched' : ''}
              ${item.decision === 'create' ? renderIcon('check', 10, 'currentColor') + '  Will create' : ''}
            </span>
          ` : ''}
        </div>

        ${!isResolved ? `
          <!-- Fuzzy match suggestion -->
          ${hasFuzzy ? `
            <div style="
              padding:10px;border-radius:10px;
              background:rgba(13,148,136,0.06);
              border:1px solid var(--teal-200);
              margin-bottom:10px;
            ">
              <div style="font-size:0.75rem;font-weight:700;color:var(--teal-700);
                margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">
                Similar product found
              </div>
              ${item.fuzzyMatches.slice(0, 2).map((match, mi) => `
                <div style="
                  display:flex;align-items:center;justify-content:space-between;
                  padding:8px 10px;border-radius:8px;
                  background:var(--bg-elevated);
                  border:1px solid var(--border);
                  margin-bottom:${mi < item.fuzzyMatches.slice(0, 2).length - 1 ? '6px' : '0'};
                ">
                  <div style="min-width:0;flex:1">
                    <div style="font-weight:600;font-size:0.875rem;color:var(--dark)">
                      ${escHtml(match.item_name)}
                    </div>
                    <div style="font-size:0.75rem;color:var(--muted);margin-top:1px">
                      ${match.quantity} in stock
                      · ${Math.round(match.confidence * 100)}% match
                    </div>
                  </div>
                  <button class="btn-match-existing btn btn-outline btn-sm"
                    data-item="${i}" data-match-id="${match.id}"
                    data-match-name="${escHtml(match.item_name)}"
                    data-match-price="${match.selling_price || ''}"
                    data-sold-price="${item.soldPrice}"
                    style="flex-shrink:0;margin-left:8px;white-space:nowrap">
                    Use this
                  </button>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="font-size:0.8125rem;color:var(--muted);
              margin-bottom:10px;padding:8px 10px;
              background:var(--red-50);border-radius:8px;
              border:1px solid #FECACA;display:flex;gap:6px;align-items:center;">
              ${renderIcon('alert', 13, '#991B1B')}
              <span style="color:#991B1B;font-weight:500">Not found in inventory</span>
            </div>
          `}

          <!-- Choice buttons -->
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-choice btn btn-sm btn-outline" data-item="${i}" data-choice="skip"
              style="font-size:0.8125rem;color:var(--muted)">
              Skip
            </button>
            ${(allInventory?.length || 0) > 0 ? `
              <button class="btn-choice btn btn-sm btn-outline" data-item="${i}" data-choice="search"
                style="font-size:0.8125rem">
                ${renderIcon('search', 12)} Match inventory
              </button>
            ` : ''}
            <button class="btn-choice btn btn-sm" data-item="${i}" data-choice="create"
              style="font-size:0.8125rem;background:var(--accent);color:#fff;border:none">
              ${renderIcon('plus', 12, '#fff')} Create new
            </button>
          </div>

          <!-- Search panel (hidden by default) -->
          <div class="search-panel" data-panel="${i}" style="display:none;margin-top:10px">
            <input type="text" class="form-input inv-search" data-item="${i}"
              placeholder="Search inventory..."
              style="margin-bottom:6px">
            <div class="inv-search-results" data-item="${i}"
              style="max-height:160px;overflow-y:auto;display:flex;
                flex-direction:column;gap:4px;">
            </div>
          </div>

          <!-- Create panel (hidden by default) -->
          <div class="create-panel" data-panel-create="${i}" style="display:none;margin-top:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
              <div>
                <label class="form-label">Store *</label>
                <select class="form-input store-select" data-item="${i}">
                  ${stores.map(s => `
                    <option value="${s.id}" ${s.id === currentStore?.id ? 'selected' : ''}>
                      ${s.name}
                    </option>
                  `).join('')}
                </select>
              </div>
              <div>
                <label class="form-label">Total qty you had</label>
                <input type="number" class="form-input total-qty-input" data-item="${i}"
                  placeholder="e.g. 200" min="0" step="1" inputmode="numeric"
                  style="font-weight:600">
              </div>
            </div>
            <div>
              <label class="form-label">Unit cost (ETB)
                <span style="font-weight:400;color:var(--muted)">
                  — leave blank to use selling price (${fmt(item.soldPrice)} ETB)
                </span>
              </label>
              <input type="number" class="form-input unit-cost-input" data-item="${i}"
                placeholder="${item.soldPrice > 0 ? fmt(item.soldPrice) : '0.00'}"
                min="0" step="0.01" inputmode="decimal">
            </div>
            <div style="margin-top:8px;font-size:0.8125rem;
              color:var(--muted);background:var(--bg-subtle);
              padding:8px 10px;border-radius:8px;line-height:1.5">
              Will create: <strong>${escHtml(item.soldName)}</strong>
              with <strong id="remaining-display-${i}">? − ${item.soldQty} = ?</strong> remaining
            </div>
            <button class="btn-confirm-create btn btn-primary btn-sm"
              data-item="${i}" style="margin-top:10px;gap:6px">
              ${renderIcon('check', 13, '#fff')} Confirm create
            </button>
          </div>

          <!-- Price update prompt (shown after match) -->
          <div class="price-prompt" data-price-prompt="${i}" style="display:none;margin-top:10px;
            padding:10px;border-radius:10px;background:var(--amber-50);
            border:1px solid #FDE68A;">
            <div style="font-size:0.8125rem;font-weight:600;color:#92400E;margin-bottom:8px">
              Update selling price?
            </div>
            <div style="font-size:0.8125rem;color:#78350F;margin-bottom:10px">
              Sale price: <strong>${fmt(item.soldPrice)} ETB</strong>
              · Inventory price: <strong id="inv-price-display-${i}">—</strong>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn-price-yes btn btn-sm" data-item="${i}"
                style="background:var(--accent);color:#fff;border:none;
                  font-size:0.8125rem;border-radius:8px;padding:6px 14px;
                  cursor:pointer;-webkit-tap-highlight-color:transparent">
                Yes, update to ${fmt(item.soldPrice)} ETB
              </button>
              <button class="btn-price-no btn btn-sm btn-outline" data-item="${i}"
                style="font-size:0.8125rem">
                Keep existing
              </button>
            </div>
          </div>

        ` : `
          <!-- Resolved summary -->
          <div style="font-size:0.8125rem;color:var(--muted);margin-top:4px">
            ${item.decision === 'skip' ? 'Will not affect inventory.' : ''}
            ${item.decision === 'match' ? `Will deduct ${item.soldQty} from "${escHtml(item.matchedItemName || '')}"${item.updatePrice === true ? ` and update price to ${fmt(item.soldPrice)} ETB` : ''}` : ''}
            ${item.decision === 'create' ? `Will create with ${Math.max(0, (Number(item.totalQtyHad) || item.soldQty) - item.soldQty)} remaining in ${escHtml(stores.find(s => s.id === item.targetStoreId)?.name || '')}` : ''}
          </div>
          <button class="btn-undo btn btn-ghost btn-sm" data-item="${i}"
            style="margin-top:6px;font-size:0.75rem;color:var(--muted)">
            ↩ Change decision
          </button>
        `}
      </div>
    `
    }

    // ── Bind all events ──────────────────────────────────────
    function bindAll() {

        // Skip
        modal.querySelectorAll('.btn-choice[data-choice="skip"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                items[i].decision = 'skip'
                reRenderItem(i)
            })
        })

        // Show search panel
        modal.querySelectorAll('.btn-choice[data-choice="search"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                const panel = modal.querySelector(`.search-panel[data-panel="${i}"]`)
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
                    panel.querySelector('.inv-search')?.focus()
                }
            })
        })

        // Show create panel
        modal.querySelectorAll('.btn-choice[data-choice="create"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                const panel = modal.querySelector(`.create-panel[data-panel-create="${i}"]`)
                if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
            })
        })

        // Inventory search input
        modal.querySelectorAll('.inv-search').forEach(inp => {
            inp.addEventListener('input', () => {
                const i = parseInt(inp.dataset.item)
                const query = inp.value.toLowerCase().trim()
                const results = modal.querySelector(`.inv-search-results[data-item="${i}"]`)
                if (!results) return

                const filtered = (allInventory || []).filter(inv =>
                    inv.item_name.toLowerCase().includes(query)
                ).slice(0, 8)

                results.innerHTML = filtered.map(inv => `
          <div style="
            display:flex;align-items:center;justify-content:space-between;
            padding:8px 10px;border-radius:8px;
            background:var(--bg-elevated);border:1px solid var(--border);
            cursor:pointer;transition:all 0.15s;
            -webkit-tap-highlight-color:transparent;
          " class="inv-result"
            data-item="${i}"
            data-match-id="${inv.id}"
            data-match-name="${escHtml(inv.item_name)}"
            data-match-price="${inv.selling_price || ''}"
            data-sold-price="${items[i].soldPrice}">
            <div>
              <div style="font-weight:600;font-size:0.875rem">${escHtml(inv.item_name)}</div>
              <div style="font-size:0.75rem;color:var(--muted)">${inv.quantity} in stock</div>
            </div>
            <div style="font-size:0.8125rem;font-weight:600;color:var(--accent)">
              Select
            </div>
          </div>
        `).join('')

                results.querySelectorAll('.inv-result').forEach(row => {
                    row.addEventListener('click', () => handleMatchSelect(row))
                })
            })
        })

        // Match from fuzzy suggestion buttons
        modal.querySelectorAll('.btn-match-existing').forEach(btn => {
            btn.addEventListener('click', () => handleMatchSelect(btn))
        })

        // Handle match selection (shared logic)
        function handleMatchSelect(el) {
            const i = parseInt(el.dataset.item)
            const matchId = el.dataset.matchId
            const matchName = el.dataset.matchName
            const matchPrice = parseFloat(el.dataset.matchPrice) || 0
            const soldPrice = parseFloat(el.dataset.soldPrice) || 0

            items[i].matchedItemId = matchId
            items[i].matchedItemName = matchName

            // If prices differ — ask user
            if (matchPrice > 0 && soldPrice > 0 && Math.abs(matchPrice - soldPrice) > 0.01) {
                // Show price prompt, don't set decision yet
                items[i]._pendingMatchId = matchId
                items[i]._pendingMatchName = matchName
                items[i]._matchPrice = matchPrice

                // Show price prompt
                const pricePrompt = modal.querySelector(`[data-price-prompt="${i}"]`)
                const invPriceEl = modal.querySelector(`#inv-price-display-${i}`)
                if (pricePrompt) pricePrompt.style.display = 'block'
                if (invPriceEl) invPriceEl.textContent = fmt(matchPrice) + ' ETB'
            } else {
                // Same price or no price — resolve directly
                items[i].decision = 'match'
                items[i].matchedItemId = matchId
                items[i].matchedItemName = matchName
                items[i].updatePrice = false
                reRenderItem(i)
            }
        }

        // Price: Yes update
        modal.querySelectorAll('.btn-price-yes').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                items[i].decision = 'match'
                items[i].matchedItemId = items[i]._pendingMatchId
                items[i].matchedItemName = items[i]._pendingMatchName
                items[i].updatePrice = true
                reRenderItem(i)
            })
        })

        // Price: No keep
        modal.querySelectorAll('.btn-price-no').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                items[i].decision = 'match'
                items[i].matchedItemId = items[i]._pendingMatchId
                items[i].matchedItemName = items[i]._pendingMatchName
                items[i].updatePrice = false
                reRenderItem(i)
            })
        })

        // Confirm create
        modal.querySelectorAll('.btn-confirm-create').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                const panel = modal.querySelector(`.create-panel[data-panel-create="${i}"]`)
                const totalQty = parseFloat(panel?.querySelector('.total-qty-input')?.value) || 0
                const unitCost = parseFloat(panel?.querySelector('.unit-cost-input')?.value) || null
                const storeId = panel?.querySelector('.store-select')?.value || currentStore?.id

                if (!totalQty) {
                    showToast('Enter the total quantity you had before the sale', 'error')
                    return
                }

                items[i].decision = 'create'
                items[i].totalQtyHad = totalQty
                items[i].unitCost = unitCost
                items[i].targetStoreId = storeId
                reRenderItem(i)
            })
        })

        // Live remaining display
        modal.querySelectorAll('.total-qty-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const i = parseInt(inp.dataset.item)
                const totalQty = parseFloat(inp.value) || 0
                const remaining = Math.max(0, totalQty - items[i].soldQty)
                const display = modal.querySelector(`#remaining-display-${i}`)
                if (display) {
                    display.textContent = `${totalQty} − ${items[i].soldQty} = ${remaining} remaining`
                }
            })
        })

        // Undo decision
        modal.querySelectorAll('.btn-undo').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.item)
                items[i].decision = null
                items[i].matchedItemId = null
                items[i].matchedItemName = null
                items[i].updatePrice = null
                items[i]._pendingMatchId = null
                items[i].totalQtyHad = null
                items[i].unitCost = null
                reRenderItem(i)
            })
        })

        // Skip all
        modal.querySelector('#res-skip-all')?.addEventListener('click', () => {
            items.forEach(item => { if (item.decision === null) item.decision = 'skip' })
            render()
        })

        // Apply
        modal.querySelector('#res-apply')?.addEventListener('click', async () => {
            if (!allResolved()) {
                showToast('Resolve all items before applying', 'error')
                return
            }

            const applyBtn = modal.querySelector('#res-apply')
            applyBtn.textContent = 'Applying...'
            applyBtn.disabled = true

            try {
                const results = await applyResolutions(items, saleId)

                const successes = results.success.length
                const errors = results.errors.length

                close()

                if (errors > 0) {
                    showToast(`Applied ${successes} items. ${errors} failed — check console.`, 'error')
                } else {
                    showToast(`Inventory updated for ${successes} item${successes !== 1 ? 's' : ''}`, 'success')
                }

                if (onDone) onDone()

            } catch (err) {
                console.error('Apply error:', err)
                showToast('Failed to apply: ' + err.message, 'error')
                applyBtn.textContent = 'Apply'
                applyBtn.disabled = false
            }
        })
    }

    // ── Re-render a single item row ──────────────────────────
    function reRenderItem(i) {
        const existing = modal.querySelector(`[data-item="${i}"]`)
        if (existing) {
            const wrap = document.createElement('div')
            wrap.innerHTML = itemHtml(items[i], i)
            const newEl = wrap.firstElementChild
            existing.replaceWith(newEl)
        }
        // Update progress bar and apply button
        const resolved = items.filter(i => i.decision !== null).length
        const total = items.length
        const pb = modal.querySelector('[style*="transition:width"]')
        if (pb) pb.style.width = `${Math.round(resolved / total * 100)}%`
        const progressText = modal.querySelector('[style*="of ${total} items"]')
        // Re-bind
        bindAll()
        // Update apply button state
        const applyBtn = modal.querySelector('#res-apply')
        if (applyBtn) {
            applyBtn.disabled = !allResolved()
            applyBtn.innerHTML = `${renderIcon('check', 18)} Apply ${resolved} of ${total}`
        }
    }

    function close() {
        if (modalEl) { modalEl.remove(); modalEl = null }
    }

    // ── Init ─────────────────────────────────────────────────
    render()
}

// ── Toast helper ─────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const t = document.createElement('div')
    t.className = `toast toast-${type}`
    t.textContent = msg
    let wrap = document.querySelector('.toast-container')
    if (!wrap) {
        wrap = document.createElement('div')
        wrap.className = 'toast-container'
        document.body.appendChild(wrap)
    }
    wrap.appendChild(t)
    setTimeout(() => t.remove(), 4000)
}