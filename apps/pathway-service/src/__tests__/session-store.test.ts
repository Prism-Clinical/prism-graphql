import {
  serializeResolutionState,
  deserializeResolutionState,
  serializeDependencyMap,
  deserializeDependencyMap,
  getMatchedPathways,
} from '../services/resolution/session-store';
import { NodeStatus, NodeResult, createEmptyDependencyMap } from '../services/resolution/types';

describe('SessionStore serialization', () => {
  it('should round-trip ResolutionState through JSON', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Med',
          status: NodeStatus.INCLUDED,
          confidence: 0.85,
          confidenceBreakdown: [],
          depth: 2,
        },
      ],
    ]);
    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json)); // simulate DB round-trip
    const restored = deserializeResolutionState(parsed);
    expect(restored.get('node-1')?.status).toBe(NodeStatus.INCLUDED);
    expect(restored.get('node-1')?.confidence).toBe(0.85);
  });

  it('should round-trip DependencyMap through JSON', () => {
    const depMap = createEmptyDependencyMap();
    depMap.influences.set('a', new Set(['b', 'c']));
    depMap.influencedBy.set('b', new Set(['a']));
    depMap.gateContextFields.set('gate-1', new Set(['conditions']));
    depMap.scorerInputs.set('med-1', new Set(['medications', 'allergies']));

    const json = serializeDependencyMap(depMap);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeDependencyMap(parsed);

    expect(restored.influences.get('a')?.has('b')).toBe(true);
    expect(restored.influences.get('a')?.has('c')).toBe(true);
    expect(restored.influencedBy.get('b')?.has('a')).toBe(true);
    expect(restored.gateContextFields.get('gate-1')?.has('conditions')).toBe(true);
    expect(restored.scorerInputs.get('med-1')?.has('medications')).toBe(true);
  });

  it('should handle empty state', () => {
    const state = new Map<string, NodeResult>();
    const json = serializeResolutionState(state);
    const restored = deserializeResolutionState(JSON.parse(JSON.stringify(json)));
    expect(restored.size).toBe(0);
  });

  it('should handle empty dependency map', () => {
    const depMap = createEmptyDependencyMap();
    const json = serializeDependencyMap(depMap);
    const restored = deserializeDependencyMap(JSON.parse(JSON.stringify(json)));
    expect(restored.influences.size).toBe(0);
    expect(restored.influencedBy.size).toBe(0);
    expect(restored.gateContextFields.size).toBe(0);
    expect(restored.scorerInputs.size).toBe(0);
  });

  it('should preserve multiple nodes in ResolutionState', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Aspirin',
          status: NodeStatus.INCLUDED,
          confidence: 0.9,
          confidenceBreakdown: [],
          depth: 1,
        },
      ],
      [
        'node-2',
        {
          nodeId: 'node-2',
          nodeType: 'LabTest',
          title: 'CBC',
          status: NodeStatus.EXCLUDED,
          confidence: 0.3,
          confidenceBreakdown: [],
          excludeReason: 'Not indicated',
          depth: 2,
        },
      ],
      [
        'node-3',
        {
          nodeId: 'node-3',
          nodeType: 'Procedure',
          title: 'Biopsy',
          status: NodeStatus.PENDING_QUESTION,
          confidence: 0.5,
          confidenceBreakdown: [],
          depth: 2,
        },
      ],
    ]);

    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeResolutionState(parsed);

    expect(restored.size).toBe(3);
    expect(restored.get('node-2')?.excludeReason).toBe('Not indicated');
    expect(restored.get('node-3')?.status).toBe(NodeStatus.PENDING_QUESTION);
  });

  it('should preserve provider override in NodeResult', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Statins',
          status: NodeStatus.INCLUDED,
          confidence: 0.4,
          confidenceBreakdown: [],
          depth: 1,
          providerOverride: {
            action: 'include' as any,
            reason: 'Clinical judgment',
            originalStatus: NodeStatus.EXCLUDED,
            originalConfidence: 0.4,
          },
        },
      ],
    ]);

    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeResolutionState(parsed);

    const node = restored.get('node-1')!;
    expect(node.providerOverride).toBeDefined();
    expect(node.providerOverride!.reason).toBe('Clinical judgment');
    expect(node.providerOverride!.originalConfidence).toBe(0.4);
  });
});

