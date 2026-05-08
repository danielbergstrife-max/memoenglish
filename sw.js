const CACHE_NAME = 'memoenglish-v1.2.1';

// Recursos essenciais para funcionarem offline
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './phonetics.js',
  './manifest.json',
  './assets/logo.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Força o SW a se tornar ativo imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Limpa caches antigos quando atualizar o Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(), // Toma controle das abas abertas imediatamente
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Estratégia Network-First para o index.html e raiz
  // Isso garante que se estiver online, sempre pegue o HTML mais novo
  if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Estratégia Cache-First para o restante dos recursos
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
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
