#!/usr/bin/env bash
set -euo pipefail

IMAGE="rtippenhauer/dinnerbears:latest"
START=$(date +%s)

echo "==> Building $IMAGE"
docker build \
  --platform linux/amd64 \
  -t "$IMAGE" \
  .

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

ELAPSED=$(( $(date +%s) - START ))
echo "==> Done: $IMAGE  ($(date '+%b %d %Y %I:%M %p')  $(( ELAPSED / 60 ))m $(( ELAPSED % 60 ))s)"
