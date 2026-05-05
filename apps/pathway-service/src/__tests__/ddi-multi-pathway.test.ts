/**
 * Phase 4 commit 5 — multi-pathway DDI orchestration tests.
 *
 * Drives findings into the resolver via the mocked DDI module and verifies:
 *   - Pre-merge per-plan suppressions land in mergedPlan.suppressed
 *     and the suppressed med drops from medications
 *   - Pre-merge warnings accumulate on session.ddiWarnings
 *   - Post-merge cross-recommendation suppressions also drop + accumulate
 *   - Mixed allergy/drug-drug findings populate the right SuppressionSource
 *   - DDI integrates cleanly with the existing conflict + dedup flow
 */

jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
  createSession: jest.fn(),
}));

jest.mock('../services/resolution/lattice-collapse', () => ({
  collapseLattice: jest.fn(),
}));

jest.mock('../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn(),
  makeTraversalAdapter: jest.fn(() => ({})),
}));

jest.mock('../services/resolution/traversal-engine', () => ({
  TraversalEngine: jest.fn().mockImplementation(() => ({ traverse: jest.fn() })),
}));

jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn(),
  getMultiPathwaySession: jest.fn(),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
}));

jest.mock('../services/medications/ddi-pass', () => ({
  runPatientContextDdi: jest.fn(),
  runCrossRecommendationDdi: jest.fn(),
}));

import {
  multiPathwayResolutionMutations,
} from '../resolvers/mutations/multi-pathway-resolution';
import { getMatchedPathways } from '../services/resolution/session-store';
import { collapseLattice } from '../services/resolution/lattice-collapse';
import { buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import {
  createMultiPathwaySession,
  getMultiPathwaySession,
} from '../services/resolution/multi-pathway-session-store';
import {
  runPatientContextDdi,
  runCrossRecommendationDdi,
} from '../services/medications/ddi-pass';
import { NodeStatus } from '../services/resolution/types';

// ── Helpers ─────────────────────────────────────────────────────────

function fakeContext() {
  return {
    pool: {} as unknown,
    redis: {},
    userId: 'provider-1',
    userRole: 'PROVIDER',
  } as never;
}

function fakeMatched(id: string, title = `P-${id}`) {
  return {
    pathway: {
      id, logicalId: `lp-${id}`, title, version: '1.0',
      category: 'CHRONIC_DISEASE', status: 'ACTIVE', conditionCodes: ['I10'],
    },
    matched: true,
    matchedSets: [],
    mostSpecificMatchedSet: { setId: `s-${id}`, scope: 'EXACT', members: [], memberCount: 0 } as never,
    specificityDepth: 1,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
    matchScore: 1,
    matchedConditionCodes: [],
  };
}

function fakeRctx(allNodesLength = 3) {
  return {
    graphContext: { allNodes: new Array(allNodesLength).fill({}) },
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.5 },
  };
}

function makeResolutionStateWith(meds: Array<{ id: string; name: string }>) {
  const state = new Map();
  for (const m of meds) {
    state.set(m.id, {
      nodeId: m.id, nodeType: 'Medication', title: m.name,
      status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 1,
      properties: { name: m.name, role: 'first_line' },
    });
  }
  return state;
}

