// Boot orchestration and background revalidation.
//
// The ordering rule that makes this fast: nothing on the path to first paint may
// touch the network. Credentials and preferences come from localStorage
// synchronously, the view model comes from one IndexedDB read, and only once the
// grid is on screen does revalidation begin.

import {
    DEFAULT_URL,
    FANOUT_CONCURRENCY,
    FULL_REFETCH_TTL_MS,
    CACHE_MAX_AGE_MS,
    SCHEMA_VERSION,
} from './config.ts';
import {
    readCredentials,
    writeCredentials,
    clearApiKey,
    clearCredentials,
    readPrefs,
    updatePrefs,
    clampColumns,
    serverId,
    readCollapsedOverrides,
    writeCollapsedOverrides,
    clearCollapsedOverrides,
    isListCollapsed,
} from './storage.ts';
import { readSnapshot, writeSnapshot, clearCache } from './cache.ts';
import {
    ApiError,
    createClient,
    mapWithConcurrency,
    normalizeBaseUrl,
    isMixedContent,
    type KarakeepClient,
} from './api.ts';
import {
    normalizeBookmark,
    normalizeList,
    buildSnapshot,
    buildTree,
    computeFingerprint,
    sortBookmarks,
    type PerList,
} from './model.ts';
import {
    distributeColumns,
    renderGrid,
    renderLoading,
    renderEmpty,
    renderRemoteResults,
} from './render.ts';
import { buildIndex, applyFilter, attachSearch, type SearchIndex } from './search.ts';
import {
    initSortable,
    initBookmarkSortables,
    destroySortables,
    readLayoutFromDom,
    isDragging,
    recentlyDragged,
} from './dnd.ts';
import {
    renderSetup,
    renderSettings,
    renderRemotePrompt,
    describeError,
    showToast,
    showBanner,
    hideBanner,
    formatAgo,
    showConfirmDialog,
} from './ui.ts';
import type { ApiUser, Credentials, List, Prefs, Snapshot } from './types.ts';

const content = () => document.getElementById('content')!;
const searchInput = () => document.getElementById('searchInput') as HTMLInputElement | null;

interface AppState {
    creds: Credentials | null;
    prefs: Prefs;
    snapshot: Snapshot | null;
    index: SearchIndex | null;
    mountedHtml: string;
    revalidating: boolean;
    // A revalidation requested while one was running. Dropping it would lose the
    // rollback that a failed edit-mode action relies on, so it runs afterwards.
    queuedRevalidate: { force: boolean } | null;
    pendingRender: Snapshot | null;
    remoteMode: boolean;
    partial: boolean;
    editMode: boolean;
}

const state: AppState = {
    creds: null,
    prefs: readPrefs(),
    snapshot: null,
    index: null,
    mountedHtml: '',
    revalidating: false,
    queuedRevalidate: null,
    pendingRender: null,
    remoteMode: false,
    partial: false,
    editMode: false,
};

const renderOptions = () => ({
    bookmarkTarget: state.prefs.bookmarkTarget,
    showTags: state.prefs.showTags,
    collapseListsByDefault: state.prefs.collapseListsByDefault,
    collapseSublistsByDefault: state.prefs.collapseSublistsByDefault,
    showBookmarkCounts: state.prefs.showBookmarkCounts,
    collapsedOverrides: readCollapsedOverrides(),
    editMode: state.editMode,
    showEmptyLists: state.editMode,
});

function updateFooter(total: number, matching?: number | null): void {
    const footer = document.getElementById('footer');
    if (!footer) return;
    if (total === 0) {
        footer.hidden = true;
        footer.textContent = '';
        return;
    }
    footer.hidden = false;
    if (matching != null && matching < total) {
        footer.textContent = `Showing ${matching} of ${total} bookmarks`;
    } else {
        footer.textContent = `${total} ${total === 1 ? 'bookmark' : 'bookmarks'}`;
    }
}

/* ------------------------------------------------------------------ rendering */

function currentGrid(snapshot: Snapshot) {
    const roots = buildTree(snapshot, {
        includeSmartLists: state.prefs.includeSmartLists,
        showEmptyLists: state.editMode,
    });
    return renderGrid(distributeColumns(roots, state.prefs), renderOptions());
}

