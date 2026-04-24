const CACHE_NAME = 'mc-stocks-v30';
const STATIC_EXTENSIONS = [
  '.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        '/',
        '/index.html',
        '/css/style.css',
        '/js/app.js',
        '/js/montecarlo.js',
        '/js/charts.js',
        '/js/sentiment.js',
        '/manifest.json'
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Interceptează DOAR fișiere locale statice
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1) Ignoră complet requesturile către domenii externe
  if (url.origin !== self.location.origin) {
    return; // nu interceptăm deloc
  }

  // 2) Interceptează DOAR fișiere statice
  if (!STATIC_EXTENSIONS.some(ext => url.pathname.endsWith(ext))) {
    return; // nu e fișier static → nu interceptăm
  }

  // 3) Cache-first pentru fișiere locale
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});
