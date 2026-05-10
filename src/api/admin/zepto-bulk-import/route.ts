/**
 * POST /admin/zepto-bulk-import
 *
 * Bulk import products from Zepto into Medusa.
 * Uses the same Admin API approach as the working single-product importer:
 *   - POST /admin/products  (handles prices correctly via pricing module)
 *   - GET  /admin/products/:id (retrieve inventory items)
 *   - POST /admin/inventory-items/:id/location-levels (set stock)
 *
 * Streams progress as NDJSON for real-time UI updates.
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { scrapeZeptoProduct } from "../../../lib/zepto-scraper"
import { refineZeptoProduct } from "../../../lib/zepto-ai-refiner"
import {
  getProductUrlsFromSitemap,
  getProductUrlsFromCategoryPage,
} from "../../../lib/zepto-sitemap"
import { ZeptoConfig } from "../../../lib/zepto.config"

// ── Types ────────────────────────────────────────────────────────────────────

type BulkImportBody = {
  mode: "sitemap" | "category" | "urls"
  sitemap_pages?: number[] | "all"
  keyword?: string
  category_url?: string
  product_urls?: string[]
  max_products?: number
  use_ai?: boolean
  default_inventory?: number
  sales_channel_id?: string
  shipping_profile_id?: string
  stock_location_id?: string
}

interface ProgressEvent {
  type: "discovery" | "progress" | "summary"
  message?: string
  current?: number
  total?: number
  status?: "importing" | "skipped" | "success" | "failed"
  product_title?: string
  product_url?: string
  product_id?: string
  error?: string
  imported?: number
  skipped?: number
  failed?: number
  errors?: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeEvent(res: MedusaResponse, event: ProgressEvent) {
  try {
    res.write(JSON.stringify(event) + "\n")
    if (typeof (res as any).flush === "function") {
      (res as any).flush()
    }
  } catch {
    // Response may have been closed
  }
}

/**
 * Make an internal Admin API call, forwarding the session cookie
 * from the incoming request for authentication.
 */
