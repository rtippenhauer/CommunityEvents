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

# Schema is created via dataSource.synchronize() in test/utils/test-app.ts,
# not the migration CLI — this DB is ephemeral and rebuilt every run, and
# the migration-CLI invocation (ts-node + typeorm/cli.js) hits a ts-node/
# typeorm compatibility issue in some environments. synchronize() gives the
# same up-to-date schema without that dependency. See test-app.ts for why
# this doesn't conflict with the app's synchronize:false convention.
echo "==> Running e2e tests"
(
  cd api
  npm run test:e2e
)
