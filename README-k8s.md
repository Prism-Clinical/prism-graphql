# Healthcare Federation Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the Healthcare GraphQL Federation.

## Prerequisites

- Kubernetes cluster (local via Docker Desktop, minikube, or cloud)
- kubectl configured to connect to your cluster
- Docker images built and available to your cluster

## Quick Start

### 1. Build Docker Images

```bash
# Build all images
docker-compose build

# Tag images for your registry (if using remote cluster)
docker tag healthcare/recommendations-service:latest your-registry/healthcare/recommendations-service:latest
docker tag healthcare/patients-service:latest your-registry/healthcare/patients-service:latest
docker tag healthcare/providers-service:latest your-registry/healthcare/providers-service:latest
docker tag healthcare/recommendation-items-service:latest your-registry/healthcare/recommendation-items-service:latest
docker tag healthcare/institutions-service:latest your-registry/healthcare/institutions-service:latest
docker tag healthcare/gateway:latest your-registry/healthcare/gateway:latest

# Push to registry (if using remote cluster)
docker push your-registry/healthcare/recommendations-service:latest
# ... repeat for all services
```

### 2. Deploy to Kubernetes

```bash
# Deploy everything
./k8s/deploy.sh

# Or deploy manually step by step:
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmaps/
kubectl apply -f k8s/services/
kubectl apply -f k8s/deployments/
```

### 3. Access the Gateway

```bash
# Port forward to access locally
kubectl port-forward -n healthcare-federation service/healthcare-gateway 4000:4000

# Open in browser
open http://localhost:4000
```

### 4. Monitor Deployment

```bash
# Check pod status
kubectl get pods -n healthcare-federation

# Check services
kubectl get services -n healthcare-federation

# Check logs
kubectl logs -f deployment/healthcare-gateway -n healthcare-federation
kubectl logs -f deployment/recommendations-service -n healthcare-federation
```

## Architecture

### Services

- **healthcare-gateway** (port 4000): Apollo Gateway federating all subgraphs
- **recommendations-service** (port 4001): Case-based recommendations
- **patients-service** (port 4002): Patient and case management
- **providers-service** (port 4003): Provider and visit management
- **recommendation-items-service** (port 4004): Medical recommendation items
- **institutions-service** (port 4005): Hospital and institution management

### Resources

- **Namespace**: `healthcare-federation`
- **Deployments**: Each service has 3 replicas (gateway has 2)
- **Services**: ClusterIP for internal services, LoadBalancer for gateway
- **ConfigMaps**: Environment configuration
- **Resource Limits**: CPU and memory limits for each service
- **Health Checks**: Liveness and readiness probes
- **Security**: Non-root user, security context

## Configuration

### Environment Variables

Configured via ConfigMaps:

- `gateway-config`: Gateway service URLs and environment
- `subgraph-config`: Shared subgraph configuration

### Service Discovery

Services communicate using Kubernetes DNS:

- `recommendations-service:4001`
- `patients-service:4002`
- `providers-service:4003`
- `recommendation-items-service:4004`
- `institutions-service:4005`

## Scaling

```bash
# Scale a specific service
kubectl scale deployment/recommendations-service --replicas=5 -n healthcare-federation

# Scale the gateway
kubectl scale deployment/healthcare-gateway --replicas=3 -n healthcare-federation
```

## Cleanup

```bash
# Tear down everything
./k8s/teardown.sh

# Or manually
kubectl delete namespace healthcare-federation
```

## Troubleshooting

### Common Issues

1. **ImagePullBackOff**: Images not available in cluster
   ```bash
   # For local development with Docker Desktop
   docker-compose build
   ```

2. **Service not ready**: Check health endpoints
   ```bash
   kubectl describe pod <pod-name> -n healthcare-federation
   kubectl logs <pod-name> -n healthcare-federation
   ```

3. **Gateway can't reach subgraphs**: Check service names and ports
   ```bash
   kubectl get services -n healthcare-federation
   kubectl describe service <service-name> -n healthcare-federation
   ```

### Logs

```bash
# All pods
kubectl logs -l component=graphql-subgraph -n healthcare-federation --tail=100

# Specific service
kubectl logs -l app=recommendations-service -n healthcare-federation -f

# Gateway logs
kubectl logs -l app=healthcare-gateway -n healthcare-federation -f
```

## Production Considerations

1. **Ingress**: Add ingress controller for external access
2. **TLS**: Configure TLS certificates
3. **Monitoring**: Add Prometheus/Grafana monitoring
4. **Persistence**: Add persistent volumes if services need storage
5. **Secrets**: Use Kubernetes secrets for sensitive configuration
6. **Network Policies**: Add network security policies
7. **Resource Quotas**: Configure namespace resource quotas
8. **HPA**: Add Horizontal Pod Autoscaler for auto-scaling