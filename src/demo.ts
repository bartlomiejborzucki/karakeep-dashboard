// Demo mode: an in-memory stand-in for the Karakeep API, so the dashboard can be
// tried (and screenshotted) without an instance. Enabled only by a demo build
// (`node build.mjs --demo`), which sets `__DEMO__`; production bundles drop it.
//
// Mutations made in edit mode change this in-memory store, so the optimistic UI
// and the follow-up revalidation agree. A reload starts over.

import type { KarakeepClient } from './api.ts';
import type { ApiBookmark, ApiList, ApiStats, ApiUser } from './types.ts';

export const DEMO_BASE_URL = 'https://demo.karakeep.invalid';
export const DEMO_API_KEY = 'demo';

interface Seed {
    /** null: in no list — reachable only through favourites or search. */
    list: string | null;
    favourite?: boolean;
    title: string;
    url: string;
    tags?: string[];
    description?: string;
}

const LISTS: ApiList[] = [
    { id: 'daily', name: 'Daily', icon: '☀️', parentId: null, type: 'manual' },
    { id: 'homelab', name: 'Homelab', icon: '🖥️', parentId: null, type: 'manual' },
    { id: 'homelab-media', name: 'Media', icon: '🎬', parentId: 'homelab', type: 'manual' },
    { id: 'homelab-monitoring', name: 'Monitoring', icon: '📈', parentId: 'homelab', type: 'manual' },
    { id: 'dev', name: 'Development', icon: '💻', parentId: null, type: 'manual' },
    { id: 'dev-docs', name: 'Docs', icon: '📘', parentId: 'dev', type: 'manual' },
    { id: 'reading', name: 'Read later', icon: '📚', parentId: null, type: 'manual' },
    { id: 'design', name: 'Design', icon: '🎨', parentId: null, type: 'manual' },
    { id: 'tools', name: 'Tools', icon: '🧰', parentId: null, type: 'manual' },
    { id: 'learning', name: 'Learning', icon: '🎓', parentId: null, type: 'manual' },
];

