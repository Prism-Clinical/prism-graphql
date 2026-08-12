/**
 * Review finding 2 — the `v1` sweep judged attribute conditions from the
 * NAMESPACE alone, so preflight rejected sessions evaluation would never have
 * rejected.
 *
 * `sweepableConditions` derived an attribute condition's cascade key from
 * `attributeNamespaceToField(namespace)`. `adaptAttributeCondition` derives the
 * same key — and then returns `null` when the attribute has no `codeMap` row,
 * because there is no code to select on, at which point the evaluator falls back
 * to `resolveAttribute` and resolves no temporal policy at all.
 *
 * So `lab.unmapped` with `horizon: 'ENCOUNTER'` threw `MISSING_ENCOUNTER_ANCHOR`
 * at session creation while evaluating as an ordinary unsatisfied gate: one
 * condition, two answers. That is the preflight/evaluation divergence locked
 * decision #7 forbids, and this plan has been corrected for it four times.
 *
 * **R11-2 is FALSE and is corrected by this file.** It records that using the
 * real adapter in the sweep is "structurally impossible" because the sweep has
 * no `codeMap` in scope. `ResolutionContext.codeMap` exists
 * (`resolution-context.ts:283`), it is loaded by `buildResolutionContext` for
 * every resolution, and `assertEncounterAnchor` already receives the whole
 * `rctx`. The map was one field away the entire time.
 *
 * The fix threads it through and calls `adaptAttributeCondition` — exactly what
 * the coded branch already does with `adaptCodedCondition`. What that must NOT
 * cost is P1-18: the adapter parses the NODE override BEFORE its code lookup, so
 * a malformed override on an unmapped attribute still rejects at preflight. That
 * ordering is load-bearing and is pinned below rather than assumed.
 */

jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  assertEncounterAnchor,
  sweepableConditions,
  ResolutionContext,
} from '../../resolvers/helpers/resolution-context';
import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  AttributeCondition,
  AttributeCodeMap,
} from '../../services/resolution/types';
import {
  EvaluationTemporalContext,
  makeEvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { adaptAttributeCondition } from '../../services/resolution/temporal/condition-adapter';
import type { PatientContext, GraphNode } from '../../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';

const CODE_MAP: AttributeCodeMap = new Map([
  [
    'lab.a1c',
    {
      attributeName: 'lab.a1c',
      namespace: 'lab',
      system: 'LOINC',
      code: '4548-4',
      valueType: 'number' as const,
    },
  ],
  [
    'allergy.penicillin',
    {
      attributeName: 'allergy.penicillin',
      namespace: 'allergy',
      system: 'RXNORM',
      code: '7980',
      valueType: 'boolean' as const,
    },
  ],
]);

function gateNode(id: string, condition: AttributeCondition): GraphNode {
  return {
    id,
    nodeIdentifier: id,
    nodeType: 'Gate',
    properties: {
      title: id,
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition,
    },
  };
}

function rctx(nodes: GraphNode[], codeMap: AttributeCodeMap = CODE_MAP): ResolutionContext {
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
    codeMap,
    temporalDefaults: {},
  };
}

function tctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return { evaluationAsOf: AS_OF, timezone: 'UTC', temporalPolicyVersion: 'v1', ...over };
}

function patient(): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
  };
}

function gateFor(condition: AttributeCondition): GateProperties {
  return {
    title: 'attr gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
  };
}

function deps(overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      temporalPolicyVersion: 'v1',
    }),
    pathwayDefaults: {},
    factStore: [],
    codeMap: CODE_MAP,
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

// ─── The divergence ───────────────────────────────────────────────────

