# Multi-stage build for transcription service
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY codegen.ts ./
COPY tsconfig.json ./
COPY schema.graphql ./

# Install dependencies (skip scripts to avoid build errors)
RUN npm install --ignore-scripts

# Copy source code
COPY src/ ./src/

# Generate types and build
RUN npm run codegen
RUN npx tsc

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S graphql -u 1001

# Copy built application
COPY --from=builder --chown=graphql:nodejs /app/dist ./dist
COPY --from=builder --chown=graphql:nodejs /app/node_modules ./node_modules
COPY --chown=graphql:nodejs schema.graphql ./

USER graphql

EXPOSE 4007

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null --post-data='{"query":"{__typename}"}' --header='Content-Type: application/json' http://localhost:4007/ || exit 1

CMD ["node", "dist/index.js"]
