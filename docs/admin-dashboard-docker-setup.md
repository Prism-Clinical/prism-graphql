# Admin Dashboard - Docker Setup Guide

How to start the Admin Dashboard and its dependencies using Docker Compose.

## Architecture Overview

The Admin Dashboard runs as part of the prism-graphql Docker Compose stack:

```
Browser (http://localhost:3001)
    │
    ▼
admin-dashboard (Next.js 14, port 3001)
    │  GraphQL over HTTP
    ▼
gateway (Apollo Federation, port 4000)
    │
    ├── admin-service   (port 4011) — user management, audit logs, safety rules
    ├── auth-service    (port 4012) — JWT authentication, email verification
    └── ... other subgraph services
    │
    ▼
PostgreSQL (port 5432) + Redis (port 6379)
```

## Prerequisites

- Docker and Docker Compose installed
- Repository cloned at `workspace/prism-graphql/`

## Quick Start (Full Stack)

Start all services including the admin dashboard:

```bash
cd workspace/prism-graphql
make compose-up
```

This runs `docker compose up -d --build` and starts every service. The admin dashboard will be available at **http://localhost:3001**.

## Minimal Start (Admin Services Only)

To start only the services required for the admin dashboard:

```bash
cd workspace/prism-graphql
docker compose up -d --build postgres redis admin-service auth-service gateway admin-dashboard
```

This starts:

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| PostgreSQL | `healthcare-postgres` | 5432 | Database |
| Redis | `healthcare-redis` | 6379 | Caching / sessions |
| admin-service | `healthcare-admin` | 4011 | Admin GraphQL subgraph |
| auth-service | `healthcare-auth` | 4012 | Authentication |
| gateway | `healthcare-gateway` | 4000 | Apollo Federation gateway |
| admin-dashboard | `healthcare-admin-dashboard` | 3001 | Next.js admin UI |

## Database Setup

After the containers start, run migrations to create the database schema:

```bash
make migrate
```

Optionally seed test data:

```bash
make seed-epic-sql
```

## Verify Services Are Running

Check container status:

```bash
make status
```

Health check individual services:

```bash
# Admin service
curl http://localhost:4011/.well-known/apollo/server-health

# Auth service
curl http://localhost:4012/.well-known/apollo/server-health

# Gateway
curl http://localhost:4000/.well-known/apollo/server-health

# Admin dashboard
curl http://localhost:3001/api/health
```

Test a GraphQL query through the gateway:

```bash
curl http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ adminStats { totalUsers activeUsers totalSafetyRules } }"}'
```

## Viewing Logs

All services:

```bash
make compose-logs
```

Admin services only:

```bash
docker compose logs -f admin-service admin-dashboard auth-service gateway
```

## Stopping Services

```bash
make compose-down
```

## Environment Variables

Key environment variables are set in `docker-compose.yml`. For local overrides, create a `.env` file in the `prism-graphql/` root:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `your-super-secret-jwt-key-change-in-production` | JWT signing secret |
| `SMTP_HOST` | `localhost` | SMTP server for email verification |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | (empty) | SMTP username |
| `SMTP_PASS` | (empty) | SMTP password |
| `FROM_EMAIL` | `noreply@prism-clinical.com` | Sender email address |
| `SKIP_NPI_LOOKUP` | `true` | Skip NPI validation in dev |

## Troubleshooting

**Admin dashboard not loading:**
- Confirm the gateway is healthy first — the dashboard depends on it
- Check logs: `docker compose logs admin-dashboard`

**Auth failures:**
- Auth service must be running and healthy
- In development, `SKIP_NPI_LOOKUP=true` is set by default

**Database connection errors:**
- Ensure PostgreSQL is healthy: `docker compose ps postgres`
- Run migrations: `make migrate`

**Port conflicts:**
- If ports 3001, 4000, 4011, or 4012 are in use, stop conflicting processes or adjust port mappings in `docker-compose.yml`

## Admin Dashboard Features

Once running at http://localhost:3001, the dashboard provides:

- **Dashboard** — Stats overview (care plans, alerts, models, medications)
- **Care Plans** — Care plan management
- **Safety Rules** — Clinical alert rule management with version history
- **Audit Logs** — System audit trail
- **ML Models** — Machine learning model management
- **Training Data** — Training data management
