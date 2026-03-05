const CACHE_NAME = 'attendance-pro-v4'; // Bumped to v4 to force phones to update
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
        console.log('Opened cache v4');
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

// --- 4. PUSH NOTIFICATION LISTENER ---
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    const title = data.title || "Attendance Update";
    const options = {
        body: data.body || "There has been a change in your attendance.",
        icon: '/icon.png', 
        badge: '/icon.png',
        vibrate: [200, 100, 200, 100, 200], 
        // Read the target URL from the server (defaults to /#notifications)
        data: { url: data.url || '/#notifications' } 
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// --- 5. NOTIFICATION TAP HANDLER (Smart Redirect) ---
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Get the destination URL from the push payload
    const targetUrl = event.notification.data.url;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // If the app is already open in a tab, hijack it and send it to the notification page
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    client.navigate(targetUrl); // Force the app to the specific page
                    return client.focus();
                }
            }
            // Otherwise, open a brand new window straight to the notifications page
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});