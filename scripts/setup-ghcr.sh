#!/bin/bash
# Setup GitHub Container Registry authentication for pulling ML service images
#
# Prerequisites:
#   1. Create a GitHub Personal Access Token (classic) at:
#      https://github.com/settings/tokens
#   2. Required scope: read:packages
#   3. Copy the token - you'll need it below
#
# Usage:
#   ./scripts/setup-ghcr.sh
#
# Or with environment variables:
#   GHCR_USERNAME=myuser GHCR_TOKEN=ghp_xxx ./scripts/setup-ghcr.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "GitHub Container Registry Setup"
echo "========================================"
echo ""

# Check if .env file exists and source it
if [ -f .env ]; then
    echo -e "${GREEN}Found .env file, loading variables...${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# Get username
if [ -z "$GHCR_USERNAME" ]; then
    read -p "Enter your GitHub username: " GHCR_USERNAME
fi

# Get token
if [ -z "$GHCR_TOKEN" ]; then
    echo ""
    echo -e "${YELLOW}You need a GitHub Personal Access Token with 'read:packages' scope.${NC}"
    echo "Create one at: https://github.com/settings/tokens"
    echo ""
    read -sp "Enter your GitHub token (input hidden): " GHCR_TOKEN
    echo ""
fi

# Validate inputs
if [ -z "$GHCR_USERNAME" ] || [ -z "$GHCR_TOKEN" ]; then
    echo -e "${RED}Error: Username and token are required${NC}"
    exit 1
fi

# Login to GHCR
echo ""
echo "Logging in to GitHub Container Registry..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}Successfully authenticated to ghcr.io${NC}"
    echo ""
    echo "You can now pull ML service images. Make sure your .env file has:"
    echo ""
    echo "  ML_REGISTRY=ghcr.io/<your-org>/prism-ml-infra"
    echo "  ML_IMAGE_TAG=latest"
    echo ""
    echo "Then run:"
    echo "  docker compose pull"
    echo "  docker compose up -d"
else
    echo ""
    echo -e "${RED}Authentication failed. Please check your credentials.${NC}"
    echo ""
    echo "Common issues:"
    echo "  - Token doesn't have 'read:packages' scope"
    echo "  - Token has expired"
    echo "  - Username is incorrect"
    exit 1
fi