describe('getMatchedPathways — Phase 1b set-based matching', () => {
  // Helper: build a mock pool that responds to the three queries in
  // getMatchedPathways' sequence: matched-pathways, patient-codes, set-members.
  function buildPool(opts: {
    matched: any[];
    patientCodes?: { code: string; system: string }[];
    setsWithMembers?: any[];
  }) {
    const calls: string[] = [];
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes('matched_set_ids') && sql.includes('ARRAY_AGG')) {
        return { rows: opts.matched };
      }
      // Patient literal codes query (just snapshot_conditions, no expanded_codes CTE)
      if (sql.includes('snapshot_conditions') && !sql.includes('matched_set_ids')) {
        return { rows: opts.patientCodes ?? [] };
      }
      if (sql.includes('pathway_code_sets') && sql.includes('jsonb_agg')) {
        return { rows: opts.setsWithMembers ?? [] };
      }
      // findAncestors (helper from icd10-hierarchy)
      if (sql.includes('icd10_codes ancestor')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    return { query, calls };
  }

  it('issues set-containment SQL with active-condition predicate + ICD-10 ancestor expansion', async () => {
    const pool = buildPool({ matched: [] }) as any;

    await getMatchedPathways(pool, 'patient-1');

    const sql = pool.calls[0];
    // Phase 1.5 active-condition filter still applied
    expect(sql).toContain('sc.abatement_date_time IS NULL');
    expect(sql).toContain("c->>'code' IN ('active', 'recurrence', 'relapse')");
    // Phase 1a ancestor expansion still applied
    expect(sql).toContain('expanded_codes');
    expect(sql).toContain('leaf.path <@ ancestor.path');
    // Phase 1b set-containment via NOT EXISTS / NOT EXISTS
    expect(sql).toContain('matched_set_ids');
    expect(sql).toContain('pathway_code_sets cs');
    expect(sql).toContain('NOT EXISTS');
  });

  it('returns empty array when no pathways match', async () => {
    const pool = buildPool({ matched: [] }) as any;
    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result).toEqual([]);
  });

  it('composes a MatchedPathway with all Phase 1b structured fields', async () => {
    const pool = buildPool({
      matched: [
        {
          id: 'p1',
          logical_id: 'lp-1',
          title: 'Diabetes Pathway',
          version: '1.0',
          category: 'CHRONIC_DISEASE',
          status: 'ACTIVE',
          condition_codes: ['E11'],
          matched_set_ids: ['set-1'],
        },
      ],
      patientCodes: [{ code: 'E11', system: 'ICD-10' }],
      setsWithMembers: [
        {
          id: 'set-1',
          description: 'Type 2 diabetes',
          scope: 'EXACT',
          entry_node_id: null,
          members: [{ code: 'E11', system: 'ICD-10' }],
        },
      ],
    }) as any;

    const result = await getMatchedPathways(pool, 'patient-1');

    expect(result).toHaveLength(1);
    const mp = result[0];
    expect(mp.matched).toBe(true);
    expect(mp.specificityDepth).toBe(1);
    expect(mp.mostSpecificMatchedSet.setId).toBe('set-1');
    expect(mp.mostSpecificMatchedSet.members).toEqual([{ code: 'E11', system: 'ICD-10' }]);
    expect(mp.patientCodesAddressed).toEqual(['E11']);
    expect(mp.patientCodesUnaddressed).toEqual([]);
    expect(mp.matchScore).toBe(1);
    expect(mp.matchedConditionCodes).toEqual(['E11']);
  });

  it('picks the largest matched set as mostSpecific and uses its size for specificityDepth', async () => {
    const pool = buildPool({
      matched: [
        {
          id: 'p1',
          logical_id: 'lp',
          title: 'P',
          version: '1.0',
          category: 'CHRONIC_DISEASE',
          status: 'ACTIVE',
          condition_codes: ['E11', 'I10'],
          matched_set_ids: ['set-broad', 'set-specific'],
        },
      ],
      patientCodes: [
        { code: 'E11', system: 'ICD-10' },
        { code: 'I10', system: 'ICD-10' },
      ],
      setsWithMembers: [
        {
          id: 'set-broad',
          description: 'T2DM only',
          scope: 'EXACT',
          entry_node_id: null,
          members: [{ code: 'E11', system: 'ICD-10' }],
        },
        {
          id: 'set-specific',
          description: 'T2DM + HTN',
          scope: 'EXACT',
          entry_node_id: 'stage-1-comorbid',
          members: [
            { code: 'E11', system: 'ICD-10' },
            { code: 'I10', system: 'ICD-10' },
          ],
        },
      ],
    }) as any;

    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result[0].specificityDepth).toBe(2);
    expect(result[0].mostSpecificMatchedSet.setId).toBe('set-specific');
    expect(result[0].matchedSets).toHaveLength(2);
  });

  it('coverage score is fraction of literal codes in mostSpecific set territory', async () => {
    const pool = buildPool({
      matched: [
        {
          id: 'p1',
          logical_id: 'lp',
          title: 'P',
          version: '1.0',
          category: 'CHRONIC_DISEASE',
          status: 'ACTIVE',
          condition_codes: ['E11'],
          matched_set_ids: ['set-1'],
        },
      ],
      // Patient has E11 + F32.9 (depression). Pathway only addresses E11.
      patientCodes: [
        { code: 'E11', system: 'ICD-10' },
        { code: 'F32.9', system: 'ICD-10' },
      ],
      setsWithMembers: [
        {
          id: 'set-1',
          description: 'T2DM',
          scope: 'EXACT',
          entry_node_id: null,
          members: [{ code: 'E11', system: 'ICD-10' }],
        },
      ],
    }) as any;

    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result[0].patientCodesAddressed).toEqual(['E11']);
    expect(result[0].patientCodesUnaddressed).toEqual(['F32.9']);
    expect(result[0].matchScore).toBe(0.5);
  });

  it('skips a matched-pathway row whose matched_set_ids reference no fetched sets', async () => {
    // Defensive: if the second-pass set fetch comes back empty, the pathway
    // can't be composed and should be skipped rather than crash.
    const pool = buildPool({
      matched: [
        {
          id: 'p1',
          logical_id: 'lp',
          title: 'P',
          version: '1.0',
          category: 'CHRONIC_DISEASE',
          status: 'ACTIVE',
          condition_codes: ['E11'],
          matched_set_ids: ['set-missing'],
        },
      ],
      patientCodes: [{ code: 'E11', system: 'ICD-10' }],
      setsWithMembers: [], // set-missing not returned
    }) as any;

    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result).toEqual([]);
  });
});
