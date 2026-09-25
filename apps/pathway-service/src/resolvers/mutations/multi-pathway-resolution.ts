/**
 * Multi-pathway runs on the evaluation pipeline (spec §3; plan 04).
 *
 * A run is a parent session plus one child session per contributing pathway.
 * The parent owns the patient facts added after start, the clock, the
 * conflict decisions and the run's single revision (D5, D6). Every mutation
 * loads one environment snapshot, re-evaluates every child at CONTRIBUTION
 * scope, composes the run (`composeRun`) and commits the parent and every
 * child in one transaction under the parent's revision (`commitRun`). Reads
 * never recompute.
 *
 * Mutations here: startMultiPathwayResolution, resolveConflict,
 * generateMergedCarePlan, abandonMultiPathwaySession, deletePreviewSession.
 * An answer, override or fact on a child goes through the single-pathway
 * mutations, which route a child to `commitRun` (resolution.ts).
 */

import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../../types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  parseResolutionInput,
  ResolutionModeArgs,
} from '../../services/resolution/temporal/trust-mode';
import { assertAssemblableMode } from '../../services/resolution/temporal/context-assembler';
import {
  formatBlocker,
  PatientContextArgs,
  PLAN_CHANGED,
  TemporalAnchorArgs,
  temporalInputFrom,
  toPatientContext,
  warningsOf,
} from './resolution';
import { SessionStatus } from '../../services/resolution/types';
import {
  getMatchedPathways,
  insertSession,
  logEvent,
  writeChildrenLifecycle,
  writeLlmAudits,
} from '../../services/resolution/session-store';
import type { Db } from '../../services/resolution/session-store';
import { collapseLattice } from '../../services/resolution/lattice-collapse';
import {
  MergedCarePlan,
  MergedConflict,
  ConflictResolution,
  ConflictResolutionKind,
  CustomMedicationOverride,
} from '../../services/resolution/care-plan-merge';
import { resolveTemporalPolicyVersion } from '../helpers/resolution-context';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import {
  deletePreviewSession,
  getMultiPathwaySession,
  getPatientMultiPathwaySessions,
  insertRun,
  MultiPathwayResolutionSession,
  MultiPathwaySessionStatus,
  setContributingSessions,
  setRunCarePlanId,
  writeRunLifecycle,
} from '../../services/resolution/multi-pathway-session-store';
import { conflictError, MAX_ATTEMPTS, statusOf } from '../../services/resolution/pipeline/commit';
import { inTransaction, persistedObservations, RevisionConflict } from '../../services/resolution/pipeline/request';
import {
  clearAudits,
  evaluateRun,
  newRunRequest,
  requestFor,
  runInputsOf,
  sessionInputsOf,
} from '../../services/resolution/pipeline/run';
import {
  assertRunMutable,
  commitRun,
  loadRun,
  withRunAudits,
  writeRun,
} from '../../services/resolution/pipeline/run-commit';

// ─── Argument shapes ────────────────────────────────────────────────

export interface MultiPathwayResolutionArgs extends ResolutionModeArgs, TemporalAnchorArgs {
  patientId: string;
  /**
   * Expressed against the shared `PatientContextArgs` rather than re-declared
   * inline: `CodeInput`/`LabResultInput` are one SDL type each, and a second
   * copy of their TypeScript shape is a field the resolver silently drops the
   * next time the input grows.
   */
  patientContext?: PatientContextArgs;
  /**
   * QA / preview capability. When true, DRAFT pathways are also considered for
   * matching (in addition to ACTIVE). Use for QA tooling against unpublished
   * pathways.
   *
   * NOT ACCESS-CONTROLLED, deliberately, for now. A role check here would be
   * caller-asserted and therefore worthless: this service reads `x-user-role`
   * straight off the request with a PROVIDER default (`index.ts`) and never
   * derives it from the bearer token — `prism-provider-front-end` does send
   * `authorization: Bearer <token>` (its `lib/apollo-client.ts`), but nothing
   * here reads it. Meanwhile `prism-admin-dashboard`, the client that actually
   * calls this mutation, sets no auth header at all, so an ADMIN check would
   * break the encounter simulator (`PatientComposer.tsx`) and pathway preview
   * (`PreviewResolutionPanel.tsx`) — both of which send these flags — while
   * securing nothing.
   *
   * Tracked as authentication debt: `docs/AUTHORIZATION_DEBT.md`. Gate on
   * verified claims when auth lands, not before.
   */
  includeDraftPathways?: boolean;
  /**
   * QA / preview capability. When true, the matcher uses the resolved
   * `conditionCodes` directly instead of looking up the patient row in the
   * EMR-synced snapshot tables. Required for the admin simulator, where there
   * is no real patient. Same non-enforcement note as `includeDraftPathways`.
   *
   * Only coherent on a SYNTHETIC resolution — see the guard in the resolver.
   */
  syntheticPatient?: boolean;
}

