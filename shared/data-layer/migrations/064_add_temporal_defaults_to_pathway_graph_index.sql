-- Migration 064: pathway-level temporal defaults
--
-- Temporal horizon work (design §5, §7). The PATHWAY level of the
-- SYSTEM_DEFAULT → PATHWAY → NODE cascade. The pathway JSON header carries
-- `default_horizons` / `default_statuses`, but import decomposes the header
-- and only known fields survive — PathwayMetadata has no temporal fields and
-- root creation serializes a fixed list — so the header alone cannot
-- round-trip.
--
-- The relational index is the SINGLE source: there is deliberately no copy on
-- the AGE root node. Import reconstruction reads it back from here; graph root
-- creation ignores it (§7.4).
--
-- Nullable: NULL and '{}' both mean "this pathway states no opinion, inherit
-- the platform defaults for the session's pinned policy version".

BEGIN;

ALTER TABLE pathway_graph_index
  ADD COLUMN temporal_defaults JSONB;

COMMENT ON COLUMN pathway_graph_index.temporal_defaults IS
    'Pathway-level temporal cascade defaults, in pathway-JSON header shape: {"default_horizons":{<gate field>:<horizon>},"default_statuses":{<gate field>:active|inactive|any}}. NULL = no pathway-level opinion. Single source of truth — not mirrored onto the AGE root node.';

COMMIT;
