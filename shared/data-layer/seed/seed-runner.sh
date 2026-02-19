#!/bin/bash

# Epic FHIR Sandbox Seed Runner
#
# One-command setup for local test data:
#   1. Runs pending database migrations
#   2. Seeds patients, providers, and institutions
#   3. Creates clinical snapshots from Epic FHIR sandbox
#
# Usage:
#   make seed-epic-data          (from repo root)
#   ./shared/data-layer/seed/seed-runner.sh
#
# Requires:
#   - Docker Compose stack running (make compose-up)
#   - Epic sandbox private key at ./keys/epic-private-key.pem

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}=== Epic FHIR Sandbox Data Seed ===${NC}"
echo ""

# --- Pre-flight checks ---

echo -e "${BLUE}Pre-flight checks...${NC}"

if ! docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo -e "${RED}Database is not running. Run 'make compose-up' first.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Database is reachable"

if [ ! -f "$REPO_ROOT/keys/epic-private-key.pem" ]; then
  echo -e "${RED}Missing keys/epic-private-key.pem. Place your Epic sandbox private key there.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Epic private key found"
echo ""

# --- Step 1: Run migrations ---

echo -e "${BLUE}Step 1: Running pending database migrations...${NC}"
"$REPO_ROOT/run-migrations.sh"
echo -e "${GREEN}✓ Migrations up to date.${NC}"
echo ""

# --- Step 2: SQL seed ---

echo -e "${BLUE}Step 2: Seeding patients, providers, and institutions...${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation \
  < "$SCRIPT_DIR/epic-sandbox-patients.sql"
echo -e "${GREEN}✓ SQL seed complete.${NC}"
echo ""

# --- Step 3: Clinical snapshots ---

echo -e "${BLUE}Step 3: Creating clinical snapshots from Epic sandbox...${NC}"
"$SCRIPT_DIR/seed-epic-snapshots.sh"
echo ""

# --- Summary ---

echo -e "${CYAN}=== Seed Complete ===${NC}"
echo ""

echo -e "${BOLD}Database contents:${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -tAc "
  SELECT format('  Patients:    %s', count(*)) FROM patients
  UNION ALL
  SELECT format('  Providers:   %s', count(*)) FROM providers
  UNION ALL
  SELECT format('  Institutions:%s', count(*)) FROM institutions
  UNION ALL
  SELECT format('  Snapshots:   %s', count(*)) FROM patient_clinical_snapshots
  UNION ALL
  SELECT format('  Conditions:  %s', count(*)) FROM snapshot_conditions
  UNION ALL
  SELECT format('  Medications: %s', count(*)) FROM snapshot_medications
  UNION ALL
  SELECT format('  Vitals:      %s', count(*)) FROM snapshot_vitals
  UNION ALL
  SELECT format('  Labs:        %s', count(*)) FROM snapshot_lab_results
  UNION ALL
  SELECT format('  Allergies:   %s', count(*)) FROM snapshot_allergies;
"
echo ""
