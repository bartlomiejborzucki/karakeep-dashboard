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
}

// env.js (generated in the container) may seed a default instance URL. Never a token.
export const DEFAULT_URL = globalThis.KARAKEEP_ENV?.karakeepUrl || 'http://localhost:3000';
