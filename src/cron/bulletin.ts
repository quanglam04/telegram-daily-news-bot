import { Article, Env, EventItem } from "../types.js";
import {
  formatDateVN,
  formatDayMonthVN,
  getNextEventOccurrence,
  getVietnamNow,
  tetCountdown,
  VIETNAMESE_WEEKDAYS,
} from "../lib/lunar.js";
import { escapeHtml, sendTelegramMessage } from "../lib/telegram.js";
import { cleanupOldSentArticles, fetchAndProcessNews, recordSentArticles } from "./news.js";

const WEATHER_TABLE: Record<number, string> = {
  0: "trời quang",
  1: "chủ yếu trời quang",
  2: "có mây",
  3: "nhiều mây",
  45: "có sương mù",
  48: "có sương mù",
  51: "mưa phùn nhẹ",
  53: "mưa phùn",
  55: "mưa phùn dày",
  61: "mưa nhẹ",
  63: "có mưa",
  65: "mưa lớn",
  71: "tuyết nhẹ",
  80: "mưa rào nhẹ",
  81: "có mưa rào",
  82: "mưa rào lớn",
  95: "có dông",
  96: "dông kèm mưa đá",
  99: "dông mạnh",
};

/**
 * Fetch Hanoi weather from Open-Meteo (free, no API key required)
 */
export async function getHanoiWeather(): Promise<string> {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FHo_Chi_Minh&forecast_days=1";
    const res = await fetch(url, {
      headers: { "User-Agent": "DailyNewsBot/1.0" },
    });

    if (!res.ok) {
      return "🌦 <b>Hà Nội:</b> Chưa lấy được dữ liệu thời tiết";
    }

    const data = (await res.json()) as {
      daily?: {
        temperature_2m_min?: number[];
        temperature_2m_max?: number[];
        precipitation_probability_max?: number[];
        weather_code?: number[];
      };
    };

    const daily = data.daily;
    if (!daily || !daily.weather_code || daily.weather_code.length === 0) {
      return "🌦 <b>Hà Nội:</b> Chưa lấy được dữ liệu thời tiết";
    }

    const lo = Math.round(daily.temperature_2m_min?.[0] ?? 24);
    const hi = Math.round(daily.temperature_2m_max?.[0] ?? 30);
    const rain = daily.precipitation_probability_max?.[0] ?? 0;
    const code = daily.weather_code[0];
    const desc = WEATHER_TABLE[code] || "thời tiết thay đổi";

    return `🌦 <b>Hà Nội:</b> ${lo}–${hi}°C, ${desc}, khả năng mưa ${rain}%`;
  } catch (err) {
    console.error("Open-Meteo weather fetch error:", err);
    return "🌦 <b>Hà Nội:</b> Chưa lấy được dữ liệu thời tiết";
  }
}

/**
 * Format events from D1: Due soon (reminders) and upcoming calendar events
 */
export function formatEventsSection(
  events: EventItem[],
  today: Date
): { dueSoonText: string; upcomingEventsText: string } {
  interface ResolvedEvent {
    item: EventItem;
    occDate: Date;
    daysRemaining: number;
    shouldNotify: boolean;
  }

  const resolved: ResolvedEvent[] = [];

  for (const item of events) {
    if (!item.enabled) continue;

    const occ = getNextEventOccurrence(
      item.target_date,
      item.recurrence,
      today
    );

    if (!occ) continue;

    // Parse notify_days, e.g. "7,3,1,0"
    const notifyList = (item.notify_days || "7,3,1,0")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const shouldNotify = notifyList.includes(occ.daysRemaining);

    resolved.push({
      item,
      occDate: occ.occDate,
      daysRemaining: occ.daysRemaining,
      shouldNotify,
    });
  }

  // 1. Due soon (SẮP ĐẾN HẠN) — Only quota/deadline categories
  const dueItems = resolved
    .filter(
      (r) =>
        (r.item.category === "quota" || r.item.category === "deadline") &&
        r.daysRemaining >= 0 &&
        r.shouldNotify
    )
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  let dueSoonText = "";
  if (dueItems.length > 0) {
    const lines = ["⏰ <b>SẮP ĐẾN HẠN</b>"];
    for (const r of dueItems) {
      const emoji = r.item.emoji || "📌";
      const name = escapeHtml(r.item.name);
      if (r.daysRemaining === 0) {
        lines.push(`${emoji} ${name} — <b>hết hạn hôm nay!</b>`);
      } else if (r.daysRemaining === 1) {
        lines.push(`${emoji} ${name} — <b>còn 1 ngày</b>`);
      } else {
        lines.push(`${emoji} ${name} — còn ${r.daysRemaining} ngày`);
      }
    }
    dueSoonText = lines.join("\n");
  }

  // 2. Upcoming events (SỰ KIỆN SẮP TỚI) — Only holiday/personal/general (exclude quota/deadline)
  const upcomingList = resolved
    .filter(
      (r) =>
        r.item.category !== "quota" &&
        r.item.category !== "deadline" &&
        r.daysRemaining >= 0 &&
        r.daysRemaining <= 40
    )
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, 5);

  let upcomingEventsText = "";
  if (upcomingList.length > 0) {
    const lines = ["📌 <b>SỰ KIỆN SẮP TỚI</b>"];
    for (const r of upcomingList) {
      const name = escapeHtml(r.item.name);
      const dm = formatDayMonthVN(r.occDate);
      const when = r.daysRemaining === 0 ? "hôm nay" : `còn ${r.daysRemaining} ngày`;

      let lunarNote = "";
      if (r.item.is_lunar) {
        try {
          const meta = JSON.parse(r.item.metadata || "{}");
          if (meta.lunar_day && meta.lunar_month) {
            const ld = String(meta.lunar_day).padStart(2, "0");
            const lm = String(meta.lunar_month).padStart(2, "0");
            lunarNote = ` (${ld}/${lm} ÂL)`;
          }
        } catch {
          /* ignore */
        }
      }

      lines.push(`• ${dm} — ${name}${lunarNote} (${when})`);
    }
    upcomingEventsText = lines.join("\n");
  }

  return { dueSoonText, upcomingEventsText };
}

