-- Join table for linking related visits (e.g., prior visits relevant to current diagnosis)

CREATE TABLE IF NOT EXISTS visit_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  related_visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_visit_relation UNIQUE(visit_id, related_visit_id),
  CONSTRAINT chk_no_self_relation CHECK(visit_id != related_visit_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_relations_visit_id ON visit_relations(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_relations_related_visit_id ON visit_relations(related_visit_id);
