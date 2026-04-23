import json
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

    feed = feedparser.parse("https://www.ilpost.it/mondo/feed/")
    entries = [e.link for e in feed.entries if hasattr(e, "link")]
    results = {"rss_entry_count": len(entries), "articles": []}

    for url in entries[:3]:
        info = {"url": url}
        try:
            resp = sess.get(url, timeout=15)
            soup = BeautifulSoup(resp.text, "lxml")

            # Check for Next.js embedded data
            next_script = soup.find("script", id="__NEXT_DATA__")
            if next_script:
                data = json.loads(next_script.string)
                info["has_next_data"] = True
                # Walk the props tree to find article body
                props = data.get("props", {}).get("pageProps", {})
                info["pageProps_keys"] = list(props.keys())[:20]
                # Try common keys
                for key in ["article", "post", "data", "item", "content"]:
                    if key in props:
                        info[f"found_key_{key}"] = str(props[key])[:300]
            else:
                info["has_next_data"] = False

            # Paragraph count from page
            paras = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True).split()) >= 5]
            info["total_paras"] = len(paras)
            info["total_words_all_paras"] = len(" ".join(paras).split())
            info["first_para"] = paras[0] if paras else None

        except Exception as e:
            info["error"] = str(e)

        results["articles"].append(info)

    return jsonify(results)
