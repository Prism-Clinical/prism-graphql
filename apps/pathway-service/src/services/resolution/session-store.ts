/**
 * Session Store — serialization + DB persistence for resolution sessions.
 *
 * Serialization functions convert Map/Set ↔ JSON for JSONB columns.
 * DB functions handle CRUD on pathway_resolution_sessions and analytics tables.
 */

import { Pool } from 'pg';
import { EvaluationTemporalContext } from './temporal/evaluation-context';
import {
  ResolutionState,
  NodeResult,
  DependencyMap,
  ResolutionSession,
  MatchedPathway,
  MatchedCodeSet,
  MatchedCodeSetMember,
  GateAnswer,
  ProviderOverride,
  SessionStatus,
} from './types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import type { EvaluationResult, LlmObservation, SessionInputs } from './pipeline/types';
import { activeConditionPredicate } from '../snapshot/active-context-filter';
import { findAncestors } from '../codes/icd10-hierarchy';

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

// ─── Inputs + evaluation cache (evaluation pipeline, spec §1/§4) ─────

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = Pick<Pool, 'query'>;

/** An LLM gate call, recorded whether or not it succeeded (spec §4, Audit). */
export interface LlmAuditRow {
  gateId: string;
  pathwayId: string;
  inputAttribute: string | null;
  inputText: string;
  prompt: string;
  branches: unknown;
  model: string;
  chosenBranch: string | null;
  confidence: number | null;
  reasoning: string | null;
  fullResponse: unknown;
  tentative: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
}

export interface NewSession {
  pathwayVersion: string;
  patientId: string;
  providerId: string;
  inputs: SessionInputs;
  result: EvaluationResult;
  status: SessionStatus;
  durationMs: number;
  parentSessionId?: string;
}

const objOf = <V>(m: Map<string, V>): Record<string, V> => Object.fromEntries(m);
const mapOf = <V>(o: Record<string, V> | null | undefined): Map<string, V> => new Map(Object.entries(o ?? {}));
/** JSONB parameters are sent as JSON text; scalars pass through. */
const param = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** The columns an evaluation writes: the session's mutable inputs and the cache of its result. */
export function evaluationColumns(args: {
  inputs: SessionInputs;
  result: EvaluationResult;
  status: SessionStatus;
  durationMs: number;
}): Record<string, unknown> {
  const { inputs, result } = args;
  return {
    status: args.status,
    additional_context: inputs.additionalContext,
    gate_answers: objOf(inputs.gateAnswers),
    provider_overrides: objOf(inputs.providerOverrides),
    observations: objOf(inputs.observations),
    resolution_state: serializeResolutionState(result.resolutionState),
    pending_questions: result.pendingQuestions,
    red_flags: result.redFlags,
    ddi_warnings: result.safetyFindings.filter((f) => f.action === 'WARN'),
    readiness: result.readiness,
    gate_context_fields: objOf(result.gateContextFields),
    catch_up_items: result.catchUpItems,
    env_fingerprint: result.envFingerprint,
    result_hash: result.resultHash,
    total_nodes_evaluated: result.resolutionState.size,
    traversal_duration_ms: Math.round(args.durationMs),
  };
}

/** Every column of a new row: identity, the immutable inputs, then `evaluationColumns`. */
export function insertColumns(s: NewSession): Record<string, unknown> {
  return {
    pathway_id: s.inputs.pathwayId,
    pathway_version: s.pathwayVersion,
    patient_id: s.patientId,
    provider_id: s.providerId,
    initial_patient_context: s.inputs.initialPatientContext,
    temporal_context: s.inputs.temporalContext,
    graph_fingerprint: s.inputs.graphFingerprint,
    parent_session_id: s.parentSessionId ?? null,
    ...evaluationColumns(s),
  };
}

