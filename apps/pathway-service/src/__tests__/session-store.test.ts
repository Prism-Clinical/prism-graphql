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

describe('getMatchedPathways — ontology-aware matching', () => {
  it('issues a query that expands patient codes via icd10_codes ltree path', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;

    await getMatchedPathways(pool, 'patient-1');

    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = pool.query.mock.calls[0][0];

    // The expanded_codes CTE walks from patient codes to ancestors via icd10_codes.path.
    expect(sql).toContain('expanded_codes');
    expect(sql).toContain('icd10_codes leaf');
    expect(sql).toContain('icd10_codes ancestor');
    expect(sql).toContain('leaf.path <@ ancestor.path');

    // Match still goes through expanded_codes, not raw patient_codes.
    expect(sql).toContain('JOIN expanded_codes ON expanded_codes.code = pc.code');

    expect(pool.query.mock.calls[0][1]).toEqual(['patient-1']);
  });

  it('filters snapshot_conditions to active rows via the active-condition predicate', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;

    await getMatchedPathways(pool, 'patient-1');

    const sql = pool.query.mock.calls[0][0];

    // The patient_codes CTE must drop abated and resolved conditions before they
    // drive matching. The shared predicate covers both checks.
    expect(sql).toContain('sc.abatement_date_time IS NULL');
    expect(sql).toContain("c->>'code' IN ('active', 'recurrence', 'relapse')");
  });

  it('maps result rows into MatchedPathway shape including matchScore', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'p1',
            logical_id: 'lp-1',
            title: 'Diabetes Pathway',
            version: '1.0',
            category: 'CHRONIC_DISEASE',
            status: 'ACTIVE',
            condition_codes: ['E11', 'E11.65'],
            matched_codes: ['E11'],
            total_codes: 2,
          },
        ],
      }),
    } as any;

    const result = await getMatchedPathways(pool, 'patient-1');

    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe('p1');
    expect(result[0].matchedConditionCodes).toEqual(['E11']);
    expect(result[0].matchScore).toBe(0.5);
  });

  it('returns empty array when no pathways match', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;

    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result).toEqual([]);
  });

  it('handles null matched_codes defensively without crashing', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'p1',
            logical_id: 'lp-1',
            title: 'P',
            version: '1.0',
            category: 'CHRONIC_DISEASE',
            status: 'ACTIVE',
            condition_codes: ['E11'],
            matched_codes: null,
            total_codes: 1,
          },
        ],
      }),
    } as any;

    const result = await getMatchedPathways(pool, 'patient-1');
    expect(result[0].matchedConditionCodes).toEqual([]);
    expect(result[0].matchScore).toBe(0);
  });
});
