import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Sign a JWT for Google service account
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

  // Import private key
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

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

// Parse Vision API response into structured data
function parseVisionResponse(response: any) {
  const fullText = response.responses?.[0]?.fullTextAnnotation?.text || ""
  const blocks   = response.responses?.[0]?.textAnnotations || []

  // Simple heuristic parser
  const lines      = fullText.split("\n").map((l: string) => l.trim()).filter(Boolean)
  const lineItems: any[] = []
  let   total      = 0
  let   date       = ""
  let   vendor     = lines[0] || ""

  // Find date
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/
  for (const line of lines) {
    const match = line.match(dateRegex)
    if (match) { date = match[1]; break }
  }

  // Find total
  const totalRegex = /(?:total|amount|grand total)[^\d]*(\d+(?:[.,]\d{1,2})?)/i
  for (const line of lines) {
    const match = line.match(totalRegex)
    if (match) { total = parseFloat(match[1].replace(",", ".")); break }
  }

  // Find line items — lines with a number that look like prices
  const itemRegex = /^(.+?)\s+(\d+(?:\.\d{1,2})?)\s*(?:x\s*(\d+(?:\.\d{1,2})?))?(?:\s+(\d+(?:\.\d{1,2})?))?$/
  for (const line of lines) {
    const match = line.match(itemRegex)
    if (match && !line.toLowerCase().includes("total")) {
      lineItems.push({
        description: match[1].trim(),
        quantity:    match[3] ? Number(match[3]) : 1,
        unit_price:  match[2] ? Number(match[2]) : 0,
        total:       match[4] ? Number(match[4]) : Number(match[2]) || 0,
      })
    }
  }

  return {
    raw_text:   fullText,
    raw_blocks: blocks.slice(0, 50),
    parsed_data: {
      vendor,
      date,
      total,
      line_items: lineItems,
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { imageUrl } = await req.json()
    if (!imageUrl) throw new Error("imageUrl is required")

    // Load service account from env
    const serviceAccount = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "")
    const accessToken    = await getGoogleAccessToken(serviceAccount)

    // Call Vision API
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          requests: [{
            image:   { source: { imageUri: imageUrl } },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          }]
        }),
      }
    )

    if (!visionRes.ok) {
      const err = await visionRes.text()
      throw new Error(`Vision API error: ${err}`)
    }

    const visionData = await visionRes.json()
    const parsed     = parseVisionResponse(visionData)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.error("OCR proxy error:", err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
