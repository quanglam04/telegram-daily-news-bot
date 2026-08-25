import html
import math
import os
import re
import unicodedata
from datetime import date, datetime
from difflib import SequenceMatcher
from zoneinfo import ZoneInfo

import feedparser
import requests
from bs4 import BeautifulSoup



BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

VIETNAM_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


VIETNAM_FEEDS = [
    ("VnExpress", "https://vnexpress.net/rss/tin-moi-nhat.rss"),
    ("Tuổi Trẻ", "https://tuoitre.vn/rss/tin-moi-nhat.rss"),
    ("Thanh Niên", "https://thanhnien.vn/rss/home.rss"),
    ("Dân Trí", "https://dantri.com.vn/rss/home.rss"),
    ("VietnamNet", "https://vietnamnet.vn/rss/tin-moi-nong.rss"),
]

TECH_FEEDS = [
    ("VnExpress Số hóa", "https://vnexpress.net/rss/so-hoa.rss"),
    ("Tuổi Trẻ Nhịp sống số", "https://tuoitre.vn/rss/nhip-song-so.rss"),
    ("Dân Trí Công nghệ", "https://dantri.com.vn/rss/suc-manh-so.rss"),
]

WEEKDAYS = {
    0: "THỨ HAI", 1: "THỨ BA", 2: "THỨ TƯ", 3: "THỨ NĂM",
    4: "THỨ SÁU", 5: "THỨ BẢY", 6: "CHỦ NHẬT",
}


SOLAR_EVENTS = [
    (1, 1, "Tết Dương lịch"),
    (14, 2, "Lễ Tình nhân"),
    (8, 3, "Quốc tế Phụ nữ"),
    (26, 3, "Thành lập Đoàn TNCS Hồ Chí Minh"),
    (30, 4, "Giải phóng miền Nam"),
    (1, 5, "Quốc tế Lao động"),
    (19, 5, "Sinh nhật Chủ tịch Hồ Chí Minh"),
    (1, 6, "Quốc tế Thiếu nhi"),
    (21, 6, "Ngày Báo chí Cách mạng Việt Nam"),
    (27, 7, "Ngày Thương binh - Liệt sĩ"),
    (2, 9, "Quốc khánh"),
    (20, 10, "Ngày Phụ nữ Việt Nam"),
    (20, 11, "Ngày Nhà giáo Việt Nam"),
    (22, 12, "Thành lập Quân đội Nhân dân Việt Nam"),
    (25, 12, "Lễ Giáng sinh"),
]


LUNAR_EVENTS = [
    (15, 1, "Tết Nguyên Tiêu (Rằm tháng Giêng)"),
    (10, 3, "Giỗ Tổ Hùng Vương"),
    (5, 5, "Tết Đoan Ngọ"),
    (15, 7, "Lễ Vu Lan"),
    (15, 8, "Tết Trung Thu"),
    (23, 12, "Ông Công Ông Táo"),
]

CAN = ["Canh", "Tân", "Nhâm", "Quý", "Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ"]
CHI = ["Thân", "Dậu", "Tuất", "Hợi", "Tý", "Sửu", "Dần", "Mão",
       "Thìn", "Tỵ", "Ngọ", "Mùi"]

STOPWORDS = {
    "va", "cua", "cho", "cac", "nhung", "duoc", "trong", "voi", "da", "se",
    "la", "co", "khong", "mot", "nguoi", "khi", "de", "nay", "do", "ra",
    "vao", "len", "xuong", "tai", "ve", "theo", "sau", "truoc", "hon", "nhu",
    "vi", "bi", "con", "thi", "ma", "nen", "cung", "tin", "bao", "hom",
    "nam", "sau", "moi", "vua", "den", "tu", "boi", "nhieu", "gi", "the",
}


USE_AI_SUMMARY = os.environ.get("USE_AI_SUMMARY") == "1"
AI_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


def _jd_from_date(dd, mm, yy):
    a = (14 - mm) // 12
    y = yy + 4800 - a
    m = mm + 12 * a - 3
    jd = dd + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
    if jd < 2299161:
        jd = dd + (153 * m + 2) // 5 + 365 * y + y // 4 - 32083
    return jd