function setupTraverseSeq(states: Array<Map<string, unknown>>) {
  let idx = 0;
  (TraversalEngine as unknown as jest.Mock).mockImplementation(() => ({
    traverse: jest.fn().mockImplementation(() => {
      const s = states[Math.min(idx, states.length - 1)];
      idx++;
      return Promise.resolve({
        resolutionState: s,
        dependencyMap: { influencedBy: new Map(), influences: new Map(), gateContextFields: new Map(), scorerInputs: new Map() },
        pendingQuestions: [], redFlags: [],
        totalNodesEvaluated: s.size, traversalDurationMs: 1, isDegraded: false,
      });
    }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no DDI hits.
  (runPatientContextDdi as jest.Mock).mockResolvedValue({
    findings: [], suppressedRecommendationIds: new Set(),
  });
  (runCrossRecommendationDdi as jest.Mock).mockResolvedValue({
    findings: [], suppressedRecommendationIds: new Set(),
  });
});

// ── Pre-merge per-plan DDI ──────────────────────────────────────────

describe('startMultiPathwayResolution — pre-merge per-plan DDI', () => {
  it('drops a medication suppressed by patient med and adds it to merged.suppressed', async () => {
    const a = fakeMatched('a');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a]);
    (collapseLattice as jest.Mock).mockResolvedValue([a]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    setupTraverseSeq([makeResolutionStateWith([{ id: 'med-a-1', name: 'Amiodarone' }])]);

    (runPatientContextDdi as jest.Mock).mockResolvedValue({
      findings: [{
        recommendationId: 'med-a-1',
        drugName: 'Amiodarone',
        action: 'SUPPRESS',
        severity: 'SEVERE',
        category: 'DDI_SEVERE',
        mechanism: 'CYP2C9',
        clinicalAdvice: 'Reduce dose',
        source: { kind: 'PATIENT_MEDICATION', rxcui: '11289', name: 'warfarin' },
      }],
      suppressedRecommendationIds: new Set(['med-a-1']),
    });

    let createdPlan: { medications: unknown[]; suppressed: unknown[] } | undefined;
    (createMultiPathwaySession as jest.Mock).mockImplementation(async (_pool, args) => {
      createdPlan = args.mergedPlan;
      return 'mp-1';
    });
    (getMultiPathwaySession as jest.Mock).mockImplementation(async () => ({
      id: 'mp-1', patientId: 'pat-1', providerId: 'provider-1', status: 'ACTIVE',
      initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: ['a'],
      mergedPlan: createdPlan, conflictResolutions: {}, carePlanId: null,
      ddiWarnings: [], createdAt: new Date(), updatedAt: new Date(),
    }));

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );

    expect(createdPlan?.medications).toEqual([]);
    expect(createdPlan?.suppressed).toHaveLength(1);
    const suppressed = createdPlan?.suppressed[0] as Record<string, unknown>;
    expect(suppressed.reason).toBe('ddi_severe');
    expect((suppressed.source as { kind: string }).kind).toBe('PATIENT_MEDICATION');
  });

  it('accumulates MODERATE pre-merge findings as ddiWarnings on the session', async () => {
    const a = fakeMatched('a');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a]);
    (collapseLattice as jest.Mock).mockResolvedValue([a]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    setupTraverseSeq([makeResolutionStateWith([{ id: 'med-a-1', name: 'Drug1' }])]);

    (runPatientContextDdi as jest.Mock).mockResolvedValue({
      findings: [{
        recommendationId: 'med-a-1', drugName: 'Drug1', action: 'WARN',
        severity: 'MODERATE', category: 'DDI_MODERATE',
        mechanism: 'minor enzyme effect', clinicalAdvice: 'monitor',
        source: { kind: 'PATIENT_MEDICATION', rxcui: 'rx', name: 'Other' },
      }],
      suppressedRecommendationIds: new Set(),
    });

    let capturedWarnings: unknown[] | undefined;
    (createMultiPathwaySession as jest.Mock).mockImplementation(async (_pool, args) => {
      capturedWarnings = args.ddiWarnings;
      return 'mp-1';
    });
    (getMultiPathwaySession as jest.Mock).mockImplementation(async () => ({
      id: 'mp-1', patientId: 'pat-1', providerId: 'provider-1', status: 'ACTIVE',
      initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: ['a'],
      mergedPlan: { sourcePathwayIds: [], medications: [], labs: [], procedures: [], schedules: [], qualityMetrics: [], suppressed: [], conflicts: [] },
      conflictResolutions: {}, carePlanId: null,
      ddiWarnings: capturedWarnings ?? [],
      createdAt: new Date(), updatedAt: new Date(),
    }));

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );

    expect(capturedWarnings).toHaveLength(1);
    expect((capturedWarnings![0] as { category: string }).category).toBe('DDI_MODERATE');
  });

  it('preserves allergy-source SuppressionSource on suppression entry', async () => {
    const a = fakeMatched('a');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a]);
    (collapseLattice as jest.Mock).mockResolvedValue([a]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    setupTraverseSeq([makeResolutionStateWith([{ id: 'med-a-1', name: 'Amoxicillin' }])]);

    (runPatientContextDdi as jest.Mock).mockResolvedValue({
      findings: [{
        recommendationId: 'med-a-1', drugName: 'Amoxicillin',
        action: 'SUPPRESS', severity: 'SEVERE', category: 'ALLERGY',
        mechanism: null, clinicalAdvice: 'class match: J01CA04 vs J01C',
        source: { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Penicillin allergy' },
      }],
      suppressedRecommendationIds: new Set(['med-a-1']),
    });

    let createdPlan: { suppressed: unknown[] } | undefined;
    (createMultiPathwaySession as jest.Mock).mockImplementation(async (_pool, args) => {
      createdPlan = args.mergedPlan;
      return 'mp-1';
    });
    (getMultiPathwaySession as jest.Mock).mockImplementation(async () => ({
      id: 'mp-1', patientId: 'pat-1', providerId: 'provider-1', status: 'ACTIVE',
      initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: ['a'],
      mergedPlan: createdPlan, conflictResolutions: {}, carePlanId: null,
      ddiWarnings: [], createdAt: new Date(), updatedAt: new Date(),
    }));

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );

    const sup = createdPlan!.suppressed[0] as { reason: string; source: Record<string, unknown> };
    expect(sup.reason).toBe('allergy');
    expect(sup.source.kind).toBe('PATIENT_ALLERGY');
    expect(sup.source.snomedCode).toBe('91936005');
  });
});

