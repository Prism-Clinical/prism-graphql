#!/bin/bash

# Test script for Epic API service
echo "🧪 Testing Epic API Integration..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

GATEWAY_URL="http://localhost:4000/graphql"
EPIC_MOCK_URL="http://localhost:8080"
EPIC_API_URL="http://localhost:4006"

echo -e "${BLUE}Testing services...${NC}"

# Test Epic Mock Service
echo -e "${YELLOW}1. Testing Epic Mock Service health...${NC}"
curl -s "$EPIC_MOCK_URL/health" | jq . && echo -e "${GREEN}✓ Epic Mock Service is healthy${NC}" || echo -e "${RED}✗ Epic Mock Service failed${NC}"

# Test Epic API Service health  
echo -e "${YELLOW}2. Testing Epic API Service health...${NC}"
curl -s "$EPIC_API_URL/.well-known/apollo/server-health" && echo -e "${GREEN}✓ Epic API Service is healthy${NC}" || echo -e "${RED}✗ Epic API Service failed${NC}"

# Test Epic connection through GraphQL
echo -e "${YELLOW}3. Testing Epic connection status through GraphQL...${NC}"
curl -s "$GATEWAY_URL" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { epicConnectionStatus { connected lastConnectionTest responseTime errors } }"}' | jq .

# Test syncing patient data from Epic
echo -e "${YELLOW}4. Testing patient data sync from Epic...${NC}"
curl -s "$GATEWAY_URL" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "mutation { syncPatientDataFromEpic(epicPatientId: \"patient-123\", dataTypes: [DEMOGRAPHICS, VITALS, MEDICATIONS]) { success syncedDataTypes totalRecords processingTime errors { dataType message } } }"}' | jq .

# Test fetching Epic patient data
echo -e "${YELLOW}5. Testing Epic patient data fetch...${NC}"
curl -s "$GATEWAY_URL" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { epicPatientData(epicPatientId: \"patient-123\") { epicPatientId demographics { firstName lastName gender dateOfBirth } vitals { type value unit recordedDate } medications { name status dosage } lastSync } }"}' | jq .

# Test data sync status
echo -e "${YELLOW}6. Testing data sync status...${NC}"
curl -s "$GATEWAY_URL" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { epicDataSyncStatus(patientId: \"patient-123\") { patientId lastSync syncInProgress dataFreshness { dataType lastSync isStale } } }"}' | jq .

echo -e "${BLUE}Epic API testing completed!${NC}"