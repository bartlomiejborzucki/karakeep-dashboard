import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoClient } from '../src/demo.ts';
import { normalizeBookmark } from '../src/model.ts';

test('demo lists all normalize into renderable bookmarks', async () => {
    const client = createDemoClient();
    const lists = await client.getLists();
    assert.ok(lists.length >= 5);
    for (const list of lists) {
        if (list.parentId) assert.ok(lists.some((l) => l.id === list.parentId), `orphan list ${list.id}`);
        for (const raw of await client.getListBookmarks(list.id)) {
            assert.notEqual(normalizeBookmark(raw), null, `${raw.id} does not normalize`);
        }
    }
});

test('demo mutations are visible to the next fetch and change the stats', async () => {
    const client = createDemoClient();
    const before = await client.getStats();
    const [first] = await client.getListBookmarks('daily');
    assert.ok(first);

    await client.addBookmarkToList('reading', first.id);
    await client.removeBookmarkFromList('daily', first.id);
    assert.ok(!(await client.getListBookmarks('daily')).some((b) => b.id === first.id));
    assert.ok((await client.getListBookmarks('reading')).some((b) => b.id === first.id));

    await client.archiveBookmark(first.id);
    assert.ok(!(await client.getListBookmarks('reading')).some((b) => b.id === first.id));

    assert.notDeepEqual(await client.getStats(), before);
});

test('each demo client starts from a fresh store', async () => {
    const a = createDemoClient();
    const [first] = await a.getListBookmarks('daily');
    await a.deleteBookmark(first!.id);
    const b = createDemoClient();
    assert.ok((await b.getListBookmarks('daily')).some((x) => x.id === first!.id));
});

test('demo favourites include a bookmark that is in no list', async () => {
    const client = createDemoClient();
    const favourites = await client.getFavouriteBookmarks();
    assert.ok(favourites.length >= 3);
    assert.ok(favourites.every((b) => b.favourited));

    const listed = new Set<string>();
    for (const list of await client.getLists()) {
        for (const b of await client.getListBookmarks(list.id)) listed.add(b.id);
    }
    assert.ok(favourites.some((b) => !listed.has(b.id)), 'expected an unlisted favourite');
});
