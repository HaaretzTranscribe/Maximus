import traceback
import requests
import feedparser
from flask import Blueprint, jsonify

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")


@debug_bp.route("/scrape")
def test_scrape():
    try:
        from scraper import _extract_article, _get_rss_urls, MIN_WORDS, MAX_WORDS

        sess = requests.Session()
        sess.headers["User-Agent"] = "Maximus/1.0 Italian-learning personal tool"

        urls = _get_rss_urls("mondo")
        results = {"rss_count": len(urls), "articles": []}

        for url in urls[:3]:
            try:
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
                    results["articles"].append({"url": url, "result": "None returned"})
            except Exception as e:
                results["articles"].append({"url": url, "error": str(e), "trace": traceback.format_exc()})

        return jsonify(results)
    except Exception as e:
        return jsonify({"fatal_error": str(e), "trace": traceback.format_exc()}), 500


@debug_bp.route("/error")
def test_error():
    try:
        from app import app as flask_app
        return jsonify({"debug": flask_app.config.get("PROPAGATE_EXCEPTIONS")})
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500
