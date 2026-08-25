import html
import os
import re
import unicodedata
from datetime import datetime
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
]

TECH_FEEDS = [
    ("VnExpress Số hóa", "https://vnexpress.net/rss/so-hoa.rss"),
    ("Tuổi Trẻ Công nghệ", "https://tuoitre.vn/rss/nhip-song-so.rss"),
]

WEEKDAYS = {
    0: "THỨ HAI",
    1: "THỨ BA",
    2: "THỨ TƯ",
    3: "THỨ NĂM",
    4: "THỨ SÁU",
    5: "THỨ BẢY",
    6: "CHỦ NHẬT",
}


def normalize_title(title):
    """Chuẩn hóa tiêu đề để phát hiện các bài gần giống nhau."""
    title = unicodedata.normalize("NFD", title.lower())
    title = "".join(
        character
        for character in title
        if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9\s]", " ", title)


def is_duplicate(title, selected_articles):
    normalized = normalize_title(title)

    for article in selected_articles:
        previous = normalize_title(article["title"])
        similarity = SequenceMatcher(None, normalized, previous).ratio()

        if similarity >= 0.72:
            return True

    return False


def clean_description(raw_description):
    soup = BeautifulSoup(raw_description or "", "html.parser")
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text)


def get_articles(feeds, limit):
    articles = []

    for source, feed_url in feeds:
        try:
            response = requests.get(
                feed_url,
                timeout=20,
                headers={"User-Agent": "Mozilla/5.0 DailyNewsBot/1.0"},
            )
            response.raise_for_status()
            feed = feedparser.parse(response.content)

            for position, entry in enumerate(feed.entries[:15]):
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()

                if not title or not link:
                    continue

                articles.append(
                    {
                        "title": title,
                        "link": link,
                        "source": source,
                        "description": clean_description(
                            entry.get("summary", "")
                        ),
                        # Tin ở đầu RSS được ưu tiên hơn.
                        "score": 100 - position,
                    }
                )

        except Exception as error:
            print(f"Không đọc được RSS {source}: {error}")

    articles.sort(key=lambda article: article["score"], reverse=True)

    selected = []

    for article in articles:
        if not is_duplicate(article["title"], selected):
            selected.append(article)

        if len(selected) == limit:
            break

    return selected


def weather_description(weather_code):
    descriptions = {
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
    }

    return descriptions.get(weather_code, "thời tiết thay đổi")


def get_hanoi_weather():
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": 21.0285,
        "longitude": 105.8542,
        "daily": (
            "weather_code,"
            "temperature_2m_max,"
            "temperature_2m_min,"
            "precipitation_probability_max"
        ),
        "timezone": "Asia/Ho_Chi_Minh",
        "forecast_days": 1,
    }

    try:
        response = requests.get(url, params=params, timeout=20)
        response.raise_for_status()
        daily = response.json()["daily"]

        minimum = round(daily["temperature_2m_min"][0])
        maximum = round(daily["temperature_2m_max"][0])
        rain = daily["precipitation_probability_max"][0]
        code = daily["weather_code"][0]

        return (
            f"🌦 <b>Hà Nội:</b> {minimum}–{maximum}°C, "
            f"{weather_description(code)}, khả năng mưa {rain}%"
        )

    except Exception as error:
        print(f"Không lấy được thời tiết: {error}")
        return "🌦 <b>Hà Nội:</b> Chưa lấy được dữ liệu thời tiết"


def format_articles(title, icon, articles):
    lines = [f"\n{icon} <b>{html.escape(title)}</b>\n"]

    if not articles:
        lines.append("Chưa lấy được dữ liệu tin tức.")
        return "\n".join(lines)

    for index, article in enumerate(articles, start=1):
        safe_title = html.escape(article["title"])
        safe_link = html.escape(article["link"], quote=True)
        safe_source = html.escape(article["source"])

        lines.append(
            f'{index}. <a href="{safe_link}">{safe_title}</a>\n'
            f"   <i>Nguồn: {safe_source}</i>"
        )

    return "\n\n".join(lines)


def build_message():
    now = datetime.now(VIETNAM_TZ)

    vietnam_news = get_articles(VIETNAM_FEEDS, 5)
    technology_news = get_articles(TECH_FEEDS, 3)

    header = (
        f" <b>BẢN TIN SÁNG</b>\n"
        f" <b>{WEEKDAYS[now.weekday()]}, "
        f"{now.strftime('%d/%m/%Y')}</b>\n"
        f"{get_hanoi_weather()}"
    )

    return (
        header
        + "\n"
        + format_articles(
            "TIN NÓNG VIỆT NAM",
            "🇻🇳",
            vietnam_news,
        )
        + "\n"
        + format_articles(
            "CÔNG NGHỆ & AI",
            "",
            technology_news,
        )
        + "\n\n<i>Bản tin được tổng hợp tự động từ RSS.</i>"
    )


def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"

    response = requests.post(
        url,
        data={
            "chat_id": CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=30,
    )

    response.raise_for_status()
    print("Đã gửi bản tin Telegram thành công.")


if __name__ == "__main__":
    send_telegram_message(build_message())
