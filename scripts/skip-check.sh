#!/usr/bin/env bash
# Writes skip=<true|false> to $GITHUB_OUTPUT. Only scheduled runs may skip;
# any other event always deploys.
set -euo pipefail

if [ "${EVENT_NAME:-}" != "schedule" ]; then
  echo "skip=false" >> "$GITHUB_OUTPUT"
  exit 0
fi
# Separate assignment so set -e catches a failing rev-parse.
current_sha="$(git rev-parse HEAD)"
CURRENT_SHA="$current_sha" node scripts/check-undeployed-commits.mjs
