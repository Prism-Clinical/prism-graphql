#!/bin/bash

# Epic FHIR Sandbox Seed Runner
# Orchestrates the SQL seed and clinical snapshot creation.
# Requires: Docker Compose stack running, Epic private key in place.

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

# --- Pre-flight checks ---

echo -e "${BLUE}Checking database connection...${NC}"
if ! docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo -e "${RED}Database is not running. Run 'make compose-up' first.${NC}"
  exit 1
fi
echo -e "${GREEN}Database is reachable.${NC}"

if [ ! -f "$REPO_ROOT/keys/epic-private-key.pem" ]; then
  echo -e "${RED}Missing keys/epic-private-key.pem. Place your Epic sandbox private key there.${NC}"
  exit 1
fi
echo -e "${GREEN}Epic private key found.${NC}"
echo ""

# --- Step 1: SQL seed ---

echo -e "${BLUE}Step 1: Seeding patients, providers, and institutions...${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation \
  < "$SCRIPT_DIR/epic-sandbox-patients.sql"
echo -e "${GREEN}SQL seed complete.${NC}"
echo ""

# --- Step 2: Clinical snapshots ---

echo -e "${BLUE}Step 2: Creating clinical snapshots from Epic sandbox...${NC}"
"$SCRIPT_DIR/seed-epic-snapshots.sh"
echo ""

# --- Done ---

echo -e "${CYAN}=== Seed Complete ===${NC}"
echo ""

echo -e "${BLUE}Database contents:${NC}"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) AS patients FROM patients;"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) AS providers FROM providers;"
docker compose exec -T postgres psql -U postgres -d healthcare_federation -c \
  "SELECT count(*) AS snapshots FROM patient_clinical_snapshots;"
