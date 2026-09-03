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
import type { ResolutionSession } from '../../services/resolution/types';
import type { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  buildResolutionContext,
  makeTraversalAdapter,
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
import type { Pool } from 'pg';
import type { ResolutionState } from '../../services/resolution/types';
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

/**
 * Re-run DDI over a session whose resolution state has just changed.
 *
 * DDI used to run ONCE, at session creation. Every mutation that re-resolves
 * can bring a medication INTO the plan — a branch chosen at a DecisionPoint, a
 * gate opened by an answer, a node included by an override — and adding
 * medications to the patient context changes the other side of the check. So a
 * care plan could be generated from medication state that never passed DDI.
 *
 * Centralised rather than repeated at each call site: five paths mutate the
 * plan, and a check that must be remembered five times is a check that will be
 * forgotten once.
 *
 * `applyDdiToResolutionState` only ever moves a node INCLUDED -> EXCLUDED, so
 * re-running it cannot resurrect a suppression that no longer applies; that
 * happens when the region is re-disposed, which is what put the node back to
 * INCLUDED in the first place.
 */
async function refreshSessionDdi(
  pool: Pool,
  session: { resolutionState: ResolutionState; ddiWarnings?: unknown[] },
  patientContext: PatientContext,
): Promise<void> {
  const result = await applyDdiToResolutionState(pool, session.resolutionState, patientContext);
  session.ddiWarnings = result.findings.filter((f) => f.action === 'WARN');
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
    let degraded = false;
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
      const incrementalEngine = new TraversalEngine(
        makeTraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
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

      const reResult = await incrementalEngine.resolveIncrementally(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        patientCtx,
        session.gateAnswers,
        { pendingQuestions: session.pendingQuestions, redFlags: session.redFlags },
      );
      degraded = degraded || reResult.isDegraded;

      if (llmBundle) await llmBundle.flushAudits(args.sessionId);

      statusChanges.push(...reResult.statusChanges);
      // An override RE-DISPOSES a region, so it can settle a question and
      // clear a flag as surely as an answer can. Both were discarded here, so
      // overriding a node out of the plan left the questions and red flags of
      // everything beneath it standing for ever.
      session.pendingQuestions = reResult.pendingQuestions;
      session.redFlags = reResult.redFlags;
    }

    // Outside the re-resolution guard on purpose. An INCLUDE override puts THAT
    // node into the plan whether or not anything downstream was affected, and
    // if it is a Medication it has never been checked against the patient's
    // other drugs.
    await refreshSessionDdi(
      pool,
      session,
      buildEffectivePatientContext(
        session.initialPatientContext as PatientContext,
        session.additionalContext as Partial<AdditionalContextInput>,
      ),
    );

    // 7. Update session (with optimistic lock)
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
      // Persisted now that an override reconciles them. It did not touch
      // either before, so there was nothing here to write.
      pendingQuestions: session.pendingQuestions,
      redFlags: session.redFlags,
      totalNodesEvaluated: session.resolutionState.size,
      // A degraded incremental resolve timed out midway. The region it was
      // rebuilding is only partly rebuilt, so the session must SAY so rather
      // than look complete — nothing downstream can tell otherwise.
      ...(degraded ? { status: SessionStatus.DEGRADED } : {}),
      ddiWarnings: session.ddiWarnings,
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

  /**
   * Answer whatever the session is waiting on at a node: a question gate, an
   * escalated request for a datum, or a branch choice at a DecisionPoint.
   *
   * Renamed from `answerGateQuestion` — it answers three different things now,
   * and `gateId` was wrong for the third.
   */
  async answerPendingDecision(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; answer: GateAnswerInput },
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
    let degraded = false;
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
      const gateResult = session.resolutionState.get(args.nodeId);
      if (!gateResult) {
        throw new GraphQLError(`Gate "${args.nodeId}" not found in session`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // ─── Branch choice at a DecisionPoint ─────────────────────────
      //
      // A one_of fork with several qualifying branches pends rather than
      // taking them all (plan 05 task 1). The answer names which branch
      // applies; taking it must CLOSE the others, or the pend bought nothing.
      if (gateResult.nodeType === 'DecisionPoint') {
        const pendingDecision = session.pendingQuestions.find(q => q.gateId === args.nodeId);
        const candidates = pendingDecision?.options ?? [];
        const chosen = args.answer.selectedOption;

        if (!chosen || !candidates.includes(chosen)) {
          throw new GraphQLError(
            `"${chosen}" is not among the candidate branches at "${args.nodeId}": ` +
              `${candidates.join(', ')}`,
            { extensions: { code: 'BAD_USER_INPUT' } },
          );
        }

        const rctxDp = await buildResolutionContext(pool, session.pathwayId);
        const dpClock = requireSessionTemporalContext(session);

        // Everything the session has learned since it was created, not just
        // the context it was created with. Conditions, medications and
        // allergies added later live here — the fact store carries labs and
        // vitals, but not these — and every other re-resolution path in this
        // resolver already builds context this way. This one did not, so a
        // branch choice re-resolved against a stale picture of the patient.
        const dpPatientCtx = buildEffectivePatientContext(
          session.initialPatientContext as PatientContext,
          session.additionalContext as Partial<AdditionalContextInput>,
        );

        // Record the choice as an ANSWER before re-resolving.
        //
        // Two things follow from that. It SURVIVES: an ancestor retraversal
        // that re-disposes this DecisionPoint reads the answer and keeps the
        // branch, instead of finding several qualifying branches again and
        // re-asking a question the provider already answered. And it is what
        // the engine routes on, so the choice takes effect through the same
        // disposition path a full traversal uses rather than through a second
        // implementation here.
        session.gateAnswers.set(args.nodeId, { selectedOption: chosen } as GateAnswer);

        const dpEngine = new TraversalEngine(
          makeTraversalAdapter(rctxDp, pool, session.pathwayId, dpPatientCtx),
          rctxDp.thresholds,
          dpClock,
          rctxDp.temporalDefaults,
          factStoreForSession(session, session.additionalContext as Partial<AdditionalContextInput>),
          rctxDp.codeMap,
        );

        // Seeded at the DECISION POINT, not at the chosen branch.
        //
        // Disposing the DecisionPoint is what closes the branches nobody
        // chose — roots AND their subtrees — because that is what the normal
        // traversal path already does. Seeding at the chosen branch alone
        // closed only the roots of the other QUALIFYING candidates: their
        // descendants, and every non-qualifying branch, stayed
        // PENDING_QUESTION while the DecisionPoint's own question was removed.
        // That is a session no answer can finish, because care-plan generation
        // blocks on any PENDING_QUESTION and none of the remaining ones had a
        // question left to answer.
        const dpResult = await dpEngine.resolveIncrementally(
          new Set([args.nodeId]),
          session.resolutionState,
          session.dependencyMap,
          rctxDp.graphContext,
          dpPatientCtx,
          session.gateAnswers,
          {
            pendingQuestions: session.pendingQuestions,
            redFlags: session.redFlags,
            alsoDropGateIds: [args.nodeId],
          },
        );
      degraded = degraded || dpResult.isDegraded;

        statusChanges.push(...dpResult.statusChanges);
        nodesRecomputed = dpResult.nodesRecomputed;

        // Findings from the chosen subtree are KEPT. Discarding them lost every
        // question and red flag the chosen branch raised, so a branch leading
        // to further questions looked resolved.
        // Reconciled wholes, not additions — the engine already merged them
        // against what the session held.
        session.pendingQuestions = dpResult.pendingQuestions;
        session.redFlags = dpResult.redFlags;

        // The chosen branch is exactly where new medications come from.
        await refreshSessionDdi(pool, session, dpPatientCtx);

        try {
          await updateSession(pool, args.sessionId, {
            resolutionState: session.resolutionState,
            dependencyMap: session.dependencyMap,
            pendingQuestions: session.pendingQuestions,
            redFlags: session.redFlags,
            gateAnswers: session.gateAnswers,
            totalNodesEvaluated: session.resolutionState.size,
          // A degraded incremental resolve timed out midway. The region it was
      // rebuilding is only partly rebuilt, so the session must SAY so rather
      // than look complete — nothing downstream can tell otherwise.
      ...(degraded ? { status: SessionStatus.DEGRADED } : {}),
            ddiWarnings: session.ddiWarnings,
          }, session.updatedAt);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('optimistic lock') && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
            continue;
          }
          throw err;
        }

        await logEvent(pool, args.sessionId, {
          eventType: 'BRANCH_CHOSEN',
          triggerData: { nodeId: args.nodeId, chosen, candidates },
          nodesRecomputed,
          statusChanges,
        });
        const refreshed = await getSession(pool, args.sessionId);
        return formatSessionForGraphQL(refreshed ?? session);
      }

      // ─── Escalated datum request ──────────────────────────────────
      //
      // A gate that could not DECIDE asks for the datum it needed, and the
      // pending entry carries where the answer belongs. Such an answer is a
      // FACT, not a verdict: it goes into the session's patient context and
      // the gate re-evaluates from it, which is what makes one answer resolve
      // every gate reading that datum rather than only the one asked.
      //
      // Delegated to addPatientContext rather than reimplemented — one way for
      // a fact to enter a session. Two ways is how the traversal engines
      // diverged, and this is the same shape of mistake.
      const escalated = session.pendingQuestions.find(
        q => q.gateId === args.nodeId && q.askTarget,
      );
      if (escalated?.askTarget) {
        const value = args.answer.numericValue;
        if (value === undefined || value === null) {
          throw new GraphQLError(
            `Gate "${args.nodeId}" is a request for ${escalated.datumKey}; supply numericValue`,
            { extensions: { code: 'BAD_USER_INPUT' } },
          );
        }

        const target = escalated.askTarget;
        const fragment: AdditionalContextInput =
          target.kind === 'lab'
            ? { labResults: [{ code: target.code, system: target.system, value }] }
            : target.kind === 'vital'
              ? { vitalSigns: { [target.path]: value } }
              // `patient.trimester` addresses patientAttributes.trimester —
              // resolveAttribute reads a FLAT key, not a nested namespace.
              : { patientAttributes: { [target.path.split('.').slice(1).join('.')]: value } };

        // NOTE: deliberately no `sourceId` on the fragment. It is in
        // LAB_ASSERTION_FIELDS, so the trust guard would reject it — and
        // rightly: that guard stops CALLERS asserting clinical provenance.
        // The fact that a clinician supplied this rather than the chart is
        // recorded below as an audit event, which is where "who said what"
        // belongs. It must not be dressed up as an observation.
        await logEvent(pool, args.sessionId, {
          eventType: 'PROVIDER_ASSERTED_DATUM',
          triggerData: { gateId: args.nodeId, datumKey: escalated.datumKey, target, value },
          nodesRecomputed: 0,
          statusChanges: [],
        });

        // Deliberately NOT written to session.gateAnswers. That map is what
        // evaluateQuestion reads; an entry there would make this data gate
        // look like an answered QUESTION gate and be consulted instead of the
        // fact on every later retraversal.
        return resolutionMutations.addPatientContext(
          _parent,
          { sessionId: args.sessionId, additionalContext: fragment },
          context,
        );
      }

      const newAnswer: GateAnswer = {
        booleanValue: args.answer.booleanValue,
        numericValue: args.answer.numericValue,
        selectedOption: args.answer.selectedOption,
      };
      session.gateAnswers.set(args.nodeId, newAnswer);


      // 4. Build resolution context and find affected subtree
      const rctx = await buildResolutionContext(pool, session.pathwayId);

      // Reject a clock-less session up front, not only when a retraversal
      // happens to be triggered — the session is un-retraversable either way.
      const sessionClock = requireSessionTemporalContext(session);

      const affectedNodes = new Set<string>();
      affectedNodes.add(args.nodeId);
      const subtreeQueue = [args.nodeId];
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

      // EVERY valid answer goes through the engine.
      //
      // This used to branch on a truthiness test — `booleanValue === true ||
      // selectedOption != null || numericValue != null` — and hand-marked the
      // whole subtree GATED_OUT when it failed. Answering "no" is a DECISION,
      // not the absence of one: it can select a `{ equals: false }` branch. The
      // hand-rolled path never called the engine, so a false answer never
      // routed, never reconciled findings and never re-ran DDI, however
      // correctly the engine handled it.
      //
      // It was also a second disposition implementation living in the resolver,
      // the same duplication plan 03 removed from the engine. `disposeNode`
      // decides what an answer means — INCLUDING when the answer closes the
      // gate, where it applies `default_behavior` that the hand-rolled
      // GATED_OUT ignored. The gate is in `affectedNodes`, so it is re-disposed
      // like anything else and its own status change is computed, not asserted.

      // NOTE: there used to be a loop here deleting every PENDING_QUESTION /
      // GATED_OUT node under the answered gate, because `retraverse` could
      // only re-evaluate rows that already existed and had no way to
      // re-resolve one in place. It also had no way to RECREATE what it
      // deleted, so answering a question permanently removed nodes from the
      // session. `resolveIncrementally` clears and rebuilds its own region
      // through the same unit that materialises nodes on a full traversal,
      // so deleting here would destroy exactly what it is about to rebuild.

      const llmBundle = makeLlmGateEvaluator(pool, session.pathwayId, args.sessionId);
      const incrementalEngine = new TraversalEngine(
        makeTraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
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

      const reResult = await incrementalEngine.resolveIncrementally(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        patientCtx,
        session.gateAnswers,
        {
          pendingQuestions: session.pendingQuestions,
          redFlags: session.redFlags,
          alsoDropGateIds: [args.nodeId],
        },
      );
    degraded = degraded || reResult.isDegraded;

      if (llmBundle) await llmBundle.flushAudits(args.sessionId);

      statusChanges.push(...reResult.statusChanges);
      nodesRecomputed = reResult.nodesRecomputed;

      // Update pending questions and red flags
      // Remove the answered gate from pending, add any new ones
      session.pendingQuestions = reResult.pendingQuestions;
      session.redFlags = reResult.redFlags;

      // An answer that opens a gate opens whatever it prescribes.
      await refreshSessionDdi(pool, session, patientCtx);

      // Reported from what the engine decided, not predicted from the answer's
      // shape. Only the audit event reads it.
      gateOpened = session.resolutionState.get(args.nodeId)?.status === NodeStatus.INCLUDED;

      // 7. Update session (optimistic lock)
      try {
        await updateSession(pool, args.sessionId, {
          resolutionState: session.resolutionState,
          pendingQuestions: session.pendingQuestions,
          redFlags: session.redFlags,
          gateAnswers: session.gateAnswers,
          totalNodesEvaluated: session.resolutionState.size,
        // A degraded incremental resolve timed out midway. The region it was
      // rebuilding is only partly rebuilt, so the session must SAY so rather
      // than look complete — nothing downstream can tell otherwise.
      ...(degraded ? { status: SessionStatus.DEGRADED } : {}),
          ddiWarnings: session.ddiWarnings,
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
        gateId: args.nodeId,
        answer: args.answer,
        gateOpened,
      },
      nodesRecomputed,
      statusChanges,
    });

    // 9. Log to pathway_gate_answers
    await logGateAnswer(pool, {
      sessionId: args.sessionId,
      gateId: args.nodeId,
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
    let degraded = false;
    let nodesRecomputed = 0;

    if (affectedNodes.size > 0) {
      const rctx = await buildResolutionContext(pool, session.pathwayId);

      const llmBundle = makeLlmGateEvaluator(pool, session.pathwayId, args.sessionId);
      const incrementalEngine = new TraversalEngine(
        makeTraversalAdapter(rctx, pool, session.pathwayId, updatedPc),
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

      const reResult = await incrementalEngine.resolveIncrementally(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        updatedPc,
        session.gateAnswers,
        { pendingQuestions: session.pendingQuestions, redFlags: session.redFlags },
      );
      degraded = degraded || reResult.isDegraded;

      if (llmBundle) await llmBundle.flushAudits(args.sessionId);

      statusChanges.push(...reResult.statusChanges);
      nodesRecomputed = reResult.nodesRecomputed;

      // Reconciled wholes. This replaces a hand-rolled prune-then-append that
      // deduped on `gateId`, which could not see that two gates share ONE
      // escalated datum prompt — the shared key is the datum. The engine now
      // does the merge, keyed the same way for questions and flags.
      //
      // Dropping a question whose gate is no longer PENDING_QUESTION is what
      // the reconcile already does: the gate was re-disposed, it no longer
      // asks, so the question is settled.
      session.pendingQuestions = reResult.pendingQuestions;
      session.redFlags = reResult.redFlags;
    }

    // Outside the re-resolution guard on purpose. Adding medications changes
    // the OTHER side of the check — the patient's own list — so DDI must run
    // even when no gate depended on the new context and nothing was re-resolved.
    await refreshSessionDdi(pool, session, updatedPc);

    // 6. Update session (with optimistic lock)
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
      additionalContext: merged,
      pendingQuestions: session.pendingQuestions,
      redFlags: session.redFlags,
      totalNodesEvaluated: session.resolutionState.size,
      // A degraded incremental resolve timed out midway. The region it was
      // rebuilding is only partly rebuilt, so the session must SAY so rather
      // than look complete — nothing downstream can tell otherwise.
      ...(degraded ? { status: SessionStatus.DEGRADED } : {}),
      ddiWarnings: session.ddiWarnings,
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

    // 1b. DDI, immediately before the plan is built.
    //
    // The four resolution mutations each refresh DDI, so this should be a
    // no-op. It runs anyway because this is the last moment before a plan
    // becomes a clinical artefact, and "some other path already checked" is
    // the assumption that let a plan be generated from medication state that
    // never passed DDI at all. A suppression here still excludes the node, so
    // it changes the plan rather than merely reporting on it.
    await refreshSessionDdi(
      pool,
      session,
      buildEffectivePatientContext(
        session.initialPatientContext as PatientContext,
        session.additionalContext as Partial<AdditionalContextInput>,
      ),
    );

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
