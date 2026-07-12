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

// 1st-trimester analog of the above: Hb 9.0 satisfies the t1/t3 anemia
// threshold (< 11) but not severe-anemia (< 7). trimester: 1 is the value
// that must be found inside the `in [1, 3]` array-operator condition for
// gate-anemia-t1t3 to fire — this is the headline array-operator proof.
// Also carries a ferritin lab below 30 so gate-iron-deficient's coded/labs
// condition fires on the same patient.
function firstTrimesterAnemicPatient(): PatientContext {
  return {
    patientId: 'p2', conditionCodes: [], medications: [], allergies: [],
    labResults: [
      { code: '718-7', system: 'LOINC', value: 9.0 },  // Hb 9.0 < 11 → t1/t3 anemia
      { code: '2276-4', system: 'LOINC', value: 12 },  // ferritin 12 < 30 → iron deficient
    ],
    vitalSigns: {}, freeformData: {},
    patientAttributes: { trimester: 1 },
  };
}

// Dated 2-point Hb series rising ≥1 g/dL within the 14-day window that
// gate-oral-iron-response's delta_from_baseline condition requires.
// Dates are computed relative to the real clock (Date.now()) because the
// TraversalEngine path (unlike direct evaluateGate() unit tests) does not
// expose an injectable `now` — production callers always evaluate against
// Date.now(), so this fixture must too.
function oralIronResponseRisingPatient(): PatientContext {
  const now = Date.now();
  const daysAgo = (n: number): string => new Date(now - n * 86_400_000).toISOString();
  return {
    patientId: 'p3', conditionCodes: [], medications: [], allergies: [],
    labResults: [
      { code: '718-7', system: 'LOINC', value: 8.5, date: daysAgo(13) },
      { code: '718-7', system: 'LOINC', value: 9.8, date: daysAgo(1) },
    ],
    vitalSigns: {}, freeformData: {},
    patientAttributes: {},
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

    // Within-run negative discriminator: gate-anemia-t1t3 requires
    // trimester in [1, 3]. This patient is trimester 2, so the compound
    // AND is unsatisfied regardless of Hb — proving INCLUDED above isn't
    // automatic (a non-firing gate in the same run still gates out its
    // own subtree).
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T1T3)!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T1T3)!.status).toBe(NodeStatus.GATED_OUT);

    // gate-iron-deficient: this patient has no ferritin (2276-4) lab at
    // all → getNumericValue finds nothing → not satisfied → GATED_OUT.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.IRON_DEFICIENT)!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.IRON_DEFICIENT)!.status).toBe(NodeStatus.GATED_OUT);

    // gate-oral-iron-response: this patient's single Hb lab entry carries
    // no `date`, so collectLabSeries() drops it — 0 points is below the
    // delta_from_baseline minimum of 2 → not satisfied → GATED_OUT. See
    // the dedicated positive-path test below for the firing case.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ORAL_IRON_RESPONSE)!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ORAL_IRON_RESPONSE)!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('anemia-t1t3 gate fires via the `in [1, 3]` array operator for a 1st-trimester patient, and discriminates against t2', async () => {
    const graph = buildCanonicalAnemiaGraph();
    const engine = createEngine();
    const result = await engine.traverse(graph, firstTrimesterAnemicPatient(), new Map());

    // gate-anemia-t1t3: trimester 1 ∈ [1, 3] (array `in` operator) AND
    // Hb 9.0 < 11 → compound AND satisfied → gate + downstream INCLUDED.
    // This is the assertion that would catch a regression of the operand
    // shape from an array [1, 3] to a stringly-typed "1,3".
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T1T3)!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T1T3)!.status).toBe(NodeStatus.INCLUDED);

    // gate-anemia-t2 requires trimester == 2; this patient is trimester 1,
    // so the compound AND is unsatisfied — proves the `in` vs `equals`
    // operators discriminate correctly on the same attribute value.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ANEMIA_T2)!.status).toBe(NodeStatus.GATED_OUT);

    // gate-severe-anemia: Hb 9.0 is not < 7 → not satisfied → GATED_OUT.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.SEVERE_ANEMIA)!.status).toBe(NodeStatus.GATED_OUT);

    // gate-iron-deficient: ferritin 12 < 30 → coded/labs condition
    // satisfied → gate + downstream INCLUDED.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.IRON_DEFICIENT)!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.IRON_DEFICIENT)!.status).toBe(NodeStatus.INCLUDED);
  });

  it('oral-iron-response gate fires via delta_from_baseline for a rising dated Hb series', async () => {
    const graph = buildCanonicalAnemiaGraph();
    const engine = createEngine();
    const result = await engine.traverse(graph, oralIronResponseRisingPatient(), new Map());

    // gate-oral-iron-response: Hb rose from 8.5 (13 days ago) to 9.8
    // (1 day ago) — a delta of +1.3 within the 14-day window, meeting the
    // delta_threshold of 1 → satisfied → gate + downstream INCLUDED.
    expect(result.resolutionState.get(ANEMIA_GATE_IDS.ORAL_IRON_RESPONSE)!.status).toBe(NodeStatus.INCLUDED);
    expect(result.resolutionState.get(ANEMIA_ACTION_IDS.ORAL_IRON_RESPONSE)!.status).toBe(NodeStatus.INCLUDED);
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
