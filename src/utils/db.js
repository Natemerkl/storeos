import { supabase } from '../supabase.js'
import { cache } from './cache.js'
import { appStore } from '../store.js'

function storeIds() {
  const { currentStore, accountingView, stores } = appStore.getState()
  return accountingView === 'joint' ? stores.map(s => s.id) : [currentStore?.id].filter(Boolean)
}

function cacheKey(name, ...parts) {
  return [name, ...storeIds(), ...parts].join(':')
}

// ── Dashboard ─────────────────────────────────────────────────
export async function getDashboardData(forceRefresh = false) {
  const key   = cacheKey('dashboard')
  const today = new Date().toISOString().split('T')[0]
  const ids   = storeIds()

  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }

  const [
    { data: accounts },
    { data: sales },
    { data: expenses },
    { data: items },
    { data: recentSales },
    { data: recentExpenses },
  ] = await Promise.all([
    supabase.from('cash_accounts').select('id,name,account_type,balance,stores(name)').in('store_id', ids),
    supabase.from('sales').select('total_amount').in('store_id', ids).eq('sale_date', today),
    supabase.from('expenses').select('amount').in('store_id', ids).eq('expense_date', today),
    supabase.from('inventory_items').select('item_name,quantity,low_stock_threshold,unit_cost,selling_price').in('store_id', ids),
    supabase.from('sales').select('id,total_amount,sale_date,created_at,payment_method').in('store_id', ids).order('created_at', { ascending: false }).limit(5),
    supabase.from('expenses').select('id,amount,description,expense_date,created_at').in('store_id', ids).order('created_at', { ascending: false }).limit(5),
  ])

  const result = {
    accounts:       accounts || [],
    todaySales:     (sales||[]).reduce((s,r) => s + Number(r.total_amount), 0),
    todayExpenses:  (expenses||[]).reduce((s,r) => s + Number(r.amount), 0),
    inventoryItems: items || [],
    recentSales:    recentSales || [],
    recentExpenses: recentExpenses || [],
  }

  cache.set(key, result, 30) // 30 second TTL
  return result
}

// ── Inventory ─────────────────────────────────────────────────
export async function getInventory(forceRefresh = false) {
  const key = cacheKey('inventory')
  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .in('store_id', storeIds())
    .order('item_name')
  const result = data || []
  cache.set(key, result, 60) // 60 second TTL
  return result
}

// ── Cash accounts ─────────────────────────────────────────────
export async function getCashAccounts(forceRefresh = false) {
  const key = cacheKey('cash_accounts')
  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }
  const { data } = await supabase
    .from('cash_accounts')
    .select('*, stores(name)')
    .in('store_id', storeIds())
    .order('account_type')
  const result = data || []
  cache.set(key, result, 60)
  return result
}

// ── Customers ─────────────────────────────────────────────────
export async function getCustomers(forceRefresh = false) {
  const key = cacheKey('customers')
  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }
  const { data } = await supabase
    .from('customers')
    .select('id,name,phone,credit_balance')
    .in('store_id', storeIds())
    .order('name')
  const result = data || []
  cache.set(key, result, 120)
  return result
}

// ── Transactions ──────────────────────────────────────────────
export async function getTransactions(forceRefresh = false) {
  const key = cacheKey('transactions')
  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }
  const [{ data: sales }, { data: expenses }] = await Promise.all([
    supabase.from('sales').select('*').in('store_id', storeIds()).order('sale_date', { ascending: false }).limit(200),
    supabase.from('expenses').select('*, cash_accounts(id,name,account_type)').in('store_id', storeIds()).order('expense_date', { ascending: false }).limit(200),
  ])
  const result = { sales: sales || [], expenses: expenses || [] }
  cache.set(key, result, 30)
  return result
}

// ── Sidebar stats (lighter version for sidebar live data) ─────
export async function getSidebarStats(forceRefresh = false) {
  const key   = cacheKey('sidebar_stats')
  const today = new Date().toISOString().split('T')[0]
  const ym    = new Date().toISOString().slice(0, 7)
  const ids   = storeIds()

  if (!forceRefresh) {
    const cached = cache.get(key)
    if (cached) return cached
  }

  const [
    { data: accounts },
    { data: sales },
    { data: expenses },
    { data: usage },
  ] = await Promise.all([
    supabase.from('cash_accounts').select('balance').in('store_id', ids),
    supabase.from('sales').select('total_amount').in('store_id', ids).eq('sale_date', today),
    supabase.from('expenses').select('amount').in('store_id', ids).eq('expense_date', today),
    supabase.from('ocr_usage').select('scan_count').in('store_id', ids).eq('year_month', ym),
  ])

  const result = {
    totalCash:  (accounts||[]).reduce((s,a) => s + Number(a.balance), 0),
    todaySales: (sales||[]).reduce((s,r) => s + Number(r.total_amount), 0),
    todayExp:   (expenses||[]).reduce((s,r) => s + Number(r.amount), 0),
    ocrScans:   (usage||[]).reduce((s,r) => s + Number(r.scan_count), 0),
  }

  cache.set(key, result, 30)
  return result
}

// ── Invalidation helpers — call after mutations ───────────────
export function invalidateAfterSale() {
  cache.invalidate(cacheKey('dashboard'))
  cache.invalidate(cacheKey('transactions'))
  cache.invalidate(cacheKey('inventory'))
  cache.invalidate(cacheKey('sidebar_stats'))
}

export function invalidateAfterExpense() {
  cache.invalidate(cacheKey('dashboard'))
  cache.invalidate(cacheKey('transactions'))
  cache.invalidate(cacheKey('sidebar_stats'))
}

export function invalidateAfterInventory() {
  cache.invalidate(cacheKey('inventory'))
  cache.invalidate(cacheKey('dashboard'))
}

export function invalidateAfterTransfer() {
  cache.invalidate(cacheKey('cash_accounts'))
  cache.invalidate(cacheKey('dashboard'))
  cache.invalidate(cacheKey('sidebar_stats'))
}

export function invalidateAll() {
  cache.invalidateAll()
}