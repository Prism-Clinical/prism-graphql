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
