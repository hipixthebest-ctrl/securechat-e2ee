const CACHE_NAME = 'whisper-v1';
const OFFLINE_URL = '/index.html';

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/crypto.js',
    '/webrtc.js',
    '/pwa.js',
    '/manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                return self.skipWaiting();
            })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and socket.io
    if (event.request.method !== 'GET' || 
        event.request.url.includes('socket.io')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // Return cached response immediately
                    // Then update cache in background
                    const fetchPromise = fetch(event.request).then(
                        (networkResponse) => {
                            if (networkResponse && networkResponse.status === 200) {
                                const responseClone = networkResponse.clone();
                                caches.open(CACHE_NAME).then((cache) => {
                                    cache.put(event.request, responseClone);
                                });
                            }
                            return networkResponse;
                        }
                    ).catch(() => {
                        // Network failed, cached response already returned
                    });

                    return cachedResponse;
                }

                // Not in cache, fetch from network
                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200) {
                            return response;
                        }

                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });

                        return response;
                    })
                    .catch(() => {
                        // Both cache and network failed
                        if (event.request.mode === 'navigate') {
                            return caches.match(OFFLINE_URL);
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});

// Handle push notifications
self.addEventListener('push', (event) => {
    let data = {};
    
    if (event.data) {
        data = event.data.json();
    }

    const options = {
        body: data.body || 'New message',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/',
            ...data
        },
        actions: [
            {
                action: 'reply',
                title: 'Reply',
                icon: '/icons/icon-72.png'
            },
            {
                action: 'open',
                title: 'Open',
                icon: '/icons/icon-72.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Whisper Messenger',
            options
        )
    );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'reply') {
        // Focus on the app
        event.waitUntil(
            self.clients.matchAll({ type: 'window' })
                .then((clientList) => {
                    const url = event.notification.data.url || '/';
                    for (const client of clientList) {
                        if (client.url.includes(url) && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    if (self.clients.openWindow) {
                        return self.clients.openWindow(url);
                    }
                })
        );
    } else {
        event.waitUntil(
            self.clients.matchAll({ type: 'window' })
                .then((clientList) => {
                    for (const client of clientList) {
                        if ('focus' in client) {
                            return client.focus();
                        }
                    }
                    if (self.clients.openWindow) {
                        return self.clients.openWindow('/');
                    }
                })
        );
    }
});

// Handle messages from the app
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
