/**
 * Phase 3 commit 4: persistent multi-pathway resolution mutations.
 *
 * The pipeline is unchanged from commit 3 — matchedPathways → collapseLattice
 * → per-pathway TraversalEngine → project → merge — but the result now lands
 * in `multi_pathway_resolution_sessions`, the per-pathway sessions are
 * persisted alongside (so providers can drill in), and the merge surfaces
 * `clinical_role` conflicts that the provider has to resolve before a real
 * care plan can be generated.
 *
 * Mutations exposed:
 *   - startMultiPathwayResolution    creates the session + per-pathway sessions
 *   - resolveConflict                applies one provider choice
 *   - generateMergedCarePlan         materializes care_plans rows (validates
 *                                    no unresolved conflicts remain)
 *   - abandonMultiPathwaySession     marks ABANDONED (row preserved for audit)
 *   - deletePreviewSession           hard-deletes a preview session and its
 *                                    contributing per-pathway sessions
 */

import { GraphQLError } from 'graphql';
import { Pool } from 'pg';
import {
  DataSourceContext,
  SessionStatus,
  BlockerType,
} from '../../types';
import { PatientContext } from '../../services/confidence/types';
import { normalizePatientAttributes } from '../../services/resolution/patient-attributes';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import type { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  parseResolutionInput,
  ResolutionModeArgs,
} from '../../services/resolution/temporal/trust-mode';
import { assertAssemblableMode } from '../../services/resolution/temporal/context-assembler';
import {
  PatientContextArgs,
  TemporalAnchorArgs,
  temporalInputFrom,
  toPatientContext,
} from './resolution';
import {
  GateAnswer,
  MatchedPathway,
  NodeStatus,
} from '../../services/resolution/types';
import {
  getMatchedPathways,
  createSession,
  getSession,
} from '../../services/resolution/session-store';
import { collapseLattice } from '../../services/resolution/lattice-collapse';
import {
  mergeResolvedCarePlans,
  ResolvedCarePlan,
  ResolvedMedication,
  MergedCarePlan,
  MergedConflict,
  MergedRecommendation,
  ConflictResolution,
  ConflictResolutionKind,
  CustomMedicationOverride,
  SuppressedRecommendation,
  SuppressionSource,
  candidatePathwayIds,
  drugKey,
  medicationRegimenKey,
} from '../../services/resolution/care-plan-merge';
import {
  runPatientContextDdi,
  runCrossRecommendationDdi,
  DdiFinding,
} from '../../services/medications/ddi-pass';
import { projectResolutionToCarePlan } from '../../services/resolution/care-plan-projection';
import { findUnmetPrerequisites } from '../../services/resolution/prerequisites';
import { CatchUpItem, SkippedPathway } from '../../services/resolution/care-plan-merge';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import {
  buildResolutionContext,
  makeTraversalAdapter,
  makeLlmGateEvaluator,
  assertEncounterAnchor,
  resolveTemporalPolicyVersion,
  ResolutionContext,
} from '../helpers/resolution-context';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import type { FactStore } from '../../services/resolution/temporal/fact-model';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import { normalizeAnswerType } from '../../services/resolution/answer-validation';
import { withTherapyStarts } from '../../services/resolution/temporal/anchored-window';
import { loadCarePlanTherapyStarts } from '../helpers/therapy-starts';
import {
  createMultiPathwaySession,
  deletePreviewSession,
  getMultiPathwaySession,
  getPatientMultiPathwaySessions,
  markMultiPathwaySessionStatus,
  updateMergedPlanAndResolutions,
  MultiPathwayResolutionSession,
  MultiPathwaySessionStatus,
} from '../../services/resolution/multi-pathway-session-store';

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
    const temporalInput = { ...temporalInputFrom(args), temporalPolicyVersion };
    // A synthetic (simulator / preview) run has no real encounter, so an
    // ENCOUNTER horizon had nothing to anchor to and the pathway using it
    // could not resolve at all. Anchor it at the session's own evaluation
    // instant — ONE stamp for both, not two reads of the wall clock, so the
    // encounter can never start after the evaluation it belongs to.
    if (isPreview && temporalInput.encounterStart === undefined) {
      temporalInput.evaluationAsOf ??= new Date(Date.now()).toISOString();
      temporalInput.encounterStart = temporalInput.evaluationAsOf;
    }
    const temporalContext = makeEvaluationTemporalContext(temporalInput);

    // Before the zero-match branch: that path creates a parent session and
    // returns without ever entering resolveAndPersistAll, so a version
    // validated only during the sweep would never be checked at all.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Assembled ONCE for the whole run, and — like the version check — before
    // the zero-match branch: the assembler validates, and whether a malformed
    // context is rejected must not depend on how many pathways happened to
    // match. On the zero-match path the store is simply discarded. `[]` under
    // `legacy-v0`, without entering the assembler at all (P1-9).
    const factStore = factStoreForInput(resolutionInput, temporalContext);

    const matched = await getMatchedPathways(pool, args.patientId, matcherOptions);
    if (matched.length === 0) {
      // Persist an empty session so the FE has something to show — and so we
      // have a paper trail that no pathways matched on this date.
      const sessionId = await createMultiPathwaySession(pool, {
        patientId: args.patientId,
        providerId: context.userId,
        initialPatientContext: patientContext,
        contributingSessionIds: [],
        contributingPathwayIds: [],
        mergedPlan: emptyMergedCarePlan(),
        isPreview,
        temporalContext,
      });
      const session = await getMultiPathwaySession(pool, sessionId);
      return formatSessionForGraphQL(session!);
    }

    const surviving = await collapseLattice(pool, matched);

    const { resolvedPlans, contributingSessionIds, contributingPathwayIds, skippedPathways } =
      await resolveAndPersistAll(
        pool,
        surviving,
        patientContext,
        context.userId,
        temporalContext,
        factStore,
      );

    const { mergedPlan: merged, ddiWarnings } = await runMergePipeline(
      pool,
      resolvedPlans,
      patientContext,
    );
    const finalMerged: MergedCarePlan = { ...merged, skippedPathways };

    const sessionId = await createMultiPathwaySession(pool, {
      patientId: args.patientId,
      providerId: context.userId,
      initialPatientContext: patientContext,
      contributingSessionIds,
      contributingPathwayIds,
      mergedPlan: finalMerged,
      ddiWarnings,
      isPreview,
      temporalContext,
    });

    const session = await getMultiPathwaySession(pool, sessionId);
    return formatSessionForGraphQL(session!);
  },

  async resolveConflict(
    _parent: unknown,
    args: ResolveConflictArgs,
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const session = await loadActiveSession(pool, args.sessionId);

    const conflict = session.mergedPlan.conflicts.find(
      (c) => c.conflictId === args.conflictId,
    );
    if (!conflict) {
      throw new GraphQLError(
        `Conflict "${args.conflictId}" not found in session "${args.sessionId}"`,
        { extensions: { code: 'NOT_FOUND' } },
      );
    }

    const resolution = buildResolution(args.choice, context.userId);
    validateResolutionAgainstConflict(resolution, conflict);

    const updatedPlan = applyResolution(session.mergedPlan, conflict, resolution);
    const updatedResolutions = {
      ...session.conflictResolutions,
      [args.conflictId]: resolution,
    };

    await updateMergedPlanAndResolutions(
      pool,
      args.sessionId,
      updatedPlan,
      updatedResolutions,
    );

    const refreshed = await getMultiPathwaySession(pool, args.sessionId);
    return formatSessionForGraphQL(refreshed!);
  },

  async generateMergedCarePlan(
    _parent: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const session = await loadActiveSession(pool, args.sessionId);

    const blockers = validateForGeneration(session);
    if (blockers.length > 0) {
      return {
        success: false as const,
        carePlanId: null as string | null,
        warnings: [] as string[],
        blockers,
      };
    }

    const carePlanId = await materializeCarePlan(pool, session);

    await markMultiPathwaySessionStatus(
      pool,
      args.sessionId,
      'COMPLETED',
      carePlanId,
    );

    return {
      success: true as const,
      carePlanId,
      warnings: [] as string[],
      blockers: [] as Array<{ type: string; description: string; relatedNodeIds: string[] }>,
    };
  },

  async abandonMultiPathwaySession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const session = await getMultiPathwaySession(pool, args.sessionId);
    if (!session) {
      throw new GraphQLError('Session not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    await markMultiPathwaySessionStatus(pool, args.sessionId, 'ABANDONED');
    const refreshed = await getMultiPathwaySession(pool, args.sessionId);
    return formatSessionForGraphQL(refreshed!);
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

  /**
   * Re-run the merge pipeline against the current state of every contributing
   * per-pathway session, then update this multi-pathway session's stored
   * mergedPlan + ddiWarnings. Used after a provider answers a Gate question
   * (which re-traverses the per-pathway session) so the merged view picks up
   * the new per-pathway state without forcing a full new resolution.
   *
   * Existing conflict resolutions are preserved — the new merged plan is
   * re-derived from the resolved per-pathway plans, then any prior provider
   * conflict choices replay on top of it.
   */
  async reMergeMultiPathwaySession(
    _parent: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const session = await loadActiveSession(pool, args.sessionId);

    const resolvedPlans = await buildResolvedPlansFromSessions(
      pool,
      session.contributingSessionIds,
    );
    const patientContext = session.initialPatientContext as PatientContext;
    const { mergedPlan, ddiWarnings } = await runMergePipeline(
      pool,
      resolvedPlans,
      patientContext,
    );

    // Replay prior conflict resolutions onto the freshly-merged plan so the
    // provider doesn't have to re-pick them — but only where the conflict
    // still offers the same choices (see replayConflictResolutions).
    // Which pathways were dropped is decided once, at creation; a re-merge
    // re-projects the survivors and must not forget the others.
    const { plan: replayedPlan, resolutions } = replayConflictResolutions(
      session.mergedPlan,
      { ...mergedPlan, skippedPathways: session.mergedPlan.skippedPathways ?? [] },
      session.conflictResolutions,
    );

    await updateMergedPlanAndResolutions(
      pool,
      args.sessionId,
      replayedPlan,
      resolutions,
      ddiWarnings,
    );

    const refreshed = await getMultiPathwaySession(pool, args.sessionId);
    return formatSessionForGraphQL(refreshed!);
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
            answerType: normalizeAnswerType(q.answerType ?? q.answer_type),
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

export function buildPatientContext(args: MultiPathwayResolutionArgs): PatientContext {
  const pc = args.patientContext;
  return {
    patientId: args.patientId,
    conditionCodes: pc?.conditionCodes ?? [],
    medications: pc?.medications ?? [],
    labResults: pc?.labResults ?? [],
    allergies: pc?.allergies ?? [],
    vitalSigns: pc?.vitalSigns,
    freeformData: pc?.freeformData,
    patientAttributes: normalizePatientAttributes(pc?.patientAttributes),
  };
}

/**
 * Run the full merge pipeline (DDI stage 1 → merge → DDI stage 2) over a set
 * of already-resolved per-pathway care plans. Used both by the initial
 * `startMultiPathwayResolution` flow and by `reMergeMultiPathwaySession` after
 * gate answers re-traverse a contributing session.
 *
 * Returns the final merged plan plus the DDI WARN-severity findings; the
 * suppressions are folded into `mergedPlan.suppressed` directly.
 */
export async function runMergePipeline(
  pool: Pool,
  resolvedPlans: ResolvedCarePlan[],
  patientContext: PatientContext,
): Promise<{ mergedPlan: MergedCarePlan; ddiWarnings: unknown[] }> {
  // ── DDI stage 1: pre-merge, per-plan against patient context ──
  const preMergeWarnings: unknown[] = [];
  const preMergeSuppressions: SuppressedRecommendation[] = [];
  const ddiCleanedPlans: ResolvedCarePlan[] = [];

  for (const plan of resolvedPlans) {
    const candidates = plan.medications.map((m) => ({
      recommendationId: m.sourceNodeId ?? `${plan.pathwayId}|${m.name}`,
      drugName: m.name,
    }));
    const ddi = await runPatientContextDdi(pool, candidates, patientContext);
    preMergeWarnings.push(...ddi.findings.filter((f) => f.action === 'WARN'));

    const suppressedIds = ddi.suppressedRecommendationIds;
    for (const finding of ddi.findings) {
      if (finding.action !== 'SUPPRESS') continue;
      const med = plan.medications.find(
        (m) => (m.sourceNodeId ?? `${plan.pathwayId}|${m.name}`) === finding.recommendationId,
      );
      if (!med) continue;
      preMergeSuppressions.push(buildDdiSuppression(med, finding));
    }

    ddiCleanedPlans.push({
      ...plan,
      medications: plan.medications.filter(
        (m) => !suppressedIds.has(m.sourceNodeId ?? `${plan.pathwayId}|${m.name}`),
      ),
    });
  }

  const merged = mergeResolvedCarePlans(ddiCleanedPlans);

  // ── DDI stage 2: post-merge, cross-recommendation pairs ──
  // Checked: every auto-included medication AND every regimen of a drug held
  // in a MEDICATION_REGIMEN conflict. Those regimens are one drug the plan
  // will contain in some form, and before regimens were kept apart they
  // name-merged into `medications` and were checked here; parking them in a
  // conflict must not exempt them. (clinical_role conflict candidates are
  // alternatives, not co-prescriptions, and were never checked here — a known
  // gap, unchanged.) Suppression then removes the DRUG, every regimen of it,
  // matching the drug-identity rule the pathway flags follow.
  const recId = (r: ResolvedMedication) => r.sourceNodeId ?? `${r.sourcePathwayId}|${r.name}`;
  const crossMeds: ResolvedMedication[] = [
    ...merged.medications.map((m) => m.recommendation),
    ...merged.conflicts
      .filter((c) => c.type === 'medication_regimen')
      .flatMap((c) => c.candidates.map((cand) => cand.recommendation)),
  ];
  const crossCandidates = crossMeds.map((r) => ({
    recommendationId: recId(r),
    drugName: r.name,
    sourcePathwayId: r.sourcePathwayId,
  }));
  const cross = await runCrossRecommendationDdi(pool, crossCandidates);
  const crossWarnings = cross.findings.filter((f) => f.action === 'WARN');
  const crossSuppressions: SuppressedRecommendation[] = [];
  for (const finding of cross.findings) {
    if (finding.action !== 'SUPPRESS') continue;
    const med = crossMeds.find((r) => recId(r) === finding.recommendationId);
    if (!med) continue;
    crossSuppressions.push(buildDdiSuppression(med, finding));
  }
  const suppressedDrugs = new Set(
    crossMeds
      .filter((r) => cross.suppressedRecommendationIds.has(recId(r)))
      .map((r) => drugKey(r.name)),
  );

  const finalMerged: MergedCarePlan = {
    ...merged,
    medications: merged.medications.filter(
      (m) => !suppressedDrugs.has(drugKey(m.recommendation.name)),
    ),
    // A regimen conflict is one drug; if that drug is suppressed the choice
    // is gone. clinical_role conflicts never contain a drug checked above.
    conflicts: merged.conflicts.filter(
      (c) =>
        c.type !== 'medication_regimen' ||
        !c.candidates.some((cand) => suppressedDrugs.has(drugKey(cand.recommendation.name))),
    ),
    suppressed: [...merged.suppressed, ...preMergeSuppressions, ...crossSuppressions],
  };

  return { mergedPlan: finalMerged, ddiWarnings: [...preMergeWarnings, ...crossWarnings] };
}

/**
 * Rebuild `ResolvedCarePlan` array by re-projecting the current state of
 * each contributing per-pathway session. Used by `reMergeMultiPathwaySession`
 * — the gate answers that have been applied since session creation are
 * reflected in the per-pathway session's `resolutionState`, so re-projection
 * picks up the post-answer state. Sessions with missing rows are skipped
 * (consistent with the initial-merge behavior).
 */
export async function buildResolvedPlansFromSessions(
  pool: Pool,
  sessionIds: string[],
): Promise<ResolvedCarePlan[]> {
  const plans: ResolvedCarePlan[] = [];
  for (const sessionId of sessionIds) {
    const session = await getSession(pool, sessionId);
    if (!session) continue;
    const meta = await pool.query<{ logical_id: string; title: string }>(
      `SELECT logical_id, title FROM pathway_graph_index WHERE id = $1`,
      [session.pathwayId],
    );
    const pathwayLogicalId = meta.rows[0]?.logical_id ?? session.pathwayId;
    const pathwayTitle = meta.rows[0]?.title ?? session.pathwayId;
    plans.push(
      projectResolutionToCarePlan(
        session.resolutionState,
        {
          pathwayId: session.pathwayId,
          pathwayLogicalId,
          pathwayTitle,
        },
        [],
        session.dependencyMap,
      ),
    );
  }
  return plans;
}

/**
 * Run TraversalEngine for each surviving pathway, persist the per-pathway
 * session, and project the result. Empty graphs are skipped (consistent
 * with commit 3 behavior — one broken pathway shouldn't kill the merge).
 */
export async function resolveAndPersistAll(
  pool: Pool,
  pathways: MatchedPathway[],
  patientContext: PatientContext,
  providerId: string,
  /**
   * Created by the caller, never here. `startMultiPathwayResolution` stamps
   * one clock for the whole run and hands it down, because it — not this
   * function — is the outermost boundary: it creates the parent session on
   * two paths, one of which (zero matches) returns before this is ever
   * called. A clock created here could not reach the parent at all on that
   * path, and on the other the parent would need the child's clock handed
   * back out.
   */
  temporalContext: EvaluationTemporalContext,
  /**
   * Assembled by the caller for the same reason the clock is: one store for the
   * whole run. Assembly is pathway-independent — it reads the patient payload
   * and the clock, neither of which varies per pathway — so building it here,
   * once per pathway, would do the same work N times and give sibling sessions
   * distinct (though equal) fact objects.
   */
  factStore: FactStore,
): Promise<{
  resolvedPlans: ResolvedCarePlan[];
  contributingSessionIds: string[];
  contributingPathwayIds: string[];
  /** Matched pathways left out, with the reason. See the preflight below. */
  skippedPathways: SkippedPathway[];
}> {
  const skippedPathways: SkippedPathway[] = [];
  const resolvedPlans: ResolvedCarePlan[] = [];
  const contributingSessionIds: string[] = [];
  const contributingPathwayIds: string[] = [];

  // Load every pathway's context and validate the whole set BEFORE any
  // traversal. Nothing here writes: a rejection must leave no child sessions
  // and no audit rows behind. Validating inside the traversal loop would mean
  // pathway A is already persisted by the time pathway B is rejected.
  const loaded: Array<{ m: MatchedPathway; rctx: ResolutionContext }> = [];
  for (const m of pathways) {
    const rctx = await buildResolutionContext(pool, m.pathway.id);
    if (rctx.graphContext.allNodes.length === 0) continue;
    try {
      assertEncounterAnchor(rctx, temporalContext);
    } catch (err) {
      // A missing encounter anchor is a fact about THIS pathway and this
      // session, not about the request: the other pathways resolve without
      // one. Rejecting the whole session over it withheld every other
      // pathway's plan. It is dropped, with the reason recorded on the
      // merged plan so the omission is visible.
      //
      // Only this code. Anything else the preflight raises — an unknown
      // policy version, a malformed horizon — is a defect in the request or
      // the pathway, and still rejects the run before anything is written.
      if (err instanceof TemporalContextError && err.code === 'MISSING_ENCOUNTER_ANCHOR') {
        skippedPathways.push({
          pathwayId: m.pathway.id,
          logicalId: m.pathway.logicalId,
          pathwayTitle: m.pathway.title,
          code: err.code,
          reason: err.message,
        });
        continue;
      }
      throw err;
    }
    loaded.push({ m, rctx });
  }

  for (const { m, rctx } of loaded) {
    // The run's clock, plus THIS pathway's care-plan therapy starts for its
    // `window_from` anchors (none, and no query, for a pathway without one).
    // Per pathway because the starts are matched against this pathway's own
    // recommendations; the clock itself is identical across the run.
    const pathwayClock = withTherapyStarts(
      temporalContext,
      await loadCarePlanTherapyStarts(pool, {
        patientId: patientContext.patientId,
        pathwayId: m.pathway.id,
        graphContext: rctx.graphContext,
      }),
    );
    const llmBundle = makeLlmGateEvaluator(pool, m.pathway.id);
    const engine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, m.pathway.id, patientContext),
      rctx.thresholds,
      pathwayClock,
      rctx.temporalDefaults,
      factStore,
      rctx.codeMap,
      llmBundle?.evaluator,
    );
    const traversalResult = await engine.traverse(
      rctx.graphContext,
      patientContext,
      new Map<string, GateAnswer>(),
    );

    // REQUIRES backtracking pass — for every included Stage/Step node,
    // walk outgoing REQUIRES edges and check each prereq's
    // satisfaction_check against the patient snapshot. Deduplicate by
    // prereq nodeId (one prereq can be reached from many dependents).
    const catchUpItems: CatchUpItem[] = [];
    const seenPrereqs = new Set<string>();
    for (const node of traversalResult.resolutionState.values()) {
      if (node.status !== NodeStatus.INCLUDED) continue;
      if (node.nodeType !== 'Stage' && node.nodeType !== 'Step') continue;
      const unmet = findUnmetPrerequisites(
        node.nodeId,
        patientContext,
        rctx.graphContext,
      );
      for (const u of unmet) {
        if (seenPrereqs.has(u.nodeId)) continue;
        seenPrereqs.add(u.nodeId);
        catchUpItems.push({
          nodeId: u.nodeId,
          nodeType: u.nodeType,
          title: u.title,
          dependentNodeId: u.dependentNodeId,
          reason: u.reason,
          sourcePathwayId: m.pathway.id,
        });
      }
    }

    const status = traversalResult.isDegraded
      ? SessionStatus.DEGRADED
      : SessionStatus.ACTIVE;

    const sessionId = await createSession(pool, {
      pathwayId: m.pathway.id,
      pathwayVersion: m.pathway.version,
      patientId: patientContext.patientId,
      providerId,
      status,
      initialPatientContext: patientContext,
      resolutionState: traversalResult.resolutionState,
      dependencyMap: traversalResult.dependencyMap,
      pendingQuestions: traversalResult.pendingQuestions,
      redFlags: traversalResult.redFlags,
      totalNodesEvaluated: traversalResult.totalNodesEvaluated,
      traversalDurationMs: traversalResult.traversalDurationMs,
      temporalContext: pathwayClock,
    });

    if (llmBundle) await llmBundle.flushAudits(sessionId);

    contributingSessionIds.push(sessionId);
    contributingPathwayIds.push(m.pathway.id);

    resolvedPlans.push(
      projectResolutionToCarePlan(
        traversalResult.resolutionState,
        {
          pathwayId: m.pathway.id,
          pathwayLogicalId: m.pathway.logicalId,
          pathwayTitle: m.pathway.title,
        },
        catchUpItems,
        traversalResult.dependencyMap,
      ),
    );
  }

  return { resolvedPlans, contributingSessionIds, contributingPathwayIds, skippedPathways };
}

async function loadActiveSession(
  pool: Pool,
  sessionId: string,
): Promise<MultiPathwayResolutionSession> {
  const session = await getMultiPathwaySession(pool, sessionId);
  if (!session) {
    throw new GraphQLError('Session not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  if (session.status !== 'ACTIVE') {
    throw new GraphQLError(
      `Cannot modify session with status "${session.status}"`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
  return session;
}

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
  if (resolution.kind === 'CONFIRM_PATHWAY' && !resolutionFitsConflict(resolution, conflict)) {
    throw new GraphQLError(
      `chosenPathwayId "${resolution.chosenPathwayId}" is not among this conflict's candidates`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
}

/**
 * A CONFIRM_PATHWAY choice fits a conflict when the chosen pathway asked for
 * at least one of its candidates — any contributor, not only the first one
 * recorded on the candidate. Other kinds fit any conflict.
 */
function resolutionFitsConflict(
  resolution: ConflictResolution,
  conflict: MergedConflict,
): boolean {
  if (resolution.kind !== 'CONFIRM_PATHWAY') return true;
  return conflict.candidates.some((c) =>
    candidatePathwayIds(c).includes(resolution.chosenPathwayId),
  );
}

/**
 * What a conflict offered the provider: each candidate's drug+regimen and the
 * pathways behind it. Pathways are part of it because CONFIRM_PATHWAY names a
 * pathway, not a regimen — if two pathways swapped regimens, replaying "use
 * Obesity's" would silently hand the provider the other dose. Two conflicts
 * with the same id and the same offer are the same decision; anything else is
 * a new one.
 */
function conflictOffer(conflict: MergedConflict): string {
  return conflict.candidates
    .map((c) => `${medicationRegimenKey(c.recommendation)}@${[...candidatePathwayIds(c)].sort().join(',')}`)
    .sort()
    .join('\n');
}

/**
 * Re-apply the provider's earlier choices to a freshly re-merged plan.
 *
 * A choice is replayed only when the same conflict existed in the previous
 * plan offering exactly the same drug+regimen candidates, and (for
 * CONFIRM_PATHWAY) the chosen pathway still asks for one of them. Otherwise
 * the conflict surfaces unresolved: a provider who picked "Obesity's 1000 mg"
 * did not pick whatever Obesity asks for after a gate answer moved it to
 * 2000 mg. Replaying without that check also crashed outright when the chosen
 * pathway had left the conflict.
 *
 * Returns the plan and the resolutions still in force; stale ones are dropped
 * so a later re-merge cannot resurrect them against a conflict that happens
 * to match again.
 */
export function replayConflictResolutions(
  previousPlan: MergedCarePlan,
  freshPlan: MergedCarePlan,
  priorResolutions: Record<string, ConflictResolution>,
): { plan: MergedCarePlan; resolutions: Record<string, ConflictResolution> } {
  const previousById = new Map(
    (previousPlan.conflicts ?? []).map((c) => [c.conflictId, c]),
  );
  let plan = freshPlan;
  const resolutions: Record<string, ConflictResolution> = {};
  for (const conflict of freshPlan.conflicts) {
    const prior = priorResolutions[conflict.conflictId];
    if (!prior) continue;
    const previous = previousById.get(conflict.conflictId);
    if (!previous || conflictOffer(previous) !== conflictOffer(conflict)) continue;
    if (!resolutionFitsConflict(prior, conflict)) continue;
    plan = applyResolution(plan, conflict, prior);
    resolutions[conflict.conflictId] = prior;
  }
  return { plan, resolutions };
}

/**
 * Apply a single conflict resolution to the merged plan. Mutates the conflict
 * entry's `resolution` field; for CONFIRM_PATHWAY and CUSTOM_OVERRIDE it also
 * adds new MergedRecommendations to the medications list. ACCEPT_BOTH adds
 * all candidates as auto-included recommendations. REJECT_BOTH only updates
 * the conflict's resolution — no medications surface.
 */
export function applyResolution(
  plan: MergedCarePlan,
  conflict: MergedConflict,
  resolution: ConflictResolution,
): MergedCarePlan {
  const conflicts = plan.conflicts.map((c) =>
    c.conflictId === conflict.conflictId ? { ...c, resolution } : c,
  );
  let medications = [...plan.medications];

  switch (resolution.kind) {
    case 'CONFIRM_PATHWAY': {
      // Everything the chosen pathway asked for in this conflict — one
      // candidate normally; more when that pathway itself authored two
      // regimens (or two lane drugs). Provenance keeps every pathway that
      // asked for the same regimen, not just the one clicked.
      const chosen = conflict.candidates.filter((c) =>
        candidatePathwayIds(c).includes(resolution.chosenPathwayId),
      );
      for (const c of chosen) {
        medications.push({
          recommendation: c.recommendation,
          sourcePathwayIds: candidatePathwayIds(c),
          state: 'provider-confirmed',
        });
      }
      break;
    }
    case 'ACCEPT_BOTH': {
      for (const c of conflict.candidates) {
        medications.push({
          recommendation: c.recommendation,
          sourcePathwayIds: candidatePathwayIds(c),
          state: 'auto-included',
        });
      }
      break;
    }
    case 'REJECT_BOTH':
      // No new recommendations; conflict carries the rejection.
      break;
    case 'CUSTOM_OVERRIDE': {
      const custom = resolution.customMedication;
      const customMed: ResolvedMedication = {
        name: custom.name,
        role: 'first_line', // provider's write-in is treated as first-line
        dose: custom.dose,
        frequency: custom.frequency,
        duration: custom.duration,
        route: custom.route,
        sourcePathwayId: 'provider-override',
        // Provider-typed override doesn't trace back to any pathway gate.
        evidenceGateIds: [],
      };
      const rec: MergedRecommendation<ResolvedMedication> = {
        recommendation: customMed,
        sourcePathwayIds: ['provider-override'],
        state: 'provider-override',
      };
      medications.push(rec);
      break;
    }
  }

  return { ...plan, conflicts, medications };
}

// ─── Generation validation ──────────────────────────────────────────

function validateForGeneration(
  session: MultiPathwayResolutionSession,
): Array<{ type: string; description: string; relatedNodeIds: string[] }> {
  const blockers: Array<{ type: string; description: string; relatedNodeIds: string[] }> = [];
  const unresolved = session.mergedPlan.conflicts.filter((c) => c.resolution == null);
  for (const c of unresolved) {
    blockers.push({
      type: BlockerType.PENDING_GATE, // reuse: closest semantic existing enum
      description: `Conflict "${c.conflictId}" is unresolved — provider must choose before generating the care plan`,
      relatedNodeIds: c.candidates.map((cand) => cand.recommendation.sourceNodeId ?? cand.sourcePathwayId),
    });
  }
  if (
    session.mergedPlan.medications.length === 0 &&
    session.mergedPlan.labs.length === 0 &&
    session.mergedPlan.procedures.length === 0
  ) {
    blockers.push({
      type: BlockerType.EMPTY_PLAN,
      description: 'Merged plan has no recommendations — care plan would be empty',
      relatedNodeIds: [],
    });
  }
  return blockers;
}

// ─── Care plan materialization ──────────────────────────────────────

/**
 * Insert care_plans/care_plan_goals/care_plan_interventions rows from the
 * merged plan. Mirrors single-pathway generateCarePlanFromResolution but
 * works off the MergedCarePlan shape directly. Goals come from contributing
 * pathway titles (one per pathway); interventions come from the merged
 * recommendations across all five types.
 */
async function materializeCarePlan(
  pool: Pool,
  session: MultiPathwayResolutionSession,
): Promise<string> {
  // Per migration 019: `care_plans` is the patient-agnostic pathway-definition
  // table; per-patient instances belong in `patient_care_plans` (with
  // `patient_care_plan_goals` / `patient_care_plan_interventions` for children).
  // Earlier versions of this resolver targeted `care_plans` directly and broke
  // at runtime because `patient_id` / `provider_id` / `source` etc. only exist
  // on the patient-specific table. Provenance (source pathway, source node)
  // is stashed in `guideline_reference` since the patient tables don't carry
  // dedicated columns for it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure the patient row exists. For real-patient flows this is a no-op
    // (ON CONFLICT DO NOTHING). For simulator flows where patient_id is a
    // freshly-generated UUID with no matching `patients` row, this stashes a
    // placeholder so the patient_care_plans FK is satisfied.
    await ensurePatientRowExists(client, session.patientId);

    const carePlanResult = await client.query(
      `INSERT INTO patient_care_plans
         (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
       VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
       RETURNING id`,
      [
        session.patientId,
        'Multi-Pathway Care Plan',
        session.providerId,
        [], // condition codes aggregation deferred
        session.providerId,
      ],
    );
    const carePlanId: string = carePlanResult.rows[0].id;

    // One placeholder goal per contributing pathway. Pathway id lives in
    // guideline_reference (the only free-text-ish column on the table).
    for (const pathwayId of session.contributingPathwayIds) {
      await client.query(
        `INSERT INTO patient_care_plan_goals
           (patient_care_plan_id, description, priority, guideline_reference)
         VALUES ($1, $2, 'HIGH', $3)`,
        [carePlanId, `Goals from pathway ${pathwayId}`, `pathway:${pathwayId}`],
      );
    }

    // Interventions: one row per merged recommendation. Per the
    // check_constraint on patient_care_plan_interventions.type, labs map to
    // MONITORING (no LAB type exists).
    // The table has dosage and frequency columns but none for route or
    // duration, which used to be dropped here — so a conflict the provider
    // settled on route (PO vs IV) or duration reached the care plan without
    // the thing they chose. They ride in patient_instructions instead.
    for (const m of session.mergedPlan.medications) {
      const r = m.recommendation;
      await client.query(
        `INSERT INTO patient_care_plan_interventions
           (patient_care_plan_id, type, description, dosage, frequency, patient_instructions, guideline_reference)
         VALUES ($1, 'MEDICATION', $2, $3, $4, $5, $6)`,
        [
          carePlanId,
          r.name,
          r.dose ?? null,
          r.frequency ?? null,
          medicationInstructions(r),
          provenance(r.sourcePathwayId, r.sourceNodeId),
        ],
      );
    }
    for (const l of session.mergedPlan.labs) {
      const r = l.recommendation;
      await client.query(
        `INSERT INTO patient_care_plan_interventions
           (patient_care_plan_id, type, description, guideline_reference)
         VALUES ($1, 'MONITORING', $2, $3)`,
        [carePlanId, r.name, provenance(r.sourcePathwayId, r.sourceNodeId)],
      );
    }
    for (const p of session.mergedPlan.procedures) {
      const r = p.recommendation;
      await client.query(
        `INSERT INTO patient_care_plan_interventions
           (patient_care_plan_id, type, description, procedure_code, guideline_reference)
         VALUES ($1, 'PROCEDURE', $2, $3, $4)`,
        [carePlanId, r.name, r.code ?? null, provenance(r.sourcePathwayId, r.sourceNodeId)],
      );
    }

    await client.query('COMMIT');
    return carePlanId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Route and duration for a medication intervention row, or null when neither is stated. */
function medicationInstructions(r: ResolvedMedication): string | null {
  const parts: string[] = [];
  if (r.route?.trim()) parts.push(`Route: ${r.route.trim()}`);
  if (r.duration?.trim()) parts.push(`Duration: ${r.duration.trim()}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

function provenance(pathwayId: string | undefined, nodeId: string | null | undefined): string | null {
  if (!pathwayId && !nodeId) return null;
  const parts: string[] = [];
  if (pathwayId && pathwayId !== 'provider-override') parts.push(`pathway:${pathwayId}`);
  if (nodeId) parts.push(`node:${nodeId}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Ensure a row exists in `patients` for the given id so the FK on
 * `patient_care_plans.patient_id` can be satisfied. For real patient flows
 * the row exists from EMR sync and this is a no-op. For the admin simulator
 * (which fabricates patientIds via crypto.randomUUID()) it creates a
 * placeholder so the commit flow can complete; the row remains discoverable
 * for any downstream audit.
 */
async function ensurePatientRowExists(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, patientId: string): Promise<void> {
  await client.query(
    `INSERT INTO patients (id, first_name, last_name, date_of_birth)
     VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [patientId],
  );
}

// ─── GraphQL formatting ─────────────────────────────────────────────

export function formatSessionForGraphQL(s: MultiPathwayResolutionSession) {
  return {
    id: s.id,
    patientId: s.patientId,
    providerId: s.providerId,
    status: s.status,
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
    skippedPathways: merged.skippedPathways ?? [],
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
  };
}

function formatConflictForGraphQL(c: MergedConflict) {
  return {
    conflictId: c.conflictId,
    // Rows stored before regimen conflicts existed carry no `type`; every one
    // of them was a clinical_role conflict.
    type: c.type === 'medication_regimen' ? 'MEDICATION_REGIMEN' : 'MEDICATION',
    clinicalRole: c.clinicalRole,
    candidates: c.candidates.map((cand) => ({
      recommendation: cand.recommendation,
      sourcePathwayId: cand.sourcePathwayId,
      sourcePathwayIds: candidatePathwayIds(cand),
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

function buildDdiSuppression(
  med: ResolvedMedication,
  finding: DdiFinding,
): SuppressedRecommendation {
  const reasonMap: Record<string, SuppressedRecommendation['reason']> = {
    DDI_CONTRAINDICATED: 'ddi_contraindicated',
    DDI_SEVERE: 'ddi_severe',
    ALLERGY: 'allergy',
  };
  let source: SuppressionSource;
  switch (finding.source.kind) {
    case 'PATIENT_MEDICATION':
      source = { kind: 'PATIENT_MEDICATION', rxcui: finding.source.rxcui, name: finding.source.name };
      break;
    case 'PATIENT_ALLERGY':
      source = { kind: 'PATIENT_ALLERGY', snomedCode: finding.source.snomedCode, snomedDisplay: finding.source.snomedDisplay };
      break;
    case 'OTHER_RECOMMENDATION':
      source = { kind: 'OTHER_RECOMMENDATION', recommendationId: finding.source.recommendationId, drugName: finding.source.drugName };
      break;
  }
  return {
    type: 'medication',
    name: med.name,
    reason: reasonMap[finding.category] ?? 'ddi_severe',
    source,
    original: med,
  };
}

function emptyMergedCarePlan(): MergedCarePlan {
  return {
    sourcePathwayIds: [],
    medications: [],
    labs: [],
    imaging: [],
    procedures: [],
    guidance: [],
    schedules: [],
    qualityMetrics: [],
    suppressed: [],
    conflicts: [],
    catchUpItems: [],
    evidenceTrail: [],
    dataGapHints: [],
    skippedPathways: [],
  };
}
