import { supabase } from '../supabase.js'
import { appStore } from '../store.js'

const CACHE = {}

// ── Save a pattern ────────────────────────────────────────────
export async function savePattern(key, data) {
  const { currentStore } = appStore.getState()
  if (!currentStore?.id) return

  // Merge with existing
  const existing = await getPattern(key)
  const merged   = deepMerge(existing || {}, data)

  CACHE[key] = merged

  await supabase.from('user_patterns').upsert({
    store_id:     currentStore.id,
    pattern_key:  key,
    pattern_data: merged,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'store_id,pattern_key' })
}

// ── Get a pattern ─────────────────────────────────────────────
export async function getPattern(key) {
  if (CACHE[key]) return CACHE[key]

  const { currentStore } = appStore.getState()
  if (!currentStore?.id) return null

  const { data } = await supabase
    .from('user_patterns')
    .select('pattern_data')
    .eq('store_id', currentStore.id)
    .eq('pattern_key', key)
    .single()

  if (data?.pattern_data) {
    CACHE[key] = data.pattern_data
    return data.pattern_data
  }
  return null
}

// ── Learn from a completed OCR session ───────────────────────
export async function learnFromSession(sessionData) {
  const { destination, lineItems, paymentMethod, extraFields } = sessionData

  // 1. Track which columns were used and in what order
  const usedColumns = lineItems
    .flatMap(item => Object.keys(item).filter(k => item[k] !== null && item[k] !== ''))

  const columnFreq = {}
  usedColumns.forEach(col => { columnFreq[col] = (columnFreq[col] || 0) + 1 })

  await savePattern(`${destination}_columns`, {
    columns:   [...new Set(usedColumns)],
    frequency: columnFreq,
    lastUsed:  new Date().toISOString(),
  })

  // 2. Track payment method preference
  if (paymentMethod) {
    const payPattern = await getPattern('payment_preferences') || {}
    payPattern[paymentMethod] = (payPattern[paymentMethod] || 0) + 1
    await savePattern('payment_preferences', payPattern)
  }

  // 3. Track extra fields used
  if (extraFields && Object.keys(extraFields).length > 0) {
    await savePattern('extra_fields_used', {
      fields:  Object.keys(extraFields),
      lastUsed: new Date().toISOString(),
    })
  }

  // 4. Track row count preference per destination
  await savePattern(`${destination}_row_count`, {
    lastCount: lineItems.length,
    avgCount:  lineItems.length, // will be averaged over time
  })

  // Invalidate cache
  Object.keys(CACHE).forEach(k => delete CACHE[k])
}

// ── Get preferred payment method ──────────────────────────────
export async function getPreferredPayment() {
  const prefs = await getPattern('payment_preferences')
  if (!prefs) return 'cash'
  return Object.entries(prefs).sort((a,b) => b[1] - a[1])[0]?.[0] || 'cash'
}

// ── Get learned columns for destination ───────────────────────
export async function getLearnedColumns(destination) {
  return await getPattern(`${destination}_columns`)
}

// ── Deep merge helper ─────────────────────────────────────────
function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
      result[key] = deepMerge(result[key] || {}, source[key])
    } else if (typeof source[key] === 'number' && typeof result[key] === 'number') {
      // Average numbers (for counts/frequencies)
      result[key] = Math.round((result[key] + source[key]) / 2)
    } else {
      result[key] = source[key]
    }
  }
  return result
}