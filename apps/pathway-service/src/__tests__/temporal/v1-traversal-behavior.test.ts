/**
 * Plan 04 Task 9's behavioural proofs, on the evaluation pipeline.
 *
 * 1. The pathway-default cascade, proven behaviourally (P1-16).
 * 2. The P1-2 flip: `addPatientContext` flips a previously unsatisfied gate,
 *    and its subtree follows — every mutation now re-evaluates from inputs,
 *    so there is no stale subtree to be left behind.
 *
 * The engines are real: fixtures/resolver-harness replaces only the session
 * table and the snapshot loader.
 */
jest.mock('../../services/resolution/session-store', () => require('../fixtures/resolver-harness').sessionStoreMock());
jest.mock('../../services/resolution/pipeline/load-env', () => require('../fixtures/resolver-harness').loadEnvMock());

import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { DefaultBehavior, GateType, NodeStatus } from '../../services/resolution/types';
import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';
import { harness } from '../fixtures/resolver-harness';
import { edge, makeEnv, node } from '../fixtures/pipeline-env';

const PINNED = '2026-01-15T08:30:00.000Z';
/** 200 days before PINNED — inside YEAR (365d), outside v1's QUARTER (90d). */
const TWO_HUNDRED_DAYS_AGO = '2025-06-29';
/** 10 days before PINNED — inside every horizon under test. */
const RECENT = '2026-01-05';

/**
 * A scalar lab gate. `default_behavior: skip` is load-bearing: without it an
 * unsatisfied gate is included anyway and nothing below would prove anything.
 * `on_unresolved: 'default'` opts out of escalation, so an absent lab gates
 * out rather than pending.
 */
const NODES = [
  node('root', 'Pathway'),
  node('gate-1', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'default',
    condition: { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 9 },
  }),
  node('step-1', 'Step'),
];
const EDGES = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];

async function start(labResults: Array<Record<string, unknown>>, temporalDefaults: PathwayTemporalDefaults, version: string): Promise<string> {
  harness.addPathway('pw-1', makeEnv(NODES, EDGES, {}, { temporalDefaults }));
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults },
  } as never, harness.context({ temporalPolicyVersion: version }));
  return (s as { id: string }).id;
}
const state = (id: string) => harness.session(id).resolutionState;

beforeEach(() => harness.reset());

describe('the pathway-default cascade, proven behaviorally (moved from Task 3, P1-16)', () => {
  const OLD_LAB = [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO }];

  it('admits a 200-day-old lab when the pathway default is YEAR and v1 says QUARTER', async () => {
    const id = await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(state(id).get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
  });

  it('excludes the same lab when the pathway sets no default', async () => {
    const id = await start(OLD_LAB, {}, 'v1');
    const gate = state(id).get('gate-1')!;
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
    // NO_MATCH, not INDETERMINATE: the horizon dropped the only candidate.
    expect(gate.excludeReason).toBe('No numeric value found for labs:718-7');
  });

  it('is a v1-only delta — legacy-v0 admits the old lab with or without the default', async () => {
    const a = await start(OLD_LAB, {}, 'legacy-v0');
    expect(state(a).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    const b = await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'legacy-v0');
    expect(state(b).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a lab inside v1’s own QUARTER needs no pathway default', async () => {
    const id = await start([{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT }], {}, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});

describe('addPatientContext changes what a gate decides (the P1-2 flip test)', () => {
  it('re-resolves a previously unsatisfied gate once the new fact arrives', async () => {
    const id = await start([], {}, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(state(id).get('step-1')!.status).toBe(NodeStatus.GATED_OUT);
    // The gate reads `labs`; the pipeline keeps that as gateContextFields (spec §1).
    expect(harness.session(id).gateContextFields.get('gate-1')).toContain('labs');

    await resolutionMutations.addPatientContext(undefined, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT }] },
    }, harness.context({ temporalPolicyVersion: 'v1' }));

    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(state(id).get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
    expect(state(id).get('step-1')!.excludeReason).toBeUndefined();
    expect(state(id).get('gate-1')!.excludeReason).toBeUndefined();
  });

  it('a lab outside the v1 horizon does NOT flip the gate', async () => {
    const id = await start([], {}, 'v1');
    await resolutionMutations.addPatientContext(undefined, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO }] },
    }, harness.context({ temporalPolicyVersion: 'v1' }));
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});
