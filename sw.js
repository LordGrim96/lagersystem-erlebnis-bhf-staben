// Service Worker: speichert die App-Dateien auf dem Gerät, damit das Getränkelager
// auch ohne Internet startet. Die Lagerdaten selbst (Supabase) werden nie hier gespeichert –
// darum kümmert sich app.js (letzter Stand + Warteschlange).
const CACHE = 'getraenkelager-v8';
const APP_DATEIEN = [
  './', './index.html', './app.js', './style.css', './config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // 'reload': beim Update frische Dateien vom Server holen, nicht aus dem Browser-Cache
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(APP_DATEIEN.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const merken = (req, res) => {
  if (res.ok || res.type === 'opaque') {
    const kopie = res.clone();
    caches.open(CACHE).then((c) => c.put(req, kopie));
  }
  return res;
};

// Bei schlechtem Empfang nicht ewig warten, sondern nach ein paar Sekunden den gespeicherten Stand nehmen
const mitZeitlimit = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), ms)),
]);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // Daten immer live

  if (url.origin !== self.location.origin) {
    // Datenbank-Bibliothek und Schriften: aus dem Speicher, sonst laden und merken
    e.respondWith(caches.match(req).then((treffer) => treffer || fetch(req).then((res) => merken(req, res))));
    return;
  }

  // Eigene Dateien: zuerst aus dem Netz (damit Updates sofort ankommen), ohne Netz aus dem Speicher.
  // 'no-cache' fragt immer beim Server nach, ob es eine neue Version gibt (sonst bis zu 10 Min. alt).
  e.respondWith(
    mitZeitlimit(fetch(req, { cache: 'no-cache' }), 5000)
      .then((res) => merken(req, res))
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((treffer) => treffer || caches.match('./index.html'))),
  );
});
