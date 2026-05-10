/**
 * zepto-sitemap.ts
 * Parses Zepto's public sitemaps to extract product URLs for bulk import.
 *
 * Sitemap structure:
 *   /sitemap/products.xml → index pointing to products_1.xml … products_24.xml
 *   /sitemap/categories.xml → all category/subcategory URLs
 *
 * Product URL pattern:
 *   https://www.zepto.com/pn/{product-slug}/pvid/{uuid}
 *
 * Category URL pattern:
 *   https://www.zepto.com/cn/{category}/{subcategory}/cid/{uuid}/scid/{uuid}
 */

import * as cheerio from "cheerio"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SitemapProductUrl {
  url: string
  lastmod?: string
}

export interface SitemapCategory {
  url: string
  category: string
  subcategory: string
  lastmod?: string
}

export interface SitemapDiscoveryResult {
  urls: string[]
  source: "sitemap" | "category"
  totalFound: number
  filtered: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRODUCTS_SITEMAP_INDEX = "https://www.zepto.com/sitemap/products.xml"
const CATEGORIES_SITEMAP = "https://www.zepto.com/sitemap/categories.xml"
const PRODUCT_URL_PATTERN = /\/pn\/[^/]+\/pvid\/[a-f0-9-]+/i

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchXml(url: string): Promise<string> {
  const fetch = (await import("node-fetch")).default
  const res = await fetch(url, { headers: FETCH_HEADERS })

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
  }

  return res.text()
}

function extractUrlsFromXml(xml: string): string[] {
  const urls: string[] = []
  // Match <loc>...</loc> tags
  const locRegex = /<loc>\s*(https?:\/\/[^<]+?)\s*<\/loc>/gi
  let match: RegExpExecArray | null

  while ((match = locRegex.exec(xml)) !== null) {
    urls.push(match[1].trim())
  }

  return urls
}

// ─── Product Sitemap Parsing ─────────────────────────────────────────────────

/**
 * Get the list of product sitemap page URLs (products_1.xml through products_24.xml)
 */
export async function getProductSitemapPages(): Promise<string[]> {
  const xml = await fetchXml(PRODUCTS_SITEMAP_INDEX)
  return extractUrlsFromXml(xml).filter((u) => u.includes("/products/products_"))
}

/**
 * Extract product URLs from a single sitemap page (e.g. products_3.xml)
 */
export async function getProductUrlsFromSitemapPage(
  sitemapPageUrl: string,
  options?: {
    keyword?: string
    maxProducts?: number
  }
): Promise<SitemapDiscoveryResult> {
  const xml = await fetchXml(sitemapPageUrl)
  let urls = extractUrlsFromXml(xml).filter((u) => PRODUCT_URL_PATTERN.test(u))

  const totalFound = urls.length

  // Filter by keyword if provided
  if (options?.keyword) {
    const kw = options.keyword.toLowerCase()
    urls = urls.filter((u) => u.toLowerCase().includes(kw))
  }

  // Limit
  if (options?.maxProducts && options.maxProducts > 0) {
    urls = urls.slice(0, options.maxProducts)
  }

  return {
    urls,
    source: "sitemap",
    totalFound,
    filtered: urls.length,
  }
}

/**
 * Get product URLs from multiple sitemap pages at once.
 * @param pages Array of page numbers (1-24) or "all" for all pages
 */
export async function getProductUrlsFromSitemap(
  pages: number[] | "all",
  options?: {
    keyword?: string
    maxProducts?: number
  }
): Promise<SitemapDiscoveryResult> {
  const allSitemapPages = await getProductSitemapPages()

  let targetPages: string[]
  if (pages === "all") {
    targetPages = allSitemapPages
  } else {
    targetPages = pages
      .map((n) => allSitemapPages.find((u) => u.includes(`products_${n}.xml`)))
      .filter(Boolean) as string[]
  }

  let allUrls: string[] = []
  let totalFound = 0

  for (const pageUrl of targetPages) {
    try {
      const result = await getProductUrlsFromSitemapPage(pageUrl, {
        keyword: options?.keyword,
        // Don't limit individual pages — limit the total at the end
      })
      allUrls.push(...result.urls)
      totalFound += result.totalFound
    } catch (err: any) {
      console.warn(`[sitemap] Failed to fetch ${pageUrl}: ${err.message}`)
    }
  }

  // Apply global limit
  if (options?.maxProducts && options.maxProducts > 0) {
    allUrls = allUrls.slice(0, options.maxProducts)
  }

  return {
    urls: allUrls,
    source: "sitemap",
    totalFound,
    filtered: allUrls.length,
  }
}

