# Pathway Graph — Plan 1: Infrastructure & Service Scaffold

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the database infrastructure (custom PG image with AGE 1.5.0, all migrations) and pathway-service boilerplate so Plans 2-4 can build on working scaffolding.

**Architecture:** Custom PostgreSQL image layers Apache AGE 1.5.0 on top of the existing pgvector:pg15 base. Four migrations handle AGE install, legacy table rename, new relational tables, and confidence signal seeding. A new `pathway-service` (port 4016) joins the federation as a minimal subgraph with a health-check query and stub schema.

**Tech Stack:** PostgreSQL 15, Apache AGE 1.5.0, pgvector, Docker, TypeScript 5, Apollo Server 4, Apollo Federation 2.10, Jest

**Spec:** `docs/superpowers/specs/2026-03-14-clinical-pathway-graph-architecture-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `docker/postgres-age/Dockerfile` | Custom PG image: pgvector + AGE 1.5.0 |
| `shared/data-layer/migrations/036_install_age_extension.sql` | Install AGE extension, create graph namespace |
| `shared/data-layer/migrations/037_rename_legacy_pathway_tables.sql` | Rename migration-017 tables to `_legacy`, drop helper functions |
| `shared/data-layer/migrations/038_create_pathway_graph_tables.sql` | New relational side tables + confidence framework tables |
| `shared/data-layer/migrations/039_seed_confidence_signals.sql` | Seed 4 built-in signals + system default thresholds |
| `apps/pathway-service/package.json` | Service dependencies |
| `apps/pathway-service/tsconfig.json` | TypeScript config matching codebase pattern |
| `apps/pathway-service/codegen.ts` | GraphQL codegen config |
| `apps/pathway-service/schema.graphql` | Minimal federation schema (stub) |
| `apps/pathway-service/Dockerfile` | Multi-stage Docker build |
| `apps/pathway-service/src/index.ts` | Apollo Server bootstrap |
| `apps/pathway-service/src/resolvers/index.ts` | Resolver barrel export |
| `apps/pathway-service/src/resolvers/Query.ts` | Query resolvers (health check + stub) |
| `apps/pathway-service/src/services/database.ts` | Pool init with AGE search_path |
| `apps/pathway-service/src/services/age-client.ts` | AGE Cypher query wrapper (thin abstraction) |
| `apps/pathway-service/src/types/index.ts` | TypeScript interfaces + context type |
| `apps/pathway-service/src/__tests__/age-client.test.ts` | Unit tests for AGE client query builder |
| `apps/pathway-service/src/__tests__/database.test.ts` | Unit tests for database initialization |

### Modified files

| File | Change |
|------|--------|
| `docker-compose.yml` | Replace `image: pgvector/pgvector:pg15` with build context; add pathway-service container; add PATHWAY_URL to gateway env; add pathway-service to gateway depends_on |
| `gateway/index.js` | Add pathway service to services array |

---

## Chunk 1: Custom PostgreSQL Image + AGE Extension Migration

### Task 1: Custom PostgreSQL Docker Image

**Files:**
- Create: `docker/postgres-age/Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
FROM pgvector/pgvector:pg15

# Install build dependencies for AGE compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    postgresql-server-dev-15 \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clone and compile Apache AGE 1.5.0 (pinned release — not main branch)
RUN git clone --branch PG15/v1.5.0-rc0 --depth 1 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make \
    && make install \
    && rm -rf /tmp/age

# Clean up build dependencies to reduce image size
RUN apt-get purge -y build-essential postgresql-server-dev-15 git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Pre-load AGE for all connections so LOAD 'age' is not needed per-session
RUN echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample
```

- [ ] **Step 2: Build the image locally to verify compilation succeeds**

Run: `docker build -t prism-postgres-age:local -f docker/postgres-age/Dockerfile docker/postgres-age/`

Expected: Image builds successfully. AGE compiles without errors. Final line shows image ID.

- [ ] **Step 3: Smoke-test AGE availability in the built image**

Run:
```bash
docker run --rm -d --name age-smoke-test \
  -e POSTGRES_DB=test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  prism-postgres-age:local

# Wait for PG to be ready
sleep 5
docker exec age-smoke-test pg_isready -U test

# Test AGE extension loads
docker exec age-smoke-test psql -U test -d test -c "CREATE EXTENSION IF NOT EXISTS age;"
docker exec age-smoke-test psql -U test -d test -c "LOAD 'age'; SET search_path = ag_catalog, public; SELECT create_graph('test_graph');"
docker exec age-smoke-test psql -U test -d test -c "LOAD 'age'; SET search_path = ag_catalog, public; SELECT * FROM cypher('test_graph', \$\$ CREATE (n:TestNode {name: 'hello'}) RETURN n \$\$) AS (v agtype);"

docker stop age-smoke-test
```

Expected: Extension creates successfully. Graph creates. Cypher CREATE/RETURN works.

- [ ] **Step 4: Commit**

```bash
git add docker/postgres-age/Dockerfile
git commit -m "feat: add custom PostgreSQL image with AGE 1.5.0 + pgvector

Layers Apache AGE 1.5.0 (PG15/v1.5.0-rc0) on top of pgvector:pg15
base image. Build deps are purged after compilation to keep image lean."
```

### Task 2: docker-compose.yml — Switch to Custom PG Image

**Files:**
- Modify: `docker-compose.yml:3-18` (postgres service block)

- [ ] **Step 1: Replace the postgres image line with a build context**

In `docker-compose.yml`, change the postgres service from:

```yaml
  postgres:
    image: pgvector/pgvector:pg15
    container_name: healthcare-postgres
```

to:

```yaml
  postgres:
    build:
      context: ./docker/postgres-age
      dockerfile: Dockerfile
    container_name: healthcare-postgres
