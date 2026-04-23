# CLAUDE.md — Italian Learning PWA (working title: "IlPost Debate")

## Project overview

Personal-use Progressive Web App for Italian language learning. Fetches articles from Il Post (ilpost.it), lets the user read or listen to them, holds a conversational debate in Italian grounded in the article, then scores the user's performance and tracks improvement over time.

**Single user. No authentication in v1.** Amnon is the only user. Multi-user is a potential v2.

**The user is non-technical.** Amnon directs Claude Code to write all code. Do not suggest "you could also try..." — make decisions and explain them.

**Never drop a feature, degrade functionality, simplify scope, skip a step, or substitute a weaker implementation without explicit written approval from Amnon.** If you run into a blocker, report it clearly, propose specific resolutions, and WAIT for his decision. Do not proceed on a reduced plan and report it after the fact. This rule overrides any instinct to "be helpful by moving forward." Moving forward on a degraded plan without approval is the opposite of helpful.

## Non-negotiables (read every session)

1. **No scheduled jobs, no background workers, no cron.** Article fetching is user-triggered only, via a button in the UI.
2. **Never truncate or summarize Il Post article text.** If an article is outside the 400–900 word range, it is filtered out, not shortened.
3. **Debate is Italian-only.** No fallback to Hebrew or English during the debate. Full immersion is the point.
4. **Error explanations after scoring are in Hebrew.** This is the one place Hebrew appears — so the user actually understands what they got wrong.
5. **OpenAI is the only AI provider.** GPT-4o (or latest equivalent) for debate and scoring, Whisper for STT, OpenAI TTS for voice output. Do not introduce Anthropic, ElevenLabs, or any other provider.
6. **Hosting is Railway only.** No Netlify, no Vercel, no separate frontend host. Flask serves both the API and the static frontend from one Railway service.
7. **Never store the OpenAI API key in the frontend.** All OpenAI calls go through the Flask backend.
8. **Il Post article text must render as native selectable HTML** so iOS's built-in Look Up / Translate / Share work on long-press. Do not use canvas, do not use images of text, do not override selection behavior.

## Tech stack

- **Backend:** Python 3.11+, Flask, deployed on Railway
- **Frontend:** Mobile-first PWA. Plain HTML/CSS/JavaScript is acceptable; React is acceptable if it serves the design. Pick one and stick with it — don't mix. Default: plain HTML/CSS/JS for minimum surface area.
- **Database:** Supabase (Postgres). Use the Python `supabase-py` client.
- **AI:** OpenAI API — models: `gpt-4o` (or newest equivalent) for debate/scoring, `whisper-1` for STT, `tts-1` or `tts-1-hd` for voice output. Use the `openai` Python SDK.
- **PWA manifest + service worker** so it installs to the iPhone home screen with an icon and opens fullscreen.
- **Environment variables:** `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Nothing else should be secret. Never commit `.env`.

## User flow

### Screen 1: Home

- **Top:** `Fetch new articles` button.
- **Middle:** "Current articles" — a list of 4 cards, one per section slot:
  - Mondo
  - Italia
  - Sport
  - Scienza / Tecnologia / Cultura (whichever the fetcher found first)
- Each card shows: article title, section label, date, word count, and status badge.
  - Status values: `Not started` / `In progress` / `Scored: NN` / `Done` / `Rejected`
- **Bottom:** `Stats` button.

On first-ever app open, the 4 cards are empty placeholders with a prompt to tap the Fetch button.

On subsequent opens, the previous session's articles persist exactly as they were.

### Screen 2: Article view

Tapped from a card on Home.

- Title, section, publication date, word count at the top.
- Two mode buttons: `📖 Read` / `🔊 Listen`. User picks freely per article; both modes access the same text, mode choice does not affect scoring.
- The article text itself — full, unmodified, native selectable HTML.
- In Listen mode, a play/pause/scrub bar appears above the text. TTS uses OpenAI TTS with a natural Italian voice (e.g., `onyx`, `alloy`, or whichever sounds most natural for Italian — test and pick one).
- **Bottom buttons:**
  - `💬 Start debate`
  - `❌ Reject this article` — marks it for replacement on next `Fetch new articles`
  - `✓ Mark done` — archives it, removes from active list

### Screen 3: Debate view

- Collapsed reference to the article at top (tappable to re-read).
- Mode toggle: `🎤 Voice` / `⌨️ Text` — switchable at any point during the debate.
- Conversation area:
  - In voice mode: user taps mic, speaks Italian, Whisper transcribes, GPT responds, TTS speaks response. Both sides' transcripts visible as the exchange happens.
  - In text mode: keyboard input, text-only exchange.
- **Bottom:** `End debate & get score` button.

Debate tone: friendly, conversational, can agree when there's nothing to disagree about. Not adversarial. The AI's role is to be an engaged Italian-speaking interlocutor, not a drill sergeant.

### Screen 4: Score view

Shown after user ends the debate.

- Large overall score: `NN / 100`
- Written explanation in **Hebrew**: specific errors (grammar, vocabulary, argument quality, pronunciation if voice), calibrated to the level of the user's actual response. An advanced user should be scored against advanced standards; a basic response should be scored against basic standards. Do not grade harshly beyond what the user's own level justifies.
- Two buttons: `Back to home` / `Next article` (goes to the next card that is not Done/Rejected/Scored).

### Screen 5: Stats

- Line graph of overall score over time.
- Averages by section (Mondo / Italia / Sport / Scienza-Tecnologia-Cultura).
- Recurring error patterns — generated from the error explanations in Supabase, aggregated by GPT on demand.
- Filters: date range.

## Article selection logic

### Source
Il Post sections to pull from:
- Mondo: `https://www.ilpost.it/mondo/`
- Italia: `https://www.ilpost.it/italia/`
- Sport: `https://www.ilpost.it/sport/`
- Scienza: `https://www.ilpost.it/scienza/`
- Tecnologia: `https://www.ilpost.it/tecnologia/`
- Cultura: `https://www.ilpost.it/cultura/`

