#!/bin/sh
# Writes the framing policy that nginx.conf includes at server level.
#
# Default: the dashboard refuses to be framed (X-Frame-Options DENY and
# frame-ancestors 'none'). FRAME_ANCESTORS opts in, for embedding in a homelab
# dashboard such as Homepage, Homarr or Dashy:
#
#   FRAME_ANCESTORS="https://home.example.com http://192.168.1.50:3000 self"
#
# The value ends up inside an nginx config string, so like KARAKEEP_URL it is an
# injection sink: every token is whitelisted rather than escaped. No quotes, no
# semicolons, no whitespace and no `$` (nginx variables) can survive.
set -e
set -f # tokens may contain `*` (https://*.example.com); never glob them

OUT="${FRAME_CONF:-/etc/nginx/kkhd/frame.conf}"
sources=""

for token in ${FRAME_ANCESTORS:-}; do
    case "$token" in
        self | "'self'")
            sources="$sources 'self'"
            ;;
        http://* | https://*)
            clean="$(printf '%s' "$token" | tr -cd 'A-Za-z0-9:/._*-')"
            case "$clean" in
                http://?* | https://?*) sources="$sources $clean" ;;
                *) echo "11-frame-ancestors.sh: ignoring '$token'" >&2 ;;
            esac
            ;;
        *)
            echo "11-frame-ancestors.sh: ignoring '$token' (expected self or an http(s):// origin)" >&2
            ;;
    esac
done

if [ -n "$sources" ]; then
    # X-Frame-Options cannot express an allow-list (ALLOW-FROM is dead), so it is
    # omitted and CSP alone decides.
    printf 'add_header Content-Security-Policy "frame-ancestors%s" always;\n' "$sources" > "$OUT"
    echo "11-frame-ancestors.sh: framing allowed for$sources"
else
    printf '%s\n' \
        'add_header X-Frame-Options "DENY" always;' \
        "add_header Content-Security-Policy \"frame-ancestors 'none'\" always;" > "$OUT"
fi
