/**
 * Zepto Bulk Import UI Component
 * Renders as a separate tab in the Zepto Import admin page.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { Spinner, CheckCircle, ExclamationCircle, ArrowDownTray } from "@medusajs/icons"
import { sdk, backendUrl } from "../lib/sdk.js"

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface BulkImportConfig {
  salesChannelId: string
  shippingProfileId: string
  stockLocationId: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZeptoBulkImport({ config }: { config: BulkImportConfig }) {
  // Mode
  const [importMode, setImportMode] = useState<"sitemap" | "category" | "urls">("sitemap")

  // Sitemap mode
  const [sitemapPage, setSitemapPage] = useState("1")
  const [keyword, setKeyword] = useState("")
  const [maxProducts, setMaxProducts] = useState(20)

  // Category mode
  const [categoryUrl, setCategoryUrl] = useState("")

  // URLs mode
  const [urlsText, setUrlsText] = useState("")

  // Options
  const [useAi, setUseAi] = useState(false) // Off by default for bulk
  const [defaultInventory, setDefaultInventory] = useState(100)

  // State
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<ProgressEvent[]>([])
  const [summary, setSummary] = useState<ProgressEvent | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const handleStartImport = useCallback(async () => {
    setIsRunning(true)
    setLogs([])
    setSummary(null)
    setProgress({ current: 0, total: 0 })

    const body: any = {
      mode: importMode,
      max_products: maxProducts,
      use_ai: useAi,
      default_inventory: defaultInventory,
      sales_channel_id: config.salesChannelId || undefined,
      shipping_profile_id: config.shippingProfileId || undefined,
      stock_location_id: config.stockLocationId || undefined,
    }

    if (importMode === "sitemap") {
      body.sitemap_pages = sitemapPage === "all" ? "all" : [parseInt(sitemapPage)]
      body.keyword = keyword.trim() || undefined
    } else if (importMode === "category") {
      body.category_url = categoryUrl.trim()
    } else if (importMode === "urls") {
      body.product_urls = urlsText
        .split("\n")
        .map((u: string) => u.trim())
        .filter(Boolean)
    }

    try {
      const fullUrl = `${backendUrl.replace(/\/+$/, "")}/admin/zepto-bulk-import`
      const response = await fetch(fullUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`)
      }

      // Read NDJSON stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event: ProgressEvent = JSON.parse(line)
              setLogs((prev) => [...prev, event])

              if (event.type === "progress" && event.current && event.total) {
                setProgress({ current: event.current, total: event.total })
              }

              if (event.type === "summary") {
                setSummary(event)
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const event: ProgressEvent = JSON.parse(buffer)
            setLogs((prev) => [...prev, event])
            if (event.type === "summary") setSummary(event)
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setSummary({
        type: "summary",
        message: `Import failed: ${err.message}`,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [err.message],
      })
    } finally {
      setIsRunning(false)
    }
  }, [importMode, sitemapPage, keyword, maxProducts, categoryUrl, urlsText, useAi, defaultInventory, config])

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="flex flex-col gap-y-4">
      {/* ── Import Mode Selector ──────────────────────────────────────── */}
      <div className="bg-ui-bg-base border border-ui-border-base rounded-xl p-5 shadow-sm">
        <label className="text-sm font-medium text-ui-fg-base mb-3 block">Import Mode</label>
        <div className="flex gap-x-2">
          {(["sitemap", "category", "urls"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setImportMode(mode)}
              disabled={isRunning}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${importMode === mode
                  ? "bg-ui-button-inverted text-ui-fg-on-inverted border-transparent"
                  : "bg-ui-bg-field text-ui-fg-base border-ui-border-base hover:bg-ui-bg-field-hover"
                } disabled:opacity-50`}
            >
              {mode === "sitemap" ? "📦 From Sitemap" : mode === "category" ? "📂 From Category" : "🔗 Paste URLs"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mode-Specific Inputs ──────────────────────────────────────── */}
      <div className="bg-ui-bg-base border border-ui-border-base rounded-xl p-5 shadow-sm flex flex-col gap-y-4">
        {importMode === "sitemap" && (
          <>
            <div className="grid grid-cols-3 gap-x-4">
              <BField label="Sitemap Page (1-24 or all)">
                <select
                  value={sitemapPage}
                  onChange={(e) => setSitemapPage(e.target.value)}
                  disabled={isRunning}
                  className={inputCls}
                >
                  <option value="all">All Pages</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      Page {i + 1}
                    </option>
                  ))}
                </select>
              </BField>
              <BField label="Keyword Filter (optional)">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. milk, atta, dal"
                  disabled={isRunning}
                  className={inputCls}
                />
              </BField>
              <BField label="Max Products">
                <input
                  type="number"
                  value={maxProducts}
                  onChange={(e) => setMaxProducts(Math.max(1, parseInt(e.target.value) || 20))}
                  min={1}
                  max={500}
                  disabled={isRunning}
                  className={inputCls}
                />
              </BField>
            </div>
            <p className="text-xs text-ui-fg-subtle">
              Fetches product URLs from Zepto's public sitemap. Use keyword filter to narrow down results.
            </p>
          </>
        )}

        {importMode === "category" && (
          <>
            <BField label="Zepto Category URL">
              <input
                type="url"
                value={categoryUrl}
                onChange={(e) => setCategoryUrl(e.target.value)}
                placeholder="https://www.zepto.com/cn/dairy-bread-eggs/milk/cid/..."
                disabled={isRunning}
                className={inputCls}
              />
            </BField>
            <BField label="Max Products">
              <input
                type="number"
                value={maxProducts}
                onChange={(e) => setMaxProducts(Math.max(1, parseInt(e.target.value) || 20))}
                min={1}
                max={200}
                disabled={isRunning}
                className={inputCls}
              />
            </BField>
            <p className="text-xs text-ui-fg-subtle">
              Paste a category URL from Zepto to import all products from that category.
            </p>
          </>
        )}

        {importMode === "urls" && (
          <>
            <BField label="Product URLs (one per line)">
              <textarea
                rows={6}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder={"https://www.zepto.com/pn/product-1/pvid/...\nhttps://www.zepto.com/pn/product-2/pvid/..."}
                disabled={isRunning}
                className={inputCls + " resize-y min-h-[120px] font-mono text-xs"}
              />
            </BField>
            <p className="text-xs text-ui-fg-subtle">
              Paste multiple Zepto product URLs, one per line.
            </p>
          </>
        )}

        {/* ── Common Options ──────────────────────────────────────────── */}
        <div className="border-t border-ui-border-base pt-4 mt-1">
          <p className="text-xs font-medium text-ui-fg-subtle uppercase tracking-wide mb-3">Options</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <label className="inline-flex items-center gap-x-2 text-sm text-ui-fg-base cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
                disabled={isRunning}
                className="h-4 w-4 rounded border-ui-border-base"
              />
              AI cleanup (slower, uses Gemini credits)
            </label>
            <BField label="Default Inventory Qty">
              <input
                type="number"
                value={defaultInventory}
                onChange={(e) => setDefaultInventory(Math.max(0, parseInt(e.target.value) || 100))}
                min={0}
                disabled={isRunning}
                className={inputCls}
              />
            </BField>
          </div>
        </div>

        {/* ── Start Button ────────────────────────────────────────────── */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleStartImport}
            disabled={isRunning}
            className="inline-flex items-center gap-x-2 h-10 px-5 rounded-lg bg-ui-button-inverted text-ui-fg-on-inverted text-sm font-medium hover:bg-ui-button-inverted-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? (
              <><Spinner className="animate-spin" /> Importing…</>
            ) : (
              <><ArrowDownTray /> Start Bulk Import</>
            )}
          </button>
        </div>
      </div>

      {/* ── Progress Bar ──────────────────────────────────────────────── */}
      {(isRunning || summary) && progress.total > 0 && (
        <div className="bg-ui-bg-base border border-ui-border-base rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-ui-fg-base">
              Progress: {progress.current} / {progress.total}
            </p>
            <p className="text-sm text-ui-fg-subtle">{progressPercent}%</p>
          </div>
          <div className="w-full h-2 bg-ui-bg-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-ui-button-inverted rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Live Log ──────────────────────────────────────────────────── */}
      {logs.length > 0 && (
        <div className="bg-ui-bg-base border border-ui-border-base rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-ui-border-base">
            <p className="text-sm font-medium text-ui-fg-base">Import Log</p>
          </div>
          <div
            ref={logContainerRef}
            className="max-h-[320px] overflow-y-auto p-4 font-mono text-xs space-y-1"
          >
            {logs.map((log, i) => (
              <div
                key={i}
                className={`flex items-start gap-x-2 py-0.5 ${log.status === "success"
                    ? "text-ui-tag-green-text"
                    : log.status === "skipped"
                      ? "text-ui-tag-orange-text"
                      : log.status === "failed"
                        ? "text-ui-tag-red-text"
                        : "text-ui-fg-subtle"
                  }`}
              >
                <span>
                  {log.status === "success"
                    ? "✅"
                    : log.status === "skipped"
                      ? "⏭️"
                      : log.status === "failed"
                        ? "❌"
                        : log.type === "discovery"
                          ? "🔍"
                          : "⏳"}
                </span>
                <span className="flex-1">{log.message}</span>
                {log.product_id && (
                  <a
                    href={`/app/products/${log.product_id}`}
                    className="text-ui-fg-interactive hover:underline shrink-0"
                    target="_blank"
                  >
                    View →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary ───────────────────────────────────────────────────── */}
      {summary && (
        <div
          className={`rounded-xl border p-5 shadow-sm ${summary.failed === 0 && (summary.imported ?? 0) > 0
              ? "border-ui-tag-green-border bg-ui-tag-green-bg"
              : summary.imported === 0 && summary.failed === 0
                ? "border-ui-border-base bg-ui-bg-subtle"
                : "border-ui-tag-red-border bg-ui-tag-red-bg"
            }`}
        >
          <div className="flex items-start gap-x-2">
            {(summary.imported ?? 0) > 0 ? (
              <CheckCircle className="mt-0.5 text-ui-tag-green-icon shrink-0" />
            ) : (
              <ExclamationCircle className="mt-0.5 text-ui-tag-red-icon shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium">
                {summary.message || "Import complete"}
              </p>
              <div className="flex gap-x-4 mt-2 text-xs">
                <span className="text-ui-tag-green-text font-medium">
                  ✅ Imported: {summary.imported ?? 0}
                </span>
                <span className="text-ui-tag-orange-text font-medium">
                  ⏭️ Skipped: {summary.skipped ?? 0}
                </span>
                <span className="text-ui-tag-red-text font-medium">
                  ❌ Failed: {summary.failed ?? 0}
                </span>
              </div>
              {summary.errors && summary.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-ui-fg-subtle">
                    Show errors ({summary.errors.length})
                  </summary>
                  <ul className="mt-1 text-xs text-ui-tag-red-text space-y-0.5 max-h-32 overflow-y-auto">
                    {summary.errors.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:ring-2 focus:ring-ui-border-interactive disabled:opacity-50"

function BField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <label className="text-xs font-medium text-ui-fg-subtle uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}
