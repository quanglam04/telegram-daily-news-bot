export interface Env {
  DB: D1Database;
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;
  GROQ_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ASSETS?: Fetcher;
}

export type EventCategory = 'quota' | 'holiday' | 'personal' | 'deadline' | 'general';
export type RecurrenceType = 'yearly' | 'monthly' | null;

export interface EventItem {
  id?: number;
  name: string;
  category: EventCategory | string;
  emoji?: string;
  target_date: string; // ISO datetime, e.g. "2026-10-10T17:00:00"
  is_lunar?: number; // 0 = solar, 1 = lunar
  recurrence?: RecurrenceType | string | null;
  notify_days?: string; // e.g. "7,3,1,0"
  metadata?: string | null; // JSON string
  enabled?: number; // 1 or 0
  created_at?: string;
  updated_at?: string;
}

export interface EventCountdown {
  event: EventItem;
  daysLeft: number;
  nextOccurrence: string; // YYYY-MM-DD
  isToday: boolean;
  shouldNotify: boolean;
}

export interface FeedConfig {
  name: string;
  url: string;
}

export interface Article {
  title: string;
  link: string;
  source: string;
  description: string;
  position: number;
  summary?: string;
  source_count?: number;
  all_sources?: string[];
  url_hash?: string;
}

export interface BulletinData {
  header: string;
  hanoiWeather: string;
  tetCountdown: string;
  upcomingEvents: string;
  dueSoonEvents: string;
  vietnamNews: string;
  techNews: string;
  fullMessage: string;
}
