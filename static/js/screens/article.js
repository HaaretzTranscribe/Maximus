async function showArticle(articleId) {
  const app = document.getElementById('app');
  const article = await API.articles.get(articleId);

  const SECTION_LABELS = {
    mondo: 'World', italia: 'Italy', sport: 'Sport',
    scienza: 'Science', tecnologia: 'Technology', cultura: 'Culture',
  };
  const section = SECTION_LABELS[article.section] || article.section;
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  app.innerHTML = `
    <div id="screen-article" class="screen active">
      <div class="screen-header article-screen-header">
        <button class="back-btn" id="article-back">‹ Back</button>
      </div>

      <div class="article-sticky-header">
        <div class="article-meta-block">
          <h2>${article.title}</h2>
          <div class="article-meta-row">
            <span class="badge badge-in_progress">${section}</span>
            <span>${date}</span>
            <span>${article.word_count} words</span>
          </div>
        </div>

        <div class="mode-toggle">
          <button class="btn active" id="mode-read">📖 Read</button>
          <button class="btn" id="mode-listen">🔊 Listen</button>
        </div>

        <div class="audio-player" id="audio-player">
          <div id="tts-loading" class="tts-loading hidden">
            <span class="spinner"></span> <span id="tts-loading-msg">Generating audio…</span>
          </div>
          <div id="tts-error" class="tts-error hidden">
            ⚠️ Audio failed. <button class="btn btn-outline" id="tts-retry-btn" style="padding:4px 10px;font-size:0.8rem;">Retry</button>
          </div>
          <div id="tts-controls" class="hidden">
            <div class="audio-controls-row">
              <button class="btn btn-outline audio-skip" id="skip-back">−5s</button>
              <audio id="article-audio" controls preload="none">
                Your browser does not support audio.
              </audio>
              <button class="btn btn-outline audio-skip" id="skip-fwd">+5s</button>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;justify-content:center;">
              <button class="btn btn-outline speed-btn" data-speed="0.75" style="padding:6px 12px;font-size:0.8rem;">0.75×</button>
              <button class="btn btn-outline speed-btn active" data-speed="1" style="padding:6px 12px;font-size:0.8rem;">1×</button>
              <button class="btn btn-outline speed-btn" data-speed="1.25" style="padding:6px 12px;font-size:0.8rem;">1.25×</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Native selectable HTML — iOS Look Up works here -->
      <div class="article-body" id="article-body">${buildSentenceSpans(article.body)}</div>

      <div class="article-actions">
        <button class="btn btn-primary btn-full" id="start-debate-btn">💬 Start debate</button>
        <div class="btn-row">
          <button class="btn btn-danger" id="reject-btn">❌ Reject</button>
          <button class="btn btn-success" id="done-btn">✓ Mark done</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('article-back').addEventListener('click', () => Router.go('home'));

  const audioPlayer  = document.getElementById('audio-player');
  const ttsLoading   = document.getElementById('tts-loading');
  const ttsLoadingMsg= document.getElementById('tts-loading-msg');
  const ttsError     = document.getElementById('tts-error');
  const ttsControls  = document.getElementById('tts-controls');
  let audioEl        = null;
  let audioLoaded    = false;
  let loadingTimer   = null;

  function showTtsLoading() {
    ttsLoading.classList.remove('hidden');
    ttsError.classList.add('hidden');
    ttsControls.classList.add('hidden');
    // After 8s hint that it may take longer
    loadingTimer = setTimeout(() => {
      ttsLoadingMsg.textContent = 'Still generating… (can take ~30s for long articles)';
    }, 8000);
  }

  function showTtsControls() {
    clearTimeout(loadingTimer);
    ttsLoading.classList.add('hidden');
    ttsError.classList.add('hidden');
    ttsControls.classList.remove('hidden');
  }

  function showTtsError() {
    clearTimeout(loadingTimer);
    ttsLoading.classList.add('hidden');
    ttsControls.classList.add('hidden');
    ttsError.classList.remove('hidden');
  }

  function loadAudio() {
    showTtsLoading();
    audioEl = document.getElementById('article-audio');
    audioEl.src = API.articles.ttsUrl(articleId);

    audioEl.addEventListener('canplay', showTtsControls, { once: true });
    audioEl.addEventListener('error', showTtsError, { once: true });

    // Sentence highlight
    setupHighlight(audioEl);
  }

  document.getElementById('mode-read').addEventListener('click', () => {
    document.getElementById('mode-read').classList.add('active');
    document.getElementById('mode-listen').classList.remove('active');
    audioPlayer.classList.remove('visible');
    clearSentenceHighlight();
    if (audioEl) audioEl.pause();
  });

  document.getElementById('mode-listen').addEventListener('click', () => {
    document.getElementById('mode-listen').classList.add('active');
    document.getElementById('mode-read').classList.remove('active');
    audioPlayer.classList.add('visible');
    if (!audioLoaded) {
      audioLoaded = true;
      loadAudio();
    }
  });

  document.getElementById('tts-retry-btn').addEventListener('click', () => {
    // Clear cached src to force reload
    if (audioEl) { audioEl.src = ''; }
    audioLoaded = false;
    audioLoaded = true;
    loadAudio();
  });

  // Skip & speed buttons (delegated — audioEl may not exist yet)
  audioPlayer.addEventListener('click', e => {
    if (!audioEl) return;
    if (e.target.id === 'skip-back') audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
    if (e.target.id === 'skip-fwd')  audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 5);
    if (e.target.classList.contains('speed-btn')) {
      audioEl.playbackRate = parseFloat(e.target.dataset.speed);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    }
  });

  // Sentence highlight — character-weighted for better sync
  const sentenceEls = Array.from(document.querySelectorAll('.audio-sentence'));
  const sentenceLens = sentenceEls.map(el => el.textContent.length);
  const totalChars   = sentenceLens.reduce((a, b) => a + b, 0);
  let cumFractions   = [];
  let acc = 0;
  for (const len of sentenceLens) { acc += len; cumFractions.push(acc / totalChars); }
  let lastIdx = -1;

  function clearSentenceHighlight() {
    sentenceEls.forEach(el => el.classList.remove('audio-active'));
    lastIdx = -1;
  }

  function setupHighlight(el) {
    el.addEventListener('timeupdate', () => {
      if (!el.duration || !sentenceEls.length) return;
      const pct = el.currentTime / el.duration;
      const idx = cumFractions.findIndex(f => f >= pct);
      const target = idx === -1 ? sentenceEls.length - 1 : idx;
      if (target === lastIdx) return;
      lastIdx = target;
      sentenceEls.forEach((s, i) => s.classList.toggle('audio-active', i === target));
      // Only auto-scroll when playing
      if (!el.paused) {
        sentenceEls[target].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    el.addEventListener('ended', clearSentenceHighlight);
  }

  document.getElementById('start-debate-btn').addEventListener('click', () => {
    Router.go('debate', { id: articleId, article });
  });

  document.getElementById('reject-btn').addEventListener('click', async () => {
    await API.articles.setStatus(articleId, 'rejected');
    showToast('Article rejected.');
    Router.go('home');
  });

  document.getElementById('done-btn').addEventListener('click', async () => {
    await API.articles.setStatus(articleId, 'done');
    showToast('Marked done.');
    Router.go('home');
  });
}

function buildSentenceSpans(text) {
  let idx = 0;
  // Process paragraph by paragraph to preserve \n\n structure
  const paragraphs = text.split(/\n\n+/);
  const htmlParas = paragraphs.map(para => {
    if (!para.trim()) return '';
    // Split sentences on . ! ? » followed by a space and capital/quote
    const parts = para.split(/(?<=[.!?»])\s+(?=[A-ZÁÀÉÈÍÌÓÒÚÙ"«\u0022\u201C])/);
    return parts.map(s => {
      if (!s.trim()) return escapeHtml(s);
      return `<span class="audio-sentence" id="s-${idx++}">${escapeHtml(s)}</span>`;
    }).join(' ');
  });
  return htmlParas.join('\n\n');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
