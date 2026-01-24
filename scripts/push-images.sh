#!/bin/bash
# Push all Docker images to a registry
# Usage: REGISTRY=ghcr.io/your-org/prism ./scripts/push-images.sh

set -e

REGISTRY=${REGISTRY:-"ghcr.io/your-org/prism"}
TAG=${TAG:-"latest"}

echo "Pushing images to $REGISTRY"

# Build all images first
docker compose build

# List of services to push
SERVICES=(
  "gateway"
  "auth-service"
  "admin-service"
  "patients-service"
  "providers-service"
  "institutions-service"
  "careplan-service"
  "recommendations-service"
  "recommendation-items-service"
  "rag-service"
  "safety-service"
  "transcription-service"
  "admin-dashboard"
  "web-dashboard"
  "epic-api-service"
  "epic-mock-service"
  "decision-explorer-service"
  "careplan-recommender-service"
)

for SERVICE in "${SERVICES[@]}"; do
  LOCAL_IMAGE="prism-graphql-${SERVICE}:latest"
  REMOTE_IMAGE="${REGISTRY}/${SERVICE}:${TAG}"

  echo "Tagging $LOCAL_IMAGE -> $REMOTE_IMAGE"
  docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE" 2>/dev/null || {
    # Try alternate naming convention
    docker tag "prism-graphql_${SERVICE}:latest" "$REMOTE_IMAGE" 2>/dev/null || {
      echo "Warning: Could not find image for $SERVICE, skipping"
      continue
    }
  }

  echo "Pushing $REMOTE_IMAGE"
  docker push "$REMOTE_IMAGE"
done

echo ""
echo "Done! Images pushed to $REGISTRY"
echo ""
echo "Others can now run with:"
echo "  REGISTRY=$REGISTRY docker compose -f docker-compose.registry.yml up -d"
