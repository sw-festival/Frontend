// public/sw.js
const CACHE = 'swbooth-static-v2'; // 버전업으로 새 캐시 사용
const ASSET_GLOBS = [
  '/order-system/css/',
  '/order-system/js/',
  '/order-system/images/',
  '/order-system/img/',
  '/icons/',
  '/_next/static/',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isAsset = ASSET_GLOBS.some(p => url.pathname.startsWith(p));

  if (isAsset) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(hit =>
          hit || fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
        )
      )
    );
  } else {
    // HTML/API는 항상 네트워크 우선
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  }
});
