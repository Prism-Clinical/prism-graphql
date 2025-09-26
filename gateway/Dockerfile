# Multi-stage build for healthcare gateway
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S gateway -u 1001

# Copy application
COPY --from=builder --chown=gateway:nodejs /app/node_modules ./node_modules
COPY --chown=gateway:nodejs index.js ./

USER gateway

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/.well-known/apollo/server-health || exit 1

CMD ["node", "index.js"]