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
 *   - abandonMultiPathwaySession     marks ABANDONED
 */

import { GraphQLError } from 'graphql';
import { Pool } from 'pg';
import {
  DataSourceContext,
  SessionStatus,
  BlockerType,
} from '../../types';
import { PatientContext } from '../../services/confidence/types';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import {
  GateAnswer,
  MatchedPathway,
} from '../../services/resolution/types';
import {
  getMatchedPathways,
  createSession,
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
} from '../../services/resolution/care-plan-merge';
import {
  runPatientContextDdi,
  runCrossRecommendationDdi,
  DdiFinding,
} from '../../services/medications/ddi-pass';
import { projectResolutionToCarePlan } from '../../services/resolution/care-plan-projection';
import {
  buildResolutionContext,
  makeTraversalAdapter,
} from '../helpers/resolution-context';
import {
  createMultiPathwaySession,
  getMultiPathwaySession,
  getPatientMultiPathwaySessions,
  markMultiPathwaySessionStatus,
  updateMergedPlanAndResolutions,
  MultiPathwayResolutionSession,
  MultiPathwaySessionStatus,
} from '../../services/resolution/multi-pathway-session-store';

// ─── Argument shapes ────────────────────────────────────────────────

export interface MultiPathwayResolutionArgs {
  patientId: string;
  patientContext?: {
    patientId: string;
    conditionCodes?: Array<{ code: string; system: string; display?: string }>;
    medications?: Array<{ code: string; system: string; display?: string }>;
    labResults?: Array<{
      code: string;
      system: string;
      value?: number;
      unit?: string;
      date?: string;
      display?: string;
    }>;
    allergies?: Array<{ code: string; system: string; display?: string }>;
    vitalSigns?: Record<string, unknown>;
  };
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

    const matched = await getMatchedPathways(pool, args.patientId);
    if (matched.length === 0) {
      // Persist an empty session so the FE has something to show — and so we
      // have a paper trail that no pathways matched on this date.
      const sessionId = await createMultiPathwaySession(pool, {
        patientId: args.patientId,
        providerId: context.userId,
        initialPatientContext: buildPatientContext(args),
        contributingSessionIds: [],
        contributingPathwayIds: [],
        mergedPlan: emptyMergedCarePlan(),
      });
      const session = await getMultiPathwaySession(pool, sessionId);
      return formatSessionForGraphQL(session!);
    }

    const surviving = await collapseLattice(pool, matched);
    const patientContext = buildPatientContext(args);

    const { resolvedPlans, contributingSessionIds, contributingPathwayIds } =
      await resolveAndPersistAll(pool, surviving, patientContext, context.userId);

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