**Check whether Il Post publishes RSS feeds for these sections first** — if yes, use RSS, it's more stable than scraping. Falls back to HTML scraping if not.

### Rules
- Exactly 4 articles per set:
  1. One from Mondo
  2. One from Italia
  3. One from Sport
  4. One from whichever of Scienza / Tecnologia / Cultura yields a qualifying article first (check in that order, or pick the newest across the three — the latter is preferable)
- Qualifying = 400 to 900 words, inclusive, based on the article body text from Il Post (exclude title, byline, captions, related-article boxes, comments).
- Walk backward from the newest article in each section until one qualifies. No arbitrary cap — keep walking.
- Exclude any article whose URL is already in the `articles` table with status `done`. (Articles marked rejected are also excluded from future fetches.)

### Fetch button behavior
- **First fetch:** populates all 4 slots.
- **Subsequent fetches:** replaces only articles currently marked `rejected`. Articles marked `not started`, `in progress`, `scored`, or `done` are preserved.
- If no rejected articles exist, show a toast: "Nothing to replace. Mark articles as rejected or done first."

### Scraping
- Use `requests` + `BeautifulSoup4` (or `feedparser` if RSS works).
- Respect robots.txt. Throttle to at most 1 request per second. Set a proper User-Agent identifying this as a personal learning tool.
- Cache article bodies in Supabase `articles` table on first fetch — never re-scrape an already-stored article.

## Database schema (Supabase)

```sql
-- Articles ever served to the user
create table articles (
  id uuid primary key default gen_random_uuid(),
  url text unique not null,
  section text not null,              -- 'mondo' | 'italia' | 'sport' | 'scienza' | 'tecnologia' | 'cultura'
  title text not null,
  body text not null,                  -- full article text, unmodified
  word_count int not null,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  status text not null default 'not_started',  -- 'not_started' | 'in_progress' | 'scored' | 'done' | 'rejected'
  current_set boolean default true    -- true if article is in the active home-screen set
);

-- One row per completed debate session for an article
create table sessions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  mode text,                           -- 'voice' | 'text' | 'mixed'
  debate_transcript jsonb,             -- [{role, content, timestamp}]
  overall_score int,                   -- 0-100
  error_explanation_hebrew text,       -- the Hebrew feedback shown to user
  error_categories jsonb               -- structured tags for stats aggregation, e.g. {grammar: [...], vocab: [...]}
);
```

No user_id column in v1. Add it in v2 if going multi-user (entire schema gets a `user_id uuid` column plus RLS policies — see "Future multi-user considerations" below).

## API surface (Flask routes)

- `GET /` — serves the PWA index.html
- `GET /static/...` — serves JS, CSS, service worker, manifest, icons
- `GET /api/articles/current` — returns the 4 cards currently in the active set, with status
- `POST /api/articles/fetch` — runs the fetch logic, replaces rejected slots, returns new set
- `GET /api/articles/<id>` — returns full article body + metadata
- `POST /api/articles/<id>/status` — body: `{status: 'done' | 'rejected' | 'in_progress'}`
- `POST /api/articles/<id>/tts` — body: none. Streams or returns TTS audio for the article body. Cache the audio file per article in Supabase Storage to avoid re-paying for TTS on re-listens.
- `POST /api/debate/<article_id>/message` — body: `{role: 'user', content: '...', mode: 'voice' | 'text'}`. Returns GPT's Italian response. For voice, also accepts `{audio: <base64>}` and runs Whisper first.
- `POST /api/debate/<article_id>/end` — body: `{transcript: [...]}`. Runs scoring, stores session, returns `{score, error_explanation_hebrew}`.
- `GET /api/stats` — returns aggregated stats for the Stats screen.

