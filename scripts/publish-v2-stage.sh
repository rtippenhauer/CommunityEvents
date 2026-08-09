#!/usr/bin/env bash
set -euo pipefail

# Separate stage tag for the v2 rewrite (multi-tenant/Prisma), so v2
# development doesn't clobber :stage — v1 dinnerbears keeps deploying from
# :stage/:latest, untouched, until an actual 2.0 cutover repoints them.
IMAGE="rtippenhauer/community-events:v2-stage"
EXTRA_FLAGS=""
START=$(date +%s)
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_FLAGS="--no-cache"
fi

GIT_COMMIT=$(git rev-parse HEAD)

echo "==> Building $IMAGE (commit $GIT_COMMIT)"
docker build \
  --platform linux/amd64 \
  $EXTRA_FLAGS \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  -t "$IMAGE" \
  .

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

ELAPSED=$(( $(date +%s) - START ))
echo "==> Done: $IMAGE  ($(date '+%b %d %Y %I:%M %p')  $(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"
