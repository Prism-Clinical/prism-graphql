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
import { applicablePathways } from '../../services/resolution/pathway-applicability';
import { buildEffectivePatientContext, mergeAdditionalContext } from '../../services/resolution/effective-context';
import { firstTrustAssertion, normalizeContextEntryNulls } from '../../services/resolution/temporal/trust-mode';
import type { AdditionalContextInput } from './resolution';
import { setPlanNode } from './resolution';
import { loadRememberedAttributes } from '../../services/resolution/remembered-answers';
import { randomUUID } from 'crypto';
import {
  PLAN_ITEM_KINDS,
  WRITE_IN,
  cleanFields,
  planEditProblem,
  type PlanEdit,
  type PlanItemKind,
  type PlanNodeRef,
} from '../../services/resolution/pipeline/plan-edits';
import {
  candidatePathwayIds,
  MergedCarePlan,
  MergedConflict,
  ConflictResolution,
  ConflictResolutionKind,
  CustomMedicationOverride,
} from '../../services/resolution/care-plan-merge';
import { fetchGraphFromAGE, resolveTemporalPolicyVersion } from '../helpers/resolution-context';
import { citationsForNodes } from '../../services/resolution/plan-citations';
import { runAssumptions } from '../../services/resolution/assumptions';
import {
  KNOWN_VACCINES, immunizationMedicationEntry, immunizationOfEntry, insertImmunization, loadImmunizations, parseOccurrence,
  parseVaccineRef, retractImmunization, toFhirImmunization,
} from '../../services/resolution/immunizations';
import type { ImmunizationRecord } from '../../services/resolution/immunizations';
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
  commitRunWithJoiners,
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
  /** Doses delivered with the chart. */
  immunizations?: Array<{ vaccine: unknown; date?: string | null; reported?: boolean | null }> | null;
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
  /** Diagnoses on THIS encounter — the only codes that activate a pathway. */
  encounterDiagnoses?: Array<{ code: string; system: string; display?: string | null; date?: string | null }>;
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
  chosenNodeId?: string;
  customMedication?: CustomMedicationOverride;
}

export interface ResolveConflictArgs {
  sessionId: string;
  conflictId: string;
  choice: ConflictChoiceInput;
}

function invalidImmunization(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'INVALID_IMMUNIZATION' } });
}

