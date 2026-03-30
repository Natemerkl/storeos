/**
 * Ethiopian Calendar (EC) Conversion Utilities
 * Supports full Amharic month names and Gregorian ↔ Ethiopian conversion.
 *
 * The Ethiopian calendar is ~7-8 years behind Gregorian and has 13 months:
 * 12 months of 30 days + Pagume (5 or 6 days in leap years).
 */

export const ET_MONTHS = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዚያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'
]

export const ET_MONTHS_SHORT = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዚያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'
]

const ET_DAYS = ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'አርብ', 'ቅዳሜ']

/**
 * Convert a Gregorian date to Ethiopian calendar.
 * @param {Date|string} date — JS Date or ISO string
 * @returns {{ year:number, month:number, day:number, monthName:string, dayName:string }}
 */
export function toEthiopian(date) {
  let d
  if (date instanceof Date) {
    d = date
  } else {
    // Parse ISO date strings (YYYY-MM-DD) in local timezone to avoid UTC shift
    const dateStr = String(date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number)
      d = new Date(year, month - 1, day)
    } else {
      d = new Date(dateStr)
    }
  }
  const jdn = gregorianToJDN(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return jdnToEthiopian(jdn, d)
}

/**
 * Convert Ethiopian date back to a JS Date (Gregorian).
 * @param {number} year
 * @param {number} month  1-indexed
 * @param {number} day
 * @returns {Date}
 */
export function fromEthiopian(year, month, day) {
  const jdn = ethiopianToJDN(year, month, day)
  return jdnToGregorian(jdn)
}

/**
 * Format a date using Ethiopian calendar with Amharic labels.
 * e.g. "ሰኞ፣ ጥቅምት 15 ቀን 2016 ዓ.ም"
 */
export function formatEthiopian(date, opts = {}) {
  const { showDay = false, showWeekday = false, short = false } = opts
  const et = toEthiopian(date)
  const monthLabel = short ? ET_MONTHS_SHORT[et.month - 1] : ET_MONTHS[et.month - 1]
  const parts = []
  
  // Support both showDay (legacy) and showWeekday (new standard)
  if (showDay || showWeekday) parts.push(et.dayName + '፣')
  
  parts.push(monthLabel, `${et.day} ቀን`, `${et.year} ዓ.ም`)
  return parts.join(' ')
}

// ── Internal helpers ────────────────────────────────────────────

function gregorianToJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12)
  const y2 = y + 4800 - a
  const m2 = m + 12 * a - 3
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + 
         Math.floor(y2 / 4) - Math.floor(y2 / 100) + 
         Math.floor(y2 / 400) - 32045
}

function jdnToEthiopian(jdn, originalDate) {
  const r = (jdn - 1723856) % 1461
  const n = r % 365 + 365 * Math.floor(r / 1460)
  const year = 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460)
  const month = Math.floor(n / 30) + 1
  const day = n % 30 + 1
  
  // Use original date for weekday to avoid timezone issues
  const dayName = ET_DAYS[originalDate.getDay()]
  return { year, month, day, monthName: ET_MONTHS[month - 1], dayName }
}

function ethiopianToJDN(year, month, day) {
  return 1723856 + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day - 1
}

function jdnToGregorian(jdn) {
  let l = jdn + 68569
  const n = Math.floor((4 * l) / 146097)
  l = l - Math.floor((146097 * n + 3) / 4)
  const i = Math.floor((4000 * (l + 1)) / 1461001)
  l = l - Math.floor((1461 * i) / 4) + 31
  const j = Math.floor((80 * l) / 2447)
  const d = l - Math.floor((2447 * j) / 80)
  l = Math.floor(j / 11)
  const m = j + 2 - 12 * l
  const y = 100 * (n - 49) + i + l
  return new Date(y, m - 1, d)
}
