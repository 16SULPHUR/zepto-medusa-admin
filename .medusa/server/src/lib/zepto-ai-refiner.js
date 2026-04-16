"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refineZeptoProduct = refineZeptoProduct;
// ---------------------------------------------------------------------------
// Text / value helpers
// ---------------------------------------------------------------------------
function normalizeSpace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function cleanText(value, maxLen = 260) {
    if (typeof value !== "string") {
        return "";
    }
    const cleaned = normalizeSpace(value
        .replace(/<[^>]+>/g, " ")
        .replace(/\\u003c|\\u003e|\\u002f/gi, " "));
    if (!cleaned) {
        return "";
    }
    const punctuationCount = (cleaned.match(/[{}\[\]"\\]/g) ?? []).length;
    if (punctuationCount > cleaned.length * 0.16) {
        return "";
    }
    return cleaned.slice(0, maxLen);
}
function toNullableInt(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.round(value) : null;
    }
    if (typeof value === "string") {
        const parsed = Number(value.replace(/,/g, "").trim());
        return Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
    return null;
}
function normalizeCountryCode(value) {
    const text = cleanText(value, 24);
    const compact = text.toUpperCase().replace(/[^A-Z]/g, "");
    if (compact.length === 2) {
        return compact;
    }
    if (/india|bharat/i.test(text)) {
        return "IN";
    }
    return "IN";
}
function normalizeHandle(value, fallback) {
    const source = cleanText(value, 180);
    const slug = source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return slug || fallback;
}
function normalizeTag(value) {
    const base = cleanText(value, 48)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s/g, "-");
    if (!base || base.length < 2 || base.length > 32) {
        return "";
    }
    return base;
}
function normalizeTags(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    const seen = new Set();
    const tags = [];
    for (const item of values) {
        const tag = normalizeTag(item);
        if (!tag || seen.has(tag)) {
            continue;
        }
        seen.add(tag);
        tags.push(tag);
        if (tags.length >= 10) {
            break;
        }
    }
    return tags;
}
function normalizeImage(value) {
    const text = cleanText(value, 500);
    if (!text) {
        return "";
    }
    if (text.startsWith("//")) {
        return `https:${text}`;
    }
    if (/^https?:\/\//i.test(text)) {
        return text;
    }
    return "";
}
function normalizeImages(values, fallback) {
    const source = Array.isArray(values) ? values : [];
    const out = [];
    for (const item of source) {
        const image = normalizeImage(item);
        if (!image || out.includes(image)) {
            continue;
        }
        out.push(image);
        if (out.length >= 12) {
            break;
        }
    }
    if (out.length > 0) {
        return out;
    }
    return fallback.slice(0, 12);
}
function skuPart(value, maxLen) {
    return normalizeSpace(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, maxLen);
}
function buildSku(brand, variantTitle, externalId) {
    const parts = [
        skuPart(brand, 12),
        skuPart(variantTitle, 16),
        skuPart(externalId, 8),
    ].filter(Boolean);
    if (parts.length > 0) {
        return parts.join("-");
    }
    return `ZEPTO-${Date.now()}`;
}
function normalizeVariant(value, fallback, brand, externalId, originCountry, material) {
    if (!value || typeof value !== "object") {
        return {
            ...fallback,
            origin_country: originCountry,
            material,
        };
    }
    const raw = value;
    const title = cleanText(raw.title, 80) || fallback.title || "Default";
    const sku = cleanText(raw.sku, 64) || buildSku(brand, title, externalId);
    const weight = toNullableInt(raw.weight) ?? fallback.weight;
    return {
        title,
        sku,
        weight,
        origin_country: normalizeCountryCode(raw.origin_country ?? originCountry),
        material: cleanText(raw.material, 120) || material,
    };
}
function normalizeExtraDetails(value, fallback) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fallback;
    }
    const out = {};
    for (const [rawKey, rawVal] of Object.entries(value)) {
        const key = normalizeSpace(String(rawKey)).toLowerCase();
        const val = cleanText(rawVal, 180);
        if (!key || !val) {
            continue;
        }
        out[key] = val;
    }
    return Object.keys(out).length > 0 ? out : fallback;
}
// ---------------------------------------------------------------------------
// Deterministic sanitise pass (always runs — AI is optional on top)
// ---------------------------------------------------------------------------
function sanitizeBaseProduct(product) {
    const title = cleanText(product.title, 140) || "Zepto Product";
    const brand = cleanText(product.brand, 80);
    const handle = normalizeHandle(product.handle || title, `zepto-${Date.now()}`);
    const originCountry = normalizeCountryCode(product.origin_country);
    const material = cleanText(product.material, 120);
    const firstVariant = product.variants?.[0];
    const variantFallback = {
        title: cleanText(firstVariant?.title, 80) || "Default",
        sku: cleanText(firstVariant?.sku, 64) ||
            buildSku(brand || title, firstVariant?.title || "default", product.external_id || handle),
        weight: toNullableInt(firstVariant?.weight) ?? toNullableInt(product.weight),
        origin_country: originCountry,
        material,
    };
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
            normalizeVariant(firstVariant, variantFallback, brand || title, product.external_id || handle, originCountry, material),
        ],
        price_inr: toNullableInt(product.price_inr),
        mrp_inr: toNullableInt(product.mrp_inr),
        inventory_quantity: toNullableInt(product.inventory_quantity),
        extra_details: normalizeExtraDetails(product.extra_details, {}),
        raw_url: cleanText(product.raw_url, 1000),
    };
}
// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------
function extractJsonObject(text) {
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
    const source = fenceMatch?.[1] ?? text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) {
        return null;
    }
    return source.slice(start, end + 1);
}
function normalizeJsonCandidate(value) {
    return value
        .replace(/^\uFEFF/, "")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1")
        .trim();
}
function repairPartialJsonObject(text) {
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
    const source = (fenceMatch?.[1] ?? text).trim();
    const start = source.indexOf("{");
    if (start < 0) {
        return null;
    }
    const fragment = source.slice(start);
    let output = "";
    let inString = false;
    let isEscaped = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let sawObjectStart = false;
    for (const ch of fragment) {
        if (inString && (ch === "\n" || ch === "\r")) {
            output += "\\n";
            continue;
        }
        if (inString && ch === "\t") {
            output += " ";
            continue;
        }
        output += ch;
        if (isEscaped) {
            isEscaped = false;
            continue;
        }
        if (inString && ch === "\\") {
            isEscaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (ch === "{") {
            braceDepth += 1;
            sawObjectStart = true;
            continue;
        }
        if (ch === "}") {
            if (braceDepth > 0) {
                braceDepth -= 1;
            }
            if (sawObjectStart && braceDepth === 0 && bracketDepth === 0) {
                return normalizeJsonCandidate(output);
            }
            continue;
        }
        if (ch === "[") {
            bracketDepth += 1;
            continue;
        }
        if (ch === "]") {
            if (bracketDepth > 0) {
                bracketDepth -= 1;
            }
            continue;
        }
    }
    if (!sawObjectStart) {
        return null;
    }
    let repaired = output;
    if (inString) {
        repaired += '"';
    }
    if (bracketDepth > 0) {
        repaired += "]".repeat(bracketDepth);
    }
    if (braceDepth > 0) {
        repaired += "}".repeat(braceDepth);
    }
    return normalizeJsonCandidate(repaired);
}
function parseGeminiJsonContent(textContent, finishReason) {
    const candidates = [];
    const direct = normalizeJsonCandidate(textContent);
    if (direct) {
        candidates.push({ strategy: "direct", json: direct });
    }
    const extracted = extractJsonObject(textContent);
    if (extracted) {
        const normalized = normalizeJsonCandidate(extracted);
        if (!candidates.some((c) => c.json === normalized)) {
            candidates.push({ strategy: "extracted", json: normalized });
        }
    }
    const repaired = repairPartialJsonObject(textContent);
    if (repaired && !candidates.some((c) => c.json === repaired)) {
        candidates.push({ strategy: "repaired", json: repaired });
    }
    let lastErrorMessage = "";
    for (const candidate of candidates) {
        try {
            return {
                value: JSON.parse(candidate.json),
                strategy: candidate.strategy,
            };
        }
        catch (error) {
            lastErrorMessage = error?.message ? String(error.message) : "unknown parse error";
        }
    }
    const reasonSuffix = finishReason ? ` (finishReason: ${finishReason})` : "";
    const parseSuffix = lastErrorMessage ? `; parse error: ${lastErrorMessage}` : "";
    throw new Error(`Gemini returned non-JSON content${reasonSuffix}: ${toLogPreview(textContent, 220)}${parseSuffix}`);
}
function toLogPreview(text, maxLen = 900) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "<empty>";
    }
    return normalized.slice(0, maxLen);
}
// ---------------------------------------------------------------------------
// Gemini config helpers
// ---------------------------------------------------------------------------
function getGeminiModel() {
    // gemini-2.0-flash: free tier, fast (~2-4s), 1 000 RPD, great quality
    // Override via GEMINI_MODEL if you want e.g. "gemini-1.5-flash-8b" (even faster)
    return cleanText(process.env.GEMINI_MODEL, 120) || "gemini-2.5-flash";
}
function getGeminiTimeoutMs() {
    const parsed = Number(process.env.GEMINI_TIMEOUT_MS);
    if (!Number.isFinite(parsed)) {
        return 30000;
    }
    return Math.max(5000, Math.min(90000, Math.round(parsed)));
}
function getGeminiMaxOutputTokens() {
    const parsed = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS);
    if (!Number.isFinite(parsed)) {
        return 800;
    }
    return Math.max(128, Math.min(2048, Math.round(parsed)));
}
// ---------------------------------------------------------------------------
// Slim prompt — only fields AI can meaningfully improve.
// Price / inventory / images / raw_url are preserved from base in mergeAiIntoProduct.
// ---------------------------------------------------------------------------
function buildPrompt(product) {
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
    };
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
    ].join("\n");
}
// ---------------------------------------------------------------------------
// Gemini REST call (no extra SDK — uses node-fetch already in your project)
// ---------------------------------------------------------------------------
async function runGeminiRefinement(product) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set");
    }
    const model = getGeminiModel();
    const timeoutMs = getGeminiTimeoutMs();
    const maxOutputTokens = getGeminiMaxOutputTokens();
    // Plain REST — no additional dependency needed
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    timeoutHandle.unref?.();
    const fetch = (await import("node-fetch")).default;
    try {
        console.log(`[Gemini] Requesting model: ${model} (timeout=${timeoutMs}ms, maxOutputTokens=${maxOutputTokens})`);
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
        };
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
        const rawBody = await response.text();
        console.log(`[Gemini] Status: ${response.status}. Preview: ${toLogPreview(rawBody, 300)}`);
        if (!response.ok) {
            throw new Error(`Gemini request failed (${response.status}): ${toLogPreview(rawBody)}`);
        }
        let payload;
        try {
            payload = JSON.parse(rawBody);
        }
        catch {
            throw new Error(`Gemini returned non-JSON payload: ${toLogPreview(rawBody)}`);
        }
        if (payload.error?.message) {
            throw new Error(`Gemini API error: ${payload.error.message}`);
        }
        const textContent = (payload.candidates?.[0]?.content?.parts ?? [])
            .map((p) => p.text ?? "")
            .join("")
            .trim();
        const finishReason = payload.candidates?.[0]?.finishReason ?? "unknown";
        if (!textContent) {
            throw new Error(`Gemini returned empty content (finishReason: ${finishReason})`);
        }
        const parsed = parseGeminiJsonContent(textContent, finishReason);
        if (parsed.strategy !== "direct") {
            console.warn(`[Gemini] Parsed response using ${parsed.strategy} JSON strategy (finishReason: ${finishReason})`);
        }
        return parsed.value;
    }
    catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeoutHandle);
    }
}
// ---------------------------------------------------------------------------
// Merge AI output back into base product.
// Sensitive fields (price, inventory, images, external_id, raw_url) always
// come from the deterministic base — AI cannot overwrite them.
// ---------------------------------------------------------------------------
function mergeAiIntoProduct(base, aiRaw) {
    const title = cleanText(aiRaw.title, 140) || base.title;
    const brand = cleanText(aiRaw.brand, 80) || base.brand;
    const handle = normalizeHandle(aiRaw.handle ?? title, base.handle);
    const material = cleanText(aiRaw.material, 120) || base.material;
    const originCountry = normalizeCountryCode(aiRaw.origin_country ?? base.origin_country);
    const images = normalizeImages(aiRaw.images, base.images);
    const thumbnail = normalizeImage(aiRaw.thumbnail) || images[0] || base.thumbnail;
    const tags = normalizeTags(aiRaw.tags);
    const baseVariant = base.variants?.[0] ?? {
        title: "Default",
        sku: buildSku(brand || title, "default", base.external_id || base.handle),
        weight: base.weight,
        origin_country: originCountry,
        material,
    };
    const rawVariants = Array.isArray(aiRaw.variants) ? aiRaw.variants : [];
    const variants = rawVariants.length > 0
        ? rawVariants
            .slice(0, 5)
            .map((v) => normalizeVariant(v, baseVariant, brand || title, base.external_id || base.handle, originCountry, material))
        : [
            normalizeVariant(baseVariant, baseVariant, brand || title, base.external_id || base.handle, originCountry, material),
        ];
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
    };
}
// ---------------------------------------------------------------------------
// Public API — drop-in replacement for the old refineZeptoProduct
// ---------------------------------------------------------------------------
async function refineZeptoProduct(sourceProduct, options) {
    const product = sanitizeBaseProduct(sourceProduct);
    if (options?.useAi === false) {
        return {
            product,
            ai: {
                used: false,
                provider: "none",
                model: null,
                note: "AI cleanup disabled for this request",
            },
        };
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
        };
    }
    const model = getGeminiModel();
    try {
        const aiResult = await runGeminiRefinement(product);
        const mergedProduct = sanitizeBaseProduct(mergeAiIntoProduct(product, aiResult));
        return {
            product: mergedProduct,
            ai: {
                used: true,
                provider: "gemini",
                model,
            },
        };
    }
    catch (error) {
        const reason = error?.message ?? "unknown error";
        console.warn(`[Gemini] Refinement failed — falling back to deterministic result. Reason: ${reason}`);
        return {
            product,
            ai: {
                used: false,
                provider: "none",
                model: null,
                note: `AI cleanup failed, deterministic fallback used: ${reason}`,
            },
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiemVwdG8tYWktcmVmaW5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9saWIvemVwdG8tYWktcmVmaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQTJ0QkEsZ0RBMkRDO0FBeHdCRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxTQUFTLGNBQWMsQ0FBQyxLQUFhO0lBQ2pDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7QUFDNUMsQ0FBQztBQUVELFNBQVMsU0FBUyxDQUFDLEtBQWMsRUFBRSxNQUFNLEdBQUcsR0FBRztJQUMzQyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzVCLE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLGNBQWMsQ0FDMUIsS0FBSztTQUNBLE9BQU8sQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDO1NBQ3hCLE9BQU8sQ0FBQywyQkFBMkIsRUFBRSxHQUFHLENBQUMsQ0FDakQsQ0FBQTtJQUVELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNYLE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztJQUVELE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQTtJQUNyRSxJQUFJLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLEdBQUcsSUFBSSxFQUFFLENBQUM7UUFDM0MsT0FBTyxFQUFFLENBQUE7SUFDYixDQUFDO0lBRUQsT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQTtBQUNuQyxDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsS0FBYztJQUNqQyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzVCLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO0lBQzVELENBQUM7SUFFRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzVCLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQ3JELE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO0lBQzlELENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLEtBQWM7SUFDeEMsTUFBTSxJQUFJLEdBQUcsU0FBUyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUNqQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUV6RCxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdkIsT0FBTyxPQUFPLENBQUE7SUFDbEIsQ0FBQztJQUVELElBQUksZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQzdCLE9BQU8sSUFBSSxDQUFBO0lBQ2YsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2YsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLEtBQWMsRUFBRSxRQUFnQjtJQUNyRCxNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0lBQ3BDLE1BQU0sSUFBSSxHQUFHLE1BQU07U0FDZCxXQUFXLEVBQUU7U0FDYixPQUFPLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQztTQUMzQixPQUFPLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFBO0lBRTFCLE9BQU8sSUFBSSxJQUFJLFFBQVEsQ0FBQTtBQUMzQixDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsS0FBYztJQUNoQyxNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQztTQUM1QixXQUFXLEVBQUU7U0FDYixPQUFPLENBQUMsZUFBZSxFQUFFLEdBQUcsQ0FBQztTQUM3QixPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQztTQUNwQixJQUFJLEVBQUU7U0FDTixPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0lBRXhCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLEVBQUUsQ0FBQztRQUMvQyxPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFlO0lBQ2xDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDekIsT0FBTyxFQUFFLENBQUE7SUFDYixDQUFDO0lBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQTtJQUM5QixNQUFNLElBQUksR0FBYSxFQUFFLENBQUE7SUFFekIsS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUN4QixNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDeEIsU0FBUTtRQUNaLENBQUM7UUFFRCxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ2IsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUVkLElBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNwQixNQUFLO1FBQ1QsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxLQUFjO0lBQ2xDLE1BQU0sSUFBSSxHQUFHLFNBQVMsQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUE7SUFDbEMsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1IsT0FBTyxFQUFFLENBQUE7SUFDYixDQUFDO0lBRUQsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDeEIsT0FBTyxTQUFTLElBQUksRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRCxJQUFJLGVBQWUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUM3QixPQUFPLElBQUksQ0FBQTtJQUNmLENBQUM7SUFFRCxPQUFPLEVBQUUsQ0FBQTtBQUNiLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxNQUFlLEVBQUUsUUFBa0I7SUFDeEQsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFDbEQsTUFBTSxHQUFHLEdBQWEsRUFBRSxDQUFBO0lBRXhCLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxFQUFFLENBQUM7UUFDeEIsTUFBTSxLQUFLLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2xDLElBQUksQ0FBQyxLQUFLLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2hDLFNBQVE7UUFDWixDQUFDO1FBRUQsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUVmLElBQUksR0FBRyxDQUFDLE1BQU0sSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNuQixNQUFLO1FBQ1QsQ0FBQztJQUNMLENBQUM7SUFFRCxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakIsT0FBTyxHQUFHLENBQUE7SUFDZCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQTtBQUNoQyxDQUFDO0FBRUQsU0FBUyxPQUFPLENBQUMsS0FBYSxFQUFFLE1BQWM7SUFDMUMsT0FBTyxjQUFjLENBQUMsS0FBSyxDQUFDO1NBQ3ZCLFdBQVcsRUFBRTtTQUNiLE9BQU8sQ0FBQyxhQUFhLEVBQUUsR0FBRyxDQUFDO1NBQzNCLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDO1NBQ25CLE9BQU8sQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDO1NBQ3JCLEtBQUssQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUE7QUFDekIsQ0FBQztBQUVELFNBQVMsUUFBUSxDQUFDLEtBQWEsRUFBRSxZQUFvQixFQUFFLFVBQWtCO0lBQ3JFLE1BQU0sS0FBSyxHQUFHO1FBQ1YsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDbEIsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7UUFDekIsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7S0FDekIsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7SUFFakIsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ25CLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMxQixDQUFDO0lBRUQsT0FBTyxTQUFTLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFBO0FBQ2hDLENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUNyQixLQUFjLEVBQ2QsUUFBc0IsRUFDdEIsS0FBYSxFQUNiLFVBQWtCLEVBQ2xCLGFBQXFCLEVBQ3JCLFFBQWdCO0lBRWhCLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDdEMsT0FBTztZQUNILEdBQUcsUUFBUTtZQUNYLGNBQWMsRUFBRSxhQUFhO1lBQzdCLFFBQVE7U0FDWCxDQUFBO0lBQ0wsQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFHLEtBQThCLENBQUE7SUFDMUMsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksUUFBUSxDQUFDLEtBQUssSUFBSSxTQUFTLENBQUE7SUFDckUsTUFBTSxHQUFHLEdBQUcsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLElBQUksUUFBUSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsVUFBVSxDQUFDLENBQUE7SUFDeEUsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxRQUFRLENBQUMsTUFBTSxDQUFBO0lBRTNELE9BQU87UUFDSCxLQUFLO1FBQ0wsR0FBRztRQUNILE1BQU07UUFDTixjQUFjLEVBQUUsb0JBQW9CLENBQUMsR0FBRyxDQUFDLGNBQWMsSUFBSSxhQUFhLENBQUM7UUFDekUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxJQUFJLFFBQVE7S0FDckQsQ0FBQTtBQUNMLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLEtBQWMsRUFBRSxRQUFnQztJQUMzRSxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDOUQsT0FBTyxRQUFRLENBQUE7SUFDbkIsQ0FBQztJQUVELE1BQU0sR0FBRyxHQUEyQixFQUFFLENBQUE7SUFDdEMsS0FBSyxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBZ0MsQ0FBQyxFQUFFLENBQUM7UUFDOUUsTUFBTSxHQUFHLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3hELE1BQU0sR0FBRyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUE7UUFDbEMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ2YsU0FBUTtRQUNaLENBQUM7UUFDRCxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFBO0lBQ2xCLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUE7QUFDdkQsQ0FBQztBQUVELDhFQUE4RTtBQUM5RSxvRUFBb0U7QUFDcEUsOEVBQThFO0FBRTlFLFNBQVMsbUJBQW1CLENBQUMsT0FBcUI7SUFDOUMsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLElBQUksZUFBZSxDQUFBO0lBQzlELE1BQU0sS0FBSyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFBO0lBQzFDLE1BQU0sTUFBTSxHQUFHLGVBQWUsQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLEtBQUssRUFBRSxTQUFTLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFDOUUsTUFBTSxhQUFhLEdBQUcsb0JBQW9CLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQ2xFLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFBO0lBQ2pELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUUxQyxNQUFNLGVBQWUsR0FBaUI7UUFDbEMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxZQUFZLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLFNBQVM7UUFDdEQsR0FBRyxFQUNDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQztZQUNoQyxRQUFRLENBQ0osS0FBSyxJQUFJLEtBQUssRUFDZCxZQUFZLEVBQUUsS0FBSyxJQUFJLFNBQVMsRUFDaEMsT0FBTyxDQUFDLFdBQVcsSUFBSSxNQUFNLENBQ2hDO1FBQ0wsTUFBTSxFQUFFLGFBQWEsQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLElBQUksYUFBYSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFDNUUsY0FBYyxFQUFFLGFBQWE7UUFDN0IsUUFBUTtLQUNYLENBQUE7SUFFRCxPQUFPO1FBQ0gsR0FBRyxPQUFPO1FBQ1YsS0FBSztRQUNMLFFBQVEsRUFBRSxTQUFTLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQzFFLFdBQVcsRUFBRSxTQUFTLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxHQUFHLENBQUMsSUFBSSxHQUFHLEtBQUssR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtRQUM1RixNQUFNO1FBQ04sU0FBUyxFQUFFLGNBQWMsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLElBQUksY0FBYyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUU7UUFDekYsTUFBTSxFQUFFLGVBQWUsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDO1FBQzdELE1BQU0sRUFBRSxhQUFhLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUNyQyxjQUFjLEVBQUUsYUFBYTtRQUM3QixRQUFRO1FBQ1IsVUFBVSxFQUFFLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQztRQUM5QyxLQUFLO1FBQ0wsWUFBWSxFQUFFLFNBQVMsQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQztRQUNqRCxJQUFJLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUM7UUFDakMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxJQUFJLE1BQU07UUFDekQsUUFBUSxFQUFFO1lBQ04sZ0JBQWdCLENBQ1osWUFBWSxFQUNaLGVBQWUsRUFDZixLQUFLLElBQUksS0FBSyxFQUNkLE9BQU8sQ0FBQyxXQUFXLElBQUksTUFBTSxFQUM3QixhQUFhLEVBQ2IsUUFBUSxDQUNYO1NBQ0o7UUFDRCxTQUFTLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUM7UUFDM0MsT0FBTyxFQUFFLGFBQWEsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO1FBQ3ZDLGtCQUFrQixFQUFFLGFBQWEsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUM7UUFDN0QsYUFBYSxFQUFFLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDO1FBQy9ELE9BQU8sRUFBRSxTQUFTLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUM7S0FDNUMsQ0FBQTtBQUNMLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsMEJBQTBCO0FBQzFCLDhFQUE4RTtBQUU5RSxTQUFTLGlCQUFpQixDQUFDLElBQVk7SUFDbkMsTUFBTSxVQUFVLEdBQ1osSUFBSSxDQUFDLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQTtJQUMvRSxNQUFNLE1BQU0sR0FBRyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUE7SUFFdEMsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNqQyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBRW5DLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSSxHQUFHLElBQUksS0FBSyxFQUFFLENBQUM7UUFDNUIsT0FBTyxJQUFJLENBQUE7SUFDZixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUE7QUFDdkMsQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQUMsS0FBYTtJQUN6QyxPQUFPLEtBQUs7U0FDUCxPQUFPLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQztTQUN0QixPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQztTQUNyQixPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQztTQUNyQixPQUFPLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQztTQUM3QixJQUFJLEVBQUUsQ0FBQTtBQUNmLENBQUM7QUFFRCxTQUFTLHVCQUF1QixDQUFDLElBQVk7SUFDekMsTUFBTSxVQUFVLEdBQ1osSUFBSSxDQUFDLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQTtJQUMvRSxNQUFNLE1BQU0sR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFBO0lBRS9DLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDakMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDWixPQUFPLElBQUksQ0FBQTtJQUNmLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3BDLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUNmLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQTtJQUNwQixJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUE7SUFDckIsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFBO0lBQ2xCLElBQUksWUFBWSxHQUFHLENBQUMsQ0FBQTtJQUNwQixJQUFJLGNBQWMsR0FBRyxLQUFLLENBQUE7SUFFMUIsS0FBSyxNQUFNLEVBQUUsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUN4QixJQUFJLFFBQVEsSUFBSSxDQUFDLEVBQUUsS0FBSyxJQUFJLElBQUksRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQTtZQUNmLFNBQVE7UUFDWixDQUFDO1FBRUQsSUFBSSxRQUFRLElBQUksRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQzFCLE1BQU0sSUFBSSxHQUFHLENBQUE7WUFDYixTQUFRO1FBQ1osQ0FBQztRQUVELE1BQU0sSUFBSSxFQUFFLENBQUE7UUFFWixJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ1osU0FBUyxHQUFHLEtBQUssQ0FBQTtZQUNqQixTQUFRO1FBQ1osQ0FBQztRQUVELElBQUksUUFBUSxJQUFJLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUMxQixTQUFTLEdBQUcsSUFBSSxDQUFBO1lBQ2hCLFNBQVE7UUFDWixDQUFDO1FBRUQsSUFBSSxFQUFFLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDYixRQUFRLEdBQUcsQ0FBQyxRQUFRLENBQUE7WUFDcEIsU0FBUTtRQUNaLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ1gsU0FBUTtRQUNaLENBQUM7UUFFRCxJQUFJLEVBQUUsS0FBSyxHQUFHLEVBQUUsQ0FBQztZQUNiLFVBQVUsSUFBSSxDQUFDLENBQUE7WUFDZixjQUFjLEdBQUcsSUFBSSxDQUFBO1lBQ3JCLFNBQVE7UUFDWixDQUFDO1FBRUQsSUFBSSxFQUFFLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDYixJQUFJLFVBQVUsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDakIsVUFBVSxJQUFJLENBQUMsQ0FBQTtZQUNuQixDQUFDO1lBRUQsSUFBSSxjQUFjLElBQUksVUFBVSxLQUFLLENBQUMsSUFBSSxZQUFZLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzNELE9BQU8sc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDekMsQ0FBQztZQUVELFNBQVE7UUFDWixDQUFDO1FBRUQsSUFBSSxFQUFFLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDYixZQUFZLElBQUksQ0FBQyxDQUFBO1lBQ2pCLFNBQVE7UUFDWixDQUFDO1FBRUQsSUFBSSxFQUFFLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDYixJQUFJLFlBQVksR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDbkIsWUFBWSxJQUFJLENBQUMsQ0FBQTtZQUNyQixDQUFDO1lBQ0QsU0FBUTtRQUNaLENBQUM7SUFDTCxDQUFDO0lBRUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ2xCLE9BQU8sSUFBSSxDQUFBO0lBQ2YsQ0FBQztJQUVELElBQUksUUFBUSxHQUFHLE1BQU0sQ0FBQTtJQUVyQixJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ1gsUUFBUSxJQUFJLEdBQUcsQ0FBQTtJQUNuQixDQUFDO0lBRUQsSUFBSSxZQUFZLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbkIsUUFBUSxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUE7SUFDeEMsQ0FBQztJQUVELElBQUksVUFBVSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pCLFFBQVEsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRCxPQUFPLHNCQUFzQixDQUFDLFFBQVEsQ0FBQyxDQUFBO0FBQzNDLENBQUM7QUFJRCxTQUFTLHNCQUFzQixDQUMzQixXQUFtQixFQUNuQixZQUFxQjtJQUVyQixNQUFNLFVBQVUsR0FBeUQsRUFBRSxDQUFBO0lBQzNFLE1BQU0sTUFBTSxHQUFHLHNCQUFzQixDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQ2xELElBQUksTUFBTSxFQUFFLENBQUM7UUFDVCxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQTtJQUN6RCxDQUFDO0lBRUQsTUFBTSxTQUFTLEdBQUcsaUJBQWlCLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDaEQsSUFBSSxTQUFTLEVBQUUsQ0FBQztRQUNaLE1BQU0sVUFBVSxHQUFHLHNCQUFzQixDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3BELElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDakQsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDaEUsQ0FBQztJQUNMLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyx1QkFBdUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUNyRCxJQUFJLFFBQVEsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssUUFBUSxDQUFDLEVBQUUsQ0FBQztRQUMzRCxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQTtJQUM3RCxDQUFDO0lBRUQsSUFBSSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7SUFFekIsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUNqQyxJQUFJLENBQUM7WUFDRCxPQUFPO2dCQUNILEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQTBCO2dCQUMxRCxRQUFRLEVBQUUsU0FBUyxDQUFDLFFBQVE7YUFDL0IsQ0FBQTtRQUNMLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ2xCLGdCQUFnQixHQUFHLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixDQUFBO1FBQ3JGLENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxZQUFZLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsWUFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUMzRSxNQUFNLFdBQVcsR0FBRyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUVoRixNQUFNLElBQUksS0FBSyxDQUNYLG1DQUFtQyxZQUFZLEtBQUssWUFBWSxDQUFDLFdBQVcsRUFBRSxHQUFHLENBQUMsR0FBRyxXQUFXLEVBQUUsQ0FDckcsQ0FBQTtBQUNMLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxJQUFZLEVBQUUsTUFBTSxHQUFHLEdBQUc7SUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDbkQsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2QsT0FBTyxTQUFTLENBQUE7SUFDcEIsQ0FBQztJQUNELE9BQU8sVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUE7QUFDdEMsQ0FBQztBQUVELDhFQUE4RTtBQUM5RSx3QkFBd0I7QUFDeEIsOEVBQThFO0FBRTlFLFNBQVMsY0FBYztJQUNuQixzRUFBc0U7SUFDdEUsaUZBQWlGO0lBQ2pGLE9BQU8sU0FBUyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxJQUFJLGtCQUFrQixDQUFBO0FBQ3pFLENBQUM7QUFFRCxTQUFTLGtCQUFrQjtJQUN2QixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO0lBQ3BELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDM0IsT0FBTyxLQUFLLENBQUE7SUFDaEIsQ0FBQztJQUNELE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDOUQsQ0FBQztBQUVELFNBQVMsd0JBQXdCO0lBQzdCLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixDQUFDLENBQUE7SUFDM0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUMzQixPQUFPLEdBQUcsQ0FBQTtJQUNkLENBQUM7SUFDRCxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQzVELENBQUM7QUFFRCw4RUFBOEU7QUFDOUUseURBQXlEO0FBQ3pELHNGQUFzRjtBQUN0Riw4RUFBOEU7QUFFOUUsU0FBUyxXQUFXLENBQUMsT0FBcUI7SUFDdEMsTUFBTSxJQUFJLEdBQUc7UUFDVCxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7UUFDcEIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO1FBQzFCLFdBQVcsRUFBRSxPQUFPLENBQUMsV0FBVztRQUNoQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7UUFDcEIsWUFBWSxFQUFFLE9BQU8sQ0FBQyxZQUFZO1FBQ2xDLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtRQUNsQixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7UUFDMUIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1FBQzlCLGNBQWMsRUFBRSxPQUFPLENBQUMsY0FBYztRQUN0QyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07UUFDdEIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3BDLEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSztZQUNkLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRztZQUNWLE1BQU0sRUFBRSxDQUFDLENBQUMsTUFBTTtTQUNuQixDQUFDLENBQUM7S0FDTixDQUFBO0lBRUQsT0FBTztRQUNILDZFQUE2RTtRQUM3RSxnRkFBZ0Y7UUFDaEYsUUFBUTtRQUNSLCtKQUErSjtRQUMvSiwrQ0FBK0M7UUFDL0MsMERBQTBEO1FBQzFELHlEQUF5RDtRQUN6RCwyRkFBMkY7UUFDM0YsMEVBQTBFO1FBQzFFLDhDQUE4QztRQUM5QyxRQUFRO1FBQ1IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7S0FDdkIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7QUFDaEIsQ0FBQztBQUVELDhFQUE4RTtBQUM5RSw0RUFBNEU7QUFDNUUsOEVBQThFO0FBRTlFLEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxPQUFxQjtJQUNwRCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQTtJQUN6QyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDVixNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLGNBQWMsRUFBRSxDQUFBO0lBQzlCLE1BQU0sU0FBUyxHQUFHLGtCQUFrQixFQUFFLENBQUE7SUFDdEMsTUFBTSxlQUFlLEdBQUcsd0JBQXdCLEVBQUUsQ0FBQTtJQUVsRCwrQ0FBK0M7SUFDL0MsTUFBTSxHQUFHLEdBQUcsMkRBQTJELEtBQUssd0JBQXdCLE1BQU0sRUFBRSxDQUFBO0lBRTVHLE1BQU0sVUFBVSxHQUFHLElBQUksZUFBZSxFQUFFLENBQUE7SUFDeEMsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUNyRSxhQUFhLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQTtJQUV2QixNQUFNLEtBQUssR0FBRyxDQUFDLE1BQU0sTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFBO0lBRWxELElBQUksQ0FBQztRQUNELE9BQU8sQ0FBQyxHQUFHLENBQ1AsOEJBQThCLEtBQUssYUFBYSxTQUFTLHVCQUF1QixlQUFlLEdBQUcsQ0FDckcsQ0FBQTtRQUVELE1BQU0sV0FBVyxHQUFHO1lBQ2hCLFFBQVEsRUFBRTtnQkFDTjtvQkFDSSxJQUFJLEVBQUUsTUFBTTtvQkFDWixLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxXQUFXLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztpQkFDMUM7YUFDSjtZQUNELGdCQUFnQixFQUFFO2dCQUNkLFdBQVcsRUFBRSxHQUFHO2dCQUNoQixlQUFlO2dCQUNmLDREQUE0RDtnQkFDNUQsZ0JBQWdCLEVBQUUsa0JBQWtCO2FBQ3ZDO1NBQ0osQ0FBQTtRQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLEdBQUcsRUFBRTtZQUM5QixNQUFNLEVBQUUsTUFBTTtZQUNkLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtZQUMvQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUM7WUFDakMsTUFBTSxFQUFFLFVBQVUsQ0FBQyxNQUFNO1NBQzVCLENBQUMsQ0FBQTtRQUVGLE1BQU0sT0FBTyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFBO1FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQ1Asb0JBQW9CLFFBQVEsQ0FBQyxNQUFNLGNBQWMsWUFBWSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsRUFBRSxDQUNoRixDQUFBO1FBRUQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLFFBQVEsQ0FBQyxNQUFNLE1BQU0sWUFBWSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMzRixDQUFDO1FBRUQsSUFBSSxPQU1ILENBQUE7UUFFRCxJQUFJLENBQUM7WUFDRCxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNqQyxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqRixDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQ3pCLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUNqRSxDQUFDO1FBRUQsTUFBTSxXQUFXLEdBQUcsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUM7YUFDOUQsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQzthQUN4QixJQUFJLENBQUMsRUFBRSxDQUFDO2FBQ1IsSUFBSSxFQUFFLENBQUE7UUFDWCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsWUFBWSxJQUFJLFNBQVMsQ0FBQTtRQUV2RSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDZixNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxZQUFZLEdBQUcsQ0FBQyxDQUFBO1FBQ3BGLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxzQkFBc0IsQ0FBQyxXQUFXLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDaEUsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQy9CLE9BQU8sQ0FBQyxJQUFJLENBQ1Isa0NBQWtDLE1BQU0sQ0FBQyxRQUFRLGlDQUFpQyxZQUFZLEdBQUcsQ0FDcEcsQ0FBQTtRQUNMLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUE7SUFDdkIsQ0FBQztJQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7UUFDbEIsSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO1lBQy9CLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLFNBQVMsSUFBSSxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUNELE1BQU0sS0FBSyxDQUFBO0lBQ2YsQ0FBQztZQUFTLENBQUM7UUFDUCxZQUFZLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDL0IsQ0FBQztBQUNMLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsMENBQTBDO0FBQzFDLDJFQUEyRTtBQUMzRSwrREFBK0Q7QUFDL0QsOEVBQThFO0FBRTlFLFNBQVMsa0JBQWtCLENBQUMsSUFBa0IsRUFBRSxLQUE0QjtJQUN4RSxNQUFNLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ3ZELE1BQU0sS0FBSyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUE7SUFDdEQsTUFBTSxNQUFNLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsRSxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFBO0lBQ2hFLE1BQU0sYUFBYSxHQUFHLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBRXZGLE1BQU0sTUFBTSxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN6RCxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFBO0lBQ2hGLE1BQU0sSUFBSSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUE7SUFFdEMsTUFBTSxXQUFXLEdBQWlCLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSTtRQUNwRCxLQUFLLEVBQUUsU0FBUztRQUNoQixHQUFHLEVBQUUsUUFBUSxDQUFDLEtBQUssSUFBSSxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQztRQUN6RSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07UUFDbkIsY0FBYyxFQUFFLGFBQWE7UUFDN0IsUUFBUTtLQUNYLENBQUE7SUFFRCxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQ3ZFLE1BQU0sUUFBUSxHQUNWLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUNsQixDQUFDLENBQUMsV0FBVzthQUNOLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2FBQ1gsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FDUCxnQkFBZ0IsQ0FDWixDQUFDLEVBQ0QsV0FBVyxFQUNYLEtBQUssSUFBSSxLQUFLLEVBQ2QsSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUMvQixhQUFhLEVBQ2IsUUFBUSxDQUNYLENBQ0o7UUFDUCxDQUFDLENBQUM7WUFDSSxnQkFBZ0IsQ0FDWixXQUFXLEVBQ1gsV0FBVyxFQUNYLEtBQUssSUFBSSxLQUFLLEVBQ2QsSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUMvQixhQUFhLEVBQ2IsUUFBUSxDQUNYO1NBQ0osQ0FBQTtJQUVYLE9BQU87UUFDSCxHQUFHLElBQUk7UUFDUCxLQUFLO1FBQ0wsUUFBUSxFQUFFLFNBQVMsQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDeEUsV0FBVyxFQUFFLFNBQVMsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxXQUFXO1FBQ2xFLE1BQU07UUFDTixTQUFTO1FBQ1QsTUFBTTtRQUNOLE1BQU0sRUFBRSxhQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxNQUFNO1FBQ2xELGNBQWMsRUFBRSxhQUFhO1FBQzdCLFFBQVE7UUFDUixVQUFVLEVBQUUsU0FBUyxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVU7UUFDL0QsS0FBSztRQUNMLFlBQVksRUFBRSxTQUFTLENBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsWUFBWTtRQUNwRSxJQUFJLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUk7UUFDeEMsUUFBUTtRQUNSLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDN0UsdURBQXVEO1FBQ3ZELFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztRQUN6QixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87UUFDckIsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtRQUMzQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7UUFDN0IsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO0tBQ3hCLENBQUE7QUFDTCxDQUFDO0FBRUQsOEVBQThFO0FBQzlFLGtFQUFrRTtBQUNsRSw4RUFBOEU7QUFFdkUsS0FBSyxVQUFVLGtCQUFrQixDQUNwQyxhQUEyQixFQUMzQixPQUE2QjtJQUU3QixNQUFNLE9BQU8sR0FBRyxtQkFBbUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUVsRCxJQUFJLE9BQU8sRUFBRSxLQUFLLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDM0IsT0FBTztZQUNILE9BQU87WUFDUCxFQUFFLEVBQUU7Z0JBQ0EsSUFBSSxFQUFFLEtBQUs7Z0JBQ1gsUUFBUSxFQUFFLE1BQU07Z0JBQ2hCLEtBQUssRUFBRSxJQUFJO2dCQUNYLElBQUksRUFBRSxzQ0FBc0M7YUFDL0M7U0FDSixDQUFBO0lBQ0wsQ0FBQztJQUVELElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQzlCLE9BQU87WUFDSCxPQUFPO1lBQ1AsRUFBRSxFQUFFO2dCQUNBLElBQUksRUFBRSxLQUFLO2dCQUNYLFFBQVEsRUFBRSxNQUFNO2dCQUNoQixLQUFLLEVBQUUsSUFBSTtnQkFDWCxJQUFJLEVBQUUsZ0VBQWdFO29CQUNsRSxzREFBc0Q7YUFDN0Q7U0FDSixDQUFBO0lBQ0wsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLGNBQWMsRUFBRSxDQUFBO0lBRTlCLElBQUksQ0FBQztRQUNELE1BQU0sUUFBUSxHQUFHLE1BQU0sbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDbkQsTUFBTSxhQUFhLEdBQUcsbUJBQW1CLENBQUMsa0JBQWtCLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7UUFFaEYsT0FBTztZQUNILE9BQU8sRUFBRSxhQUFhO1lBQ3RCLEVBQUUsRUFBRTtnQkFDQSxJQUFJLEVBQUUsSUFBSTtnQkFDVixRQUFRLEVBQUUsUUFBUTtnQkFDbEIsS0FBSzthQUNSO1NBQ0osQ0FBQTtJQUNMLENBQUM7SUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1FBQ2xCLE1BQU0sTUFBTSxHQUFXLEtBQUssRUFBRSxPQUFPLElBQUksZUFBZSxDQUFBO1FBQ3hELE9BQU8sQ0FBQyxJQUFJLENBQUMsOEVBQThFLE1BQU0sRUFBRSxDQUFDLENBQUE7UUFFcEcsT0FBTztZQUNILE9BQU87WUFDUCxFQUFFLEVBQUU7Z0JBQ0EsSUFBSSxFQUFFLEtBQUs7Z0JBQ1gsUUFBUSxFQUFFLE1BQU07Z0JBQ2hCLEtBQUssRUFBRSxJQUFJO2dCQUNYLElBQUksRUFBRSxtREFBbUQsTUFBTSxFQUFFO2FBQ3BFO1NBQ0osQ0FBQTtJQUNMLENBQUM7QUFDTCxDQUFDIn0=