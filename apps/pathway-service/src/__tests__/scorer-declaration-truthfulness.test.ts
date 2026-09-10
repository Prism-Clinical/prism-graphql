/**
 * A scorer's declaration must match what it actually READS.
 *
 * `scorer-context-inputs.test.ts` checks that every declared input is mapped
 * to a context key. It passed while `risk-magnitude` declared only a
 * graph-local `risk_value` and its `score()` reached into
 * `patientContext.allergies` — so adding an allergy re-scored no medication,
 * and the anti-drift test could not see it. Comparing a hand-written map to a
 * hand-written declaration proves the two AGREE, not that either is TRUE.
 *
 * So this reads the scorer SOURCE and checks the declaration against the
 * patient-context fields the code touches. It is the same shape as
 * `reconcilable-red-flag-types.test.ts`: the check has to reach past the
 * thing being checked, or it only confirms its own assumptions.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  DataCompletenessScorer,
  EvidenceStrengthScorer,
  PatientMatchQualityScorer,
  RiskMagnitudeScorer,
  CustomRulesScorer,
} from '../services/confidence';
import { contextKeysForInputs } from '../services/confidence/scorer-context-inputs';
import type { GraphNode, SignalDefinition, SignalScorer } from '../services/confidence/types';

const SCORER_DIR = join(__dirname, '../services/confidence/scorers');

/** Node types a scorer might treat specially. */
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

/** PatientContext field -> the context key that supplies it. */
const FIELD_TO_KEY: Record<string, string> = {
  conditionCodes: 'conditions',
  medications: 'medications',
  labResults: 'labs',
  allergies: 'allergies',
  vitalSigns: 'vitalSigns',
};

const SCORERS: Array<{ file: string; scorer: SignalScorer }> = [
  { file: 'data-completeness.ts', scorer: new DataCompletenessScorer() },
  { file: 'evidence-strength.ts', scorer: new EvidenceStrengthScorer() },
  { file: 'patient-match-quality.ts', scorer: new PatientMatchQualityScorer() },
  { file: 'risk-magnitude.ts', scorer: new RiskMagnitudeScorer() },
  { file: 'custom-rules.ts', scorer: new CustomRulesScorer() },
];

/** Patient-context fields this scorer's source actually reaches into. */
function fieldsReadBy(file: string): Set<string> {
  const src = readFileSync(join(SCORER_DIR, file), 'utf-8');
  // Strip comments so prose about a field is not mistaken for a read.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const found = new Set<string>();
  for (const field of Object.keys(FIELD_TO_KEY)) {
    if (new RegExp(`patientContext\\.${field}\\b`).test(code)) found.add(field);
  }
  return found;
}

/** Every context key this scorer declares, across all node types. */
function keysDeclaredBy(scorer: SignalScorer): Set<string> {
  const keys = new Set<string>();
  for (const nt of NODE_TYPES) {
    for (const k of contextKeysForInputs(scorer.declareRequiredInputs(node(nt), signal))) {
      keys.add(k);
    }
  }
  return keys;
}

describe('every scorer declares the patient context it reads', () => {
  it.each(SCORERS.map(s => [s.file, s.scorer] as const))(
    '%s',
    (file, scorer) => {
      const declared = keysDeclaredBy(scorer);
      const missing = [...fieldsReadBy(file)]
        .map(f => FIELD_TO_KEY[f])
        .filter(k => !declared.has(k));
      // A field read but not declared means a change to it re-scores nothing.
      expect(missing).toEqual([]);
    },
  );

  // The walk is worthless if it silently matches no files.
  it('found a scorer that reads patient context at all', () => {
    const any = SCORERS.some(s => fieldsReadBy(s.file).size > 0);
    expect(any).toBe(true);
  });

  it('covers every scorer file on disk', () => {
    const onDisk = readdirSync(SCORER_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const covered = SCORERS.map(s => s.file);
    // A new scorer must be added above, or it goes unchecked.
    expect(onDisk.filter(f => !covered.includes(f))).toEqual([]);
  });
});