function mountGrid(snapshot: Snapshot): boolean {
    const { html, items } = currentGrid(snapshot);
    const body = items.length === 0 ? renderEmpty() : html;

    // Only touch the DOM when the output actually differs. A no-op revalidation
    // must not blow away scroll position, drag state or the search results.
    if (body === state.mountedHtml) return false;

    // A drag in progress and server-side search results both own the DOM. Park the
    // snapshot; persistLayout / exitRemoteMode render it once they hand the DOM back.
    if (isDragging() || state.remoteMode) {
        state.pendingRender = snapshot;
        return false;
    }

    const scrollY = window.scrollY;
    destroySortables();
    content().innerHTML = body;
    state.mountedHtml = body;
    state.index = items.length === 0 ? null : buildIndex(content(), items);

    const term = searchInput()?.value ?? '';
    if (term) runFilter(term);
    else updateFooter(snapshot.bookmarks.length);
    window.scrollTo(0, scrollY);

    if (state.editMode) {
        idle(() =>
            initBookmarkSortables(content(), {
                onMoveBookmark: handleMoveBookmark,
                onArchiveBookmark: handleArchiveBookmark,
                onDeleteBookmark: handleDeleteBookmark,
            })
        );
    } else {
        idle(() => initSortable(content(), persistLayout));
    }
    return true;
}

function idle(fn: () => void): void {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 500 });
    else setTimeout(fn, 0);
}

function persistLayout(): void {
    state.prefs = updatePrefs(readLayoutFromDom(content()));

    // A revalidation that landed mid-drag was parked. Render it first, now that the
    // new arrangement is saved and will be reproduced by the render. Doing this after
    // the reference HTML is regenerated below would make the two compare equal and
    // silently drop the refresh.
    if (state.pendingRender) {
        const pending = state.pendingRender;
        state.pendingRender = null;
        if (mountGrid(pending)) {
            showToast('Bookmarks updated.');
            return;
        }
    }

    // Sortable moved the existing nodes, so the DOM is already correct; rebuilding it
    // would be visible churn for no gain. Regenerate the reference HTML so the next
    // revalidation compares against what is on screen, and rebuild the search index,
    // because a card may have changed column.
    if (state.snapshot) {
        const { html, items } = currentGrid(state.snapshot);
        state.mountedHtml = html;
        state.index = buildIndex(content(), items);
    }
}

/* ----------------------------------------------------------------- edit mode */

function toggleEditMode(): void {
    if (state.remoteMode) exitRemoteMode();
    state.editMode = !state.editMode;

    const btn = document.getElementById('editModeButton');
    const bar = document.getElementById('editActionBar');

    if (btn) {
        btn.classList.toggle('is-active', state.editMode);
        btn.setAttribute('title', state.editMode ? 'Exit edit mode' : 'Edit mode');
        btn.setAttribute('aria-label', state.editMode ? 'Exit edit mode' : 'Enter edit mode');
    }

    if (bar) {
        bar.hidden = !state.editMode;
    }

    document.body.classList.toggle('edit-mode-active', state.editMode);

    state.mountedHtml = '';
    if (state.snapshot) {
        mountGrid(state.snapshot);
    }
}

async function handleMoveBookmark(bookmarkId: string, fromListId: string, toListId: string): Promise<void> {
    if (!state.creds || !state.snapshot) return;

    const snapshot = state.snapshot;
    const fromMembership = snapshot.membership[fromListId] ?? [];
    const toMembership = snapshot.membership[toListId] ?? [];

    snapshot.membership[fromListId] = fromMembership.filter((id) => id !== bookmarkId);
    if (!toMembership.includes(bookmarkId)) {
        snapshot.membership[toListId] = [...toMembership, bookmarkId];
    }

    await writeSnapshot(snapshot);
    state.mountedHtml = '';
    mountGrid(snapshot);

    const toListName = snapshot.lists.find((l) => l.id === toListId)?.name ?? 'list';
    showToast(`Moved to “${toListName}”.`);

    try {
        const client = createClient(state.creds);
        await client.addBookmarkToList(toListId, bookmarkId);
        await client.removeBookmarkFromList(fromListId, bookmarkId);
    } catch (err) {
        showToast(`Move failed: ${(err as Error).message}`, { kind: 'warn' });
        await revalidate({ force: true });
    }
}

