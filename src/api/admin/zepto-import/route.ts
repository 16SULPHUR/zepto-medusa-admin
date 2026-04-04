
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { scrapeZeptoProduct } from "../../../lib/zepto-scraper"
import { refineZeptoProduct } from "../../../lib/zepto-ai-refiner"

type ZeptoImportBody = {
  url?: string
  use_ai?: boolean
}

// POST /admin/zepto-import
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { url, use_ai } = (req.body ?? {}) as ZeptoImportBody
  const normalizedUrl = String(url ?? "").trim()

  if (!normalizedUrl || !/^https?:\/\/([a-z0-9-]+\.)*zepto\.com\//i.test(normalizedUrl)) {
    return res.status(400).json({ error: "Please provide a valid Zepto product URL." })
  }

  try {
    const scrapedProduct = await scrapeZeptoProduct(normalizedUrl)
    const refined = await refineZeptoProduct(scrapedProduct, {
      useAi: use_ai !== false,
    })

    return res.status(200).json({
      product: refined.product,
      ai: refined.ai,
    })
  } catch (err: any) {
    console.error("[zepto-import] scrape error:", err.message)
    return res.status(500).json({ error: err.message || "Failed to fetch product from Zepto." })
  }
}
