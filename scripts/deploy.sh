#!/bin/bash
# Deploy Prism Healthcare Platform to a VM
# Usage: ./scripts/deploy.sh [staging|production]

set -e

ENVIRONMENT=${1:-staging}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Deploying Prism Healthcare Platform${NC}"
echo "Environment: $ENVIRONMENT"
echo ""

# Load environment-specific config
if [ -f "$PROJECT_DIR/.env.$ENVIRONMENT" ]; then
    source "$PROJECT_DIR/.env.$ENVIRONMENT"
elif [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
else
    echo -e "${RED}Error: No .env file found${NC}"
    echo "Please create .env or .env.$ENVIRONMENT from .env.example"
    exit 1
fi

# Validate required variables
if [ -z "$DEPLOY_HOST" ]; then
    echo -e "${RED}Error: DEPLOY_HOST is required${NC}"
    exit 1
fi

DEPLOY_USER=${DEPLOY_USER:-ubuntu}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/prism}
SSH_KEY=${SSH_KEY:-~/.ssh/id_rsa}

echo "Host: $DEPLOY_USER@$DEPLOY_HOST"
echo "Path: $DEPLOY_PATH"
echo ""

# Build images locally
echo -e "${YELLOW}Building Docker images...${NC}"
docker compose -f docker-compose.yml build

# Tag and save images for transfer (optional - for slow connections)
# For faster deploys, we'll build on the server instead

# Deploy to server
echo -e "${YELLOW}Deploying to server...${NC}"
ssh -i "$SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" bash << ENDSSH
set -e

# Create deployment directory
sudo mkdir -p $DEPLOY_PATH
sudo chown $DEPLOY_USER:$DEPLOY_USER $DEPLOY_PATH
cd $DEPLOY_PATH

# Pull latest code (if using git) or sync files
if [ -d ".git" ]; then
    git pull origin main
fi

# Ensure Docker is running
sudo systemctl start docker || true

# Build and deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Clean up old images
docker image prune -f

# Show status
docker compose ps

echo "Deployment complete!"
ENDSSH

echo -e "${GREEN}Deployment finished!${NC}"
echo "Access the application at: https://$DOMAIN"