```

Keep all other postgres service config (ports, environment, volumes, healthcheck, etc.) unchanged.

- [ ] **Step 2: Verify the compose file is valid**

Run: `docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml config --quiet`

Expected: Exits 0 (no errors).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: switch postgres service to custom AGE image build"
```

### Task 3: Migration 036 — Install AGE Extension

**Files:**
- Create: `shared/data-layer/migrations/036_install_age_extension.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 036: Install Apache AGE extension and create clinical_pathways graph namespace
-- Prerequisite: PostgreSQL must be running the custom prism-postgres-age image with AGE 1.5.0

-- Load the AGE shared library for this migration session.
-- In production, shared_preload_libraries='age' in postgresql.conf handles this automatically.
-- But the migration runner may connect before the custom config takes effect, so LOAD explicitly.
LOAD 'age';

-- Install the extension
CREATE EXTENSION IF NOT EXISTS age;

-- Set search path so AGE functions are accessible
SET search_path = ag_catalog, "$user", public;

-- Create the graph namespace for clinical pathway data
SELECT create_graph('clinical_pathways');

-- Verify: create and immediately drop a test node to confirm Cypher works
SELECT * FROM cypher('clinical_pathways', $$
  CREATE (n:_migration_test {verified: true})
  RETURN n
$$) AS (v agtype);

SELECT * FROM cypher('clinical_pathways', $$
  MATCH (n:_migration_test)
  DELETE n
$$) AS (v agtype);
```

- [ ] **Step 2: Commit**

```bash
git add shared/data-layer/migrations/036_install_age_extension.sql
git commit -m "feat: add migration 036 — install AGE extension and create graph namespace"
```

### Task 4: Migration 037 — Rename Legacy Pathway Tables

**Files:**
- Create: `shared/data-layer/migrations/037_rename_legacy_pathway_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 037: Rename legacy pathway tables from migration 017
-- These tables are empty in all environments (pre-launch). No data migration needed.
-- Renamed rather than dropped to preserve schema for reference.

-- Drop triggers first (they reference the old table names)
DROP TRIGGER IF EXISTS clinical_pathways_updated_at ON clinical_pathways;
DROP TRIGGER IF EXISTS pathway_nodes_updated_at ON pathway_nodes;
DROP TRIGGER IF EXISTS patient_pathway_instances_updated_at ON patient_pathway_instances;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_clinical_pathway_timestamp();
DROP FUNCTION IF EXISTS update_pathway_node_timestamp();
DROP FUNCTION IF EXISTS update_patient_pathway_instance_timestamp();

-- Drop helper functions
DROP FUNCTION IF EXISTS get_pathway_tree(UUID);
DROP FUNCTION IF EXISTS get_pathway_usage_stats(UUID);
DROP FUNCTION IF EXISTS get_node_selection_stats(UUID);

-- Rename tables to _legacy suffix
ALTER TABLE clinical_pathways RENAME TO clinical_pathways_legacy;
ALTER TABLE pathway_nodes RENAME TO pathway_nodes_legacy;
ALTER TABLE pathway_node_outcomes RENAME TO pathway_node_outcomes_legacy;
ALTER TABLE patient_pathway_instances RENAME TO patient_pathway_instances_legacy;
ALTER TABLE patient_pathway_selections RENAME TO patient_pathway_selections_legacy;

-- Rename indexes to match new table names (prevents name collisions)
ALTER INDEX IF EXISTS idx_clinical_pathways_slug RENAME TO idx_clinical_pathways_legacy_slug;
ALTER INDEX IF EXISTS idx_clinical_pathways_conditions RENAME TO idx_clinical_pathways_legacy_conditions;
ALTER INDEX IF EXISTS idx_clinical_pathways_active RENAME TO idx_clinical_pathways_legacy_active;
ALTER INDEX IF EXISTS idx_clinical_pathways_published RENAME TO idx_clinical_pathways_legacy_published;
ALTER INDEX IF EXISTS idx_clinical_pathways_embedding RENAME TO idx_clinical_pathways_legacy_embedding;
ALTER INDEX IF EXISTS idx_pathway_nodes_pathway RENAME TO idx_pathway_nodes_legacy_pathway;
ALTER INDEX IF EXISTS idx_pathway_nodes_parent RENAME TO idx_pathway_nodes_legacy_parent;
ALTER INDEX IF EXISTS idx_pathway_nodes_type RENAME TO idx_pathway_nodes_legacy_type;
ALTER INDEX IF EXISTS idx_pathway_nodes_pathway_active RENAME TO idx_pathway_nodes_legacy_pathway_active;
ALTER INDEX IF EXISTS idx_pathway_nodes_embedding RENAME TO idx_pathway_nodes_legacy_embedding;
ALTER INDEX IF EXISTS idx_pathway_node_outcomes_node RENAME TO idx_pathway_node_outcomes_legacy_node;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_patient RENAME TO idx_patient_pathway_instances_legacy_patient;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_provider RENAME TO idx_patient_pathway_instances_legacy_provider;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_pathway RENAME TO idx_patient_pathway_instances_legacy_pathway;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_status RENAME TO idx_patient_pathway_instances_legacy_status;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_started RENAME TO idx_patient_pathway_instances_legacy_started;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_instance RENAME TO idx_patient_pathway_selections_legacy_instance;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_node RENAME TO idx_patient_pathway_selections_legacy_node;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_type RENAME TO idx_patient_pathway_selections_legacy_type;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_care_plan RENAME TO idx_patient_pathway_selections_legacy_care_plan;

COMMENT ON TABLE clinical_pathways_legacy IS 'LEGACY (migration 017) — replaced by AGE graph + pathway_graph_index in migration 038';
```

- [ ] **Step 2: Commit**

```bash
git add shared/data-layer/migrations/037_rename_legacy_pathway_tables.sql
git commit -m "feat: add migration 037 — rename legacy pathway tables from migration 017"
```

---

## Chunk 2: New Relational Tables + Confidence Framework Migration

