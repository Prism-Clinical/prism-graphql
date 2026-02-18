# Epic FHIR Sandbox Test Data Seed — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `make seed-epic-data` command that populates the dev database with real test patients and clinical data from Epic's FHIR sandbox.

**Architecture:** A Docker Compose override switches epic-api-service from the local mock to Epic's sandbox (`fhir.epic.com`). A SQL script seeds patients/providers/institutions into Postgres. A shell script then calls the existing `createClinicalSnapshot` GraphQL mutation for each patient, which fetches live FHIR data from Epic and stores it in the clinical snapshot tables.

**Tech Stack:** Bash, SQL (PostgreSQL), Docker Compose override, curl (GraphQL), existing epic-api-service resolvers

---

## Task 1: Create the Docker Compose Epic Sandbox Override

**Files:**
- Create: `docker-compose.epic-sandbox.yml`

**Step 1: Write the override file**

This overrides only the epic-api-service environment variables to point at the real Epic sandbox instead of epic-mock. It also removes the `depends_on` for epic-mock since we won't need it.

```yaml
# docker-compose.epic-sandbox.yml
# Override to use real Epic FHIR sandbox instead of epic-mock.
# Usage: docker compose -f docker-compose.yml -f docker-compose.epic-sandbox.yml up -d epic-api-service
services:
  epic-api-service:
    environment:
      - EPIC_BASE_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
      - EPIC_CLIENT_ID=b071ea66-9918-43f2-ae82-9a67a322ca36
      - EPIC_TOKEN_URL=https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
      - EPIC_AUTH_ENABLED=true
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

**Step 2: Verify the override parses correctly**

Run: `cd /home/claude/workspace/prism-graphql && docker compose -f docker-compose.yml -f docker-compose.epic-sandbox.yml config --services 2>&1 | head -5`

Expected: List of service names, no parse errors.

**Step 3: Commit**

```bash
git add docker-compose.epic-sandbox.yml
git commit -m "feat: add docker-compose override for Epic FHIR sandbox"
```

---

## Task 2: Create the Seed Directory and SQL Seed Script

**Files:**
- Create: `shared/data-layer/seed/epic-sandbox-patients.sql`

**Step 1: Create the seed directory**

```bash
mkdir -p shared/data-layer/seed
```

**Step 2: Write the SQL seed script**

This script inserts a test institution, test provider, and known Epic sandbox test patients. All inserts use `ON CONFLICT DO NOTHING` for idempotency. The `epic_patient_id` values are real IDs from Epic's open FHIR sandbox.

```sql
-- Epic FHIR Sandbox Test Data Seed
-- Populates patients, providers, and institutions with known Epic sandbox data.
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING).

BEGIN;

-- ============================================================================
-- Institution
-- ============================================================================
INSERT INTO institutions (id, name, type, phone, email, active)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'Prism Dev Clinic',
  'clinic',
  '(555) 100-0001',
  'admin@prism-dev-clinic.test',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Provider
