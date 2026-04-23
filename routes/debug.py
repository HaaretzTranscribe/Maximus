import json
import requests
import feedparser
from flask import Blueprint, jsonify
from bs4 import BeautifulSoup

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")
USER_AGENT = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"


def _dig(obj, path="", results=None, max_depth=6, depth=0):
    """Recursively find string fields that look like article body text."""
    if results is None:
        results = []
    if depth > max_depth:
        return results
    if isinstance(obj, str) and len(obj.split()) > 50:
        results.append({"path": path, "word_count": len(obj.split()), "preview": obj[:200]})
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _dig(v, f"{path}.{k}", results, max_depth, depth + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):
            _dig(v, f"{path}[{i}]", results, max_depth, depth + 1)
    return results


@debug_bp.route("/scrape")
def test_scrape():
    sess = requests.Session()
    sess.headers["User-Agent"] = USER_AGENT

    feed = feedparser.parse("https://www.ilpost.it/mondo/feed/")
    url = feed.entries[1].link if len(feed.entries) > 1 else feed.entries[0].link

    resp = sess.get(url, timeout=15)
    soup = BeautifulSoup(resp.text, "lxml")

    next_script = soup.find("script", id="__NEXT_DATA__")
    if not next_script:
        return jsonify({"error": "No __NEXT_DATA__ found"})

    data = json.loads(next_script.string)
    page_props = data.get("props", {}).get("pageProps", {})

    # Find all long text fields
    long_texts = _dig(page_props)
    long_texts.sort(key=lambda x: x["word_count"], reverse=True)

    return jsonify({
        "url": url,
        "top_text_fields": long_texts[:10],
    })
