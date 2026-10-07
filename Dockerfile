# Build stage: TypeScript is bundled here so the runtime image stays a plain
# static file server with no Node and no dependencies in it.
FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json build.mjs index.html styles.css env.js favicon.svg favicon.ico apple-touch-icon.png manifest.json icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png ./
COPY src/ ./src/
COPY test/ ./test/

# Types and logic are verified as part of the image build: a broken bundle should
# never reach a registry.
RUN npm run typecheck && npm test && npm run build

# Runtime stage. The unprivileged variant runs nginx as uid 101 instead of root;
# 8595 is above 1024, so nothing needs to change about the port.
FROM nginxinc/nginx-unprivileged:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

COPY docker-entrypoint.d/10-env.sh /docker-entrypoint.d/10-env.sh

# The image runs /docker-entrypoint.d/*.sh at start but skips non-executable ones,
# and the script rewrites env.js as the unprivileged user, so that one file (and
# only that file) must be writable by it.
USER root
RUN chmod 755 /docker-entrypoint.d/10-env.sh \
 && chown 101:101 /usr/share/nginx/html/env.js
USER 101

EXPOSE 8595

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8595/ || exit 1