-- ============================================================================
INSERT INTO providers (id, first_name, last_name, specialty, npi, email, department, institution_id, active)
VALUES (
  '00000000-0000-4000-a000-000000000002',
  'Dev',
  'Doctor',
  'Internal Medicine',
  '1234567890',
  'dev.doctor@prism-dev-clinic.test',
  'Primary Care',
  '00000000-0000-4000-a000-000000000001',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Epic Sandbox Test Patients
--
-- These are known patient IDs from Epic's open FHIR sandbox.
-- The epic_patient_id links to the FHIR Patient resource ID used by
-- epic-api-service to fetch clinical data.
--
-- To find more valid IDs, use the searchEpicPatients query or check
-- https://fhir.epic.com/Documentation
-- ============================================================================

-- Camila Lopez (confirmed working in test-sandbox.ts)
INSERT INTO patients (id, first_name, last_name, date_of_birth, gender, medical_record_number, epic_patient_id)
VALUES (
  '00000000-0000-4000-b000-000000000001',
  'Camila', 'Lopez', '1987-09-12', 'female', 'EPIC-SEED-001', 'erXuFYUfucBZaryVksYEcMg3'
)
ON CONFLICT (medical_record_number) DO NOTHING;

-- Add more Epic sandbox patients below as you discover valid IDs.
-- Use the searchEpicPatients GraphQL query or test-sandbox.ts to validate IDs.
--
-- Example:
-- INSERT INTO patients (id, first_name, last_name, date_of_birth, gender, medical_record_number, epic_patient_id)
-- VALUES (
--   '00000000-0000-4000-b000-000000000002',
--   'Jason', 'Argonaut', '1985-08-01', 'male', 'EPIC-SEED-002', '<epic-patient-id-here>'
-- )
-- ON CONFLICT (medical_record_number) DO NOTHING;

COMMIT;
```

**Step 3: Verify the SQL is valid**

Run: `cd /home/claude/workspace/prism-graphql && docker compose exec -T postgres psql -U postgres -d healthcare_federation -f - < shared/data-layer/seed/epic-sandbox-patients.sql`

Expected: `BEGIN`, `INSERT 0 1` (or `INSERT 0 0` if already seeded), `COMMIT`. No errors.

**Step 4: Verify data was inserted**

Run: `cd /home/claude/workspace/prism-graphql && docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT id, first_name, last_name, epic_patient_id FROM patients WHERE epic_patient_id IS NOT NULL;"`

Expected: Row for Camila Lopez with `epic_patient_id = erXuFYUfucBZaryVksYEcMg3`.

**Step 5: Commit**

```bash
git add shared/data-layer/seed/epic-sandbox-patients.sql
git commit -m "feat: add SQL seed for Epic sandbox test patients"
```

---

## Task 3: Create the Snapshot Seed Script

**Files:**
- Create: `shared/data-layer/seed/seed-epic-snapshots.sh`

**Step 1: Write the snapshot seed script**

This script reads `epic_patient_id` values from the database, then calls `createClinicalSnapshot` via GraphQL for each one. The mutation is served by epic-api-service which fetches real FHIR data from Epic's sandbox.

```bash
#!/bin/bash

# Seed Clinical Snapshots from Epic FHIR Sandbox
# Calls createClinicalSnapshot for each patient with an epic_patient_id.
# Requires: epic-api-service running and pointed at Epic sandbox.

set -euo pipefail

EPIC_API_URL="${EPIC_API_URL:-http://localhost:4006/graphql}"
MAX_WAIT=60
WAITED=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Seeding clinical snapshots from Epic FHIR sandbox...${NC}"

# Wait for epic-api-service to be healthy
echo "Waiting for epic-api-service at $EPIC_API_URL ..."
until curl -sf "$EPIC_API_URL" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { __typename }"}' > /dev/null 2>&1; do
  WAITED=$((WAITED + 2))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo -e "${RED}epic-api-service did not become ready within ${MAX_WAIT}s${NC}"
    exit 1
  fi
  sleep 2
done
echo -e "${GREEN}epic-api-service is ready.${NC}"

# Get all epic_patient_ids from the database
EPIC_IDS=$(docker compose exec -T postgres psql -U postgres -d healthcare_federation -tAc \
  "SELECT epic_patient_id FROM patients WHERE epic_patient_id IS NOT NULL AND epic_patient_id != '';")

if [ -z "$EPIC_IDS" ]; then
  echo -e "${YELLOW}No patients with epic_patient_id found. Run the SQL seed first.${NC}"
  exit 0
fi

SUCCESS=0
FAILED=0

for EPIC_ID in $EPIC_IDS; do
  echo -n "  Creating snapshot for $EPIC_ID ... "

  RESPONSE=$(curl -sf "$EPIC_API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"mutation { createClinicalSnapshot(epicPatientId: \\\"$EPIC_ID\\\", trigger: MANUAL_REFRESH) { snapshot { id snapshotVersion epicPatientId } isNew } }\"}" \
    2>&1) || true

  if echo "$RESPONSE" | grep -q '"snapshotVersion"'; then
    VERSION=$(echo "$RESPONSE" | grep -o '"snapshotVersion":[0-9]*' | cut -d: -f2)
    echo -e "${GREEN}OK (version $VERSION)${NC}"
    SUCCESS=$((SUCCESS + 1))
  else
    ERROR=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1 || echo "unknown error")
    echo -e "${RED}FAILED${NC} — $ERROR"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo -e "Snapshot summary: ${GREEN}$SUCCESS succeeded${NC}, ${RED}$FAILED failed${NC}"
```

**Step 2: Make it executable**

```bash
chmod +x shared/data-layer/seed/seed-epic-snapshots.sh
```

**Step 3: Commit**

```bash
git add shared/data-layer/seed/seed-epic-snapshots.sh
git commit -m "feat: add snapshot seed script for Epic sandbox data"
```

---

## Task 4: Create the Seed Runner (Orchestrator)

**Files:**
- Create: `shared/data-layer/seed/seed-runner.sh`

**Step 1: Write the orchestrator**

```bash
#!/bin/bash

# Epic FHIR Sandbox Seed Runner
# Orchestrates: SQL seed → clinical snapshot creation.
# Usage: make seed-epic-data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Epic FHIR Sandbox Data Seed ===${NC}"
echo ""

# Pre-flight: check that postgres is reachable
echo -e "${BLUE}Checking database connection...${NC}"
if ! docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo -e "${RED}Database is not running. Run 'make compose-up' first.${NC}"
  exit 1
fi

# Pre-flight: check that keys exist
if [ ! -f "$REPO_ROOT/keys/epic-private-key.pem" ]; then
  echo -e "${RED}Missing keys/epic-private-key.pem. Place your Epic sandbox private key there.${NC}"
  exit 1
fi

# Step 1: SQL seed
echo -e "${BLUE}Step 1: Seeding patients, providers, and institutions...${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation \
  < "$SCRIPT_DIR/epic-sandbox-patients.sql"
echo -e "${GREEN}SQL seed complete.${NC}"
echo ""

# Step 2: Clinical snapshots
echo -e "${BLUE}Step 2: Creating clinical snapshots from Epic sandbox...${NC}"
"$SCRIPT_DIR/seed-epic-snapshots.sh"
echo ""

echo -e "${CYAN}=== Seed Complete ===${NC}"

# Summary: show what's in the database
echo ""
echo -e "${BLUE}Database contents:${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) as patients FROM patients;"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) as providers FROM providers;"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) as snapshots FROM patient_clinical_snapshots;"
```

**Step 2: Make it executable**

```bash
chmod +x shared/data-layer/seed/seed-runner.sh
```

**Step 3: Commit**

```bash
git add shared/data-layer/seed/seed-runner.sh
git commit -m "feat: add seed runner orchestrator"
```

---

## Task 5: Add Makefile Targets

**Files:**
- Modify: `Makefile` (add targets after the `migrate-clean` target, around line 112)

**Step 1: Add the seed targets**

After the `migrate-clean` target (line 112), add:

```makefile

seed-epic-data: ## Database - Seed Epic sandbox test patients + clinical snapshots
	@echo "$(BLUE)Seeding Epic sandbox data...$(NC)"
	@./shared/data-layer/seed/seed-runner.sh

seed-epic-sql: ## Database - Seed patients/providers/institutions only (no snapshots)
	@echo "$(BLUE)Seeding SQL data only...$(NC)"
	@docker compose exec -T postgres psql -U postgres -d healthcare_federation < shared/data-layer/seed/epic-sandbox-patients.sql
	@echo "$(GREEN)✓ SQL seed completed$(NC)"
```

Also add the new targets to the `.PHONY` declaration at line 5:

```makefile
.PHONY: seed-epic-data seed-epic-sql
```

**Step 2: Verify the target is listed**

Run: `cd /home/claude/workspace/prism-graphql && make help`

Expected: `seed-epic-data` and `seed-epic-sql` appear under Database section.

**Step 3: Commit**

```bash
git add Makefile
git commit -m "feat: add make seed-epic-data target"
```

---

## Task 6: Add Compose Target for Epic Sandbox Mode

**Files:**
- Modify: `Makefile` (add a compose-up target variant for Epic sandbox)

**Step 1: Add the sandbox compose target**

After the `compose-restart` target (around line 53), add:

```makefile

compose-up-epic: ## Docker - Start services with Epic sandbox (not mock)
	@echo "$(BLUE)Starting with Epic FHIR sandbox...$(NC)"
	@if [ ! -f keys/epic-private-key.pem ]; then \
		echo "$(RED)Missing keys/epic-private-key.pem$(NC)"; \
		exit 1; \
	fi
	@docker compose -f docker-compose.yml -f docker-compose.epic-sandbox.yml up -d --build
	@echo "$(GREEN)✅ Services started with Epic sandbox! Gateway at http://localhost:4000$(NC)"
```

Also add to `.PHONY`:

```makefile
.PHONY: compose-up-epic
```

**Step 2: Commit**

```bash
git add Makefile
git commit -m "feat: add make compose-up-epic for Epic sandbox mode"
```

---

## Task 7: End-to-End Test

**No files to create — this is a manual validation task.**

**Step 1: Ensure the private key is in place**

```bash
ls -la keys/epic-private-key.pem
```

Expected: File exists with reasonable size (1-3 KB).

**Step 2: Start the stack in Epic sandbox mode**

```bash
make compose-up-epic
```

Wait for services to be healthy:

```bash
make status
```

Expected: All containers running, including `healthcare-epic-api`.

**Step 3: Run migrations**

```bash
make migrate
```

Expected: Migrations applied (or skipped if already applied).

**Step 4: Run the seed**

```bash
make seed-epic-data
```

Expected output:
```
=== Epic FHIR Sandbox Data Seed ===

Step 1: Seeding patients, providers, and institutions...
SQL seed complete.

Step 2: Creating clinical snapshots from Epic sandbox...
epic-api-service is ready.
  Creating snapshot for erXuFYUfucBZaryVksYEcMg3 ... OK (version 1)

Snapshot summary: 1 succeeded, 0 failed

=== Seed Complete ===

 patients
--------
       1

 providers
----------
        1

 snapshots
----------
        1
```

**Step 5: Verify via GraphQL**

Query the gateway to confirm data is accessible:

```bash
curl -s http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ patients { id firstName lastName epicPatientId } }"}' | jq .
```

Expected: Camila Lopez with `epicPatientId: erXuFYUfucBZaryVksYEcMg3`.

```bash
curl -s http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ latestSnapshot(epicPatientId: \"erXuFYUfucBZaryVksYEcMg3\") { id snapshotVersion demographics { firstName lastName } vitals { observationType value unit } medications { name status } diagnoses { display clinicalStatus } } }"}' | jq .
```

Expected: Clinical snapshot with demographics, vitals, medications, and diagnoses from Epic's sandbox data.

**Step 6: Verify idempotency**

Run `make seed-epic-data` again. Expected: SQL inserts show `INSERT 0 0` (no duplicates), snapshot gets version 2.

**Step 7: Open the frontend**

Navigate to `http://localhost:3000`. Expected: Patient list shows Camila Lopez. (If patient detail page is wired, clicking through should show clinical data.)

---

## Quick Reference

**Full startup flow with Epic sandbox:**
```bash
make compose-up-epic     # Start stack with Epic sandbox
make migrate             # Create/update tables
make seed-epic-data      # Seed patients + clinical snapshots
```

**Adding more test patients:**

1. Find valid Epic sandbox patient IDs:
   ```bash
   curl -s http://localhost:4006/graphql \
     -H "Content-Type: application/json" \
     -d '{"query":"{ searchEpicPatients(input: { family: \"Smith\" }) { results { epicPatientId firstName lastName } } }"}' | jq .
   ```

2. Add the new patient to `shared/data-layer/seed/epic-sandbox-patients.sql`

3. Re-run `make seed-epic-data`
