/* eslint-disable no-undef */
/**
 * Service Worker —— 仅做静态资源缓存。
 *
 * 明确不做的事情（对应架构文档 D6 / PL-13）：
 * - 不实现 Web Push（需要服务端，本版本是纯前端）；
 * - 不做后台常驻调度（浏览器会终止 SW，主动消息由页面内 scheduler + Worker 心跳负责）；
 * - 不缓存任何 LLM 请求（用户自备 Key，绝不落缓存）。
 */
const CACHE_NAME = 'ai-ai-web-v1';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // 单个资源失败不应让整个安装失败
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET；非 GET（LLM 请求都是 POST）直接放过
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域资源不劫持（避免踩 CORS 与隐私红线）
  if (url.origin !== self.location.origin) return;
  // 导航请求走网络优先，保证拿到最新的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // 带 hash 的构建产物（/assets/xxx.[hash].js）用缓存优先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      }),
    );
    return;
  }

  // 其它同源静态资源：网络优先 + 失败回缓存
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
