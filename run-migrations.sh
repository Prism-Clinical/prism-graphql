#!/bin/bash

# Healthcare Federation Migration Runner
# Auto-discovers and runs all .sql migrations in sorted order.

MIGRATIONS_DIR="shared/data-layer/migrations"

echo "Running Healthcare Federation Database Migrations..."

# Wait for database to be ready
echo "Waiting for database to be ready..."
until docker compose exec postgres pg_isready -U postgres > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready!"

# Create migration tracking table
echo "Creating migration tracking table..."
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
CREATE TABLE IF NOT EXISTS migration_history (
  migration_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NOT NULL
);
"

# Function to calculate checksum
calculate_checksum() {
  echo -n "$1" | shasum -a 256 | cut -d' ' -f1
}

# Auto-discover and run all migrations in sorted order
echo "Running migrations..."

APPLIED=0
SKIPPED=0
FAILED=0

for MIGRATION_FILE in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  FILENAME=$(basename "$MIGRATION_FILE")
  MIGRATION_ID="${FILENAME%.sql}"

  # Check if already applied
  if docker compose exec postgres psql -U postgres -d healthcare_federation -tAc \
    "SELECT 1 FROM migration_history WHERE migration_id = '$MIGRATION_ID'" | grep -q '1'; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "Applying: $MIGRATION_ID"
  MIGRATION_SQL=$(cat "$MIGRATION_FILE")
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")

  if docker compose exec -T postgres psql -U postgres -d healthcare_federation <<EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$MIGRATION_ID', '$MIGRATION_ID', '$CHECKSUM');
COMMIT;
EOF
  then
    echo "  Applied: $MIGRATION_ID"
    APPLIED=$((APPLIED + 1))
  else
    echo "  FAILED: $MIGRATION_ID"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "Migration summary: $APPLIED applied, $SKIPPED already applied, $FAILED failed"
echo ""
echo "Migration history:"
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
SELECT migration_id, applied_at
FROM migration_history
ORDER BY migration_id;
"
