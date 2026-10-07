// Synchronous localStorage layer: credentials + preferences.
// Read before the first async hop so a missing token short-circuits to the setup
// screen with zero I/O, and so the column layout is known before the first render.

import { KEYS, DEFAULT_COLUMNS, MIN_COLUMNS, MAX_COLUMNS } from './config.ts';
import type { ColumnLayout, Credentials, Prefs } from './types.ts';

function readJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* quota or disabled storage: preferences are not worth failing over */
    }
}

function removeKey(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

export function readCredentials(): Credentials | null {
    const c = readJson<Partial<Credentials>>(KEYS.creds);
    if (!c || typeof c.baseUrl !== 'string') return null;
    return {
        baseUrl: c.baseUrl,
        apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
        userId: c.userId ?? null,
    };
}

export function writeCredentials(creds: Credentials): void {
    writeJson(KEYS.creds, creds);
}

export function clearApiKey(): void {
    const c = readCredentials();
    if (c) writeCredentials({ ...c, apiKey: '' });
}

export function clearCredentials(): void {
    try {
        localStorage.removeItem(KEYS.creds);
    } catch {
        /* ignore */
    }
}

const DEFAULT_PREFS: Prefs = {
    columnLayout: null,
    columnOrder: [],
    bookmarkTarget: '_self',
    includeSmartLists: false,
    numColumns: DEFAULT_COLUMNS,
    showTags: false,
    collapseListsByDefault: false,
    collapseSublistsByDefault: false,
    showBookmarkCounts: true,
    showFavourites: false,
};

let migrated = false;

// The pre-API version wrote `karakeep-column-layout` / `karakeep-column-order`.
// Fold those in once so an existing user's column arrangement survives the upgrade.
function migrateLegacy(prefs: Prefs): void {
    const layout = readJson<ColumnLayout>(KEYS.legacyLayout);
    if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
        prefs.columnLayout = layout;
    }
    const order = readJson<string[]>(KEYS.legacyOrder);
    if (Array.isArray(order)) prefs.columnOrder = order;
}

export function clampColumns(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_COLUMNS;
    return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, n));
}

export function readPrefs(): Prefs {
    const stored = readJson<Partial<Prefs>>(KEYS.prefs);
    if (stored) {
        return { ...DEFAULT_PREFS, ...stored, numColumns: clampColumns(stored.numColumns) };
    }

    const prefs: Prefs = { ...DEFAULT_PREFS };
    if (!migrated) {
        migrated = true;
        migrateLegacy(prefs);
        writeJson(KEYS.prefs, prefs);
    }
    return prefs;
}

export function writePrefs(prefs: Prefs): void {
    writeJson(KEYS.prefs, prefs);

    // Keep the legacy keys in sync so rolling back does not lose the layout — and
    // clear them when the layout is reset, otherwise a layout saved for a different
    // column count survives here and migrateLegacy resurrects it later.
    if (prefs.columnLayout) writeJson(KEYS.legacyLayout, prefs.columnLayout);
    else removeKey(KEYS.legacyLayout);

    if (prefs.columnOrder?.length) writeJson(KEYS.legacyOrder, prefs.columnOrder);
    else removeKey(KEYS.legacyOrder);
}

export function updatePrefs(patch: Partial<Prefs>): Prefs {
    const next: Prefs = { ...readPrefs(), ...patch };
    writePrefs(next);
    return next;
}

// Identifies "which server, which user" so a snapshot is never shown for the wrong account.
export function serverId(baseUrl: string, userId: string | null): string {
    const input = `${baseUrl}|${userId ?? ''}`;
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
}

export function readCollapsedOverrides(): Record<string, boolean> {
    return readJson<Record<string, boolean>>(KEYS.collapsed) ?? {};
}

export function writeCollapsedOverrides(overrides: Record<string, boolean>): void {
    writeJson(KEYS.collapsed, overrides);
}

export function clearCollapsedOverrides(): void {
    removeKey(KEYS.collapsed);
}

export function isListCollapsed(
    listId: string,
    isSublist: boolean,
    prefs: Pick<Prefs, 'collapseListsByDefault' | 'collapseSublistsByDefault'>,
    overrides: Record<string, boolean>
): boolean {
    if (listId in overrides) {
        return Boolean(overrides[listId]);
    }
    return isSublist ? prefs.collapseSublistsByDefault : prefs.collapseListsByDefault;
}
