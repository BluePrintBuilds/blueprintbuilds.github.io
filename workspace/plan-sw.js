const CACHE = 'blueprint-plan-desk-shell-v3';
const SHELL = [
  '/workspace/plan/',
  '/workspace/core.js',
  '/workspace/offline.js',
  '/workspace/workspace.css',
  '/workspace/plan/plan.js',
  '/styles.css',
  '/assets/pdfjs/pdf.min.js',
  '/assets/pdfjs/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('blueprint-plan-desk-shell-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.pathname.startsWith('/workspace/plan/')) {
    event.respondWith(fetch(request).catch(() => caches.match('/workspace/plan/')));
    return;
  }

  if (!SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.pathname);
    const refresh = fetch(request).then((response) => {
      if (response.ok) cache.put(url.pathname, response.clone());
      return response;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    return (await refresh) || new Response('Offline', { status: 503 });
  })());
});
