// Service worker mínimo: permite instalar la app en el celular.
// No guarda datos en caché: la planificación siempre se lee y escribe en línea.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
