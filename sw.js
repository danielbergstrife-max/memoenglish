const CACHE_NAME = 'memoenglish-v3.0.7';

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
    caches.open(CACHE_NAME).then(async cache => {
      for (const url of urlsToCache) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('Recurso secundário não pôde ser pré-cacheado:', url);
        }
      }
    })
  );
});

// Limpa caches antigos quando atualizar o Service Worker e notifica o app
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
      .then(() => {
        // Notifica todas as janelas e o app instalado para recarregar automaticamente
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          clients.forEach(client => {
            client.postMessage({ action: 'RELOAD_NEW_VERSION', version: CACHE_NAME });
          });
        });
      })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Não intercepta chamadas para APIs externas ou CDNs
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Navegação e páginas HTML: Network-First
  // Garante que o aplicativo instalado sempre carregue o HTML mais novo quando online
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }) || caches.match('./index.html') || caches.match('./'))
    );
    return;
  }

  // 2. Scripts e Estilos (JS/CSS): Network-First
  // Faz com que novas versões (v3.0.0) sejam baixadas imediatamente pelo app instalado
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // 3. Imagens e recursos estáticos: Cache-First
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => {
        return cached || fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        });
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
