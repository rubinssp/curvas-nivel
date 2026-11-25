// Guarda o app no aparelho. Imagem de satélite e altitudes sempre vêm da internet.
const CACHE = 'curvas-nivel-v2';
const APP = ['./', 'index.html', 'curvas.js', 'manifest.webmanifest', 'icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const ehApp = url.origin === location.origin || url.hostname === 'unpkg.com';
  if (!ehApp) return; // tiles: direto da rede
  // rede primeiro (pega atualizações), cache se estiver sem internet
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request)));
});