def _jd_to_date(jd):
    if jd > 2299160:
        a = jd + 32044
        b = (4 * a + 3) // 146097
        c = a - (b * 146097) // 4
    else:
        b = 0
        c = jd + 32082
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = b * 100 + d - 4800 + m // 10
    return (day, month, year)


def _new_moon(k):
    T = k / 1236.85
    T2, T3 = T * T, T * T * T
    dr = math.pi / 180
    jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
    jd1 += 0.00033 * math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
    M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
    Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
    F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3
    c1 = (0.1734 - 0.000393 * T) * math.sin(M * dr) + 0.0021 * math.sin(2 * dr * M)
    c1 += -0.4068 * math.sin(Mpr * dr) + 0.0161 * math.sin(dr * 2 * Mpr)
    c1 += -0.0004 * math.sin(dr * 3 * Mpr)
    c1 += 0.0104 * math.sin(dr * 2 * F) - 0.0051 * math.sin(dr * (M + Mpr))
    c1 += -0.0074 * math.sin(dr * (M - Mpr)) + 0.0004 * math.sin(dr * (2 * F + M))
    c1 += -0.0004 * math.sin(dr * (2 * F - M)) - 0.0006 * math.sin(dr * (2 * F + Mpr))
    c1 += 0.0010 * math.sin(dr * (2 * F - Mpr)) + 0.0005 * math.sin(dr * (2 * Mpr + M))
    if T < -11:
        deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    else:
        deltat = -0.000278 + 0.000265 * T + 0.000262 * T2
    return jd1 + c1 - deltat


def _sun_longitude(jdn):
    T = (jdn - 2451545.0) / 36525
    T2 = T * T
    dr = math.pi / 180
    M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2
    l0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
    dl = (1.914600 - 0.004817 * T - 0.000014 * T2) * math.sin(dr * M)
    dl += (0.019993 - 0.000101 * T) * math.sin(dr * 2 * M) + 0.000290 * math.sin(dr * 3 * M)
    L = (l0 + dl) * dr
    return L - math.pi * 2 * int(L / (math.pi * 2))


def _new_moon_day(k, tz):
    return int(_new_moon(k) + 0.5 + tz / 24)


def _sun_long(day_number, tz):
    return int(_sun_longitude(day_number - 0.5 - tz / 24) / math.pi * 6)


def _lunar_month_11(yy, tz):
    off = _jd_from_date(31, 12, yy) - 2415021
    k = int(off / 29.530588853)
    nm = _new_moon_day(k, tz)
    if _sun_long(nm, tz) >= 9:
        nm = _new_moon_day(k - 1, tz)
    return nm


def _leap_month_offset(a11, tz):
    k = int((a11 - 2415021.076998695) / 29.530588853 + 0.5)
    i = 1
    arc = _sun_long(_new_moon_day(k + i, tz), tz)
    while True:
        last = arc
        i += 1
        arc = _sun_long(_new_moon_day(k + i, tz), tz)
        if arc == last or i >= 14:
            break
    return i - 1


def lunar_to_solar(lunar_day, lunar_month, lunar_year, lunar_leap=0, tz=7):
    if lunar_month < 11:
        a11 = _lunar_month_11(lunar_year - 1, tz)
        b11 = _lunar_month_11(lunar_year, tz)
    else:
        a11 = _lunar_month_11(lunar_year, tz)
        b11 = _lunar_month_11(lunar_year + 1, tz)
    k = int(0.5 + (a11 - 2415021.076998695) / 29.530588853)
    off = lunar_month - 11
    if off < 0:
        off += 12
    if b11 - a11 > 365:
        leap_off = _leap_month_offset(a11, tz)
        leap_month = leap_off - 2
        if leap_month < 0:
            leap_month += 12
        if lunar_leap and lunar_month != leap_month:
            return None
        if lunar_leap or off >= leap_off:
            off += 1
    month_start = _new_moon_day(k + off, tz)
    return _jd_to_date(month_start + lunar_day - 1)


