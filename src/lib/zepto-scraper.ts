/**
 * zepto-scraper.ts
 * Server-side scraper for Zepto product pages.
 * Uses node-fetch to grab the HTML and extracts structured
 * product data from the embedded JSON-LD / page content.
 *
 * Install deps:  npm install node-fetch cheerio
 */

import * as cheerio from "cheerio"

export interface ZeptoProduct {
  title: string
  subtitle: string
  description: string
  handle: string
  thumbnail: string
  images: string[]
  weight: number | null
  origin_country: string
  material: string
  shelf_life: string
  brand: string
  product_type: string
  tags: string[]
  external_id: string
  variants: ZeptoVariant[]
  price_inr: number | null
  mrp_inr: number | null
  inventory_quantity: number | null
  extra_details: Record<string, string>
  raw_url: string
}

export interface ZeptoVariant {
  title: string
  sku: string
  weight: number | null
  origin_country: string
  material: string
}

interface JsonLdProduct {
  name?: string
  description?: string
  brand?: string | { name?: string }
  image?: string | string[]
  category?: string
  offers?: {
    price?: number | string
    highPrice?: number | string
    priceSpecification?: { price?: number | string }
  } | Array<{
    price?: number | string
    highPrice?: number | string
    priceSpecification?: { price?: number | string }
  }>
}

function normalizeSpace(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/\s+/g, " ").trim()
}

function sanitizeValue(value: unknown, maxLen = 220): string {
  if (typeof value !== "string") {
    return ""
  }

  const cleaned = normalizeSpace(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\\u003c|\\u003e|\\u002f/gi, " ")
  )

  if (!cleaned) {
    return ""
  }

  // Ignore serialized JSON / broken script fragments that leak into text extraction.
  if (
    cleaned.includes("\"key\"") ||
    cleaned.includes("\":") ||
    cleaned.includes("{\"") ||
    cleaned.includes("__NEXT_DATA__")
  ) {
    return ""
  }

  const punctuationCount = (cleaned.match(/[{}\[\]"\\]/g) ?? []).length
  if (punctuationCount > cleaned.length * 0.16) {
    return ""
  }

  if (/^[^a-zA-Z0-9]+$/.test(cleaned)) {
    return ""
  }

  if (cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen).trim()
  }

  return cleaned
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function collectJsonLdProducts(node: unknown, bucket: JsonLdProduct[]) {
  if (!node) {
    return
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsonLdProducts(item, bucket)
    }
    return
  }

  if (typeof node !== "object") {
    return
  }

  const obj = node as Record<string, unknown>
  const typeValue = String(obj["@type"] ?? "").toLowerCase()
  const hasProductShape = Boolean(obj.name && (obj.offers || obj.image || obj.brand))

  if (typeValue.includes("product") || hasProductShape) {
    bucket.push(obj as JsonLdProduct)
  }

  if (obj["@graph"]) {
    collectJsonLdProducts(obj["@graph"], bucket)
  }

  if (obj.mainEntity) {
    collectJsonLdProducts(obj.mainEntity, bucket)
  }

  if (obj.itemListElement) {
    collectJsonLdProducts(obj.itemListElement, bucket)
  }
}

function extractProductFromJsonLd($: cheerio.CheerioAPI): JsonLdProduct {
  const products: JsonLdProduct[] = []

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim()
    if (!raw) {
      return
    }

    const parsed = tryParseJson<unknown>(raw)
    if (!parsed) {
      return
    }

    collectJsonLdProducts(parsed, products)
  })

  return products[0] ?? {}
}

function pickFirstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const cleaned = sanitizeValue(value ?? "")
    if (cleaned) {
      return cleaned
    }
  }
  return ""
}

function normalizeImageUrl(url: string): string {
  const cleaned = normalizeSpace(url)
  if (!cleaned) {
    return ""
  }

  let finalUrl = ""
  if (cleaned.startsWith("//")) {
    finalUrl = `https:${cleaned}`
  } else if (/^https?:\/\//i.test(cleaned)) {
    finalUrl = cleaned
  }

  if (finalUrl) {
    let u = finalUrl.split("?")[0]
    u = u.replace(/\/tr:[^\/]+\//, "/")
    return u
  }

  return ""
}

function extractVisibleText($: cheerio.CheerioAPI): string {
  const clonedBody = $("body").clone()
  clonedBody.find("script, style, noscript, template").remove()

  return normalizeSpace(clonedBody.text())
}

function extractFirstNumber(text: string, regex: RegExp): number | null {
  const match = text.match(regex)
  if (!match?.[1]) {
    return null
  }

  const value = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== "string") {
    return null
  }

  const num = Number(value.replace(/,/g, "").trim())
  return Number.isFinite(num) ? num : null
}

