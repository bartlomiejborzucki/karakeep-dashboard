import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compareBinary,
    normalizeBookmark,
    normalizeList,
    buildSnapshot,
    buildTree,
    computeFingerprint,
    sortBookmarks,
} from '../src/model.ts';

import type { ApiBookmark, Bookmark, List, Snapshot } from '../src/types.ts';
import { FAVOURITES_LIST, SCHEMA_VERSION } from '../src/config.ts';

interface LinkOpts {
    title?: string;
    crawledTitle?: string;
    url?: string;
    favicon?: string;
    archived?: boolean;
    tags?: string[];
}

const link = (id: string, opts: LinkOpts = {}): ApiBookmark => ({
    id,
    title: opts.title ?? null,
    archived: opts.archived ?? false,
    tags: (opts.tags ?? []).map((name) => ({ id: name, name })),
    content: {
        type: 'link',
        url: opts.url ?? `https://example.com/${id}`,
        title: opts.crawledTitle ?? null,
        favicon: opts.favicon ?? null,
    },
});

/** normalizeBookmark returns null for non-link input; tests here always pass links. */
const norm = (raw: ApiBookmark): Bookmark => {
    const b = normalizeBookmark(raw);
    if (!b) throw new Error(`expected a link bookmark for ${raw.id}`);
    return b;
};

const snapshotOf = (
    lists: List[],
    membership: Record<string, string[]>,
    bookmarks: Bookmark[]
): Snapshot => ({
    schemaVersion: SCHEMA_VERSION,
    serverId: 'x',
    fetchedAt: Date.now(),
    fingerprint: 'f',
    lists,
    bookmarks,
    membership,
});

test('compareBinary reproduces SQLite BINARY collation, not locale order', () => {
    // The old SQL sorted under BINARY, where uppercase precedes lowercase.
    // localeCompare would put "apple" first and reshuffle every card.
    assert.equal(compareBinary('Zebra', 'apple') < 0, true);
    assert.equal('Zebra'.localeCompare('apple') < 0, false);

    const titles = ['banana', 'Apple', 'Zebra', 'apple'];
    assert.deepEqual([...titles].sort(compareBinary), ['Apple', 'Zebra', 'apple', 'banana']);
});

test('sortBookmarks orders by the title that is actually displayed', () => {
    const items = [
        norm(link('1', { title: 'zulu' })),
        norm(link('2', { title: 'Alpha' })),
        norm(link('3', { title: 'mike' })),
    ];
    assert.deepEqual(sortBookmarks(items).map((b) => b.id), ['2', '3', '1']);
});

test('normalizeBookmark applies user title over crawled title over Untitled', () => {
    assert.equal(norm(link('a', { title: 'Mine', crawledTitle: 'Theirs' })).title, 'Mine');
    assert.equal(norm(link('b', { crawledTitle: 'Theirs' })).title, 'Theirs');
    assert.equal(norm(link('c')).title, 'Untitled');
});

test('normalizeBookmark keeps only link bookmarks, matching the old WHERE clause', () => {
    assert.equal(normalizeBookmark({ id: 'x', content: { type: 'text', text: 'note' } }), null);
    assert.equal(normalizeBookmark({ id: 'y', content: { type: 'asset', assetId: 'a' } }), null);
    assert.notEqual(normalizeBookmark(link('z')), null);
});

test('normalizeBookmark drops archived bookmarks', () => {
    assert.equal(normalizeBookmark(link('a', { archived: true })), null);
    assert.notEqual(normalizeBookmark(link('b', { archived: false })), null);
});

test('normalizeBookmark precomputes a lowercase haystack covering title, url and tags', () => {
    const plain = norm(link('a', { title: 'MiXeD Case', url: 'https://Example.COM/Path' }));
    assert.equal(plain.hay, 'mixed case https://example.com/path');

    const tagged = norm(link('b', { title: 'T', url: 'https://e.example', tags: ['SelfHosted', 'RSS'] }));
    assert.equal(tagged.hay, 't https://e.example selfhosted rss');
    assert.equal(tagged.hay.includes('selfhosted'), true);
});