async function adminApiFetch(
  req: MedusaRequest,
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<any> {
  const fetch = (await import("node-fetch")).default

  // Determine the backend URL for internal calls
  const backendUrl = (
    process.env.MEDUSA_BACKEND_URL ||
    `http://localhost:9000`
  ).replace(/\/+$/, "")

  const url = `${backendUrl}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  // Forward cookies from the incoming request for session auth
  const cookie = req.headers.cookie
  if (cookie) {
    headers["Cookie"] = cookie
  }

  // Forward authorization header if present
  const auth = req.headers.authorization
  if (auth) {
    headers["Authorization"] = auth as string
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const errMsg = data?.message || data?.error || `HTTP ${res.status}`
    throw new Error(errMsg)
  }

  return data
}

// ── Main Route ───────────────────────────────────────────────────────────────

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as BulkImportBody

  if (!body.mode || !["sitemap", "category", "urls"].includes(body.mode)) {
    return res.status(400).json({ error: "Invalid mode. Use 'sitemap', 'category', or 'urls'." })
  }

  // Set up NDJSON streaming
  res.setHeader("Content-Type", "application/x-ndjson")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.status(200)

  // ── Step 1: Discover product URLs ────────────────────────────────────────

  let productUrls: string[] = []

  try {
    writeEvent(res, {
      type: "discovery",
      message: `Discovering product URLs (mode: ${body.mode})...`,
    })

    if (body.mode === "sitemap") {
      const pages = body.sitemap_pages || [1]
      const result = await getProductUrlsFromSitemap(pages, {
        keyword: body.keyword,
        maxProducts: body.max_products || 50,
      })
      productUrls = result.urls
      writeEvent(res, {
        type: "discovery",
        message: `Found ${result.totalFound} products in sitemap, ${result.filtered} after filtering.`,
      })
    } else if (body.mode === "category") {
      if (!body.category_url || !/zepto\.com/i.test(body.category_url)) {
        writeEvent(res, {
          type: "summary",
          imported: 0, skipped: 0, failed: 0,
          errors: ["Please provide a valid Zepto category URL."],
        })
        return res.end()
      }
      const result = await getProductUrlsFromCategoryPage(body.category_url, {
        maxProducts: body.max_products || 50,
      })
      productUrls = result.urls
      writeEvent(res, {
        type: "discovery",
        message: `Found ${result.totalFound} products on category page, using ${result.filtered}.`,
      })
    } else if (body.mode === "urls") {
      productUrls = (body.product_urls || [])
        .map((u) => u.trim())
        .filter((u) => /zepto\.com/i.test(u))
        .slice(0, body.max_products || 200)
      writeEvent(res, {
        type: "discovery",
        message: `Processing ${productUrls.length} provided URLs.`,
      })
    }

    if (productUrls.length === 0) {
      writeEvent(res, {
        type: "summary",
        imported: 0, skipped: 0, failed: 0, errors: [],
        message: "No product URLs found.",
      })
      return res.end()
    }
  } catch (err: any) {
    writeEvent(res, {
      type: "summary",
      imported: 0, skipped: 0, failed: 0,
      errors: [err.message || "Failed to discover product URLs"],
    })
    return res.end()
  }

  // ── Step 2: Import products one by one ───────────────────────────────────

  const total = productUrls.length
  let imported = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  const useAi = body.use_ai !== false
  const defaultInventory = body.default_inventory ?? 100
  const salesChannelId = body.sales_channel_id
  const shippingProfileId = body.shipping_profile_id
  const stockLocationId = body.stock_location_id

  for (let i = 0; i < total; i++) {
    const productUrl = productUrls[i]

    writeEvent(res, {
      type: "progress",
      current: i + 1, total,
      status: "importing",
      product_url: productUrl,
      message: `[${i + 1}/${total}] Scraping...`,
    })

    try {
      // ── Scrape ─────────────────────────────────────────────────────────
      const scraped = await scrapeZeptoProduct(productUrl)
      const refined = await refineZeptoProduct(scraped, { useAi })
      const product = refined.product

      // ── Check for duplicates via Admin API ─────────────────────────────
      let isDuplicate = false
      try {
        const existing = await adminApiFetch(req, `/admin/products?handle=${encodeURIComponent(product.handle)}&limit=1`)
        if (existing?.products?.length > 0) {
          isDuplicate = true
        }
      } catch { /* proceed */ }

      if (!isDuplicate && product.external_id) {
        try {
          const existing = await adminApiFetch(req, `/admin/products?external_id=${encodeURIComponent(product.external_id)}&limit=1`)
          if (existing?.products?.length > 0) {
            isDuplicate = true
          }
        } catch { /* proceed */ }
      }

      if (isDuplicate) {
        skipped++
        writeEvent(res, {
          type: "progress",
          current: i + 1, total,
          status: "skipped",
          product_title: product.title,
          product_url: productUrl,
          message: `[${i + 1}/${total}] Skipped (duplicate): ${product.title}`,
        })
        await sleep(500)
        continue
      }

      // ── Resolve tags via Admin API ─────────────────────────────────────
      const resolvedTags: { id: string }[] = []
      for (const tagValue of (product.tags || []).slice(0, 10)) {
        try {
          const listed = await adminApiFetch(req, `/admin/product-tags?value=${encodeURIComponent(tagValue)}&limit=1`)
          const existing = listed?.product_tags?.find(
            (t: any) => t.value.toLowerCase() === tagValue.toLowerCase()
          )
          if (existing?.id) {
            resolvedTags.push({ id: existing.id })
          } else {
            const created = await adminApiFetch(req, `/admin/product-tags`, {
              method: "POST",
              body: { value: tagValue },
            })
            if (created?.product_tag?.id) {
              resolvedTags.push({ id: created.product_tag.id })
            }
          }
        } catch { /* skip tag */ }
      }

      // ── Build variant prices (exactly like single importer) ────────────
      const variantPrice =
        product.price_inr && product.price_inr > 0
          ? [{ currency_code: "inr", amount: Math.round(product.price_inr) }]
          : []

      // ── Create product via Admin API (handles prices correctly) ────────
      const payload: any = {
        title: product.title,
        subtitle: product.subtitle || undefined,
        description: product.description || undefined,
        handle: product.handle,
        status: "published",
        weight: product.weight ?? undefined,
        origin_country: product.origin_country || undefined,
        material: product.material || undefined,
        external_id: product.external_id || undefined,
        sales_channels: salesChannelId ? [{ id: salesChannelId }] : undefined,
        shipping_profile_id: shippingProfileId || undefined,
        metadata: {
          zepto_url: product.raw_url,
          zepto_brand: product.brand,
          zepto_product_type: product.product_type,
          zepto_shelf_life: product.shelf_life || undefined,
          zepto_mrp_inr: product.mrp_inr ?? undefined,
          zepto_extra_details: product.extra_details ?? {},
          zepto_bulk_imported: true,
          zepto_import_date: new Date().toISOString(),
        },
        tags: resolvedTags.length ? resolvedTags : undefined,
        images: product.images?.slice(0, 6).map((u: string) => ({ url: u })) ?? [],
        thumbnail: product.thumbnail || undefined,
        options: [
          { title: "Size", values: product.variants.map((v: any) => v.title) },
        ],
        variants: product.variants.map((v: any) => ({
          title: v.title,
          sku: v.sku || undefined,
          manage_inventory: true,
          allow_backorder: false,
          weight: v.weight ?? undefined,
          origin_country: v.origin_country || undefined,
          material: v.material || undefined,
          options: { Size: v.title },
          prices: variantPrice,
        })),
      }

      const createResult = await adminApiFetch(req, `/admin/products`, {
        method: "POST",
        body: payload,
      })

      const createdProductId = createResult?.product?.id
      if (!createdProductId) {
        throw new Error("Product creation returned no ID")
      }

      // ── Inventory sync (exactly like single importer) ──────────────────
      if (stockLocationId && defaultInventory > 0) {
        try {
          // Retrieve product with inventory items
          const retrieved = await adminApiFetch(
            req,
            `/admin/products/${createdProductId}?fields=*variants.inventory_items`
          )

          const inventoryItemId =
            retrieved?.product?.variants?.[0]?.inventory_items?.[0]?.inventory_item_id

          if (inventoryItemId) {
            try {
              await adminApiFetch(
                req,
                `/admin/inventory-items/${inventoryItemId}/location-levels`,
                {
                  method: "POST",
                  body: {
                    location_id: stockLocationId,
                    stocked_quantity: defaultInventory,
                  },
                }
              )
            } catch (levelErr: any) {
              // If level already exists, try updating it
              console.warn(`[bulk-import] create level failed, trying update:`, levelErr.message)
              try {
                await adminApiFetch(
                  req,
                  `/admin/inventory-items/${inventoryItemId}/location-levels/${stockLocationId}`,
                  {
                    method: "POST",
                    body: { stocked_quantity: defaultInventory },
                  }
                )
              } catch { /* non-critical */ }
            }
          }
        } catch (invErr: any) {
          console.warn(`[bulk-import] Inventory sync failed for ${product.title}: ${invErr.message}`)
        }
      }

      imported++
      writeEvent(res, {
        type: "progress",
        current: i + 1, total,
        status: "success",
        product_title: product.title,
        product_url: productUrl,
        product_id: createdProductId,
        message: `[${i + 1}/${total}] ✓ ${product.title} (₹${product.price_inr ?? "?"})`,
      })
    } catch (err: any) {
      failed++
      const errorMsg = `${productUrl}: ${err.message || "Unknown error"}`
      errors.push(errorMsg)
      console.error(`[bulk-import] Failed:`, errorMsg)

      writeEvent(res, {
        type: "progress",
        current: i + 1, total,
        status: "failed",
        product_url: productUrl,
        error: err.message,
        message: `[${i + 1}/${total}] ✗ ${err.message}`,
      })
    }

    // ── Rate limiting between scrapes ────────────────────────────────
    if (i < total - 1) {
      await sleep(ZeptoConfig.import.scrapeDelayMs)
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────

  writeEvent(res, {
    type: "summary",
    message: `Bulk import complete. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`,
    imported,
    skipped,
    failed,
    errors: errors.slice(0, 20),
  })

  res.end()
}
