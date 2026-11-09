#!/usr/bin/env bash
# Runs the API's e2e/integration test suite against a throwaway MySQL
# container (never the real Unraid dev/stage/prod database). Usage:
#   bash scripts/run-e2e-tests.sh
set -euo pipefail

COMPOSE="docker compose --project-directory . -f docker/docker-compose.test.yml"

cleanup() {
  # Capture the real exit status FIRST. Without this the trap's own last
  # command decided the script's status, so a run where the database never
  # started -- `up --wait` failing on a container-name conflict -- tore down
  # cleanly and exited 0. Nothing ran, and it looked like a pass.
  local status=$?
  echo "==> Tearing down test database"
  $COMPOSE down --remove-orphans || true
  exit "$status"
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
