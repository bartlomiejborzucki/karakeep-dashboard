// HTML generation. The markup is deliberately the same as the pre-API build,
// except that values are now escaped, the inline onerror is gone (CSP), and
// favicons carry loading/decoding/size hints.

import type { Bookmark, ListNode, Prefs } from './types.ts';

// Null-safe: the old escapeHtml threw on a list with a null icon.
export function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Bookmark URLs come from crawled third-party pages. With an API token now living
// in localStorage, a `javascript:` href is token exfiltration, not a curiosity.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeUrl(value: string | null | undefined): string {
    if (!value) return '#';
    try {
        // Absolute URLs only. Resolving against location.href would let a relative
        // value from a crawled page point back at this origin.
        const url = new URL(String(value));
        return SAFE_PROTOCOLS.has(url.protocol) ? String(value) : '#';
    } catch {
        return '#';
    }
}

export function faviconUrlFor(bookmark: Pick<Bookmark, 'favicon' | 'url'>): string {
    if (bookmark.favicon) return bookmark.favicon;
    try {
        return `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}&sz=32`;
    } catch {
        return '';
    }
}

export interface RenderOptions {
    bookmarkTarget?: Prefs['bookmarkTarget'];
    showTags?: boolean;
    collapseListsByDefault?: boolean;
    collapseSublistsByDefault?: boolean;
    showBookmarkCounts?: boolean;
    collapsedOverrides?: Record<string, boolean>;
    editMode?: boolean;
    showEmptyLists?: boolean;
}

export function countBookmarks(node: ListNode): number {
    const ids = new Set<string>();
    function collect(n: ListNode) {
        for (const b of n.bookmarks) ids.add(b.id);
        for (const child of n.children) collect(child);
    }
    collect(node);
    return ids.size;
}

function renderBookmark(bookmark: Bookmark, options: Required<RenderOptions>, sink: Bookmark[]): string {
    // Emission order is recorded so the search index can zip against
    // querySelectorAll('.bookmark-item') without ever reading the DOM.
    sink.push(bookmark);

    const { bookmarkTarget: target, showTags, editMode } = options;
    const title = esc(bookmark.title);
    const url = esc(safeUrl(bookmark.url));
    const favicon = esc(faviconUrlFor(bookmark));
    // The description only ever appears on hover, so it costs no layout space.
    const tooltip = bookmark.description ? esc(`${bookmark.title} — ${bookmark.description}`) : title;

    return `
        <a href="${url}"
           class="bookmark-item${editMode ? ' is-editable' : ''}"
           data-bookmark-id="${esc(bookmark.id)}"
           title="${tooltip}"
           target="${esc(target)}"
           rel="${target === '_blank' ? 'noopener noreferrer' : ''}"
           draggable="false">
            ${editMode ? `
                <span class="bookmark-drag-handle" title="Przeciągnij">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="5" r="1.5" fill="currentColor"></circle>
                        <circle cx="9" cy="12" r="1.5" fill="currentColor"></circle>
                        <circle cx="9" cy="19" r="1.5" fill="currentColor"></circle>
                        <circle cx="15" cy="5" r="1.5" fill="currentColor"></circle>
                        <circle cx="15" cy="12" r="1.5" fill="currentColor"></circle>
                        <circle cx="15" cy="19" r="1.5" fill="currentColor"></circle>
                    </svg>
                </span>
            ` : ''}
            <div class="bookmark-content">
                ${favicon ? `
                    <img src="${favicon}"
                         alt=""
                         class="bookmark-favicon"
                         width="16"
                         height="16"
                         loading="lazy"
                         decoding="async"
                         referrerpolicy="no-referrer">
                ` : ''}
                <span class="bookmark-title">${title}</span>
                ${showTags && bookmark.tags.length ? `<span class="bookmark-tags">${bookmark.tags.map((t) => `<span class="bookmark-tag">${esc(t)}</span>`).join('')}</span>` : ''}
            </div>
            ${editMode ? `
                <div class="bookmark-edit-actions">
                    <button type="button" class="bookmark-action-btn btn-archive" data-action="archive" title="Przenieś do archiwum" aria-label="Archiwizuj">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="21 8 21 21 3 21 3 8"></polyline>
                            <rect x="1" y="3" width="22" height="5"></rect>
                            <line x1="10" y1="12" x2="14" y2="12"></line>
                        </svg>
                    </button>
                    <button type="button" class="bookmark-action-btn btn-delete" data-action="delete" title="Usuń" aria-label="Usuń">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            ` : ''}
        </a>
    `;
}

function renderList(list: ListNode, options: Required<RenderOptions>, sink: Bookmark[], level = 0): string {
    if (!list.hasContent && !options.showEmptyLists) return '';
    const isSublist = level > 0;
    const isCollapsed = list.id in options.collapsedOverrides
        ? Boolean(options.collapsedOverrides[list.id])
        : (isSublist ? options.collapseSublistsByDefault : options.collapseListsByDefault);

    const listClass = level === 0 ? 'list-section' : `nested-list-${level}`;
    const headingLevel = Math.min(level + 2, 6);
    const count = countBookmarks(list);

    // Note: the depth cap applies to the *class name* only — deeper lists still
    // render, styled as nested-list-2. That is the existing behaviour, kept as-is.
    return `
        <div class="${listClass}${isCollapsed ? ' is-collapsed' : ''}" data-list-id="${esc(list.id)}" data-list-type="${esc(list.type)}">
            <div class="list-header">
                <button type="button"
                        class="list-collapse-btn"
                        aria-label="Toggle ${esc(list.name)}"
                        aria-expanded="${isCollapsed ? 'false' : 'true'}"
                        title="${isCollapsed ? 'Expand' : 'Collapse'}">
                    <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <span class="list-icon">${esc(list.icon)}</span>
                <h${headingLevel} class="list-title">${esc(list.name)}</h${headingLevel}>
                ${options.showBookmarkCounts ? `<span class="list-count" title="${count} ${count === 1 ? 'bookmark' : 'bookmarks'}">${count}</span>` : ''}
            </div>
            <div class="bookmark-grid${list.bookmarks.length === 0 ? ' is-empty' : ''}" data-list-id="${esc(list.id)}" data-list-type="${esc(list.type)}">
                ${list.bookmarks.map((b) => renderBookmark(b, options, sink)).join('')}
                ${list.bookmarks.length === 0 ? `<div class="empty-list-dropzone"><span>Brak zakładek</span></div>` : ''}
            </div>
            ${list.children.map((child) => renderList(child, options, sink, Math.min(level + 1, 2))).join('')}
        </div>
    `;
}

