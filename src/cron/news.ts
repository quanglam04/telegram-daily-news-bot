import { Article, Env } from "../types.js";
import { getHotArticles, TECH_FEEDS, VIETNAM_FEEDS } from "../lib/rss.js";
import { attachSummaries } from "../lib/groq.js";

export interface ProcessedNews {
  vietnamNews: Article[];
  techNews: Article[];
}

/**
 * Fetch hot news from Vietnam & Tech RSS feeds, dedup against D1 sent_articles,
 * and attach AI summaries.
 */
export async function fetchAndProcessNews(
  env: Env,
  limits = { vietnam: 5, tech: 3 }
): Promise<ProcessedNews> {
  // Fetch both in parallel
  const [vietnamNews, techNews] = await Promise.all([
    getHotArticles(VIETNAM_FEEDS, limits.vietnam, env.DB),
    getHotArticles(TECH_FEEDS, limits.tech, env.DB),
  ]);

  // Summarize both categories
  await Promise.all([
    attachSummaries(vietnamNews, env),
    attachSummaries(techNews, env),
  ]);

  return { vietnamNews, techNews };
}

/**
 * Save newly sent article hashes to D1 to prevent duplicate sends
 */
export async function recordSentArticles(articles: Article[], db: D1Database): Promise<void> {
  if (!db || articles.length === 0) return;

  const valid = articles.filter((a) => a.url_hash);
  if (valid.length === 0) return;

  try {
    const stmts = valid.map((a) =>
      db
        .prepare("INSERT OR IGNORE INTO sent_articles (url_hash, title, sent_at) VALUES (?, ?, datetime('now'))")
        .bind(a.url_hash, a.title)
    );
    await db.batch(stmts);
  } catch (err) {
    console.error("Failed to record sent_articles into D1:", err);
  }
}

/**
 * Clean up sent_articles older than 7 days
 */
export async function cleanupOldSentArticles(db: D1Database): Promise<void> {
  if (!db) return;
  try {
    await db.prepare("DELETE FROM sent_articles WHERE sent_at < datetime('now', '-7 days')").run();
  } catch (err) {
    console.error("Failed to cleanup old sent_articles:", err);
  }
}
