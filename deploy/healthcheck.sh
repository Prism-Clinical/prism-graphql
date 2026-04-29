#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Prism Healthcare Platform — Healthcheck
# Pings all services, PostgreSQL, and Redis.
# Intended to run as cron: */5 * * * *
#
# Logs to: /home/prism/app/logs/healthcheck.log
# ──────────────────────────────────────────────────────────────
set -uo pipefail

APP_DIR="/home/prism/app"
ENV_FILE="${APP_DIR}/.env.production"

# Source env for passwords
if [ -f "${ENV_FILE}" ]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
FAILED=0
TOTAL=0

check_service() {
  local name="$1"
  local port="$2"
  TOTAL=$((TOTAL + 1))
  if curl -sf -o /dev/null --max-time 5 "http://localhost:${port}/.well-known/apollo/server-health" 2>/dev/null \
     || curl -sf -o /dev/null --max-time 5 "http://localhost:${port}" 2>/dev/null; then
    echo "  OK   ${name} (:${port})"
  else
    echo "  FAIL ${name} (:${port})"
    FAILED=$((FAILED + 1))
  fi
}

echo "── Healthcheck ${TIMESTAMP} ──"

# ── Infrastructure ───────────────────────────────────────────
TOTAL=$((TOTAL + 1))
if pg_isready -h localhost -U "${POSTGRES_USER:-prism_user}" > /dev/null 2>&1; then
  echo "  OK   PostgreSQL"
else
  echo "  FAIL PostgreSQL"
  FAILED=$((FAILED + 1))
fi

TOTAL=$((TOTAL + 1))
if REDISCLI_AUTH="${REDIS_PASSWORD:-}" redis-cli -h localhost ping 2>/dev/null | grep -q PONG; then
  echo "  OK   Redis"
else
  echo "  FAIL Redis"
  FAILED=$((FAILED + 1))
fi

# ── Gateway + Federation subgraphs ──────────────────────────
check_service "gateway"        4000
check_service "auth"           4012
check_service "admin"          4011
check_service "pathway"        4016
check_service "patients"       4002
check_service "providers"      4003
check_service "institutions"   4005
check_service "careplan"       4010
check_service "safety"         4009
check_service "transcription"  4007
check_service "rag"            4008
check_service "epic-api"       4006

# ── Standalone services ─────────────────────────────────────
check_service "recommendations"      4001
check_service "recommendation-items" 4004
check_service "careplan-recommender" 4013
check_service "decision-explorer"    4015

# ── Frontends ───────────────────────────────────────────────
check_service "admin-dashboard"    3001
check_service "provider-dashboard" 3000

# ── Summary ─────────────────────────────────────────────────
PASSED=$((TOTAL - FAILED))
echo "── Result: ${PASSED}/${TOTAL} OK ──"

if [ "${FAILED}" -gt 0 ]; then
  echo "WARNING: ${FAILED} check(s) failed"
  exit 1
fi
