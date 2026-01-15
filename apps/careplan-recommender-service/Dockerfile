FROM node:20-slim

WORKDIR /app

# Copy all files first
COPY . .

# Install all dependencies (including dev for build)
# The postinstall script will run build automatically
RUN npm install --ignore-scripts

# Build manually after install
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --production

EXPOSE 4013

CMD ["node", "dist/index.js"]