### Task 5: Migration 038 — Create Pathway Graph Tables

**Files:**
- Create: `shared/data-layer/migrations/038_create_pathway_graph_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 038: Create pathway graph relational side tables and confidence framework
-- These tables complement the AGE graph (migration 036) with search indexes,
-- resolution tracking, and the confidence configuration framework.

-- =============================================================================
-- 1. PATHWAY_GRAPH_INDEX — Relational index for pathway search and metadata
-- =============================================================================

CREATE TABLE pathway_graph_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    age_node_id VARCHAR(100),
    logical_id VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    version VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    condition_codes TEXT[] NOT NULL DEFAULT '{}',
    scope TEXT,
    target_population TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_graph_index_status_check CHECK (
        status IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'SUPERSEDED')
    ),
    CONSTRAINT pathway_graph_index_category_check CHECK (
        category IN ('CHRONIC_DISEASE', 'ACUTE_CARE', 'PREVENTIVE_CARE', 'POST_PROCEDURE',
                     'MEDICATION_MANAGEMENT', 'LIFESTYLE_MODIFICATION', 'MENTAL_HEALTH',
                     'PEDIATRIC', 'GERIATRIC', 'OBSTETRIC')
    ),
    CONSTRAINT pathway_graph_index_logical_version_unique UNIQUE (logical_id, version)
);

CREATE INDEX idx_pathway_graph_index_logical_id ON pathway_graph_index(logical_id);
CREATE INDEX idx_pathway_graph_index_status ON pathway_graph_index(status);
CREATE INDEX idx_pathway_graph_index_condition_codes ON pathway_graph_index USING GIN(condition_codes);
CREATE INDEX idx_pathway_graph_index_active ON pathway_graph_index(is_active) WHERE is_active = true;
CREATE INDEX idx_pathway_graph_index_category ON pathway_graph_index(category);

-- =============================================================================
-- 2. PATHWAY_CONDITION_CODES — Flat code-to-pathway mapping for Layer 1 matching
-- =============================================================================

CREATE TABLE pathway_condition_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    system VARCHAR(10) NOT NULL,
    description TEXT,
    usage TEXT,
    grouping VARCHAR(50),

    CONSTRAINT pathway_condition_codes_system_check CHECK (
        system IN ('ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT')
    )
);

CREATE INDEX idx_pathway_condition_codes_code ON pathway_condition_codes(code);
CREATE INDEX idx_pathway_condition_codes_pathway ON pathway_condition_codes(pathway_id);
CREATE INDEX idx_pathway_condition_codes_system ON pathway_condition_codes(system);

-- =============================================================================
-- 3. PATHWAY_VERSION_DIFFS — Import diff audit trail
-- =============================================================================

CREATE TABLE pathway_version_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    previous_pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE SET NULL,
    import_type VARCHAR(20) NOT NULL,
    diff_summary JSONB NOT NULL DEFAULT '{}',
    diff_details JSONB NOT NULL DEFAULT '[]',
    imported_by UUID,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_version_diffs_import_type_check CHECK (
        import_type IN ('NEW_PATHWAY', 'DRAFT_UPDATE', 'NEW_VERSION')
    )
);

CREATE INDEX idx_pathway_version_diffs_pathway ON pathway_version_diffs(pathway_id);

-- =============================================================================
-- 4. PATHWAY_RESOLUTION_SESSIONS — Patient pathway resolution tracking
-- =============================================================================

CREATE TABLE pathway_resolution_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE RESTRICT,
    patient_context JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    resulting_care_plan_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_resolution_sessions_status_check CHECK (
        status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')
    )
);

CREATE INDEX idx_pathway_resolution_sessions_patient ON pathway_resolution_sessions(patient_id);
CREATE INDEX idx_pathway_resolution_sessions_pathway ON pathway_resolution_sessions(pathway_id);
CREATE INDEX idx_pathway_resolution_sessions_status ON pathway_resolution_sessions(status);

-- =============================================================================
-- 5. PATHWAY_RESOLUTION_DECISIONS — Individual decision point resolutions
-- =============================================================================

CREATE TABLE pathway_resolution_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
    decision_point_graph_id VARCHAR(100) NOT NULL,
    resolution_type VARCHAR(30) NOT NULL,
    chosen_branch VARCHAR(200) NOT NULL,
    confidence_score DECIMAL(4,3),
    confidence_breakdown JSONB,
    provider_override BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by UUID,

    CONSTRAINT pathway_resolution_decisions_type_check CHECK (
        resolution_type IN ('AUTO_RESOLVED', 'SYSTEM_SUGGESTED', 'PROVIDER_DECIDED', 'FORCED_MANUAL')
    )
);

CREATE INDEX idx_pathway_resolution_decisions_session ON pathway_resolution_decisions(session_id);
CREATE INDEX idx_pathway_resolution_decisions_graph_id ON pathway_resolution_decisions(decision_point_graph_id);

-- =============================================================================
-- 6. CONFIDENCE_SIGNAL_DEFINITIONS — Signal categories for confidence scoring
-- =============================================================================

CREATE TABLE confidence_signal_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    scoring_type VARCHAR(30) NOT NULL,
    scoring_rules JSONB NOT NULL DEFAULT '{}',
    scope VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    institution_id UUID,
    default_weight FLOAT NOT NULL DEFAULT 0.25,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_signal_definitions_scoring_type_check CHECK (
        scoring_type IN ('DATA_PRESENCE', 'MAPPING_LOOKUP', 'CRITERIA_MATCH', 'RISK_INVERSE', 'CUSTOM_RULES')
    ),
    CONSTRAINT confidence_signal_definitions_scope_check CHECK (
        scope IN ('SYSTEM', 'ORGANIZATION', 'INSTITUTION')
    ),
    CONSTRAINT confidence_signal_definitions_name_scope_unique UNIQUE NULLS NOT DISTINCT (name, institution_id)
);

CREATE INDEX idx_confidence_signal_definitions_scope ON confidence_signal_definitions(scope);
CREATE INDEX idx_confidence_signal_definitions_institution ON confidence_signal_definitions(institution_id);

-- =============================================================================
-- 7. CONFIDENCE_SIGNAL_WEIGHTS — Multi-level signal weight overrides
-- =============================================================================

CREATE TABLE confidence_signal_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_definition_id UUID NOT NULL REFERENCES confidence_signal_definitions(id) ON DELETE CASCADE,
    weight FLOAT NOT NULL,
    scope VARCHAR(20) NOT NULL,
    pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100),
    node_type VARCHAR(30),
    institution_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_signal_weights_scope_check CHECK (
        scope IN ('NODE', 'PATHWAY', 'INSTITUTION_GLOBAL', 'ORGANIZATION_GLOBAL')
    ),
    CONSTRAINT confidence_signal_weights_unique UNIQUE NULLS NOT DISTINCT (signal_definition_id, scope, pathway_id, node_identifier, institution_id)
);

CREATE INDEX idx_confidence_signal_weights_signal ON confidence_signal_weights(signal_definition_id);
CREATE INDEX idx_confidence_signal_weights_pathway ON confidence_signal_weights(pathway_id);
CREATE INDEX idx_confidence_signal_weights_institution ON confidence_signal_weights(institution_id);

-- =============================================================================
-- 8. CONFIDENCE_NODE_WEIGHTS — Per-node importance weights for pathway rollup
-- =============================================================================

CREATE TABLE confidence_node_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100) NOT NULL,
    node_type VARCHAR(30) NOT NULL,
    default_weight FLOAT NOT NULL DEFAULT 1.0,
    institution_id UUID,
    weight_override FLOAT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_node_weights_unique UNIQUE NULLS NOT DISTINCT (pathway_id, node_identifier, institution_id)
);

CREATE INDEX idx_confidence_node_weights_pathway ON confidence_node_weights(pathway_id);
CREATE INDEX idx_confidence_node_weights_institution ON confidence_node_weights(institution_id);

-- =============================================================================
-- 9. CONFIDENCE_RESOLUTION_THRESHOLDS — Auto-resolve and suggest thresholds
-- =============================================================================

CREATE TABLE confidence_resolution_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auto_resolve_threshold FLOAT NOT NULL DEFAULT 0.85,
    suggest_threshold FLOAT NOT NULL DEFAULT 0.60,
    scope VARCHAR(20) NOT NULL,
    pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100),
    institution_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_resolution_thresholds_scope_check CHECK (
        scope IN ('SYSTEM_DEFAULT', 'ORGANIZATION', 'INSTITUTION', 'PATHWAY', 'NODE')
    )
);

CREATE INDEX idx_confidence_resolution_thresholds_scope ON confidence_resolution_thresholds(scope);
CREATE INDEX idx_confidence_resolution_thresholds_pathway ON confidence_resolution_thresholds(pathway_id);
CREATE INDEX idx_confidence_resolution_thresholds_institution ON confidence_resolution_thresholds(institution_id);

-- =============================================================================
-- 10. UPDATED_AT TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_pathway_graph_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pathway_graph_index_updated_at
    BEFORE UPDATE ON pathway_graph_index
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER pathway_resolution_sessions_updated_at
    BEFORE UPDATE ON pathway_resolution_sessions
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_signal_definitions_updated_at
    BEFORE UPDATE ON confidence_signal_definitions
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_signal_weights_updated_at
    BEFORE UPDATE ON confidence_signal_weights
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_node_weights_updated_at
    BEFORE UPDATE ON confidence_node_weights
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_resolution_thresholds_updated_at
    BEFORE UPDATE ON confidence_resolution_thresholds
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

-- =============================================================================
-- 11. TABLE COMMENTS
-- =============================================================================

COMMENT ON TABLE pathway_graph_index IS 'Relational index for pathway search. Graph data lives in AGE clinical_pathways namespace.';
COMMENT ON TABLE pathway_condition_codes IS 'Flat code-to-pathway mapping for Layer 1 recommendation matching';
COMMENT ON TABLE pathway_version_diffs IS 'Stores diff results from import pipeline for audit and review';
COMMENT ON TABLE pathway_resolution_sessions IS 'Tracks provider pathway resolution sessions for a patient';
COMMENT ON TABLE pathway_resolution_decisions IS 'Individual decision point resolutions within a session';
COMMENT ON TABLE confidence_signal_definitions IS 'Signal categories for computing per-node confidence scores';
COMMENT ON TABLE confidence_signal_weights IS 'Multi-level signal weight overrides (node -> pathway -> institution -> system)';
COMMENT ON TABLE confidence_node_weights IS 'Per-node importance weights for pathway confidence rollup';
COMMENT ON TABLE confidence_resolution_thresholds IS 'Auto-resolve and suggest thresholds at multiple levels';
```

