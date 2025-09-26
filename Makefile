# Healthcare GraphQL Federation Makefile
# Docker and Kubernetes deployment management

.PHONY: help compose-up compose-down compose-logs compose-build compose-restart
.PHONY: docker-build docker-clean k8s-deploy k8s-delete k8s-status

# Default target
.DEFAULT_GOAL := help

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
CYAN := \033[0;36m
NC := \033[0m # No Color

# Help target
help: ## Show available commands
	@echo "$(CYAN)Healthcare GraphQL Federation - Docker/K8s Commands$(NC)"
	@echo ""
	@echo "$(YELLOW)Docker Compose:$(NC)"
	@awk '/^[a-zA-Z_-]+:.*?## .*Docker.*/ { printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2 }' $(MAKEFILE_LIST) | sed 's/:.*##//'
	@echo ""
	@echo "$(YELLOW)Kubernetes:$(NC)"
	@awk '/^[a-zA-Z_-]+:.*?## .*K8s.*/ { printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2 }' $(MAKEFILE_LIST) | sed 's/:.*##//'
	@echo ""
	@echo "$(YELLOW)Utilities:$(NC)"
	@awk '/^[a-zA-Z_-]+:.*?## .*Util.*/ { printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2 }' $(MAKEFILE_LIST) | sed 's/:.*##//'

# Docker Compose Commands
compose-up: ## Docker - Start all services with Docker Compose
	@echo "$(BLUE)Starting healthcare federation with Docker Compose...$(NC)"
	@docker compose up -d --build
	@echo "$(GREEN)✅ Services started! Gateway available at http://localhost:4000$(NC)"

compose-down: ## Docker - Stop and remove all containers
	@echo "$(BLUE)Stopping Docker Compose services...$(NC)"
	@docker compose down
	@echo "$(GREEN)✓ All containers stopped and removed$(NC)"

compose-logs: ## Docker - Show logs from all services
	@docker compose logs -f --tail=100

compose-build: ## Docker - Build all Docker images
	@echo "$(BLUE)Building all Docker images...$(NC)"
	@docker compose build
	@echo "$(GREEN)✓ All images built successfully$(NC)"

compose-restart: ## Docker - Restart all services
	@echo "$(BLUE)Restarting all services...$(NC)"
	@docker compose restart
	@echo "$(GREEN)✓ All services restarted$(NC)"

# Individual Docker Commands  
docker-build: ## Docker - Build images without compose
	@echo "$(BLUE)Building individual Docker images...$(NC)"
	@docker build -t healthcare-gateway ./gateway
	@docker build -t healthcare-recommendations ./apps/recommendations-service
	@docker build -t healthcare-patients ./apps/patients-service
	@docker build -t healthcare-providers ./apps/providers-service
	@docker build -t healthcare-recommendation-items ./apps/recommendation-items-service
	@docker build -t healthcare-institutions ./apps/institutions-service
	@echo "$(GREEN)✓ All Docker images built$(NC)"

docker-clean: ## Docker - Clean up Docker resources
	@echo "$(BLUE)Cleaning up Docker resources...$(NC)"
	@docker compose down --volumes --remove-orphans
	@docker system prune -f
	@echo "$(GREEN)✓ Docker cleanup completed$(NC)"

# Kubernetes Commands
k8s-deploy: ## K8s - Deploy to Kubernetes (requires k8s manifests)
	@echo "$(BLUE)Deploying to Kubernetes...$(NC)"
	@if [ -d "k8s" ]; then \
		kubectl apply -f k8s/; \
		echo "$(GREEN)✓ Deployed to Kubernetes$(NC)"; \
	else \
		echo "$(RED)❌ No k8s directory found. Create Kubernetes manifests first.$(NC)"; \
	fi

k8s-delete: ## K8s - Delete from Kubernetes
	@echo "$(BLUE)Deleting from Kubernetes...$(NC)"
	@if [ -d "k8s" ]; then \
		kubectl delete -f k8s/; \
		echo "$(GREEN)✓ Deleted from Kubernetes$(NC)"; \
	else \
		echo "$(RED)❌ No k8s directory found.$(NC)"; \
	fi

k8s-status: ## K8s - Show Kubernetes deployment status
	@echo "$(BLUE)Kubernetes Status:$(NC)"
	@kubectl get pods,services,deployments -l app=healthcare-federation 2>/dev/null || \
		echo "$(YELLOW)No healthcare federation resources found in current namespace$(NC)"

# Utility Commands
status: ## Util - Show Docker container status
	@echo "$(BLUE)Docker Container Status:$(NC)"
	@docker compose ps

logs-gateway: ## Util - Show gateway logs only
	@docker compose logs -f gateway

logs-services: ## Util - Show all service logs (no gateway)
	@docker compose logs -f recommendations-service patients-service providers-service recommendation-items-service institutions-service

health: ## Util - Check service health
	@echo "$(BLUE)Checking service health...$(NC)"
	@echo "$(YELLOW)Gateway (4000):$(NC)"
	@curl -s http://localhost:4000/graphql -H "Content-Type: application/json" -d '{"query":"query{__typename}"}' >/dev/null && echo "$(GREEN)✓ Healthy$(NC)" || echo "$(RED)❌ Unhealthy$(NC)"

quick-start: compose-up ## Util - Quick start all services
	@echo "$(CYAN)🚀 Healthcare Federation is ready!$(NC)"
	@echo "$(YELLOW)Gateway: http://localhost:4000$(NC)"
	@echo "$(YELLOW)Run 'make logs' to view logs$(NC)"
	@echo "$(YELLOW)Run 'make compose-down' to stop$(NC)"