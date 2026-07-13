// apps/pathway-service/src/__tests__/fixtures/anemia-pathway-canonical.ts
//
// Canonical `anemia-in-pregnancy` pathway, built directly as an in-memory
// GraphContext (no DB, no PathwayJson import layer) — mirrors the
// hand-built Gate fixtures in `traversal-engine.test.ts` (see the
// `gate-transplant` / `gate-question` / `gate-dep` examples there).
//
// One Stage → one Step, with the Step HAS_GATE-ing each of the 5 canonical
// anemia-in-pregnancy gates. Each gate BRANCHES_TO a distinct downstream
// action node so firing is observable purely as node-status inclusion /
// exclusion in the TraversalEngine result.

import { GraphContext, GraphNode, GraphEdge } from '../../services/confidence/types';
import { GateType, DefaultBehavior } from '../../services/resolution/types';
import { makeGraphContext } from './reference-patient-context';

/** Stable gate node ids — referenced by the e2e proof test. */
export const ANEMIA_GATE_IDS = {
  SEVERE_ANEMIA: 'gate-severe-anemia',
  ANEMIA_T2: 'gate-anemia-t2',
  ANEMIA_T1T3: 'gate-anemia-t1t3',
  IRON_DEFICIENT: 'gate-iron-deficient',
  ORAL_IRON_RESPONSE: 'gate-oral-iron-response',
} as const;

/** Stable downstream action node ids, one per gate, distinct so gate firing is observable. */
export const ANEMIA_ACTION_IDS = {
  SEVERE_ANEMIA: 'action-severe-anemia-transfusion',
  ANEMIA_T2: 'action-anemia-t2-oral-iron',
  ANEMIA_T1T3: 'action-anemia-t1t3-oral-iron',
  IRON_DEFICIENT: 'action-iron-deficient-workup',
  ORAL_IRON_RESPONSE: 'action-oral-iron-response-recheck',
} as const;

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } };
}

function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} };
}

/**
 * Builds the canonical anemia-in-pregnancy pathway as an in-memory
 * GraphContext: root Pathway → Stage → Step, with the Step HAS_GATE-ing
 * all 5 canonical gates from the field/attribute gate-condition reference
 * table, each BRANCHES_TO-ing a distinct downstream action node.
 */
export function buildCanonicalAnemiaGraph(): GraphContext {
  const nodes: GraphNode[] = [
    node('root', 'Pathway', { title: 'Anemia in Pregnancy' }),
    node('stage-1', 'Stage', { title: 'Anemia Screening & Management' }),
    node('step-1', 'Step', { title: 'Anemia Gate Evaluation' }),

    // ── Gate 1: severe anemia — Hb < 7 (coded/labs condition) ──────────
    node(ANEMIA_GATE_IDS.SEVERE_ANEMIA, 'Gate', {
      title: 'Severe Anemia (Hb < 7)',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'labs',
        operator: 'less_than',
        value: '718-7',
        system: 'LOINC',
        threshold: 7,
      },
    }),

    // ── Gate 2: 2nd-trimester anemia — trimester==2 AND Hb < 10.5 ──────
    node(ANEMIA_GATE_IDS.ANEMIA_T2, 'Gate', {
      title: 'Anemia, 2nd Trimester (Hb < 10.5)',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { attribute: 'patient.trimester', operator: 'equals', value: 2 },
        { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 10.5 },
      ],
    }),

    // ── Gate 3: 1st/3rd-trimester anemia — trimester in [1,3] AND Hb < 11 ──
    node(ANEMIA_GATE_IDS.ANEMIA_T1T3, 'Gate', {
      title: 'Anemia, 1st/3rd Trimester (Hb < 11)',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { attribute: 'patient.trimester', operator: 'in', value: [1, 3] },
        { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
      ],
    }),

    // ── Gate 4: iron deficiency — ferritin < 30 (coded/labs condition) ──
    node(ANEMIA_GATE_IDS.IRON_DEFICIENT, 'Gate', {
      title: 'Iron Deficient (Ferritin < 30)',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'labs',
        operator: 'less_than',
        value: '2276-4',
        system: 'LOINC',
        threshold: 30,
      },
    }),

    // ── Gate 5: oral iron response — Hb rose ≥1 g/dL within 14 days ────
    node(ANEMIA_GATE_IDS.ORAL_IRON_RESPONSE, 'Gate', {
      title: 'Oral Iron Response (Hb delta ≥ 1 in 14d)',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '718-7',
        system: 'LOINC',
        delta_threshold: 1,
        window_days: 14,
      },
    }),

    // ── Distinct downstream action nodes, one per gate ─────────────────
    node(ANEMIA_ACTION_IDS.SEVERE_ANEMIA, 'Medication', {
      title: 'Transfusion / IV Iron for Severe Anemia',
    }),
    node(ANEMIA_ACTION_IDS.ANEMIA_T2, 'Medication', {
      title: 'Oral Iron Supplementation (2nd Trimester)',
    }),
    node(ANEMIA_ACTION_IDS.ANEMIA_T1T3, 'Medication', {
      title: 'Oral Iron Supplementation (1st/3rd Trimester)',
    }),
    node(ANEMIA_ACTION_IDS.IRON_DEFICIENT, 'LabTest', {
      title: 'Iron Studies Workup',
    }),
    node(ANEMIA_ACTION_IDS.ORAL_IRON_RESPONSE, 'LabTest', {
      title: 'Recheck CBC — Oral Iron Response',
    }),
  ];

  const edges: GraphEdge[] = [
    edge('root', 'stage-1'),
    edge('stage-1', 'step-1'),

    // Step HAS_GATE each of the 5 canonical gates
    edge('step-1', ANEMIA_GATE_IDS.SEVERE_ANEMIA, 'HAS_GATE'),
    edge('step-1', ANEMIA_GATE_IDS.ANEMIA_T2, 'HAS_GATE'),
    edge('step-1', ANEMIA_GATE_IDS.ANEMIA_T1T3, 'HAS_GATE'),
    edge('step-1', ANEMIA_GATE_IDS.IRON_DEFICIENT, 'HAS_GATE'),
    edge('step-1', ANEMIA_GATE_IDS.ORAL_IRON_RESPONSE, 'HAS_GATE'),

    // Each gate BRANCHES_TO its own distinct downstream action node
    edge(ANEMIA_GATE_IDS.SEVERE_ANEMIA, ANEMIA_ACTION_IDS.SEVERE_ANEMIA, 'BRANCHES_TO'),
    edge(ANEMIA_GATE_IDS.ANEMIA_T2, ANEMIA_ACTION_IDS.ANEMIA_T2, 'BRANCHES_TO'),
    edge(ANEMIA_GATE_IDS.ANEMIA_T1T3, ANEMIA_ACTION_IDS.ANEMIA_T1T3, 'BRANCHES_TO'),
    edge(ANEMIA_GATE_IDS.IRON_DEFICIENT, ANEMIA_ACTION_IDS.IRON_DEFICIENT, 'BRANCHES_TO'),
    edge(ANEMIA_GATE_IDS.ORAL_IRON_RESPONSE, ANEMIA_ACTION_IDS.ORAL_IRON_RESPONSE, 'BRANCHES_TO'),
  ];

  return makeGraphContext(nodes, edges);
}
