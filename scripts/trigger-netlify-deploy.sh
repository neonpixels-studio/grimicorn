#!/usr/bin/env bash
# Calls the Netlify production build hook and writes trigger_title and
# triggered_at to $GITHUB_OUTPUT for scripts/verify-netlify-deploy.mjs.
set -euo pipefail

if [ -z "${NETLIFY_BUILD_HOOK_URL:-}" ]; then
  echo "::error::Repository secret NETLIFY_BUILD_HOOK_URL is not set; cannot trigger the production deploy."
  exit 1
fi
trigger_title="Manual+production+deploy"
if [ "${EVENT_NAME:-}" = "schedule" ]; then
  trigger_title="Weekly+production+deploy"
fi
# The hook answers 200 with an empty body (no build id), so the verify
# step finds the deploy by this title and time instead.
triggered_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
curl --fail --silent --show-error --max-time 30 -X POST -d '{}' "$NETLIFY_BUILD_HOOK_URL?trigger_title=$trigger_title"
echo "Triggered Netlify production build ($trigger_title) at $triggered_at."
echo "trigger_title=${trigger_title//+/ }" >> "$GITHUB_OUTPUT"
echo "triggered_at=$triggered_at" >> "$GITHUB_OUTPUT"
