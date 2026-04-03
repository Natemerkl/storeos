// @ts-ignore: Deno URL imports are resolved at runtime, not by the VS Code TS server
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Deno global — available at runtime in Supabase Edge Functions
declare const Deno: { env: { get(key: string): string | undefined } }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Google Auth ───────────────────────────────────────────────────────────────

async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT" }
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")

  const signingInput = `${encode(header)}.${encode(payload)}`

  const pemContents = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "")

  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  )

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")

  const jwt = `${signingInput}.${sigB64}`

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface WordToken {
  text: string
  x: number
  y: number
}

interface Row {
  y: number
  words: WordToken[]
  text: string
}

// Parse Ethiopian amounts: "35,000" → 35000, "3,500" → 3500
function parseAmount(s: string): number {
  if (!s) return 0
  return parseFloat(s.replace(/,/g, "")) || 0
}

// Is a token a pure number (with optional Ethiopian thousands comma)?
function isNumeric(s: string): boolean {
  return /^[\d,]+(\.\d+)?$/.test(s.trim())
}

// ── Step 1: Spatial row reconstruction ───────────────────────────────────────
// Groups Vision API word tokens by Y-coordinate proximity into rows,
// then sorts words within each row by X (left → right).

function groupIntoRows(wordAnnotations: any[], yTolerance = 15): Row[] {
  const tokens: WordToken[] = wordAnnotations
    .filter(w => w.description && w.boundingPoly?.vertices?.length >= 4)
    .map(w => ({
      text: w.description as string,
      x: (w.boundingPoly.vertices[0].x as number) || 0,
      y: (w.boundingPoly.vertices[0].y as number) || 0,
    }))
    .sort((a, b) => a.y - b.y)

  const rows: Row[] = []

  for (const token of tokens) {
    const existing = rows.find(r => Math.abs(r.y - token.y) <= yTolerance)
    if (existing) {
      existing.words.push(token)
    } else {
      rows.push({ y: token.y, words: [token], text: "" })
    }
  }

  // Sort words left→right within each row, rows top→bottom
  for (const row of rows) {
    row.words.sort((a, b) => a.x - b.x)
    row.text = row.words.map(w => w.text).join(" ")
  }
  rows.sort((a, b) => a.y - b.y)

  return rows
}

// Post-processor: merge all-numeric orphan rows into the nearest preceding row.
// Handwritten receipts often place price/total columns slightly lower on the page
// than the product name, causing the spatial grouper to split one item across two rows.
// e.g. ["Klonze", "10"] row + ["3500", "35,000"] row → ["Klonze", "10", "3500", "35,000"]
function mergeOrphanNumericRows(rows: Row[], maxYGap = 35): Row[] {
  const result: Row[] = []

  for (let i = 0; i < rows.length; i++) {
    const row       = rows[i]
    const allNumeric = row.words.length > 0 && row.words.every(w => isNumeric(w.text))

    if (allNumeric && result.length > 0) {
      const prev      = result[result.length - 1]
      const yDiff     = Math.abs(row.y - prev.y)
      const prevNums  = prev.words.filter(w => isNumeric(w.text)).length
      // Guard: never merge into a customer/targa row.
      // A targa row has exactly 1 numeric (4-6 digits) flanked by text on both sides.
      const prevOnlyNum = prev.words.filter(w => isNumeric(w.text))
      const isTargaRow  = prevNums === 1 &&
        /^\d{4,6}$/.test(prevOnlyNum[0]?.text || "") &&
        !isNumeric(prev.words[0]?.text || "") &&
        !isNumeric(prev.words[prev.words.length - 1]?.text || "")
      if (!isTargaRow && (yDiff <= maxYGap || prevNums < 2)) {
        prev.words = [...prev.words, ...row.words].sort((a, b) => a.x - b.x)
        prev.text  = prev.words.map(w => w.text).join(" ")
        continue
      }
    }

    result.push({ y: row.y, words: [...row.words], text: row.text })
  }

  return result
}

// Fallback: build rows from plain text lines when no bounding boxes available
function rowsFromPlainText(fullText: string): Row[] {
  return fullText
    .split("\n")
    .map((l, i) => l.trim())
    .filter(l => l.length > 0)
    .map((line, idx) => {
      const words: WordToken[] = line.split(/\s+/).map((w, x) => ({
        text: w, x: x * 60, y: idx * 20,
      }))
      return { y: idx * 20, words, text: line }
    })
}

// ── Step 2: Customer header extraction ───────────────────────────────────────
// Finds the label row ("Name targ Place"), then reads the data row below it.

const CUSTOMER_LABEL_KEYWORDS = ["name", "targ", "place", "nom", "customer", "client"]

