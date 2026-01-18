# Healthcare Federation Database Migrations

This document describes the database migration system for the Healthcare GraphQL Federation.

## Overview

All database schema changes are managed through a versioned migration system that ensures:
- **Reproducible deployments** - Database can be torn down and rebuilt identically
- **Migration tracking** - All applied migrations are recorded with checksums
- **Rollback capability** - Migrations can be rolled back if needed
- **Team synchronization** - All developers work with the same database schema

## Migration Files

Migration files are located in `shared/data-layer/migrations/` and follow the naming convention:
```
{number}_{descriptive_name}.sql
```

### Current Migrations

1. **001_create_patient_sessions.sql** - Patient session tracking
2. **002_create_patients_table.sql** - Core patient demographics and medical records
3. **003_create_providers_table.sql** - Healthcare providers and visits
4. **004_create_institutions_table.sql** - Healthcare institutions
5. **005_create_recommendations_table.sql** - Clinical recommendations and items

## Commands

### Run Migrations
```bash
make migrate
```
Runs all pending migrations that haven't been applied yet.

### Check Migration Status
```bash
make migrate-status
```
Shows which migrations have been applied and when.

### Clean Database and Re-run All Migrations
```bash
make migrate-clean
```
**⚠️ DESTRUCTIVE**: Drops all data and re-runs all migrations from scratch.

## Migration Process

### Creating a New Migration

1. Create a new SQL file in `shared/data-layer/migrations/`:
   ```sql
   -- 006_add_patient_allergies.sql
   CREATE TABLE patient_allergies (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       patient_id UUID NOT NULL REFERENCES patients(id),
       allergen VARCHAR(255) NOT NULL,
       severity VARCHAR(50),
       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   );
   
   CREATE INDEX idx_patient_allergies_patient ON patient_allergies(patient_id);
   ```

2. Update the migration runner script `run-migrations.sh` to include the new migration.

3. Test the migration:
   ```bash
   make migrate
   ```

### Migration Best Practices

- **Always use transactions** - Each migration is wrapped in BEGIN/COMMIT
- **Use IF NOT EXISTS** - Make migrations idempotent when possible
- **Create indexes** - Add appropriate indexes for performance
- **Foreign keys** - Use proper referential integrity
- **Timestamps** - Include created_at/updated_at for audit trails

## Database Schema

### Core Tables

- **patients** - Patient demographics and medical record information
- **providers** - Healthcare providers (doctors, nurses, specialists)
- **institutions** - Hospitals, clinics, labs, etc.
- **visits** - Patient-provider encounters
- **recommendations** - Clinical recommendations for patients
- **recommendation_items** - Specific action items within recommendations
- **migration_history** - Tracks applied migrations

### Relationships

```
institutions (1) -----> (N) providers
patients (1) -----> (N) visits (N) <----- (1) providers
patients (1) -----> (N) recommendations (N) <----- (1) providers
recommendations (1) -----> (N) recommendation_items
```

## Environment Variables

The migration system uses the following environment variables (configured in docker-compose.yml):

- `DB_HOST` - Database hostname (default: postgres)
- `DB_PORT` - Database port (default: 5432)
- `DB_NAME` - Database name (default: healthcare_federation)
- `DB_USER` - Database user (default: postgres)
- `DB_PASSWORD` - Database password (default: postgres)

## Troubleshooting

### Migration Fails
If a migration fails, check:
1. Database connectivity
2. SQL syntax errors
3. Constraint violations
4. Missing dependencies

### Reset Database
To completely reset the database:
```bash
make migrate-clean
```

### Check Applied Migrations
```bash
make migrate-status
```

This will show all migrations that have been successfully applied to the database.

## Development Workflow

1. **Start services**: `make quick-start`
2. **Run migrations**: `make migrate` (done automatically on first start)
3. **Make schema changes**: Create new migration file
4. **Apply changes**: `make migrate`
5. **Verify**: `make migrate-status`

The migration system ensures that your local development database matches production and can be easily recreated from scratch.