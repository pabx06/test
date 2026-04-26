#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-propriateraydb-smoke}"
FRONTEND_URL="${SMOKE_FRONTEND_URL:-http://localhost:4200}"
BACKEND_URL="${SMOKE_BACKEND_URL:-http://localhost:3000}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-120}"
RESPONSE_FILE="/tmp/${PROJECT_NAME}-smoke-response"

compose() {
  docker compose -p "$PROJECT_NAME" -f docker-compose.yml "$@"
}

cleanup() {
  compose down --volumes --remove-orphans
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))

  until curl -fs "$url" >"$RESPONSE_FILE"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for ${label}: ${url}" >&2
      compose logs --no-color frontend backend db redis >&2 || true
      return 1
    fi

    sleep 2
  done
}

assert_contains() {
  local expected="$1"
  local url="$2"
  local label="$3"

  curl -fsS "$url" >"$RESPONSE_FILE"

  if ! grep -q "$expected" "$RESPONSE_FILE"; then
    echo "Unexpected ${label} response from ${url}" >&2
    cat "$RESPONSE_FILE" >&2
    return 1
  fi
}

trap cleanup EXIT

compose down --volumes --remove-orphans
compose up -d --build

wait_for_http "${BACKEND_URL}/health/startup" "backend startup"
wait_for_http "${BACKEND_URL}/health/ready" "backend readiness"
wait_for_http "${FRONTEND_URL}/" "frontend"
wait_for_http "${FRONTEND_URL}/api/health" "frontend backend proxy"
wait_for_http "${FRONTEND_URL}/auth/login" "frontend auth proxy"

assert_contains "PropriaterayDB" "${FRONTEND_URL}/" "frontend"
assert_contains "propriateraydb-backend" "${BACKEND_URL}/api/health" "backend health"
assert_contains "propriateraydb-backend" "${FRONTEND_URL}/api/health" "frontend proxy health"
assert_contains "mock mode" "${FRONTEND_URL}/auth/login" "frontend auth proxy"

echo "Docker Compose smoke test passed."
