# Angular 19 — Multi-stage build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

FROM alpine:latest
WORKDIR /app
COPY --from=build /app/dist/dinnerbears/browser ./dist/dinnerbears/browser
CMD ["sh", "-c", "cp -r /app/dist/dinnerbears/browser/* /output/"]