- [ ] **Step 2: Commit**

```bash
git add shared/data-layer/migrations/038_create_pathway_graph_tables.sql
git commit -m "feat: add migration 038 — pathway graph relational tables + confidence framework"
```

### Task 6: Migration 039 — Seed Confidence Signals

**Files:**
- Create: `shared/data-layer/migrations/039_seed_confidence_signals.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 039: Seed built-in confidence signal definitions and system default thresholds
-- These are the 4 SYSTEM-scope signals used by the confidence framework.

-- =============================================================================
-- 1. BUILT-IN SIGNALS
-- =============================================================================

INSERT INTO confidence_signal_definitions (id, name, display_name, description, scoring_type, scoring_rules, scope, default_weight, is_active)
VALUES
  (
    gen_random_uuid(),
    'data_completeness',
    'Data Completeness',
    'Fraction of required inputs available in patient clinical context. Missing data is the most common source of incorrect auto-resolution.',
    'DATA_PRESENCE',
    '{"check": "inputs_array", "scoring": {"present": 1.0, "partial": 0.5, "absent": 0.0}, "aggregation": "ratio"}'::jsonb,
    'SYSTEM',
    0.30,
    true
  ),
  (
    gen_random_uuid(),
    'evidence_strength',
    'Evidence Strength',
    'Maps the evidence level backing this node to a confidence score. Stronger evidence increases trustworthiness of the recommendation.',
    'MAPPING_LOOKUP',
    '{"field": "evidence_level", "mappings": {"Level A": 0.95, "Level B": 0.80, "Level C": 0.65, "Expert Consensus": 0.60}, "default": 0.30}'::jsonb,
    'SYSTEM',
    0.25,
    true
  ),
  (
    gen_random_uuid(),
    'match_quality',
    'Patient Match Quality',
    'How precisely patient data matches pathway criteria. Compares patient codes and values against each criterion.',
    'CRITERIA_MATCH',
    '{"match_scores": {"exact_code_match": 1.0, "parent_prefix_match": 0.7, "inferred_from_context": 0.5, "absent": 0.0}, "aggregation": "weighted_average", "critical_criteria_cap": 0.5}'::jsonb,
    'SYSTEM',
    0.25,
    true
  ),
  (
    gen_random_uuid(),
    'risk_magnitude',
    'Risk Magnitude',
    'Inverse of clinical risk — higher risk lowers confidence for auto-resolution, forcing provider involvement for high-stakes decisions.',
    'RISK_INVERSE',
    '{"formula": "max(0.10, 1.0 - (log10(risk_value * 1000 + 1) / 3.0))", "no_data_default": 0.50, "aggregation": "min"}'::jsonb,
    'SYSTEM',
    0.20,
    true
  );

-- =============================================================================
-- 2. SYSTEM DEFAULT THRESHOLDS
-- =============================================================================

INSERT INTO confidence_resolution_thresholds (id, auto_resolve_threshold, suggest_threshold, scope)
VALUES (
  gen_random_uuid(),
  0.85,
  0.60,
  'SYSTEM_DEFAULT'
);
```

