import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { scrapeZeptoProduct } from "../../../lib/zepto-scraper"

// POST /admin/zepto-import
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { url } = req.body as { url: string }

  if (!url || !url.includes("zepto.com")) {
    return res.status(400).json({ error: "Please provide a valid Zepto product URL." })
  }

  try {
    const productData = await scrapeZeptoProduct(url)
    return res.status(200).json({ product: productData })
  } catch (err: any) {
    console.error("[zepto-import] scrape error:", err.message)
    return res.status(500).json({ error: err.message || "Failed to fetch product from Zepto." })
  }
}
