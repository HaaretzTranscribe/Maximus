async function showStats() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-stats" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="stats-back">‹</button>
        <h1>Statistiche</h1>
      </div>

      <div class="date-filters">
        <label>Da</label>
        <input type="date" id="filter-from">
        <label>A</label>
        <input type="date" id="filter-to">
        <button class="btn btn-outline" id="filter-apply" style="padding:6px 12px;font-size:0.8rem;">Filtra</button>
      </div>

      <div class="stats-section">
        <h3>Punteggi nel tempo</h3>
        <div class="chart-container">
          <canvas id="score-chart"></canvas>
        </div>
      </div>

      <div class="stats-section">
        <h3>Media per sezione</h3>
        <div id="section-avgs"></div>
      </div>

      <div class="stats-section">
        <h3>Errori ricorrenti</h3>
        <div id="error-patterns"><span class="text-dim">Caricamento…</span></div>
      </div>
    </div>
  `;

  document.getElementById('stats-back').addEventListener('click', () => Router.go('home'));
  document.getElementById('filter-apply').addEventListener('click', loadStats);

  let chart = null;

  async function loadStats() {
    const from = document.getElementById('filter-from').value || null;
    const to   = document.getElementById('filter-to').value || null;

    let data;
    try {
      data = await API.stats.get(from, to);
    } catch {
      showToast('Errore nel caricamento delle statistiche.');
      return;
    }

    // Line chart
    const scores = data.scores_over_time || [];
    const labels = scores.map(s => {
      const d = new Date(s.date);
      return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    });
    const values = scores.map(s => s.score);

    const ctx = document.getElementById('score-chart').getContext('2d');
    if (chart) chart.destroy();

    if (typeof Chart === 'undefined') {
      // Load Chart.js on demand
      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js');
    }

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Punteggio',
          data: values,
          borderColor: '#e94560',
          backgroundColor: 'rgba(233,69,96,0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#e94560',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 100, ticks: { color: '#888' }, grid: { color: '#2a2a4a' } },
          x: { ticks: { color: '#888' }, grid: { color: '#2a2a4a' } },
        },
        plugins: { legend: { display: false } },
      },
    });

    // Section averages
    const avgs = data.averages_by_section || {};
    const LABELS = { mondo: 'Mondo', italia: 'Italia', sport: 'Sport', scienza: 'Scienza / Tecnologia / Cultura' };
    const avgsEl = document.getElementById('section-avgs');
    const entries = Object.entries(avgs);
    avgsEl.innerHTML = entries.length === 0
      ? '<span class="text-dim">Nessun dato.</span>'
      : entries.map(([slot, avg]) => `
          <div class="section-avg-row">
            <span>${LABELS[slot] || slot}</span>
            <span class="section-avg-score">${avg} / 100</span>
          </div>
        `).join('');

    // Error patterns
    const patterns = data.error_patterns || [];
    const patternsEl = document.getElementById('error-patterns');
    patternsEl.innerHTML = patterns.length === 0
      ? '<span class="text-dim">Nessun pattern rilevato ancora.</span>'
      : patterns.map(p => `<div class="error-pattern-item">${escapeHtml(p)}</div>`).join('');
  }

  loadStats();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
