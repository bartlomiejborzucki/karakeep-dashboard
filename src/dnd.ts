// Drag-and-drop column arrangement.
//
// SortableJS is now an npm dependency bundled at build time rather than an
// unpinned `@latest` script from a CDN — a supply-chain hole on a page that holds
// an API token, and a hard dependency on the public internet for a LAN dashboard.
//
// Instances are tracked so a background refresh can tear them down before swapping
// the DOM; the old build created four per render and never destroyed them, which
// only stayed harmless while render ran exactly once.

import Sortable from 'sortablejs';
import type { ColumnLayout } from './types.ts';

let instances: Sortable[] = [];
let bookmarkInstances: Sortable[] = [];
let dragging = false;
let bookmarkDragging = false;
let root: Element | null = null;

let wasJustDragged = false;

export function isDragging(): boolean {
    return dragging || bookmarkDragging;
}

export function recentlyDragged(): boolean {
    return wasJustDragged;
}

// `add`/`remove` only fire on drop, so they cannot drive a hover indicator: they
// would paint the destination column at the exact moment the drag ends and leave
// it painted. The live signal is `move`, which fires on every hover change.
function highlight(column: Element | null): void {
    for (const el of root?.querySelectorAll('.drag-over-column') ?? []) {
        if (el !== column) el.classList.remove('drag-over-column');
    }
    column?.classList.add('drag-over-column');
}

function clearHighlight(): void {
    for (const el of root?.querySelectorAll('.drag-over-column') ?? []) {
        el.classList.remove('drag-over-column');
    }
}

function highlightDropTarget(target: Element | null): void {
    const archiveZone = document.getElementById('archiveDropzone');
    const trashZone = document.getElementById('trashDropzone');
    if (archiveZone) {
        archiveZone.classList.toggle('drag-over', target === archiveZone || Boolean(archiveZone?.contains(target as Node)));
    }
    if (trashZone) {
        trashZone.classList.toggle('drag-over', target === trashZone || Boolean(trashZone?.contains(target as Node)));
    }
}

function clearDropTargetHighlight(): void {
    document.getElementById('archiveDropzone')?.classList.remove('drag-over');
    document.getElementById('trashDropzone')?.classList.remove('drag-over');
}

export function destroyBookmarkSortables(): void {
    clearDropTargetHighlight();
    document.body.classList.remove('is-dragging-bookmark');
    for (const instance of bookmarkInstances) {
        try {
            instance.destroy();
        } catch {
            /* ignore */
        }
    }
    bookmarkInstances = [];
    bookmarkDragging = false;
}

export function destroySortables(): void {
    destroyBookmarkSortables();
    clearHighlight();
    for (const instance of instances) {
        try {
            instance.destroy();
        } catch {
            /* ignore */
        }
    }
    instances = [];
    dragging = false;
    wasJustDragged = false;
    root = null;
}

export function initSortable(container: Element, onChange: () => void): void {
    destroySortables();
    root = container;

    for (const column of container.querySelectorAll<HTMLElement>('.grid-column')) {
        instances.push(
            Sortable.create(column, {
                group: 'shared-lists',
                animation: 150,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                filter: '.list-collapse-btn, .list-collapse-btn *, a, .bookmark-item',
                preventOnFilter: false,
                onStart: (evt) => {
                    dragging = true;
                    wasJustDragged = true;
                    highlight(evt.from);
                },
                onMove: (evt) => {
                    highlight(evt.to);
                },
                onEnd: () => {
                    dragging = false;
                    clearHighlight();
                    onChange();
                    setTimeout(() => {
                        wasJustDragged = false;
                    }, 150);
                },
            })
        );
    }
}

function acceptsBookmarks(el: HTMLElement): boolean {
    const type = el.dataset['listType'];
    return type !== 'smart' && type !== 'favourites';
}

export interface BookmarkDndHandlers {
    onMoveBookmark: (bookmarkId: string, fromListId: string, toListId: string) => void;
    onArchiveBookmark: (bookmarkId: string, fromListId: string) => void;
    onDeleteBookmark: (bookmarkId: string, fromListId: string) => void;
}

