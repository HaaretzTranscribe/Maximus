import requests
import feedparser
from flask import Blueprint, jsonify
from scraper import _extract_article, _get_rss_urls, MIN_WORDS, MAX_WORDS

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")


@debug_bp.route("/scrape")
def test_scrape():
    sess = requests.Session()
    sess.headers["User-Agent"] = "Maximus/1.0 Italian-learning personal tool (amnon.harari@gmail.com)"

    urls = _get_rss_urls("mondo")
    results = {"rss_count": len(urls), "articles": []}

    for url in urls[:5]:
        article = _extract_article(url, sess)
        if article:
            results["articles"].append({
                "url": url,
                "title": article["title"],
                "word_count": article["word_count"],
                "qualifies": MIN_WORDS <= article["word_count"] <= MAX_WORDS,
                "preview": article["body"][:200],
            })
        else:
            results["articles"].append({"url": url, "error": "extraction failed"})

    return __import__("flask").jsonify(results)
