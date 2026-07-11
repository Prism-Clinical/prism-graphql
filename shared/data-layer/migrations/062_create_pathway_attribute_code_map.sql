-- Migration 062: curated attribute-name -> code map for the pathway
-- resolution engine's attribute registry (lab.* / allergy.* namespaces).
-- Mirrors the snomed_icd10_common_map read-boundary pattern: small curated
-- table, cached in-memory by pathway-service.

BEGIN;

CREATE TABLE pathway_attribute_code_map (
  attribute_name TEXT PRIMARY KEY,            -- e.g. 'lab.hemoglobin'
  namespace      TEXT NOT NULL,               -- 'lab' | 'allergy'
  system         TEXT NOT NULL,               -- 'LOINC' | 'SNOMED' | ...
  code           TEXT NOT NULL,               -- '718-7'
  value_type     TEXT NOT NULL DEFAULT 'number'
    CHECK (value_type IN ('number', 'boolean', 'string'))
);

COMMENT ON TABLE pathway_attribute_code_map IS
  'Curated map from an attribute dotted-name (lab.hemoglobin) to a terminology code. Read by pathway-service attribute resolvers; cached in-memory.';

INSERT INTO pathway_attribute_code_map (attribute_name, namespace, system, code, value_type) VALUES
  ('lab.hemoglobin',        'lab',     'LOINC',  '718-7',   'number'),
  ('lab.ferritin',          'lab',     'LOINC',  '2276-4',  'number'),
  ('lab.rh_factor',         'lab',     'LOINC',  '10331-7', 'string'),
  ('allergy.metronidazole', 'allergy', 'RXNORM', '6922',    'boolean');

COMMIT;
