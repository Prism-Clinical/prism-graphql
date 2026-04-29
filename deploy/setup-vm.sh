#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Prism Healthcare Platform — One-time VM provisioning
# Run as root on a fresh Hetzner CPX41 (Ubuntu 22.04 / 24.04)
#
# Usage:
#   export DOMAIN=example.com PG_PASSWORD=... REDIS_PASSWORD=...
#   bash setup-vm.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ────────────────────────────────────────────
: "${DOMAIN:?'Set DOMAIN env var (e.g. prism-clinical.com)'}"
: "${PG_PASSWORD:?'Set PG_PASSWORD env var'}"
: "${REDIS_PASSWORD:?'Set REDIS_PASSWORD env var'}"
DEPLOY_USER="${DEPLOY_USER:-prism}"
APP_DIR="/home/${DEPLOY_USER}/app"
GRAPHQL_DIR="${APP_DIR}/prism-graphql"

echo "══════════════════════════════════════════════════════════"
echo "  Prism VM Setup — ${DOMAIN}"
echo "══════════════════════════════════════════════════════════"

# ── 1. System packages ──────────────────────────────────────
echo "▸ Updating system packages..."
apt update && apt upgrade -y
apt install -y curl git build-essential ufw fail2ban flex bison \
  software-properties-common gnupg lsb-release

# ── 2. Create deploy user ───────────────────────────────────
echo "▸ Creating user ${DEPLOY_USER}..."
if ! id "${DEPLOY_USER}" &>/dev/null; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
  usermod -aG sudo "${DEPLOY_USER}"
  echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${DEPLOY_USER}"
fi

# ── 3. Node.js 20 LTS ───────────────────────────────────────
echo "▸ Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
echo "  Node $(node -v) / npm $(npm -v)"
npm install -g pm2

# ── 4. PostgreSQL 17 + pgvector ──────────────────────────────
echo "▸ Installing PostgreSQL 17..."
if ! command -v pg_isready &>/dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  apt update
  apt install -y postgresql-17 postgresql-server-dev-17 postgresql-17-pgvector
fi

echo "▸ Configuring PostgreSQL..."
sudo -u postgres psql -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prism_user') THEN
    CREATE ROLE prism_user WITH LOGIN PASSWORD '${PG_PASSWORD}';
  END IF;
END \$\$;"
sudo -u postgres psql -c "SELECT 'CREATE DATABASE healthcare_federation OWNER prism_user'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'healthcare_federation')\gexec"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE healthcare_federation TO prism_user;"
sudo -u postgres psql -d healthcare_federation -c "GRANT ALL ON SCHEMA public TO prism_user;"

# Tune PG for 16 GB RAM
PG_CONF="/etc/postgresql/17/main/postgresql.conf"
sed -i "s/^#\?shared_buffers.*/shared_buffers = '4GB'/" "$PG_CONF"
sed -i "s/^#\?effective_cache_size.*/effective_cache_size = '12GB'/" "$PG_CONF"
sed -i "s/^#\?work_mem.*/work_mem = '64MB'/" "$PG_CONF"
sed -i "s/^#\?max_connections.*/max_connections = 200/" "$PG_CONF"
sed -i "s/^#\?maintenance_work_mem.*/maintenance_work_mem = '512MB'/" "$PG_CONF"

# ── 5. Apache AGE 1.6.0 ─────────────────────────────────────
echo "▸ Building Apache AGE 1.6.0..."
if ! sudo -u postgres psql -d healthcare_federation -c "SELECT extname FROM pg_extension WHERE extname = 'age'" | grep -q age; then
  cd /tmp
  if [ ! -d "age" ]; then
    git clone --branch release/PG17/1.6.0 https://github.com/apache/age.git
  fi
  cd age
  make clean || true
  make -j$(nproc)
  make install

  # Add to shared_preload_libraries
  if ! grep -q "shared_preload_libraries.*age" "$PG_CONF"; then
    if grep -q "^shared_preload_libraries" "$PG_CONF"; then
      sed -i "s/^shared_preload_libraries = '\(.*\)'/shared_preload_libraries = '\1,age'/" "$PG_CONF"
    else
      echo "shared_preload_libraries = 'age'" >> "$PG_CONF"
    fi
  fi

  systemctl restart postgresql

  sudo -u postgres psql -d healthcare_federation -c "CREATE EXTENSION IF NOT EXISTS age CASCADE;"
  sudo -u postgres psql -d healthcare_federation -c "CREATE EXTENSION IF NOT EXISTS vector;"
  sudo -u postgres psql -d healthcare_federation -c "SET search_path = ag_catalog, public; SELECT create_graph('clinical_pathways');" 2>/dev/null || true
