# Manual Testing: Pathway Graph Infrastructure (Plan 1)

PR #26 — `feat/pathway-graph-infrastructure`

This document walks through verifying every change in the PR: custom PG image, AGE extension, migrations, pathway-service, and gateway integration. Each section has expected results and known gaps to watch for.

---

## Prerequisites

```bash
# Switch to the feature branch
cd workspace/prism-graphql
git fetch origin
git checkout feat/pathway-graph-infrastructure
```

Make sure no containers from previous runs are lingering:
```bash
docker compose down -v   # -v removes volumes for a clean slate
```

---

## 1. Custom PostgreSQL Image Build

**What to verify:** AGE 1.5.0 compiles on top of pgvector:pg15 without errors.

```bash
docker compose build postgres
```

**Expected:**
- Build completes (may take 2-3 min for AGE compilation)
- No compiler errors in the AGE `make` step
- Final image size is reasonable (~400-500MB)

**Check image layers:**
```bash
docker images | grep healthcare-postgres
```

**Known gaps:**
- The image is not pushed to a registry yet — CI/CD and k8s manifests still reference the old image. This is expected (deferred to deployment work).
- No automated smoke test in CI for AGE compilation — if AGE 1.5.0 disappears or the tag changes, the build will break silently.

---

## 2. Stack Startup + Migration Execution

**What to verify:** All services start, migrations 036-039 run, and AGE is available.

```bash
docker compose up -d postgres redis
# Wait for postgres healthy
docker compose exec postgres pg_isready -U postgres

# Run migrations
make migrate
```

**Expected for migration 036 (AGE install):**
- `LOAD 'age'` succeeds
- `CREATE EXTENSION age` succeeds
- `create_graph('clinical_pathways')` returns a row
- Test node create/delete Cypher queries execute without error

**Expected for migration 037 (legacy rename):**
- No errors (tables exist from migration 017 and are empty)
- Tables renamed: `clinical_pathways` → `clinical_pathways_legacy`, etc.

**Expected for migration 038 (new tables):**
- 9 new tables created

**Expected for migration 039 (seed data):**
- 4 rows in `confidence_signal_definitions`
- 1 row in `confidence_resolution_thresholds`

**Verify all at once:**
```bash
# AGE graph exists
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM ag_graph WHERE name = 'clinical_pathways';
"

# AGE Cypher works
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    CREATE (n:TestNode {name: 'manual_test'}) RETURN n
  \$\$) AS (v agtype);
"

# Clean up test node
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (n:TestNode {name: 'manual_test'}) DELETE n
  \$\$) AS (v agtype);
"

# Legacy tables renamed
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT tablename FROM pg_tables
  WHERE tablename LIKE '%_legacy'
  ORDER BY tablename;
"
# Expected: 5 rows (clinical_pathways_legacy, pathway_nodes_legacy, etc.)

# New tables exist
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT tablename FROM pg_tables
  WHERE tablename IN (
    'pathway_graph_index', 'pathway_condition_codes', 'pathway_version_diffs',
    'pathway_resolution_sessions', 'pathway_resolution_decisions',
    'confidence_signal_definitions', 'confidence_signal_weights',
    'confidence_node_weights', 'confidence_resolution_thresholds'
  )
  ORDER BY tablename;
"
# Expected: 9 rows

# Seed data
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT name, scoring_type, default_weight FROM confidence_signal_definitions ORDER BY name;
"
# Expected:
# data_completeness  | DATA_PRESENCE   | 0.3000
# evidence_strength  | MAPPING_LOOKUP  | 0.2500
# match_quality      | CRITERIA_MATCH  | 0.2500
# risk_magnitude     | RISK_INVERSE    | 0.2000

docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT auto_resolve_threshold, suggest_threshold, scope FROM confidence_resolution_thresholds;
"
# Expected: 0.8500 | 0.6000 | SYSTEM_DEFAULT
```

