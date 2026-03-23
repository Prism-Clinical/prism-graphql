BEGIN;

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000001'
  WHERE name = 'data_completeness' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000002'
  WHERE name = 'evidence_strength' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000003'
  WHERE name = 'match_quality' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET id = '00000000-0000-4000-a000-000000000004'
  WHERE name = 'risk_magnitude' AND scope = 'SYSTEM';

COMMIT;
