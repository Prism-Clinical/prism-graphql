# Healthcare GraphQL Federation

A comprehensive GraphQL federation system for healthcare data management, built with Apollo Federation 2.10, PostgreSQL, Redis, and Epic FHIR integration.

## Overview

This repository contains a federated GraphQL architecture composed of 8 microservices with full database persistence and Epic EHR integration:

### Core Services
- **Gateway** (Port 4000) - Apollo Federation gateway that orchestrates all subgraph services
- **Patients Service** (Port 4002) - Patient demographics and medical records with PostgreSQL persistence
- **Providers Service** (Port 4003) - Healthcare provider information and specialties
- **Recommendations Service** (Port 4001) - Medical recommendations and care plans
- **Recommendation Items Service** (Port 4004) - Detailed recommendation items and evidence
- **Institutions Service** (Port 4005) - Healthcare institutions and hospital data

### Epic Integration Services
- **Epic API Service** (Port 4006) - FHIR Epic integration for external healthcare data
- **Epic Mock Service** (Port 8080) - Mock Epic FHIR server for testing and development

### Database Infrastructure
- **PostgreSQL** (Port 5432) - Primary database for persistent data storage
- **Redis** (Port 6379) - Caching layer for improved performance

## Architecture

```
                    ┌─────────────────┐
                    │   Gateway       │ ← GraphQL Federation Gateway
                    │   (Port 4000)   │
                    └─────────┬───────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│ Core Services│    │ Epic Integration│    │ Infrastructure│
│             │    │               │    │             │
│ ┌─────────┐ │    │ ┌─────────────┐ │    │ ┌─────────┐ │
│ │Patients │ │    │ │ Epic API    │ │    │ │PostgreSQL│ │
│ │(4002)   │ │    │ │ Service     │ │    │ │(5432)   │ │
│ └─────────┘ │    │ │(4006)       │ │    │ └─────────┘ │
│ ┌─────────┐ │    │ └─────────────┘ │    │ ┌─────────┐ │
│ │Provider │ │    │ ┌─────────────┐ │    │ │  Redis  │ │
│ │(4003)   │ │    │ │ Epic Mock   │ │    │ │(6379)   │ │
│ └─────────┘ │    │ │(8080)       │ │    │ └─────────┘ │
│ ┌─────────┐ │    │ └─────────────┘ │    └─────────────┘
│ │Recommend│ │    └─────────────────┘
│ │(4001)   │ │
│ └─────────┘ │
│ ┌─────────┐ │
│ │Rec Items│ │
│ │(4004)   │ │
│ └─────────┘ │
│ ┌─────────┐ │
│ │Institu- │ │
│ │tions    │ │
│ │(4005)   │ │
│ └─────────┘ │
└─────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Make (optional, for convenience commands)

### Starting the Federation

**Option 1: Using Make (Recommended)**
```bash
make quick-start
```

**Option 2: Using Docker Compose Directly**
```bash
docker compose up -d --build
```

The federation will be available at **http://localhost:4000**

### Verify Installation

Check that all services are running:
```bash
make status
```

Or manually:
```bash
docker compose ps
```

## Making GraphQL Queries

The federation supports queries across all domains. Here are some examples:

### Get All Patients
```bash
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { patients { id firstName lastName email dateOfBirth } }"}'
```

### Get Recommendations for a Case
```bash
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { recommendationsForCase(caseId: \"case-1\") { id title description status } }"}'
```

### Get Healthcare Providers
```bash
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { providers { id name specialty email } }"}'
```

### Epic Patient Data Sync
```bash
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "mutation { syncEpicPatientData(epicPatientId: \"123\") { success sessionId } }"}'
```

### Complex Federation Query
```bash
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "query { institutions { id name type address hospitals { id name beds emergencyServices } } }"}'
```

## Available Commands

### Docker Management
- `make compose-up` - Start all services
- `make compose-down` - Stop all services
- `make compose-logs` - View logs
- `make compose-build` - Build images
- `make compose-restart` - Restart services
- `make docker-clean` - Clean up Docker resources

### Database Management
- `make migrate` - Run pending database migrations
- `make migrate-status` - Show migration status
- `make migrate-clean` - Clean database and re-run all migrations

### Monitoring
- `make status` - Show container status
- `make health` - Check service health
- `make logs-gateway` - Gateway logs only
- `make logs-services` - All service logs

### Kubernetes (Future)
- `make k8s-deploy` - Deploy to Kubernetes
- `make k8s-delete` - Delete from Kubernetes
- `make k8s-status` - K8s deployment status

## Service Details

### Gateway Service
- **Technology**: Apollo Server 4, Apollo Gateway
- **Purpose**: Federation orchestration and query routing
- **Features**: Schema composition, query planning, introspection

### Patients Service
- **Technology**: PostgreSQL, Redis caching
- **Schema**: Patient demographics, medical history, contact information
- **Key Types**: `Patient`, `MedicalRecord`, `ContactInfo`
- **Queries**: `patients`, `patient(id)`
- **Features**: Database persistence, Epic patient ID mapping, Redis caching

### Providers Service
- **Schema**: Healthcare provider profiles, specialties, availability
- **Key Types**: `Provider`, `Specialty`, `Schedule`
- **Queries**: `providers`, `provider(id)`, `providersBySpecialty`

### Recommendations Service
- **Schema**: Medical recommendations, care plans, treatment protocols
- **Key Types**: `Recommendation`, `CareCase`, `TreatmentPlan`
- **Queries**: `recommendationsForCase`, `recommendation(id)`

### Recommendation Items Service
- **Schema**: Detailed recommendation items, evidence levels, studies
- **Key Types**: `RecommendationItem`, `EvidenceLevel`, `StudyReference`
- **Queries**: `recommendationItems`, `recommendationItem(id)`

### Institutions Service
- **Schema**: Healthcare institutions, hospitals, departments
- **Key Types**: `Institution`, `Hospital`, `Department`
- **Queries**: `institutions`, `hospitals`, `institution(id)`

### Epic API Service
- **Technology**: FHIR Client, Redis caching, PostgreSQL
- **Schema**: Epic patient data, sync operations, FHIR resources
- **Key Types**: `EpicPatientData`, `SyncOperation`, `FHIRResource`
- **Features**: Epic FHIR integration, smart caching, patient data sync
- **Mutations**: `syncEpicPatientData`, `refreshPatientCache`

### Epic Mock Service
- **Technology**: Express.js, FHIR mock data
- **Purpose**: Mock Epic FHIR server for testing
- **Features**: Realistic FHIR responses, simulated latency, error scenarios

## Development

### Project Structure
```
├── apps/
│   ├── patients-service/       # Patient data service (PostgreSQL + Redis)
│   ├── providers-service/      # Provider data service
│   ├── recommendations-service/ # Recommendations service
│   ├── recommendation-items-service/ # Recommendation items service
│   ├── institutions-service/   # Institutions service
│   ├── epic-api-service/       # Epic FHIR integration service
│   └── epic-mock-service/      # Mock Epic server for testing
├── shared/
│   └── data-layer/            # Shared database layer
│       ├── src/               # Database connections, queries
│       └── migrations/        # Database migration files
├── gateway/                   # Federation gateway
├── docker-compose.yml        # Container orchestration
├── run-migrations.sh         # Database migration runner
├── Makefile                  # Build and deployment commands
├── MIGRATIONS.md             # Database migration documentation
└── README.md                 # This file
```

### Local Development
Each service can be developed independently. All services use:
- **Runtime**: Node.js 18
- **Framework**: Apollo Server 4
- **Federation**: Apollo Federation 2.10
- **Language**: TypeScript
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Migration System**: SQL-based with tracking

### Database Development
The system uses a shared data layer for database operations:
- **Decoupled Architecture**: Services access data through shared modules
- **Migration System**: Versioned SQL migrations with tracking
- **Redis Caching**: Smart caching with TTL strategies
- **Transaction Support**: Automatic transaction handling

### Adding New Services
1. Create service directory under `apps/`
2. Add Dockerfile for containerization
3. Update `docker-compose.yml`
4. Add service to gateway's service list
5. Update Makefile commands
6. Create database migrations if needed
7. Update shared data layer queries
8. Add Redis caching strategy

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on contributing to this project.

## Troubleshooting

### Services Not Starting
```bash
# Check container status
make status

# View logs for debugging
make compose-logs

# Clean and restart
make docker-clean
make compose-up
```

### Port Conflicts
If ports 4000-4005 are in use:
1. Stop conflicting processes
2. Or modify ports in `docker-compose.yml`

### Federation Issues
- Ensure all subgraph services are healthy before gateway starts
- Check service discovery in Docker network
- Verify schema compatibility between services

## License

[Add your license information here]