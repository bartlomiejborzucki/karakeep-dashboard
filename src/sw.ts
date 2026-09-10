/*
 * Two narrow jobs, nothing else.
 *
 * 1. Favicons. These are cross-origin resources served without CORS headers, so
 *    `fetch()` only ever yields an *opaque* response: it can be stored in Cache
 *    Storage, but reading `.blob()` back gives an empty blob. A service worker is
 *    the only way to reuse them, because it can hand the opaque Response straight
 *    to the image pipeline without ever reading it. Strategy: cache-first, so a
 *    warm load issues zero requests for icons.
 *
 * 2. Offline fallback for the app shell. Strategy: network-first. When online this
 *    is a no-op — `fetch()` still goes through the normal HTTP cache, so nginx's
 *    max-age/stale-while-revalidate headers do the actual speed work — and the
 *    cached copy is only ever used when the network fails. That ordering is what
 *    makes a service worker safe in a project with no build step: it is incapable
 *    of pinning anyone to a stale version.
 *
 * Karakeep's API is excluded from both. Same-origin is not a good enough test for
 * that, because Karakeep is often reverse-proxied onto this same host, so the
 * exclusion is by path.
 */

const SHELL_CACHE = 'kkhd-shell-v2';
// Hashed bundles live apart from the shell so they can be capped: every deploy ships
// new filenames, and a single cache would grow by one bundle pair forever.
const ASSET_CACHE = 'kkhd-assets-v1';
const ICON_CACHE = 'kkhd-favicons-v1';
const CURRENT = [SHELL_CACHE, ASSET_CACHE, ICON_CACHE];
const MAX_ICONS = 600;
const MAX_ASSETS = 12;

// Hashed asset URLs are unknown at build time, so only the stable entry points are
// precached; everything else is added on first fetch by the network-first handler.
const SHELL: string[] = [
    './',
    './index.html',
    './manifest.json',
    './env.js',
    './favicon.svg',
    './favicon.ico',
    './apple-touch-icon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-192.png',
    './icon-maskable-512.png',
];

// `export {}` makes this a module, which lets the ServiceWorkerGlobalScope
// declaration shadow the ambient `self` instead of colliding with it.
export {};
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(SHELL_CACHE);
            // Individually, so one bad entry cannot fail the whole install.
            await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
            await self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names.filter((n) => n.startsWith('kkhd-') && !CURRENT.includes(n)).map((n) => caches.delete(n))
            );
            await self.clients.claim();
        })()
    );
});

async function trim(cache: Cache, max: number): Promise<void> {
    const keys = await cache.keys();
    if (keys.length <= max) return;
    // Cache.keys() is insertion-ordered, so the head is the oldest.
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function iconCacheFirst(request: Request): Promise<Response> {
    const cache = await caches.open(ICON_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;

    try {
        const response = await fetch(request);
        // Opaque responses have status 0; that is expected here and still cacheable.
        if (response && (response.ok || response.type === 'opaque')) {
            await cache.put(request, response.clone());
            trim(cache, MAX_ICONS);
        }
        return response;
    } catch {
        // Offline with no cached copy: let the <img> error handler hide the icon.
        return Response.error();
    }
}

async function shellNetworkFirst(request: Request, isAsset: boolean): Promise<Response> {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(isAsset ? ASSET_CACHE : SHELL_CACHE);
            await cache.put(request, response.clone());
            if (isAsset) await trim(cache, MAX_ASSETS);
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const fallback = await caches.match('./index.html');
            if (fallback) return fallback;
        }
        throw err;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    let url: URL;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    if (url.origin !== self.location.origin) {
        // Only images. API traffic must never be intercepted or cached.
        if (request.destination === 'image') event.respondWith(iconCacheFirst(request));
        return;
    }

    // Same-origin does not mean "ours": Karakeep is commonly reverse-proxied onto
    // this very host, and those requests carry a bearer token and are marked
    // no-store. Writing them to Cache Storage would leak one user's bookmarks into
    // a cache the next user of the browser profile can read back offline.
    if (/(^|\/)api\/v\d+(\/|$)/.test(url.pathname)) return;

    event.respondWith(shellNetworkFirst(request, url.pathname.includes('/assets/')));
});
