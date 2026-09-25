import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { DataSourceContext, NodeStatus, OverrideAction, SessionStatus } from '../../types';
import { PatientContext, CodeEntry, LabResult } from '../../services/confidence/types';
import {
  parseResolutionInput,
  firstTrustAssertion,
  normalizeContextEntryNulls,
  ResolutionModeArgs,
  RawPatientContextInput,
} from '../../services/resolution/temporal/trust-mode';
import type { ResolutionInput } from '../../services/resolution/temporal/trust-mode';
import { assertAssemblableMode } from '../../services/resolution/temporal/context-assembler';
import type { TemporalContextInput } from '../../services/resolution/temporal/evaluation-context';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import { PATHWAY_COLUMNS, formatSessionForGraphQL } from '../Query';
import {
  inputsOf,
  insertSession,
  logEvent,
  logGateAnswer,
  logNodeOverride,
  setCarePlanId,
  writeEvaluation,
  writeLifecycleStatus,
  writeLlmAudits,
} from '../../services/resolution/session-store';
import type { Db } from '../../services/resolution/session-store';
import type { DdiFinding } from '../../services/medications/ddi-pass';
import { childChange, commitRun } from '../../services/resolution/pipeline/run-commit';
import { generateCarePlan } from '../../services/resolution/care-plan-generator';
import type { CarePlanData } from '../../services/resolution/care-plan-generator';
import type { GateAnswer, GateProperties, ProviderOverride, ResolutionSession } from '../../services/resolution/types';
import { resolveTemporalPolicyVersion } from '../helpers/resolution-context';
import { validateAnswerAgainstGate } from '../../services/resolution/answer-validation';
import { normalizePatientAttributes } from '../../services/resolution/patient-attributes';
import { mergeAdditionalContext } from '../../services/resolution/effective-context';
import {
  assertMutable,
  Change,
  childOfRunError,
  commitEvaluation,
  conflictError,
  loadSession,
  MAX_ATTEMPTS,
  statusOf,
  withAudits,
} from '../../services/resolution/pipeline/commit';
import {
  evaluateSession,
  inTransaction,
  newRequest,
  persistedObservations,
  RevisionConflict,
} from '../../services/resolution/pipeline/request';
import type { ScopedBlocker } from '../../services/resolution/pipeline/types';

