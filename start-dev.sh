#!/bin/bash

# Healthcare Federation Development Startup Script
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Healthcare GraphQL Federation...${NC}"

# Clean up any existing services
echo -e "${BLUE}Stopping any existing services...${NC}"
lsof -ti:4000,4001,4002,4003,4004,4005 | xargs -r kill -TERM 2>/dev/null || true
sleep 2
lsof -ti:4000,4001,4002,4003,4004,4005 | xargs -r kill -KILL 2>/dev/null || true

# Create directories
mkdir -p logs pids

# Start subgraph services
echo -e "${BLUE}Starting subgraph services...${NC}"
cd apps/recommendations-service && npm run dev > ../../logs/recommendations.log 2>&1 & echo $! > ../../pids/recommendations.pid &
cd apps/patients-service && npm run dev > ../../logs/patients.log 2>&1 & echo $! > ../../pids/patients.pid &
cd apps/providers-service && npm run dev > ../../logs/providers.log 2>&1 & echo $! > ../../pids/providers.pid &
cd apps/recommendation-items-service && npm run dev > ../../logs/items.log 2>&1 & echo $! > ../../pids/items.pid &
cd apps/institutions-service && npm run dev > ../../logs/institutions.log 2>&1 & echo $! > ../../pids/institutions.pid &

# Wait for services to start
echo -e "${YELLOW}Waiting for services to start...${NC}"
for port in 4001 4002 4003 4004 4005; do
    timeout=60
    while [ $timeout -gt 0 ]; do
        if lsof -ti:$port >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Service on port $port is ready${NC}"
            break
        fi
        sleep 1
        timeout=$((timeout-1))
    done
    if [ $timeout -eq 0 ]; then
        echo -e "${RED}✗ Service on port $port failed to start${NC}"
        exit 1
    fi
done

# Start gateway
echo -e "${BLUE}Starting gateway...${NC}"
cd gateway && npm run dev > ../logs/gateway.log 2>&1 & echo $! > ../pids/gateway.pid &
sleep 10

# Check gateway
if lsof -ti:4000 >/dev/null 2>&1; then
    echo -e "${GREEN}✅ All services started!${NC}"
    echo -e "${CYAN}🌐 Gateway ready at http://localhost:4000${NC}"
    echo -e "${YELLOW}Services running:${NC}"
    echo -e "  • Gateway:         ${CYAN}http://localhost:4000${NC}"
    echo -e "  • Recommendations: ${CYAN}http://localhost:4001${NC}"
    echo -e "  • Patients:        ${CYAN}http://localhost:4002${NC}"
    echo -e "  • Providers:       ${CYAN}http://localhost:4003${NC}"
    echo -e "  • Items:           ${CYAN}http://localhost:4004${NC}"
    echo -e "  • Institutions:    ${CYAN}http://localhost:4005${NC}"
    echo -e "${YELLOW}📋 Run 'make logs' to view service logs${NC}"
    echo -e "${YELLOW}🛑 Run 'make stop' to stop all services${NC}"
else
    echo -e "${RED}✗ Gateway failed to start${NC}"
    exit 1
fi