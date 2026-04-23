const Router = {
  current: null,
  params: {},

  go(screen, params = {}) {
    this.current = screen;
    this.params = params;
    this._render(screen, params);
  },

  async _render(screen, params) {
    const app = document.getElementById('app');

    switch (screen) {
      case 'home': {
        app.innerHTML = renderHome();
        const articles = await API.articles.current().catch(() => []);
        initHome(articles);
        break;
      }
      case 'article': {
        await showArticle(params.id);
        break;
      }
      case 'debate': {
        await showDebate(params.id, params.article || null);
        break;
      }
      case 'score': {
        showScore(params);
        break;
      }
      case 'stats': {
        await showStats();
        break;
      }
    }
  },
};
