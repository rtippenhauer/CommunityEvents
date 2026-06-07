#!/bin/sh
# Fix permissions on mounted volumes
chmod 777 /app/uploads /app/appdata 2>/dev/null || true

# Run database migrations before starting the app
echo "[entrypoint] Running database migrations..."
node /app/node_modules/typeorm/cli.js migration:run \
  -d /app/dist/database/data-source.js \
  && echo "[entrypoint] Migrations complete." \
  || echo "[entrypoint] WARNING: Migration failed — check logs."

exec /usr/bin/supervisord -c /etc/supervisord.conf
