#!/usr/bin/env bash
set -euo pipefail

# One generic image serves every instance (DinnerBears, Sons, …) — stage vs
# prod is a runtime distinction (the IS_STAGE env var), so the stage tag is the
# same production build as :latest, just a separately-promotable tag.
IMAGE="rtippenhauer/community-events:stage"
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
