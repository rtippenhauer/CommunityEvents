#!/usr/bin/env bash
set -euo pipefail

IMAGE="rtippenhauer/dinnerbears:stage"

echo "==> Building $IMAGE"
docker build \
  --platform linux/amd64 \
  -t "$IMAGE" \
  .

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

echo "==> Done: $IMAGE"
