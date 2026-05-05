import { GraphQLError } from 'graphql';
import { DataSourceContext, NodeStatus, OverrideAction, SessionStatus } from '../../types';
import { PatientContext } from '../../services/confidence/types';
import { PATHWAY_COLUMNS, formatSessionForGraphQL } from '../Query';
import { TraversalEngine } from '../../services/resolution/traversal-engine';
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
import {
  buildResolutionContext,
  makeTraversalAdapter,
  makeRetraversalAdapter,
} from '../helpers/resolution-context';
import { applyDdiToResolutionState } from '../../services/medications/ddi-pass-single-pathway';

export interface GateAnswerInput {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

export interface AdditionalContextInput {
  conditionCodes?: Array<{ code: string; system: string; display?: string }>;
  medications?: Array<{ code: string; system: string; display?: string }>;
  labResults?: Array<{ code: string; system: string; value?: number; unit?: string; date?: string; display?: string }>;
  allergies?: Array<{ code: string; system: string; display?: string }>;
  vitalSigns?: Record<string, unknown>;
  freeformData?: Record<string, unknown>;
}

export const resolutionMutations = {
  async startResolution(
    _parent: unknown,
    args: {
      pathwayId: string;
      patientId: string;
      patientContext?: {
        patientId: string;
        conditionCodes?: Array<{ code: string; system: string; display?: string }>;
        medications?: Array<{ code: string; system: string; display?: string }>;
        labResults?: Array<{ code: string; system: string; value?: number; unit?: string; date?: string; display?: string }>;
        allergies?: Array<{ code: string; system: string; display?: string }>;
        vitalSigns?: Record<string, unknown>;
      };
    },
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

    const pc = args.patientContext;
    const patientContext: PatientContext = {
      patientId: args.patientId,
      conditionCodes: pc?.conditionCodes ?? [],
      medications: pc?.medications ?? [],
      labResults: pc?.labResults ?? [],
      allergies: pc?.allergies ?? [],
      vitalSigns: pc?.vitalSigns,
    };

    const traversalEngine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, args.pathwayId, patientContext),
      rctx.thresholds,
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
    });

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
      const patientCtx = session.initialPatientContext as PatientContext;

      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
        rctx.thresholds,
      );

      const reResult = await retraversalEngine.retraverse(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        patientCtx,
        session.gateAnswers,
      );

      statusChanges.push(...reResult.statusChanges);
    }

    // 7. Update session (with optimistic lock)
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
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
    const gateOpened = args.answer.booleanValue === true ||
      (args.answer.selectedOption != null) ||
      (args.answer.numericValue != null);

    // 4. Build resolution context and find affected subtree
    const rctx = await buildResolutionContext(pool, session.pathwayId);

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

    const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
    let nodesRecomputed = 0;
    const patientCtx = session.initialPatientContext as PatientContext;

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

      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
        rctx.thresholds,
      );

      const reResult = await retraversalEngine.retraverse(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        patientCtx,
        session.gateAnswers,
      );

      statusChanges.push(...reResult.statusChanges);
      nodesRecomputed = reResult.nodesRecomputed;

      // Update pending questions and red flags
      // Remove the answered gate from pending, add any new ones
      session.pendingQuestions = session.pendingQuestions
        .filter(q => q.gateId !== args.gateId)
        .concat(reResult.newPendingQuestions);
      if (reResult.newRedFlags.length > 0) {
        session.redFlags = [...session.redFlags, ...reResult.newRedFlags];
      }
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
    }

    // 7. Update session
    await updateSession(pool, args.sessionId, {
      resolutionState: session.resolutionState,
      pendingQuestions: session.pendingQuestions,
      redFlags: session.redFlags,
      gateAnswers: session.gateAnswers,
      totalNodesEvaluated: session.resolutionState.size,
    }, session.updatedAt);

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
      pathwayId: session.pathwayId,
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

    // 2. Merge additional context
    const merged = { ...(session.additionalContext ?? {}), ...args.additionalContext };

    // 3. Build updated patient context for re-evaluation
    const basePc = session.initialPatientContext as PatientContext;

    // Deduplicate by code+system when merging
    const dedup = <T extends { code: string; system: string }>(base: T[], added: T[]): T[] => {
      const seen = new Set(base.map(e => `${e.code}|${e.system}`));
      const result = [...base];
      for (const item of added) {
        const key = `${item.code}|${item.system}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      return result;
    };

    const updatedPc: PatientContext = {
      patientId: basePc.patientId,
      conditionCodes: dedup(basePc.conditionCodes, args.additionalContext.conditionCodes ?? []),
      medications: dedup(basePc.medications, args.additionalContext.medications ?? []),
      labResults: dedup(basePc.labResults, args.additionalContext.labResults ?? []),
      allergies: dedup(basePc.allergies, args.additionalContext.allergies ?? []),
      vitalSigns: {
        ...(basePc.vitalSigns ?? {}),
        ...(args.additionalContext.vitalSigns ?? {}),
      },
    };

    // 4. Identify affected nodes via dependency maps
    const changedFields = new Set<string>();
    if (args.additionalContext.conditionCodes) changedFields.add('conditions');
    if (args.additionalContext.medications) changedFields.add('medications');
    if (args.additionalContext.labResults) changedFields.add('labs');
    if (args.additionalContext.allergies) changedFields.add('allergies');
    if (args.additionalContext.vitalSigns) changedFields.add('vitalSigns');

    const affectedNodes = new Set<string>();

    // Gates: mark if any context field they read was updated.
    // Field names must match exactly what gate-evaluator.ts getCodeEntries uses:
    // 'conditions', 'medications', 'labs', 'allergies', 'vitals'
    const fieldToContextKey: Record<string, keyof AdditionalContextInput> = {
      conditions: 'conditionCodes',
      medications: 'medications',
      labs: 'labResults',
      allergies: 'allergies',
      vitals: 'vitalSigns',
    };
    for (const [gateId, fields] of session.dependencyMap.gateContextFields) {
      for (const field of fields) {
        const contextKey = fieldToContextKey[field];
        if (contextKey && args.additionalContext[contextKey] !== undefined) {
          affectedNodes.add(gateId);
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

      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, updatedPc),
        rctx.thresholds,
      );

      const reResult = await retraversalEngine.retraverse(
        affectedNodes,
        session.resolutionState,
        session.dependencyMap,
        rctx.graphContext,
        updatedPc,
        session.gateAnswers,
      );

      statusChanges.push(...reResult.statusChanges);
      nodesRecomputed = reResult.nodesRecomputed;

      // Update pending questions and red flags
      if (reResult.newPendingQuestions.length > 0) {
        session.pendingQuestions = [...session.pendingQuestions, ...reResult.newPendingQuestions];
      }
      if (reResult.newRedFlags.length > 0) {
        session.redFlags = [...session.redFlags, ...reResult.newRedFlags];
      }
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
        addedContext: Object.keys(args.additionalContext).filter(
          k => (args.additionalContext as Record<string, unknown>)[k] !== undefined
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

      const carePlanResult = await client.query(
        `INSERT INTO care_plans (patient_id, title, provider_id, status, condition_codes, source, pathway_session_id, created_by)
         VALUES ($1, $2, $3, 'DRAFT', $4, 'pathway_resolution', $5, $6)
         RETURNING id`,
        [
          session.patientId,
          carePlanTitle,
          session.providerId,
          carePlanData.conditionCodes,
          args.sessionId,
          session.providerId,
        ]
      );
      carePlanId = carePlanResult.rows[0].id;

      // 5. Insert goals
      for (const goal of carePlanData.goals) {
        await client.query(
          `INSERT INTO care_plan_goals (care_plan_id, description, priority, guideline_reference, pathway_node_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [carePlanId, goal.description, goal.priority, goal.guidelineReference ?? null, goal.pathwayNodeId]
        );
      }

      // 6. Insert interventions
      for (const intervention of carePlanData.interventions) {
        await client.query(
          `INSERT INTO care_plan_interventions
           (care_plan_id, type, description, medication_code, dosage, frequency,
            procedure_code, referral_specialty, patient_instructions, guideline_reference,
            recommendation_confidence, source, pathway_node_id, pathway_id, session_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            carePlanId, intervention.type, intervention.description,
            intervention.medicationCode ?? null, intervention.dosage ?? null,
            intervention.frequency ?? null, intervention.procedureCode ?? null,
            intervention.referralSpecialty ?? null, intervention.patientInstructions ?? null,
            intervention.guidelineReference ?? null, intervention.recommendationConfidence,
            intervention.source, intervention.pathwayNodeId,
            intervention.pathwayId, intervention.sessionId,
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
