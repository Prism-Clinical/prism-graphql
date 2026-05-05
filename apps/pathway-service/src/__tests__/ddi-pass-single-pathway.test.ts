/**
 * Phase 4 commit 4 — single-pathway DDI orchestration tests.
 *
 * The engine + normalizer have their own unit tests. These tests focus on
 * the orchestration: which Medication nodes get suppressed, what excludeReason
 * lands on them, what warnings come back to the resolver.
 */

jest.mock('../services/medications/normalizer', () => ({
  lookupNormalizedMedication: jest.fn(),
}));
jest.mock('../services/medications/ddi-engine', () => ({
  checkDrugDrugInteraction: jest.fn(),
  // Phase-4 review fix #7: allergy lookup is now split into a fetch + a sync
  // matcher so the patient's mappings are resolved once per pass instead of
  // once per candidate.
  fetchAllergyMappings: jest.fn(),
  matchDrugAllergyAgainstMappings: jest.fn(),
  moreSevere: jest.fn(),
}));

import {
  applyDdiToResolutionState,
} from '../services/medications/ddi-pass-single-pathway';
import { lookupNormalizedMedication } from '../services/medications/normalizer';
import {
  checkDrugDrugInteraction,
  fetchAllergyMappings,
  matchDrugAllergyAgainstMappings,
} from '../services/medications/ddi-engine';
import { NodeStatus } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────

function makeNode(partial: { id: string; type: string; props?: Record<string, unknown>; status?: NodeStatus }) {
  return {
    nodeId: partial.id,
    nodeType: partial.type,
    title: (partial.props?.name as string) ?? partial.id,
    status: partial.status ?? NodeStatus.INCLUDED,
    confidence: 1,
    confidenceBreakdown: [],
    depth: 1,
    properties: partial.props,
  };
}

function makeState(nodes: ReturnType<typeof makeNode>[]) {
  const m = new Map();
  for (const n of nodes) m.set(n.nodeId, n);
  return m;
}

const fakePool = {} as never;
const emptyContext = { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] };

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('applyDdiToResolutionState — empty / no-op cases', () => {
  it('does nothing when state has no Medication nodes', async () => {
    const state = makeState([
      makeNode({ id: 'stage', type: 'Stage' }),
      makeNode({ id: 'lab', type: 'LabTest', props: { name: 'A1c' } }),
    ]);
    const result = await applyDdiToResolutionState(fakePool, state, emptyContext);
    expect(result.findings).toEqual([]);
    expect(result.suppressedNodeCount).toBe(0);
  });

  it('skips Medication nodes that are not INCLUDED', async () => {
    const state = makeState([
      makeNode({
        id: 'med-1', type: 'Medication',
        status: NodeStatus.EXCLUDED,
        props: { name: 'X', role: 'first_line' },
      }),
    ]);
    const result = await applyDdiToResolutionState(fakePool, state, emptyContext);
    expect(result.suppressedNodeCount).toBe(0);
    expect(lookupNormalizedMedication).not.toHaveBeenCalled();
  });

  it('skips drugs that fail to normalize (admin queue handles them)', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'MysteryDrug', role: 'first_line' } }),
    ]);
    (lookupNormalizedMedication as jest.Mock).mockResolvedValue(null);

    const result = await applyDdiToResolutionState(fakePool, state, emptyContext);
    expect(result.suppressedNodeCount).toBe(0);
    expect(checkDrugDrugInteraction).not.toHaveBeenCalled();
    expect(matchDrugAllergyAgainstMappings).not.toHaveBeenCalled();
  });
});

describe('applyDdiToResolutionState — drug↔drug suppression', () => {
  it('SEVERE drug↔drug → suppress + EXCLUDED + DDI excludeReason', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Amiodarone', role: 'first_line' } }),
    ]);
    const ctx = {
      ...emptyContext,
      medications: [{ code: '11289', system: 'RxNorm', display: 'Warfarin' }],
    };

    (lookupNormalizedMedication as jest.Mock).mockImplementation(async (_pool, input) => {
      if (input.text.toLowerCase() === 'amiodarone') {
        return { ingredientRxcui: '703', ingredientName: 'amiodarone', atcClasses: ['C01BD01'] };
      }
      if (input.code === '11289') {
        return { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] };
      }
      return null;
    });
    (checkDrugDrugInteraction as jest.Mock).mockResolvedValue({
      severity: 'SEVERE',
      mechanism: 'CYP2C9 inhibition',
      clinicalAdvice: 'Reduce dose',
      matchType: 'PAIR',
      matchedClasses: null,
    });
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    expect(result.suppressedNodeCount).toBe(1);
    const node = state.get('med-1');
    expect(node.status).toBe(NodeStatus.EXCLUDED);
    expect(node.excludeReason).toMatch(/DDI_SEVERE/);
    expect(node.excludeReason).toMatch(/warfarin/);
    expect(result.findings[0].action).toBe('SUPPRESS');
    expect(result.findings[0].category).toBe('DDI_SEVERE');
  });

  it('MODERATE drug↔drug → warning, NOT a suppression', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Drug1' } }),
    ]);
    const ctx = { ...emptyContext, medications: [{ code: 'rx2', system: 'RxNorm', display: 'Drug2' }] };

    (lookupNormalizedMedication as jest.Mock).mockImplementation(async (_pool, input) => ({
      ingredientRxcui: input.code ?? input.text,
      ingredientName: input.text,
      atcClasses: [],
    }));
    (checkDrugDrugInteraction as jest.Mock).mockResolvedValue({
      severity: 'MODERATE',
      mechanism: 'minor enzyme effect',
      clinicalAdvice: 'monitor',
      matchType: 'PAIR',
      matchedClasses: null,
    });
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    expect(result.suppressedNodeCount).toBe(0);
    expect(state.get('med-1').status).toBe(NodeStatus.INCLUDED);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].action).toBe('WARN');
  });

  it('MINOR severity is dropped (not surfaced)', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Drug1' } }),
    ]);
    const ctx = { ...emptyContext, medications: [{ code: 'rx2', system: 'RxNorm', display: 'Drug2' }] };

    (lookupNormalizedMedication as jest.Mock).mockImplementation(async (_pool, input) => ({
      ingredientRxcui: input.code ?? input.text,
      ingredientName: input.text,
      atcClasses: [],
    }));
    (checkDrugDrugInteraction as jest.Mock).mockResolvedValue({
      severity: 'MINOR',
      mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null,
    });
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    expect(result.findings).toEqual([]);
  });
});