describe('an UNMAPPED clinical attribute must not be rejected by preflight alone', () => {
  const UNMAPPED_ENCOUNTER = {
    attribute: 'lab.unmapped',
    operator: 'greater_than',
    value: 9,
    horizon: 'ENCOUNTER',
  };

  it('evaluates as an ordinary unsatisfied gate — no anchor is ever demanded', async () => {
    // The evaluation half of the divergence, asserted first so the preflight
    // half below is measured against something observed rather than assumed.
    // `adaptAttributeCondition` returns null (no codeMap row), the evaluator
    // falls back to `resolveAttribute`, and no temporal policy is resolved at
    // all — so the missing `encounterStart` is never consulted.
    const r = await evaluateGate(gateFor(UNMAPPED_ENCOUNTER), deps());
    expect(r.satisfied).toBe(false);
  });

  it('is not swept, so preflight demands no anchor either', () => {
    expect(sweepableConditions([gateNode('g-unmapped', UNMAPPED_ENCOUNTER)], 'v1', CODE_MAP)).toEqual(
      [],
    );
    expect(() =>
      assertEncounterAnchor(rctx([gateNode('g-unmapped', UNMAPPED_ENCOUNTER)]), tctx()),
    ).not.toThrow();
  });

  it('still demands the anchor once the attribute IS mapped', () => {
    // The confining half. The fix must not reopen the P1-8 hole it is standing
    // next to: a MAPPED lab that resolves ENCOUNTER is exactly what preflight
    // exists to catch, and evaluation agrees by throwing the same code.
    const mapped = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'ENCOUNTER',
    };

    expect(sweepableConditions([gateNode('g-a1c', mapped)], 'v1', CODE_MAP)).toEqual([
      { label: 'g-a1c / condition 0', field: 'labs', override: { horizon: 'ENCOUNTER' } },
    ]);
    expect(() => assertEncounterAnchor(rctx([gateNode('g-a1c', mapped)]), tctx())).toThrow(
      /g-a1c/,
    );
    return expect(evaluateGate(gateFor(mapped), deps())).rejects.toMatchObject({
      code: 'MISSING_ENCOUNTER_ANCHOR',
    });
  });

  it('sweeps an unmapped allergy no more than an unmapped lab', async () => {
    const cond = {
      attribute: 'allergy.unmapped',
      operator: 'equals',
      value: true,
      horizon: 'ENCOUNTER',
    };
    expect(sweepableConditions([gateNode('g-allergy', cond)], 'v1', CODE_MAP)).toEqual([]);
    const r = await evaluateGate(gateFor(cond), deps());
    expect(r.satisfied).toBe(false);
  });
});

// ─── What the codeMap must NOT change ─────────────────────────────────

describe('the codeMap threading preserves the rules that predate it', () => {
  it('keeps rejecting a malformed override on an UNMAPPED attribute (P1-18)', () => {
    // The load-bearing ordering: `adaptAttributeCondition` parses the NODE
    // override BEFORE the codeMap lookup. Resolving the code first would make
    // this condition vanish from the sweep silently — and then throw from the
    // evaluator's own `parseConditionOverride` mid-traversal, which is the
    // divergence in the other direction.
    const cond = {
      attribute: 'lab.unmapped',
      operator: 'greater_than',
      value: 9,
      horizon: 'FORTNIGHT',
    };
    expect(() => sweepableConditions([gateNode('g-bad', cond)], 'v1', CODE_MAP)).toThrow(
      /FORTNIGHT/,
    );
    return expect(evaluateGate(gateFor(cond), deps())).rejects.toThrow(/FORTNIGHT/);
  });

  it('rejects a window_days/horizon conflict on an unmapped attribute too', () => {
    const cond = {
      attribute: 'lab.unmapped',
      operator: 'greater_than',
      value: 9,
      horizon: 'QUARTER',
      window_days: 30,
    };
    expect(() => sweepableConditions([gateNode('g-both', cond)], 'v1', CODE_MAP)).toThrow(
      /not both/,
    );
  });

  it('sweeps vitals with no codeMap row at all — the dotted path IS the code', () => {
    // `vitals.*` never consults the map, so an empty one must change nothing
    // for it. Without this, threading the map would look like it worked while
    // silently depending on a fixture.
    const cond = {
      attribute: 'vitals.systolic_bp',
      operator: 'greater_than',
      value: 140,
    };
    expect(sweepableConditions([gateNode('g-bp', cond)], 'v1', new Map())).toEqual([
      { label: 'g-bp / condition 0', field: 'vitals' },
    ]);
  });

  it('still ignores patient.* on both sides', () => {
    const cond = {
      attribute: 'patient.age',
      operator: 'greater_than',
      value: 60,
      horizon: 'FORTNIGHT',
    };
    expect(sweepableConditions([gateNode('g-age', cond)], 'v1', CODE_MAP)).toEqual([]);
    expect(adaptAttributeCondition(cond, CODE_MAP)).toBeNull();
  });

  it('leaves the legacy-v0 sweep blind to attribute conditions, mapped or not', () => {
    // legacy-v0 sweeps coded conditions only, byte-for-byte as today. Threading
    // a map must not widen it — a behavior change reachable under legacy-v0 is
    // a bug in the seam (locked decision #2).
    const mapped = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'ENCOUNTER',
    };
    expect(sweepableConditions([gateNode('g-a1c', mapped)], 'legacy-v0', CODE_MAP)).toEqual([]);
  });
});