/** A dose delivered with the chart, validated; its id is its place in the list. */
function chartDose(
  raw: { vaccine: unknown; date?: string | null; reported?: boolean | null },
  index: number,
  asOf: string,
): ImmunizationRecord {
  const vaccine = parseVaccineRef(raw.vaccine);
  if ('problem' in vaccine) return invalidImmunization(`immunizations[${index}]: ${vaccine.problem}`);
  try {
    return { id: String(index), origin: 'CHART', ...vaccine, ...parseOccurrence(raw.date, null, asOf), reported: raw.reported === true };
  } catch (err) {
    return invalidImmunization(`immunizations[${index}]: ${(err as Error).message}`);
  }
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
    let patientContext = toPatientContext(resolutionInput);

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
    // Only a diagnosis ON THE ENCOUNTER activates a pathway
    // ([DECISION — Josh 2026-10-04]: "it can read throughout the chart to help
    // a pathway, but chart can't cause a pathway to be activated"). The chart's
    // problem list — the supplied context, or the patient's stored rows — is
    // data every gate may read, and is never what the matcher sees. A run with
    // no encounter diagnosis starts with no pathways; they join as diagnoses
    // are added (`addEncounterContext`).
    const encounterDiagnoses = normalizeContextEntryNulls({ conditionCodes: args.encounterDiagnoses ?? [] }).conditionCodes ?? [];
    matcherOptions.directPatientCodes = encounterDiagnoses.map((c) => ({ code: c.code, system: c.system }));
    const startingContext: Partial<AdditionalContextInput> = encounterDiagnoses.length > 0 ? { conditionCodes: encounterDiagnoses } : {};

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

    // Answers remembered for this patient from earlier encounters
    // (remembered-answers.ts) are supplied as patient attributes the chart does
    // not carry — read once here, so the run's stored context holds them and
    // every re-evaluation and replay sees the same patient.
    const remembered = await loadRememberedAttributes(pool, {
      patientId: args.patientId,
      asOf: temporalContext.evaluationAsOf,
      suppliedAttributes: patientContext.patientAttributes as Record<string, unknown> | undefined,
    });
    if (Object.keys(remembered).length > 0) {
      patientContext = {
        ...patientContext,
        patientAttributes: { ...remembered, ...(patientContext.patientAttributes ?? {}) } as typeof patientContext.patientAttributes,
      };
    }

    // Her immunization doses — delivered with the chart, and on her record
    // here from earlier encounters (immunizations.ts) — join the medication
    // list, where the vaccine gates read. Once, here, for the same reason as
    // the remembered answers: the run's stored context then holds them.
    const doses: ImmunizationRecord[] = [
      ...(args.immunizations ?? []).map((d, i) => chartDose(d, i, temporalContext.evaluationAsOf)),
      ...(await loadImmunizations(pool, args.patientId)),
    ];
    if (doses.length > 0) {
      patientContext = {
        ...patientContext,
        medications: [...patientContext.medications, ...doses.map(immunizationMedicationEntry)] as typeof patientContext.medications,
      };
    }

    // Validates the request — like the version check — before the zero-match
    // branch: whether a malformed context is rejected must not depend on how
    // many pathways happened to match. The store itself is discarded; each
    // child's evaluation assembles its own from the same inputs. Under
    // `legacy-v0` the assembler is never entered (P1-9).
    factStoreForInput(resolutionInput, temporalContext);

    // Obstetric pathways apply to pregnant patients only (pathway-applicability.ts).
    const matched = applicablePathways(
      await getMatchedPathways(pool, args.patientId, matcherOptions),
      buildEffectivePatientContext(patientContext, startingContext),
    );
    // Zero matches takes the same path with no children (spec §3): the run is
    // stored, with EMPTY_PLAN at its root, as a record that nothing matched.
    const surviving = matched.length === 0 ? [] : await collapseLattice(pool, matched);

    const request = newRunRequest();
    const ev = await evaluateRun(pool, request, {
      initialPatientContext: patientContext,
      additionalContext: startingContext,
      temporalContext,
      conflictResolutions: {},
      planEdits: {},
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
        // The evaluated clock: it carries the therapy starts pinned at start.
        temporalContext: ev.inputs.temporalContext,
        additionalContext: startingContext,
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
   * Add facts to an encounter in progress, and let newly matching pathways
   * join it. Matching runs on the patient's diagnoses as they stand AFTER the
   * addition; a pathway already in the run is never added twice, and one that
   * no longer matches stays — an encounter does not un-ask what it has asked.
   */
  async addEncounterContext(
    _parent: unknown,
    args: { sessionId: string; additionalContext: AdditionalContextInput; includeDraftPathways?: boolean },
    context: DataSourceContext,
  ) {
    // The same trust parsing as addPatientContext (D10).
    const assertion = firstTrustAssertion(args.additionalContext);
    if (assertion) {
      throw new GraphQLError(
        `additionalContext.${assertion} is a SYNTHETIC assertion about clinical truth and cannot be supplied through addEncounterContext`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }
    const added = normalizeContextEntryNulls(args.additionalContext);
    const { pool } = context;

    const run = await commitRunWithJoiners(pool, args.sessionId, context.userId, async (r) => {
      const inputs = runInputsOf(r);
      inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, added);

      // Applicability (is she pregnant?) reads the whole effective context; matching does not.
      const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
      const matched = applicablePathways(
        await getMatchedPathways(pool, r.parent.patientId, {
          // Encounter diagnoses only: the run's additions, never the chart it started from.
          directPatientCodes: (inputs.additionalContext.conditionCodes ?? []).map((c) => ({ code: c.code, system: c.system })),
          ...(args.includeDraftPathways ? { includeDraftPathways: true } : {}),
        }),
        patient,
      );
      const surviving = matched.length === 0 ? [] : await collapseLattice(pool, matched);
      const present = new Set(inputs.children.map((c) => c.pathwayId));
      const joining = surviving.filter((m) => !present.has(m.pathway.id));
      for (const m of joining) {
        inputs.children.push({
          sessionId: '',
          pathwayId: m.pathway.id,
          // '' = not pinned yet: evaluateRun pins the graph and the therapy starts.
          inputs: { pathwayId: m.pathway.id, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: new Map(), observations: new Map(), revision: 0 },
        });
      }
      return {
        inputs,
        joining: joining.map((m) => ({ pathwayId: m.pathway.id, version: m.pathway.version })),
        triggerData: {
          addedContext: Object.keys(added).filter((k) => (added as Record<string, unknown>)[k] !== undefined),
          joinedPathwayIds: joining.map((m) => m.pathway.id),
        },
      };
    });
    return formatSessionForGraphQL(run.parent);
  },

  /** A dose given before this visit: onto her record, and into the run. See immunizations.ts. */
  async recordImmunization(
    _parent: unknown,
    args: { sessionId: string; vaccine: unknown; date?: string | null },
    context: DataSourceContext,
  ) {
    const vaccine = parseVaccineRef(args.vaccine);
    if ('problem' in vaccine) invalidImmunization(vaccine.problem);
    const id = randomUUID();
    let pendingDose: { patientId: string; when: ReturnType<typeof parseOccurrence>; replacedIds: string[] } | undefined;
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      let when: ReturnType<typeof parseOccurrence>;
      try {
        // Against the encounter's own clock, not the wall clock.
        when = parseOccurrence(args.date, null, r.parent.temporalContext.evaluationAsOf);
      } catch (err) {
        return invalidImmunization((err as Error).message);
      }
      const inputs = runInputsOf(r);
      const entry = immunizationMedicationEntry({ id, origin: 'PRISM', ...vaccine, ...when, reported: true });
      // A dose of the same vaccine recorded earlier in this encounter with no
      // date is the one now being dated: the dated entry replaces it.
      const replaced = (inputs.additionalContext.medications ?? []).filter((m) => {
        const dose = immunizationOfEntry(m);
        return dose?.origin === 'PRISM' && dose.rxnormIngredient === vaccine.rxnormIngredient && !dose.date && !!when.date;
      });
      inputs.additionalContext = {
        ...inputs.additionalContext,
        medications: [...(inputs.additionalContext.medications ?? []).filter((m) => !replaced.includes(m)), entry],
      };
      pendingDose = { patientId: r.parent.patientId, when, replacedIds: replaced.map((m) => immunizationOfEntry(m)!.id) };
      return { inputs, events: [] };
    });
    // After the run took it: a dose the run refused is not on her record.
    const done = pendingDose as { patientId: string; when: ReturnType<typeof parseOccurrence>; replacedIds: string[] } | undefined;
    if (done) {
      await insertImmunization(context.pool, {
        id, patientId: done.patientId, dose: { ...vaccine, ...done.when, reported: true }, recordedBy: context.userId, sessionId: args.sessionId,
      });
      for (const old of done.replacedIds) await retractImmunization(context.pool, done.patientId, old);
    }
    return formatSessionForGraphQL(run.parent);
  },

  async retractPatientImmunization(
    _parent: unknown,
    args: { patientId: string; immunizationId: string },
    context: DataSourceContext,
  ) {
    return retractImmunization(context.pool, args.patientId, args.immunizationId);
  },

  async removeImmunization(
    _parent: unknown,
    args: { sessionId: string; immunizationId: string },
    context: DataSourceContext,
  ) {
    let patientId: string | undefined;
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      const inputs = runInputsOf(r);
      const before = inputs.additionalContext.medications ?? [];
      const after = before.filter((m) => {
        const dose = immunizationOfEntry(m);
        return !(dose?.origin === 'PRISM' && dose.id === args.immunizationId);
      });
      if (after.length === before.length) {
        invalidImmunization('Only a dose recorded during this encounter can be taken back here.');
      }
      inputs.additionalContext = { ...inputs.additionalContext, medications: after };
      patientId = r.parent.patientId;
      return { inputs, events: [] };
    });
    if (patientId) await retractImmunization(context.pool, patientId, args.immunizationId);
    return formatSessionForGraphQL(run.parent);
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
   * The provider removes a line from the plan, or puts one back. A line can
   * stand for several nodes (one code ordered by several steps or pathways),
   * so the nodes arrive as a list; each is overridden on the per-pathway
   * session that owns it and the run is re-evaluated.
   */
  async setPlanItems(
    _parent: unknown,
    args: { sessionId: string; items: Array<{ pathwayId: string; nodeId: string }>; action: 'REMOVE' | 'RESTORE'; reason?: string | null },
    context: DataSourceContext,
  ) {
    const children = await context.pool.query(
      `SELECT id, pathway_id FROM pathway_resolution_sessions WHERE parent_session_id = $1`,
      [args.sessionId],
    );
    const sessionOf = new Map(children.rows.map((r) => [String(r.pathway_id), String(r.id)]));
    // A line the provider ADDED has no node: its reference is the write-in
    // pathway and the edit id. Removing it deletes the addition (there is
    // nothing of the pathway's to restore).
    const additions = args.items.filter((i) => i.pathwayId === WRITE_IN).map((i) => i.nodeId);
    if (additions.length > 0 && args.action === 'REMOVE') {
      await commitRun(context.pool, args.sessionId, (r) => {
        const inputs = runInputsOf(r);
        for (const id of additions) delete inputs.planEdits[id];
        return { inputs, events: [] };
      });
    }
    for (const item of args.items) {
      if (item.pathwayId === WRITE_IN) continue;
      const childId = sessionOf.get(item.pathwayId);
      if (!childId) {
        throw new GraphQLError(
          `Pathway "${item.pathwayId}" is not part of session "${args.sessionId}"`,
          { extensions: { code: 'NOT_FOUND' } },
        );
      }
      await setPlanNode(context.pool, {
        sessionId: childId,
        nodeId: item.nodeId,
        remove: args.action === 'REMOVE',
        reason: args.reason ?? undefined,
      });
    }
    const session = await getMultiPathwaySession(context.pool, args.sessionId);
    return session ? formatSessionForGraphQL(session) : null;
  },

  /**
   * The provider edits a line of the plan as free text (a dose, a follow-up
   * interval, a guidance note). `fields: null` withdraws the edit — the line
   * reads as the pathway wrote it again. An edit of a line the provider added
   * changes the addition itself.
   */
  async editPlanItem(
    _parent: unknown,
    args: { sessionId: string; items: PlanNodeRef[]; kind: string; fields?: Record<string, unknown> | null },
    context: DataSourceContext,
  ) {
    const kind = planItemKind(args.kind);
    const refs = args.items.map(({ pathwayId, nodeId }) => ({ pathwayId, nodeId }));
    if (refs.length === 0) invalidPlanEdit('items is empty — pass the line\'s sourceNodes');
    const addition = refs.find((r) => r.pathwayId === WRITE_IN);
    const fields = args.fields ? cleanFields(args.fields) : null;
    if (args.fields) {
      const problem = planEditProblem(addition ? 'ADD' : 'EDIT', kind, args.fields);
      if (problem) invalidPlanEdit(problem);
    }
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      const inputs = runInputsOf(r);
      if (addition) {
        const existing = inputs.planEdits[addition.nodeId];
        if (!existing) invalidPlanEdit(`No added line "${addition.nodeId}" in this session`);
        if (fields) inputs.planEdits[addition.nodeId] = { ...existing, fields, at: existing.at };
        return { inputs, events: [] };
      }
      // One edit per line: an edit that shares a node with this one is replaced.
      for (const [id, e] of Object.entries(inputs.planEdits)) {
        if (e.action === 'EDIT' && (e.target ?? []).some((t) => refs.some((x) => x.pathwayId === t.pathwayId && x.nodeId === t.nodeId))) {
          delete inputs.planEdits[id];
        }
      }
      if (fields) {
        const edit: PlanEdit = { id: randomUUID(), action: 'EDIT', itemKind: kind, target: refs, fields, by: context.userId, at: new Date().toISOString() };
        inputs.planEdits[edit.id] = edit;
      }
      return { inputs, events: [] };
    });
    return formatSessionForGraphQL(run.parent);
  },

  /** The provider adds a line no pathway produced. An added medication is safety-checked like any write-in. */
  async addPlanItem(
    _parent: unknown,
    args: { sessionId: string; kind: string; fields: Record<string, unknown> },
    context: DataSourceContext,
  ) {
    const kind = planItemKind(args.kind);
    const problem = planEditProblem('ADD', kind, args.fields ?? {});
    if (problem) invalidPlanEdit(problem);
    const edit: PlanEdit = {
      id: randomUUID(), action: 'ADD', itemKind: kind, fields: cleanFields(args.fields), by: context.userId, at: new Date().toISOString(),
    };
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      const inputs = runInputsOf(r);
      inputs.planEdits[edit.id] = edit;
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

function invalidPlanEdit(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'INVALID_PLAN_EDIT' } });
}