export interface GateAnswerInput {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

/**
 * `AdditionalContextInput` shares `CodeInput`/`LabResultInput` with
 * `PatientContextInput` in the SDL, so it shares their TypeScript types here
 * too. When these were separate inline copies, a field added to the shared SDL
 * input reached one path and was dropped on the other — and the merge key in
 * effective-context.ts reads `date` and `sourceId` off exactly these entries.
 */
export interface AdditionalContextInput {
  conditionCodes?: CodeEntry[];
  medications?: CodeEntry[];
  labResults?: LabResult[];
  allergies?: CodeEntry[];
  vitalSigns?: Record<string, unknown>;
  freeformData?: Record<string, unknown>;
  patientAttributes?: Record<string, unknown>;
}

/**
 * The GraphQL `PatientContextInput` shape, expressed once against the central
 * `CodeEntry`/`LabResult` types. It used to be re-declared inline at each call
 * site, so widening the coded entries meant finding every copy — and missing
 * one produced a field the resolver silently dropped.
 */
export interface PatientContextArgs extends RawPatientContextInput {
  patientId: string;
}

/** The clock arguments both start mutations accept. */
export interface TemporalAnchorArgs {
  evaluationAsOf?: string | null;
  encounterStart?: string | null;
}

/**
 * Project a parsed SYNTHETIC variant into the `PatientContext` the traversal,
 * DDI pass and session record all consume.
 *
 * Takes the whole `ResolutionInput` rather than a bare context, so the only
 * way to reach the clinical payload is through a variant that has already been
 * validated. Throws on LIVE/REPLAY: callers run `assertAssemblableMode` first,
 * and this is the backstop if one forgets.
 */
export function toPatientContext(input: ResolutionInput): PatientContext {
  if (input.mode !== 'SYNTHETIC') {
    throw new GraphQLError(`cannot build a patient context in ${input.mode} mode`, {
      extensions: { code: 'INVALID_RESOLUTION_INPUT' },
    });
  }
  const pc = input.patientContext;
  return {
    patientId: pc.patientId,
    conditionCodes: pc.conditionCodes,
    medications: pc.medications,
    labResults: pc.labResults,
    allergies: pc.allergies,
    vitalSigns: pc.vitalSigns,
    freeformData: pc.freeformData,
    patientAttributes: normalizePatientAttributes(pc.patientAttributes),
  };
}

/**
 * Only pass through what the caller actually supplied — absent means "read the
 * wall clock".
 *
 * Tested for null/undefined, NOT truthiness. `evaluationAsOf: ""` is a
 * malformed clock, not an absent one: dropping it silently substituted the wall
 * clock and pinned the session to an instant the caller never asked for.
 * Forwarded, it reaches the strict parser and is rejected as INVALID_CLOCK.
 */
export function temporalInputFrom(args: TemporalAnchorArgs): TemporalContextInput {
  const input: TemporalContextInput = {};
  if (args.evaluationAsOf != null) input.evaluationAsOf = args.evaluationAsOf;
  if (args.encounterStart != null) input.encounterStart = args.encounterStart;
  return input;
}

// ─── Evaluation pipeline helpers ──────────────────────────────────────

/** A blocker as the API returns it. `pathwayId` is set on a blocker a run propagates from one of its pathways. */
export function formatBlocker(b: ScopedBlocker & { pathwayId?: string }) {
  return { scope: b.scope, type: b.type, description: b.description, relatedNodeIds: b.relatedNodeIds, pathwayId: b.pathwayId ?? null };
}

/** Moderate interactions accompany a plan without blocking it (P3-9). */
export function warningsOf(findings: DdiFinding[]): string[] {
  return findings
    .filter((f) => f.action === 'WARN')
    .map((f) => `${f.category}: ${f.drugName}${f.clinicalAdvice ? ` — ${f.clinicalAdvice}` : ''}`);
}

export const PLAN_CHANGED: ScopedBlocker = {
  scope: 'OUTPUT',
  type: 'PLAN_CHANGED_SINCE_REVIEW',
  description: 'The plan changed after it was reviewed. Review the current plan and generate again.',
  relatedNodeIds: [],
};

/**
 * Everything a session is waiting on at one node, as a change to its inputs:
 * a question gate's answer, an escalated datum (a FACT), or a DecisionPoint
 * branch choice. Validation throws here, before any evaluation.
 */
function answerChange(session: ResolutionSession, args: { sessionId: string; nodeId: string; answer: GateAnswerInput }): Change {
  const node = session.resolutionState.get(args.nodeId);
  if (!node) {
    throw new GraphQLError(`Gate "${args.nodeId}" not found in session`, { extensions: { code: 'NOT_FOUND' } });
  }
  const inputs = inputsOf(session);
  const pending = session.pendingQuestions.find((q) => q.gateId === args.nodeId);

  // A branch choice is recorded as an ANSWER the engine routes on, so it
  // survives every later evaluation instead of being re-asked.
  if (node.nodeType === 'DecisionPoint') {
    const candidates = pending?.options ?? [];
    const chosen = args.answer.selectedOption;
    if (!chosen || !candidates.includes(chosen)) {
      throw new GraphQLError(
        `"${chosen}" is not among the candidate branches at "${args.nodeId}": ${candidates.join(', ')}`,
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }
    inputs.gateAnswers.set(args.nodeId, { selectedOption: chosen });
    return { inputs, event: { eventType: 'BRANCH_CHOSEN', triggerData: { nodeId: args.nodeId, chosen, candidates } } };
  }

  // An escalated datum request: the answer is a FACT, added to the patient
  // context — never to gateAnswers — so every gate reading that datum sees it.
  if (pending?.askTarget) {
    const value = args.answer.numericValue;
    if (value === undefined || value === null) {
      throw new GraphQLError(`Gate "${args.nodeId}" is a request for ${pending.datumKey}; supply numericValue`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const target = pending.askTarget;
    // No `sourceId`: a clinician-supplied value is not a chart observation.
    // Who said what is recorded by the PROVIDER_ASSERTED_DATUM event.
    // Dated at the evaluation clock: it is observed now. Undated, it merged as a
    // duplicate of any undated entry for the same lab (effective-context.ts keys
    // on code|system|date) — e.g. one selected without a value — and was dropped.
    const fragment: AdditionalContextInput =
      target.kind === 'lab'
        ? { labResults: [{ code: target.code, system: target.system, value, date: session.temporalContext.evaluationAsOf }] }
        : target.kind === 'vital'
          ? { vitalSigns: { [target.path]: value } }
          // `patient.trimester` addresses patientAttributes.trimester — a FLAT key.
          : { patientAttributes: { [target.path.split('.').slice(1).join('.')]: value } };
    inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, fragment);
    return {
      inputs,
      event: { eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: { gateId: args.nodeId, datumKey: pending.datumKey, target, value } },
    };
  }

  // A question gate's answer, checked against the gate's own schema first.
  const problem = node.properties
    ? validateAnswerAgainstGate(args.answer, node.properties as unknown as GateProperties)
    : null;
  if (problem) {
    throw new GraphQLError(`Gate "${args.nodeId}": ${problem}`, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  const answer: GateAnswer = {
    booleanValue: args.answer.booleanValue,
    numericValue: args.answer.numericValue,
    selectedOption: args.answer.selectedOption,
  };
  inputs.gateAnswers.set(args.nodeId, answer);
  return {
    inputs,
    event: { eventType: 'gate_answer', triggerData: { gateId: args.nodeId, answer: args.answer } },
    record: (db, result) => logGateAnswer(db, {
      sessionId: session.id,
      gateId: args.nodeId,
      pathwayId: session.pathwayId,
      answer: args.answer,
      // Reported from what evaluation decided, not predicted from the answer's shape.
      gateOpened: result.resolutionState.get(args.nodeId)?.status === NodeStatus.INCLUDED,
    }),
  };
}

/** An override, as a change to a session's inputs. The pathway's own decision survives re-overrides. */
function overrideChange(
  s: ResolutionSession,
  args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
): Change {
  const node = s.resolutionState.get(args.nodeId);
  if (!node) {
    throw new GraphQLError(`Node "${args.nodeId}" not found in session`, { extensions: { code: 'NOT_FOUND' } });
  }
  // The pathway's own decision, kept across re-overrides: an override of an
  // override still records what the pathway originally concluded.
  const previous = s.providerOverrides.get(args.nodeId);
  const override: ProviderOverride = {
    action: args.action,
    reason: args.reason,
    originalStatus: previous?.originalStatus ?? node.status,
    originalConfidence: previous?.originalConfidence ?? node.confidence,
  };
  const inputs = inputsOf(s);
  inputs.providerOverrides.set(args.nodeId, override);
  return {
    inputs,
    event: { eventType: 'override', triggerData: { nodeId: args.nodeId, action: args.action, reason: args.reason } },
    record: (db) => logNodeOverride(db, {
      sessionId: args.sessionId,
      nodeId: args.nodeId,
      pathwayId: s.pathwayId,
      action: args.action,
      reason: args.reason,
      originalStatus: override.originalStatus,
      originalConfidence: override.originalConfidence,
    }),
  };
}

/** New facts accumulate onto everything supplied before: adding A then B keeps both. */
function contextChange(s: ResolutionSession, additionalContext: AdditionalContextInput): Change {
  const inputs = inputsOf(s);
  inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, additionalContext);
  return {
    inputs,
    event: {
      eventType: 'context_update',
      triggerData: {
        addedContext: Object.keys(additionalContext).filter(
          (k) => (additionalContext as Record<string, unknown>)[k] !== undefined,
        ),
      },
    },
  };
}

/**
 * Commit a change to one session. A child of a run changes through its run —
 * facts to the parent, answers and overrides to the child, every child
 * re-evaluated (D5, D6, D13); a standalone session through commitEvaluation.
 * Returns the session as committed.
 */
async function commitSession(pool: Pool, sessionId: string, build: (s: ResolutionSession) => Change): Promise<ResolutionSession> {
  const session = await loadSession(pool, sessionId);
  if (!session.parentSessionId) return commitEvaluation(pool, sessionId, build);
  const run = await commitRun(pool, session.parentSessionId, (r) => childChange(r, sessionId, build));
  return run.children.find((c) => c.id === sessionId)!;
}

/** Insert the care plan, goals and interventions; returns the plan id. Runs inside generation's claimed transaction. */
async function insertCarePlanRows(db: Db, session: ResolutionSession, carePlanData: CarePlanData): Promise<string> {
  const pathwayTitleResult = await db.query('SELECT title FROM pathway_graph_index WHERE id = $1', [session.pathwayId]);
  const carePlanTitle = pathwayTitleResult.rows[0]?.title
    ? `Care Plan: ${pathwayTitleResult.rows[0].title}`
    : 'Pathway-Generated Care Plan';

  // Ensure the patient row exists so the patient_care_plans FK is satisfied.
  // No-op for real patients; a placeholder for the simulator's synthetic ids.
  await db.query(
    `INSERT INTO patients (id, first_name, last_name, date_of_birth)
     VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [session.patientId],
  );

  // Per migration 019: the patient-specific instance tables.
  const carePlanResult = await db.query(
    `INSERT INTO patient_care_plans
       (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
     VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
     RETURNING id`,
    [session.patientId, carePlanTitle, session.providerId, carePlanData.conditionCodes, session.providerId],
  );
  const carePlanId: string = carePlanResult.rows[0].id;

  // The patient-specific tables have no pathway_node_id column; provenance
  // goes into guideline_reference.
  for (const goal of carePlanData.goals) {
    const refParts: string[] = [];
    if (goal.guidelineReference) refParts.push(goal.guidelineReference);
    if (goal.pathwayNodeId) refParts.push(`node:${goal.pathwayNodeId}`);
    await db.query(
      `INSERT INTO patient_care_plan_goals
         (patient_care_plan_id, description, priority, guideline_reference)
       VALUES ($1, $2, $3, $4)`,
      [carePlanId, goal.description, goal.priority, refParts.length > 0 ? refParts.join(' ') : null],
    );
  }

  for (const intervention of carePlanData.interventions) {
    const refParts: string[] = [];
    if (intervention.guidelineReference) refParts.push(intervention.guidelineReference);
    if (intervention.pathwayId) refParts.push(`pathway:${intervention.pathwayId}`);
    if (intervention.pathwayNodeId) refParts.push(`node:${intervention.pathwayNodeId}`);
    if (intervention.sessionId) refParts.push(`session:${intervention.sessionId}`);
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, medication_code, dosage, frequency,
          procedure_code, referral_specialty, patient_instructions, guideline_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        carePlanId, intervention.type, intervention.description,
        intervention.medicationCode ?? null, intervention.dosage ?? null,
        intervention.frequency ?? null, intervention.procedureCode ?? null,
        intervention.referralSpecialty ?? null, intervention.patientInstructions ?? null,
        refParts.length > 0 ? refParts.join(' ') : null,
      ],
    );
  }
  return carePlanId;
}

// ─── Mutations ────────────────────────────────────────────────────────

export const resolutionMutations = {
  async startResolution(
    _parent: unknown,
    args: {
      pathwayId: string;
      patientId: string;
      patientContext?: PatientContextArgs;
    } & ResolutionModeArgs &
      TemporalAnchorArgs,
    context: DataSourceContext
  ) {
    const { pool } = context;

    const pathwayResult = await pool.query(
      `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
      [args.pathwayId]
    );
    const pathway = pathwayResult.rows[0];
    if (!pathway) {
      throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
    }
    if (pathway.status !== 'ACTIVE') {
      throw new GraphQLError(`Pathway is not ACTIVE (status: ${pathway.status})`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // Exactly one payload per trust mode, policed over the WHOLE raw request.
    // Refuse LIVE/REPLAY before any work.
    const resolutionInput = parseResolutionInput(args, args.patientId, context.userRole);
    assertAssemblableMode(resolutionInput);
    const patientContext: PatientContext = toPatientContext(resolutionInput);

    // The policy version comes from the SERVER (AD-1), never from `args`, and
    // the wall clock is read exactly once, here (§1).
    const temporalPolicyVersion = resolveTemporalPolicyVersion(context);
    const temporalContext = makeEvaluationTemporalContext({
      ...temporalInputFrom(args),
      temporalPolicyVersion,
    });
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Validates the REQUEST before the snapshot is loaded (P1-9): under v1 the
    // assembler rejects a malformed context here, exactly as it did before the
    // pipeline. `evaluate` assembles again from the same inputs.
    factStoreForInput(resolutionInput, temporalContext);

    const request = newRequest();
    const { env, inputs, result, durationMs } = await evaluateSession(pool, request, {
      pathwayId: args.pathwayId,
      graphFingerprint: '',
      temporalContext,
      initialPatientContext: patientContext,
      additionalContext: {},
      gateAnswers: new Map(),
      providerOverrides: new Map(),
      observations: new Map(),
      revision: 0,
    }, 'ROOT', { pinGraph: true });
    if (env.resolution.graphContext.allNodes.length === 0) {
      throw new GraphQLError('Pathway graph is empty', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
    }

    const sessionId = await inTransaction(pool, async (db) => {
      const id = await insertSession(db, {
        pathwayVersion: pathway.version,
        patientId: args.patientId,
        providerId: context.userId,
        inputs: { ...inputs, observations: persistedObservations(inputs, request, result) },
        result,
        status: statusOf(result),
        durationMs,
      });
      await writeLlmAudits(db, id, request.audits);
      await logEvent(db, id, {
        eventType: 'traversal_complete',
        triggerData: {
          pathwayId: args.pathwayId,
          patientId: args.patientId,
          nodesInGraph: env.resolution.graphContext.allNodes.length,
        },
        nodesRecomputed: result.resolutionState.size,
        statusChanges: [],
      });
      return id;
    });

    return formatSessionForGraphQL(await loadSession(pool, sessionId));
  },

  async overrideNode(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
    context: DataSourceContext
  ) {
    return formatSessionForGraphQL(await commitSession(context.pool, args.sessionId, (s) => overrideChange(s, args)));
  },

  /**
   * Answer whatever the session is waiting on at a node: a question gate, an
   * escalated request for a datum, or a branch choice at a DecisionPoint.
   */
  async answerPendingDecision(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; answer: GateAnswerInput },
    context: DataSourceContext
  ) {
    const session = await commitSession(context.pool, args.sessionId, (s) => answerChange(s, args));
    return formatSessionForGraphQL(session);
  },

  async addPatientContext(
    _parent: unknown,
    args: { sessionId: string; additionalContext: AdditionalContextInput },
    context: DataSourceContext
  ) {
    // The SAME trust parsing `startResolution` runs (D10), read from the
    // NEWLY supplied payload: a session whose stored context already carries
    // an assertion must not become permanently un-addable-to.
    const assertion = firstTrustAssertion(args.additionalContext);
    if (assertion) {
      throw new GraphQLError(
        `additionalContext.${assertion} is a SYNTHETIC assertion about clinical truth and cannot be supplied through addPatientContext`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }
    // Explicit nulls become omissions, as at session start.
    const additionalContext = normalizeContextEntryNulls(args.additionalContext);

    const session = await commitSession(context.pool, args.sessionId, (s) => contextChange(s, additionalContext));
    return formatSessionForGraphQL(session);
  },

  /**
   * Materialize the plan the provider reviewed (spec §4, Generation).
   *
   * A COMPLETED session returns its plan without evaluating. Otherwise the
   * session is re-evaluated: a changed resultHash returns
   * PLAN_CHANGED_SINCE_REVIEW (D7), and unready readiness returns its
   * blockers, after storing the fresh cache. If that store loses a revision
   * race, the blockers describe a state that no longer exists, so generation
   * reloads and evaluates again (review P2). The claim — status to COMPLETED
   * under the revision read — happens BEFORE the inserts in one transaction,
   * so a lost race inserts nothing and retries (#4, #8). Every exit writes the
   * audit rows of LLM calls no committed transaction wrote (`withAudits`).
   */
  async generateCarePlanFromResolution(
    _parent: unknown,
    args: { sessionId: string; reviewedResultHash: string },
    context: DataSourceContext
  ) {
    const { pool } = context;
    const request = newRequest();
    type Outcome = { success: boolean; carePlanId: string | null; warnings: string[]; blockers: ReturnType<typeof formatBlocker>[] };

    return withAudits(pool, args.sessionId, request, async (): Promise<Outcome> => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const session = await loadSession(pool, args.sessionId);
        if (session.parentSessionId) throw childOfRunError();
        if (session.status === SessionStatus.COMPLETED) {
          return { success: true, carePlanId: session.carePlanId ?? null, warnings: [], blockers: [] };
        }
        if (session.status === SessionStatus.ABANDONED) {
          throw new GraphQLError('Session was abandoned and cannot generate a care plan', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        assertMutable(session);

        const { inputs, result, durationMs } = await evaluateSession(pool, request, inputsOf(session), 'ROOT');
        const toStore = { ...inputs, observations: persistedObservations(inputs, request, result) };
        const warnings = warningsOf(result.safetyFindings);
        const planChanged = result.resultHash !== args.reviewedResultHash;

        try {
          if (planChanged || !result.readiness.ready) {
            // Store what was just evaluated, so the provider re-reviews exactly this.
            await inTransaction(pool, async (db) => {
              const written = await writeEvaluation(db, {
                sessionId: args.sessionId, expectedRevision: session.revision, inputs: toStore, result,
                status: statusOf(result), durationMs,
              });
              if (!written) throw new RevisionConflict();
              await writeLlmAudits(db, args.sessionId, request.audits);
            });
            request.audits.length = 0;
            const blockers = planChanged ? [PLAN_CHANGED] : result.readiness.blockers;
            return { success: false, carePlanId: null, warnings, blockers: blockers.map(formatBlocker) };
          }

          const carePlanData = generateCarePlan(result.resolutionState, session.pathwayId, args.sessionId);
          const carePlanId = await inTransaction(pool, async (db) => {
            // Claim first (#8): only the request that moves the session to COMPLETED inserts.
            const claimed = await writeEvaluation(db, {
              sessionId: args.sessionId, expectedRevision: session.revision, inputs: toStore, result,
              status: SessionStatus.COMPLETED, durationMs,
            });
            if (!claimed) throw new RevisionConflict();
            const id = await insertCarePlanRows(db, session, carePlanData);
            await setCarePlanId(db, args.sessionId, id);
            await writeLlmAudits(db, args.sessionId, request.audits);
            await logEvent(db, args.sessionId, {
              eventType: 'care_plan_generated',
              triggerData: { carePlanId: id, goalsCount: carePlanData.goals.length, interventionsCount: carePlanData.interventions.length },
              nodesRecomputed: 0,
              statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.COMPLETED }],
            });
            return id;
          });
          request.audits.length = 0;
          return { success: true, carePlanId, warnings, blockers: [] };
        } catch (err) {
          // Either write lost a race: reload, and evaluate the state that won.
          if (err instanceof RevisionConflict) continue;
          if (err instanceof GraphQLError) throw err;
          console.error('Care plan generation failed:', err);
          throw new GraphQLError('Failed to generate care plan: transaction rolled back', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
      }
      throw conflictError();
    });
  },

  /** Lifecycle only (spec §4): no evaluation; ACTIVE or DEGRADED only; the revision check still applies. */
  async abandonSession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext
  ) {
    const { pool } = context;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const session = await loadSession(pool, args.sessionId);
      if (session.parentSessionId) throw childOfRunError();
      assertMutable(session);
      try {
        await inTransaction(pool, async (db) => {
          const written = await writeLifecycleStatus(db, {
            sessionId: args.sessionId, expectedRevision: session.revision, status: SessionStatus.ABANDONED,
          });
          if (!written) throw new RevisionConflict();
          await logEvent(db, args.sessionId, {
            eventType: 'abandoned',
            triggerData: { reason: args.reason ?? 'No reason provided' },
            nodesRecomputed: 0,
            statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.ABANDONED }],
          });
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      return formatSessionForGraphQL(await loadSession(pool, args.sessionId));
    }
    throw conflictError();
  },
};
