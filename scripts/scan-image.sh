#!/usr/bin/env bash
set -euo pipefail

# Prevents Git Bash on Windows from mangling absolute container paths
# (e.g. /var/run/docker.sock) into Windows paths. No effect on Linux/Mac.
export MSYS_NO_PATHCONV=1

TAG="${1:-stage}"
IMAGE="rtippenhauer/community-events:${TAG}"
SEVERITY="${2:-HIGH,CRITICAL,MEDIUM}"

echo "==> Scanning $IMAGE (severity: $SEVERITY)"
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v trivy-cache:/root/.cache/ \
  aquasec/trivy image \
  --scanners vuln \
  --timeout 15m \
  --severity "$SEVERITY" \
  "$IMAGE"
