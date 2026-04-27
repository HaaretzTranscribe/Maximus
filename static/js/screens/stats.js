async function showStats() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="screen-stats" class="screen active">
      <div class="screen-header">
        <button class="back-btn" id="stats-back">‹ Back</button>
        <h1>My Stats</h1>
      </div>

      <div class="cefr-setting">
        <label class="cefr-label">Debate level</label>
        <div class="cefr-options" id="cefr-options">
          ${['A1','A2','B1','B2','C1','C2'].map(l =>
            `<button class="cefr-btn${(localStorage.getItem('maximus_cefr_level')||'B2')===l?' active':''}" data-level="${l}">${l}</button>`
          ).join('')}
        </div>
        <span class="cefr-hint">Debates are scored against this CEFR target</span>
      </div>

      <div class="date-filters">
        <label>From</label>
        <input type="date" id="filter-from">
        <label>To</label>
        <input type="date" id="filter-to">
        <button class="btn btn-outline" id="filter-apply" style="padding:8px 14px;font-size:0.82rem;">Filter</button>
      </div>

      <div id="stats-totals" class="stats-totals"></div>

      <div class="stats-section">
        <h3>Score over time</h3>
        <div class="chart-container">
          <canvas id="score-chart"></canvas>
        </div>
      </div>

      <div class="stats-section">
        <h3>Average by section</h3>
        <div id="section-avgs"></div>
      </div>

      <div class="stats-section">
        <h3>Recurring errors</h3>
        <div id="error-patterns"><span class="text-dim">Loading…</span></div>
      </div>
    </div>
  `;

  document.getElementById('stats-back').addEventListener('click', () => Router.go('home'));
  document.getElementById('filter-apply').addEventListener('click', loadStats);

  document.getElementById('cefr-options').addEventListener('click', e => {
    const btn = e.target.closest('.cefr-btn');
    if (!btn) return;
    localStorage.setItem('maximus_cefr_level', btn.dataset.level);
    document.querySelectorAll('.cefr-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  let chart = null;

  async function loadStats() {
    const from = document.getElementById('filter-from').value || null;
    const to   = document.getElementById('filter-to').value || null;
    let data;
    try {
      data = await API.stats.get(from, to);
    } catch {
      showToast('Error loading stats.');
      return;
    }

    document.getElementById('stats-totals').innerHTML = `
      <div class="stats-total-row">
        <div class="stats-total-pill">${data.articles_finished ?? 0}<span>articles finished</span></div>
        <div class="stats-total-pill">${data.debates_scored ?? 0}<span>debates scored</span></div>
      </div>
    `;

    const scores = data.scores_over_time || [];
    const labels = scores.map(s => new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const values = scores.map(s => s.score);

    const ctx = document.getElementById('score-chart').getContext('2d');
    if (chart) chart.destroy();

    if (typeof Chart === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js');
    }

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Score',
          data: values,
          borderColor: '#58CC02',
          backgroundColor: 'rgba(88,204,2,0.1)',
          tension: 0.35,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: '#58CC02',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 100, ticks: { color: '#777', font: { family: 'Nunito', weight: '700' } }, grid: { color: '#E5E5E5' } },
          x: { ticks: { color: '#777', font: { family: 'Nunito', weight: '700' } }, grid: { color: '#E5E5E5' } },
        },
        plugins: { legend: { display: false } },
      },
    });

    const LABELS = { mondo: 'World', italia: 'Italy', sport: 'Sport', scienza: 'Science / Tech / Culture' };
    const avgs = data.averages_by_section || {};
    const avgsEl = document.getElementById('section-avgs');
    const entries = Object.entries(avgs);
    avgsEl.innerHTML = entries.length === 0
      ? '<span class="text-dim">No data yet.</span>'
      : entries.map(([slot, avg]) => `
          <div class="section-avg-row">
            <span>${LABELS[slot] || slot}</span>
            <span class="section-avg-score">${avg} / 100</span>
          </div>
        `).join('');

    const patterns = data.error_patterns || [];
    const patternsEl = document.getElementById('error-patterns');
    patternsEl.innerHTML = patterns.length === 0
      ? '<span class="text-dim">No patterns detected yet.</span>'
      : patterns.map(p => `<div class="error-pattern-item">${escapeHtml(p)}</div>`).join('');
  }

  loadStats();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
