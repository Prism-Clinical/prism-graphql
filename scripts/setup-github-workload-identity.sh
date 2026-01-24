#!/bin/bash
# Setup Workload Identity Federation for GitHub Actions
# This script configures GCP to allow GitHub Actions to authenticate without service account keys

set -e

# Configuration - Update these values
PROJECT_ID="${GCP_PROJECT_ID:-athena-prod-484720}"
GITHUB_REPO="${GITHUB_REPO:-}"  # e.g., "your-org/prism-graphql"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"
SA_NAME="github-actions"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Workload Identity Federation for GitHub Actions${NC}"
echo "Project ID: $PROJECT_ID"

# Validate inputs
if [ -z "$GITHUB_REPO" ]; then
    echo -e "${RED}Error: GITHUB_REPO environment variable is required${NC}"
    echo "Usage: GITHUB_REPO=your-org/prism-graphql ./scripts/setup-github-workload-identity.sh"
    exit 1
fi

echo "GitHub Repository: $GITHUB_REPO"
echo ""

# Get project number
echo -e "${YELLOW}Getting project number...${NC}"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
echo "Project Number: $PROJECT_NUMBER"

# Create Workload Identity Pool
echo -e "${YELLOW}Creating Workload Identity Pool...${NC}"
if gcloud iam workload-identity-pools describe "$POOL_NAME" \
    --project="$PROJECT_ID" \
    --location="global" &>/dev/null; then
    echo "Pool '$POOL_NAME' already exists, skipping creation"
else
    gcloud iam workload-identity-pools create "$POOL_NAME" \
        --project="$PROJECT_ID" \
        --location="global" \
        --display-name="GitHub Actions Pool" \
        --description="Workload Identity Pool for GitHub Actions"
    echo -e "${GREEN}Created Workload Identity Pool${NC}"
fi

# Create Workload Identity Provider
echo -e "${YELLOW}Creating Workload Identity Provider...${NC}"
if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
    --project="$PROJECT_ID" \
    --location="global" \
    --workload-identity-pool="$POOL_NAME" &>/dev/null; then
    echo "Provider '$PROVIDER_NAME' already exists, skipping creation"
else
    gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
        --project="$PROJECT_ID" \
        --location="global" \
        --workload-identity-pool="$POOL_NAME" \
        --display-name="GitHub Provider" \
        --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
        --issuer-uri="https://token.actions.githubusercontent.com"
    echo -e "${GREEN}Created Workload Identity Provider${NC}"
fi

# Create Service Account
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo -e "${YELLOW}Creating Service Account: $SA_EMAIL${NC}"
if gcloud iam service-accounts describe "$SA_EMAIL" \
    --project="$PROJECT_ID" &>/dev/null; then
    echo "Service account '$SA_EMAIL' already exists, skipping creation"
else
    gcloud iam service-accounts create "$SA_NAME" \
        --project="$PROJECT_ID" \
        --display-name="GitHub Actions Service Account" \
        --description="Service account for GitHub Actions CI/CD"
    echo -e "${GREEN}Created Service Account${NC}"
fi

# Grant Artifact Registry Writer role
echo -e "${YELLOW}Granting Artifact Registry Writer role...${NC}"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/artifactregistry.writer" \
    --condition=None \
    --quiet

# Grant GKE Developer role
echo -e "${YELLOW}Granting GKE Developer role...${NC}"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/container.developer" \
    --condition=None \
    --quiet

# Grant Storage Object Viewer (for pulling images)
echo -e "${YELLOW}Granting Storage Object Viewer role...${NC}"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.objectViewer" \
    --condition=None \
    --quiet

echo -e "${GREEN}Granted IAM roles${NC}"

# Allow GitHub repository to impersonate the service account
echo -e "${YELLOW}Configuring Workload Identity binding for GitHub repository...${NC}"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
    --project="$PROJECT_ID" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}"

echo -e "${GREEN}Configured Workload Identity binding${NC}"

# Output the values needed for GitHub Secrets
echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Add these secrets to your GitHub repository:"
echo "(Settings > Secrets and variables > Actions > New repository secret)"
echo ""
echo -e "${YELLOW}GCP_WORKLOAD_IDENTITY_PROVIDER:${NC}"
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
echo ""
echo -e "${YELLOW}GCP_SERVICE_ACCOUNT:${NC}"
echo "$SA_EMAIL"
echo ""
echo "=========================================="
