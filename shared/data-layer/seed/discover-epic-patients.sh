#!/bin/bash

# Discover Data-Rich Epic Sandbox Patients
#
# Authenticates with Epic's FHIR sandbox via RS384 JWT and probes test patients
# for data richness (vitals, labs, medications, conditions, allergies).
# Outputs a ranked table sorted by total resource count.
#
# Usage:
#   ./shared/data-layer/seed/discover-epic-patients.sh
#
# Prerequisites:
#   - openssl and jq installed
#   - Epic sandbox private key at ./keys/epic-private-key.pem
#
# This is a one-time discovery utility run manually to find the best test
# patients for local seed data.

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

# Epic sandbox configuration
CLIENT_ID="b071ea66-9918-43f2-ae82-9a67a322ca36"
TOKEN_URL="https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
BASE_URL="https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
KID="prism-clinical-sandbox"
SCOPE="system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs system/AllergyIntolerance.rs"
PRIVATE_KEY_PATH="./keys/epic-private-key.pem"

# Known Epic sandbox patient IDs
KNOWN_PATIENT_IDS=(
  "erXuFYUfucBZaryVksYEcMg3"   # Camila Lopez
  "eq081-VQEgP8drUUqCWzHfw3"   # Derrick Lin
  "TgnR.yiGmEKkry0K5Rnj4kgB"  # Jason Argonaut
)

# =============================================================================
# Helper Functions
# =============================================================================

base64url_encode() {
  openssl base64 -e -A | tr '+/' '-_' | tr -d '='
}

check_dependencies() {
  local missing=()
  for cmd in openssl jq curl; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Missing required tools: ${missing[*]}${NC}"
    echo "Install them and try again."
    exit 1
  fi
}

# Create RS384-signed JWT for Epic backend services auth.
# Follows the same pattern as apps/epic-api-service/src/clients/epic-auth-client.ts
create_jwt() {
  local now
  now=$(date +%s)
  local exp=$((now + 300))
  local jti
  jti=$(openssl rand -hex 16)

  local header
  header=$(printf '{"alg":"RS384","typ":"JWT","kid":"%s"}' "$KID" | base64url_encode)

  local payload
  payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","jti":"%s","iat":%d,"exp":%d}' \
    "$CLIENT_ID" "$CLIENT_ID" "$TOKEN_URL" "$jti" "$now" "$exp" | base64url_encode)

  local signature
  signature=$(printf '%s.%s' "$header" "$payload" \
    | openssl dgst -sha384 -sign "$PRIVATE_KEY_PATH" -binary \
    | base64url_encode)

  printf '%s.%s.%s' "$header" "$payload" "$signature"
}

# Exchange JWT for an access token via client_credentials grant
get_access_token() {
  local jwt
  jwt=$(create_jwt)

  local response
  response=$(curl -sf -X POST "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
    -d "client_assertion=$jwt" \
    -d "scope=$SCOPE" \
    2>&1)

  if [ $? -ne 0 ] || ! echo "$response" | jq -e '.access_token' > /dev/null 2>&1; then
    echo -e "${RED}Failed to obtain access token from Epic${NC}" >&2
    echo "$response" >&2
    exit 1
  fi

  echo "$response" | jq -r '.access_token'
}

# Fetch a FHIR resource, return the JSON body (empty object on failure)
fhir_get() {
  local path="$1"
  local token="$2"

  curl -sf "${BASE_URL}/${path}" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/fhir+json" \
    2>/dev/null || echo '{}'
}

# Count the total entries in a FHIR Bundle (returns 0 on error)
count_bundle() {
  local json="$1"
  echo "$json" | jq '.total // (.entry | length) // 0' 2>/dev/null || echo 0
}