**Known gaps:**
- Migration 036 uses `LOAD 'age'` which is session-scoped. If `shared_preload_libraries` isn't picked up by the container (e.g., custom postgresql.conf override), every new psql session needs `LOAD 'age'` first. The pathway-service handles this via its `pool.on('connect')` handler, but manual psql sessions need the explicit LOAD.
- The migration runner (`run-migrations.sh`) runs via `docker compose exec postgres psql`. If AGE's shared library isn't preloaded, migration 036 may fail. Watch for: `ERROR: could not access file "age": No such file or directory`.
- No down-migration scripts — rollback requires manual `DROP TABLE` / `DROP EXTENSION` statements.

---

## 3. Pathway Service Startup

**What to verify:** pathway-service starts, connects to DB, registers with gateway.

```bash
docker compose up -d pathway-service
docker compose logs pathway-service --tail=20
```

**Expected log output:**
```
Subgraph pathway ready at http://0.0.0.0:4016/
```

**No errors about:**
- Database connection failures
- AGE search_path issues
- Schema parsing errors

**Health check:**
```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathwayServiceHealth }"}'
```

**Expected:**
```json
{"data":{"pathwayServiceHealth":true}}
```

**Known gaps:**
- The service uses `startStandaloneServer` which serves GraphQL at `/` (root path), but the gateway default URL is `http://pathway-service:4016/graphql`. Apollo's standalone server also accepts requests at any path, so this works — but it's worth confirming in your environment.
- No structured logging — uses `console.log` like other services. Observability deferred to post-MVP.

---

## 4. Gateway Integration

**What to verify:** Gateway discovers the pathway subgraph and exposes its types.

```bash
docker compose up -d   # Start everything
docker compose logs gateway --tail=30
```

**Expected in gateway logs:**
```
Adding service: pathway at http://pathway-service:4016/graphql
```

**Test via gateway (port 4000):**
```bash
# Health check through gateway
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathwayServiceHealth }"}'
```

**Expected:**
```json
{"data":{"pathwayServiceHealth":true}}
```

**Test pathway queries (will return empty arrays since no data exists yet):**
```bash
# List pathways (empty)
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways { id title status } }"}'

# Expected: {"data":{"pathways":[]}}

# Query by ID (null)
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathway(id: \"00000000-0000-0000-0000-000000000000\") { id title } }"}'

# Expected: {"data":{"pathway":null}}

# Filter by status
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(status: DRAFT) { id title status } }"}'

# Expected: {"data":{"pathways":[]}}
```

**Known gaps:**
- If any other subgraph is down, the gateway may fail to compose the supergraph and refuse to start. The `_DISABLED` env var pattern (e.g., `PATHWAY_URL_DISABLED=true`) can exclude individual services, but it requires knowing which one is broken.
- The pathway-service schema is a stub — only `pathwayServiceHealth`, `pathways`, and `pathway` queries exist. Import mutations, resolution mutations, and confidence queries arrive in Plans 2-4.

---

## 5. Insert Test Data Manually (Verify Full Path)

**What to verify:** Data inserted into `pathway_graph_index` is queryable through GraphQL.

```bash
# Insert a test pathway directly into the DB
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  INSERT INTO pathway_graph_index (
    id, logical_id, title, version, category, status, condition_codes, scope, target_population, is_active
  ) VALUES (
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'CP-TestPathway',
    'Test Prior Uterine Surgery Pathway',
    '1.0',
    'OBSTETRIC',
    'DRAFT',
    ARRAY['O34.21', 'O34.211', 'O34.212'],
    'Prior uterine surgery management',
    'Patients with prior cesarean delivery or myomectomy',
    false
  );
"

# Query through GraphQL
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways { id logicalId title version category status conditionCodes scope targetPopulation isActive } }"}' | python3 -m json.tool

# Expected: One pathway returned with all fields populated

# Query by ID
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathway(id: \"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\") { id title status conditionCodes } }"}' | python3 -m json.tool

# Filter by category
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(category: OBSTETRIC) { id title } }"}' | python3 -m json.tool

# Clean up
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  DELETE FROM pathway_graph_index WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
"
```

