import json
import time
import re
import feedparser
import requests
from bs4 import BeautifulSoup
from db import get_db

USER_AGENT = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"
THROTTLE = 1.0

RSS_URLS = {
    "mondo":      "https://www.ilpost.it/mondo/feed/",
    "italia":     "https://www.ilpost.it/italia/feed/",
    "sport":      "https://www.ilpost.it/sport/feed/",
    "scienza":    "https://www.ilpost.it/scienza/feed/",
    "tecnologia": "https://www.ilpost.it/tecnologia/feed/",
    "cultura":    "https://www.ilpost.it/cultura/feed/",
}

SECTION_URLS = {
    "mondo":      "https://www.ilpost.it/mondo/",
    "italia":     "https://www.ilpost.it/italia/",
    "sport":      "https://www.ilpost.it/sport/",
    "scienza":    "https://www.ilpost.it/scienza/",
    "tecnologia": "https://www.ilpost.it/tecnologia/",
    "cultura":    "https://www.ilpost.it/cultura/",
}

FOURTH_SLOT_SECTIONS = ["scienza", "tecnologia", "cultura"]
MIN_WORDS = 400
MAX_WORDS = 900


def _session():
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def _count_words(text: str) -> int:
    return len(text.split())


def _get_rss_urls(section: str) -> list:
    feed = feedparser.parse(RSS_URLS[section])
    return [e.link for e in feed.entries if hasattr(e, "link")]


def _get_html_urls(section: str, sess) -> list:
    time.sleep(THROTTLE)
    resp = sess.get(SECTION_URLS[section], timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    seen = []
    for a in soup.select("a[href]"):
        href = a["href"]
        if href.startswith("https://www.ilpost.it/") and href.count("/") >= 5 and href not in seen:
            seen.append(href)
    return seen


def _extract_article(url: str, sess) -> dict | None:
    """
    Il Post is a Next.js app — article data is in __NEXT_DATA__ JSON.
    Path: props.pageProps.data.data.main.data
    Fields: title, content_html, timestamp, words
    """
    time.sleep(THROTTLE)
    try:
        resp = sess.get(url, timeout=15)
        resp.raise_for_status()
    except Exception:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    # Extract from __NEXT_DATA__
    next_script = soup.find("script", id="__NEXT_DATA__")
    if next_script:
        try:
            data = json.loads(next_script.string)
            main = data["props"]["pageProps"]["data"]["data"]["main"]["data"]

            title = main.get("title", "")
            pub_date = main.get("timestamp")  # Already an ISO date string

            content_html = main.get("content_html", "")
            if content_html:
                content_soup = BeautifulSoup(content_html, "lxml")
                # Remove non-article elements
                for tag in content_soup.find_all(["figure", "figcaption", "script", "style",
                                                   "iframe", "audio", "video"]):
                    tag.decompose()
                for tag in content_soup.find_all(id=re.compile(r"audio|player|ad", re.I)):
                    tag.decompose()
                paras = [p.get_text(strip=True) for p in content_soup.find_all("p")
                         if p.get_text(strip=True)]
                body = "\n\n".join(paras)
                if body:
                    return {
                        "url": url,
                        "title": title,
                        "body": body,
                        "word_count": _count_words(body),
                        "published_at": pub_date,
                    }
        except (KeyError, TypeError, json.JSONDecodeError):
            pass  # Fall through to HTML extraction

    # Fallback: extract paragraphs from <article> or <main>
    container = soup.find("article") or soup.find("main")
    if not container:
        return None

    for tag in container.find_all(["nav", "figure", "figcaption", "script", "style", "aside", "iframe"]):
        tag.decompose()

    title_tag = soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else ""
    time_tag = soup.find("time")
    pub_date = time_tag["datetime"] if time_tag and time_tag.get("datetime") else None

    paras = [p.get_text(strip=True) for p in container.find_all("p") if p.get_text(strip=True)]
    body = "\n\n".join(paras)
    if not body:
        return None

    return {
        "url": url,
        "title": title,
        "body": body,
        "word_count": _count_words(body),
        "published_at": pub_date,
    }


def _already_done_urls() -> set:
    """Return URLs that the scraper should never pick: done, rejected, or currently active."""
    result = get_db().table("articles").select("url,status,current_set").execute()
    skip = set()
    for row in (result.data or []):
        if row["status"] in ("done", "rejected"):
            skip.add(row["url"])
        elif row.get("current_set"):
            # Don't steal an article already on the home screen
            skip.add(row["url"])
    return skip


def _find_qualifying_article(section: str, skip_urls: set, sess) -> dict | None:
    try:
        urls = _get_rss_urls(section)
    except Exception:
        urls = []
    if not urls:
        try:
            urls = _get_html_urls(section, sess)
        except Exception:
            return None

    for url in urls:
        if url in skip_urls:
            continue

        cached = get_db().table("articles").select("*").eq("url", url).execute()
        if cached.data:
            row = cached.data[0]
            if MIN_WORDS <= row["word_count"] <= MAX_WORDS:
                return row
            skip_urls.add(url)
            continue

        article = _extract_article(url, sess)
        if not article:
            skip_urls.add(url)
            continue

        if MIN_WORDS <= article["word_count"] <= MAX_WORDS:
            article["section"] = section
            return article

        skip_urls.add(url)

    return None


def fetch_articles_for_slots(slots: list) -> list:
    sess = _session()
    skip_urls = _already_done_urls()
    results = []

    for slot in slots:
        if slot in ("mondo", "italia", "sport"):
            article = _find_qualifying_article(slot, skip_urls, sess)
            if article:
                article["section"] = slot
                results.append(article)
        elif slot == "scienza":
            article = None
            for sec in FOURTH_SLOT_SECTIONS:
                article = _find_qualifying_article(sec, skip_urls, sess)
                if article:
                    article["section"] = sec
                    break
            if article:
                results.append(article)

    return results
