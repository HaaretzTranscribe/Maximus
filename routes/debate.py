import os
import json
import base64
import tempfile
from flask import Blueprint, jsonify, request
from openai import OpenAI
from db import get_db

debate_bp = Blueprint("debate", __name__, url_prefix="/api/debate")

DEBATE_SYSTEM = """Sei un interlocutore amichevole e colto che discute articoli di attualità in italiano. L'utente sta imparando l'italiano e vuole praticare la conversazione su un articolo specifico.

REGOLE:
- Rispondi SEMPRE in italiano. Mai in ebraico, mai in inglese, mai tradurre.
- Tono amichevole e conversazionale. Non sei un insegnante, sei un amico con cui si discute.
- Puoi essere d'accordo con l'utente quando non c'è molto su cui dissentire. Non fingere disaccordo per creare un dibattito artificiale.
- Fai domande di approfondimento per mantenere viva la conversazione.
- Rimani ancorato all'articolo fornito. Se l'utente divaga, riporta gentilmente il discorso sul tema.
- Usa un italiano naturale, non artificialmente semplificato. L'utente vuole immersione.
- Non correggere gli errori dell'utente durante la conversazione — la correzione avviene separatamente alla fine.

ARTICOLO:
Titolo: {article_title}
Sezione: {article_section}
Testo: {article_body}"""

SCORING_PROMPT = """You are evaluating a language learner's Italian conversation about a specific article.

CONTEXT:
Article title: {article_title}
Article section: {article_section}
Article excerpt (first 500 words): {article_body_excerpt}

TARGET CEFR LEVEL: {cefr_level}
Grade the user AGAINST this target level. A score of 100 means perfect {cefr_level} performance. If the user writes below {cefr_level}, the score reflects the gap. If they exceed it, cap at 100. Do not auto-calibrate downward — hold them to the {cefr_level} standard.

USER'S DEBATE TRANSCRIPT (Italian):
{transcript}

TASK:
1. Assign ONE overall score from 0 to 100 against the {cefr_level} standard.
2. Write feedback IN HEBREW structured as follows:

**סיכום כללי**: 1-2 משפטים על הרמה הכללית.

**שגיאות**: For EACH mistake, use this exact format:
❌ כתבת: "[exact wrong text from transcript]"
✅ נכון: "[corrected version]"
💡 למה: [brief Hebrew explanation of the rule]

Cover grammar errors, wrong vocabulary, Hebraisms/Anglicisms, and weak argumentation. If there are no errors in a category, skip it. If voice mode, note any pronunciation issues.

**מה עבד טוב**: briefly note 1-2 things done well.

3. Tag errors into categories for stats.

OUTPUT FORMAT (strict JSON):
{{
  "overall_score": <int 0-100>,
  "error_explanation_hebrew": "<Hebrew string with the structured feedback above>",
  "error_categories": {{
    "grammar": ["<tag>", ...],
    "vocabulary": ["<tag>", ...],
    "argumentation": ["<tag>", ...],
    "pronunciation": ["<tag>", ...]
  }}
}}

Respond ONLY with valid JSON. No preamble, no markdown fences."""


@debate_bp.route("/translate", methods=["POST"])
def translate_word():
    body = request.get_json()
    word = (body.get("word") or "").strip()
    if not word:
        return jsonify({"error": "word required"}), 400
    client = _openai()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": f"Translate the following English word or short phrase to Italian. Reply with ONLY the Italian translation, nothing else: {word}",
        }],
        max_tokens=30,
        temperature=0,
    )
    return jsonify({"italian": response.choices[0].message.content.strip()})


def _get_article(article_id):
    result = get_db().table("articles").select("*").eq("id", article_id).single().execute()
    return result.data


def _openai():
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


@debate_bp.route("/<article_id>/message", methods=["POST"])
def send_message(article_id):
    article = _get_article(article_id)
    if not article:
        return jsonify({"error": "Article not found"}), 404

    body = request.get_json()
    history = body.get("history", [])  # [{role, content}]
    mode = body.get("mode", "text")
    user_text = body.get("content", "")
    final_turn = body.get("final_turn", False)

    # Voice mode: transcribe audio first
    if mode == "voice":
        audio_b64 = body.get("audio")
        if not audio_b64:
            return jsonify({"error": "audio field required for voice mode"}), 400
        audio_bytes = base64.b64decode(audio_b64)
        client = _openai()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name
        with open(tmp_path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="it",
            )
        os.unlink(tmp_path)
        user_text = transcription.text

    if not user_text:
        return jsonify({"error": "No user content"}), 400

    # Mark article in_progress if not_started
    if article["status"] == "not_started":
        get_db().table("articles").update({"status": "in_progress"}).eq("id", article_id).execute()

    system_msg = (DEBATE_SYSTEM
        .replace("{article_title}", article["title"])
        .replace("{article_section}", article["section"])
        .replace("{article_body}", article["body"])
    )

    messages = [{"role": "system", "content": system_msg}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_text})
    if final_turn:
        messages.append({
            "role": "system",
            "content": "Questo è l'ultimo scambio della conversazione. Concludi in modo naturale senza porre nuove domande.",
        })

    client = _openai()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        temperature=0.7,
    )
    assistant_text = response.choices[0].message.content

    return jsonify({
        "user_text": user_text,
        "assistant_text": assistant_text,
    })


@debate_bp.route("/<article_id>/end", methods=["POST"])
def end_debate(article_id):
    article = _get_article(article_id)
    if not article:
        return jsonify({"error": "Article not found"}), 404

    body = request.get_json()
    transcript = body.get("transcript", [])
    mode = body.get("mode", "text")
    cefr_level = body.get("cefr_level", "B2")

    # Build transcript string for scoring
    transcript_str = "\n".join(
        f"[{t['role'].upper()}]: {t['content']}" for t in transcript
    )

    body_words = article["body"].split()
    excerpt = " ".join(body_words[:500])

    scoring_prompt = (SCORING_PROMPT
        .replace("{article_title}", article["title"])
        .replace("{article_section}", article["section"])
        .replace("{article_body_excerpt}", excerpt)
        .replace("{transcript}", transcript_str)
        .replace("{cefr_level}", cefr_level)
    )

    try:
        client = _openai()
        scoring_response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": scoring_prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = scoring_response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        scoring = json.loads(raw)
    except Exception as e:
        return jsonify({"error": f"Scoring failed: {str(e)}"}), 500

    score = scoring.get("overall_score", 0)
    feedback = scoring.get("error_explanation_hebrew", "")
    categories = scoring.get("error_categories", {})

    from datetime import datetime, timezone
    db_error = None
    try:
        get_db().table("sessions").insert({
            "article_id": article_id,
            "mode": mode,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "debate_transcript": transcript,
            "overall_score": score,
            "error_explanation_hebrew": feedback,
            "error_categories": categories,
        }).execute()
        get_db().table("articles").update({"status": "scored"}).eq("id", article_id).execute()
    except Exception as e:
        db_error = str(e)

    return jsonify({
        "score": score,
        "error_explanation_hebrew": feedback,
        "db_error": db_error,
    })
