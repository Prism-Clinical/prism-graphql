/**
 * Temporal wiring now has ONE engine construction site (evaluate) and ONE
 * input path (inputsOf → evaluateSession). These tests replace the per-entry-
 * point suites (pathway-defaults-threading, retraversal-clock-reuse, the
 * retraversal half of resolution-fact-store-wiring): they prove every mutation
 * reaches that site with the stored clock and the accumulated facts.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/traversal-engine', () => {
  const actual = jest.requireActual('../services/resolution/traversal-engine');
  class RecordingEngine extends actual.TraversalEngine {
    constructor(...args: unknown[]) {
      // @ts-expect-error — spread into the real constructor
      super(...args);
      require('./fixtures/resolver-harness').harness.recordEngine(args);
    }
  }
  return { ...actual, TraversalEngine: RecordingEngine };
});
jest.mock('../services/resolution/temporal/context-assembler', () => {
  const actual = jest.requireActual('../services/resolution/temporal/context-assembler');
  return { ...actual, assembleContext: jest.fn(actual.assembleContext) };
});
jest.mock('../services/resolution/temporal/fact-store', () => {
  const actual = jest.requireActual('../services/resolution/temporal/fact-store');
  return { ...actual, factStoreFor: jest.fn(actual.factStoreFor) };
});

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { DEFAULT_TEMPORAL_POLICY_VERSION } from '../services/resolution/temporal/evaluation-context';
import { factStoreFor } from '../services/resolution/temporal/fact-store';
import { DefaultBehavior, GateType, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-01-15T08:30:00.000Z';
const RECENT = '2026-01-05';
/** A distinct object, so identity can be asserted. */
const DEFAULTS = { horizons: { labs: 'YEAR' } } as never;
const ENV = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-1', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'default',
      condition: { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 9 } }),
    node('step-1', 'Step'),
  ],
  [edge('root', 'gate-1'), edge('gate-1', 'step-1')],
  {},
  { temporalDefaults: DEFAULTS },
);
const HB = (value: number, date = RECENT) => ({ code: '718-7', system: 'LOINC', value, unit: 'g/dL', date });

async function start(patient: Record<string, unknown>, context: Record<string, unknown>, extraArgs: Record<string, unknown> = {}): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw-t', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
    ...extraArgs,
  } as never, harness.context(context));
  return (s as { id: string }).id;
}
const later = (id: string, version: string) => ({
  addLab: (lab: Record<string, unknown>) =>
    resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { labResults: [lab] } } as never, harness.context({ temporalPolicyVersion: version })),
  override: () =>
    resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'step-1', action: OverrideAction.INCLUDE }, harness.context({ temporalPolicyVersion: version })),
});

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-t', ENV);
  (assembleContext as jest.Mock).mockClear();
  (factStoreFor as jest.Mock).mockClear();
});

describe('temporal wiring through the pipeline', () => {
  it('legacy-v0 never invokes the assembler — at start or on any later mutation', async () => {
    // A lab date v1's assembler would reject: legacy-v0 must start anyway (P1-9).
    const id = await start({ labResults: [HB(12, 'not-a-date')] }, { temporalPolicyVersion: 'legacy-v0' });
    await later(id, 'legacy-v0').addLab(HB(10));
    await later(id, 'legacy-v0').override();
    expect(assembleContext).not.toHaveBeenCalled();
    expect((factStoreFor as jest.Mock).mock.results.every((r) => r.value.length === 0)).toBe(true);
  });

  it('v1 assembles from the start payload, and again with the new facts, on every later mutation', async () => {
    const id = await start({ labResults: [HB(12)] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').addLab({ code: '2345-7', system: 'LOINC', value: 90, unit: 'mg/dL', date: RECENT });
    await later(id, 'v1').override();

    const calls = (factStoreFor as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    const codes = (i: number) => calls[i][0].labResults.map((l: { code: string }) => l.code);
    expect(codes(0)).toEqual(['718-7']);
    expect(codes(1)).toEqual(['718-7', '2345-7']);
    expect(codes(2)).toEqual(['718-7', '2345-7']);
    expect((factStoreFor as jest.Mock).mock.results[0].value.length).toBeGreaterThan(0);
  });

  it('a v1 session with no encounterStart still starts and hands its vitals to the assembler', async () => {
    await start({ vitalSigns: { systolic_bp: 120 } }, { temporalPolicyVersion: 'v1' });
    expect((factStoreFor as jest.Mock).mock.calls[0][0].vitalSigns).toEqual({ systolic_bp: 120 });
  });

  it('later mutations evaluate under the clock stored at start, not the wall clock', async () => {
    const id = await start({}, { temporalPolicyVersion: 'v1' });
    const stored = harness.session(id).temporalContext;
    await later(id, 'v1').override();

    expect(stored!.evaluationAsOf).toBe(PINNED);
    expect(harness.engineArgs).toHaveLength(2);
    expect(harness.engineArgs[1][2]).toEqual(stored);
    expect((factStoreFor as jest.Mock).mock.calls[1][1]).toEqual(stored);
  });

  it('the engine receives the pathway temporal defaults by identity', async () => {
    await start({}, { temporalPolicyVersion: 'v1' });
    expect(harness.engineArgs[0][3]).toBe(DEFAULTS);
  });

  it('the same inputs assemble the same facts on every evaluation', async () => {
    const id = await start({ labResults: [HB(12)] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').override(); // changes no patient fact
    const results = (factStoreFor as jest.Mock).mock.results;
    expect(results[1].value).toEqual(results[0].value);
  });

  it('the policy version is the server’s: the default, an injected one, never the request’s', async () => {
    const byDefault = await start({}, {});
    expect(harness.session(byDefault).temporalContext!.temporalPolicyVersion).toBe(DEFAULT_TEMPORAL_POLICY_VERSION);

    const injected = await start({}, { temporalPolicyVersion: 'legacy-v0' });
    expect(harness.session(injected).temporalContext!.temporalPolicyVersion).toBe('legacy-v0');

    const ignored = await start({}, { temporalPolicyVersion: 'legacy-v0' }, { temporalPolicyVersion: 'v99' });
    expect(harness.session(ignored).temporalContext!.temporalPolicyVersion).toBe('legacy-v0');
  });

  it('addPatientContext treats an explicit null assertion as omitted, and leaves stored facts alone', async () => {
    const id = await start({ labResults: [{ ...HB(12), recordValidity: 'INVALID' }] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').addLab({ ...HB(10, '2026-01-10'), recordValidity: null });

    const s = harness.session(id);
    expect(s.initialPatientContext.labResults[0]).toMatchObject({ recordValidity: 'INVALID' });
    expect((s.additionalContext as { labResults: Array<Record<string, unknown>> }).labResults[0]).not.toHaveProperty('recordValidity');
  });
});
