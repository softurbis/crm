// Service worker del panel: está SOLO para que el celular lo pueda instalar como app.
// No guarda nada en caché a propósito: cada push a main es un deploy, y una copia
// vieja guardada en el celular mostraría un panel desactualizado (o roto contra la
// base nueva). Todo sigue yendo a la red, igual que en el navegador.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
