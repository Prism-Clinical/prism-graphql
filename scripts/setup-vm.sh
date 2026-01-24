#!/bin/bash
# Initial VM setup for Prism Healthcare Platform
# Run this once on a fresh Ubuntu 22.04+ VM
# Usage: curl -sSL https://raw.githubusercontent.com/your-org/prism-graphql/main/scripts/setup-vm.sh | bash

set -e

echo "Setting up Prism Healthcare Platform VM..."

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt-get install -y docker-compose-plugin

# Install useful tools
sudo apt-get install -y git curl htop

# Create app directory
sudo mkdir -p /opt/prism
sudo chown $USER:$USER /opt/prism

# Clone repository (adjust URL as needed)
cd /opt/prism
if [ ! -d ".git" ]; then
    echo "Please clone your repository:"
    echo "  git clone https://github.com/your-org/prism-graphql.git ."
fi

# Create .env file template
if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
# Prism Healthcare Platform - Production Environment

# Domain name (required for HTTPS)
DOMAIN=your-domain.com

# Database password (required)
DB_PASSWORD=CHANGE_ME_TO_SECURE_PASSWORD

# Redis password (required)
REDIS_PASSWORD=CHANGE_ME_TO_SECURE_PASSWORD

# JWT Secret for authentication (required)
JWT_SECRET=CHANGE_ME_TO_SECURE_SECRET

# Deployment config
DEPLOY_HOST=localhost
DEPLOY_USER=ubuntu
DEPLOY_PATH=/opt/prism
EOF
    echo "Created .env template - please edit with your values!"
fi

# Configure firewall
echo "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Enable Docker to start on boot
sudo systemctl enable docker

echo ""
echo "=========================================="
echo "VM Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Clone your repository to /opt/prism"
echo "2. Edit /opt/prism/.env with your configuration"
echo "3. Run: cd /opt/prism && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo ""
echo "Note: Log out and back in for Docker permissions to take effect"
