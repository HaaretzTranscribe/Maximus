const CACHE = 'maximus-v3';
const SHELL = [
  '/',
  '/static/css/style.css',
  '/static/js/api.js',
  '/static/js/router.js',
  '/static/js/app.js',
  '/static/js/screens/home.js',
  '/static/js/screens/article.js',
  '/static/js/screens/debate.js',
  '/static/js/screens/score.js',
  '/static/js/screens/stats.js',
  '/static/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API calls: network only
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