**Known gaps:**
- `createdAt` and `updatedAt` are returned as ISO strings — no custom DateTime scalar in the stub schema. Plan 2 may need to add one.
- No input validation on the GraphQL layer (e.g., `first` could be negative). The resolver trusts the input. Plan 2 will add proper input types with validation.

---

## 6. Constraint and Index Verification

**What to verify:** Unique constraints, check constraints, and indexes work correctly.

```bash
# Test logical_id + version uniqueness
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  INSERT INTO pathway_graph_index (logical_id, title, version, category) VALUES ('CP-Dup', 'Test', '1.0', 'ACUTE_CARE');
  INSERT INTO pathway_graph_index (logical_id, title, version, category) VALUES ('CP-Dup', 'Test 2', '1.0', 'ACUTE_CARE');
"
# Expected: Second INSERT fails with unique violation

# Test status check constraint
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  INSERT INTO pathway_graph_index (logical_id, title, version, category, status) VALUES ('CP-Bad', 'Test', '1.0', 'ACUTE_CARE', 'INVALID');
"
# Expected: Fails with check constraint violation

# Test category check constraint
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  INSERT INTO pathway_graph_index (logical_id, title, version, category) VALUES ('CP-Bad2', 'Test', '1.0', 'NOT_A_CATEGORY');
"
# Expected: Fails with check constraint violation

# Test NULLS NOT DISTINCT on confidence_signal_definitions
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  INSERT INTO confidence_signal_definitions (name, display_name, scoring_type, scope) VALUES ('test_signal', 'Test', 'CUSTOM_RULES', 'SYSTEM');
  INSERT INTO confidence_signal_definitions (name, display_name, scoring_type, scope) VALUES ('test_signal', 'Test 2', 'CUSTOM_RULES', 'SYSTEM');
"
# Expected: Second INSERT fails — NULLS NOT DISTINCT treats both NULL institution_ids as equal

# Clean up
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  DELETE FROM pathway_graph_index WHERE logical_id IN ('CP-Dup', 'CP-Bad', 'CP-Bad2');
  DELETE FROM confidence_signal_definitions WHERE name = 'test_signal';
"
```

---

## 7. Existing Services Unaffected

**What to verify:** The custom PG image and new tables don't break existing services.

```bash
# After full stack start, check all services are healthy
docker compose ps

# Test an existing service through gateway
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ patients(first: 1) { patients { id firstName lastName } } }"}'

# Check that pgvector still works (used by RAG)
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'age');
"
# Expected: Both 'vector' and 'age' listed
```

**Known gaps:**
- If any existing service attempts to reference the old `clinical_pathways` table (now renamed to `clinical_pathways_legacy`), it will get a "relation does not exist" error. The decision-explorer-service had stubs referencing these tables — verify it still starts. It should be fine since those tables were never used, but check the logs.

---

## Summary of Known Gaps

| Gap | Severity | When to Fix |
|-----|----------|-------------|
| No import mutations — can't populate pathways via GraphQL yet | Expected | Plan 2 (Import Pipeline) |
| No resolution mutations — can't resolve pathways for patients | Expected | Plan 4 (Resolution) |
| No confidence scoring queries | Expected | Plan 3 (Confidence Framework) |
| AGE graph is empty — no Cypher-based queries exercised end-to-end | Expected | Plan 2 will create nodes |
| No CI build step for custom PG image | Low | Before staging deploy |
| No down-migration scripts | Low | Add if rollback needed |
| k8s manifests still reference old PG image | Low | Before staging deploy |
| decision-explorer-service may reference old table names | Low | Verify on full stack start |
| No DateTime scalar in schema | Low | Plan 2 schema expansion |
| No input validation on GraphQL args | Low | Plan 2 input types |
