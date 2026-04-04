import type { ZeptoProduct, ZeptoVariant } from "./zepto-scraper"

export interface ZeptoAiMeta {
    used: boolean
    provider: "gemini" | "none"
    model: string | null
    note?: string
}

export interface ZeptoRefineResult {
    product: ZeptoProduct
    ai: ZeptoAiMeta
}

// ---------------------------------------------------------------------------
// Text / value helpers
// ---------------------------------------------------------------------------

function normalizeSpace(value: string): string {
    return value.replace(/\s+/g, " ").trim()
}

function cleanText(value: unknown, maxLen = 260): string {
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

    const punctuationCount = (cleaned.match(/[{}\[\]"\\]/g) ?? []).length
    if (punctuationCount > cleaned.length * 0.16) {
        return ""
    }

    return cleaned.slice(0, maxLen)
}

function toNullableInt(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.round(value) : null
    }

    if (typeof value === "string") {
        const parsed = Number(value.replace(/,/g, "").trim())
        return Number.isFinite(parsed) ? Math.round(parsed) : null
    }

    return null
}

function normalizeCountryCode(value: unknown): string {
    const text = cleanText(value, 24)
    const compact = text.toUpperCase().replace(/[^A-Z]/g, "")

    if (compact.length === 2) {
        return compact
    }

    if (/india|bharat/i.test(text)) {
        return "IN"
    }

    return "IN"
}

function normalizeHandle(value: unknown, fallback: string): string {
    const source = cleanText(value, 180)
    const slug = source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")

    return slug || fallback
}

function normalizeTag(value: unknown): string {
    const base = cleanText(value, 48)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s/g, "-")

    if (!base || base.length < 2 || base.length > 32) {
        return ""
    }

    return base
}

function normalizeTags(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return []
    }

    const seen = new Set<string>()
    const tags: string[] = []

    for (const item of values) {
        const tag = normalizeTag(item)
        if (!tag || seen.has(tag)) {
            continue
        }

        seen.add(tag)
        tags.push(tag)

        if (tags.length >= 10) {
            break
        }
    }

    return tags
}

function normalizeImage(value: unknown): string {
    const text = cleanText(value, 500)
    if (!text) {
        return ""
    }

    if (text.startsWith("//")) {
        return `https:${text}`
    }

    if (/^https?:\/\//i.test(text)) {
        return text
    }

    return ""
}

function normalizeImages(values: unknown, fallback: string[]): string[] {
    const source = Array.isArray(values) ? values : []
    const out: string[] = []

    for (const item of source) {
        const image = normalizeImage(item)
        if (!image || out.includes(image)) {
            continue
        }

        out.push(image)

        if (out.length >= 12) {
            break
        }
    }

    if (out.length > 0) {
        return out
    }

    return fallback.slice(0, 12)
}

function skuPart(value: string, maxLen: number): string {
    return normalizeSpace(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, maxLen)
}

function buildSku(brand: string, variantTitle: string, externalId: string): string {
    const parts = [
        skuPart(brand, 12),
        skuPart(variantTitle, 16),
        skuPart(externalId, 8),
    ].filter(Boolean)

    if (parts.length > 0) {
        return parts.join("-")
    }

    return `ZEPTO-${Date.now()}`
}

function normalizeVariant(
    value: unknown,
    fallback: ZeptoVariant,
    brand: string,
    externalId: string,
    originCountry: string,
    material: string
): ZeptoVariant {
    if (!value || typeof value !== "object") {
        return {
            ...fallback,
            origin_country: originCountry,
            material,
        }
    }

    const raw = value as Partial<ZeptoVariant>
    const title = cleanText(raw.title, 80) || fallback.title || "Default"
    const sku = cleanText(raw.sku, 64) || buildSku(brand, title, externalId)
    const weight = toNullableInt(raw.weight) ?? fallback.weight

    return {
        title,
        sku,
        weight,
        origin_country: normalizeCountryCode(raw.origin_country ?? originCountry),
        material: cleanText(raw.material, 120) || material,
    }
}

