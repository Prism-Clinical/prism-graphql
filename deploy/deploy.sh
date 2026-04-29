#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Prism Healthcare Platform — Build & Restart (repeatable)
# Run as the deploy user (prism) from any directory.
#
# Usage: bash /home/prism/app/prism-graphql/deploy/deploy.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/home/prism/app"
GRAPHQL_DIR="${APP_DIR}/prism-graphql"
ENV_FILE="${APP_DIR}/.env.production"

echo "══════════════════════════════════════════════════════════"
echo "  Prism Deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════════════"

# ── 1. Source environment ────────────────────────────────────
if [ -f "${ENV_FILE}" ]; then
  set -a
  source "${ENV_FILE}"
  set +a
  echo "▸ Loaded ${ENV_FILE}"
else
  echo "ERROR: ${ENV_FILE} not found" >&2
  exit 1
fi

# ── 2. Pull latest code ─────────────────────────────────────
echo "▸ Pulling latest code..."
cd "${GRAPHQL_DIR}"
git pull --ff-only || echo "  (git pull skipped — not a git repo or no remote)"

# ── 3. Fix workspace:* → file: in careplan-service ──────────
echo "▸ Fixing workspace protocol references..."
CAREPLAN_PKG="${GRAPHQL_DIR}/apps/careplan-service/package.json"
if grep -q '"workspace:\*"' "${CAREPLAN_PKG}" 2>/dev/null; then
  sed -i 's|"@prism/security": "workspace:\*"|"@prism/security": "file:../../shared/security"|g' "${CAREPLAN_PKG}"
  sed -i 's|"@prism/service-clients": "workspace:\*"|"@prism/service-clients": "file:../../shared/service-clients"|g' "${CAREPLAN_PKG}"
  echo "  Fixed careplan-service workspace:* → file: references"
fi

# ── 4. Install root dependencies ────────────────────────────
echo "▸ Installing root dependencies..."
cd "${GRAPHQL_DIR}"
npm install --omit=dev 2>&1 | tail -1

# ── 5. Build shared packages first ──────────────────────────
echo "▸ Building shared packages..."
for pkg in shared/security shared/service-clients; do
  echo "  Building ${pkg}..."
  cd "${GRAPHQL_DIR}/${pkg}"
  npm install --omit=dev 2>/dev/null || true
  npx tsc
done

# ── 6. Build TypeScript services ─────────────────────────────
echo "▸ Building services..."
SERVICES=(
  auth-service
  admin-service
  pathway-service
  patients-service
  providers-service
  institutions-service
  careplan-service
  safety-service
  transcription-service
  rag-service
  recommendations-service
  recommendation-items-service
  careplan-recommender-service
  decision-explorer-service
)

for svc in "${SERVICES[@]}"; do
  echo "  Building ${svc}..."
  cd "${GRAPHQL_DIR}/apps/${svc}"
  npm install 2>/dev/null || true
  # Run codegen first (skip for epic-api which has no codegen)
  npx graphql-codegen 2>/dev/null || true
  npx tsc
done

# epic-api-service — tsc only, no codegen
echo "  Building epic-api-service..."
cd "${GRAPHQL_DIR}/apps/epic-api-service"
npm install 2>/dev/null || true
npx tsc

# Gateway — plain JS, skip build
echo "  Gateway — no build needed (plain JS)"
cd "${GRAPHQL_DIR}/gateway"
npm install --omit=dev 2>/dev/null || true

# ── 7. Build frontends ──────────────────────────────────────
echo "▸ Building frontends..."

echo "  Building admin-dashboard..."
cd "${GRAPHQL_DIR}/apps/admin-dashboard"
npm install 2>/dev/null || true
NEXT_PUBLIC_GRAPHQL_URL="https://api.${DOMAIN}/graphql" npm run build

echo "  Building web-dashboard (provider dashboard)..."
cd "${GRAPHQL_DIR}/apps/web-dashboard"
npm install 2>/dev/null || true
NEXT_PUBLIC_GRAPHQL_URL="https://api.${DOMAIN}/graphql" npm run build

# ── 8. Run migrations ───────────────────────────────────────
echo "▸ Running database migrations..."
bash "${GRAPHQL_DIR}/deploy/run-migrations-vm.sh"

# ── 9. Start/restart PM2 ────────────────────────────────────
echo "▸ Starting PM2 processes..."
cd "${GRAPHQL_DIR}"
pm2 startOrRestart deploy/ecosystem.config.js --update-env
pm2 save

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Deploy complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Run 'pm2 status' to verify all processes are online."
echo "══════════════════════════════════════════════════════════"
