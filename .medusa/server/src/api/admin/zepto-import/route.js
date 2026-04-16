"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = void 0;
const zepto_scraper_1 = require("../../../lib/zepto-scraper");
const zepto_ai_refiner_1 = require("../../../lib/zepto-ai-refiner");
// POST /admin/zepto-import
const POST = async (req, res) => {
    const { url, use_ai } = (req.body ?? {});
    const normalizedUrl = String(url ?? "").trim();
    if (!normalizedUrl || !/^https?:\/\/([a-z0-9-]+\.)*zepto\.com\//i.test(normalizedUrl)) {
        return res.status(400).json({ error: "Please provide a valid Zepto product URL." });
    }
    try {
        const scrapedProduct = await (0, zepto_scraper_1.scrapeZeptoProduct)(normalizedUrl);
        const refined = await (0, zepto_ai_refiner_1.refineZeptoProduct)(scrapedProduct, {
            useAi: use_ai !== false,
        });
        return res.status(200).json({
            product: refined.product,
            ai: refined.ai,
        });
    }
    catch (err) {
        console.error("[zepto-import] scrape error:", err.message);
        return res.status(500).json({ error: err.message || "Failed to fetch product from Zepto." });
    }
};
exports.POST = POST;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvYXBpL2FkbWluL3plcHRvLWltcG9ydC9yb3V0ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSw4REFBK0Q7QUFDL0Qsb0VBQWtFO0FBT2xFLDJCQUEyQjtBQUNwQixNQUFNLElBQUksR0FBRyxLQUFLLEVBQUUsR0FBa0IsRUFBRSxHQUFtQixFQUFFLEVBQUU7SUFDcEUsTUFBTSxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFvQixDQUFBO0lBQzNELE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7SUFFOUMsSUFBSSxDQUFDLGFBQWEsSUFBSSxDQUFDLDBDQUEwQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQ3RGLE9BQU8sR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUUsMkNBQTJDLEVBQUUsQ0FBQyxDQUFBO0lBQ3JGLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUEsa0NBQWtCLEVBQUMsYUFBYSxDQUFDLENBQUE7UUFDOUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFBLHFDQUFrQixFQUFDLGNBQWMsRUFBRTtZQUN2RCxLQUFLLEVBQUUsTUFBTSxLQUFLLEtBQUs7U0FDeEIsQ0FBQyxDQUFBO1FBRUYsT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQztZQUMxQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsRUFBRSxFQUFFLE9BQU8sQ0FBQyxFQUFFO1NBQ2YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUFDLE9BQU8sR0FBUSxFQUFFLENBQUM7UUFDbEIsT0FBTyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDMUQsT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsT0FBTyxJQUFJLHFDQUFxQyxFQUFFLENBQUMsQ0FBQTtJQUM5RixDQUFDO0FBQ0gsQ0FBQyxDQUFBO0FBdEJZLFFBQUEsSUFBSSxRQXNCaEIifQ==