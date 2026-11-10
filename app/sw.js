// 앱 화면 파일을 기기에 저장해 두고(오프라인 동작), 백그라운드에서 새 버전을 받아옵니다.
const CACHE = 'wrongnote-v9';
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
  'js/views/subjects.js',
  'js/views/list.js',
  'js/views/editor.js',
  'js/views/detail.js',
  'js/views/inkpad.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  // AI 손글씨 지우기 (오프라인에서도 동작하도록 함께 저장, 약 15MB)
  'models/inkseg.onnx',
  'vendor/ort/ort.wasm.min.js',
  'vendor/ort/ort-wasm-simd-threaded.mjs',
  'vendor/ort/ort-wasm-simd-threaded.wasm',
];

// 버전이 고정된 큰 파일은 이전 저장본을 그대로 씀 (업데이트마다 11MB씩 다시 받지 않게)
const IMMUTABLE = ASSETS.filter((u) => u.startsWith('vendor/'));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      if (IMMUTABLE.includes(u)) {
        const old = await caches.match(u);
        if (old) { await cache.put(u, old); return; }
      }
      // cache: 'reload' → 브라우저에 남은 옛 파일 말고 서버의 새 파일을 받기
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${u} ${res.status}`);
      await cache.put(u, res);
    }));
    await self.skipWaiting();
  })());
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
      // no-cache: 서버에 바뀌었는지 물어보고 받기 (안 바뀌었으면 아주 짧은 응답)
      const network = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