export interface ConflictChoiceInput {
  kind: ConflictResolutionKind;
  reason?: string;
  chosenPathwayId?: string;
  customMedication?: CustomMedicationOverride;
}

export interface ResolveConflictArgs {
  sessionId: string;
  conflictId: string;
  choice: ConflictChoiceInput;
}

// ─── Mutations ──────────────────────────────────────────────────────

export const multiPathwayResolutionMutations = {
  async startMultiPathwayResolution(
    _parent: unknown,
    args: MultiPathwayResolutionArgs,
    context: DataSourceContext,
  ) {
    const { pool } = context;

    // Validation FIRST. The matcher options below decide which pathways are
    // even considered, so building them from `args.patientContext` before the
    // trust boundary ran meant raw caller codes drove matching on a request
    // the boundary might reject.
    //
    // Exactly one payload per trust mode, policed over the WHOLE raw request:
    // a LIVE or REPLAY caller cannot smuggle in facts or a clock, and an
    // explicit SYNTHETIC needs ADMIN. An absent mode stays SYNTHETIC so every
    // existing caller works, but admits only what they could already send.
    const resolutionInput = parseResolutionInput(args, args.patientId, context.userRole);
    assertAssemblableMode(resolutionInput);

    // Built once, from the VARIANT — never re-derived from args.patientContext,
    // which would reintroduce the raw payload on a path that already validated.
    const patientContext = toPatientContext(resolutionInput);

    // `syntheticPatient` means "drive matching from the caller's own code set",
    // which has no coherent meaning once the facts come from a snapshot (LIVE)
    // or from a recorded session (REPLAY). Encoded as a guard rather than left
    // to documentation, so the combination cannot quietly become valid when
    // plan 07 makes LIVE reachable.
    if (args.syntheticPatient && resolutionInput.mode !== 'SYNTHETIC') {
      throw new GraphQLError(
        `syntheticPatient is not valid on a ${resolutionInput.mode} resolution`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }

    const matcherOptions: { directPatientCodes?: Array<{ code: string; system: string }>; includeDraftPathways?: boolean } = {};
    if (args.includeDraftPathways) {
      matcherOptions.includeDraftPathways = true;
    }
    if (args.syntheticPatient) {
      // For synthetic patients, drive matching off the supplied codes only —
      // there is no real patients row to read from. Read from the VALIDATED
      // context, so every code that reaches the matcher has been through the
      // same boundary as the codes that reach the evaluator.
      matcherOptions.directPatientCodes = patientContext.conditionCodes.map((c) => ({
        code: c.code,
        system: c.system,
      }));
    }

    // syntheticPatient signals this is admin/QA/preview traffic; persist that
    // so downstream list views can filter it out and `deletePreviewSession`
    // can clean up. Real provider encounters never set this flag.
    //
    // NOT role-gated, deliberately — see the note on `includeDraftPathways` in
    // MultiPathwayResolutionArgs.
    const isPreview = args.syntheticPatient === true;

    // The SERVER's policy version, read immediately before the clock is stamped
    // and before `getMatchedPathways` — the zero-match branch below returns
    // without ever building a `ResolutionContext`, which is why the selector
    // takes the GraphQL context instead (P1-14). One read per request is also
    // what gives every child session the same version (§1).
    const temporalPolicyVersion = resolveTemporalPolicyVersion(context);

    // One clock for the entire multi-pathway run (§1) — the parent session and
    // every contributing session resolve horizons against the same instant.
    // Created here, before the zero-match branch, so BOTH exits stamp it.
    const temporalContext = makeEvaluationTemporalContext({
      ...temporalInputFrom(args),
      temporalPolicyVersion,
    });

    // Before the zero-match branch: that path creates a parent session and
    // returns without ever entering resolveAndPersistAll, so a version
    // validated only during the sweep would never be checked at all.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Validates the request — like the version check — before the zero-match
    // branch: whether a malformed context is rejected must not depend on how
    // many pathways happened to match. The store itself is discarded; each
    // child's evaluation assembles its own from the same inputs. Under
    // `legacy-v0` the assembler is never entered (P1-9).
    factStoreForInput(resolutionInput, temporalContext);

    const matched = await getMatchedPathways(pool, args.patientId, matcherOptions);
    // Zero matches takes the same path with no children (spec §3): the run is
    // stored, with EMPTY_PLAN at its root, as a record that nothing matched.
    const surviving = matched.length === 0 ? [] : await collapseLattice(pool, matched);

    const request = newRunRequest();
    const ev = await evaluateRun(pool, request, {
      initialPatientContext: patientContext,
      additionalContext: {},
      temporalContext,
      conflictResolutions: {},
      children: surviving.map((m) => ({
        sessionId: '',
        pathwayId: m.pathway.id,
        inputs: {
          pathwayId: m.pathway.id,
          graphFingerprint: '',
          gateAnswers: new Map(),
          providerOverrides: new Map(),
          observations: new Map(),
          revision: 0,
        },
      })),
    }, { pinGraphs: true });
    const versionOf = new Map(surviving.map((m) => [m.pathway.id, m.pathway.version]));

    // Every pathway was evaluated before anything is written, and everything is
    // written in ONE transaction: a failure leaves no parent, no child and no
    // audit row behind (P3-10).
    const runId = await inTransaction(pool, async (db) => {
      const id = await insertRun(db, {
        patientId: args.patientId,
        providerId: context.userId,
        isPreview,
        initialPatientContext: patientContext,
        temporalContext,
        additionalContext: {},
        conflictResolutions: {},
        result: ev.result,
      });
      const sessionIds: string[] = [];
      for (const child of ev.result.children) {
        const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
        const inputs = sessionInputsOf(ev.inputs, own.inputs);
        const req = requestFor(request, child.pathwayId);
        const sessionId = await insertSession(db, {
          pathwayVersion: versionOf.get(child.pathwayId)!,
          patientId: patientContext.patientId,
          providerId: context.userId,
          // The parent owns the facts (D5); the child keeps a copy of the initial context (P4-1).
          inputs: { ...inputs, additionalContext: {}, observations: persistedObservations(inputs, req, child.result) },
          result: child.result,
          status: statusOf(child.result),
          durationMs: ev.durationMs,
          parentSessionId: id,
        });
        await writeLlmAudits(db, sessionId, req.audits);
        await logEvent(db, sessionId, {
          eventType: 'traversal_complete',
          triggerData: { runId: id, pathwayId: child.pathwayId, patientId: args.patientId },
          nodesRecomputed: child.result.resolutionState.size,
          statusChanges: [],
        });
        sessionIds.push(sessionId);
      }
      await setContributingSessions(db, id, sessionIds, ev.result.children.map((c) => c.pathwayId));
      return id;
    });

    return formatSessionForGraphQL((await getMultiPathwaySession(pool, runId))!);
  },

  /**
   * Record a provider's decision for one conflict (spec §3). The decision is an
   * input on the parent; the merged plan is re-derived from the base merge on
   * every evaluation, so a changed decision REPLACES the previous one (review
   * #6), and the final set is safety-checked again (review #7).
   */
  async resolveConflict(
    _parent: unknown,
    args: ResolveConflictArgs,
    context: DataSourceContext,
  ) {
    // Built once, outside the retries: `resolvedAt` is when the provider decided.
    const decision = buildResolution(args.choice, context.userId);
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      const conflict = r.parent.mergedPlan.conflicts.find((c) => c.conflictId === args.conflictId);
      if (!conflict) {
        throw new GraphQLError(
          `Conflict "${args.conflictId}" not found in session "${args.sessionId}"`,
          { extensions: { code: 'NOT_FOUND' } },
        );
      }
      validateResolutionAgainstConflict(decision, conflict);
      const inputs = runInputsOf(r);
      inputs.conflictResolutions = { ...inputs.conflictResolutions, [args.conflictId]: decision };
      return { inputs, events: [] };
    });
    return formatSessionForGraphQL(run.parent);
  },

  /**
   * Materialize the run the provider reviewed (spec §4, Generation; D7).
   *
   * A COMPLETED run returns its plan without evaluating. Otherwise every child
   * is re-evaluated and the run recomposed: a changed resultHash returns
   * PLAN_CHANGED_SINCE_REVIEW, and unready readiness returns its blockers,
   * after storing the fresh run. If that store loses a revision race, the
   * blockers describe a state that no longer exists, so generation reloads and
   * evaluates again. The claim — the run to COMPLETED under the revision read,
   * every child with it — precedes the inserts in one transaction, so a lost
   * race or a failed insert leaves nothing behind (#4, #8). Every exit writes
   * the audit rows of LLM calls no committed transaction wrote.
   */
  async generateMergedCarePlan(
    _parent: unknown,
    args: { sessionId: string; reviewedResultHash: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const request = newRunRequest();
    type Outcome = { success: boolean; carePlanId: string | null; warnings: string[]; blockers: ReturnType<typeof formatBlocker>[] };

    return withRunAudits(pool, request, async (seen): Promise<Outcome> => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const run = await loadRun(pool, args.sessionId);
        seen.run = run;
        if (run.parent.status === 'COMPLETED') {
          return { success: true, carePlanId: run.parent.carePlanId, warnings: [], blockers: [] };
        }
        if (run.parent.status === 'ABANDONED') {
          throw new GraphQLError('Session was abandoned and cannot generate a care plan', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }

        const ev = await evaluateRun(pool, request, runInputsOf(run));
        const warnings = warningsOf(ev.result.ddiWarnings);
        const planChanged = ev.result.resultHash !== args.reviewedResultHash;

        try {
          if (planChanged || !ev.result.readiness.ready) {
            // Store what was just evaluated, so the provider re-reviews exactly this.
            await inTransaction(pool, (db) => writeRun(db, run, ev, request, 'ACTIVE'));
            clearAudits(request);
            const blockers = planChanged ? [PLAN_CHANGED] : ev.result.readiness.blockers;
            return { success: false, carePlanId: null, warnings, blockers: blockers.map(formatBlocker) };
          }

          const carePlanId = await inTransaction(pool, async (db) => {
            // Claim first (#8): only the request that moves the run to COMPLETED inserts.
            await writeRun(db, run, ev, request, 'COMPLETED');
            const id = await materializeCarePlan(db, run.parent, ev.result.mergedPlan);
            await setRunCarePlanId(db, run.parent.id, id);
            await writeChildrenLifecycle(db, run.parent.id, SessionStatus.COMPLETED, id);
            for (const child of run.children) {
              await logEvent(db, child.id, {
                eventType: 'care_plan_generated',
                triggerData: { carePlanId: id, runId: run.parent.id },
                nodesRecomputed: 0,
                statusChanges: [{ nodeId: 'session', from: child.status, to: SessionStatus.COMPLETED }],
              });
            }
            return id;
          });
          clearAudits(request);
          return { success: true, carePlanId, warnings, blockers: [] };
        } catch (err) {
          // Either write lost a race: reload, and evaluate the run that won.
          if (err instanceof RevisionConflict) continue;
          if (err instanceof GraphQLError) throw err;
          console.error('Merged care plan generation failed:', err);
          throw new GraphQLError('Failed to generate care plan: transaction rolled back', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
      }
      throw conflictError();
    });
  },

  /** Lifecycle only (spec §4): no evaluation; an ACTIVE run only; the revision check applies; every child follows. */
  async abandonMultiPathwaySession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await loadRun(pool, args.sessionId);
      assertRunMutable(run);
      try {
        await inTransaction(pool, async (db) => {
          const written = await writeRunLifecycle(db, {
            runId: run.parent.id, expectedRevision: run.parent.revision, status: 'ABANDONED',
          });
          if (!written) throw new RevisionConflict();
          await writeChildrenLifecycle(db, run.parent.id, SessionStatus.ABANDONED);
          for (const child of run.children) {
            await logEvent(db, child.id, {
              eventType: 'abandoned',
              triggerData: { reason: args.reason ?? 'No reason provided', runId: run.parent.id },
              nodesRecomputed: 0,
              statusChanges: [{ nodeId: 'session', from: child.status, to: SessionStatus.ABANDONED }],
            });
          }
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      return formatSessionForGraphQL((await getMultiPathwaySession(pool, args.sessionId))!);
    }
    throw conflictError();
  },

  /**
   * Hard-delete a preview session (and its contributing per-pathway
   * sessions). Refuses to touch a real session — those must go through
   * `abandonMultiPathwaySession`, which preserves the row for audit.
   * Intended for admin/QA/preview UIs to clean up after themselves so
   * preview traffic doesn't accumulate in the database.
   */
  async deletePreviewSession(
    _parent: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const result = await deletePreviewSession(context.pool, args.sessionId);
    if (result.kind === 'not-found') {
      throw new GraphQLError('Session not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    if (result.kind === 'not-preview') {
      throw new GraphQLError(
        'Session is not a preview session and cannot be hard-deleted; use abandonMultiPathwaySession instead',
        { extensions: { code: 'FORBIDDEN' } },
      );
    }
    return {
      sessionId: args.sessionId,
      contributingSessionsDeleted: result.contributingSessionsDeleted,
    };
  },
};

// ─── Query resolvers (exported separately for Query.ts) ─────────────

export const multiPathwayResolutionQueries = {
  async multiPathwayResolutionSession(
    _: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const session = await getMultiPathwaySession(context.pool, args.sessionId);
    return session ? formatSessionForGraphQL(session) : null;
  },

  async patientMultiPathwayResolutionSessions(
    _: unknown,
    args: {
      patientId: string;
      status?: MultiPathwaySessionStatus;
      includePreview?: boolean;
    },
    context: DataSourceContext,
  ) {
    const summaries = await getPatientMultiPathwaySessions(
      context.pool,
      args.patientId,
      args.status,
      args.includePreview ?? false,
    );
    return summaries.map((s) => ({
      id: s.id,
      patientId: s.patientId,
      providerId: s.providerId,
      status: s.status,
      isPreview: s.isPreview,
      contributingPathwayCount: s.contributingPathwayCount,
      unresolvedConflictCount: s.unresolvedConflictCount,
      carePlanId: s.carePlanId,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  },
};

// ─── Type field resolvers ──────────────────────────────────────────

/**
 * MultiPathwayResolutionSession.contributingPathways — lazily fetches the
 * hydrated Pathway objects for the IDs already on the parent. Single SQL
 * query (`WHERE id = ANY($1)`), one round trip per session. Order is
 * preserved to match `contributingPathwayIds` so the FE can correlate
 * positionally with `sourcePathwayIds` elsewhere on the session.
 */
export const multiPathwayResolutionTypeResolvers = {
  MultiPathwayResolutionSession: {
    contributingPathways: async (
      parent: { contributingPathwayIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingPathwayIds || parent.contributingPathwayIds.length === 0) {
        return [];
      }
      const result = await context.pool.query(
        `SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
                title, version, category, status,
                condition_codes AS "conditionCodes",
                scope, target_population AS "targetPopulation",
                is_active AS "isActive",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM pathway_graph_index
           WHERE id = ANY($1::uuid[])`,
        [parent.contributingPathwayIds],
      );
      const byId = new Map(result.rows.map((row) => [row.id as string, row]));
      return parent.contributingPathwayIds
        .map((id) => byId.get(id))
        .filter((row): row is Record<string, unknown> => row !== undefined);
    },

    /**
     * Aggregate pending Gate questions across all contributing per-pathway
     * sessions. Each entry carries `sessionId` + `pathwayId` so the FE can
     * route the answer to the right per-pathway session and surface which
     * pathway the gate belongs to.
     */
    pendingGateQuestions: async (
      parent: { contributingSessionIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingSessionIds || parent.contributingSessionIds.length === 0) {
        return [];
      }
      const result = await context.pool.query(
        `SELECT s.id AS session_id,
                s.pathway_id AS pathway_id,
                p.title AS pathway_title,
                s.pending_questions AS pending_questions
           FROM pathway_resolution_sessions s
           LEFT JOIN pathway_graph_index p ON p.id = s.pathway_id
          WHERE s.id = ANY($1::uuid[])
            AND jsonb_array_length(s.pending_questions) > 0`,
        [parent.contributingSessionIds],
      );
      const out: Array<{
        sessionId: string;
        pathwayId: string;
        pathwayTitle: string;
        gateId: string;
        prompt: string;
        answerType: string;
        options: string[] | null;
        affectedSubtreeSize: number;
        estimatedImpact: string;
        tentative: boolean | null;
        tentativeBranch: string | null;
        tentativeConfidence: number | null;
        tentativeReasoning: string | null;
        datumKey: string | null;
        optionLabels: string[] | null;
      }> = [];
      for (const row of result.rows) {
        const questions = (row.pending_questions ?? []) as Array<Record<string, unknown>>;
        for (const q of questions) {
          const tentativeConfidenceRaw = q.tentativeConfidence ?? q.tentative_confidence;
          out.push({
            sessionId: String(row.session_id),
            pathwayId: String(row.pathway_id),
            pathwayTitle: String(row.pathway_title ?? '(untitled pathway)'),
            gateId: String(q.gateId ?? q.gate_id ?? ''),
            prompt: String(q.prompt ?? ''),
            answerType: String(q.answerType ?? q.answer_type ?? 'BOOLEAN'),
            options: Array.isArray(q.options) ? (q.options as string[]) : null,
            affectedSubtreeSize: Number(q.affectedSubtreeSize ?? q.affected_subtree_size ?? 0),
            estimatedImpact: String(q.estimatedImpact ?? q.estimated_impact ?? 'unknown'),
            tentative: q.tentative == null ? null : Boolean(q.tentative),
            tentativeBranch: q.tentativeBranch == null && q.tentative_branch == null
              ? null
              : String(q.tentativeBranch ?? q.tentative_branch),
            tentativeConfidence: tentativeConfidenceRaw == null
              ? null
              : Number(tentativeConfidenceRaw),
            tentativeReasoning: q.tentativeReasoning == null && q.tentative_reasoning == null
              ? null
              : String(q.tentativeReasoning ?? q.tentative_reasoning),
            // Both spellings, like the fields above: these rows come off
            // persisted JSON that has been written by more than one shape.
            datumKey: q.datumKey == null && q.datum_key == null
              ? null
              : String(q.datumKey ?? q.datum_key),
            optionLabels: Array.isArray(q.optionLabels ?? q.option_labels)
              ? ((q.optionLabels ?? q.option_labels) as string[])
              : null,
          });
        }
      }
      return out;
    },
  },
};

// ─── Internals ──────────────────────────────────────────────────────

// ─── Conflict resolution logic ──────────────────────────────────────

function buildResolution(
  choice: ConflictChoiceInput,
  resolvedBy: string,
): ConflictResolution {
  const meta = { resolvedBy, resolvedAt: new Date().toISOString(), reason: choice.reason };
  switch (choice.kind) {
    case 'CONFIRM_PATHWAY':
      if (!choice.chosenPathwayId) {
        throw new GraphQLError('chosenPathwayId is required for CONFIRM_PATHWAY', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      return { kind: 'CONFIRM_PATHWAY', chosenPathwayId: choice.chosenPathwayId, ...meta };
    case 'ACCEPT_BOTH':
      return { kind: 'ACCEPT_BOTH', ...meta };
    case 'REJECT_BOTH':
      return { kind: 'REJECT_BOTH', ...meta };
    case 'CUSTOM_OVERRIDE':
      if (!choice.customMedication) {
        throw new GraphQLError('customMedication is required for CUSTOM_OVERRIDE', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      return { kind: 'CUSTOM_OVERRIDE', customMedication: choice.customMedication, ...meta };
    default:
      throw new GraphQLError(`Unknown conflict resolution kind: ${choice.kind}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
  }
}

function validateResolutionAgainstConflict(
  resolution: ConflictResolution,
  conflict: MergedConflict,
): void {
  if (resolution.kind !== 'CONFIRM_PATHWAY') return;
  const candidatePathwayIds = new Set(
    conflict.candidates.map((c) => c.sourcePathwayId),
  );
  if (!candidatePathwayIds.has(resolution.chosenPathwayId)) {
    throw new GraphQLError(
      `chosenPathwayId "${resolution.chosenPathwayId}" is not among this conflict's candidates`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
}

// ─── Care plan materialization ──────────────────────────────────────

/**
 * Insert the patient care plan, goals and interventions from the composed
 * merged plan, inside generation's claimed transaction. Goals come from the
 * contributing pathways (one per pathway); interventions from the merged
 * medications, labs and procedures (review #11 is out of scope).
 *
 * Per migration 019: `care_plans` is the patient-agnostic pathway-definition
 * table; per-patient instances live in `patient_care_plans` (with
 * `patient_care_plan_goals` / `patient_care_plan_interventions`). Provenance
 * (source pathway, source node) goes into `guideline_reference`, since the
 * patient tables have no dedicated columns for it.
 */
async function materializeCarePlan(db: Db, session: MultiPathwayResolutionSession, plan: MergedCarePlan): Promise<string> {
  // A no-op for a real patient; a placeholder for the simulator's synthetic ids,
  // so the patient_care_plans foreign key holds.
  await db.query(
    `INSERT INTO patients (id, first_name, last_name, date_of_birth)
     VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [session.patientId],
  );

  const carePlanResult = await db.query(
    `INSERT INTO patient_care_plans
       (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
     VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
     RETURNING id`,
    [session.patientId, 'Multi-Pathway Care Plan', session.providerId, [], session.providerId],
  );
  const carePlanId: string = carePlanResult.rows[0].id;

  for (const pathwayId of session.contributingPathwayIds) {
    await db.query(
      `INSERT INTO patient_care_plan_goals
         (patient_care_plan_id, description, priority, guideline_reference)
       VALUES ($1, $2, 'HIGH', $3)`,
      [carePlanId, `Goals from pathway ${pathwayId}`, `pathway:${pathwayId}`],
    );
  }

  // Labs map to MONITORING: the interventions type CHECK has no LAB type.
  for (const m of plan.medications) {
    const r = m.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, dosage, frequency, guideline_reference)
       VALUES ($1, 'MEDICATION', $2, $3, $4, $5)`,
      [carePlanId, r.name, r.dose ?? null, r.frequency ?? null, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  for (const l of plan.labs) {
    const r = l.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, guideline_reference)
       VALUES ($1, 'MONITORING', $2, $3)`,
      [carePlanId, r.name, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  for (const p of plan.procedures) {
    const r = p.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, procedure_code, guideline_reference)
       VALUES ($1, 'PROCEDURE', $2, $3, $4)`,
      [carePlanId, r.name, r.code ?? null, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  return carePlanId;
}

function provenance(pathwayId: string | undefined, nodeId: string | null | undefined): string | null {
  if (!pathwayId && !nodeId) return null;
  const parts: string[] = [];
  if (pathwayId && pathwayId !== 'provider-override') parts.push(`pathway:${pathwayId}`);
  if (nodeId) parts.push(`node:${nodeId}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function formatSessionForGraphQL(s: MultiPathwayResolutionSession) {
  return {
    id: s.id,
    patientId: s.patientId,
    providerId: s.providerId,
    status: s.status,
    revision: s.revision,
    resultHash: s.resultHash,
    envFingerprint: s.envFingerprint,
    isPreview: s.isPreview,
    mergedPlan: formatMergedForGraphQL(s.mergedPlan),
    contributingSessionIds: s.contributingSessionIds,
    contributingPathwayIds: s.contributingPathwayIds,
    carePlanId: s.carePlanId,
    ddiWarnings: (s.ddiWarnings ?? []).map(formatDdiWarningForGraphQL),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function formatDdiWarningForGraphQL(w: unknown) {
  const wo = (w ?? {}) as Record<string, unknown>;
  const source = (wo.source ?? {}) as Record<string, unknown>;
  return {
    recommendationId: wo.recommendationId ?? '',
    drugName: wo.drugName ?? '',
    category: wo.category ?? 'DDI_MODERATE',
    severity: wo.severity ?? 'MODERATE',
    mechanism: wo.mechanism ?? null,
    clinicalAdvice: wo.clinicalAdvice ?? null,
    source: {
      kind: source.kind ?? '',
      rxcui: source.rxcui ?? null,
      name: source.name ?? null,
      snomedCode: source.snomedCode ?? null,
      snomedDisplay: source.snomedDisplay ?? null,
      recommendationId: source.recommendationId ?? null,
    },
  };
}

const STATE_TO_GQL: Record<string, string> = {
  'auto-included': 'AUTO_INCLUDED',
  'pending-provider-choice': 'PENDING_PROVIDER_CHOICE',
  'provider-confirmed': 'PROVIDER_CONFIRMED',
  'provider-override': 'PROVIDER_OVERRIDE',
};

function gqlState(state: string): string {
  return STATE_TO_GQL[state] ?? 'AUTO_INCLUDED';
}

export function formatMergedForGraphQL(merged: MergedCarePlan) {
  // Defensive defaults on read: sessions stored under prior schema versions
  // may not carry the newer fields (imaging / guidance / catchUpItems /
  // evidenceTrail / dataGapHints). Coalescing to [] here keeps old rows
  // renderable through the current non-nullable schema.
  return {
    sourcePathwayIds: merged.sourcePathwayIds,
    medications: merged.medications.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    labs: merged.labs.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    imaging: (merged.imaging ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    procedures: merged.procedures.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    guidance: (merged.guidance ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    schedules: merged.schedules.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    qualityMetrics: merged.qualityMetrics.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    suppressed: merged.suppressed.map(formatSuppressedForGraphQL),
    conflicts: merged.conflicts.map(formatConflictForGraphQL),
    catchUpItems: merged.catchUpItems ?? [],
    evidenceTrail: merged.evidenceTrail ?? [],
    dataGapHints: merged.dataGapHints ?? [],
  };
}

function formatSuppressedForGraphQL(s: MergedCarePlan['suppressed'][number]) {
  const typeMap = {
    medication: 'MEDICATION',
    lab: 'LAB',
    imaging: 'IMAGING',
    procedure: 'PROCEDURE',
    guidance: 'GUIDANCE',
    schedule: 'SCHEDULE',
    qualityMetric: 'QUALITY_METRIC',
  } as const;
  const reasonMap: Record<string, string> = {
    contraindicated: 'CONTRAINDICATED',
    avoid: 'AVOID',
    ddi_contraindicated: 'DDI_CONTRAINDICATED',
    ddi_severe: 'DDI_SEVERE',
    allergy: 'ALLERGY',
  };
  // Pathway-source: legacy fields stay populated; DDI-source: legacy fields null.
  const src = s.source;
  return {
    type: typeMap[s.type],
    name: s.name,
    reason: reasonMap[s.reason] ?? 'CONTRAINDICATED',
    suppressedByPathwayId: src.kind === 'PATHWAY' ? src.pathwayId : null,
    suppressedByPathwayTitle: src.kind === 'PATHWAY' ? src.pathwayTitle : null,
    suppressedByPatientMedRxcui:
      src.kind === 'PATIENT_MEDICATION' ? src.rxcui : null,
    suppressedByPatientMedName:
      src.kind === 'PATIENT_MEDICATION' ? src.name : null,
    suppressedByAllergyCode:
      src.kind === 'PATIENT_ALLERGY' ? src.snomedCode : null,
    suppressedByAllergyDisplay:
      src.kind === 'PATIENT_ALLERGY' ? src.snomedDisplay : null,
    suppressedByRecommendationName:
      src.kind === 'OTHER_RECOMMENDATION' ? src.drugName : null,
    // Which pathway proposed it: the "pathway reason" beside the safety reason (spec §5.10).
    sourcePathwayId: s.original.sourcePathwayId ?? null,
  };
}

function formatConflictForGraphQL(c: MergedConflict) {
  return {
    conflictId: c.conflictId,
    type: 'MEDICATION',
    clinicalRole: c.clinicalRole,
    candidates: c.candidates.map((cand) => ({
      recommendation: cand.recommendation,
      sourcePathwayId: cand.sourcePathwayId,
      sourcePathwayTitle: cand.sourcePathwayTitle,
    })),
    resolution: c.resolution ? formatResolutionForGraphQL(c.resolution) : null,
  };
}

function formatResolutionForGraphQL(r: ConflictResolution) {
  const base = {
    kind: r.kind,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    reason: r.reason ?? null,
    chosenPathwayId: null as string | null,
    customMedication: null as CustomMedicationOverride | null,
  };
  if (r.kind === 'CONFIRM_PATHWAY') base.chosenPathwayId = r.chosenPathwayId;
  if (r.kind === 'CUSTOM_OVERRIDE') base.customMedication = r.customMedication;
  return base;
}
