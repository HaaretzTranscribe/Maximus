async function showArticle(articleId) {
  const app = document.getElementById('app');
  const article = await API.articles.get(articleId);

  const SECTION_LABELS = {
    mondo: 'Mondo', italia: 'Italia', sport: 'Sport',
    scienza: 'Scienza', tecnologia: 'Tecnologia', cultura: 'Cultura',
  };
  const section = SECTION_LABELS[article.section] || article.section;
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  // Replace home screen content with article view
  app.innerHTML = `
    <div id="screen-article" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="article-back">‹</button>
        <h1>Articolo</h1>
      </div>

      <div class="article-meta-block">
        <h2>${article.title}</h2>
        <div class="article-meta-row">
          <span class="badge badge-${article.status}">${section}</span>
          <span>${date}</span>
          <span>${article.word_count} parole</span>
        </div>
      </div>

      <div class="mode-toggle">
        <button class="btn active" id="mode-read">📖 Leggi</button>
        <button class="btn" id="mode-listen">🔊 Ascolta</button>
      </div>

      <div class="audio-player" id="audio-player">
        <audio id="article-audio" controls preload="none">
          Il tuo browser non supporta l'audio.
        </audio>
      </div>

      <!-- Native selectable HTML — iOS Look Up works here -->
      <div class="article-body" id="article-body">${escapeHtml(article.body)}</div>

      <div class="article-actions">
        <button class="btn btn-primary btn-full" id="start-debate-btn">💬 Inizia il dibattito</button>
        <div class="btn-row">
          <button class="btn btn-danger" id="reject-btn">❌ Rifiuta</button>
          <button class="btn btn-success" id="done-btn">✓ Segna come fatto</button>
        </div>
      </div>
    </div>
  `;

  // Back
  document.getElementById('article-back').addEventListener('click', () => Router.go('home'));

  // Mode toggle
  const audioPlayer = document.getElementById('audio-player');
  const audioEl = document.getElementById('article-audio');
  let audioLoaded = false;

  document.getElementById('mode-read').addEventListener('click', () => {
    document.getElementById('mode-read').classList.add('active');
    document.getElementById('mode-listen').classList.remove('active');
    audioPlayer.classList.remove('visible');
  });

  document.getElementById('mode-listen').addEventListener('click', async () => {
    document.getElementById('mode-listen').classList.add('active');
    document.getElementById('mode-read').classList.remove('active');
    audioPlayer.classList.add('visible');
    if (!audioLoaded) {
      audioEl.src = API.articles.ttsUrl(articleId);
      audioLoaded = true;
    }
  });

  // Start debate
  document.getElementById('start-debate-btn').addEventListener('click', () => {
    Router.go('debate', { id: articleId, article });
  });

  // Reject
  document.getElementById('reject-btn').addEventListener('click', async () => {
    await API.articles.setStatus(articleId, 'rejected');
    showToast('Articolo rifiutato.');
    Router.go('home');
  });

  // Done
  document.getElementById('done-btn').addEventListener('click', async () => {
    await API.articles.setStatus(articleId, 'done');
    showToast('Articolo completato.');
    Router.go('home');
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
