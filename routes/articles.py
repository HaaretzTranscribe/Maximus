import traceback
from flask import Blueprint, jsonify, request
from db import get_db
from scraper import fetch_articles_for_slots

articles_bp = Blueprint("articles", __name__, url_prefix="/api/articles")

SECTION_ORDER = ["mondo", "italia", "sport", "scienza"]


def _slot(section):
    return section if section in ("mondo", "italia", "sport") else "scienza"


def _current_articles():
    result = get_db().table("articles").select(
        "id,url,section,title,word_count,published_at,status,current_set"
    ).filter("current_set", "eq", "true").order("fetched_at", desc=True).execute()
    rows = result.data or []
    cards = {s: None for s in SECTION_ORDER}
    for row in rows:
        cards[_slot(row["section"])] = row
    return [cards[s] for s in SECTION_ORDER]


@articles_bp.route("/current", methods=["GET"])
def get_current():
    return jsonify(_current_articles())


@articles_bp.route("/fetch", methods=["POST"])
def fetch_articles():
    try:
        active = get_db().table("articles").select(
            "id,section,status,current_set"
        ).filter("current_set", "eq", "true").execute().data or []

        filled = {}
        for row in active:
            if row["status"] not in ("rejected", "done"):
                filled[_slot(row["section"])] = True

        slots_needed = [s for s in SECTION_ORDER if s not in filled]

        if not slots_needed:
            return jsonify({"message": "Nothing to replace. Mark articles as rejected or done first."})

        # Remove rejected and done articles from active set
        for row in active:
            if row["status"] in ("rejected", "done"):
                get_db().table("articles").update({"current_set": False}).eq("id", row["id"]).execute()

        new_articles = fetch_articles_for_slots(slots_needed)
        if not new_articles:
            return jsonify({"error": "Could not find qualifying articles. Try again."}), 500

        for article in new_articles:
            existing = get_db().table("articles").select("id,status").eq("url", article["url"]).execute()
            if existing.data:
                row = existing.data[0]
                if row["status"] != "done":
                    get_db().table("articles").update({
                        "current_set": True,
                        "section": article["section"],
                    }).eq("id", row["id"]).execute()
            else:
                get_db().table("articles").insert({
                    **article, "current_set": True, "status": "not_started"
                }).execute()

        return jsonify(_current_articles())

    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@articles_bp.route("/<article_id>", methods=["GET"])
def get_article(article_id):
    result = get_db().table("articles").select("*").eq("id", article_id).single().execute()
    if not result.data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(result.data)


@articles_bp.route("/<article_id>/status", methods=["POST"])
def set_status(article_id):
    body = request.get_json()
    new_status = body.get("status")
    if new_status not in {"done", "rejected", "in_progress", "not_started"}:
        return jsonify({"error": "invalid status"}), 400
    update = {"status": new_status}
    if new_status == "done":
        update["current_set"] = False
    get_db().table("articles").update(update).eq("id", article_id).execute()
    return jsonify({"ok": True})


@articles_bp.route("/<article_id>/tts", methods=["GET"])
def get_tts(article_id):
    import os, io
    from openai import OpenAI
    from flask import send_file

    result = get_db().table("articles").select("title,body,tts_storage_path").eq("id", article_id).single().execute()
    if not result.data:
        return jsonify({"error": "Not found"}), 404

    article = result.data
    storage_path = article.get("tts_storage_path")

    if storage_path:
        try:
            file_data = get_db().storage.from_("tts-audio").download(storage_path)
            if file_data and len(file_data) > 1000:
                return send_file(io.BytesIO(file_data), mimetype="audio/mpeg", download_name="article.mp3")
        except Exception:
            pass
        # Cached path is bad — clear it and regenerate
        get_db().table("articles").update({"tts_storage_path": None}).eq("id", article_id).execute()

    # OpenAI TTS limit is 4096 characters — truncate at a word boundary
    tts_text = f"{article['title']}. {article['body']}"
    if len(tts_text) > 4096:
        tts_text = tts_text[:4096].rsplit(' ', 1)[0]

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=tts_text,
    )
    audio_bytes = response.content

    path = f"{article_id}.mp3"
    try:
        get_db().storage.from_("tts-audio").upload(path, audio_bytes, {"content-type": "audio/mpeg"})
        get_db().table("articles").update({"tts_storage_path": path}).eq("id", article_id).execute()
    except Exception:
        pass

    return send_file(io.BytesIO(audio_bytes), mimetype="audio/mpeg", download_name="article.mp3")