- [ ] **Step 2: Commit**

```bash
git add shared/data-layer/migrations/039_seed_confidence_signals.sql
git commit -m "feat: add migration 039 — seed built-in confidence signals and default thresholds"
```

---

## Chunk 3: pathway-service Scaffold (Package, Config, Types)

### Task 7: package.json

**Files:**
- Create: `apps/pathway-service/package.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "pathway-service",
  "private": true,
  "description": "Prism Pathway Service - Clinical pathway graph management and resolution",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "engines": {
    "node": ">=18.0"
  },
  "scripts": {
    "build": "npm run codegen && tsc",
    "codegen": "graphql-codegen",
    "postinstall": "npm run build",
    "start": "node dist/index.js",
    "dev": "nodemon --watch \"src/**\" --ext \"ts,json,graphql\" --exec \"npm run build && npm run start\" --ignore src/__generated__",
    "test": "jest"
  },
  "dependencies": {
    "@apollo/server": "^4.3.3",
    "@apollo/subgraph": "^2.3.1",
    "@prism/security": "workspace:*",
    "@prism/service-clients": "workspace:*",
    "@types/pg": "^8.15.5",
    "@types/uuid": "^9.0.0",
    "graphql": "latest",
    "graphql-tag": "latest",
    "ioredis": "^5.8.0",
    "pg": "^8.16.3",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@graphql-codegen/cli": "^5.0.0",
    "@graphql-codegen/typescript": "^4.0.0",
    "@graphql-codegen/typescript-resolvers": "^4.0.0",
    "@types/jest": "^29.0.3",
    "@types/node": "^22.0.0",
    "jest": "^29.0.3",
    "nodemon": "^3.0.0",
    "ts-jest": "^29.0.2",
    "ts-node": "^10.9.1",
    "typescript": "^5.0.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": [
      "src"
    ],
    "globals": {
      "ts-jest": {
        "testRegext": "/__tests__/.*.test.ts",
        "verbose": true
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/package.json
git commit -m "feat: add pathway-service package.json"
```

### Task 8: tsconfig.json

**Files:**
- Create: `apps/pathway-service/tsconfig.json`