// ─── One adapter, not two derivations ─────────────────────────────────

describe('the sweep and the adapter are now the SAME call', () => {
  it.each([
    ['lab.a1c', 'labs'],
    ['allergy.penicillin', 'allergies'],
    ['vitals.systolic_bp', 'vitals'],
  ])('agrees on field and override for %s', (attribute, field) => {
    const cond = { attribute, operator: 'greater_than', value: 1, horizon: 'YEAR' };
    const swept = sweepableConditions([gateNode('g', cond)], 'v1', CODE_MAP)[0];
    const adapted = adaptAttributeCondition(cond, CODE_MAP)!;
    expect(swept.field).toBe(field);
    expect(swept.field).toBe(adapted.selection.field);
    expect(swept.override).toEqual(adapted.override);
  });

  it('agrees that an unmapped clinical attribute is not routable', () => {
    const cond = { attribute: 'lab.nope', operator: 'greater_than', value: 1 };
    expect(adaptAttributeCondition(cond, CODE_MAP)).toBeNull();
    expect(sweepableConditions([gateNode('g', cond)], 'v1', CODE_MAP)).toEqual([]);
  });

  it('follows the map, not the namespace: the same attribute flips with the map', () => {
    // The property that makes this a real threading rather than a coincidence.
    const cond = { attribute: 'lab.a1c', operator: 'greater_than', value: 9 };
    expect(sweepableConditions([gateNode('g', cond)], 'v1', CODE_MAP)).toHaveLength(1);
    expect(sweepableConditions([gateNode('g', cond)], 'v1', new Map())).toHaveLength(0);
  });

  it('sweeps compound gate conditions through the same adapter', () => {
    const node: GraphNode = {
      id: 'g-comp',
      nodeIdentifier: 'g-comp',
      nodeType: 'Gate',
      properties: {
        title: 'comp',
        gate_type: GateType.COMPOUND,
        default_behavior: DefaultBehavior.SKIP,
        operator: 'AND',
        conditions: [
          { attribute: 'lab.a1c', operator: 'greater_than', value: 9 },
          { attribute: 'lab.unmapped', operator: 'greater_than', value: 9 },
        ],
      },
    };
    expect(sweepableConditions([node], 'v1', CODE_MAP)).toEqual([
      { label: 'g-comp / condition 0', field: 'labs' },
    ]);
  });

  it('names the gate in a preflight rejection, through the adapter it now calls', () => {
    // `where` still reaches the adapter — an author fixing a pathway needs to
    // know which gate, and the switch to the real adapter must not lose it.
    const cond = {
      attribute: 'lab.unmapped',
      operator: 'greater_than',
      value: 9,
      horizon: 'FORTNIGHT',
    };
    expect(() => sweepableConditions([gateNode('g-named', cond)], 'v1', CODE_MAP)).toThrow(
      /g-named \/ condition 0/,
    );
  });

  it('passes rctx.codeMap through assertEncounterAnchor, not an empty default', () => {
    // The whole finding in one assertion: a mapped lab resolving ENCOUNTER must
    // be caught, and it can only be caught if the real map reached the sweep.
    const mapped = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'ENCOUNTER',
    };
    expect(() => assertEncounterAnchor(rctx([gateNode('g-a1c', mapped)]), tctx())).toThrow(
      /MISSING_ENCOUNTER_ANCHOR|encounterStart/,
    );
    // ...and with an EMPTY map it is not, because then it is genuinely not
    // routable — which is the same answer evaluation gives.
    expect(() =>
      assertEncounterAnchor(rctx([gateNode('g-a1c', mapped)], new Map()), tctx()),
    ).not.toThrow();
  });

  it('is unaffected by an anchor being present', () => {
    const mapped = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'ENCOUNTER',
    };
    expect(() =>
      assertEncounterAnchor(
        rctx([gateNode('g-a1c', mapped)]),
        tctx({ encounterStart: ENCOUNTER_START }),
      ),
    ).not.toThrow();
  });
});
