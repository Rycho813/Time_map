/**
 * 文件作用：Service Worker（网页离线缓存服务）。第一次联网访问时缓存整套程序；
 * 以后即使断网，也能从手机缓存里打开网页并操作本地记录。
 * 当修改了发布代码时，建议把 CACHE_NAME 的 v1 改成 v2、v3…以方便更新。
 */

const CACHE_NAME = 'time-map-shell-v1.2-place-duration-1';
const FILES = [
  './', './index.html', './styles.css', './js/app.js', './js/time.js',
  './js/storage.js', './js/log-export.js', './js/sync.js', './js/range-ui.js', './js/connection-vault.js', './manifest.webmanifest', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('time-map-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname.includes('/v1/')) return;
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      // 在线：请求最新版本，同时刷新离线缓存；离线：改用此前缓存。
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }
  })());
});
