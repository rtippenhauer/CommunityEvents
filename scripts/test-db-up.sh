#!/usr/bin/env bash
set -euo pipefail

# Brings up the ephemeral e2e MySQL and does not return until it can actually
# be used. Optionally resets the schema first: `bash scripts/test-db-up.sh --reset`.
#
# Why this exists: `mysqladmin ping` is NOT a sufficient readiness check. During
# first-run initialization the MySQL image starts a temporary server so it can
# apply init scripts, and that server answers ping before the real one is up
# with final root grants. So ping reports "ready", the very next statement fails
# with `ERROR 1045 (28000): Access denied`, and the failure looks random.
#
# A fixed `sleep` only moves the race. The reliable probe is the capability we
# actually need: authenticate as root and execute a statement.

CONTAINER="dinnerbears-mysql-test"
COMPOSE_FILE="docker/docker-compose.test.yml"
DB_NAME="${DB_NAME:-dinnerbears_test}"
DB_PASSWORD="${DB_PASSWORD:-test}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-90}"

RESET=0
if [[ "${1:-}" == "--reset" ]]; then
  RESET=1
fi

echo "==> Starting $CONTAINER"
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for it to accept authenticated queries (up to ${TIMEOUT_SECONDS}s)"
deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
until docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    echo "!!! $CONTAINER did not become usable within ${TIMEOUT_SECONDS}s" >&2
    echo "--- last 20 log lines ---" >&2
    docker logs --tail 20 "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "==> Ready"

if (( RESET )); then
  echo "==> Resetting schema $DB_NAME"
  docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" \
    -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\`;"
  echo "==> Schema reset"
fi