// ── Post-merge cross-recommendation DDI ─────────────────────────────

describe('startMultiPathwayResolution — post-merge cross-recommendation DDI', () => {
  it('drops cross-recommendation suppressed meds from medications and adds OTHER_RECOMMENDATION suppression', async () => {
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    setupTraverseSeq([
      makeResolutionStateWith([{ id: 'med-a-1', name: 'Amiodarone' }]),
      makeResolutionStateWith([{ id: 'med-b-1', name: 'Warfarin' }]),
    ]);

    (runCrossRecommendationDdi as jest.Mock).mockResolvedValue({
      findings: [
        {
          recommendationId: 'med-a-1', drugName: 'Amiodarone',
          action: 'SUPPRESS', severity: 'SEVERE', category: 'DDI_SEVERE',
          mechanism: 'CYP2C9', clinicalAdvice: null,
          source: { kind: 'OTHER_RECOMMENDATION', recommendationId: 'med-b-1', drugName: 'Warfarin' },
        },
      ],
      suppressedRecommendationIds: new Set(['med-a-1']),
    });

    let createdPlan: { medications: unknown[]; suppressed: unknown[] } | undefined;
    (createMultiPathwaySession as jest.Mock).mockImplementation(async (_pool, args) => {
      createdPlan = args.mergedPlan;
      return 'mp-1';
    });
    (getMultiPathwaySession as jest.Mock).mockImplementation(async () => ({
      id: 'mp-1', patientId: 'pat-1', providerId: 'provider-1', status: 'ACTIVE',
      initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: ['a', 'b'],
      mergedPlan: createdPlan, conflictResolutions: {}, carePlanId: null,
      ddiWarnings: [], createdAt: new Date(), updatedAt: new Date(),
    }));

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );

    // amiodarone dropped; warfarin remains
    expect(createdPlan?.medications).toHaveLength(1);
    const remaining = createdPlan!.medications[0] as { recommendation: { name: string } };
    expect(remaining.recommendation.name).toBe('Warfarin');
    // Suppression source is OTHER_RECOMMENDATION
    const sup = createdPlan!.suppressed[0] as { source: Record<string, unknown> };
    expect(sup.source.kind).toBe('OTHER_RECOMMENDATION');
  });
});