describe('applyDdiToResolutionState — allergy suppression', () => {
  it('allergy match → suppress + ALLERGY excludeReason', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Amoxicillin' } }),
    ]);
    const ctx = { ...emptyContext, allergies: [{ code: '91936005', system: 'SNOMED', display: 'Penicillin allergy' }] };

    (lookupNormalizedMedication as jest.Mock).mockResolvedValue({
      ingredientRxcui: '723',
      ingredientName: 'amoxicillin',
      atcClasses: ['J01CA04'],
    });
    (checkDrugDrugInteraction as jest.Mock).mockResolvedValue(null);
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([
      { snomedCode: '91936005', snomedDisplay: 'Penicillin allergy', atcClass: 'J01C' },
    ]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([{
      severity: 'SEVERE',
      snomedCode: '91936005',
      snomedDisplay: 'Penicillin allergy',
      allergyAtcClass: 'J01C',
      matchedDrugAtcClass: 'J01CA04',
    }]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    expect(result.suppressedNodeCount).toBe(1);
    const node = state.get('med-1');
    expect(node.status).toBe(NodeStatus.EXCLUDED);
    expect(node.excludeReason).toMatch(/ALLERGY/);
    expect(node.excludeReason).toMatch(/Penicillin/);
  });

  it('allergy takes precedence over drug-drug findings in excludeReason ranking', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Drug' } }),
    ]);
    const ctx = {
      ...emptyContext,
      medications: [{ code: 'rx2', system: 'RxNorm', display: 'Other' }],
      allergies: [{ code: '91936005', system: 'SNOMED', display: 'Penicillin allergy' }],
    };

    (lookupNormalizedMedication as jest.Mock).mockResolvedValue({
      ingredientRxcui: 'r', ingredientName: 'drug', atcClasses: ['J01CA04'],
    });
    (checkDrugDrugInteraction as jest.Mock).mockResolvedValue({
      severity: 'SEVERE', mechanism: 'CYP2C9', clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null,
    });
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([
      { snomedCode: '91936005', snomedDisplay: 'Penicillin allergy', atcClass: 'J01C' },
    ]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([{
      severity: 'SEVERE', snomedCode: '91936005', snomedDisplay: 'Penicillin allergy',
      allergyAtcClass: 'J01C', matchedDrugAtcClass: 'J01CA04',
    }]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    // Both findings present, but excludeReason picks ALLERGY (Decision 5: allergy is the most clinically actionable)
    expect(state.get('med-1').excludeReason).toMatch(/ALLERGY/);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('applyDdiToResolutionState — multi-medication scenarios', () => {
  it('processes multiple Medication nodes independently', async () => {
    const state = makeState([
      makeNode({ id: 'med-1', type: 'Medication', props: { name: 'Drug1' } }),
      makeNode({ id: 'med-2', type: 'Medication', props: { name: 'Drug2' } }),
    ]);
    const ctx = { ...emptyContext, medications: [{ code: 'rx', system: 'RxNorm', display: 'Other' }] };

    (lookupNormalizedMedication as jest.Mock).mockImplementation(async (_pool, input) => ({
      ingredientRxcui: input.code ?? input.text,
      ingredientName: input.text,
      atcClasses: [],
    }));
    (checkDrugDrugInteraction as jest.Mock).mockImplementation(async (_pool, drugA) => {
      // Only drug1 has a SEVERE interaction
      if (drugA.rxcui === 'Drug1') {
        return { severity: 'SEVERE', mechanism: null, clinicalAdvice: null, matchType: 'PAIR', matchedClasses: null };
      }
      return null;
    });
    (fetchAllergyMappings as jest.Mock).mockResolvedValue([]);
    (matchDrugAllergyAgainstMappings as jest.Mock).mockReturnValue([]);

    const result = await applyDdiToResolutionState(fakePool, state, ctx);
    expect(result.suppressedNodeCount).toBe(1);
    expect(state.get('med-1').status).toBe(NodeStatus.EXCLUDED);
    expect(state.get('med-2').status).toBe(NodeStatus.INCLUDED);
  });
});
