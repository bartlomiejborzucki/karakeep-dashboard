/**
 * Shared shapes.
 *
 * `Api*` types mirror what Karakeep actually sends and are therefore permissive:
 * anything nullable in the OpenAPI spec is nullable here, so the compiler forces
 * every access through the same guards the runtime needs. Everything after
 * normalization is strict and non-null.
 */

/* ------------------------------------------------------------------ raw API */

export interface ApiUser {
    id: string;
    name?: string | null;
    email?: string | null;
    localUser?: boolean;
}

export interface ApiStats {
    numBookmarks?: number;
    numFavorites?: number;
    numArchived?: number;
    numTags?: number;
    numLists?: number;
    bookmarksByType?: { link?: number; text?: number; asset?: number };
}

export type ListKind = 'manual' | 'smart';

export interface ApiList {
    id: string;
    name: string;
    icon: string | null;
    parentId: string | null;
    type?: ListKind;
}

export interface ApiLinkContent {
    type: 'link';
    url: string;
    title?: string | null;
    description?: string | null;
    favicon?: string | null;
    imageUrl?: string | null;
}

export interface ApiTextContent {
    type: 'text';
    text: string;
}

export interface ApiAssetContent {
    type: 'asset';
    assetId?: string;
}

export type ApiContent = ApiLinkContent | ApiTextContent | ApiAssetContent;

export interface ApiTag {
    id: string;
    name: string;
    attachedBy?: 'ai' | 'human';
}

export interface ApiBookmark {
    id: string;
    createdAt?: string;
    modifiedAt?: string | null;
    title?: string | null;
    archived?: boolean;
    favourited?: boolean;
    note?: string | null;
    summary?: string | null;
    tags?: ApiTag[];
    content?: ApiContent;
}

export interface PaginatedBookmarks {
    bookmarks: ApiBookmark[];
    nextCursor: string | null;
}

/* --------------------------------------------------------- normalized model */

export interface Bookmark {
    id: string;
    title: string;
    url: string;
    favicon: string | null;
    description: string | null;
    tags: string[];
    /** Lowercased title + url + tags, precomputed so filtering never reads the DOM. */
    hay: string;
}

export interface List {
    id: string;
    name: string;
    icon: string | null;
    parentId: string | null;
    type: ListKind;
}

export interface Snapshot {
    key?: string;
    schemaVersion: number;
    serverId: string;
    fetchedAt: number;
    fingerprint: string;
    lists: List[];
    /** Deduplicated: a bookmark in three lists is stored once. */
    bookmarks: Bookmark[];
    /** listId -> bookmark ids, preserving that list's sort order. */
    membership: Record<string, string[]>;
}

export interface ListNode extends List {
    children: ListNode[];
    bookmarks: Bookmark[];
    hasContent: boolean;
}

/* --------------------------------------------------------------- app state */

export interface Credentials {
    baseUrl: string;
    apiKey: string;
    userId: string | null;
}

export type ColumnLayout = Record<string, string[]>;

export interface Prefs {
    columnLayout: ColumnLayout | null;
    columnOrder: string[];
    bookmarkTarget: '_self' | '_blank';
    includeSmartLists: boolean;
    numColumns: number;
    showTags: boolean;
}

export interface ErrorInfo {
    title: string;
    message: string;
    hint?: string;
}
