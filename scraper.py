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

RSS_URLS = {
    "mondo":      "https://www.ilpost.it/mondo/feed/",
    "italia":     "https://www.ilpost.it/italia/feed/",
    "sport":      "https://www.ilpost.it/sport/feed/",
    "scienza":    "https://www.ilpost.it/scienza/feed/",
    "tecnologia": "https://www.ilpost.it/tecnologia/feed/",
    "cultura":    "https://www.ilpost.it/cultura/feed/",
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


def _get_article_urls_from_rss(section: str):
    """Returns list of (url, rss_body) tuples. rss_body may be None."""
    feed = feedparser.parse(RSS_URLS[section])
    results = []
    for entry in feed.entries:
        if not hasattr(entry, "link"):
            continue
        # feedparser may give full content in content[0].value or summary
        body = None
        if hasattr(entry, "content") and entry.content:
            body = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            body = entry.summary
        results.append((entry.link, body))
    return results


def _get_article_urls_from_html(section: str, sess) -> list:
    """Fallback: scrape section page for article links."""
    time.sleep(THROTTLE)
    resp = sess.get(SECTION_URLS[section], timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    links = []
    for a in soup.select("a[href]"):
        href = a["href"]
        if href.startswith("https://www.ilpost.it/") and href.count("/") >= 5:
            if href not in links:
                links.append(href)
    return [(url, None) for url in links]


def _extract_body_from_html(soup: BeautifulSoup) -> str:
    """
    Il Post uses React + CSS Modules with hashed class names.
    Strategy: try known stable selectors, then fall back to collecting
    all <p> tags not inside nav/header/footer/aside, pick the largest block.
    """
    NOISE_TAGS = ["figure", "figcaption", "aside", "script", "style", "iframe", "nav", "header", "footer"]
    NOISE_CLASSES = re.compile(r"related|caption|comment|share|social|newsletter|promo|tag|author|adv|widget|subscribe", re.I)

    # Try known stable selectors first (Il Post uses 'contenuto' as a stable class)
    for selector in [
        "div.contenuto",
        "div.post-content",
        "div.entry-content",
        "div.article-body",
        "div.articleBody",
    ]:
        el = soup.select_one(selector)
        if el:
            for tag in el.find_all(NOISE_TAGS):
                tag.decompose()
            for tag in el.find_all(class_=NOISE_CLASSES):
                tag.decompose()
            paras = [p.get_text(strip=True) for p in el.find_all("p") if p.get_text(strip=True)]
            text = "\n\n".join(paras)
            if _count_words(text) >= 100:
                return text

    # Fallback: remove noise elements, collect all remaining <p> tags,
    # group consecutive ones and pick the largest group
    for tag in soup.find_all(["nav", "header", "footer", "aside", "script", "style", "iframe"]):
        tag.decompose()
    for tag in soup.find_all(class_=NOISE_CLASSES):
        tag.decompose()

    all_paras = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True).split()) >= 8]
    return "\n\n".join(all_paras)


def _extract_article(url: str, rss_body: str | None, sess) -> dict | None:
    """
    Try RSS body first (fastest, no extra request).
    Fall back to fetching the article page.
    """
    time.sleep(THROTTLE)

    # Try RSS content
    if rss_body:
        soup = BeautifulSoup(rss_body, "lxml")
        paras = [p.get_text(strip=True) for p in soup.find_all("p") if p.get_text(strip=True)]
        rss_text = "\n\n".join(paras)
        if _count_words(rss_text) >= MIN_WORDS:
            return {
                "url": url,
                "title": "",   # filled below
                "body": rss_text,
                "word_count": _count_words(rss_text),
                "published_at": None,
                "_needs_title": True,
            }

    # Fetch full page
    try:
        resp = sess.get(url, timeout=15)
        resp.raise_for_status()
    except Exception:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    title_tag = soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    pub_date = None
    time_tag = soup.find("time")
    if time_tag and time_tag.get("datetime"):
        pub_date = time_tag["datetime"]

    body_text = _extract_body_from_html(soup)
    if not body_text:
        return None

    return {
        "url": url,
        "title": title,
        "body": body_text,
        "word_count": _count_words(body_text),
        "published_at": pub_date,
    }


def _get_title_for_url(url: str, sess) -> str:
    """Fetch just the title when we got body from RSS."""
    try:
        time.sleep(THROTTLE)
        resp = sess.get(url, timeout=15)
        soup = BeautifulSoup(resp.text, "lxml")
        h1 = soup.find("h1")
        return h1.get_text(strip=True) if h1 else url.split("/")[-2].replace("-", " ").title()
    except Exception:
        return url.split("/")[-2].replace("-", " ").title()


def _already_done_urls() -> set:
    result = (
        get_db().table("articles")
        .select("url,status")
        .in_("status", ["done", "rejected"])
        .execute()
    )
    return {row["url"] for row in (result.data or [])}


def _find_qualifying_article(section: str, skip_urls: set, sess) -> dict | None:
    try:
        entries = _get_article_urls_from_rss(section)
    except Exception:
        entries = []

    if not entries:
        try:
            entries = _get_article_urls_from_html(section, sess)
        except Exception:
            return None

    for url, rss_body in entries:
        if url in skip_urls:
            continue

        # Return cached DB article if it qualifies
        cached = get_db().table("articles").select("*").eq("url", url).execute()
        if cached.data:
            row = cached.data[0]
            if MIN_WORDS <= row["word_count"] <= MAX_WORDS:
                return row
            skip_urls.add(url)
            continue

        article = _extract_article(url, rss_body, sess)
        if not article:
            skip_urls.add(url)
            continue

        if MIN_WORDS <= article["word_count"] <= MAX_WORDS:
            # Fill in title if we only had RSS content
            if article.pop("_needs_title", False):
                article["title"] = _get_title_for_url(url, sess)
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