      // Translate suppressions to SuppressedRecommendation entries; drop them
      // from the plan's medications so merge doesn't see them.
      const suppressedIds = ddi.suppressedRecommendationIds;
      for (const finding of ddi.findings) {
        if (finding.action !== 'SUPPRESS') continue;
        const med = plan.medications.find((m) => (m.sourceNodeId ?? `${plan.pathwayId}|${m.name}`) === finding.recommendationId);
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
    const crossCandidates = merged.medications.map((m) => ({
      recommendationId: m.recommendation.sourceNodeId ?? `${m.recommendation.sourcePathwayId}|${m.recommendation.name}`,
      drugName: m.recommendation.name,
      sourcePathwayId: m.recommendation.sourcePathwayId,
    }));
    const cross = await runCrossRecommendationDdi(pool, crossCandidates);
    const crossWarnings = cross.findings.filter((f) => f.action === 'WARN');
    const crossSuppressedIds = cross.suppressedRecommendationIds;
    const crossSuppressions: SuppressedRecommendation[] = [];
    for (const finding of cross.findings) {
      if (finding.action !== 'SUPPRESS') continue;
      const med = merged.medications.find(
        (m) => (m.recommendation.sourceNodeId ?? `${m.recommendation.sourcePathwayId}|${m.recommendation.name}`) === finding.recommendationId,
      );
      if (!med) continue;
      crossSuppressions.push(buildDdiSuppression(med.recommendation, finding));
    }

    const finalMerged: MergedCarePlan = {
      ...merged,
      medications: merged.medications.filter(
        (m) => !crossSuppressedIds.has(m.recommendation.sourceNodeId ?? `${m.recommendation.sourcePathwayId}|${m.recommendation.name}`),
      ),
      suppressed: [...merged.suppressed, ...preMergeSuppressions, ...crossSuppressions],
    };

    const ddiWarnings = [...preMergeWarnings, ...crossWarnings];

    const sessionId = await createMultiPathwaySession(pool, {
      patientId: args.patientId,
      providerId: context.userId,
      initialPatientContext: patientContext,
      contributingSessionIds,
      contributingPathwayIds,
      mergedPlan: finalMerged,
      ddiWarnings,
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
    args: { patientId: string; status?: MultiPathwaySessionStatus },
    context: DataSourceContext,
  ) {
    const summaries = await getPatientMultiPathwaySessions(
      context.pool,
      args.patientId,
      args.status,
    );
    return summaries.map((s) => ({
      id: s.id,
      patientId: s.patientId,
      providerId: s.providerId,
      status: s.status,
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
  },
};

// ─── Internals ──────────────────────────────────────────────────────

function buildPatientContext(args: MultiPathwayResolutionArgs): PatientContext {
  const pc = args.patientContext;
  return {
    patientId: args.patientId,
    conditionCodes: pc?.conditionCodes ?? [],
    medications: pc?.medications ?? [],
    labResults: pc?.labResults ?? [],
    allergies: pc?.allergies ?? [],
    vitalSigns: pc?.vitalSigns,
  };
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
): Promise<{
  resolvedPlans: ResolvedCarePlan[];
  contributingSessionIds: string[];
  contributingPathwayIds: string[];
}> {
  const resolvedPlans: ResolvedCarePlan[] = [];
  const contributingSessionIds: string[] = [];
  const contributingPathwayIds: string[] = [];

  for (const m of pathways) {
    const rctx = await buildResolutionContext(pool, m.pathway.id);
    if (rctx.graphContext.allNodes.length === 0) continue;

    const engine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, m.pathway.id, patientContext),
      rctx.thresholds,
    );
    const traversalResult = await engine.traverse(
      rctx.graphContext,
      patientContext,
      new Map<string, GateAnswer>(),
    );

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
    });

    contributingSessionIds.push(sessionId);
    contributingPathwayIds.push(m.pathway.id);

    resolvedPlans.push(
      projectResolutionToCarePlan(traversalResult.resolutionState, {
        pathwayId: m.pathway.id,
        pathwayLogicalId: m.pathway.logicalId,
        pathwayTitle: m.pathway.title,
      }),
    );
  }

  return { resolvedPlans, contributingSessionIds, contributingPathwayIds };
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
      const chosen = conflict.candidates.find(
        (c) => c.sourcePathwayId === resolution.chosenPathwayId,
      )!;
      medications.push({
        recommendation: chosen.recommendation,
        sourcePathwayIds: [chosen.sourcePathwayId],
        state: 'provider-confirmed',
      });
      break;
    }
    case 'ACCEPT_BOTH': {
      for (const c of conflict.candidates) {
        medications.push({
          recommendation: c.recommendation,
          sourcePathwayIds: [c.sourcePathwayId],
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const carePlanResult = await client.query(
      `INSERT INTO care_plans
         (patient_id, title, provider_id, status, condition_codes, source, created_by)
       VALUES ($1, $2, $3, 'DRAFT', $4, 'multi_pathway_resolution', $5)
       RETURNING id`,
      [
        session.patientId,
        'Multi-Pathway Care Plan',
        session.providerId,
        [], // condition codes aggregation deferred — single-pathway flow does this from included nodes
        session.providerId,
      ],
    );
    const carePlanId: string = carePlanResult.rows[0].id;

    // One goal per contributing pathway as a placeholder; richer goal
    // synthesis can come later.
    for (const pathwayId of session.contributingPathwayIds) {
      await client.query(
        `INSERT INTO care_plan_goals (care_plan_id, description, priority, pathway_node_id)
         VALUES ($1, $2, 'HIGH', $3)`,
        [carePlanId, `Goals from pathway ${pathwayId}`, pathwayId],
      );
    }

    // Interventions: one row per merged recommendation across all types.
    for (const m of session.mergedPlan.medications) {
      const r = m.recommendation;
      await client.query(
        `INSERT INTO care_plan_interventions
           (care_plan_id, type, description, dosage, frequency,
            recommendation_confidence, source, pathway_node_id, pathway_id, session_id)
         VALUES ($1, 'MEDICATION', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          carePlanId,
          r.name,
          r.dose ?? null,
          r.frequency ?? null,
          1.0,
          m.state === 'provider-override' ? 'provider_override' : 'pathway_recommendation',
          r.sourceNodeId ?? null,
          r.sourcePathwayId === 'provider-override' ? null : r.sourcePathwayId,
          null,
        ],
      );
    }
    for (const l of session.mergedPlan.labs) {
      await client.query(
        `INSERT INTO care_plan_interventions
           (care_plan_id, type, description, recommendation_confidence, source, pathway_node_id, pathway_id, session_id)
         VALUES ($1, 'MONITORING', $2, $3, $4, $5, $6, $7)`,
        [carePlanId, l.recommendation.name, 1.0, 'pathway_recommendation', l.recommendation.sourceNodeId ?? null, l.recommendation.sourcePathwayId, null],
      );
    }
    for (const p of session.mergedPlan.procedures) {
      await client.query(
        `INSERT INTO care_plan_interventions
           (care_plan_id, type, description, procedure_code, recommendation_confidence, source, pathway_node_id, pathway_id, session_id)
         VALUES ($1, 'PROCEDURE', $2, $3, $4, $5, $6, $7, $8)`,
        [carePlanId, p.recommendation.name, p.recommendation.code ?? null, 1.0, 'pathway_recommendation', p.recommendation.sourceNodeId ?? null, p.recommendation.sourcePathwayId, null],
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

// ─── GraphQL formatting ─────────────────────────────────────────────

export function formatSessionForGraphQL(s: MultiPathwayResolutionSession) {
  return {
    id: s.id,
    patientId: s.patientId,
    providerId: s.providerId,
    status: s.status,
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
    procedures: merged.procedures.map((m) => ({
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
  };
}

function formatSuppressedForGraphQL(s: MergedCarePlan['suppressed'][number]) {
  const typeMap = {
    medication: 'MEDICATION',
    lab: 'LAB',
    procedure: 'PROCEDURE',
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
    procedures: [],
    schedules: [],
    qualityMetrics: [],
    suppressed: [],
    conflicts: [],
  };
}