- [ ] **Step 1: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "commonjs",
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "removeComments": true,
    "skipLibCheck": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["esnext", "esnext.asynciterable", "DOM"],
    "types": ["node", "jest"],
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "./src",
    "paths": {
      "@pathway/*": ["./*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["codegen.ts", "dist", "node_modules", "src/__tests__"]
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/tsconfig.json
git commit -m "feat: add pathway-service tsconfig.json"
```

### Task 9: codegen.ts

**Files:**
- Create: `apps/pathway-service/codegen.ts`

- [ ] **Step 1: Write codegen.ts**

```typescript
import { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./*.graphql",
  generates: {
    "./src/__generated__/resolvers-types.ts": {
      config: {
        federation: true,
        useIndexSignature: true,
        contextType: '../types/index#DataSourceContext',
      },
      plugins: ["typescript", "typescript-resolvers"]
    },
  },
};

export default config;
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/codegen.ts
git commit -m "feat: add pathway-service codegen config"
```

### Task 10: TypeScript Types

**Files:**
- Create: `apps/pathway-service/src/types/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
import { Pool } from 'pg';
import { Redis } from 'ioredis';

// Apollo context passed to every resolver
export interface DataSourceContext {
  pool: Pool;
  redis: Redis;
  userId: string;
  userRole: string;
}

// Pathway status lifecycle
export enum PathwayStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  SUPERSEDED = 'SUPERSEDED',
}

// Pathway categories
export enum PathwayCategory {
  CHRONIC_DISEASE = 'CHRONIC_DISEASE',
  ACUTE_CARE = 'ACUTE_CARE',
  PREVENTIVE_CARE = 'PREVENTIVE_CARE',
  POST_PROCEDURE = 'POST_PROCEDURE',
  MEDICATION_MANAGEMENT = 'MEDICATION_MANAGEMENT',
  LIFESTYLE_MODIFICATION = 'LIFESTYLE_MODIFICATION',
  MENTAL_HEALTH = 'MENTAL_HEALTH',
  PEDIATRIC = 'PEDIATRIC',
  GERIATRIC = 'GERIATRIC',
  OBSTETRIC = 'OBSTETRIC',
}

// Relational index row
export interface PathwayGraphIndex {
  id: string;
  ageNodeId: string | null;
  logicalId: string;
  title: string;
  version: string;
  category: PathwayCategory;
  status: PathwayStatus;
  conditionCodes: string[];
  scope: string | null;
  targetPopulation: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Resolution session status
export enum ResolutionSessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
}

// Resolution decision types
export enum ResolutionType {
  AUTO_RESOLVED = 'AUTO_RESOLVED',
  SYSTEM_SUGGESTED = 'SYSTEM_SUGGESTED',
  PROVIDER_DECIDED = 'PROVIDER_DECIDED',
  FORCED_MANUAL = 'FORCED_MANUAL',
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/src/types/index.ts
git commit -m "feat: add pathway-service TypeScript types"
```

---

## Chunk 4: pathway-service Core (Database, AGE Client, Resolvers, Schema)

### Task 11: Database Service with AGE search_path

**Files:**
- Create: `apps/pathway-service/src/services/database.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/database.test.ts`:

```typescript
import { initializeDatabase, getPool, getRedis } from '../services/database';

describe('database initialization', () => {
  it('should throw if getPool called before init', () => {
    expect(() => getPool()).toThrow('Database not initialized');
  });

  it('should throw if getRedis called before init', () => {
    expect(() => getRedis()).toThrow('Database not initialized');
  });

  it('should return pool and redis after init', () => {
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(getPool()).toBe(mockPool);
    expect(getRedis()).toBe(mockRedis);
  });

  it('should register connect handler on pool for AGE LOAD + search_path', () => {
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(mockPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config apps/pathway-service/package.json --testPathPattern database.test --no-coverage 2>&1 | tail -20` (from `prism-graphql/`)

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';

let pool: Pool;
let redis: Redis;

export function initializeDatabase(dbPool: Pool, redisClient: Redis): void {
  pool = dbPool;
  redis = redisClient;

  // Every new connection needs AGE loaded and ag_catalog in search_path.
  // shared_preload_libraries handles LOAD in the Docker image, but we also
  // LOAD explicitly as a safety net (idempotent — no-op if already loaded).
  pool.on('connect', (client: PoolClient) => {
    client.query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public;").catch((err) => {
      console.error('Failed to initialize AGE on new connection:', err);
    });
  });
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return redis;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config apps/pathway-service/package.json --testPathPattern database.test --no-coverage 2>&1 | tail -20` (from `prism-graphql/`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/database.ts apps/pathway-service/src/__tests__/database.test.ts
git commit -m "feat: add pathway-service database service with AGE search_path setup"
```

### Task 12: AGE Client (Cypher Query Wrapper)

**Files:**
- Create: `apps/pathway-service/src/services/age-client.ts`
- Create: `apps/pathway-service/src/__tests__/age-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { buildCypherQuery } from '../services/age-client';

describe('buildCypherQuery', () => {
  it('should wrap cypher in SELECT FROM cypher() call', () => {
    const result = buildCypherQuery(
      'clinical_pathways',
      'MATCH (p:Pathway) RETURN p',
      '(v agtype)'
    );
    expect(result).toBe(
      "SELECT * FROM cypher('clinical_pathways', $$ MATCH (p:Pathway) RETURN p $$) AS (v agtype)"
    );
  });

  it('should handle multi-column return types', () => {
    const result = buildCypherQuery(
      'clinical_pathways',
      'MATCH (p:Pathway)-[:HAS_STAGE]->(s:Stage) RETURN p, s',
      '(p agtype, s agtype)'
    );
    expect(result).toContain('AS (p agtype, s agtype)');
  });

  it('should use default graph name when not specified', () => {
    const result = buildCypherQuery(
      undefined,
      'CREATE (n:Test {id: 1}) RETURN n',
      '(v agtype)'
    );
    expect(result).toContain("cypher('clinical_pathways'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config apps/pathway-service/package.json --testPathPattern age-client.test --no-coverage 2>&1 | tail -20` (from `prism-graphql/`)

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { Pool, QueryResult } from 'pg';

const DEFAULT_GRAPH = 'clinical_pathways';

/**
 * Build a SQL string that wraps a Cypher query for execution via the pg driver.
 * AGE Cypher is called through: SELECT * FROM cypher('graph', $$ ... $$) AS (columns)
 */
export function buildCypherQuery(
  graphName: string | undefined,
  cypher: string,
  returnType: string
): string {
  const graph = graphName ?? DEFAULT_GRAPH;
  return `SELECT * FROM cypher('${graph}', $$ ${cypher} $$) AS ${returnType}`;
}

/**
 * Execute a Cypher query against the AGE graph via the pg pool.
 * Requires that the connection has ag_catalog in search_path (set by database.ts pool.on('connect')).
 */
export async function executeCypher(
  pool: Pool,
  cypher: string,
  returnType: string,
  graphName?: string
): Promise<QueryResult> {
  const sql = buildCypherQuery(graphName, cypher, returnType);
  return pool.query(sql);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config apps/pathway-service/package.json --testPathPattern age-client.test --no-coverage 2>&1 | tail -20` (from `prism-graphql/`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/age-client.ts apps/pathway-service/src/__tests__/age-client.test.ts
git commit -m "feat: add AGE Cypher query wrapper with unit tests"
```

### Task 13: GraphQL Schema (Stub)

**Files:**
- Create: `apps/pathway-service/schema.graphql`

- [ ] **Step 1: Write the minimal stub schema**

This schema is intentionally minimal — Plan 2 (Import Pipeline) and Plan 4 (Resolution) will expand it with the full query/mutation surface.

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@shareable"])

# Enums
enum PathwayStatus {
  DRAFT
  ACTIVE
  ARCHIVED
  SUPERSEDED
}

enum PathwayCategory {
  CHRONIC_DISEASE
  ACUTE_CARE
  PREVENTIVE_CARE
  POST_PROCEDURE
  MEDICATION_MANAGEMENT
  LIFESTYLE_MODIFICATION
  MENTAL_HEALTH
  PEDIATRIC
  GERIATRIC
  OBSTETRIC
}

# Core types
type Pathway @key(fields: "id") {
  id: ID!
  logicalId: String!
  title: String!
  version: String!
  category: PathwayCategory!
  status: PathwayStatus!
  conditionCodes: [String!]!
  scope: String
  targetPopulation: String
  isActive: Boolean!
  createdAt: String!
  updatedAt: String!
}

# Queries — stub for health check and basic listing
type Query {
  pathwayServiceHealth: Boolean!
  pathways(status: PathwayStatus, category: PathwayCategory, first: Int): [Pathway!]!
  pathway(id: ID!): Pathway
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/schema.graphql
git commit -m "feat: add pathway-service stub GraphQL schema"
```

### Task 14: Resolvers

**Files:**
- Create: `apps/pathway-service/src/resolvers/Query.ts`
- Create: `apps/pathway-service/src/resolvers/index.ts`

- [ ] **Step 1: Write Query resolvers**

```typescript
import { DataSourceContext } from '../types';

export const Query = {
  Query: {
    pathwayServiceHealth: (): boolean => true,

    pathways: async (
      _: unknown,
      args: { status?: string; category?: string; first?: number },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const first = args.first ?? 50;

      let query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE 1=1
      `;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (args.status) {
        query += ` AND status = $${paramIdx}`;
        params.push(args.status);
        paramIdx++;
      }
      if (args.category) {
        query += ` AND category = $${paramIdx}`;
        params.push(args.category);
        paramIdx++;
      }

      query += ` ORDER BY updated_at DESC LIMIT $${paramIdx}`;
      params.push(first);

      const result = await pool.query(query, params);
      return result.rows;
    },

    pathway: async (
      _: unknown,
      args: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE id = $1
      `;
      const result = await pool.query(query, [args.id]);
      return result.rows[0] || null;
    },
  },

  // Federation reference resolver
  Pathway: {
    __resolveReference: async (
      ref: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE id = $1
      `;
      const result = await pool.query(query, [ref.id]);
      return result.rows[0] || null;
    },
  },
};
```

- [ ] **Step 2: Write resolver barrel export**

```typescript
import { Query } from "./Query";

const resolvers = {
  ...Query,
};

export default resolvers;
```

- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/resolvers/index.ts
git commit -m "feat: add pathway-service resolvers (health check + basic CRUD)"
```

### Task 15: Server Entry Point (index.ts)

**Files:**
- Create: `apps/pathway-service/src/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import resolvers from "./resolvers";
import { initializeDatabase } from "./services/database";

const port = process.env.PORT || "4016";
const subgraphName = "pathway";

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'healthcare_federation',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  });

  initializeDatabase(pool, redis);

  const typeDefs = gql(readFileSync("schema.graphql", { encoding: "utf-8" }));
  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
  });

  const DEV_PROVIDER_ID = '00000000-0000-4000-a000-000000000002';

  const { url } = await startStandaloneServer(server, {
    listen: { port: Number.parseInt(port) },
    context: async ({ req }) => {
      const userId = req.headers['x-user-id'] as string || DEV_PROVIDER_ID;
      const userRole = req.headers['x-user-role'] as string || 'PROVIDER';
      return {
        pool,
        redis,
        userId,
        userRole,
      };
    },
  });

  console.log(`Subgraph ${subgraphName} ready at ${url}`);
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/src/index.ts
git commit -m "feat: add pathway-service Apollo Server entry point"
```

---

## Chunk 5: Dockerfile, Docker Compose Integration, Gateway Registration

### Task 16: Dockerfile

**Files:**
- Create: `apps/pathway-service/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Follow the exact pattern from `apps/careplan-service/Dockerfile`:

```dockerfile
# Multi-stage build for Pathway service
FROM node:18-alpine AS builder

WORKDIR /app

# Copy root tsconfig for path alias resolution
COPY tsconfig.json ./tsconfig.base.json

# Copy shared modules
COPY shared/ciss-types ./shared/ciss-types
COPY shared/security ./shared/security
COPY shared/service-clients ./shared/service-clients

# Build shared modules
WORKDIR /app/shared/ciss-types
RUN npm install && npm run build

WORKDIR /app/shared/security
RUN npm install && npm run build && npm link

WORKDIR /app/shared/service-clients
RUN npm link @prism/security && npm install && npm run build && npm link

# Now build the service
WORKDIR /app/service

# Copy service package files
COPY apps/pathway-service/package*.json ./
COPY apps/pathway-service/codegen.ts ./
COPY apps/pathway-service/schema.graphql ./

# Replace workspace:* references with file references for Docker build
RUN sed -i 's/"@prism\/security": "workspace:\*"/"@prism\/security": "file:..\/shared\/security"/g' package.json && \
    sed -i 's/"@prism\/service-clients": "workspace:\*"/"@prism\/service-clients": "file:..\/shared\/service-clients"/g' package.json

# Create tsconfig that extends base and includes shared paths
RUN echo '{\
  "extends": "../tsconfig.base.json",\
  "compilerOptions": {\
    "target": "esnext",\
    "module": "commonjs",\
    "esModuleInterop": true,\
    "sourceMap": true,\
    "declaration": true,\
    "declarationMap": true,\
    "removeComments": true,\
    "skipLibCheck": true,\
    "noImplicitAny": true,\
    "noImplicitReturns": true,\
    "noFallthroughCasesInSwitch": true,\
    "forceConsistentCasingInFileNames": true,\
    "lib": ["esnext", "esnext.asynciterable", "DOM"],\
    "types": ["node", "jest"],\
    "rootDir": "./src",\
    "outDir": "./dist",\
    "baseUrl": "..",\
    "paths": {\
      "@pathway/*": ["service/src/*"],\
      "@shared/*": ["shared/*"]\
    }\
  },\
  "include": ["src/**/*"],\
  "exclude": ["codegen.ts", "dist", "node_modules", "src/__tests__"]\
}' > tsconfig.json

# Install dependencies (skip scripts to avoid build errors)
RUN npm install --ignore-scripts

# Copy source code
COPY apps/pathway-service/src/ ./src/

# Generate types and build
RUN npm run codegen
RUN npx tsc

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S graphql -u 1001

# Copy built application
COPY --from=builder --chown=graphql:nodejs /app/service/dist ./dist
COPY --from=builder --chown=graphql:nodejs /app/service/node_modules ./node_modules
COPY --from=builder --chown=graphql:nodejs /app/shared ./shared
COPY --chown=graphql:nodejs apps/pathway-service/schema.graphql ./

# Re-link shared packages (npm link symlinks don't survive Docker COPY)
RUN rm -rf node_modules/@prism/security node_modules/@prism/service-clients && \
    mkdir -p node_modules/@prism && \
    ln -s /app/shared/security node_modules/@prism/security && \
    ln -s /app/shared/service-clients node_modules/@prism/service-clients

USER graphql

EXPOSE 4016

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null --post-data='{"query":"{__typename}"}' --header='Content-Type: application/json' http://localhost:4016/ || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Commit**

```bash
git add apps/pathway-service/Dockerfile
git commit -m "feat: add pathway-service Dockerfile"
```

### Task 17: Add pathway-service to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the pathway-service container**

Add this block after the `decision-explorer-service` block (before `transcription-worker`):

```yaml
  # Pathway Service (Clinical pathway graph management)
  pathway-service:
    build:
      context: .
      dockerfile: apps/pathway-service/Dockerfile
    container_name: healthcare-pathway
    ports:
      - "4016:4016"
    environment:
      - NODE_ENV=production
      - PORT=4016
      - SERVICE_NAME=pathway
      # Database connections
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_DB=healthcare_federation
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      # Redis connection
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=redis_password
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null --post-data='{\"query\":\"{__typename}\"}' --header='Content-Type: application/json' http://localhost:4016/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - healthcare-network
```

- [ ] **Step 2: Add PATHWAY_URL to gateway environment**

In the gateway service's environment section, add after `DECISION_EXPLORER_URL`:

```yaml
      # Pathway Service
      - PATHWAY_URL=http://pathway-service:4016
```

- [ ] **Step 3: Add pathway-service to gateway depends_on**

In the gateway's `depends_on` list, add:

```yaml
      - pathway-service
```

- [ ] **Step 4: Verify compose file is still valid**

Run: `docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml config --quiet`

Expected: Exits 0.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add pathway-service to docker-compose with gateway wiring"
```

### Task 18: Register pathway-service in Gateway

**Files:**
- Modify: `gateway/index.js:12-24` (services array)

- [ ] **Step 1: Add the pathway service entry**

Add to the `services` array in `gateway/index.js`, after the `epic-api` entry:

```javascript
    { name: 'pathway', envVar: 'PATHWAY_URL', defaultUrl: 'http://pathway-service:4016' },
```

- [ ] **Step 2: Commit**

```bash
git add gateway/index.js
git commit -m "feat: register pathway-service in Apollo Federation gateway"
```

---

## Chunk 6: Verification

### Task 19: Install Dependencies and Build

- [ ] **Step 1: Install pathway-service dependencies**

Run: `npm install --prefix /home/claude/workspace/prism-graphql/apps/pathway-service`

Expected: Dependencies install. `postinstall` runs codegen + tsc build. No errors.

- [ ] **Step 2: Run pathway-service unit tests**

Run: `npm test --prefix /home/claude/workspace/prism-graphql/apps/pathway-service`

Expected: All tests pass (database.test.ts + age-client.test.ts).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project /home/claude/workspace/prism-graphql/apps/pathway-service/tsconfig.json`

Expected: No type errors.

- [ ] **Step 4: Commit if any fixes were needed**

Only if steps 1-3 required fixes.

### Task 20: Docker Compose Validation

- [ ] **Step 1: Build the custom postgres image**

Run: `docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml build postgres`

Expected: Image builds successfully with AGE compiled.

- [ ] **Step 2: Build the pathway-service image**

Run: `docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml build pathway-service`

Expected: Multi-stage build completes. Service compiles.

- [ ] **Step 3: Start postgres + pathway-service only**

Run:
```bash
docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml up -d postgres redis pathway-service
```

Wait for health checks, then:

```bash
docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml ps pathway-service postgres
```

Expected: Both containers healthy.

- [ ] **Step 4: Test pathway-service health endpoint**

Run:
```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathwayServiceHealth }"}'
```

Expected: `{"data":{"pathwayServiceHealth":true}}`

- [ ] **Step 5: Test AGE is available via pathway-service's database**

Run:
```bash
docker exec healthcare-postgres psql -U postgres -d healthcare_federation -c "LOAD 'age'; SET search_path = ag_catalog, public; SELECT * FROM ag_graph WHERE name = 'clinical_pathways';"
```

Expected: Returns one row showing the `clinical_pathways` graph (if migrations have been run).

- [ ] **Step 6: Stop test containers**

Run: `docker compose -f /home/claude/workspace/prism-graphql/docker-compose.yml down`

- [ ] **Step 7: Final commit if any fixes**

Only if verification uncovered issues.
