#!/usr/bin/env bash
set -euo pipefail

IMAGE="rtippenhauer/dinnerbears:stage"
EXTRA_FLAGS=""
START=$(date +%s)
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_FLAGS="--no-cache"
fi

echo "==> Building $IMAGE"
docker build \
  --platform linux/amd64 \
  $EXTRA_FLAGS \
  --build-arg ANGULAR_CONFIG=stage \
  -t "$IMAGE" \
  .

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

ELAPSED=$(( $(date +%s) - START ))
echo "==> Done: $IMAGE  ($(date '+%b %d %Y %I:%M %p')  $(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"
