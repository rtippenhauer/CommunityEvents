#!/usr/bin/env bash
set -euo pipefail

# One generic image serves every instance (DinnerBears, Sons, …); all branding
# is runtime (DB + .env via /config/branding), so there's no per-instance build.
IMAGE="rtippenhauer/community-events:latest"
START=$(date +%s)

GIT_COMMIT=$(git rev-parse HEAD)

echo "==> Building $IMAGE (commit $GIT_COMMIT)"
docker build \
  --platform linux/amd64 \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  -t "$IMAGE" \
  .

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

ELAPSED=$(( $(date +%s) - START ))
echo "==> Done: $IMAGE  ($(date '+%b %d %Y %I:%M %p')  $(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"
