// Minimaler Service Worker — nur fuer die Installierbarkeit (PWA "App installieren").
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