function normalizeExtraDetails(value: unknown, fallback: Record<string, string>): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fallback
    }

    const out: Record<string, string> = {}
    for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
        const key = normalizeSpace(String(rawKey)).toLowerCase()
        const val = cleanText(rawVal, 180)
        if (!key || !val) {
            continue
        }
        out[key] = val
    }

    return Object.keys(out).length > 0 ? out : fallback
}

// ---------------------------------------------------------------------------
// Deterministic sanitise pass (always runs — AI is optional on top)
// ---------------------------------------------------------------------------

function sanitizeBaseProduct(product: ZeptoProduct): ZeptoProduct {
    const title = cleanText(product.title, 140) || "Zepto Product"
    const brand = cleanText(product.brand, 80)
    const handle = normalizeHandle(product.handle || title, `zepto-${Date.now()}`)
    const originCountry = normalizeCountryCode(product.origin_country)
    const material = cleanText(product.material, 120)
    const firstVariant = product.variants?.[0]

    const variantFallback: ZeptoVariant = {
        title: cleanText(firstVariant?.title, 80) || "Default",
        sku:
            cleanText(firstVariant?.sku, 64) ||
            buildSku(
                brand || title,
                firstVariant?.title || "default",
                product.external_id || handle
            ),
        weight: toNullableInt(firstVariant?.weight) ?? toNullableInt(product.weight),
        origin_country: originCountry,
        material,
    }

    return {
        ...product,
        title,
        subtitle: cleanText(product.subtitle, 120) || (brand ? `by ${brand}` : ""),
        description: cleanText(product.description, 700) || `${title}${brand ? ` by ${brand}` : ""}`,
        handle,
        thumbnail: normalizeImage(product.thumbnail) || normalizeImage(product.images?.[0]) || "",
        images: normalizeImages(product.images, product.images ?? []),
        weight: toNullableInt(product.weight),
        origin_country: originCountry,
        material,
        shelf_life: cleanText(product.shelf_life, 120),
        brand,
        product_type: cleanText(product.product_type, 80),
        tags: normalizeTags(product.tags),
        external_id: cleanText(product.external_id, 80) || handle,
        variants: [
            normalizeVariant(
                firstVariant,
                variantFallback,
                brand || title,
                product.external_id || handle,
                originCountry,
                material
            ),
        ],
        price_inr: toNullableInt(product.price_inr),
        mrp_inr: toNullableInt(product.mrp_inr),
        inventory_quantity: toNullableInt(product.inventory_quantity),
        extra_details: normalizeExtraDetails(product.extra_details, {}),
        raw_url: cleanText(product.raw_url, 1000),
    }
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): string | null {
    const fenceMatch =
        text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/)
    const source = fenceMatch?.[1] ?? text

    const start = source.indexOf("{")
    const end = source.lastIndexOf("}")

    if (start < 0 || end <= start) {
        return null
    }

    return source.slice(start, end + 1)
}

function normalizeJsonCandidate(value: string): string {
    return value
        .replace(/^\uFEFF/, "")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1")
        .trim()
}

function repairPartialJsonObject(text: string): string | null {
    const fenceMatch =
        text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/)
    const source = (fenceMatch?.[1] ?? text).trim()

    const start = source.indexOf("{")
    if (start < 0) {
        return null
    }

    const fragment = source.slice(start)
    let output = ""
    let inString = false
    let isEscaped = false
    let braceDepth = 0
    let bracketDepth = 0
    let sawObjectStart = false

    for (const ch of fragment) {
        if (inString && (ch === "\n" || ch === "\r")) {
            output += "\\n"
            continue
        }

        if (inString && ch === "\t") {
            output += " "
            continue
        }

        output += ch

        if (isEscaped) {
            isEscaped = false
            continue
        }

        if (inString && ch === "\\") {
            isEscaped = true
            continue
        }

        if (ch === '"') {
            inString = !inString
            continue
        }

        if (inString) {
            continue
        }

        if (ch === "{") {
            braceDepth += 1
            sawObjectStart = true
            continue
        }

        if (ch === "}") {
            if (braceDepth > 0) {
                braceDepth -= 1
            }

            if (sawObjectStart && braceDepth === 0 && bracketDepth === 0) {
                return normalizeJsonCandidate(output)
            }

            continue
        }

        if (ch === "[") {
            bracketDepth += 1
            continue
        }

        if (ch === "]") {
            if (bracketDepth > 0) {
                bracketDepth -= 1
            }
            continue
        }
    }

    if (!sawObjectStart) {
        return null
    }

    let repaired = output

    if (inString) {
        repaired += '"'
    }

    if (bracketDepth > 0) {
        repaired += "]".repeat(bracketDepth)
    }

    if (braceDepth > 0) {
        repaired += "}".repeat(braceDepth)
    }

    return normalizeJsonCandidate(repaired)
}

