# DinnerBears — Developer Reference

## Local Development

### Start local stack (Docker Compose)

```bash
# Start all containers (API + MySQL)
./dc.sh

# Start and rebuild images
./dc.sh up-build

# Stop all containers
./dc.sh down

# Tail all container logs
./dc.sh logs

# Show running containers
./dc.sh ps
```

The API runs on port 3000 internally; the Angular dev server runs separately on port 4200.

### Start Angular dev server

```bash
cd frontend
npm start
# → http://localhost:4200
```

### Start NestJS dev server (watch mode)

```bash
cd api
npm run start:dev
```

---

## Database Migrations

Run from the `api/` directory. The stack must be running (MySQL accessible).

```bash
cd api

# Apply all pending migrations
npm run migration:run

# Revert the last applied migration
npm run migration:revert

# Generate a new migration from entity changes (replace <MigrationName>)
npm run migration:generate -- src/database/migrations/<MigrationName>
```

Migrations live in `api/src/database/migrations/` with timestamp prefixes.

---

## Build & Publish to Docker Hub

All scripts run from the **repo root**.

### Production image (`latest` tag)

```bash
bash scripts/publish-latest.sh
```

Builds `rtippenhauer/dinnerbears:latest` for `linux/amd64` and pushes to Docker Hub.

### Staging image (`stage` tag)

```bash
bash scripts/publish-stage.sh

# Force a clean build (no layer cache)
bash scripts/publish-stage.sh --no-cache
```

Builds `rtippenhauer/dinnerbears:stage` and pushes to Docker Hub.

---

## Deploying to Unraid

After pushing a new image:

1. In Unraid, go to **Docker** → find the DinnerBears container
2. Click **Force Update** (or stop → re-pull → start)
3. The container pulls the new image from Docker Hub on next start
4. The entrypoint runs `migration:run` automatically before the app starts

---

## Linting & Formatting

```bash
# API
cd api
npm run lint
npm run format

# Frontend
cd frontend
npm run lint
npm run format
```

---

## Admin Dev Delete

To free up a test account's email so it can re-register:

1. Sign in as admin → **Admin → Members**
2. Find the user row and click the red `delete_forever` icon
3. Confirm the inline prompt
4. The account is soft-deleted, email anonymized to `deleted_<id>@deleted.invalid`, and the Google OAuth link is removed — the same Gmail can now register fresh with a new invite

For dev testing without a second Gmail account, use Gmail `+` addressing:
`yourname+test1@gmail.com`, `yourname+test2@gmail.com`, etc.