function parseWeight(unit: string): number | null {
  let weight: number | null = null

  const kgMatch = unit.match(/([\d.]+)\s*kg/i)
  const gMatch = unit.match(/([\d.]+)\s*g(?:\b|$)/i)
  const mlMatch = unit.match(/([\d.]+)\s*ml/i)
  const lMatch = unit.match(/([\d.]+)\s*[lL](?:\b|$)/)

  if (kgMatch) {
    weight = Math.round(parseFloat(kgMatch[1]) * 1000)
  } else if (gMatch) {
    weight = Math.round(parseFloat(gMatch[1]))
  } else if (mlMatch) {
    weight = Math.round(parseFloat(mlMatch[1]))
  } else if (lMatch) {
    weight = Math.round(parseFloat(lMatch[1]) * 1000)
  }

  return weight
}

function extractUnitFromText(text: string): string {
  const match = text.match(/(\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pcs?|pc|packs?|tablets?|capsules?))/i)
  return sanitizeValue(match?.[1] ?? "", 60)
}

function normalizeCountryCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z]/g, "")

  if (compact.length === 2) {
    return compact
  }

  if (/india|bharat/i.test(value)) {
    return "IN"
  }

  return "IN"
}

function buildHandle(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  return slug || fallback
}

function normalizeTags(values: Array<string | undefined | null>): string[] {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const raw of values) {
    if (typeof raw !== "string") {
      continue
    }

    const cleaned = normalizeSpace(raw)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "-")

    if (!cleaned || cleaned.length < 2 || cleaned.length > 32 || seen.has(cleaned)) {
      continue
    }

    seen.add(cleaned)
    tags.push(cleaned)

    if (tags.length >= 10) {
      break
    }
  }

  return tags
}

function skuPart(value: string, maxLen: number): string {
  return normalizeSpace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
}

function buildSku(brand: string, unit: string, externalId: string): string {
  const parts = [
    skuPart(brand, 12),
    skuPart(unit, 16),
    skuPart(externalId, 8),
  ].filter(Boolean)

  if (parts.length > 0) {
    return parts.join("-")
  }

  return `ZEPTO-${Date.now()}`
}

function extractKeyValuePairsFromRawJson(raw: string, blockName: string): Record<string, string> {
  const result: Record<string, string> = {}
  const blockRegex = new RegExp(`\"${blockName}\"\\s*:\\s*\\[(.*?)\\]`, "s")
  const blockMatch = raw.match(blockRegex)

  if (!blockMatch?.[1]) {
    return result
  }

  const itemRegex = /\"key\"\s*:\s*\"([^\"]+)\"\s*,\s*\"value\"\s*:\s*\"([^\"]*)\"/g
  let match: RegExpExecArray | null = itemRegex.exec(blockMatch[1])

  while (match) {
    const key = normalizeSpace(match[1]).toLowerCase()
    const value = sanitizeValue(match[2])
    if (key && value && !result[key]) {
      result[key] = value
    }
    match = itemRegex.exec(blockMatch[1])
  }

  return result
}