type JsonParseStrategy = "direct" | "extracted" | "repaired"

function parseGeminiJsonContent(
    textContent: string,
    finishReason?: string
): { value: Partial<ZeptoProduct>; strategy: JsonParseStrategy } {
    const candidates: Array<{ strategy: JsonParseStrategy; json: string }> = []
    const direct = normalizeJsonCandidate(textContent)
    if (direct) {
        candidates.push({ strategy: "direct", json: direct })
    }

    const extracted = extractJsonObject(textContent)
    if (extracted) {
        const normalized = normalizeJsonCandidate(extracted)
        if (!candidates.some((c) => c.json === normalized)) {
            candidates.push({ strategy: "extracted", json: normalized })
        }
    }

    const repaired = repairPartialJsonObject(textContent)
    if (repaired && !candidates.some((c) => c.json === repaired)) {
        candidates.push({ strategy: "repaired", json: repaired })
    }

    let lastErrorMessage = ""

    for (const candidate of candidates) {
        try {
            return {
                value: JSON.parse(candidate.json) as Partial<ZeptoProduct>,
                strategy: candidate.strategy,
            }
        } catch (error: any) {
            lastErrorMessage = error?.message ? String(error.message) : "unknown parse error"
        }
    }

    const reasonSuffix = finishReason ? ` (finishReason: ${finishReason})` : ""
    const parseSuffix = lastErrorMessage ? `; parse error: ${lastErrorMessage}` : ""

    throw new Error(
        `Gemini returned non-JSON content${reasonSuffix}: ${toLogPreview(textContent, 220)}${parseSuffix}`
    )
}

function toLogPreview(text: string, maxLen = 900): string {
    const normalized = text.replace(/\s+/g, " ").trim()
    if (!normalized) {
        return "<empty>"
    }
    return normalized.slice(0, maxLen)
}

// ---------------------------------------------------------------------------
// Gemini config helpers
// ---------------------------------------------------------------------------

function getGeminiModel(): string {
    // gemini-2.0-flash: free tier, fast (~2-4s), 1 000 RPD, great quality
    // Override via GEMINI_MODEL if you want e.g. "gemini-1.5-flash-8b" (even faster)
    return cleanText(process.env.GEMINI_MODEL, 120) || "gemini-2.5-flash"
}

function getGeminiTimeoutMs(): number {
    const parsed = Number(process.env.GEMINI_TIMEOUT_MS)
    if (!Number.isFinite(parsed)) {
        return 30000
    }
    return Math.max(5000, Math.min(90000, Math.round(parsed)))
}

function getGeminiMaxOutputTokens(): number {
    const parsed = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS)
    if (!Number.isFinite(parsed)) {
        return 800
    }
    return Math.max(128, Math.min(2048, Math.round(parsed)))
}

// ---------------------------------------------------------------------------
// Slim prompt — only fields AI can meaningfully improve.
// Price / inventory / images / raw_url are preserved from base in mergeAiIntoProduct.
// ---------------------------------------------------------------------------

