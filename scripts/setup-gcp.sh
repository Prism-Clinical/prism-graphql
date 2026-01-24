#!/bin/bash
set -euo pipefail

# =============================================================================
# Prism GCP Infrastructure Setup Script
# =============================================================================
# This script sets up the required GCP infrastructure for the Prism application
# Run this script once to provision all necessary resources
# =============================================================================

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-athena-prod-484720}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-c}"

# Resource names
CLUSTER_NAME="prism-cluster"
DB_INSTANCE_NAME="prism-db"
REDIS_INSTANCE_NAME="prism-redis"
ARTIFACT_REGISTRY_NAME="prism"
SA_NAME="prism-workload"
ML_SA_NAME="prism-ml-workload"

echo "=============================================="
echo "Prism GCP Infrastructure Setup"
echo "=============================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed"
    exit 1
fi

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable \
    container.googleapis.com \
    artifactregistry.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com \
    cloudresourcemanager.googleapis.com \
    compute.googleapis.com \
    servicenetworking.googleapis.com

# =============================================================================
# 1. Create Artifact Registry
# =============================================================================
echo ""
echo "Creating Artifact Registry..."
if ! gcloud artifacts repositories describe "$ARTIFACT_REGISTRY_NAME" --location="$REGION" &> /dev/null; then
    gcloud artifacts repositories create "$ARTIFACT_REGISTRY_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Prism container images"
    echo "Artifact Registry created: $ARTIFACT_REGISTRY_NAME"
else
    echo "Artifact Registry already exists: $ARTIFACT_REGISTRY_NAME"
fi

# =============================================================================
# 2. Create GKE Autopilot Cluster
# =============================================================================
echo ""
echo "Creating GKE Autopilot cluster..."
if ! gcloud container clusters describe "$CLUSTER_NAME" --region="$REGION" &> /dev/null; then
    gcloud container clusters create-auto "$CLUSTER_NAME" \
        --region="$REGION" \
        --release-channel=regular \
        --network=default \
        --subnetwork=default
    echo "GKE cluster created: $CLUSTER_NAME"
else
    echo "GKE cluster already exists: $CLUSTER_NAME"
fi

# Get cluster credentials
gcloud container clusters get-credentials "$CLUSTER_NAME" --region="$REGION"

# =============================================================================
# 3. Create VPC Peering for Private Services
# =============================================================================
echo ""
echo "Setting up private services connection..."
if ! gcloud compute addresses describe google-managed-services-default --global &> /dev/null; then
    gcloud compute addresses create google-managed-services-default \
        --global \
        --purpose=VPC_PEERING \
        --prefix-length=16 \
        --network=default
fi

gcloud services vpc-peerings connect \
    --service=servicenetworking.googleapis.com \
    --ranges=google-managed-services-default \
    --network=default || true

# =============================================================================
# 4. Create Cloud SQL Instance
# =============================================================================
echo ""
echo "Creating Cloud SQL PostgreSQL instance..."
if ! gcloud sql instances describe "$DB_INSTANCE_NAME" &> /dev/null; then
    gcloud sql instances create "$DB_INSTANCE_NAME" \
        --database-version=POSTGRES_15 \
        --tier=db-custom-2-8192 \
        --region="$REGION" \
        --network="projects/$PROJECT_ID/global/networks/default" \
        --no-assign-ip \
        --storage-type=SSD \
        --storage-size=50GB \
        --storage-auto-increase \
        --availability-type=regional \
        --backup-start-time=03:00 \
        --enable-point-in-time-recovery \
        --database-flags=cloudsql.enable_pgvector=on
    echo "Cloud SQL instance created: $DB_INSTANCE_NAME"
else
    echo "Cloud SQL instance already exists: $DB_INSTANCE_NAME"
fi

# Create database
echo "Creating database..."
gcloud sql databases create prism --instance="$DB_INSTANCE_NAME" || true

# Create user
echo "Creating database user..."
DB_PASSWORD=$(openssl rand -base64 32)
gcloud sql users create prism --instance="$DB_INSTANCE_NAME" --password="$DB_PASSWORD" || true

echo "Database password has been generated. Store it securely!"
echo "You can set it in Secret Manager with:"
echo "  gcloud secrets create db-password --data-file=- <<< '$DB_PASSWORD'"

# =============================================================================
# 5. Create Memorystore Redis Instance
# =============================================================================
echo ""
echo "Creating Memorystore Redis instance..."
if ! gcloud redis instances describe "$REDIS_INSTANCE_NAME" --region="$REGION" &> /dev/null; then
    gcloud redis instances create "$REDIS_INSTANCE_NAME" \
        --size=2 \
        --region="$REGION" \
        --redis-version=redis_7_0 \
        --tier=standard \
        --connect-mode=private-service-access \
        --network=default
    echo "Redis instance created: $REDIS_INSTANCE_NAME"
