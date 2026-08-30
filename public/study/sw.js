const CACHE_PREFIX = 'sewon-study-shell';
const CACHE_NAME = `${CACHE_PREFIX}-v1`;
const APP_SHELL = [
  '/study/',
  '/study/manifest.webmanifest',
  '/favicon.png',
];

const API_PATH_PREFIXES = [
  '/auth/v1/',
  '/functions/v1/',
  '/graphql/v1',
  '/realtime/v1/',
  '/rest/v1/',
  '/storage/v1/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Authentication, database, storage, and function responses must never enter
  // the PWA cache. Supabase is normally cross-origin; the path guard also keeps
  // this safe if an API proxy is added on the portfolio domain later.
  if (
    url.origin !== self.location.origin
    || API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (['font', 'image', 'script', 'style'].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || caches.match('/study/');
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
