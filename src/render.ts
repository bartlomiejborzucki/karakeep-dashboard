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
}

function renderBookmark(bookmark: Bookmark, options: Required<RenderOptions>, sink: Bookmark[]): string {
    // Emission order is recorded so the search index can zip against
    // querySelectorAll('.bookmark-item') without ever reading the DOM.
    sink.push(bookmark);

    const { bookmarkTarget: target, showTags } = options;
    const title = esc(bookmark.title);
    const url = esc(safeUrl(bookmark.url));
    const favicon = esc(faviconUrlFor(bookmark));
    // The description only ever appears on hover, so it costs no layout space.
    const tooltip = bookmark.description ? esc(`${bookmark.title} — ${bookmark.description}`) : title;

    return `
        <a href="${url}"
           class="bookmark-item"
           title="${tooltip}"
           target="${esc(target)}"
           rel="${target === '_blank' ? 'noopener noreferrer' : ''}"
           draggable="false">
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
        </a>
    `;
}

function renderList(list: ListNode, options: Required<RenderOptions>, sink: Bookmark[], level = 0): string {
    if (!list.hasContent) return '';
    const listClass = level === 0 ? 'list-section' : `nested-list-${level}`;
    const headingLevel = Math.min(level + 2, 6);

    // Note: the depth cap applies to the *class name* only — deeper lists still
    // render, styled as nested-list-2. That is the existing behaviour, kept as-is.
    return `
        <div class="${listClass}" data-list-id="${esc(list.id)}">
            <div class="list-header">
                <span class="list-icon">${esc(list.icon)}</span>
                <h${headingLevel} class="list-title">${esc(list.name)}</h${headingLevel}>
            </div>
            ${list.bookmarks.length > 0 ? `<div class="bookmark-grid">${list.bookmarks.map((b) => renderBookmark(b, options, sink)).join('')}</div>` : ''}
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
