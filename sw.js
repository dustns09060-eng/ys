const CACHE = 'yeowoobang-first-load-v402';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=402',
  './app.js?v=402',
  './config.json?v=402',
  './manifest.json?v=402',
  './favicon-v20.png?v=402',
  './icon-192-v20.png?v=402',
  './icon-512-v20.png?v=402',
  './app-logo-v20.png?v=402',
  './preview-v35.png?v=402'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(ASSETS.map((asset) => cache.add(asset)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('docs.google.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) return;

  // 문서 이동은 네트워크 우선, 실패 시 캐시된 메인 화면으로 복구합니다.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put('./index.html', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // 정적 파일은 네트워크 우선으로 최신 파일을 받고, 오프라인일 때만 캐시를 사용합니다.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
