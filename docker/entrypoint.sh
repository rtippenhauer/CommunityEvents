#!/bin/sh
# Fix permissions on mounted volumes
chmod 777 /app/uploads /app/appdata 2>/dev/null || true

# Load secrets from persistent appdata .env (never commit secrets to git)
if [ -f /app/appdata/.env ]; then
  echo "[entrypoint] Loading /app/appdata/.env"
  set -a
  . /app/appdata/.env
  set +a
fi

# Run database migrations before starting the app.
#
# Prisma owns the schema (v2-1). `migrate deploy` only applies migrations that
# have not been applied yet and never generates or edits one, which is what
# makes it safe to run unattended on every container start.
#
echo "[entrypoint] Running database migrations..."
node /app/node_modules/prisma/build/index.js migrate deploy \
  && echo "[entrypoint] Migrations complete." \
  || echo "[entrypoint] WARNING: Migration failed - check logs."

# Reference data and the root tenant, for a brand-new database only.
#
# Seeding and bootstrapping are NOT safe to run unconditionally: seed.js would
# rewrite app_config rows an operator has since edited through the admin UI, and
# bootstrap.js resets the root tenant's domain from APP_URL every time it runs
# (which is how stage came up unresolvable on the v2-4 deploy). deploy-provision
# gates each on a first-install check -- no cities, no tenants -- so a
# deployment that is already set up performs no writes at all.
#
# Opt-in, and off unless AUTO_PROVISION=true is set in the environment. It never
# exits non-zero: the app starts either way, and an unbootstrapped database
# already answers 503 TENANT_NOT_CONFIGURED with a specific reason, which is a
# far better failure than a restart loop.
echo "[entrypoint] Checking provisioning..."
node /app/dist/deploy-provision.js || true

# Migrations run as root and may create new upload subdirectories (e.g. category
# folders) — reopen permissions afterward so the unprivileged nestjs user (which
# the app itself runs as, below) can still write into them.
chmod -R 777 /app/uploads 2>/dev/null || true

# Run nginx and NestJS side by side (no process manager — supervisor pulled in
# python3/setuptools purely to run two commands, which kept surfacing unrelated
# CVEs in image scans). NestJS drops to the unprivileged nestjs user via su-exec.
nginx -g "daemon off;" &
NGINX_PID=$!

su-exec nestjs node /app/dist/main.js &
NODE_PID=$!

shutdown() {
  kill -TERM "$NGINX_PID" "$NODE_PID" 2>/dev/null
  wait
  exit 0
}
trap shutdown TERM INT

# If either process dies, tear down the other and exit non-zero so Docker's
# restart policy (restart: unless-stopped) restarts the whole container.
while kill -0 "$NGINX_PID" 2>/dev/null && kill -0 "$NODE_PID" 2>/dev/null; do
  sleep 2
done

echo "[entrypoint] nginx or nestjs exited unexpectedly — restarting container."
kill -TERM "$NGINX_PID" "$NODE_PID" 2>/dev/null
wait
exit 1
