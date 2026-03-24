/**
 * Unified date formatter for StoreOS.
 * Reads localStorage('storeos_date_format'):
 *   'et'  → Ethiopian calendar (Amharic)
 *   'en'  → Gregorian (default)
 */
import { formatEthiopian, toEthiopian } from './ethiopian-date.js'

export function getDateFormat() {
  return localStorage.getItem('storeos_date_format') || 'en'
}

export function setDateFormat(fmt) {
  localStorage.setItem('storeos_date_format', fmt)
}

/**
 * Format any date string or JS Date for display.
 * @param {string|Date} date
 * @param {{ short?: boolean, showDay?: boolean }} opts
 * @returns {string}
 */
export function formatDate(date, opts = {}) {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date + 'T00:00:00')
  if (isNaN(d)) return String(date)

  if (getDateFormat() === 'et') {
    return formatEthiopian(d, opts)
  }

  // Gregorian
  return d.toLocaleDateString('en-ET', {
    year:  'numeric',
    month: opts.short ? 'short' : 'long',
    day:   'numeric',
  })
}

/**
 * Get today's date as an ISO string (YYYY-MM-DD) — same regardless of calendar.
 */
export function todayISO() {
  return new Date().toISOString().split('T')[0]
}

/**
 * Format a date as a short label: "15 Oct" or "ጥቅምት 15"
 */
export function formatDateShort(date) {
  return formatDate(date, { short: true })
}

/**
 * Returns the Ethiopian year + month name for a given date, useful for headers.
 * In Gregorian mode returns "Month YYYY"
 */
export function formatMonthYear(date) {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date + 'T00:00:00')
  if (getDateFormat() === 'et') {
    const et = toEthiopian(d)
    return `${et.monthName} ${et.year} ዓ.ም`
  }
  return d.toLocaleDateString('en-ET', { month: 'long', year: 'numeric' })
}
