// 설치용 서비스 워커. 이 게임 폴더(/gakseong/) 안에서만 동작하고, 캐시를 쓰지 않아 업데이트가 바로 반영된다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request)); });
