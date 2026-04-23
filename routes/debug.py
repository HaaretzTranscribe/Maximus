import os
import requests
import traceback
from flask import Blueprint, jsonify

debug_bp = Blueprint("debug", __name__, url_prefix="/api/debug")


@debug_bp.route("/db")
def test_db():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")

    result = {
        "url_prefix": url[:40],
        "key_prefix": key[:20],
        "tests": {}
    }

    # Raw REST call — bypass supabase-py entirely
    try:
        r = requests.get(
            f"{url}/rest/v1/articles?select=id&limit=1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=10
        )
        result["tests"]["raw_rest"] = {
            "status": r.status_code,
            "body": r.text[:300]
        }
    except Exception as e:
        result["tests"]["raw_rest"] = {"error": str(e)}

    # supabase-py call
    try:
        from db import get_db
        rows = get_db().table("articles").select("id").limit(1).execute()
        result["tests"]["supabase_py"] = {"ok": True, "rows": len(rows.data or [])}
    except Exception as e:
        result["tests"]["supabase_py"] = {"error": str(e), "trace": traceback.format_exc()[-500:]}

    return jsonify(result)
