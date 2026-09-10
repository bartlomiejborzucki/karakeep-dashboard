import test from 'node:test';
import assert from 'node:assert/strict';

import { esc, safeUrl, faviconUrlFor, distributeColumns, renderGrid, countBookmarks } from '../src/render.ts';
import { buildTree, normalizeBookmark } from '../src/model.ts';
import { DEFAULT_COLUMNS, SCHEMA_VERSION } from '../src/config.ts';
import type { Bookmark, ListNode, Prefs, Snapshot } from '../src/types.ts';

const listNode = (id: string, bookmarks: Bookmark[] = [], children: ListNode[] = []): ListNode => ({
    id,
    name: id,
    icon: '📁',
    parentId: null,
    type: 'manual',
    children,
    bookmarks,
    hasContent: true,
});

const bm = (id: string, title: string, url: string, tags: string[] = []): Bookmark => ({
    id,
    title,
    url,
    favicon: null,
    description: null,
    tags,
    hay: `${title} ${url} ${tags.join(' ')}`.toLowerCase(),
});

type LayoutPrefs = Pick<Prefs, 'columnLayout' | 'columnOrder' | 'numColumns'>;
const layout = (p: Partial<LayoutPrefs> = {}): LayoutPrefs => ({
    columnLayout: p.columnLayout ?? null,
    columnOrder: p.columnOrder ?? [],
    numColumns: p.numColumns ?? DEFAULT_COLUMNS,
});

test('esc does not throw on a null list icon', () => {
    // escapeHtml(list.icon) used to crash the whole render for a list with no icon.
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
});

test('esc neutralises HTML in crawled titles', () => {
    assert.equal(
        esc('"><img src=x onerror=alert(1)>'),
        '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'
    );
});

test('safeUrl rejects javascript: and other script-bearing schemes', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl('JaVaScRiPt:alert(1)'), '#');
    assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), '#');
    assert.equal(safeUrl('vbscript:msgbox(1)'), '#');
    assert.equal(safeUrl(''), '#');
    assert.equal(safeUrl(null), '#');
});

