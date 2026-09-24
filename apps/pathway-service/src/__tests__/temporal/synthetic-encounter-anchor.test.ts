/**
 * What anchoring a synthetic session's encounter at "now" actually does.
 *
 * startMultiPathwayResolution sets encounterStart = evaluationAsOf for a
 * syntheticPatient run that supplies none. That makes the ENCOUNTER horizon
 * ZERO-width: [asOf, asOf]. This pins the consequences, through the real
 * preflight, horizon resolution, assembler and selection:
 *  - the preflight no longer rejects a vitals-reading pathway;
 *  - a synthetic vital (always undated, asserted current at asOf) matches;
 *  - anything dated before the evaluation instant does NOT — acceptable for
 *    the simulator, which has no encounter to date anything within.
 */

jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { assertEncounterAnchor, ResolutionContext } from '../../resolvers/helpers/resolution-context';
import {
  makeEvaluationTemporalContext,
  resolveHorizon,
} from '../../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { GraphNode } from '../../services/confidence/types';

const AS_OF = '2026-09-24T12:00:00.000Z';
const clock = makeEvaluationTemporalContext({
  evaluationAsOf: AS_OF, encounterStart: AS_OF, temporalPolicyVersion: 'v1',
});

const vitalsGate: GraphNode = {
  id: 'g-bp', nodeIdentifier: 'g-bp', nodeType: 'Gate',
  properties: {
    title: 'BP check', gate_type: 'patient_attribute', default_behavior: 'skip',
    condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
  },
};
const rctx = {
  graphContext: {
    allNodes: [vitalsGate], allEdges: [],
    incomingEdges: () => [], outgoingEdges: () => [], getNode: () => undefined, linkedNodes: () => [],
  },
  edges: [], signals: [], thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
  confidenceEngine: {}, codeMap: new Map(), temporalDefaults: {},
} as unknown as ResolutionContext;

describe('synthetic encounter anchored at the evaluation instant', () => {
  it('passes the real preflight that rejected it without an anchor', () => {
    expect(() => assertEncounterAnchor(rctx, clock)).not.toThrow();
  });

  it('a synthetic vital matches the zero-width ENCOUNTER window; a past-dated lab does not', () => {
    const horizon = resolveHorizon('ENCOUNTER', clock);
    expect(horizon).toEqual({ lowerBound: AS_OF, upperBound: AS_OF });

    const store = assembleContext(
      {
        mode: 'SYNTHETIC',
        patientContext: {
          patientId: 'p', conditionCodes: [], medications: [], allergies: [],
          labResults: [{ code: '718-7', system: 'LOINC', value: 9, date: '2026-09-24T08:00:00.000Z' }],
          vitalSigns: { systolicBP: 150 },
        },
      } as never,
      clock,
    );

    const vital = store.find(f => f.kind === 'vital')!;
    expect(vital).toBeDefined();
    const vitalOut = selectFacts(
      { field: 'vitals', operator: 'greater_than', value: vital.code, system: vital.system },
      store, { horizon },
    );
    expect(vitalOut.status).toBe('READY');

    const labOut = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, store, { horizon },
    );
    expect(labOut.status).toBe('NO_MATCH');
  });
});
