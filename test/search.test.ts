import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilter, matchesTerms, parseTerms, type SearchIndex } from '../src/search.ts';

// applyFilter only ever touches classList and one querySelector, so a stub stands in
// for the DOM without pulling in a browser environment.
const fakeEl = () => {
    const classes = new Set<string>();
    return {
        classes,
        classList: {
            toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name), force),
            remove: (name: string) => void classes.delete(name),
            add: (name: string) => void classes.add(name),
        },
        querySelector: () => null,
    };
};

function fakeIndex(entries: Array<[id: string, hay: string]>): SearchIndex & { els: ReturnType<typeof fakeEl>[] } {
    const els = entries.map(() => fakeEl());
    const items = entries.map(([id, hay], i) => ({ el: els[i] as unknown as Element, id, hay }));
    return {
        container: fakeEl() as unknown as Element,
        items,
        groups: [],
        columns: [],
        total: new Set(entries.map(([id]) => id)).size,
        els,
    };
}

test('parseTerms lowercases and splits on any whitespace', () => {
    assert.deepEqual(parseTerms('  Docker\tGitHub  self-hosted '), ['docker', 'github', 'self-hosted']);
    assert.deepEqual(parseTerms('   '), []);
});

test('matchesTerms requires every term, in any order', () => {
    const hay = 'awesome selfhosted https://github.com/awesome-selfhosted docker';
    assert.equal(matchesTerms(hay, ['docker', 'github']), true);
    assert.equal(matchesTerms(hay, ['github', 'docker']), true);
    assert.equal(matchesTerms(hay, ['docker', 'kubernetes']), false);
    assert.equal(matchesTerms(hay, []), true);
});

test('applyFilter counts a bookmark shown in two lists once', () => {
    // Same bookmark rendered in a list and in the Favourites card, plus one other.
    const index = fakeIndex([
        ['a', 'karakeep https://karakeep.app'],
        ['a', 'karakeep https://karakeep.app'],
        ['b', 'nginx https://nginx.org'],
    ]);

    assert.equal(index.total, 2);
    assert.equal(applyFilter(index, 'karakeep'), 1);
    assert.equal(index.els[0]!.classes.has('is-hidden'), false);
    assert.equal(index.els[1]!.classes.has('is-hidden'), false);
    assert.equal(index.els[2]!.classes.has('is-hidden'), true);
});

test('applyFilter with an empty term reports unique bookmarks and unhides everything', () => {
    const index = fakeIndex([
        ['a', 'one'],
        ['a', 'one'],
        ['b', 'two'],
    ]);
    applyFilter(index, 'two');
    assert.equal(applyFilter(index, '   '), 2);
    assert.equal(index.els.some((el) => el.classes.has('is-hidden')), false);
});

test('applyFilter matches multi-word queries as AND', () => {
    const index = fakeIndex([
        ['a', 'docker compose https://docs.docker.com'],
        ['b', 'docker hub https://hub.docker.com'],
        ['c', 'compose for podman https://podman.io'],
    ]);
    assert.equal(applyFilter(index, 'compose docker'), 1);
    assert.equal(index.els[0]!.classes.has('is-hidden'), false);
});