else
    echo "Redis instance already exists: $REDIS_INSTANCE_NAME"
fi

# Get Redis host
REDIS_HOST=$(gcloud redis instances describe "$REDIS_INSTANCE_NAME" --region="$REGION" --format="value(host)")
echo "Redis host: $REDIS_HOST"

# =============================================================================
# 6. Create Service Accounts for Workload Identity
# =============================================================================
echo ""
echo "Creating service accounts..."

# Main workload service account
if ! gcloud iam service-accounts describe "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" &> /dev/null; then
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="Prism Workload Identity"
fi

# ML workload service account
if ! gcloud iam service-accounts describe "$ML_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" &> /dev/null; then
    gcloud iam service-accounts create "$ML_SA_NAME" \
        --display-name="Prism ML Workload Identity"
fi

# Grant roles to service accounts
echo "Granting IAM roles..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.objectViewer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$ML_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$ML_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$ML_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# =============================================================================
# 7. Setup Workload Identity Bindings
# =============================================================================
echo ""
echo "Setting up Workload Identity bindings..."

# Allow Kubernetes service accounts to impersonate GCP service accounts
gcloud iam service-accounts add-iam-policy-binding "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:$PROJECT_ID.svc.id.goog[prism/user-service]"

gcloud iam service-accounts add-iam-policy-binding "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:$PROJECT_ID.svc.id.goog[prism/auth-service]"

gcloud iam service-accounts add-iam-policy-binding "$ML_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:$PROJECT_ID.svc.id.goog[prism/careplan-recommender]"

# =============================================================================
# 8. Create Secrets in Secret Manager
# =============================================================================
echo ""
echo "Creating secrets in Secret Manager..."

# Create secrets (you'll need to update these values)
echo "Creating placeholder secrets..."
echo -n "change-me" | gcloud secrets create jwt-secret --data-file=- || true
echo -n "$DB_PASSWORD" | gcloud secrets create db-password --data-file=- || true
echo -n "$REDIS_HOST:6379" | gcloud secrets create redis-url --data-file=- || true

echo "Remember to update secrets with actual values!"

# =============================================================================
# 9. Setup GitHub Actions Workload Identity Federation
# =============================================================================
echo ""
echo "Setting up GitHub Actions Workload Identity Federation..."

GITHUB_ORG="${GITHUB_ORG:-your-github-org}"
GITHUB_REPO="${GITHUB_REPO:-prism-graphql}"

# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-actions \
    --location=global \
    --display-name="GitHub Actions" \
    --description="Workload Identity Pool for GitHub Actions" || true

# Create Workload Identity Provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
    --location=global \
    --workload-identity-pool=github-actions \
    --display-name="GitHub OIDC Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$GITHUB_ORG/$GITHUB_REPO'" || true

# Create service account for GitHub Actions
if ! gcloud iam service-accounts describe github-actions@$PROJECT_ID.iam.gserviceaccount.com &> /dev/null; then
    gcloud iam service-accounts create github-actions \
        --display-name="GitHub Actions"
fi

# Grant required roles
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/container.developer"

# Allow GitHub Actions to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding github-actions@$PROJECT_ID.iam.gserviceaccount.com \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-actions/attribute.repository/$GITHUB_ORG/$GITHUB_REPO"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
echo "Setup Complete!"
echo "=============================================="
echo ""
echo "Resources created:"
echo "  - Artifact Registry: $ARTIFACT_REGISTRY_NAME"
echo "  - GKE Cluster: $CLUSTER_NAME"
echo "  - Cloud SQL: $DB_INSTANCE_NAME"
echo "  - Memorystore Redis: $REDIS_INSTANCE_NAME"
echo "  - Service Accounts: $SA_NAME, $ML_SA_NAME"
echo ""
echo "Next steps:"
echo "1. Update secrets in Secret Manager with actual values"
echo "2. Add GitHub repository secrets:"
echo "   - GCP_PROJECT_ID: $PROJECT_ID"
echo "   - GCP_WORKLOAD_IDENTITY_PROVIDER: projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-actions/providers/github-provider"
echo "   - GCP_SERVICE_ACCOUNT: github-actions@$PROJECT_ID.iam.gserviceaccount.com"
echo "3. Update k8s overlays with actual PROJECT_ID"
echo "4. Deploy using: kubectl apply -k k8s/overlays/staging"
echo ""
