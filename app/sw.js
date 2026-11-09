// 앱 화면 파일을 기기에 저장해 두고(오프라인 동작), 백그라운드에서 새 버전을 받아옵니다.
const CACHE = 'wrongnote-v2';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/image.js',
  'js/shared.js',
  'js/clean-worker.js',
  'js/views/cleaner.js',
  'js/views/profiles.js',
  'js/views/list.js',
  'js/views/editor.js',
  'js/views/detail.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: 저장본을 먼저 보여주고, 뒤에서 최신 파일로 갱신
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // 화면(문서) 요청만 index.html로 대신 응답 (워커 스크립트 요청은 제외)
      const key = req.mode === 'navigate' && req.destination === 'document' ? 'index.html' : req;
      const cached = await cache.match(key);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
