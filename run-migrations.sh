#!/bin/bash

# Healthcare Federation Migration Runner
echo "🏥 Running Healthcare Federation Database Migrations..."

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

# Function to calculate checksum (simple approach)
calculate_checksum() {
  echo -n "$1" | shasum -a 256 | cut -d' ' -f1
}

# Run each migration in order
echo "🔄 Running migrations..."

# Migration 001: Create patient sessions
if ! docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT 1 FROM migration_history WHERE migration_id = '001_create_patient_sessions'" | grep -q '1 row'; then
  echo "📋 Running migration: 001_create_patient_sessions"
  MIGRATION_SQL=$(cat shared/data-layer/migrations/001_create_patient_sessions.sql)
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")
  
  docker compose exec postgres psql -U postgres -d healthcare_federation -f /dev/stdin << EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('001_create_patient_sessions', 'Create patient sessions table', '$CHECKSUM');
COMMIT;
EOF
  echo "✅ Applied: 001_create_patient_sessions"
else
  echo "⏭️  Skipping: 001_create_patient_sessions (already applied)"
fi

# Migration 002: Create patients table
if ! docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT 1 FROM migration_history WHERE migration_id = '002_create_patients_table'" | grep -q '1 row'; then
  echo "📋 Running migration: 002_create_patients_table"
  MIGRATION_SQL=$(cat shared/data-layer/migrations/002_create_patients_table.sql)
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")
  
  docker compose exec postgres psql -U postgres -d healthcare_federation -f /dev/stdin << EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('002_create_patients_table', 'Create patients table', '$CHECKSUM');
COMMIT;
EOF
  echo "✅ Applied: 002_create_patients_table"
else
  echo "⏭️  Skipping: 002_create_patients_table (already applied)"
fi

# Migration 003: Create providers table
if ! docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT 1 FROM migration_history WHERE migration_id = '003_create_providers_table'" | grep -q '1 row'; then
  echo "📋 Running migration: 003_create_providers_table"
  MIGRATION_SQL=$(cat shared/data-layer/migrations/003_create_providers_table.sql)
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")
  
  docker compose exec postgres psql -U postgres -d healthcare_federation -f /dev/stdin << EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('003_create_providers_table', 'Create providers table', '$CHECKSUM');
COMMIT;
EOF
  echo "✅ Applied: 003_create_providers_table"
else
  echo "⏭️  Skipping: 003_create_providers_table (already applied)"
fi

# Migration 004: Create institutions table
if ! docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT 1 FROM migration_history WHERE migration_id = '004_create_institutions_table'" | grep -q '1 row'; then
  echo "📋 Running migration: 004_create_institutions_table"
  MIGRATION_SQL=$(cat shared/data-layer/migrations/004_create_institutions_table.sql)
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")
  
  docker compose exec postgres psql -U postgres -d healthcare_federation -f /dev/stdin << EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('004_create_institutions_table', 'Create institutions table', '$CHECKSUM');
COMMIT;
EOF
  echo "✅ Applied: 004_create_institutions_table"
else
  echo "⏭️  Skipping: 004_create_institutions_table (already applied)"
fi

# Migration 005: Create recommendations table
if ! docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT 1 FROM migration_history WHERE migration_id = '005_create_recommendations_table'" | grep -q '1 row'; then
  echo "📋 Running migration: 005_create_recommendations_table"
  MIGRATION_SQL=$(cat shared/data-layer/migrations/005_create_recommendations_table.sql)
  CHECKSUM=$(calculate_checksum "$MIGRATION_SQL")
  
  docker compose exec postgres psql -U postgres -d healthcare_federation -f /dev/stdin << EOF
BEGIN;
$MIGRATION_SQL
INSERT INTO migration_history (migration_id, name, checksum) VALUES ('005_create_recommendations_table', 'Create recommendations table', '$CHECKSUM');
COMMIT;
EOF
  echo "✅ Applied: 005_create_recommendations_table"
else
  echo "⏭️  Skipping: 005_create_recommendations_table (already applied)"
fi

# Restore backed up data if it exists
echo "🔄 Restoring patient data..."
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
INSERT INTO patients SELECT * FROM patients_backup;
" 2>/dev/null || echo "No existing patient data to restore"

echo "✅ All migrations completed successfully!"
echo "📊 Migration status:"
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
SELECT migration_id, name, applied_at 
FROM migration_history 
ORDER BY applied_at;
"