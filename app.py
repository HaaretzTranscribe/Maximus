import os
from flask import Flask, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["PROPAGATE_EXCEPTIONS"] = True


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/health")
def health():
    import os
    url = os.environ.get("SUPABASE_URL", "NOT SET")
    return jsonify({
        "status": "ok",
        "app": "Maximus",
        "supabase_url": url[:30] + "..." if len(url) > 30 else url,
        "supabase_key_set": bool(os.environ.get("SUPABASE_SERVICE_KEY")),
    })


from routes.articles import articles_bp
from routes.debate import debate_bp
from routes.stats import stats_bp

app.register_blueprint(articles_bp)
app.register_blueprint(debate_bp)
app.register_blueprint(stats_bp)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