function extractCustomerHeader(rows: Row[]): {
  name: string | null; targa: string | null; place: string | null
} {
  // Strategy 1: Find label row ("Name targ Place") then look ahead up to 5 rows
  for (let i = 0; i < rows.length - 1; i++) {
    const lower = rows[i].text.toLowerCase()
    const labelHits = CUSTOMER_LABEL_KEYWORDS.filter(kw => lower.includes(kw)).length
    if (labelHits >= 2) {
      for (let j = i + 1; j <= Math.min(i + 5, rows.length - 1); j++) {
        const tokens = rows[j].words.map(w => w.text)
        const targaIdx = tokens.findIndex(t => /^\d{4,6}$/.test(t))
        if (targaIdx > 0) {
          return {
            name:  tokens.slice(0, targaIdx).join(" ").trim() || null,
            targa: tokens[targaIdx],
            place: tokens.slice(targaIdx + 1).join(" ").trim() || null,
          }
        }
      }
    }
  }

  // Strategy 2: Find any row matching [text+] [4-6 digit targa] [text+] with exactly 1 numeric
  // This handles OCR misreads of the label row and non-standard receipt layouts
  for (const row of rows) {
    const tokens  = row.words.map(w => w.text)
    const lower   = row.text.toLowerCase()
    // Must not be an item header row
    if (ITEM_HEADER_KEYWORDS.filter(kw => lower.includes(kw)).length >= 2) continue
    // Must not be a skip-keyword row
    if (ITEM_SKIP_KEYWORDS.some(kw => lower.includes(kw))) continue

    const numericTokens = tokens.filter(t => isNumeric(t))
    const textTokens    = tokens.filter(t => !isNumeric(t))

    // Pattern: exactly 1 numeric (the targa) flanked by text on both sides
    if (numericTokens.length === 1 && textTokens.length >= 2) {
      const targaIdx = tokens.findIndex(t => /^\d{4,6}$/.test(t))
      if (targaIdx > 0 && targaIdx < tokens.length - 1) {
        return {
          name:  tokens.slice(0, targaIdx).join(" ").trim() || null,
          targa: tokens[targaIdx],
          place: tokens.slice(targaIdx + 1).join(" ").trim() || null,
        }
      }
    }
  }

  return { name: null, targa: null, place: null }
}

// ── Step 3: Line item extraction ─────────────────────────────────────────────
// Detects the column-header row ("Item Quantity Price Total"), then parses
// subsequent rows that contain 2+ numeric tokens as line items.
// Validates column order with: qty × price ≈ total cross-check.

const ITEM_HEADER_KEYWORDS = ["item", "quantity", "price", "total", "qty", "amount", "product", "description"]
const ITEM_SKIP_KEYWORDS   = ["wezader", "wezader", "transport", "total", "grand", "subtotal", "sum",
                               "name", "targ", "place", "delivery", "ወዘደር"]

function extractLineItems(rows: Row[], manualColumnOrder?: string[]): {
  items: any[]; headerRowIdx: number
} {
  // Find column header row (≥2 header keywords)
  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].text.toLowerCase()
    if (ITEM_HEADER_KEYWORDS.filter(kw => lower.includes(kw)).length >= 2) {
      headerRowIdx = i
      break
    }
  }

  const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0
  const items: any[] = []

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i]
    const tokens = row.words.map(w => w.text)
    const lower = row.text.toLowerCase()

    // Skip summary / transport / header rows
    if (ITEM_SKIP_KEYWORDS.some(kw => lower.includes(kw))) continue

    // Collect numeric and text tokens
    const numericTokens: Array<{ value: number; idx: number }> = []
    const leadingText: string[] = []
    let seenNumber = false

    for (let t = 0; t < tokens.length; t++) {
      if (isNumeric(tokens[t])) {
        seenNumber = true
        numericTokens.push({ value: parseAmount(tokens[t]), idx: t })
      } else if (!seenNumber) {
        leadingText.push(tokens[t])
      }
    }

    // Need at least 2 numerics to qualify as a line item
    if (numericTokens.length < 2) continue

    let description: string
    let quantity: number
    let unit_price: number
    let total: number

    if (manualColumnOrder && manualColumnOrder.length > 0) {
      // Use user-corrected column assignments
      const assigned: Record<string, string> = {}
      tokens.forEach((t, idx) => {
        const colType = manualColumnOrder[idx]
        if (colType && colType !== "ignore") assigned[colType] = t
      })
      description = assigned["name"] || assigned["description"] || leadingText.join(" ")
      quantity    = parseAmount(assigned["qty"] || assigned["quantity"] || "1")
      unit_price  = parseAmount(assigned["price"] || assigned["unit_price"] || "0")
      total       = parseAmount(assigned["amount"] || assigned["total"] || "0")
    } else {
      description = leadingText.join(" ").trim()

      if (numericTokens.length >= 3) {
        const n0 = numericTokens[0].value
        const n1 = numericTokens[1].value
        const n2 = numericTokens[numericTokens.length - 1].value

        // Cross-check: qty × price ≈ total  (within 5% rounding tolerance)
        const crossCheck = (q: number, p: number, tot: number) =>
          tot > 0 && Math.abs(q * p - tot) / tot < 0.05

        if (crossCheck(n0, n1, n2)) {
          quantity = n0; unit_price = n1; total = n2
        } else if (crossCheck(n1, n0, n2)) {
          quantity = n1; unit_price = n0; total = n2
        } else {
          // Fallback: first = qty, second = price, last = total
          quantity = n0; unit_price = n1; total = n2
        }
      } else {
        // 2 numbers: assume [price, total] with qty = 1
        quantity   = 1
        unit_price = numericTokens[0].value
        total      = numericTokens[1].value
      }
    }

    if (description || unit_price > 0 || total > 0) {
      items.push({ description, quantity, unit_price, total })
    }
  }

  return { items, headerRowIdx }
}

