"use strict";
/**
 * zepto-scraper.ts
 * Server-side scraper for Zepto product pages.
 * Uses node-fetch to grab the HTML and extracts structured
 * product data from the embedded JSON-LD / page content.
 *
 * Install deps:  npm install node-fetch cheerio
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeZeptoProduct = scrapeZeptoProduct;
const cheerio = __importStar(require("cheerio"));
function normalizeSpace(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value.replace(/\s+/g, " ").trim();
}
function sanitizeValue(value, maxLen = 220) {
    if (typeof value !== "string") {
        return "";
    }
    const cleaned = normalizeSpace(value
        .replace(/<[^>]+>/g, " ")
        .replace(/\\u003c|\\u003e|\\u002f/gi, " "));
    if (!cleaned) {
        return "";
    }
    // Ignore serialized JSON / broken script fragments that leak into text extraction.
    if (cleaned.includes("\"key\"") ||
        cleaned.includes("\":") ||
        cleaned.includes("{\"") ||
        cleaned.includes("__NEXT_DATA__")) {
        return "";
    }
    const punctuationCount = (cleaned.match(/[{}\[\]"\\]/g) ?? []).length;
    if (punctuationCount > cleaned.length * 0.16) {
        return "";
    }
    if (/^[^a-zA-Z0-9]+$/.test(cleaned)) {
        return "";
    }
    if (cleaned.length > maxLen) {
        return cleaned.slice(0, maxLen).trim();
    }
    return cleaned;
}
function tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function collectJsonLdProducts(node, bucket) {
    if (!node) {
        return;
    }
    if (Array.isArray(node)) {
        for (const item of node) {
            collectJsonLdProducts(item, bucket);
        }
        return;
    }
    if (typeof node !== "object") {
        return;
    }
    const obj = node;
    const typeValue = String(obj["@type"] ?? "").toLowerCase();
    const hasProductShape = Boolean(obj.name && (obj.offers || obj.image || obj.brand));
    if (typeValue.includes("product") || hasProductShape) {
        bucket.push(obj);
    }
    if (obj["@graph"]) {
        collectJsonLdProducts(obj["@graph"], bucket);
    }
    if (obj.mainEntity) {
        collectJsonLdProducts(obj.mainEntity, bucket);
    }
    if (obj.itemListElement) {
        collectJsonLdProducts(obj.itemListElement, bucket);
    }
}
function extractProductFromJsonLd($) {
    const products = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim();
        if (!raw) {
            return;
        }
        const parsed = tryParseJson(raw);
        if (!parsed) {
            return;
        }
        collectJsonLdProducts(parsed, products);
    });
    return products[0] ?? {};
}
function pickFirstNonEmpty(...values) {
    for (const value of values) {
        const cleaned = sanitizeValue(value ?? "");
        if (cleaned) {
            return cleaned;
        }
    }
    return "";
}
function normalizeImageUrl(url) {
    const cleaned = normalizeSpace(url);
    if (!cleaned) {
        return "";
    }
    if (cleaned.startsWith("//")) {
        return `https:${cleaned}`;
    }
    if (/^https?:\/\//i.test(cleaned)) {
        return cleaned;
    }
    return "";
}
function extractVisibleText($) {
    const clonedBody = $("body").clone();
    clonedBody.find("script, style, noscript, template").remove();
    return normalizeSpace(clonedBody.text());
}
function extractFirstNumber(text, regex) {
    const match = text.match(regex);
    if (!match?.[1]) {
        return null;
    }
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
}
function parseNumberish(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== "string") {
        return null;
    }
    const num = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(num) ? num : null;
}
function parseWeight(unit) {
    let weight = null;
    const kgMatch = unit.match(/([\d.]+)\s*kg/i);
    const gMatch = unit.match(/([\d.]+)\s*g(?:\b|$)/i);
    const mlMatch = unit.match(/([\d.]+)\s*ml/i);
    const lMatch = unit.match(/([\d.]+)\s*[lL](?:\b|$)/);
    if (kgMatch) {
        weight = Math.round(parseFloat(kgMatch[1]) * 1000);
    }
    else if (gMatch) {
        weight = Math.round(parseFloat(gMatch[1]));
    }
    else if (mlMatch) {
        weight = Math.round(parseFloat(mlMatch[1]));
    }
    else if (lMatch) {
        weight = Math.round(parseFloat(lMatch[1]) * 1000);
    }
    return weight;
}
function extractUnitFromText(text) {
    const match = text.match(/(\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pcs?|pc|packs?|tablets?|capsules?))/i);
    return sanitizeValue(match?.[1] ?? "", 60);
}
function normalizeCountryCode(value) {
    const compact = value.toUpperCase().replace(/[^A-Z]/g, "");
    if (compact.length === 2) {
        return compact;
    }
    if (/india|bharat/i.test(value)) {
        return "IN";
    }
    return "IN";
}
function buildHandle(title, fallback) {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return slug || fallback;
}
function normalizeTags(values) {
    const tags = [];
    const seen = new Set();
    for (const raw of values) {
        if (typeof raw !== "string") {
            continue;
        }
        const cleaned = normalizeSpace(raw)
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\s/g, "-");
        if (!cleaned || cleaned.length < 2 || cleaned.length > 32 || seen.has(cleaned)) {
            continue;
        }
        seen.add(cleaned);
        tags.push(cleaned);
        if (tags.length >= 10) {
            break;
        }
    }
    return tags;
}
function skuPart(value, maxLen) {
    return normalizeSpace(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, maxLen);
}
function buildSku(brand, unit, externalId) {
    const parts = [
        skuPart(brand, 12),
        skuPart(unit, 16),
        skuPart(externalId, 8),
    ].filter(Boolean);
    if (parts.length > 0) {
        return parts.join("-");
    }
    return `ZEPTO-${Date.now()}`;
}
function extractKeyValuePairsFromRawJson(raw, blockName) {
    const result = {};
    const blockRegex = new RegExp(`\"${blockName}\"\\s*:\\s*\\[(.*?)\\]`, "s");
    const blockMatch = raw.match(blockRegex);
    if (!blockMatch?.[1]) {
        return result;
    }
    const itemRegex = /\"key\"\s*:\s*\"([^\"]+)\"\s*,\s*\"value\"\s*:\s*\"([^\"]*)\"/g;
    let match = itemRegex.exec(blockMatch[1]);
    while (match) {
        const key = normalizeSpace(match[1]).toLowerCase();
        const value = sanitizeValue(match[2]);
        if (key && value && !result[key]) {
            result[key] = value;
        }
        match = itemRegex.exec(blockMatch[1]);
    }
    return result;
}
// ──────────────────────────────────────────────────────────────────────────────
// Main scrape function
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeZeptoProduct(url) {
    const fetch = (await import("node-fetch")).default;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: "https://www.zepto.com/",
        },
    });
    if (!res.ok) {
        throw new Error(`Zepto returned HTTP ${res.status} for URL: ${url}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const visibleText = extractVisibleText($);
    const productJsonLd = extractProductFromJsonLd($);
    // ── Extract product variant ID from URL ────────────────────────────────────
    const pvid = url.match(/pvid\/([a-f0-9-]+)/)?.[1] ?? "";
    const jsonLdBrand = sanitizeValue(typeof productJsonLd.brand === "string"
        ? productJsonLd.brand
        : productJsonLd.brand?.name ?? "", 80);
    const jsonLdDescription = sanitizeValue(productJsonLd.description ?? "", 320);
    const jsonLdCategory = sanitizeValue(productJsonLd.category ?? "", 80);
    const rawJsonLdImages = Array.isArray(productJsonLd.image)
        ? productJsonLd.image
        : productJsonLd.image
            ? [productJsonLd.image]
            : [];
    const jsonLdImages = rawJsonLdImages
        .map((image) => normalizeImageUrl(String(image)))
        .filter(Boolean);
    const primaryOffer = Array.isArray(productJsonLd.offers)
        ? productJsonLd.offers[0]
        : productJsonLd.offers;
    const jsonLdPrice = parseNumberish(primaryOffer?.price);
    const jsonLdMrp = parseNumberish(primaryOffer?.priceSpecification?.price) ??
        parseNumberish(primaryOffer?.highPrice);
    // ── Title ──────────────────────────────────────────────────────────────────
    const title = pickFirstNonEmpty(productJsonLd.name, $("h1").first().text().trim(), $('meta[property="og:title"]').attr("content"), $('meta[name="twitter:title"]').attr("content"));
    // ── Images ─────────────────────────────────────────────────────────────────
    const images = [];
    for (const image of jsonLdImages) {
        if (!images.includes(image)) {
            images.push(image);
        }
    }
    $("img").each((_, el) => {
        const src = normalizeImageUrl($(el).attr("src") || $(el).attr("data-src") || "");
        if (!src) {
            return;
        }
        if (src.includes("cms/product_variant") || src.includes("zeptonow.com") || src.includes("zepto.com")) {
            if (!images.includes(src))
                images.push(src);
        }
    });
    const ogImage = normalizeImageUrl($('meta[property="og:image"]').attr("content") || "");
    const thumbnail = ogImage || images[0] || "";
    if (thumbnail && !images.includes(thumbnail)) {
        images.unshift(thumbnail);
    }
    const limitedImages = images.slice(0, 12);
    // ── Structured key-value extraction from embedded JSON ────────────────────
    const highlights = extractKeyValuePairsFromRawJson(html, "highlights");
    const information = extractKeyValuePairsFromRawJson(html, "information");
    function extractAfterLabel(label) {
        const re = new RegExp(`${label}[:\\s]+([^|.]{1,160})`, "i");
        return sanitizeValue(visibleText.match(re)?.[1] ?? "");
    }
    const brand = pickFirstNonEmpty(highlights["brand"], jsonLdBrand, $("a[href*='/brand/']").first().text().trim(), extractAfterLabel("brand"), sanitizeValue(html.match(/\"brand\"\s*:\s*\"([^\"]+)\"/)?.[1] ?? ""));
    const productType = pickFirstNonEmpty(highlights["product type"], highlights["type"], jsonLdCategory, extractAfterLabel("product type"));
    const material = pickFirstNonEmpty(highlights["material type free"], highlights["material"]);
    const keyFeatures = pickFirstNonEmpty(highlights["key features"], highlights["features"], extractAfterLabel("key features"));
    const usageInstruction = pickFirstNonEmpty(highlights["usage instruction"], extractAfterLabel("usage instruction"));
    const fragrance = pickFirstNonEmpty(highlights["fragrance"], extractAfterLabel("fragrance"));
    const unitFromTitle = extractUnitFromText(title);
    const unit = pickFirstNonEmpty(highlights["unit"], highlights["net qty"], unitFromTitle, sanitizeValue(visibleText.match(/Net Qty[:\s]+([^|]{1,120})/i)?.[1] ?? ""));
    const packagingType = pickFirstNonEmpty(highlights["packaging type"], extractAfterLabel("packaging type"));
    const hypoallergenic = pickFirstNonEmpty(highlights["hypoallergenic"], extractAfterLabel("hypoallergenic"));
    const shelfLife = pickFirstNonEmpty(information["shelf life"], extractAfterLabel("shelf life"));
    const originCountryRaw = pickFirstNonEmpty(information["country of origin"], highlights["country of origin"], extractAfterLabel("country of origin"), "IN");
    const originCountry = normalizeCountryCode(originCountryRaw);
    // ── Prices ─────────────────────────────────────────────────────────────────
    const priceVisible = extractFirstNumber(visibleText, /(?:₹|Rs\.?)[\s]*([\d.,]+)/i);
    const mrpVisible = extractFirstNumber(visibleText, /MRP\s*(?:₹|Rs\.?)[\s]*([\d.,]+)/i);
    const discountedPaise = extractFirstNumber(html, /\"discountedSellingPrice\"\s*:\s*(\d+)/);
    const mrpPaise = extractFirstNumber(html, /\"mrp\"\s*:\s*(\d+)/);
    const priceCandidate = discountedPaise !== null
        ? discountedPaise / 100
        : jsonLdPrice !== null
            ? jsonLdPrice
            : priceVisible;
    let price_inr = priceCandidate !== null
        ? Math.max(0, Math.round(priceCandidate))
        : null;
    const mrpCandidate = mrpPaise !== null
        ? mrpPaise / 100
        : jsonLdMrp !== null
            ? jsonLdMrp
            : mrpVisible;
    let mrp_inr = mrpCandidate !== null
        ? Math.max(0, Math.round(mrpCandidate))
        : null;
    if (price_inr !== null && mrp_inr !== null && mrp_inr < price_inr) {
        mrp_inr = price_inr;
    }
    const rawInventory = extractFirstNumber(html, /\"availableQuantity\"\s*:\s*(\d+)/) ??
        extractFirstNumber(html, /\"quantity\"\s*:\s*(\d+)/);
    const inventory_quantity = rawInventory !== null && rawInventory >= 0 && rawInventory <= 10000
        ? rawInventory
        : null;
    // ── Weight from unit (e.g. "1 pack (4 L)" → 4000g) ───────────────────────
    const weight = parseWeight(unit || title);
    // ── Build description ──────────────────────────────────────────────────────
    const metaDescription = sanitizeValue($('meta[name="description"]').attr("content") || "", 320);
    const descParts = [];
    if (keyFeatures)
        descParts.push(keyFeatures);
    if (fragrance)
        descParts.push(`Fragrance: ${fragrance}`);
    if (hypoallergenic)
        descParts.push(`Hypoallergenic: ${hypoallergenic}`);
    if (usageInstruction)
        descParts.push(`Usage: ${usageInstruction}`);
    if (unit)
        descParts.push(`Net Qty: ${unit}`);
    if (shelfLife)
        descParts.push(`Shelf Life: ${shelfLife}`);
    if (packagingType)
        descParts.push(`Packaging: ${packagingType}`);
    const fallbackDescription = pickFirstNonEmpty(jsonLdDescription, metaDescription, extractAfterLabel("about the product")) ||
        sanitizeValue(`${title}${brand ? ` by ${brand}` : ""}${unit ? `. Net Qty: ${unit}` : ""}`, 320);
    const description = sanitizeValue(descParts.join(". "), 500) || fallbackDescription;
    // ── Handle (URL slug) ──────────────────────────────────────────────────────
    const handle = buildHandle(title, pvid ? `zepto-${pvid.slice(0, 12)}` : "zepto-product");
    // ── Tags ───────────────────────────────────────────────────────────────────
    const tags = normalizeTags([
        productType,
        brand,
        highlights["concern"],
        highlights["hair type"],
        packagingType,
        fragrance,
        material,
    ]);
    // ── Variants ───────────────────────────────────────────────────────────────
    const sku = buildSku(brand || title, unit || title, pvid);
    const variants = [
        {
            title: unit || "Default",
            sku,
            weight,
            origin_country: originCountry,
            material,
        },
    ];
    const extra_details = {};
    for (const [rawKey, rawValue] of Object.entries({ ...highlights, ...information })) {
        const key = normalizeSpace(rawKey).toLowerCase();
        const value = sanitizeValue(rawValue, 180);
        if (!key || !value) {
            continue;
        }
        extra_details[key] = value;
    }
    if (unit && !extra_details["unit"]) {
        extra_details["unit"] = unit;
    }
    if (packagingType && !extra_details["packaging type"]) {
        extra_details["packaging type"] = packagingType;
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
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiemVwdG8tc2NyYXBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9saWIvemVwdG8tc2NyYXBlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7R0FPRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpV0gsZ0RBa1RDO0FBanBCRCxpREFBa0M7QUFrRGxDLFNBQVMsY0FBYyxDQUFDLEtBQWM7SUFDcEMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM5QixPQUFPLEVBQUUsQ0FBQTtJQUNYLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFBO0FBQzFDLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxLQUFjLEVBQUUsTUFBTSxHQUFHLEdBQUc7SUFDakQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM5QixPQUFPLEVBQUUsQ0FBQTtJQUNYLENBQUM7SUFFRCxNQUFNLE9BQU8sR0FBRyxjQUFjLENBQzVCLEtBQUs7U0FDRixPQUFPLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQztTQUN4QixPQUFPLENBQUMsMkJBQTJCLEVBQUUsR0FBRyxDQUFDLENBQzdDLENBQUE7SUFFRCxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDYixPQUFPLEVBQUUsQ0FBQTtJQUNYLENBQUM7SUFFRCxtRkFBbUY7SUFDbkYsSUFDRSxPQUFPLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUMzQixPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUN2QixPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUN2QixPQUFPLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxFQUNqQyxDQUFDO1FBQ0QsT0FBTyxFQUFFLENBQUE7SUFDWCxDQUFDO0lBRUQsTUFBTSxnQkFB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