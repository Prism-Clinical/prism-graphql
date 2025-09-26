#!/bin/bash

# Healthcare Federation Kubernetes Deployment Script

set -e

echo "🏥 Deploying Healthcare Federation to Kubernetes..."

# Create namespace first
echo "📁 Creating namespace..."
kubectl apply -f k8s/namespace.yaml

# Apply ConfigMaps
echo "⚙️ Applying ConfigMaps..."
kubectl apply -f k8s/configmaps/

# Apply Services (create networking before deployments)
echo "🌐 Applying Services..."
kubectl apply -f k8s/services/

# Apply Deployments
echo "🚀 Applying Deployments..."
kubectl apply -f k8s/deployments/

# Wait for deployments to be ready
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/recommendations-service -n healthcare-federation
kubectl wait --for=condition=available --timeout=300s deployment/patients-service -n healthcare-federation
kubectl wait --for=condition=available --timeout=300s deployment/providers-service -n healthcare-federation
kubectl wait --for=condition=available --timeout=300s deployment/recommendation-items-service -n healthcare-federation
kubectl wait --for=condition=available --timeout=300s deployment/institutions-service -n healthcare-federation
kubectl wait --for=condition=available --timeout=300s deployment/healthcare-gateway -n healthcare-federation

echo "✅ Healthcare Federation deployed successfully!"
echo ""
echo "📊 Deployment Status:"
kubectl get pods -n healthcare-federation
echo ""
echo "🌐 Services:"
kubectl get services -n healthcare-federation
echo ""
echo "🚀 Gateway Service:"
kubectl get service healthcare-gateway -n healthcare-federation
echo ""
echo "💡 To access the gateway locally, run:"
echo "   kubectl port-forward -n healthcare-federation service/healthcare-gateway 4000:4000"
echo "   Then open: http://localhost:4000"