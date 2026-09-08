#!/bin/sh
# Writes env.js from $KARAKEEP_URL so the setup form has a sensible default.
# Only ever an address — never an API token.
set -e

HTML_DIR="${HTML_DIR:-/usr/share/nginx/html}"

# This value is interpolated into a JavaScript file, so it is an injection sink.
# Whitelist the characters a URL can legitimately contain rather than trying to
# escape; there is no jq in this image and quoting mistakes here are exploitable.
SAFE_URL="$(printf '%s' "${KARAKEEP_URL:-}" | tr -cd 'A-Za-z0-9:/._~-')"

if [ -n "$SAFE_URL" ]; then
    printf 'globalThis.KARAKEEP_ENV = { karakeepUrl: "%s" };\n' "$SAFE_URL" > "$HTML_DIR/env.js"
    echo "10-env.sh: seeded Karakeep URL as $SAFE_URL"
else
    # Always emit the file so index.html never gets a 404 for it.
    printf 'globalThis.KARAKEEP_ENV = {};\n' > "$HTML_DIR/env.js"
fi
