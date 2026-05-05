// MemoEnglish Service Worker
const CACHE_NAME = 'memoenglish-v1';

// Recursos essenciais para funcionarem offline
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './phonetics.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Retorna do cache se encontrar, senão busca na rede
        return response || fetch(event.request);
      })
  );
});

// Limpa caches antigos quando atualizar o Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'background-check') {
    event.waitUntil(doBackgroundCheck());
  }
});

function doBackgroundCheck() {
  return self.registration.showNotification('MemoEnglish', {
    body: 'Verifique suas revisões pendentes!',
    icon: './icon-192.png',
    tag: 'memoenglish-background'
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
