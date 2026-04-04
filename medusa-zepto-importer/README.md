# Zepto Product Importer for Medusa v2

Import products from Zepto directly into your Medusa backend with a single URL.

---

## What's included

| File | Purpose |
|------|---------|
| `src/api/admin/zepto-import/route.ts` | Custom admin API route — scrapes Zepto server-side |
| `src/lib/zepto-scraper.ts` | Node.js scraper (fetch + cheerio) |
| `src/admin/routes/zepto-import/page.tsx` | Medusa Admin UI page with edit + import flow |

---

## Setup

### 1. Install dependencies

```bash
npm install cheerio node-fetch
npm install --save-dev @types/cheerio
```

### 2. Copy files into your Medusa v2 project

```
your-medusa-project/
├── src/
│   ├── api/
│   │   └── admin/
│   │       └── zepto-import/
│   │           └── route.ts        ← copy here
│   ├── lib/
│   │   └── zepto-scraper.ts        ← copy here
│   └── admin/
│       └── routes/
│           └── zepto-import/
│               └── page.tsx        ← copy here
```

### 3. Restart your Medusa dev server

```bash
npx medusa develop
```

### 4. Open the importer

Navigate to: **http://localhost:9000/app/zepto-import**

You'll see "Zepto Importer" in the admin sidebar.

---

## How to use

1. Paste any Zepto product URL into the input box
2. Click **Fetch Product** — the backend scrapes Zepto and extracts all available details
3. Review and edit the prefilled fields (title, description, weight, tags, etc.)
4. Click **Create Product in Medusa** — the product is created instantly

---

## Notes

- **Prices**: Zepto prices are in INR. The importer stores the price info in the description for reference. 
  To set actual prices, use Medusa's pricing module after import (multi-currency support).
- **Images**: Up to 6 product images are imported from Zepto's CDN.
- **Variants**: The scraper creates one variant per product by default (based on the unit/size listed).
- **Scraping reliability**: Zepto's HTML structure may change. If scraping fails, check `zepto-scraper.ts` selectors.

---

## Extending to other marketplaces

To add support for more URLs (e.g. Blinkit, BigBasket), add a scraper in `src/lib/` and update `route.ts`:

```ts
import { scrapeBlinkitProduct } from "../../../lib/blinkit-scraper"

if (url.includes("blinkit.com")) {
  productData = await scrapeBlinkitProduct(url)
}
```