const SEEDS: Seed[] = [
    { list: 'daily', title: 'Hacker News', url: 'https://news.ycombinator.com', tags: ['news'], favourite: true },
    { list: 'daily', title: 'GitHub', url: 'https://github.com', tags: ['dev'], favourite: true },
    { list: 'daily', title: 'r/selfhosted', url: 'https://www.reddit.com/r/selfhosted', tags: ['community'] },
    { list: 'daily', title: 'Lobsters', url: 'https://lobste.rs', tags: ['news'] },
    { list: 'daily', title: 'Wikipedia', url: 'https://en.wikipedia.org' },
    { list: 'daily', title: 'YouTube', url: 'https://www.youtube.com' },
    { list: 'homelab', title: 'Karakeep', url: 'https://github.com/karakeep-app/karakeep', tags: ['bookmarks', 'self-hosted'], description: 'The bookmark-everything app', favourite: true },
    { list: 'homelab', title: 'Proxmox VE', url: 'https://www.proxmox.com', tags: ['virtualization'] },
    { list: 'homelab', title: 'Tailscale', url: 'https://tailscale.com', tags: ['vpn', 'network'] },
    { list: 'homelab', title: 'Traefik Proxy', url: 'https://traefik.io', tags: ['reverse-proxy'] },
    { list: 'homelab', title: 'awesome-selfhosted', url: 'https://awesome-selfhosted.net', tags: ['list'] },
    { list: 'homelab', title: 'Pi-hole', url: 'https://pi-hole.net', tags: ['dns', 'network'] },
    { list: 'homelab-media', title: 'Jellyfin', url: 'https://jellyfin.org', tags: ['media'] },
    { list: 'homelab-media', title: 'Immich', url: 'https://immich.app', tags: ['photos'] },
    { list: 'homelab-media', title: 'Navidrome', url: 'https://www.navidrome.org', tags: ['music'] },
    { list: 'homelab-monitoring', title: 'Grafana', url: 'https://grafana.com', tags: ['monitoring'], favourite: true },
    { list: 'homelab-monitoring', title: 'Uptime Kuma', url: 'https://github.com/louislam/uptime-kuma', tags: ['monitoring'] },
    { list: 'homelab-monitoring', title: 'Prometheus', url: 'https://prometheus.io', tags: ['monitoring'] },
    { list: 'dev', title: 'TypeScript Playground', url: 'https://www.typescriptlang.org/play', tags: ['typescript'] },
    { list: 'dev', title: 'esbuild', url: 'https://esbuild.github.io', tags: ['build'] },
    { list: 'dev', title: 'Can I use', url: 'https://caniuse.com', tags: ['web'] },
    { list: 'dev', title: 'regex101', url: 'https://regex101.com', tags: ['tools'] },
    { list: 'dev', title: 'Docker Hub', url: 'https://hub.docker.com', tags: ['docker'] },
    { list: 'dev-docs', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', tags: ['web', 'docs'] },
    { list: 'dev-docs', title: 'Node.js docs', url: 'https://nodejs.org/docs/latest/api/', tags: ['node', 'docs'] },
    { list: 'dev-docs', title: 'nginx documentation', url: 'https://nginx.org/en/docs/', tags: ['nginx', 'docs'] },
    { list: 'reading', title: 'The Twelve-Factor App', url: 'https://12factor.net', tags: ['architecture'] },
    { list: 'reading', title: 'Julia Evans — blog', url: 'https://jvns.ca', tags: ['blog'] },
    { list: 'reading', title: 'Martin Fowler', url: 'https://martinfowler.com', tags: ['architecture'] },
    { list: 'reading', title: 'web.dev — Learn PWA', url: 'https://web.dev/learn/pwa', tags: ['pwa', 'web'] },
    { list: 'reading', title: 'High Scalability', url: 'https://highscalability.com', tags: ['architecture'] },
    { list: 'design', title: 'Figma', url: 'https://www.figma.com', tags: ['design'] },
    { list: 'design', title: 'Lucide icons', url: 'https://lucide.dev', tags: ['icons'] },
    { list: 'design', title: 'Coolors', url: 'https://coolors.co', tags: ['colors'] },
    { list: 'design', title: 'Google Fonts', url: 'https://fonts.google.com', tags: ['fonts'] },
    { list: 'tools', title: 'CyberChef', url: 'https://gchq.github.io/CyberChef/', tags: ['tools'] },
    { list: 'tools', title: 'Excalidraw', url: 'https://excalidraw.com', tags: ['diagrams'], favourite: true },
    { list: 'tools', title: 'crontab.guru', url: 'https://crontab.guru', tags: ['cron'] },
    { list: 'tools', title: 'Squoosh', url: 'https://squoosh.app', tags: ['images'] },
    { list: 'learning', title: 'Exercism', url: 'https://exercism.org', tags: ['practice'] },
    { list: 'learning', title: 'roadmap.sh', url: 'https://roadmap.sh', tags: ['career'] },
    { list: 'learning', title: 'The Missing Semester', url: 'https://missing.csail.mit.edu', tags: ['cli'] },
    { list: null, title: 'Karakeep docs', url: 'https://docs.karakeep.app', tags: ['docs'], favourite: true },
];

function seedStore() {
    const bookmarks = new Map<string, ApiBookmark>();
    const membership = new Map<string, string[]>(LISTS.map((l) => [l.id, []]));
    SEEDS.forEach((seed, i) => {
        const id = `demo-${i}`;
        bookmarks.set(id, {
            id,
            createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
            title: seed.title,
            archived: false,
            favourited: seed.favourite ?? false,
            tags: (seed.tags ?? []).map((name) => ({ id: `tag-${name}`, name, attachedBy: 'human' })),
            content: { type: 'link', url: seed.url, title: seed.title, description: seed.description ?? null },
        });
        if (seed.list) membership.get(seed.list)!.push(id);
    });
    return { bookmarks, membership };
}

export function createDemoClient(): KarakeepClient {
    const { bookmarks, membership } = seedStore();
    // Every mutation bumps this, so the fingerprint changes like a real server's would.
    let revision = 0;

    const user: ApiUser = { id: 'demo-user', name: 'Demo', email: null };

    return {
        getMe: async () => user,
        getStats: async (): Promise<ApiStats> => ({
            numBookmarks: bookmarks.size + revision * 1000,
            numLists: LISTS.length,
        }),
        getLists: async () => LISTS.map((l) => ({ ...l })),
        getListBookmarks: async (listId) =>
            (membership.get(listId) ?? [])
                .map((id) => bookmarks.get(id))
                .filter((b): b is ApiBookmark => b !== undefined && !b.archived),
        getFavouriteBookmarks: async () => [...bookmarks.values()].filter((b) => b.favourited && !b.archived),
        searchBookmarks: async (query) => {
            const q = query.toLowerCase();
            return [...bookmarks.values()].filter((b) => {
                const url = b.content?.type === 'link' ? b.content.url : '';
                return `${b.title ?? ''} ${url}`.toLowerCase().includes(q);
            });
        },
        addBookmarkToList: async (listId, bookmarkId) => {
            const ids = membership.get(listId);
            if (ids && !ids.includes(bookmarkId)) ids.push(bookmarkId);
            revision++;
        },
        removeBookmarkFromList: async (listId, bookmarkId) => {
            const ids = membership.get(listId);
            if (ids) membership.set(listId, ids.filter((id) => id !== bookmarkId));
            revision++;
        },
        deleteBookmark: async (bookmarkId) => {
            bookmarks.delete(bookmarkId);
            for (const [listId, ids] of membership) membership.set(listId, ids.filter((id) => id !== bookmarkId));
            revision++;
        },
        archiveBookmark: async (bookmarkId) => {
            const b = bookmarks.get(bookmarkId);
            if (b) b.archived = true;
            revision++;
        },
    };
}