function buildPrompt(product: ZeptoProduct): string {
    const slim = {
        title: product.title,
        subtitle: product.subtitle,
        description: product.description,
        brand: product.brand,
        product_type: product.product_type,
        tags: product.tags,
        material: product.material,
        shelf_life: product.shelf_life,
        origin_country: product.origin_country,
        handle: product.handle,
        variants: product.variants?.map((v) => ({
            title: v.title,
            sku: v.sku,
            weight: v.weight,
        })),
    }

    return [
        "You are a strict ecommerce data cleaner for an Indian grocery/FMCG catalog.",
        "Return ONE valid JSON object only. No markdown. No explanation. No extra keys.",
        "Rules:",
        "- Improve title (title-case, clear), subtitle, description (2-3 sentences), brand, product_type, tags, material, shelf_life, and variant title only if messy.",
        "- Keep handle slug-safe lowercase, no spaces.",
        "- Keep origin_country as 2-letter ISO code (default IN).",
        "- tags: lowercase, unique, max 10, relevant to product.",
        "- variants: non-empty array; each must have title, sku, weight, origin_country, material.",
        "- Do NOT invent nutrition, ingredients, price, inventory, or dimensions.",
        "- Do NOT add keys that are not in the input.",
        "Input:",
        JSON.stringify(slim),
    ].join("\n")
}

// ---------------------------------------------------------------------------
// Gemini REST call (no extra SDK — uses node-fetch already in your project)
// ---------------------------------------------------------------------------

async function runGeminiRefinement(product: ZeptoProduct): Promise<Partial<ZeptoProduct>> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set")
    }

    const model = getGeminiModel()
    const timeoutMs = getGeminiTimeoutMs()
    const maxOutputTokens = getGeminiMaxOutputTokens()

    // Plain REST — no additional dependency needed
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
    timeoutHandle.unref?.()

    const fetch = (await import("node-fetch")).default

    try {
        console.log(
            `[Gemini] Requesting model: ${model} (timeout=${timeoutMs}ms, maxOutputTokens=${maxOutputTokens})`
        )

        const requestBody = {
            contents: [
                {
                    role: "user",
                    parts: [{ text: buildPrompt(product) }],
                },
            ],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens,
                // Tells Gemini to return pure JSON — avoids markdown fences
                responseMimeType: "application/json",
            },
        }

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        })

        const rawBody = await response.text()
        console.log(
            `[Gemini] Status: ${response.status}. Preview: ${toLogPreview(rawBody, 300)}`
        )

        if (!response.ok) {
            throw new Error(`Gemini request failed (${response.status}): ${toLogPreview(rawBody)}`)
        }

        let payload: {
            candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> }
                finishReason?: string
            }>
            error?: { message?: string }
        }

        try {
            payload = JSON.parse(rawBody)
        } catch {
            throw new Error(`Gemini returned non-JSON payload: ${toLogPreview(rawBody)}`)
        }

        if (payload.error?.message) {
            throw new Error(`Gemini API error: ${payload.error.message}`)
        }

        const textContent = (payload.candidates?.[0]?.content?.parts ?? [])
            .map((p) => p.text ?? "")
            .join("")
            .trim()
        const finishReason = payload.candidates?.[0]?.finishReason ?? "unknown"

        if (!textContent) {
            throw new Error(`Gemini returned empty content (finishReason: ${finishReason})`)
        }

        const parsed = parseGeminiJsonContent(textContent, finishReason)
        if (parsed.strategy !== "direct") {
            console.warn(
                `[Gemini] Parsed response using ${parsed.strategy} JSON strategy (finishReason: ${finishReason})`
            )
        }

        return parsed.value
    } catch (error: any) {
        if (error?.name === "AbortError") {
            throw new Error(`Gemini request timed out after ${timeoutMs}ms`)
        }
        throw error
    } finally {
        clearTimeout(timeoutHandle)
    }
}

// ---------------------------------------------------------------------------
// Merge AI output back into base product.
// Sensitive fields (price, inventory, images, external_id, raw_url) always
// come from the deterministic base — AI cannot overwrite them.
// ---------------------------------------------------------------------------

