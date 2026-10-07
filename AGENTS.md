# AGENTS.md

Instructions for AI coding agents (OpenAI Codex, Claude Code, and anything else that
reads `AGENTS.md`). `CLAUDE.md` imports this file, so keep **this** file as the single
source of truth and do not duplicate rules into `CLAUDE.md`.

## What this project is

KaraKeep Dashboard: a static, browser-only "home page" view of a
[Karakeep](https://github.com/karakeep-app/karakeep) instance's bookmarks, grouped by
list in a masonry grid. The browser talks to the Karakeep REST API directly with a
user-supplied API key. There is **no backend**: the Docker image is nginx serving
`dist/`. Fork of `CodeJawn/karakeep-homedash`, licensed GPL-3.0.

## Commands

Node **24+** is required (tests run `.ts` directly via native type stripping). `.nvmrc`
pins it; `.npmrc` pins the public registry and `engine-strict`.

```bash
npm ci              # install
npm run check       # typecheck (3 tsconfigs) + tests — run before every commit
npm run typecheck   # tsc only
npm test            # node --test 'test/*.test.ts'
npm run build       # -> dist/ (minified, content-hashed assets)
npm run dev         # unminified build with inline sourcemaps
npm run build:demo  # -> dist-demo/, API swapped for in-memory sample data (GitHub Pages demo)
python3 -m http.server 8595 --directory dist   # serve the build
docker build -t karakeep-dashboard:dev .       # image build also runs typecheck + tests
```

A single test file: `node --test test/model.test.ts`.

There is no linter or formatter configured. Match the surrounding style (below).

## Layout

```
index.html       shell, CSP <meta>, mount points; build.mjs rewrites asset URLs
styles.css       whole design system (CSS custom properties, auto dark mode)
manifest.json    PWA manifest (asserted by test/pwa.test.ts)
env.js           placeholder; regenerated at container start from $KARAKEEP_URL
build.mjs        esbuild bundle + sha256 content hashing + HTML templating
nginx.conf       static server, cache headers chosen via `map $uri`
docker-entrypoint.d/10-env.sh   writes env.js (sanitised — it is an injection sink)
src/types.ts     API response shapes and the normalized model
src/config.ts    constants, localStorage keys, SCHEMA_VERSION
src/storage.ts   localStorage: credentials, prefs, collapse state, legacy migration
src/cache.ts     IndexedDB: the single view snapshot
src/api.ts       REST client: error taxonomy, cursor draining, bounded fan-out
src/model.ts     normalize -> snapshot -> tree; SQLite BINARY sort order
src/render.ts    pure HTML string generation (all values escaped), column distribution
src/search.ts    precomputed search index, class-based filtering
src/dnd.ts       SortableJS wiring: column layout + edit-mode bookmark moves
src/ui.ts        setup screen, settings panel, toasts, banner, confirm dialog
src/main.ts      boot orchestration, revalidation, edit-mode handlers
src/sw.ts        service worker (own tsconfig, WebWorker lib)
src/demo.ts      in-memory KarakeepClient for the demo build
docs/screenshots README images, generated from the demo build
test/            node:test suites, imported as ../src/*.ts
```

Three tsconfigs: `tsconfig.json` (src, strict + `noUncheckedIndexedAccess`),
`tsconfig.test.json` (adds tests, relaxes index check), `tsconfig.sw.json`
(`src/sw.ts` against the WebWorker lib). New source files are picked up automatically;
a new non-DOM entry point needs its own config.

## Invariants — do not break these

1. **Nothing on the path to first paint touches the network.** Boot reads
   localStorage (sync) and one IndexedDB snapshot, renders, and only then
   (`afterPaint`) revalidates. Do not add awaits on fetches before `mountGrid`.
2. **Cheap revalidation.** `/users/me/stats` + `/lists` form a fingerprint; a full
   fan-out only happens when it changes, the TTL (15 min) expires, a previous refresh
   was partial, or it is forced. Do not add per-load requests.
3. **Never re-render when HTML is unchanged** (`state.mountedHtml` comparison), and
   never swap the DOM mid-drag or while remote search results are shown — park the
   snapshot in `state.pendingRender` instead.
4. **All interpolated HTML goes through `esc()`** (render.ts / ui.ts). No inline event
   handlers, no inline scripts or styles: the CSP is `script-src 'self'; style-src 'self'`.
   Use delegated listeners on `#content` instead. `test/render.test.ts` checks this.
5. **The service worker never intercepts or caches Karakeep API traffic**, including
   same-origin `/api/vN/` paths (Karakeep is often reverse-proxied onto the same host).
   App shell is network-first; only cross-origin *images* are cache-first.
   `sw.js` must keep a stable, unhashed URL.
6. **`env.js` only ever holds a URL, never a token.** `10-env.sh` whitelists characters;
   CI injects a hostile `KARAKEEP_URL` and evaluates the result. Keep both.
7. **Bump `SCHEMA_VERSION`** in `src/config.ts` whenever the `Snapshot` shape changes.
   Old caches are then discarded instead of misread.
8. **Snapshots are keyed by `serverId(baseUrl, userId)`** so one account's bookmarks are
   never shown to another. Never persist a partial snapshot (some lists failed).
9. **Auth failures keep the cached grid** and show a Reconnect banner — never drop a
   working dashboard back to the login form.
10. **nginx `add_header` does not merge** across levels. Add headers at server level
    only; cache policy goes through the `map $uri $kkhd_cache_control` block.
11. Every file the build or image needs must be listed in `build.mjs` **and** the
    Dockerfile `COPY` line (they are explicit, not globbed). Adding an icon/asset means
    touching both, plus `SHELL` in `src/sw.ts` if it should work offline.
12. Runtime dependencies are bundled. Do not load anything from a CDN.

## Code style

- TypeScript, ES modules, imports **with the `.ts` extension** and `import type` for
  types (`verbatimModuleSyntax`).
- 4-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- Comments explain *why* (trade-offs, browser quirks), not what. Keep that density.
- Prefer small pure functions in `model.ts` / `render.ts` (testable without a DOM);
  keep DOM and side effects in `main.ts`, `ui.ts`, `dnd.ts`.
- Tests: `node:test` + `node:assert/strict`, descriptive sentence-style test names.
  Add a test for every bug fix and every new pure function.

## Demo build

`__DEMO__` is an esbuild `define` (true only for `npm run build:demo`). Reference it
**directly** and only from `main.ts` — routing it through an exported constant stops
esbuild from folding it and leaks `src/demo.ts` into the production bundle. All API
access in `main.ts` goes through `clientFor()`, so the demo store is substituted in
one place. If you add a method to `KarakeepClient`, implement it in `src/demo.ts` too.
After a visible UI change, regenerate `docs/screenshots/` from the demo build.

## UI language

All user-facing strings are English and inline (no i18n layer yet). Do not add strings
in other languages; a proper i18n map is a welcome, separate change.

## Workflow for agents

- Run `npm run check` before declaring a change done; run `npm run build` if you
  touched `build.mjs`, `index.html`, icons, or the service worker.
- Do not commit `dist/` or `node_modules/` (gitignored).
- Keep the README's Features, Configuration and Layout sections in sync with changes.
- CI (`.github/workflows/docker-publish.yml`) runs checks, builds the image, smoke-tests
  it (asset 200s, cache headers, gzip, env.js injection), and publishes to GHCR on
  `master`/`main` (`latest`), `develop` (`dev`) and `v*` tags (semver).
- Commit messages: imperative, sentence case, e.g. `Add collapsible sublists`.
- User-visible changes get a line under `## [Unreleased]` in `CHANGELOG.md`. Releasing:
  rename that section to `## [X.Y.Z] - date`, bump `package.json`, merge, then push tag
  `vX.Y.Z` — `release.yml` creates the GitHub Release from the changelog section.
- Never put secrets or API keys in the repo, fixtures, or `.npmrc`.
