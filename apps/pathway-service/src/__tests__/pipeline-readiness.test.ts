import { applyDisposition, medicationCandidates } from '../services/resolution/pipeline/disposition';
import { readinessOf } from '../services/resolution/pipeline/readiness';
import { NodeResult, NodeStatus, OverrideAction, ResolutionState } from '../services/resolution/types';
import type { ScopedFinding } from '../services/resolution/pipeline/types';

const n = (nodeId: string, nodeType: string, status: NodeStatus, extra: Partial<NodeResult> = {}): NodeResult =>
  ({ nodeId, nodeType, title: nodeId, status, confidence: 0.9, confidenceBreakdown: [], depth: 1, properties: { name: nodeId }, ...extra });
const state = (...nodes: NodeResult[]): ResolutionState => new Map(nodes.map((x) => [x.nodeId, x]));
const base = { pendingQuestions: [], redFlags: [], unavailable: [], scope: 'ROOT' as const, isDegraded: false };
const allergy: ScopedFinding = {
  recommendationId: 'med', drugName: 'med', action: 'SUPPRESS', severity: 'SEVERE', category: 'ALLERGY',
  mechanism: null, clinicalAdvice: 'x', source: { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin' }, scope: 'PATIENT',
};

describe('applyDisposition (C2)', () => {
  it('keeps eligibility and withholds by safety', () => {
    const out = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]).get('med')!;
    expect(out.eligibility).toEqual({ status: NodeStatus.INCLUDED, reason: undefined, decidedBy: 'traversal' });
    expect(out.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
    expect(out.status).toBe(NodeStatus.EXCLUDED);
    expect(out.excludeReason).toContain('ALLERGY');
  });

  it('leaves non-included nodes and unrelated nodes unchanged; overrides are decidedBy override', () => {
    const s = applyDisposition(state(
      n('med', 'Medication', NodeStatus.EXCLUDED, { excludeReason: 'low' }),
      n('lab', 'LabTest', NodeStatus.INCLUDED, { providerOverride: { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 } }),
    ), [allergy]);
    expect(s.get('med')!.disposition).toEqual({ status: NodeStatus.EXCLUDED });
    expect(s.get('med')!.excludeReason).toBe('low');
    expect(s.get('lab')!.eligibility!.decidedBy).toBe('override');
  });

  it('medicationCandidates lists included medications by the DDI name', () => {
    expect(medicationCandidates(state(n('m1', 'Medication', NodeStatus.INCLUDED), n('m2', 'Medication', NodeStatus.EXCLUDED), n('l', 'LabTest', NodeStatus.INCLUDED))))
      .toEqual([{ recommendationId: 'm1', drugName: 'm1', meta: { nodeType: 'Medication' } }]);
  });
});

describe('readinessOf (C3)', () => {
  const types = (r: ReturnType<typeof readinessOf>) => r.blockers.map((b) => `${b.scope}:${b.type}`).sort();

  it('ready when an action is included and nothing is open', () => {
    const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED)) });
    expect(r).toMatchObject({ ready: true, blockers: [], status: 'ACTIVE' });
  });

  it('completeness blockers: pending node, tentative question, red flag, timeout, unavailable safety data', () => {
    const r = readinessOf({
      ...base,
      state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('q', 'Gate', NodeStatus.PENDING_QUESTION), n('llm', 'Gate', NodeStatus.INCLUDED), n('t', 'Step', NodeStatus.TIMEOUT)),
      pendingQuestions: [{ gateId: 'q', prompt: 'q', answerType: 'BOOLEAN' as never, affectedSubtreeSize: 0, estimatedImpact: 'low' },
        { gateId: 'llm', prompt: 'llm', answerType: 'SELECT' as never, affectedSubtreeSize: 0, estimatedImpact: 'low', tentative: true }],
      redFlags: [{ nodeId: 'dp', nodeTitle: 'dp', type: 'all_branches_excluded', description: 'x' }],
      unavailable: [{ drugName: 'Mysterydrug', source: 'PATIENT_MEDICATION' }],
    });
    expect(types(r)).toEqual([
      'COMPLETENESS:INCOMPLETE_RESOLUTION', 'COMPLETENESS:PENDING_GATE', 'COMPLETENESS:PENDING_GATE',
      'COMPLETENESS:SAFETY_DATA_UNAVAILABLE', 'COMPLETENESS:UNRESOLVED_RED_FLAG',
    ]);
    expect(r.status).toBe('DEGRADED');
  });

  it('EMPTY_PLAN is an OUTPUT blocker at ROOT only, judged on disposition', () => {
    const withheld = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]);
    expect(types(readinessOf({ ...base, state: withheld }))).toEqual(['OUTPUT:EMPTY_PLAN']);
    expect(types(readinessOf({ ...base, scope: 'CONTRIBUTION', state: withheld }))).toEqual([]);
  });
});
