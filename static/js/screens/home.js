function renderHome() {
  return `
    <div id="screen-home" class="screen active">
      <div class="app-logo">
        <div class="logo-icon">🏛️</div>
        <h1>Maximus</h1>
        <span class="app-version">v1.3</span>
        <button id="home-refresh-btn" class="refresh-btn" title="Refresh">↺</button>
      </div>

      <div id="install-hint" class="install-hint hidden">
        Tap Share → "Add to Home Screen" to install the app.
      </div>

      <button id="home-fetch-btn" class="btn btn-primary btn-full" style="margin-bottom:20px;">
        ⬇ Fetch new articles
      </button>

      <div id="article-cards"></div>

      <div class="mt-auto" style="padding-top:16px;">
        <button id="home-stats-btn" class="btn btn-outline btn-full">📊 My stats</button>
      </div>
    </div>
  `;
}

function initHome(data) {
  // Accept both old array format and new { current, past } format
  const articles = Array.isArray(data) ? data : (data.current || []);
  const pastArticles = Array.isArray(data) ? [] : (data.past || []);

  const SECTION_LABELS = {
    mondo: 'World', italia: 'Italy', sport: 'Sport',
    scienza: 'Science', tecnologia: 'Technology', cultura: 'Culture',
  };

  const container = document.getElementById('article-cards');

  // Wire up buttons regardless of article state
  document.getElementById('home-refresh-btn').addEventListener('click', () => location.reload());

  document.getElementById('home-fetch-btn').addEventListener('click', async () => {
    const btn = document.getElementById('home-fetch-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Fetching…';
    try {
      const data = await API.articles.fetch();
      if (data.message) {
        showToast(data.message);
        initHome(await API.articles.current());
      } else {
        initHome(data);
      }
    } catch (e) {
      showToast('Error fetching articles. Try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⬇ Fetch new articles';
    }
  });


  document.getElementById('home-stats-btn').addEventListener('click', () => Router.go('stats'));

  if (!articles || articles.length === 0 || articles.every(a => a === null)) {
    container.innerHTML = `
      <div class="card-placeholder">No articles yet — tap Fetch to get started.</div>
      <div class="card-placeholder">World slot empty</div>
      <div class="card-placeholder">Italy slot empty</div>
      <div class="card-placeholder">Sport slot empty</div>
    `;
    document.getElementById('install-hint').classList.remove('hidden');
    return;
  }

  container.innerHTML = articles.map(article => {
    if (!article) {
      return `<div class="card-placeholder">Slot empty — tap Fetch new articles.</div>`;
    }
    const section = SECTION_LABELS[article.section] || article.section;
    const date = article.published_at
      ? new Date(article.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '';
    const statusLabel = {
      not_started: 'Not started',
      in_progress:  'In progress',
      scored:       `Scored`,
      done:         'Done',
      rejected:     'Rejected',
    }[article.status] || article.status;

    return `
      <div class="card" data-id="${article.id}" data-status="${article.status}">
        <div class="card-section">${section}</div>
        <div class="card-title">${article.title}</div>
        <div class="card-meta">
          <span>${date}</span>
          <span>${article.word_count} words</span>
          <span class="badge badge-${article.status}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      Router.go('article', { id: card.dataset.id });
    });
  });

  if (pastArticles.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'past-divider';
    divider.textContent = 'Past articles';
    container.appendChild(divider);

    pastArticles.forEach(article => {
      const section = SECTION_LABELS[article.section] || article.section;
      const date = article.published_at
        ? new Date(article.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : '';
      const statusLabel = { scored: `Scored`, done: 'Done' }[article.status] || article.status;
      const el = document.createElement('div');
      el.className = 'card card-past';
      el.dataset.id = article.id;
      el.innerHTML = `
        <div class="card-section">${section}</div>
        <div class="card-title">${article.title}</div>
        <div class="card-meta">
          <span>${date}</span>
          <span>${article.word_count} words</span>
          <span class="badge badge-${article.status}">${statusLabel}</span>
        </div>
      `;
      el.addEventListener('click', () => Router.go('article', { id: article.id }));
      container.appendChild(el);
    });
  }
}