function planItemKind(raw: string): PlanItemKind {
  const kind = String(raw).toLowerCase() as PlanItemKind;
  if (!PLAN_ITEM_KINDS.includes(kind)) invalidPlanEdit(`Unknown plan item kind "${raw}"`);
  return kind;
}

export const multiPathwayResolutionQueries = {
  /** A patient's immunization record here, each dose with its FHIR resource. */
  async patientImmunizations(
    _: unknown,
    args: { patientId: string; includeEnteredInError?: boolean | null },
    context: DataSourceContext,
  ) {
    const doses = await loadImmunizations(context.pool, args.patientId, args.includeEnteredInError === true);
    return doses.map((d) => ({
      id: d.id,
      vaccine: { cvx: d.cvx, rxnormIngredient: d.rxnormIngredient, display: d.display },
      date: d.date ?? null,
      precision: d.precision,
      reported: d.reported,
      status: d.status ?? 'completed',
      recordedAt: d.recordedAt ?? null,
      recordedBy: d.recordedBy ?? null,
      fhir: toFhirImmunization(d, args.patientId),
    }));
  },

  knownVaccines: () => KNOWN_VACCINES,

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
     * The provider's edits and additions, each with whether it currently
     * applies: an edit whose line the pathways no longer produce is listed as
     * not applying, never dropped.
     */
    planChanges: (parent: { planEdits?: Record<string, PlanEdit>; mergedPlan: { [k: string]: unknown } }) => {
      const edits = Object.values(parent.planEdits ?? {});
      if (edits.length === 0) return [];
      const lines = ['medications', 'labs', 'imaging', 'procedures', 'guidance', 'schedules']
        .flatMap((k) => (parent.mergedPlan[k] as Array<{ sourceNodes?: PlanNodeRef[] }> | undefined) ?? []);
      const present = new Set(lines.flatMap((l) => (l.sourceNodes ?? []).map((n) => `${n.pathwayId}|${n.nodeId}`)));
      return edits
        .sort((a, b) => (a.at < b.at ? -1 : 1))
        .map((e) => ({
          id: e.id,
          action: e.action,
          kind: e.itemKind.toUpperCase(),
          items: e.action === 'ADD' ? [{ pathwayId: WRITE_IN, nodeId: e.id }] : e.target ?? [],
          fields: e.fields,
          // An added order the pathways already carry is folded into their
          // line; only an added medication can be withheld (by a safety check).
          applies: e.action === 'ADD'
            ? present.has(`${WRITE_IN}|${e.id}`) || e.itemKind !== 'medication'
            : (e.target ?? []).some((t) => present.has(`${t.pathwayId}|${t.nodeId}`)),
        }));
    },

    /**
     * The guideline citations behind each line of the merged plan. Read from
     * the pathway graphs when asked for, never stored with the run: the plan
     * (and so `resultHash`) is exactly what it was without them. One graph
     * read per contributing pathway that has a line in the plan.
     */
    recommendationCitations: async (
      parent: { mergedPlan: { [k: string]: unknown } },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      const lines = ['medications', 'labs', 'imaging', 'procedures', 'guidance', 'schedules', 'qualityMetrics']
        .flatMap((k) => (parent.mergedPlan[k] as Array<{ sourceNodes?: PlanNodeRef[] }> | undefined) ?? []);
      const nodesByPathway = new Map<string, string[]>();
      for (const ref of lines.flatMap((l) => l.sourceNodes ?? [])) {
        // A line the provider wrote in has no pathway and cites nothing.
        if (ref.pathwayId === WRITE_IN) continue;
        nodesByPathway.set(ref.pathwayId, [...(nodesByPathway.get(ref.pathwayId) ?? []), ref.nodeId]);
      }
      if (nodesByPathway.size === 0) return [];
      const index = await context.pool.query(
        'SELECT id, age_node_id FROM pathway_graph_index WHERE id = ANY($1::uuid[])',
        [[...nodesByPathway.keys()]],
      );
      const perPathway = await Promise.all(
        index.rows
          .filter((row) => row.age_node_id)
          .map(async (row) => {
            const pathwayId = String(row.id);
            const graph = await fetchGraphFromAGE(context.pool, String(row.age_node_id));
            return citationsForNodes(graph, nodesByPathway.get(pathwayId) ?? []).map((c) => ({ pathwayId, ...c }));
          }),
      );
      return perPathway.flat();
    },

    /** Doses the run reads, off the medication entries they travel as. */
    immunizations: async (parent: { id: string }, _args: unknown, context: DataSourceContext) => {
      const { rows } = await context.pool.query(
        `SELECT initial_patient_context, additional_context FROM multi_pathway_resolution_sessions WHERE id = $1`,
        [parent.id],
      );
      const of = (ctx: { medications?: unknown[] } | null | undefined, thisEncounter: boolean) =>
        ((ctx?.medications ?? []) as Array<Record<string, string>>)
          .map(immunizationOfEntry)
          .filter((d): d is ImmunizationRecord => d !== null)
          .map((d) => ({
            id: d.id,
            vaccine: { cvx: d.cvx, rxnormIngredient: d.rxnormIngredient, display: d.display },
            date: d.date ?? null,
            precision: d.precision,
            reported: d.reported,
            origin: d.origin,
            recordedThisEncounter: thisEncounter,
          }));
      return [...of(rows[0]?.initial_patient_context, false), ...of(rows[0]?.additional_context, true)];
    },

    /** Plan lines and questions about a vaccine: nodes authored with an `immunization`. */
    vaccineNodes: async (parent: { contributingSessionIds: string[] }, _args: unknown, context: DataSourceContext) => {
      if (!parent.contributingSessionIds?.length) return [];
      const { rows } = await context.pool.query(
        `SELECT s.pathway_id, n.key AS node_id, n.value AS node
           FROM pathway_resolution_sessions s, jsonb_each(s.resolution_state) n
          WHERE s.id = ANY($1::uuid[]) AND n.value -> 'properties' ? 'immunization'`,
        [parent.contributingSessionIds],
      );
      return rows.flatMap((r) => {
        const vaccine = parseVaccineRef(r.node?.properties?.immunization);
        if ('problem' in vaccine) return [];
        return [{ pathwayId: String(r.pathway_id), nodeId: String(r.node?.nodeId ?? r.node_id), nodeType: String(r.node?.nodeType ?? ''), vaccine }];
      });
    },

    /**
     * Where the plan rests on something less than a fresh, measured chart
     * value. Read from the run's stored chart and its pathways' stored answers
     * and gates when asked for (`runAssumptions`); nothing is evaluated,
     * stored or hashed.
     */
    assumptions: async (
      parent: { id: string; contributingSessionIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingSessionIds?.length) return [];
      const [chart, children] = await Promise.all([
        context.pool.query(
          `SELECT initial_patient_context, additional_context FROM multi_pathway_resolution_sessions WHERE id = $1`,
          [parent.id],
        ),
        context.pool.query(
          `SELECT id, pathway_id, gate_answers, resolution_state
             FROM pathway_resolution_sessions
            WHERE id = ANY($1::uuid[])`,
          [parent.contributingSessionIds],
        ),
      ]);
      // In the run's own pathway order, so the list does not shuffle between reads.
      const order = new Map(parent.contributingSessionIds.map((id, i) => [id, i]));
      return runAssumptions({
        initialContext: chart.rows[0]?.initial_patient_context ?? {},
        additionalContext: chart.rows[0]?.additional_context ?? {},
        children: children.rows
          .map((r) => ({
            sessionId: String(r.id),
            pathwayId: String(r.pathway_id),
            gateAnswers: r.gate_answers ?? {},
            resolutionState: r.resolution_state ?? {},
          }))
          .sort((a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0)),
      });
    },

    /**
     * What the provider took out of the plan — every EXCLUDE override on the
     * contributing sessions, with enough to name the line and put it back.
     */
    providerRemovals: async (
      parent: { contributingSessionIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingSessionIds?.length) return [];
      const result = await context.pool.query(
        `SELECT s.pathway_id, o.key AS node_id, o.value AS override, s.resolution_state -> o.key AS node
           FROM pathway_resolution_sessions s, jsonb_each(s.provider_overrides) o
          WHERE s.id = ANY($1::uuid[]) AND o.value ->> 'action' = 'EXCLUDE'`,
        [parent.contributingSessionIds],
      );
      return result.rows.map((r) => {
        const props = (r.node?.properties ?? {}) as Record<string, unknown>;
        const name = props.name ?? props.topic ?? props.interval ?? props.title ?? r.node?.title ?? r.node_id;
        return {
          pathwayId: String(r.pathway_id),
          nodeId: String(r.node_id),
          nodeType: String(r.node?.nodeType ?? ''),
          title: String(name),
          reason: r.override?.reason ?? null,
        };
      });
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
        lastOnFileValue: number | null;
        lastOnFileDate: string | null;
        lastOnFileCode: string | null;
        lastOnFileSystem: string | null;
        lastOnFileDisplay: string | null;
        lastOnFileUnit: string | null;
        alternatives: Array<{ code: string; system: string; display: string; unit: string }> | null;
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
            lastOnFileValue: typeof (q.lastOnFile as { value?: unknown } | undefined)?.value === 'number'
              ? (q.lastOnFile as { value: number }).value
              : null,
            lastOnFileDate: typeof (q.lastOnFile as { date?: unknown } | undefined)?.date === 'string'
              ? (q.lastOnFile as { date: string }).date
              : null,
            ...(['Code', 'System', 'Display', 'Unit'] as const).reduce((acc, k) => {
              const v = (q.lastOnFile as Record<string, unknown> | undefined)?.[k.toLowerCase()];
              return { ...acc, [`lastOnFile${k}`]: typeof v === 'string' ? v : null };
            }, {} as Record<'lastOnFileCode' | 'lastOnFileSystem' | 'lastOnFileDisplay' | 'lastOnFileUnit', string | null>),
            alternatives: Array.isArray(q.alternatives)
              ? (q.alternatives as Array<{ code: string; system: string; display: string; unit: string }>)
              : null,
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
      return {
        kind: 'CONFIRM_PATHWAY',
        chosenPathwayId: choice.chosenPathwayId,
        ...(choice.chosenNodeId ? { chosenNodeId: choice.chosenNodeId } : {}),
        ...meta,
      };
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
  // Any pathway that asked for a candidate's exact drug and regimen is a valid choice.
  const validPathwayIds = new Set(conflict.candidates.flatMap(candidatePathwayIds));
  if (!validPathwayIds.has(resolution.chosenPathwayId)) {
    throw new GraphQLError(
      `chosenPathwayId "${resolution.chosenPathwayId}" is not among this conflict's candidates`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
  if (resolution.chosenNodeId && !conflict.candidates.some((c) => c.recommendation.sourceNodeId === resolution.chosenNodeId)) {
    throw new GraphQLError(
      `chosenNodeId "${resolution.chosenNodeId}" is not among this conflict's candidates`,
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
    planEdits: s.planEdits ?? {},
    contributingSessionIds: s.contributingSessionIds,
    contributingPathwayIds: s.contributingPathwayIds,
    carePlanId: s.carePlanId,
    ddiWarnings: (s.ddiWarnings ?? []).map(formatDdiWarningForGraphQL),
    // Read-only views of the run's own inputs, so a client that reloads can
    // still tell the chart's problems from the encounter's diagnoses.
    chartConditionCodes: conditionCodesOf(s.initialPatientContext),
    encounterDiagnoses: conditionCodesOf(s.additionalContext),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * The condition codes of a stored context, as `EncounterConditionCode`. The
 * stored JSON is not trusted to be well-formed (older rows, hand-made
 * fixtures): anything without a code and a system is left out.
 */
function conditionCodesOf(context: unknown): Array<{ code: string; system: string; display: string | null; date: string | null }> {
  const codes = (context as { conditionCodes?: unknown } | null | undefined)?.conditionCodes;
  if (!Array.isArray(codes)) return [];
  return codes.flatMap((c) => {
    const e = (c ?? {}) as Record<string, unknown>;
    if (typeof e.code !== 'string' || typeof e.system !== 'string') return [];
    return [{
      code: e.code,
      system: e.system,
      display: typeof e.display === 'string' ? e.display : null,
      date: typeof e.date === 'string' ? e.date : null,
    }];
  });
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

/**
 * Every node a merged line stands for. Stored plans from before the merge
 * recorded this carry only the canonical node, which is used as the fallback.
 */
function sourceNodesOf(m: {
  sourceNodes?: Array<{ pathwayId: string; nodeId: string }>;
  recommendation: { sourcePathwayId?: string; sourceNodeId?: string };
}): Array<{ pathwayId: string; nodeId: string }> {
  if (m.sourceNodes?.length) return m.sourceNodes;
  const { sourcePathwayId, sourceNodeId } = m.recommendation;
  return sourcePathwayId && sourceNodeId ? [{ pathwayId: sourcePathwayId, nodeId: sourceNodeId }] : [];
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
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    labs: merged.labs.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    imaging: (merged.imaging ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    procedures: merged.procedures.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    guidance: (merged.guidance ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    schedules: merged.schedules.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
      state: gqlState(m.state),
    })),
    qualityMetrics: merged.qualityMetrics.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      sourceNodes: sourceNodesOf(m),
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
    type: c.type === 'medication_regimen' ? 'MEDICATION_REGIMEN' : c.type === 'medication_choice' ? 'MEDICATION_CHOICE' : 'MEDICATION',
    clinicalRole: c.clinicalRole,
    candidates: c.candidates.map((cand) => ({
      recommendation: cand.recommendation,
      sourcePathwayId: cand.sourcePathwayId,
      // Non-null in the SDL: every pathway that asked for this exact drug and
      // regimen. Omitting it failed the WHOLE session query the moment a run
      // had a conflict, and the simulator fell back to its start snapshot.
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
    chosenNodeId: null as string | null,
    customMedication: null as CustomMedicationOverride | null,
  };
  if (r.kind === 'CONFIRM_PATHWAY') {
    base.chosenPathwayId = r.chosenPathwayId;
    base.chosenNodeId = r.chosenNodeId ?? null;
  }
  if (r.kind === 'CUSTOM_OVERRIDE') base.customMedication = r.customMedication;
  return base;
}
