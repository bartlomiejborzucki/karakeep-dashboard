// Karakeep REST client. Runs entirely in the browser: Karakeep sends
// `Access-Control-Allow-Origin: *` and allows the `Authorization` header on /api/*,
// so no proxy is involved and the token never leaves this origin.

import {
    PAGE_LIMIT,
    MAX_PAGES_PER_LIST,
    REQUEST_TIMEOUT_MS,
    SEARCH_RESULT_LIMIT,
} from './config.ts';
import type { ApiBookmark, ApiList, ApiStats, ApiUser, PaginatedBookmarks } from './types.ts';

export type ErrorKind =
    | 'auth'
    | 'not-found'
    | 'rate-limit'
    | 'server'
    | 'timeout'
    | 'offline'
    | 'mixed-content'
    | 'network'
    | 'bad-response';

export class ApiError extends Error {
    readonly kind: ErrorKind;
    readonly status: number | undefined;

    constructor(kind: ErrorKind, message: string, status?: number) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
    }
}

// Accepts what people actually paste: trailing slashes, a full ".../api/v1", stray
// whitespace. Refuses to guess a missing scheme — defaulting to https:// would
// silently break the overwhelmingly common http://localhost:3000 case.
export function normalizeBaseUrl(raw: string): string {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) throw new ApiError('bad-response', 'Enter your Karakeep address.');
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new ApiError('bad-response', 'The address must start with http:// or https://');
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new ApiError('bad-response', 'That is not a valid URL.');
    }
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
    return `${url.origin}${path}`;
}

// An `https:` page calling an `http:` API is blocked by the browser before any
// request is sent, and surfaces as an indistinguishable TypeError. Detect it up front.
export function isMixedContent(baseUrl: string): boolean {
    try {
        return location.protocol === 'https:' && new URL(baseUrl).protocol === 'http:';
    } catch {
        return false;
    }
}

function timeoutSignal(ms: number): AbortSignal {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), ms);
    return ac.signal;
}

function classifyNetworkError(err: unknown, baseUrl: string): ApiError {
    if (err instanceof ApiError) return err;
    const name = (err as Error | undefined)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
        return new ApiError('timeout', 'Karakeep did not respond in time.');
    }
    if (navigator.onLine === false) {
        return new ApiError('offline', 'You appear to be offline.');
    }
    if (isMixedContent(baseUrl)) {
        return new ApiError('mixed-content', 'Blocked: an https:// page cannot call an http:// API.');
    }
    return new ApiError('network', 'Could not reach Karakeep (unreachable host, or CORS blocked).');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface KarakeepClient {
    getMe(): Promise<ApiUser>;
    getStats(): Promise<ApiStats>;
    getLists(): Promise<ApiList[]>;
    getListBookmarks(listId: string): Promise<ApiBookmark[]>;
    searchBookmarks(query: string): Promise<ApiBookmark[]>;
    addBookmarkToList(listId: string, bookmarkId: string): Promise<void>;
    removeBookmarkFromList(listId: string, bookmarkId: string): Promise<void>;
    deleteBookmark(bookmarkId: string): Promise<void>;
    archiveBookmark(bookmarkId: string): Promise<void>;
}

export interface RequestOptions {
    method?: string;
    body?: unknown;
    retryOn429?: boolean;
}