# Extract patient name from a FHIR Patient resource
extract_name() {
  local json="$1"
  local family given

  family=$(echo "$json" | jq -r '
    .name[0].family // "Unknown"
  ' 2>/dev/null || echo "Unknown")

  given=$(echo "$json" | jq -r '
    (.name[0].given // []) | join(" ") // "?"
  ' 2>/dev/null || echo "?")

  printf '%s %s' "$given" "$family"
}

# =============================================================================
# Main
# =============================================================================

echo -e "${CYAN}=== Epic Sandbox Patient Discovery ===${NC}"
echo ""

check_dependencies

if [ ! -f "$PRIVATE_KEY_PATH" ]; then
  echo -e "${RED}Missing private key at $PRIVATE_KEY_PATH${NC}"
  echo "Place your Epic sandbox private key there and try again."
  exit 1
fi
echo -e "${GREEN}Private key found.${NC}"

echo -e "${BLUE}Authenticating with Epic FHIR sandbox...${NC}"
ACCESS_TOKEN=$(get_access_token)
echo -e "${GREEN}Access token acquired.${NC}"
echo ""

# Collect all patient IDs (known + discovered via search)
declare -A ALL_PATIENT_IDS

for pid in "${KNOWN_PATIENT_IDS[@]}"; do
  ALL_PATIENT_IDS["$pid"]=1
done

echo -e "${BLUE}Searching for additional patients...${NC}"
SEARCH_RESPONSE=$(fhir_get "Patient?_count=20" "$ACCESS_TOKEN")
DISCOVERED_IDS=$(echo "$SEARCH_RESPONSE" | jq -r '.entry[]?.resource.id // empty' 2>/dev/null || true)

DISCOVERED_COUNT=0
for pid in $DISCOVERED_IDS; do
  if [ -z "${ALL_PATIENT_IDS[$pid]+_}" ]; then
    ALL_PATIENT_IDS["$pid"]=1
    DISCOVERED_COUNT=$((DISCOVERED_COUNT + 1))
  fi
done
echo -e "${GREEN}Found $DISCOVERED_COUNT additional patients via search.${NC}"
echo -e "Total patients to probe: ${#ALL_PATIENT_IDS[@]}"
echo ""

# Probe each patient for resource counts
echo -e "${BLUE}Probing patients for data richness...${NC}"
echo ""

# Accumulate results as lines: "TOTAL|EPIC_ID|NAME|VITALS|LABS|MEDS|COND|ALLERGY"
RESULTS=""
PROBED=0

for PATIENT_ID in "${!ALL_PATIENT_IDS[@]}"; do
  PROBED=$((PROBED + 1))
  echo -ne "  [$PROBED/${#ALL_PATIENT_IDS[@]}] $PATIENT_ID ... "

  # Fetch patient demographics
  PATIENT_JSON=$(fhir_get "Patient/$PATIENT_ID" "$ACCESS_TOKEN")
  NAME=$(extract_name "$PATIENT_JSON")

  if echo "$PATIENT_JSON" | jq -e '.resourceType == "Patient"' > /dev/null 2>&1; then
    # Count each resource category
    VITALS_JSON=$(fhir_get "Observation?patient=$PATIENT_ID&category=vital-signs&_summary=count" "$ACCESS_TOKEN")
    VITALS=$(count_bundle "$VITALS_JSON")

    LABS_JSON=$(fhir_get "Observation?patient=$PATIENT_ID&category=laboratory&_summary=count" "$ACCESS_TOKEN")
    LABS=$(count_bundle "$LABS_JSON")

    MEDS_JSON=$(fhir_get "MedicationRequest?patient=$PATIENT_ID&_summary=count" "$ACCESS_TOKEN")
    MEDS=$(count_bundle "$MEDS_JSON")

    COND_JSON=$(fhir_get "Condition?patient=$PATIENT_ID&_summary=count" "$ACCESS_TOKEN")
    COND=$(count_bundle "$COND_JSON")

    ALLERGY_JSON=$(fhir_get "AllergyIntolerance?patient=$PATIENT_ID&_summary=count" "$ACCESS_TOKEN")
    ALLERGY=$(count_bundle "$ALLERGY_JSON")

    TOTAL=$((VITALS + LABS + MEDS + COND + ALLERGY))

    echo -e "${GREEN}OK${NC} (total: $TOTAL)"
    RESULTS="${RESULTS}${TOTAL}|${PATIENT_ID}|${NAME}|${VITALS}|${LABS}|${MEDS}|${COND}|${ALLERGY}"$'\n'
  else
    echo -e "${YELLOW}SKIP${NC} (not found or access denied)"
  fi
done

echo ""

# Sort by TOTAL (descending) and display formatted table
echo -e "${CYAN}=== Results (ranked by total resources) ===${NC}"
echo ""

HEADER=$(printf "%-28s  %-22s  %6s  %6s  %6s  %6s  %7s  %6s" \
  "EPIC_PATIENT_ID" "NAME" "VITALS" "LABS" "MEDS" "COND" "ALLERGY" "TOTAL")
echo -e "${BOLD}${HEADER}${NC}"
printf '%.0s-' {1..110}
echo ""

echo "$RESULTS" | sort -t'|' -k1 -nr | while IFS='|' read -r TOTAL PID NAME VITALS LABS MEDS COND ALLERGY; do
  [ -z "$TOTAL" ] && continue
  printf "%-28s  %-22s  %6s  %6s  %6s  %6s  %7s  %6s\n" \
    "$PID" "$NAME" "$VITALS" "$LABS" "$MEDS" "$COND" "$ALLERGY" "$TOTAL"
done

echo ""
echo -e "${GREEN}Discovery complete.${NC}"
echo "Use the top-ranked patients to expand shared/data-layer/seed/epic-sandbox-patients.sql"
