# Epic Mock Service Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory and user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S epic-mock -u 1001

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=epic-mock:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=epic-mock:nodejs /app/dist ./dist
COPY --from=builder --chown=epic-mock:nodejs /app/package*.json ./

# Switch to non-root user
USER epic-mock

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]