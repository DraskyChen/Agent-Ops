#!/bin/sh
set -eu

BASE_URL=${BASE_URL:-http://127.0.0.1:8080}
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT/.env.production"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Production environment file not found: $ENV_FILE" >&2
  exit 1
fi

AGENT_OPS_INGEST_TOKEN=$(awk -F= '
  $1 == "AGENT_OPS_INGEST_TOKEN" {
    sub(/^[^=]*=/, "")
    gsub(/^"|"$/, "")
    print
    exit
  }
' "$ENV_FILE")

if [ -z "$AGENT_OPS_INGEST_TOKEN" ]; then
  echo "AGENT_OPS_INGEST_TOKEN is required" >&2
  exit 1
fi

health=$(curl -fsS "$BASE_URL/healthz")
printf '%s' "$health" | grep -q '"status":"ok"'
printf '%s' "$health" | grep -q '"database":"connected"'

curl -fsS "$BASE_URL/" | grep -q 'Agent Ops'

status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL/api/v1/feedback" \
  -H "Authorization: Bearer $AGENT_OPS_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"traceId":"release-smoke-nonexistent","eventId":"release-smoke","type":"comment"}')

if [ "$status" != "404" ]; then
  echo "Expected an authenticated 404 for the non-existent smoke trace; got $status" >&2
  exit 1
fi

echo "Release smoke checks passed for $BASE_URL."
echo "Complete the OIDC and one-trace SDK smoke steps from docs/release-runbook.md."