// ── Step 4: Transport / Wezader extraction ────────────────────────────────────

const TRANSPORT_KEYWORDS = [
  "wezader", "wezader", "transport", "delivery", "driver",
  "ወዘደር", "ዊዘደር", "ወዘደር", "wezader", "wezider",
]

function extractTransport(rows: Row[]): {
  amount: number | null; worker_note: string; detected: boolean
} {
  for (const row of rows) {
    const lower = row.text.toLowerCase()
    if (TRANSPORT_KEYWORDS.some(kw => lower.includes(kw))) {
      const tokens = row.words.map(w => w.text)
      const numerics  = tokens.filter(t => isNumeric(t))
      const nonNumerics = tokens.filter(t =>
        !isNumeric(t) && !TRANSPORT_KEYWORDS.some(kw => t.toLowerCase().includes(kw))
      )
      const amount = numerics.length > 0
        ? parseAmount(numerics[numerics.length - 1])
        : null
      return {
        amount,
        worker_note: nonNumerics.join(" ").trim(),
        detected: true,
      }
    }
  }
  return { amount: null, worker_note: "", detected: false }
}

// ── Step 5: Payment bank detection ───────────────────────────────────────────
// Scans the bottom rows for arrow notation (→ CBE) or known Ethiopian bank names.

const BANK_ALIASES: Array<[string, string]> = [
  ["cbe birr", "CBE Birr"],
  ["commercial bank", "CBE"],
  ["cbe", "CBE"],
  ["telebirr", "Telebirr"],
  ["awash", "Awash"],
  ["abyssinia", "Abyssinia"],
  ["boa", "Abyssinia"],
  ["dashen", "Dashen"],
  ["wegagen", "Wegagen"],
  ["nib", "NIB"],
  ["united", "United"],
  ["oromia", "Oromia"],
  ["berhan", "Berhan"],
  ["bunna", "Bunna"],
  ["zemen", "Zemen"],
  ["cooperative", "Cooperative"],
  ["enat", "Enat"],
]

function extractPaymentBank(rows: Row[]): string | null {
  const bottomRows = rows.slice(-6)
  for (const row of bottomRows) {
    const lower = row.text.toLowerCase()
    for (const [key, label] of BANK_ALIASES) {
      if (lower.includes(key)) return label
    }
  }
  return null
}

// ── Step 6: Column detection for correction modal ────────────────────────────

function buildColumnDetection(rows: Row[], headerRowIdx: number): { columns: any[] } {
  // Scan forward from the header row looking for the first genuine item data row:
  // must have ≥2 numeric tokens and must not match skip keywords (transport, totals, etc.)
  const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0
  let firstDataRow: Row | undefined

  for (let i = startIdx; i < rows.length; i++) {
    const row   = rows[i]
    const lower = row.text.toLowerCase()
    if (ITEM_SKIP_KEYWORDS.some(kw => lower.includes(kw))) continue
    if (row.words.filter(w => isNumeric(w.text)).length >= 2) {
      firstDataRow = row
      break
    }
  }

  // Fallback: any row with ≥2 numerics anywhere in the document
  if (!firstDataRow) {
    firstDataRow = rows.find(r => r.words.filter(w => isNumeric(w.text)).length >= 2)
  }

  if (!firstDataRow) return { columns: [] }

  const tokens = firstDataRow.words.map(w => w.text)
  const columns: any[] = []
  let nameAdded    = false
  let numericCount = 0

  for (let i = 0; i < tokens.length; i++) {
    const sample = tokens[i]
    let type: string
    if (!isNumeric(sample)) {
      type = nameAdded ? "description" : "name"
      nameAdded = true
    } else {
      type = numericCount === 0 ? "qty" : numericCount === 1 ? "price" : "amount"
      numericCount++
    }
    columns.push({ index: i, type, sample })
  }

  return { columns }
}

