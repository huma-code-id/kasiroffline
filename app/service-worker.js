// Service worker: cache-first untuk app shell, supaya PWA benar-benar bisa jalan offline
// setelah pertama kali dibuka online. Request POST (sinkronisasi ke GAS) sengaja TIDAK
// di-intercept sama sekali, jadi selalu langsung ke network (tidak relevan di-cache & tidak
// boleh diam-diam gagal karena cache).

const CACHE_NAME = 'kasir-offline-v1';

const APP_SHELL = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/config.js',
    './js/crypto.js',
    './js/db.js',
    './js/printer.js',
    './js/receipt.js',
    './js/sync.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Biarkan request non-GET (POST sync ke GAS) lewat langsung tanpa campur tangan.
    if (request.method !== 'GET') return;

    event.respondWith(
        caches.match(request).then((cached) => {
            const networkFetch = fetch(request)
                .then((response) => {
                    if (response && (response.ok || response.type === 'opaque')) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);

            // App shell: cache-first (cepat & tetap jalan offline).
            // Aset lain (mis. CDN Vue saat pertama kali online): network-first, fallback ke cache.
            return cached || networkFetch;
        })
    );
});
