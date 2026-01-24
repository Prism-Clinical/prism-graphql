#!/bin/bash
set -euo pipefail

# =============================================================================
# Build and Push All Docker Images to Artifact Registry
# =============================================================================

REGISTRY="us-central1-docker.pkg.dev/athena-prod-484720/prism"
TAG="${1:-latest}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=============================================="
echo "Building and Pushing Docker Images"
echo "Registry: $REGISTRY"
echo "Tag: $TAG"
echo "=============================================="

# Services with Dockerfiles in apps/
SERVICES=(
  "admin-dashboard"
  "admin-service"
  "auth-service"
  "careplan-recommender-service:careplan-recommender"
  "careplan-service:care-plan-service"
  "institutions-service:organization-service"
  "patients-service:patient-service"
  "providers-service:provider-service"
  "rag-service:rag-embeddings"
  "recommendations-service"
  "safety-service:safety-rules-service"
  "transcription-service:audio-intelligence"
  "web-dashboard"
)

build_and_push() {
  local dir_name=$1
  local image_name=$2
  local dockerfile_path="$ROOT_DIR/apps/$dir_name/Dockerfile"

  if [ ! -f "$dockerfile_path" ]; then
    echo "WARNING: No Dockerfile found at $dockerfile_path, skipping..."
    return 0
  fi

  echo ""
  echo "----------------------------------------------"
  echo "Building: $image_name from $dir_name"
  echo "----------------------------------------------"

  docker build --platform linux/amd64 -t "$REGISTRY/$image_name:$TAG" "$ROOT_DIR/apps/$dir_name"

  echo "Pushing: $image_name:$TAG"
  docker push "$REGISTRY/$image_name:$TAG"

  echo "Done: $image_name"
}

# Build and push each service
for service in "${SERVICES[@]}"; do
  # Parse service:image mapping (service:image or just service)
  dir_name="${service%%:*}"
  image_name="${service##*:}"

  build_and_push "$dir_name" "$image_name" || echo "FAILED: $dir_name"
done

# Build gateway/apollo-router
if [ -f "$ROOT_DIR/gateway/Dockerfile" ]; then
  echo ""
  echo "----------------------------------------------"
  echo "Building: apollo-router from gateway"
  echo "----------------------------------------------"
  docker build --platform linux/amd64 -t "$REGISTRY/apollo-router:$TAG" "$ROOT_DIR/gateway"
  docker push "$REGISTRY/apollo-router:$TAG"
fi

echo ""
echo "=============================================="
echo "All images built and pushed!"
echo "=============================================="
