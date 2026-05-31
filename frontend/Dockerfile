# Angular 19 — Multi-stage build
# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# Stage 2: Serve via NGINX (for production standalone)
# In Docker Compose, the build output is shared via a named volume
# and served by the main NGINX container instead.
FROM nginx:alpine AS serve
COPY --from=build /app/dist/dinnerbears/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
