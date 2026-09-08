// Search filtering over a precomputed index.
//
// The previous implementation re-read textContent and attributes from hundreds of
// DOM nodes on every keystroke and wrote inline styles, forcing layout each time.
// Here the haystacks are computed at normalization time and the index is built once
// per render, so filtering is a linear scan of strings followed by class writes —
// no DOM reads at all.

import type { Bookmark } from './types.ts';

const GROUP_SELECTOR = '.list-section, .nested-list-1, .nested-list-2';

interface IndexItem {
    el: Element;
    hay: string;
}

interface IndexGroup {
    el: Element;
    itemIdx: number[];
}

interface IndexColumn {
    el: Element;
    sectionIdx: number[];
}

export interface SearchIndex {
    container: Element;
    items: IndexItem[];
    groups: IndexGroup[];
    columns: IndexColumn[];
}

export function buildIndex(container: Element, modelItems: readonly Bookmark[]): SearchIndex {
    const anchors = container.querySelectorAll('.bookmark-item');
    const items: IndexItem[] = [];
    const indexOfEl = new Map<Element, number>();

    // querySelectorAll returns document order, which is exactly the order renderGrid
    // emitted the bookmarks in, so the two zip 1:1.
    const count = Math.min(anchors.length, modelItems.length);
    for (let i = 0; i < count; i++) {
        const el = anchors[i]!;
        items.push({ el, hay: modelItems[i]!.hay });
        indexOfEl.set(el, i);
    }

    const groups: IndexGroup[] = [];
    for (const el of container.querySelectorAll(GROUP_SELECTOR)) {
        const itemIdx: number[] = [];
        for (const a of el.querySelectorAll('.bookmark-item')) {
            const i = indexOfEl.get(a);
            if (i !== undefined) itemIdx.push(i);
        }
        groups.push({ el, itemIdx });
    }

    const groupIndexOfEl = new Map(groups.map((g, i) => [g.el, i]));
    const columns: IndexColumn[] = [];
    for (const el of container.querySelectorAll('.grid-column')) {
        const sectionIdx: number[] = [];
        for (const section of el.querySelectorAll(':scope > .list-section')) {
            const i = groupIndexOfEl.get(section);
            if (i !== undefined) sectionIdx.push(i);
        }
        columns.push({ el, sectionIdx });
    }

    return { container, items, groups, columns };
}

/** Number of bookmarks still visible; the caller uses 0 to offer a server-side search. */
export function applyFilter(index: SearchIndex | null, rawTerm: string): number {
    if (!index) return 0;
    const term = rawTerm.toLowerCase().trim();
    const grid = index.container.querySelector('.grid-container');

    if (!term) {
        for (const item of index.items) item.el.classList.remove('is-hidden');
        for (const group of index.groups) group.el.classList.remove('is-hidden');
        for (const column of index.columns) column.el.classList.remove('is-hidden');
        grid?.classList.remove('is-filtering');
        return index.items.length;
    }

    grid?.classList.add('is-filtering');

    const visible = new Uint8Array(index.items.length);
    let matches = 0;
    for (let i = 0; i < index.items.length; i++) {
        const match = index.items[i]!.hay.includes(term);
        visible[i] = match ? 1 : 0;
        if (match) matches++;
        index.items[i]!.el.classList.toggle('is-hidden', !match);
    }

    const groupVisible = new Uint8Array(index.groups.length);
    for (let g = 0; g < index.groups.length; g++) {
        const group = index.groups[g]!;
        const any = group.itemIdx.some((i) => visible[i]);
        groupVisible[g] = any ? 1 : 0;
        group.el.classList.toggle('is-hidden', !any);
    }

    for (const column of index.columns) {
        const any = column.sectionIdx.some((g) => groupVisible[g]);
        column.el.classList.toggle('is-hidden', !any);
    }

    return matches;
}

// The filter is now cheaper than the 300ms debounce that used to hide its cost,
// so coalesce per frame instead of delaying by a third of a second.
export function attachSearch(
    inputEl: HTMLInputElement,
    onFilter: (term: string) => void
): () => void {
    let frame = 0;
    const onInput = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            onFilter(inputEl.value);
        });
    };

    inputEl.addEventListener('input', onInput);
    return () => {
        if (frame) cancelAnimationFrame(frame);
        inputEl.removeEventListener('input', onInput);
    };
}
