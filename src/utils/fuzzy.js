// ── Levenshtein distance ──────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u1200-\u137f\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlap(query, target) {
  const qTokens = normalize(query).split(' ')
  const tTokens = normalize(target).split(' ')
  let matches = 0
  for (const qt of qTokens) {
    for (const tt of tTokens) {
      if (qt === tt || (qt.length > 2 && tt.includes(qt)) || (tt.length > 2 && qt.includes(tt))) {
        matches++; break
      }
    }
  }
  return matches / Math.max(qTokens.length, 1)
}

export function fuzzyMatch(query, items, options = {}) {
  const { key = 'item_name', limit = 5, threshold = 0.25 } = options
  if (!query || !items?.length) return []
  const nQuery = normalize(query)
  return items
    .map(item => {
      const target   = normalize(item[key] || '')
      const dist     = levenshtein(nQuery, target)
      const maxLen   = Math.max(nQuery.length, target.length, 1)
      const levScore = 1 - dist / maxLen
      const tokScore = tokenOverlap(nQuery, target)
      return { ...item, _score: levScore * 0.4 + tokScore * 0.6 }
    })
    .filter(i => i._score >= threshold)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
}

// ── Ethiopian name dictionary ─────────────────────────────────
const ETHIOPIAN_NAMES = new Set([
  'abebe','kebede','tekle','haile','girma','tadesse','alemu','tesfaye',
  'solomon','dawit','yonas','samuel','daniel','michael','yohannes',
  'tigist','hiwot','meron','selam','bethelhem','rahel','sara','helen',
  'alem','biruk','eyob','abel','natnael','nathaniel','tsehay','senait',
  'mulugeta','belay','fekadu','getachew','worku','demeke','tilahun',
  'mekonnen','ayele','negash','bekele','asefa','teshome','sisay',
  'aymen','ibrahim','mohammed','ali','omar','fatima','amina',
])

function isEthiopianName(word) {
  return ETHIOPIAN_NAMES.has(normalize(word))
}

function looksLikeName(str) {
  if (!str) return false
  const words = str.trim().split(/\s+/)
  // Must be 2 words, each 3+ chars, at least one looks Ethiopian or both capitalized
  if (words.length < 2 || words.length > 3) return false
  if (words.some(w => w.length < 2)) return false
  const hasEthiopian = words.some(w => isEthiopianName(w))
  const allAlpha     = words.every(w => /^[a-zA-Z\u1200-\u137f]+$/.test(w))
  return allAlpha && hasEthiopian
}

// ── Smart meta extractor ──────────────────────────────────────
export function extractMetaFromText(text) {
  if (!text) return {}

  const result = {}
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean)
  const usedTokens = new Set() // track what's already been assigned

  // 1. Phone — strict Ethiopian formats
  const phoneRegex = /\b(09\d{8}|07\d{8}|\+2519\d{8}|\+2517\d{8})\b/
  for (const line of lines) {
    const m = line.match(phoneRegex)
    if (m) {
      result.phone = m[1]
      usedTokens.add(m[1])
      break
    }
  }

  // 2. Plate number — must have context word OR be standalone 5-6 digit number
  // Ethiopian plates: "3-12345 AA", "AA12345", or contextual "plate 64976"
  const plateContextRegex = /(?:plate|car|vehicle|ref)[:\s#]*([a-z0-9\-]{4,12})/i
  const plateStandaloneRegex = /\b(\d{5,6})\b/
  for (const line of lines) {
    const mc = line.match(plateContextRegex)
    if (mc && !usedTokens.has(mc[1])) {
      result.plate = mc[1].toUpperCase()
      usedTokens.add(mc[1])
      break
    }
  }
  // Only use standalone number as plate if context word exists in full text
  if (!result.plate && /\b(plate|car|vehicle)\b/i.test(text)) {
    for (const line of lines) {
      const ms = line.match(plateStandaloneRegex)
      if (ms && !usedTokens.has(ms[1])) {
        result.plate = ms[1]
        usedTokens.add(ms[1])
        break
      }
    }
  }

  // 3. Customer name — only if it looks like an Ethiopian name
  // Skip vendor names (first line), skip product-like lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    // Skip lines with numbers (likely products or amounts)
    if (/\d/.test(line)) continue
    // Skip short lines
    if (line.length < 5) continue
    // Check if looks like Ethiopian name
    if (looksLikeName(line) && !usedTokens.has(line)) {
      result.customerName = line.trim()
      usedTokens.add(line)
      break
    }
  }

  // 4. Date
  const dateRegex = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/
  for (const line of lines) {
    const m = line.match(dateRegex)
    if (m) {
      const year  = m[3].length === 2 ? `20${m[3]}` : m[3]
      const month = m[1].padStart(2,'0')
      const day   = m[2].padStart(2,'0')
      result.date = `${year}-${month}-${day}`
      break
    }
  }

  // 5. Total
  const totalRegex = /(?:total|amount|grand total|birr|etb)[:\s]*(\d+(?:[.,]\d{1,2})?)/i
  for (const line of lines) {
    const m = line.match(totalRegex)
    if (m) {
      result.total = parseFloat(m[1].replace(',','.'))
      break
    }
  }

  return result
}

export function parseProductLine(line) {
  if (!line) return null
  const clean = line.trim()
  // Skip lines that are clearly not products
  if (clean.length < 2) return null
  if (/^(total|tax|change|visa|cash|thank|www|tel|phone)/i.test(clean)) return null

  const patterns = [
    /^(.+?)\s+x?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/,
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/,
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*$/,
  ]

  for (const pattern of patterns) {
    const m = clean.match(pattern)
    if (m) {
      return {
        raw:        clean,
        name:       m[1].trim(),
        quantity:   parseFloat(m[2]) || 1,
        unitPrice:  m[3] ? parseFloat(m[3]) : null,
        total:      m[3] ? parseFloat(m[2]) * parseFloat(m[3]) : null,
      }
    }
  }

  return { raw: clean, name: clean, quantity: 1, unitPrice: null, total: null }
}