#!/usr/bin/env bash
# Regression check for purge-attachments (Part 17a, review finding H2): 300 queue entries with
# long object names (~330 characters each, which overflowed the old URL-based live-row check)
# must be drained by ONE call with {"limit": 500}, and the response must have exactly the shape
# { purged, alreadyGone, retryable, dead }.
#
# Local stack only (it inserts into public.storage_deletion_queue as postgres through
# `docker exec`). Needs the edge runtime serving the functions (`supabase functions serve` or the
# runtime container started by `supabase start`). Reads the API URL and the service-role key from
# `supabase status -o env`; neither is printed. The 300 names do not exist in Storage, so the
# call reports them as alreadyGone; nothing outside the marker entries is touched except that
# the call also drains whatever else was queued (at most 200 other entries are tolerated).
#
#   bash scripts/ci/purge-drain-check.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --no-install supabase)
fi
PROJECT_ID=$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' supabase/config.toml | head -n 1)
DB_CONTAINER="supabase_db_${PROJECT_ID:-unknown}"
psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

STATUS_ENV=$("${SUPABASE[@]}" status -o env 2>/dev/null) || fail "supabase status failed; is the stack running?"
API_URL=$(printf '%s\n' "$STATUS_ENV" | sed -nE 's/^API_URL="?([^"]*)"?$/\1/p' | head -n 1)
SERVICE_KEY=$(printf '%s\n' "$STATUS_ENV" | sed -nE 's/^SERVICE_ROLE_KEY="?([^"]*)"?$/\1/p' | head -n 1)
unset STATUS_ENV
[ -n "$API_URL" ] && [ -n "$SERVICE_KEY" ] || fail "API_URL or SERVICE_ROLE_KEY missing from 'supabase status -o env'"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
umask 077
printf 'Authorization: Bearer %s\napikey: %s\n' "$SERVICE_KEY" "$SERVICE_KEY" >"$WORK_DIR/headers"
unset SERVICE_KEY

MARKER="purge-drain-check-$(date +%s)"
OTHER=$(psql_db -c "select count(*) from public.storage_deletion_queue where attempts < 10")
[ "$OTHER" -le 200 ] || fail "the queue already holds $OTHER entries; drain it first"

psql_db -c "insert into public.storage_deletion_queue (bucket_id, object_name, workspace_id)
            select 'attachments',
                   gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '-' || '$MARKER' || '-' || repeat('n', 200) || '-' || g || '.txt',
                   gen_random_uuid()
            from generate_series(1, 300) g"

RESPONSE=$(curl -s --max-time 120 -X POST "$API_URL/functions/v1/purge-attachments" \
  -H 'content-type: application/json' -H "@$WORK_DIR/headers" --data '{"limit":500}')

LEFT=$(psql_db -c "select count(*) from public.storage_deletion_queue where object_name like '%$MARKER%'")
if [ "$LEFT" != 0 ]; then
  psql_db -c "delete from public.storage_deletion_queue where object_name like '%$MARKER%'" >/dev/null
  fail "$LEFT of 300 marker entries are still queued after one call; response: $RESPONSE"
fi

node -e '
  const body = JSON.parse(process.argv[1]).data
  const keys = Object.keys(body ?? {}).sort().join(",")
  if (keys !== "alreadyGone,dead,purged,retryable") throw new Error(`unexpected shape: ${keys}`)
  if (body.purged + body.alreadyGone < 300) throw new Error(`only ${body.purged + body.alreadyGone} processed`)
  if (body.retryable !== 0) throw new Error(`retryable ${body.retryable} after one call`)
  console.log(`ok    one call drained 300 long-named entries: ${JSON.stringify(body)}`)
' "$RESPONSE" || fail "unexpected response: $RESPONSE"
echo "purge-attachments drain check passed"
