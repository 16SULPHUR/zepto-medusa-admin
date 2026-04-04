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
  raw_url: string
}

export interface ZeptoVariant {
  title: string
  sku: string
  weight: number | null
  origin_country: string
  material: string
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

  // ── Extract product variant ID from URL ────────────────────────────────────
  const pvid = url.match(/pvid\/([a-f0-9-]+)/)?.[1] ?? ""

  // ── Title ──────────────────────────────────────────────────────────────────
  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    ""

  // ── Images ─────────────────────────────────────────────────────────────────
  const images: string[] = []
  $("img").each((_, el) => {
    const src = $(el).attr("src") || ""
    // Only take the larger product images (w-470)
    if (src.includes("zeptonow.com") && src.includes("w-470")) {
      if (!images.includes(src)) images.push(src)
    }
  })

  const thumbnail = images[0] ?? ""

  // ── Highlight key-value rows ───────────────────────────────────────────────
  const highlights: Record<string, string> = {}
  // Zepto renders highlights as pairs of <p> tags inside a highlights section
  $("h2, h3").each((_, heading) => {
    if ($(heading).text().trim().toLowerCase() === "highlights") {
      const section = $(heading).closest("section, div")
      section.find("p, span").each((i, el) => {
        const text = $(el).text().trim()
        // Alternating key / value pattern
        if (i % 2 === 0) {
          highlights["_key"] = text.toLowerCase()
        } else if (highlights["_key"]) {
          highlights[highlights["_key"]] = text
          delete highlights["_key"]
        }
      })
    }
  })

  // ── Fallback: grab ALL text nodes that look like label: value ─────────────
  const pageText = $("body").text()

  function extractAfterLabel(label: string): string {
    const re = new RegExp(label + "[:\\s]+([^\\n]+)", "i")
    return pageText.match(re)?.[1]?.trim() ?? ""
  }

  const brand =
    highlights["brand"] ||
    $("a[href*='/brand/']").first().text().trim() ||
    extractAfterLabel("brand")

  const productType =
    highlights["product type"] ||
    highlights["type"] ||
    extractAfterLabel("product type")

  const material =
    highlights["material type free"] ||
    highlights["material"] ||
    extractAfterLabel("material")

  const keyFeatures =
    highlights["key features"] ||
    highlights["features"] ||
    extractAfterLabel("key features")

  const fragrance =
    highlights["fragrance"] || extractAfterLabel("fragrance")

  const unit =
    highlights["unit"] ||
    highlights["net qty"] ||
    pageText.match(/Net Qty[:\s]+([^\n•]+)/i)?.[1]?.trim() ||
    ""

  const packagingType =
    highlights["packaging type"] || extractAfterLabel("packaging type")

  const hypoallergenic =
    highlights["hypoallergenic"] || extractAfterLabel("hypoallergenic")

  const shelfLife =
    pageText.match(/Shelf Life[:\s]+([^\n•]+)/i)?.[1]?.trim() ||
    extractAfterLabel("shelf life")

  const originCountry =
    highlights["country of origin"] ||
    pageText.match(/Country of Origin[:\s]+([^\n•]+)/i)?.[1]?.trim() ||
    "IN"

  // ── Prices ─────────────────────────────────────────────────────────────────
  const priceMatch = pageText.match(/₹\s*(\d+)/)
  const mrpMatch = pageText.match(/MRP\s*₹\s*(\d+)/)
  const price_inr = priceMatch ? parseInt(priceMatch[1]) : null
  const mrp_inr = mrpMatch ? parseInt(mrpMatch[1]) : null

  // ── Weight from unit (e.g. "1 pack (4 L)" → 4000g) ───────────────────────
  let weight: number | null = null
  const kgMatch = unit.match(/([\d.]+)\s*kg/i)
  const lMatch = unit.match(/([\d.]+)\s*[lL](?:\b|$)/)
  const gMatch = unit.match(/([\d.]+)\s*g(?:\b|$)/i)
  const mlMatch = unit.match(/([\d.]+)\s*ml/i)
  if (kgMatch) weight = Math.round(parseFloat(kgMatch[1]) * 1000)
  else if (lMatch) weight = Math.round(parseFloat(lMatch[1]) * 1000)
  else if (gMatch) weight = parseInt(gMatch[1])
  else if (mlMatch) weight = parseInt(mlMatch[1])

  // ── Build description ──────────────────────────────────────────────────────
  const descParts: string[] = []
  if (keyFeatures) descParts.push(keyFeatures)
  if (fragrance) descParts.push(`Fragrance: ${fragrance}`)
  if (hypoallergenic) descParts.push(`Hypoallergenic: ${hypoallergenic}`)
  if (unit) descParts.push(`Net Qty: ${unit}`)
  if (shelfLife) descParts.push(`Shelf Life: ${shelfLife}`)
  if (packagingType) descParts.push(`Packaging: ${packagingType}`)
  const description = descParts.join(". ")

  // ── Handle (URL slug) ──────────────────────────────────────────────────────
  const handle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  // ── Tags ───────────────────────────────────────────────────────────────────
  const tags: string[] = [
    productType,
    brand,
    "cleaning essentials",
    packagingType,
    fragrance,
  ].filter(Boolean).map((t) => t.toLowerCase())

  // ── Variants ───────────────────────────────────────────────────────────────
  const sku =
    brand.toUpperCase().replace(/\s+/g, "-") +
    "-" +
    (unit
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .toUpperCase()
      .slice(0, 20))

  const variants: ZeptoVariant[] = [
    {
      title: unit || "Default",
      sku,
      weight,
      origin_country: originCountry.trim().toUpperCase().slice(0, 2),
      material,
    },
  ]

  return {
    title,
    subtitle: brand ? `by ${brand}` : "",
    description,
    handle,
    thumbnail,
    images,
    weight,
    origin_country: originCountry.trim().toUpperCase().slice(0, 2),
    material,
    shelf_life: shelfLife,
    brand,
    product_type: productType,
    tags,
    external_id: pvid,
    variants,
    price_inr,
    mrp_inr,
    raw_url: url,
  }
}
