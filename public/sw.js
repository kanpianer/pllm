/**
 * Service Worker: 主页内容缓存策略
 * 1. 优先从网络获取最新页面，网络异常或离线时才回退至缓存
 * 2. 避免客户端长久缓存旧样式与旧版本内容
 */

const CACHE_NAME = 'paolu-home-cache-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只拦截同源的主页 HTML 导航请求（"/" 或 "/index.html"）
  const isHomePage =
    url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname === '/index.html');

  if (request.mode === 'navigate' && isHomePage) {
    // Network First: 优先从网络拉取最新内容，拉取成功则更新缓存；若网络离线则使用缓存兜底
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, resClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
  }
});

// 监听客户端消息，如主动刷新时清空或更新缓存
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REFRESH_HOME') {
    caches.open(CACHE_NAME).then((cache) => {
      fetch('/').then((res) => {
        if (res && res.status === 200) {
          cache.put('/', res);
        }
      }).catch(() => {});
    });
  }
});
