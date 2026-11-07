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
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