// ──────────────────────────────────────────────────────────────────────────────
// Main scrape function
// ──────────────────────────────────────────────────────────────────────────────
export async function scrapeZeptoProduct(url: string): Promise<ZeptoProduct> {
  const fetch = (await import("node-fetch")).default

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://www.zepto.com/",
    },
  })

  if (!res.ok) {
    throw new Error(`Zepto returned HTTP ${res.status} for URL: ${url}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)
  const visibleText = extractVisibleText($)
  const productJsonLd = extractProductFromJsonLd($)

  // ── Extract product variant ID from URL ────────────────────────────────────
  const pvid = url.match(/pvid\/([a-f0-9-]+)/)?.[1] ?? ""

  const jsonLdBrand = sanitizeValue(
    typeof productJsonLd.brand === "string"
      ? productJsonLd.brand
      : productJsonLd.brand?.name ?? "",
    80
  )

  const jsonLdDescription = sanitizeValue(productJsonLd.description ?? "", 320)
  const jsonLdCategory = sanitizeValue(productJsonLd.category ?? "", 80)

  const rawJsonLdImages = Array.isArray(productJsonLd.image)
    ? productJsonLd.image
    : productJsonLd.image
      ? [productJsonLd.image]
      : []

  const jsonLdImages = rawJsonLdImages
    .map((image) => normalizeImageUrl(String(image)))
    .filter(Boolean)

  const primaryOffer = Array.isArray(productJsonLd.offers)
    ? productJsonLd.offers[0]
    : productJsonLd.offers

  const jsonLdPrice = parseNumberish(primaryOffer?.price)
  const jsonLdMrp =
    parseNumberish(primaryOffer?.priceSpecification?.price) ??
    parseNumberish(primaryOffer?.highPrice)

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = pickFirstNonEmpty(
    productJsonLd.name,
    $("h1").first().text().trim(),
    $('meta[property="og:title"]').attr("content"),
    $('meta[name="twitter:title"]').attr("content")
  )

  // ── Images ─────────────────────────────────────────────────────────────────
  const images: string[] = []

  for (const image of jsonLdImages) {
    if (!images.includes(image)) {
      images.push(image)
    }
  }

  $("img").each((_, el) => {
    const src = normalizeImageUrl($(el).attr("src") || $(el).attr("data-src") || "")
    if (!src) {
      return
    }

    if (src.includes("cms/product_variant") || src.includes("zeptonow.com") || src.includes("zepto.com")) {
      if (!images.includes(src)) images.push(src)
    }
  })

  const ogImage = normalizeImageUrl($('meta[property="og:image"]').attr("content") || "")
  const thumbnail = ogImage || images[0] || ""
  if (thumbnail && !images.includes(thumbnail)) {
    images.unshift(thumbnail)
  }

  const limitedImages = images.slice(0, 12)

  // ── Structured key-value extraction from embedded JSON ────────────────────
  const highlights = extractKeyValuePairsFromRawJson(html, "highlights")
  const information = extractKeyValuePairsFromRawJson(html, "information")

  function extractAfterLabel(label: string): string {
    const re = new RegExp(`${label}[:\\s]+([^|.]{1,160})`, "i")
    return sanitizeValue(visibleText.match(re)?.[1] ?? "")
  }

  const brand =
    pickFirstNonEmpty(
      highlights["brand"],
      jsonLdBrand,
      $("a[href*='/brand/']").first().text().trim(),
      extractAfterLabel("brand"),
      sanitizeValue(html.match(/\"brand\"\s*:\s*\"([^\"]+)\"/)?.[1] ?? "")
    )

  const productType =
    pickFirstNonEmpty(
      highlights["product type"],
      highlights["type"],
      jsonLdCategory,
      extractAfterLabel("product type")
    )

  const material =
    pickFirstNonEmpty(
      highlights["material type free"],
      highlights["material"]
    )

  const keyFeatures =
    pickFirstNonEmpty(
      highlights["key features"],
      highlights["features"],
      extractAfterLabel("key features")
    )

  const usageInstruction =
    pickFirstNonEmpty(
      highlights["usage instruction"],
      extractAfterLabel("usage instruction")
    )

  const fragrance =
    pickFirstNonEmpty(highlights["fragrance"], extractAfterLabel("fragrance"))

  const unitFromTitle = extractUnitFromText(title)

  const unit =
    pickFirstNonEmpty(
      highlights["unit"],
      highlights["net qty"],
      unitFromTitle,
      sanitizeValue(visibleText.match(/Net Qty[:\s]+([^|]{1,120})/i)?.[1] ?? "")
    )

  const packagingType =
    pickFirstNonEmpty(highlights["packaging type"], extractAfterLabel("packaging type"))

  const hypoallergenic =
    pickFirstNonEmpty(highlights["hypoallergenic"], extractAfterLabel("hypoallergenic"))

  const shelfLife =
    pickFirstNonEmpty(information["shelf life"], extractAfterLabel("shelf life"))

  const originCountryRaw =
    pickFirstNonEmpty(
      information["country of origin"],
      highlights["country of origin"],
      extractAfterLabel("country of origin"),
      "IN"
    )

  const originCountry = normalizeCountryCode(originCountryRaw)

  // ── Prices ─────────────────────────────────────────────────────────────────
  const priceVisible = extractFirstNumber(visibleText, /(?:₹|Rs\.?)[\s]*([\d.,]+)/i)
  const mrpVisible = extractFirstNumber(visibleText, /MRP\s*(?:₹|Rs\.?)[\s]*([\d.,]+)/i)
  const discountedPaise = extractFirstNumber(html, /\"discountedSellingPrice\"\s*:\s*(\d+)/)
  const mrpPaise = extractFirstNumber(html, /\"mrp\"\s*:\s*(\d+)/)

  const priceCandidate =
    discountedPaise !== null
      ? discountedPaise / 100
      : jsonLdPrice !== null
        ? jsonLdPrice
        : priceVisible

  let price_inr =
    priceCandidate !== null
      ? Math.max(0, Math.round(priceCandidate))
      : null

  const mrpCandidate =
    mrpPaise !== null
      ? mrpPaise / 100
      : jsonLdMrp !== null
        ? jsonLdMrp
        : mrpVisible

  let mrp_inr =
    mrpCandidate !== null
      ? Math.max(0, Math.round(mrpCandidate))
      : null

  if (price_inr !== null && mrp_inr !== null && mrp_inr < price_inr) {
    mrp_inr = price_inr
  }

  const rawInventory =
    extractFirstNumber(html, /\"availableQuantity\"\s*:\s*(\d+)/) ??
    extractFirstNumber(html, /\"quantity\"\s*:\s*(\d+)/)

  const inventory_quantity =
    rawInventory !== null && rawInventory >= 0 && rawInventory <= 10000
      ? rawInventory
      : null

  // ── Weight from unit (e.g. "1 pack (4 L)" → 4000g) ───────────────────────
  const weight = parseWeight(unit || title)

  // ── Build description ──────────────────────────────────────────────────────
  const metaDescription = sanitizeValue($('meta[name="description"]').attr("content") || "", 320)
  const descParts: string[] = []
  if (keyFeatures) descParts.push(keyFeatures)
  if (fragrance) descParts.push(`Fragrance: ${fragrance}`)
  if (hypoallergenic) descParts.push(`Hypoallergenic: ${hypoallergenic}`)
  if (usageInstruction) descParts.push(`Usage: ${usageInstruction}`)
  if (unit) descParts.push(`Net Qty: ${unit}`)
  if (shelfLife) descParts.push(`Shelf Life: ${shelfLife}`)
  if (packagingType) descParts.push(`Packaging: ${packagingType}`)

  const fallbackDescription =
    pickFirstNonEmpty(
      jsonLdDescription,
      metaDescription,
      extractAfterLabel("about the product")
    ) ||
    sanitizeValue(`${title}${brand ? ` by ${brand}` : ""}${unit ? `. Net Qty: ${unit}` : ""}`, 320)

  const description = sanitizeValue(descParts.join(". "), 500) || fallbackDescription

  // ── Handle (URL slug) ──────────────────────────────────────────────────────
  const handle = buildHandle(
    title,
    pvid ? `zepto-${pvid.slice(0, 12)}` : "zepto-product"
  )

  // ── Tags ───────────────────────────────────────────────────────────────────
  const tags: string[] = normalizeTags([
    productType,
    brand,
    highlights["concern"],
    highlights["hair type"],
    packagingType,
    fragrance,
    material,
  ])

  // ── Variants ───────────────────────────────────────────────────────────────
  const sku = buildSku(brand || title, unit || title, pvid)

  const variants: ZeptoVariant[] = [
    {
      title: unit || "Default",
      sku,
      weight,
      origin_country: originCountry,
      material,
    },
  ]

  const extra_details: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries({ ...highlights, ...information })) {
    const key = normalizeSpace(rawKey).toLowerCase()
    const value = sanitizeValue(rawValue, 180)

    if (!key || !value) {
      continue
    }

    extra_details[key] = value
  }

  if (unit && !extra_details["unit"]) {
    extra_details["unit"] = unit
  }
  if (Object.keys(extra_details).length <= 2 && visibleText) {
    extra_details["raw_page_text"] = sanitizeValue(visibleText, 2500)
  }
  if (packagingType && !extra_details["packaging type"]) {
    extra_details["packaging type"] = packagingType
  }

  return {
    title,
    subtitle: brand ? `by ${brand}` : "",
    description,
    handle,
    thumbnail,
    images: limitedImages,
    weight,
    origin_country: originCountry,
    material,
    shelf_life: shelfLife,
    brand,
    product_type: productType,
    tags,
    external_id: pvid || handle,
    variants,
    price_inr,
    mrp_inr,
    inventory_quantity,
    extra_details,
    raw_url: url,
  }
}