test('buildSnapshot stores a multi-list bookmark once but keeps both memberships', () => {
    const shared = norm(link('shared'));
    const snap = buildSnapshot({
        lists: [normalizeList({ id: 'l1', name: 'One', icon: '1', parentId: null }),
                normalizeList({ id: 'l2', name: 'Two', icon: '2', parentId: null })],
        perList: [
            { listId: 'l1', bookmarks: [shared] },
            { listId: 'l2', bookmarks: [shared] },
        ],
        fingerprint: 'f',
        serverId: 's',
        schemaVersion: SCHEMA_VERSION,
    });

    assert.equal(snap.bookmarks.length, 1);
    assert.deepEqual(snap.membership.l1, ['shared']);
    assert.deepEqual(snap.membership.l2, ['shared']);
});

test('buildTree nests children and drops lists with no content anywhere below', () => {
    const lists: List[] = [
        { id: 'root', name: 'Root', icon: 'R', parentId: null, type: 'manual' },
        { id: 'kid', name: 'Kid', icon: 'K', parentId: 'root', type: 'manual' },
        { id: 'empty', name: 'Empty', icon: 'E', parentId: null, type: 'manual' },
    ];
    const b = norm(link('b1'));
    const snap = snapshotOf(lists, { root: [], kid: ['b1'], empty: [] }, [b]);

    const roots = buildTree(snap);
    assert.deepEqual(roots.map((r) => r.id), ['root']);
    assert.deepEqual(roots[0].children.map((c) => c.id), ['kid']);
    assert.equal(roots[0].bookmarks.length, 0);
    assert.equal(roots[0].children[0].bookmarks.length, 1);
});

test('buildTree renders a bookmark once per list it belongs to', () => {
    const lists: List[] = [
        { id: 'a', name: 'A', icon: 'a', parentId: null, type: 'manual' },
        { id: 'b', name: 'B', icon: 'b', parentId: null, type: 'manual' },
    ];
    const shared = norm(link('s'));
    const roots = buildTree(snapshotOf(lists, { a: ['s'], b: ['s'] }, [shared]));
    assert.equal(roots.length, 2);
    assert.equal(roots[0].bookmarks[0].id, 's');
    assert.equal(roots[1].bookmarks[0].id, 's');
});

test('buildTree excludes smart lists by default and includes them on request', () => {
    const lists: List[] = [
        { id: 'm', name: 'Manual', icon: 'm', parentId: null, type: 'manual' },
        { id: 's', name: 'Smart', icon: 's', parentId: null, type: 'smart' },
    ];
    const snap = snapshotOf(lists, { m: ['b1'], s: ['b1'] }, [norm(link('b1'))]);

    assert.deepEqual(buildTree(snap).map((r) => r.id), ['m']);
    assert.deepEqual(
        buildTree(snap, { includeSmartLists: true }).map((r) => r.id).sort(),
        ['m', 's']
    );
});

test('buildTree survives a parentId cycle instead of recursing forever', () => {
    // The previous build hung the browser on this input.
    const lists: List[] = [
        { id: 'a', name: 'A', icon: 'a', parentId: 'b', type: 'manual' },
        { id: 'b', name: 'B', icon: 'b', parentId: 'a', type: 'manual' },
    ];
    const snap = snapshotOf(lists, { a: ['b1'], b: ['b1'] }, [norm(link('b1'))]);

    const roots = buildTree(snap);
    assert.equal(roots.length > 0, true);
    assert.equal(roots.every((r) => typeof r.id === 'string'), true);
});

test('buildTree tolerates a list pointing at itself', () => {
    const lists: List[] = [{ id: 'self', name: 'Self', icon: 's', parentId: 'self', type: 'manual' }];
    const snap = snapshotOf(lists, { self: ['b1'] }, [norm(link('b1'))]);
    assert.deepEqual(buildTree(snap).map((r) => r.id), ['self']);
});