/**
 * Places root lists into columns: saved columnLayout first, then the legacy flat
 * columnOrder, then plain round-robin. Lists missing from a saved layout are
 * appended across columns, matching the previous behaviour.
 */
export function distributeColumns(lists: readonly ListNode[], prefs: Pick<Prefs, 'columnLayout' | 'columnOrder' | 'numColumns'>): ListNode[][] {
    const count = Math.max(1, prefs.numColumns);
    const columns: ListNode[][] = Array.from({ length: count }, () => []);

    if (prefs.columnLayout) {
        const listMap = new Map(lists.map((l) => [l.id, l]));
        for (let col = 0; col < count; col++) {
            for (const id of prefs.columnLayout[String(col)] ?? []) {
                const list = listMap.get(id);
                if (list) {
                    columns[col]!.push(list);
                    listMap.delete(id);
                }
            }
        }
        // Anything saved into a column that no longer exists (the user reduced the
        // column count) must still be placed rather than silently dropped.
        let i = 0;
        for (const list of listMap.values()) {
            columns[i % count]!.push(list);
            i++;
        }
        return columns;
    }

    let ordered: ListNode[] = [...lists];
    if (prefs.columnOrder.length > 0) {
        const listMap = new Map(lists.map((l) => [l.id, l]));
        ordered = [];
        for (const id of prefs.columnOrder) {
            const list = listMap.get(id);
            if (list) {
                ordered.push(list);
                listMap.delete(id);
            }
        }
        ordered.push(...listMap.values());
    }

    ordered.forEach((list, index) => columns[index % count]!.push(list));
    return columns;
}

export interface RenderResult {
    html: string;
    items: Bookmark[];
}

/** Returns the grid HTML plus the bookmarks in DOM emission order. */
export function renderGrid(columns: readonly ListNode[][], options: RenderOptions = {}): RenderResult {
    const resolved: Required<RenderOptions> = {
        bookmarkTarget: options.bookmarkTarget ?? '_self',
        showTags: options.showTags ?? false,
        collapseListsByDefault: options.collapseListsByDefault ?? false,
        collapseSublistsByDefault: options.collapseSublistsByDefault ?? false,
        showBookmarkCounts: options.showBookmarkCounts ?? true,
        collapsedOverrides: options.collapsedOverrides ?? {},
        editMode: options.editMode ?? false,
        showEmptyLists: options.showEmptyLists ?? false,
    };
    const items: Bookmark[] = [];

    // The column count is expressed as a class rather than an inline style: the CSP
    // sets style-src 'self', which blocks style="" attributes.
    const html = `
        <div class="grid-container cols-${columns.length}">
            ${columns.map((col, index) => `
                <div class="grid-column" data-column-index="${index}">
                    ${col.map((list) => renderList(list, resolved, items)).join('')}
                </div>
            `).join('')}
        </div>
    `;

    return { html, items };
}

export function renderLoading(message: string): string {
    return `
        <div class="loading">
            <div class="spinner"></div>
            <p>${esc(message)}</p>
        </div>
    `;
}

export function renderEmpty(): string {
    return `
        <div class="error">
            <h2>No bookmarks to show</h2>
            <p>None of your Karakeep lists contain link bookmarks yet.</p>
            <small>Add a bookmark to a list in Karakeep, then refresh.</small>
        </div>
    `;
}

/** Results from the server-side search fallback, rendered as one flat list. */
export function renderRemoteResults(bookmarks: readonly Bookmark[], query: string, options: RenderOptions = {}): RenderResult {
    const resolved: Required<RenderOptions> = {
        bookmarkTarget: options.bookmarkTarget ?? '_self',
        showTags: options.showTags ?? false,
        collapseListsByDefault: options.collapseListsByDefault ?? false,
        collapseSublistsByDefault: options.collapseSublistsByDefault ?? false,
        showBookmarkCounts: options.showBookmarkCounts ?? true,
        collapsedOverrides: options.collapsedOverrides ?? {},
        editMode: options.editMode ?? false,
        showEmptyLists: options.showEmptyLists ?? false,
    };
    const items: Bookmark[] = [];

    const body = bookmarks.length
        ? `<div class="bookmark-grid">${bookmarks.map((b) => renderBookmark(b, resolved, items)).join('')}</div>`
        : '<p class="remote-empty">Karakeep found nothing either.</p>';

    return {
        html: `
        <div class="remote-results">
            <div class="remote-head">
                <h2>Found in Karakeep</h2>
                <span>${bookmarks.length} result${bookmarks.length === 1 ? '' : 's'} for &ldquo;${esc(query)}&rdquo;</span>
                <button type="button" data-action="close-remote">Back</button>
            </div>
            ${body}
        </div>
    `,
        items,
    };
}
