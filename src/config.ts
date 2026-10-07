// Constants and storage keys shared across modules.

// Bumped whenever the cached snapshot shape changes; a mismatch discards the cache.
export const SCHEMA_VERSION = 2;

export const DEFAULT_COLUMNS = 4;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 6;

// API tuning
export const PAGE_LIMIT = 100;
export const MAX_PAGES_PER_LIST = 50;
export const FANOUT_CONCURRENCY = 6;
export const REQUEST_TIMEOUT_MS = 10_000;
export const SEARCH_RESULT_LIMIT = 50;

// Cache freshness
export const FULL_REFETCH_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Favourites are shown as a virtual list: one extra request on a full refresh,
// pinned to the top of the first column until the user drags it elsewhere. The id
// cannot collide with Karakeep's (cuid2: lowercase alphanumerics, no colon).
export const FAVOURITES_LIST = {
    id: 'kkhd:favourites',
    name: 'Favourites',
    icon: '⭐',
    parentId: null,
    type: 'favourites',
} as const;

export const KEYS = {
    creds: 'kkhd.credentials',
    prefs: 'kkhd.prefs',
    collapsed: 'kkhd.collapsed',
    legacyLayout: 'karakeep-column-layout',
    legacyOrder: 'karakeep-column-order',
} as const;

export const CACHE_DB_NAME = 'karakeep-homedash';
export const CACHE_DB_VERSION = 1;
export const CACHE_STORE = 'snapshots';
export const CACHE_KEY = 'view';

declare global {
    // eslint-disable-next-line no-var
    var KARAKEEP_ENV: { karakeepUrl?: string } | undefined;
    // Replaced by esbuild `define` (build.mjs): true only in `--demo` builds, which
    // swap the API for the in-memory store in src/demo.ts. Referenced directly,
    // never through a variable, so a normal build folds it and drops the demo code.
    // Undefined under node --test, so only main.ts (never imported by tests) reads it.
    const __DEMO__: boolean;
}
export const REPO_URL = 'https://github.com/bartlomiejborzucki/karakeep-dashboard';

// env.js (generated in the container) may seed a default instance URL. Never a token.
export const DEFAULT_URL = globalThis.KARAKEEP_ENV?.karakeepUrl || 'http://localhost:3000';
