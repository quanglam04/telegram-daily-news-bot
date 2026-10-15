import { Env } from "./types.js";
import { handleEventsApi, handleRecalculate, jsonResponse, recalculateYearlyLunarEvents } from "./api/events.js";
import { buildBulletin, runDailyBulletin } from "./cron/bulletin.js";
import { getVietnamNow } from "./lib/lunar.js";

export default {
  /**
   * HTTP request router: CMS static assets + REST APIs
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle API routes
    if (url.pathname === "/api/events/recalculate" && request.method === "POST") {
      return handleRecalculate(request, env);
    }

    if (url.pathname.startsWith("/api/events")) {
      return handleEventsApi(request, env);
    }

    // Manual bulletin trigger: POST /api/trigger or POST /api/bulletin/send
    if (
      (url.pathname === "/api/trigger" || url.pathname === "/api/bulletin/send") &&
      request.method === "POST"
    ) {
      try {
        const result = await runDailyBulletin(env, true);
        return jsonResponse(result);
      } catch (err: unknown) {
        console.error("Manual trigger error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ ok: false, error: msg }, 500);
      }
    }

    // Bulletin preview (does NOT send to Telegram): GET /api/bulletin/preview
    if (url.pathname === "/api/bulletin/preview" && request.method === "GET") {
      try {
        const today = getVietnamNow();
        const { fullMessage, newsArticles } = await buildBulletin(env, today);
        return jsonResponse({
          ok: true,
          message: fullMessage,
          articleCount: newsArticles.length,
        });
      } catch (err: unknown) {
        console.error("Preview error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ ok: false, error: msg }, 500);
      }
    }

    // Health check endpoint: GET /api/health
    if (url.pathname === "/api/health") {
      return jsonResponse({
        status: "ok",
        time: getVietnamNow().toISOString(),
        hasDb: !!env.DB,
        hasTelegramToken: !!env.TELEGRAM_BOT_TOKEN,
        hasGroqKey: !!env.GROQ_API_KEY,
      });
    }

    // 2. Serve static assets via Cloudflare Worker Assets
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Cloudflare Cron Trigger (Runs at 02:00 UTC = 09:00 VN)
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron triggered at ${new Date().toISOString()} (cron: ${controller.cron})`);

    const today = getVietnamNow();

    // Year-end: auto-recalculate lunar events for next year on Dec 31
    if (today.getMonth() === 11 && today.getDate() === 31 && env.DB) {
      const nextYear = today.getFullYear() + 1;
      console.log(`Year-end detected! Recalculating lunar events for ${nextYear}...`);
      ctx.waitUntil(
        recalculateYearlyLunarEvents(env.DB, nextYear)
          .then((r) => console.log(`Recalculated ${r.updated} lunar events for ${nextYear}`, r.errors))
          .catch((err) => console.error("Year-end recalculation failed:", err))
      );
    }

    ctx.waitUntil(
      runDailyBulletin(env, true).catch((err) => {
        console.error("Scheduled bulletin execution failed:", err);
      })
    );
  },
};
