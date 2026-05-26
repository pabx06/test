#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${OIDC_SMOKE_BACKEND_URL:-http://localhost:3000}"
PROVIDER_URL="${OIDC_SMOKE_PROVIDER_URL:-http://localhost:8092}"
LOG_DIR="${OIDC_SMOKE_LOG_DIR:-../oidc-smoke-logs}"
TIMEOUT_SECONDS="${OIDC_SMOKE_TIMEOUT_SECONDS:-60}"

BACKEND_URL="${BACKEND_URL%/}"
PROVIDER_URL="${PROVIDER_URL%/}"
provider_pid=""
backend_pid=""

port_of() {
  node -e 'const url = new URL(process.argv[1]); console.log(url.port || (url.protocol === "https:" ? "443" : "80"))' "$1"
}

wait_for() {
  local url="$1" label="$2" pid="$3" deadline=$((SECONDS + TIMEOUT_SECONDS))

  until curl -fsS "$url" >/dev/null 2>&1; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "${label} process exited before becoming reachable" >&2
      return 1
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for ${label}: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

cleanup() {
  local status=$?

  for pid in "$backend_pid" "$provider_pid"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
  done

  if [ "$status" -ne 0 ]; then
    echo "OIDC smoke test failed; provider log:" >&2
    cat "$LOG_DIR/provider.log" >&2 || true
    echo "OIDC smoke test failed; backend log:" >&2
    cat "$LOG_DIR/backend.log" >&2 || true
  fi

  exit "$status"
}

trap cleanup EXIT

mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*

OIDC_PROVIDER_PORT="$(port_of "$PROVIDER_URL")" npm run provider > "$LOG_DIR/provider.log" 2>&1 &
provider_pid="$!"
wait_for "$PROVIDER_URL/.well-known/openid-configuration" "mock OIDC provider" "$provider_pid"

NODE_ENV=test \
LOG_LEVEL=info \
PORT="$(port_of "$BACKEND_URL")" \
AUTH_MODE=oidc \
SESSION_STORE=memory \
SESSION_SECRET=ci-oidc-smoke-session-secret-local-only \
DB_HOST=localhost \
DB_PORT=3306 \
DB_NAME=propriateraydb \
DB_USER=propriateraydb \
DB_PASSWORD=dummy \
OIDC_ISSUER_URL="$PROVIDER_URL/" \
OIDC_CLIENT_ID=propriateraydb-backend \
OIDC_CLIENT_SECRET=mock-secret \
OIDC_REDIRECT_URI="$BACKEND_URL/auth/callback" \
OIDC_SCOPE="openid profile email" \
npm start > "$LOG_DIR/backend.log" 2>&1 &
backend_pid="$!"
wait_for "$BACKEND_URL/health/live" "backend liveness" "$backend_pid"

node scripts/smoke-oidc-flow.mjs "$BACKEND_URL" "$PROVIDER_URL"

echo "OIDC smoke test passed."
