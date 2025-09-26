# Healthcare GraphQL Federation

A comprehensive GraphQL federation system for healthcare data management, built with Apollo Federation 2.10 and Docker.

## Overview

This repository contains a federated GraphQL architecture composed of 6 microservices that handle different aspects of healthcare data:

- **Gateway** (Port 4000) - Apollo Federation gateway that orchestrates all subgraph services
- **Patients Service** (Port 4002) - Patient demographics and medical records
- **Providers Service** (Port 4003) - Healthcare provider information and specialties
- **Recommendations Service** (Port 4001) - Medical recommendations and care plans
- **Recommendation Items Service** (Port 4004) - Detailed recommendation items and evidence
- **Institutions Service** (Port 4005) - Healthcare institutions and hospital data

## Architecture

```
┌─────────────────┐
│   Gateway       │ ← GraphQL Federation Gateway
│   (Port 4000)   │
└─────────┬───────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│Patients │ │Provider │ │Recommend│ │Rec Items│ │Institu- │
│Service  │ │Service  │ │Service  │ │Service  │ │tions    │
│(4002)   │ │(4003)   │ │(4001)   │ │(4004)   │ │(4005)   │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
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
- **Schema**: Patient demographics, medical history, contact information
- **Key Types**: `Patient`, `MedicalRecord`, `ContactInfo`
- **Queries**: `patients`, `patient(id)`

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

## Development

### Project Structure
```
├── apps/
│   ├── patients-service/       # Patient data service
│   ├── providers-service/      # Provider data service
│   ├── recommendations-service/ # Recommendations service
│   ├── recommendation-items-service/ # Recommendation items service
│   └── institutions-service/   # Institutions service
├── gateway/                    # Federation gateway
├── docker-compose.yml         # Container orchestration
├── Makefile                   # Build and deployment commands
└── README.md                  # This file
```

### Local Development
Each service can be developed independently. All services use:
- **Runtime**: Node.js 18
- **Framework**: Apollo Server 4
- **Federation**: Apollo Federation 2.10
- **Language**: TypeScript

### Adding New Services
1. Create service directory under `apps/`
2. Add Dockerfile for containerization
3. Update `docker-compose.yml`
4. Add service to gateway's service list
5. Update Makefile commands

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