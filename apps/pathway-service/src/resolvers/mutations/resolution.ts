import { GraphQLError } from 'graphql';
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
import { PATHWAY_COLUMNS, formatSessionForGraphQL } from '../Query';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { RetraversalEngine } from '../../services/resolution/retraversal-engine';
import {
  createSession,
  getSession,
  updateSession,
  logEvent,
  logNodeOverride,
  logGateAnswer,
} from '../../services/resolution/session-store';
import {
  validateForGeneration,
  generateCarePlan,
} from '../../services/resolution/care-plan-generator';
import { GateAnswer } from '../../services/resolution/types';
import type { ResolutionSession, RetraversalResult } from '../../services/resolution/types';
import {
  reconcileRedFlags,
  reconcilePendingQuestions,
  isRedFlagType,
  RED_FLAG_TYPES,
} from '../../services/resolution/red-flags';
import type { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  buildResolutionContext,
  makeTraversalAdapter,
  makeRetraversalAdapter,
  makeLlmGateEvaluator,
  assertEncounterAnchor,
  resolveTemporalPolicyVersion,
} from '../helpers/resolution-context';
import {
  factStoreForInput,
  factStoreForSession,
} from '../../services/resolution/temporal/fact-store';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import { applyDdiToResolutionState } from '../../services/medications/ddi-pass-single-pathway';
import { normalizePatientAttributes } from '../../services/resolution/patient-attributes';
import {
  buildEffectivePatientContext,
  dependencyContextKey,
  mergeAdditionalContext,
} from '../../services/resolution/effective-context';

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
 * A retraversal must reuse the clock its session was created with — never
 * stamp a new one, or the same data could resolve differently than it did at
 * creation. Sessions written before migration 063 have no clock and are not
 * retraversable (§5).
 */
function requireSessionTemporalContext(session: ResolutionSession): EvaluationTemporalContext {
  if (!session.temporalContext) {
    throw new GraphQLError(
      'Session has no pinned evaluation clock and cannot be retraversed (created before temporal context was introduced)',
      { extensions: { code: 'SESSION_NOT_RETRAVERSABLE' } },
    );
  }
  return session.temporalContext;
}

/**
 * The shared body of `acknowledgeRedFlag` / `unacknowledgeRedFlag`.
 *
 * A red flag is identified by (nodeId, flagType) — the same key
 * `reconcileRedFlags` uses, and for the same reason: it is what stays stable
 * when the flag is re-derived. Node ID alone is not enough, because
 * `TraversalEngine` can raise both `all_branches_excluded` and
 * `missing_critical_data`, and one acknowledgment must not silence the other.
 *
 * Every guard here is a runtime throw rather than a type: `src/__tests__` is
 * excluded from `tsconfig`, so a type constrains no caller that matters.
 */
