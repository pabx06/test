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
BACKEND_PORT="$(node -e 'const url = new URL(process.argv[1]); console.log(url.port || (url.protocol === "https:" ? "443" : "80"))' "$BACKEND_URL")"
PROVIDER_PORT="$(node -e 'const url = new URL(process.argv[1]); console.log(url.port || (url.protocol === "https:" ? "443" : "80"))' "$PROVIDER_URL")"

mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*

cleanup() {
  local status=$?

  if [ -n "$backend_pid" ]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi

  if [ -n "$provider_pid" ]; then
    kill "$provider_pid" 2>/dev/null || true
    wait "$provider_pid" 2>/dev/null || true
  fi

  if [ "$status" -ne 0 ]; then
    echo "OIDC smoke test failed; provider log:" >&2
    cat "$LOG_DIR/provider.log" >&2 || true
    echo "OIDC smoke test failed; backend log:" >&2
    cat "$LOG_DIR/backend.log" >&2 || true
  fi

  exit "$status"
}

trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local label="$2"
  local pid="${3:-}"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))

  until curl -fsS "$url" >/dev/null 2>&1; do
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "${label} process exited before becoming reachable" >&2
      return 1
    fi

    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for ${label}: ${url}" >&2
      return 1
    fi

    sleep 1
  done

  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "${label} process exited after another service answered ${url}" >&2
    return 1
  fi
}

extract_location() {
  local headers_file="$1"

  awk '
    BEGIN { IGNORECASE = 1 }
    /^location:/ {
      sub(/\r$/, "")
      sub(/^location:[[:space:]]*/, "")
      print
    }
  ' "$headers_file" | tail -n 1
}

absolute_url() {
  local location="$1"
  local base="$2"

  case "$location" in
    http://*|https://*) printf '%s\n' "$location" ;;
    /*) printf '%s%s\n' "$base" "$location" ;;
    *) printf '%s/%s\n' "$base" "$location" ;;
  esac
}

build_form_url() {
  local authorize_url="$1"
  local subject="$2"

  node - "$authorize_url" "$subject" <<'NODE'
const authorizeUrl = new URL(process.argv[2]);
const subject = process.argv[3];
const formUrl = new URL("/api/form", authorizeUrl.origin);

for (const name of ["redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "nonce"]) {
  const value = authorizeUrl.searchParams.get(name);
  if (!value) {
    throw new Error(`Missing ${name} in authorization URL`);
  }
  formUrl.searchParams.set(name, value);
}

formUrl.searchParams.set("sub", subject);
console.log(formUrl.href);
NODE
}

assert_auth_context() {
  local response_file="$1"
  local subject="$2"
  local expected_role="$3"

  node - "$response_file" "$subject" "$expected_role" <<'NODE'
const fs = require("node:fs");

const responseFile = process.argv[2];
const subject = process.argv[3];
const expectedRole = process.argv[4];
const payload = JSON.parse(fs.readFileSync(responseFile, "utf8"));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const findForbiddenKeys = (value, path = []) => {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const currentPath = [...path, key];
    if (["access_token", "id_token", "refresh_token", "claims"].includes(key)) {
      return [currentPath.join(".")];
    }
    return findForbiddenKeys(nested, currentPath);
  });
};

if (payload.authenticated !== true) {
  fail("Expected authenticated=true");
}
if (payload.user?.subject !== subject) {
  fail(`Expected subject ${subject}, got ${payload.user?.subject}`);
}
if (payload.user?.email !== `${subject}@example.test`) {
  fail(`Expected ${subject}@example.test, got ${payload.user?.email}`);
}
if (!payload.authorization?.roles?.includes(expectedRole)) {
  fail(`Expected role ${expectedRole}`);
}

const permissions = payload.authorization?.permissions ?? [];
if (expectedRole === "admin") {
  for (const permission of ["users:read", "users:write", "reports:read", "settings:manage"]) {
    if (!permissions.includes(permission)) {
      fail(`Expected admin permission ${permission}`);
    }
  }
} else if (expectedRole === "viewer") {
  if (!permissions.includes("reports:read")) {
    fail("Expected viewer permission reports:read");
  }
  for (const permission of ["users:write", "settings:manage"]) {
    if (permissions.includes(permission)) {
      fail(`Viewer must not have ${permission}`);
    }
  }
}

const forbidden = findForbiddenKeys(payload);
if (forbidden.length > 0) {
  fail(`Response leaked token or claim fields: ${forbidden.join(", ")}`);
}
NODE
}

run_user_flow() {
  local subject="$1"
  local expected_role="$2"
  local backend_cookie="$LOG_DIR/${subject}-backend.cookie"
  local provider_cookie="$LOG_DIR/${subject}-provider.cookie"
  local login_headers="$LOG_DIR/${subject}-login.headers"
  local form_headers="$LOG_DIR/${subject}-form.headers"
  local callback_headers="$LOG_DIR/${subject}-callback.headers"
  local me_response="$LOG_DIR/${subject}-me.json"

  curl -fsS -D "$login_headers" -o /dev/null -c "$backend_cookie" "$BACKEND_URL/auth/login"

  local authorize_url
  authorize_url="$(absolute_url "$(extract_location "$login_headers")" "$PROVIDER_URL")"

  local form_url
  form_url="$(build_form_url "$authorize_url" "$subject")"

  curl -fsS -D "$form_headers" -o /dev/null -b "$provider_cookie" -c "$provider_cookie" "$form_url"

  local callback_url
  callback_url="$(absolute_url "$(extract_location "$form_headers")" "$BACKEND_URL")"

  curl -fsS -D "$callback_headers" -o /dev/null -b "$backend_cookie" -c "$backend_cookie" "$callback_url"

  local final_location
  final_location="$(extract_location "$callback_headers")"
  if [ "$final_location" != "/me" ]; then
    echo "Expected callback redirect to /me, got ${final_location}" >&2
    return 1
  fi

  curl -fsS -b "$backend_cookie" "$BACKEND_URL/auth/me" > "$me_response"
  assert_auth_context "$me_response" "$subject" "$expected_role"
}

OIDC_PROVIDER_PORT="$PROVIDER_PORT" npm run provider > "$LOG_DIR/provider.log" 2>&1 &
provider_pid="$!"

wait_for_http "$PROVIDER_URL/.well-known/openid-configuration" "mock OIDC provider" "$provider_pid"

NODE_ENV=test \
LOG_LEVEL=info \
PORT="$BACKEND_PORT" \
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

wait_for_http "$BACKEND_URL/health/live" "backend liveness" "$backend_pid"

curl -fsS -X POST "$PROVIDER_URL/api/clear" >/dev/null
run_user_flow alice admin

curl -fsS -X POST "$PROVIDER_URL/api/clear" >/dev/null
run_user_flow bob viewer

echo "OIDC smoke test passed."