test('buildTree sorts lists and their bookmarks under BINARY order', () => {
    const lists: List[] = [
        { id: 'z', name: 'Zebra', icon: 'z', parentId: null, type: 'manual' },
        { id: 'a', name: 'apple', icon: 'a', parentId: null, type: 'manual' },
    ];
    const bookmarks = [norm(link('b1', { title: 'zulu' })), norm(link('b2', { title: 'Alpha' }))];
    const snap = buildSnapshot({
        lists,
        perList: [{ listId: 'z', bookmarks }, { listId: 'a', bookmarks: [] }],
        fingerprint: 'f',
        serverId: 's',
        schemaVersion: SCHEMA_VERSION,
    });

    assert.deepEqual(snap.lists.map((l) => l.name), ['Zebra', 'apple']);
    assert.deepEqual(buildTree(snap)[0].bookmarks.map((b) => b.title), ['Alpha', 'zulu']);
});

test('computeFingerprint changes when a list is renamed but counters are not', () => {
    const stats = { numBookmarks: 10, numLists: 2, numTags: 3, numArchived: 0, numFavorites: 1,
        bookmarksByType: { link: 10, text: 0, asset: 0 } };
    const before: List[] = [{ id: 'a', name: 'Old', icon: 'x', parentId: null, type: 'manual' }];
    const after: List[] = [{ id: 'a', name: 'New', icon: 'x', parentId: null, type: 'manual' }];

    assert.notEqual(computeFingerprint(stats, before), computeFingerprint(stats, after));
});

test('computeFingerprint is stable across list ordering', () => {
    const stats = { numBookmarks: 1, numLists: 2, bookmarksByType: {} };
    const a: List = { id: 'a', name: 'A', icon: 'x', parentId: null, type: 'manual' };
    const b: List = { id: 'b', name: 'B', icon: 'y', parentId: null, type: 'manual' };
    assert.equal(computeFingerprint(stats, [a, b]), computeFingerprint(stats, [b, a]));
});

test('computeFingerprint changes when a bookmark is added', () => {
    const lists: List[] = [{ id: 'a', name: 'A', icon: 'x', parentId: null, type: 'manual' }];
    const before = { numBookmarks: 10, bookmarksByType: { link: 10 } };
    const after = { numBookmarks: 11, bookmarksByType: { link: 11 } };
    assert.notEqual(computeFingerprint(before, lists), computeFingerprint(after, lists));
});

test('buildTree preserves empty manual lists when showEmptyLists is true', () => {
    const emptyManual: List = { id: 'm', name: 'Empty Manual', icon: null, parentId: null, type: 'manual' };
    const emptySmart: List = { id: 's', name: 'Empty Smart', icon: null, parentId: null, type: 'smart' };
    const snap = snapshotOf([emptyManual, emptySmart], {}, []);

    const defaultTree = buildTree(snap, { includeSmartLists: true });
    assert.equal(defaultTree.length, 0);

    const editModeTree = buildTree(snap, { includeSmartLists: true, showEmptyLists: true });
    assert.equal(editModeTree.length, 1);
    assert.equal(editModeTree[0]?.id, 'm');
});


test('buildTree shows the favourites list only when asked to', () => {
    const fav: List = { ...FAVOURITES_LIST };
    const work: List = { id: 'work', name: 'Work', icon: null, parentId: null, type: 'manual' };
    const a = norm(link('a'));
    const snap = snapshotOf([fav, work], { [fav.id]: ['a'], work: ['a'] }, [a]);

    assert.deepEqual(buildTree(snap).map((n) => n.id), ['work']);
    assert.deepEqual(
        buildTree(snap, { showFavourites: true }).map((n) => n.id).sort(),
        [fav.id, 'work'].sort()
    );
});
