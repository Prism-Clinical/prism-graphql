import { recordOf } from '../scripts/capture-resolution';

const node = (nodeId: string, status: string, confidence: number, extra: Record<string, unknown> = {}) =>
  ({ nodeId, nodeType: 'Step', status, confidence, excludeReason: null, ...extra });

const SESSION = {
  id: 's-1',
  includedNodes: [node('b', 'INCLUDED', 0.78123), node('a', 'INCLUDED', 0.5)],
  excludedNodes: [node('m', 'EXCLUDED', 0.094, { nodeType: 'Medication', excludeReason: 'low confidence', eligibilityStatus: 'EXCLUDED', withheldBy: null })],
  gatedOutNodes: [],
  pendingQuestions: [{ gateId: 'g2', datumKey: null, tentative: null, tentativeBranch: null }, { gateId: 'g1', datumKey: 'lab:718-7', tentative: false, tentativeBranch: null }],
  redFlags: [],
  ddiWarnings: [],
};

describe('capture-resolution record (plan 05, P5-1)', () => {
  it('is one sorted line per node, question, flag and warning, confidences to 3 dp, no ids or timings', () => {
    expect(recordOf(SESSION as never)).toEqual([
      'node a Step INCLUDED conf=0.500 reason=-',
      'node b Step INCLUDED conf=0.781 reason=-',
      'node m Medication EXCLUDED conf=0.094 reason=low confidence',
      'question g1 datum=lab:718-7 tentative=false branch=-',
      'question g2 datum=- tentative=- branch=-',
    ]);
  });

  it('puts the pipeline-only facts after a separator, so the shared part diffs cleanly', () => {
    const withheld = {
      ...SESSION,
      includedNodes: [],
      excludedNodes: [node('m', 'EXCLUDED', 0.9, { nodeType: 'Medication', excludeReason: 'ALLERGY', eligibilityStatus: 'INCLUDED', withheldBy: 'SAFETY' })],
      pendingQuestions: [],
    };
    expect(recordOf(withheld as never, { success: false, carePlanId: null, blockers: [{ scope: 'OUTPUT', type: 'EMPTY_PLAN', relatedNodeIds: [] }] })).toEqual([
      'node m Medication EXCLUDED conf=0.900 reason=ALLERGY',
      '-- after only',
      'eligibility m eligible=INCLUDED withheldBy=SAFETY',
      'probe success=false carePlan=-',
      'blocker OUTPUT EMPTY_PLAN nodes=-',
    ]);
    expect(recordOf(withheld as never, 'skipped')).toContain('probe skipped (no pending question: generating would write a care plan)');
  });
});
