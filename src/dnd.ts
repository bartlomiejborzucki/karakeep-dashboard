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
let dragging = false;
let root: Element | null = null;

export function isDragging(): boolean {
    return dragging;
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

export function destroySortables(): void {
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
                onStart: (evt) => {
                    dragging = true;
                    highlight(evt.from);
                },
                onMove: (evt) => {
                    highlight(evt.to);
                },
                onEnd: () => {
                    dragging = false;
                    clearHighlight();
                    onChange();
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
