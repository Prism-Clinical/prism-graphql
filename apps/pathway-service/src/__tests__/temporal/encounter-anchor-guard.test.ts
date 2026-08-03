// Same reason as the resolution-context-defaults test: importing the real
// resolution-context pulls in the Query resolver at module load.
jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  assertEncounterAnchor,
  ResolutionContext,
} from '../../resolvers/helpers/resolution-context';
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { GraphNode } from '../../services/confidence/types';

const AS_OF = '2026-08-03T12:00:00.000Z';

function ctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return { evaluationAsOf: AS_OF, timezone: 'UTC', temporalPolicyVersion: 'v1', ...over };
}

function gate(nodeId: string, properties: Record<string, unknown>): GraphNode {
  return { id: nodeId, nodeIdentifier: nodeId, nodeType: 'Gate', properties };
}

function rctx(nodes: GraphNode[], defaults = {}): ResolutionContext {
  return {
    graphContext: {
      allNodes: nodes,
      allEdges: [],
      incomingEdges: () => [],
      outgoingEdges: () => [],
      getNode: () => undefined,
      linkedNodes: () => [],
    },
    edges: [],
    signals: [],
    thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
    confidenceEngine: {} as ResolutionContext['confidenceEngine'],
    codeMap: new Map(),
    temporalDefaults: defaults,
  };
}

const vitalsGate = gate('g-bp', {
  title: 'BP check',
  gate_type: 'patient_attribute',
  default_behavior: 'skip',
  condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
});

