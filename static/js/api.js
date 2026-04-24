// Central API client — all fetch calls go through here
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  articles: {
    current:     ()         => API.get('/api/articles/current'),
    fetch:       ()         => API.post('/api/articles/fetch', {}),
    get:         (id)       => API.get(`/api/articles/${id}`),
    setStatus:   (id, status) => API.post(`/api/articles/${id}/status`, { status }),
    ttsUrl:      (id)       => `/api/articles/${id}/tts`,
  },

  debate: {
    message:   (articleId, payload) => API.post(`/api/debate/${articleId}/message`, payload),
    end:       (articleId, payload) => API.post(`/api/debate/${articleId}/end`, payload),
    translate: (word)               => API.post('/api/debate/translate', { word }),
  },

  stats: {
    get: (from, to) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      return API.get(`/api/stats?${params}`);
    },
  },
};
