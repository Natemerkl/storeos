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
  // Strip trailing punctuation/artifacts common in handwritten numbers before testing
  const clean = s.trim().replace(/[>)\.\-_]+$/, '')
  return /^[\d,]+(\.\d+)?$/.test(clean) && clean.length > 0
}

// ── Step 1: Spatial row reconstruction ───────────────────────────────────────
// Groups Vision API word tokens by Y-coordinate proximity into rows,
// then sorts words within each row by X (left → right).

function groupIntoRows(wordAnnotations: any[], yTolerance = 45): Row[] {
  // Helper to detect if a word is just pure noise/punctuation
  const isNoise = (text: string) => /^[\-\_\.\,\:\;\>\<\~]+$/.test(text.trim())

  const tokens: WordToken[] = wordAnnotations
    .filter(w => w.description && w.boundingPoly?.vertices?.length >= 4)
    // Filter out the noise tokens right away!
    .filter(w => !isNoise(w.description as string))
    .map(w => {
      const vertices = w.boundingPoly.vertices
      // Use center-Y of the bounding box instead of top-left corner
      // to handle tall capitals and slanted handwriting more robustly
      const ys = vertices.map((v: any) => v.y || 0)
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
      return {
        text: w.description as string,
        x: (vertices[0].x as number) || 0,
        y: centerY,
      }
    })
    .sort((a, b) => a.y - b.y)

  const rows: Row[] = []

  for (const token of tokens) {
    const existing = rows.find(r => Math.abs(r.y - token.y) <= yTolerance)
    if (existing) {
      existing.words.push(token)
      // Recalculate row average Y to track slant drift across the line
      existing.y = existing.words.reduce((s, w) => s + w.y, 0) / existing.words.length
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
function mergeOrphanNumericRows(rows: Row[], maxYGap = 65): Row[] {
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
  // 1. First, find where the actual line items start so we don't accidentally grab them
  let firstDataRowIdx = rows.length
  for (let i = 0; i < rows.length; i++) {
    // If a row has 2 or more numbers, it's definitely a line item, stop searching!
    const numCount = rows[i].words.filter(w => isNumeric(w.text)).length
    if (numCount >= 2) {
      firstDataRowIdx = i
      break
    }
  }

  // 2. Isolate the "Header Zone" (max the top 4 rows, but strictly BEFORE the line items)
  const headerRows = rows.slice(0, Math.min(4, firstDataRowIdx))

  // 3. Pool EVERY single word from the header zone into one flat array left-to-right, top-to-bottom
  const headerTokens = headerRows.flatMap(r => r.words.map(w => w.text))

  // 4. Scan the pool to find the Targa
  let targaIdx = -1
  let cleanTarga = ""
  
  for (let i = 0; i < headerTokens.length; i++) {
    // Clean trailing squiggles or dots from handwriting before testing
    const cleanStr = headerTokens[i].trim().replace(/[\>\)\.\-\_]+$/, '')
    
    // If it's exactly 4 to 6 digits, we found our Targa!
    if (/^\d{4,6}$/.test(cleanStr)) {
      targaIdx = i
      cleanTarga = cleanStr
      break
    }
  }

  // 5. If we found a Targa, slice the pool
  if (targaIdx >= 0) {
    // Everything written BEFORE the Targa is the Customer Name
    const name = headerTokens.slice(0, targaIdx).join(" ").trim() || null
    
    // Everything written AFTER the Targa is the Place
    const place = headerTokens.slice(targaIdx + 1).join(" ").trim() || null

    return { name, targa: cleanTarga, place }
  }

  // Fallback if absolutely no 4-6 digit number was found at the top of the page
  return { name: null, targa: null, place: null }
}

// ── Step 3: Line item extraction ─────────────────────────────────────────────
// Detects the column-header row ("Item Quantity Price Total"), then parses
// subsequent rows that contain 2+ numeric tokens as line items.
// Validates column order with: qty × price ≈ total cross-check.

const ITEM_HEADER_KEYWORDS = ["item", "quantity", "price", "total", "qty", "amount", "product", "description"]
const ITEM_SKIP_KEYWORDS   = [
  "wezader", "wezider", "wezder", "wzder", "weyder",
  "terezeder", "terezder", "tewezeder", "tewezder", "terezdr",
  "transport", "delivery", "driver", "labor",
  "total", "grand", "subtotal", "sum",
  "name", "targ", "place",
  "ወዘደር", "ዊዘደር",
]

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

    // Completely separate text and numbers first
    const numericTokens: number[] = []
    const textTokens: string[] = []
    
    for (let t = 0; t < tokens.length; t++) {
      if (isNumeric(tokens[t])) {
        numericTokens.push(parseAmount(tokens[t]))
      } else {
        textTokens.push(tokens[t])
      }
    }

    // Need at least 2 numerics to qualify as a line item
    if (numericTokens.length < 2) continue

    // All text automatically becomes the description/name
    // This perfectly handles multi-word names like "Desta Bane" or "200k"
    let description = textTokens.join(" ").trim()
    let quantity = 1
    let unit_price = 0
    let total = 0

    if (manualColumnOrder && manualColumnOrder.length > 0) {
      // Filter the user's mapping to ONLY look at the number columns they expect
      const expectedNumberCols = manualColumnOrder.filter(c => 
        c === "qty" || c === "quantity" || 
        c === "price" || c === "unit_price" || 
        c === "amount" || c === "total"
      )

      // Map the actual numbers found to the expected number columns, in order
      for (let j = 0; j < Math.min(numericTokens.length, expectedNumberCols.length); j++) {
        const val = numericTokens[j]
        const colType = expectedNumberCols[j]
        
        if (colType === "qty" || colType === "quantity") quantity = val
        if (colType === "price" || colType === "unit_price") unit_price = val
        if (colType === "amount" || colType === "total") total = val
      }
    } else {
      // Automatic mode: use text/number separation
      if (numericTokens.length >= 3) {
        const n0 = numericTokens[0]
        const n1 = numericTokens[1]
        const n2 = numericTokens[numericTokens.length - 1]

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
        unit_price = numericTokens[0]
        total      = numericTokens[1]
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
  "wezader", "wezider", "wezder", "wzder", "weyder", "wez", "pudhal",
  "terezeder", "terezder", "tewezeder", "tewezder", "terezdr",
  "transport", "delivery", "driver", "labor",
  "ወዘደር", "ዊዘደር",
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

function buildColumnDetection(rows: Row[], headerRowIdx: number): { columns: any[]; needs_review: boolean } {
  // Scan the next 5 data rows and pick the one with the most tokens
  // (avoids picking an anomalous fractured row as the column template)
  const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0
  let bestRow: Row | undefined
  let maxTokens = 0

  for (let i = startIdx; i < Math.min(startIdx + 5, rows.length); i++) {
    const row   = rows[i]
    const lower = row.text.toLowerCase()
    if (ITEM_SKIP_KEYWORDS.some(kw => lower.includes(kw))) continue
    const numCount = row.words.filter(w => isNumeric(w.text)).length
    if (numCount >= 2 && row.words.length > maxTokens) {
      bestRow = row
      maxTokens = row.words.length
    }
  }

  // Fallback: any row with ≥2 numerics anywhere in the document
  if (!bestRow) {
    const candidates = rows.filter(r => r.words.filter(w => isNumeric(w.text)).length >= 2)
    bestRow = candidates.reduce((best, r) => (!best || r.words.length > best.words.length) ? r : best, undefined as Row | undefined)
  }

  if (!bestRow) return { columns: [], needs_review: false }

  const tokens = bestRow.words.map(w => w.text)
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

  return { columns, needs_review: columns.length >= 2 }
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

  // Flag column review when math validation fails or items have zero prices
  if (!validation.match || lineItems.some(i => i.unit_price === 0 && i.total === 0)) {
    columnDetection.needs_review = true
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

// ── Gemini Pro Scan ────────────────────────────────────────────────────────────
// Called when mode === 'pro'. Fetches the image bytes, base64-encodes them, and
// sends them to Gemini 1.5 Flash with a two-step Chain-of-Thought prompt.
// Deliberately omits responseMimeType so real CoT reasoning is not suppressed.

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ── Gemini structured output schema ──────────────────────────
const GeminiSystemPrompt = (userCtx: { products: any[], customers: any[] }) => `
You are an expert Ethiopian bookkeeping assistant. Extract data from this handwritten receipt into a strict JSON object.

CONTEXT - Use these lists to correct messy handwriting:
KNOWN PRODUCTS: ${JSON.stringify(userCtx.products.slice(0, 100), null, 0)}
KNOWN CUSTOMERS: ${JSON.stringify(userCtx.customers.slice(0, 40), null, 0)}

--- CRITICAL MASTER TEMPLATE ---
This receipt follows a STRICT 4-column format. You must read left-to-right across the massive gaps. 

EXAMPLE OF THE EXACT RECEIPT FORMAT YOU ARE LOOKING AT:
Image Text:
Aymen       Biretene        14563
Klenze      15      4350  - 65,250
200k        10      5000  - 50,000
Qemeni      10      2300    23,000
DestaBane   7       1500    10,500
           tewezeder 500
Total - 149,250

CORRECT EXTRACTION FOR THIS EXAMPLE:
- Header -> Name: "Aymen", Place: "Biretene", Targa: "14563"
- Line 1 -> desc: "Klenze", qty: 15, unit_price: 4350, total: 65250
- Line 2 -> desc: "200k", qty: 10, unit_price: 5000, total: 50000
- Line 3 -> desc: "Qemeni", qty: 10, unit_price: 2300, total: 23000
- Line 4 -> desc: "DestaBane", qty: 7, unit_price: 1500, total: 10500
- Transport -> amount: 500, worker_note: "tewezeder"
- Grand Total -> 149250
--------------------------------

RULES YOU MUST FOLLOW:
1. NEVER split a single row into multiple items. A product row ALWAYS has 4 parts: [Product Name] [Quantity] [Unit Price] [Total].
2. If you see a number like "1500" sitting alone, it is a PRICE or a TOTAL. It is NEVER a product name.
3. Words like "tewezeder", "wezader", "terezeder", "labor", or "transport" are TRANSPORT FEES. Put their amount ONLY in the "transport_fee" field. NEVER put them in the line_items array.
4. MATH ANCHOR: Quantity * Unit Price MUST exactly equal Total.

You MUST return a valid JSON object with these exact keys:
{
  "_step_1_raw_transcription": "Transcribe the receipt line-by-line exactly as written.",
  "vendor": "vendor name or empty string",
  "date": "YYYY-MM-DD or empty string",
  "total": <total amount as a number, 0 if not found>,
  "subtotal": <subtotal before fees, 0 if unknown>,
  "transport_fee": <transport/delivery/wezader fee amount, 0 if none>,
  "line_items": [
    {
      "description": "product name",
      "matched_product_id": "id from known products if matched, null if not",
      "matched_product_name": "corrected product name if matched, null if not",
      "quantity": <number>,
      "unit_price": <price per unit>,
      "total": <quantity * unit_price>
    }
  ],
  "customer_name": "customer name if found, null if not",
  "matched_customer_id": "id from known customers if matched, null if not",
  "payment_method": "cash | credit | bank_transfer | telebirr | cbe_birr | null",
  "notes": "put the targa/plate number or place here if found",
  "scan_mode": "pro"
}
`

async function callGeminiProScan(
  imageUrl: string,
  userContext: { products: any[]; customers: any[] },
  apiKey: string
) {
  // 1. Fetch image bytes and encode to base64
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`)
  const buf = await imgRes.arrayBuffer()
  const b64 = uint8ToBase64(new Uint8Array(buf))
  const mimeType = imageUrl.toLowerCase().includes('.pdf') ? 'application/pdf' : 'image/webp'

  // 2. Build prompt using the strictly templated schema with few-shot example
  const prompt = GeminiSystemPrompt(userContext)

  // 3. Call Gemini — NO responseMimeType so CoT reasoning is fully executed
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    }
  )

  if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`)
  const gData = await res.json()
  const rawText: string = gData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  // 5. Extract the first JSON object (model may prefix with reasoning text)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Gemini returned no JSON. Preview: ${rawText.slice(0, 300)}`)
  const g = JSON.parse(jsonMatch[0])

  // 6. Normalise line items — preserve matched_product_id / matched_product_name
  const lineItems = (g.line_items || []).map((it: any) => ({
    description:          String(it.description || ''),
    matched_product_id:   it.matched_product_id   || null,
    matched_product_name: it.matched_product_name || null,
    quantity:             Math.max(Number(it.quantity)  || 1, 0.001),
    unit_price:           Number(it.unit_price) || 0,
    total:                Number(it.total)      || 0,
  }))

  const itemsTotal      = lineItems.reduce((s: number, i: any) => s + i.total, 0)
  const transportAmount = Number(g.transport_fee) || 0
  const grandTotal      = Number(g.total) || (itemsTotal + transportAmount)

  // Determine targa vs place from the free-form notes field
  const notesStr       = String(g.notes || '').trim()
  const looksLikeTarga = notesStr.length > 0 &&
    (/^\d{4,8}$/.test(notesStr) || /^[A-Z]{1,3}\d{4,6}$/i.test(notesStr))
  const targa = looksLikeTarga ? notesStr : null
  const place = looksLikeTarga ? null     : (notesStr || null)

  return {
    raw_text:        String(g._step_1_raw_transcription || ''),
    raw_blocks:      [],
    customer_header: {
      name:  g.customer_name || null,
      targa: targa,
      place: place,
    },
    transport: {
      amount:      transportAmount > 0 ? transportAmount : null,
      worker_note: '',
      detected:    transportAmount > 0,
    },
    payment_bank:  g.payment_method || null,
    validation: {
      items_total:      itemsTotal,
      transport_amount: transportAmount,
      detected_total:   grandTotal,
      match:            true,
    },
    parsed_data: {
      vendor:           g.vendor || '',
      date:             g.date   || '',
      total:            grandTotal,
      scan_mode:        'pro',
      line_items:       lineItems,
      column_detection: { columns: [], needs_review: false },
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
    const { imageUrl, manual_column_order, mode, userContext } = body
    if (!imageUrl) throw new Error("imageUrl is required")

    let parsed

    if (mode === 'pro') {
      const geminiKey = Deno.env.get("GEMINI_API_KEY")
      if (!geminiKey) {
        throw new Error("GEMINI_API_KEY is not configured for Pro Scan")
      }
      if (geminiKey.trim() === "") {
        throw new Error("GEMINI_API_KEY is empty for Pro Scan")
      }
      parsed = await callGeminiProScan(
        imageUrl,
        userContext || { products: [], customers: [] },
        geminiKey
      )
    } else {
      const serviceAccountEnv = Deno.env.get("GOOGLE_SERVICE_ACCOUNT")
      if (!serviceAccountEnv) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT is not configured for Standard Scan")
      }
      if (serviceAccountEnv.trim() === "") {
        throw new Error("GOOGLE_SERVICE_ACCOUNT is empty for Standard Scan")
      }
      
      let serviceAccount
      try {
        serviceAccount = JSON.parse(serviceAccountEnv)
      } catch (parseErr) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT is not valid JSON")
      }
      
      const accessToken = await getGoogleAccessToken(serviceAccount)

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
      parsed = parseVisionResponse(visionData, manual_column_order)
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err: any) {
    console.error("OCR proxy error:", err)
    console.error("Error stack:", err.stack)
    
    // Try to log request body if available, but don't crash if it fails
    try {
      const body = await req.clone().json()
      console.error("Request body received:", JSON.stringify(body, null, 2))
    } catch (bodyErr) {
      console.error("Could not log request body:", bodyErr.message)
    }
    
    // Add more specific error context
    let errorMessage = err.message
    if (err.message.includes("GOOGLE_SERVICE_ACCOUNT")) {
      errorMessage = "Google Vision API not configured: GOOGLE_SERVICE_ACCOUNT environment variable is missing or invalid"
    } else if (err.message.includes("GEMINI_API_KEY")) {
      errorMessage = "Gemini API not configured: GEMINI_API_KEY environment variable is missing"
    } else if (err.message.includes("Vision API error")) {
      errorMessage = `Google Vision API error: ${err.message}`
    } else if (err.message.includes("Gemini API error")) {
      errorMessage = `Gemini API error: ${err.message}`
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage, details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
