# Multi-stage build for Care Plan service
FROM node:18-alpine AS builder

WORKDIR /app

# Copy root tsconfig for path alias resolution
COPY tsconfig.json ./tsconfig.base.json

# Copy shared modules
COPY shared/ciss-types ./shared/ciss-types
COPY shared/security ./shared/security
COPY shared/service-clients ./shared/service-clients

# Build shared modules
WORKDIR /app/shared/ciss-types
RUN npm install && npm run build

WORKDIR /app/shared/security
RUN npm install && npm run build && npm link

WORKDIR /app/shared/service-clients
RUN npm link @prism/security && npm install && npm run build && npm link

# Now build the service
WORKDIR /app/service

# Copy service package files
COPY apps/careplan-service/package*.json ./
COPY apps/careplan-service/codegen.ts ./
COPY apps/careplan-service/schema.graphql ./

# Replace workspace:* references with file references for Docker build
RUN sed -i 's/"@prism\/security": "workspace:\*"/"@prism\/security": "file:..\/shared\/security"/g' package.json && \
    sed -i 's/"@prism\/service-clients": "workspace:\*"/"@prism\/service-clients": "file:..\/shared\/service-clients"/g' package.json

# Create tsconfig that extends base and includes shared paths
RUN echo '{\
  "extends": "../tsconfig.base.json",\
  "compilerOptions": {\
    "target": "esnext",\
    "module": "commonjs",\
    "esModuleInterop": true,\
    "sourceMap": true,\
    "declaration": true,\
    "declarationMap": true,\
    "removeComments": true,\
    "skipLibCheck": true,\
    "noImplicitAny": true,\
    "noImplicitReturns": true,\
    "noFallthroughCasesInSwitch": true,\
    "forceConsistentCasingInFileNames": true,\
    "lib": ["esnext", "esnext.asynciterable", "DOM"],\
    "types": ["node", "jest"],\
    "rootDir": "./src",\
    "outDir": "./dist",\
    "baseUrl": "..",\
    "paths": {\
      "@careplan/*": ["service/src/*"],\
      "@shared/*": ["shared/*"]\
    }\
  },\
  "include": ["src/**/*"],\
  "exclude": ["codegen.ts", "dist", "node_modules", "src/__tests__"]\
}' > tsconfig.json

# Install dependencies (skip scripts to avoid build errors)
RUN npm install --ignore-scripts

# Copy source code
COPY apps/careplan-service/src/ ./src/

# Generate types and build
RUN npm run codegen
RUN npx tsc

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S graphql -u 1001

# Copy built application
COPY --from=builder --chown=graphql:nodejs /app/service/dist ./dist
COPY --from=builder --chown=graphql:nodejs /app/service/node_modules ./node_modules
COPY --from=builder --chown=graphql:nodejs /app/shared ./shared
COPY --chown=graphql:nodejs apps/careplan-service/schema.graphql ./

USER graphql

EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4010/.well-known/apollo/server-health || exit 1

CMD ["node", "dist/index.js"]
