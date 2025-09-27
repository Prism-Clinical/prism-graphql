# Contributing to Healthcare GraphQL Federation

Thank you for your interest in contributing to our healthcare GraphQL federation project! This guide will help you get started with contributing to the codebase.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)

## Code of Conduct

This project follows a professional code of conduct. Please be respectful, inclusive, and collaborative in all interactions.

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Docker & Docker Compose** - For containerized development
- **Node.js 18+** - For local development (optional)
- **Git** - For version control
- **Make** - For build commands (optional)
- **Text Editor/IDE** - VS Code recommended with GraphQL extensions

### Initial Setup

1. **Clone the Repository**
   ```bash
   # Clone on GitHub
   git clone https://github.com/YOUR_USERNAME/prism-codebase.git
   cd prism-codebase/prism-graphql
   ```

2. **Start the Development Environment**
   ```bash
   make quick-start
   ```

3. **Verify Everything Works**
   ```bash
   make status
   make health
   ```

## Development Setup

### Architecture Overview

The project consists of 6 services:
- **Gateway** - Federation orchestrator
- **Patients Service** - Patient data management
- **Providers Service** - Healthcare provider information  
- **Recommendations Service** - Medical recommendations
- **Recommendation Items Service** - Detailed recommendation data
- **Institutions Service** - Healthcare institution data

### Working with Services

Each service is independently containerized but works together through Apollo Federation.

#### Service Structure
```
apps/[service-name]/
├── src/
│   ├── index.ts          # Service entry point
│   ├── resolvers/        # GraphQL resolvers
│   ├── datasources/      # Data layer
│   └── __generated__/    # Generated TypeScript types
├── schema.graphql        # GraphQL schema definition
├── codegen.ts           # Code generation config
├── Dockerfile           # Container definition
└── package.json         # Dependencies
```

## Making Changes

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Types of Changes

**Schema Changes**
- Modify `schema.graphql` in the relevant service
- Run code generation: `cd apps/[service] && npm run codegen`
- Update resolvers accordingly
- Test federation compatibility

**Resolver Changes**
- Modify files in `src/resolvers/`
- Ensure type safety with generated types
- Add appropriate error handling

**Data Source Changes**
- Modify files in `src/datasources/`
- Maintain data consistency across services
- Consider federation relationships

**Infrastructure Changes**
- Update `docker-compose.yml` for new services
- Modify `Makefile` for new commands
- Update documentation

### 3. Development Workflow

```bash
# Start services
make compose-up

# Make your changes to source code

# Rebuild affected services
docker compose build [service-name]

# Restart services to test changes
make compose-restart

# Check logs
make compose-logs

# Test your changes
curl -s "http://localhost:4000/graphql" \
  -H "Content-Type: application/json" \
  -H "apollo-require-preflight: true" \
  -d '{"query": "your test query here"}'
```

## Testing

### Manual Testing

1. **Service Health Check**
   ```bash
   make health
   ```

2. **Test Individual Services**
   ```bash
   # Test patients service directly
   curl -s "http://localhost:4002/graphql" \
     -H "Content-Type: application/json" \
     -d '{"query": "query { patients { id } }"}'
   ```

3. **Test Federation**
   ```bash
   # Test cross-service queries through gateway
   curl -s "http://localhost:4000/graphql" \
     -H "Content-Type: application/json" \
     -H "apollo-require-preflight: true" \
     -d '{"query": "query { patients { id } providers { id } }"}'
   ```

### Schema Validation

Ensure your schema changes are compatible:
```bash
# In each modified service directory
cd apps/[service-name]
npm run codegen
npm run build
```

## Submitting Changes

### 1. Pre-submission Checklist

- [ ] All services build successfully
- [ ] Federation gateway starts without errors
- [ ] Manual testing passes
- [ ] Code follows project style guidelines
- [ ] Documentation updated if needed
- [ ] No sensitive data or credentials committed

### 2. Create Pull Request

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create PR on GitHub**
   - Use a descriptive title
   - Reference any related issues
   - Include testing steps
   - Add screenshots if UI changes

3. **PR Description Template**
   ```markdown
   ## What
   Brief description of changes

   ## Why
   Reason for the change

   ## How to Test
   1. Step 1
   2. Step 2
   3. Expected result

   ## Screenshots (if applicable)

   ## Checklist
   - [ ] Services build successfully
   - [ ] Manual testing completed
   - [ ] Documentation updated
   ```

## Code Style

### TypeScript Guidelines

- Use TypeScript for all new code
- Leverage generated types from GraphQL schemas
- Use proper error handling with GraphQLError
- Follow naming conventions: camelCase for variables, PascalCase for types

### GraphQL Schema Guidelines

```graphql
# Use descriptive names
type Patient {
  id: ID!
  firstName: String!
  lastName: String!
  # Use federation directives appropriately
  visits: [Visit!]! @external
}

# Document complex fields
"""
Medical recommendations for a specific case
"""
type Recommendation {
  id: ID!
  title: String!
  description: String!
}
```

### Docker Guidelines

- Use multi-stage builds for efficiency
- Include health checks in Dockerfiles
- Use consistent base images (node:18-alpine)
- Optimize layer caching

## Project Structure

### Adding a New Service

1. **Create Service Directory**
   ```bash
   mkdir apps/new-service
   cd apps/new-service
   ```

2. **Copy Template Files**
   ```bash
   # Copy from existing service and modify
   cp -r ../patients-service/* .
   ```

3. **Update Configuration**
   - Modify `package.json`
   - Update `schema.graphql`
   - Implement resolvers
   - Create Dockerfile

4. **Add to Docker Compose**
   ```yaml
   new-service:
     build: ./apps/new-service
     ports:
       - "4006:4006"
     networks:
       - healthcare-federation
   ```

5. **Update Gateway**
   Add service to gateway's service list in `gateway/index.js`

6. **Update Makefile**
   Add new service to relevant commands

## Common Tasks

### Adding a New Query

1. **Update Schema**
   ```graphql
   type Query {
     newQuery(input: NewInput!): NewType
   }
   ```

2. **Generate Types**
   ```bash
   npm run codegen
   ```

3. **Implement Resolver**
   ```typescript
   export const Query: Resolvers = {
     Query: {
       newQuery: (parent, { input }, context) => {
         // Implementation
       }
     }
   };
   ```

### Adding Federation Relationships

1. **Define Entity Key**
   ```graphql
   type Patient @key(fields: "id") {
     id: ID!
     # other fields
   }
   ```

2. **Implement Reference Resolver**
   ```typescript
   export const Patient: Resolvers = {
     Patient: {
       __resolveReference: (patient: Pick<Patient, "id">) => {
         return findPatientById(patient.id);
       }
     }
   };
   ```

### Debugging Issues

1. **Check Service Logs**
   ```bash
   make logs-gateway      # Gateway only
   make logs-services     # All services
   make compose-logs      # All containers
   ```

2. **Inspect Container Status**
   ```bash
   make status
   docker compose ps
   ```

3. **Test Individual Services**
   ```bash
   # Test specific service health
   curl http://localhost:4002/.well-known/apollo/server-health
   ```

## Questions and Support

- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Update relevant docs with your changes

## Recognition

Contributors will be recognized in the project documentation. Thank you for helping improve healthcare GraphQL federation!