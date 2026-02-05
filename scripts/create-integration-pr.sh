#!/bin/bash
# create-integration-pr.sh
# Creates the Ralph service integration PR in prism-graphql following PRD-5.7.2
#
# Prerequisites:
# - GitHub CLI authenticated: gh auth login
# - Current directory: prism-graphql repo root
# - feat/ralph-service-integration branch pushed to origin
#
# Usage: ./scripts/create-integration-pr.sh

set -e

echo "=== Creating Ralph Service Integration PR ==="
echo ""

# Verify gh is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI is not authenticated."
  echo "Run: gh auth login"
  exit 1
fi

# Verify we're in prism-graphql
if [ ! -f "package.json" ] || ! grep -q "healthcare-graphql-federation" package.json 2>/dev/null; then
  echo "ERROR: Must run from prism-graphql repo root"
  exit 1
fi

# Create the integration PR
echo "Creating PR: Ralph Service Integration"
gh pr create \
  --base main \
  --head feat/ralph-service-integration \
  --title "feat: Integrate care-plan-parser and feature-extraction services" \
  --body "$(cat <<'EOF'
## Summary

Integrates prism-ml-infra's TypeScript services (care-plan-parser, feature-extraction) into prism-graphql via thin HTTP service clients.

### Architecture
> **prism-graphql contains NO processing logic** — only service clients and GraphQL resolvers.
> All parsing, validation, extraction, and generation logic lives in prism-ml-infra.

### Changes

#### Service Clients (`apps/careplan-service/src/clients/`)
- **ParserClient**: HTTP client for care-plan-parser service
  - `parse(text)` - Parse care plan document
  - `validate(text)` - Validate document
  - `generate(carePlan)` - Generate document from CarePlan
  - `healthCheck()` - Service health check

- **ExtractionClient**: HTTP client for feature-extraction service
  - `extractVitals(observations)` - Extract vital signs from FHIR

#### Type Bridge (`apps/careplan-service/src/types/`)
- **care-plan-bridge.ts**: Bidirectional mapping between document and persistence CarePlan models
  - `toDocumentFormat()` - Convert persistence model to generator input
  - `toPersistenceFormat()` - Convert parsed document to database input

#### GraphQL Schema (`apps/careplan-service/schema.graphql`)
- `importCarePlanDocument` mutation - Parse and persist document
- `exportCarePlanDocument` query - Load and generate document
- `validateCarePlanDocument` query - Validate without persisting

#### Document Resolvers (`apps/careplan-service/src/resolvers/`)
- **DocumentResolvers.ts**: Import/export/validate resolvers using service clients

#### Environment Configuration
- `docker-compose.yml` - Service URL environment variables
- `.env.example` - Documentation of required env vars

### Dependencies
> ⚠️ **This PR requires prism-ml-infra Epic 4 merged and services deployed.**

Service URLs (defaults for Docker Compose):
- `CARE_PLAN_PARSER_URL=http://care-plan-parser:8080`
- `FEATURE_EXTRACTION_URL=http://feature-extraction:8081`

## Test Plan
- [ ] TypeScript compiles without errors
- [ ] Service clients handle timeouts gracefully
- [ ] Import/export resolvers work when services are running
- [ ] Existing careplan-service tests pass
- [ ] No parsing logic in prism-graphql (only client calls)

### Verification
```bash
# Check for accidental processing logic
grep -r "parseCarePlanDocument" apps/ shared/ --include="*.ts" | grep -v "client"
# Should return no results (only service client calls allowed)
```

---
🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"

echo "✓ Integration PR created"
echo ""
echo "View PR: gh pr view"
