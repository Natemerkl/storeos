import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { computePandL, computeBalanceSheet, computePandLFromLedger } from '../utils/accounting.js'

export async function render(container) {
  const { currentStore, accountingView, stores } = appStore.getState()
  const storeIds = accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id]

  const now        = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
  const today      = now.toISOString().split('T')[0]

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Accounting</div>
        <div class="page-sub">${accountingView === 'joint' ? 'All Stores' : currentStore?.name ?? ''}</div>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="tab-bar" style="display:flex;gap:0;margin-bottom:1.5rem;border-bottom:2px solid var(--border)">
      ${[
        { id:'pl',      label:'📊 P&L Statement'     },
        { id:'bs',      label:'⚖️ Balance Sheet'      },
        { id:'coa',     label:'📋 Chart of Accounts'  },
        { id:'ledger',  label:'📒 General Ledger'     },
        { id:'vat',     label:'🧾 VAT Summary'        },
      ].map((t,i) => `
        <button class="tab-btn" data-tab="${t.id}" style="
          padding:0.6rem 1.1rem;font-size:13.5px;font-weight:600;
          border:none;background:none;cursor:pointer;white-space:nowrap;
          color:${i===0 ? 'var(--accent)' : 'var(--muted)'};
          border-bottom:${i===0 ? '2px solid var(--accent)' : '2px solid transparent'};
          margin-bottom:-2px;
        ">${t.label}</button>
      `).join('')}
    </div>

    <div id="tab-content"></div>
  `

  let activeTab = 'pl'

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab
      container.querySelectorAll('.tab-btn').forEach(b => {
        const active = b.dataset.tab === activeTab
        b.style.color        = active ? 'var(--accent)' : 'var(--muted)'
        b.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent'
      })
      loadTab()
    })
  })

  async function loadTab() {
    const el = container.querySelector('#tab-content')
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Loading...</div>`
    if (activeTab === 'pl')     await renderPL(el)
    if (activeTab === 'bs')     await renderBS(el)
    if (activeTab === 'coa')    await renderCOA(el)
    if (activeTab === 'ledger') await renderLedger(el)
    if (activeTab === 'vat')    await renderVAT(el)
  }

  // ── P&L STATEMENT ─────────────────────────────────────────
  async function renderPL(el) {
    el.innerHTML = `
      <!-- Date range -->
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
          <input type="date" class="form-input" id="pl-from" value="${monthStart}" style="max-width:160px">
          <span style="color:var(--muted)">to</span>
          <input type="date" class="form-input" id="pl-to" value="${today}" style="max-width:160px">
          <button class="btn btn-primary btn-sm" id="pl-run">Generate</button>
          <div style="display:flex;gap:0.5rem;margin-left:auto">
            <button class="btn btn-outline btn-sm" data-preset="month">This Month</button>
            <button class="btn btn-outline btn-sm" data-preset="quarter">This Quarter</button>
            <button class="btn btn-outline btn-sm" data-preset="year">This Year</button>
          </div>
          <div style="display:flex;gap:0.5rem;border-left:1px solid var(--border);padding-left:0.75rem">
            <span style="font-size:12px;color:var(--muted);align-self:center">Source:</span>
            <button class="btn btn-outline btn-sm source-btn active-source" data-source="derived" style="font-size:11px">Fast (Derived)</button>
            <button class="btn btn-outline btn-sm source-btn" data-source="ledger" style="font-size:11px">GL Ledger</button>
          </div>
        </div>
      </div>
      <div id="pl-body"></div>
    `

    let source = 'derived'

    el.querySelectorAll('.source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        source = btn.dataset.source
        el.querySelectorAll('.source-btn').forEach(b => {
          b.classList.toggle('active-source', b.dataset.source === source)
          b.style.borderColor = b.dataset.source === source ? 'var(--accent)' : ''
          b.style.color       = b.dataset.source === source ? 'var(--accent)' : ''
        })
      })
    })

    el.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const n = new Date()
        const t = n.toISOString().split('T')[0]
        if (btn.dataset.preset === 'month') {
          el.querySelector('#pl-from').value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`
          el.querySelector('#pl-to').value   = t
        } else if (btn.dataset.preset === 'quarter') {
          const q = Math.floor(n.getMonth() / 3)
          el.querySelector('#pl-from').value = `${n.getFullYear()}-${String(q*3+1).padStart(2,'0')}-01`
          el.querySelector('#pl-to').value   = t
        } else {
          el.querySelector('#pl-from').value = `${n.getFullYear()}-01-01`
          el.querySelector('#pl-to').value   = t
        }
        runPL()
      })
    })

    el.querySelector('#pl-run').addEventListener('click', runPL)

    async function runPL() {
      const from = el.querySelector('#pl-from').value
      const to   = el.querySelector('#pl-to').value
      const body = el.querySelector('#pl-body')
      body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Calculating...</div>`

      const pl = source === 'ledger'
        ? await computePandLFromLedger(storeIds, from, to)
        : await computePandL(storeIds, from, to)

      const margin = pl.margin || pl.netProfit / (pl.totalRevenue || pl.revenue || 1) * 100

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
          <div class="kpi-card">
            <div class="kpi-label">Total Revenue</div>
            <div class="kpi-value accent">${fmt(pl.revenue || pl.totalRevenue)}</div>
            <div class="kpi-sub">ETB</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total Expenses</div>
            <div class="kpi-value">${fmt(pl.expenses || pl.totalExpenses)}</div>
            <div class="kpi-sub">ETB</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Net Profit</div>
            <div class="kpi-value" style="color:${(pl.netProfit||pl.grossProfit) >= 0 ? 'var(--accent)':'var(--danger)'}">
              ${fmt(pl.netProfit || pl.grossProfit)}
            </div>
            <div class="kpi-sub">ETB</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Profit Margin</div>
            <div class="kpi-value" style="color:${margin >= 0 ? 'var(--accent)':'var(--danger)'}">
              ${margin.toFixed(1)}%
            </div>
            <div class="kpi-sub">of revenue</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <!-- Revenue section -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:1rem;color:var(--accent)">REVENUE</div>
            ${renderPLSection(
              source === 'ledger' ? pl.revenue : { 'Sales Revenue': pl.revenue || pl.totalRevenue },
              'accent'
            )}
            <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;border-top:2px solid var(--border);font-weight:700;margin-top:0.5rem">
              <span>Total Revenue</span>
              <span style="color:var(--accent)">${fmt(pl.revenue || pl.totalRevenue)} ETB</span>
            </div>
          </div>

          <!-- Expenses section -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:1rem;color:var(--danger)">EXPENSES</div>
            ${renderPLSection(
              source === 'ledger' ? pl.expenses : (pl.expenseGroups || {}),
              'danger'
            )}
            <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;border-top:2px solid var(--border);font-weight:700;margin-top:0.5rem">
              <span>Total Expenses</span>
              <span style="color:var(--danger)">${fmt(pl.expenses || pl.totalExpenses)} ETB</span>
            </div>
          </div>
        </div>

        <!-- Net profit bar -->
        <div style="margin-top:1rem;padding:1.25rem;background:${(pl.netProfit||pl.grossProfit) >= 0 ? 'var(--accent-lt)' : '#fee2e2'};border-radius:var(--radius);border:1px solid ${(pl.netProfit||pl.grossProfit) >= 0 ? 'var(--accent)' : 'var(--danger)'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:700;font-size:1rem">NET PROFIT / LOSS</div>
              <div style="font-size:12px;color:var(--muted)">${from} to ${to}</div>
            </div>
            <div style="font-size:1.8rem;font-weight:800;color:${(pl.netProfit||pl.grossProfit) >= 0 ? 'var(--accent)':'var(--danger)'}">
              ${(pl.netProfit||pl.grossProfit) >= 0 ? '+' : ''}${fmt(pl.netProfit || pl.grossProfit)} ETB
            </div>
          </div>
        </div>
      `
    }

    runPL()
  }

  function renderPLSection(data, colorVar) {
    if (!data || !Object.keys(data).length) {
      return `<div style="color:var(--muted);font-size:13px;padding:0.5rem 0">No data</div>`
    }
    return Object.entries(data)
      .filter(([, v]) => v > 0.01)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => `
        <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13.5px;color:var(--dark)">${name}</span>
          <span style="font-weight:600;color:var(--${colorVar})">${fmt(value)} ETB</span>
        </div>
      `).join('')
  }

  // ── BALANCE SHEET ─────────────────────────────────────────
  async function renderBS(el) {
    const bs = await computeBalanceSheet(storeIds)

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
        <div class="kpi-card">
          <div class="kpi-label">Total Assets</div>
          <div class="kpi-value accent">${fmt(bs.assets.total)}</div>
          <div class="kpi-sub">ETB</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Liabilities</div>
          <div class="kpi-value" style="color:var(--danger)">${fmt(bs.liabilities.total)}</div>
          <div class="kpi-sub">ETB</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Owner Equity</div>
          <div class="kpi-value" style="color:${bs.equity >= 0 ? 'var(--accent)':'var(--danger)'}">
            ${fmt(bs.equity)}
          </div>
          <div class="kpi-sub">ETB</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <!-- Assets -->
        <div class="card">
          <div style="font-weight:700;margin-bottom:1rem;font-size:1rem">ASSETS</div>

          <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;margin-bottom:0.5rem">CURRENT ASSETS</div>
          ${bsRow('Cash & Bank', bs.assets.cash)}
          ${bsRow('Inventory', bs.assets.inventory)}
          ${bsRow('Accounts Receivable', bs.assets.receivables)}

          <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;border-top:2px solid var(--border);font-weight:700;margin-top:0.5rem">
            <span>TOTAL ASSETS</span>
            <span style="color:var(--accent)">${fmt(bs.assets.total)} ETB</span>
          </div>
        </div>

        <!-- Liabilities + Equity -->
        <div class="card">
          <div style="font-weight:700;margin-bottom:1rem;font-size:1rem">LIABILITIES & EQUITY</div>

          <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;margin-bottom:0.5rem">CURRENT LIABILITIES</div>
          ${bsRow('Accounts Payable', bs.liabilities.payables, 'danger')}

          <div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-top:1px solid var(--border);font-weight:600;margin-top:0.5rem">
            <span>Total Liabilities</span>
            <span style="color:var(--danger)">${fmt(bs.liabilities.total)} ETB</span>
          </div>

          <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;margin:0.75rem 0 0.5rem">EQUITY</div>
          ${bsRow('Owner Equity', bs.equity, bs.equity >= 0 ? 'accent' : 'danger')}

          <div style="display:flex;justify-content:space-between;padding:0.75rem 0 0;border-top:2px solid var(--border);font-weight:700;margin-top:0.5rem">
            <span>TOTAL LIABILITIES + EQUITY</span>
            <span style="color:var(--accent)">${fmt(bs.liabilities.total + bs.equity)} ETB</span>
          </div>

          <!-- Accounting equation check -->
          <div style="margin-top:0.75rem;padding:0.6rem;background:${Math.abs(bs.assets.total - (bs.liabilities.total + bs.equity)) < 1 ? 'var(--accent-lt)':'#fee2e2'};border-radius:var(--radius);font-size:12px;text-align:center">
            ${Math.abs(bs.assets.total - (bs.liabilities.total + bs.equity)) < 1
              ? '✓ Balanced — Assets = Liabilities + Equity'
              : '⚠️ Balance sheet not balanced — post more journal entries'}
          </div>
        </div>
      </div>
    `
  }

  function bsRow(label, value, colorVar = 'dark') {
    return `
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13.5px;color:var(--muted)">${label}</span>
        <span style="font-weight:600;color:var(--${colorVar})">${fmt(value)} ETB</span>
      </div>
    `
  }

  // ── CHART OF ACCOUNTS ─────────────────────────────────────
  async function renderCOA(el) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('*')
      .in('store_id', storeIds)
      .order('code')

    const types = ['asset','liability','equity','revenue','expense']
    const typeLabels = {
      asset:'Assets', liability:'Liabilities',
      equity:'Equity', revenue:'Revenue', expense:'Expenses'
    }
    const typeColors = {
      asset:'var(--accent)', liability:'var(--danger)',
      equity:'var(--dark)', revenue:'#22c55e', expense:'var(--warning)'
    }

    el.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <div style="font-weight:700">Chart of Accounts</div>
          <button class="btn btn-primary btn-sm" id="btn-add-account">+ Add Account</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account Name</th>
                <th>Type</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              ${types.map(type => {
                const group = (accounts||[]).filter(a => a.type === type && !a.code.endsWith('000'))
                if (!group.length) return ''
                return `
                  <tr style="background:var(--bg-light)">
                    <td colspan="4" style="font-weight:700;font-size:12px;letter-spacing:1px;color:${typeColors[type]}">
                      ${typeLabels[type].toUpperCase()}
                    </td>
                  </tr>
                  ${group.map(a => `
                    <tr>
                      <td style="font-family:monospace;color:var(--muted)">${a.code}</td>
                      <td style="font-weight:${a.is_system ? '500':'400'}">${a.name}</td>
                      <td><span class="badge badge-grey">${a.subtype || a.type}</span></td>
                      <td style="font-weight:600;color:${Number(a.balance) >= 0 ? typeColors[type] : 'var(--danger)'}">
                        ${fmt(a.balance)} ETB
                      </td>
                    </tr>
                  `).join('')}
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  // ── GENERAL LEDGER ────────────────────────────────────────
  async function renderLedger(el) {
    el.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
          <input type="date" class="form-input" id="gl-from" value="${monthStart}" style="max-width:160px">
          <span style="color:var(--muted)">to</span>
          <input type="date" class="form-input" id="gl-to" value="${today}" style="max-width:160px">
          <select class="form-input" id="gl-account" style="max-width:220px">
            <option value="">All Accounts</option>
          </select>
          <button class="btn btn-primary btn-sm" id="gl-run">Load</button>
        </div>
      </div>
      <div id="gl-body"></div>
    `

    // Load accounts for filter
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code, name')
      .in('store_id', storeIds)
      .order('code')

    const sel = el.querySelector('#gl-account')
    sel.innerHTML += (accounts||[]).map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')

    el.querySelector('#gl-run').addEventListener('click', async () => {
      const from      = el.querySelector('#gl-from').value
      const to        = el.querySelector('#gl-to').value
      const accountId = el.querySelector('#gl-account').value
      const body      = el.querySelector('#gl-body')

      body.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>`

      let query = supabase
        .from('journal_lines')
        .select(`
          debit, credit, description,
          accounts(code, name, type),
          journal_entries!inner(entry_date, description, reference_type)
        `)
        .in('journal_entries.store_id', storeIds)
        .gte('journal_entries.entry_date', from)
        .lte('journal_entries.entry_date', to)
        .order('journal_entries.entry_date', { ascending: true })

      if (accountId) query = query.eq('account_id', accountId)

      const { data: lines } = await query

      if (!lines || lines.length === 0) {
        body.innerHTML = `<div class="empty"><div class="empty-text">No journal entries in this period</div></div>`
        return
      }

      let runningBalance = 0
      body.innerHTML = `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                ${lines.map(l => `
                  <tr>
                    <td>${l.journal_entries?.entry_date}</td>
                    <td>${l.description || l.journal_entries?.description || '—'}</td>
                    <td style="font-family:monospace;font-size:12px">
                      ${l.accounts?.code} — ${l.accounts?.name}
                    </td>
                    <td style="color:var(--dark);font-weight:${l.debit > 0 ? '600':'400'}">
                      ${l.debit > 0 ? fmt(l.debit) : '—'}
                    </td>
                    <td style="color:var(--muted);font-weight:${l.credit > 0 ? '600':'400'}">
                      ${l.credit > 0 ? fmt(l.credit) : '—'}
                    </td>
                    <td><span class="badge badge-grey" style="font-size:10px">${l.journal_entries?.reference_type || 'manual'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `
    })
  }

  // ── VAT SUMMARY ───────────────────────────────────────────
  async function renderVAT(el) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('name, balance, code')
      .in('store_id', storeIds)
      .in('code', ['2010','1030'])

    const vatPayable      = (accounts||[]).find(a => a.code === '2010')
    const vatReceivable   = (accounts||[]).find(a => a.code === '1030')
    const vatOwed         = Number(vatPayable?.balance || 0) - Number(vatReceivable?.balance || 0)

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
        <div class="kpi-card">
          <div class="kpi-label">VAT Collected (Sales)</div>
          <div class="kpi-value" style="color:var(--danger)">${fmt(vatPayable?.balance || 0)}</div>
          <div class="kpi-sub">ETB payable to tax authority</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">VAT Paid (Purchases)</div>
          <div class="kpi-value accent">${fmt(vatReceivable?.balance || 0)}</div>
          <div class="kpi-sub">ETB reclaimable</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Net VAT Owed</div>
          <div class="kpi-value" style="color:${vatOwed >= 0 ? 'var(--danger)':'var(--accent)'}">
            ${fmt(vatOwed)}
          </div>
          <div class="kpi-sub">ETB ${vatOwed >= 0 ? 'to pay' : 'refundable'}</div>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:0.75rem">VAT Rate</div>
        <div style="font-size:13.5px;color:var(--muted)">
          Ethiopian standard VAT rate: <strong style="color:var(--dark)">15%</strong>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-top:0.5rem">
          VAT is automatically calculated on sales and purchases when the journal entries are posted.
          To enable VAT on a sale, pass vatRate: 0.15 to postSaleEntry().
        </div>
      </div>
    `
  }

  await loadTab()
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-ET', { minimumFractionDigits:2, maximumFractionDigits:2 })
}