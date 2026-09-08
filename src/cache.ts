// IndexedDB snapshot of the *rendered view model* — not raw API responses.
// Boot does one `get` and zero normalization work, which is where the speed comes from.

import {
    CACHE_DB_NAME,
    CACHE_DB_VERSION,
    CACHE_STORE,
    CACHE_KEY,
    SCHEMA_VERSION,
} from './config.ts';
import type { Snapshot } from './types.ts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
        } catch (err) {
            reject(err as Error);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CACHE_STORE)) {
                db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    // A failed open must not poison every later call.
    dbPromise.catch(() => {
        dbPromise = null;
    });
    return dbPromise;
}

function runTx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, mode);
        let request: IDBRequest<T>;
        try {
            request = fn(tx.objectStore(CACHE_STORE));
        } catch (err) {
            reject(err as Error);
            return;
        }
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
}

// The cache is an optimization, never a correctness requirement: every failure
// degrades to "no cache" rather than breaking the app (private browsing, disabled
// storage, exceeded quota).
export async function readSnapshot(expectedServerId: string): Promise<Snapshot | null> {
    try {
        const db = await openDb();
        const snap = await runTx<Snapshot>(db, 'readonly', (store) => store.get(CACHE_KEY));
        if (!snap) return null;
        if (snap.schemaVersion !== SCHEMA_VERSION) return null;
        if (snap.serverId !== expectedServerId) return null;
        return snap;
    } catch {
        return null;
    }
}

export async function writeSnapshot(snapshot: Snapshot): Promise<boolean> {
    try {
        const db = await openDb();
        await runTx(db, 'readwrite', (store) => store.put({ ...snapshot, key: CACHE_KEY }));
        return true;
    } catch {
        return false;
    }
}

export async function clearCache(): Promise<void> {
    try {
        const db = await openDb();
        await runTx(db, 'readwrite', (store) => store.clear());
    } catch {
        /* ignore */
    }
    try {
        if (typeof caches !== 'undefined') {
            const names = await caches.keys();
            await Promise.all(names.filter((n) => n.startsWith('kkhd-')).map((n) => caches.delete(n)));
        }
    } catch {
        /* ignore */
    }
}
