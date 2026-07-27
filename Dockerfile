# ── Stage 1: Build Angular ─────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
ARG ANGULAR_CONFIG=production
WORKDIR /app
COPY frontend/package*.json frontend/.npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-timeout=120000
COPY frontend/ .
RUN npm run build -- --configuration $ANGULAR_CONFIG

# ── Stage 2: Build NestJS ──────────────────────────────────────────────────────
FROM node:20-alpine AS api-build
WORKDIR /app
COPY api/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-timeout=120000
COPY api/ .
COPY docs/NEXT_RELEASE.md ./release-notes/_draft.md
RUN npm run build
RUN npm prune --omit=dev

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM node:20-alpine
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
# Pull latest patched OS packages at build time — the base image tag doesn't
# always carry the newest security patches (e.g. openssl) for its Alpine release.
RUN apk update && apk upgrade --no-cache && apk add --no-cache nginx su-exec

# npm/npx/corepack are never invoked at runtime (entrypoint.sh runs `node dist/main.js`
# directly) — they just carry their own bundled dependencies (tar, sigstore, older
# glob/minimatch/cross-spawn) that show up as unpatched CVEs in image scans for no
# functional benefit. Stripping them removes that surface entirely.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

# NestJS API
WORKDIR /app
COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/package.json ./package.json
COPY --from=api-build /app/release-notes ./release-notes

# Angular static files → nginx webroot
COPY --from=frontend-build /app/dist/dinnerbears/browser /usr/share/nginx/html

# Config
COPY docker/nginx/nginx-combined.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /app/uploads /app/appdata /run/nginx \
    && chown -R nestjs:nestjs /app/uploads /app/appdata \
    && chmod +x /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/nginx-health || exit 1

CMD ["/entrypoint.sh"]
