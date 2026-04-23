import traceback
from flask import Blueprint, jsonify, request
from db import get_db
from scraper import fetch_articles_for_slots

articles_bp = Blueprint("articles", __name__, url_prefix="/api/articles")


@articles_bp.route("/current", methods=["GET"])
def get_current():
    result = (
        get_db().table("articles")
        .select("id,url,section,title,word_count,published_at,status,current_set")
        .eq("current_set", True)
        .execute()
    )
    rows = result.data or []
    # Ensure one card per expected section slot in display order
    section_order = ["mondo", "italia", "sport", "scienza"]
    cards = {s: None for s in section_order}
    for row in rows:
        sec = row["section"]
        # Map scienza/tecnologia/cultura all to the fourth slot key
        slot = sec if sec in ("mondo", "italia", "sport") else "scienza"
        cards[slot] = row
    return jsonify([cards[s] for s in section_order])


@articles_bp.route("/fetch", methods=["POST"])
def fetch_articles():
  try:
   return _fetch_articles_inner()
  except Exception as e:
   return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500

def _fetch_articles_inner():
    # Determine which slots need filling (rejected or empty)
    result = (
        get_db().table("articles")
        .select("id,section,status,current_set")
        .eq("current_set", True)
        .execute()
    )
    active = result.data or []

    section_order = ["mondo", "italia", "sport", "scienza"]
    filled = {}
    for row in active:
        sec = row["section"]
        slot = sec if sec in ("mondo", "italia", "sport") else "scienza"
        if row["status"] != "rejected":
            filled[slot] = True

    slots_needed = [s for s in section_order if s not in filled]

    if not slots_needed:
        return jsonify({"message": "Nothing to replace. Mark articles as rejected or done first."}), 200

    # Mark rejected articles as no longer current
    for row in active:
        if row["status"] == "rejected":
            get_db().table("articles").update({"current_set": False}).eq("id", row["id"]).execute()

    # Fetch new articles for empty/rejected slots
    new_articles = fetch_articles_for_slots(slots_needed)
    if not new_articles:
        return jsonify({"error": "Could not find qualifying articles for all slots."}), 500

    # Upsert into articles table
    for article in new_articles:
        existing = get_db().table("articles").select("id,status").eq("url", article["url"]).execute()
        if existing.data:
            # Already in DB — just mark current_set=True if not done
            row = existing.data[0]
            if row["status"] not in ("done",):
                get_db().table("articles").update({"current_set": True}).eq("id", row["id"]).execute()
        else:
            get_db().table("articles").insert({**article, "current_set": True, "status": "not_started"}).execute()

    return get_current()


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
    allowed = {"done", "rejected", "in_progress", "not_started"}
    if new_status not in allowed:
        return jsonify({"error": f"status must be one of {allowed}"}), 400
    get_db().table("articles").update({"status": new_status}).eq("id", article_id).execute()
    return jsonify({"ok": True})


@articles_bp.route("/<article_id>/tts", methods=["POST"])
def get_tts(article_id):
    import os, io
    from openai import OpenAI
    from flask import send_file

    result = get_db().table("articles").select("title,body,tts_storage_path").eq("id", article_id).single().execute()
    if not result.data:
        return jsonify({"error": "Not found"}), 404

    article = result.data
    storage_path = article.get("tts_storage_path")

    # Return cached audio if available
    if storage_path:
        try:
            file_data = get_db().storage.from_("tts-audio").download(storage_path)
            return send_file(io.BytesIO(file_data), mimetype="audio/mpeg", download_name="article.mp3")
        except Exception:
            pass  # Cache miss — regenerate

    # Generate TTS via OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    text = f"{article['title']}. {article['body']}"

    # Italian voice: 'alloy' tested as most natural for Italian
    response = client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=text,
    )
    audio_bytes = response.content

    # Cache in Supabase Storage
    path = f"{article_id}.mp3"
    try:
        get_db().storage.from_("tts-audio").upload(path, audio_bytes, {"content-type": "audio/mpeg"})
        get_db().table("articles").update({"tts_storage_path": path}).eq("id", article_id).execute()
    except Exception:
        pass  # Non-fatal — still serve the audio

    return send_file(io.BytesIO(audio_bytes), mimetype="audio/mpeg", download_name="article.mp3")
