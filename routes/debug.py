import requests
import feedparser
from flask import Blueprint, jsonify
from bs4 import BeautifulSoup

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")

USER_AGENT = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"


@debug_bp.route("/scrape")
def test_scrape():
    sess = requests.Session()
    sess.headers["User-Agent"] = USER_AGENT

    results = {}

    # Test RSS
    rss_url = "https://www.ilpost.it/mondo/feed/"
    feed = feedparser.parse(rss_url)
    rss_links = [e.link for e in feed.entries if hasattr(e, "link")]
    results["rss_entry_count"] = len(rss_links)
    results["rss_first_links"] = rss_links[:3]

    if not rss_links:
        return jsonify({"error": "RSS returned no entries", **results})

    # Try fetching the first article
    url = rss_links[0]
    try:
        resp = sess.get(url, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return jsonify({"error": f"Article fetch failed: {e}", **results})

    soup = BeautifulSoup(resp.text, "lxml")
    results["article_url"] = url
    results["page_title"] = soup.title.string if soup.title else None

    # Report all div classes found in the page (to identify body container)
    all_divs = soup.find_all("div", class_=True)
    classes_found = list(set(
        c for div in all_divs for c in div.get("class", [])
    ))[:60]
    results["div_classes_sample"] = sorted(classes_found)

    # Try each selector
    selectors_tried = {}
    for selector in [
        "div.post-content", "div.article-body", "div.entry-content",
        "div.content", "div.articolo", "article", "main",
        "div.post__content", "div.article__body", "div.story__body",
    ]:
        el = soup.select_one(selector)
        if el:
            paras = el.find_all("p")
            text = " ".join(p.get_text(strip=True) for p in paras if p.get_text(strip=True))
            selectors_tried[selector] = {"found": True, "word_count": len(text.split()), "preview": text[:200]}
        else:
            selectors_tried[selector] = {"found": False}

    results["selectors"] = selectors_tried
    return jsonify(results)
