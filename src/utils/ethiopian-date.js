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
  'መስከ', 'ጥቅምት', 'ኅዳር', 'ታኅሣ', 'ጥር', 'የካቲ',
  'መጋቢ', 'ሚያዚ', 'ግንቦ', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉ'
]

const ET_DAYS = ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'አርብ', 'ቅዳሜ']

/**
 * Convert a Gregorian date to Ethiopian calendar.
 * @param {Date|string} date — JS Date or ISO string
 * @returns {{ year:number, month:number, day:number, monthName:string, dayName:string }}
 */
export function toEthiopian(date) {
  const d = date instanceof Date ? date : new Date(date)
  const jdn = gregorianToJDN(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return jdnToEthiopian(jdn)
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
  const { showDay = false, short = false } = opts
  const et = toEthiopian(date)
  const monthLabel = short ? ET_MONTHS_SHORT[et.month - 1] : ET_MONTHS[et.month - 1]
  const parts = []
  if (showDay) parts.push(et.dayName + '፣')
  parts.push(monthLabel, `${et.day} ቀን`, `${et.year} ዓ.ም`)
  return parts.join(' ')
}

// ── Internal helpers ────────────────────────────────────────────

function gregorianToJDN(y, m, d) {
  return Math.floor((1461 * (y + 4800 + Math.floor((m - 14) / 12))) / 4)
    + Math.floor((367 * (m - 2 - 12 * Math.floor((m - 14) / 12))) / 12)
    - Math.floor((3 * Math.floor((y + 4900 + Math.floor((m - 14) / 12)) / 100)) / 4)
    + d - 32075
}

function jdnToEthiopian(jdn) {
  const r = (jdn - 1723856) % 1461
  const n = r % 365 + 365 * Math.floor(r / 1460)
  const year = 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460)
  const month = Math.floor(n / 30) + 1
  const day = n % 30 + 1
  const jsDate = jdnToGregorian(jdn)
  const dayName = ET_DAYS[jsDate.getDay()]
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
