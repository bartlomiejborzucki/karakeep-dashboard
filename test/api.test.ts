import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/api.ts';

test('createClient sends correct PUT request for addBookmarkToList', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method ?? 'GET';
        return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
        const client = createClient({ baseUrl: 'http://localhost:3000', apiKey: 'testkey' });
        await client.addBookmarkToList('list-123', 'bm-456');
        assert.equal(capturedUrl, 'http://localhost:3000/api/v1/lists/list-123/bookmarks/bm-456');
        assert.equal(capturedMethod, 'PUT');
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('createClient sends correct DELETE request for removeBookmarkFromList', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method ?? 'GET';
        return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
        const client = createClient({ baseUrl: 'http://localhost:3000', apiKey: 'testkey' });
        await client.removeBookmarkFromList('list-123', 'bm-456');
        assert.equal(capturedUrl, 'http://localhost:3000/api/v1/lists/list-123/bookmarks/bm-456');
        assert.equal(capturedMethod, 'DELETE');
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('createClient sends correct DELETE request for deleteBookmark', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method ?? 'GET';
        return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
        const client = createClient({ baseUrl: 'http://localhost:3000', apiKey: 'testkey' });
        await client.deleteBookmark('bm-456');
        assert.equal(capturedUrl, 'http://localhost:3000/api/v1/bookmarks/bm-456');
        assert.equal(capturedMethod, 'DELETE');
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('createClient sends correct PATCH request for archiveBookmark', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method ?? 'GET';
        capturedBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ id: 'bm-456', archived: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;

    try {
        const client = createClient({ baseUrl: 'http://localhost:3000', apiKey: 'testkey' });
        await client.archiveBookmark('bm-456');
        assert.equal(capturedUrl, 'http://localhost:3000/api/v1/bookmarks/bm-456');
        assert.equal(capturedMethod, 'PATCH');
        assert.deepEqual(JSON.parse(capturedBody), { archived: true });
    } finally {
        globalThis.fetch = origFetch;
    }
});