/**
 * Format article list for Telegram
 */
export function formatArticles(title: string, icon: string, articles: Article[]): string {
  const head = `${icon} <b>${escapeHtml(title)}</b>`;
  if (articles.length === 0) {
    return `${head}\n<i>Chưa có tin tức mới.</i>`;
  }

  const blocks: string[] = [];
  for (let idx = 0; idx < articles.length; idx++) {
    const a = articles[idx];
    const safeTitle = escapeHtml(a.title);
    const safeLink = escapeHtml(a.link);
    const heat = (a.source_count ?? 1) >= 3 ? " 🔥" : "";
    const parts = [`${idx + 1}. <a href="${safeLink}">${safeTitle}</a>${heat}`];

    if (a.summary) {
      parts.push(`   ${escapeHtml(a.summary)}`);
    }

    if ((a.source_count ?? 1) >= 2 && a.all_sources && a.all_sources.length > 0) {
      const srcs = escapeHtml(a.all_sources.join(", "));
      parts.push(`   <i>${a.source_count} nguồn: ${srcs}</i>`);
    } else {
      parts.push(`   <i>Nguồn: ${escapeHtml(a.source)}</i>`);
    }

    blocks.push(parts.join("\n"));
  }

  return `${head}\n${blocks.join("\n\n")}`;
}

/**
 * Build the complete bulletin message
 */
export async function buildBulletin(
  env: Env,
  today: Date = getVietnamNow()
): Promise<{ fullMessage: string; newsArticles: Article[] }> {
  // 1. Fetch events from D1
  let events: EventItem[] = [];
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT * FROM events WHERE enabled = 1").all<EventItem>();
      events = results || [];
    } catch (err) {
      console.error("Failed to query events from D1:", err);
    }
  }

  // 2. Fetch Hanoi weather & RSS news in parallel
  const [weatherStr, newsData] = await Promise.all([
    getHanoiWeather(),
    fetchAndProcessNews(env, { vietnam: 5, tech: 3 }),
  ]);

  // 3. Date header
  const weekdayStr = VIETNAMESE_WEEKDAYS[today.getDay()] || "THỨ NĂM";
  const dateStr = formatDateVN(today);
  const header = `🌅 <b>BẢN TIN SÁNG</b>\n📅 <b>${weekdayStr}, ${dateStr}</b>\n${weatherStr}`;

  // 4. Events & Tet countdown
  const { dueSoonText, upcomingEventsText } = formatEventsSection(events, today);
  const tet = tetCountdown(today);
  const tetStr = `🎊 <b>Còn ${tet.days} ngày nữa đến Tết ${tet.canChiYear} (${formatDateVN(tet.tetDate)})</b>`;

  // Combine event sections
  const eventSections: string[] = [];
  if (dueSoonText) eventSections.push(dueSoonText);
  if (upcomingEventsText) {
    eventSections.push(upcomingEventsText + "\n" + tetStr);
  } else {
    eventSections.push(tetStr);
  }

  // 5. News sections
  const vnNewsStr = formatArticles("TIN NÓNG VIỆT NAM", "🇻🇳", newsData.vietnamNews);
  const techNewsStr = formatArticles("CÔNG NGHỆ & AI", "💻", newsData.techNews);

  const sections: string[] = [
    header,
    eventSections.join("\n\n"),
    vnNewsStr,
    techNewsStr,
    "<i>Bản tin được tổng hợp tự động từ RSS.</i>",
  ];

  const fullMessage = sections.filter(Boolean).join("\n\n");
  const allArticles = [...newsData.vietnamNews, ...newsData.techNews];

  return { fullMessage, newsArticles: allArticles };
}

/**
 * Scheduled cron job runner
 */
export async function runDailyBulletin(
  env: Env,
  sendTelegram = true
): Promise<{ ok: boolean; message: string; messageId?: number; error?: string }> {
  console.log("Starting Daily Bulletin generation...");
  const today = getVietnamNow();
  const { fullMessage, newsArticles } = await buildBulletin(env, today);

  let sendResult: { ok: boolean; messageId?: number; error?: string } = { ok: true };

  if (sendTelegram) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing, skipped sending");
      sendResult = { ok: false, messageId: undefined, error: "Telegram credentials missing" };
    } else {
      sendResult = await sendTelegramMessage(botToken, chatId, fullMessage);
    }
  }

  // Record sent articles into D1
  if (env.DB && newsArticles.length > 0) {
    await recordSentArticles(newsArticles, env.DB);
    await cleanupOldSentArticles(env.DB);
  }

  return {
    ok: sendResult.ok,
    message: fullMessage,
    messageId: sendResult.messageId,
    error: sendResult.error,
  };
}
