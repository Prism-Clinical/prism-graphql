/**
 * Which context changes can move a node's confidence.
 *
 * `dependencyMap.scorerInputs` is read by `addPatientContext` to decide which
 * action nodes need re-scoring, and nothing ever wrote to it. The information
 * needed to write it already existed: every scorer implements
 * `declareRequiredInputs`, it is covered by tests, and no production code had
 * ever called it. Two constructs authored and never consumed, closed against
 * each other.
 *
 * The mapping between the two vocabularies is hand-written, which is how the
 * last one rotted. So the first test here walks every scorer and asserts the
 * map covers what they actually declare — a new input name fails this suite
 * rather than silently widening every node's dependencies.
 */

import {
  DataCompletenessScorer,
  EvidenceStrengthScorer,
  PatientMatchQualityScorer,
  RiskMagnitudeScorer,
  CustomRulesScorer,
} from '../services/confidence';
import {
  contextKeysForInputs,
  isMappedInput,
  CONTEXT_KEYS,
} from '../services/confidence/scorer-context-inputs';
import type { GraphNode, SignalDefinition, RequiredInput } from '../services/confidence/types';

const NODE_TYPES = [
  'LabTest', 'Medication', 'DecisionPoint', 'Criterion', 'Step',
  'Stage', 'Procedure', 'Imaging', 'EvidenceCitation', 'Gate',
];

function node(nodeType: string): GraphNode {
  return {
    id: `n-${nodeType}`, nodeIdentifier: `n-${nodeType}`, nodeType,
    properties: { title: nodeType },
  } as GraphNode;
}

const signal = { name: 's', scoringType: 'DATA_COMPLETENESS' } as unknown as SignalDefinition;

/** Every builtin scorer. A new one must be added here to stay covered. */
const SCORERS = [
  new DataCompletenessScorer(),
  new EvidenceStrengthScorer(),
  new PatientMatchQualityScorer(),
  new RiskMagnitudeScorer(),
  new CustomRulesScorer(),
];

function allDeclaredInputs(): RequiredInput[] {
  const out: RequiredInput[] = [];
  for (const scorer of SCORERS) {
    for (const nt of NODE_TYPES) out.push(...scorer.declareRequiredInputs(node(nt), signal));
  }
  return out;
}

describe('the declared-input vocabulary stays mapped', () => {
  it('has a mapping for every patient_context input any scorer declares', () => {
    const unmapped = allDeclaredInputs()
      .filter(i => i.source === 'patient_context')
      .map(i => i.name)
      .filter(name => !isMappedInput(name));
    // If this fails, add the new input to INPUT_TO_CONTEXT_KEYS. Until then it
    // resolves to every key, which is safe but re-scores far too much.
    expect([...new Set(unmapped)]).toEqual([]);
  });

  it('finds something to map — the walk is not silently scoring nothing', () => {
    const patientInputs = allDeclaredInputs().filter(i => i.source === 'patient_context');
    expect(patientInputs.length).toBeGreaterThan(0);
  });
});

describe('contextKeysForInputs', () => {
  it('maps a lab input to the labs context key', () => {
    expect([...contextKeysForInputs([
      { name: 'result_value', source: 'patient_context', required: true },
    ])]).toEqual(['labs']);
  });

  // Added context cannot change the pathway, so a graph input is not a
  // dependency on it.
  it('ignores graph_node inputs', () => {
    expect([...contextKeysForInputs([
      { name: 'criteria_resolved', source: 'graph_node', required: true },
    ])]).toEqual([]);
  });

  it('unions the keys of several inputs', () => {
    const keys = contextKeysForInputs([
      { name: 'result_value', source: 'patient_context', required: true },
      { name: 'allergies_checked', source: 'patient_context', required: true },
    ]);
    expect([...keys].sort()).toEqual(['allergies', 'labs']);
  });

  // A custom rule may read anything, so it depends on everything.
  it('treats the custom-rules catch-all as depending on all context', () => {
    const keys = contextKeysForInputs([
      { name: 'patient_context', source: 'patient_context', required: false },
    ]);
    expect(keys.size).toBe(CONTEXT_KEYS.length);
  });

  // Failing conservative: needless re-scoring, never a missed one.
  it('treats an unrecognised input as depending on everything', () => {
    const keys = contextKeysForInputs([
      { name: 'something_new', source: 'patient_context', required: true },
    ]);
    expect(keys.size).toBe(CONTEXT_KEYS.length);
  });
});
