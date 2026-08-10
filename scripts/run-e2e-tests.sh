#!/usr/bin/env bash
# Runs the API's e2e/integration test suite against a throwaway MySQL
# container (never the real Unraid dev/stage/prod database). Usage:
#   bash scripts/run-e2e-tests.sh
set -euo pipefail

COMPOSE="docker compose --project-directory . -f docker/docker-compose.test.yml"

cleanup() {
  echo "==> Tearing down test database"
  $COMPOSE down --remove-orphans
}
trap cleanup EXIT

echo "==> Starting ephemeral test MySQL"
$COMPOSE up -d --wait

# Schema is created by test/global-setup.ts, which runs `prisma migrate
# deploy` once before the first spec. TypeORM used to build it implicitly via
# synchronize()/migrationsRun on every app.init(); Prisma has no connection-time
# equivalent, so it is an explicit step now — the same one docker/entrypoint.sh
# runs in the real container.
echo "==> Running e2e tests"
(
  cd api
  npm run test:e2e
)
