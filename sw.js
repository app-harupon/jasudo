const CACHE_NAME = 'pon-todo-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/store.js',
  './js/ui.js',
  './js/matrix.js',
  './js/calendar.js',
  './js/timer.js',
  './js/tutorial.js',
  './js/app.js',
  './js/firebase-config.js',
  './js/sync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// メール連携(Firebase)のCDNスクリプト。失敗してもインストール全体は失敗させない
// (連携未設定の場合はそもそも使われないため)
const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(ASSETS).then(() =>
          Promise.all(CDN_ASSETS.map((url) => cache.add(url).catch(() => {})))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // ネットワーク優先(常に最新のコードを反映し、オフライン時のみキャッシュにフォールバック)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
