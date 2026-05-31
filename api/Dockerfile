# NestJS API — Multi-stage build
# NO public ports — internal Docker network only

# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

USER nestjs

EXPOSE 3000

# Enable debug port in dev (commented out for prod)
# CMD ["node", "--inspect=0.0.0.0:9229", "dist/main"]
CMD ["node", "dist/main"]
