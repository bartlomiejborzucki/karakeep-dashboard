# Build stage: TypeScript is bundled here so the runtime image stays a plain
# static file server with no Node and no dependencies in it.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json build.mjs index.html styles.css env.js favicon.svg favicon.ico apple-touch-icon.png ./
COPY src/ ./src/
COPY test/ ./test/

# Types and logic are verified as part of the image build: a broken bundle should
# never reach a registry.
RUN npm run typecheck && npm test && npm run build

# Runtime stage
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine runs /docker-entrypoint.d/*.sh at start, but skips non-executable ones.
COPY docker-entrypoint.d/10-env.sh /docker-entrypoint.d/10-env.sh
RUN chmod +x /docker-entrypoint.d/10-env.sh

EXPOSE 8595

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8595/ || exit 1
