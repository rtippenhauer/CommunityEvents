#!/bin/sh
# Fix permissions on mounted volumes so the nestjs user can write to them
chmod 777 /app/uploads /app/appdata 2>/dev/null || true
exec /usr/bin/supervisord -c /etc/supervisord.conf
