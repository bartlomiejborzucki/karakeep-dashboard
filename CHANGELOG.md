# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Docker images are tagged `X.Y.Z`, `X.Y`,
`X` and `latest`.

## [Unreleased]

### Added
- Optional ⭐ Favourites card (⚙ → *Show favourites*), pinned to the top of the first
  column until you move it. Includes favourited bookmarks that are in no list.

## [2.2.0] - 2026-10-07

### Added
- Unraid template (`unraid/karakeep-dashboard.xml`).
- `FRAME_ANCESTORS` to allow embedding in Homepage, Homarr, Dashy or another dashboard
  (framing stays denied by default), with setup examples for all three in the README.
- Code of Conduct and automatic GitHub Releases from `CHANGELOG.md` on `v*` tags.

## [2.1.0] - 2026-10-07

### Added
- Live demo on GitHub Pages and `npm run build:demo`: the real app with the API
  replaced by in-memory sample data.
- README screenshots, badges and a one-line `docker run`.
- `AGENTS.md` (OpenAI Codex) and `CLAUDE.md` (Claude Code) with the project's rules.
- Issue and PR templates, `CONTRIBUTING.md`, `SECURITY.md`, Dependabot.

### Changed
- Edit mode, its notifications and the delete confirmation are now in English, like
  the rest of the interface.
- The image runs nginx as a non-root user (`nginx-unprivileged`).

### Fixed
- Mobile: stacked columns now fill the screen width, and the title no longer overlaps
  the header buttons.
- A failed move/archive/delete could leave the screen out of sync when another
  refresh was already running; the corrective refresh is now queued.
- Escape in the delete confirmation cancels it (and no longer exits edit mode
  underneath it); focus starts on Cancel.
- Opening settings twice (gear, then the Reconnect banner) ran every settings action
  twice.

## [2.0.0] - 2026-09-10

First release of this fork: rewritten in TypeScript on the Karakeep REST API.

### Added
- API-key setup instead of mounting Karakeep's database file.
- Instant start from an IndexedDB cache with cheap change detection.
- Edit mode: drag bookmarks between lists, archive, delete.
- Collapsible lists and sublists, bookmark counts.
- Progressive Web App with offline support.

[Unreleased]: https://github.com/bartlomiejborzucki/karakeep-dashboard/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/bartlomiejborzucki/karakeep-dashboard/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/bartlomiejborzucki/karakeep-dashboard/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/bartlomiejborzucki/karakeep-dashboard/releases/tag/v2.0.0
