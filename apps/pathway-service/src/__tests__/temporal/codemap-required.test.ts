/**
 * NOTE: this file used to assert the same codeMap guard on RetraversalEngine
 * as well. That engine is gone — retraversal is TraversalEngine re-entered
 * incrementally — so the guard has one construction site and one pair of tests.
 */

/**
 * Review finding 3 (R11-4) — `codeMap` was optional at every load-bearing seam.
 *
 * `GateEvaluationDeps.codeMap`, `TraversalEngine`'s constructor and
 * the engine constructors all defaulted it to an empty `Map`. Every
 * production site passes `rctx.codeMap`, so nothing was broken — but the FAILURE
 * MODE of omitting it at one site is silent: `adaptAttributeCondition` returns
 * `null` for every `lab.*` and `allergy.*`, the evaluator falls back to
 * `resolveAttribute`, which bails on the missing row, and the gate answers a
 * quiet `false` that is indistinguishable in the audit row from a patient who
 * genuinely has no such lab.
 *
 * This is the exact shape P1-10 promoted `pathwayDefaults` out of and Task 9
 * promoted `factStore` out of, so it follows them: required in the type,
 * positioned before the optionals, and asserted at RUNTIME — because `tsconfig`
 * excludes `src/__tests__` with `diagnostics: false`, so a type alone enforces
 * nothing on any test caller, and the engines are built from resolvers whose
 * `rctx` shape is partly `unknown` at the boundary.
 *
 * The assertion is `instanceof Map`, not truthiness: an EMPTY map is legitimate
 * — `legacy-v0` never reads it, and a deployment with no attribute registry rows
 * has one — while an absent or wrong-typed one is a wiring bug.
 */

import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  AttributeCondition,
  AttributeCodeMap,
} from '../../services/resolution/types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import type { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import type { PatientContext } from '../../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
const A1C_CODE = '4548-4';

const CODE_MAP: AttributeCodeMap = new Map([
  [
    'lab.a1c',
    {
      attributeName: 'lab.a1c',
      namespace: 'lab',
      system: 'LOINC',
      code: A1C_CODE,
      valueType: 'number' as const,
    },
  ],
]);

function a1cFact(): NormalizedFact {
  return {
    kind: 'lab',
    factId: 'l1',
    code: A1C_CODE,
    system: 'LOINC',
    value: 11,
    unit: '%',
    observationStatus: 'final',
    interval: {
      start: { value: '2026-07-01', precision: 'day' },
      end: { kind: 'KNOWN', bound: { value: '2026-07-01', precision: 'day' } },
    },
    recordValidity: 'VALID',
    validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
  } as NormalizedFact;
}

function patient(): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [] };
}

const A1C_GATE: GateProperties = {
  title: 'A1c above 9',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: { attribute: 'lab.a1c', operator: 'greater_than', value: 9 } as AttributeCondition,
};

function deps(overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: ENCOUNTER_START,
      temporalPolicyVersion: 'v1',
    }),
    pathwayDefaults: {},
    factStore: [a1cFact()],
    codeMap: CODE_MAP,
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

describe('an omitted codeMap must be loud, not a quiet false', () => {
  it('answers the gate correctly when the map is supplied', async () => {
    // The baseline the omission is measured against: A1c 11 > 9, satisfied.
    const r = await evaluateGate(A1C_GATE, deps());
    expect(r.satisfied).toBe(true);
  });

  it('throws rather than answering when the map is absent', async () => {
    // Before this fix the very same call answered `satisfied: false` — the same
    // answer a patient with no A1c at all produces. That is R11-4's failure
    // mode, and it is unobservable at the audit row.
    const without = deps();
    delete (without as Partial<GateEvaluationDeps>).codeMap;
    await expect(evaluateGate(A1C_GATE, without)).rejects.toThrow(/codeMap/);
  });

  it('throws when the map is present but is not a Map', async () => {
    await expect(
      evaluateGate(A1C_GATE, deps({ codeMap: {} as unknown as AttributeCodeMap })),
    ).rejects.toThrow(/codeMap/);
  });

  it('accepts an EMPTY map — that is a legitimate deployment, not a wiring bug', async () => {
    // The confining assertion. An empty registry means the attribute is not
    // routable, which the evaluator answers `false` for, exactly as it should.
    const r = await evaluateGate(A1C_GATE, deps({ codeMap: new Map() }));
    expect(r.satisfied).toBe(false);
  });

  it('throws for a legacy-v0 gate too — the seam is wiring, not semantics', async () => {
    // legacy-v0 reads `codeMap` as well (`evaluateConditionLegacyAdapted`), and
    // a required input that is only checked on one branch is a required input
    // one branch can skip.
    const without = deps({
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'legacy-v0',
      }),
    });
    delete (without as Partial<GateEvaluationDeps>).codeMap;
    await expect(evaluateGate(A1C_GATE, without)).rejects.toThrow(/codeMap/);
  });
});

describe('the engine requires it at construction', () => {
  const thresholds = { autoResolveThreshold: 0.8, suggestThreshold: 0.5 };
  const clock = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: 'v1',
  });
  const conf = {} as never;

  it('TraversalEngine throws when codeMap is omitted', () => {
    expect(
      () => new TraversalEngine(conf, thresholds, clock, {}, [], undefined as never),
    ).toThrow(/codeMap/);
  });


  it('TraversalEngine throws when codeMap is not a Map', () => {
    expect(
      () =>
        new TraversalEngine(conf, thresholds, clock, {}, [], [] as unknown as AttributeCodeMap),
    ).toThrow(/codeMap/);
  });


  it('both accept an empty Map', () => {
    expect(() => new TraversalEngine(conf, thresholds, clock, {}, [], new Map())).not.toThrow();
  });

  it('keeps llmGateEvaluator optional AFTER the required codeMap', () => {
    // The ordering is forced — TypeScript forbids a required parameter after an
    // optional one — so this pins that the LLM evaluator did not become
    // required as a side effect of promoting the map.
    expect(() => new TraversalEngine(conf, thresholds, clock, {}, [], CODE_MAP)).not.toThrow();
    expect(
      () => new TraversalEngine(conf, thresholds, clock, {}, [], CODE_MAP, undefined),
    ).not.toThrow();
  });
});