// ── Step 7: Grand total detection ────────────────────────────────────────────

function findGrandTotal(rows: Row[]): number {
  const TOTAL_KEYS = ["total", "grand total", "sum", "amount due", "net"]

  // Prefer bottom-up search
  for (let i = rows.length - 1; i >= 0; i--) {
    const lower = rows[i].text.toLowerCase()
    if (TOTAL_KEYS.some(k => lower.includes(k))) {
      const nums = rows[i].words.filter(w => isNumeric(w.text))
      if (nums.length > 0) return parseAmount(nums[nums.length - 1].text)
    }
  }
  // Fallback: largest number in bottom 4 rows
  const bottomNums: number[] = []
  for (const row of rows.slice(-4)) {
    for (const w of row.words) {
      if (isNumeric(w.text)) bottomNums.push(parseAmount(w.text))
    }
  }
  return bottomNums.length > 0 ? Math.max(...bottomNums) : 0
}

// ── Step 8: Date detection ────────────────────────────────────────────────────

function findDate(rows: Row[]): string {
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/
  for (const row of rows) {
    const m = row.text.match(dateRegex)
    if (m) return m[1]
  }
  return ""
}

// ── Main parser ───────────────────────────────────────────────────────────────

function parseVisionResponse(response: any, manualColumnOrder?: string[]) {
  const fullText       = response.responses?.[0]?.fullTextAnnotation?.text || ""
  const allAnnotations = response.responses?.[0]?.textAnnotations || []
  // Index 0 = full document annotation; 1…N = individual word tokens
  const wordAnnotations = allAnnotations.slice(1)

  // Build spatial rows
  const rows: Row[] = mergeOrphanNumericRows(
    wordAnnotations.length > 0
      ? groupIntoRows(wordAnnotations)
      : rowsFromPlainText(fullText)
  )

  // Run all extractors
  const customerHeader              = extractCustomerHeader(rows)
  const transport                   = extractTransport(rows)
  const paymentBank                 = extractPaymentBank(rows)
  const { items: lineItems,
          headerRowIdx }            = extractLineItems(rows, manualColumnOrder)
  const columnDetection             = buildColumnDetection(rows, headerRowIdx)
  const detectedTotal               = findGrandTotal(rows)
  const date                        = findDate(rows)
  const vendor                      = rows[0]?.text || fullText.split("\n")[0] || ""

  // Validation cross-check
  const itemsTotal      = lineItems.reduce((s, i) => s + (i.total || 0), 0)
  const transportAmount = transport.amount || 0
  const calcTotal       = itemsTotal + transportAmount
  const validation = {
    items_total:      itemsTotal,
    transport_amount: transportAmount,
    detected_total:   detectedTotal || calcTotal,
    match:            detectedTotal > 0 ? Math.abs(calcTotal - detectedTotal) <= 2 : true,
  }

  return {
    raw_text:        fullText,
    raw_blocks:      allAnnotations.slice(0, 50),
    customer_header: customerHeader,
    transport:       transport,
    payment_bank:    paymentBank,
    validation,
    parsed_data: {
      vendor,
      date,
      total:           detectedTotal || calcTotal,
      line_items:      lineItems,
      column_detection: columnDetection,
    },
  }
}

// ── Edge Function handler ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { imageUrl, manual_column_order } = body
    if (!imageUrl) throw new Error("imageUrl is required")

    const serviceAccount = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "")
    const accessToken    = await getGoogleAccessToken(serviceAccount)

    const visionRes = await fetch(
      "https://vision.googleapis.com/v1/images:annotate",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          requests: [{
            image:    { source: { imageUri: imageUrl } },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          }],
        }),
      }
    )

    if (!visionRes.ok) {
      const err = await visionRes.text()
      throw new Error(`Vision API error: ${err}`)
    }

    const visionData = await visionRes.json()
    
    // Gracefully handle parsing errors
    let parsed
    try {
      parsed = parseVisionResponse(visionData, manual_column_order)
    } catch (parseError: any) {
      return new Response(JSON.stringify({
        success: false,
        error_code: 'OCR_PARSE_ERROR',
        message: "The receipt couldn't be formatted properly. Please try a clearer photo."
      }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err: any) {
    console.error("OCR proxy error:", err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
