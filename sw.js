const CACHE_NAME = 'maison-eternite-v46';
const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './admin.html'
];
const MAX_CACHE_ENTRIES = 80;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

function trimCache() {
    caches.open(CACHE_NAME).then((cache) =>
        cache.keys().then((keys) => {
            if (keys.length <= MAX_CACHE_ENTRIES) return;
            Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map((k) => cache.delete(k)));
        })
    );
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never intercept cross-origin traffic or API/storage calls.
    // External assets (fonts, images) use their own browser cache;
    // Supabase data must always be fresh from the network.
    if (url.origin !== self.location.origin) return;

    // Network-first for navigation, fall back to cache (offline support)
    if (request.mode === 'navigate') {
        if (url.pathname.includes('admin.html')) {
            event.respondWith(fetch(request));
            return;
        }
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true }))
        );
        return;
    }

    // Cache-first for same-origin static assets
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, copy);
                            trimCache();
                        });
                    }
                    return response;
                })
                .catch(() => cached);
        })
    );
});
