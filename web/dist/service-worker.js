// Install support without caching game binaries or licensed player files.
// Every launch fetches the current deployment, including its security headers.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
