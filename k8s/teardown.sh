#!/bin/bash

# Healthcare Federation Kubernetes Teardown Script

set -e

echo "🧺 Tearing down Healthcare Federation from Kubernetes..."

# Delete Deployments first
echo "🗑️ Deleting Deployments..."
kubectl delete -f k8s/deployments/ --ignore-not-found=true

# Delete Services
echo "🌐 Deleting Services..."
kubectl delete -f k8s/services/ --ignore-not-found=true

# Delete ConfigMaps
echo "⚙️ Deleting ConfigMaps..."
kubectl delete -f k8s/configmaps/ --ignore-not-found=true

# Delete namespace (this will also clean up any remaining resources)
echo "📁 Deleting namespace..."
kubectl delete -f k8s/namespace.yaml --ignore-not-found=true

echo "✅ Healthcare Federation teardown complete!"
echo "📊 Remaining resources in healthcare-federation namespace:"
kubectl get all -n healthcare-federation 2>/dev/null || echo "   (namespace deleted)"