fi
cd /root

# ── 6. Redis 7 ───────────────────────────────────────────────
echo "▸ Installing Redis..."
apt install -y redis-server
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASSWORD}/" /etc/redis/redis.conf
sed -i "s/^bind .*/bind 127.0.0.1 ::1/" /etc/redis/redis.conf
systemctl restart redis-server
systemctl enable redis-server

# ── 7. Nginx + Certbot ──────────────────────────────────────
echo "▸ Installing Nginx + Certbot..."
apt install -y nginx certbot python3-certbot-nginx

# Deploy nginx config (replace DOMAIN placeholder)
sed "s/DOMAIN/${DOMAIN}/g" "${GRAPHQL_DIR}/deploy/nginx.conf" \
  > /etc/nginx/sites-available/prism
ln -sf /etc/nginx/sites-available/prism /etc/nginx/sites-enabled/prism
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 8. Firewall (ufw) ───────────────────────────────────────
echo "▸ Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 9. SSH hardening ────────────────────────────────────────
echo "▸ Hardening SSH..."
SSHD_CONF="/etc/ssh/sshd_config"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONF"
systemctl restart sshd

# ── 10. Clone repos ─────────────────────────────────────────
echo "▸ Setting up application directory..."
sudo -u "${DEPLOY_USER}" mkdir -p "${APP_DIR}/logs"
if [ ! -d "${GRAPHQL_DIR}" ]; then
  echo "  NOTICE: Clone your repos into ${APP_DIR}/"
  echo "  Expected: ${GRAPHQL_DIR}"
fi

# ── 11. Copy .env.production template ───────────────────────
if [ ! -f "${APP_DIR}/.env.production" ]; then
  cp "${GRAPHQL_DIR}/deploy/.env.production" "${APP_DIR}/.env.production"
  # Fill in known values
  sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" "${APP_DIR}/.env.production"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${PG_PASSWORD}/" "${APP_DIR}/.env.production"
  sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" "${APP_DIR}/.env.production"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/.env.production"
  chmod 600 "${APP_DIR}/.env.production"
  echo "  .env.production created — edit it to set JWT_SECRET, SMTP, etc."
fi

# ── 12. Initial build ───────────────────────────────────────
echo "▸ Running initial deployment..."
sudo -u "${DEPLOY_USER}" bash "${GRAPHQL_DIR}/deploy/deploy.sh"

# ── 13. PM2 systemd startup ─────────────────────────────────
echo "▸ Configuring PM2 startup..."
pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}"
sudo -u "${DEPLOY_USER}" bash -c "cd ${GRAPHQL_DIR} && pm2 save"

# ── 14. SSL certificates ────────────────────────────────────
echo "▸ Obtaining SSL certificates..."
echo "  Make sure DNS A records point to this server before proceeding."
echo "  Run manually if DNS is not ready yet:"
echo "    certbot --nginx -d api.${DOMAIN} -d admin.${DOMAIN} -d app.${DOMAIN}"
read -rp "  DNS ready? Obtain certs now? [y/N] " ssl_confirm
if [[ "${ssl_confirm}" =~ ^[Yy]$ ]]; then
  certbot --nginx -d "api.${DOMAIN}" -d "admin.${DOMAIN}" -d "app.${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email
fi

# ── 15. Healthcheck cron ────────────────────────────────────
echo "▸ Installing healthcheck cron..."
CRON_LINE="*/5 * * * * ${GRAPHQL_DIR}/deploy/healthcheck.sh >> ${APP_DIR}/logs/healthcheck.log 2>&1"
(sudo -u "${DEPLOY_USER}" crontab -l 2>/dev/null | grep -v healthcheck; echo "${CRON_LINE}") | sudo -u "${DEPLOY_USER}" crontab -

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit ${APP_DIR}/.env.production (JWT_SECRET, SMTP)"
echo "    2. Set DNS: api.${DOMAIN}, admin.${DOMAIN}, app.${DOMAIN} → $(curl -s ifconfig.me)"
echo "    3. Run: certbot --nginx -d api.${DOMAIN} -d admin.${DOMAIN} -d app.${DOMAIN}"
echo "    4. Verify: pm2 status / bash deploy/healthcheck.sh"
echo "══════════════════════════════════════════════════════════"
