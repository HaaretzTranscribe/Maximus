function showScore({ score, feedback, articleId }) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-score" class="screen active">
      <div class="screen-header">
        <h1>Risultato</h1>
      </div>

      <div class="score-circle" style="--pct:${score}">
        <div class="score-number">${score}</div>
      </div>
      <div class="score-label">su 100</div>

      <div class="feedback-box">${escapeHtml(feedback)}</div>

      <div class="btn-row" style="margin-top:auto; padding-top:16px;">
        <button class="btn btn-outline" id="score-home-btn">🏠 Home</button>
        <button class="btn btn-primary" id="score-next-btn">Prossimo articolo ›</button>
      </div>
    </div>
  `;

  document.getElementById('score-home-btn').addEventListener('click', () => Router.go('home'));

  document.getElementById('score-next-btn').addEventListener('click', async () => {
    const articles = await API.articles.current();
    const next = articles.find(a => a && !['done', 'rejected', 'scored'].includes(a.status) && a.id !== articleId);
    if (next) {
      Router.go('article', { id: next.id });
    } else {
      showToast('Nessun altro articolo disponibile.');
      Router.go('home');
    }
  });
}
