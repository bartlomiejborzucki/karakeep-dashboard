# Security policy

## Supported versions

Only the latest release (and the `latest` image tag) receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through
[GitHub security advisories](https://github.com/bartlomiejborzucki/karakeep-dashboard/security/advisories/new).
You should get a reply within a week. Once a fix is released, you will be credited in
the advisory unless you prefer otherwise.

## Scope and threat model

The dashboard is a static page that calls your Karakeep API from the browser:

- The API key is stored in the browser's `localStorage` and sent only to the Karakeep
  address you configured. A strict CSP (`script-src 'self'`, no inline scripts) and
  HTML escaping of every API value are the main defences protecting it.
- The container serves static files only, runs nginx as a non-root user, and writes
  a single generated file (`env.js`) whose content is whitelisted.
- The dashboard has no login of its own: anyone who can open it in a browser that
  already holds a key can use that key. Keep the port on your LAN or behind an
  authenticating reverse proxy or VPN.

Particularly interesting reports: anything that lets bookmark data (titles, URLs,
tags) execute script, leaks the API key to another origin, or makes the service
worker cache API responses.