def can_chi(lunar_year):
    return f"{CAN[lunar_year % 10]} {CHI[lunar_year % 12]}"



def tet_countdown(today):
    """Trả về (số ngày còn lại, ngày dương lịch của Tết, tên năm âm lịch)."""
    year = today.year
    d, m, y = lunar_to_solar(1, 1, year, 0, 7)
    tet = date(y, m, d)
    if tet < today:  # Tết năm nay đã qua -> lấy Tết năm sau
        d, m, y = lunar_to_solar(1, 1, year + 1, 0, 7)
        tet = date(y, m, d)
    lunar_year_of_tet = tet.year  # năm âm lịch bắt đầu từ đúng ngày Tết
    days = (tet - today).days
    return days, tet, can_chi(lunar_year_of_tet)


def _next_occurrence(day, month, today, lunar=False):
    """Ngày dương lịch tới đây của một sự kiện (năm nay hoặc năm sau)."""
    for year in (today.year, today.year + 1):
        if lunar:
            converted = lunar_to_solar(day, month, year, 0, 7)
            if not converted:
                continue
            d, m, y = converted
            occ = date(y, m, d)
        else:
            occ = date(year, month, day)
        if occ >= today:
            return occ
    return None


def upcoming_events(today, window_days=40, limit=4):
    events = []
    for day, month, name in SOLAR_EVENTS:
        occ = _next_occurrence(day, month, today, lunar=False)
        if occ:
            events.append((occ, name))
    for day, month, name in LUNAR_EVENTS:
        occ = _next_occurrence(day, month, today, lunar=True)
        if occ:
            events.append((occ, name))
    events = [(d, n) for d, n in events if 0 <= (d - today).days <= window_days]
    events.sort(key=lambda item: item[0])
    return events[:limit]



def _strip_accents(text):
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def normalize_title(title):
    return re.sub(r"[^a-z0-9\s]", " ", _strip_accents(title))


def significant_tokens(title):
    tokens = normalize_title(title).split()
    return {t for t in tokens if len(t) >= 2 and t not in STOPWORDS}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def same_story(title_a, title_b):
    """Hai tiêu đề có nói về cùng một sự kiện không? Dùng cả hai tín hiệu:
    - Jaccard trên từ khóa (bắt được cùng chuyện dù khác cách giật tít)
    - SequenceMatcher (bắt được tiêu đề gần y hệt)."""
    tokens_a = significant_tokens(title_a)
    tokens_b = significant_tokens(title_b)
    if jaccard(tokens_a, tokens_b) >= 0.34:
        return True
    ratio = SequenceMatcher(None, normalize_title(title_a),
                            normalize_title(title_b)).ratio()
    return ratio >= 0.72


