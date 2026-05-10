/**
 * Zepto Importer Configuration
 * Centralized settings for API keys, models, rate limits, and defaults.
 */

export const ZeptoConfig = {
    ai: {
        // Models to use for AI refinement, in order of preference.
        // If a model fails or is rate-limited, it will fall back to the next one.
        models: [
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-3.1-flash-lite-preview",
        ],

        // Timeout in milliseconds for AI requests
        timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,

        // Max output tokens for Gemini
        maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 4096,

        // All Gemini API keys for rate limit rotation. Add more in .env
        apiKeys: [
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
        ].filter((key) => typeof key === "string" && key.trim().length > 0) as string[],
    },
    import: {
        // Delay in milliseconds between scrapes during bulk import to avoid rate limiting
        scrapeDelayMs: 2000,
    }
}
