#!/usr/bin/env bash
# Smoke test for the Edge Functions served by the local Supabase stack.
#
# Run after `supabase start` (CI db-tests job, or locally with Docker running). Reads the API URL
# and anon key from `supabase status -o env`; neither value, nor any JWT, is ever printed. Only
# HTTP status codes are asserted:
#
#   1. POST invite-member without Authorization            -> 401
#   2. alice@example.com invites into a random workspace   -> 403 (not a member)
#   3. alice@example.com accepts a garbage invitation token -> 404
#
# `supabase start` normally serves the functions at <API_URL>/functions/v1/<name> through the
# edge runtime container. If the probe shows the runtime is not answering (for example after a
# `supabase functions serve` session was stopped), the script starts `supabase functions serve`
# itself in the background and stops it again on exit.
#
# Requirements: bash, curl, jq (ubuntu-latest has it; without jq, node is used as a fallback),
# Supabase CLI (`supabase` on PATH or `npx supabase` from the devDependency).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --no-install supabase)
fi

WORK_DIR=$(mktemp -d)
SERVE_PID=""
SERVE_STARTED=0
PROJECT_ID=$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' supabase/config.toml | head -n 1)
EDGE_CONTAINER="supabase_edge_runtime_${PROJECT_ID:-unknown}"

cleanup() {
  if [ "$SERVE_STARTED" = 1 ]; then
    echo "Stopping the background 'supabase functions serve'"
    if [ -n "$SERVE_PID" ]; then kill "$SERVE_PID" >/dev/null 2>&1 || true; fi
    docker stop "$EDGE_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# json_get <path>: print one top-level field of the JSON on stdin (e.g. `.access_token`).
json_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r "$1 // empty"
  else
    node -e '
      let raw = ""
      process.stdin.on("data", (d) => (raw += d)).on("end", () => {
        const keys = process.argv[1].replace(/^\./, "").split(".")
        const value = keys.reduce((o, k) => (o == null ? o : o[k]), JSON.parse(raw))
        process.stdout.write(value == null ? "" : String(value))
      })' "$1"
  fi
}

random_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-F' 'a-f'
  else
    od -An -N16 -tx1 /dev/urandom | tr -d ' \n' |
      sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
  fi
}

# status_of <url> <header-file> <json-body>: print the HTTP status only ("000" on transport error).
status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$1" \
    -H 'content-type: application/json' -H "@$2" --data "$3" || echo 000
}

# --- Read the stack's URL and anon key without echoing them ------------------------------------
STATUS_ENV=$("${SUPABASE[@]}" status -o env 2>/dev/null) || fail "supabase status failed; is the stack running?"
API_URL=$(printf '%s\n' "$STATUS_ENV" | sed -nE 's/^API_URL="?([^"]*)"?$/\1/p' | head -n 1)
ANON_KEY=$(printf '%s\n' "$STATUS_ENV" | sed -nE 's/^ANON_KEY="?([^"]*)"?$/\1/p' | head -n 1)
unset STATUS_ENV
[ -n "$API_URL" ] || fail "API_URL missing from 'supabase status -o env'"
[ -n "$ANON_KEY" ] || fail "ANON_KEY missing from 'supabase status -o env'"

FUNCTIONS_URL="$API_URL/functions/v1"
umask 077
NO_AUTH_HEADERS="$WORK_DIR/no-auth.headers"
ANON_HEADERS="$WORK_DIR/anon.headers"
USER_HEADERS="$WORK_DIR/user.headers"
printf 'x-smoke-test: 1\n' >"$NO_AUTH_HEADERS"
printf 'apikey: %s\n' "$ANON_KEY" >"$ANON_HEADERS"

# --- Make sure the edge runtime answers (401 for a request without credentials) -----------------
probe() { status_of "$FUNCTIONS_URL/invite-member" "$NO_AUTH_HEADERS" '{}'; }

PROBE=$(probe)
if [ "$PROBE" != 401 ]; then
  echo "Edge runtime not serving functions (probe returned $PROBE); starting 'supabase functions serve' in the background"
  "${SUPABASE[@]}" functions serve >"$WORK_DIR/functions-serve.log" 2>&1 &
  SERVE_PID=$!
  SERVE_STARTED=1
  for _ in $(seq 1 60); do
    sleep 2
    PROBE=$(probe)
    [ "$PROBE" = 401 ] && break
  done
  if [ "$PROBE" != 401 ]; then
    echo "--- supabase functions serve log (last 40 lines) ---" >&2
    tail -n 40 "$WORK_DIR/functions-serve.log" >&2 || true
    fail "edge runtime did not come up (last probe status $PROBE)"
  fi
fi

# --- Sign in as the seed owner with the password grant -----------------------------------------
ACCESS_TOKEN=$(curl -s --max-time 20 -X POST "$API_URL/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' -H "@$ANON_HEADERS" \
  --data '{"email":"alice@example.com","password":"password123"}' | json_get .access_token)
[ -n "$ACCESS_TOKEN" ] || fail "password-grant login as alice@example.com returned no access_token"
printf 'Authorization: Bearer %s\napikey: %s\n' "$ACCESS_TOKEN" "$ANON_KEY" >"$USER_HEADERS"
unset ACCESS_TOKEN ANON_KEY

# --- Assertions ---------------------------------------------------------------------------------
FAILURES=0
assert_status() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then
    echo "ok    $name -> $actual"
  else
    echo "FAIL  $name -> $actual (expected $expected)"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_status "invite-member without credentials" 401 "$PROBE"

INVITE_BODY=$(printf '{"workspaceId":"%s","email":"smoke-test@example.com","role":"member"}' "$(random_uuid)")
assert_status "invite-member into a workspace the caller is not a member of" 403 \
  "$(status_of "$FUNCTIONS_URL/invite-member" "$USER_HEADERS" "$INVITE_BODY")"

ACCEPT_BODY=$(printf '{"token":"smoke-garbage-%s"}' "$(random_uuid)")
assert_status "accept-invitation with an unknown token" 404 \
  "$(status_of "$FUNCTIONS_URL/accept-invitation" "$USER_HEADERS" "$ACCEPT_BODY")"

if [ "$FAILURES" -ne 0 ]; then
  fail "$FAILURES function smoke assertion(s) failed"
fi
echo "Edge Function smoke test passed"