test('safeUrl passes ordinary bookmark URLs through untouched', () => {
    assert.equal(safeUrl('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d');
    assert.equal(safeUrl('http://localhost:3000/'), 'http://localhost:3000/');
    assert.equal(safeUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
});

test('safeUrl does not resolve relative values against our own origin', () => {
    assert.equal(safeUrl('/admin'), '#');
    assert.equal(safeUrl('../secrets'), '#');
});

test('faviconUrlFor prefers the stored favicon and falls back per domain', () => {
    assert.equal(faviconUrlFor({ favicon: 'https://a.example/f.ico', url: 'https://a.example' }), 'https://a.example/f.ico');
    assert.equal(
        faviconUrlFor({ favicon: null, url: 'https://b.example/page' }),
        'https://www.google.com/s2/favicons?domain=b.example&sz=32'
    );
    assert.equal(faviconUrlFor({ favicon: null, url: 'not a url' }), '');
});

test('a malicious title and URL cannot escape their attributes', () => {
    const evil = bm('e', '"><img src=x onerror=alert(1)>', 'javascript:alert(1)');
    const { html } = renderGrid([[listNode('l', [evil])], [], [], []] as ListNode[][]);

    assert.equal(html.includes('onerror=alert(1)>'), false);
    assert.equal(html.includes('href="javascript:'), false);
    assert.equal(html.includes('href="#"'), true);
    assert.equal(html.includes('&quot;&gt;&lt;img'), true);
});

test('no inline event handlers survive in the output', () => {
    // CSP sets script-src 'self'; an inline onerror would be blocked anyway.
    const { html } = renderGrid([[listNode('l', [bm('a', 'Title', 'https://e.example')])], [], [], []]);
    assert.equal(/\son\w+\s*=/.test(html), false);
});

test('renderGrid emits bookmarks in the same order the DOM will contain them', () => {
    // The search index zips this array against querySelectorAll('.bookmark-item'),
    // so a mismatch would silently associate the wrong haystack with each anchor.
    const child: ListNode = { ...listNode('child', [bm('c1', 'Child one', 'https://c.example')]), parentId: 'root' };
    const root = listNode('root', [bm('r1', 'Root one', 'https://r.example')], [child]);
    const other = listNode('other', [bm('o1', 'Other one', 'https://o.example')]);

    const { html, items } = renderGrid([[root], [other], [], []]);

    assert.deepEqual(items.map((b) => b.id), ['r1', 'c1', 'o1']);

    const inDom = [...html.matchAll(/class="bookmark-title">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(inDom, ['Root one', 'Child one', 'Other one']);
});

test('nested lists keep the level-capped class names and heading levels', () => {
    const deep = listNode('d3', [bm('b3', 'Deep', 'https://d.example')]);
    const mid = listNode('d2', [], [deep]);
    const top = listNode('d1', [], [mid]);
    const { html } = renderGrid([[top], [], [], []]);

    assert.equal(html.includes('class="list-section"'), true);
    assert.equal(html.includes('class="nested-list-1"'), true);
    assert.equal(html.includes('class="nested-list-2"'), true);
    assert.equal(html.includes('<h2 class="list-title">'), true);
    assert.equal(html.includes('<h3 class="list-title">'), true);
    assert.equal(html.includes('<h4 class="list-title">'), true);
});

test('depth beyond two levels still renders, styled as nested-list-2', () => {
    // The old code capped the class name, not the recursion. Preserved deliberately.
    let node: ListNode = listNode('leaf', [bm('x', 'Leaf', 'https://l.example')]);
    for (let i = 0; i < 4; i++) node = listNode(`n${i}`, [], [node]);

    const { html, items } = renderGrid([[node], [], [], []]);
    assert.equal(items.length, 1);
    assert.equal((html.match(/nested-list-2/g) || []).length >= 2, true);
});

test('a list with no content renders nothing', () => {
    const empty: ListNode = { ...listNode('empty'), hasContent: false };
    const { html, items } = renderGrid([[empty], [], [], []]);
    assert.equal(items.length, 0);
    assert.equal(html.includes('data-list-id="empty"'), false);
});

test('bookmarks open in the configured target', () => {
    const item: ListNode[][] = [[listNode('l', [bm('a', 'T', 'https://e.example')])], [], [], []];
    assert.equal(renderGrid(item).html.includes('target="_self"'), true);
    assert.equal(renderGrid(item).html.includes('rel=""'), true);

    const blank = renderGrid(item, { bookmarkTarget: '_blank' }).html;
    assert.equal(blank.includes('target="_blank"'), true);
    assert.equal(blank.includes('rel="noopener noreferrer"'), true);
});

test('favicons are lazy and do not leak a referrer', () => {
    const withIcon: Bookmark = { ...bm('a', 'T', 'https://e.example'), favicon: 'https://e.example/f.ico' };
    const { html } = renderGrid([[listNode('l', [withIcon])], [], [], []]);
    assert.equal(html.includes('loading="lazy"'), true);
    assert.equal(html.includes('decoding="async"'), true);
    assert.equal(html.includes('referrerpolicy="no-referrer"'), true);
});

test('distributeColumns honours a saved layout and appends unknown lists', () => {
    const lists = ['a', 'b', 'c', 'd'].map((id) => listNode(id));
    const prefs = layout({ columnLayout: { '0': ['c'], '1': [], '2': ['a'], '3': [] } });

    const columns = distributeColumns(lists, prefs);

    // Saved placements come first, then anything new is appended round-robin from
    // column 0 — the same behaviour as the pre-API build.
    assert.deepEqual(columns[0].map((l) => l.id), ['c', 'b']);
    assert.deepEqual(columns[1].map((l) => l.id), ['d']);
    assert.deepEqual(columns[2].map((l) => l.id), ['a']);

    const all = columns.flat().map((l) => l.id).sort();
    assert.deepEqual(all, ['a', 'b', 'c', 'd']);
});

test('distributeColumns reads a legacy layout stored with string keys', () => {
    const lists = ['a', 'b'].map((id) => listNode(id));
    const columns = distributeColumns(lists, layout({ columnLayout: { '1': ['b'], '3': ['a'] } }));
    assert.deepEqual(columns[1].map((l) => l.id), ['b']);
    assert.deepEqual(columns[3].map((l) => l.id), ['a']);
});

test('distributeColumns falls back to legacy columnOrder, then round-robin', () => {
    const lists = ['a', 'b', 'c'].map((id) => listNode(id));

    const ordered = distributeColumns(lists, layout({ columnOrder: ['c', 'b', 'a'] }));
    assert.deepEqual([ordered[0][0].id, ordered[1][0].id, ordered[2][0].id], ['c', 'b', 'a']);

    const plain = distributeColumns(lists, layout());
    assert.deepEqual([plain[0][0].id, plain[1][0].id, plain[2][0].id], ['a', 'b', 'c']);
});

test('distributeColumns never drops or duplicates a list', () => {
    const lists = Array.from({ length: 11 }, (_, i) => listNode(`l${i}`));
    for (const prefs of [
        layout(),
        layout({ columnOrder: ['l5', 'l1'] }),
        layout({ columnLayout: { '0': ['l9', 'l2'], '2': ['l0'] } }),
    ]) {
        const ids = distributeColumns(lists, prefs).flat().map((l) => l.id);
        assert.equal(ids.length, 11);
        assert.equal(new Set(ids).size, 11);
    }
});

test('end to end: an API payload renders the expected card', () => {
    const snapshot: Snapshot = {
        schemaVersion: SCHEMA_VERSION,
        serverId: 's',
        fetchedAt: Date.now(),
        fingerprint: 'f',
        lists: [{ id: 'l1', name: 'Self-hosting', icon: '🏠', parentId: null, type: 'manual' }],
        bookmarks: [
            normalizeBookmark({
                id: 'b1',
                title: null,
                archived: false,
                content: { type: 'link', url: 'https://karakeep.app', title: 'Karakeep', favicon: null },
            })!,
        ],
        membership: { l1: ['b1'] },
    };

    const { html, items } = renderGrid(distributeColumns(buildTree(snapshot), layout()));

    assert.equal(items.length, 1);
    assert.equal(html.includes('data-list-id="l1"'), true);
    assert.equal(html.includes('<span class="list-icon">🏠</span>'), true);
    assert.equal(html.includes('Self-hosting'), true);
    assert.equal(html.includes('href="https://karakeep.app"'), true);
    assert.equal(html.includes('>Karakeep<'), true);
});

test('countBookmarks counts unique bookmarks including descendants', () => {
    const b1 = bm('b1', 'One', 'https://1.example');
    const b2 = bm('b2', 'Two', 'https://2.example');
    const b3 = bm('b3', 'Three', 'https://3.example');
    const child = listNode('c', [b2, b3]);
    const parent = listNode('p', [b1, b2], [child]);

    assert.equal(countBookmarks(child), 2);
    assert.equal(countBookmarks(parent), 3);
});

test('renderGrid displays bookmark counts on lists and sublists', () => {
    const b1 = bm('b1', 'One', 'https://1.example');
    const b2 = bm('b2', 'Two', 'https://2.example');
    const child = listNode('c', [b2]);
    const parent = listNode('p', [b1], [child]);

    const withCounts = renderGrid([[parent]], { showBookmarkCounts: true }).html;
    assert.equal(withCounts.includes('<span class="list-count" title="2 bookmarks">2</span>'), true);
    assert.equal(withCounts.includes('<span class="list-count" title="1 bookmark">1</span>'), true);

    const withoutCounts = renderGrid([[parent]], { showBookmarkCounts: false }).html;
    assert.equal(withoutCounts.includes('class="list-count"'), false);
});

test('renderGrid supports default and overridden collapse states', () => {
    const b1 = bm('b1', 'One', 'https://1.example');
    const b2 = bm('b2', 'Two', 'https://2.example');
    const child = listNode('c', [b2]);
    const parent = listNode('p', [b1], [child]);

    // Default: expanded
    const def = renderGrid([[parent]]).html;
    assert.equal(def.includes('class="list-section is-collapsed"'), false);
    assert.equal(def.includes('class="nested-list-1 is-collapsed"'), false);
    assert.equal(def.includes('aria-expanded="true"'), true);

    // Collapse lists by default
    const collapsedLists = renderGrid([[parent]], { collapseListsByDefault: true }).html;
    assert.equal(collapsedLists.includes('class="list-section is-collapsed"'), true);
    assert.equal(collapsedLists.includes('class="nested-list-1 is-collapsed"'), false);

    // Collapse sublists by default
    const collapsedSublists = renderGrid([[parent]], { collapseSublistsByDefault: true }).html;
    assert.equal(collapsedSublists.includes('class="list-section is-collapsed"'), false);
    assert.equal(collapsedSublists.includes('class="nested-list-1 is-collapsed"'), true);

    // Explicit overrides take precedence
    const overridden = renderGrid([[parent]], {
        collapseListsByDefault: true,
        collapsedOverrides: { p: false, c: true },
    }).html;
    assert.equal(overridden.includes('class="list-section is-collapsed"'), false);
    assert.equal(overridden.includes('class="nested-list-1 is-collapsed"'), true);
});
