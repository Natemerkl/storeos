import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { renderIcon } from '../components/icons.js'

const ACTION_COLORS = {
  complete_sale:      { bg:'var(--green-50)',  color:'#15803D',       label:'Sale'        },
  create:             { bg:'var(--teal-50)',   color:'var(--teal-700)',label:'Created'     },
  update:             { bg:'#EFF6FF',          color:'#1D4ED8',       label:'Updated'     },
  delete:             { bg:'var(--red-50)',    color:'#991B1B',       label:'Deleted'     },
  stock_movement:     { bg:'var(--amber-50)', color:'#92400E',       label:'Stock'       },
  payment_received:   { bg:'var(--green-50)', color:'#15803D',       label:'Payment'     },
  apply_ocr:          { bg:'#F5F3FF',         color:'#5B21B6',       label:'OCR'         },
  login:              { bg:'var(--gray-100)', color:'var(--muted)',   label:'Login'       },
  logout:             { bg:'var(--gray-100)', color:'var(--muted)',   label:'Logout'      },
  export:             { bg:'var(--teal-50)',  color:'var(--teal-700)',label:'Export'      },
  cash_transfer:      { bg:'var(--amber-50)','color':'#92400E',      label:'Transfer'    },
}

const ENTITY_ICONS = {
  sale:           'store',
  expense:        'expenses',
  inventory_item: 'inventory',
  stock_movement: 'inventory',
  cash_transfer:  'transfers',
  credit_sale:    'credits',
  vendor_debt:    'credits',
  ocr_log:        'scan',
  auth:           'user',
  export:         'reports',
}

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Audit Log</div>
        <div class="page-sub">Every action recorded — who did what and when</div>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-refresh-audit">
        ${renderIcon('refresh', 14)} Refresh
      </button>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center">
        <input class="form-input" id="audit-search"
          placeholder="Search actions, users, items..."
          style="max-width:240px">
        <select class="form-input" id="audit-action" style="max-width:160px">
          <option value="">All Actions</option>
          <option value="complete_sale">Sales</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="delete">Deleted</option>
          <option value="stock_movement">Stock Movements</option>
          <option value="payment_received">Payments</option>
          <option value="apply_ocr">OCR Applied</option>
          <option value="login">Logins</option>
          <option value="export">Exports</option>
        </select>
        <select class="form-input" id="audit-entity" style="max-width:170px">
          <option value="">All Types</option>
          <option value="sale">Sales</option>
          <option value="expense">Expenses</option>
          <option value="inventory_item">Inventory</option>
          <option value="cash_transfer">Cash Transfers</option>
          <option value="credit_sale">Credit Sales</option>
          <option value="auth">Auth Events</option>
        </select>
        <input type="date" class="form-input" id="audit-from" style="max-width:155px">
        <input type="date" class="form-input" id="audit-to"   style="max-width:155px">
        <button class="btn btn-ghost btn-sm" id="audit-clear">Clear</button>
      </div>
    </div>

    <!-- Stats row -->
    <div id="audit-stats" class="kpi-grid" style="margin-bottom:1rem"></div>

    <!-- Log table -->
    <div class="card">
      <div id="audit-table-wrap">
        <div style="padding:2rem;text-align:center;color:var(--muted)">Loading...</div>
      </div>

      <!-- Pagination -->
      <div id="audit-pagination" style="
        display:flex;justify-content:space-between;align-items:center;
        padding:0.875rem 0 0;border-top:1px solid var(--border);
        margin-top:0.5rem;
      "></div>
    </div>

    <!-- Detail modal -->
    <div id="audit-detail-modal" class="modal-overlay" style="display:none">
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <div class="modal-title">Action Details</div>
          <button class="modal-close" id="audit-detail-close">
            ${renderIcon('close', 14)}
          </button>
        </div>
        <div id="audit-detail-body"></div>
      </div>
    </div>
  `

  let page    = 1
  const limit = 25
  let allLogs = []

  // ── Load stats ────────────────────────────────────────────
  async function loadStats() {
    const today = new Date().toISOString().split('T')[0]

    const { data: todayLogs } = await supabase
      .from('audit_logs')
      .select('action')
      .in('store_id', storeIds)
      .gte('created_at', today + 'T00:00:00')

    const { data: totalLogs } = await supabase
      .from('audit_logs')
      .select('id', { count: 'exact' })
      .in('store_id', storeIds)

    const sales    = (todayLogs||[]).filter(l => l.action === 'complete_sale').length
    const changes  = (todayLogs||[]).filter(l => ['create','update','delete'].includes(l.action)).length
    const total    = totalLogs?.length || 0

    container.querySelector('#audit-stats').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Today's Actions</div>
        <div class="kpi-value">${(todayLogs||[]).length}</div>
        <div class="kpi-sub">logged today</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Today's Sales</div>
        <div class="kpi-value accent">${sales}</div>
        <div class="kpi-sub">completed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Data Changes</div>
        <div class="kpi-value">${changes}</div>
        <div class="kpi-sub">today</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Logged</div>
        <div class="kpi-value">${total.toLocaleString()}</div>
        <div class="kpi-sub">all time</div>
      </div>
    `
  }

  // ── Load logs ─────────────────────────────────────────────
  async function loadLogs() {
    const search     = container.querySelector('#audit-search').value.trim()
    const action     = container.querySelector('#audit-action').value
    const entityType = container.querySelector('#audit-entity').value
    const from       = container.querySelector('#audit-from').value
    const to         = container.querySelector('#audit-to').value

    let query = supabase
      .from('audit_logs')
      .select('*')
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (action)     query = query.eq('action', action)
    if (entityType) query = query.eq('entity_type', entityType)
    if (from)       query = query.gte('created_at', from + 'T00:00:00')
    if (to)         query = query.lte('created_at', to   + 'T23:59:59')
    if (search)     query = query.or(
      `entity_label.ilike.%${search}%,user_email.ilike.%${search}%,action.ilike.%${search}%`
    )

    const { data, error } = await query

    if (error) {
      container.querySelector('#audit-table-wrap').innerHTML =
        `<div class="empty"><div class="empty-text">Error loading logs: ${error.message}</div></div>`
      return
    }

    allLogs = data || []
    renderTable()
    renderPagination()
  }

  // ── Render table ──────────────────────────────────────────
  function renderTable() {
    const wrap = container.querySelector('#audit-table-wrap')

    if (allLogs.length === 0) {
      wrap.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${renderIcon('reports', 24, 'var(--gray-400)')}</div>
          <div class="empty-text">No audit logs found</div>
          <div class="empty-sub">Actions will appear here as the system is used</div>
        </div>
      `
      return
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${allLogs.map(log => {
              const ac      = ACTION_COLORS[log.action] || { bg:'var(--gray-100)', color:'var(--muted)', label: log.action }
              const icon    = ENTITY_ICONS[log.entity_type] || 'reports'
              const timeStr = formatTime(log.created_at)

              return `
                <tr style="cursor:pointer" data-log-id="${log.id}">
                  <td style="white-space:nowrap;color:var(--muted);font-size:0.8125rem">
                    <div style="font-weight:500;color:var(--dark)">${timeStr.date}</div>
                    <div>${timeStr.time}</div>
                  </td>
                  <td>
                    <div style="font-weight:500;font-size:0.875rem">
                      ${log.user_name || log.user_email?.split('@')[0] || '—'}
                    </div>
                    <div style="font-size:0.75rem;color:var(--muted)">${log.user_email || '—'}</div>
                  </td>
                  <td>
                    <span class="badge" style="background:${ac.bg};color:${ac.color}">
                      ${ac.label}
                    </span>
                  </td>
                  <td style="max-width:260px">
                    <div style="
                      font-size:0.875rem;font-weight:500;
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                    ">
                      ${log.entity_label || '—'}
                    </div>
                  </td>
                  <td>
                    <div style="display:flex;align-items:center;gap:0.375rem;color:var(--muted);font-size:0.8125rem">
                      ${renderIcon(icon, 13, 'currentColor')}
                      ${log.entity_type?.replace('_',' ') || '—'}
                    </div>
                  </td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-view="${log.id}">
                      Details
                    </button>
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `

    // Row click → details
    wrap.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const log = allLogs.find(l => l.id === btn.dataset.view)
        if (log) openDetail(log)
      })
    })

    wrap.querySelectorAll('tr[data-log-id]').forEach(row => {
      row.addEventListener('click', () => {
        const log = allLogs.find(l => l.id === row.dataset.logId)
        if (log) openDetail(log)
      })
    })
  }

  // ── Pagination ────────────────────────────────────────────
  function renderPagination() {
    const el = container.querySelector('#audit-pagination')
    el.innerHTML = `
      <div style="font-size:0.8125rem;color:var(--muted)">
        Page ${page} · Showing ${allLogs.length} records
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-outline btn-sm" id="btn-prev" ${page === 1 ? 'disabled style="opacity:0.4"' : ''}>
          ← Prev
        </button>
        <button class="btn btn-outline btn-sm" id="btn-next" ${allLogs.length < limit ? 'disabled style="opacity:0.4"' : ''}>
          Next →
        </button>
      </div>
    `

    el.querySelector('#btn-prev')?.addEventListener('click', () => {
      if (page > 1) { page--; loadLogs() }
    })
    el.querySelector('#btn-next')?.addEventListener('click', () => {
      if (allLogs.length === limit) { page++; loadLogs() }
    })
  }

  // ── Detail modal ──────────────────────────────────────────
  function openDetail(log) {
    const ac   = ACTION_COLORS[log.action] || { bg:'var(--gray-100)', color:'var(--muted)', label: log.action }
    const time = formatTime(log.created_at)

    container.querySelector('#audit-detail-body').innerHTML = `
      <!-- Header info -->
      <div style="
        display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;
        margin-bottom:1.25rem;
      ">
        <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:0.75rem;color:var(--muted);font-weight:600;margin-bottom:0.25rem">USER</div>
          <div style="font-weight:600">${log.user_name || '—'}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">${log.user_email || '—'}</div>
        </div>
        <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:0.75rem;color:var(--muted);font-weight:600;margin-bottom:0.25rem">TIME</div>
          <div style="font-weight:600">${time.date}</div>
          <div style="font-size:0.8125rem;color:var(--muted)">${time.time}</div>
        </div>
        <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:0.75rem;color:var(--muted);font-weight:600;margin-bottom:0.25rem">ACTION</div>
          <span class="badge" style="background:${ac.bg};color:${ac.color}">${ac.label}</span>
        </div>
        <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:var(--radius)">
          <div style="font-size:0.75rem;color:var(--muted);font-weight:600;margin-bottom:0.25rem">TYPE</div>
          <div style="font-weight:600">${log.entity_type?.replace('_',' ') || '—'}</div>
        </div>
      </div>

      <!-- Label -->
      <div style="margin-bottom:1rem;padding:0.875rem;background:var(--teal-50);border-radius:var(--radius);border:1px solid var(--teal-200,#99f6e4)">
        <div style="font-size:0.75rem;color:var(--muted);font-weight:600;margin-bottom:0.25rem">DESCRIPTION</div>
        <div style="font-weight:600;color:var(--dark)">${log.entity_label || '—'}</div>
      </div>

      <!-- Data diff -->
      ${log.old_data || log.new_data ? `
        <div style="display:grid;grid-template-columns:${log.old_data && log.new_data ? '1fr 1fr' : '1fr'};gap:0.75rem;margin-bottom:1rem">
          ${log.old_data ? `
            <div>
              <div style="font-size:0.75rem;font-weight:700;color:var(--danger);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.5px">
                Before
              </div>
              <pre style="
                font-size:0.75rem;background:var(--red-50);border:1px solid #FECACA;
                border-radius:var(--radius);padding:0.75rem;overflow:auto;
                max-height:180px;color:#991B1B;line-height:1.5;
              ">${JSON.stringify(log.old_data, null, 2)}</pre>
            </div>
          ` : ''}
          ${log.new_data ? `
            <div>
              <div style="font-size:0.75rem;font-weight:700;color:var(--accent);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.5px">
                After
              </div>
              <pre style="
                font-size:0.75rem;background:var(--teal-50);border:1px solid var(--teal-200,#99f6e4);
                border-radius:var(--radius);padding:0.75rem;overflow:auto;
                max-height:180px;color:var(--teal-700);line-height:1.5;
              ">${JSON.stringify(log.new_data, null, 2)}</pre>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Meta -->
      ${log.meta && Object.keys(log.meta).length > 0 ? `
        <div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.5px">
            Additional Info
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem">
            ${Object.entries(log.meta).map(([k, v]) => `
              <div style="
                background:var(--bg-subtle);border:1px solid var(--border);
                border-radius:var(--radius-pill);padding:0.25rem 0.75rem;
                font-size:0.8125rem;
              ">
                <span style="color:var(--muted)">${k}:</span>
                <span style="font-weight:600;margin-left:0.25rem">${v}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `

    container.querySelector('#audit-detail-modal').style.display = 'flex'
  }

  container.querySelector('#audit-detail-close').addEventListener('click', () => {
    container.querySelector('#audit-detail-modal').style.display = 'none'
  })

  // ── Filters ───────────────────────────────────────────────
  const filterFn = () => { page = 1; loadLogs() }
  container.querySelector('#audit-search').addEventListener('input',  filterFn)
  container.querySelector('#audit-action').addEventListener('change', filterFn)
  container.querySelector('#audit-entity').addEventListener('change', filterFn)
  container.querySelector('#audit-from').addEventListener('change',   filterFn)
  container.querySelector('#audit-to').addEventListener('change',     filterFn)

  container.querySelector('#audit-clear').addEventListener('click', () => {
    container.querySelector('#audit-search').value = ''
    container.querySelector('#audit-action').value = ''
    container.querySelector('#audit-entity').value = ''
    container.querySelector('#audit-from').value   = ''
    container.querySelector('#audit-to').value     = ''
    page = 1
    loadLogs()
  })

  container.querySelector('#btn-refresh-audit').addEventListener('click', () => {
    loadStats()
    loadLogs()
  })

  // ── Init ──────────────────────────────────────────────────
  await Promise.all([loadStats(), loadLogs()])
}

// ── Helpers ───────────────────────────────────────────────────
function formatTime(iso) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
  }
}