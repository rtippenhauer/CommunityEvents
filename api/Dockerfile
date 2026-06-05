# NestJS — Non-root production container
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
RUN mkdir -p /app/uploads && chown nestjs:nestjs /app/uploads
USER nestjs
EXPOSE 3000
CMD ["node", "dist/main.js"]
