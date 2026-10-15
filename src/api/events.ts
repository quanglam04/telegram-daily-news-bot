import { Env, EventItem } from "../types.js";
import { convertLunarEventToSolar, getNextEventOccurrence, getVietnamNow } from "../lib/lunar.js";

/**
 * Standard JSON response helper
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

/**
 * Handle CRUD operations for /api/events
 */
export async function handleEventsApi(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({ error: "Database binding 'DB' is missing" }, 500);
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Parse ID from path: /api/events/:id
  const match = url.pathname.match(/^\/api\/events(?:\/(\d+))?$/);
  if (!match) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const id = match[1] ? parseInt(match[1], 10) : null;

  // 1. GET /api/events or GET /api/events/:id
  if (method === "GET") {
    const today = getVietnamNow();

    if (id !== null) {
      const stmt = env.DB.prepare("SELECT * FROM events WHERE id = ?");
      const event = await stmt.bind(id).first<EventItem>();
      if (!event) {
        return jsonResponse({ error: "Event not found" }, 404);
      }
      return jsonResponse(withEventCountdown(event, today));
    }

    const category = url.searchParams.get("category");
    let query = "SELECT * FROM events";
    const params: (string | number)[] = [];

    if (category && category !== "all") {
      query += " WHERE category = ?";
      params.push(category);
    }

    query += " ORDER BY enabled DESC, target_date ASC";

    const stmt = env.DB.prepare(query);
    const { results } = await (params.length > 0 ? stmt.bind(...params) : stmt).all<EventItem>();

    const enhanced = (results || []).map((e) => withEventCountdown(e, today));
    return jsonResponse(enhanced);
  }

  // 2. POST /api/events
  if (method === "POST") {
    try {
      const body = (await request.json()) as Partial<EventItem>;

      if (!body.name || !body.target_date) {
        return jsonResponse({ error: "name and target_date are required" }, 400);
      }

      const name = body.name.trim();
      const category = body.category || "general";
      const emoji = body.emoji || "📌";
      let targetDate = body.target_date;
      const isLunar = body.is_lunar ? 1 : 0;
      const recurrence = body.recurrence || null;
      const notifyDays = body.notify_days || "7,3,1,0";
      let metadata = typeof body.metadata === "object" ? JSON.stringify(body.metadata) : body.metadata || "{}";
      const enabled = body.enabled === undefined || Number(body.enabled) === 1 ? 1 : 0;

      // If lunar: convert target_date to solar, store lunar info in metadata
      if (isLunar) {
        const converted = convertLunarDateAndMetadata(targetDate, metadata);
        if (!converted) {
          return jsonResponse({ error: "Không thể chuyển đổi ngày âm lịch sang dương lịch" }, 400);
        }
        targetDate = converted.solarDate;
        metadata = converted.metadata;
      }

      const stmt = env.DB.prepare(`
        INSERT INTO events (name, category, emoji, target_date, is_lunar, recurrence, notify_days, metadata, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      const result = await stmt
        .bind(name, category, emoji, targetDate, isLunar, recurrence, notifyDays, metadata, enabled)
        .run();

      const newId = result.meta.last_row_id;
      const created = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(newId).first<EventItem>();

      return jsonResponse(created ? withEventCountdown(created, getVietnamNow()) : { success: true, id: newId }, 201);
    } catch (err: unknown) {
      console.error("POST /api/events error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  }

  // 3. PUT /api/events/:id
  if (method === "PUT") {
    if (id === null) {
      return jsonResponse({ error: "Missing event id in path" }, 400);
    }

    try {
      const body = (await request.json()) as Partial<EventItem>;

      const existing = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventItem>();
      if (!existing) {
        return jsonResponse({ error: "Event not found" }, 404);
      }

      const name = body.name !== undefined ? body.name.trim() : existing.name;
      const category = body.category !== undefined ? body.category : existing.category;
      const emoji = body.emoji !== undefined ? body.emoji : existing.emoji;
      let targetDate = body.target_date !== undefined ? body.target_date : existing.target_date;
      const isLunar = body.is_lunar !== undefined ? (body.is_lunar ? 1 : 0) : existing.is_lunar;
      const recurrence = body.recurrence !== undefined ? body.recurrence : existing.recurrence;
      const notifyDays = body.notify_days !== undefined ? body.notify_days : existing.notify_days;
      let metadata =
        body.metadata !== undefined
          ? typeof body.metadata === "object"
            ? JSON.stringify(body.metadata)
            : body.metadata
          : existing.metadata;
      const enabled =
        body.enabled !== undefined ? (Number(body.enabled) === 1 ? 1 : 0) : existing.enabled;

      // If lunar and target_date changed: re-convert to solar
      if (isLunar && body.target_date !== undefined) {
        const converted = convertLunarDateAndMetadata(targetDate, metadata || "{}");
        if (!converted) {
          return jsonResponse({ error: "Không thể chuyển đổi ngày âm lịch sang dương lịch" }, 400);
        }
        targetDate = converted.solarDate;
        metadata = converted.metadata;
      }

      await env.DB.prepare(`
        UPDATE events
        SET name = ?, category = ?, emoji = ?, target_date = ?, is_lunar = ?, recurrence = ?, notify_days = ?, metadata = ?, enabled = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
        .bind(name, category, emoji, targetDate, isLunar, recurrence, notifyDays, metadata, enabled, id)
        .run();

      const updated = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventItem>();
      return jsonResponse(updated ? withEventCountdown(updated, getVietnamNow()) : { success: true });
    } catch (err: unknown) {
      console.error("PUT /api/events error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  }

  // 4. DELETE /api/events/:id
  if (method === "DELETE") {
    if (id === null) {
      return jsonResponse({ error: "Missing event id in path" }, 400);
    }

    const res = await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
    if (res.meta.changes === 0) {
      return jsonResponse({ error: "Event not found or already deleted" }, 404);
    }
    return jsonResponse({ success: true, message: `Event ${id} deleted` });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

/**
 * Recalculate all yearly events for a given target year.
 * - Lunar events: converts original lunar_day/lunar_month to solar date for targetYear.
 * - Solar events: updates target_date to targetYear.
 */
export async function recalculateYearlyLunarEvents(
  db: D1Database,
  targetYear: number
): Promise<{ updated: number; errors: string[] }> {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE recurrence = 'yearly' AND enabled = 1")
    .all<EventItem>();

  let updated = 0;
  const errors: string[] = [];

  for (const event of results || []) {
    try {
      let solarDateStr = "";

      if (event.is_lunar === 1) {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(event.metadata || "{}");
        } catch {
          /* skip invalid JSON */
        }

        const lunarDay = meta.lunar_day as number | undefined;
        const lunarMonth = meta.lunar_month as number | undefined;

        if (!lunarDay || !lunarMonth) {
          errors.push(`Event ${event.id} "${event.name}": missing lunar_day/lunar_month in metadata`);
          continue;
        }

        const solar = convertLunarEventToSolar(lunarDay, lunarMonth, targetYear);
        if (!solar) {
          errors.push(`Event ${event.id} "${event.name}": failed to convert lunar ${lunarDay}/${lunarMonth}/${targetYear}`);
          continue;
        }

        solarDateStr = `${solar.year}-${String(solar.month).padStart(2, "0")}-${String(solar.day).padStart(2, "0")}T00:00:00`;
      } else {
        const parsed = new Date(event.target_date);
        if (isNaN(parsed.getTime())) continue;
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const dd = String(parsed.getDate()).padStart(2, "0");
        const hh = String(parsed.getHours()).padStart(2, "0");
        const min = String(parsed.getMinutes()).padStart(2, "0");
        const ss = String(parsed.getSeconds()).padStart(2, "0");
        solarDateStr = `${targetYear}-${mm}-${dd}T${hh}:${min}:${ss}`;
      }

      await db
        .prepare("UPDATE events SET target_date = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(solarDateStr, event.id)
        .run();

      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Event ${event.id} "${event.name}": ${msg}`);
    }
  }

  return { updated, errors };
}

/**
 * Handle POST /api/events/recalculate?year=2027
 */
export async function handleRecalculate(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({ error: "Database binding 'DB' is missing" }, 500);
  }

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const targetYear = yearParam ? parseInt(yearParam, 10) : getVietnamNow().getFullYear() + 1;

  if (isNaN(targetYear) || targetYear < 2000 || targetYear > 2100) {
    return jsonResponse({ error: "Invalid year" }, 400);
  }

  const result = await recalculateYearlyLunarEvents(env.DB, targetYear);
  return jsonResponse({
    ok: true,
    targetYear,
    ...result,
  });
}

/**
 * Convert a lunar target_date to solar and merge lunar info into metadata.
 * Input target_date is treated as lunar: the month/day parts are lunar calendar values.
 */
function convertLunarDateAndMetadata(
  targetDateStr: string,
  existingMetadata: string
): { solarDate: string; metadata: string } | null {
  const parsed = new Date(targetDateStr);
  if (isNaN(parsed.getTime())) return null;

  const lunarDay = parsed.getDate();
  const lunarMonth = parsed.getMonth() + 1; // 1-12
  const lunarYear = parsed.getFullYear();

  const solar = convertLunarEventToSolar(lunarDay, lunarMonth, lunarYear);
  if (!solar) return null;

  // Merge lunar info into metadata
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(existingMetadata || "{}");
  } catch {
    /* ignore */
  }
  meta.lunar_day = lunarDay;
  meta.lunar_month = lunarMonth;

  const solarDate = `${solar.year}-${String(solar.month).padStart(2, "0")}-${String(solar.day).padStart(2, "0")}T00:00:00`;

  return { solarDate, metadata: JSON.stringify(meta) };
}

/**
 * Augment EventItem with computed countdown and occurrence dates for UI
 */
function withEventCountdown(event: EventItem, today: Date) {
  const occ = getNextEventOccurrence(
    event.target_date,
    event.recurrence,
    today
  );

  if (!occ) {
    return {
      ...event,
      days_remaining: null,
      next_occurrence: null,
      is_due_today: false,
      should_notify_today: false,
    };
  }

  const notifyList = (event.notify_days || "7,3,1,0")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  const shouldNotifyToday = notifyList.includes(occ.daysRemaining);

  const occY = occ.occDate.getFullYear();
  const occM = String(occ.occDate.getMonth() + 1).padStart(2, "0");
  const occD = String(occ.occDate.getDate()).padStart(2, "0");
  const nextOccurrenceStr = `${occY}-${occM}-${occD}`;

  return {
    ...event,
    days_remaining: occ.daysRemaining,
    next_occurrence: nextOccurrenceStr,
    is_due_today: occ.daysRemaining === 0,
    should_notify_today: shouldNotifyToday,
  };
}
