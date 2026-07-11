-- Migration 061: is_preview flag on multi_pathway_resolution_sessions
--
-- Preview sessions are runs created by admin/QA tooling (the pathway
-- preview page, simulator scenarios, etc.) rather than by a real provider
-- encounter. They share the exact same resolver path — same TraversalEngine
-- pass, same merge pipeline, same DDI checks — so we get real integration
-- coverage without a parallel "preview-only" resolver. What we want to
-- avoid is:
--
--   * Preview rows showing up in real "my sessions" list views.
--   * Preview rows polluting downstream reporting / audit trails.
--   * Preview rows accumulating forever.
--
-- The flag is set at session-create time (routed from the existing
-- `syntheticPatient` mutation argument for now; more preview sources can
-- flip it directly later). List resolvers filter by `is_preview = false`
-- by default. `deletePreviewSession` refuses to hard-delete any row where
-- `is_preview = false`.
--
-- Partial index — most sessions are real, so we only index the minority
-- (preview rows) which are what cleanup queries scan.

BEGIN;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN is_preview BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_mp_resolution_sessions_is_preview
    ON multi_pathway_resolution_sessions(is_preview)
    WHERE is_preview = true;

COMMENT ON COLUMN multi_pathway_resolution_sessions.is_preview IS
    'True when this session was created by admin/QA/preview tooling. Filtered out of default list queries; deletable via deletePreviewSession.';

COMMIT;
