// ============================================================
// Service Worker：静态资源离线缓存
// 数据请求(API)走 network-first，由 app.js 的 localStorage 缓存兜底
// ============================================================
const CACHE = 'sup-sz-static-v1';

// 应用外壳静态资源（同源，必须缓存成功）
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/logic.js',
  './js/ui.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 跨域 CDN 资源（尽力缓存，取不到不阻塞安装）
// 注意：jsdelivr 国内可达性不稳定，故不放进原子的 addAll，
//       否则一旦取不到会导致整个 SW 安装失败、离线能力全废。
const CDN = [
  'https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css',
  'https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // 同源资源：原子缓存，任一失败则安装失败（本地文件保证存在）
      await c.addAll(SHELL);
      // CDN 资源：逐个尽力缓存，失败静默忽略，不影响安装
      await Promise.all(
        CDN.map((u) =>
          fetch(u, { mode: 'no-cors' })
            .then((res) => c.put(u, res))
            .catch(() => {})
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // API 数据请求：network-first，不进 SW 缓存（由 app.js 负责数据缓存）
  if (
    url.includes('open-meteo.com') ||
    url.includes('qweatherapi.com')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // 静态资源：cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        // 顺手缓存新的同源静态资源
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
