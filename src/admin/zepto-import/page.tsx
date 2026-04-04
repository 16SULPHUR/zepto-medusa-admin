/**
 * Zepto Product Importer — Medusa Admin UI
 *
 * File location (Medusa v2):
 *   src/admin/routes/zepto-import/page.tsx
 *
 * This adds a page at:  /app/zepto-import
 * The sidebar link is registered in src/admin/routes/zepto-import/page.tsx
 * automatically by Medusa v2's file-based routing.
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray, CheckCircle, ExclamationCircle, Spinner, ShoppingBag } from "@medusajs/icons"
import { useState } from "react"

// ── Medusa Admin SDK hooks ────────────────────────────────────────────────────
import { sdk } from "../lib/sdk.js"

// ── Types ─────────────────────────────────────────────────────────────────────
interface ZeptoVariant {
  title: string
  sku: string
  weight: number | null
  origin_country: string
  material: string
}

interface ZeptoProduct {
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

interface AiRefineMeta {
  used: boolean
  provider: "openrouter" | "none"
  model: string | null
  note?: string
}

// ── Route config (registers in Medusa Admin sidebar) ──────────────────────────
export const config = defineRouteConfig({
  label: "Zepto Importer",
  icon: ArrowDownTray,
})

// ── Main page component ────────────────────────────────────────────────────────
export default function ZeptoImportPage() {
  const [url, setUrl] = useState("")
  const [useAi, setUseAi] = useState(true)
  const [fetchState, setFetchState] = useState<"idle" | "fetching" | "done" | "error">("idle")
  const [importState, setImportState] = useState<"idle" | "importing" | "done" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [importedId, setImportedId] = useState("")
  const [editedProduct, setEditedProduct] = useState<ZeptoProduct | null>(null)
  const [aiMeta, setAiMeta] = useState<AiRefineMeta | null>(null)

  function detailsToText(details?: Record<string, string>) {
    const entries = Object.entries(details ?? {})
      .filter(([k, v]) => k.trim() && String(v).trim())
      .slice(0, 80)

    return entries.map(([k, v]) => `${k}: ${v}`).join("\n")
  }

  function textToDetails(text: string): Record<string, string> {
    const details: Record<string, string> = {}

    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf(":")
        if (idx < 1) {
          return
        }

        const key = line.slice(0, idx).trim().toLowerCase()
        const value = line.slice(idx + 1).trim()
        if (key && value) {
          details[key] = value
        }
      })

    return details
  }

  // ── Step 1: Fetch product details from backend ─────────────────────────────
  async function handleFetch() {
    if (!url.trim()) return
    setFetchState("fetching")
    setEditedProduct(null)
    setAiMeta(null)
    setImportState("idle")
    setErrorMsg("")

    try {
      const res = await fetch("/admin/zepto-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          url: url.trim(),
          use_ai: useAi,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to fetch product")
      setAiMeta(data.ai ?? null)
      setEditedProduct({
        ...data.product,
        tags: data.product?.tags ?? [],
        images: data.product?.images ?? [],
        variants: data.product?.variants ?? [],
        inventory_quantity: data.product?.inventory_quantity ?? 0,
        extra_details: data.product?.extra_details ?? {},
      })
      setFetchState("done")
    } catch (err: any) {
      setErrorMsg(err.message)
      setFetchState("error")
    }
  }

  // ── Step 2: Create product in Medusa ──────────────────────────────────────
  async function handleImport() {
    if (!editedProduct) return
    setImportState("importing")
    setErrorMsg("")

    try {
      const tagValues = Array.from(
        new Set((editedProduct.tags ?? []).map((t) => t.trim()).filter(Boolean))
      )

      const resolvedTags: { id: string }[] = []

      for (const value of tagValues) {
        const listed = await sdk.admin.productTag.list({ value, limit: 1 })
        const existing = listed.product_tags?.find(
          (tag) => tag.value.toLowerCase() === value.toLowerCase()
        )

        if (existing?.id) {
          resolvedTags.push({ id: existing.id })
          continue
        }

        const created = await sdk.admin.productTag.create({ value })
        if (created.product_tag?.id) {
          resolvedTags.push({ id: created.product_tag.id })
        }
      }

      const variantPrice =
        editedProduct.price_inr && editedProduct.price_inr > 0
          ? [{ currency_code: "inr", amount: Math.round(editedProduct.price_inr) }]
          : []

      // Build Medusa v2 product payload
      const payload: any = {
        title: editedProduct.title,
        subtitle: editedProduct.subtitle || undefined,
        description: editedProduct.description || undefined,
        handle: editedProduct.handle,
        status: "published",
        weight: editedProduct.weight ?? undefined,
        origin_country: editedProduct.origin_country || undefined,
        material: editedProduct.material || undefined,
        external_id: editedProduct.external_id || undefined,
        metadata: {
          zepto_url: editedProduct.raw_url,
          zepto_brand: editedProduct.brand,
          zepto_product_type: editedProduct.product_type,
          zepto_shelf_life: editedProduct.shelf_life || undefined,
          zepto_mrp_inr: editedProduct.mrp_inr ?? undefined,
          zepto_extra_details: editedProduct.extra_details ?? {},
        },
        tags: resolvedTags.length ? resolvedTags : undefined,
        images: editedProduct.images?.slice(0, 6).map((url) => ({ url })) ?? [],
        thumbnail: editedProduct.thumbnail || undefined,
        options: [{ title: "Size", values: editedProduct.variants.map((v) => v.title) }],
        variants: editedProduct.variants.map((v) => ({
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

      const result = await sdk.admin.product.create(payload)

      // Best-effort inventory sync for first stock location.
      const qty = editedProduct.inventory_quantity ?? 0
      if (qty > 0) {
        try {
          const stockLocations = await sdk.admin.stockLocation.list({ limit: 1 })
          const locationId = stockLocations.stock_locations?.[0]?.id

          if (locationId) {
            const createdProduct = await sdk.admin.product.retrieve(result.product.id, {
              fields: "id,*variants,+variants.inventory_items",
            } as any)

            const inventoryItemId = createdProduct.product?.variants?.[0]?.inventory_items?.[0]?.inventory_item_id

            if (inventoryItemId) {
              await sdk.admin.inventoryItem.updateLevel(inventoryItemId, locationId, {
                stocked_quantity: qty,
              })
            }
          }
        } catch (inventoryErr) {
          console.warn("[zepto-import] inventory sync skipped:", inventoryErr)
        }
      }

      setImportedId(result.product.id)
      setImportState("done")
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create product in Medusa")
      setImportState("error")
    }
  }

  function updateField(key: keyof ZeptoProduct, value: any) {
    setEditedProduct((prev) => prev ? { ...prev, [key]: value } : prev)
  }

  return (
    <div className="flex flex-col gap-y-6 p-6 max-w-4xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-x-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
          <ShoppingBag className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ui-fg-base">Zepto Product Importer</h1>
          <p className="text-sm text-ui-fg-subtle">
            Paste a Zepto product URL to fetch and import it directly into Medusa
          </p>
        </div>
      </div>

      {/* ── URL Input ──────────────────────────────────────────────────────── */}
      <div className="bg-ui-bg-base border border-ui-border-base rounded-xl p-5 flex flex-col gap-y-4 shadow-sm">
        <label className="text-sm font-medium text-ui-fg-base">Zepto Product URL</label>
        <div className="flex gap-x-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFetch()}
            placeholder="https://www.zepto.com/pn/product-name/pvid/..."
            className="flex-1 h-10 rounded-lg border border-ui-border-base bg-ui-bg-field px-3 text-sm text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:ring-2 focus:ring-ui-border-interactive"
          />
          <button
            onClick={handleFetch}
            disabled={fetchState === "fetching" || !url.trim()}
            className="inline-flex items-center gap-x-2 h-10 px-4 rounded-lg bg-ui-button-neutral text-ui-fg-base text-sm font-medium border border-ui-border-base hover:bg-ui-button-neutral-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {fetchState === "fetching" ? (
              <><Spinner className="animate-spin" /> Fetching…</>
            ) : (
              <><ArrowDownTray /> Fetch Product</>
            )}
          </button>
        </div>

        <div className="flex flex-col gap-y-1">
          <label className="inline-flex items-center gap-x-2 text-sm text-ui-fg-base cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              className="h-4 w-4 rounded border-ui-border-base"
            />
            Use AI cleanup (OpenRouter free model)
          </label>
          <p className="text-xs text-ui-fg-subtle">
            Set OPENROUTER_API_KEY in your backend env for best cleanup quality.
          </p>
        </div>

        {fetchState === "done" && aiMeta && (
          <div
            className={
              aiMeta.used
                ? "rounded-lg border border-ui-tag-green-border bg-ui-tag-green-bg p-3"
                : "rounded-lg border border-ui-tag-red-border bg-ui-tag-red-bg p-3"
            }
          >
            <p
              className={
                aiMeta.used
                  ? "text-sm font-medium text-ui-tag-green-text"
                  : "text-sm font-medium text-ui-tag-red-text"
              }
            >
              {aiMeta.used
                ? `AI cleanup applied (${aiMeta.model || "OpenRouter"})`
                : "AI cleanup not applied"}
            </p>
            {aiMeta.note && (
              <p
                className={
                  aiMeta.used
                    ? "mt-1 text-xs text-ui-tag-green-text"
                    : "mt-1 text-xs text-ui-tag-red-text"
                }
              >
                {aiMeta.note}
              </p>
            )}
          </div>
        )}

        {/* Error message */}
        {(fetchState === "error" || importState === "error") && (
          <div className="flex items-start gap-x-2 rounded-lg border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
            <ExclamationCircle className="mt-0.5 text-ui-tag-red-icon shrink-0" />
            <p className="text-sm text-ui-tag-red-text">{errorMsg}</p>
          </div>
        )}

        {/* Success message */}
        {importState === "done" && (
          <div className="flex items-start gap-x-2 rounded-lg border border-ui-tag-green-border bg-ui-tag-green-bg p-3">
            <CheckCircle className="mt-0.5 text-ui-tag-green-icon shrink-0" />
            <div>
              <p className="text-sm font-medium text-ui-tag-green-text">Product imported successfully!</p>
              <a
                href={`/products/${importedId}`}
                className="text-sm text-ui-tag-green-text underline"
              >
                View product →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Product Preview + Edit ─────────────────────────────────────────── */}
      {editedProduct && fetchState === "done" && (
        <div className="flex flex-col gap-y-4">
          {/* Product card header */}
          <div className="bg-ui-bg-base border border-ui-border-base rounded-xl overflow-hidden shadow-sm">
            <div className="flex items-start gap-x-4 p-5 border-b border-ui-border-base">
              {editedProduct.thumbnail && (
                <img
                  src={editedProduct.thumbnail}
                  alt={editedProduct.title}
                  className="w-24 h-24 rounded-lg object-cover border border-ui-border-base bg-ui-bg-subtle flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-x-2 mb-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ui-tag-green-bg text-ui-tag-green-text border border-ui-tag-green-border">
                    Fetched from Zepto
                  </span>
                  {editedProduct.price_inr && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ui-tag-blue-bg text-ui-tag-blue-text border border-ui-tag-blue-border">
                      ₹{editedProduct.price_inr} (MRP ₹{editedProduct.mrp_inr})
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold text-ui-fg-base leading-tight mb-1">
                  {editedProduct.title}
                </h2>
                <p className="text-sm text-ui-fg-subtle">{editedProduct.brand}</p>
              </div>
            </div>

            {/* Editable fields */}
            <div className="p-5 grid grid-cols-1 gap-y-4">
              <Field label="Title">
                <input
                  type="text"
                  value={editedProduct.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="Handle (slug)">
                <input
                  type="text"
                  value={editedProduct.handle}
                  onChange={(e) => updateField("handle", e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="Description">
                <textarea
                  rows={4}
                  value={editedProduct.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={inputCls + " resize-y min-h-[80px]"}
                />
              </Field>

              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Brand">
                  <input
                    type="text"
                    value={editedProduct.brand}
                    onChange={(e) => updateField("brand", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Product Type">
                  <input
                    type="text"
                    value={editedProduct.product_type}
                    onChange={(e) => updateField("product_type", e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-x-4">
                <Field label="Weight (g)">
                  <input
                    type="number"
                    value={editedProduct.weight ?? ""}
                    onChange={(e) => updateField("weight", parseInt(e.target.value) || null)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Origin Country">
                  <input
                    type="text"
                    value={editedProduct.origin_country}
                    onChange={(e) => updateField("origin_country", e.target.value)}
                    className={inputCls}
                    maxLength={2}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-x-4">
                <Field label="Selling Price (INR)">
                  <input
                    type="number"
                    value={editedProduct.price_inr ?? ""}
                    onChange={(e) => updateField("price_inr", parseInt(e.target.value) || null)}
                    className={inputCls}
                  />
                </Field>
                <Field label="MRP (INR)">
                  <input
                    type="number"
                    value={editedProduct.mrp_inr ?? ""}
                    onChange={(e) => updateField("mrp_inr", parseInt(e.target.value) || null)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Inventory Qty">
                  <input
                    type="number"
                    value={editedProduct.inventory_quantity ?? 0}
                    min={0}
                    onChange={(e) => updateField("inventory_quantity", Math.max(0, parseInt(e.target.value) || 0))}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Material">
                <input
                  type="text"
                  value={editedProduct.material}
                  onChange={(e) => updateField("material", e.target.value)}
                  className={inputCls}
                />
              </Field>

              <Field label="Tags (comma separated)">
                <input
                  type="text"
                  value={editedProduct.tags.join(", ")}
                  onChange={(e) =>
                    updateField("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
                  }
                  className={inputCls}
                />
              </Field>

              <Field label="Extra Details (key: value per line)">
                <textarea
                  rows={8}
                  value={detailsToText(editedProduct.extra_details)}
                  onChange={(e) => updateField("extra_details", textToDetails(e.target.value))}
                  className={inputCls + " resize-y min-h-[120px]"}
                />
              </Field>
            </div>

            {/* Variants preview */}
            {editedProduct.variants.length > 0 && (
              <div className="border-t border-ui-border-base p-5">
                <p className="text-sm font-medium text-ui-fg-base mb-3">Variants ({editedProduct.variants.length})</p>
                <div className="flex flex-col gap-y-2">
                  {editedProduct.variants.map((v, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                      <span className="text-sm font-medium text-ui-fg-base">{v.title}</span>
                      <span className="text-xs text-ui-fg-muted font-mono">{v.sku}</span>
                      {v.weight && <span className="text-xs text-ui-fg-muted">{v.weight}g</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Images preview */}
            {editedProduct.images.length > 0 && (
              <div className="border-t border-ui-border-base p-5">
                <p className="text-sm font-medium text-ui-fg-base mb-3">Images ({editedProduct.images.length})</p>
                <div className="flex flex-wrap gap-2">
                  {editedProduct.images.slice(0, 6).map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt={`Product image ${i + 1}`}
                      className="w-16 h-16 rounded-lg object-cover border border-ui-border-base bg-ui-bg-subtle"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Import button ────────────────────────────────────────────── */}
          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={importState === "importing" || importState === "done"}
              className="inline-flex items-center gap-x-2 h-10 px-5 rounded-lg bg-ui-button-inverted text-ui-fg-on-inverted text-sm font-medium hover:bg-ui-button-inverted-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importState === "importing" ? (
                <><Spinner className="animate-spin" /> Importing…</>
              ) : importState === "done" ? (
                <><CheckCircle /> Imported!</>
              ) : (
                <>Create Product in Medusa</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tiny helpers ───────────────────────────────────────────────────────────────
const inputCls =
  "w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:ring-2 focus:ring-ui-border-interactive"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <label className="text-xs font-medium text-ui-fg-subtle uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
