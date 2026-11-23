/* BCG GIS — PWA Service Worker (v19) */
const CACHE_NAME = "bcg-gis-pwa-v19";

self.addEventListener("install", event => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    // Yalnız eyni mənşəli (local) statik fayllar üçün: xəritə kafelləri, peyk şəkilləri və Supabase API sorğularına mane olma
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (event.request.method !== "GET") return;
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
