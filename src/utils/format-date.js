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
 * @param {{ short?: boolean, showDay?: boolean, showWeekday?: boolean }} opts
 * @returns {string}
 */
export function formatDate(date, opts = {}) {
  if (!date) return '—'
  
  // Parse date correctly - handle both Date objects and ISO strings
  let d
  if (date instanceof Date) {
    d = date
  } else {
    // For ISO date strings (YYYY-MM-DD), parse in local timezone
    const dateStr = String(date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number)
      d = new Date(year, month - 1, day)
    } else {
      d = new Date(dateStr)
    }
  }
  
  if (isNaN(d)) return String(date)

  if (getDateFormat() === 'et') {
    return formatEthiopian(d, opts)
  }

  // Gregorian
  const dateOpts = {
    year:  'numeric',
    month: opts.short ? 'short' : 'long',
    day:   'numeric',
  }
  
  if (opts.showWeekday) {
    dateOpts.weekday = opts.short ? 'short' : 'long'
  }
  
  return d.toLocaleDateString('en-ET', dateOpts)
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
 * Format a date with weekday: "Monday, March 30, 2026" or "ሰኞ፣ ጥቅምት 15 ቀን 2016 ዓ.ም"
 */
export function formatDateWithWeekday(date) {
  return formatDate(date, { showWeekday: true })
}

/**
 * Returns the Ethiopian year + month name for a given date, useful for headers.
 * In Gregorian mode returns "Month YYYY"
 */
export function formatMonthYear(date) {
  if (!date) return '—'
  
  // Parse date correctly
  let d
  if (date instanceof Date) {
    d = date
  } else {
    const dateStr = String(date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number)
      d = new Date(year, month - 1, day)
    } else {
      d = new Date(dateStr)
    }
  }
  
  if (getDateFormat() === 'et') {
    const et = toEthiopian(d)
    return `${et.monthName} ${et.year} ዓ.ም`
  }
  return d.toLocaleDateString('en-ET', { month: 'long', year: 'numeric' })
}
