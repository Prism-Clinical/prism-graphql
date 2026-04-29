#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Prism Healthcare Platform — Migration Runner (VM / bare-metal)
# Direct port of prism-graphql/run-migrations.sh replacing
# docker compose exec with direct psql.
#
# Expects env vars: POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB, POSTGRES_HOST
# ──────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/prism/app"
GRAPHQL_DIR="${APP_DIR}/prism-graphql"
ENV_FILE="${APP_DIR}/.env.production"

# Source env if not already loaded
if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f "${ENV_FILE}" ]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

PG_USER="${POSTGRES_USER:-prism_user}"
PG_DB="${POSTGRES_DB:-healthcare_federation}"
PG_HOST="${POSTGRES_HOST:-localhost}"
export PGPASSWORD="${POSTGRES_PASSWORD:?'POSTGRES_PASSWORD not set'}"

# Helper: run psql
run_psql() {
  psql -h "${PG_HOST}" -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 "$@"
}

echo "Running Healthcare Federation Database Migrations..."

# Wait for database
echo "Waiting for database to be ready..."
until pg_isready -h "${PG_HOST}" -U "${PG_USER}" > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 2
done
echo "Database is ready!"

# Create migration tracking table
echo "Creating migration tracking table..."
run_psql -c "
CREATE TABLE IF NOT EXISTS migration_history (
  migration_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NOT NULL
);
"

# Checksum helper
calculate_checksum() {
  echo -n "$1" | shasum -a 256 | cut -d' ' -f1
}

# Extract only UP portion (strip -- DOWN and below)
extract_up_sql() {
  local file="$1"
  sed '/^-- DOWN$/,$d' "$file"
}

# ── Collect all migration directories ────────────────────────
MIGRATION_DIRS=(
  "${GRAPHQL_DIR}/shared/data-layer/migrations"
  "${GRAPHQL_DIR}/apps/auth-service/migrations"
  "${GRAPHQL_DIR}/apps/admin-service/migrations"
  "${GRAPHQL_DIR}/apps/pathway-service/migrations"
)

APPLIED=0
SKIPPED=0
FAILED=0

for MIGRATIONS_DIR in "${MIGRATION_DIRS[@]}"; do
  if [ ! -d "${MIGRATIONS_DIR}" ]; then
    continue
  fi

  echo ""
  echo "── Migrations from: ${MIGRATIONS_DIR##*/prism-graphql/} ──"

  for MIGRATION_FILE in $(ls "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort); do
    FILENAME=$(basename "${MIGRATION_FILE}")
    MIGRATION_ID="${FILENAME%.sql}"

    # Check if already applied
    if run_psql -tAc "SELECT 1 FROM migration_history WHERE migration_id = '${MIGRATION_ID}'" | grep -q '1'; then
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    echo "Applying: ${MIGRATION_ID}"
    MIGRATION_SQL=$(extract_up_sql "${MIGRATION_FILE}")
    CHECKSUM=$(calculate_checksum "${MIGRATION_SQL}")

    # Check if migration has its own BEGIN/COMMIT
    if echo "${MIGRATION_SQL}" | grep -qE '^\s*BEGIN\s*;'; then
      # Migration manages its own transaction
      if run_psql <<EOF
${MIGRATION_SQL}
EOF
      then
        run_psql -c "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('${MIGRATION_ID}', '${MIGRATION_ID}', '${CHECKSUM}');"
        echo "  Applied: ${MIGRATION_ID}"
        APPLIED=$((APPLIED + 1))
      else
        echo "  FAILED: ${MIGRATION_ID}"
        FAILED=$((FAILED + 1))
      fi
    else
      # Wrap in transaction
      if run_psql <<EOF
BEGIN;
${MIGRATION_SQL}
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('${MIGRATION_ID}', '${MIGRATION_ID}', '${CHECKSUM}');
COMMIT;
EOF
      then
        echo "  Applied: ${MIGRATION_ID}"
        APPLIED=$((APPLIED + 1))
      else
        echo "  FAILED: ${MIGRATION_ID}"
        FAILED=$((FAILED + 1))
      fi
    fi
  done
done

echo ""
echo "Migration summary: ${APPLIED} applied, ${SKIPPED} already applied, ${FAILED} failed"

if [ "${FAILED}" -gt 0 ]; then
  echo "WARNING: ${FAILED} migration(s) failed. Check output above for details."
fi

echo ""
echo "Migration history:"
run_psql -c "
SELECT migration_id, applied_at
FROM migration_history
ORDER BY migration_id;
"
