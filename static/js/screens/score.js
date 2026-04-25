function showScore({ score, feedback, articleId }) {
  const tag = score >= 80 ? '🏆 Excellent!' : score >= 60 ? '👍 Good work!' : score >= 40 ? '📈 Keep going!' : '💪 Keep practising!';

  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-score" class="screen active">
      <div class="screen-header">
        <h1>Your score</h1>
      </div>

      <div class="score-circle" style="--pct:${score}">
        <div class="score-number">${score}</div>
      </div>
      <div class="score-label">out of 100</div>
      <div class="score-tag">${tag}</div>

      <div class="feedback-box">${escapeHtml(feedback)}</div>

      <div class="btn-row" style="margin-top:auto; padding-top:16px;">
        <button class="btn btn-outline" id="score-home-btn">🏠 Home</button>
        <button class="btn btn-primary" id="score-next-btn">Next article ›</button>
      </div>
    </div>
  `;

  document.getElementById('score-home-btn').addEventListener('click', () => Router.go('home'));

  document.getElementById('score-next-btn').addEventListener('click', async () => {
    const data = await API.articles.current();
    const current = Array.isArray(data) ? data : (data.current || []);
    const next = current.find(a => a && !['done', 'rejected', 'scored'].includes(a.status) && a.id !== articleId);
    if (next) {
      Router.go('article', { id: next.id });
    } else {
      showToast('No more articles available.');
      Router.go('home');
    }
  });
}