function mergeAiIntoProduct(base: ZeptoProduct, aiRaw: Partial<ZeptoProduct>): ZeptoProduct {
    const title = cleanText(aiRaw.title, 140) || base.title
    const brand = cleanText(aiRaw.brand, 80) || base.brand
    const handle = normalizeHandle(aiRaw.handle ?? title, base.handle)
    const material = cleanText(aiRaw.material, 120) || base.material
    const originCountry = normalizeCountryCode(aiRaw.origin_country ?? base.origin_country)

    const images = normalizeImages(aiRaw.images, base.images)
    const thumbnail = normalizeImage(aiRaw.thumbnail) || images[0] || base.thumbnail
    const tags = normalizeTags(aiRaw.tags)

    const baseVariant: ZeptoVariant = base.variants?.[0] ?? {
        title: "Default",
        sku: buildSku(brand || title, "default", base.external_id || base.handle),
        weight: base.weight,
        origin_country: originCountry,
        material,
    }

    const rawVariants = Array.isArray(aiRaw.variants) ? aiRaw.variants : []
    const variants =
        rawVariants.length > 0
            ? rawVariants
                  .slice(0, 5)
                  .map((v) =>
                      normalizeVariant(
                          v,
                          baseVariant,
                          brand || title,
                          base.external_id || base.handle,
                          originCountry,
                          material
                      )
                  )
            : [
                  normalizeVariant(
                      baseVariant,
                      baseVariant,
                      brand || title,
                      base.external_id || base.handle,
                      originCountry,
                      material
                  ),
              ]

    return {
        ...base,
        title,
        subtitle: cleanText(aiRaw.subtitle, 120) || (brand ? `by ${brand}` : ""),
        description: cleanText(aiRaw.description, 700) || base.description,
        handle,
        thumbnail,
        images,
        weight: toNullableInt(aiRaw.weight) ?? base.weight,
        origin_country: originCountry,
        material,
        shelf_life: cleanText(aiRaw.shelf_life, 120) || base.shelf_life,
        brand,
        product_type: cleanText(aiRaw.product_type, 80) || base.product_type,
        tags: tags.length > 0 ? tags : base.tags,
        variants,
        extra_details: normalizeExtraDetails(aiRaw.extra_details, base.extra_details),
        // Always preserved from base — AI must not touch these
        price_inr: base.price_inr,
        mrp_inr: base.mrp_inr,
        inventory_quantity: base.inventory_quantity,
        external_id: base.external_id,
        raw_url: base.raw_url,
    }
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacement for the old refineZeptoProduct
// ---------------------------------------------------------------------------

export async function refineZeptoProduct(
    sourceProduct: ZeptoProduct,
    options?: { useAi?: boolean }
): Promise<ZeptoRefineResult> {
    const product = sanitizeBaseProduct(sourceProduct)

    if (options?.useAi === false) {
        return {
            product,
            ai: {
                used: false,
                provider: "none",
                model: null,
                note: "AI cleanup disabled for this request",
            },
        }
    }

    if (!process.env.GEMINI_API_KEY) {
        return {
            product,
            ai: {
                used: false,
                provider: "none",
                model: null,
                note: "GEMINI_API_KEY is missing — using deterministic cleanup only. " +
                    "Get a free key at https://aistudio.google.com/apikey",
            },
        }
    }

    const model = getGeminiModel()

    try {
        const aiResult = await runGeminiRefinement(product)
        const mergedProduct = sanitizeBaseProduct(mergeAiIntoProduct(product, aiResult))

        return {
            product: mergedProduct,
            ai: {
                used: true,
                provider: "gemini",
                model,
            },
        }
    } catch (error: any) {
        const reason: string = error?.message ?? "unknown error"
        console.warn(`[Gemini] Refinement failed — falling back to deterministic result. Reason: ${reason}`)

        return {
            product,
            ai: {
                used: false,
                provider: "none",
                model: null,
                note: `AI cleanup failed, deterministic fallback used: ${reason}`,
            },
        }
    }
}