// ─── Category Page Parsing ───────────────────────────────────────────────────

/**
 * Fetch all available categories from Zepto's category sitemap.
 */
export async function getCategories(): Promise<SitemapCategory[]> {
  const xml = await fetchXml(CATEGORIES_SITEMAP)
  const urls = extractUrlsFromXml(xml)

  return urls
    .map((url) => {
      // Pattern: /cn/{category}/{subcategory}/cid/{uuid}/scid/{uuid}
      const match = url.match(/\/cn\/([^/]+)\/([^/]+)\/cid\//)
      if (!match) return null

      return {
        url,
        category: match[1].replace(/-/g, " "),
        subcategory: match[2].replace(/-/g, " "),
      } as SitemapCategory
    })
    .filter(Boolean) as SitemapCategory[]
}

/**
 * Get a curated list of grocery/supermart relevant category slugs.
 * Used to filter the full category list for "Ashapura" store.
 */
export function getGroceryCategories(): string[] {
  return [
    "fruits-vegetables",
    "dairy-bread-eggs",
    "atta-rice-oil-dals",
    "masala-dry-fruits-more",
    "breakfast-sauces",
    "tea-coffee-more",
    "cold-drinks-juices",
    "munchies",
    "sweet-cravings",
    "biscuits",
    "packaged-food",
    "frozen-food",
    "ice-creams-more",
    "cleaning-essentials",
    "bath-body",
    "hair-care",
    "skincare",
    "home-needs",
    "pharma-wellness",
    "pet-care",
    "meats-fish-eggs",
    "feminine-hygiene",
    "fragrances-grooming",
    "protein-nutrition",
  ]
}

/**
 * Scrape a Zepto category page to extract product URLs from it.
 * Category pages are JS-rendered, so we look for product links in the HTML
 * and also in embedded JSON data.
 */
export async function getProductUrlsFromCategoryPage(
  categoryUrl: string,
  options?: {
    maxProducts?: number
  }
): Promise<SitemapDiscoveryResult> {
  const fetch = (await import("node-fetch")).default
  const res = await fetch(categoryUrl, { headers: { ...FETCH_HEADERS, Referer: "https://www.zepto.com/" } })

  if (!res.ok) {
    throw new Error(`Failed to fetch category page: HTTP ${res.status}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  const productUrls = new Set<string>()

  // Method 1: Look for <a> tags with product URLs
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || ""
    if (PRODUCT_URL_PATTERN.test(href)) {
      const fullUrl = href.startsWith("http") ? href : `https://www.zepto.com${href}`
      productUrls.add(fullUrl)
    }
  })

  // Method 2: Look for product URLs in embedded JSON / __NEXT_DATA__
  const nextDataScript = $('script#__NEXT_DATA__').html() || ""
  if (nextDataScript) {
    const urlMatches = nextDataScript.match(/https?:\/\/(?:www\.)?zepto\.com\/pn\/[^"\\]+/g) || []
    for (const url of urlMatches) {
      productUrls.add(url)
    }
  }

  // Method 3: Search raw HTML for product URL patterns
  const rawMatches = html.match(/https?:\/\/(?:www\.)?zepto\.com\/pn\/[^"\\<>\s]+/g) || []
  for (const url of rawMatches) {
    productUrls.add(url.replace(/[\\'"]/g, ""))
  }

  let urls = Array.from(productUrls)
  const totalFound = urls.length

  if (options?.maxProducts && options.maxProducts > 0) {
    urls = urls.slice(0, options.maxProducts)
  }

  return {
    urls,
    source: "category",
    totalFound,
    filtered: urls.length,
  }
}
