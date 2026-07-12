// apps/pathway-service/src/__tests__/anemia-pathway-e2e.test.ts
//
// End-to-end proof (no DB): builds the canonical anemia-in-pregnancy
// pathway as an in-memory GraphContext and runs it through a real
// TraversalEngine.traverse() to prove the field/attribute gate-condition
// model actually fires gates against a patient.

import {
  buildCanonicalAnemiaGraph,
  ANEMIA_GATE_IDS,
  ANEMIA_ACTION_IDS,
} from './fixtures/anemia-pathway-canonical';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { NodeStatus } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const CODE_MAP = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.ferritin', namespace: 'lab', system: 'LOINC', code: '2276-4', valueType: 'number' },
]);

// Mock confidence adapter — always scores high enough that any node the
// traversal engine actually reaches (i.e. not gated out) comes back
// INCLUDED. This isolates the proof to gate firing, not confidence scoring.
const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.9,
    breakdown: [
      { signalName: 'data_completeness', score: 0.9, weight: 1.0, weightSource: 'SYSTEM_DEFAULT', missingInputs: [] },
    ],
    resolutionType: 'AUTO_RESOLVED',
  }),
};

const mockThresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.60 };

function createEngine(): TraversalEngine {
  return new TraversalEngine(mockConfidenceEngine, mockThresholds, undefined, CODE_MAP);
}

function anemicSecondTrimesterPatient(): PatientContext {
  return {
    patientId: 'p', conditionCodes: [], medications: [], allergies: [],
    labResults: [{ code: '718-7', system: 'LOINC', value: 6.2 }], // Hb 6.2 → severe + t2 anemia
    vitalSigns: {}, freeformData: {},
    patientAttributes: { trimester: 2 },
  };
}

describe('canonical anemia pathway — gate firing (in-memory, no DB)', () => {
  it('severe-anemia gate fires for Hb 6.2 (< 7)', async () => {
    const graph = buildCanonicalAnemiaGraph();
    const engine = createEngine();
    const result = await engine.traverse(graph, anemicSecondTrimesterPatient(), new Map());

    // gate-severe-anemia: Hb 6.2 < 7 → satisfied → gate + downstream INCLUDED
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.SEVERE_ANEMIA)!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.SEVERE_ANEMIA)!.status).toBe(NodeStatus.INCLUDED);

    // gate-anemia-t2: trimester==2 AND Hb 6.2 < 10.5 → satisfied → gate + downstream INCLUDED
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.INCLUDED);
  });

  it('trimester gate does NOT fire when patientAttributes is absent (data-blocked / skip)', async () => {
    const graph = buildCanonicalAnemiaGraph();
    const engine = createEngine();
    const patient = { ...anemicSecondTrimesterPatient(), patientAttributes: undefined };
    const result = await engine.traverse(graph, patient, new Map());

    // No trimester data → patient.trimester resolves to undefined → the
    // AND compound is unsatisfied → default_behavior 'skip' → gate and its
    // downstream action node are GATED_OUT, never INCLUDED.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T2)!.status).not.toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T2)!.status).not.toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.GATED_OUT);

    // Meanwhile severe-anemia (labs-only condition) is unaffected by the
    // missing trimester data — proves the attribute path is independent.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.SEVERE_ANEMIA)!.status).toBe(NodeStatus.INCLUDED);
  });
});
