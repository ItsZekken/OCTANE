/**
 * OCTANE // KINETIC — Progressive Web App Service Worker
 * Stale-While-Revalidate caching for static shell & assets.
 * Transparent pass-through for Firebase Auth & Cloud Firestore requests.
 */

const CACHE_NAME = 'octane-v1.0.8';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg'
];

// URLs to completely bypass (Firebase Auth, Cloud Firestore, Google APIs, IOPGPS)
const BYPASS_DOMAINS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'apis.google.com',
  'firebaseinstallations.googleapis.com',
  'proxy.scalar.com',
  'iopgps.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass non-GET requests or IOPGPS proxy API routes
  if (event.request.method !== 'GET' || url.pathname.startsWith('/iopgps-api/')) {
    return;
  }

  // Bypass Firebase / Google APIs
  if (BYPASS_DOMAINS.some(domain => url.hostname.includes(domain))) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached index.html (SPA architecture)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // Static Assets & Media: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'octane:suggest-refuel',
            action: 'suggest-refuel',
            initialOdo: data.initialOdo,
            defaultFull: data.defaultFull !== undefined ? data.defaultFull : true,
            data
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
