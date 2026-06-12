#!/usr/bin/env bash
set -euo pipefail

IMAGE="rtippenhauer/dinnerbears:stage"
EXTRA_FLAGS=""
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

echo "==> Done: $IMAGE"
