function renderHome() {
  const SECTION_LABELS = {
    mondo: 'Mondo', italia: 'Italia', sport: 'Sport',
    scienza: 'Scienza', tecnologia: 'Tecnologia', cultura: 'Cultura',
  };
  const SLOT_ORDER = ['mondo', 'italia', 'sport', 'scienza'];

  return `
    <div id="screen-home" class="screen active">
      <div class="screen-header">
        <h1>Maximus</h1>
      </div>

      <div id="install-hint" class="install-hint hidden">
        Tocca Condividi → "Aggiungi a schermata Home" per installare l'app.
      </div>

      <button id="home-fetch-btn" class="btn btn-primary btn-full">
        ⬇ Recupera nuovi articoli
      </button>

      <div id="article-cards"></div>

      <div class="mt-auto" style="padding-top:16px;">
        <button id="home-stats-btn" class="btn btn-outline btn-full">📊 Statistiche</button>
      </div>
    </div>
  `;
}

function initHome(articles) {
  const SECTION_LABELS = {
    mondo: 'Mondo', italia: 'Italia', sport: 'Sport',
    scienza: 'Scienza', tecnologia: 'Tecnologia', cultura: 'Cultura',
  };

  const container = document.getElementById('article-cards');

  if (!articles || articles.every(a => a === null)) {
    container.innerHTML = `
      <div class="card-placeholder">
        Nessun articolo. Premi il pulsante qui sopra per recuperarli.
      </div>
    `.repeat(4);
    // Show install hint on first open
    document.getElementById('install-hint').classList.remove('hidden');
    return;
  }

  container.innerHTML = articles.map(article => {
    if (!article) {
      return `<div class="card-placeholder">Slot vuoto — premi Recupera nuovi articoli.</div>`;
    }
    const section = SECTION_LABELS[article.section] || article.section;
    const date = article.published_at
      ? new Date(article.published_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
      : '';
    const statusLabel = {
      not_started: 'Non iniziato',
      in_progress: 'In corso',
      scored: `Punteggio: ${article.score ?? '—'}`,
      done: 'Completato',
      rejected: 'Rifiutato',
    }[article.status] || article.status;

    return `
      <div class="card" data-id="${article.id}" data-status="${article.status}">
        <div class="card-section">${section}</div>
        <div class="card-title">${article.title}</div>
        <div class="card-meta">
          <span>${date}</span>
          <span>${article.word_count} parole</span>
          <span class="badge badge-${article.status}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  // Card click → article view
  container.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.dataset.status === 'done') return; // done = archived, read-only
      Router.go('article', { id: card.dataset.id });
    });
  });

  // Fetch button
  document.getElementById('home-fetch-btn').addEventListener('click', async () => {
    const btn = document.getElementById('home-fetch-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Recupero…';
    try {
      const data = await API.articles.fetch();
      if (data.message) {
        showToast(data.message);
        initHome(await API.articles.current());
      } else {
        initHome(data);
      }
    } catch (e) {
      showToast('Errore durante il recupero. Riprova.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⬇ Recupera nuovi articoli';
    }
  });

  document.getElementById('home-stats-btn').addEventListener('click', () => Router.go('stats'));
}
