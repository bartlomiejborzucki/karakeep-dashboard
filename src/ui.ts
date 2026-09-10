// Setup screen, settings panel, toasts and the reconnect banner.

import { esc } from './render.ts';
import { MIN_COLUMNS, MAX_COLUMNS } from './config.ts';
import type { ApiError } from './api.ts';
import type { ErrorInfo, Prefs } from './types.ts';

/**
 * `fetch` collapses every transport failure into a bare TypeError, so the raw error
 * is useless to a user. Turn each case into something actionable.
 */
export function describeError(err: unknown, baseUrl: string): ErrorInfo {
    const kind = (err as ApiError | undefined)?.kind ?? 'network';

    switch (kind) {
        case 'auth':
            return {
                title: 'API key rejected',
                message: 'Karakeep did not accept that API key. Generate a new one under Settings → API Keys.',
            };
        case 'not-found':
            return {
                title: 'Not a Karakeep instance',
                message: `Nothing answered at ${baseUrl}/api/v1. Check the address, and whether Karakeep sits behind a path prefix.`,
            };
        case 'mixed-content':
            return {
                title: 'Blocked by the browser',
                message:
                    'This page is served over https://, and browsers refuse to let it call an http:// API. ' +
                    'Either open this dashboard over http://, or put Karakeep behind https://.',
            };
        case 'offline':
            return { title: 'Offline', message: 'You appear to be offline. Showing the last cached view.' };
        case 'timeout':
            return { title: 'Karakeep timed out', message: 'The server did not respond in time. Is it still starting up?' };
        case 'rate-limit':
            return { title: 'Rate limited', message: 'Karakeep asked us to slow down. Try again shortly.' };
        case 'server':
            return { title: 'Karakeep error', message: (err as Error).message };
        default:
            return {
                title: 'Cannot reach Karakeep',
                message: `No response from ${baseUrl}. If the server is up, a reverse proxy may be stripping CORS headers — Karakeep sends Access-Control-Allow-Origin: * for /api/* by default.`,
                hint: `curl -i -H 'Origin: ${location.origin}' ${baseUrl}/api/v1/users/me`,
            };
    }
}

export interface SetupState {
    baseUrl?: string;
    apiKey?: string;
    error?: ErrorInfo | null;
    busy?: boolean;
}

export function renderSetup({ baseUrl = '', apiKey = '', error = null, busy = false }: SetupState = {}): string {
    return `
        <div class="setup">
            <div class="setup-card">
                <h2 class="setup-title">Connect to Karakeep</h2>
                <p class="setup-lead">
                    KaraKeep Dashboard talks to your Karakeep instance over its API. Your key is stored
                    in this browser only &mdash; it is never sent anywhere else.
                </p>
                ${error ? `
                    <div class="setup-error" role="alert">
                        <strong>${esc(error.title)}</strong>
                        <span>${esc(error.message)}</span>
                        ${error.hint ? `<code>${esc(error.hint)}</code>` : ''}
                    </div>
                ` : ''}
                <form id="setupForm" class="setup-form" autocomplete="off">
                    <label class="setup-field">
                        <span>Karakeep address</span>
                        <input type="url" id="setupUrl" name="url" value="${esc(baseUrl)}"
                               placeholder="http://localhost:3000" autocomplete="off" required>
                    </label>
                    <label class="setup-field">
                        <span>API key</span>
                        <input type="password" id="setupKey" name="key" value="${esc(apiKey)}"
                               placeholder="ak1_..." autocomplete="new-password" required>
                        <small>Karakeep &rarr; Settings &rarr; API Keys</small>
                    </label>
                    <button type="submit" class="setup-submit" ${busy ? 'disabled' : ''}>
                        ${busy ? 'Connecting&hellip;' : 'Connect'}
                    </button>
                </form>
            </div>
        </div>
    `;
}

export interface SettingsState {
    baseUrl: string;
    hasKey: boolean;
    prefs: Prefs;
    status: string;
}

