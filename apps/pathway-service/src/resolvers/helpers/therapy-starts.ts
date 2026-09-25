import type { Pool } from 'pg';
import type { GraphContext } from '../../services/confidence/types';
import { gateConditionLeaves } from '../../services/resolution/types';
import {
  parseWindowFrom,
  TherapyStartEvent,
} from '../../services/resolution/temporal/anchored-window';

/**
 * The care-plan source of `window_from` anchors: when did THIS pathway
 * recommend a drug of the class to this patient?
 *
 * `materializeCarePlan` writes one `patient_care_plans` row per commit, dated
 * `start_date = CURRENT_DATE`, with a MEDICATION intervention per recommended
 * drug whose `guideline_reference` reads `pathway:<pathwayId> node:<nodeId>`.
 * That row is the pathway's own, dated, provenance-tagged prescription — the
 * preferred anchor. Every commit inserts a NEW plan, so ALL matching rows are
 * returned and `withTherapyStarts` keeps the EARLIEST per class.
 *
 * Read once at session creation and pinned on the evaluation context, so the
 * session's retraversals and any replay anchor on the same set.
 */

/** The classes this pathway's `window_from` conditions anchor on. */
export function windowFromRoles(graphContext: GraphContext): Set<string> {
  const roles = new Set<string>();
  for (const node of graphContext.allNodes) {
    if (node.nodeType !== 'Gate') continue;
    const props = node.properties as Record<string, unknown> | undefined;
    if (!props) continue;
    // Nested condition groups included: a `window_from` two levels down still
    // needs its care-plan anchor loaded, or production asks for a date the
    // stored plan already holds.
    for (const c of gateConditionLeaves(props)) {
      const raw = (c as { window_from?: unknown } | null)?.window_from;
      if (raw === undefined) continue;
      try {
        roles.add(parseWindowFrom(raw, 'window_from').clinicalRole);
      } catch {
        // Malformed: the anchor sweep rejects the session with a named error
        // in a moment. Loading nothing for it here changes nothing.
      }
    }
  }
  return roles;
}

// `patient_care_plans.patient_id` is a UUID column: a non-UUID id (a test
// fixture, an MRN) would make Postgres reject the whole query rather than
// match nothing.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function referenceParts(ref: string): { pathwayId?: string; nodeId?: string } {
  return {
    pathwayId: /(?:^|\s)pathway:(\S+)/.exec(ref)?.[1],
    nodeId: /(?:^|\s)node:(\S+)/.exec(ref)?.[1],
  };
}

export async function loadCarePlanTherapyStarts(
  pool: Pick<Pool, 'query'>,
  input: { patientId: string; pathwayId: string; graphContext: GraphContext },
): Promise<TherapyStartEvent[]> {
  // No anchored condition — no query. Keeps every existing pathway's session
  // start byte-for-byte what it was.
  const roles = windowFromRoles(input.graphContext);
  if (roles.size === 0) return [];
  if (!UUID.test(input.patientId)) return [];

  // Every VERSION of this pathway is "this pathway": a v3 plan recommended the
  // same oral iron the v4 gate asks about. Node ids are resolved against the
  // CURRENT graph below, which relies on authors keeping node ids stable across
  // versions — the convention the importer's diffing already depends on.
  const versions = await pool.query(
    `SELECT id FROM pathway_graph_index
      WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)`,
    [input.pathwayId],
  );
  const pathwayIds = new Set<string>(
    (versions.rows as Array<{ id: string }>).map((r) => String(r.id)),
  );
  pathwayIds.add(input.pathwayId);

  // `to_char`, not the DATE itself: node-postgres parses DATE into a JS Date at
  // LOCAL midnight, which shifts the day in any timezone west of UTC.
  const rows = await pool.query(
    `SELECT i.id AS intervention_id,
            p.id AS care_plan_id,
            i.guideline_reference,
            to_char(p.start_date, 'YYYY-MM-DD') AS start_date
       FROM patient_care_plan_interventions i
       JOIN patient_care_plans p ON p.id = i.patient_care_plan_id
      WHERE p.patient_id = $1
        AND i.type = 'MEDICATION'
        AND i.status <> 'CANCELLED'
        AND p.status <> 'CANCELLED'
        AND i.guideline_reference IS NOT NULL`,
    [input.patientId],
  );

  const out: TherapyStartEvent[] = [];
  for (const row of rows.rows as Array<Record<string, unknown>>) {
    const { pathwayId, nodeId } = referenceParts(String(row.guideline_reference ?? ''));
    if (!pathwayId || !nodeId || !pathwayIds.has(pathwayId)) continue;
    const node = input.graphContext.getNode(nodeId);
    if (!node || node.nodeType !== 'Medication') continue;
    const role = (node.properties as Record<string, unknown> | undefined)?.clinical_role;
    if (typeof role !== 'string' || !roles.has(role)) continue;
    out.push({
      clinicalRole: role,
      date: String(row.start_date),
      source: {
        carePlanId: String(row.care_plan_id),
        interventionId: String(row.intervention_id),
        pathwayId,
        nodeId,
      },
    });
  }
  return out;
}
