// Verse a Day service worker. Works under any sub-path: every URL is resolved
// against this worker's own scope.
//  - Shell: precached at install, served stale-while-revalidate.
//  - entries/index.json and every entries/*.json: cached (they are small),
//    stale-while-revalidate. New entries named by a fresh index are fetched
//    in the background so the day is available offline.
//  - Google Fonts: cached opportunistically so reading works offline.
//  - The pinned supabase-js module and what it imports (cdn.jsdelivr.net/npm/...):
//    cached on first load, cache-first, so a signed-in app still starts offline.
//  - Requests to the Supabase project (or any other origin) are never touched:
//    they fall straight through to the network.
// Bump VERSION whenever the shell files change.

const VERSION = 'v3';
const SHELL = `vad-shell-${VERSION}`;
const ENTRIES = `vad-entries-${VERSION}`;
const FONTS = `vad-fonts-${VERSION}`;
const LIB = `vad-lib-${VERSION}`;
const KEEP = [SHELL, ENTRIES, FONTS, LIB];

const scope = new URL('./', self.registration.scope);
const abs = (p) => new URL(p, scope).href;

const SHELL_FILES = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'icons/mark.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/main.js',
  'js/util.js',
  'js/storage.js',
  'js/icons.js',
  'js/prefs.js',
  'js/fonts.js',
  'js/dialogs.js',
  'js/store-entries.js',
  'js/store-journal.js',
  'js/view-piece.js',
  'js/view-journal.js',
  'js/view-archive.js',
  'js/view-month.js',
  'js/view-states.js',
  'js/lookup.js',
  'js/settings-ui.js',
  'js/config.js',
  'js/device.js',
  'js/remote.js',
  'js/sync.js',
  'js/sync-app.js',
  'js/sync-ui.js',
].map(abs);

const INDEX_URL = abs('entries/index.json');
const isEntry = (url) => url.href.startsWith(abs('entries/'));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(SHELL_FILES);
      try {
        // Best effort: prefetch every entry so the whole archive reads offline.
        const entries = await caches.open(ENTRIES);
        const res = await fetch(INDEX_URL, { cache: 'no-cache' });
        await entries.put(INDEX_URL, res.clone());
        await prefetchEntries(entries, await res.json());
      } catch {
        /* offline at install time is fine; entries cache as they are opened */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!KEEP.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function prefetchEntries(cache, rows) {
  if (!Array.isArray(rows)) return;
  await Promise.all(
    rows
      .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .map(async (r) => {
        const url = abs(`entries/${r.date}.json`);
        if (await cache.match(url)) return;
        try {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        } catch {
          /* skip */
        }
      }),
  );
}

async function notifyClients(msg) {
  for (const c of await self.clients.matchAll()) c.postMessage(msg);
}

async function staleWhileRevalidate(request, cacheName, { onFresh, ignoreSearch } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch });
  const network = fetch(request)
    .then(async (res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const old = cached && onFresh ? await cached.clone().text() : null;
        await cache.put(request, res.clone());
        if (onFresh) await onFresh(res.clone(), old, cache);
      }
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await network) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request); // a network failure rejects, like any uncached request would
  if (res && res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }
  // The pinned library only: versions are immutable, so cache-first is safe.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/')) {
    event.respondWith(cacheFirst(req, LIB));
    return;
  }
  // Everything else cross-origin (including the Supabase project) is not ours to intercept.
  if (url.origin !== location.origin) return;

  if (isEntry(url)) {
    const isIndex = url.href === INDEX_URL;
    event.respondWith(
      staleWhileRevalidate(req, ENTRIES, {
        onFresh: isIndex
          ? async (res, oldText, cache) => {
              const text = await res.text();
              if (oldText !== null && text !== oldText) {
                try {
                  await prefetchEntries(cache, JSON.parse(text));
                } catch {
                  /* ignore */
                }
                await notifyClients({ type: 'entries-updated' });
              }
            }
          : undefined,
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(abs('index.html'));
        const net = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(abs('index.html'), res.clone());
            return res;
          })
          .catch(() => null);
        return hit || (await net) || Response.error();
      })(),
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(req, SHELL, { ignoreSearch: true }));
});