## Prompts (critical — these define the product)

### Debate prompt (system message for conversation)

```
Sei un interlocutore amichevole e colto che discute articoli di attualità in italiano. L'utente sta imparando l'italiano e vuole praticare la conversazione su un articolo specifico.

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
Testo: {article_body}
```

### Scoring prompt (separate call, after debate ends)

```
You are evaluating a language learner's performance in an Italian conversation about a specific article. The user is Amnon, a Hebrew speaker learning Italian.

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

Respond ONLY with valid JSON. No preamble, no markdown fences.
```

## PWA requirements

- `manifest.json` with `display: standalone`, app name, icons at 192×192 and 512×512.
- `service-worker.js` for offline shell caching (app frame, not article content).
- Meta tags for iOS: `apple-mobile-web-app-capable`, `apple-touch-icon`, status bar style.
- Viewport meta with `viewport-fit=cover` for safe-area handling on iPhones with notches.
- On first open, a small instruction card: "Tap Share → Add to Home Screen to install."

## OpenAI usage notes

- Use `gpt-4o` for debate exchanges. Temperature 0.7 (conversational).
- Use `gpt-4o` for scoring. Temperature 0.2 (consistent evaluation).
- Use `whisper-1` for STT. Pass `language="it"` explicitly.
- Use `tts-1` initially (cheap). Upgrade to `tts-1-hd` only if voice quality is insufficient. Italian voice: test `alloy`, `onyx`, `nova` and pick the most natural. Document the choice in a comment.
- Cache TTS audio per article in Supabase Storage. Never regenerate for the same article.
- **Hard spending limit:** Set a $20/month cap in the OpenAI dashboard. Document this in README.

## What NOT to do

- Do NOT build a login/signup system. Single user, no auth.
- Do NOT build a scheduler, cron job, or background worker. All fetches are user-triggered.
- Do NOT use LocalStorage for persistent data beyond simple UI preferences. All state lives in Supabase.
- Do NOT call OpenAI from the browser. All API keys stay on the server.
- Do NOT add translation features in the debate — iOS's native Look Up handles word-level help, and the debate is meant to be immersive.
- Do NOT add a "hint" button, "give me the answer" button, or any feature that reduces friction in the debate. The friction is the point.
- Do NOT add gamification beyond the score and the stats graph. No streaks, no badges, no daily goals. This is a tool, not a game.
- Do NOT suggest Realtime API for v1. Standard Whisper + GPT + TTS pipeline is fine. Realtime is a future optimization if voice feels too turn-based.

## Development order

Build in this order. Do not start a layer until the previous one works.

1. **Scaffold:** Flask app on Railway, Supabase connected, environment variables working. `/` returns "hello."
2. **Il Post scraper:** standalone script that fetches one Mondo article, prints title + body + word count. Verify word counting matches Il Post's actual content.
3. **Article selection logic:** given all 6 sections, returns 4 qualifying articles following the rules.
4. **DB persistence:** scraper writes to `articles` table, idempotent.
5. **Frontend — Home screen:** vanilla HTML/CSS/JS. Fetches from `/api/articles/current`. Displays 4 cards.
6. **Frontend — Article view:** Read mode first, native HTML rendering, selectable text. Verify iOS Look Up works on a real iPhone.
7. **TTS / Listen mode:** `/api/articles/<id>/tts` endpoint. Frontend audio player.
8. **Debate — text mode first:** full text-only debate loop working end-to-end.
9. **Scoring:** end debate, GPT evaluates, Hebrew feedback shown.
10. **Stats screen:** line graph + averages.
11. **Voice mode:** Whisper integration, mic recording in frontend, TTS playback of AI responses.
12. **PWA installability:** manifest, service worker, iOS meta tags. Install to home screen on a real iPhone and verify.

Each step should end with a working, deployed, tested version. No "I'll wire this up later."

## Future multi-user considerations (do NOT build in v1, document only)

If v2 goes multi-user:
- Add `users` table, Supabase Auth integration.
- Every table gets `user_id uuid references users(id)`.
- RLS policies on every table: users can only read/write their own rows.
- Articles table becomes shared (article content is the same regardless of user) but `status` and `current_set` move to a per-user `user_articles` join table.
- OpenAI key strategy: either BYO user keys, or a quota/billing layer.
- Terms of service, privacy policy, Il Post content-use position.

## Reporting back

When Claude Code finishes each development step, report:
- What was built
- What was tested and how
- Any blockers or decisions made
- Next step

Do not skip ahead. Do not add features not in this spec without asking.
