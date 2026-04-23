import time
import re
import feedparser
import requests
from bs4 import BeautifulSoup
from db import get_db

USER_AGENT = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"
THROTTLE = 1.0  # seconds between requests

SECTION_URLS = {
    "mondo":      "https://www.ilpost.it/mondo/",
    "italia":     "https://www.ilpost.it/italia/",
    "sport":      "https://www.ilpost.it/sport/",
    "scienza":    "https://www.ilpost.it/scienza/",
    "tecnologia": "https://www.ilpost.it/tecnologia/",
    "cultura":    "https://www.ilpost.it/cultura/",
}

# Il Post publishes RSS feeds per section
RSS_URLS = {
    "mondo":      "https://www.ilpost.it/mondo/feed/",
    "italia":     "https://www.ilpost.it/italia/feed/",
    "sport":      "https://www.ilpost.it/sport/feed/",
    "scienza":    "https://www.ilpost.it/scienza/feed/",
    "tecnologia": "https://www.ilpost.it/tecnologia/feed/",
    "cultura":    "https://www.ilpost.it/cultura/feed/",
}

# Fourth slot tries these sections in order
FOURTH_SLOT_SECTIONS = ["scienza", "tecnologia", "cultura"]

MIN_WORDS = 400
MAX_WORDS = 900


def _session():
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def _get_article_urls_from_rss(section: str) -> list[str]:
    rss_url = RSS_URLS[section]
    feed = feedparser.parse(rss_url)
    return [entry.link for entry in feed.entries if hasattr(entry, "link")]


def _get_article_urls_from_html(section: str, sess) -> list[str]:
    url = SECTION_URLS[section]
    time.sleep(THROTTLE)
    resp = sess.get(url, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    links = []
    for a in soup.select("a[href]"):
        href = a["href"]
        if href.startswith("https://www.ilpost.it/") and href.count("/") >= 5:
            if href not in links:
                links.append(href)
    return links


def _count_words(text: str) -> int:
    return len(text.split())


def _extract_article_body(url: str, sess) -> dict | None:
    """Fetch and parse one Il Post article. Returns dict or None if unreadable."""
    time.sleep(THROTTLE)
    try:
        resp = sess.get(url, timeout=15)
        resp.raise_for_status()
    except Exception:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    # Title
    title_tag = soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # Publication date
    pub_date = None
    time_tag = soup.find("time")
    if time_tag and time_tag.get("datetime"):
        pub_date = time_tag["datetime"]

    # Article body — Il Post wraps content in <div class="post-content"> or similar
    body_div = (
        soup.find("div", class_=re.compile(r"post-content|article-body|entry-content", re.I))
        or soup.find("article")
    )
    if not body_div:
        return None

    # Remove noise: captions, related boxes, ads, comments
    for tag in body_div.find_all(["figure", "figcaption", "aside", "blockquote",
                                   "script", "style", "iframe"]):
        tag.decompose()
    for tag in body_div.find_all(class_=re.compile(
            r"related|caption|comment|share|social|newsletter|promo|tag|author", re.I)):
        tag.decompose()

    paragraphs = body_div.find_all("p")
    body_text = "\n\n".join(p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True))

    if not body_text:
        return None

    return {
        "title": title,
        "body": body_text,
        "word_count": _count_words(body_text),
        "published_at": pub_date,
        "url": url,
    }


def _already_done_urls() -> set[str]:
    """URLs of articles already marked done or rejected — skip these."""
    result = (
        get_db().table("articles")
        .select("url,status")
        .in_("status", ["done", "rejected"])
        .execute()
    )
    return {row["url"] for row in (result.data or [])}


def _find_qualifying_article(section: str, skip_urls: set[str], sess) -> dict | None:
    """Walk articles newest-first until one qualifies (400–900 words)."""
    try:
        urls = _get_article_urls_from_rss(section)
    except Exception:
        urls = []

    if not urls:
        try:
            urls = _get_article_urls_from_html(section, sess)
        except Exception:
            return None

    for url in urls:
        if url in skip_urls:
            continue
        # Check if already cached in DB
        cached = get_db().table("articles").select("*").eq("url", url).execute()
        if cached.data:
            row = cached.data[0]
            if MIN_WORDS <= row["word_count"] <= MAX_WORDS:
                return row
            else:
                skip_urls.add(url)
                continue

        article = _extract_article_body(url, sess)
        if not article:
            continue
        if MIN_WORDS <= article["word_count"] <= MAX_WORDS:
            article["section"] = section
            return article
        skip_urls.add(url)

    return None


def fetch_articles_for_slots(slots: list[str]) -> list[dict]:
    """
    Given a list of slot names ('mondo', 'italia', 'sport', 'scienza'),
    return one qualifying article dict per slot.
    """
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
            # Try scienza → tecnologia → cultura
            article = None
            for sec in FOURTH_SLOT_SECTIONS:
                article = _find_qualifying_article(sec, skip_urls, sess)
                if article:
                    article["section"] = sec
                    break
            if article:
                results.append(article)

    return results


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json
    print("Fetching one Mondo article for testing...")
    sess = _session()
    skip = set()
    article = _find_qualifying_article("mondo", skip, sess)
    if article:
        print(f"Title:      {article['title']}")
        print(f"URL:        {article['url']}")
        print(f"Words:      {article['word_count']}")
        print(f"Published:  {article.get('published_at')}")
        print(f"Body (first 300 chars):\n{article['body'][:300]}")
    else:
        print("No qualifying article found.")
