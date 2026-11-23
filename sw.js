/**
 * Kinetix Lab — Service Worker (sw.js)
 * Architecture offline-first pour GitHub Pages & sous-sol de salle de sport.
 * - App Shell precache (tolérant aux modules progressifs)
 * - Cache-First progressif pour images free-exercise-db & calques SVG wger
 * - Cache-First pour polices Google Fonts
 * - Stale-While-Revalidate pour dépendances CDN épinglées
 * - Network-Only strict pour tous les endpoints IA, GitHub API et ntfy.sh
 */

const SHELL_CACHE = 'kinetix-shell-v1.5.0';
const MEDIA_CACHE = 'kinetix-exercise-media-v2';
const FONTS_CACHE = 'kinetix-fonts-v1';
const CDN_CACHE = 'kinetix-cdn-v1';

const MAX_MEDIA_ENTRIES = 320;
const MAX_CDN_ENTRIES = 60;

const CORE_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/db.js',
  './js/ai-router.js',
];

const OPTIONAL_MODULE_ASSETS = [
  './js/exercises-db.js',
  './js/biomechanics-engine.js',
  './js/physique-lab.js',
  './js/nutrition-db.js',
  './js/nutrition-advisor.js',
  './js/coach-actions.js',
  './js/timer.js',
  './js/p2p-share.js',
  './js/ui.js',
];

const NETWORK_ONLY_HOSTS = [
  'localhost',
  '127.0.0.1',
  'api.openai.com',
  'api.groq.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'api.github.com',
  'ntfy.sh',
  'text.pollinations.ai',
  'api.puter.com',
  'world.openfoodfacts.org',
];

function isExerciseMediaRequest(url) {
  const href = url.href;
  return (
    href.includes('free-exercise-db') ||
    href.includes('wger.de/static/images/muscles') ||
    href.includes('wger-project/wger') ||
    (url.pathname.endsWith('.svg') && href.includes('muscles'))
  );
}

function isFontRequest(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function isPinnedCdnRequest(url) {
  return (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'unpkg.com' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'esm.run' ||
    url.hostname === 'js.puter.com'
  );
}

function isNetworkOnlyRequest(url) {
  if (url.origin === self.location.origin) {
    return false;
  }
  return NETWORK_ONLY_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith('.' + host)
  );
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function precacheResilient(cache, urls) {
  const results = await Promise.allSettled(
    urls.map(async (assetUrl) => {
      const request = new Request(assetUrl, { cache: 'reload' });
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(assetUrl, response.clone());
      }
    })
  );
  return results;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await precacheResilient(cache, CORE_SHELL_ASSETS);
      await precacheResilient(cache, OPTIONAL_MODULE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  const activeCaches = new Set([SHELL_CACHE, MEDIA_CACHE, FONTS_CACHE, CDN_CACHE]);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !activeCaches.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Endpoints dynamiques IA / API externes : réseau uniquement
  if (isNetworkOnlyRequest(url)) {
    return;
  }

  // 2. Images free-exercise-db & calques SVG anatomiques wger : Cache-First progressif
  if (isExerciseMediaRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
            trimCache(MEDIA_CACHE, MAX_MEDIA_ENTRIES);
          }
          return networkResponse;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline Media Unavailable' });
        }
      })()
    );
    return;
  }

  // 3. Polices Google Fonts : Cache-First longue durée
  if (isFontRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FONTS_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline Fonts Unavailable' });
        }
      })()
    );
    return;
  }

  // 4. Bibliothèques CDN (Chart.js, LZ-String, MediaPipe, html5-qrcode) : Stale-While-Revalidate
  if (isPinnedCdnRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CDN_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && (response.ok || response.type === 'opaque')) {
              cache.put(request, response.clone());
              trimCache(CDN_CACHE, MAX_CDN_ENTRIES);
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        const fresh = await networkPromise;
        return fresh || new Response('', { status: 504, statusText: 'Offline CDN Unavailable' });
      })()
    );
    return;
  }

  // 5. Navigation HTML : Network-First avec repli App Shell (préserve les query params ?sync_weight=...)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('./index.html', fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('Hors ligne — rechargez une fois connecté.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  // 6. Assets locaux (same-origin) : Stale-While-Revalidate rapide
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        const fresh = await networkPromise;
        return fresh || new Response('', { status: 504, statusText: 'Offline Asset Unavailable' });
      })()
    );
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CLEAR_MEDIA_CACHE') {
    event.waitUntil(
      (async () => {
        await caches.delete(MEDIA_CACHE);
        event.ports?.[0]?.postMessage({ cleared: true });
      })()
    );
    return;
  }

  if (data.type === 'CACHE_STATUS') {
    event.waitUntil(
      (async () => {
        const [shell, media, fonts, cdn] = await Promise.all([
          caches.open(SHELL_CACHE).then((c) => c.keys()),
          caches.open(MEDIA_CACHE).then((c) => c.keys()),
          caches.open(FONTS_CACHE).then((c) => c.keys()),
          caches.open(CDN_CACHE).then((c) => c.keys()),
        ]);
        event.ports?.[0]?.postMessage({
          version: SHELL_CACHE,
          shellCount: shell.length,
          mediaCount: media.length,
          fontsCount: fonts.length,
          cdnCount: cdn.length,
        });
      })()
    );
  }
});
