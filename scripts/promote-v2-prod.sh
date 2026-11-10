#!/usr/bin/env bash
set -euo pipefail

# Production ships the image that was tested on stage, byte for byte: this
# script retags a :v2-stage digest as :v2-prod and pushes it. It never builds.
# A rebuild from the same commit is not the same image -- the base image, the
# npm registry and Google Fonts all move underneath it -- so the one thing
# Rob's testing pass actually signed off on is the digest, not the commit.
#
# :stage and :latest belong to v1 DinnerBears and are published from the other
# repo. Nothing here may write them.
STAGE_IMAGE="rtippenhauer/community-events:v2-stage"
PROD_IMAGE="rtippenhauer/community-events:v2-prod"

usage() {
  cat <<USAGE
Usage: $0 [--local] [--expect-commit <sha>]

  --local                 Promote the :v2-stage image already in the local
                          daemon instead of pulling the registry's current one.
                          Use this only when you are promoting a build you just
                          made and have not pushed.
  --expect-commit <sha>   Refuse to promote unless the image's baked GIT_COMMIT
                          starts with this. Pass the commit you tested.
USAGE
}

PULL=true
EXPECT_COMMIT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) PULL=false; shift ;;
    --expect-commit) EXPECT_COMMIT="${2:-}"; [[ -n "$EXPECT_COMMIT" ]] || { usage; exit 2; }; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$PULL" == true ]]; then
  echo "==> Pulling $STAGE_IMAGE"
  docker pull "$STAGE_IMAGE"
else
  echo "==> Using the local $STAGE_IMAGE (--local)"
  docker image inspect "$STAGE_IMAGE" >/dev/null
fi

IMAGE_ID=$(docker image inspect "$STAGE_IMAGE" --format '{{.Id}}')
IMAGE_COMMIT=$(docker image inspect "$STAGE_IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^GIT_COMMIT=//p')
IMAGE_COMMIT=${IMAGE_COMMIT:-unknown}

# The digest exists only for an image that has been pushed or pulled, so a
# --local promote of a never-pushed build legitimately has none.
SOURCE_DIGEST=$(docker image inspect "$STAGE_IMAGE" --format '{{range .RepoDigests}}{{println .}}{{end}}' \
  | sed -n '1p')
SOURCE_DIGEST=${SOURCE_DIGEST:-"(not pushed; no digest)"}

if [[ -n "$EXPECT_COMMIT" && "$IMAGE_COMMIT" != "$EXPECT_COMMIT"* ]]; then
  echo "ERROR: image was built from $IMAGE_COMMIT, not $EXPECT_COMMIT" >&2
  echo "       Build and push :v2-stage from the commit you mean to promote." >&2
  exit 1
fi

echo "==> Promoting to $PROD_IMAGE"
echo "    source:  $SOURCE_DIGEST"
echo "    image:   $IMAGE_ID"
echo "    commit:  $IMAGE_COMMIT"

docker tag "$STAGE_IMAGE" "$PROD_IMAGE"
docker push "$PROD_IMAGE"

echo
echo "==> Done: $PROD_IMAGE ($(date '+%b %d %Y %I:%M %p'))"
echo "    Promoted commit $IMAGE_COMMIT from $SOURCE_DIGEST"
echo
echo "    Production does not restart itself. Pull the new tag on Unraid:"
echo "      docker pull $PROD_IMAGE && docker restart CommunityEvents-v2-Prod"
echo "    Then confirm what is live:"
echo "      curl -s https://www.communityeventsproject.com/api/v1/health"
echo "    Its gitCommit should read $IMAGE_COMMIT."
