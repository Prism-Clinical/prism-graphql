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