async function setRedFlagAcknowledgement(
  args: { sessionId: string; nodeId: string; flagType: string; reason: string },
  context: DataSourceContext,
  acknowledged: boolean,
) {
  const { pool } = context;

  if (!isRedFlagType(args.flagType)) {
    throw new GraphQLError(
      `"${args.flagType}" is not a known red flag type (expected one of: ${RED_FLAG_TYPES.join(', ')})`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
  const reason = (args.reason ?? '').trim();
  if (reason.length === 0) {
    throw new GraphQLError(
      'A reason is required: acknowledging a red flag is a clinical override, not a UI dismissal',
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }

  const session = await getSession(pool, args.sessionId);
  if (!session) {
    throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
  }
  if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
    throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const target = session.redFlags.find(
    f => f.nodeId === args.nodeId && f.type === args.flagType,
  );
  if (!target) {
    throw new GraphQLError(
      `No red flag of type "${args.flagType}" on node "${args.nodeId}" in this session`,
      { extensions: { code: 'NOT_FOUND' } },
    );
  }

  const previouslyAcknowledgedBy = target.acknowledgedBy;
  const previouslyAcknowledged = target.acknowledged === true;

  session.redFlags = session.redFlags.map(f => {
    if (f !== target) return f;
    if (!acknowledged) {
      // Clear the metadata with the mark. A stale `acknowledgedBy` on an
      // un-acknowledged flag reads as an acceptance that is still in force.
      const { acknowledgedBy, acknowledgedAt, acknowledgementReason, ...rest } = f;
      void acknowledgedBy; void acknowledgedAt; void acknowledgementReason;
      return { ...rest, acknowledged: false };
    }
    return {
      ...f,
      acknowledged: true,
      // Asserted, not verified — see the mutation comment (AD-1).
      acknowledgedBy: context.userId,
      acknowledgedAt: new Date().toISOString(),
      acknowledgementReason: reason,
    };
  });

  await updateSession(pool, args.sessionId, { redFlags: session.redFlags }, session.updatedAt);

  // Audited through the same `pathway_resolution_events` mechanism every other
  // resolution mutation uses, so the override lands in one trail, not a new one.
  await logEvent(pool, args.sessionId, {
    eventType: acknowledged ? 'red_flag_acknowledged' : 'red_flag_unacknowledged',
    triggerData: {
      nodeId: args.nodeId,
      flagType: args.flagType,
      reason,
      // Prefixed `asserted` so no later reader mistakes either for an
      // authenticated identity: both come from unverified headers (AD-1).
      assertedActorId: context.userId,
      assertedActorRole: context.userRole,
      previouslyAcknowledged,
      previouslyAcknowledgedBy,
    },
    nodesRecomputed: 0,
    statusChanges: [],
  });

  const updated = await getSession(pool, args.sessionId);
  if (!updated) {
    throw new GraphQLError('Failed to retrieve updated session', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
  return formatSessionForGraphQL(updated);
}

/**
 * Fold a retraversal's findings back onto the session by KEYED REPLACE over
 * the scope the pass reports, instead of appending them.
 *
 * All three retraversing mutations route through here so they cannot drift
 * apart again: `answerGateQuestion` reconciled pending questions but appended
 * red flags, `addPatientContext` appended both, and `overrideNode` dropped
 * both on the floor.
 *
 * The scope comes from the engine rather than from the resolver's own
 * `affectedNodes` seed set, because the two differ in both directions: the
 * cascade reaches past the seed, and inside the seed the engine skips
 * provider-overridden and missing nodes. Reconciling against the seed would
 * delete findings for nodes the pass never re-evaluated.
 *
 * @param answeredGateId when set, that gate's pending question is dropped
 *   whether or not the pass re-derived one — the question is settled by the
 *   answer itself. (This is the `.filter(q => q.gateId !== args.gateId)` the
 *   old code had, kept.)
 */
function applyRetraversalFindings(
  session: ResolutionSession,
  reResult: RetraversalResult,
  options: { answeredGateId?: string } = {},
): void {
  // Runtime, not type-level: `src/__tests__` is excluded from tsconfig, so a
  // stubbed engine that forgets the scope would otherwise reconcile against
  // `undefined` and silently keep every stale flag.
  if (
    !Array.isArray(reResult.reEvaluatedNodeIds) ||
    !Array.isArray(reResult.reDerivedRedFlagTypes)
  ) {
    throw new GraphQLError(
      'Retraversal returned no reconciliation scope; session findings cannot be reconciled',
      { extensions: { code: 'INTERNAL_SERVER_ERROR' } },
    );
  }

  session.redFlags = reconcileRedFlags(session.redFlags, reResult.newRedFlags, {
    nodeIds: reResult.reEvaluatedNodeIds,
    types: reResult.reDerivedRedFlagTypes,
  });

  session.pendingQuestions = reconcilePendingQuestions(
    session.pendingQuestions,
    reResult.newPendingQuestions,
    {
      gateIds: reResult.reEvaluatedNodeIds,
      alsoDropGateIds: options.answeredGateId ? [options.answeredGateId] : [],
    },
  );
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

    const rctx = await buildResolutionContext(pool, args.pathwayId);
    if (rctx.graphContext.allNodes.length === 0) {
      throw new GraphQLError('Pathway graph is empty', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }

    // Exactly one payload per trust mode, policed over the WHOLE raw request:
    // a LIVE or REPLAY caller cannot smuggle in facts or a clock, and an
    // explicit SYNTHETIC needs ADMIN. An absent mode stays SYNTHETIC so every
    // existing caller keeps working, but admits only what they could already
    // send. Refuse LIVE/REPLAY before any work rather than silently resolving
    // against an empty context.
    const resolutionInput = parseResolutionInput(args, args.patientId, context.userRole);
    assertAssemblableMode(resolutionInput);

    // Dispatch from the VARIANT, never from `args.patientContext` — reading the
    // raw args here is what made the union decorative in the first place.
    const patientContext: PatientContext = toPatientContext(resolutionInput);

    // The policy version comes from the SERVER, immediately before the clock is
    // stamped — never from `args` (AD-1). Spread last so a future
    // `temporalInputFrom` that ever carried one could not win.
    const temporalPolicyVersion = resolveTemporalPolicyVersion(context);

    // One clock for the whole session (§1). The wall clock is read exactly
    // once, here — every gate evaluation, retraversal and replay of this
    // session uses this instant. A caller may pin it instead, and must supply
    // encounterStart when the pathway resolves an ENCOUNTER horizon.
    const temporalContext = makeEvaluationTemporalContext({
      ...temporalInputFrom(args),
      temporalPolicyVersion,
    });

    // The version gates everything downstream, so it is checked at the
    // boundary — not left to the sweep, which never runs on a pathway with
    // nothing to sweep.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // `v1` only — under `legacy-v0` this returns `[]` without ever entering the
    // assembler, which VALIDATES and throws (P1-9).
    //
    // Before the anchor sweep, so both start mutations order these the same
    // way: the assembler validates the REQUEST, the sweep validates the PATHWAY
    // against it. `startMultiPathwayResolution` has no choice — its zero-match
    // branch returns before any pathway is loaded — so matching that here is
    // what stops the same malformed context reporting two different errors
    // depending on which mutation the caller used.
    const factStore = factStoreForInput(resolutionInput, temporalContext);

    // Refuse up front rather than throwing partway through: an ENCOUNTER
    // horizon with no anchor is unresolvable, and by the time the first
    // such gate is reached the traversal has already called LLM gates.
    assertEncounterAnchor(rctx, temporalContext);

    const llmBundle = makeLlmGateEvaluator(pool, args.pathwayId);
    const traversalEngine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, args.pathwayId, patientContext),
      rctx.thresholds,
      temporalContext,
      rctx.temporalDefaults,
      factStore,
      rctx.codeMap,
      llmBundle?.evaluator,
    );
    const traversalResult = await traversalEngine.traverse(
      rctx.graphContext,
      patientContext,
      new Map<string, GateAnswer>(),
    );

    const status = traversalResult.isDegraded
      ? SessionStatus.DEGRADED
      : SessionStatus.ACTIVE;

    // DDI: post-traversal pass over the resolutionState. Suppresses nodes in
    // place via NodeStatus.EXCLUDED; warnings persist on the session for UX.
    const ddiResult = await applyDdiToResolutionState(
      pool,
      traversalResult.resolutionState,
      patientContext,
    );
    const ddiWarnings = ddiResult.findings.filter((f) => f.action === 'WARN');

    const sessionId = await createSession(pool, {
      pathwayId: args.pathwayId,
      pathwayVersion: pathway.version,
      patientId: args.patientId,
      providerId: context.userId,
      status,
      initialPatientContext: patientContext,
      resolutionState: traversalResult.resolutionState,
      dependencyMap: traversalResult.dependencyMap,
      pendingQuestions: traversalResult.pendingQuestions,
      redFlags: traversalResult.redFlags,
      totalNodesEvaluated: traversalResult.totalNodesEvaluated,
      traversalDurationMs: traversalResult.traversalDurationMs,
      ddiWarnings,
      temporalContext,
    });

    // Flush buffered LLM gate audit rows now that the session ID exists.
    if (llmBundle) {
      await llmBundle.flushAudits(sessionId);
    }

    // 11. Log event
    await logEvent(pool, sessionId, {
      eventType: 'traversal_complete',
      triggerData: {
        pathwayId: args.pathwayId,
        patientId: args.patientId,
        nodesInGraph: rctx.graphContext.allNodes.length,
      },
      nodesRecomputed: traversalResult.totalNodesEvaluated,
      statusChanges: [],
    });

    // 12. Return formatted session
    const session = await getSession(pool, sessionId);
    if (!session) {
      throw new GraphQLError('Failed to retrieve created session', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return formatSessionForGraphQL(session);
  },

  async overrideNode(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // 1. Load session
    const session = await getSession(pool, args.sessionId);
    if (!session) {
      throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
    }
    if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
      throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // 2. Find the node
    const nodeResult = session.resolutionState.get(args.nodeId);
    if (!nodeResult) {
      throw new GraphQLError(`Node "${args.nodeId}" not found in session`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // 3. Store previous state as provider override
    const originalStatus = nodeResult.status;
    const originalConfidence = nodeResult.confidence;
    nodeResult.providerOverride = {
      action: args.action,
      reason: args.reason,
      originalStatus,
      originalConfidence,
    };

    // 4. Set new status
    nodeResult.status = args.action === OverrideAction.INCLUDE
      ? NodeStatus.INCLUDED
      : NodeStatus.EXCLUDED;

    // Reject a clock-less session up front, not only when a retraversal
    // happens to be triggered — the session is un-retraversable either way.
    const sessionClock = requireSessionTemporalContext(session);

    // 5. Find affected nodes
    const affectedNodes = new Set<string>();
    const influenced = session.dependencyMap.influences.get(args.nodeId);
    if (influenced) {
      for (const depId of influenced) {
        affectedNodes.add(depId);
      }
    }

    // 6. Run re-traversal on affected nodes if any
    const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [
      { nodeId: args.nodeId, from: originalStatus, to: nodeResult.status },
    ];

    if (affectedNodes.size > 0) {
      const rctx = await buildResolutionContext(pool, session.pathwayId);
      const patientCtx = buildEffectivePatientContext(
        session.initialPatientContext as PatientContext,
        session.additionalContext as Partial<AdditionalContextInput>,
      );

      const llmBundle = makeLlmGateEvaluator(pool, session.pathwayId, args.sessionId);
      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
        rctx.thresholds,
        sessionClock,
        rctx.temporalDefaults,
        // Re-assembled from the SAME inputs `patientCtx` was built from, under
        // the session's STORED clock — never a fresh one (plan 05b / §1).
        factStoreForSession(
          session,
          session.additionalContext as Partial<AdditionalContextInput>,
        ),
        rctx.codeMap,
        llmBundle?.evaluator,
      );

      const reResult = await retraversalEngine.retraverse(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        patientCtx,
        session.gateAnswers,
      );

      if (llmBundle) await llmBundle.flushAudits(args.sessionId);

      statusChanges.push(...reResult.statusChanges);

      // An override can raise a red flag or open a question. Both used to be
      // discarded here — only `statusChanges` was read — so a session never
      // recorded either.
      applyRetraversalFindings(session, reResult);
    }

    // 7. Update session (with optimistic lock)
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
      pendingQuestions: session.pendingQuestions,
      redFlags: session.redFlags,
      totalNodesEvaluated: session.resolutionState.size,
    }, session.updatedAt);

    // 8. Log event
    await logEvent(pool, args.sessionId, {
      eventType: 'override',
      triggerData: {
        nodeId: args.nodeId,
        action: args.action,
        reason: args.reason,
      },
      nodesRecomputed: affectedNodes.size + 1,
      statusChanges,
    });

    // 9. Log to pathway_node_overrides
    await logNodeOverride(pool, {
      sessionId: args.sessionId,
      nodeId: args.nodeId,
      pathwayId: session.pathwayId,
      action: args.action,
      reason: args.reason,
      originalStatus,
      originalConfidence,
    });

    // 10. Return formatted session
    const updated = await getSession(pool, args.sessionId);
    if (!updated) {
      throw new GraphQLError('Failed to retrieve updated session', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return formatSessionForGraphQL(updated);
  },

  async answerGateQuestion(
    _parent: unknown,
    args: { sessionId: string; gateId: string; answer: GateAnswerInput },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // Optimistic-lock retry loop. The read/compute/write cycle can lose
    // the WHERE-updated_at guard when another request lands on the same
    // session between our read and our write (typical in the preview
    // flow where the composer applies several pre-answers back-to-back
    // and the merged-plan re-render kicks other traffic against the row).
    // Retry with a fresh load — the answer itself is idempotent from the
    // caller's perspective. Cap attempts so a real conflict (e.g. two
    // providers editing) still surfaces after we've done our best.
    const MAX_ATTEMPTS = 4;
    let statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
    let nodesRecomputed = 0;
    let gateOpened = false;
    let pathwayIdForLog = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 1. Load session (fresh every attempt so updated_at matches).
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
        throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      pathwayIdForLog = session.pathwayId;

      // 2. Find gate in resolution state
      const gateResult = session.resolutionState.get(args.gateId);
      if (!gateResult) {
        throw new GraphQLError(`Gate "${args.gateId}" not found in session`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const newAnswer: GateAnswer = {
        booleanValue: args.answer.booleanValue,
        numericValue: args.answer.numericValue,
        selectedOption: args.answer.selectedOption,
      };
      session.gateAnswers.set(args.gateId, newAnswer);

      // Determine if gate opens: delegate to gate evaluator after building context.
      // For now, any non-null answer value is treated as opening the gate.
      // The retraversal will use the proper gate evaluator for final status.
      gateOpened = args.answer.booleanValue === true ||
        (args.answer.selectedOption != null) ||
        (args.answer.numericValue != null);

      // 4. Build resolution context and find affected subtree
      const rctx = await buildResolutionContext(pool, session.pathwayId);

      // Reject a clock-less session up front, not only when a retraversal
      // happens to be triggered — the session is un-retraversable either way.
      const sessionClock = requireSessionTemporalContext(session);

      const affectedNodes = new Set<string>();
      affectedNodes.add(args.gateId);
      const subtreeQueue = [args.gateId];
      while (subtreeQueue.length > 0) {
        const id = subtreeQueue.shift()!;
        for (const edge of rctx.graphContext.outgoingEdges(id)) {
          if (!affectedNodes.has(edge.targetId)) {
            affectedNodes.add(edge.targetId);
            subtreeQueue.push(edge.targetId);
          }
        }
      }

      statusChanges = [];
      nodesRecomputed = 0;
      const patientCtx = buildEffectivePatientContext(
        session.initialPatientContext as PatientContext,
        session.additionalContext as Partial<AdditionalContextInput>,
      );

      if (gateOpened) {
        // 5a. Gate opens: mark gate as INCLUDED and re-evaluate subtree
        const previousGateStatus = gateResult.status;
        gateResult.status = NodeStatus.INCLUDED;
        gateResult.confidence = 1;
        gateResult.excludeReason = undefined;
        statusChanges.push({ nodeId: args.gateId, from: previousGateStatus, to: NodeStatus.INCLUDED });

        // Remove stale subtree nodes so RetraversalEngine re-evaluates them
        for (const nodeId of affectedNodes) {
          if (nodeId !== args.gateId && session.resolutionState.has(nodeId)) {
            const existing = session.resolutionState.get(nodeId)!;
            if (existing.status === NodeStatus.PENDING_QUESTION || existing.status === NodeStatus.GATED_OUT) {
              session.resolutionState.delete(nodeId);
            }
          }
        }

        const llmBundle = makeLlmGateEvaluator(pool, session.pathwayId, args.sessionId);
        const retraversalEngine = new RetraversalEngine(
          makeRetraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
          rctx.thresholds,
          sessionClock,
          rctx.temporalDefaults,
          // Same inputs as `patientCtx`, under the session's stored clock.
          factStoreForSession(
            session,
            session.additionalContext as Partial<AdditionalContextInput>,
          ),
          rctx.codeMap,
          llmBundle?.evaluator,
        );

        const reResult = await retraversalEngine.retraverse(
          affectedNodes,
          session.resolutionState,
          session.dependencyMap,
          rctx.graphContext,
          patientCtx,
          session.gateAnswers,
        );

        if (llmBundle) await llmBundle.flushAudits(args.sessionId);

        statusChanges.push(...reResult.statusChanges);
        nodesRecomputed = reResult.nodesRecomputed;

        // Reconcile pending questions AND red flags. The red-flag half used to
        // be an append beside an already-correct keyed replace of the
        // questions, which is what let an identical flag pile up once per
        // retraversal and a resolved one never leave.
        applyRetraversalFindings(session, reResult, { answeredGateId: args.gateId });
      } else {
        // 5b. Gate closes: mark subtree as GATED_OUT
        const previousGateStatus = gateResult.status;
        gateResult.status = NodeStatus.GATED_OUT;
        gateResult.excludeReason = 'Gate answer: condition not met';
        statusChanges.push({ nodeId: args.gateId, from: previousGateStatus, to: NodeStatus.GATED_OUT });

        for (const nodeId of affectedNodes) {
          if (nodeId === args.gateId) continue;
          const existing = session.resolutionState.get(nodeId);
          if (existing) {
            const oldStatus = existing.status;
            existing.status = NodeStatus.GATED_OUT;
            existing.excludeReason = `Gated out by answer to ${gateResult.title}`;
            if (oldStatus !== NodeStatus.GATED_OUT) {
              statusChanges.push({ nodeId, from: oldStatus, to: NodeStatus.GATED_OUT });
            }
            nodesRecomputed++;
          }
        }

        // Remove the answered question from pending
        session.pendingQuestions = session.pendingQuestions.filter(q => q.gateId !== args.gateId);

        // This branch runs NO retraversal — deliberately. `RetraversalEngine`
        // knows nothing about the answer that closed the gate; re-deriving the
        // subtree through it would overwrite the GATED_OUT stamping just
        // applied with confidence-derived INCLUDED/EXCLUDED, which is a
        // behaviour change well past reconciliation. (Pinned by a test.)
        //
        // It does still RE-DECIDE these nodes: it forces the whole subtree to
        // GATED_OUT. A node that is unreachable cannot carry a live finding —
        // an `all_branches_excluded` on a gated-out decision point is about a
        // decision the patient no longer reaches — so the same keyed replace
        // applies over that scope with an empty derived set. Every flag type,
        // not just the ones a retraversal re-derives, because being gated out
        // moots all of them.
        const gatedOutNodeIds = [...affectedNodes].filter(
          id => session.resolutionState.has(id),
        );
        session.redFlags = reconcileRedFlags(session.redFlags, [], {
          nodeIds: gatedOutNodeIds,
          types: RED_FLAG_TYPES,
        });
      }

      // 7. Update session (optimistic lock)
      try {
        await updateSession(pool, args.sessionId, {
          resolutionState: session.resolutionState,
          pendingQuestions: session.pendingQuestions,
          redFlags: session.redFlags,
          gateAnswers: session.gateAnswers,
          totalNodesEvaluated: session.resolutionState.size,
        }, session.updatedAt);
        break; // committed
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('optimistic lock') && attempt < MAX_ATTEMPTS) {
          // Small jitter (10–40ms) so parallel callers don't lock-step.
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
          continue;
        }
        throw err;
      }
    }

    // 8. Log event
    await logEvent(pool, args.sessionId, {
      eventType: 'gate_answer',
      triggerData: {
        gateId: args.gateId,
        answer: args.answer,
        gateOpened,
      },
      nodesRecomputed,
      statusChanges,
    });

    // 9. Log to pathway_gate_answers
    await logGateAnswer(pool, {
      sessionId: args.sessionId,
      gateId: args.gateId,
      pathwayId: pathwayIdForLog,
      answer: args.answer,
      gateOpened,
    });

    // 10. Return formatted session
    const updated = await getSession(pool, args.sessionId);
    if (!updated) {
      throw new GraphQLError('Failed to retrieve updated session', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return formatSessionForGraphQL(updated);
  },

  async addPatientContext(
    _parent: unknown,
    args: { sessionId: string; additionalContext: AdditionalContextInput },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // 1. Load session
    const session = await getSession(pool, args.sessionId);
    if (!session) {
      throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
    }
    if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
      throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // 1b. The SAME trust parsing `startResolution` runs (D10).
    //
    //    `AdditionalContextInput` reuses the very same `CodeInput` /
    //    `LabResultInput` SDL types as `PatientContextInput`, so it can carry
    //    `endDate` / `clinicalState` / `recordValidity` / `sourceId` — the
    //    fields `parseResolutionInput` treats as assertions about clinical
    //    truth. Until this ran here, a request refused at session creation was
    //    accepted mid-session, and under `v1` those fields govern selection:
    //    `recordValidity: 'INVALID'` drops a fact from selection entirely and
    //    `clinicalState: 'INACTIVE'` flips it out of every `status: 'active'`
    //    gate.
    //
    //    NOT a security fix, and it must not be cited as one: under AD-1
    //    `userRole` is caller-asserted, so a role check secures nothing. What
    //    this buys is that one request gets one answer whichever mutation
    //    carries it — locked decision #7's shape, one layer up.
    //
    //    Version-independent, exactly as at `startResolution`, where
    //    `parseResolutionInput` runs before the policy version is even
    //    resolved. A `v1`-only guard would leave the two doors disagreeing
    //    under `legacy-v0`, which is the defect rather than a narrower fix.
    //
    //    Read from the NEWLY supplied payload, never from `merged`: a session
    //    whose stored context already carries an assertion must not become
    //    permanently un-addable-to, and the boundary is what arrives here.
    const assertion = firstTrustAssertion(args.additionalContext);
    if (assertion) {
      throw new GraphQLError(
        `additionalContext.${assertion} is a SYNTHETIC assertion about clinical truth and cannot be supplied through addPatientContext`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }
    // Explicit nulls become omissions here too — otherwise `recordValidity:
    // null`, which a client sends simply by binding an unset form field, starts
    // a session cleanly and then throws out of `parseRecordValidity` on the
    // first mid-session addition.
    const additionalContext = normalizeContextEntryNulls(args.additionalContext);

    // 2. Accumulate additional context onto everything supplied before it.
    //    A shallow spread replaced each key instead of merging it, so adding
    //    condition A and then condition B stored only B — and every later
    //    retraversal lost evidence a gate had already counted.
    const merged = mergeAdditionalContext(
      session.additionalContext as Partial<AdditionalContextInput> | undefined,
      additionalContext,
    );

    // 3. Build updated patient context for re-evaluation (rebuilt from the
    // accumulated `merged` bag so retraversal context accumulates across calls)
    const basePc = session.initialPatientContext as PatientContext;
    const updatedPc = buildEffectivePatientContext(basePc, merged as Partial<AdditionalContextInput>);

    // 4. Identify affected nodes via dependency maps
    const changedFields = new Set<string>();
    if (additionalContext.conditionCodes) changedFields.add('conditions');
    if (additionalContext.medications) changedFields.add('medications');
    if (additionalContext.labResults) changedFields.add('labs');
    if (additionalContext.allergies) changedFields.add('allergies');
    if (additionalContext.vitalSigns) changedFields.add('vitalSigns');
    if (additionalContext.freeformData) changedFields.add('freeformData');
    if (additionalContext.patientAttributes) changedFields.add('patientAttributes');

    // Reject a clock-less session up front, not only when a retraversal
    // happens to be triggered — the session is un-retraversable either way.
    const sessionClock = requireSessionTemporalContext(session);

    const affectedNodes = new Set<string>();

    // Gates: mark if any context field they read was updated.
    // Legacy coded deps use bucket names ('labs'); attribute-condition deps use
    // dotted paths ('lab.hemoglobin'). dependencyContextKey maps both to the
    // AdditionalContextInput key that supplies the data.
    for (const [gateId, fields] of session.dependencyMap.gateContextFields) {
      for (const field of fields) {
        const contextKey = dependencyContextKey(field);
        if (contextKey && additionalContext[contextKey] !== undefined) {
          affectedNodes.add(gateId);
          break;
        }
      }
    }

    // Action nodes: only re-score if their scorer inputs overlap with changed fields
    for (const [nodeId, inputs] of session.dependencyMap.scorerInputs) {
      for (const input of inputs) {
        if (changedFields.has(input)) {
          affectedNodes.add(nodeId);
          break;
        }
      }
    }

    // 5. Run re-traversal
    const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
    let nodesRecomputed = 0;

    if (affectedNodes.size > 0) {
      const rctx = await buildResolutionContext(pool, session.pathwayId);

      const llmBundle = makeLlmGateEvaluator(pool, session.pathwayId, args.sessionId);
      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, updatedPc),
        rctx.thresholds,
        sessionClock,
        rctx.temporalDefaults,
        // `merged`, NOT `session.additionalContext` — the newly supplied facts
        // must reach the very retraversal they triggered. Assembling from the
        // stored bag is the stale-store half of P1-2: the gate would be marked
        // affected, re-evaluated, and still see nothing new.
        factStoreForSession(session, merged as Partial<AdditionalContextInput>),
        rctx.codeMap,
        llmBundle?.evaluator,
      );

      const reResult = await retraversalEngine.retraverse(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        updatedPc,
        session.gateAnswers,
      );

      if (llmBundle) await llmBundle.flushAudits(args.sessionId);

      statusChanges.push(...reResult.statusChanges);
      nodesRecomputed = reResult.nodesRecomputed;

      // Reconcile pending questions and red flags. Both were appends: a gate
      // that stayed PENDING_QUESTION grew one duplicate prompt per context
      // addition, and a still-excluded decision point one duplicate flag.
      applyRetraversalFindings(session, reResult);
    }

    // 6. Update session (with optimistic lock)
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
      additionalContext: merged,
      pendingQuestions: session.pendingQuestions,
      redFlags: session.redFlags,
      totalNodesEvaluated: session.resolutionState.size,
    }, session.updatedAt);

    // 7. Log event
    await logEvent(pool, args.sessionId, {
      eventType: 'context_update',
      triggerData: {
        addedContext: Object.keys(additionalContext).filter(
          k => (additionalContext as Record<string, unknown>)[k] !== undefined
        ),
      },
      nodesRecomputed,
      statusChanges,
    });

    // 8. Return formatted session
    const updated = await getSession(pool, args.sessionId);
    if (!updated) {
      throw new GraphQLError('Failed to retrieve updated session', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return formatSessionForGraphQL(updated);
  },

  /**
   * Accept a red flag that is genuinely still true.
   *
   * Reconciliation removes STALE flags; this is the other half. A flag that
   * still holds and that the clinician has considered and accepted otherwise
   * blocks care-plan generation forever (`care-plan-generator.ts` blocks on
   * every unacknowledged flag), which was the dead end §1 of the gaps document
   * describes.
   *
   * NOT ROLE-GATED, DELIBERATELY, AND THIS IS NOT A SECURITY BOUNDARY.
   * Under AD-1 (`docs/AUTHORIZATION_DEBT.md`) `userRole` is read straight off
   * an unverified `x-user-role` header that defaults to `PROVIDER`, and
   * `userId` off `x-user-id` with a dev default. A role check here would
   * secure nothing — any client satisfies it by sending one header — and would
   * break the encounter simulator, which sends neither. So the asserted actor
   * is RECORDED on the flag and in the audit row, and enforced nowhere. When
   * AD-1 lands and the identity is derived from a verified token, this is
   * where the check goes.
   */
  async acknowledgeRedFlag(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; flagType: string; reason: string },
    context: DataSourceContext,
  ) {
    return setRedFlagAcknowledgement(args, context, true);
  },

  /**
   * Reverse an acknowledgment.
   *
   * Present because acknowledging is one-way otherwise: an acknowledgment
   * entered against the wrong flag would permanently unblock a live safety
   * finding with no API-level remedy — the same shape of dead end as the bug
   * this whole change fixes, only pointing the other way. Same required
   * reason, same audit row, distinct event type.
   */
  async unacknowledgeRedFlag(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; flagType: string; reason: string },
    context: DataSourceContext,
  ) {
    return setRedFlagAcknowledgement(args, context, false);
  },

  async generateCarePlanFromResolution(
    _parent: unknown,
    args: { sessionId: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // 1. Load session
    const session = await getSession(pool, args.sessionId);
    if (!session) {
      throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
    }
    if (session.status === SessionStatus.COMPLETED) {
      throw new GraphQLError('Session already completed — care plan was already generated', {
        extensions: { code: 'BAD_REQUEST' },
      });
    }
    if (session.status === SessionStatus.ABANDONED) {
      throw new GraphQLError('Session was abandoned and cannot generate a care plan', {
        extensions: { code: 'BAD_REQUEST' },
      });
    }

    // 2. Validate
    const blockers = validateForGeneration(session.resolutionState, session.redFlags);
    if (blockers.length > 0) {
      return {
        success: false as const,
        carePlanId: null as string | null,
        warnings: [] as string[],
        blockers: blockers.map(b => ({
          type: b.type,
          description: b.description,
          relatedNodeIds: b.relatedNodeIds,
        })),
      };
    }

    // 3. Generate care plan data
    const carePlanData = generateCarePlan(
      session.resolutionState,
      session.pathwayId,
      args.sessionId,
    );

    // 4. Insert care plan, goals, interventions, and update session in a transaction
    const client = await pool.connect();
    let carePlanId: string;
    try {
      await client.query('BEGIN');

      // Fetch pathway title for the care plan name
      const pathwayTitleResult = await client.query(
        'SELECT title FROM pathway_graph_index WHERE id = $1',
        [session.pathwayId],
      );
      const carePlanTitle = pathwayTitleResult.rows[0]?.title
        ? `Care Plan: ${pathwayTitleResult.rows[0].title}`
        : 'Pathway-Generated Care Plan';

      // Ensure the patient row exists so the patient_care_plans FK is
      // satisfied. No-op for real patients; creates a placeholder for the
      // admin simulator's synthetic UUIDs.
      await client.query(
        `INSERT INTO patients (id, first_name, last_name, date_of_birth)
         VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
         ON CONFLICT (id) DO NOTHING`,
        [session.patientId],
      );

      // Per migration 019: target the patient-specific instance tables.
      // `care_plans` is the patient-agnostic pathway-definition table and
      // does not have patient_id/provider_id/status/source columns.
      const carePlanResult = await client.query(
        `INSERT INTO patient_care_plans
           (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
         VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
         RETURNING id`,
        [
          session.patientId,
          carePlanTitle,
          session.providerId,
          carePlanData.conditionCodes,
          session.providerId,
        ]
      );
      carePlanId = carePlanResult.rows[0].id;

      // 5. Insert goals. The patient-specific table has no `pathway_node_id`
      // column; we stash the source node id in `guideline_reference`
      // alongside any caller-supplied reference so provenance is preserved.
      for (const goal of carePlanData.goals) {
        const refParts: string[] = [];
        if (goal.guidelineReference) refParts.push(goal.guidelineReference);
        if (goal.pathwayNodeId) refParts.push(`node:${goal.pathwayNodeId}`);
        await client.query(
          `INSERT INTO patient_care_plan_goals
             (patient_care_plan_id, description, priority, guideline_reference)
           VALUES ($1, $2, $3, $4)`,
          [carePlanId, goal.description, goal.priority, refParts.length > 0 ? refParts.join(' ') : null]
        );
      }

      // 6. Insert interventions. Per the patient-specific table's column
      // list, we drop recommendation_confidence / source / pathway_node_id /
      // pathway_id / session_id (none exist) and fold provenance into
      // guideline_reference. Lab interventions also don't have a `lab_code`
      // column — callers should send them as MONITORING with the LOINC in
      // the description.
      for (const intervention of carePlanData.interventions) {
        const refParts: string[] = [];
        if (intervention.guidelineReference) refParts.push(intervention.guidelineReference);
        if (intervention.pathwayId) refParts.push(`pathway:${intervention.pathwayId}`);
        if (intervention.pathwayNodeId) refParts.push(`node:${intervention.pathwayNodeId}`);
        if (intervention.sessionId) refParts.push(`session:${intervention.sessionId}`);
        await client.query(
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
          ]
        );
      }

      // 7. Update session with carePlanId and COMPLETED status (within transaction)
      await client.query(
        `UPDATE pathway_resolution_sessions
         SET care_plan_id = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [carePlanId, SessionStatus.COMPLETED, args.sessionId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Care plan generation failed:', err);
      throw new GraphQLError('Failed to generate care plan: transaction rolled back', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    } finally {
      client.release();
    }

    // 8. Log event (outside transaction — non-critical)
    await logEvent(pool, args.sessionId, {
      eventType: 'care_plan_generated',
      triggerData: {
        carePlanId,
        goalsCount: carePlanData.goals.length,
        interventionsCount: carePlanData.interventions.length,
      },
      nodesRecomputed: 0,
      statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.COMPLETED }],
    });

    return {
      success: true as const,
      carePlanId,
      warnings: [] as string[],
      blockers: [] as Array<{ type: string; description: string; relatedNodeIds: string[] }>,
    };
  },

  async abandonSession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // 1. Load session
    const session = await getSession(pool, args.sessionId);
    if (!session) {
      throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
    }

    // 2. Set status to ABANDONED
    await updateSession(pool, args.sessionId, {
      status: SessionStatus.ABANDONED,
    });

    // 3. Log event
    await logEvent(pool, args.sessionId, {
      eventType: 'abandoned',
      triggerData: { reason: args.reason ?? 'No reason provided' },
      nodesRecomputed: 0,
      statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.ABANDONED }],
    });

    // 4. Return formatted session
    const updated = await getSession(pool, args.sessionId);
    if (!updated) {
      throw new GraphQLError('Failed to retrieve updated session', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return formatSessionForGraphQL(updated);
  },
};
