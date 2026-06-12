# ── Stage 1: Build Angular ─────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
ARG ANGULAR_CONFIG=production
WORKDIR /app
COPY frontend/package*.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ .
RUN npm run build -- --configuration $ANGULAR_CONFIG

# ── Stage 2: Build NestJS ──────────────────────────────────────────────────────
FROM node:20-alpine AS api-build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ .
RUN npm run build
RUN npm prune --omit=dev

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache nginx supervisor

RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

# NestJS API
WORKDIR /app
COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/node_modules ./node_modules

# Angular static files → nginx webroot
COPY --from=frontend-build /app/dist/dinnerbears/browser /usr/share/nginx/html

# Config
COPY docker/nginx/nginx-combined.conf /etc/nginx/http.d/default.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /app/uploads /app/appdata /run/nginx \
    && chown -R nestjs:nestjs /app/uploads /app/appdata \
    && chmod +x /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/nginx-health || exit 1

CMD ["/entrypoint.sh"]
