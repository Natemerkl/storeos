import { supabase } from '../supabase.js'

// ── Get account by code for a store ──────────────────────────
async function getAccount(storeId, code) {
  const { data } = await supabase
    .from('accounts')
    .select('id, code, name, type, balance')
    .eq('store_id', storeId)
    .eq('code', code)
    .single()
  return data
}

// ── Post a journal entry ──────────────────────────────────────
export async function postJournalEntry({
  storeId,
  date,
  description,
  referenceType,
  referenceId,
  lines,   // [{ accountCode, debit, credit, description }]
}) {
  // Validate: debits must equal credits
  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry unbalanced: DR ${totalDebit} ≠ CR ${totalCredit}`)
  }

  // Create journal entry
  const { data: entry, error: entryErr } = await supabase
    .from('journal_entries')
    .insert({
      store_id:       storeId,
      entry_date:     date,
      description,
      reference_type: referenceType,
      reference_id:   referenceId,
      is_posted:      true,
    })
    .select()
    .single()

  if (entryErr) throw entryErr

  // Resolve account codes to IDs
  const journalLines = []
  for (const line of lines) {
    const account = await getAccount(storeId, line.accountCode)
    if (!account) throw new Error(`Account ${line.accountCode} not found`)
    journalLines.push({
      entry_id:    entry.id,
      account_id:  account.id,
      debit:       Number(line.debit)  || 0,
      credit:      Number(line.credit) || 0,
      description: line.description || null,
    })
  }

  const { error: linesErr } = await supabase
    .from('journal_lines')
    .insert(journalLines)

  if (linesErr) throw linesErr
  return entry
}

// ── SALE: Cash DR / Revenue CR / VAT Payable CR ──────────────
export async function postSaleEntry({ storeId, saleId, date, amount, isCredit = false, vatRate = 0 }) {
  const vatAmount   = vatRate > 0 ? amount - (amount / (1 + vatRate)) : 0
  const netRevenue  = amount - vatAmount

  const lines = []

  if (isCredit) {
    // Credit sale: Accounts Receivable DR / Revenue CR
    lines.push({ accountCode:'1010', debit: amount,     credit: 0,          description:'Credit sale receivable' })
    lines.push({ accountCode:'4001', debit: 0,          credit: netRevenue, description:'Sales revenue' })
    if (vatAmount > 0.01) {
      lines.push({ accountCode:'2010', debit: 0, credit: vatAmount, description:'VAT on sale' })
    }
  } else {
    // Cash sale: Cash DR / Revenue CR
    lines.push({ accountCode:'1001', debit: amount,     credit: 0,          description:'Cash received from sale' })
    lines.push({ accountCode:'4001', debit: 0,          credit: netRevenue, description:'Sales revenue' })
    if (vatAmount > 0.01) {
      lines.push({ accountCode:'2010', debit: 0, credit: vatAmount, description:'VAT on sale' })
    }
  }

  return postJournalEntry({
    storeId,
    date,
    description:   `Sale recorded`,
    referenceType: 'sale',
    referenceId:   saleId,
    lines,
  })
}

// ── EXPENSE: Expense DR / Cash CR ────────────────────────────
export async function postExpenseEntry({ storeId, expenseId, date, amount, category, vatRate = 0 }) {
  const vatAmount  = vatRate > 0 ? amount - (amount / (1 + vatRate)) : 0
  const netExpense = amount - vatAmount

  // Map category to account code
  const categoryMap = {
    'rent':       '6001',
    'utilities':  '6002',
    'salary':     '6003',
    'salaries':   '6003',
    'transport':  '6004',
    'supplies':   '6005',
    'purchase':   '5001',
    'purchases':  '5001',
  }
  const expenseCode = categoryMap[(category || '').toLowerCase()] || '6099'

  const lines = [
    { accountCode: expenseCode, debit: netExpense, credit: 0, description: category || 'Expense' },
    { accountCode: '1001',      debit: 0, credit: amount,      description: 'Cash payment' },
  ]

  if (vatAmount > 0.01) {
    lines.push({ accountCode:'1030', debit: vatAmount, credit: 0, description:'VAT on purchase' })
    lines[1].credit = netExpense // adjust cash to net
  }

  return postJournalEntry({
    storeId,
    date,
    description:   `Expense: ${category || 'General'}`,
    referenceType: 'expense',
    referenceId:   expenseId,
    lines,
  })
}

// ── CASH TRANSFER: Account DR / Account CR ───────────────────
export async function postTransferEntry({ storeId, transferId, date, amount, fromType, toType }) {
  const fromCode = fromType === 'till' ? '1001' : '1002'
  const toCode   = toType   === 'till' ? '1001' : '1002'

  return postJournalEntry({
    storeId,
    date,
    description:   'Cash transfer between accounts',
    referenceType: 'transfer',
    referenceId:   transferId,
    lines: [
      { accountCode: toCode,   debit: amount, credit: 0,      description: 'Transfer in' },
      { accountCode: fromCode, debit: 0,      credit: amount, description: 'Transfer out' },
    ],
  })
}

// ── CREDIT PAYMENT RECEIVED: Cash DR / Receivable CR ─────────
export async function postCreditPaymentEntry({ storeId, creditId, date, amount }) {
  return postJournalEntry({
    storeId,
    date,
    description:   'Credit payment received',
    referenceType: 'credit_payment',
    referenceId:   creditId,
    lines: [
      { accountCode:'1001', debit: amount, credit: 0,      description:'Cash received' },
      { accountCode:'1010', debit: 0,      credit: amount, description:'Receivable cleared' },
    ],
  })
}

// ── VENDOR PAYMENT: Payable DR / Cash CR ─────────────────────
export async function postVendorPaymentEntry({ storeId, debtId, date, amount }) {
  return postJournalEntry({
    storeId,
    date,
    description:   'Vendor payment made',
    referenceType: 'vendor_payment',
    referenceId:   debtId,
    lines: [
      { accountCode:'2001', debit: amount, credit: 0,      description:'Payable settled' },
      { accountCode:'1001', debit: 0,      credit: amount, description:'Cash paid to vendor' },
    ],
  })
}

// ── INVENTORY PURCHASE: Inventory DR / Cash or Payable CR ────
export async function postInventoryEntry({ storeId, itemId, date, amount, onCredit = false }) {
  return postJournalEntry({
    storeId,
    date,
    description:   'Inventory purchase',
    referenceType: 'inventory',
    referenceId:   itemId,
    lines: [
      { accountCode:'1020', debit: amount, credit: 0,      description:'Inventory added' },
      { accountCode: onCredit ? '2001' : '1001', debit: 0, credit: amount, description: onCredit ? 'Payable to vendor' : 'Cash paid' },
    ],
  })
}

// ── DERIVED P&L (Option B — fast) ─────────────────────────────
export async function computePandL(storeIds, from, to) {
  const [{ data: sales }, { data: expenses }] = await Promise.all([
    supabase.from('sales').select('total_amount, payment_method').in('store_id', storeIds).gte('sale_date', from).lte('sale_date', to),
    supabase.from('expenses').select('amount, category').in('store_id', storeIds).gte('expense_date', from).lte('expense_date', to),
  ])

  const totalRevenue  = (sales||[]).reduce((s, r) => s + Number(r.total_amount), 0)
  const totalExpenses = (expenses||[]).reduce((s, r) => s + Number(r.amount), 0)
  const grossProfit   = totalRevenue - totalExpenses

  // Group expenses by category
  const expenseGroups = {}
  ;(expenses||[]).forEach(e => {
    const cat = e.category || 'Miscellaneous'
    expenseGroups[cat] = (expenseGroups[cat] || 0) + Number(e.amount)
  })

  return {
    revenue:       totalRevenue,
    expenses:      totalExpenses,
    grossProfit,
    netProfit:     grossProfit,
    expenseGroups,
    margin:        totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
  }
}

// ── DERIVED BALANCE SHEET (Option B — fast) ───────────────────
export async function computeBalanceSheet(storeIds) {
  const [
    { data: cashAccounts },
    { data: inventory },
    { data: creditSales },
    { data: vendorDebts },
  ] = await Promise.all([
    supabase.from('cash_accounts').select('name, balance, account_type').in('store_id', storeIds),
    supabase.from('inventory_items').select('quantity, unit_cost').in('store_id', storeIds),
    supabase.from('credit_sales').select('amount_owed, amount_paid, status').in('store_id', storeIds).neq('status','paid'),
    supabase.from('vendor_debts').select('amount_owed, amount_paid, status').in('store_id', storeIds).neq('status','paid'),
  ])

  const cash        = (cashAccounts||[]).reduce((s, a) => s + Number(a.balance), 0)
  const invValue    = (inventory||[]).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost||0), 0)
  const receivables = (creditSales||[]).reduce((s, c) => s + Number(c.amount_owed) - Number(c.amount_paid), 0)
  const payables    = (vendorDebts||[]).reduce((s, d) => s + Number(d.amount_owed) - Number(d.amount_paid), 0)

  const totalAssets      = cash + invValue + receivables
  const totalLiabilities = payables
  const equity           = totalAssets - totalLiabilities

  return {
    assets: {
      cash,
      inventory: invValue,
      receivables,
      total: totalAssets,
    },
    liabilities: {
      payables,
      total: totalLiabilities,
    },
    equity,
  }
}

// ── FULL GL-BASED P&L (Option A — from journal) ───────────────
export async function computePandLFromLedger(storeIds, from, to) {
  const { data: lines } = await supabase
    .from('journal_lines')
    .select(`
      debit, credit,
      accounts!inner(code, name, type, subtype),
      journal_entries!inner(entry_date, store_id)
    `)
    .in('journal_entries.store_id', storeIds)
    .gte('journal_entries.entry_date', from)
    .lte('journal_entries.entry_date', to)

  const revenue  = {}
  const expenses = {}

  ;(lines||[]).forEach(line => {
    const acc  = line.accounts
    const type = acc?.type

    if (type === 'revenue') {
      const key = acc.name
      if (!revenue[key]) revenue[key] = 0
      // Revenue increases on credit
      revenue[key] += Number(line.credit) - Number(line.debit)
    }

    if (type === 'expense') {
      const key = acc.name
      if (!expenses[key]) expenses[key] = 0
      // Expense increases on debit
      expenses[key] += Number(line.debit) - Number(line.credit)
    }
  })

  const totalRevenue  = Object.values(revenue).reduce((s, v) => s + v, 0)
  const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0)

  return {
    revenue,
    expenses,
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    margin:    totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0,
  }
}