// apps/pathway-service/src/__tests__/fixtures/reference-pathway-with-gates.ts

import { PathwayJson } from '../../services/import/types';
import { REFERENCE_PATHWAY, clonePathway } from './reference-pathway';

/**
 * Gate node IDs used in the fixture.
 */
export const GATE_IDS = {
  TRANSPLANT_SCREEN: 'gate-transplant-screen',
  PRIOR_CESAREAN: 'gate-prior-cesarean',
  MED_MONITORING: 'gate-med-monitoring',
} as const;

/**
 * Step node IDs added behind each gate.
 */
export const GATED_STEP_IDS = {
  IMMUNOSUPPRESSION: 'step-immunosuppression',
  CESAREAN_SPECIFIC: 'step-cesarean-specific',
  MED_MONITORING: 'step-med-monitoring',
} as const;

/**
 * Creates a deep clone of REFERENCE_PATHWAY with 3 Gate nodes and
 * corresponding gated Step nodes wired via HAS_GATE / BRANCHES_TO edges.
 *
 * Gate 1 (patient_attribute): gate-transplant-screen
 *   Attached to stage-3, guards step-immunosuppression.
 *   Condition: patient has Z94.* in conditions (organ transplant).
 *   Default: skip (most patients are not transplant recipients).
 *
 * Gate 2 (question): gate-prior-cesarean
 *   Attached to stage-2, guards step-cesarean-specific.
 *   Prompt: "Was the prior uterine surgery a cesarean delivery?"
 *   Boolean answer type, default: skip.
 *
 * Gate 3 (prior_node_result): gate-med-monitoring
 *   Attached to stage-3, guards step-med-monitoring.
 *   Depends on step-3-1 being INCLUDED.
 *   Default: skip.
 */
export function createPathwayWithGates(): PathwayJson {
  const pw = clonePathway(REFERENCE_PATHWAY);

  // ── Gate nodes ──────────────────────────────────────────────────────

  pw.nodes.push(
    // Gate 1: patient_attribute — transplant screening
    {
      id: GATE_IDS.TRANSPLANT_SCREEN,
      type: 'Gate',
      properties: {
        title: 'Transplant Recipient Screen',
        gate_type: 'patient_attribute',
        default_behavior: 'skip',
        condition: {
          field: 'conditions',
          operator: 'includes_code',
          value: 'Z94.*',
          system: 'ICD-10',
        },
      },
    },

    // Gate 2: question — prior cesarean confirmation
    {
      id: GATE_IDS.PRIOR_CESAREAN,
      type: 'Gate',
      properties: {
        title: 'Prior Cesarean Confirmation',
        gate_type: 'question',
        default_behavior: 'skip',
        prompt: 'Was the prior uterine surgery a cesarean delivery?',
        answer_type: 'BOOLEAN',
      },
    },

    // Gate 3: prior_node_result — medication monitoring depends on step-3-1
    {
      id: GATE_IDS.MED_MONITORING,
      type: 'Gate',
      properties: {
        title: 'Medication Monitoring Gate',
        gate_type: 'prior_node_result',
        default_behavior: 'skip',
        depends_on: [
          { node_id: 'step-3-1', status: 'INCLUDED' },
        ],
      },
    },
  );

  // ── Gated Step nodes ────────────────────────────────────────────────

  pw.nodes.push(
    {
      id: GATED_STEP_IDS.IMMUNOSUPPRESSION,
      type: 'Step',
      properties: {
        stage_number: 3,
        step_number: 10,
        display_number: '3.10',
        title: 'Immunosuppression Considerations',
        description: 'Adjust medication plan for transplant recipients on immunosuppressive therapy',
      },
    },
    {
      id: GATED_STEP_IDS.CESAREAN_SPECIFIC,
      type: 'Step',
      properties: {
        stage_number: 2,
        step_number: 10,
        display_number: '2.10',
        title: 'Cesarean-Specific Risk Assessment',
        description: 'Additional risk assessment specific to prior cesarean delivery',
      },
    },
    {
      id: GATED_STEP_IDS.MED_MONITORING,
      type: 'Step',
      properties: {
        stage_number: 3,
        step_number: 11,
        display_number: '3.11',
        title: 'Medication Monitoring Protocol',
        description: 'Enhanced monitoring when fetal monitoring step is included',
      },
    },
  );

  // ── Edges: HAS_GATE (parent → gate) ────────────────────────────────

  pw.edges.push(
    { from: 'stage-3', to: GATE_IDS.TRANSPLANT_SCREEN, type: 'HAS_GATE' },
    { from: 'stage-2', to: GATE_IDS.PRIOR_CESAREAN, type: 'HAS_GATE' },
    { from: 'stage-3', to: GATE_IDS.MED_MONITORING, type: 'HAS_GATE' },
  );

  // ── Edges: BRANCHES_TO (gate → gated step) ─────────────────────────

  pw.edges.push(
    { from: GATE_IDS.TRANSPLANT_SCREEN, to: GATED_STEP_IDS.IMMUNOSUPPRESSION, type: 'BRANCHES_TO' },
    { from: GATE_IDS.PRIOR_CESAREAN, to: GATED_STEP_IDS.CESAREAN_SPECIFIC, type: 'BRANCHES_TO' },
    { from: GATE_IDS.MED_MONITORING, to: GATED_STEP_IDS.MED_MONITORING, type: 'BRANCHES_TO' },
  );

  return pw;
}
