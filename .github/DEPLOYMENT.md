# VM Deployment Guide

Simple Docker Compose deployment to a single VM with automatic HTTPS.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Single VM                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                        Caddy                              │   │
│  │              (Reverse Proxy + Auto HTTPS)                 │   │
│  │                    :80, :443                              │   │
│  └────────────────────────┬──────────────────────────────────┘   │
│                           │                                      │
│  ┌────────────────────────┼──────────────────────────────────┐   │
│  │        Docker Compose Network (healthcare-network)        │   │
│  │                        │                                  │   │
│  │  ┌─────────────────────▼──────────────────────────────┐  │   │
│  │  │              Gateway (Apollo Federation)            │  │   │
│  │  │                    :4000                            │  │   │
│  │  └─────────────────────┬──────────────────────────────┘  │   │
│  │                        │                                  │   │
│  │  ┌─────────────────────┼──────────────────────────────┐  │   │
│  │  │           GraphQL Microservices                     │  │   │
│  │  │  patients, providers, careplan, auth, admin, etc.  │  │   │
│  │  └─────────────────────┬──────────────────────────────┘  │   │
│  │                        │                                  │   │
│  │  ┌──────────────┐  ┌───┴───────┐  ┌──────────────────┐  │   │
│  │  │   PostgreSQL │  │   Redis   │  │   ML Services    │  │   │
│  │  │   (pgvector) │  │           │  │ (Python FastAPI) │  │   │
│  │  └──────────────┘  └───────────┘  └──────────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Provision a VM

Any cloud provider works. Recommended specs:
- **Minimum**: 4 vCPU, 8GB RAM, 50GB SSD (e.g., GCP e2-standard-4 ~$100/mo)
- **Recommended**: 8 vCPU, 16GB RAM, 100GB SSD (e.g., GCP e2-standard-8 ~$200/mo)
- **OS**: Ubuntu 22.04 LTS

### 2. Initial VM Setup

SSH into your VM and run:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt-get update && sudo apt-get install -y docker-compose-plugin git

# Create app directory
sudo mkdir -p /opt/prism
sudo chown $USER:$USER /opt/prism

# Clone repository
cd /opt/prism
git clone https://github.com/your-org/prism-graphql.git .

# Log out and back in for Docker permissions
exit
```

### 3. Configure Environment

```bash
cd /opt/prism
cp .env.example .env
nano .env  # Edit with your values
```

Required environment variables:
```bash
DOMAIN=prism.yourdomain.com
DB_PASSWORD=your-secure-database-password
REDIS_PASSWORD=your-secure-redis-password
JWT_SECRET=your-jwt-secret-generate-with-openssl-rand-base64-32
```

### 4. Deploy

```bash
cd /opt/prism
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 5. Point DNS

Point your domain to the VM's public IP. Caddy will automatically obtain SSL certificates.

## GitHub Actions Deployment

### Required Secrets

Add these secrets in GitHub repository settings (Settings > Secrets and variables > Actions):

| Secret | Description | Example |
|--------|-------------|---------|
| `SSH_PRIVATE_KEY` | SSH private key for deployment | Contents of `~/.ssh/id_rsa` |
| `DEPLOY_HOST` | VM hostname or IP | `prism.yourdomain.com` |
| `DEPLOY_USER` | SSH username | `ubuntu` |

### Setup SSH Key

1. Generate a deploy key:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/prism_deploy -N ""
   ```

2. Add public key to VM:
   ```bash
   ssh-copy-id -i ~/.ssh/prism_deploy.pub ubuntu@your-vm-ip
   ```

3. Add private key to GitHub secrets as `SSH_PRIVATE_KEY`

### Deployment Triggers

- **Automatic**: Push to `main` branch deploys to staging
- **Manual**: Use Actions tab > "CD - Deploy to VM" > Run workflow

## Manual Deployment

```bash
# SSH to VM
ssh ubuntu@your-vm-ip

# Navigate to app
cd /opt/prism

# Pull latest code
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# View logs
docker compose logs -f gateway

# Check status
docker compose ps
```

## Useful Commands

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f gateway
docker compose logs -f auth-service

# Restart a service
docker compose restart gateway

# Stop everything
docker compose down

# Stop and remove volumes (WARNING: deletes data)
docker compose down -v

# Check resource usage
docker stats

# Enter a container
docker compose exec gateway sh
docker compose exec postgres psql -U postgres
```

## Backup Database

```bash
# Backup
docker compose exec postgres pg_dump -U postgres healthcare_federation > backup.sql

# Restore
cat backup.sql | docker compose exec -T postgres psql -U postgres healthcare_federation
```

## Troubleshooting

### Services won't start
```bash
# Check logs
docker compose logs

# Ensure .env is configured
cat .env

# Check disk space
df -h
```

### SSL certificate issues
```bash
# Check Caddy logs
docker compose logs caddy

# Ensure DNS is pointing to VM
dig +short your-domain.com
```

### Database connection issues
```bash
# Check postgres is running
docker compose ps postgres

# Check postgres logs
docker compose logs postgres

# Test connection
docker compose exec postgres psql -U postgres -c "SELECT 1"
```

### Out of memory
```bash
# Check memory usage
free -h
docker stats

# Reduce service replicas or upgrade VM
```

## Cost Estimates

| Provider | Instance | Monthly Cost |
|----------|----------|--------------|
| GCP | e2-standard-4 (4 vCPU, 16GB) | ~$100 |
| AWS | t3.xlarge (4 vCPU, 16GB) | ~$120 |
| DigitalOcean | s-4vcpu-8gb | ~$48 |
| Hetzner | CPX31 (4 vCPU, 8GB) | ~$15 |

Note: Prices vary by region and commitment terms.
