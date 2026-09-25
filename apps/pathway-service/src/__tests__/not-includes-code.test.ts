/**
 * `not_includes_code` — "the patient does NOT have code X".
 *
 * The exact negation of `includes_code`: the same candidate rule (code,
 * system, trailing `.*` wildcard), the same horizon/status/validity selection.
 * Two things are its own:
 *
 *  - **No code on file is a definite TRUE.** Absence of a diagnosis is the
 *    answer, so it never asks.
 *  - **A match whose status or record validity cannot be decided makes it
 *    INDETERMINATE, not true.** `includes_code` fails OPEN on such a fact
 *    ("may have had X"); negating that blindly would read "may have had X" as
 *    a definite "does not have X" or a definite "has X". Neither is known.
 *
 * Motivating use: keep hemoglobinopathy patients away from empiric iron —
 * MCV < 80 AND none of D57.*, D56.x, D58.2 — in ONE flat AND.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
  NodeStatus,
  VALID_CODED_OPERATORS,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { NormalizedFact } from '../services/resolution/temporal/fact-model';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { hasDataForCondition } from '../services/resolution/reachability';
import { askFor } from '../services/resolution/unresolved-prompt';
import { validatePathwayJson } from '../services/import/validator';
import { clonePathway } from './fixtures/reference-pathway';
import { PathwayJson } from '../services/import/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-08-11T00:00:00.000Z';

function conditionFact(
  factId: string,
  code: string,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'condition',
    factId,
    code,
    system: 'ICD-10',
    interval: {
      start: { value: '2020', precision: 'year' },
      end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' },
    },
    recordValidity: 'VALID',
    validityBasis: 'verification:confirmed',
    provenance: { sourceType: 'SYNTHETIC' },
    clinicalState: 'ACTIVE',
    stateBasis: 'FHIR_STATUS',
    ...overrides,
  } as NormalizedFact;
}

function mcvFact(value: number): NormalizedFact {
  return {
    kind: 'lab',
    factId: `mcv-${value}`,
    code: '787-2',
    system: 'LOINC',
    value,
    unit: 'fL',
    observationStatus: 'final',
    interval: {
      start: { value: '2026-08-01', precision: 'day' },
      end: { kind: 'KNOWN', bound: { value: '2026-08-01', precision: 'day' } },
    },
    recordValidity: 'VALID',
    validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
  } as NormalizedFact;
}

function patient(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

function deps(version: string, overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      temporalPolicyVersion: version,
    }),
    pathwayDefaults: {},
    factStore: [],
    codeMap: new Map(),
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

const NOT_SCD = (value: string, extra: Record<string, unknown> = {}): GateCondition =>
  ({ field: 'conditions', operator: 'not_includes_code', value, system: 'ICD-10', ...extra }) as GateCondition;

function single(condition: GateCondition): GateProperties {
  return {
    title: 'no hemoglobinopathy',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
  };
}

const MCV_LT_80: GateCondition = {
  field: 'labs', operator: 'less_than', value: '787-2', system: 'LOINC', threshold: 80,
  horizon: { days: 90 },
} as GateCondition;

function microcyticNoHgbpathy(): GateProperties {
  return {
    title: 'Microcytic, no hemoglobinopathy',
    gate_type: GateType.COMPOUND,
    default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'ask',
    operator: 'AND',
    conditions: [
      MCV_LT_80,
      NOT_SCD('D57.0.*', { horizon: 'LIFETIME', status: 'any' }),
      NOT_SCD('D57.1', { horizon: 'LIFETIME', status: 'any' }),
      NOT_SCD('D56.1', { horizon: 'LIFETIME', status: 'any' }),
      NOT_SCD('D58.2', { horizon: 'LIFETIME', status: 'any' }),
    ],
  } as GateProperties;
}

describe('not_includes_code on the v1 kernel', () => {
  it('no code on file is a DEFINITE true — absence of a diagnosis is the answer', async () => {
    const r = await evaluateGate(single(NOT_SCD('D57.1')), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.contextFieldsRead).toEqual(['conditions']);
    expect(r.reason).toBe('No matching code D57.1 found in patient conditions');
  });

  it('a matching code makes it a definite false', async () => {
    const r = await evaluateGate(
      single(NOT_SCD('D57.1')),
      deps('v1', { factStore: [conditionFact('c1', 'D57.1')] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
    expect(r.reason).toBe('Patient has matching code D57.1 in conditions');
  });

  it('matches the trailing .* wildcard exactly as includes_code does', async () => {
    const gate = single(NOT_SCD('D57.0.*'));
    const hbss = await evaluateGate(gate, deps('v1', { factStore: [conditionFact('c1', 'D57.00')] }));
    expect(hbss.satisfied).toBe(false);
    // D57.1 is not under D57.0 — the pattern is a prefix, not a family.
    const other = await evaluateGate(gate, deps('v1', { factStore: [conditionFact('c1', 'D57.1')] }));
    expect(other.satisfied).toBe(true);
  });

  it('honours the system filter', async () => {
    const r = await evaluateGate(
      single(NOT_SCD('D57.1')),
      deps('v1', { factStore: [conditionFact('c1', 'D57.1', { system: 'SNOMED' })] }),
    );
    expect(r.satisfied).toBe(true);
  });

  it('honours the horizon: a resolved diagnosis outside it does not count', async () => {
    const resolvedIn2021 = conditionFact('c1', 'D57.1', {
      interval: {
        start: { value: '2020', precision: 'year' },
        end: { kind: 'KNOWN', bound: { value: '2021', precision: 'year' } },
      },
      clinicalState: 'INACTIVE',
    } as Partial<NormalizedFact>);
    const lastYear = await evaluateGate(
      single(NOT_SCD('D57.1', { horizon: 'YEAR', status: 'any' })),
      deps('v1', { factStore: [resolvedIn2021] }),
    );
    expect(lastYear.satisfied).toBe(true);
    const ever = await evaluateGate(
      single(NOT_SCD('D57.1', { horizon: 'LIFETIME', status: 'any' })),
      deps('v1', { factStore: [resolvedIn2021] }),
    );
    expect(ever.satisfied).toBe(false);
  });

  it('honours the status filter', async () => {
    const inactive = conditionFact('c1', 'D57.1', { clinicalState: 'INACTIVE' } as Partial<NormalizedFact>);
    const activeOnly = await evaluateGate(
      single(NOT_SCD('D57.1', { status: 'active' })),
      deps('v1', { factStore: [inactive] }),
    );
    expect(activeOnly.satisfied).toBe(true);
    const any = await evaluateGate(
      single(NOT_SCD('D57.1', { status: 'any' })),
      deps('v1', { factStore: [inactive] }),
    );
    expect(any.satisfied).toBe(false);
  });

  describe('indeterminate propagates — an undecidable match is not a "no"', () => {
    it('a validity-UNKNOWN match: INDETERMINATE, not true', async () => {
      const r = await evaluateGate(
        single(NOT_SCD('D57.1')),
        deps('v1', { factStore: [conditionFact('c1', 'D57.1', { recordValidity: 'UNKNOWN' })] }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(true);
      expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
      expect(r.reason).toContain('Indeterminate');
      expect(r.reason).toContain('D57.1');
    });

    it('a state-UNKNOWN match under status: active: INDETERMINATE', async () => {
      const r = await evaluateGate(
        single(NOT_SCD('D57.1', { status: 'active' })),
        deps('v1', {
          factStore: [conditionFact('c1', 'D57.1', { clinicalState: 'UNKNOWN' } as Partial<NormalizedFact>)],
        }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(true);
      expect(r.uncertainty).toContain('STATE_UNKNOWN');
    });

    it('under status: any the author admitted every state — the match is definite', async () => {
      const r = await evaluateGate(
        single(NOT_SCD('D57.1', { status: 'any' })),
        deps('v1', {
          factStore: [conditionFact('c1', 'D57.1', { clinicalState: 'UNKNOWN' } as Partial<NormalizedFact>)],
        }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(false);
    });

    it('one definite match settles it even beside an uncertain one', async () => {
      const r = await evaluateGate(
        single(NOT_SCD('D57.*')),
        deps('v1', {
          factStore: [
            conditionFact('c1', 'D57.1', { recordValidity: 'UNKNOWN' }),
            conditionFact('c2', 'D57.3'),
          ],
        }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(false);
      // The doubt about the other fact is still evidence.
      expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
    });

    it('never asks — there is no honest question for a code on a problem list', () => {
      expect(askFor(NOT_SCD('D57.1'))).toBeNull();
    });
  });

  describe('in a flat compound AND with a lab condition', () => {
    it('MCV < 80 and no hemoglobinopathy code → satisfied', async () => {
      const r = await evaluateGate(microcyticNoHgbpathy(), deps('v1', { factStore: [mcvFact(72)] }));
      expect(r.satisfied).toBe(true);
      expect(r.indeterminate).toBe(false);
    });

    it('MCV < 80 with an HbSS code → a definite false', async () => {
      const r = await evaluateGate(
        microcyticNoHgbpathy(),
        deps('v1', { factStore: [mcvFact(72), conditionFact('c1', 'D57.01')] }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(false);
      expect(r.reason).toContain('Patient has matching code D57.0.* in conditions');
    });

    it('MCV < 80 with an undecidable thalassemia record → indeterminate, not satisfied', async () => {
      const r = await evaluateGate(
        microcyticNoHgbpathy(),
        deps('v1', {
          factStore: [mcvFact(72), conditionFact('c1', 'D56.1', { recordValidity: 'UNKNOWN' })],
        }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(true);
    });

    it('a definite MCV ≥ 80 dominates the AND whatever the code check says', async () => {
      const r = await evaluateGate(
        microcyticNoHgbpathy(),
        deps('v1', {
          factStore: [mcvFact(88), conditionFact('c1', 'D56.1', { recordValidity: 'UNKNOWN' })],
        }),
      );
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(false);
    });

    it('in a traversal the undecidable case asks nothing and takes default_behavior', async () => {
      const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
        ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
      const edge = (s: string, t: string, type: string): GraphEdge =>
        ({ id: `${s}->${t}`, edgeType: type, sourceId: s, targetId: t, properties: {} });
      const graph = makeGraphContext(
        [node('root', 'Pathway'), node('g', 'Gate', microcyticNoHgbpathy() as never), node('s', 'Step')],
        [edge('root', 'g', 'HAS_GATE'), edge('g', 's', 'BRANCHES_TO')],
      );
      const engine = new TraversalEngine(
        { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [] }) } as never,
        { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
        makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' }),
        {},
        [mcvFact(72), conditionFact('c1', 'D56.1', { recordValidity: 'UNKNOWN' })],
        new Map(),
      );
      const r = await engine.traverse(graph, patient(), new Map());
      expect(r.pendingQuestions).toEqual([]);
      expect(r.resolutionState.get('g')!.status).toBe(NodeStatus.GATED_OUT);
      expect(r.resolutionState.get('g')!.indeterminate).toBe(true);
      expect(r.resolutionState.get('s')!.status).toBe(NodeStatus.GATED_OUT);
    });
  });
});

describe('not_includes_code under legacy-v0', () => {
  it('is the exact negation of legacy includes_code over patientContext', async () => {
    const gate = single(NOT_SCD('D57.0.*'));
    const none = await evaluateGate(gate, deps('legacy-v0'));
    expect(none.satisfied).toBe(true);
    expect(none.reason).toBe('No matching code D57.0.* found in patient conditions');
    const hbss = await evaluateGate(
      gate,
      deps('legacy-v0', {
        patientContext: patient({ conditionCodes: [{ code: 'D57.00', system: 'ICD-10' }] }),
      }),
    );
    expect(hbss.satisfied).toBe(false);
    expect(hbss.reason).toBe('Patient has matching code D57.0.* in conditions');
    // No kernel keys on the legacy path.
    expect(hbss).not.toHaveProperty('indeterminate');
  });
});

describe('not_includes_code in the operator vocabularies', () => {
  it('is a coded operator', () => {
    expect(VALID_CODED_OPERATORS).toContain('not_includes_code');
  });

  it('reachability classifies it as always evaluable (membership), never data-blocked', () => {
    expect(hasDataForCondition(NOT_SCD('D57.1'), patient(), new Map())).toBe(true);
  });
});

describe('not_includes_code at import', () => {
  function withCondition(condition: Record<string, unknown>): PathwayJson {
    const pw = clonePathway();
    pw.nodes.push({
      id: 'gate-n',
      type: 'Gate' as any,
      properties: { title: 'N', gate_type: 'patient_attribute', default_behavior: 'skip', condition },
    });
    pw.edges.push({ from: 'step-1-1', to: 'gate-n', type: 'HAS_GATE' as any });
    pw.edges.push({ from: 'gate-n', to: 'step-1-2', type: 'BRANCHES_TO' as any });
    return pw;
  }
  const errorsFor = (c: Record<string, unknown>) =>
    validatePathwayJson(withCondition(c)).errors.filter(e => e.includes('gate-n'));

  it('accepts it with a trailing-wildcard value, horizon and status', () => {
    expect(
      errorsFor({
        field: 'conditions', operator: 'not_includes_code', value: 'D57.0.*', system: 'ICD-10',
        horizon: 'LIFETIME', status: 'any',
      }),
    ).toEqual([]);
  });

  it('applies the same wildcard rule as includes_code', () => {
    const [err] = errorsFor({ field: 'conditions', operator: 'not_includes_code', value: 'D57.0*', system: 'ICD-10' });
    expect(err).toContain('not a wildcard the engine understands');
    expect(err).toContain('"D57.0.*"');
  });

  it('applies the same horizon / status rules (the runtime parsers)', () => {
    expect(
      errorsFor({ field: 'conditions', operator: 'not_includes_code', value: 'D57.1', horizon: 'FOREVER' })[0],
    ).toContain('horizon');
    expect(
      errorsFor({
        field: 'conditions', operator: 'not_includes_code', value: 'D57.1', horizon: 'YEAR', window_days: 30,
      })[0],
    ).toContain('not both');
    expect(
      errorsFor({ field: 'labs', operator: 'not_includes_code', value: '718-7', status: 'active' })[0],
    ).toContain('status');
  });

  it('refuses window_from on it, as on includes_code', () => {
    const [err] = errorsFor({
      field: 'conditions', operator: 'not_includes_code', value: 'D57.1',
      window_from: { event: 'medication_start', clinical_role: 'oral-iron-repletion' },
    });
    expect(err).toContain('window_from applies only to');
  });
});
