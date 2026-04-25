import traceback
from flask import Blueprint, jsonify, request, Response
from db import get_db
from scraper import fetch_articles_for_slots


def _audio_response(audio_bytes: bytes) -> Response:
    """Return MP3 bytes with headers iOS Safari needs to play audio."""
    return Response(
        audio_bytes,
        status=200,
        mimetype="audio/mpeg",
        headers={
            "Content-Length": str(len(audio_bytes)),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
        },
    )

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


def _past_articles():
    result = get_db().table("articles").select(
        "id,url,section,title,word_count,published_at,status,current_set"
    ).filter("current_set", "eq", "false").neq("status", "rejected").order(
        "fetched_at", desc=True
    ).limit(20).execute()
    return result.data or []


@articles_bp.route("/current", methods=["GET"])
def get_current():
    return jsonify({"current": _current_articles(), "past": _past_articles()})


@articles_bp.route("/fetch", methods=["POST"])
def fetch_articles():
    try:
        # Always fetch all 4 slots — move everything to past first
        active = get_db().table("articles").select(
            "id,url,section,status,current_set"
        ).filter("current_set", "eq", "true").execute().data or []

        for row in active:
            get_db().table("articles").update({"current_set": False}).eq("id", row["id"]).execute()

        # Skip every URL already in the DB — only truly new articles qualify
        all_known = get_db().table("articles").select("url").execute()
        all_known_urls = {row["url"] for row in (all_known.data or [])}

        slots_needed = list(SECTION_ORDER)
        new_articles = fetch_articles_for_slots(slots_needed, extra_skip_urls=all_known_urls)
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

        return jsonify({"current": _current_articles(), "past": _past_articles()})

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
    get_db().table("articles").update({"status": new_status}).eq("id", article_id).execute()
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
                return _audio_response(file_data)
        except Exception:
            pass
        get_db().table("articles").update({"tts_storage_path": None}).eq("id", article_id).execute()

    tts_text = f"{article['title']}. {article['body']}"
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    def split_chunks(text, limit=4000):
        chunks = []
        while len(text) > limit:
            cut = text[:limit].rsplit(' ', 1)[0]
            chunks.append(cut)
            text = text[len(cut):].lstrip()
        if text:
            chunks.append(text)
        return chunks

    audio_parts = []
    for chunk in split_chunks(tts_text):
        r = client.audio.speech.create(model="tts-1", voice="nova", input=chunk)
        audio_parts.append(r.content)
    audio_bytes = b"".join(audio_parts)

    path = f"{article_id}.mp3"
    try:
        get_db().storage.from_("tts-audio").upload(path, audio_bytes, {"content-type": "audio/mpeg"})
        get_db().table("articles").update({"tts_storage_path": path}).eq("id", article_id).execute()
    except Exception:
        pass

    return _audio_response(audio_bytes)
