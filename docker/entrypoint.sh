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

# Run database migrations before starting the app
echo "[entrypoint] Running database migrations..."
node /app/node_modules/typeorm/cli.js migration:run \
  -d /app/dist/database/data-source.js \
  && echo "[entrypoint] Migrations complete." \
  || echo "[entrypoint] WARNING: Migration failed — check logs."

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
