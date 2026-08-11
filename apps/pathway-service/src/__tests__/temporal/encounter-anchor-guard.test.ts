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

  it('lists every offending gate in one message (kept last of the original suite)', () => {
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

// ─── Plan 04 Task 1 ─────────────────────────────────────────────────

const ANCHOR = '2026-08-03T09:00:00.000Z';
const legacyNoAnchor = ctx({ temporalPolicyVersion: 'legacy-v0' });
const legacyWithAnchor = ctx({ temporalPolicyVersion: 'legacy-v0', encounterStart: ANCHOR });
const v1WithAnchor = ctx({ encounterStart: ANCHOR });

/** vitals.* is ENCOUNTER under v1 (plan 03), so this needs an anchor. */
const vitalsAttrGate = gate('g-attr-bp', {
  title: 'systolic',
  gate_type: 'patient_attribute',
  default_behavior: 'skip',
  condition: { attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 120 },
});

const patientAttrGate = gate('g-trimester', {
  title: 'trimester',
  gate_type: 'patient_attribute',
  default_behavior: 'skip',
  condition: { attribute: 'patient.trimester', operator: 'exists', value: true },
});

const malformedOverrideGate = gate('g-bad-horizon', {
  title: 'bad horizon',
  gate_type: 'patient_attribute',
  default_behavior: 'skip',
  condition: { field: 'labs', operator: 'greater_than', value: '4548-4', horizon: 'FORTNIGHT' },
});

const conflictingKeysGate = gate('g-conflict', {
  title: 'both keys',
  gate_type: 'patient_attribute',
  default_behavior: 'skip',
  condition: {
    field: 'labs',
    operator: 'count_in_window',
    value: '4548-4',
    window_days: 90,
    horizon: 'QUARTER',
  },
});

describe('the sweep covers clinical attribute conditions (P1-8)', () => {
  it('rejects a v1 pathway whose vitals.* attribute gate has no encounterStart', () => {
    // Without this the gate passes preflight and throws mid-traversal — after
    // LLM gates have run and audit rows exist.
    expect(() => assertEncounterAnchor(rctx([vitalsAttrGate]), ctx())).toThrow(
      /MISSING_ENCOUNTER_ANCHOR|encounterStart/,
    );
  });

  it('accepts the same pathway when encounterStart is supplied', () => {
    expect(() => assertEncounterAnchor(rctx([vitalsAttrGate]), v1WithAnchor)).not.toThrow();
  });

  it('does NOT sweep patient.* demographics', () => {
    expect(() => assertEncounterAnchor(rctx([patientAttrGate]), ctx())).not.toThrow();
  });

  it('leaves legacy-v0 unaffected — attributes are not swept there at all', () => {
    expect(() => assertEncounterAnchor(rctx([vitalsAttrGate]), legacyNoAnchor)).not.toThrow();
  });
});

describe('the legacy-v0 sweep is preserved exactly (D1, P1-15)', () => {
  it('still REJECTS a malformed horizon when encounterStart is absent', () => {
    // Today's behavior: the raw value reaches parseHorizonValue via the
    // cascade. Ignoring it would turn a current rejection into a success.
    expect(() => assertEncounterAnchor(rctx([malformedOverrideGate]), legacyNoAnchor)).toThrow(
      TemporalContextError,
    );
  });

  it('still IGNORES it when encounterStart is present', () => {
    // assertEncounterAnchor returns early, so nothing is ever parsed.
    expect(() =>
      assertEncounterAnchor(rctx([malformedOverrideGate]), legacyWithAnchor),
    ).not.toThrow();
  });

  it('does not sweep attribute conditions under legacy-v0', () => {
    // Coverage must not widen on the legacy path, or a pathway that starts
    // today stops starting.
    expect(() => assertEncounterAnchor(rctx([vitalsAttrGate]), legacyNoAnchor)).not.toThrow();
  });

  it('ignores a window_days/horizon conflict under legacy-v0', () => {
    // The conflict check is a v1 rule. Applying it to legacy would reject a
    // pathway that starts today.
    expect(() => assertEncounterAnchor(rctx([conflictingKeysGate]), legacyWithAnchor)).not.toThrow();
  });
});

describe('v1 validation is not behind the encounterStart early return (P1-18)', () => {
  it('rejects a malformed v1 override even when an anchor IS supplied', () => {
    expect(() => assertEncounterAnchor(rctx([malformedOverrideGate]), v1WithAnchor)).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a window_days/horizon conflict when an anchor IS supplied', () => {
    expect(() => assertEncounterAnchor(rctx([conflictingKeysGate]), v1WithAnchor)).toThrow(
      /window_days.*horizon|horizon.*window_days/i,
    );
  });

  it('still short-circuits the ANCHOR requirement when an anchor is supplied', () => {
    // Validation runs; the anchor throw does not.
    expect(() => assertEncounterAnchor(rctx([vitalsAttrGate]), v1WithAnchor)).not.toThrow();
  });

  it('leaves legacy-v0 conditional exactly as today', () => {
    // The mirror case: legacy must NOT gain validation it lacks today.
    expect(() =>
      assertEncounterAnchor(rctx([malformedOverrideGate]), legacyWithAnchor),
    ).not.toThrow();
  });
});
