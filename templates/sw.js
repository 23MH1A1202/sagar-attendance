const CACHE_NAME = 'attendance-pro-v3'; // Bumped to v3 to force phones to update
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache v3');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. Activate Service Worker & Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
  
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 3. Fetch (Network-First Strategy for HTML)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// --- 4. NEW: PUSH NOTIFICATION LISTENER ---
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    const title = data.title || "Attendance Update";
    const options = {
        body: data.body || "There has been a change in your attendance.",
        icon: '/icon.png', // Uses your app's icon
        badge: '/icon.png',
        vibrate: [200, 100, 200, 100, 200], // Cool vibration pattern
        data: { url: '/' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// --- 5. NEW: NOTIFICATION TAP HANDLER ---
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // If the app is already open in a tab, just focus it
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url.indexOf('/') !== -1 && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise, open a new window
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});