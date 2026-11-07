const CACHE = 'localdrop-v9';
const FILES = ['./', 'index.html', 'app.js', 'signal.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png',
  'icon-192.png', 'icon-512.png', 'qrcode.js', 'jsQR.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (so updates arrive as soon as there is internet), falling back to the cache when offline.
// The 2.5 s cap keeps the app quick on a hotspot that has no internet.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const fresh = fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  });
  fresh.catch(() => {});
  const timeout = new Promise((_, rej) => setTimeout(rej, 2500));
  e.respondWith(Promise.race([fresh, timeout]).catch(() => caches.match(e.request).then(r => r || fresh)));
});