def clean_description(raw):
    soup = BeautifulSoup(raw or "", "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True))


def shorten(text, max_len=200):
    text = text.strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    # cắt ở ranh giới câu/từ cho gọn
    for sep in (". ", "! ", "? "):
        idx = cut.rfind(sep)
        if idx >= max_len * 0.5:
            return cut[:idx + 1].strip()
    idx = cut.rfind(" ")
    return (cut[:idx] if idx > 0 else cut).strip() + "…"



def _fetch_feed(source, feed_url):
    articles = []
    try:
        response = requests.get(
            feed_url, timeout=20,
            headers={"User-Agent": "Mozilla/5.0 DailyNewsBot/1.0"},
        )
        response.raise_for_status()
        feed = feedparser.parse(response.content)
        for position, entry in enumerate(feed.entries[:15]):
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            if not title or not link:
                continue
            articles.append({
                "title": title,
                "link": link,
                "source": source,
                "description": clean_description(entry.get("summary", "")),
                "position": position,  # càng đầu RSS càng mới/ưu tiên
            })
    except Exception as error:
        print(f"Không đọc được RSS {source}: {error}")
    return articles


def get_hot_articles(feeds, limit):
    """Gom bài từ nhiều nguồn thành các 'cụm' cùng chủ đề. Cụm được nhiều
    báo đưa tin = tin nóng, xếp lên trước. Đây là tín hiệu 'hot' thay cho
    việc chỉ lấy tin mới nhất."""
    raw = []
    for source, feed_url in feeds:
        raw.extend(_fetch_feed(source, feed_url))

    clusters = []  # mỗi cụm: {"articles": [...], "sources": set()}
    for article in raw:
        placed = False
        for cluster in clusters:
            if same_story(article["title"], cluster["articles"][0]["title"]):
                cluster["articles"].append(article)
                cluster["sources"].add(article["source"])
                placed = True
                break
        if not placed:
            clusters.append({
                "articles": [article],
                "sources": {article["source"]},
            })

    def cluster_score(cluster):
        source_count = len(cluster["sources"])
        best_position = min(a["position"] for a in cluster["articles"])
        # nhiều nguồn quan trọng hơn, sau đó tới độ mới (position nhỏ)
        return (source_count, -best_position)

    clusters.sort(key=cluster_score, reverse=True)

    selected = []
    for cluster in clusters[:limit]:
        # chọn bài đại diện: có mô tả dài nhất, ưu tiên vị trí đầu RSS
        rep = max(cluster["articles"],
                  key=lambda a: (len(a["description"]), -a["position"]))
        rep = dict(rep)
        rep["source_count"] = len(cluster["sources"])
        rep["all_sources"] = sorted(cluster["sources"])
        selected.append(rep)
    return selected


# ============================================================
# TÓM TẮT BẰNG AI (tùy chọn)
# ============================================================
def ai_summarize(articles):
    """Nếu bật USE_AI_SUMMARY: gọi Claude tóm tắt gọn mỗi bài. Lỗi thì
    tự động quay về dùng sapo RSS. Trả về list summary theo đúng thứ tự."""
    import json
    items = [
        {"i": idx, "title": a["title"], "desc": a["description"][:400]}
        for idx, a in enumerate(articles)
    ]
    prompt = (
        "Tóm tắt mỗi tin dưới đây thành 1 câu tiếng Việt ngắn gọn, khách "
        "quan (tối đa 30 từ), nêu đúng ý chính. CHỈ trả về JSON dạng "
        '[{"i":0,"summary":"..."}], không thêm gì khác.\n\n'
        + json.dumps(items, ensure_ascii=False)
    )
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": AI_MODEL,
            "max_tokens": 1500,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    response.raise_for_status()
    text = "".join(
        block.get("text", "")
        for block in response.json()["content"]
        if block.get("type") == "text"
    )
    text = re.sub(r"```(json)?", "", text).strip()
    parsed = json.loads(text)
    summaries = {item["i"]: item["summary"] for item in parsed}
    return [summaries.get(idx, "") for idx in range(len(articles))]


def attach_summaries(articles):
    """Gắn khóa 'summary' cho từng bài."""
    if USE_AI_SUMMARY and articles:
        try:
            ai = ai_summarize(articles)
            for article, summary in zip(articles, ai):
                article["summary"] = summary or shorten(article["description"])
            return
        except Exception as error:
            print(f"AI tóm tắt lỗi, dùng sapo RSS: {error}")
    for article in articles:
        article["summary"] = shorten(article["description"])


# ============================================================
# THỜI TIẾT
# ============================================================
def weather_description(code):
    table = {
        0: "trời quang", 1: "chủ yếu trời quang", 2: "có mây", 3: "nhiều mây",
        45: "có sương mù", 48: "có sương mù", 51: "mưa phùn nhẹ",
        53: "mưa phùn", 55: "mưa phùn dày", 61: "mưa nhẹ", 63: "có mưa",
        65: "mưa lớn", 71: "tuyết nhẹ", 80: "mưa rào nhẹ", 81: "có mưa rào",
        82: "mưa rào lớn", 95: "có dông", 96: "dông kèm mưa đá", 99: "dông mạnh",
    }
    return table.get(code, "thời tiết thay đổi")


def get_hanoi_weather():
    try:
        response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 21.0285, "longitude": 105.8542,
                "daily": ("weather_code,temperature_2m_max,"
                          "temperature_2m_min,precipitation_probability_max"),
                "timezone": "Asia/Ho_Chi_Minh", "forecast_days": 1,
            },
            timeout=20,
        )
        response.raise_for_status()
        daily = response.json()["daily"]
        lo = round(daily["temperature_2m_min"][0])
        hi = round(daily["temperature_2m_max"][0])
        rain = daily["precipitation_probability_max"][0]
        code = daily["weather_code"][0]
        return (f"🌦 <b>Hà Nội:</b> {lo}–{hi}°C, "
                f"{weather_description(code)}, khả năng mưa {rain}%")
    except Exception as error:
        print(f"Không lấy được thời tiết: {error}")
        return "🌦 <b>Hà Nội:</b> Chưa lấy được dữ liệu thời tiết"


