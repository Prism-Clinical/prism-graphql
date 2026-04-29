// PM2 Ecosystem Configuration — Prism Healthcare Platform
// Usage: pm2 startOrRestart deploy/ecosystem.config.js --update-env

const GRAPHQL_ROOT = '/home/prism/app/prism-graphql';

// ── Shared environment variables ────────────────────────────
const commonEnv = {
  NODE_ENV: 'production',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'healthcare_federation',
  POSTGRES_USER: 'prism_user',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
};

// epic-api and recommendation-items use DB_* instead of POSTGRES_*
const dbEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'healthcare_federation',
  DB_USER: 'prism_user',
  DB_PASSWORD: process.env.POSTGRES_PASSWORD,
};

const authEnv = {
  JWT_SECRET: process.env.JWT_SECRET,
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  FROM_EMAIL: process.env.FROM_EMAIL || '',
};

// ── Shared PM2 options ──────────────────────────────────────
const commonOpts = {
  watch: false,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '500M',
  max_restarts: 10,
  restart_delay: 5000,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
};

// ── Build the CORS_ORIGINS string from DOMAIN env var ───────
const DOMAIN = process.env.DOMAIN || 'localhost';
const CORS_ORIGINS = `https://admin.${DOMAIN},https://app.${DOMAIN}`;

module.exports = {
  apps: [
    // ════════════════════════════════════════════════════════
    // 1. Gateway (plain JS — no build)
    // ════════════════════════════════════════════════════════
    {
      name: 'gateway',
      script: 'index.js',
      cwd: `${GRAPHQL_ROOT}/gateway`,
      ...commonOpts,
      env: {
        ...commonEnv,
        PORT: 4000,
        CORS_ORIGINS,
        // Federation subgraph URLs (localhost, no Docker hostnames)
        AUTH_URL: 'http://localhost:4012/graphql',
        PATIENTS_URL: 'http://localhost:4002/graphql',
        PROVIDERS_URL: 'http://localhost:4003/graphql',
        INSTITUTIONS_URL: 'http://localhost:4005/graphql',
        CAREPLAN_URL: 'http://localhost:4010/graphql',
        ADMIN_URL: 'http://localhost:4011/graphql',
        SAFETY_URL: 'http://localhost:4009/graphql',
        TRANSCRIPTION_URL: 'http://localhost:4007/graphql',
        RAG_URL: 'http://localhost:4008/graphql',
        EPIC_API_URL: 'http://localhost:4006/graphql',
        PATHWAY_URL: 'http://localhost:4016/graphql',
        // Disable ML-backed subgraphs that need Python services
        CAREPLAN_RECOMMENDER_URL_DISABLED: 'true',
      },
    },

    // ════════════════════════════════════════════════════════
    // 2–12. Federation subgraph services
    // ════════════════════════════════════════════════════════
    {
      name: 'auth',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/auth-service`,
      ...commonOpts,
      env: { ...commonEnv, ...authEnv, PORT: 4012 },
    },
    {
      name: 'admin',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/admin-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4011 },
    },
    {
      name: 'pathway',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/pathway-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4016 },
    },
    {
      name: 'patients',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/patients-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4002 },
    },
    {
      name: 'providers',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/providers-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4003 },
    },
    {
      name: 'institutions',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/institutions-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4005 },
    },
    {
      name: 'careplan',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/careplan-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4010 },
    },
    {
      name: 'safety',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/safety-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4009 },
    },
    {
      name: 'transcription',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/transcription-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4007 },
    },
    {
      name: 'rag',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/rag-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4008 },
    },
    {
      name: 'epic-api',
      script: 'dist/server.js',
      cwd: `${GRAPHQL_ROOT}/apps/epic-api-service`,
      ...commonOpts,
      env: {
        ...commonEnv,
        ...dbEnv,
        PORT: 4006,
        EPIC_AUTH_ENABLED: process.env.EPIC_AUTH_ENABLED || 'false',
        EPIC_BASE_URL: process.env.EPIC_BASE_URL || '',
      },
    },

    // ════════════════════════════════════════════════════════
    // 13–16. Standalone services (not in federation graph)
    // ════════════════════════════════════════════════════════
    {
      name: 'recommendations',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/recommendations-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4001 },
    },
    {
      name: 'recommendation-items',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/recommendation-items-service`,
      ...commonOpts,
      env: { ...commonEnv, ...dbEnv, PORT: 4004 },
    },
    {
      name: 'careplan-recommender',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/careplan-recommender-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4013 },
    },
    {
      name: 'decision-explorer',
      script: 'dist/index.js',
      cwd: `${GRAPHQL_ROOT}/apps/decision-explorer-service`,
      ...commonOpts,
      env: { ...commonEnv, PORT: 4015 },
    },

    // ════════════════════════════════════════════════════════
    // 17–18. Frontend dashboards (Next.js)
    // ════════════════════════════════════════════════════════
    {
      name: 'admin-dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      cwd: `${GRAPHQL_ROOT}/apps/admin-dashboard`,
      ...commonOpts,
      max_memory_restart: '700M',
      env: {
        ...commonEnv,
        PORT: 3001,
        NEXT_PUBLIC_GRAPHQL_URL: `https://api.${DOMAIN}/graphql`,
      },
    },
    {
      name: 'provider-dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: `${GRAPHQL_ROOT}/apps/web-dashboard`,
      ...commonOpts,
      max_memory_restart: '700M',
      env: {
        ...commonEnv,
        PORT: 3000,
        NEXT_PUBLIC_GRAPHQL_URL: `https://api.${DOMAIN}/graphql`,
      },
    },
  ],
};
