#!/usr/bin/env bash
# qa-smoke.sh — read-only smoke test against the live staging app.
#
# Logs in via NextAuth Credentials and hits the safest read-only surfaces
# (auth, version, health, the main tRPC list/count queries). NO MUTATIONS —
# this is safe to run against production. Returns non-zero on any check
# that misbehaves so it can be wired into CI / a pre-deploy gate.
#
#   ENV (optional):
#     BASE   — defaults to https://standart.202ok.online
#     EMAIL  — defaults to admin@test.ua
#     PASS   — defaults to Admin123!
#
#   Usage:
#     pnpm qa:smoke
#     BASE=http://localhost:3000 pnpm qa:smoke
#
# Requires `curl` and `jq` on PATH.

set -euo pipefail

BASE="${BASE:-https://standart.202ok.online}"
EMAIL="${EMAIL:-admin@test.ua}"
PASS="${PASS:-Admin123!}"

# tracking
PASS_COUNT=0
FAIL_COUNT=0
COOKIE_JAR="$(mktemp -t qa-smoke.XXXXXX)"
TMP_OUT="$(mktemp -t qa-smoke-out.XXXXXX)"
trap 'rm -f "$COOKIE_JAR" "$TMP_OUT"' EXIT

ok()   { printf '  \033[32mok  \033[0m %s\n' "$1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { printf '  \033[31mfail\033[0m %s\n' "$1"; FAIL_COUNT=$((FAIL_COUNT+1)); }

require_jq() {
  command -v jq >/dev/null || { echo "qa-smoke: jq is required, install it first" >&2; exit 2; }
  command -v curl >/dev/null || { echo "qa-smoke: curl is required" >&2; exit 2; }
}

# Issue an HTTP GET, return the status code on stdout. Writes body to $TMP_OUT.
http_status() {
  curl -sS -o "$TMP_OUT" -w '%{http_code}' "$@"
}

require_jq

echo "== qa-smoke against $BASE =="
echo "   user: $EMAIL"

# ── 1. Unauth probes ───────────────────────────────────────────────────
echo
echo "[1/4] Unauth probes"
for path in /api/version /api/health /api/db-status; do
  code=$(http_status "$BASE$path")
  case "$code" in
    200|204) ok "GET $path  → $code" ;;
    401|302|403) ok "GET $path  → $code (gated, expected)" ;;
    *) fail "GET $path  → $code (unexpected)" ;;
  esac
done

# tRPC list without auth must NOT 200 with data
code=$(http_status \
  "$BASE/api/trpc/standard.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D")
case "$code" in
  401|403) ok "tRPC standard.list (no auth) → $code" ;;
  200)
    if jq -e '.[0].error' "$TMP_OUT" >/dev/null 2>&1; then
      ok "tRPC standard.list (no auth) → 200 with error body"
    else
      fail "tRPC standard.list (no auth) → 200 with DATA — leak"
    fi
    ;;
  *) fail "tRPC standard.list (no auth) → $code" ;;
esac

# ── 2. NextAuth credentials login ──────────────────────────────────────
echo
echo "[2/4] Login"
csrf_json=$(curl -sS -c "$COOKIE_JAR" "$BASE/api/auth/csrf")
csrf=$(echo "$csrf_json" | jq -r .csrfToken)
if [ -z "$csrf" ] || [ "$csrf" = "null" ]; then
  fail "csrfToken missing"; exit 1
fi
ok "csrfToken acquired (${#csrf} chars)"

login_code=$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$csrf" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASS" \
  --data-urlencode "callbackUrl=$BASE/dashboard" \
  -o /dev/null -w '%{http_code}')
case "$login_code" in
  200|302) ok "login → $login_code" ;;
  *) fail "login → $login_code"; exit 1 ;;
esac

session=$(curl -sS -b "$COOKIE_JAR" "$BASE/api/auth/session")
email_back=$(echo "$session" | jq -r '.user.email // empty')
if [ "$email_back" = "$EMAIL" ]; then
  ok "session: $(echo "$session" | jq -c '.user | {email, globalRole}')"
else
  fail "session has no user / wrong email (got '$email_back')"
fi

# ── 3. Authed read-only queries ────────────────────────────────────────
echo
echo "[3/4] Authed reads"

trpc_get() {
  local endpoint="$1" input_json="$2"
  local enc
  enc=$(jq -rn --arg j "$input_json" '{"0":{"json":($j|fromjson)}}' | jq -sRr @uri)
  local code
  code=$(curl -sS -b "$COOKIE_JAR" -o "$TMP_OUT" -w '%{http_code}' \
    "$BASE/api/trpc/$endpoint?batch=1&input=$enc")
  if [ "$code" = "200" ] && jq -e '.[0].result' "$TMP_OUT" >/dev/null 2>&1; then
    ok "$endpoint  → 200"
  else
    fail "$endpoint  → $code  $(jq -c '.[0].error.message // empty' "$TMP_OUT")"
  fi
}

trpc_get "user.me"                  '{}'
trpc_get "workingGroup.list"        '{}'
trpc_get "standard.list"            '{"page":1,"pageSize":5}'
trpc_get "dashboard.navCounts"      '{}'
trpc_get "dashboard.kpis"           '{}'
trpc_get "notification.unreadCount" '{}'
trpc_get "search.global"            '{"q":"test"}'

# ── 4. RBAC negative — random cuid should NOT_FOUND / FORBIDDEN ────────
echo
echo "[4/4] RBAC negative"
trpc_negative() {
  local endpoint="$1" input_json="$2" expect_code_re="$3"
  local enc
  enc=$(jq -rn --arg j "$input_json" '{"0":{"json":($j|fromjson)}}' | jq -sRr @uri)
  local code
  code=$(curl -sS -b "$COOKIE_JAR" -o "$TMP_OUT" -w '%{http_code}' \
    "$BASE/api/trpc/$endpoint?batch=1&input=$enc")
  local trpc_code
  trpc_code=$(jq -r '.[0].error.data.code // empty' "$TMP_OUT")
  if [[ "$trpc_code" =~ $expect_code_re ]]; then
    ok "$endpoint  → $trpc_code"
  else
    fail "$endpoint  → http=$code trpc=$trpc_code (expected $expect_code_re)"
  fi
}

trpc_negative "meeting.byId" '{"id":"clxxxxxxx0000xxxxxxxxxxx0"}' '^(NOT_FOUND|FORBIDDEN|BAD_REQUEST)$'
trpc_negative "task.byId"    '{"id":"clxxxxxxx0000xxxxxxxxxxx0"}' '^(NOT_FOUND|FORBIDDEN|BAD_REQUEST)$'

# ── Summary ────────────────────────────────────────────────────────────
echo
echo "== summary =="
echo "   $PASS_COUNT ok / $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