export function initBookmarkSortables(container: Element, handlers: BookmarkDndHandlers): void {
    destroyBookmarkSortables();

    for (const grid of container.querySelectorAll<HTMLElement>('.bookmark-grid')) {
        // Smart lists and the favourites list are computed, not curated: nothing can
        // be dragged into or out of them.
        if (!acceptsBookmarks(grid)) continue;
        bookmarkInstances.push(
            Sortable.create(grid, {
                group: {
                    name: 'bookmarks',
                    pull: true,
                    put: (to) => acceptsBookmarks(to.el),
                },
                animation: 150,
                ghostClass: 'bookmark-ghost',
                dragClass: 'bookmark-drag',
                chosenClass: 'bookmark-chosen',
                filter: '.empty-list-dropzone, .bookmark-action-btn, .bookmark-edit-actions',
                preventOnFilter: false,
                onStart: () => {
                    bookmarkDragging = true;
                    wasJustDragged = true;
                    document.body.classList.add('is-dragging-bookmark');
                },
                onMove: (evt) => {
                    highlightDropTarget(evt.to);
                },
                onEnd: () => {
                    bookmarkDragging = false;
                    document.body.classList.remove('is-dragging-bookmark');
                    clearDropTargetHighlight();
                    setTimeout(() => {
                        wasJustDragged = false;
                    }, 150);
                },
                onAdd: (evt) => {
                    const item = evt.item;
                    const bookmarkId = item.dataset['bookmarkId'];
                    const fromListId = evt.from.dataset['listId'];
                    const toListId = evt.to.dataset['listId'];
                    if (bookmarkId && fromListId && toListId && fromListId !== toListId) {
                        handlers.onMoveBookmark(bookmarkId, fromListId, toListId);
                    }
                },
            })
        );
    }

    const archiveZone = document.getElementById('archiveDropzone');
    if (archiveZone) {
        bookmarkInstances.push(
            Sortable.create(archiveZone, {
                group: {
                    name: 'bookmarks',
                    pull: false,
                    put: true,
                },
                animation: 150,
                onAdd: (evt) => {
                    const item = evt.item;
                    const bookmarkId = item.dataset['bookmarkId'];
                    const fromListId = evt.from.dataset['listId'];
                    item.remove();
                    if (bookmarkId && fromListId) {
                        handlers.onArchiveBookmark(bookmarkId, fromListId);
                    }
                },
            })
        );
    }

    const trashZone = document.getElementById('trashDropzone');
    if (trashZone) {
        bookmarkInstances.push(
            Sortable.create(trashZone, {
                group: {
                    name: 'bookmarks',
                    pull: false,
                    put: true,
                },
                animation: 150,
                onAdd: (evt) => {
                    const item = evt.item;
                    const bookmarkId = item.dataset['bookmarkId'];
                    const fromListId = evt.from.dataset['listId'];
                    item.remove();
                    if (bookmarkId && fromListId) {
                        handlers.onDeleteBookmark(bookmarkId, fromListId);
                    }
                },
            })
        );
    }
}

export interface LayoutSnapshot {
    columnLayout: ColumnLayout;
    columnOrder: string[];
}

/** Reads the arrangement back out of the DOM after a drag. */
export function readLayoutFromDom(container: Element): LayoutSnapshot {
    const columnLayout: ColumnLayout = {};
    const columns = container.querySelectorAll('.grid-column');

    columns.forEach((column, index) => {
        columnLayout[String(index)] = Array.from(
            column.querySelectorAll<HTMLElement>(':scope > .list-section')
        )
            .map((card) => card.dataset['listId'])
            .filter((id): id is string => Boolean(id));
    });

    // Flat order is still written for backward compatibility with the old build.
    const columnOrder: string[] = [];
    for (let i = 0; i < columns.length; i++) {
        columnOrder.push(...(columnLayout[String(i)] ?? []));
    }

    return { columnLayout, columnOrder };
}