async function handleArchiveBookmark(bookmarkId: string, fromListId: string): Promise<void> {
    if (!state.creds || !state.snapshot) return;

    const snapshot = state.snapshot;
    const bm = snapshot.bookmarks.find((b) => b.id === bookmarkId);
    const title = bm?.title ?? 'bookmark';

    const fromMembership = snapshot.membership[fromListId] ?? [];
    snapshot.membership[fromListId] = fromMembership.filter((id) => id !== bookmarkId);

    let inOtherList = false;
    for (const [lId, ids] of Object.entries(snapshot.membership)) {
        if (lId !== fromListId && ids.includes(bookmarkId)) {
            inOtherList = true;
            break;
        }
    }
    if (!inOtherList) {
        snapshot.bookmarks = snapshot.bookmarks.filter((b) => b.id !== bookmarkId);
    }

    await writeSnapshot(snapshot);
    state.mountedHtml = '';
    mountGrid(snapshot);
    updateFooter(snapshot.bookmarks.length);
    showToast(`Archived “${title}”.`);

    try {
        const client = createClient(state.creds);
        await client.archiveBookmark(bookmarkId);
    } catch (err) {
        showToast(`Archive failed: ${(err as Error).message}`, { kind: 'warn' });
        await revalidate({ force: true });
    }
}

