// Normalization, snapshot assembly, and tree building.
// Everything expensive happens here on the *refresh* path, so the boot path can
// render straight from a cached snapshot with no transformation work.

import type { ApiBookmark, ApiList, ApiStats, Bookmark, List, ListNode, Snapshot } from './types.ts';

export const UNTITLED = 'Untitled';

// The old SQL used `ORDER BY COALESCE(b.title, bl.title)` under SQLite's default
// BINARY collation — byte order, so "Zebra" sorts before "apple". `localeCompare`
// would reshuffle nearly every card and break parity with the pre-API build.
export function compareBinary(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function resolveTitle(raw: ApiBookmark): string {
    const content = raw.content;
    const crawled = content && content.type === 'link' ? content.title : null;
    return raw.title || crawled || UNTITLED;
}

// Mirrors `WHERE b.type = 'link'` plus the agreed change: archived bookmarks are hidden.
export function normalizeBookmark(raw: ApiBookmark | null | undefined): Bookmark | null {
    if (!raw?.content || raw.content.type !== 'link' || !raw.content.url) return null;
    if (raw.archived === true) return null;

    const title = resolveTitle(raw);
    const url = raw.content.url;
    const tags = (raw.tags ?? []).map((t) => t.name).filter(Boolean);

    return {
        id: raw.id,
        title,
        url,
        favicon: raw.content.favicon || null,
        description: raw.content.description || raw.summary || null,
        tags,
        // Precomputed once here so the search filter never touches the DOM.
        hay: [title, url, ...tags].join(' ').toLowerCase(),
    };
}

export function normalizeList(raw: ApiList): List {
    return {
        id: raw.id,
        name: raw.name,
        icon: raw.icon ?? null,
        parentId: raw.parentId || null,
        type: raw.type ?? 'manual',
    };
}

function hashString(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
}

// Stats alone are not enough: renaming a bookmark or moving it between lists leaves
// every counter untouched. Folding in the (single, unpaginated) /lists response
// catches list-level edits; the rest is bounded by the refresh TTL.
export function computeFingerprint(stats: ApiStats | null, lists: readonly List[]): string {
    const s = stats ?? {};
    const byType = s.bookmarksByType ?? {};
    const statPart = [
        s.numBookmarks,
        s.numFavorites,
        s.numArchived,
        s.numTags,
        s.numLists,
        byType.link,
        byType.text,
        byType.asset,
    ].join('|');

    const listPart = lists
        .map((l) => `${l.id}|${l.name}|${l.icon ?? ''}|${l.parentId ?? ''}|${l.type}`)
        .sort()
        .join('\n');

    return `${hashString(statPart)}#${hashString(listPart)}`;
}

export interface PerList {
    listId: string;
    bookmarks: Bookmark[];
}

// Bookmarks living in several lists are stored once and referenced by `membership`,
// which preserves each list's sort order.
export function buildSnapshot(input: {
    lists: readonly List[];
    perList: readonly PerList[];
    fingerprint: string;
    serverId: string;
    schemaVersion: number;
}): Snapshot {
    const byId = new Map<string, Bookmark>();
    const membership: Record<string, string[]> = {};

    for (const { listId, bookmarks } of input.perList) {
        const ids: string[] = [];
        for (const b of bookmarks) {
            if (!byId.has(b.id)) byId.set(b.id, b);
            ids.push(b.id);
        }
        membership[listId] = ids;
    }

    return {
        schemaVersion: input.schemaVersion,
        serverId: input.serverId,
        fetchedAt: Date.now(),
        fingerprint: input.fingerprint,
        lists: [...input.lists].sort((a, b) => compareBinary(a.name, b.name)),
        bookmarks: [...byId.values()],
        membership,
    };
}

// Sorted by the string that is actually displayed, which keeps render, sort and
// search consistent. (The old SQL sorted by COALESCE but displayed `||`; those
// disagree when a user title is an empty string.)
export function sortBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
    return [...bookmarks].sort((a, b) => compareBinary(a.title, b.title));
}

/**
 * Builds the root list forest. Two fixes over the pre-API build:
 *  - `hasContent` is computed bottom-up once instead of the old O(n^2) recursion
 *    that ran inside both the root filter and every renderList call;
 *  - a `visited` guard, because a parentId cycle previously hung the browser.
 */
export function buildTree(snapshot: Snapshot, options: { includeSmartLists?: boolean; showEmptyLists?: boolean } = {}): ListNode[] {
    const { includeSmartLists = false, showEmptyLists = false } = options;
    const bookmarksById = new Map(snapshot.bookmarks.map((b) => [b.id, b]));
    const nodes = new Map<string, ListNode>();

    for (const list of snapshot.lists) {
        // Smart lists have no rows in `bookmarksInLists`, so the SQL build could never
        // show them. Rendering them by default would be a visible change.
        if (!includeSmartLists && list.type === 'smart') continue;

        const bookmarks: Bookmark[] = [];
        for (const id of snapshot.membership[list.id] ?? []) {
            const b = bookmarksById.get(id);
            if (b) bookmarks.push(b);
        }
        nodes.set(list.id, { ...list, children: [], bookmarks: sortBookmarks(bookmarks), hasContent: false });
    }

    const roots: ListNode[] = [];
    for (const node of nodes.values()) {
        const parent = node.parentId ? nodes.get(node.parentId) : undefined;
        if (parent && parent !== node) parent.children.push(node);
        else roots.push(node);
    }

    // Depth-first with a visited set: a cycle detaches rather than recursing forever.
    const visited = new Set<string>();
    function markContent(node: ListNode): boolean {
        if (visited.has(node.id)) return false;
        visited.add(node.id);

        node.children = node.children.filter((child) => markContent(child));
        node.hasContent = node.bookmarks.length > 0 || node.children.length > 0 || (showEmptyLists && node.type === 'manual');
        return node.hasContent;
    }

    const visibleRoots = roots.filter((node) => markContent(node));

    // Any node not reached above is part of a cycle; surface it as a root so its
    // bookmarks are not silently lost.
    for (const node of nodes.values()) {
        if (!visited.has(node.id) && markContent(node)) visibleRoots.push(node);
    }

    return visibleRoots;
}
