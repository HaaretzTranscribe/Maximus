import requests
import feedparser
from flask import Blueprint, jsonify
from bs4 import BeautifulSoup
from scraper import _extract_body_from_html, _count_words, MIN_WORDS, MAX_WORDS

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")
USER_AGENT = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"


@debug_bp.route("/scrape")
def test_scrape():
    sess = requests.Session()
    sess.headers["User-Agent"] = USER_AGENT

    feed = feedparser.parse("https://www.ilpost.it/mondo/feed/")
    entries = [(e.link, getattr(e, "summary", None)) for e in feed.entries if hasattr(e, "link")]

    results = {
        "rss_entry_count": len(entries),
        "articles_tested": [],
    }

    for url, rss_body in entries[:5]:
        info = {"url": url}

        # RSS body word count
        if rss_body:
            rss_soup = BeautifulSoup(rss_body, "lxml")
            rss_text = "\n\n".join(p.get_text(strip=True) for p in rss_soup.find_all("p") if p.get_text(strip=True))
            info["rss_word_count"] = _count_words(rss_text)
        else:
            info["rss_word_count"] = 0

        # Full page word count
        try:
            resp = sess.get(url, timeout=15)
            soup = BeautifulSoup(resp.text, "lxml")
            body = _extract_body_from_html(soup)
            info["page_word_count"] = _count_words(body)
            info["qualifies"] = MIN_WORDS <= _count_words(body) <= MAX_WORDS
            info["preview"] = body[:200] if body else None
        except Exception as e:
            info["page_error"] = str(e)

        results["articles_tested"].append(info)

    return jsonify(results)
