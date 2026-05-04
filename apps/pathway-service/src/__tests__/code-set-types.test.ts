import {
  PathwayMetadata,
  CodeSetDefinition,
  CodeSetMemberDefinition,
  CodeSetScope,
  VALID_CODE_SET_SCOPES,
  PathwayCodeSetRow,
  PathwayCodeSetMemberRow,
} from '../services/import/types';

describe('Phase 1b code-set types', () => {
  describe('VALID_CODE_SET_SCOPES', () => {
    it('contains exactly the three scope values defined in migration 047', () => {
      expect(VALID_CODE_SET_SCOPES).toEqual([
        'EXACT',
        'EXACT_AND_DESCENDANTS',
        'DESCENDANTS_OK',
      ]);
    });
  });

  describe('CodeSetDefinition shape', () => {
    it('accepts a minimal single-member set', () => {
      const def: CodeSetDefinition = {
        required_codes: [{ code: 'I10', system: 'ICD-10' }],
      };
      expect(def.required_codes).toHaveLength(1);
      expect(def.scope).toBeUndefined();
      expect(def.entry_node_id).toBeUndefined();
    });

    it('accepts a multi-member conjunction set with full metadata', () => {
      const def: CodeSetDefinition = {
        description: 'T2DM with hypertension',
        scope: 'EXACT',
        entry_node_id: 'stage-1-comorbid',
        required_codes: [
          { code: 'E11', system: 'ICD-10', description: 'Type 2 diabetes' },
          { code: 'I10', system: 'ICD-10', description: 'Hypertension' },
        ],
      };
      expect(def.required_codes).toHaveLength(2);
      expect(def.scope).toBe('EXACT');
      expect(def.entry_node_id).toBe('stage-1-comorbid');
    });

    it('accepts cross-system members in one set', () => {
      const def: CodeSetDefinition = {
        description: 'On warfarin AND has AF',
        required_codes: [
          { code: 'I48.91', system: 'ICD-10' },
          { code: '11289', system: 'RXNORM' },
        ],
      };
      expect(def.required_codes.map((m) => m.system)).toEqual(['ICD-10', 'RXNORM']);
    });

    it('accepts per-member scope override', () => {
      const member: CodeSetMemberDefinition = {
        code: 'E11',
        system: 'ICD-10',
        scope_override: 'EXACT_AND_DESCENDANTS',
      };
      expect(member.scope_override).toBe('EXACT_AND_DESCENDANTS');
    });
  });

  describe('PathwayMetadata extension', () => {
    it('still accepts metadata without code_sets (legacy)', () => {
      const meta: PathwayMetadata = {
        logical_id: 'test',
        title: 'Test',
        version: '1.0',
        category: 'CHRONIC_DISEASE',
        condition_codes: [{ code: 'E11', system: 'ICD-10' }],
      };
      expect(meta.code_sets).toBeUndefined();
    });

    it('accepts metadata with both condition_codes and code_sets', () => {
      const meta: PathwayMetadata = {
        logical_id: 'test',
        title: 'Test',
        version: '1.0',
        category: 'CHRONIC_DISEASE',
        condition_codes: [
          { code: 'E11', system: 'ICD-10' },
          { code: 'I10', system: 'ICD-10' },
        ],
        code_sets: [
          {
            description: 'Combined',
            required_codes: [
              { code: 'E11', system: 'ICD-10' },
              { code: 'I10', system: 'ICD-10' },
            ],
          },
        ],
      };
      expect(meta.code_sets).toHaveLength(1);
      expect(meta.code_sets![0].required_codes).toHaveLength(2);
    });
  });

  describe('DB row types', () => {
    it('PathwayCodeSetRow has the columns from migration 047', () => {
      const row: PathwayCodeSetRow = {
        id: '00000000-0000-4000-a000-000000000001',
        pathway_id: '00000000-0000-4000-a000-000000000002',
        scope: 'EXACT',
        semantics: 'ALL_OF',
        entry_node_id: null,
        description: 'Migrated',
        created_at: new Date(),
        updated_at: new Date(),
      };
      expect(row.semantics).toBe('ALL_OF');
    });

    it('PathwayCodeSetMemberRow has the columns from migration 047', () => {
      const row: PathwayCodeSetMemberRow = {
        id: '00000000-0000-4000-a000-000000000003',
        code_set_id: '00000000-0000-4000-a000-000000000001',
        code: 'E11',
        system: 'ICD-10',
        scope_override: null,
        description: null,
      };
      expect(row.code).toBe('E11');
    });

    it('CodeSetScope is the same union across JSON and DB shapes', () => {
      // Compile-time check: this assignment validates the type is shared.
      const fromJson: CodeSetScope = 'EXACT';
      const fromDbRow: PathwayCodeSetRow['scope'] = fromJson;
      expect(fromDbRow).toBe('EXACT');
    });
  });
});
