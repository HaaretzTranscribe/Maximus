import os
from flask import Blueprint, jsonify, request
from openai import OpenAI
from db import get_db

stats_bp = Blueprint("stats", __name__, url_prefix="/api/stats")


@stats_bp.route("", methods=["GET"])
def get_stats():
    date_from = request.args.get("from")
    date_to = request.args.get("to")

    query = (
        get_db().table("sessions")
        .select("overall_score,mode,ended_at,error_categories,article_id,articles(section)")
        .not_.is_("overall_score", "null")
        .order("ended_at", desc=False)
    )
    if date_from:
        query = query.gte("ended_at", date_from)
    if date_to:
        query = query.lte("ended_at", date_to)

    result = query.execute()
    sessions = result.data or []

    # Scores over time for line graph
    scores_over_time = [
        {"date": s["ended_at"], "score": s["overall_score"]}
        for s in sessions if s.get("ended_at")
    ]

    # Averages by section
    section_totals = {}
    section_counts = {}
    for s in sessions:
        section = None
        if s.get("articles") and isinstance(s["articles"], dict):
            section = s["articles"].get("section")
        elif s.get("articles") and isinstance(s["articles"], list) and s["articles"]:
            section = s["articles"][0].get("section")
        if section:
            slot = section if section in ("mondo", "italia", "sport") else "scienza"
            section_totals[slot] = section_totals.get(slot, 0) + s["overall_score"]
            section_counts[slot] = section_counts.get(slot, 0) + 1

    averages_by_section = {
        slot: round(section_totals[slot] / section_counts[slot])
        for slot in section_totals
    }

    # Recurring error patterns — aggregated by GPT on demand
    all_errors = []
    for s in sessions:
        cats = s.get("error_categories") or {}
        for category, tags in cats.items():
            if isinstance(tags, list):
                all_errors.extend(tags)

    error_patterns = []
    if all_errors:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        prompt = (
            "These are error tags from an Italian language learner's debate sessions:\n"
            + ", ".join(all_errors)
            + "\n\nIdentify the top recurring patterns (max 5). "
            "Return a JSON array of strings, each describing one pattern concisely in Hebrew. "
            "No preamble, no markdown."
        )
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        import json
        try:
            error_patterns = json.loads(resp.choices[0].message.content.strip())
        except Exception:
            error_patterns = []

    return jsonify({
        "scores_over_time": scores_over_time,
        "averages_by_section": averages_by_section,
        "error_patterns": error_patterns,
    })