describe('assertEncounterAnchor', () => {
  it('passes under legacy-v0 — nothing resolves to ENCOUNTER', () => {
    expect(() =>
      assertEncounterAnchor(rctx([vitalsGate]), ctx({ temporalPolicyVersion: 'legacy-v0' })),
    ).not.toThrow();
  });

  it('rejects a v1 session whose pathway reads vitals with no encounterStart', () => {
    try {
      assertEncounterAnchor(rctx([vitalsGate]), ctx());
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
      expect((e as Error).message).toContain('g-bp');
    }
  });

  it('passes once the anchor is supplied', () => {
    expect(() =>
      assertEncounterAnchor(rctx([vitalsGate]), ctx({ encounterStart: '2026-08-03T09:00:00.000Z' })),
    ).not.toThrow();
  });

  it('walks compound gates — conditions[], not just condition', () => {
    const compound = gate('g-compound', {
      title: 'compound',
      gate_type: 'compound',
      default_behavior: 'skip',
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'E11.9' },
        { field: 'vitals', operator: 'greater_than', value: '8480-6' },
      ],
    });
    expect(() => assertEncounterAnchor(rctx([compound]), ctx())).toThrow(/g-compound/);
  });

  it('ignores attribute conditions — they never resolve a horizon (see "Known gap")', () => {
    const attrGate = gate('g-age', {
      title: 'age',
      gate_type: 'patient_attribute',
      default_behavior: 'skip',
      condition: { attribute: 'age', operator: 'greater_than', value: 18 },
    });
    expect(() => assertEncounterAnchor(rctx([attrGate]), ctx())).not.toThrow();
  });

  it('ignores a gate with no condition', () => {
    const plain = gate('g-empty', { title: 'no condition' });
    expect(() => assertEncounterAnchor(rctx([plain]), ctx())).not.toThrow();
  });

  it('ignores a NON-Gate node even when it carries a condition-shaped property', () => {
    // Must not use the gate() helper — that sets nodeType 'Gate', so the
    // test would pass with or without the nodeType check and prove nothing.
    const step: GraphNode = {
      id: 'n-step',
      nodeIdentifier: 'n-step',
      nodeType: 'Step',
      properties: {
        title: 'Order vitals',
        // Condition-shaped, but nothing ever evaluates it on a Step node.
        condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
      },
    };
    expect(() => assertEncounterAnchor(rctx([step]), ctx())).not.toThrow();
  });

  it('ignores a leftover condition on a question gate — evaluateQuestion never reads it', () => {
    // evaluateGate dispatches on gate_type (gate-evaluator.ts:753): question,
    // prior_node_result and llm_text_analysis read neither `condition` nor
    // `conditions`. The import validator does not currently forbid a stale
    // `condition` surviving a gate-type change, so rejecting a session over
    // one would be a false positive on a condition that is never evaluated.
    for (const gateType of ['question', 'prior_node_result', 'llm_text_analysis']) {
      const g = gate(`g-${gateType}`, {
        title: gateType,
        gate_type: gateType,
        default_behavior: 'skip',
        condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
        conditions: [{ field: 'vitals', operator: 'greater_than', value: '8480-6' }],
      });
      expect(() => assertEncounterAnchor(rctx([g]), ctx())).not.toThrow();
    }
  });

  it('reads only the key its gate type evaluates', () => {
    // patient_attribute reads `condition`; a stray `conditions[]` on it is
    // never evaluated. compound is the mirror image.
    const attrWithStrayArray = gate('g-attr', {
      title: 'attr',
      gate_type: 'patient_attribute',
      default_behavior: 'skip',
      condition: { field: 'labs', operator: 'greater_than', value: '4548-4' },
      conditions: [{ field: 'vitals', operator: 'greater_than', value: '8480-6' }],
    });
    expect(() => assertEncounterAnchor(rctx([attrWithStrayArray]), ctx())).not.toThrow();

    const compoundWithStraySingular = gate('g-comp', {
      title: 'comp',
      gate_type: 'compound',
      default_behavior: 'skip',
      operator: 'AND',
      condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
      conditions: [{ field: 'labs', operator: 'greater_than', value: '4548-4' }],
    });
    expect(() => assertEncounterAnchor(rctx([compoundWithStraySingular]), ctx())).not.toThrow();
  });

  it('ignores a satisfaction_check, which is not a gate condition', () => {
    const step: GraphNode = {
      id: 'n-prereq',
      nodeIdentifier: 'n-prereq',
      nodeType: 'Step',
      properties: {
        title: 'A1c drawn',
        satisfaction_check: {
          type: 'code',
          code: '4548-4',
          system: 'http://loinc.org',
          lookback_days: 90,
        },
      },
    };
    expect(() => assertEncounterAnchor(rctx([step]), ctx())).not.toThrow();
  });

  it('honors a pathway-level ENCOUNTER default on an ordinary field', () => {
    const labsGate = gate('g-a1c', {
      title: 'A1c',
      gate_type: 'patient_attribute',
      default_behavior: 'skip',
      condition: { field: 'labs', operator: 'greater_than', value: '4548-4' },
    });
    expect(() =>
      assertEncounterAnchor(
        rctx([labsGate], { horizons: { labs: 'ENCOUNTER' } }),
        ctx({ temporalPolicyVersion: 'legacy-v0' }),
      ),
    ).toThrow(/g-a1c/);
  });

  it('rejects an unknown policy version even when an anchor is present', () => {
    // Regression: behind the encounterStart early return, a bad version
    // sailed through whenever an anchor happened to be supplied.
    expect(() =>
      assertEncounterAnchor(
        rctx([vitalsGate]),
        ctx({ temporalPolicyVersion: 'v99', encounterStart: '2026-08-03T09:00:00.000Z' }),
      ),
    ).toThrow(/unknown temporalPolicyVersion/);
  });

  it('rejects an unknown policy version on a pathway with nothing to sweep', () => {
    expect(() => assertEncounterAnchor(rctx([]), ctx({ temporalPolicyVersion: 'v99' }))).toThrow(
      /unknown temporalPolicyVersion/,
    );
  });

  it('lists every offending gate in one message', () => {
    try {
      assertEncounterAnchor(
        rctx([
          vitalsGate,
          gate('g-hr', {
            title: 'HR',
            gate_type: 'patient_attribute',
            default_behavior: 'skip',
            condition: { field: 'vitals', operator: 'greater_than', value: '8867-4' },
          }),
        ]),
        ctx(),
      );
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('g-bp');
      expect((e as Error).message).toContain('g-hr');
    }
  });
});
