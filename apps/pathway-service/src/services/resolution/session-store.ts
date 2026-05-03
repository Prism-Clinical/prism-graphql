/**
 * Session Store — serialization + DB persistence for resolution sessions.
 *
 * Serialization functions convert Map/Set ↔ JSON for JSONB columns.
 * DB functions handle CRUD on pathway_resolution_sessions and analytics tables.
 */

import { Pool } from 'pg';
import {
  ResolutionState,
  NodeResult,
  DependencyMap,
  ResolutionSession,
  MatchedPathway,
  GateAnswer,
} from './types';
import { activeConditionPredicate } from '../snapshot/active-context-filter';

// ─── Helpers ───────────────────────────────────────────────────────

function mapOfSetsToObj(map: Map<string, Set<string>>): Record<string, string[]> {
  const obj: Record<string, string[]> = {};
  for (const [key, set] of map) {
    obj[key] = [...set];
  }
  return obj;
}

function objToMapOfSets(obj: Record<string, string[]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [key, arr] of Object.entries(obj)) {
    map.set(key, new Set(arr));
  }
  return map;
}

// ─── Gate Answer Serialization ─────────────────────────────────────

function serializeGateAnswers(answers: Map<string, GateAnswer>): Record<string, GateAnswer> {
  const obj: Record<string, GateAnswer> = {};
  for (const [key, value] of answers) {
    obj[key] = value;
  }
  return obj;
}

function deserializeGateAnswers(json: Record<string, GateAnswer> | null | undefined): Map<string, GateAnswer> {
  const map = new Map<string, GateAnswer>();
  if (!json) return map;
  for (const [key, value] of Object.entries(json)) {
    map.set(key, value as GateAnswer);
  }
  return map;
}

// ─── Serialization ─────────────────────────────────────────────────

export function serializeResolutionState(state: ResolutionState): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of state) {
    obj[key] = value;
  }
  return obj;
}

export function deserializeResolutionState(json: Record<string, unknown>): ResolutionState {
  const state = new Map<string, NodeResult>();
  for (const [key, value] of Object.entries(json)) {
    state.set(key, value as NodeResult);
  }
  return state;
}

export function serializeDependencyMap(depMap: DependencyMap): Record<string, unknown> {
  return {
    influencedBy: mapOfSetsToObj(depMap.influencedBy),
    influences: mapOfSetsToObj(depMap.influences),
    gateContextFields: mapOfSetsToObj(depMap.gateContextFields),
    scorerInputs: mapOfSetsToObj(depMap.scorerInputs),
  };
}

export function deserializeDependencyMap(json: Record<string, unknown>): DependencyMap {
  const raw = json as Record<string, Record<string, string[]>>;
  return {
    influencedBy: objToMapOfSets(raw.influencedBy ?? {}),
    influences: objToMapOfSets(raw.influences ?? {}),
    gateContextFields: objToMapOfSets(raw.gateContextFields ?? {}),
    scorerInputs: objToMapOfSets(raw.scorerInputs ?? {}),
  };
}

// ─── DB: Sessions ──────────────────────────────────────────────────

export async function createSession(
  pool: Pool,
  session: {
    pathwayId: string;
    pathwayVersion: string;
    patientId: string;
    providerId: string;
    status: string;
    initialPatientContext: unknown;
    resolutionState: ResolutionState;
    dependencyMap: DependencyMap;
    pendingQuestions: unknown[];
    redFlags: unknown[];
    gateAnswers?: Map<string, GateAnswer>;
    totalNodesEvaluated: number;
    traversalDurationMs: number;
  },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO pathway_resolution_sessions
     (pathway_id, pathway_version, patient_id, provider_id, status, initial_patient_context,
      resolution_state, dependency_map, pending_questions, red_flags, gate_answers,
      total_nodes_evaluated, traversal_duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      session.pathwayId,
      session.pathwayVersion,
      session.patientId,
      session.providerId,
      session.status,
      JSON.stringify(session.initialPatientContext),
      JSON.stringify(serializeResolutionState(session.resolutionState)),
      JSON.stringify(serializeDependencyMap(session.dependencyMap)),
      JSON.stringify(session.pendingQuestions),
      JSON.stringify(session.redFlags),
      JSON.stringify(serializeGateAnswers(session.gateAnswers ?? new Map())),
      session.totalNodesEvaluated,
      session.traversalDurationMs,
    ],
  );
  return result.rows[0].id;
}

