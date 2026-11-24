/**
 * Service Worker: 主页内容临时缓存策略
 * 1. 当用户打开网站时，主页内容自动临时缓存
 * 2. 从机场详情页返回主页时，优先从缓存提供，不重新拉取远端内容
 * 3. 只有用户主动刷新主页时（reload），才重新从远端获取最新内容并更新缓存
 */

const CACHE_NAME = 'paolu-home-cache-v1';

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
    // 检测是否为用户主动刷新（按 F5、浏览器刷新按钮、下拉刷新等）
    const isReload =
      request.cache === 'reload' ||
      request.headers.get('cache-control') === 'no-cache';

    if (isReload) {
      // 用户主动刷新主页：重新拉取远端内容并刷新临时缓存
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
    } else {
      // 从详情页返回主页或普通站内跳转：优先使用临时缓存，不重新拉取远端内容
      event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
          return cache.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // 首次访问未命中缓存：拉取远端内容并存入临时缓存
            return fetch(request).then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            });
          });
        })
      );
    }
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
