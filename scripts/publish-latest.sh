#!/usr/bin/env bash
set -euo pipefail

IMAGE="rtippenhauer/dinnerbears:latest"
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