export async function insertSession(db: Db, s: NewSession): Promise<string> {
  // Types are erased and tests are not typechecked: a clock-less row would be
  // unevaluable forever, so refuse it here rather than at the NOT NULL.
  if (!s.inputs.temporalContext) {
    throw new Error('insertSession requires temporalContext — a session with no pinned clock cannot be evaluated');
  }
  const cols = insertColumns(s);
  const names = Object.keys(cols);
  const result = await db.query(
    `INSERT INTO pathway_resolution_sessions (${names.join(', ')})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    names.map((n) => param(cols[n])),
  );
  return result.rows[0].id;
}

/**
 * Commit an evaluation as a compare-and-set on `revision` (spec §4). Returns
 * false when another write moved the row or it left ACTIVE/DEGRADED; the caller
 * rolls back and retries. `status: COMPLETED` is generation's claim.
 */
export async function writeEvaluation(
  db: Db,
  args: { sessionId: string; expectedRevision: number; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number },
): Promise<boolean> {
  const cols = evaluationColumns(args);
  const names = Object.keys(cols);
  const result = await db.query(
    `UPDATE pathway_resolution_sessions
        SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}, revision = revision + 1, updated_at = NOW()
      WHERE id = $${names.length + 1} AND revision = $${names.length + 2} AND status IN ('ACTIVE', 'DEGRADED')`,
    [...names.map((n) => param(cols[n])), args.sessionId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Lifecycle-only change (abandon): no evaluation, same revision check (spec §4). */
export async function writeLifecycleStatus(
  db: Db,
  args: { sessionId: string; expectedRevision: number; status: SessionStatus },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE pathway_resolution_sessions
        SET status = $1, revision = revision + 1, updated_at = NOW()
      WHERE id = $2 AND revision = $3 AND status IN ('ACTIVE', 'DEGRADED')`,
    [args.status, args.sessionId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Inside generation's claimed transaction only. */
export async function setCarePlanId(db: Db, sessionId: string, carePlanId: string): Promise<void> {
  await db.query('UPDATE pathway_resolution_sessions SET care_plan_id = $1 WHERE id = $2', [carePlanId, sessionId]);
}

/**
 * A stored row as a session. Missing JSON columns read as empty rather than
 * crashing: every row written after migration 067 has them, and test fixtures
 * that predate them keep working.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSession(row: any, events: unknown[]): ResolutionSession {
  return {
    id: row.id,
    pathwayId: row.pathway_id,
    pathwayVersion: row.pathway_version,
    patientId: row.patient_id,
    providerId: row.provider_id,
    status: row.status,
    revision: row.revision ?? 0,
    resolutionState: deserializeResolutionState(row.resolution_state ?? {}),
    dependencyMap: deserializeDependencyMap(row.dependency_map ?? {}),
    initialPatientContext: row.initial_patient_context,
    additionalContext: row.additional_context ?? {},
    pendingQuestions: row.pending_questions ?? [],
    redFlags: row.red_flags ?? [],
    resolutionEvents: events as ResolutionSession['resolutionEvents'],
    gateAnswers: mapOf<GateAnswer>(row.gate_answers),
    providerOverrides: mapOf<ProviderOverride>(row.provider_overrides),
    observations: mapOf<LlmObservation>(row.observations),
    graphFingerprint: row.graph_fingerprint ?? '',
    envFingerprint: row.env_fingerprint ?? '',
    resultHash: row.result_hash ?? '',
    readiness: row.readiness ?? { ready: false, blockers: [] },
    gateContextFields: mapOf<string[]>(row.gate_context_fields),
    catchUpItems: row.catch_up_items ?? [],
    totalNodesEvaluated: row.total_nodes_evaluated,
    traversalDurationMs: row.traversal_duration_ms,
    carePlanId: row.care_plan_id,
    ddiWarnings: row.ddi_warnings ?? [],
    // pg parses JSONB; `?? undefined` turns SQL NULL into undefined.
    temporalContext: (row.temporal_context ?? undefined) as EvaluationTemporalContext | undefined,
    parentSessionId: row.parent_session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The inputs a mutation starts from: fresh copies, so changing them cannot edit the loaded session. */
export function inputsOf(session: ResolutionSession): SessionInputs {
  if (!session.temporalContext) {
    throw new Error(`session ${session.id} has no pinned clock and cannot be evaluated`);
  }
  return {
    pathwayId: session.pathwayId,
    graphFingerprint: session.graphFingerprint,
    temporalContext: session.temporalContext,
    initialPatientContext: session.initialPatientContext,
    additionalContext: { ...(session.additionalContext as Partial<AdditionalContextInput>) },
    gateAnswers: new Map(session.gateAnswers),
    providerOverrides: new Map(session.providerOverrides),
    observations: new Map(session.observations),
    revision: session.revision,
  };
}

/** The event log's statusChanges: the previous cache against the new result, in nodeId order (spec §1 rule 2). */
export function statusChangesBetween(
  prev: ResolutionState,
  next: ResolutionState,
): Array<{ nodeId: string; from: string; to: string }> {
  const ids = [...new Set([...prev.keys(), ...next.keys()])].sort();
  const changes: Array<{ nodeId: string; from: string; to: string }> = [];
  for (const nodeId of ids) {
    const from = prev.get(nodeId)?.status ?? 'ABSENT';
    const to = next.get(nodeId)?.status ?? 'ABSENT';
    if (from !== to) changes.push({ nodeId, from, to });
  }
  return changes;
}

/** Moved from resolution-context's flushAudits; runs inside the caller's transaction. */
export async function writeLlmAudits(db: Db, sessionId: string, rows: LlmAuditRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `INSERT INTO llm_gate_evaluations (
         session_id, gate_id, pathway_id, input_attribute, input_text,
         prompt, branches, model, chosen_branch, confidence, reasoning,
         full_response, tentative, error_message, latency_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        sessionId, row.gateId, row.pathwayId, row.inputAttribute, row.inputText,
        row.prompt, JSON.stringify(row.branches), row.model, row.chosenBranch, row.confidence,
        row.reasoning, row.fullResponse ? JSON.stringify(row.fullResponse) : null,
        row.tentative, row.errorMessage, row.latencyMs,
      ],
    );
  }
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
    ddiWarnings?: unknown[];
    // Required on the way IN, optional on the way OUT. Every session created
    // from now on has a clock, and a required parameter is what lets the
    // compiler prove it — a new call site that forgets one is a build error,
    // not a session that silently cannot be retraversed. The column and
    // ResolutionSession.temporalContext stay optional for pre-migration rows.
    temporalContext: EvaluationTemporalContext;
  },
): Promise<string> {
  // The declared type is not a runtime guard: tsconfig excludes src/__tests__
  // and types are erased anyway, so an untyped caller can reach here without a
  // clock. Serializing that to NULL would mint a session that is already
  // non-retraversable — a silent, permanent defect in a brand new row. NULL is
  // reserved for rows that predate migration 063; nothing may create one now.
  if (!session.temporalContext) {
    throw new Error(
      'createSession requires temporalContext — a session with no pinned evaluation clock cannot be retraversed',
    );
  }

  const result = await pool.query(
    `INSERT INTO pathway_resolution_sessions
     (pathway_id, pathway_version, patient_id, provider_id, status, initial_patient_context,
      resolution_state, dependency_map, pending_questions, red_flags, gate_answers,
      total_nodes_evaluated, traversal_duration_ms, ddi_warnings, temporal_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
      JSON.stringify(session.ddiWarnings ?? []),
      JSON.stringify(session.temporalContext),
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

  return rowToSession(row, events.rows);
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
    /**
     * DDI warnings. Writable now that DDI re-runs after every state-changing
     * resolution — it used to run only at session creation, so there was
     * nothing to update.
     */
    ddiWarnings?: unknown[];
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
  if (updates.ddiWarnings) {
    sets.push(`ddi_warnings = $${idx++}`);
    values.push(JSON.stringify(updates.ddiWarnings));
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
  // hasn't been modified by another request since we read it.
  //
  // Precision note: Postgres TIMESTAMPTZ has microsecond precision, but
  // node-pg deserialises into a JS Date which only carries milliseconds.
  // If we compared `updated_at = $expected` directly, every guard would
  // fail whenever the row's timestamp has any sub-millisecond content
  // (i.e. almost always), because the parameter round-trips as
  // `.529000` while the row is stored as e.g. `.529591`. Truncating the
  // row's timestamp to milliseconds before the comparison matches the
  // precision of the JS Date we're comparing against.
  let whereClause = `id = $${idx++}`;
  values.push(sessionId);

  if (expectedUpdatedAt) {
    whereClause += ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${idx++}::timestamptz)`;
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
  db: Db,
  sessionId: string,
  event: {
    eventType: string;
    triggerData: unknown;
    nodesRecomputed: number;
    statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  },
): Promise<void> {
  await db.query(
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
  db: Db,
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
  await db.query(
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
  db: Db,
  data: {
    sessionId: string;
    gateId: string;
    pathwayId: string;
    answer: unknown;
    gateOpened: boolean;
  },
): Promise<void> {
  await db.query(
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

interface PatientLiteralCode {
  code: string;
  system: string;
}

export interface GetMatchedPathwaysOptions {
  /**
   * When provided, the matcher uses these codes directly instead of looking
   * up the patient row in `snapshot_conditions`. Use for synthetic patients
   * (admin simulator, what-if analysis) where there's no EMR-synced row.
   */
  directPatientCodes?: PatientLiteralCode[];
  /**
   * When true, also matches DRAFT pathways (default false matches only ACTIVE).
   * Use for admin QA tooling. Production encounter callers should leave this
   * false so providers don't see unfinished pathways.
   */
  includeDraftPathways?: boolean;
}

/**
 * Phase 1b set-based matcher.
 *
 * A pathway matches when at least one of its code sets is fully covered by
 * the patient's expanded code set (set member ∈ patient_codes ∪ ancestors).
 * For each matched pathway we collect the matched sets, identify the most
 * specific (largest) one, and compute coverage of the patient's literal
 * problems against that set.
 */
export async function getMatchedPathways(
  pool: Pool,
  patientId: string,
  options: GetMatchedPathwaysOptions = {},
): Promise<MatchedPathway[]> {
  const { directPatientCodes, includeDraftPathways = false } = options;
  const useDirectCodes = directPatientCodes !== undefined;

  // The patient_codes CTE either pulls from snapshot_conditions (real patient)
  // or is built from a VALUES list (synthetic patient). We branch the SQL up
  // front so the rest of the CTE chain reads from a uniform `patient_codes`.
  const patientCodesCte = useDirectCodes
    ? buildDirectCodesCte(directPatientCodes ?? [])
    : `SELECT DISTINCT sc.code, 'ICD-10' AS system
       FROM snapshot_conditions sc
       JOIN patient_clinical_snapshots pcs ON sc.snapshot_id = pcs.id
       JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
       WHERE p.id = $1
         AND pcs.snapshot_version = (
           SELECT MAX(snapshot_version) FROM patient_clinical_snapshots
           WHERE epic_patient_id = p.epic_patient_id
         )
         AND sc.code IS NOT NULL
         AND ${activeConditionPredicate('sc')}`;

  // When draft pathways are included, also relax the is_active filter — drafts
  // carry is_active=false because they haven't been published yet, but for QA
  // tooling we still want to surface them.
  const statusAndActiveFilter = includeDraftPathways
    ? `pgi.status IN ('ACTIVE', 'DRAFT') AND (pgi.is_active = true OR pgi.status = 'DRAFT')`
    : `pgi.status = 'ACTIVE' AND pgi.is_active = true`;

  const queryParams = useDirectCodes ? [] : [patientId];

  const matchedRowsRes = await pool.query(
    `WITH patient_codes AS (
       ${patientCodesCte}
     ),
     expanded_codes AS (
       SELECT code, system FROM patient_codes
       UNION
       SELECT ancestor.code, 'ICD-10' AS system
       FROM patient_codes pc
       JOIN icd10_codes leaf ON leaf.code = pc.code
       JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
       WHERE ancestor.code != leaf.code
         AND pc.system = 'ICD-10'
     ),
     matched_set_ids AS (
       SELECT cs.id AS set_id, cs.pathway_id
       FROM pathway_code_sets cs
       WHERE NOT EXISTS (
         SELECT 1 FROM pathway_code_set_members m
         WHERE m.code_set_id = cs.id
           AND NOT EXISTS (
             SELECT 1 FROM expanded_codes e
             WHERE e.code = m.code AND e.system = m.system
           )
       )
     )
     SELECT
       pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
       pgi.status, pgi.condition_codes,
       ARRAY_AGG(ms.set_id) AS matched_set_ids
     FROM pathway_graph_index pgi
     JOIN matched_set_ids ms ON ms.pathway_id = pgi.id
     WHERE ${statusAndActiveFilter}
     GROUP BY pgi.id, pgi.logical_id, pgi.title, pgi.version, pgi.category,
              pgi.status, pgi.condition_codes
     ORDER BY pgi.title`,
    queryParams,
  );

  if (matchedRowsRes.rows.length === 0) return [];

  // Patient's literal active codes for the addressed/unaddressed computation.
  // Synthetic-patient callers use the codes they passed; real-patient callers
  // re-query snapshot_conditions.
  let patientLiteralCodes: PatientLiteralCode[];
  if (useDirectCodes) {
    patientLiteralCodes = (directPatientCodes ?? []).map((c) => ({
      code: c.code,
      system: c.system,
    }));
  } else {
    const patientCodesRes = await pool.query(
      `SELECT DISTINCT sc.code, 'ICD-10' AS system
         FROM snapshot_conditions sc
         JOIN patient_clinical_snapshots pcs ON sc.snapshot_id = pcs.id
         JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
        WHERE p.id = $1
          AND pcs.snapshot_version = (
            SELECT MAX(snapshot_version) FROM patient_clinical_snapshots
            WHERE epic_patient_id = p.epic_patient_id
          )
          AND sc.code IS NOT NULL
          AND ${activeConditionPredicate('sc')}`,
      [patientId],
    );
    patientLiteralCodes = patientCodesRes.rows.map((r) => ({
      code: r.code,
      system: r.system,
    }));
  }

  // 3. Fetch all matched code sets (with their members) in one query.
  const allMatchedSetIds = Array.from(
    new Set(matchedRowsRes.rows.flatMap((r) => r.matched_set_ids as string[])),
  );
  const setsByIdMap = await fetchCodeSetsWithMembers(pool, allMatchedSetIds);

  // 4. Compose each MatchedPathway.
  const composed: MatchedPathway[] = [];
  for (const row of matchedRowsRes.rows) {
    const matchedSets: MatchedCodeSet[] = (row.matched_set_ids as string[])
      .map((id) => setsByIdMap.get(id))
      .filter((s): s is MatchedCodeSet => s !== undefined);

    if (matchedSets.length === 0) continue;

    const mostSpecific = matchedSets.reduce((a, b) =>
      a.memberCount >= b.memberCount ? a : b,
    );

    const { addressed, unaddressed } = await computeCoverage(
      pool,
      patientLiteralCodes,
      mostSpecific.members,
    );

    const total = addressed.length + unaddressed.length;
    const matchScore = total === 0 ? 0 : addressed.length / total;

    const matchedConditionCodes = Array.from(
      new Set(matchedSets.flatMap((s) => s.members.map((m) => m.code))),
    );

    composed.push({
      pathway: {
        id: row.id,
        logicalId: row.logical_id,
        title: row.title,
        version: row.version,
        category: row.category,
        status: row.status,
        conditionCodes: row.condition_codes,
      },
      matched: true,
      matchedSets,
      mostSpecificMatchedSet: mostSpecific,
      specificityDepth: mostSpecific.memberCount,
      patientCodesAddressed: addressed,
      patientCodesUnaddressed: unaddressed,
      matchScore,
      matchedConditionCodes,
    });
  }
  return composed;
}

/**
 * Build the body of the `patient_codes` CTE from a caller-supplied code list.
 * Used for synthetic patients (admin simulator) where there's no real EMR row.
 *
 * Returns a `SELECT … UNION ALL …` literal so the surrounding WITH clause can
 * read from `patient_codes` uniformly. Codes/systems are escaped via single-
 * quote doubling — they're short clinical identifiers, not free text, so this
 * is safe and avoids the parameter-expansion plumbing that VALUES would need.
 */
function buildDirectCodesCte(codes: PatientLiteralCode[]): string {
  if (codes.length === 0) {
    // Empty patient_codes — produces zero matches. Use a no-row SELECT.
    return `SELECT NULL::text AS code, NULL::text AS system WHERE FALSE`;
  }
  const escape = (s: string) => s.replace(/'/g, "''");
  const lines = codes.map(
    (c) => `SELECT '${escape(c.code)}'::text AS code, '${escape(c.system)}'::text AS system`,
  );
  return lines.join('\n       UNION ALL\n       ');
}

/**
 * Fetch a batch of code sets with their members, returned as a Map keyed by set id.
 */
async function fetchCodeSetsWithMembers(
  pool: Pool,
  setIds: string[],
): Promise<Map<string, MatchedCodeSet>> {
  if (setIds.length === 0) return new Map();
  const result = await pool.query(
    `SELECT cs.id, cs.description, cs.scope, cs.entry_node_id,
            COALESCE(
              jsonb_agg(
                jsonb_build_object('code', m.code, 'system', m.system)
                ORDER BY m.code
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'::jsonb
            ) AS members
     FROM pathway_code_sets cs
     LEFT JOIN pathway_code_set_members m ON m.code_set_id = cs.id
     WHERE cs.id = ANY($1::uuid[])
     GROUP BY cs.id, cs.description, cs.scope, cs.entry_node_id`,
    [setIds],
  );
  const out = new Map<string, MatchedCodeSet>();
  for (const row of result.rows) {
    const members: MatchedCodeSetMember[] = (row.members as MatchedCodeSetMember[]) ?? [];
    out.set(row.id, {
      setId: row.id,
      description: row.description,
      scope: row.scope,
      entryNodeId: row.entry_node_id,
      members,
      memberCount: members.length,
    });
  }
  return out;
}

/**
 * For each patient literal code, decide whether it falls under any member of
 * the most-specific matched set. ICD-10 codes are matched literally OR via
 * ancestor relationships (using the icd10_codes hierarchy). Non-ICD-10
 * codes only match literally.
 */
async function computeCoverage(
  pool: Pool,
  patientCodes: PatientLiteralCode[],
  members: MatchedCodeSetMember[],
): Promise<{ addressed: string[]; unaddressed: string[] }> {
  const addressed: string[] = [];
  const unaddressed: string[] = [];

  const memberSet = new Set(members.map((m) => `${m.system}|${m.code}`));

  for (const pc of patientCodes) {
    const literalKey = `${pc.system}|${pc.code}`;
    if (memberSet.has(literalKey)) {
      addressed.push(pc.code);
      continue;
    }

    if (pc.system === 'ICD-10') {
      const ancestors = await findAncestors(pool, pc.code);
      const covered = ancestors.some((a) => memberSet.has(`ICD-10|${a}`));
      if (covered) addressed.push(pc.code);
      else unaddressed.push(pc.code);
    } else {
      unaddressed.push(pc.code);
    }
  }

  return { addressed, unaddressed };
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
