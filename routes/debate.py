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

SCORING_PROMPT = """You are evaluating a language learner's performance in an Italian conversation about a specific article. The user is Amnon, a Hebrew speaker learning Italian.

CONTEXT:
Article title: {article_title}
Article section: {article_section}
Article excerpt (first 500 words): {article_body_excerpt}

USER'S DEBATE TRANSCRIPT (Italian):
{transcript}

TASK:
1. Assign ONE overall score from 0 to 100. Calibrate the score to the LEVEL the user demonstrated. An advanced-level response should be graded against advanced standards; a basic response against basic standards. Do NOT grade a clearly basic user harshly on advanced criteria — grade proportionally.
2. Write an error explanation IN HEBREW that:
   - Lists specific grammatical errors with the wrong form, the correct form, and a brief explanation (e.g., "כתבת 'penso che è' — הצורה הנכונה היא 'penso che sia', כי אחרי 'penso che' נדרש שימוש בקונגיונטיבו").
   - Notes vocabulary issues (wrong word choice, Anglicisms, calques from English/Hebrew).
   - Comments briefly on argument quality and engagement with the article content.
   - If voice mode, note pronunciation issues inferred from the transcript (unusual word choices that suggest mishearing, etc.).
3. Tag errors into categories for later stats aggregation.

OUTPUT FORMAT (strict JSON):
{
  "overall_score": <int 0-100>,
  "error_explanation_hebrew": "<string, Hebrew, can be multi-paragraph>",
  "error_categories": {
    "grammar": ["<tag>", ...],
    "vocabulary": ["<tag>", ...],
    "argumentation": ["<tag>", ...],
    "pronunciation": ["<tag>", ...]
  }
}

Respond ONLY with valid JSON. No preamble, no markdown fences."""


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

    system_msg = DEBATE_SYSTEM.format(
        article_title=article["title"],
        article_section=article["section"],
        article_body=article["body"],
    )

    messages = [{"role": "system", "content": system_msg}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_text})

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

    # Build transcript string for scoring (user turns only for analysis)
    transcript_str = "\n".join(
        f"[{t['role'].upper()}]: {t['content']}" for t in transcript
    )

    body_words = article["body"].split()
    excerpt = " ".join(body_words[:500])

    scoring_prompt = SCORING_PROMPT.format(
        article_title=article["title"],
        article_section=article["section"],
        article_body_excerpt=excerpt,
        transcript=transcript_str,
    )

    client = _openai()
    scoring_response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": scoring_prompt}],
        temperature=0.2,
    )
    raw = scoring_response.choices[0].message.content.strip()

    try:
        scoring = json.loads(raw)
    except json.JSONDecodeError:
        return jsonify({"error": "Scoring returned invalid JSON", "raw": raw}), 500

    # Store session
    get_db().table("sessions").insert({
        "article_id": article_id,
        "mode": mode,
        "debate_transcript": transcript,
        "overall_score": scoring["overall_score"],
        "error_explanation_hebrew": scoring["error_explanation_hebrew"],
        "error_categories": scoring["error_categories"],
    }).execute()

    # Update article status to scored
    get_db().table("articles").update({"status": "scored"}).eq("id", article_id).execute()

    return jsonify({
        "score": scoring["overall_score"],
        "error_explanation_hebrew": scoring["error_explanation_hebrew"],
    })
