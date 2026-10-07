# Contributing to KaraKeep Dashboard

Thanks for helping! Bug reports, docs fixes, translations and features are all welcome.

## Ground rules

The dashboard is a fast, static, read-mostly **view** of Karakeep. Changes that keep it
that way are the easiest to merge:

- **Nothing on the path to first paint touches the network.** The grid renders from
  the local cache; the API is only asked afterwards.
- **No backend.** The image serves static files; the API key never leaves the browser.
- **No CDN scripts and no inline scripts/styles** — the CSP is `script-src 'self'`.
- **Small and dependency-light.** SortableJS is the only runtime dependency.

[`AGENTS.md`](AGENTS.md) lists every invariant in detail. It is written for AI coding
agents (Codex, Claude Code), but it is the best architecture summary for humans too.

## Getting started

You need Node 24+ (`nvm use` reads `.nvmrc`).

```bash
npm ci
npm run check        # typecheck + tests
npm run build:demo   # build with sample data, no Karakeep needed
python3 -m http.server 8595 --directory dist-demo
```

To work against a real instance, use `npm run build` and serve `dist/` instead, then
paste your Karakeep address and an API key into the setup screen.

## Pull requests

1. Open an issue or discussion first for anything larger than a bug fix, so we can
   agree on the approach before you spend time on it.
2. Keep PRs focused: one change per PR.
3. Add or update tests in `test/` for logic changes (`node:test`, run as `.ts`).
4. Run `npm run check` — CI runs the same, then builds and smoke-tests the image.
5. For visible changes, attach before/after screenshots. If the README screenshots
   change, regenerate them from the demo build.

Commit messages are imperative and in sentence case, e.g. `Add keyboard navigation`.

## Good first issues

Look for the [`good first issue`](https://github.com/bartlomiejborzucki/karakeep-dashboard/labels/good%20first%20issue)
label. Translations, accessibility and docs are great places to start.

## License

By contributing you agree that your contributions are licensed under the GPL-3.0,
like the rest of the project.