export function renderSettings({ baseUrl, hasKey, prefs, status }: SettingsState): string {
    return `
        <div class="settings-backdrop" data-close="1"></div>
        <div class="settings-panel" role="dialog" aria-label="Settings">
            <div class="settings-head">
                <h2>Settings</h2>
                <button type="button" class="settings-close" data-close="1" aria-label="Close">&times;</button>
            </div>
            <form id="settingsForm" class="settings-body" autocomplete="off">
                <label class="setup-field">
                    <span>Karakeep address</span>
                    <input type="url" id="settingsUrl" value="${esc(baseUrl)}" autocomplete="off" required>
                </label>
                <label class="setup-field">
                    <span>API key</span>
                    <input type="password" id="settingsKey" autocomplete="new-password"
                           placeholder="${hasKey ? 'Stored — leave blank to keep' : 'Required'}">
                </label>
                <label class="setup-field">
                    <span>Columns: <output id="settingsColumnsOut">${prefs.numColumns}</output></span>
                    <input type="range" id="settingsColumns" min="${MIN_COLUMNS}" max="${MAX_COLUMNS}"
                           step="1" value="${prefs.numColumns}">
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsTarget" ${prefs.bookmarkTarget === '_blank' ? 'checked' : ''}>
                    <span>Open bookmarks in a new tab</span>
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsTags" ${prefs.showTags ? 'checked' : ''}>
                    <span>Show tags on bookmarks</span>
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsSmart" ${prefs.includeSmartLists ? 'checked' : ''}>
                    <span>Include smart lists</span>
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsCollapseLists" ${prefs.collapseListsByDefault ? 'checked' : ''}>
                    <span>Collapse lists by default</span>
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsCollapseSublists" ${prefs.collapseSublistsByDefault ? 'checked' : ''}>
                    <span>Collapse sublists by default</span>
                </label>
                <label class="settings-check">
                    <input type="checkbox" id="settingsShowCounts" ${prefs.showBookmarkCounts ? 'checked' : ''}>
                    <span>Show bookmark count on lists</span>
                </label>
                <button type="submit" class="setup-submit">Save</button>
            </form>
            <div class="settings-actions">
                <button type="button" data-action="refresh">Refresh now</button>
                <button type="button" data-action="clear">Clear cache</button>
                <button type="button" data-action="signout" class="danger">Sign out</button>
            </div>
            <p class="settings-status">${esc(status)}</p>
        </div>
    `;
}

export function showToast(message: string, { kind = 'info', timeout = 5000 }: { kind?: 'info' | 'warn'; timeout?: number } = {}): void {
    const host = document.getElementById('toasts');
    if (!host) return;

    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), timeout);
}

export function showBanner(message: string, actionLabel: string | null, onAction?: () => void): void {
    const host = document.getElementById('banner');
    if (!host) return;

    host.innerHTML = `
        <div class="banner" role="alert">
            <span>${esc(message)}</span>
            <span class="banner-actions">
                ${actionLabel ? `<button type="button" data-action="primary">${esc(actionLabel)}</button>` : ''}
                <button type="button" data-action="dismiss" aria-label="Dismiss">&times;</button>
            </span>
        </div>
    `;
    host.hidden = false;
    host.onclick = (event) => {
        const action = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
        if (!action) return;
        if (action.dataset['action'] === 'primary') onAction?.();
        hideBanner();
    };
}

export function hideBanner(): void {
    const host = document.getElementById('banner');
    if (!host) return;
    host.innerHTML = '';
    host.hidden = true;
    host.onclick = null;
}

/** Offered when a local search matches nothing but Karakeep may still know the answer. */
export function renderRemotePrompt(query: string): string {
    return `
        <div class="remote-prompt">
            <span>Nothing on this dashboard matches &ldquo;${esc(query)}&rdquo;.</span>
            <button type="button" data-action="remote-search">Search all of Karakeep</button>
        </div>
    `;
}

export function formatAgo(timestamp: number | null): string {
    if (!timestamp) return 'never';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'just now';

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}