export async function getSession(
  pool: Pool,
  sessionId: string,
): Promise<ResolutionSession | null> {
  const result = await pool.query(
    `SELECT s.*, p.title as pathway_title
     FROM pathway_resolution_sessions s
     LEFT JOIN pathway_graph_index p ON s.pathway_id = p.id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  const events = await pool.query(
    'SELECT * FROM pathway_resolution_events WHERE session_id = $1 ORDER BY created_at',
    [sessionId],
  );

  return {
    id: row.id,
    pathwayId: row.pathway_id,
    pathwayVersion: row.pathway_version,
    patientId: row.patient_id,
    providerId: row.provider_id,
    status: row.status,
    resolutionState: deserializeResolutionState(row.resolution_state),
    dependencyMap: deserializeDependencyMap(row.dependency_map),
    initialPatientContext: row.initial_patient_context,
    additionalContext: row.additional_context ?? {},
    pendingQuestions: row.pending_questions ?? [],
    redFlags: row.red_flags ?? [],
    resolutionEvents: events.rows,
    gateAnswers: deserializeGateAnswers(row.gate_answers),
    totalNodesEvaluated: row.total_nodes_evaluated,
    traversalDurationMs: row.traversal_duration_ms,
    carePlanId: row.care_plan_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateSession(
  pool: Pool,
  sessionId: string,
  updates: {
    status?: string;
    resolutionState?: ResolutionState;
    dependencyMap?: DependencyMap;
    additionalContext?: unknown;
    pendingQuestions?: unknown[];
    redFlags?: unknown[];
    gateAnswers?: Map<string, GateAnswer>;
    totalNodesEvaluated?: number;
    carePlanId?: string;
  },
  expectedUpdatedAt?: Date,
): Promise<void> {
  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.status) {
    sets.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.resolutionState) {
    sets.push(`resolution_state = $${idx++}`);
    values.push(JSON.stringify(serializeResolutionState(updates.resolutionState)));
  }
  if (updates.dependencyMap) {
    sets.push(`dependency_map = $${idx++}`);
    values.push(JSON.stringify(serializeDependencyMap(updates.dependencyMap)));
  }
  if (updates.additionalContext) {
    sets.push(`additional_context = $${idx++}`);
    values.push(JSON.stringify(updates.additionalContext));
  }
  if (updates.pendingQuestions) {
    sets.push(`pending_questions = $${idx++}`);
    values.push(JSON.stringify(updates.pendingQuestions));
  }
  if (updates.redFlags) {
    sets.push(`red_flags = $${idx++}`);
    values.push(JSON.stringify(updates.redFlags));
  }
  if (updates.gateAnswers) {
    sets.push(`gate_answers = $${idx++}`);
    values.push(JSON.stringify(serializeGateAnswers(updates.gateAnswers)));
  }
  if (updates.totalNodesEvaluated !== undefined) {
    sets.push(`total_nodes_evaluated = $${idx++}`);
    values.push(updates.totalNodesEvaluated);
  }
  if (updates.carePlanId) {
    sets.push(`care_plan_id = $${idx++}`);
    values.push(updates.carePlanId);
  }

  // Optimistic locking: if expectedUpdatedAt is provided, only update if the row
  // hasn't been modified by another request since we read it
  let whereClause = `id = $${idx++}`;
  values.push(sessionId);

  if (expectedUpdatedAt) {
    whereClause += ` AND updated_at = $${idx++}`;
    values.push(expectedUpdatedAt);
  }

  const result = await pool.query(
    `UPDATE pathway_resolution_sessions SET ${sets.join(', ')} WHERE ${whereClause}`,
    values,
  );

  if (expectedUpdatedAt && result.rowCount === 0) {
    throw new Error(
      'Session was modified by another request (optimistic lock conflict). Please reload and retry.',
    );
  }
}

// ─── DB: Events & Analytics ────────────────────────────────────────

export async function logEvent(
  pool: Pool,
  sessionId: string,
  event: {
    eventType: string;
    triggerData: unknown;
    nodesRecomputed: number;
    statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO pathway_resolution_events
     (session_id, event_type, trigger_data, nodes_recomputed, status_changes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      sessionId,
      event.eventType,
      JSON.stringify(event.triggerData),
      event.nodesRecomputed,
      JSON.stringify(event.statusChanges),
    ],
  );
}

export async function logNodeOverride(
  pool: Pool,
  data: {
    sessionId: string;
    nodeId: string;
    pathwayId: string;
    action: string;
    reason?: string;
    originalStatus: string;
    originalConfidence: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO pathway_node_overrides
     (session_id, node_id, pathway_id, action, reason, original_status, original_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.sessionId,
      data.nodeId,
      data.pathwayId,
      data.action,
      data.reason,
      data.originalStatus,
      data.originalConfidence,
    ],
  );
}

export async function logGateAnswer(
  pool: Pool,
  data: {
    sessionId: string;
    gateId: string;
    pathwayId: string;
    answer: unknown;
    gateOpened: boolean;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO pathway_gate_answers
     (session_id, gate_id, pathway_id, answer, gate_opened)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      data.sessionId,
      data.gateId,
      data.pathwayId,
      JSON.stringify(data.answer),
      data.gateOpened,
    ],
  );
}

// ─── DB: Queries ───────────────────────────────────────────────────

export async function getMatchedPathways(
  pool: Pool,
  patientId: string,
): Promise<MatchedPathway[]> {
  // Ontology-aware match: a pathway requiring E11 (Type 2 diabetes, broad) should
  // match a patient whose snapshot only carries E11.65 (with hyperglycemia, more
  // specific). The expanded_codes CTE unions the patient's literal snapshot
  // codes with all their ICD-10 ancestors via the icd10_codes ltree path.
  // Codes from other systems (or ICD-10 codes not in icd10_codes) pass through
  // the UNION's anchor side unchanged.
  const result = await pool.query(
    `WITH patient_codes AS (
       SELECT DISTINCT sc.code
       FROM snapshot_conditions sc
       JOIN patient_clinical_snapshots pcs ON sc.snapshot_id = pcs.id
       JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
       WHERE p.id = $1
         AND pcs.snapshot_version = (
           SELECT MAX(snapshot_version) FROM patient_clinical_snapshots
           WHERE epic_patient_id = p.epic_patient_id
         )
         AND sc.code IS NOT NULL
         AND ${activeConditionPredicate('sc')}
     ),
     expanded_codes AS (
       SELECT code FROM patient_codes
       UNION
       SELECT ancestor.code
       FROM patient_codes pc
       JOIN icd10_codes leaf ON leaf.code = pc.code
       JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
       WHERE ancestor.code != leaf.code
     ),
     pathway_totals AS (
       SELECT pathway_id, COUNT(*) AS total_codes
       FROM pathway_condition_codes
       GROUP BY pathway_id
     )
     SELECT pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
            pgi.status, pgi.condition_codes,
            array_agg(DISTINCT pc.code) AS matched_codes,
            pt.total_codes
     FROM pathway_graph_index pgi
     JOIN pathway_condition_codes pc ON pc.pathway_id = pgi.id
     JOIN expanded_codes ON expanded_codes.code = pc.code
     JOIN pathway_totals pt ON pt.pathway_id = pgi.id
     WHERE pgi.status = 'ACTIVE' AND pgi.is_active = true
     GROUP BY pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
              pgi.status, pgi.condition_codes, pt.total_codes
     ORDER BY pgi.title`,
    [patientId],
  );

  return result.rows.map(row => ({
    pathway: {
      id: row.id,
      logicalId: row.logical_id,
      title: row.title,
      version: row.version,
      category: row.category,
      status: row.status,
      conditionCodes: row.condition_codes,
    },
    matchedConditionCodes: row.matched_codes || [],
    matchScore: (row.matched_codes?.length || 0) / (row.total_codes || 1),
  }));
}

export async function getPatientSessions(
  pool: Pool,
  patientId: string,
  status?: string,
): Promise<Array<{
  id: string;
  pathwayId: string;
  pathwayTitle: string;
  status: string;
  totalNodesEvaluated: number;
  includedCount: number;
  redFlagCount: number;
  carePlanId: string | null;
  createdAt: string;
  updatedAt: string;
}>> {
  let query = `SELECT s.*, p.title as pathway_title
    FROM pathway_resolution_sessions s
    LEFT JOIN pathway_graph_index p ON s.pathway_id = p.id
    WHERE s.patient_id = $1`;
  const values: unknown[] = [patientId];

  if (status) {
    query += ' AND s.status = $2';
    values.push(status);
  }
  query += ' ORDER BY s.created_at DESC';

  const result = await pool.query(query, values);

  return result.rows.map((row) => {
    const rs = row.resolution_state || {};
    const included = Object.values(rs).filter(
      (n: unknown) => (n as NodeResult).status === 'INCLUDED',
    );
    return {
      id: row.id,
      pathwayId: row.pathway_id,
      pathwayTitle: row.pathway_title || '',
      status: row.status,
      totalNodesEvaluated: row.total_nodes_evaluated,
      includedCount: included.length,
      redFlagCount: (row.red_flags || []).length,
      carePlanId: row.care_plan_id,
      createdAt: row.created_at?.toISOString(),
      updatedAt: row.updated_at?.toISOString(),
    };
  });
}
