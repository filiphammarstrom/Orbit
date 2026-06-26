self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Network-first by default. The service worker exists so Orbit can be
  // installed as a share target without adding stale-cache behavior yet.
});