# ============================================================
# ĐỊNH DẠNG
# ============================================================
def format_countdown_and_events(today):
    days, tet, ten_nam = tet_countdown(today)
    lines = [
        f"\n🎊 <b>Còn {days} ngày nữa đến Tết {ten_nam} "
        f"({tet.strftime('%d/%m/%Y')})</b>"
    ]
    events = upcoming_events(today)
    if events:
        lines.append("\n📌 <b>SỰ KIỆN SẮP TỚI</b>")
        for occ, name in events:
            remaining = (occ - today).days
            when = "hôm nay" if remaining == 0 else f"còn {remaining} ngày"
            lines.append(f"• {occ.strftime('%d/%m')} — "
                         f"{html.escape(name)} ({when})")
    return "\n".join(lines)


def format_articles(title, icon, articles):
    head = f"{icon} <b>{html.escape(title)}</b>".strip()
    lines = [f"\n{head}\n"]
    if not articles:
        lines.append("Chưa lấy được dữ liệu tin tức.")
        return "\n".join(lines)
    blocks = []
    for index, article in enumerate(articles, start=1):
        safe_title = html.escape(article["title"])
        safe_link = html.escape(article["link"], quote=True)
        heat = " 🔥" if article.get("source_count", 1) >= 3 else ""
        parts = [f'{index}. <a href="{safe_link}">{safe_title}</a>{heat}']
        if article.get("summary"):
            parts.append(f"   {html.escape(article['summary'])}")
        if article.get("source_count", 1) >= 2:
            srcs = ", ".join(article["all_sources"])
            parts.append(f"   <i>{article['source_count']} nguồn: "
                         f"{html.escape(srcs)}</i>")
        else:
            parts.append(f"   <i>Nguồn: {html.escape(article['source'])}</i>")
        blocks.append("\n".join(parts))
    return lines[0] + "\n\n".join(blocks)


def build_message():
    now = datetime.now(VIETNAM_TZ)
    today = now.date()

    vietnam_news = get_hot_articles(VIETNAM_FEEDS, 5)
    technology_news = get_hot_articles(TECH_FEEDS, 3)
    attach_summaries(vietnam_news)
    attach_summaries(technology_news)

    header = (
        f"🌅 <b>BẢN TIN SÁNG</b>\n"
        f"📅 <b>{WEEKDAYS[now.weekday()]}, {now.strftime('%d/%m/%Y')}</b>\n"
        f"{get_hanoi_weather()}"
    )

    return (
        header
        + "\n"
        + format_countdown_and_events(today)
        + "\n"
        + format_articles("TIN NÓNG VIỆT NAM", "🇻🇳", vietnam_news)
        + "\n"
        + format_articles("CÔNG NGHỆ & AI", "💻", technology_news)
        + "\n\n<i>Bản tin được tổng hợp tự động từ RSS.</i>"
    )


def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    response = requests.post(
        url,
        data={
            "chat_id": CHAT_ID, "text": message, "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=30,
    )
    response.raise_for_status()
    print("Đã gửi bản tin Telegram thành công.")


if __name__ == "__main__":
    send_telegram_message(build_message())