async function handleDeleteBookmark(bookmarkId: string, _fromListId?: string): Promise<void> {
    if (!state.creds || !state.snapshot) return;

    const snapshot = state.snapshot;
    const bm = snapshot.bookmarks.find((b) => b.id === bookmarkId);
    const title = bm?.title ?? 'this bookmark';

    const confirmed = await showConfirmDialog({
        title: 'Delete bookmark?',
        message: `Permanently delete “${title}”? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true,
    });

    if (!confirmed) {
        state.mountedHtml = '';
        mountGrid(snapshot);
        return;
    }

    for (const lId of Object.keys(snapshot.membership)) {
        snapshot.membership[lId] = (snapshot.membership[lId] ?? []).filter((id) => id !== bookmarkId);
    }
    snapshot.bookmarks = snapshot.bookmarks.filter((b) => b.id !== bookmarkId);

    await writeSnapshot(snapshot);
    state.mountedHtml = '';
    mountGrid(snapshot);
    updateFooter(snapshot.bookmarks.length);
    showToast(`Deleted “${title}”.`);

    try {
        const client = createClient(state.creds);
        await client.deleteBookmark(bookmarkId);
    } catch (err) {
        showToast(`Delete failed: ${(err as Error).message}`, { kind: 'warn' });
        await revalidate({ force: true });
    }
}

/* -------------------------------------------------------------------- search */

function runFilter(term: string): void {
    if (state.remoteMode) return;
    const matches = applyFilter(state.index, term);
    const total = state.snapshot?.bookmarks.length ?? 0;
    updateFooter(total, term.trim() ? matches : null);

    const host = document.getElementById('remotePrompt');
    if (!host) return;

    // Only offer the server-side search once the local cache has definitively failed.
    if (term.trim() && matches === 0 && state.creds?.apiKey) {
        host.innerHTML = renderRemotePrompt(term.trim());
        host.hidden = false;
    } else {
        host.innerHTML = '';
        host.hidden = true;
    }
}

async function runRemoteSearch(query: string): Promise<void> {
    if (!state.creds?.apiKey) return;
    const host = document.getElementById('remotePrompt')!;
    host.innerHTML = renderRemotePrompt(query).replace('Search all of Karakeep', 'Searching…');

    try {
        const raw = await createClient(state.creds).searchBookmarks(query);
        const bookmarks = sortBookmarks(raw.map(normalizeBookmark).filter((b) => b !== null));
        const { html, items } = renderRemoteResults(bookmarks, query, renderOptions());
        updateFooter(0);

        destroySortables();
        content().innerHTML = html;
        state.remoteMode = true;
        state.index = buildIndex(content(), items);
        host.innerHTML = '';
        host.hidden = true;
    } catch (err) {
        showToast(describeError(err, state.creds.baseUrl).message, { kind: 'warn' });
        host.innerHTML = renderRemotePrompt(query);
    }
}

function exitRemoteMode(): void {
    if (!state.remoteMode) return;
    state.remoteMode = false;
    state.mountedHtml = '';
    const input = searchInput();
    if (input) input.value = '';

    // Prefer a refresh that arrived while the remote results were up.
    const pending = state.pendingRender;
    state.pendingRender = null;
    const snapshot = pending ?? state.snapshot;

    if (snapshot) {
        mountGrid(snapshot);
        return;
    }

    // Reachable via "Clear cache" -> search -> remote search: there is no grid to go
    // back to, and leaving the results up would make the button look broken.
    updateFooter(0);
    state.index = null;
    content().innerHTML = state.revalidating ? renderLoading('Loading bookmarks…') : renderEmpty();
}

/* --------------------------------------------------------------------- setup */

function showSetup(options: { baseUrl?: string; apiKey?: string; error?: ReturnType<typeof describeError> | null; busy?: boolean } = {}): void {
    updateFooter(0);
    destroySortables();
    state.index = null;
    state.mountedHtml = '';
    content().innerHTML = renderSetup({
        baseUrl: options.baseUrl || state.creds?.baseUrl || DEFAULT_URL,
        apiKey: options.apiKey ?? '',
        error: options.error ?? null,
        busy: options.busy ?? false,
    });

    document.getElementById('setupForm')?.addEventListener('submit', onSetupSubmit);
}

async function onSetupSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const rawUrl = (document.getElementById('setupUrl') as HTMLInputElement).value;
    const apiKey = (document.getElementById('setupKey') as HTMLInputElement).value.trim();

    let baseUrl: string;
    try {
        baseUrl = normalizeBaseUrl(rawUrl);
    } catch (err) {
        showSetup({ baseUrl: rawUrl, apiKey, error: { title: 'Invalid address', message: (err as Error).message } });
        return;
    }

    // Catch the https -> http case before issuing a request that the browser will
    // block with an error indistinguishable from "server down".
    if (isMixedContent(baseUrl)) {
        showSetup({ baseUrl: rawUrl, apiKey, error: describeError(new ApiError('mixed-content', ''), baseUrl) });
        return;
    }

    showSetup({ baseUrl: rawUrl, apiKey, busy: true });

    try {
        const me = await createClient({ baseUrl, apiKey }).getMe();
        state.creds = { baseUrl, apiKey, userId: me.id ?? null };
        writeCredentials(state.creds);
        syncKarakeepLink();
        hideBanner();
        content().innerHTML = renderLoading('Loading bookmarks…');
        state.snapshot = await readSnapshot(currentServerId());
        if (state.snapshot) mountGrid(state.snapshot);
        await revalidate({ force: true });
    } catch (err) {
        showSetup({ baseUrl: rawUrl, apiKey, error: describeError(err, baseUrl) });
    }
}

function currentServerId(): string {
    return serverId(state.creds!.baseUrl, state.creds!.userId);
}

/* -------------------------------------------------------------- revalidation */

// `lists` is passed in rather than refetched: the caller has already asked for it
// as part of the cheap change check.
async function fetchEverything(client: KarakeepClient, lists: readonly List[]) {
    const results = await mapWithConcurrency(lists, FANOUT_CONCURRENCY, async (list) => ({
        listId: list.id,
        bookmarks: (await client.getListBookmarks(list.id)).map(normalizeBookmark).filter((b) => b !== null),
    }));

    const perList: PerList[] = [];
    const failed: List[] = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) perList.push(result.value);
        else failed.push(lists[i]!);
    });

    // A list that failed keeps whatever we already had, so a flaky refresh degrades
    // to "slightly stale" rather than "bookmarks vanished".
    if (failed.length && state.snapshot) {
        const byId = new Map(state.snapshot.bookmarks.map((b) => [b.id, b]));
        for (const list of failed) {
            const ids = state.snapshot.membership[list.id];
            if (!ids) continue;
            perList.push({
                listId: list.id,
                bookmarks: ids.map((id) => byId.get(id)).filter((b) => b !== undefined),
            });
        }
    }

    // If every single list failed, the connection is the problem — surface it.
    if (lists.length > 0 && failed.length === lists.length) {
        const first = results.find((r) => r.status === 'rejected');
        throw first?.reason ?? new ApiError('network', 'Every list failed to load.');
    }

    return { perList, failed };
}

async function revalidate({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!state.creds?.apiKey) return;
    if (state.revalidating) {
        state.queuedRevalidate = { force: force || Boolean(state.queuedRevalidate?.force) };
        return;
    }
    state.revalidating = true;

    const client = createClient(state.creds);
    try {
        const [stats, rawLists] = await Promise.all([client.getStats(), client.getLists()]);
        const lists = rawLists.map(normalizeList);
        const fingerprint = computeFingerprint(stats, lists);

        const previous = state.snapshot;
        const age = previous ? Date.now() - previous.fetchedAt : Infinity;
        // `partial` defeats the TTL shortcut: the fingerprint cannot change just
        // because a list that failed last time is reachable again, so without it the
        // missing lists would stay missing for a full TTL.
        const unchanged = previous?.fingerprint === fingerprint && age < FULL_REFETCH_TTL_MS && !state.partial;

        if (!force && unchanged) {
            hideBanner();
            return; // Two requests, no DOM work, done.
        }

        const { perList, failed } = await fetchEverything(client, lists);
        const next = buildSnapshot({
            lists,
            perList,
            fingerprint,
            serverId: currentServerId(),
            schemaVersion: SCHEMA_VERSION,
        });

        state.snapshot = next;
        state.partial = failed.length > 0;
        const changed = mountGrid(next);
        // Never persist a snapshot we know is incomplete as if it were whole.
        if (!failed.length) await writeSnapshot(next);

        hideBanner();
        if (failed.length) {
            showToast(`${failed.length} of ${lists.length} lists failed to refresh.`, { kind: 'warn' });
        } else if (changed && previous) {
            showToast('Bookmarks updated.');
        }
    } catch (err) {
        handleRevalidateError(err);
    } finally {
        state.revalidating = false;
        const queued = state.queuedRevalidate;
        state.queuedRevalidate = null;
        if (queued) void revalidate(queued);
    }
}

function handleRevalidateError(err: unknown): void {
    const info = describeError(err, state.creds?.baseUrl ?? '');

    if ((err as ApiError | undefined)?.kind === 'auth') {
        // Deliberately keep the cache and the rendered grid. Turning a working
        // dashboard into an empty login form would be the worst possible failure.
        clearApiKey();
        if (state.creds) state.creds = { ...state.creds, apiKey: '' };
        if (state.mountedHtml) showBanner('Your Karakeep API key was rejected.', 'Reconnect', openSettings);
        else showSetup({ error: info });
        return;
    }

    if (state.mountedHtml) showToast(info.message, { kind: 'warn' });
    else showSetup({ error: info });
}

/* ------------------------------------------------------------------ settings */

function settingsStatus(): string {
    if (!state.snapshot) return 'No cached data yet.';
    const lists = Object.keys(state.snapshot.membership).length;
    const count = state.snapshot.bookmarks.length;
    return `Updated ${formatAgo(state.snapshot.fetchedAt)} · ${count} bookmarks in ${lists} lists`;
}

function openSettings(): void {
    const host = document.getElementById('settings')!;
    // Reachable twice (gear button, then the Reconnect banner): re-opening without
    // closing would stack a second click listener and run every action twice.
    if (!host.hidden) closeSettings();
    host.innerHTML = renderSettings({
        baseUrl: state.creds?.baseUrl ?? DEFAULT_URL,
        hasKey: Boolean(state.creds?.apiKey),
        prefs: state.prefs,
        status: settingsStatus(),
    });
    host.hidden = false;

    host.addEventListener('click', onSettingsClick);
    document.getElementById('settingsForm')!.addEventListener('submit', onSettingsSubmit);
    const slider = document.getElementById('settingsColumns') as HTMLInputElement;
    const output = document.getElementById('settingsColumnsOut')!;
    slider.addEventListener('input', () => {
        output.textContent = slider.value;
    });
    document.addEventListener('keydown', onSettingsKeydown);
}

function closeSettings(): void {
    const host = document.getElementById('settings')!;
    host.hidden = true;
    host.innerHTML = '';
    host.removeEventListener('click', onSettingsClick);
    document.removeEventListener('keydown', onSettingsKeydown);
}

function onSettingsKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeSettings();
}

async function onSettingsClick(event: Event): Promise<void> {
    const target = event.target as Element | null;
    if (target?.closest('[data-close]')) {
        closeSettings();
        return;
    }

    const action = target?.closest<HTMLElement>('[data-action]')?.dataset['action'];
    switch (action) {
        case 'refresh':
            closeSettings();
            await revalidate({ force: true });
            break;
        case 'clear':
            clearCollapsedOverrides();
            await clearCache();
            state.snapshot = null;
            state.pendingRender = null;
            state.index = null;
            state.mountedHtml = '';
            updateFooter(0);
            closeSettings();
            content().innerHTML = renderLoading('Reloading bookmarks…');
            await revalidate({ force: true });
            break;
        case 'signout':
            clearCollapsedOverrides();
            await clearCache();
            clearCredentials();
            state.creds = null;
            state.snapshot = null;
            state.pendingRender = null;
            updateFooter(0);
            closeSettings();
            syncKarakeepLink();
            hideBanner();
            showSetup({ baseUrl: DEFAULT_URL });
            break;
        default:
            break;
    }
}

function toggleListCollapse(listId: string, isSublist: boolean, groupEl?: HTMLElement | null): void {
    const overrides = readCollapsedOverrides();
    const current = isListCollapsed(listId, isSublist, state.prefs, overrides);
    const next = !current;
    overrides[listId] = next;
    writeCollapsedOverrides(overrides);

    const el = groupEl ?? content().querySelector(`[data-list-id="${CSS.escape(listId)}"]`);
    if (el) {
        el.classList.toggle('is-collapsed', next);
        const btn = el.querySelector(':scope > .list-header .list-collapse-btn');
        if (btn) {
            btn.setAttribute('aria-expanded', next ? 'false' : 'true');
            btn.setAttribute('title', next ? 'Expand' : 'Collapse');
        }
    }
}

async function onSettingsSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const rawUrl = (document.getElementById('settingsUrl') as HTMLInputElement).value;
    const keyInput = (document.getElementById('settingsKey') as HTMLInputElement).value.trim();
    const bookmarkTarget = (document.getElementById('settingsTarget') as HTMLInputElement).checked ? '_blank' : '_self';
    const showTags = (document.getElementById('settingsTags') as HTMLInputElement).checked;
    const includeSmartLists = (document.getElementById('settingsSmart') as HTMLInputElement).checked;
    const collapseListsByDefault = (document.getElementById('settingsCollapseLists') as HTMLInputElement).checked;
    const collapseSublistsByDefault = (document.getElementById('settingsCollapseSublists') as HTMLInputElement).checked;
    const showBookmarkCounts = (document.getElementById('settingsShowCounts') as HTMLInputElement).checked;
    const numColumns = clampColumns((document.getElementById('settingsColumns') as HTMLInputElement).value);

    let baseUrl: string;
    try {
        baseUrl = normalizeBaseUrl(rawUrl);
    } catch (err) {
        showToast((err as Error).message, { kind: 'warn' });
        return;
    }

    const apiKey = keyInput || state.creds?.apiKey || '';
    if (!apiKey) {
        showToast('An API key is required.', { kind: 'warn' });
        return;
    }

    // Validate before writing anything: a rejected key must not leave the new
    // preferences saved (and the drag layout reset) behind a panel that stays open.
    let me: ApiUser;
    try {
        me = await createClient({ baseUrl, apiKey }).getMe();
    } catch (err) {
        showToast(describeError(err, baseUrl).message, { kind: 'warn' });
        return;
    }

    const userId = me.id ?? null;
    // The cache is keyed by server *and* user, so a new key for the same host is
    // still a different account and must not show the previous user's bookmarks.
    const identityChanged = state.creds?.baseUrl !== baseUrl || (state.creds?.userId ?? null) !== userId;
    state.creds = { baseUrl, apiKey, userId };
    writeCredentials(state.creds);
    syncKarakeepLink();

    if (
        state.prefs.collapseListsByDefault !== collapseListsByDefault ||
        state.prefs.collapseSublistsByDefault !== collapseSublistsByDefault
    ) {
        clearCollapsedOverrides();
    }

    const columnsChanged = state.prefs.numColumns !== numColumns;
    state.prefs = updatePrefs({
        bookmarkTarget,
        includeSmartLists,
        showTags,
        collapseListsByDefault,
        collapseSublistsByDefault,
        showBookmarkCounts,
        numColumns,
    });

    // Changing the column count invalidates a layout saved for a different number
    // of columns; falling back to round-robin beats piling everything into column 0.
    if (columnsChanged) state.prefs = updatePrefs({ columnLayout: null, columnOrder: [] });

    closeSettings();
    hideBanner();

    if (identityChanged) {
        await clearCache();
        state.snapshot = null;
        state.pendingRender = null;
        state.index = null;
        content().innerHTML = renderLoading('Loading bookmarks…');
    }

    state.mountedHtml = '';
    if (state.snapshot) mountGrid(state.snapshot);
    await revalidate({ force: true });
}

/* ---------------------------------------------------------------------- boot */

function syncKarakeepLink(): void {
    const link = document.getElementById('karakeepLink') as HTMLAnchorElement | null;
    if (link) link.href = state.creds?.baseUrl || DEFAULT_URL;
}

function wireChrome(): void {
    syncKarakeepLink();

    document.getElementById('settingsButton')?.addEventListener('click', openSettings);
    document.getElementById('editModeButton')?.addEventListener('click', toggleEditMode);
    document.getElementById('exitEditModeBtn')?.addEventListener('click', toggleEditMode);

    document.addEventListener('keydown', (event) => {
        // A dialog or the settings panel owns Escape while it is open.
        if (event.key !== 'Escape' || !state.editMode) return;
        if (document.querySelector('.confirm-dialog-container')) return;
        if (!document.getElementById('settings')?.hidden) return;
        toggleEditMode();
    });

    const input = searchInput();
    if (input) attachSearch(input, runFilter);

    document.getElementById('remotePrompt')?.addEventListener('click', (event) => {
        const action = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
        if (action?.dataset['action'] === 'remote-search') {
            void runRemoteSearch(searchInput()?.value.trim() ?? '');
        }
    });

    content().addEventListener('click', (event) => {
        const target = event.target as Element | null;

        // In edit mode: intercept bookmark item actions and clicks
        if (state.editMode) {
            const actionBtn = target?.closest<HTMLElement>('.bookmark-action-btn');
            if (actionBtn) {
                event.preventDefault();
                event.stopPropagation();
                const action = actionBtn.dataset['action'];
                const bmItem = actionBtn.closest<HTMLElement>('.bookmark-item');
                const bookmarkId = bmItem?.dataset['bookmarkId'];
                const listGrid = bmItem?.closest<HTMLElement>('.bookmark-grid');
                const listId = listGrid?.dataset['listId'];
                if (bookmarkId && listId) {
                    if (action === 'archive') void handleArchiveBookmark(bookmarkId, listId);
                    else if (action === 'delete') void handleDeleteBookmark(bookmarkId, listId);
                }
                return;
            }

            const bmItem = target?.closest('.bookmark-item');
            if (bmItem) {
                event.preventDefault();
                return;
            }
        }

        const action = target?.closest<HTMLElement>('[data-action]');
        if (action?.dataset['action'] === 'close-remote') {
            exitRemoteMode();
            return;
        }

        const header = target?.closest<HTMLElement>('.list-header');
        if (!header) return;

        if (target?.closest('a')) return;
        if (isDragging() || recentlyDragged()) return;

        const group = header.closest<HTMLElement>('.list-section, .nested-list-1, .nested-list-2');
        if (!group) return;

        const listId = group.dataset['listId'];
        if (!listId) return;

        const isSublist = !group.classList.contains('list-section');
        toggleListCollapse(listId, isSublist, group);
    });

    // `error` does not bubble, which is why the old build attached a listener to
    // every single favicon. One capturing listener replaces all of them.
    content().addEventListener(
        'error',
        (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.classList.contains('bookmark-favicon')) target.style.display = 'none';
        },
        true
    );

    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastCheck < FULL_REFETCH_TTL_MS) return;
        lastCheck = Date.now();
        void revalidate();
    });
}

// Guarantees the grid has painted before any network work is scheduled.
function afterPaint(fn: () => void): void {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fn, 0)));
}

// Caches favicons and provides an offline fallback for the app shell.
function registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(() => {
        /* both jobs are optimizations; failure is not fatal */
    });
}

async function boot(): Promise<void> {
    state.prefs = readPrefs();
    state.creds = readCredentials();
    wireChrome();

    if (!state.creds?.apiKey) {
        showSetup({ baseUrl: state.creds?.baseUrl ?? DEFAULT_URL });
        return;
    }

    state.snapshot = await readSnapshot(currentServerId());

    if (state.snapshot) {
        mountGrid(state.snapshot);
        const stale = Date.now() - state.snapshot.fetchedAt > CACHE_MAX_AGE_MS;
        afterPaint(() => void revalidate({ force: stale }));
    } else {
        content().innerHTML = renderLoading('Loading bookmarks…');
        await revalidate({ force: true });
    }

    registerServiceWorker();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
} else {
    void boot();
}