export function createClient({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }): KarakeepClient {
    const root = `${baseUrl}/api/v1`;

    async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const { method = 'GET', body, retryOn429 = true } = options;
        if (isMixedContent(baseUrl)) {
            throw new ApiError('mixed-content', 'Blocked: an https:// page cannot call an http:// API.');
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        let res: Response;
        try {
            res = await fetch(`${root}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: timeoutSignal(REQUEST_TIMEOUT_MS),
                credentials: 'omit',
                cache: 'no-store',
            });
        } catch (err) {
            throw classifyNetworkError(err, baseUrl);
        }

        if (res.status === 401 || res.status === 403) {
            throw new ApiError('auth', 'Your API key was rejected.', res.status);
        }
        if (res.status === 404) {
            throw new ApiError('not-found', 'That URL does not look like a Karakeep instance.', 404);
        }
        if (res.status === 429) {
            // One retry, honouring Retry-After. A second 429 is a real rate limit
            // rather than a burst, and gets its own kind so the UI can say so.
            if (retryOn429) {
                const wait = Math.min(10_000, (parseFloat(res.headers.get('Retry-After') ?? '') || 2) * 1000);
                await sleep(wait);
                return request<T>(path, { method, body, retryOn429: false });
            }
            throw new ApiError('rate-limit', 'Karakeep is rate limiting requests.', 429);
        }
        if (!res.ok) {
            throw new ApiError('server', `Karakeep returned ${res.status}.`, res.status);
        }

        if (res.status === 204) {
            return undefined as T;
        }

        const text = await res.text();
        if (!text) {
            return undefined as T;
        }

        try {
            return JSON.parse(text) as T;
        } catch {
            throw new ApiError('bad-response', 'Karakeep returned a response that was not JSON.');
        }
    }

    // Drains the cursor. The SQLite version got every row for free; this is the
    // easiest thing to get wrong when moving to a paginated API.
    async function drain(path: string, params: URLSearchParams, maxPages: number): Promise<ApiBookmark[]> {
        const out: ApiBookmark[] = [];
        let cursor: string | null = null;

        for (let page = 0; page < maxPages; page++) {
            const qs = new URLSearchParams(params);
            if (cursor) qs.set('cursor', cursor);
            const data: PaginatedBookmarks = await request<PaginatedBookmarks>(`${path}?${qs}`);
            if (Array.isArray(data.bookmarks)) out.push(...data.bookmarks);
            cursor = data.nextCursor ?? null;
            if (!cursor) break;
        }
        return out;
    }

    return {
        getMe: () => request<ApiUser>('/users/me'),
        getStats: () => request<ApiStats>('/users/me/stats'),

        async getLists() {
            const data = await request<{ lists?: ApiList[] }>('/lists');
            return Array.isArray(data.lists) ? data.lists : [];
        },

        getListBookmarks(listId) {
            return drain(
                `/lists/${encodeURIComponent(listId)}/bookmarks`,
                new URLSearchParams({ limit: String(PAGE_LIMIT), includeContent: 'false' }),
                MAX_PAGES_PER_LIST
            );
        },

        // Server-side search, used only as a fallback when the local cache finds
        // nothing: it reaches archived and non-listed bookmarks that the dashboard
        // never holds, and can do semantic matching.
        searchBookmarks(query) {
            return drain(
                '/bookmarks/search',
                new URLSearchParams({
                    q: query,
                    limit: String(SEARCH_RESULT_LIMIT),
                    includeContent: 'false',
                }),
                1
            );
        },

        addBookmarkToList(listId, bookmarkId) {
            return request<void>(
                `/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
                { method: 'PUT' }
            );
        },

        removeBookmarkFromList(listId, bookmarkId) {
            return request<void>(
                `/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
                { method: 'DELETE' }
            );
        },

        deleteBookmark(bookmarkId) {
            return request<void>(`/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' });
        },

        archiveBookmark(bookmarkId) {
            return request<void>(`/bookmarks/${encodeURIComponent(bookmarkId)}`, {
                method: 'PATCH',
                body: { archived: true },
            });
        },
    };
}

export interface Settled<T> {
    status: 'fulfilled' | 'rejected';
    value?: T;
    reason?: unknown;
}

// Bounded fan-out: a self-hosted Karakeep should not receive 40 parallel requests.
// Settles rather than rejects, so one bad list cannot discard the whole refresh.
export async function mapWithConcurrency<TIn, TOut>(
    items: readonly TIn[],
    limit: number,
    fn: (item: TIn, index: number) => Promise<TOut>
): Promise<Settled<TOut>[]> {
    const results = new Array<Settled<TOut>>(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = { status: 'fulfilled', value: await fn(items[i]!, i) };
            } catch (reason) {
                results[i] = { status: 'rejected', reason };
            }
        }
    });

    await Promise.all(workers);
    return results;
}
