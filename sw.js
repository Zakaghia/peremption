/* Service worker : met l'application en cache pour marcher sans internet.
   Les DONNÉES ne sont pas ici : elles sont dans IndexedDB. */
const CACHE = 'alerte-peremption-v2';
const FICHIERS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
// Bibliothèque du scanner (téléchargée une seule fois, puis gardée en cache)
const LIB_SCAN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHIERS).then(() => c.add(LIB_SCAN).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord, puis réseau (et on garde une copie à jour en arrière-plan)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  const aGarder = new URL(url).origin === self.location.origin || url === LIB_SCAN;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(enCache => {
      const reseau = fetch(e.request)
        .then(rep => {
          if (rep && rep.ok && aGarder) {
            const copie = rep.clone();
            caches.open(CACHE).then(c => c.put(e.request, copie));
          }
          return rep;
        })
        .catch(() => enCache || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
      return enCache || reseau;
    })
  );
});
