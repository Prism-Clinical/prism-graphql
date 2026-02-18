#!/bin/bash

# One-time script to clean up migration_history after fixing the runner + migrations.
# Removes entries for migrations that failed but were incorrectly recorded,
# and drops the broken tables so they can be recreated cleanly.
#
# Usage: ./fix-migration-history.sh
# Prerequisites: docker compose services running (make compose-up)

set -e

echo "Fixing migration history..."

# Wait for database
until docker compose exec postgres pg_isready -U postgres > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 2
done

# Migrations that failed but may have been recorded as applied
BROKEN_MIGRATIONS=(
  "001_create_patient_sessions"
  "002_create_patient_demographics"
  "003_create_clinical_data"
  "004_create_recommendation_jobs"
  "009_create_safety_checks"
)

echo "Removing incorrectly recorded migrations and their artifacts..."

for MIG in "${BROKEN_MIGRATIONS[@]}"; do
  echo "  Cleaning: $MIG"
  docker compose exec -T postgres psql -U postgres -d healthcare_federation -v ON_ERROR_STOP=1 <<EOF
DELETE FROM migration_history WHERE migration_id = '$MIG';
EOF
done

# Drop tables that were created by the broken migrations (if they exist)
# so they can be recreated cleanly on next run.
echo "Dropping tables from broken migrations (if they exist)..."
docker compose exec -T postgres psql -U postgres -d healthcare_federation <<EOF
DROP TABLE IF EXISTS recommendation_jobs CASCADE;
DROP TABLE IF EXISTS review_queue CASCADE;
DROP TABLE IF EXISTS safety_checks CASCADE;
DROP TABLE IF EXISTS patient_sessions CASCADE;
DROP TABLE IF EXISTS patient_demographics CASCADE;
DROP TABLE IF EXISTS clinical_data CASCADE;
EOF

echo ""
echo "Done. Now run: make migrate"
echo "Migrations 001-004 and 009 will be re-applied with the fixed SQL."
