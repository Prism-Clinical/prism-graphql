// apps/pathway-service/src/__tests__/fixtures/reference-pathway.ts

import { PathwayJson } from '../../services/import/types';

/**
 * Reference pathway: Prior Uterine Surgery Management
 * Exercises all node types, edge types, and validation rules.
 * Used as the baseline across all import pipeline tests.
 */
export const REFERENCE_PATHWAY: PathwayJson = {
  schema_version: '1.0',
  pathway: {
    logical_id: 'CP-PriorUterineSurgery',
    title: 'Prior Uterine Surgery Management',
    version: '1.0',
    category: 'OBSTETRIC',
    scope: 'Management of patients with prior uterine surgical history',
    target_population: 'Pregnant patients with history of cesarean delivery or other uterine surgery',
    condition_codes: [
      { code: 'O34.211', system: 'ICD-10', description: 'Maternal care for unspecified type scar from previous cesarean delivery', usage: 'primary', grouping: 'prior_surgery' },
      { code: 'O34.29', system: 'ICD-10', description: 'Maternal care due to uterine scar from other previous surgery', usage: 'secondary', grouping: 'prior_surgery' },
    ],
  },
  nodes: [
    // Stage 1: Initial Assessment
    { id: 'stage-1', type: 'Stage', properties: { stage_number: 1, title: 'Initial Assessment', description: 'Gather surgical history and assess risk factors' } },
    { id: 'step-1-1', type: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Obtain Surgical History', description: 'Document type, number, and indication of prior uterine surgeries' } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Review Operative Reports', description: 'Review prior operative reports for incision type and complications' } },

    // Stage 2: Risk Stratification
    { id: 'stage-2', type: 'Stage', properties: { stage_number: 2, title: 'Risk Stratification', description: 'Determine delivery planning based on risk profile' } },
    { id: 'step-2-1', type: 'Step', properties: { stage_number: 2, step_number: 1, display_number: '2.1', title: 'Assess TOLAC Candidacy', description: 'Evaluate trial of labor after cesarean eligibility' } },

    // Decision Point: TOLAC vs Repeat Cesarean
    { id: 'dp-1', type: 'DecisionPoint', properties: { title: 'Delivery Method Decision', auto_resolve_eligible: true } },
    { id: 'crit-1', type: 'Criterion', properties: { description: 'Single prior low-transverse cesarean', code_system: 'ICD-10', code_value: 'O34.211', base_rate: 0.006, is_critical: true } },
    { id: 'crit-2', type: 'Criterion', properties: { description: 'Prior classical or T-incision', code_system: 'ICD-10', code_value: 'O34.29', base_rate: 0.04, is_critical: true } },

    // Stage 3: TOLAC pathway
    { id: 'stage-3', type: 'Stage', properties: { stage_number: 3, title: 'TOLAC Management', description: 'Management for trial of labor after cesarean' } },
    { id: 'step-3-1', type: 'Step', properties: { stage_number: 3, step_number: 1, display_number: '3.1', title: 'Continuous Fetal Monitoring', description: 'Apply continuous electronic fetal monitoring during labor' } },

    // Medication
    { id: 'med-1', type: 'Medication', properties: { name: 'Oxytocin', dose: '2 milliunits/min initial', route: 'IV', frequency: 'Titrate per protocol', role: 'acceptable' } },
    { id: 'med-2', type: 'Medication', properties: { name: 'Dinoprostone', dose: '10mg insert', route: 'Vaginal', frequency: 'Once', role: 'acceptable' } },
    { id: 'med-3', type: 'Medication', properties: { name: 'Misoprostol', dose: 'N/A', route: 'N/A', frequency: 'N/A', role: 'contraindicated' } },

    // Lab Test
    { id: 'lab-1', type: 'LabTest', properties: { name: 'Complete Blood Count', code_system: 'LOINC', code_value: '58410-2' } },

    // Procedure
    { id: 'proc-1', type: 'Procedure', properties: { name: 'Cesarean Delivery', code_system: 'CPT', code_value: '59510' } },

    // Evidence
    { id: 'ev-1', type: 'EvidenceCitation', properties: { reference_number: 1, title: 'ACOG Practice Bulletin No. 205: Vaginal Birth After Cesarean Delivery', source: 'Obstetrics & Gynecology', evidence_level: 'Level A', year: 2019 } },
    { id: 'ev-2', type: 'EvidenceCitation', properties: { reference_number: 2, title: 'Uterine Rupture Risk Factors', source: 'American Journal of Obstetrics & Gynecology', evidence_level: 'Level B', year: 2020 } },

    // Quality Metric
    { id: 'qm-1', type: 'QualityMetric', properties: { name: 'VBAC Success Rate', measure: 'Percentage of TOLAC attempts resulting in vaginal delivery', target: '>= 60%' } },

    // Schedule
    { id: 'sched-1', type: 'Schedule', properties: { interval: 'Every 15 minutes', duration: 'Throughout active labor', description: 'Fetal heart rate monitoring intervals during TOLAC' } },

    // Code entries
    { id: 'code-1', type: 'CodeEntry', properties: { system: 'ICD-10', code: 'O34.211', description: 'Low transverse cesarean scar' } },
    { id: 'code-2', type: 'CodeEntry', properties: { system: 'CPT', code: '59510', description: 'Cesarean delivery' } },
  ],
  edges: [
    // Root → Stages
    { from: 'root', to: 'stage-1', type: 'HAS_STAGE', properties: { order: 1 } },
    { from: 'root', to: 'stage-2', type: 'HAS_STAGE', properties: { order: 2 } },
    { from: 'root', to: 'stage-3', type: 'HAS_STAGE', properties: { order: 3 } },

    // Stage 1 → Steps
    { from: 'stage-1', to: 'step-1-1', type: 'HAS_STEP', properties: { order: 1 } },
    { from: 'stage-1', to: 'step-1-2', type: 'HAS_STEP', properties: { order: 2 } },

    // Stage 2 → Steps + Decision
    { from: 'stage-2', to: 'step-2-1', type: 'HAS_STEP', properties: { order: 1 } },
    { from: 'step-2-1', to: 'dp-1', type: 'HAS_DECISION_POINT' },

    // Decision Point → Criteria + Branches
    { from: 'dp-1', to: 'crit-1', type: 'HAS_CRITERION' },
    { from: 'dp-1', to: 'crit-2', type: 'HAS_CRITERION' },
    { from: 'dp-1', to: 'stage-3', type: 'BRANCHES_TO', properties: { label: 'TOLAC candidate', confidence_threshold: 0.7 } },

    // Stage 3 → Steps
    { from: 'stage-3', to: 'step-3-1', type: 'HAS_STEP', properties: { order: 1 } },

    // Step → Medication
    { from: 'step-3-1', to: 'med-1', type: 'USES_MEDICATION' },
    { from: 'step-3-1', to: 'med-2', type: 'USES_MEDICATION' },
    { from: 'step-3-1', to: 'med-3', type: 'USES_MEDICATION' },

    // Medication escalation (only between acceptable agents; contraindicated med-3 has no escalation path)
    { from: 'med-1', to: 'med-2', type: 'ESCALATES_TO' },

    // Step → Lab / Procedure
    { from: 'step-1-1', to: 'lab-1', type: 'HAS_LAB_TEST' },
    { from: 'step-2-1', to: 'proc-1', type: 'HAS_PROCEDURE' },

    // Evidence citations
    { from: 'dp-1', to: 'ev-1', type: 'CITES_EVIDENCE' },
    { from: 'crit-2', to: 'ev-2', type: 'CITES_EVIDENCE' },

    // Quality metric + Schedule
    { from: 'step-3-1', to: 'qm-1', type: 'HAS_QUALITY_METRIC' },
    { from: 'step-3-1', to: 'sched-1', type: 'HAS_SCHEDULE' },

    // Code entries
    { from: 'crit-1', to: 'code-1', type: 'HAS_CODE' },
    { from: 'proc-1', to: 'code-2', type: 'HAS_CODE' },
  ],
};

/**
 * Helper: deep-clone the reference pathway for mutation in tests.
 */
export function clonePathway(pw: PathwayJson = REFERENCE_PATHWAY): PathwayJson {
  return JSON.parse(JSON.stringify(pw));
}

/**
 * Minimal valid pathway with just one stage and one step.
 * Useful for tests that don't need full graph complexity.
 */
export const MINIMAL_PATHWAY: PathwayJson = {
  schema_version: '1.0',
  pathway: {
    logical_id: 'CP-Minimal',
    title: 'Minimal Test Pathway',
    version: '1.0',
    category: 'ACUTE_CARE',
    condition_codes: [
      { code: 'J06.9', system: 'ICD-10', description: 'Acute upper respiratory infection' },
    ],
  },
  nodes: [
    { id: 'stage-1', type: 'Stage', properties: { stage_number: 1, title: 'Assessment' } },
    { id: 'step-1-1', type: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'Initial Evaluation' } },
  ],
  edges: [
    { from: 'root', to: 'stage-1', type: 'HAS_STAGE', properties: { order: 1 } },
    { from: 'stage-1', to: 'step-1-1', type: 'HAS_STEP', properties: { order: 1 } },
  ],
};
