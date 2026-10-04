// Gate-proof harness — runs the REAL pathway-service evaluator and traversal
// engine (no DB) against simulator-style patient context, so authoring claims
// about what a gate or a DecisionPoint does are proved, not asserted.
//
// Run from the repo root:
//   npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/gate-proof.ts [proof ...]
// Proofs (default: all):
//   attribute-form   why attribute-form lab gates don't fire from simulator context,
//                    and that coded-form equivalents do (the original harness)
//   dp-1             anemia DP-1: is empiric oral iron automatic for ferritin 50?
//   dp-1-scoring     DP-1's (and, v7, DP-3's) two branches, scored signal by signal
//                    with the seeded SYSTEM signals — can confidence alone pick one?
//   ga               anemia gate-iv-iron-ga on patient.gestational_age_weeks: present
//                    values decide, a missing one pends and asks for the datum
//   shared-leaves    anemia labs split per host step: a gate closing one step no
//                    longer takes a lab another (open) step also orders
//   mcv              anemia gate-microcytic: DP-1 is offered only for MCV < 80;
//                    normocytic / macrocytic skip it, a missing MCV asks
//   empiric          anemia DP-1 empiric arm (Stage 1.5): reaches DP-3 (v8) and,
//                    through its oral trial, the same response check as
//                    confirmed IDA; no ferritin needed
//   response         anemia v7 response check on chart data: gate-hgb-response /
//                    gate-hgb-nonresponse, an anchored Hgb delta (window_from on
//                    oral iron, due at day 14) OR/AND the trimester target in
//                    nested groups — start visit NOT_YET_DUE with nothing asked,
//                    day 5 not due, day 21 +1.2 → maintenance, +0.4 → escalation,
//                    at target → maintenance at once, trimester asked only for
//                    Hgb 10.5–11, a missing recheck asks for the newest Hgb;
//                    both arms
//   dp-3             anemia DP-3 (v7; both arms since v8): confirmed IDA and the
//                    empiric arm choose the oral trial (Stage 2.5) or IV iron
//                    without a trial (Step 2.9 → gate-iv-iron-ga-direct → Step
//                    2.10); GA 12 gates IV out, GA missing asks; ferritin 50
//                    never sees DP-3. v9: IV first on the empiric arm (no
//                    ferritin) comes out differently — split per arm here
//   iv-ferritin      anemia v9: IV iron first needs a ferritin < 30 on file —
//                    empiric + no ferritin → ferritin ordered, oral iron
//                    meanwhile, IV held on a ferritin question; ferritin 12 → IV
//                    iron, oral closes; ferritin 50 → no iron; the in-session
//                    ferritin answer re-resolved as addPatientContext does,
//                    matching the chart value; confirmed arm unchanged
//   malabsorption    anemia v8: DP-3 criterion 3c from chart codes — a malabsorption
//                    code opens Step 2.11 (recommend IV first) next to the still-
//                    pending DP-3 question; never forces the route; both arms
//   hgbpathy         anemia v8: hemoglobinopathy disease + MCV < 80 → the empiric
//                    arm is closed (iron studies, Step 1.8, if chosen anyway);
//                    confirmatory studies + ferritin 12 → the normal Stage 2 iron
//                    path, ferritin 50 → no iron; traits / uncoded unchanged
//   unknown-hgb      anemia v10: no hemoglobin on file — the level is ASKED for; Step 1.9
//                    orders a ferritin beside Step 1.1's CBC meanwhile; "Not available"
//                    stops the asking and the plan generates with the anemia labs; a
//                    level entered instead closes Step 1.9 and decides the gates
//   hgb-recheck      anemia v13: the hemoglobin threshold gates read the MOST RECENT value
//                    however old (LIFETIME), and a newest value over 30 days old opens
//                    gate-hgb-recheck-due → Step 1.13 → Lab-25 (repeat CBC). Hgb 8 at 33
//                    days: nothing asked, referral yes, transfusion no, recheck ordered;
//                    Hgb 5.5 at 33 days: transfusion yes, recheck ordered; Hgb 8 at 10
//                    days or undated: no recheck; no Hgb at all: the level is asked for, and both
//                    Step 1.13 (CBC recheck) and Step 1.9 (ferritin) are open
//   response-recheck anemia v14: on oral iron ≥ 14 days with no hemoglobin drawn since it
//                    started, the pathway does not ask for one — an anchored count gate
//                    (count_comparison less_than 1) opens a step that orders the response
//                    recheck (CBC, ferritin, iron/TIBC/saturation); the response gates sit
//                    behind the at_least-1 twin. Josh's patient of 2026-10-04, then
//                    rise ≥ 1 → maintenance, rise < 1 → nonresponse, day 7 → nothing,
//                    and the start visit unchanged; both routes (Step 2.14 and Step 2.3)
//                    v15: one hemoglobin since the start, below target, and no baseline to
//                    measure a rise from → "recheck in 2–4 weeks" (Step 2.23 / 2.24), not
//                    nonresponse and nothing asked — including a value the provider types
//                    in at the visit, and a baseline older than 28 days before the start
//   on-iron          anemia v12: the medication list is read behind gate-microcytic.
//                    Oral iron on it (any of 310325 / 198630 / 284202 / 311975) → no
//                    DP-1, no DP-3, no oral-iron Medication node; "continue" guidance,
//                    the response check on its own gate copies (start date from a
//                    dated order, asked when undated), and a yes/no question for
//                    confirmatory iron studies. IV iron on it (with or without oral
//                    iron) → no DP, no iron Medication node, follow-up CBC. No iron →
//                    DP-1 exactly as before; MCV ≥ 80 never reads the list
//   ghtn-shared-labs gestational hypertension v2: BP, severity-panel and urine-protein
//                    labs split per host step — each follows its own step's gate
//   ghtn-seizure     gestational hypertension v5: Guid-5 "Seizure: call 911" sits on
//                    Step 2.1 (unconditional) — INCLUDED for outpatient, severe-
//                    feature, postpartum and non-hypertensive patients alike
//   uti-shared-labs  UTI in pregnancy v3: organism ID, susceptibility and test-of-cure
//                    culture labs split per host step — each follows its own step's
//                    gate; the one Step 1.1/2.1 culture (both unconditional) is
//                    listed once
//
//   prenatal-ga      routine prenatal care v4: the eight gestational-age gates — a 10-,
//                    20-, 28- and 36-week patient each get the stages due at that age and
//                    nothing from a later window; a missing gestational age is asked for
//                    once, by the stage gates and the "this pregnancy" gates alike
//   prenatal-triggers routine prenatal care v4: started only by a supervision-of-pregnancy
//                    or pregnant-state diagnosis on the encounter (Z34, O09, Z33.1, Z33.3) —
//                    not Z33.2, Z3A, or a pregnancy problem (O24.41x, O99.810, O99.01x, O13)
//   prenatal-gdm     routine prenatal care v4: gestational diabetes read from the chart —
//                    a diabetes code → no screening; nothing on file → the strategy asked
//                    once, the test ordered, NO result question, no blocker; a positive 50-g
//                    → the 100-g test ordered with no strategy and no result question; the
//                    four 100-g values settle it (every pair → diagnose, every single → not)
//                    with nothing asked; early HbA1c: nobody is asked for a value
//   prenatal-handoffs routine prenatal care v4: a low hemoglobin drawn THIS pregnancy → add
//                    the anemia diagnosis; a low one from before it → no hand-off, CBC
//                    ordered; BP 140/90 or higher → add the diagnosis; Rh(D) negative → add
//                    the diagnosis, positive → nothing, missing → asked once
//   prenatal-meds    routine prenatal care v4: folic acid or a known prenatal multivitamin
//                    on the medication list → nothing asked, nothing started; none → asked
//                    once, yes → not started; aspirin likewise; panel tests on file this
//                    pregnancy (by gestational age) are not re-ordered
//   prenatal-vaccines routine prenatal care v4: vaccines read from the medication list —
//                    Tdap given this pregnancy → not recommended, in a prior pregnancy →
//                    recommended; RSV ever → not offered; influenza / COVID-19 within 180
//                    days → not recommended; an undated entry reads as given
//
// The anemia proofs read pathways/json/anemia-in-pregnancy.json (override with
// ANEMIA_JSON=<path>); ghtn-* reads gestational-hypertension-preeclampsia.json
// (GHTN_JSON=<path>); uti-* reads uti-asymptomatic-bacteriuria-pregnancy.json
// (UTI_JSON=<path>). They replay a provider answer the way the live mutation
// does since the evaluation pipeline (main PRs #56–#61): the answer is added
// to the session's INPUTS and the whole pathway is evaluated again from them
// (pipeline/evaluate.ts). There is no incremental re-resolution any more, so
// a replayed answer and a pre-loaded one can no longer disagree — what the
// replay still proves is that each answer was actually being ASKED when given.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluateGate, GateEvaluationDeps } from '../../../../apps/pathway-service/src/services/resolution/gate-evaluator';
import { makeEvaluationTemporalContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/evaluation-context';
import { assembleContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../../../../apps/pathway-service/src/services/resolution/temporal/anchored-window';
import { derivedParent } from '../../../../apps/pathway-service/src/services/codes/icd10-hierarchy';
import { isPregnant } from '../../../../apps/pathway-service/src/services/resolution/pathway-applicability';
import { normalizePatientAttributes } from '../../../../apps/pathway-service/src/services/resolution/patient-attributes';
import { TraversalEngine } from '../../../../apps/pathway-service/src/services/resolution/traversal-engine';
import { readinessOf } from '../../../../apps/pathway-service/src/services/resolution/pipeline/readiness';
import { GateType, DefaultBehavior, ScoringType } from '../../../../apps/pathway-service/src/types';
import { declinedKeyFor } from '../../../../apps/pathway-service/src/services/resolution/types';
import type { GateAnswer, GateProperties } from '../../../../apps/pathway-service/src/services/resolution/types';
import type {
  GraphContext, GraphEdge, GraphNode, PatientContext, SignalDefinition, SignalScorer,
} from '../../../../apps/pathway-service/src/services/confidence/types';
import { DataCompletenessScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/data-completeness';
import { EvidenceStrengthScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/evidence-strength';
import { PatientMatchQualityScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/patient-match-quality';
import { RiskMagnitudeScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/risk-magnitude';

const AS_OF = '2026-09-24T12:00:00.000Z';
const ANEMIA = process.env.ANEMIA_JSON ?? 'pathways/json/anemia-in-pregnancy.json';
const GHTN = process.env.GHTN_JSON ?? 'pathways/json/gestational-hypertension-preeclampsia.json';
const UTI = process.env.UTI_JSON ?? 'pathways/json/uti-asymptomatic-bacteriuria-pregnancy.json';
const PRENATAL = process.env.PRENATAL_JSON ?? 'pathways/json/routine-prenatal-care.json';
const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 }; // migration 039 system defaults
/** DP-1's empiric branch (criterion 1a): Stage 1.5, holding Steps 2.1–2.3 (was step-2-1 through v3). */
const EMPIRIC = 'stage-2-empiric';
/** DP-1's branch targets, sorted — the option ids its pending question offers. */
const DP1_OPTIONS = [EMPIRIC, 'step-1-2'].sort();
/** DP-3's branches (v7): the oral-iron trial (Stage 2.5) and IV iron without an oral trial. */
const ORAL_TRIAL = 'stage-2-oral';
const IV_FIRST = 'step-2-9';
const DP3_OPTIONS = [ORAL_TRIAL, IV_FIRST].sort();
/** The confirmed arm, as the provider gives it: workup at DP-1, then the oral trial at DP-3. */
const WORKUP: Replay = { dp: 'dp-1', option: 'step-1-2' };
const ORAL: Replay = { dp: 'dp-3', option: ORAL_TRIAL };
/** v8: the empiric arm reaches DP-3 too, so its oral iron is chosen there as well. */
const EMPIRIC_CHOICE: Replay = { dp: 'dp-1', option: EMPIRIC };
/**
 * v14 [DECISION — Josh 2026-10-04]: the two anchored COUNT gates on Step 2.3 —
 * no hemoglobin since oral iron started (→ Step 2.21, the recheck orders) and
 * one on file (→ Step 2.22, which hosts gate-hgb-response / -nonresponse). They
 * carry the NOT YET DUE verdict now; the response gates sit behind the second.
 */
const DUE_GATES = ['gate-response-recheck-due', 'gate-rechecked'];
/** Step 2.21 and what it orders (the Step 2.3 route's response recheck). */
const RECHECK = ['step-2-21', 'lab-29', 'lab-30', 'lab-31', 'guid-10'];
/** The same pair and step on the already-on-oral-iron route (Step 2.14). */
const DUE_GATES_ON_IRON = ['gate-response-recheck-due-on-iron', 'gate-rechecked-on-iron'];
const RECHECK_ON_IRON = ['step-2-19', 'lab-26', 'lab-27', 'lab-28', 'guid-9'];
/**
 * v15 [DECISION — Josh 2026-10-04]: one hemoglobin since the start, below target,
 * and no baseline to measure a rise from is "recheck in 2–4 weeks, not
 * nonresponse". The gate and the step it opens (CBC, guidance, schedule), per route.
 */
const UNMEASURABLE = ['gate-rise-unmeasurable', 'step-2-24', 'lab-33', 'guid-12', 'sched-11'];
const UNMEASURABLE_ON_IRON = ['gate-rise-unmeasurable-on-iron', 'step-2-23', 'lab-32', 'guid-11', 'sched-10'];

// ── Proof: attribute-form vs coded-form lab gates ─────────────────────
async function proveAttributeForm(): Promise<void> {
  console.log('\n=== attribute-form: MCV < 80 authored three ways, simulator-style labs ===');
  // What the simulator's PatientComposer actually sends: labs keyed by LOINC.
  const patient = {
    conditionCodes: [{ code: 'O99.011', system: 'ICD-10' }],
    medications: [], allergies: [],
    labResults: [
      { code: '787-2', system: 'LOINC', value: 72, unit: 'fL', date: '2026-08-10' },   // MCV 72 — microcytic
      { code: '2276-4', system: 'LOINC', value: 12, unit: 'ng/mL', date: '2026-08-10' }, // ferritin 12 — IDA
    ],
  } as unknown as PatientContext;
  // v1 (the deployment default) reads labs from the fact store, so it must be
  // assembled from the patient exactly as a session does — an empty store is a
  // patient with no labs, and every form reads "no value".
  const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: '2026-08-16T00:00:00.000Z' });
  const factStore = assembleContext({ mode: 'SYNTHETIC', patientContext: patient } as never, temporalContext);
  const deps = (codeMap: Map<string, any>): GateEvaluationDeps => ({
    temporalContext, pathwayDefaults: {}, factStore, codeMap,
    patientContext: patient,
    resolutionState: new Map(), gateAnswers: new Map(),
  } as GateEvaluationDeps);
  const attributeForm: GateProperties = {
    title: 'MCV < 80 (attribute form)',
    gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
    condition: { attribute: 'lab.mcv', operator: 'less_than', value: 80, unit: 'fL', horizon: { days: 90 } } as any,
  };
  const codedForm: GateProperties = {
    title: 'MCV < 80 (coded form)',
    gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'less_than', value: '787-2', system: 'LOINC', threshold: 80, horizon: { days: 90 } } as any,
  };
  const emptyMap = new Map();          // = deployment with unseeded pathway_attribute_code_map
  const seededMap = new Map([['lab.mcv', { attributeName: 'lab.mcv', namespace: 'lab', system: 'LOINC', code: '787-2', valueType: 'number' }]]);
  for (const [label, gate, map, want] of [
    ['attribute-form, code map UNSEEDED (today)', attributeForm, emptyMap, 'false'],
    ['attribute-form, code map seeded        ', attributeForm, seededMap, 'true'],
    ['coded-form, no code map needed         ', codedForm, emptyMap, 'true'],
  ] as const) {
    const r = await evaluateGate(gate, deps(map as Map<string, any>));
    expect(`${label} satisfied (${r.reason})`, String(r.satisfied), want);
  }
}

// ── Pathway JSON → in-memory graph (what the importer stores, minus the DB) ──
function graphFrom(file: string, reverse = false): GraphContext {
  const pw = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const nodes: GraphNode[] = [
    { id: 'root', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: pw.pathway.title } },
    ...pw.nodes.map((n: any) => ({
      id: n.id, nodeIdentifier: n.id, nodeType: n.type, properties: { title: n.id, ...n.properties },
    })),
  ];
  // The live graph returns edges in storage order, not file order. Every
  // traversal proof runs in both orders so a result cannot hinge on it.
  let edges: GraphEdge[] = pw.edges.map((e: any, i: number) => ({
    id: `e${i}`, edgeType: e.type, sourceId: e.from, targetId: e.to, properties: e.properties ?? {},
  }));
  if (reverse) edges = [...edges].reverse();
  const byId = new Map(nodes.map((n) => [n.nodeIdentifier, n]));
  const out = new Map<string, GraphEdge[]>(nodes.map((n) => [n.nodeIdentifier, []]));
  for (const e of edges) out.get(e.sourceId)?.push(e);
  return {
    allNodes: nodes, allEdges: edges,
    incomingEdges: (id: string) => edges.filter((e) => e.targetId === id),
    outgoingEdges: (id: string) => out.get(id) ?? [],
    getNode: (id: string) => byId.get(id),
    linkedNodes: (id: string, t: string) => (out.get(id) ?? []).filter((e) => e.edgeType === t)
      .map((e) => byId.get(e.targetId)).filter((n): n is GraphNode => n !== undefined),
  } as GraphContext;
}

/** A lab result: `[LOINC, value]` (undated, as the simulator sends it) or `[LOINC, value, 'YYYY-MM-DD']`. */
type Lab = [string, number] | [string, number, string];

function patientWith(
  labs: Lab[], attrs: Record<string, number> = {}, extraCodes: string[] = [],
  /** RxNorm medication orders, `[code, 'YYYY-MM-DD' start]`, or `[code]` undated (as the simulator sends it). */
  meds: Array<[string, string] | [string]> = [],
): PatientContext {
  return {
    patientId: 'proof',
    conditionCodes: ['O99.012', ...extraCodes].map((code) => ({ code, system: 'ICD-10' })),
    medications: meds.map(([code, startDate]) => ({ code, system: 'RXNORM', ...(startDate ? { date: startDate } : {}) })),
    allergies: [], vitalSigns: {},
    // As the resolvers do: trimester is derived from gestational age when only GA is given.
    patientAttributes: normalizePatientAttributes(attrs) ?? {},
    labResults: labs.map(([code, value, date]) => ({ code, system: 'LOINC', value, ...(date ? { date } : {}) })),
  } as unknown as PatientContext;
}

/** A patient for the non-anemia pathways: no anemia code, and a vitals bag. */
function patientOf(opts: {
  /** ICD-10 codes, undated, or `{ code, date }` for occurrence counts. */
  codes?: Array<string | { code: string; date: string }>;
  labs?: Array<[string, number]>; vitals?: Record<string, number>;
}): PatientContext {
  return {
    patientId: 'proof',
    conditionCodes: (opts.codes ?? []).map((c) => ({ ...(typeof c === 'string' ? { code: c } : c), system: 'ICD-10' })),
    medications: [], allergies: [], vitalSigns: opts.vitals ?? {}, patientAttributes: {},
    labResults: (opts.labs ?? []).map(([code, value]) => ({ code, system: 'LOINC', value })),
  } as unknown as PatientContext;
}
const YES = { booleanValue: true } as GateAnswer;
const NO = { booleanValue: false } as GateAnswer;
/** Expect every id in `ids` to hold `want`. */
function expectAll(label: string, state: Map<string, { status: string }>, ids: string[], want: string): void {
  for (const id of ids) expect(`${id} ${label}`, status(state, id), want);
}

/**
 * Stub scorer: `conf(nodeId)` is the confidence the engine sees for that node.
 * `asOf` pins the session clock (default AS_OF). `oralIronStart` (YYYY-MM-DD)
 * is a stored care plan of THIS pathway that recommended oral iron on that
 * day — what a start visit's committed plan gives every later visit (the
 * resolver reads it at session start and pins it with withTherapyStarts).
 */
function engineFor(
  patient: PatientContext, conf: (id: string) => number,
  opts: { asOf?: string; oralIronStart?: string } = {},
): TraversalEngine {
  let tc = makeEvaluationTemporalContext({ evaluationAsOf: opts.asOf ?? AS_OF, temporalPolicyVersion: 'v1' });
  if (opts.oralIronStart) {
    tc = withTherapyStarts(tc, [{
      clinicalRole: 'oral-iron-repletion', date: opts.oralIronStart,
      source: { carePlanId: 'cp-proof', interventionId: 'i-proof', pathwayId: 'anemia-in-pregnancy', nodeId: 'med-1' },
    }]);
  }
  const facts = assembleContext({ mode: 'SYNTHETIC', patientContext: patient } as never, tc);
  return new TraversalEngine(
    {
      computeNodeConfidence: async (node: GraphNode) => ({
        confidence: conf(node.nodeIdentifier), breakdown: [], resolutionType: 'AUTO_RESOLVED',
      }),
    } as never,
    THRESHOLDS, tc, {}, facts, new Map(),
  );
}

/** A provider answer, replayed in order after the first traversal. */
type Replay =
  | { dp: string; option: string }            // answerPendingDecision (a DecisionPoint branch)
  | { gate: string; answer: GateAnswer }      // answerGateQuestion (a question gate)
  | { anchor: string; answer: GateAnswer }    // a window_from start date (DATE), keyed on the anchor
  | { decline: string };                      // "Not available" for a datum (datumKey), e.g. 'LOINC:718-7'

/**
 * What blocks care-plan generation from this state — the pipeline's one
 * readiness rule set (pipeline/readiness.ts), as a standalone session's ROOT
 * evaluation applies it. Safety data is out of scope for a no-DB proof.
 */
function validateForGeneration(state: unknown, redFlags: unknown) {
  return readinessOf({
    state: state as never, pendingQuestions: [], redFlags: redFlags as never,
    unavailable: [], scope: 'ROOT', isDegraded: false,
  }).blockers;
}

/**
 * Traverse; then give each answer the way the live app does — one at a time,
 * and only once it is actually being asked. Every answer (a DecisionPoint
 * choice, a question-gate answer, a window_from start date) is added to the
 * session's inputs and the pathway is evaluated again from scratch, as
 * `commitEvaluation` does (resolvers/mutations/resolution.ts → pipeline).
 * `choose` is shorthand for a single leading DecisionPoint choice. `replay`
 * is given in order, and each step must be pending when it is given. `ask` is
 * given AS ASKED — whichever listed question is pending next, until none is —
 * and every entry must have been asked by the end, so list only what the
 * scenario actually reaches. Nothing is pre-loaded into the first traversal:
 * that is not a path the app has.
 */
async function resolveSession(opts: {
  file: string; reverse: boolean; patient: PatientContext;
  conf?: (id: string) => number; choose?: { dp: string; option: string };
  replay?: Replay[]; ask?: Replay[];
  asOf?: string; oralIronStart?: string;
}) {
  const graph = graphFrom(opts.file, opts.reverse);
  const engine = engineFor(opts.patient, opts.conf ?? (() => 0.9), { asOf: opts.asOf, oralIronStart: opts.oralIronStart });
  const answers = new Map<string, GateAnswer>();
  let r = await engine.traverse(graph, opts.patient, answers);
  let pending = r.pendingQuestions;
  let redFlags = r.redFlags;
  const idOf = (step: Replay) =>
    'dp' in step ? step.dp : 'gate' in step ? step.gate : 'anchor' in step ? step.anchor : step.decline;
  // Exposed for `supplyLab`, which continues this session the way addPatientContext does.
  const session = { graph, answers };
  const asked = (id: string) =>
    pending.some((q: any) => q.gateId === id || (q.askedByNodeIds ?? []).includes(id) || q.datumKey === id);
  const give = async (step: Replay) => {
    const nodeId = idOf(step);
    // A decline is stored against the DATUM (types.ts `declinedKeyFor`), as the resolver does.
    if ('decline' in step) answers.set(declinedKeyFor(step.decline), { notAvailable: true } as GateAnswer);
    else answers.set(nodeId, 'dp' in step ? ({ selectedOption: step.option } as GateAnswer) : step.answer);
    // A fresh engine each time: the pipeline builds one per evaluation.
    r = await engineFor(opts.patient, opts.conf ?? (() => 0.9), { asOf: opts.asOf, oralIronStart: opts.oralIronStart })
      .traverse(graph, opts.patient, answers);
    pending = r.pendingQuestions;
    redFlags = r.redFlags;
  };
  for (const step of [...(opts.choose ? [opts.choose] : []), ...(opts.replay ?? [])]) {
    // Asked now, or answered before (a re-answer, e.g. at the recheck visit).
    if (!asked(idOf(step)) && !answers.has(idOf(step))) {
      expect(`${idOf(step)} is being asked when answered`, 'no', 'yes');
    }
    await give(step);
  }
  const toAsk = [...(opts.ask ?? [])];
  for (;;) {
    const i = toAsk.findIndex((step) => asked(idOf(step)));
    if (i === -1) break;
    await give(toAsk.splice(i, 1)[0]);
  }
  for (const step of toAsk) expect(`${idOf(step)} was asked`, 'no', 'yes');
  return { state: r.resolutionState, pending, redFlags, session, gateContextFields: r.dependencyMap?.gateContextFields };
}

/**
 * The provider supplies a lab mid-session — the answer to an escalated lab
 * question — continued exactly as `addPatientContext` does it
 * (resolvers/mutations/resolution.ts): the value becomes a DATED fact at the
 * session clock (providerAsserted), added to the session's facts, and the
 * whole pathway is evaluated again over the enlarged fact store — so every
 * gate reading that lab sees it, not only the gate that asked. The
 * gate-answer replay in `resolveSession` cannot represent this: a lab answer
 * is a fact, not a gate answer. `affected` is every gate the first evaluation
 * recorded as reading labs, for proofs that assert who else re-decides.
 */
async function supplyLab(
  run: Awaited<ReturnType<typeof resolveSession>>, patient: PatientContext,
  lab: { code: string; value: number }, asOf: string = AS_OF,
) {
  const patient2 = {
    ...patient,
    labResults: [...((patient as any).labResults ?? []),
      { code: lab.code, system: 'LOINC', value: lab.value, date: asOf, providerAsserted: true }],
  } as unknown as PatientContext;
  const affected = new Set<string>();
  for (const [gateId, fields] of run.gateContextFields ?? []) {
    if ([...fields].some((f) => f === 'labs' || f.startsWith('labs.') || f.startsWith('lab.'))) affected.add(gateId);
  }
  const rr = await engineFor(patient2, () => 0.9, { asOf })
    .traverse(run.session.graph, patient2, run.session.answers);
  return { state: rr.resolutionState, pending: rr.pendingQuestions, redFlags: rr.redFlags, affected, patient: patient2 };
}

const status = (s: Map<string, { status: string }>, id: string) => s.get(id)?.status ?? '(absent)';
let failures = 0;
function expect(label: string, got: string, want: string | string[]): void {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  if (!ok) failures++;
  console.log(`    ${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : `  (expected ${[want].flat().join(' | ')})`}`);
}

// ── Proof: anemia DP-1 — ferritin 50 no longer gets oral iron automatically ──
async function proveDp1(): Promise<void> {
  console.log(`\n=== dp-1: anemia DP-1 "empiric iron vs confirmatory studies first" (${ANEMIA}) ===`);
  const MCV72_FER50: Array<[string, number]> = [['787-2', 72], ['2276-4', 50], ['718-7', 9.5]];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    console.log('  ferritin 50, no branch chosen yet (both branches score 0.9):');
    let r = await resolveSession({ ...base, patient: patientWith(MCV72_FER50) });
    expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'PENDING_QUESTION');
    expect('med-1 ferrous sulfate', status(r.state, 'med-1'), 'PENDING_QUESTION');
    const q = r.pending.find((p: any) => p.gateId === 'dp-1') as any;
    expect('dp-1 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP1_OPTIONS));

    console.log('  ferritin 50, provider chooses the workup (criterion 1b):');
    r = await resolveSession({ ...base, patient: patientWith(MCV72_FER50), choose: { dp: 'dp-1', option: 'step-1-2' } });
    expect('step-1-2 workup', status(r.state, 'step-1-2'), 'INCLUDED');
    expect(`${EMPIRIC} (unchosen branch)`, status(r.state, EMPIRIC), 'EXCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'GATED_OUT');
    // The shared steps are the GATE's to decide, not the unchosen branch's:
    // GATED_OUT (gate-ida-confirmed), never EXCLUDED (the Stage 1.5 sweep).
    for (const id of ['step-2-1', 'step-2-2', 'step-2-3', 'step-2-5', 'med-1']) {
      expect(id, status(r.state, id), 'GATED_OUT');
    }

    console.log('  ferritin 12, provider chooses the workup, then the oral trial at DP-3 (v7):');
    r = await resolveSession({
      ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]]),
      choose: WORKUP, replay: [ORAL],
    });
    expect(`${EMPIRIC} (unchosen branch)`, status(r.state, EMPIRIC), 'EXCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'INCLUDED');
    for (const id of ['step-2-1', 'step-2-2', 'step-2-3']) expect(id, status(r.state, id), 'INCLUDED');
    // v7: Stage 2 holds Step 2.8 (DP-3); the oral steps sit under DP-3's oral branch.
    expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), ORAL_TRIAL);

    // The empiric branch (criterion 1a) is proved in `empiric`.

    // (v3 proved "MCV 90 + workup → Step 1.2 included". Since v4, MCV 90 never
    // reaches DP-1 — gate-microcytic closes it — so that answer cannot be given;
    // replaying it here would re-open a fork the live path never offers. See `mcv`.)

    console.log('  COUNTERFACTUAL — scoring puts step-1-2 below the 0.60 suggest threshold:');
    r = await resolveSession({
      ...base, patient: patientWith(MCV72_FER50), conf: (id) => (id === 'step-1-2' ? 0.5 : 0.9),
    });
    expect('dp-1 auto-selects', status(r.state, 'dp-1'), 'INCLUDED');
    expect(`${EMPIRIC} (automatic again)`, status(r.state, EMPIRIC), 'INCLUDED');
    // v8: the empiric arm reaches DP-3, so oral iron still waits for the route choice.
    expect('step-2-8 route choice (automatic again)', status(r.state, 'step-2-8'), 'INCLUDED');
    expect('dp-3 asks the route', status(r.state, 'dp-3'), 'PENDING_QUESTION');
    expect('step-2-1 oral iron (waits for DP-3)', status(r.state, 'step-2-1'), 'PENDING_QUESTION');
  }
}

// ── Proof: the empiric arm gets the confirmed arm's follow-up ─────────
// [DECISION — Josh 2026-09-24] Through v3, choosing empiric oral iron at DP-1
// reached Step 2.1 only. v4–v7: DP-1's empiric branch is Stage 1.5
// (`stage-2-empiric`), which held the SAME Steps 2.1–2.3 as Stage 2. v8: Stage
// 1.5 holds Step 2.8 — DP-3, the oral-trial / IV-first route choice — so the
// empiric arm chooses its route exactly as confirmed IDA does, and its oral
// trial (Stage 2.5, Steps 2.1–2.3) brings the same Hgb recheck, response gates
// and DP-2 → gate-iv-iron-ga → IV iron. Shared, not copied: DP-1 is one_of, so
// only one of Stage 1.5 / Stage 2 is ever open, and the engine spares a chosen
// branch's contents from the sweep that excludes the other (containmentClosure)
// — checked here in both orders.
async function proveEmpiric(): Promise<void> {
  console.log(`\n=== empiric: DP-1 empiric arm → DP-3 → the same response check (${ANEMIA}) ===`);
  const labs = (ferritin: number | null, hgb: number | null): Array<[string, number]> => [
    ['787-2', 72],
    ...(ferritin === null ? [] : [['2276-4', ferritin] as [string, number]]),
    ...(hgb === null ? [] : [['718-7', hgb] as [string, number]]),
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    console.log('  ferritin 50, Hgb 9.5, GA 20 — empiric chosen, route not chosen yet: DP-3 asks (v8):');
    let r = await resolveSession({ ...base, patient: patientWith(labs(50, 9.5), { gestational_age_weeks: 20 }), replay: [EMPIRIC_CHOICE] });
    expect(EMPIRIC, status(r.state, EMPIRIC), 'INCLUDED');
    expect('step-2-8 route choice', status(r.state, 'step-2-8'), 'INCLUDED');
    expect('dp-3', status(r.state, 'dp-3'), 'PENDING_QUESTION');
    const q = r.pending.find((p: any) => p.gateId === 'dp-3') as any;
    expect('dp-3 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP3_OPTIONS));
    for (const id of ['step-2-1', 'med-1', IV_FIRST]) expect(id, status(r.state, id), 'PENDING_QUESTION');
    expect('stage-2 (unchosen DP-1 branch)', status(r.state, 'stage-2'), 'EXCLUDED');

    // The empiric arm reaches Step 2.3 and its response check; this visit starts
    // oral iron, so the check is NOT YET DUE and asks nothing (v7). What it
    // decides at the recheck is proved per arm in `response`.
    console.log('  ferritin 50, Hgb 9.5, GA 20 — empiric chosen, then the oral trial at DP-3:');
    r = await resolveSession({ ...base, patient: patientWith(labs(50, 9.5), { gestational_age_weeks: 20 }), replay: [EMPIRIC_CHOICE, ORAL] });
    expect(EMPIRIC, status(r.state, EMPIRIC), 'INCLUDED');
    expect('step-1-2 workup (unchosen)', status(r.state, 'step-1-2'), 'EXCLUDED');
    expect('gate-ida-confirmed (not evaluated)', status(r.state, 'gate-ida-confirmed'), 'EXCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'EXCLUDED');
    for (const id of [ORAL_TRIAL, 'step-2-1', 'med-1', 'step-2-2', 'step-2-3', 'lab-10', 'sched-2', 'qm-1']) {
      expect(id, status(r.state, id), 'INCLUDED');
    }
    expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), ORAL_TRIAL);
    for (const g of DUE_GATES) expect(`${g} (not yet due)`, String(r.state.get(g)?.notYetDue === true), 'true');
    expectAll('(behind the count gates, v14)', r.state, [...RECHECK, 'step-2-22', 'gate-hgb-response', 'gate-hgb-nonresponse'], 'GATED_OUT');
    expect('no response question', String(r.pending.some((p: any) =>
      [...DUE_GATES, 'gate-hgb-response', 'gate-hgb-nonresponse'].includes(p.gateId)
      || (p.askedByNodeIds ?? []).some((id: string) => id.startsWith('gate-hgb-') || DUE_GATES.includes(id)))), 'false');
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');

    console.log('  ferritin never drawn — empiric needs none:');
    r = await resolveSession({ ...base, patient: patientWith(labs(null, 9.5), { gestational_age_weeks: 20 }), replay: [EMPIRIC_CHOICE, ORAL] });
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');
    expect('step-2-3 response assessment', status(r.state, 'step-2-3'), 'INCLUDED');
    for (const g of DUE_GATES) expect(`${g} (not yet due)`, String(r.state.get(g)?.notYetDue === true), 'true');
  }
}

// ── Proof: the oral-iron response check reads chart data (v7) ─────────
// [DECISION — Josh 2026-09-24] Two single-target compound gates on Step 2.3,
// the leaf-wise De Morgan complements of each other:
//   gate-hgb-response    = OR(Δ ≥ 1 g/dL since oral iron started,
//                             OR(Hgb ≥ 11, AND(trimester 2, Hgb ≥ 10.5)))  → Step 2.4
//   gate-hgb-nonresponse = AND(Δ < 1, AND(Hgb < 11, OR(trimester ≠ 2, Hgb < 10.5)))
//                                                                           → Step 2.6 (DP-2)
// Δ is `delta_from_baseline` anchored by `window_from` on the oral-iron class
// (baseline_days 28, min_days_since_anchor 14). Replaces v5/v6's SELECT
// question router and its Step 2.7 ("recheck not yet done"): the start visit
// closes both gates NOT_YET_DUE and asks nothing, so it can finish.
// Clock: oral iron starts 2026-06-01 (DAY0); due on 2026-06-15. Later visits
// read the start from the care plan the start visit committed (oralIronStart).
const DAY0 = '2026-06-01T15:00:00.000Z';
const DAY5 = '2026-06-06T15:00:00.000Z';
const DAY21 = '2026-06-22T15:00:00.000Z';
const IRON_START = '2026-06-01';
const BASELINE_DATE = '2026-05-29';
const RECHECK_DATE = '2026-06-20';
/** The oral-iron anchor's question key (anchored-window.ts anchorKeyFor): one DATE question per class. */
const ORAL_IRON_ANCHOR = 'anchor:medication_start:oral-iron-repletion';
async function proveResponse(): Promise<void> {
  console.log(`\n=== response: oral-iron response check on chart data (${ANEMIA}) ===`);
  const RESPONSE_GATES = ['gate-hgb-response', 'gate-hgb-nonresponse'];
  const RESPONSE_GATES_SORTED = [...RESPONSE_GATES].sort();
  const ESCALATION = ['step-2-6', 'dp-2', 'step-1-5', 'lab-8', 'lab-14', 'step-2-5', 'med-4', 'med-5', 'med-6', 'med-7'];
  const IV = ['step-2-5', 'med-4', 'med-5', 'med-6', 'med-7', 'sched-3'];
  const REGION = [...DUE_GATES, ...RECHECK, ...UNMEASURABLE, 'step-2-22', ...RESPONSE_GATES, 'step-2-4', ...ESCALATION, 'gate-iv-iron-ga'];
  /** Care-plan blockers that point into the response region (Stage 3 questions etc. excluded). */
  const regionBlockers = (r: { state: any; redFlags: any[] }) => String(
    validateForGeneration(r.state, r.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => REGION.includes(id))).length,
  );
  const regionQuestions = (pending: any[]) => pending.filter((p) =>
    [...DUE_GATES, 'gate-rise-unmeasurable', ...RESPONSE_GATES].includes(p.gateId)
    || (p.askedByNodeIds ?? []).some((id: string) => [...DUE_GATES, 'gate-rise-unmeasurable', ...RESPONSE_GATES].includes(id)));
  const arms: Array<[string, Lab[], Replay[]]> = [
    ['empiric arm (ferritin never drawn; oral trial at DP-3, v8)', [['787-2', 72]], [EMPIRIC_CHOICE, ORAL]],
    ['confirmed arm (workup, ferritin 12, oral trial at DP-3)', [['787-2', 72], ['2276-4', 12]], [WORKUP, ORAL]],
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    for (const [arm, base, choice] of arms) {
      console.log(`  ${arm}:`);
      /** One visit. `hgb`: [value, date] pairs; `start`: the stored oral-iron start (absent at the start visit). */
      const visit = (o: {
        asOf: string; hgb: Array<[number, string]>; attrs?: Record<string, number>; start?: string;
        meds?: Array<[string, string]>; ask?: Replay[];
      }) => resolveSession({
        file: ANEMIA, reverse, replay: choice, asOf: o.asOf, oralIronStart: o.start, ask: o.ask,
        patient: patientWith([...base, ...o.hgb.map(([v, date]) => ['718-7', v, date] as Lab)], o.attrs ?? {}, [], o.meds ?? []),
      });
      // v14: NOT YET DUE is the verdict of the two count gates on Step 2.3. The
      // response gates sit behind gate-rechecked, so they are not evaluated at
      // all (closed with it, not "not yet due" themselves), and Step 2.21's
      // recheck orders stay closed too.
      const notYetDue = (r: { state: any }) => {
        for (const g of DUE_GATES) {
          const n = r.state.get(g);
          expect(`${g}`, status(r.state, g), 'GATED_OUT');
          expect(`${g} not yet due`, String(n?.notYetDue === true), 'true');
          expect(`${g} reason`, String(n?.excludeReason ?? '').slice(0, 36), 'NOT_YET_DUE: due on/after 2026-06-15');
        }
        expectAll('(behind the count gates)', r.state, [...RECHECK, ...UNMEASURABLE, 'step-2-22', ...RESPONSE_GATES], 'GATED_OUT');
        for (const g of RESPONSE_GATES) expect(`${g} itself not evaluated`, String(r.state.get(g)?.notYetDue === true), 'false');
      };

      console.log('    start visit (oral iron recommended this session), Hgb 9.5, GA 20 — NOT YET DUE, nothing asked:');
      let r = await visit({ asOf: DAY0, hgb: [[9.5, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('step-2-3 response assessment (recheck carries the plan)', status(r.state, 'step-2-3'), 'INCLUDED');
      expect('lab-10 Hgb recheck', status(r.state, 'lab-10'), 'INCLUDED');
      expect('med-1 ferrous sulfate', status(r.state, 'med-1'), 'INCLUDED');
      notYetDue(r);
      expect('anchor source', String(r.state.get('gate-rechecked')?.windowAnchors?.[0]?.source), 'SESSION_RECOMMENDATION');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'GATED_OUT');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    start visit, Hgb 10.7, trimester unknown — still NOT YET DUE, trimester not asked:');
      r = await visit({ asOf: DAY0, hgb: [[10.7, BASELINE_DATE]] });
      notYetDue(r);
      expect('trimester question', String(r.pending.some((p: any) => p.datumKey === 'patient.trimester')), 'false');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      // [DECISION — Josh 2026-09-24] "At target at once" — kept in v14. gate-rechecked
      // is OR(a hemoglobin since the start, at target): a definite "at target" settles
      // the OR while the count arm is NOT YET DUE, so Step 2.22 opens and
      // gate-hgb-response opens maintenance, the start visit included.
      console.log('    start visit, Hgb 11.2 (already at target) — maintenance opens at once (accepted):');
      r = await visit({ asOf: DAY0, hgb: [[11.2, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      expectAll('(at target settles the OR)', r.state, ['gate-rechecked', 'step-2-22'], 'INCLUDED');
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('gate-hgb-nonresponse (definite no, not "not yet due")', status(r.state, 'gate-hgb-nonresponse'), 'GATED_OUT');
      expect('gate-hgb-nonresponse notYetDue', String(r.state.get('gate-hgb-nonresponse')?.notYetDue === true), 'false');
      expectAll('(no recheck orders: not yet due)', r.state, ['gate-response-recheck-due', ...RECHECK], 'GATED_OUT');
      expect('gate-response-recheck-due not yet due', String(r.state.get('gate-response-recheck-due')?.notYetDue === true), 'true');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      console.log('    day 5 recheck, +0.3 (anchored on the start visit\'s care plan) — NOT YET DUE:');
      r = await visit({ asOf: DAY5, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.8, '2026-06-05']], attrs: { gestational_age_weeks: 20 } });
      notYetDue(r);
      expect('anchor source', String(r.state.get('gate-rechecked')?.windowAnchors?.[0]?.source), 'CARE_PLAN');
      expect('step-2-6 nonresponse (a day-5 +0.3 does not escalate)', status(r.state, 'step-2-6'), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      console.log('    day 21, 9.5 → 10.7 (+1.2) — responder: maintenance, nothing escalates:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [10.7, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      expectAll('(a hemoglobin since the start is on file: Step 2.22 assesses it)', r.state, ['gate-rechecked', 'step-2-22'], 'INCLUDED');
      expect('step-2-22 sits under', String(r.state.get('step-2-22')?.parentNodeId), 'gate-rechecked');
      expectAll('(no recheck orders: it has been rechecked)', r.state, ['gate-response-recheck-due', ...RECHECK], 'GATED_OUT');
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('gate-hgb-nonresponse', status(r.state, 'gate-hgb-nonresponse'), 'GATED_OUT');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    day 21, 9.5 → 9.9 (+0.4, below target), GA 20 — nonresponder: expanded workup + IV iron:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      expectAll('(Step 2.22 assesses it)', r.state, ['gate-rechecked', 'step-2-22'], 'INCLUDED');
      expectAll('(no recheck orders)', r.state, ['gate-response-recheck-due', ...RECHECK], 'GATED_OUT');
      expect('gate-hgb-nonresponse', status(r.state, 'gate-hgb-nonresponse'), 'INCLUDED');
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'GATED_OUT');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'GATED_OUT');
      for (const id of ['dp-2', 'step-1-5', 'lab-8', 'lab-14', 'gate-iv-iron-ga', ...IV, 'step-2-6']) {
        expect(id, status(r.state, id), 'INCLUDED');
      }
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      console.log('    day 21, +0.4, GA 12 — nonresponder: expanded workup, IV iron gated out:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 12 } });
      for (const id of ['step-2-6', 'dp-2', 'step-1-5']) expect(id, status(r.state, id), 'INCLUDED');
      expect('gate-iv-iron-ga', status(r.state, 'gate-iv-iron-ga'), 'GATED_OUT');
      for (const id of IV) expect(id, status(r.state, id), 'GATED_OUT');

      console.log('    day 21, +0.4, GA missing — nonresponse decided without trimester (Hgb < 10.5); IV iron asks GA:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]] });
      expect('gate-hgb-nonresponse', status(r.state, 'gate-hgb-nonresponse'), 'INCLUDED');
      expect('trimester question', String(r.pending.some((p: any) => p.datumKey === 'patient.trimester')), 'false');
      expect('gate-iv-iron-ga', status(r.state, 'gate-iv-iron-ga'), 'PENDING_QUESTION');
      expect('asks for datum', String((r.pending.find((p: any) => p.gateId === 'gate-iv-iron-ga') as any)?.datumKey),
        'patient.gestational_age_weeks');

      console.log('    day 21, 10.0 → 10.6 (+0.6), trimester unknown — the one band where the trimester decides: asks it once:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[10.0, BASELINE_DATE], [10.6, RECHECK_DATE]] });
      const tq = r.pending.filter((p: any) => p.datumKey === 'patient.trimester') as any[];
      expect('trimester questions', String(tq.length), '1');
      expect('asked by both response gates', JSON.stringify([...(tq[0]?.askedByNodeIds ?? [])].sort()), JSON.stringify(RESPONSE_GATES_SORTED));
      for (const g of RESPONSE_GATES) expect(g, status(r.state, g), 'PENDING_QUESTION');
      for (const id of ['step-2-4', 'step-2-6']) expect(id, status(r.state, id), 'PENDING_QUESTION');
      for (const [ga, open, closed] of [[20, 'step-2-4', 'step-2-6'], [30, 'step-2-6', 'step-2-4']] as const) {
        console.log(`      same Hgb, GA ${ga} (trimester ${ga < 28 ? 2 : 3}):`);
        r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[10.0, BASELINE_DATE], [10.6, RECHECK_DATE]], attrs: { gestational_age_weeks: ga } });
        expect(`${open}`, status(r.state, open), 'INCLUDED');
        expect(`${closed}`, status(r.state, closed), 'GATED_OUT');
      }

      console.log('    day 21, 10.8 → 11.3 (+0.5), trimester unknown — at target in every trimester: not asked:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[10.8, BASELINE_DATE], [11.3, RECHECK_DATE]] });
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('step-2-6 nonresponse', status(r.state, 'step-2-6'), 'GATED_OUT');
      expect('trimester question', String(r.pending.some((p: any) => p.datumKey === 'patient.trimester')), 'false');

      // Where the start date comes from at a recheck. Oral iron (Step 2.1) is
      // always recommended alongside the response check, so with no stored care
      // plan, no dated order and no clinician date the anchor falls to THIS
      // session and the check never comes due — the documented cost of that
      // source ranking. A dated order anchors it.
      // v12: a ferrous sulfate order on the chart is "already on oral iron" — DP-1 and
      // DP-3 are not asked (so this arm's choices cannot be replayed), and the same
      // response check runs on Step 2.14's copies of the gates. The order still
      // anchors it; the non-responder still escalates. Full proof: `on-iron`.
      console.log('    day 21, +0.4, NO stored care plan, dated ferrous sulfate order 2026-06-01 — anchored on the order (v12: on Step 2.14\'s gate copies):');
      r = await resolveSession({
        file: ANEMIA, reverse, asOf: DAY21,
        ask: [{ gate: 'gate-confirm-studies-on-iron', answer: NO }],
        patient: patientWith([...base, ['718-7', 9.5, BASELINE_DATE], ['718-7', 9.9, RECHECK_DATE]],
          { gestational_age_weeks: 20 }, [], [['310325', IRON_START]]),
      });
      expect('dp-1 / dp-3 asked', String(r.pending.some((p: any) => ['dp-1', 'dp-3'].includes(p.gateId))), 'false');
      expect('anchor source', String(r.state.get('gate-hgb-nonresponse-on-iron')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
      expect('step-2-16 nonresponse (already on oral iron)', status(r.state, 'step-2-16'), 'INCLUDED');
      expect('step-2-6 nonresponse (the DP-3 oral trial\'s — not reached)', status(r.state, 'step-2-6'), 'GATED_OUT');
      // engine-recheck-anchor: the session source is refused when the chart shows
      // the course under way — here the baseline Hgb is ≥ 14 days old — so the
      // visit asks the start date instead of closing NOT YET DUE (the v7 silent
      // miss). Answering it anchors on the clinician's date.
      console.log('    day 21, +0.4, no care plan, no order, no clinician date — asks "When did oral iron start?" once:');
      r = await visit({ asOf: DAY21, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      const dq = r.pending.filter((p: any) => p.datumKey === ORAL_IRON_ANCHOR) as any[];
      expect('start-date questions', String(dq.length), '1');
      expect('answer type', String(dq[0]?.answerType), 'DATE');
      expect('prompt', String(dq[0]?.prompt), 'When did oral iron start?');
      // v14: the question is gate-response-recheck-due's. gate-rechecked never asks
      // (on_unresolved: default — its at-target arm must not ask for a hemoglobin), so
      // it is closed until the date is answered, and the response gates with it.
      expect('asked by the two gates that ask (v15)', JSON.stringify([dq[0]?.gateId, ...(dq[0]?.askedByNodeIds ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).sort()),
        JSON.stringify(['gate-response-recheck-due', 'gate-rise-unmeasurable']));
      expect('no anchor resolved', String(r.state.get('gate-response-recheck-due')?.windowAnchors?.[0]?.source), 'undefined');
      expect('gate-response-recheck-due', status(r.state, 'gate-response-recheck-due'), 'PENDING_QUESTION');
      expect('gate-response-recheck-due not yet due', String(r.state.get('gate-response-recheck-due')?.notYetDue === true), 'false');
      expect('step-2-21', status(r.state, 'step-2-21'), 'PENDING_QUESTION');
      expect('questions about a hemoglobin value', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length), '0');
      expectAll('(closed until the start date is answered)', r.state, ['gate-rechecked', 'step-2-22', 'step-2-4', 'step-2-6'], 'GATED_OUT');
      console.log('      answered 2026-06-01 (21 days ago) — anchored on the clinician\'s date: nonresponder:');
      r = await visit({ asOf: DAY21, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 },
        ask: [{ anchor: ORAL_IRON_ANCHOR, answer: { dateValue: IRON_START } as GateAnswer }] });
      expect('anchor source', String(r.state.get('gate-hgb-nonresponse')?.windowAnchors?.[0]?.source), 'CLINICIAN');
      expect('gate-hgb-nonresponse', status(r.state, 'gate-hgb-nonresponse'), 'INCLUDED');
      expect('step-2-6 nonresponse', status(r.state, 'step-2-6'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      console.log('      answered today (a start visit with an older Hgb on file) — NOT YET DUE, nothing else asked:');
      r = await visit({ asOf: DAY21, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 },
        ask: [{ anchor: ORAL_IRON_ANCHOR, answer: { dateValue: '2026-06-22' } as GateAnswer }] });
      for (const g of DUE_GATES) expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
      expectAll('(nothing opens)', r.state, [...RECHECK, 'step-2-22', 'step-2-4'], 'GATED_OUT');
      expect('step-2-6 nonresponse', status(r.state, 'step-2-6'), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      // A hemoglobin since the start IS on file (so no response-recheck orders), but
      // there is no pre-treatment baseline to measure the rise from. Through v14 Step
      // 2.22 opened and both response gates held on "newest result, drawn after
      // 2026-06-16?". v15 [DECISION — Josh 2026-10-04]: "recheck in 2–4 weeks, not
      // nonresponse" — gate-rise-unmeasurable opens Step 2.24 and nothing is asked.
      console.log('    day 21, one in-window Hgb (day 15, 9.6), no baseline — v15: Step 2.24 "recheck in 2–4 weeks"; nothing asked; not nonresponse:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.6, '2026-06-16']], attrs: { gestational_age_weeks: 20 } });
      expectAll('(recheck in 2–4 weeks)', r.state, UNMEASURABLE, 'INCLUDED');
      expect('step-2-24 sits under', String(r.state.get('step-2-24')?.parentNodeId), 'gate-rise-unmeasurable');
      expectAll('(no response-recheck orders; response not assessed; no escalation)', r.state,
        ['gate-response-recheck-due', ...RECHECK, 'gate-rechecked', 'step-2-22', ...RESPONSE_GATES, 'step-2-4', 'step-2-6', 'step-2-5'], 'GATED_OUT');
      let hq = r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7') as any[];
      expect('Hgb questions', String(hq.length), '0');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');
      console.log('    …the same value at target (11.3) — maintenance at once, no recheck-in-2–4-weeks step:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[11.3, '2026-06-16']], attrs: { gestational_age_weeks: 20 } });
      expectAll('(maintenance)', r.state, ['gate-rechecked', 'step-2-22', 'gate-hgb-response', 'step-2-4'], 'INCLUDED');
      expectAll('(not unmeasurable-and-below-target)', r.state, [...UNMEASURABLE, 'gate-hgb-nonresponse', 'step-2-6'], 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      console.log('    …10.7 with the trimester unknown — the one thing asked is the trimester (as the nonresponse gate asks it); never a hemoglobin:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[10.7, '2026-06-16']] });
      expect('gate-rise-unmeasurable', status(r.state, 'gate-rise-unmeasurable'), 'PENDING_QUESTION');
      expect('trimester questions', String(r.pending.filter((p: any) => p.datumKey === 'patient.trimester').length), '1');
      expect('Hgb questions', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length), '0');
      for (const [ga, open, closed] of [[20, 'step-2-4', 'step-2-24'], [30, 'step-2-24', 'step-2-4']] as const) {
        r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[10.7, '2026-06-16']], attrs: { gestational_age_weeks: ga } });
        expect(`GA ${ga}: ${open}`, status(r.state, open), 'INCLUDED');
        expect(`GA ${ga}: ${closed}`, status(r.state, closed), 'GATED_OUT');
      }
      console.log('    day 21, a baseline OLDER than 28 days before the start (2026-04-20) + 9.6 on day 15 — unmeasurable: recheck in 2–4 weeks, nothing asked:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.0, '2026-04-20'], [9.6, '2026-06-16']], attrs: { gestational_age_weeks: 20 } });
      expectAll('(recheck in 2–4 weeks)', r.state, UNMEASURABLE, 'INCLUDED');
      expectAll('(response not assessed)', r.state, ['gate-rechecked', 'step-2-22', ...RESPONSE_GATES, 'step-2-4', 'step-2-6'], 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      console.log('    day 21, TWO since the start (9.0 day 3, 9.6 day 15), no baseline — measurable: the response gates decide (+0.6 → nonresponse):');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.0, '2026-06-04'], [9.6, '2026-06-16']], attrs: { gestational_age_weeks: 20 } });
      expectAll('(assessed)', r.state, ['gate-rechecked', 'step-2-22', 'gate-hgb-nonresponse', 'step-2-6'], 'INCLUDED');
      expectAll('(not unmeasurable)', r.state, UNMEASURABLE, 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      // The only Hgb is the pre-treatment baseline, 24 days old, and oral iron
      // started 21 days ago: the response is due and has not been checked.
      // Through v13 both response gates held on ONE question ("newest result,
      // drawn after 2026-05-29?"), and "Not available" closed both — a dead end.
      // v14 [DECISION — Josh 2026-10-04]: nothing is asked. gate-response-
      // recheck-due (count of hemoglobins since the start < 1) opens Step 2.21,
      // which orders the recheck — CBC, ferritin, iron/TIBC/saturation — and
      // gate-rechecked (count >= 1) keeps the response gates closed.
      console.log('    day 21, baseline only (24 days old, not rechecked) — v14: no Hgb question; Step 2.21 orders the recheck; the response gates are not evaluated:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      hq = r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7') as any[];
      expect('Hgb questions', String(hq.length), '0');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expectAll('(recheck ordered)', r.state, ['gate-response-recheck-due', ...RECHECK], 'INCLUDED');
      expect('step-2-21 sits under', String(r.state.get('step-2-21')?.parentNodeId), 'gate-response-recheck-due');
      expect('lab-29 name', String((graphFrom(ANEMIA).getNode('lab-29') as any)?.properties?.name), 'CBC with indices — response to oral iron (no hemoglobin since it started)');
      expect('anchor source', String(r.state.get('gate-response-recheck-due')?.windowAnchors?.[0]?.source), 'CARE_PLAN');
      expect('gate-rechecked (a definite no, not "not yet due")', status(r.state, 'gate-rechecked'), 'GATED_OUT');
      expect('gate-rechecked notYetDue', String(r.state.get('gate-rechecked')?.notYetDue === true), 'false');
      expectAll('(response not assessed)', r.state, ['step-2-22', ...RESPONSE_GATES, 'step-2-4', 'step-2-6', 'step-2-5'], 'GATED_OUT');
      expect('gate-severe-anemia (v13: reads the 24-day-old 9.5)', status(r.state, 'gate-severe-anemia'), 'GATED_OUT');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');
      expectAll('(oral iron continues; the scheduled recheck stays)', r.state, ['med-1', 'step-2-3', 'lab-10', 'sched-2'], 'INCLUDED');

      // An at-target baseline at day >= 14 with no recheck gets BOTH: maintenance
      // (at target, as always) and the recheck orders (nothing drawn since the start).
      console.log('    day 21, baseline 11.2 only (at target, not rechecked) — maintenance AND the recheck orders:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[11.2, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      expectAll('(recheck ordered)', r.state, ['gate-response-recheck-due', ...RECHECK], 'INCLUDED');
      expectAll('(maintenance)', r.state, ['gate-rechecked', 'step-2-22', 'gate-hgb-response', 'step-2-4'], 'INCLUDED');
      expectAll('(no nonresponse)', r.state, ['gate-hgb-nonresponse', 'step-2-6'], 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      // [JOSH — CONFIRM] (a): the window opens at the start of the anchor day, so a
      // hemoglobin drawn on the day oral iron started counts as "since the start" —
      // and not as a baseline. v15: she gets "recheck in 2–4 weeks" (through v14 the
      // response gates asked for a newer value).
      console.log('    day 21, the only Hgb drawn on the start day itself — counts as "since the start": Step 2.24, nothing asked:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, IRON_START]], attrs: { gestational_age_weeks: 20 } });
      expectAll('(recheck in 2–4 weeks)', r.state, UNMEASURABLE, 'INCLUDED');
      expectAll('(no response-recheck orders; response not assessed)', r.state, ['gate-response-recheck-due', ...RECHECK, 'gate-rechecked', 'step-2-22', ...RESPONSE_GATES], 'GATED_OUT');
      expect('Hgb questions', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length), '0');
    }
  }
}

// ── Proof: can confidence scoring alone pick a DP-1 branch? ───────────
// Scores both branch targets with every SYSTEM signal as seeded by migration
// 039 (weights 0.30 / 0.25 / 0.25 / 0.20, its evidence mappings). A single node
// is scored at a time in traversal (makeTraversalAdapter), so no propagation
// applies. Not verifiable here: per-node weight overrides and admin evidence
// entries, which live only in the database.
async function proveDp1Scoring(): Promise<void> {
  console.log('\n=== dp-1-scoring: DP-1 branch targets, scored per signal (seeded SYSTEM signals) ===');
  const sig = (name: string, t: ScoringType, w: number, rules: Record<string, unknown> = {}): SignalDefinition => ({
    id: name, name, displayName: name, description: '', scoringType: t, scoringRules: rules,
    propagationConfig: { mode: 'none' }, scope: 'SYSTEM', defaultWeight: w, isActive: true,
  } as SignalDefinition);
  const signals: Array<[SignalDefinition, SignalScorer]> = [
    [sig('data_completeness', ScoringType.DATA_PRESENCE, 0.30), new DataCompletenessScorer()],
    [sig('evidence_strength', ScoringType.MAPPING_LOOKUP, 0.25, {
      mappings: { 'Level A': 0.95, 'Level B': 0.80, 'Level C': 0.65, 'Expert Consensus': 0.60 }, default_score: 0.30,
    }), new EvidenceStrengthScorer()],
    [sig('match_quality', ScoringType.CRITERIA_MATCH, 0.25), new PatientMatchQualityScorer()],
    [sig('risk_magnitude', ScoringType.RISK_INVERSE, 0.20), new RiskMagnitudeScorer()],
  ];
  const graph = graphFrom(ANEMIA);
  const patient = patientWith([['787-2', 72], ['2276-4', 50], ['718-7', 9.5]]);
  // A Stage and a Step on each fork — the node type must not move the score,
  // or the fork would auto-select instead of pending. DP-1: the empiric Stage
  // 1.5 vs the workup Step 1.2. DP-3 (v7): the oral-trial Stage 2.5 vs the
  // IV-first Step 2.9 — so every confirmed-IDA patient is asked the route.
  for (const [dp, pair] of [['dp-1', [EMPIRIC, 'step-1-2']], ['dp-3', [ORAL_TRIAL, IV_FIRST]]] as const) {
    console.log(`  ${dp}:`);
    const confs: number[] = [];
    const perSignal: string[] = [];
    for (const id of pair) {
      const node = graph.getNode(id)!;
      let sum = 0; let wsum = 0; const parts: string[] = [];
      for (const [def, scorer] of signals) {
        const s = scorer.score({ node, signalDefinition: def, patientContext: patient, graphContext: graph });
        parts.push(`${def.name}=${s.skipped ? 'skipped' : s.score}`);
        if (!s.skipped) { sum += s.score * def.defaultWeight; wsum += def.defaultWeight; }
      }
      const conf = Math.round((sum / wsum) * 1000) / 1000;
      confs.push(conf); perSignal.push(parts.join(' '));
      console.log(`    ${id.padEnd(15)} ${parts.join('  ')}  → confidence ${conf}`);
    }
    expect(`${dp} per-signal scores identical`, String(perSignal[0] === perSignal[1]), 'true');
    expect(`${dp} both ≥ suggest threshold 0.60 (so a one_of fork pends)`, String(confs.every((c) => c >= 0.6)), 'true');
  }
}

// ── Proof: anemia gate-iv-iron-ga reads gestational age directly ──────
// patient.gestational_age_weeks >= 14, on_unresolved ask. Since 8f64fc1 a
// MISSING patient.* value is missing data (pends with a datum request), not a
// silent "no". Reached through the workup with ferritin 12 so Stage 2 is open,
// and a day-21 nonresponder (9.5 → 9.9, oral iron started 2026-06-01 per the
// stored care plan) so DP-2, the gate's host, is open (v7: chart data, not an
// answered question).
async function proveGa(): Promise<void> {
  console.log(`\n=== ga: anemia gate-iv-iron-ga — patient.gestational_age_weeks >= 14 (${ANEMIA}) ===`);
  const labs: Lab[] = [['787-2', 72], ['2276-4', 12], ['718-7', 9.5, BASELINE_DATE], ['718-7', 9.9, RECHECK_DATE]];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    for (const [label, attrs, gate, step] of [
      ['GA 20 weeks', { gestational_age_weeks: 20 }, 'INCLUDED', 'INCLUDED'],
      ['GA 14 weeks (boundary)', { gestational_age_weeks: 14 }, 'INCLUDED', 'INCLUDED'],
      ['GA 12 weeks', { gestational_age_weeks: 12 }, 'GATED_OUT', 'GATED_OUT'],
      ['GA missing', {}, 'PENDING_QUESTION', 'PENDING_QUESTION'],
    ] as const) {
      const r = await resolveSession({
        file: ANEMIA, reverse, patient: patientWith(labs, attrs as Record<string, number>),
        choose: WORKUP, replay: [ORAL], asOf: DAY21, oralIronStart: IRON_START,
      });
      expect('gate-hgb-nonresponse (day-21 nonresponder)', status(r.state, 'gate-hgb-nonresponse'), 'INCLUDED');
      console.log(`  ${label}:`);
      expect('gate-iv-iron-ga', status(r.state, 'gate-iv-iron-ga'), gate);
      expect('step-2-5 IV iron', status(r.state, 'step-2-5'), step);
      // The IV iron itself follows Step 2.5. Through v4, med-1 ESCALATES_TO
      // med-5 was a second, live route (the constructive walk follows every
      // edge), so ferric derisomaltose was INCLUDED at GA 12 in file order.
      expect('med-5 ferric derisomaltose (IV)', status(r.state, 'med-5'), step);
      const q = r.pending.find((p: any) => p.gateId === 'gate-iv-iron-ga') as any;
      if (label === 'GA missing') {
        expect('asks for datum', String(q?.datumKey), 'patient.gestational_age_weeks');
        expect('answer type', String(q?.answerType), 'NUMERIC');
      } else {
        expect('no GA question', String(q === undefined), 'true');
      }
    }
  }
}

// ── Proof: a LabTest leaf takes its status from ONE host step ──────────
// Marking is first-writer-wins, and a closing gate or fork sweeps its whole
// subtree synchronously. A lab shared by a step inside that subtree and a
// step outside it was decided by whichever wrote first — v3's entry-step CBC
// (lab-1, also Step 2.3's recheck) went GATED_OUT with ferritin 50, and the
// normocytic workup's ferritin / reticulocytes / smear were held behind DP-1.
// The care-plan projection keeps only INCLUDED labs, so those tests vanished.
// Each such lab is now split, one node per host step.
async function proveSharedLeaves(): Promise<void> {
  console.log(`\n=== shared-leaves: each lab follows its own step, not a neighbour's gate (${ANEMIA}) ===`);
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    console.log('  MCV 90 (normocytic), no branch chosen:');
    let r = await resolveSession({ ...base, patient: patientWith([['787-2', 90], ['2276-4', 50], ['718-7', 9.5]]) });
    expect('lab-1 entry CBC (Step 1.1)', status(r.state, 'lab-1'), 'INCLUDED');
    expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'INCLUDED');
    for (const [id, name] of [['lab-11', 'ferritin'], ['lab-12', 'reticulocytes'], ['lab-13', 'smear']]) {
      expect(`${id} ${name} (Step 1.3)`, status(r.state, id), 'INCLUDED');
    }

    console.log('  MCV 72, ferritin 50, provider chooses the workup (Stage 2 gated out):');
    r = await resolveSession({
      ...base, patient: patientWith([['787-2', 72], ['2276-4', 50], ['718-7', 9.5]]),
      choose: { dp: 'dp-1', option: 'step-1-2' },
    });
    expect('lab-1 entry CBC (Step 1.1)', status(r.state, 'lab-1'), 'INCLUDED');
    expect('lab-10 Hgb recheck CBC (Step 2.3)', status(r.state, 'lab-10'), 'GATED_OUT');
    expect('lab-2 ferritin (Step 1.2)', status(r.state, 'lab-2'), 'INCLUDED');
  }
}

// ── Proof: gate-microcytic — DP-1 is offered only for MCV < 80 ─────────
// [DECISION — Josh 2026-09-24] gate-microcytic (LOINC 787-2 < 80, 90 days,
// skip, ask) on Step 1.1 is the only way into Step 1.7, the sole host of DP-1.
// Normocytic and macrocytic patients never see the iron-strategy question and
// get their own workups through gate-normocytic / gate-macrocytic.
async function proveMcv(): Promise<void> {
  console.log(`\n=== mcv: gate-microcytic in front of DP-1 (${ANEMIA}) ===`);
  const labs = (mcv: number | null): Array<[string, number]> =>
    [...(mcv === null ? [] : [['787-2', mcv] as [string, number]]), ['2276-4', 50], ['718-7', 9.5]];
  const dp1Asked = (pending: unknown[]) => String(pending.some((p: any) => p.gateId === 'dp-1'));
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    for (const mcv of [72, 79.9]) {
      console.log(`  MCV ${mcv} (microcytic) — DP-1 offered:`);
      const r = await resolveSession({ ...base, patient: patientWith(labs(mcv)) });
      expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'INCLUDED');
      expect('step-1-7 iron strategy (DP-1 host)', status(r.state, 'step-1-7'), 'INCLUDED');
      expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
      const q = r.pending.find((p: any) => p.gateId === 'dp-1') as any;
      expect('dp-1 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP1_OPTIONS));
      expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'GATED_OUT');
      expect('step-1-4 macrocytic workup', status(r.state, 'step-1-4'), 'GATED_OUT');
    }

    for (const mcv of [80, 90]) {
      console.log(`  MCV ${mcv} (normocytic) — no DP-1, normocytic workup:`);
      const r = await resolveSession({ ...base, patient: patientWith(labs(mcv)) });
      expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'GATED_OUT');
      expect('dp-1', status(r.state, 'dp-1'), 'GATED_OUT');
      expect('no dp-1 question', dp1Asked(r.pending), 'false');
      expect('step-1-2 microcytic workup', status(r.state, 'step-1-2'), 'GATED_OUT');
      expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'GATED_OUT');
      expect('med-1 ferrous sulfate', status(r.state, 'med-1'), 'GATED_OUT');
      expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'INCLUDED');
      expect('lab-11 ferritin (Step 1.3)', status(r.state, 'lab-11'), 'INCLUDED');
      expect('lab-1 entry CBC', status(r.state, 'lab-1'), 'INCLUDED');
      expect('step-1-4 macrocytic workup', status(r.state, 'step-1-4'), 'GATED_OUT');
    }

    console.log('  MCV 105 (macrocytic) — no DP-1, macrocytic workup:');
    let r = await resolveSession({ ...base, patient: patientWith(labs(105)) });
    expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'GATED_OUT');
    expect('dp-1', status(r.state, 'dp-1'), 'GATED_OUT');
    expect('no dp-1 question', dp1Asked(r.pending), 'false');
    expect('step-1-4 macrocytic workup', status(r.state, 'step-1-4'), 'INCLUDED');
    expect('lab-5 B12', status(r.state, 'lab-5'), 'INCLUDED');
    expect('lab-6 folate', status(r.state, 'lab-6'), 'INCLUDED');
    expect('med-8 folic acid', status(r.state, 'med-8'), 'INCLUDED');
    expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'GATED_OUT');
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'GATED_OUT');
    expect('lab-1 entry CBC', status(r.state, 'lab-1'), 'INCLUDED');

    console.log('  MCV missing — asks for MCV once, holds DP-1 and every workup:');
    r = await resolveSession({ ...base, patient: patientWith(labs(null)) });
    const mcvQs = r.pending.filter((p: any) => p.datumKey === 'LOINC:787-2') as any[];
    expect('one MCV question', String(mcvQs.length), '1');
    expect('asked by the three MCV gates', JSON.stringify([...(mcvQs[0]?.askedByNodeIds ?? [])].sort()),
      JSON.stringify(['gate-macrocytic', 'gate-microcytic', 'gate-normocytic']));
    expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'PENDING_QUESTION');
    expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
    expect('no dp-1 question yet', dp1Asked(r.pending), 'false');
    for (const id of ['step-1-2', 'step-1-3', 'step-1-4', 'step-2-1']) {
      expect(id, status(r.state, id), 'PENDING_QUESTION');
    }
  }
}

// ── Proof: DP-3 — IV iron without an oral trial (v7; both arms since v8) ──
// [DECISION — Josh 2026-09-24] Step 2.8, the host of DP-3 (one_of), is reached
// on BOTH iron arms since v8: ferritin-confirmed IDA (Stage 2) and empiric iron
// chosen at DP-1 (Stage 1.5). Criterion 3a → Stage 2.5 (the oral trial: Steps
// 2.1–2.3); criteria 3b intolerance / 3c malabsorption / 3d anemia diagnosed at
// ≥ 34 weeks → Step 2.9, whose gate-iv-iron-ga-direct (GA ≥ 14, gate-iv-iron-ga's
// condition) opens Step 2.10: IV iron with its own medication and schedule
// copies. All three criteria are provider-judged. v8 [DECISION — Josh
// 2026-09-24]: IV first chosen before 14 weeks starts the oral trial until then —
// gate-oral-bridge-ga (GA < 14, the exact complement of gate-iv-iron-ga-direct)
// on Step 2.9 → Stage 2.6, which holds the same Steps 2.1–2.3 as Stage 2.5.
// v9 [DECISION — Josh 2026-09-25]: IV iron also needs a ferritin < 30 on file
// (Step 2.13 → gate-ida-confirmed-iv → Step 2.10), and the bridge also opens
// while no ferritin is on file — see `iv-ferritin`.
async function proveDp3(): Promise<void> {
  console.log(`\n=== dp-3: oral iron trial vs IV iron without an oral trial, both arms (${ANEMIA}) ===`);
  const IV_DIRECT = ['step-2-10', 'med-13', 'med-14', 'med-15', 'med-16', 'sched-6'];
  const ORAL_ARM = [ORAL_TRIAL, 'step-2-1', 'med-1', 'med-2', 'med-3', 'step-2-2', 'step-2-3', 'lab-10',
    'gate-hgb-response', 'gate-hgb-nonresponse'];
  const NONRESPONSE_IV = ['step-2-6', 'dp-2', 'step-2-5', 'med-4', 'med-5', 'med-6', 'med-7'];
  /** The oral trial's contents, which Stage 2.5 and (v8) Stage 2.6 both hold. */
  const ORAL_STEPS = ORAL_ARM.filter((id) => id !== ORAL_TRIAL);
  const BRIDGE = 'stage-2-oral-bridge';
  const IV_FIRST_CHOICE: Replay = { dp: 'dp-3', option: IV_FIRST };
  const dp3Asked = (pending: unknown[]) => String(pending.some((p: any) => p.gateId === 'dp-3'));
  const arms: Array<[string, (ga: number | null) => PatientContext, Replay, string]> = [
    ['confirmed arm (workup, ferritin 12)',
      (ga) => patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]], ga === null ? {} : { gestational_age_weeks: ga }),
      WORKUP, 'stage-2'],
    ['empiric arm (no ferritin drawn; v8)',
      (ga) => patientWith([['787-2', 72], ['718-7', 9.5]], ga === null ? {} : { gestational_age_weeks: ga }),
      // v8: Stage 1.5 reaches Step 2.8 through gate-empiric-no-hgbpathy (no hemoglobinopathy disease).
      EMPIRIC_CHOICE, 'gate-empiric-no-hgbpathy'],
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };
    for (const [arm, patient, dp1, host] of arms) {
      console.log(`  ${arm}:`);
      console.log('    GA 20, route not chosen yet — DP-3 asks, both routes held:');
      let r = await resolveSession({ ...base, patient: patient(20), replay: [dp1] });
      expect('step-2-8 route selection', status(r.state, 'step-2-8'), 'INCLUDED');
      expect('step-2-8 sits under', String(r.state.get('step-2-8')?.parentNodeId), host);
      expect('dp-3', status(r.state, 'dp-3'), 'PENDING_QUESTION');
      const q = r.pending.find((p: any) => p.gateId === 'dp-3') as any;
      expect('dp-3 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP3_OPTIONS));
      for (const id of ['step-2-1', 'med-1', IV_FIRST, 'step-2-10', 'med-13']) expect(id, status(r.state, id), 'PENDING_QUESTION');

      console.log('    oral trial chosen (3a) — oral iron and the response check; no IV-first route:');
      r = await resolveSession({ ...base, patient: patient(20), replay: [dp1, ORAL] });
      expectAll('(oral arm)', r.state, ORAL_ARM.filter((id) => !id.startsWith('gate-hgb')), 'INCLUDED');
      for (const g of DUE_GATES) {
        expect(`${g} not yet due (start visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
      }
      expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), ORAL_TRIAL);
      expect(`${IV_FIRST} (unchosen)`, status(r.state, IV_FIRST), 'EXCLUDED');
      expectAll('(IV without a trial)', r.state, ['gate-iv-iron-ga-direct', ...IV_DIRECT], 'EXCLUDED');
      expectAll('(oral bridge, under the unchosen branch)', r.state, ['gate-oral-bridge-ga', BRIDGE], 'EXCLUDED');

      // v9 [DECISION — Josh 2026-09-25]: IV iron first needs a ferritin < 30 on
      // file. On the confirmed arm the ferritin that opened Stage 2 is that
      // ferritin, so everything below reads exactly as in v8 there; the only new
      // nodes it touches are Step 2.13 (INCLUDED at GA ≥ 14 — the ferritin gate's
      // host) and the ferritin order (Step 2.12, lab-17), GATED_OUT. On the
      // empiric arm no ferritin is on file, so the SAME choices come out
      // differently — split here on purpose; the empiric arm's IV-first
      // outcomes are proved in full in `iv-ferritin`.
      const confirmed = dp1 === WORKUP;
      const FERRITIN_ORDER = ['step-2-12', 'lab-17'];
      for (const [ga, label] of [[20, 'intolerance or malabsorption (3b/3c), GA 20'], [36, 'anemia diagnosed at ≥ 34 weeks (3d), GA 36']] as const) {
        console.log(`    IV iron first chosen — ${label}: ${confirmed
          ? 'IV iron, no oral trial, no response check'
          : 'ferritin ordered, oral iron meanwhile, IV iron waits for the ferritin (v9)'}:`);
        r = await resolveSession({ ...base, patient: patient(ga), replay: [dp1, IV_FIRST_CHOICE] });
        expect(`${IV_FIRST}`, status(r.state, IV_FIRST), 'INCLUDED');
        expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'INCLUDED');
        expect('step-2-13 ferritin check before IV iron', status(r.state, 'step-2-13'), 'INCLUDED');
        expect(`${ORAL_TRIAL} (unchosen)`, status(r.state, ORAL_TRIAL), 'EXCLUDED');
        if (confirmed) {
          expect('gate-ida-confirmed-iv (the ferritin on file)', status(r.state, 'gate-ida-confirmed-iv'), 'INCLUDED');
          expectAll('(IV without a trial)', r.state, IV_DIRECT, 'INCLUDED');
          expect('med-14 sits under', String(r.state.get('med-14')?.parentNodeId), 'step-2-10');
          // v8: the oral steps also sit under Step 2.9's bridge, so DP-3 spares them
          // and the bridge's gate decides them: closed at GA ≥ 14 with a ferritin on file.
          expect('gate-oral-bridge-ga (GA ≥ 14, ferritin on file)', status(r.state, 'gate-oral-bridge-ga'), 'GATED_OUT');
          expectAll('(oral steps, bridge closed)', r.state, [BRIDGE, ...ORAL_STEPS], 'GATED_OUT');
          expectAll('(no ferritin order — one is on file)', r.state, FERRITIN_ORDER, 'GATED_OUT');
          expectAll('(post-nonresponse IV route)', r.state, NONRESPONSE_IV, 'GATED_OUT');
          expect('questions from the response check', String(r.pending.some((p: any) =>
            ['gate-hgb-response', 'gate-hgb-nonresponse'].includes(p.gateId)
            || (p.askedByNodeIds ?? []).some((id: string) => id.startsWith('gate-hgb-')))), 'false');
        } else {
          expect('gate-ida-confirmed-iv (no ferritin: asks)', status(r.state, 'gate-ida-confirmed-iv'), 'PENDING_QUESTION');
          expectAll('(IV without a trial, held for the ferritin)', r.state, IV_DIRECT, 'PENDING_QUESTION');
          expectAll('(ferritin ordered)', r.state, FERRITIN_ORDER, 'INCLUDED');
          expect('gate-oral-bridge-ga (no ferritin on file)', status(r.state, 'gate-oral-bridge-ga'), 'INCLUDED');
          expectAll('(oral iron meanwhile, via the bridge)', r.state,
            [BRIDGE, ...ORAL_STEPS.filter((id) => !id.startsWith('gate-hgb'))], 'INCLUDED');
          expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), BRIDGE);
        }
      }

      console.log('    IV iron first chosen, GA 12 — IV iron gated out; oral trial until 14 weeks (v8):');
      r = await resolveSession({ ...base, patient: patient(12), replay: [dp1, IV_FIRST_CHOICE] });
      expect(`${IV_FIRST}`, status(r.state, IV_FIRST), 'INCLUDED');
      expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'GATED_OUT');
      expectAll('(IV without a trial, and its ferritin check)', r.state, ['step-2-13', 'gate-ida-confirmed-iv', ...IV_DIRECT], 'GATED_OUT');
      expect('gate-oral-bridge-ga', status(r.state, 'gate-oral-bridge-ga'), 'INCLUDED');
      expectAll('(oral trial via the bridge)', r.state,
        [BRIDGE, ...ORAL_STEPS.filter((id) => !id.startsWith('gate-hgb'))], 'INCLUDED');
      expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), BRIDGE);
      expect(`${ORAL_TRIAL} (unchosen DP-3 branch)`, status(r.state, ORAL_TRIAL), 'EXCLUDED');
      for (const g of DUE_GATES) {
        expect(`${g} not yet due (start visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
      }
      expect('GA questions', String(r.pending.filter((p: any) => p.datumKey === 'patient.gestational_age_weeks').length), '0');
      // GA < 14 settles the IV chain before its ferritin gate is reached: nothing asked.
      expect('ferritin questions', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:2276-4').length), '0');
      expectAll(confirmed ? '(no ferritin order)' : '(ferritin ordered)', r.state, FERRITIN_ORDER, confirmed ? 'GATED_OUT' : 'INCLUDED');

      if (confirmed) {
        console.log('    IV iron first chosen, GA missing — asks for GA once, holds IV iron and the oral bridge:');
        r = await resolveSession({ ...base, patient: patient(null), replay: [dp1, IV_FIRST_CHOICE] });
        expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'PENDING_QUESTION');
        expect('gate-oral-bridge-ga', status(r.state, 'gate-oral-bridge-ga'), 'PENDING_QUESTION');
        expectAll('(held)', r.state, ['step-2-10', BRIDGE, 'step-2-1', 'med-1'], 'PENDING_QUESTION');
        const gaQs = r.pending.filter((p: any) => p.datumKey === 'patient.gestational_age_weeks') as any[];
        expect('GA questions', String(gaQs.length), '1');
        expect('asked by both GA gates', JSON.stringify([...(gaQs[0]?.askedByNodeIds ?? [])].sort()),
          JSON.stringify(['gate-iv-iron-ga-direct', 'gate-oral-bridge-ga']));
      } else {
        // No ferritin on file settles the bridge's OR at once: oral iron starts
        // whatever the GA; only the IV chain asks for it.
        console.log('    IV iron first chosen, GA missing — asks for GA once (IV chain only); oral iron and the ferritin order not held:');
        r = await resolveSession({ ...base, patient: patient(null), replay: [dp1, IV_FIRST_CHOICE] });
        expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'PENDING_QUESTION');
        expect('gate-oral-bridge-ga', status(r.state, 'gate-oral-bridge-ga'), 'INCLUDED');
        expectAll('(held)', r.state, ['step-2-13', 'step-2-10', 'med-13'], 'PENDING_QUESTION');
        expectAll('(not held)', r.state, [BRIDGE, 'step-2-1', 'med-1', ...FERRITIN_ORDER], 'INCLUDED');
        const gaQs = r.pending.filter((p: any) => p.datumKey === 'patient.gestational_age_weeks') as any[];
        expect('GA questions', String(gaQs.length), '1');
        expect('asked by the IV chain\'s GA gate only', JSON.stringify([gaQs[0]?.gateId, ...(gaQs[0]?.askedByNodeIds ?? [])]
          .filter((x, i, a) => x && a.indexOf(x) === i).sort()), JSON.stringify(['gate-iv-iron-ga-direct']));
      }
      // The boundary: with a ferritin < 30 on file exactly one of IV iron / the
      // oral bridge opens on either side of 14 0/7. Without one (empiric) oral
      // iron starts on both sides, and at 14 IV iron waits for the ferritin.
      for (const [ga, iv, oral] of (confirmed
        ? [[13.9, 'GATED_OUT', 'INCLUDED'], [14, 'INCLUDED', 'GATED_OUT']]
        : [[13.9, 'GATED_OUT', 'INCLUDED'], [14, 'PENDING_QUESTION', 'INCLUDED']]) as Array<[number, string, string]>) {
        console.log(`    IV iron first chosen, GA ${ga}${confirmed ? ' — exactly one of IV iron / the oral bridge' : ''}:`);
        r = await resolveSession({ ...base, patient: patient(ga), replay: [dp1, IV_FIRST_CHOICE] });
        expect('step-2-10 IV iron', status(r.state, 'step-2-10'), iv);
        expect('step-2-1 oral iron (bridge)', status(r.state, 'step-2-1'), oral);
      }
    }

    console.log('  ferritin 50 (not iron deficient), workup — Stage 2 closed, DP-3 never asked:');
    const r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['2276-4', 50], ['718-7', 9.5]], { gestational_age_weeks: 20 }), choose: WORKUP });
    expect('dp-3', status(r.state, 'dp-3'), 'GATED_OUT');
    expect('no dp-3 question', dp3Asked(r.pending), 'false');
    expectAll('(IV without a trial)', r.state, IV_DIRECT, 'GATED_OUT');

    console.log('  D57.1 sickle-cell disease, MCV 72, ferritin 12, workup — DP-3 asks, as for any confirmed IDA (v8):');
    const d = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]],
      { gestational_age_weeks: 20 }, ['D57.1']), choose: WORKUP });
    expect('dp-3', status(d.state, 'dp-3'), 'PENDING_QUESTION');
    expect('dp-3 question', dp3Asked(d.pending), 'true');
  }
}

// ── Proof: IV iron first needs a ferritin-confirmed iron deficiency (v9) ──
// [DECISION — Josh 2026-09-25] Through v8, IV iron first chosen at DP-3 on the
// empiric arm (Stage 1.5, no iron studies) gave IV iron with no ferritin on
// file. v9: IV iron first orders a ferritin when none is on file, starts oral
// iron meanwhile, and gives IV iron only once ferritin < 30 ng/mL confirms iron
// deficiency — gate-ida-confirmed's own condition — still at GA ≥ 14 only.
// DP-3 and Step 2.9 stay SHARED by both arms, and Step 2.9's gates read the
// chart instead of knowing the arm:
//   gate-iv-iron-ga-direct (GA ≥ 14, unchanged) → Step 2.13 → gate-ida-confirmed-iv
//     (an identical copy of gate-ida-confirmed: ferritin < 30, 90 days, ask) → Step 2.10;
//   gate-oral-bridge-ga, now OR(no ferritin on file, AND(GA < 14, ferritin < 30))
//     → Stage 2.6 — the ONLY gate into the oral steps it opens, so no oral step
//     has two differently-gated parents;
//   gate-no-ferritin-on-file (labs not_includes_code 2276-4, 90 days;
//     membership, never asks) → Step 2.12 → lab-17 (its own ferritin node).
// On the confirmed arm the ferritin that opened Stage 2 is on file (the same
// condition and horizon), so these reduce to v8's GA gates; `dp-3` proves it.
// Ferritin arrives two ways: on the chart at the next visit (a new session), or
// supplied mid-session as the answer to the ferritin question — continued here
// as addPatientContext does (`supplyLab`), and checked against a fresh session
// with that ferritin on the chart.
async function proveIvFerritin(): Promise<void> {
  console.log(`\n=== iv-ferritin: IV iron first needs a confirmed ferritin; empiric arm orders one, oral iron meanwhile (${ANEMIA}) ===`);
  const IV_FIRST_CHOICE: Replay = { dp: 'dp-3', option: IV_FIRST };
  const BRIDGE = 'stage-2-oral-bridge';
  const ORAL_IRON = ['step-2-1', 'med-1', 'med-2', 'med-3', 'step-2-2', 'step-2-3', 'lab-10'];
  const IV = ['step-2-10', 'med-13', 'med-14', 'med-15', 'med-16', 'sched-6'];
  const FERRITIN_ORDER = ['gate-no-ferritin-on-file', 'step-2-12', 'lab-17'];
  const ALL_IRON = ['med-1', 'med-2', 'med-3', 'med-4', 'med-5', 'med-6', 'med-7', 'med-13', 'med-14', 'med-15', 'med-16'];
  const ferritinQs = (pending: unknown[]) => pending.filter((p: any) => p.datumKey === 'LOINC:2276-4') as any[];
  const empiric = (ferritin: number | null, ga: number | null) => patientWith(
    [['787-2', 72], ['718-7', 9.5], ...(ferritin === null ? [] : [['2276-4', ferritin] as Lab])],
    ga === null ? {} : { gestational_age_weeks: ga });
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };
    const empiricIvFirst = (ferritin: number | null, ga: number | null) =>
      resolveSession({ ...base, patient: empiric(ferritin, ga), replay: [EMPIRIC_CHOICE, IV_FIRST_CHOICE] });

    console.log('  empiric + IV first + no ferritin, GA 20 — ferritin ordered, oral iron meanwhile, IV iron waits for the ferritin:');
    let r = await empiricIvFirst(null, 20);
    expect('step-2-8 sits under (empiric arm)', String(r.state.get('step-2-8')?.parentNodeId), 'gate-empiric-no-hgbpathy');
    expectAll('(ferritin ordered)', r.state, FERRITIN_ORDER, 'INCLUDED');
    expect('lab-17 sits under', String(r.state.get('lab-17')?.parentNodeId), 'step-2-12');
    expect('gate-oral-bridge-ga (no ferritin on file)', status(r.state, 'gate-oral-bridge-ga'), 'INCLUDED');
    expectAll('(oral iron meanwhile)', r.state, [BRIDGE, ...ORAL_IRON], 'INCLUDED');
    expect('step-2-1 sits under', String(r.state.get('step-2-1')?.parentNodeId), BRIDGE);
    for (const g of DUE_GATES) {
      expect(`${g} not yet due (oral iron starts this visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
    }
    expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'INCLUDED');
    expect('step-2-13', status(r.state, 'step-2-13'), 'INCLUDED');
    expect('gate-ida-confirmed-iv', status(r.state, 'gate-ida-confirmed-iv'), 'PENDING_QUESTION');
    expectAll('(IV iron held for the ferritin)', r.state, IV, 'PENDING_QUESTION');
    let fq = ferritinQs(r.pending);
    expect('ferritin questions', String(fq.length), '1');
    expect('asked by', JSON.stringify([fq[0]?.gateId, ...(fq[0]?.askedByNodeIds ?? [])].filter((x, i, a) => x && a.indexOf(x) === i)),
      JSON.stringify(['gate-ida-confirmed-iv']));
    expect('prompt', String(fq[0]?.prompt), 'Ferritin (ng/mL) (LOINC 2276-4) — most recent value?');
    // Care-plan generation refuses a pending question: this visit's plan waits
    // for a ferritin value (see the brief's §4 DP-3 — accepted cost of `ask`).
    expect('care-plan blockers from the ferritin question', String(validateForGeneration(r.state as never, r.redFlags)
      .filter((b) => b.relatedNodeIds.includes('gate-ida-confirmed-iv')).length > 0), 'true');
    expect('gate-ida-confirmed (confirmed arm, unchosen)', status(r.state, 'gate-ida-confirmed'), 'EXCLUDED');

    for (const [fer, label] of [[12, 'ferritin 12 — iron deficient: IV iron, oral iron stops'], [50, 'ferritin 50 — not iron deficient: no IV iron, and no oral iron from this route']] as const) {
      const noSession = await empiricIvFirst(null, 20);
      console.log(`    …the ferritin question answered in the same visit, ${label}:`);
      const s = await supplyLab(noSession, empiric(null, 20), { code: '2276-4', value: fer });
      expect('re-resolved every lab-reading gate (incl. the bridge and the ferritin order)',
        String(['gate-ida-confirmed-iv', 'gate-oral-bridge-ga', 'gate-no-ferritin-on-file'].every((g) => s.affected.has(g))), 'true');
      expect('ferritin questions', String(ferritinQs(s.pending).length), '0');
      const ivWant = fer < 30 ? 'INCLUDED' : 'GATED_OUT';
      expect('gate-ida-confirmed-iv', status(s.state, 'gate-ida-confirmed-iv'), ivWant);
      expectAll('(IV iron)', s.state, IV, ivWant);
      expect('gate-oral-bridge-ga (ferritin now on file, GA ≥ 14)', status(s.state, 'gate-oral-bridge-ga'), 'GATED_OUT');
      expectAll('(oral iron)', s.state, [BRIDGE, ...ORAL_IRON], 'GATED_OUT');
      expectAll('(ferritin order — one is on file now)', s.state, FERRITIN_ORDER.slice(1), 'GATED_OUT');
      // The same visit with that ferritin on the chart from the start: every node agrees.
      const fresh = await empiricIvFirst(fer, 20);
      const diffs = [...new Set([...s.state.keys(), ...fresh.state.keys()])]
        .filter((id) => status(s.state, id) !== status(fresh.state, id)
          && !['CodeEntry', 'EvidenceCitation'].includes(String((graphFrom(ANEMIA).getNode(id) as any)?.nodeType)));
      expect('mid-session answer agrees with the chart value (non-reference nodes)', JSON.stringify(diffs), '[]');
    }

    console.log('  empiric + IV first + no ferritin, GA 12 — oral iron until IV iron is possible; ferritin ordered, not asked:');
    r = await empiricIvFirst(null, 12);
    expectAll('(ferritin ordered)', r.state, FERRITIN_ORDER, 'INCLUDED');
    expectAll('(oral iron)', r.state, [BRIDGE, ...ORAL_IRON], 'INCLUDED');
    expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'GATED_OUT');
    expectAll('(IV iron and its ferritin check)', r.state, ['step-2-13', 'gate-ida-confirmed-iv', ...IV], 'GATED_OUT');
    expect('ferritin questions (IV is not possible before 14 weeks)', String(ferritinQs(r.pending).length), '0');

    for (const ga of [20, 12]) {
      console.log(`  empiric + IV first + ferritin 12 on the chart (next visit), GA ${ga}:`);
      r = await empiricIvFirst(12, ga);
      expectAll('(no ferritin order — one is on file)', r.state, FERRITIN_ORDER, 'GATED_OUT');
      expect('ferritin questions', String(ferritinQs(r.pending).length), '0');
      if (ga >= 14) {
        expect('gate-ida-confirmed-iv', status(r.state, 'gate-ida-confirmed-iv'), 'INCLUDED');
        expectAll('(IV iron)', r.state, IV, 'INCLUDED');
        expect('med-14 sits under', String(r.state.get('med-14')?.parentNodeId), 'step-2-10');
        expectAll('(oral iron — IV replaces it, as on the confirmed arm)', r.state, [BRIDGE, ...ORAL_IRON], 'GATED_OUT');
      } else {
        expectAll('(IV iron — before 14 weeks)', r.state, ['gate-iv-iron-ga-direct', 'step-2-13', ...IV], 'GATED_OUT');
        expectAll('(oral iron until 14 weeks)', r.state, [BRIDGE, ...ORAL_IRON], 'INCLUDED');
      }
    }

    for (const ga of [20, 12]) {
      console.log(`  empiric + IV first + ferritin 50 on the chart (next visit), GA ${ga} — no IV iron, no iron at all on this route:`);
      r = await empiricIvFirst(50, ga);
      expect('gate-oral-bridge-ga (ferritin ≥ 30)', status(r.state, 'gate-oral-bridge-ga'), 'GATED_OUT');
      expectAll('(no ferritin order — one is on file)', r.state, FERRITIN_ORDER, 'GATED_OUT');
      expectAll('(no IV iron)', r.state, IV, 'GATED_OUT');
      expect('gate-ida-confirmed-iv', status(r.state, 'gate-ida-confirmed-iv'), 'GATED_OUT');
      expectAll('(no iron of any kind)', r.state, [BRIDGE, ...ORAL_IRON, ...ALL_IRON], 'GATED_OUT');
      expect('ferritin questions', String(ferritinQs(r.pending).length), '0');
    }

    // For contrast — the empiric arm's oral trial never reads ferritin (v8, unchanged).
    console.log('  empiric + ORAL TRIAL + ferritin 50 on the chart — oral iron continues (unchanged; the oral branch reads no ferritin):');
    r = await resolveSession({ ...base, patient: empiric(50, 20), replay: [EMPIRIC_CHOICE, ORAL] });
    expectAll('(empiric oral trial)', r.state, [ORAL_TRIAL, 'step-2-1', 'med-1'], 'INCLUDED');
    expectAll('(no ferritin order on the oral branch)', r.state, FERRITIN_ORDER, 'EXCLUDED');

    console.log('  confirmed arm (workup, ferritin 12), IV first, GA 20 — unchanged: IV iron, no oral iron, no ferritin order:');
    r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]], { gestational_age_weeks: 20 }),
      replay: [WORKUP, IV_FIRST_CHOICE] });
    expectAll('(IV iron)', r.state, IV, 'INCLUDED');
    expectAll('(oral iron)', r.state, [BRIDGE, ...ORAL_IRON], 'GATED_OUT');
    expectAll('(no ferritin order)', r.state, FERRITIN_ORDER, 'GATED_OUT');
    expect('ferritin questions', String(ferritinQs(r.pending).length), '0');
  }
}

// ── Proof: DP-3 criterion 3c read from the chart, as a recommendation (v8) ──
// [DECISION — Josh 2026-09-24] Malabsorption should also be satisfiable from
// chart codes. DP-3's branch choice is confidence-scored on the branch TARGET
// (Stage 2.5 vs Step 2.9 — structural nodes whose scores do not read the
// patient), and a Criterion's codes do not feed that score, so no JSON can
// pre-select IV first. Forcing it would take a chart fork in front of DP-3,
// which the clinical reading rules out (IV first with ACTIVE IBD, "low
// threshold" after bariatric surgery). Built as a recommendation:
// gate-malabsorption-chart (OR of includes_code, membership only) on Step 2.8 →
// Step 2.11 + Guid-6, INCLUDED next to the still-pending DP-3 question.
async function proveMalabsorption(): Promise<void> {
  console.log(`\n=== malabsorption: DP-3 criterion 3c from chart codes — recommended, not forced (${ANEMIA}) ===`);
  const REC = ['gate-malabsorption-chart', 'step-2-11', 'guid-6'];
  const confirmed = (codes: string[]) => patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]], { gestational_age_weeks: 20 }, codes);
  const empiric = (codes: string[]) => patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, codes);
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };
    for (const [code, label] of [
      ['Z98.84', 'bariatric surgery status'], ['O99.842', 'bariatric status complicating pregnancy, T2 (O99.84.*)'],
      ['K50.90', 'Crohn\'s disease (K50.*)'], ['K51.011', 'ulcerative pancolitis with rectal bleeding (K51.0.*)'],
      ['K51.90', 'ulcerative colitis, unspecified (K51.9.*)'], ['K90.0', 'celiac disease'],
      ['K90.821', 'short bowel syndrome (K90.82.*)'], ['K90.83', 'intestinal failure'],
      ['K90.9', 'intestinal malabsorption, unspecified'], ['K91.2', 'postsurgical malabsorption'],
      ['Z90.3', 'acquired absence of stomach'],
    ] as const) {
      console.log(`  ${code} ${label}, confirmed arm — recommendation shown, DP-3 still asks:`);
      const r = await resolveSession({ ...base, patient: confirmed([code]), choose: WORKUP });
      expectAll('(recommendation)', r.state, REC, 'INCLUDED');
      expect('dp-3 still asks (not forced)', status(r.state, 'dp-3'), 'PENDING_QUESTION');
      const q = r.pending.find((p: any) => p.gateId === 'dp-3') as any;
      expect('dp-3 options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP3_OPTIONS));
      expect('step-2-10 IV iron (held for DP-3)', status(r.state, 'step-2-10'), 'PENDING_QUESTION');
    }
    for (const [code, label] of [
      [null, 'no malabsorption code'], ['K51.40', 'inflammatory polyps of colon (K51.4.* deliberately excluded)'],
      ['K90.41', 'non-celiac gluten sensitivity (not listed)'],
    ] as const) {
      console.log(`  ${label}, confirmed arm — no recommendation; DP-3 asks as before:`);
      const r = await resolveSession({ ...base, patient: confirmed(code ? [code] : []), choose: WORKUP });
      expect('gate-malabsorption-chart', status(r.state, 'gate-malabsorption-chart'), 'GATED_OUT');
      expectAll('(no recommendation)', r.state, ['step-2-11', 'guid-6'], 'GATED_OUT');
      expect('dp-3', status(r.state, 'dp-3'), 'PENDING_QUESTION');
      expect('nothing asked for the code gate', String(r.pending.some((p: any) =>
        p.gateId === 'gate-malabsorption-chart' || (p.askedByNodeIds ?? []).includes('gate-malabsorption-chart'))), 'false');
    }
    console.log('  K50.90 Crohn\'s, empiric arm — the recommendation reaches the empiric arm\'s DP-3 too:');
    let r = await resolveSession({ ...base, patient: empiric(['K50.90']), replay: [EMPIRIC_CHOICE] });
    expectAll('(recommendation)', r.state, REC, 'INCLUDED');
    expect('dp-3 still asks', status(r.state, 'dp-3'), 'PENDING_QUESTION');
    console.log('  Z98.84, IV first chosen at GA 20 — IV iron; the recommendation stays on the plan:');
    r = await resolveSession({ ...base, patient: confirmed(['Z98.84']), choose: WORKUP, replay: [{ dp: 'dp-3', option: IV_FIRST }] });
    expectAll('(recommendation)', r.state, REC, 'INCLUDED');
    expect('step-2-10 IV iron', status(r.state, 'step-2-10'), 'INCLUDED');
    console.log('  Z98.84, oral trial chosen anyway — the provider\'s call stands:');
    r = await resolveSession({ ...base, patient: confirmed(['Z98.84']), choose: WORKUP, replay: [ORAL] });
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'INCLUDED');
    expect('step-2-10 IV iron', status(r.state, 'step-2-10'), 'EXCLUDED');
    console.log('  Z98.84, ferritin 50 (workup) — Stage 2 closed, no recommendation:');
    r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['2276-4', 50], ['718-7', 9.5]], {}, ['Z98.84']), choose: WORKUP });
    expectAll('(closed with Stage 2)', r.state, REC, 'GATED_OUT');
  }
}

// ── Proof: hemoglobinopathy disease — no empiric iron, the normal iron path once confirmed (v8) ──
// [DECISION — Josh 2026-09-24] v7: hemoglobinopathy disease (D57.0.*, D57.1,
// D57.2.*, D57.4.*, D57.8.*, D56.0/.1/.2/.5/.8/.9, D58.2 — LIFETIME, status any;
// traits D57.3 / D56.3 NOT listed) keeps a microcytic patient off empiric iron.
// v8: a ferritin-confirmed disease patient gets the SAME iron path as any
// confirmed IDA — only the empiric arm is skipped.
//
// Why the split moved. v7 split disease / no disease with two chart gates in
// front of DP-1 (gate-microcytic with not_includes_code ×12 → DP-1;
// gate-hgbpathy-microcytic → Step 1.8). A closing gate sweeps its whole
// containment closure at once and spares nothing, and both gates' closures
// would contain Stage 2 if either route led there — so a second route into
// Step 1.2 / Stage 2 always lost Stage 2, in both edge orders. A DecisionPoint's
// sweep DOES spare what its chosen branch contains, so the split now sits behind
// DP-1's empiric branch: gate-microcytic is MCV < 80 alone (v6's gate), and
// Stage 1.5 hosts gate-empiric-no-hgbpathy (not_includes_code ×12 → Step 2.8) and
// gate-hgbpathy-microcytic (includes_code ×12 → Step 1.8, iron studies). The
// workup branch (Step 1.2 → ferritin → Stage 2) is shared by everyone.
// Cost (flagged in the brief): DP-1 is asked again for disease patients, and its
// empiric option only opens iron studies for them.
async function proveHgbpathy(): Promise<void> {
  console.log(`\n=== hgbpathy: hemoglobinopathy disease — empiric arm closed, confirmed iron path open (${ANEMIA}) ===`);
  const labs = (mcv: number | null, fer: number | null = null): Lab[] => [
    ...(mcv === null ? [] : [['787-2', mcv] as Lab]), ...(fer === null ? [] : [['2276-4', fer] as Lab]), ['718-7', 9.5]];
  const GA20 = { gestational_age_weeks: 20 };
  const options = (pending: unknown[]) =>
    JSON.stringify([...((pending.find((p: any) => p.gateId === 'dp-1') as any)?.options ?? [])].sort());
  const HG_WORKUP = ['gate-hgbpathy-microcytic', 'step-1-8', 'lab-15', 'lab-16'];
  const EMPIRIC_ARM = [EMPIRIC, 'gate-empiric-no-hgbpathy'];
  const ORAL_PATH = ['stage-2', 'step-2-8', 'dp-3', ORAL_TRIAL, 'step-2-1', 'med-1', 'step-2-2', 'step-2-3', 'lab-10'];
  const EMPIRIC_ONLY: Replay = { dp: 'dp-1', option: EMPIRIC };
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    for (const [codes, label, stage3] of [
      [[], 'no hemoglobinopathy code', null],
      [['D57.3'], 'D57.3 sickle-cell trait', ['gate-trait', 'step-3-3']],
      [['D56.3'], 'D56.3 thalassemia minor', ['gate-trait', 'step-3-3']],
    ] as const) {
      console.log(`  ${label}, MCV 72 — DP-1 offered; empiric proceeds to DP-3 as before:`);
      let r = await resolveSession({ ...base, patient: patientWith(labs(72), GA20, [...codes]) });
      expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
      expect('dp-1 options', options(r.pending), JSON.stringify(DP1_OPTIONS));
      r = await resolveSession({ ...base, patient: patientWith(labs(72), GA20, [...codes]), replay: [EMPIRIC_ONLY] });
      expectAll('(empiric arm open)', r.state, [...EMPIRIC_ARM, 'step-2-8'], 'INCLUDED');
      expect('dp-3 asks the route', status(r.state, 'dp-3'), 'PENDING_QUESTION');
      expectAll('(Step 1.8, not this patient)', r.state, HG_WORKUP, 'GATED_OUT');
      if (stage3) expect(`${stage3[0]} fires`, status(r.state, stage3[0]), 'INCLUDED');
      if (stage3) expect(stage3[1], status(r.state, stage3[1]), 'INCLUDED');
    }

    for (const [code, label, gate, step] of [
      ['D57.1', 'sickle-cell disease without crisis', 'gate-scd', 'step-3-1'],
      ['D57.00', 'Hb-SS with crisis (D57.0.*)', 'gate-scd', 'step-3-1'],
      ['D57.40', 'sickle-cell thalassemia (D57.4.*)', 'gate-scd', 'step-3-1'],
      ['D56.1', 'beta thalassemia', 'gate-thal-major', 'step-3-2'],
      ['D58.2', 'other hemoglobinopathy (HbC / HbE disease)', null, null],
    ] as const) {
      console.log(`  ${code} ${label}, MCV 72 — DP-1 is asked (v8 cost):`);
      let r = await resolveSession({ ...base, patient: patientWith(labs(72, 12), GA20, [code]) });
      expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
      expect('dp-1 options', options(r.pending), JSON.stringify(DP1_OPTIONS));

      console.log(`  ${code}, MCV 72, ferritin 12 — confirmatory studies, oral trial: the normal iron path:`);
      r = await resolveSession({ ...base, patient: patientWith(labs(72, 12), GA20, [code]), replay: [WORKUP, ORAL] });
      expect('gate-ida-confirmed', status(r.state, 'gate-ida-confirmed'), 'INCLUDED');
      expectAll('(oral iron path)', r.state, ORAL_PATH, 'INCLUDED');
      expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), ORAL_TRIAL);
      expectAll('(empiric arm, unchosen)', r.state, [...EMPIRIC_ARM, ...HG_WORKUP], 'EXCLUDED');
      for (const g of DUE_GATES) {
        expect(`${g} not yet due (start visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
      }
      if (gate && step) {
        expect(`${gate} fires`, status(r.state, gate), 'INCLUDED');
        expect(`${step} route-out (alongside the iron path)`, status(r.state, step), 'INCLUDED');
      }

      console.log(`  ${code}, MCV 72, ferritin 50 — confirmatory studies: no iron:`);
      r = await resolveSession({ ...base, patient: patientWith(labs(72, 50), GA20, [code]), choose: WORKUP });
      expect('gate-ida-confirmed', status(r.state, 'gate-ida-confirmed'), 'GATED_OUT');
      expectAll('(no iron)', r.state, ['stage-2', 'step-2-8', 'dp-3', 'step-2-1', 'med-1', 'step-2-10', 'med-13'], 'GATED_OUT');
      expect('no dp-3 question', String(r.pending.some((p: any) => p.gateId === 'dp-3')), 'false');

      console.log(`  ${code}, MCV 72 — empiric chosen anyway: no empiric iron, iron studies instead (Step 1.8):`);
      r = await resolveSession({ ...base, patient: patientWith(labs(72), GA20, [code]), replay: [EMPIRIC_ONLY] });
      expect(EMPIRIC, status(r.state, EMPIRIC), 'INCLUDED');
      expect('gate-empiric-no-hgbpathy', status(r.state, 'gate-empiric-no-hgbpathy'), 'GATED_OUT');
      expectAll('(no empiric iron)', r.state, ['step-2-8', 'dp-3', 'step-2-1', 'med-1', 'step-2-10', 'med-13'], 'GATED_OUT');
      expect('no dp-3 question', String(r.pending.some((p: any) => p.gateId === 'dp-3')), 'false');
      expectAll('(Step 1.8 iron studies)', r.state, HG_WORKUP, 'INCLUDED');
      expect('lab-15 sits under', String(r.state.get('lab-15')?.parentNodeId), 'step-1-8');
      expect('stage-2 (unchosen DP-1 branch)', status(r.state, 'stage-2'), 'EXCLUDED');
    }

    console.log('  D58.2, MCV 72, ferritin 12 — confirmatory studies, then IV iron first at GA 20:');
    let r = await resolveSession({ ...base, patient: patientWith(labs(72, 12), GA20, ['D58.2']),
      replay: [WORKUP, { dp: 'dp-3', option: IV_FIRST }] });
    expectAll('(IV iron without a trial)', r.state, ['step-2-9', 'step-2-10', 'med-13', 'med-14'], 'INCLUDED');

    console.log('  D57.1, MCV 90 — gate-microcytic closes; no DP-1, no Step 1.8; normocytic workup:');
    r = await resolveSession({ ...base, patient: patientWith(labs(90), GA20, ['D57.1']) });
    expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'GATED_OUT');
    expect('dp-1', status(r.state, 'dp-1'), 'GATED_OUT');
    expectAll('(Step 1.8)', r.state, HG_WORKUP, 'GATED_OUT');
    expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'INCLUDED');

    console.log('  D57.1, MCV missing — one MCV question from the three MCV gates, as for any patient:');
    r = await resolveSession({ ...base, patient: patientWith(labs(null), GA20, ['D57.1']) });
    const q = r.pending.filter((p: any) => p.datumKey === 'LOINC:787-2') as any[];
    expect('one MCV question', String(q.length), '1');
    expect('asked by', JSON.stringify([...(q[0]?.askedByNodeIds ?? [])].sort()),
      JSON.stringify(['gate-macrocytic', 'gate-microcytic', 'gate-normocytic']));
    expect('dp-1 held', status(r.state, 'dp-1'), 'PENDING_QUESTION');
  }
}

// ── Proof: gestational hypertension labs, one node per host step (v2) ──
// v1 had eight LabTest nodes each ordered by three steps on different sides of
// the pathway's gates: BP (lab-1/2) by Steps 2.1, 2.2 and 4.1; platelets,
// creatinine, AST, ALT (lab-3..6) by Steps 1.2, 3.1 and 4.1; 24-hour urine
// protein and protein/creatinine ratio (lab-7/8) by Steps 1.2, 2.3a and 4.2.
// Marking is first-writer-wins and a closing gate sweeps its region at once, so
// each lab took the status of whichever host was decided first: an open step
// could lose its lab to a closed neighbour's gate, and a closed step's lab
// could leak INCLUDED through an open neighbour. Each is now split, one node
// per host; the original stays on its first host (Step 2.1 / Step 1.2).
//
// Every answer is REPLAYED one at a time, as it is asked, the way the live app
// gives it. Until engine-incremental-fix these question-gate answers had to be
// pre-loaded into one traversal: answerGateQuestion seeded the answered gate's
// whole containment closure, CodeEntry / EvidenceCitation leaves shared across
// the graph included, and promote() re-entered at a DecisionPoint that merely
// cites such a leaf — aspirin "yes" at BP 120/75 re-opened DP-1 (and, in
// reversed order, gate-no-severe-features) as PENDING_QUESTION inside the
// GATED_OUT work-up. The resolver now seeds the gate alone and the engine no
// longer treats a citing DecisionPoint as a leaf's decider.
const GHTN_LABS = {
  bp21: ['lab-1', 'lab-2'],                                        // Step 2.1 (unconditional)
  base12: ['lab-3', 'lab-4', 'lab-5', 'lab-6', 'lab-7', 'lab-8'],  // Step 1.2 (gate-aspirin-indicated)
  bp22: ['lab-12', 'lab-13'],                                      // Step 2.2 (gate-bp-elevated)
  urine23a: ['lab-14', 'lab-15'],                                  // Step 2.3a (gate-htn-confirmed, DP-1)
  sev31: ['lab-16', 'lab-17', 'lab-18', 'lab-19'],                 // Step 3.1 (gate-htn-diagnosed)
  surv41: ['lab-20', 'lab-21', 'lab-22', 'lab-23', 'lab-24', 'lab-25'], // Step 4.1 (gate-no-severe-features)
  urine42: ['lab-26', 'lab-27'],                                   // Step 4.2 (gate-gestational-htn)
};
async function proveGhtnSharedLabs(): Promise<void> {
  console.log(`\n=== ghtn-shared-labs: each lab follows its own step's gate (${GHTN}) ===`);
  const L = GHTN_LABS;
  const NORMAL_BP = { systolic_bp: 120, diastolic_bp: 75 };
  const HIGH_BP = { systolic_bp: 150, diastolic_bp: 95 };   // ≥140/90, below the 160/110 severe range
  const LABS: Array<[string, number]> = [['777-3', 220], ['2160-0', 0.7]]; // no objective severe feature
  /** Diagnosed and confirmed, aspirin not indicated; severe feature on assessment or not. */
  /** A question gate's answer, given when it is asked. */
  const q = (gate: string, answer: GateAnswer): Replay => ({ gate, answer });
  /** Quantitative proteinuria chosen at DP-1, once DP-1 is asked. */
  const QUANTITATIVE: Replay = { dp: 'dp-1', option: 'step-2-3a' };
  /** Diagnosed and confirmed, aspirin not indicated; severe feature on assessment or not. */
  const diagnosed = (severe: boolean): Replay[] => [
    q('gate-aspirin-indicated', NO),
    q('gate-htn-confirmed', YES),
    q('gate-severe-feature-symptoms', severe ? YES : NO),
    q('gate-no-severe-features', severe ? NO : YES),
    QUANTITATIVE,
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const run = (codes: string[], vitals: Record<string, number>, ask: Replay[]) =>
      resolveSession({ file: GHTN, reverse, patient: patientOf({ codes, labs: LABS, vitals }), ask });

    // gate-bp-elevated closes Step 2.2 and everything downstream of it. v1: the
    // Step 1.2 baseline panel and the Step 2.1 BP readings were also in that
    // region (via 3.1 / 4.1 / 2.3a / 4.2 and 2.2), so they could go GATED_OUT.
    console.log('  aspirin indicated, BP 120/75 — baseline labs ordered, nothing downstream:');
    let r = await run([], NORMAL_BP, [q('gate-aspirin-indicated', YES)]);
    // The reported replay defect: this answer re-opened DP-1 in the gated-out work-up.
    expect('dp-1 (gated-out work-up)', status(r.state, 'dp-1'), 'GATED_OUT');
    expect('gate-no-severe-features (gated-out Stage 4)', status(r.state, 'gate-no-severe-features'), 'GATED_OUT');
    expect('questions left', JSON.stringify(r.pending.map((p: any) => p.gateId)), '[]');
    expect('step-1-2 baseline labs', status(r.state, 'step-1-2'), 'INCLUDED');
    expectAll('(Step 1.2)', r.state, L.base12, 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expect('step-2-2 confirm HTN', status(r.state, 'step-2-2'), 'GATED_OUT');
    expectAll('(Step 2.2)', r.state, L.bp22, 'GATED_OUT');
    for (const k of ['urine23a', 'sev31', 'surv41', 'urine42'] as const) expectAll(`(${k})`, r.state, L[k], 'GATED_OUT');

    // gate-htn-confirmed "no" closes the work-up. v1: the Step 2.1/2.2 BP
    // readings were also Step 4.1's, inside that region.
    console.log('  aspirin not indicated, BP 150/95, hypertension NOT confirmed:');
    r = await run([], HIGH_BP, [q('gate-aspirin-indicated', NO), q('gate-htn-confirmed', NO)]);
    expect('step-2-2 confirm HTN', status(r.state, 'step-2-2'), 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expectAll('(Step 2.2)', r.state, L.bp22, 'INCLUDED');
    expect('stage-2-workup', status(r.state, 'stage-2-workup'), 'GATED_OUT');
    expectAll('(Step 1.2, aspirin gate is its only route)', r.state, L.base12, 'GATED_OUT');
    for (const k of ['urine23a', 'sev31', 'surv41', 'urine42'] as const) expectAll(`(${k})`, r.state, L[k], 'GATED_OUT');

    // Aspirin "no" is now the only route to the Step 1.2 panel. v1: Steps 3.1,
    // 4.1, 2.3a and 4.2 ordered the same nodes, so they leaked INCLUDED.
    console.log('  aspirin not indicated, gestational HTN (O13.3), quantitative proteinuria, no severe features:');
    r = await run(['O13.3'], HIGH_BP, diagnosed(false));
    expect('gate-htn-diagnosed', status(r.state, 'gate-htn-diagnosed'), 'INCLUDED');
    expect('step-1-2 baseline labs', status(r.state, 'step-1-2'), 'GATED_OUT');
    expectAll('(Step 1.2, aspirin gate is its only route)', r.state, L.base12, 'GATED_OUT');
    for (const k of ['bp21', 'bp22', 'urine23a', 'sev31', 'surv41', 'urine42'] as const) {
      expectAll(`(${k})`, r.state, L[k], 'INCLUDED');
    }
    expect('step-4-2 weekly proteinuria', status(r.state, 'step-4-2'), 'INCLUDED');

    // gate-gestational-htn closes Step 4.2 for preeclampsia. v1: its urine
    // protein labs were also Step 2.3a's (open) — a race.
    console.log('  preeclampsia (O14.03), no severe features — weekly proteinuria stops, diagnostic one stays:');
    r = await run(['O14.03'], HIGH_BP, diagnosed(false));
    expect('gate-gestational-htn', status(r.state, 'gate-gestational-htn'), 'GATED_OUT');
    expectAll('(Step 4.2)', r.state, L.urine42, 'GATED_OUT');
    expectAll('(Step 2.3a)', r.state, L.urine23a, 'INCLUDED');
    expectAll('(Step 4.1)', r.state, L.surv41, 'INCLUDED');

    // gate-no-severe-features closes Stage 4. v1: the Step 4.1 surveillance
    // labs were the Step 3.1 severity panel and the Step 2.1/2.2 BP readings.
    console.log('  gestational HTN (O13.3), severe feature on assessment — no outpatient surveillance:');
    r = await run(['O13.3'], HIGH_BP, diagnosed(true));
    expect('stage-4 outpatient surveillance', status(r.state, 'stage-4'), 'GATED_OUT');
    expectAll('(Step 4.1)', r.state, L.surv41, 'GATED_OUT');
    expectAll('(Step 4.2)', r.state, L.urine42, 'GATED_OUT');
    expectAll('(Step 3.1)', r.state, L.sev31, 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expectAll('(Step 2.2)', r.state, L.bp22, 'INCLUDED');
  }
}

// ── Proof: GHTN v4 seizure instruction follows Step 4.4 ──────────────
// [DECISION — Josh 2026-09-24] Guid-5 "Seizure: call 911" (PB 222) is its own
// GHTN-only Guidance node on Step 4.4, next to Guid-1 (the shared warning-signs
// reference, left byte-identical to routine-prenatal-care's). Step 4.4 is
// gated by gate-no-severe-features, so Guid-5 reaches the patients managed as
// outpatients and follows that gate — never a severe-feature patient's plan.
// ── Proof: anemia v10 — no hemoglobin level on file ──────────────────
// [DECISION — Josh 2026-10-03]: ask the provider for a level; if none is
// entered, the severity is unknown and the anemia labs are ordered.
async function proveUnknownHgb(): Promise<void> {
  console.log(`\n=== unknown-hgb: anemia v10 — no hemoglobin on file (${ANEMIA}) ===`);
  const HGB = 'LOINC:718-7';
  const HCT = 'LOINC:4544-3';
  const ORDERS = ['gate-no-hgb-on-file', 'step-1-9', 'lab-18'];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const noLevel = patientWith([['787-2', 72]]);

    console.log('  no Hgb on file: the level is asked for, and the anemia labs are ordered meanwhile:');
    let r = await resolveSession({ file: ANEMIA, reverse, patient: noLevel });
    expect('Hgb questions', String(r.pending.filter((p: any) => p.datumKey === HGB).length), '1');
    expectAll('(order ferritin)', r.state, ORDERS, 'INCLUDED');
    expect('lab-1 CBC with indices (Step 1.1, unconditional)', status(r.state, 'lab-1'), 'INCLUDED');
    expect('gate-severe-anemia', status(r.state, 'gate-severe-anemia'), 'PENDING_QUESTION');

    console.log('  "Not available" for the Hgb (and the Hct the referral gate also reads): nothing left to ask about the level:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: noLevel, replay: [{ decline: HGB }], ask: [{ decline: HCT }] });
    expect('level questions left', String(r.pending.filter((p: any) => [HGB, HCT].includes(p.datumKey)).length), '0');
    expect('gate-severe-anemia', status(r.state, 'gate-severe-anemia'), 'GATED_OUT');
    expect('gate-referral-threshold', status(r.state, 'gate-referral-threshold'), 'GATED_OUT');
    expectAll('(order ferritin)', r.state, ORDERS, 'INCLUDED');
    expect('lab-1 CBC with indices', status(r.state, 'lab-1'), 'INCLUDED');
    expect('level gates among the generation blockers',
      String(validateForGeneration(r.state, r.redFlags).some((b) => b.relatedNodeIds.some((id) => /severe-anemia|referral-threshold/.test(id)))), 'false');

    console.log('  a level entered instead (Hgb 9.5, 4 days old): Step 1.9 closes, the CBC stays:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 9.5, '2026-09-20']]) });
    expect('Hgb questions', String(r.pending.filter((p: any) => p.datumKey === HGB).length), '0');
    expectAll('(no ferritin order from Step 1.9)', r.state, ['step-1-9', 'lab-18'], 'GATED_OUT');
    expect('gate-no-hgb-on-file', status(r.state, 'gate-no-hgb-on-file'), 'GATED_OUT');
    expect('lab-1 CBC with indices', status(r.state, 'lab-1'), 'INCLUDED');
  }
}

// ── Proof: anemia v13 — most recent hemoglobin, recheck when over 30 days old ──
// [DECISION — Josh 2026-10-03]: "it should be most recent but > 30 days should
// trigger recheck". The chart that prompted it: Hgb 8 g/dL dated 33 days before
// the visit, which v12's 7-day gate-severe-anemia could not see, so it asked.
async function proveHgbRecheck(): Promise<void> {
  console.log(`\n=== hgb-recheck: anemia v13 — most recent Hgb decides; over 30 days old → repeat CBC (${ANEMIA}) ===`);
  const HGB = 'LOINC:718-7';
  const DAYS_33 = '2026-08-22'; // 33 days before AS_OF (2026-09-24)
  const DAYS_10 = '2026-09-14'; // 10 days before AS_OF
  const DAYS_120 = '2026-05-27'; // 120 days before AS_OF
  const RECHECK = ['gate-hgb-recheck-due', 'step-1-13', 'lab-25'];
  const UNKNOWN = ['gate-no-hgb-on-file', 'step-1-9', 'lab-18'];
  const hgbQuestions = (r: { pending: any[] }) => String(r.pending.filter((p: any) => p.datumKey === HGB).length);
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);

    console.log('  Hgb 8, 33 days old, MCV 72: nothing asked about the level; referral yes, transfusion no; repeat CBC ordered:');
    let r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 8, DAYS_33]]) });
    expect('Hgb questions', hgbQuestions(r), '0');
    expect('gate-severe-anemia (8 is not < 6)', status(r.state, 'gate-severe-anemia'), 'GATED_OUT');
    expect('step-3-6 transfusion consideration', status(r.state, 'step-3-6'), 'GATED_OUT');
    expect('gate-referral-threshold (8 < 9)', status(r.state, 'gate-referral-threshold'), 'INCLUDED');
    expect('step-3-7 specialist referral', status(r.state, 'step-3-7'), 'INCLUDED');
    expectAll('(repeat CBC)', r.state, RECHECK, 'INCLUDED');
    expectAll('(level is not unknown)', r.state, UNKNOWN, 'GATED_OUT');
    expect('lab-1 CBC with indices (Step 1.1, unconditional)', status(r.state, 'lab-1'), 'INCLUDED');

    console.log('  Hgb 5.5, 33 days old: transfusion consideration opens on the old value, and the CBC is repeated:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 5.5, DAYS_33]]) });
    expect('Hgb questions', hgbQuestions(r), '0');
    expect('gate-severe-anemia (5.5 < 6)', status(r.state, 'gate-severe-anemia'), 'INCLUDED');
    expect('step-3-6 transfusion consideration', status(r.state, 'step-3-6'), 'INCLUDED');
    expect('gate-referral-threshold (5.5 < 9)', status(r.state, 'gate-referral-threshold'), 'INCLUDED');
    expectAll('(repeat CBC)', r.state, RECHECK, 'INCLUDED');
    expectAll('(level is not unknown)', r.state, UNKNOWN, 'GATED_OUT');

    // gate-no-hgb-on-file is unchanged in v13 (90 days), so a value older than
    // that opens Step 1.9 as well — the brief's [JOSH — CONFIRM] on that gate.
    console.log('  Hgb 8, 120 days old: still decides the threshold gates, nothing asked; recheck AND Step 1.9 (no Hgb in 90 days) open:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 8, DAYS_120]]) });
    expect('Hgb questions', hgbQuestions(r), '0');
    expect('gate-severe-anemia', status(r.state, 'gate-severe-anemia'), 'GATED_OUT');
    expect('gate-referral-threshold (8 < 9)', status(r.state, 'gate-referral-threshold'), 'INCLUDED');
    expectAll('(repeat CBC)', r.state, RECHECK, 'INCLUDED');
    expectAll('(none in 90 days: ferritin)', r.state, UNKNOWN, 'INCLUDED');

    console.log('  Hgb 8, 10 days old: nothing asked, no recheck:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 8, DAYS_10]]) });
    expect('Hgb questions', hgbQuestions(r), '0');
    expect('gate-severe-anemia', status(r.state, 'gate-severe-anemia'), 'GATED_OUT');
    expect('gate-referral-threshold', status(r.state, 'gate-referral-threshold'), 'INCLUDED');
    expectAll('(no repeat CBC)', r.state, RECHECK, 'GATED_OUT');
    expectAll('(level is not unknown)', r.state, UNKNOWN, 'GATED_OUT');
    expect('lab-1 CBC with indices', status(r.state, 'lab-1'), 'INCLUDED');

    console.log('  Hgb 8, undated (asserted current): nothing asked, no recheck:');
    r = await resolveSession({ file: ANEMIA, reverse, patient: patientWith([['787-2', 72], ['718-7', 8]]) });
    expect('Hgb questions', hgbQuestions(r), '0');
    expectAll('(no repeat CBC)', r.state, RECHECK, 'GATED_OUT');

    console.log('  no Hgb at all: the level is still ASKED for; the CBC recheck and Step 1.9\'s ferritin are both open:');
    const noLevel = patientWith([['787-2', 72]]);
    r = await resolveSession({ file: ANEMIA, reverse, patient: noLevel });
    expect('Hgb questions', hgbQuestions(r), '1');
    expect('gate-severe-anemia', status(r.state, 'gate-severe-anemia'), 'PENDING_QUESTION');
    expectAll('(repeat CBC)', r.state, RECHECK, 'INCLUDED');
    expectAll('(order ferritin)', r.state, UNKNOWN, 'INCLUDED');

    console.log('  the provider answers the question with Hgb 8 (a value as of today): the recheck and Step 1.9 close:');
    const answered = await supplyLab(r, noLevel, { code: '718-7', value: 8 });
    expect('Hgb questions', String(answered.pending.filter((p: any) => p.datumKey === HGB).length), '0');
    expect('gate-referral-threshold (8 < 9)', status(answered.state, 'gate-referral-threshold'), 'INCLUDED');
    expectAll('(no repeat CBC)', answered.state, RECHECK, 'GATED_OUT');
    expectAll('(level is not unknown)', answered.state, UNKNOWN, 'GATED_OUT');
  }
}

async function proveGhtnSeizure(): Promise<void> {
  console.log(`\n=== ghtn-seizure: Guid-5 "Seizure: call 911" on Step 2.1 — every patient (${GHTN}) ===`);
  const pw = JSON.parse(readFileSync(resolve(GHTN), 'utf8'));
  const g5 = pw.nodes.find((n: any) => n.id === 'guid-5');
  const g1 = pw.nodes.find((n: any) => n.id === 'guid-1');
  expect('guid-5 topic', String(g5?.properties?.topic), 'Seizure: call 911');
  expect('guid-5 is its own node (guid-1 text has no seizure line)', String(/seizure/i.test(g1?.properties?.instructions ?? '')), 'false');
  expect('guid-5 has one host', JSON.stringify(pw.edges.filter((e: any) => e.to === 'guid-5' && e.type === 'HAS_GUIDANCE').map((e: any) => e.from)), '["step-2-1"]');
  const q = (gate: string, answer: GateAnswer): Replay => ({ gate, answer });
  const diagnosed = (severe: boolean): Replay[] => [
    q('gate-aspirin-indicated', NO),
    q('gate-htn-confirmed', YES),
    q('gate-severe-feature-symptoms', severe ? YES : NO),
    q('gate-no-severe-features', severe ? NO : YES),
    { dp: 'dp-1', option: 'step-2-3a' },
  ];
  const HIGH_BP = { systolic_bp: 150, diastolic_bp: 95 };
  const LABS: Array<[string, number]> = [['777-3', 220], ['2160-0', 0.7]];
  const seizureLine = (r: { state: any }) => {
    expect('guid-5 seizure line', status(r.state, 'guid-5'), 'INCLUDED');
    expect('guid-5 sits under', String(r.state.get('guid-5')?.parentNodeId), 'step-2-1');
  };
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const run = (codes: string[], vitals: Record<string, number>, ask: Replay[]) =>
      resolveSession({ file: GHTN, reverse, patient: patientOf({ codes, labs: LABS, vitals }), ask });

    console.log('  gestational HTN (O13.3), no severe features — outpatient: seizure line + the warning signs:');
    let r = await run(['O13.3'], HIGH_BP, diagnosed(false));
    seizureLine(r);
    expect('step-4-4 safety-netting', status(r.state, 'step-4-4'), 'INCLUDED');
    expect('guid-1 warning signs (Step 4.4)', status(r.state, 'guid-1'), 'INCLUDED');

    console.log('  preeclampsia (O14.03), no severe features — same:');
    r = await run(['O14.03'], HIGH_BP, diagnosed(false));
    seizureLine(r);
    expect('guid-1 warning signs (Step 4.4)', status(r.state, 'guid-1'), 'INCLUDED');

    console.log('  gestational HTN, severe feature on assessment — Stage 4 closed, escalated; seizure line still shown (v5):');
    r = await run(['O13.3'], HIGH_BP, diagnosed(true));
    expect('stage-4', status(r.state, 'stage-4'), 'GATED_OUT');
    expect('guid-1 warning signs (Step 4.4, closed with Stage 4)', status(r.state, 'guid-1'), 'GATED_OUT');
    expect('step-3-2 severe feature — immediate evaluation', status(r.state, 'step-3-2'), 'INCLUDED');
    seizureLine(r);

    console.log('  postpartum — preeclampsia complicating the puerperium (O14.05), diagnosed: postpartum BP follow-up + seizure line (v5):');
    r = await run(['O14.05'], HIGH_BP, diagnosed(false));
    expect('step-5-2 postpartum BP follow-up', status(r.state, 'step-5-2'), 'INCLUDED');
    seizureLine(r);

    console.log('  postpartum, severe feature — escalated, postpartum follow-up; seizure line still shown:');
    r = await run(['O14.05'], HIGH_BP, diagnosed(true));
    expect('step-5-2 postpartum BP follow-up', status(r.state, 'step-5-2'), 'INCLUDED');
    expect('stage-4', status(r.state, 'stage-4'), 'GATED_OUT');
    seizureLine(r);

    console.log('  BP 120/75, aspirin indicated — no hypertensive disorder: the seizure line is shown too (every patient, v5):');
    r = await run([], { systolic_bp: 120, diastolic_bp: 75 }, [q('gate-aspirin-indicated', YES)]);
    seizureLine(r);
    expect('guid-1 warning signs (Step 4.4)', status(r.state, 'guid-1'), 'GATED_OUT');
  }
}

// ── Proof: UTI in pregnancy labs, one node per host step (v2) ─────────
// v1 shared three LabTest nodes across hosts: the urine culture (lab-1) on
// Steps 1.1, 2.1 and the test-of-cure repeat culture (step-5-2a); organism
// identification (lab-2) on Step 2.1 and Step 4.1 (GBS arm); susceptibility
// (lab-3) on Step 3.1 and suppressive prophylaxis (step-5-3). Same defect as
// ghtn-shared-labs, same split. Answers replayed as asked, like ghtn (see the
// comment above GHTN_LABS): "no GBS" on a negative culture used to re-open
// DP-1 in reversed edge order.
//
// v3 [DECISION — Josh 2026-09-24]: v2's Step 2.1 culture (lab-7) was the same
// test on the same specimen as the Step 1.1 screening culture (lab-1), and both
// steps are unconditional, so every care plan listed the culture twice. v3
// removes lab-7: lab-1 has two host steps, 1.1 and 2.1. That is safe only
// because both hosts always apply — no gate can close one and take the other's
// lab. Its parentNodeId then depends on edge order (whichever host the walk
// reaches first), so the proof pins it per order. The test-of-cure culture
// (lab-8, step-5-2a) stays separate: its host is gated.
const UTI_LABS = {
  culture: ['lab-1'],     // Steps 1.1 + 2.1 screening/interpreted culture (both unconditional; v3)
  culture52a: ['lab-8'],  // step-5-2a repeat culture (gate-symptomatic, DP-1 criterion 1a)
  organism21: ['lab-2'],  // Step 2.1 (unconditional)
  organism41: ['lab-9'],  // Step 4.1 (gate-gbs-identified)
  suscept31: ['lab-3'],   // Step 3.1 (gate-culture-positive)
  suscept53: ['lab-10'],  // step-5-3 suppressive prophylaxis (gate-recurrent-uti)
};
async function proveUtiSharedLabs(): Promise<void> {
  console.log(`\n=== uti-shared-labs: each lab follows its own step's gate (${UTI}) ===`);
  const L = UTI_LABS;
  const AFEBRILE = { temperature_f: 98.6 };
  const NEGATIVE: Array<[string, number]> = [['19090-0', 1000]];    // < 10^5 CFU/mL
  const POSITIVE: Array<[string, number]> = [['19090-0', 150000]];  // ≥ 10^5 CFU/mL
  const TWO_UTIS = [{ code: 'O23.42', date: '2026-07-01' }, { code: 'O23.42', date: '2026-09-01' }];
  const q = (gate: string, answer: GateAnswer): Replay => ({ gate, answer });
  const REPEAT_CULTURE: Replay = { dp: 'dp-1', option: 'step-5-2a' };
  /** Culture positive, treated; the other questions as given, each when asked. */
  const treated = (a: { symptomatic: boolean; gbs: boolean; completed: boolean }): Replay[] => [
    q('gate-symptomatic', a.symptomatic ? YES : NO),
    q('gate-gbs-identified', a.gbs ? YES : NO),
    ...(a.gbs ? [q('gate-gbs-treat-threshold', NO)] : []),
    q('gate-first-trimester', NO),
    ...(a.symptomatic ? [REPEAT_CULTURE] : []),
    q('gate-treatment-completed', a.completed ? YES : NO),
  ];
  // Every urine-culture LabTest node in the file (LOINC 19090-0). The care plan
  // lists each INCLUDED one, so this count is how many times it shows the culture.
  const CULTURE_IDS: string[] = JSON.parse(readFileSync(resolve(UTI), 'utf8')).nodes
    .filter((n: any) => n.type === 'LabTest' && n.properties?.code === '19090-0').map((n: any) => n.id);
  const culturesListed = (s: Map<string, { status: string }>) =>
    String(CULTURE_IDS.filter((id) => status(s, id) === 'INCLUDED').length);
  console.log(`  urine-culture LabTest nodes: ${CULTURE_IDS.join(', ')}`);
  expect('lab-7 (v2 Step 2.1 culture) removed', CULTURE_IDS.includes('lab-7') ? 'present' : 'absent', 'absent');
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    /** The one Step 1.1/2.1 culture sits under whichever host the walk reaches
     *  first: Step 1.1 (Stage 1) in file order, Step 2.1 (Stage 2) reversed. */
    const CULTURE_HOST = reverse ? 'step-2-1' : 'step-1-1';
    const run = (codes: Array<string | { code: string; date: string }>, labs: Array<[string, number]>,
      ask: Replay[]) =>
      resolveSession({ file: UTI, reverse, patient: patientOf({ codes, labs, vitals: AFEBRILE }), ask });

    // Culture negative closes Stage 3 and Step 2.2 (and with it test of cure);
    // GBS "no" closes Stage 4. v1: the Step 1.1 / 2.1 culture was also
    // step-5-2a's, and the Step 2.1 organism ID was also Step 4.1's.
    console.log('  culture negative (1,000 CFU/mL), no GBS — screening and interpretation only:');
    let r = await run([], NEGATIVE, [q('gate-gbs-identified', NO)]);
    expect('gate-culture-positive', status(r.state, 'gate-culture-positive'), 'GATED_OUT');
    expectAll('(Steps 1.1 + 2.1)', r.state, [...L.culture, ...L.organism21], 'INCLUDED');
    expect('lab-1 sits under', String(r.state.get('lab-1')?.parentNodeId), CULTURE_HOST);
    expect('urine cultures listed (v2: 2)', culturesListed(r.state), '1');
    expectAll('(step-5-2a)', r.state, L.culture52a, 'GATED_OUT');
    expectAll('(Step 4.1)', r.state, L.organism41, 'GATED_OUT');
    expectAll('(Step 3.1)', r.state, L.suscept31, 'GATED_OUT');
    expectAll('(step-5-3)', r.state, L.suscept53, 'GATED_OUT');

    // Symptomatic cystitis, repeat culture chosen, course not yet complete:
    // gate-treatment-completed closes Stage 5. v1: the Step 3.1 susceptibility
    // test was also step-5-3's, inside that region.
    console.log('  culture positive, symptomatic, repeat culture chosen, course NOT completed:');
    r = await run([], POSITIVE, treated({ symptomatic: true, gbs: false, completed: false }));
    expect('step-5-2a repeat culture', status(r.state, 'step-5-2a'), 'INCLUDED');
    expectAll('(Steps 1.1 + 2.1)', r.state, [...L.culture, ...L.organism21], 'INCLUDED');
    expectAll('(step-5-2a)', r.state, L.culture52a, 'INCLUDED');
    expect('urine cultures listed (screen + test of cure; v2: 3)', culturesListed(r.state), '2');
    expectAll('(Step 3.1)', r.state, L.suscept31, 'INCLUDED');
    expect('stage-5 follow-up', status(r.state, 'stage-5'), 'GATED_OUT');
    expectAll('(step-5-3)', r.state, L.suscept53, 'GATED_OUT');
    expectAll('(Step 4.1)', r.state, L.organism41, 'GATED_OUT');
    // The care plan places an intervention by its parentNodeId chain. v1's one
    // culture node could land under step-5-2a (the test-of-cure choice), which
    // moved the screening culture into Stage 5; test of cure now has its own
    // (lab-8). v3's lab-1 sits under Step 1.1 or 2.1 by edge order — both
    // unconditional, so either placement is correct; the proof pins which.
    for (const [id, host] of [['lab-1', CULTURE_HOST], ['lab-8', 'step-5-2a'],
      ['lab-2', 'step-2-1'], ['lab-3', 'step-3-1']] as Array<[string, string | string[]]>) {
      expect(`${id} sits under`, String(r.state.get(id)?.parentNodeId), host);
    }

    // Asymptomatic bacteriuria: gate-symptomatic closes test of cure.
    console.log('  culture positive, asymptomatic — no test of cure:');
    r = await run([], POSITIVE, treated({ symptomatic: false, gbs: false, completed: true }));
    expect('step-5-2 test of cure', status(r.state, 'step-5-2'), 'GATED_OUT');
    expectAll('(step-5-2a)', r.state, L.culture52a, 'GATED_OUT');
    expectAll('(Steps 1.1 + 2.1)', r.state, L.culture, 'INCLUDED');
    expect('urine cultures listed', culturesListed(r.state), '1');

    // GBS arm open: Step 4.1's own organism ID is included with Step 2.1's.
    console.log('  culture positive, GBS identified:');
    r = await run([], POSITIVE, treated({ symptomatic: false, gbs: true, completed: false }));
    expect('step-4-1 GBS notation', status(r.state, 'step-4-1'), 'INCLUDED');
    expectAll('(Step 4.1)', r.state, L.organism41, 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.organism21, 'INCLUDED');
    expect('lab-9 sits under', String(r.state.get('lab-9')?.parentNodeId), 'step-4-1');

    // Course completed; recurrence decides suppressive prophylaxis.
    console.log('  course completed, one UTI this pregnancy — no suppression, treatment susceptibility stays:');
    r = await run([], POSITIVE, treated({ symptomatic: false, gbs: false, completed: true }));
    expect('gate-recurrent-uti', status(r.state, 'gate-recurrent-uti'), 'GATED_OUT');
    expectAll('(step-5-3)', r.state, L.suscept53, 'GATED_OUT');
    expectAll('(Step 3.1)', r.state, L.suscept31, 'INCLUDED');

    console.log('  course completed, two dated O23 episodes this pregnancy — suppressive prophylaxis:');
    r = await run(TWO_UTIS, POSITIVE, treated({ symptomatic: false, gbs: false, completed: true }));
    expect('gate-recurrent-uti', status(r.state, 'gate-recurrent-uti'), 'INCLUDED');
    expect('step-5-3 suppressive prophylaxis', status(r.state, 'step-5-3'), 'INCLUDED');
    expectAll('(step-5-3)', r.state, L.suscept53, 'INCLUDED');
    expectAll('(Step 3.1)', r.state, L.suscept31, 'INCLUDED');
    expect('lab-10 sits under', String(r.state.get('lab-10')?.parentNodeId), 'step-5-3');
  }
}

// ── Proof: anemia v12 — already on iron: skip the iron choices ────────
// [DECISION — Josh 2026-10-03] "1. not necessarily. 2. all oral iron
// supplements based on what's written. 3. yes, skip". gate-microcytic now
// opens Step 1.10, which reads the medication list through three membership
// gates (exact complements; nothing is ever asked): no iron → Step 1.7 / DP-1
// as before; oral iron and no IV iron → Step 2.14; IV iron → Step 2.18.
async function proveOnIron(): Promise<void> {
  console.log(`\n=== on-iron: anemia v12 — iron already on the medication list (${ANEMIA}) ===`);
  const ORAL_CODES = ['310325', '198630', '284202', '311975'];
  const IV_CODES = ['1741261', '2274409', '1435169', '1311224', '206216'];
  const SPLIT = ['gate-no-iron-on-list', 'gate-on-oral-iron', 'gate-iv-iron-on-list'];
  const ORAL_MEDS = ['med-1', 'med-2', 'med-3', 'med-11'];
  const IV_MEDS = ['med-4', 'med-5', 'med-6', 'med-7', 'med-13', 'med-14', 'med-15', 'med-16', 'med-17', 'med-18', 'med-19', 'med-20'];
  /** The iron choices' own content: DP-1's host and everything DP-1 / DP-3 lead to. */
  const CHOICES = ['step-1-7', 'dp-1', 'stage-2-empiric', 'step-1-2', 'stage-2', 'step-2-8', 'dp-3', 'stage-2-oral', 'step-2-9',
    'step-2-1', 'step-2-2', 'step-2-3', ...DUE_GATES, ...RECHECK, ...UNMEASURABLE, 'step-2-22', 'gate-hgb-response', 'gate-hgb-nonresponse', 'step-2-4', 'step-2-6', 'step-2-10'];
  const CONTINUE = ['step-2-14', 'guid-7', 'lab-19', 'sched-7'];
  const COPIES = ['gate-hgb-response-on-iron', 'gate-hgb-nonresponse-on-iron'];
  const ESCALATION = ['step-2-16', 'dp-4', 'crit-4a', 'crit-4b', 'crit-4c', 'crit-4d', 'step-1-11', 'lab-20', 'lab-21', 'gate-iv-iron-ga-on-iron', 'step-2-17',
    'med-17', 'med-18', 'med-19', 'med-20', 'sched-8'];
  const STUDIES = ['step-1-12', 'lab-22', 'lab-23'];
  const ROUTE_A = [...CONTINUE, ...DUE_GATES_ON_IRON, ...RECHECK_ON_IRON, ...UNMEASURABLE_ON_IRON, 'step-2-20', ...COPIES, 'gate-confirm-studies-on-iron', ...STUDIES, 'step-2-15', ...ESCALATION];
  const ROUTE_B = ['step-2-18', 'guid-8', 'lab-24', 'sched-9'];
  const CONFIRM = 'gate-confirm-studies-on-iron';
  const dpAsked = (pending: unknown[]) => String(pending.some((p: any) => ['dp-1', 'dp-3', 'dp-4'].includes(p.gateId)));
  const included = (state: Map<string, { status: string }>, ids: string[]) =>
    JSON.stringify(ids.filter((id) => status(state, id) === 'INCLUDED'));
  /** Exactly one of the three medication-list gates is open. */
  const split = (state: Map<string, { status: string }>, open: string) => {
    for (const g of SPLIT) expect(g, status(state, g), g === open ? 'INCLUDED' : 'GATED_OUT');
  };
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    // ── A: already on oral iron ──
    console.log('  A. ferrous sulfate (310325, undated — as the simulator sends it), MCV 72, Hgb 9.5, GA 20 — no DP-1, no DP-3; continue; the start date is asked:');
    const onOral = patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [['310325']]);
    let r = await resolveSession({ ...base, patient: onOral });
    expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'INCLUDED');
    expect('step-1-10 (medication-list split)', status(r.state, 'step-1-10'), 'INCLUDED');
    split(r.state, 'gate-on-oral-iron');
    expect('dp-1 / dp-3 asked', dpAsked(r.pending), 'false');
    expectAll('(the iron choices are closed)', r.state, CHOICES, 'GATED_OUT');
    expect('oral-iron Medication nodes INCLUDED', included(r.state, ORAL_MEDS), '[]');
    expect('IV-iron Medication nodes INCLUDED', included(r.state, IV_MEDS), '[]');
    expectAll('(continue current oral iron)', r.state, CONTINUE, 'INCLUDED');
    expect('step-2-14 sits under', String(r.state.get('step-2-14')?.parentNodeId), 'gate-on-oral-iron');
    expectAll('(route B closed)', r.state, ROUTE_B, 'GATED_OUT');
    // No oral-iron Medication node is recommended, so the session cannot anchor
    // the window; the order is undated, so the start date is asked — once.
    let dq = r.pending.filter((p: any) => p.datumKey === ORAL_IRON_ANCHOR) as any[];
    expect('start-date questions', String(dq.length), '1');
    expect('prompt', String(dq[0]?.prompt), 'When did oral iron start?');
    expect('asked by the two gates that ask (gate-rechecked-on-iron never asks; the copies sit behind it)', JSON.stringify([dq[0]?.gateId, ...(dq[0]?.askedByNodeIds ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).sort()),
      JSON.stringify(['gate-response-recheck-due-on-iron', 'gate-rise-unmeasurable-on-iron']));
    expect('gate-response-recheck-due-on-iron', status(r.state, 'gate-response-recheck-due-on-iron'), 'PENDING_QUESTION');
    expectAll('(closed until the start date is answered)', r.state, ['gate-rechecked-on-iron', 'step-2-20', ...COPIES], 'GATED_OUT');
    expect('questions about a hemoglobin value', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length), '0');
    const cq = r.pending.filter((p: any) => p.gateId === CONFIRM) as any[];
    expect('confirmatory-studies questions', String(cq.length), '1');
    expect('prompt', String(cq[0]?.prompt), 'She is already on oral iron. Order confirmatory iron studies (ferritin, iron/TIBC/saturation) now?');
    expectAll('(held on the question)', r.state, STUDIES, 'PENDING_QUESTION');
    expect('the question holds the care plan until answered', String(validateForGeneration(r.state, r.redFlags)
      .some((b) => b.relatedNodeIds.includes(CONFIRM))), 'true');

    console.log('    "Order confirmatory iron studies now?" — yes: ferritin and iron/TIBC/saturation ordered:');
    r = await resolveSession({ ...base, patient: onOral, ask: [{ gate: CONFIRM, answer: YES }] });
    expectAll('(yes)', r.state, [CONFIRM, ...STUDIES], 'INCLUDED');
    expect('lab-22 sits under', String(r.state.get('lab-22')?.parentNodeId), 'step-1-12');
    expect('step-1-2 microcytic workup (DP-1\'s — not this one)', status(r.state, 'step-1-2'), 'GATED_OUT');
    expectAll('(continue stays)', r.state, CONTINUE, 'INCLUDED');
    console.log('    …no: not ordered, and nothing else changes:');
    r = await resolveSession({ ...base, patient: onOral, ask: [{ gate: CONFIRM, answer: NO }] });
    expectAll('(no)', r.state, [CONFIRM, ...STUDIES], 'GATED_OUT');
    expectAll('(continue stays)', r.state, CONTINUE, 'INCLUDED');
    expect('oral-iron Medication nodes INCLUDED', included(r.state, ORAL_MEDS), '[]');
    expect('dp-1 / dp-3 asked', dpAsked(r.pending), 'false');

    // The simulator flow — and the dead end Josh hit on 2026-10-04: the start date
    // answered (21 days before the proof clock), one undated Hgb on the chart. An
    // undated value has no draw date, so it is not "drawn since oral iron started".
    // Through v13 the copies then asked for "a result, and the date it was drawn?",
    // and "Not available" closed both with nothing on the route. v14: nothing is
    // asked; Step 2.19 orders the response recheck (full scenario: `response-recheck`).
    console.log('    …the start date answered 2026-09-03, only an undated Hgb on the chart — v14: no hemoglobin question; Step 2.19 orders the recheck:');
    r = await resolveSession({ ...base, patient: onOral, ask: [{ gate: CONFIRM, answer: NO },
      { anchor: ORAL_IRON_ANCHOR, answer: { dateValue: '2026-09-03' } as GateAnswer }] });
    expect('anchor source', String(r.state.get('gate-response-recheck-due-on-iron')?.windowAnchors?.[0]?.source), 'CLINICIAN');
    expectAll('(recheck ordered)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'INCLUDED');
    expect('step-2-19 sits under', String(r.state.get('step-2-19')?.parentNodeId), 'gate-response-recheck-due-on-iron');
    expectAll('(response not assessed)', r.state, ['gate-rechecked-on-iron', 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16'], 'GATED_OUT');
    expect('questions about a hemoglobin value', String(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length), '0');
    expect('questions from the count gates or the response-gate copies', String(r.pending.filter((p: any) =>
      [p.gateId, ...(p.askedByNodeIds ?? [])].some((id: string) => [...DUE_GATES_ON_IRON, ...COPIES].includes(id))).length), '0');
    expectAll('(continue stays)', r.state, CONTINUE, 'INCLUDED');

    console.log('    every oral iron code routes the same way:');
    for (const code of ORAL_CODES) {
      r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [[code]]) });
      expect(`${code}: gate-on-oral-iron`, status(r.state, 'gate-on-oral-iron'), 'INCLUDED');
      expect(`${code}: step-2-14`, status(r.state, 'step-2-14'), 'INCLUDED');
      expect(`${code}: dp-1 / dp-3 asked`, dpAsked(r.pending), 'false');
    }

    // The response check, anchored on a dated order (the `response` proof's clock).
    const recheck = (asOf: string, hgb: Array<[number, string]>, ga: number, code = '310325') => resolveSession({
      ...base, asOf, ask: [{ gate: CONFIRM, answer: NO }],
      patient: patientWith([['787-2', 72], ...hgb.map(([v, date]) => ['718-7', v, date] as Lab)],
        { gestational_age_weeks: ga }, [], [[code, IRON_START]]),
    });
    console.log('    ferrous sulfate ordered 2026-06-01; day 5, 9.5 → 9.8 — NOT YET DUE, nothing asked about the response:');
    r = await recheck(DAY5, [[9.5, BASELINE_DATE], [9.8, '2026-06-05']], 20);
    for (const g of DUE_GATES_ON_IRON) {
      expect(g, status(r.state, g), 'GATED_OUT');
      expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
    }
    expect('anchor source', String(r.state.get('gate-rechecked-on-iron')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
    expectAll('(nothing opens: no recheck orders, no assessment, neither branch)', r.state, [...RECHECK_ON_IRON, 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16'], 'GATED_OUT');
    expect('questions from the count gates or the response-gate copies', String(r.pending.filter((p: any) =>
      [p.gateId, ...(p.askedByNodeIds ?? [])].some((id: string) => [...DUE_GATES_ON_IRON, ...COPIES].includes(id))).length), '0');

    console.log('    day 21, 9.5 → 10.7 (+1.2) — responding: maintenance, nothing escalates:');
    r = await recheck(DAY21, [[9.5, BASELINE_DATE], [10.7, RECHECK_DATE]], 20);
    expect('anchor source', String(r.state.get('gate-hgb-response-on-iron')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
    expectAll('(a hemoglobin since the start: Step 2.20 assesses it)', r.state, ['gate-rechecked-on-iron', 'step-2-20'], 'INCLUDED');
    expectAll('(no recheck orders)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'GATED_OUT');
    expect('gate-hgb-response-on-iron', status(r.state, 'gate-hgb-response-on-iron'), 'INCLUDED');
    expect('step-2-15 maintenance', status(r.state, 'step-2-15'), 'INCLUDED');
    expect('gate-hgb-nonresponse-on-iron', status(r.state, 'gate-hgb-nonresponse-on-iron'), 'GATED_OUT');
    expectAll('(no escalation)', r.state, ESCALATION, 'GATED_OUT');
    expectAll('(continue)', r.state, CONTINUE, 'INCLUDED');
    expectAll('(the DP-3 oral trial\'s own response check is not reached)', r.state, ['step-2-3', 'gate-hgb-response', 'gate-hgb-nonresponse', 'step-2-4', 'step-2-6'], 'GATED_OUT');
    expect('oral-iron Medication nodes INCLUDED', included(r.state, ORAL_MEDS), '[]');
    expect('IV-iron Medication nodes INCLUDED', included(r.state, IV_MEDS), '[]');
    expect('dp asked', dpAsked(r.pending), 'false');

    console.log('    day 21, 9.5 → 9.9 (+0.4, below target), GA 20 — not responding: expanded workup + IV iron (its own copies):');
    r = await recheck(DAY21, [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], 20);
    expect('gate-hgb-nonresponse-on-iron', status(r.state, 'gate-hgb-nonresponse-on-iron'), 'INCLUDED');
    expect('gate-hgb-response-on-iron', status(r.state, 'gate-hgb-response-on-iron'), 'GATED_OUT');
    expect('step-2-15 maintenance', status(r.state, 'step-2-15'), 'GATED_OUT');
    expectAll('(escalation)', r.state, ESCALATION, 'INCLUDED');
    expectAll('(no recheck orders)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'GATED_OUT');
    expect('med-17 sits under', String(r.state.get('med-17')?.parentNodeId), 'step-2-17');
    expect('oral-iron Medication nodes INCLUDED', included(r.state, ORAL_MEDS), '[]');
    expect('IV-iron Medication nodes INCLUDED (Step 2.17\'s only)', included(r.state, IV_MEDS), JSON.stringify(['med-17', 'med-18', 'med-19', 'med-20']));
    expect('dp asked (DP-4 has one branch — taken, not asked)', dpAsked(r.pending), 'false');
    console.log('    …the same at GA 12 — expanded workup, IV iron gated out:');
    r = await recheck(DAY21, [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], 12);
    expectAll('(workup)', r.state, ['step-2-16', 'dp-4', 'step-1-11'], 'INCLUDED');
    expectAll('(IV iron)', r.state, ['gate-iv-iron-ga-on-iron', 'step-2-17', 'med-17', 'med-18', 'med-19', 'med-20', 'sched-8'], 'GATED_OUT');
    console.log('    …and with a dated ferrous sulfate INGREDIENT order (311975) — it anchors the window too:');
    r = await recheck(DAY21, [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], 20, '311975');
    expect('anchor source', String(r.state.get('gate-hgb-nonresponse-on-iron')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
    expect('step-2-16 nonresponse', status(r.state, 'step-2-16'), 'INCLUDED');

    // ── B: IV iron on the list ──
    console.log('  B. iron sucrose (1741261), MCV 72, Hgb 9.5, GA 20 — no DP-1, no DP-3, no iron recommended; follow-up CBC:');
    r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [['1741261']]) });
    split(r.state, 'gate-iv-iron-on-list');
    expect('dp asked', dpAsked(r.pending), 'false');
    expectAll('(follow-up after IV iron)', r.state, ROUTE_B, 'INCLUDED');
    expect('step-2-18 sits under', String(r.state.get('step-2-18')?.parentNodeId), 'gate-iv-iron-on-list');
    expect('oral-iron Medication nodes INCLUDED', included(r.state, ORAL_MEDS), '[]');
    expect('IV-iron Medication nodes INCLUDED', included(r.state, IV_MEDS), '[]');
    expectAll('(the iron choices are closed)', r.state, CHOICES, 'GATED_OUT');
    expectAll('(route A closed)', r.state, ROUTE_A, 'GATED_OUT');
    expect('confirmatory-studies / start-date questions', String(r.pending.filter((p: any) =>
      p.gateId === CONFIRM || p.datumKey === ORAL_IRON_ANCHOR).length), '0');
    console.log('    every IV iron code routes the same way:');
    for (const code of IV_CODES) {
      r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [[code]]) });
      expect(`${code}: gate-iv-iron-on-list`, status(r.state, 'gate-iv-iron-on-list'), 'INCLUDED');
      expect(`${code}: step-2-18`, status(r.state, 'step-2-18'), 'INCLUDED');
      expect(`${code}: dp asked`, dpAsked(r.pending), 'false');
    }
    console.log('    oral iron AND IV iron on the list — treated as IV iron given:');
    r = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [['310325', IRON_START], ['2274409']]) });
    split(r.state, 'gate-iv-iron-on-list');
    expectAll('(follow-up after IV iron)', r.state, ROUTE_B, 'INCLUDED');
    expectAll('(route A closed)', r.state, ROUTE_A, 'GATED_OUT');
    expect('dp asked', dpAsked(r.pending), 'false');

    // ── C: no iron on the list — as v11 ──
    for (const [label, meds] of [['no medications', []], ['folic acid only (310410 — not an iron product)', [['310410']]]] as Array<[string, Array<[string]>]>) {
      console.log(`  C. ${label}, MCV 72 — DP-1 asked exactly as before:`);
      const plain = patientWith([['787-2', 72], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], meds);
      r = await resolveSession({ ...base, patient: plain });
      split(r.state, 'gate-no-iron-on-list');
      expect('step-1-7 iron strategy (DP-1 host)', status(r.state, 'step-1-7'), 'INCLUDED');
      expect('step-1-7 sits under', String(r.state.get('step-1-7')?.parentNodeId), 'gate-no-iron-on-list');
      expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
      const q = r.pending.find((p: any) => p.gateId === 'dp-1') as any;
      expect('dp-1 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(DP1_OPTIONS));
      expectAll('(route A closed)', r.state, ROUTE_A, 'GATED_OUT');
      expectAll('(route B closed)', r.state, ROUTE_B, 'GATED_OUT');
      console.log('    …empiric, then the oral trial at DP-3 — oral iron is initiated as before:');
      r = await resolveSession({ ...base, patient: plain, replay: [EMPIRIC_CHOICE, ORAL] });
      expectAll('(oral iron initiated)', r.state, ['step-2-1', 'med-1', 'med-2', 'med-3', 'step-2-3', 'lab-10'], 'INCLUDED');
      expectAll('(route A closed)', r.state, ROUTE_A, 'GATED_OUT');
      expectAll('(route B closed)', r.state, ROUTE_B, 'GATED_OUT');
    }

    // ── MCV ≥ 80: the medication list is never read ──
    console.log('  ferrous sulfate on the list, MCV 90 (normocytic) — unchanged: no iron arm of any kind, normocytic workup:');
    r = await resolveSession({ ...base, patient: patientWith([['787-2', 90], ['718-7', 9.5]], { gestational_age_weeks: 20 }, [], [['310325']]) });
    expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'GATED_OUT');
    expectAll('(the split and all three routes)', r.state, ['step-1-10', ...SPLIT, 'step-1-7', 'dp-1', ...ROUTE_A, ...ROUTE_B], 'GATED_OUT');
    expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'INCLUDED');
    expect('dp asked', dpAsked(r.pending), 'false');
  }
}

// ── Proof: anemia v14 — response due, no hemoglobin since the start → order the recheck ──
// [DECISION — Josh 2026-10-04] "It should be accepting the value I gave along with
// MCV and that oral iron supplementation was started 1 month ago. The recommendation
// should be to repeat testing with iron studies to determine need for IV iron."
// His patient: 28 weeks, Hgb 8 and MCV 70 dated 2026-09-01, ferrous gluconate on the
// medication list, oral iron started 2026-09-03 (his answer), visit 2026-10-04. v13
// routed her to Step 2.14 and then asked for a newer hemoglobin; "No newer result"
// closed both response gates and left nothing. v14 puts two anchored COUNT gates in
// front of the response gates, on both routes:
//   gate-response-recheck-due[-on-iron] = count(Hgb since the start) < 1, due day 14
//                                         → Step 2.21 / 2.19: CBC + ferritin + iron/TIBC/sat
//   gate-rechecked[-on-iron]            = count(Hgb since the start) ≥ 1, due day 14
//                                         → Step 2.22 / 2.20, hosting the response gates
// A count never asks for a lab value; only an unknown start date is asked.
async function proveResponseRecheck(): Promise<void> {
  console.log(`\n=== response-recheck: anemia v14 — on oral iron ≥ 14 days, no hemoglobin since it started → the recheck is ordered, not asked for (${ANEMIA}) ===`);
  const VISIT = '2026-10-04T15:00:00.000Z';
  const START = '2026-09-03';                       // 31 days before the visit
  const BASELINE = '2026-09-01';                    // 33 days before the visit
  const GLUCONATE = '198630';                       // Med-2's CodeEntry: ferrous gluconate 324 mg tablet
  const CONFIRM = 'gate-confirm-studies-on-iron';
  const COPIES = ['gate-hgb-response-on-iron', 'gate-hgb-nonresponse-on-iron'];
  const ORIGINALS = ['gate-hgb-response', 'gate-hgb-nonresponse'];
  const ALL_CHECK_GATES = [...DUE_GATES, ...DUE_GATES_ON_IRON, 'gate-rise-unmeasurable', 'gate-rise-unmeasurable-on-iron', ...COPIES, ...ORIGINALS];
  const checkQuestions = (pending: any[]) => String(pending.filter((p: any) =>
    [p.gateId, ...(p.askedByNodeIds ?? [])].some((id: string) => ALL_CHECK_GATES.includes(id))).length);
  const hgbQuestions = (pending: any[]) => String(pending.filter((p: any) => p.datumKey === 'LOINC:718-7').length);
  const pw = JSON.parse(readFileSync(resolve(ANEMIA), 'utf8'));
  /** INCLUDED LabTest nodes ordering LOINC `code` — how many plan lines carry that test. */
  const orders = (state: Map<string, { status: string }>, code: string) => pw.nodes
    .filter((n: any) => n.type === 'LabTest' && n.properties.code === code && status(state, n.id) === 'INCLUDED')
    .map((n: any) => n.id).sort();

  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    // ── Already on oral iron (Step 2.14) ──
    const onIron = (o: { hgb: Array<[number, string]>; asOf?: string; med?: [string, string] | [string]; ask?: Replay[]; ga?: number }) => resolveSession({
      ...base, asOf: o.asOf ?? VISIT, ask: o.ask ?? [{ gate: CONFIRM, answer: NO }],
      patient: patientWith([['787-2', 70, BASELINE], ...o.hgb.map(([v, date]) => ['718-7', v, date] as Lab)],
        { gestational_age_weeks: o.ga ?? 28 }, [], [o.med ?? [GLUCONATE, START]]),
    });

    console.log('  Josh\'s patient: GA 28, Hgb 8 + MCV 70 dated 2026-09-01, ferrous gluconate on the list (undated), visit 2026-10-04:');
    console.log('    before any answer — the start date is asked once; no hemoglobin value is asked for:');
    let r = await onIron({ hgb: [[8, BASELINE]], med: [GLUCONATE], ask: [] });
    expect('step-2-14', status(r.state, 'step-2-14'), 'INCLUDED');
    let dq = r.pending.filter((p: any) => p.datumKey === ORAL_IRON_ANCHOR) as any[];
    expect('start-date questions', String(dq.length), '1');
    expect('prompt', String(dq[0]?.prompt), 'When did oral iron start?');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    console.log('    "oral iron started 2026-09-03", confirmatory studies: no — the recheck is ordered and nothing more is asked:');
    r = await onIron({ hgb: [[8, BASELINE]], med: [GLUCONATE],
      ask: [{ gate: CONFIRM, answer: NO }, { anchor: ORAL_IRON_ANCHOR, answer: { dateValue: START } as GateAnswer }] });
    expect('anchor source', String(r.state.get('gate-response-recheck-due-on-iron')?.windowAnchors?.[0]?.source), 'CLINICIAN');
    expectAll('(response recheck)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'INCLUDED');
    expect('step-2-19 sits under', String(r.state.get('step-2-19')?.parentNodeId), 'gate-response-recheck-due-on-iron');
    expectAll('(response not assessed; no maintenance, no nonresponse, no IV iron)', r.state,
      [...UNMEASURABLE_ON_IRON, 'gate-rechecked-on-iron', 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16', 'dp-4', 'step-2-17', 'med-17'], 'GATED_OUT');
    expectAll('(continue oral iron)', r.state, ['step-2-14', 'guid-7'], 'INCLUDED');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    expect('care-plan blockers on the route', String(validateForGeneration(r.state, r.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => ['step-2-14', ...DUE_GATES_ON_IRON, ...RECHECK_ON_IRON, 'step-2-20', ...COPIES].includes(id))).length), '0');
    expect('Medication nodes INCLUDED (no iron started or escalated)', JSON.stringify(pw.nodes
      .filter((n: any) => n.type === 'Medication' && /iron-repletion/.test(n.properties.clinical_role ?? '') && status(r.state, n.id) === 'INCLUDED').map((n: any) => n.id)), '[]');
    expect('referral (Hgb 8 < 9, read from the 33-day-old value)', status(r.state, 'gate-referral-threshold'), 'INCLUDED');
    // [JOSH — CONFIRM] — her plan carries the CBC four times: Step 1.1's (Lab-1),
    // Step 1.13's 30-day recheck (Lab-25: her Hgb is 33 days old), Step 2.14's
    // scheduled recheck (Lab-19) and the response recheck (Lab-26). One draw.
    expect('CBC (58410-2) order lines', JSON.stringify(orders(r.state, '58410-2')), JSON.stringify(['lab-1', 'lab-19', 'lab-25', 'lab-26']));
    expect('ferritin (2276-4) order lines', JSON.stringify(orders(r.state, '2276-4')), JSON.stringify(['lab-27']));
    expect('iron/TIBC/sat (2498-4) order lines', JSON.stringify(orders(r.state, '2498-4')), JSON.stringify(['lab-28']));
    console.log('    …confirmatory studies: yes — the recheck is ordered either way; ferritin and iron/TIBC are then listed twice:');
    r = await onIron({ hgb: [[8, BASELINE]], med: [GLUCONATE],
      ask: [{ gate: CONFIRM, answer: YES }, { anchor: ORAL_IRON_ANCHOR, answer: { dateValue: START } as GateAnswer }] });
    expectAll('(response recheck)', r.state, RECHECK_ON_IRON, 'INCLUDED');
    expect('ferritin (2276-4) order lines', JSON.stringify(orders(r.state, '2276-4')), JSON.stringify(['lab-22', 'lab-27']));
    expect('iron/TIBC/sat (2498-4) order lines', JSON.stringify(orders(r.state, '2498-4')), JSON.stringify(['lab-23', 'lab-28']));

    console.log('  (i) the same from a DATED order: Hgb 33 days ago, gluconate ordered 31 days ago, no later Hgb — nothing asked at all:');
    r = await onIron({ hgb: [[8, BASELINE]] });
    expect('anchor source', String(r.state.get('gate-response-recheck-due-on-iron')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
    expectAll('(response recheck)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'INCLUDED');
    expectAll('(response not assessed)', r.state, ['gate-rechecked-on-iron', 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16'], 'GATED_OUT');
    expect('start-date questions', String(r.pending.filter((p: any) => p.datumKey === ORAL_IRON_ANCHOR).length), '0');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');

    console.log('  (ii) a hemoglobin since the start, 8.0 → 9.4 (+1.4) — responding: maintenance; no recheck orders:');
    r = await onIron({ hgb: [[8, BASELINE], [9.4, '2026-10-01']] });
    expectAll('(assessed)', r.state, ['gate-rechecked-on-iron', 'step-2-20', 'gate-hgb-response-on-iron', 'step-2-15'], 'INCLUDED');
    expectAll('(no recheck orders, no nonresponse)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON, 'gate-hgb-nonresponse-on-iron', 'step-2-16'], 'GATED_OUT');
    expect('response-check questions', checkQuestions(r.pending), '0');
    console.log('       8.0 → 8.5 (+0.5, below target), GA 28 — not responding: nonresponse management, IV iron:');
    r = await onIron({ hgb: [[8, BASELINE], [8.5, '2026-10-01']] });
    expectAll('(assessed)', r.state, ['gate-rechecked-on-iron', 'step-2-20', 'gate-hgb-nonresponse-on-iron', 'step-2-16', 'dp-4', 'step-2-17', 'med-17'], 'INCLUDED');
    expectAll('(no recheck orders, no maintenance)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON, 'gate-hgb-response-on-iron', 'step-2-15'], 'GATED_OUT');
    expect('response-check questions', checkQuestions(r.pending), '0');

    console.log('  (iii) day 7 of oral iron (ordered 2026-09-27), no hemoglobin since — NOT YET DUE: nothing asked, neither opens:');
    r = await onIron({ hgb: [[8, '2026-09-25']], med: [GLUCONATE, '2026-09-27'] });
    for (const g of DUE_GATES_ON_IRON) {
      expect(g, status(r.state, g), 'GATED_OUT');
      expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
      expect(`${g} reason`, String(r.state.get(g)?.excludeReason ?? '').slice(0, 36), 'NOT_YET_DUE: due on/after 2026-10-11');
    }
    expectAll('(nothing opens)', r.state, [...RECHECK_ON_IRON, 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    console.log('       …day 7 with a hemoglobin drawn on day 5 — still NOT YET DUE (a day-5 value does not decide):');
    r = await onIron({ hgb: [[8, '2026-09-25'], [8.2, '2026-10-02']], med: [GLUCONATE, '2026-09-27'] });
    for (const g of DUE_GATES_ON_IRON) expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
    expectAll('(nothing opens)', r.state, [...RECHECK_ON_IRON, 'step-2-20', 'step-2-15', 'step-2-16'], 'GATED_OUT');

    // The v14 gap, closed in v15 [DECISION — Josh 2026-10-04]: "a single hemoglobin
    // below target, at least 14 days into oral iron, with no pre-iron baseline is
    // recheck in 2–4 weeks, not nonresponse". No hemoglobin on the chart: the response
    // recheck is ordered and the LEVEL is asked for by the Stage 3 threshold gates
    // (v10). The provider enters today's value: it is dated at the visit, so it is a
    // hemoglobin since the start — one point, nothing to measure a rise from. Through
    // v14 the response gates then asked for a result "drawn after" today. Now Step
    // 2.23 opens and nothing more is asked.
    console.log('  no hemoglobin on the chart, oral iron ordered 31 days ago — recheck ordered; the level is asked for (v10):');
    r = await onIron({ hgb: [] });
    expectAll('(response recheck)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON], 'INCLUDED');
    expect('Hgb question asked by', JSON.stringify(r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7').flatMap((p: any) => p.askedByNodeIds ?? [p.gateId]).sort()),
      JSON.stringify(['gate-referral-threshold', 'gate-severe-anemia']));
    console.log('    …the provider enters Hgb 8 at the visit — v15: Step 2.23 "recheck in 2–4 weeks"; no hemoglobin question, no blocker:');
    const noHgbOnIron = patientWith([['787-2', 70, BASELINE]], { gestational_age_weeks: 28 }, [], [[GLUCONATE, START]]);
    let entered = await supplyLab(r, noHgbOnIron, { code: '718-7', value: 8 }, VISIT);
    expectAll('(recheck in 2–4 weeks)', entered.state, UNMEASURABLE_ON_IRON, 'INCLUDED');
    expect('step-2-23 sits under', String(entered.state.get('step-2-23')?.parentNodeId), 'gate-rise-unmeasurable-on-iron');
    expectAll('(response-recheck closed; response not assessed; no nonresponse, no IV iron)', entered.state,
      ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON, 'gate-rechecked-on-iron', 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16', 'step-2-17', 'med-17'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(entered.pending), '0');
    expect('response-check questions', checkQuestions(entered.pending), '0');
    expect('care-plan blockers on the route', String(validateForGeneration(entered.state, entered.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => ['step-2-14', ...DUE_GATES_ON_IRON, ...RECHECK_ON_IRON, ...UNMEASURABLE_ON_IRON, 'step-2-20', ...COPIES].includes(id))).length), '0');
    console.log('    …the provider enters Hgb 11.4 instead — at target: maintenance, no recheck-in-2–4-weeks step, nothing asked:');
    entered = await supplyLab(r, noHgbOnIron, { code: '718-7', value: 11.4 }, VISIT);
    expectAll('(maintenance)', entered.state, ['gate-rechecked-on-iron', 'step-2-20', 'gate-hgb-response-on-iron', 'step-2-15'], 'INCLUDED');
    expectAll('(not unmeasurable-and-below-target)', entered.state, [...UNMEASURABLE_ON_IRON, 'step-2-16'], 'GATED_OUT');
    expect('response-check questions', checkQuestions(entered.pending), '0');
    console.log('  a baseline older than 28 days before the start (2026-07-20) + 8.5 on 2026-10-01 — unmeasurable: Step 2.23, nothing asked:');
    r = await onIron({ hgb: [[8, '2026-07-20'], [8.5, '2026-10-01']] });
    expectAll('(recheck in 2–4 weeks)', r.state, UNMEASURABLE_ON_IRON, 'INCLUDED');
    expectAll('(response not assessed; no nonresponse)', r.state, ['gate-response-recheck-due-on-iron', ...RECHECK_ON_IRON, 'gate-rechecked-on-iron', 'step-2-20', ...COPIES, 'step-2-15', 'step-2-16'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    // [JOSH — CONFIRM] (brief §18): the below-target and at-target arms read hemoglobin
    // inside 28 days. A lone hemoglobin since the start that is itself more than 28 days
    // old is outside them — what happens then is recorded here as it stands.
    console.log('  oral iron ordered 2026-07-01, ONE hemoglobin since (8.5 on 2026-08-20, 45 days old), no baseline — as it stands:');
    r = await onIron({ hgb: [[8.5, '2026-08-20']], med: [GLUCONATE, '2026-07-01'] });
    expect('gate-rise-unmeasurable-on-iron', status(r.state, 'gate-rise-unmeasurable-on-iron'), 'PENDING_QUESTION');
    const oq = r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7') as any[];
    expect('Hgb questions', String(oq.length), '1');
    expect('it asks (answerable: today\'s value is the second point)', String(oq[0]?.prompt), 'Hemoglobin (g/dL) (LOINC 718-7) — most recent value?');
    expect('asked by', JSON.stringify(oq[0]?.askedByNodeIds ?? [oq[0]?.gateId]), JSON.stringify(['gate-rise-unmeasurable-on-iron']));

    // ── Oral iron started by this pathway (Step 2.3), both arms' shared steps ──
    const started = (o: { hgb: Array<[number, string]>; asOf?: string; start?: string; ask?: Replay[] }) => resolveSession({
      ...base, asOf: o.asOf ?? VISIT, replay: [EMPIRIC_CHOICE, ORAL], oralIronStart: o.start, ask: o.ask,
      patient: patientWith([['787-2', 70, BASELINE], ...o.hgb.map(([v, date]) => ['718-7', v, date] as Lab)], { gestational_age_weeks: 28 }),
    });
    console.log('  Step 2.3 route (oral iron started by the pathway; the start is the stored care plan of 2026-09-03):');
    console.log('  (i) Hgb 33 days ago, started 31 days ago, no later Hgb — Step 2.21 orders the recheck; nothing asked:');
    r = await started({ hgb: [[8, BASELINE]], start: START });
    expect('anchor source', String(r.state.get('gate-response-recheck-due')?.windowAnchors?.[0]?.source), 'CARE_PLAN');
    expectAll('(response recheck)', r.state, ['gate-response-recheck-due', ...RECHECK], 'INCLUDED');
    expect('step-2-21 sits under', String(r.state.get('step-2-21')?.parentNodeId), 'gate-response-recheck-due');
    expectAll('(response not assessed)', r.state, ['gate-rechecked', 'step-2-22', ...ORIGINALS, 'step-2-4', 'step-2-6', 'step-2-5'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    expect('CBC (58410-2) order lines', JSON.stringify(orders(r.state, '58410-2')), JSON.stringify(['lab-1', 'lab-10', 'lab-25', 'lab-29']));
    console.log('  (ii) 8.0 → 9.4 — maintenance; 8.0 → 8.5 — nonresponse management:');
    r = await started({ hgb: [[8, BASELINE], [9.4, '2026-10-01']], start: START });
    expectAll('(assessed: responding)', r.state, ['gate-rechecked', 'step-2-22', 'gate-hgb-response', 'step-2-4'], 'INCLUDED');
    expectAll('(no recheck orders, no nonresponse)', r.state, ['gate-response-recheck-due', ...RECHECK, 'gate-hgb-nonresponse', 'step-2-6'], 'GATED_OUT');
    r = await started({ hgb: [[8, BASELINE], [8.5, '2026-10-01']], start: START });
    expectAll('(assessed: not responding)', r.state, ['gate-rechecked', 'step-2-22', 'gate-hgb-nonresponse', 'step-2-6', 'dp-2', 'step-2-5'], 'INCLUDED');
    expectAll('(no recheck orders, no maintenance)', r.state, ['gate-response-recheck-due', ...RECHECK, 'gate-hgb-response', 'step-2-4'], 'GATED_OUT');
    console.log('  v15: no hemoglobin on the chart, started 31 days ago; the provider enters Hgb 8 at the visit — Step 2.24, no hemoglobin question, no blocker:');
    const noHgb = patientWith([['787-2', 70, BASELINE]], { gestational_age_weeks: 28 });
    r = await started({ hgb: [], start: START });
    expectAll('(response recheck while the level is unknown)', r.state, ['gate-response-recheck-due', ...RECHECK], 'INCLUDED');
    // As supplyLab does (addPatientContext), with the stored care plan kept on the clock.
    const withTyped = { ...noHgb, labResults: [...(noHgb as any).labResults, { code: '718-7', system: 'LOINC', value: 8, date: VISIT, providerAsserted: true }] } as unknown as PatientContext;
    const typed = await engineFor(withTyped, () => 0.9, { asOf: VISIT, oralIronStart: START }).traverse(r.session.graph, withTyped, r.session.answers);
    expectAll('(recheck in 2–4 weeks)', typed.resolutionState as any, UNMEASURABLE, 'INCLUDED');
    expectAll('(response-recheck closed; response not assessed)', typed.resolutionState as any, ['gate-response-recheck-due', ...RECHECK, 'gate-rechecked', 'step-2-22', ...ORIGINALS, 'step-2-4', 'step-2-6', 'step-2-5'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(typed.pendingQuestions), '0');
    expect('response-check questions', checkQuestions(typed.pendingQuestions), '0');
    expect('care-plan blockers on the route', String(validateForGeneration(typed.resolutionState, typed.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => [...DUE_GATES, ...RECHECK, ...UNMEASURABLE, 'step-2-22', ...ORIGINALS].includes(id))).length), '0');
    console.log('  v15: a baseline older than 28 days before the start (2026-07-20) + 8.5 on 2026-10-01 — Step 2.24, nothing asked:');
    r = await started({ hgb: [[8, '2026-07-20'], [8.5, '2026-10-01']], start: START });
    expectAll('(recheck in 2–4 weeks)', r.state, UNMEASURABLE, 'INCLUDED');
    expectAll('(response not assessed)', r.state, ['gate-response-recheck-due', ...RECHECK, 'gate-rechecked', 'step-2-22', ...ORIGINALS, 'step-2-4', 'step-2-6'], 'GATED_OUT');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    console.log('  (iii) day 7 (care plan of 2026-09-27) — NOT YET DUE: nothing asked, neither opens:');
    r = await started({ hgb: [[8, '2026-09-25']], start: '2026-09-27' });
    for (const g of DUE_GATES) {
      expect(g, status(r.state, g), 'GATED_OUT');
      expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
    }
    expectAll('(nothing opens)', r.state, [...RECHECK, 'step-2-22', ...ORIGINALS, 'step-2-4', 'step-2-6'], 'GATED_OUT');
    expect('response-check questions', checkQuestions(r.pending), '0');
    console.log('  (iv) the START visit (oral iron recommended this session, Hgb drawn 3 days ago) — unchanged: NOT YET DUE, nothing asked:');
    r = await started({ hgb: [[8, '2026-10-01']] });
    for (const g of DUE_GATES) {
      expect(g, status(r.state, g), 'GATED_OUT');
      expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
      expect(`${g} anchor source`, String(r.state.get(g)?.windowAnchors?.[0]?.source), 'SESSION_RECOMMENDATION');
    }
    expectAll('(the start visit\'s plan)', r.state, ['step-2-1', 'med-1', 'step-2-3', 'lab-10', 'sched-2'], 'INCLUDED');
    expectAll('(nothing opens)', r.state, [...RECHECK, 'step-2-22', ...ORIGINALS, 'step-2-4', 'step-2-6'], 'GATED_OUT');
    expect('start-date questions', String(r.pending.filter((p: any) => p.datumKey === ORAL_IRON_ANCHOR).length), '0');
    expect('Hgb questions', hgbQuestions(r.pending), '0');
    expect('response-check questions', checkQuestions(r.pending), '0');
    expect('care-plan blockers on the route', String(validateForGeneration(r.state, r.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => [...DUE_GATES, ...RECHECK, 'step-2-22', ...ORIGINALS].includes(id))).length), '0');
  }
}


// ── Proofs: routine prenatal care v4 ([DECISION — Josh 2026-10-04]) ──
/** A medication-list entry: `[RxNorm]` undated (as the simulator sends it), or `[RxNorm, 'YYYY-MM-DD']` given that day. */
type PnMed = [string] | [string, string];
/** A routine-prenatal patient. `codes` are CHART conditions; labs dated or undated, as `Lab`. */
function prenatalPatient(opts: {
  ga?: number; rh?: string; codes?: string[]; labs?: Lab[]; meds?: Array<string | PnMed>; vitals?: Record<string, number>;
  /** Other patient attributes — what a remembered answer supplies at the start of a later encounter, or an answer just given. */
  attrs?: Record<string, string | number | boolean>;
}): PatientContext {
  const attrs: Record<string, unknown> = { ...(opts.attrs ?? {}) };
  if (opts.ga !== undefined) attrs.gestational_age_weeks = opts.ga;
  if (opts.rh !== undefined) attrs.rh_factor = opts.rh;
  return {
    patientId: 'proof',
    conditionCodes: ['Z34.90', ...(opts.codes ?? [])].map((code) => ({ code, system: 'ICD-10' })),
    medications: (opts.meds ?? []).map((m) => (typeof m === 'string' ? [m] as PnMed : m))
      .map(([code, date]) => ({ code, system: 'RXNORM', ...(date ? { date } : {}) })),
    allergies: [], vitalSigns: opts.vitals ?? { systolic_bp: 112, diastolic_bp: 70 },
    patientAttributes: normalizePatientAttributes(attrs as never) ?? {},
    labResults: (opts.labs ?? []).map(([code, value, date]) => ({ code, system: 'LOINC', value, ...(date ? { date } : {}) })),
  } as unknown as PatientContext;
}
const PN_GA = 'patient.gestational_age_weeks';
const PN_RH = 'patient.rh_factor';
const PN_STRATEGY = 'gate-gdm-strategy';
const PN_VITAMIN_Q = 'patient.on_prenatal_vitamin';
/** The authored remember_answer of a gate, as JSON — what the live mutation records against. */
const rememberOf = (gateId: string) => JSON.stringify(graphFrom(PRENATAL).getNode(gateId)?.properties?.remember_answer ?? null);
const PN_TWO = 'Two-step: 50-g 1-hour challenge, then a 100-g 3-hour test if it is 140 mg/dL or higher';
const PN_ONE = 'One-step: 75-g 2-hour test';
const pick = (o: string) => ({ selectedOption: o } as GateAnswer);
const keysOf = (pending: any[]) => pending.map((p: any) => p.datumKey ?? p.gateId).sort().join(', ') || '(none)';
/**
 * A chart that raises no question of its own, so each proof lists only what it
 * is about: Rh known, a prenatal vitamin, aspirin and this season's vaccines on
 * the medication list, and a hemoglobin and an HbA1c drawn this pregnancy.
 * AS_OF is 2026-09-24; at 10 weeks the pregnancy began 2026-07-16.
 */
/** This season's influenza and COVID-19 vaccines, a Tdap and an RSV vaccine, each DATED 2026-09-10 (an undated one is asked about). */
const QUIET_VACCINES: PnMed[] = [['2746468', '2026-09-10'], ['2722605', '2026-09-10'], ['1300370', '2026-09-10'], ['2642148', '2026-09-10']];
const QUIET_MEDS: Array<string | PnMed> = ['4511', '243670', ...QUIET_VACCINES];
const quiet = { rh: 'positive', meds: QUIET_MEDS, labs: [['718-7', 12.4, '2026-09-10'], ['4548-4', 5.2, '2026-09-10']] as Lab[] };

async function provePrenatalGa(): Promise<void> {
  console.log(`\n=== prenatal-ga: routine prenatal care — gestational-age windows (${PRENATAL}) ===`);
  const STAGES: Record<number, string[]> = {
    10: ['stage-1', 'stage-2', 'stage-3', 'stage-4'],
    20: ['stage-1', 'stage-2', 'stage-4', 'stage-5'],
    28: ['stage-1', 'stage-2', 'stage-6', 'stage-9'],
    36: ['stage-1', 'stage-2', 'stage-6', 'stage-9', 'stage-10', 'stage-11'],
    41: ['stage-1', 'stage-2', 'stage-6', 'stage-9', 'stage-11', 'stage-12'],
  };
  const WINDOWED = ['stage-3', 'stage-4', 'stage-5', 'stage-6', 'stage-9', 'stage-10', 'stage-11', 'stage-12'];
  /** One action node per windowed stage: it follows its stage. */
  const MARKER: Record<string, string> = { 'stage-3': 'img-1', 'stage-5': 'img-3', 'stage-9': 'guid-7', 'stage-11': 'proc-3', 'stage-12': 'proc-1' };
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    for (const [weeks, open] of Object.entries(STAGES)) {
      console.log(`  ${weeks} weeks:`);
      const r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: Number(weeks) }) });
      expect('gestational-age questions', String(r.pending.filter((p: any) => p.datumKey === PN_GA).length), '0');
      for (const s of ['stage-1', 'stage-2', ...WINDOWED]) {
        expect(s, status(r.state, s), open.includes(s) ? ['INCLUDED', 'PENDING_QUESTION'] : 'GATED_OUT');
        if (MARKER[s]) expect(`  ${MARKER[s]} (in ${s})`, status(r.state, MARKER[s]), open.includes(s) ? 'INCLUDED' : 'GATED_OUT');
      }
    }
    console.log('  gestational age missing: asked for ONCE — by the stage gates and by every "this pregnancy" gate alike; windowed stages are held:');
    const r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet }) });
    expect('pending questions', keysOf(r.pending), PN_GA);
    expectAll('(held)', r.state, WINDOWED, 'PENDING_QUESTION');
    expectAll('(root stages)', r.state, ['stage-1', 'stage-2'], 'INCLUDED');
    expect('gate-cbc-due (a hemoglobin is on file: in this pregnancy or not? held)', status(r.state, 'gate-cbc-due'), 'PENDING_QUESTION');
    expect('gate-hiv-due (never drawn: owed whatever the gestational age)', status(r.state, 'gate-hiv-due'), 'INCLUDED');
  }
}

async function provePrenatalTriggers(): Promise<void> {
  console.log(`\n=== prenatal-triggers: routine prenatal care — which encounter diagnoses start it (${PRENATAL}) ===`);
  const pw = JSON.parse(readFileSync(resolve(PRENATAL), 'utf8'));
  const triggers: string[] = pw.pathway.condition_codes.map((c: any) => c.code);
  expect('trigger codes', [...triggers].sort().join(', '), 'O09, Z33.1, Z33.3, Z34');
  expect('category', pw.pathway.category, 'OBSTETRIC');
  // An OBSTETRIC pathway is kept only for a patient the chart shows is pregnant; the encounter's
  // own diagnosis is part of that chart (multi-pathway-resolution.ts adds it to the session's context).
  for (const code of ['Z34.90', 'O09.90', 'Z33.1', 'Z33.3']) {
    expect(`${code} alone, no gestational age: counts as pregnant for the OBSTETRIC rule`,
      String(isPregnant({ conditionCodes: [{ code, system: 'ICD-10' }] } as unknown as PatientContext)), 'true');
  }
  // The matcher expands an ENCOUNTER diagnosis to its ICD-10 ancestors and compares them with the triggers.
  const matches = (code: string) => {
    for (let c: string | null = code; c; c = derivedParent(c)) if (triggers.includes(c)) return true;
    return false;
  };
  for (const [code, want, why] of [
    ['Z34.90', true, 'supervision of normal pregnancy'], ['Z34.03', true, 'supervision of normal first pregnancy, third trimester'],
    ['O09.513', true, 'supervision of elderly primigravida'], ['O09.90', true, 'supervision of high-risk pregnancy'],
    ['Z33.1', true, 'pregnant state, incidental'], ['Z33.3', true, 'gestational carrier'],
    ['Z33.2', false, 'elective termination'], ['Z3A.28', false, 'weeks of gestation'],
    ['O24.410', false, 'gestational diabetes — a pregnancy problem, not supervision'], ['O99.810', false, 'abnormal glucose'],
    ['O99.012', false, 'anemia complicating pregnancy'], ['O13.3', false, 'gestational hypertension'], ['D50.9', false, 'iron deficiency anemia'],
  ] as const) expect(`${code} on the encounter (${why}) starts routine prenatal care`, String(matches(code)), String(want));
}

async function provePrenatalGdm(): Promise<void> {
  console.log(`\n=== prenatal-gdm: routine prenatal care — gestational diabetes read from the chart, nothing asked that it holds (${PRENATAL}) ===`);
  const ORDERS = ['step-6-6', 'step-6-7', 'lab-20', 'step-6-8', 'lab-22'];
  const TWO_STEP = ['step-6-9', 'step-6-10', 'lab-21', 'step-6-11', 'step-6-12'];
  const blockers = (r: { state: unknown; redFlags: unknown }) => String(validateForGeneration(r.state, r.redFlags).length);
  // 28 weeks at AS_OF 2026-09-24: this pregnancy began 2026-03-12.
  const base = { ...quiet, ga: 28, labs: [...quiet.labs, ['718-7', 12.1, '2026-09-20']] as Lab[] };
  const with_ = (labs: Lab[], codes: string[] = []) => prenatalPatient({ ...base, codes, labs: [...base.labs, ...labs] });
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);

    console.log('  diabetes code on the chart (O24.410): no screening, nothing asked:');
    let r = await resolveSession({ file: PRENATAL, reverse, patient: with_([], ['O24.410']) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expect('step-6-4 already diagnosed', status(r.state, 'step-6-4'), 'INCLUDED');
    expectAll('(no screening)', r.state, [...ORDERS, ...TWO_STEP, 'step-6-3', 'step-6-13'], 'GATED_OUT');
    expect('care-plan blockers', blockers(r), '0');

    console.log('  nothing on file at 28 weeks: the strategy is asked ONCE; nothing else:');
    const none = with_([]);
    r = await resolveSession({ file: PRENATAL, reverse, patient: none });
    expect('pending questions', keysOf(r.pending), PN_STRATEGY);
    expect('step-6-6 choose the strategy', status(r.state, 'step-6-6'), 'INCLUDED');

    console.log('  … two-step: the 50-g challenge is ordered; NO result question; nothing blocks the plan:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: none, replay: [{ gate: PN_STRATEGY, answer: pick(PN_TWO) }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(50-g ordered)', r.state, ['step-6-7', 'lab-20'], 'INCLUDED');
    expectAll('(no 75-g order)', r.state, ['step-6-8', 'lab-22'], 'EXCLUDED');
    expectAll('(nothing from the two-step results)', r.state, TWO_STEP, 'GATED_OUT');
    expect('care-plan blockers', blockers(r), '0');

    console.log('  … one-step: the 75-g test is ordered; NO result question; nothing blocks the plan:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: none, replay: [{ gate: PN_STRATEGY, answer: pick(PN_ONE) }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(75-g ordered)', r.state, ['step-6-8', 'lab-22'], 'INCLUDED');
    expectAll('(no 50-g order)', r.state, ['step-6-7', 'lab-20'], 'EXCLUDED');
    expect('care-plan blockers', blockers(r), '0');

    console.log('  50-g challenge 118 on file: screening complete — nothing asked, nothing ordered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 118, '2026-09-14']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expect('step-6-3 screening complete', status(r.state, 'step-6-3'), 'INCLUDED');
    expectAll('(no orders, no two-step results)', r.state, [...ORDERS, ...TWO_STEP], 'GATED_OUT');

    console.log('  50-g challenge 152 on file, not diagnosed: the 100-g test is ordered — NO strategy question, NO result question:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 152, '2026-09-14']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(100-g test ordered)', r.state, ['step-6-9', 'step-6-10', 'lab-21'], 'INCLUDED');
    expectAll('(no strategy question, no screening order)', r.state, ORDERS, 'GATED_OUT');
    expectAll('(no conclusion yet)', r.state, ['step-6-11', 'step-6-12', 'step-6-3'], 'GATED_OUT');
    expect('care-plan blockers', blockers(r), '0');

    console.log('  … and the 100-g values on the chart settle it with no question: 96 / 185 / 150 / 130 (two abnormal) → diagnose GDM:');
    const ogtt = (f: number, h1: number, h2: number, h3: number): Lab[] =>
      [['1504-0', 152, '2026-09-07'], ['1549-5', f, '2026-09-14'], ['1501-6', h1, '2026-09-14'], ['1514-9', h2, '2026-09-14'], ['1530-5', h3, '2026-09-14']];
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_(ogtt(96, 185, 150, 130)) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(diagnose GDM: add O24.410 to the encounter)', r.state, ['step-6-11', 'guid-a4'], 'INCLUDED');
    expectAll('(no order, not "complete")', r.state, ['step-6-10', 'lab-21', 'step-6-12'], 'GATED_OUT');

    console.log('  … 90 / 185 / 150 / 130 (one abnormal) → not GDM, screening complete, nothing asked — and nothing recurs:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_(ogtt(90, 185, 150, 130)) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(complete: does not meet criteria)', r.state, ['step-6-12', 'guid-18'], 'INCLUDED');
    expectAll('(no order, no diagnosis)', r.state, ['step-6-10', 'lab-21', 'step-6-11'], 'GATED_OUT');

    console.log('  … every pair of abnormal values diagnoses; every single abnormal value does not (Carpenter-Coustan, ≥ 2 of 4):');
    const HI = [96, 185, 160, 145]; const LO = [90, 170, 150, 130];
    for (let a = 0; a < 4; a++) {
      const one = LO.map((v, i) => (i === a ? HI[i] : v)) as [number, number, number, number];
      r = await resolveSession({ file: PRENATAL, reverse, patient: with_(ogtt(...one)) });
      expect(`only value ${a + 1} abnormal: diagnose / complete`, `${status(r.state, 'step-6-11')} / ${status(r.state, 'step-6-12')}`, 'GATED_OUT / INCLUDED');
      for (let b = a + 1; b < 4; b++) {
        const two = LO.map((v, i) => (i === a || i === b ? HI[i] : v)) as [number, number, number, number];
        r = await resolveSession({ file: PRENATAL, reverse, patient: with_(ogtt(...two)) });
        expect(`values ${a + 1} and ${b + 1} abnormal: diagnose / complete`, `${status(r.state, 'step-6-11')} / ${status(r.state, 'step-6-12')}`, 'INCLUDED / GATED_OUT');
      }
    }
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_(ogtt(96, 185, 160, 145)) });
    expect('all four abnormal: diagnose / complete', `${status(r.state, 'step-6-11')} / ${status(r.state, 'step-6-12')}`, 'INCLUDED / GATED_OUT');

    console.log('  … a partly entered 100-g test (fasting 90 and 1-hour 185 only): the missing values are asked for, nothing is re-ordered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 152, '2026-09-07'], ['1549-5', 90, '2026-09-14'], ['1501-6', 185, '2026-09-14']]) });
    expect('pending questions', keysOf(r.pending), 'LOINC:1514-9');
    expectAll('(not re-ordered)', r.state, ['step-6-10', 'lab-21'], 'GATED_OUT');

    console.log('  75-g results on file, all below threshold (88 / 165 / 140): complete, nothing asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1552-9', 88, '2026-09-14'], ['1507-3', 165, '2026-09-14'], ['1518-0', 140, '2026-09-14']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expect('step-6-3 screening complete', status(r.state, 'step-6-3'), 'INCLUDED');
    expectAll('(no orders)', r.state, ORDERS, 'GATED_OUT');

    console.log('  75-g results on file with the 1-hour at 186: diagnose GDM — no strategy question, no order:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1552-9', 88, '2026-09-14'], ['1507-3', 186, '2026-09-14'], ['1518-0', 140, '2026-09-14']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(diagnose GDM: add O24.410 to the encounter)', r.state, ['step-6-13', 'guid-a4b'], 'INCLUDED');
    expectAll('(no orders)', r.state, ORDERS, 'GATED_OUT');

    console.log('  a 50-g challenge from BEFORE this pregnancy (2025-11-01, 110) is not this pregnancy\'s screen: the strategy is asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 110, '2025-11-01']]) });
    expect('pending questions', keysOf(r.pending), PN_STRATEGY);
    expect('step-6-3 screening complete', status(r.state, 'step-6-3'), 'GATED_OUT');

    console.log('  before 24 weeks (20 weeks), nothing on file: Stage 6 is closed — no strategy question:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 20 }) });
    expect('stage-6', status(r.state, 'stage-6'), 'GATED_OUT');
    expect('pending questions', keysOf(r.pending), '(none)');

    console.log('  early HbA1c (10 weeks), none on file: only eligibility is asked — nobody is asked for an HbA1c; yes → ordered, nothing blocks:');
    const early = prenatalPatient({ ...quiet, ga: 10, labs: [['718-7', 12.4, '2026-09-10']] });
    r = await resolveSession({ file: PRENATAL, reverse, patient: early });
    expect('pending questions', keysOf(r.pending), 'gate-early-testing-indicated');
    r = await resolveSession({ file: PRENATAL, reverse, patient: early, replay: [{ gate: 'gate-early-testing-indicated', answer: YES }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(A1c ordered)', r.state, ['step-4-2', 'lab-17'], 'INCLUDED');
    expectAll('(no result steps)', r.state, ['step-4-3', 'step-4-4'], 'GATED_OUT');
    expect('care-plan blockers', blockers(r), '0');

    console.log('  early HbA1c 6.1 on file: early abnormal glucose step — no eligibility question, no order:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 10, labs: [['718-7', 12.4, '2026-09-10'], ['4548-4', 6.1, '2026-09-10']] }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expect('step-4-4 early abnormal glucose', status(r.state, 'step-4-4'), 'INCLUDED');
    expectAll('(no overt diabetes, no eligibility question, no order)', r.state, ['step-4-3', 'step-4-6', 'step-4-2', 'lab-17'], 'GATED_OUT');

    console.log('  HbA1c 6.8 from BEFORE this pregnancy (2026-03-01; at 10 weeks it began 2026-07-16): NOT read — no overt-diabetes step; eligibility is asked as for any patient with none this pregnancy:');
    const old = prenatalPatient({ ...quiet, ga: 10, labs: [['718-7', 12.4, '2026-09-10'], ['4548-4', 6.8, '2026-03-01']] });
    r = await resolveSession({ file: PRENATAL, reverse, patient: old });
    expect('pending questions', keysOf(r.pending), 'gate-early-testing-indicated');
    expectAll('(not read)', r.state, ['step-4-3', 'step-4-4'], 'GATED_OUT');
    console.log('  … HbA1c 6.8 drawn THIS pregnancy (2026-08-01): overt diabetes step, nothing asked — whatever eligibility would have been:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 10, labs: [['718-7', 12.4, '2026-09-10'], ['4548-4', 6.8, '2026-08-01']] }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(overt diabetes: add the diagnosis)', r.state, ['step-4-3', 'guid-15'], 'INCLUDED');
    expectAll('(no eligibility question, no order)', r.state, ['step-4-6', 'step-4-2', 'lab-17'], 'GATED_OUT');

    // 28 weeks at AS_OF 2026-09-24: the pregnancy began 2026-03-12, 16 weeks was 2026-07-02, and week 24 began 2026-08-27.
    console.log('  an EARLY 50-g challenge (16 weeks, 2026-07-02) that was NEGATIVE (118) is not the 24-28-week screen: at 28 weeks screening is still open — the strategy is asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 118, '2026-07-02']]) });
    expect('pending questions', keysOf(r.pending), PN_STRATEGY);
    expect('step-6-3 screening complete', status(r.state, 'step-6-3'), 'GATED_OUT');
    expect('step-6-6 choose the strategy', status(r.state, 'step-6-6'), 'INCLUDED');
    console.log('  … the day before 24 0/7 weeks (2026-08-26) does not count; the first day of week 24 (2026-08-27) does:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 118, '2026-08-26']]) });
    expect('step-6-3 (2026-08-26)', status(r.state, 'step-6-3'), 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 118, '2026-08-27']]) });
    expect('step-6-3 (2026-08-27)', status(r.state, 'step-6-3'), 'INCLUDED');
    expect('pending questions', keysOf(r.pending), '(none)');
    console.log('  an EARLY 50-g that was POSITIVE (155 at 16 weeks): straight to the 100-g test at 28 weeks — no strategy question, no 50-g re-ordered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 155, '2026-07-02']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(100-g test ordered)', r.state, ['step-6-9', 'step-6-10', 'lab-21'], 'INCLUDED');
    expectAll('(no strategy question, no screening order)', r.state, ORDERS, 'GATED_OUT');
    console.log('  … and a 100-g test done early with it (17 weeks, normal) does not settle it: the 100-g test is still ordered at 28 weeks, nothing concluded:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: with_([['1504-0', 155, '2026-07-02'], ['1549-5', 88, '2026-07-09'], ['1501-6', 160, '2026-07-09'], ['1514-9', 140, '2026-07-09'], ['1530-5', 120, '2026-07-09']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(100-g test ordered)', r.state, ['step-6-10', 'lab-21'], 'INCLUDED');
    expectAll('(nothing concluded from the early test)', r.state, ['step-6-11', 'step-6-12'], 'GATED_OUT');
  }
}

async function provePrenatalHandoffs(): Promise<void> {
  console.log(`\n=== prenatal-handoffs: routine prenatal care — anemia, blood pressure and Rh hand-offs (${PRENATAL}) ===`);
  const ANEMIA_STEP = ['step-1-23', 'guid-12'];
  const CBC = ['step-1-10', 'lab-1'];
  const BP_STEP = ['step-2-2', 'guid-14'];
  const RH_STEP = ['step-1-24', 'guid-13'];
  const HGB = 'LOINC:718-7';
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const at = (weeks: number, hgb: Lab[], extra: Partial<Parameters<typeof prenatalPatient>[0]> = {}) =>
      prenatalPatient({ ...quiet, ga: weeks, labs: [['4548-4', 5.2, '2026-09-10'], ...hgb], ...extra });

    console.log('  Hgb 10.7 drawn this pregnancy, 10 weeks (first trimester, threshold 11): anemia hand-off; no CBC re-ordered:');
    let r = await resolveSession({ file: PRENATAL, reverse, patient: at(10, [['718-7', 10.7, '2026-09-10']]) });
    expectAll('(add the anemia diagnosis to the encounter)', r.state, ANEMIA_STEP, 'INCLUDED');
    expectAll('(CBC on file this pregnancy)', r.state, CBC, 'GATED_OUT');

    console.log('  Hgb 10.7 at 20 weeks (second trimester, threshold 10.5): no hand-off; 10.2: hand-off:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(20, [['718-7', 10.7, '2026-09-10']]) });
    expectAll('(no hand-off)', r.state, ANEMIA_STEP, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(20, [['718-7', 10.2, '2026-09-10']]) });
    expectAll('(add the anemia diagnosis)', r.state, ANEMIA_STEP, 'INCLUDED');

    console.log('  Hgb 12.4: no hand-off, nothing asked about it:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(10, [['718-7', 12.4, '2026-09-10']]) });
    expectAll('(no hand-off)', r.state, ANEMIA_STEP, 'GATED_OUT');
    expect('pending questions', keysOf(r.pending), '(none)');

    console.log('  Hgb 10.2 at 20 weeks with O99.012 already on the chart: the hand-off is closed:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(20, [['718-7', 10.2, '2026-09-10']], { codes: ['O99.012'] }) });
    expectAll('(no hand-off)', r.state, ANEMIA_STEP, 'GATED_OUT');

    console.log('  LOW Hgb from BEFORE this pregnancy (9.8 on 2026-06-01; 10 weeks → pregnancy began 2026-07-16): NO hand-off; the CBC is ordered:');
    const before = at(10, [['718-7', 9.8, '2026-06-01']]);
    r = await resolveSession({ file: PRENATAL, reverse, patient: before });
    expectAll('(CBC ordered: none this pregnancy)', r.state, CBC, 'INCLUDED');
    expect('pending questions (this pregnancy\'s value)', keysOf(r.pending), HGB);
    r = await resolveSession({ file: PRENATAL, reverse, patient: before, replay: [{ decline: HGB }] });
    expectAll('(no hand-off on a pre-pregnancy value)', r.state, ANEMIA_STEP, 'GATED_OUT');
    expectAll('(CBC ordered)', r.state, CBC, 'INCLUDED');
    expect('pending questions', keysOf(r.pending), '(none)');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');

    console.log('  … the same low value drawn ONE day into this pregnancy (2026-07-17) does open it:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(10, [['718-7', 9.8, '2026-07-17']]) });
    expectAll('(add the anemia diagnosis)', r.state, ANEMIA_STEP, 'INCLUDED');

    console.log('  a pre-pregnancy low value AND a normal one this pregnancy: this pregnancy\'s value decides — no hand-off:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(10, [['718-7', 9.8, '2026-06-01'], ['718-7', 12.2, '2026-09-10']]) });
    expectAll('(no hand-off)', r.state, ANEMIA_STEP, 'GATED_OUT');
    expect('pending questions', keysOf(r.pending), '(none)');

    console.log('  28 weeks, last Hgb at 10 weeks (126 days ago): the 24-28-week CBC is ordered; a Hgb 9 days ago: not:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(28, [['718-7', 12.0, '2026-05-21']], { codes: ['O24.410'] }) });
    expectAll('(repeat CBC)', r.state, ['step-6-5', 'lab-19'], 'INCLUDED');
    expectAll('(first-panel CBC not re-ordered)', r.state, CBC, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(28, [['718-7', 12.0, '2026-09-15']], { codes: ['O24.410'] }) });
    expectAll('(no repeat CBC)', r.state, ['step-6-5', 'lab-19'], 'GATED_OUT');

    // 26 weeks at AS_OF 2026-09-24: the pregnancy began 2026-03-26; 10 weeks was 2026-06-04; week 24 began 2026-09-10; 25 weeks was 2026-09-17.
    console.log('  26 weeks, CBC at 10 weeks only (2026-06-04): the repeat CBC is ordered; with a CBC at 25 weeks (2026-09-17): not; the day before week 24 (2026-09-09) does not count:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(26, [['718-7', 12.0, '2026-06-04']], { codes: ['O24.410'] }) });
    expectAll('(repeat CBC)', r.state, ['step-6-5', 'lab-19'], 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(26, [['718-7', 12.0, '2026-06-04'], ['718-7', 11.8, '2026-09-17']], { codes: ['O24.410'] }) });
    expectAll('(no repeat CBC)', r.state, ['step-6-5', 'lab-19'], 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(26, [['718-7', 12.0, '2026-09-09']], { codes: ['O24.410'] }) });
    expectAll('(repeat CBC: 2026-09-09 is before 24 0/7 weeks)', r.state, ['step-6-5', 'lab-19'], 'INCLUDED');

    const T3 = ['step-9-7', 'lab-24', 'step-9-8', 'lab-25', 'step-9-9', 'lab-26'];
    console.log('  20 weeks: nothing third-trimester is ordered, and no repeat CBC; 27 weeks (Stage 9 open for Tdap): still no rescreens; 28 weeks: ordered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(20, [['718-7', 12.0, '2026-09-10']]) });
    expectAll('(20 weeks)', r.state, [...T3, 'step-6-5', 'lab-19', 'step-9-10', 'med-5'], 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(27, [['718-7', 12.0, '2026-09-15']], { codes: ['O24.410'] }) });
    expect('stage-9 (27 weeks)', status(r.state, 'stage-9'), 'INCLUDED');
    expectAll('(27 weeks: no rescreens yet)', r.state, T3, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(28, [['718-7', 12.0, '2026-09-15']], { codes: ['O24.410'] }) });
    expectAll('(28 weeks: rescreens ordered)', r.state, T3, 'INCLUDED');
    console.log('  … 32 weeks (began 2026-02-12; week 28 began 2026-08-27): a syphilis test at 10 weeks does not count as the rescreen; one at 29 weeks (2026-09-03) does:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(32, [['718-7', 12.0, '2026-09-15'], ['20507-0', 1, '2026-04-23']], { codes: ['O24.410'] }) });
    expectAll('(rescreen ordered)', r.state, ['step-9-7', 'lab-24'], 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: at(32, [['718-7', 12.0, '2026-09-15'], ['20507-0', 1, '2026-09-03']], { codes: ['O24.410'] }) });
    expectAll('(rescreen not ordered)', r.state, ['step-9-7', 'lab-24'], 'GATED_OUT');

    console.log('  BP 146/88: hand-off; 118/76: none; 146/88 with O13.3 on the chart: none; BP missing: asked for:');
    const bp = (vitals: Record<string, number>, codes: string[] = []) => at(30, [['718-7', 12, '2026-09-15']], { codes: ['O24.410', ...codes], vitals });
    r = await resolveSession({ file: PRENATAL, reverse, patient: bp({ systolic_bp: 146, diastolic_bp: 88 }) });
    expectAll('(add the diagnosis to the encounter)', r.state, BP_STEP, 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: bp({ systolic_bp: 118, diastolic_bp: 76 }) });
    expectAll('(no hand-off)', r.state, BP_STEP, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: bp({ systolic_bp: 146, diastolic_bp: 88 }, ['O13.3']) });
    expectAll('(no hand-off: hypertension already diagnosed)', r.state, BP_STEP, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: bp({}) });
    expect('pending questions', keysOf(r.pending), 'vitals.systolic_bp');

    console.log('  Rh negative, weak D, partial D, or any other result that is not plainly "positive": hand-off; Rh positive: nothing; Z67.91 on the chart: nothing:');
    const rh = (v: string | undefined, codes: string[] = []) => prenatalPatient({ ...quiet, ga: 10, rh: v, codes });
    for (const type of ['negative', 'weak D', 'partial D', 'indeterminate']) {
      r = await resolveSession({ file: PRENATAL, reverse, patient: rh(type) });
      expectAll(`("${type}": add the diagnosis)`, r.state, RH_STEP, 'INCLUDED');
      expect(`"${type}": pending questions`, keysOf(r.pending), '(none)');
    }
    r = await resolveSession({ file: PRENATAL, reverse, patient: rh('positive') });
    expectAll('(nothing)', r.state, RH_STEP, 'GATED_OUT');
    console.log('  the chart\'s own spellings are read: "Rh+", "POS", "Rh(D) positive" → no hand-off; "Rh-", "neg", "Du", "weakly positive" → hand-off; "O+" (not an Rh spelling) → flagged:');
    for (const [spelling, want] of [['Rh+', 'GATED_OUT'], ['POS', 'GATED_OUT'], ['Rh(D) positive', 'GATED_OUT'], ['Rh-', 'INCLUDED'], ['neg', 'INCLUDED'], ['Du', 'INCLUDED'], ['weakly positive', 'INCLUDED'], ['O+', 'INCLUDED']] as const) {
      r = await resolveSession({ file: PRENATAL, reverse, patient: rh(spelling) });
      expect(`chart "${spelling}": step-1-24`, status(r.state, 'step-1-24'), want);
      expect(`chart "${spelling}": pending questions`, keysOf(r.pending), '(none)');
    }
    const rhStep = String(graphFrom(PRENATAL).getNode('step-1-24')?.properties?.description ?? '');
    const rhGuid = String(graphFrom(PRENATAL).getNode('guid-13')?.properties?.instructions ?? '');
    expect('step text recommends Z67.91 for weak D and partial D', String(/Add Z67\.91/.test(rhStep) && /weak D and partial D as well as/.test(rhStep)), 'true');
    expect('… with no "when she is to be managed as" qualifier, in the step or the guidance', String(/managed as/.test(rhStep + rhGuid)), 'false');
    r = await resolveSession({ file: PRENATAL, reverse, patient: rh('negative', ['Z67.91']) });
    expectAll('(already recorded)', r.state, RH_STEP, 'GATED_OUT');
    expect('no Rh immune globulin and no repeat antibody screen anywhere in the pathway',
      String(graphFrom(PRENATAL).allNodes.some((n) => /immune globulin|rhig|rhogam|antibody screen.*repeat|repeat.*antibody screen/i.test(String(n.properties?.name ?? '')))), 'false');

    console.log('  Rh missing: asked ONCE, with every answer offered; "positive" → nothing, "negative" / "weak D" / "partial D" → hand-off; Z67.91 on the chart → not asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: rh(undefined) });
    const q: any = r.pending.filter((p: any) => p.datumKey === PN_RH);
    expect('pending questions', keysOf(r.pending), PN_RH);
    expect('options offered', [...(q[0]?.options ?? [])].sort().join(' / '), 'negative / partial D / positive / weak D');
    for (const [answer, want] of [['positive', 'GATED_OUT'], ['negative', 'INCLUDED'], ['weak D', 'INCLUDED'], ['partial D', 'INCLUDED']] as const) {
      const answered = await engineFor(rh(answer), () => 0.9).traverse(r.session.graph, rh(answer), r.session.answers);
      expect(`answered "${answer}": step-1-24`, status(answered.resolutionState, 'step-1-24'), want);
      expect(`answered "${answer}": pending questions`, keysOf(answered.pendingQuestions), '(none)');
    }
    r = await resolveSession({ file: PRENATAL, reverse, patient: rh(undefined, ['Z67.91']) });
    expect('pending questions (Z67.91 on the chart)', keysOf(r.pending), '(none)');
    r = await resolveSession({ file: PRENATAL, reverse, patient: rh(undefined), replay: [{ decline: PN_RH }] });
    expect('pending questions after "Not available"', keysOf(r.pending), '(none)');
    expectAll('(typing still ordered: no blood type on file)', r.state, ['step-1-11', 'lab-2'], 'INCLUDED');
  }
}

async function provePrenatalMeds(): Promise<void> {
  console.log(`\n=== prenatal-meds: routine prenatal care — the medication list and the labs on file are read first (${PRENATAL}) ===`);
  const START_VIT = ['step-1-27', 'med-1'];
  const ON_LIST = ['step-1-28', 'guid-10'];
  const REPORTED = ['step-1-30', 'guid-19'];
  const START_ASA = ['step-1-7', 'med-2', 'sched-2'];
  const CONT_ASA = ['step-1-25', 'guid-11'];
  const ASA_Q = 'gate-aspirin-indicated';
  const VAX = QUIET_VACCINES;
  const labs: Lab[] = [['718-7', 12.4, '2026-09-10'], ['4548-4', 5.2, '2026-09-10']];
  const pt = (ga: number, meds: string[], extra: Partial<Parameters<typeof prenatalPatient>[0]> = {}) =>
    prenatalPatient({ ga, rh: 'positive', labs, meds: [...VAX, ...meds], ...extra });
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);

    for (const [code, what] of [['198640', 'folic acid 0.4 mg tablet'], ['1119573', 'Vitafol-One'], ['1248142', 'a generic prenatal multivitamin']] as const) {
      console.log(`  ${what} on the medication list (${code}): nothing asked, nothing started — "continue":`);
      const r = await resolveSession({ file: PRENATAL, reverse, patient: pt(10, [code, '243670']) });
      expect('pending questions', keysOf(r.pending), '(none)');
      expectAll('(not started)', r.state, [...START_VIT, ...REPORTED, 'step-1-29'], 'GATED_OUT');
      expectAll('(continue)', r.state, ON_LIST, 'INCLUDED');
    }

    console.log('  none on the list: asked ONCE "Already taking a prenatal vitamin?" (one question for the two gates); nothing started until answered:');
    const noVit = (attrs?: Record<string, boolean>) => pt(10, ['243670'], attrs ? { attrs } : {});
    let r = await resolveSession({ file: PRENATAL, reverse, patient: noVit() });
    expect('pending questions', keysOf(r.pending), PN_VITAMIN_Q);
    expect('prompt', String(r.pending[0]?.prompt), 'Already taking a prenatal vitamin? None is on the medication list.');
    expect('answer type', String(r.pending[0]?.answerType), 'BOOLEAN');
    expectAll('(held)', r.state, START_VIT, 'PENDING_QUESTION');
    expect('remember_answer on the "yes" gate', rememberOf('gate-taking-prenatal-vitamin'), '{"scope":"PREGNANCY","values":[true]}');
    expect('remember_answer on the "no" gate (they share the question)', rememberOf('gate-not-taking-prenatal-vitamin'), '{"scope":"PREGNANCY","values":[true]}');
    console.log('  … answered yes — or supplied true at a LATER encounter, as a remembered answer is: NOT asked, NOT started — "continue":');
    r = await resolveSession({ file: PRENATAL, reverse, patient: noVit({ on_prenatal_vitamin: true }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(not started)', r.state, START_VIT, 'GATED_OUT');
    expectAll('(continue)', r.state, REPORTED, 'INCLUDED');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    console.log('  … answered no: the prenatal vitamin is recommended (and "no" is not among the remembered values, so it is asked again next visit):');
    r = await resolveSession({ file: PRENATAL, reverse, patient: noVit({ on_prenatal_vitamin: false }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(started)', r.state, START_VIT, 'INCLUDED');
    expectAll('(no "continue")', r.state, [...REPORTED, ...ON_LIST], 'GATED_OUT');
    console.log('  … "Not available" (on_declined: traverse on the "no" gate): unknown is treated like "no" — the vitamin is recommended, the "continue" side is closed, nothing blocks:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: noVit(), replay: [{ decline: PN_VITAMIN_Q }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(recommended)', r.state, START_VIT, 'INCLUDED');
    expectAll('("continue" side closed)', r.state, REPORTED, 'GATED_OUT');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    expect('on_declined on the "no" gate / the "yes" gate', `${String(graphFrom(PRENATAL).getNode('gate-not-taking-prenatal-vitamin')?.properties?.on_declined)} / ${String(graphFrom(PRENATAL).getNode('gate-taking-prenatal-vitamin')?.properties?.on_declined)}`, 'traverse / undefined');
    console.log('  … on_declined acts only on a decline: while the question is unanswered the vitamin is still held, and a "yes" still closes it (both shown above)');
    console.log('  … a recognised product on the list settles it whatever was remembered: nothing asked, the "on the list" step, not the "reported" one:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt(10, ['1119573', '243670'], { attrs: { on_prenatal_vitamin: false } }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(continue: on the list)', r.state, ON_LIST, 'INCLUDED');
    expectAll('(not started, not asked)', r.state, [...START_VIT, ...REPORTED, 'step-1-29'], 'GATED_OUT');

    console.log('  aspirin on the list: eligibility is not asked, aspirin is not started — "continue" instead:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt(14, ['4511', '318272']) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(not started)', r.state, START_ASA, 'GATED_OUT');
    expectAll('(continue)', r.state, CONT_ASA, 'INCLUDED');

    console.log('  not on aspirin, 14 weeks: eligibility is asked; yes → started, no → not:');
    const noAsa = pt(14, ['4511']);
    r = await resolveSession({ file: PRENATAL, reverse, patient: noAsa });
    expect('pending questions', keysOf(r.pending), ASA_Q);
    r = await resolveSession({ file: PRENATAL, reverse, patient: noAsa, replay: [{ gate: ASA_Q, answer: YES }] });
    expectAll('(started)', r.state, START_ASA, 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: noAsa, replay: [{ gate: ASA_Q, answer: NO }] });
    expectAll('(not started)', r.state, START_ASA, 'GATED_OUT');

    console.log('  not on aspirin, 30 weeks (past the 28-week start window): eligibility is not asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt(30, ['4511'], { codes: ['O24.410'], labs: [['718-7', 12, '2026-09-15']] }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(not started)', r.state, START_ASA, 'GATED_OUT');

    console.log('  first-visit panel, 10 weeks, empty chart: every test is ordered; with results on file this pregnancy, none is:');
    const PANEL = ['lab-1', 'lab-2', 'lab-3', 'lab-4', 'lab-5', 'lab-6', 'lab-7', 'lab-8', 'lab-9', 'lab-10', 'lab-11', 'lab-12', 'lab-13'];
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ga: 10, rh: 'positive', meds: QUIET_MEDS }),
      ask: [{ decline: 'LOINC:718-7' }, { gate: 'gate-early-testing-indicated', answer: NO }] });
    expectAll('(ordered)', r.state, PANEL, 'INCLUDED');
    const done: Lab[] = ['718-7', '882-1', '890-4', '25514-1', '20507-0', '5196-1', '16935-9', '56888-1', '13955-0', '630-4', '21613-5', '43113-0', '19162-7', '4548-4']
      .map((c) => [c, c === '718-7' ? 12.4 : c === '4548-4' ? 5.2 : 1, '2026-09-10'] as Lab);
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ga: 10, rh: 'positive', meds: QUIET_MEDS, labs: done }) });
    expectAll('(not re-ordered)', r.state, PANEL, 'GATED_OUT');
    expect('pending questions', keysOf(r.pending), '(none)');

    console.log('  "this pregnancy" follows the gestational age: at 10 weeks (began 2026-07-16) an HIV test on 2026-07-10 is not this pregnancy\'s; on 2026-07-17 it is:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 10, labs: [...labs, ['56888-1', 1, '2026-07-10']] }) });
    expect('lab-8 HIV (6 days before the LMP)', status(r.state, 'lab-8'), 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 10, labs: [...labs, ['56888-1', 1, '2026-07-17']] }) });
    expect('lab-8 HIV (1 day after the LMP)', status(r.state, 'lab-8'), 'GATED_OUT');
    console.log('  … and at 30 weeks (began 2026-02-26) the same 2026-07-10 test IS this pregnancy\'s; a blood type from 5 years ago always counts:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, ga: 30, codes: ['O24.410'], labs: [['718-7', 12, '2026-09-15'], ['56888-1', 1, '2026-07-10'], ['882-1', 1, '2021-06-01']] }) });
    expect('lab-8 HIV', status(r.state, 'lab-8'), 'GATED_OUT');
    expect('lab-2 ABO/Rh type', status(r.state, 'lab-2'), 'GATED_OUT');

    console.log('  gestational age unknown and declined ("Not available"), empty chart: the whole first-visit panel is STILL ordered — a never-drawn test needs no gestational age:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ rh: 'positive', meds: QUIET_MEDS }) });
    expect('pending questions', keysOf(r.pending), PN_GA);
    expectAll('(ordered before the gestational age is answered)', r.state, PANEL, 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ rh: 'positive', meds: QUIET_MEDS }), replay: [{ decline: PN_GA }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(ordered)', r.state, PANEL, 'INCLUDED');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    console.log('  … with an HIV test on file at some earlier date and the gestational age declined: that one test is not ordered (it cannot be placed in or out of this pregnancy):');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ rh: 'positive', meds: QUIET_MEDS, labs: [['56888-1', 1, '2025-01-10']] }), replay: [{ decline: PN_GA }] });
    expect('lab-8 HIV', status(r.state, 'lab-8'), 'GATED_OUT');
    expect('lab-1 CBC', status(r.state, 'lab-1'), 'INCLUDED');

    // 37 weeks at AS_OF 2026-09-24: the pregnancy began 2026-01-08 and week 36 began 2026-09-17.
    console.log('  37 weeks: GBS culture ordered; a culture at 36 2/7 weeks (2026-09-19), or O99.820 on the chart → not ordered; a culture at 35 weeks (2026-09-10) does not count:');
    const late = (extra: { codes?: string[]; labs?: Lab[]; ga?: number }) =>
      prenatalPatient({ ...quiet, ga: extra.ga ?? 37, codes: ['O24.410', ...(extra.codes ?? [])], labs: [['718-7', 12, '2026-09-18'], ...(extra.labs ?? [])] });
    r = await resolveSession({ file: PRENATAL, reverse, patient: late({}) });
    expectAll('(ordered)', r.state, ['step-11-4', 'lab-27'], 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: late({ labs: [['72607-5', 1, '2026-09-19']] }) });
    expectAll('(not ordered)', r.state, ['step-11-4', 'lab-27'], 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: late({ codes: ['O99.820'] }) });
    expectAll('(not ordered)', r.state, ['step-11-4', 'lab-27'], 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: late({ labs: [['72607-5', 1, '2026-09-10']] }) });
    expectAll('(ordered: drawn before 36 0/7 weeks)', r.state, ['step-11-4', 'lab-27'], 'INCLUDED');
    console.log('  … 41 4/7 weeks (week 36 began 2026-08-16): a culture drawn at 36 2/7 weeks (2026-08-18, 37 days ago) has expired (valid 5 weeks) → ordered again:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: late({ ga: 41.5, labs: [['72607-5', 1, '2026-08-18']] }) });
    expectAll('(ordered)', r.state, ['step-11-4', 'lab-27'], 'INCLUDED');
  }
}

async function provePrenatalVaccines(): Promise<void> {
  console.log(`\n=== prenatal-vaccines: routine prenatal care — vaccines read from the medication list; the season from the calendar (${PRENATAL}) ===`);
  const TDAP = ['step-9-10', 'med-5', 'sched-4'];
  const TDAP_ASK = 'patient.tdap_given_this_pregnancy';
  const RSV = ['step-10-2', 'med-7', 'sched-6'];
  const RSV_ASK = 'patient.rsv_vaccine_ever_given';
  const FLU = ['step-1-31', 'med-3'];
  const FLU_ASK = 'gate-influenza-vaccine-given';
  const COVID = ['step-1-32', 'med-4'];
  const COVID_ASK = 'gate-covid-vaccine-given';
  const OCT = '2026-10-15T12:00:00.000Z';
  // 34 weeks: Stage 9 (Tdap) and Stage 10 (RSV) are open. At AS_OF 2026-09-24 this pregnancy began 2026-01-29.
  const pt = (meds: Array<string | PnMed>, labDate = '2026-09-15', attrs?: Record<string, boolean>) => prenatalPatient({ ga: 34, rh: 'positive', codes: ['O24.410'],
    labs: [['718-7', 12, labDate]], meds: ['4511', '243670', ...meds], ...(attrs ? { attrs } : {}) });
  const asked = (r: { pending: any[] }, key: string) => String(r.pending.some((p: any) => p.gateId === key || p.datumKey === key));
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);

    console.log('  no vaccine on the medication list (late September): Tdap, RSV, influenza and COVID-19 are all recommended, nothing asked:');
    let r = await resolveSession({ file: PRENATAL, reverse, patient: pt([]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(recommended)', r.state, [...TDAP, ...RSV, ...FLU, ...COVID], 'INCLUDED');

    console.log('  INFLUENZA, clock 2026-10-15 — "this season" is since September 1: a dose on Aug 20 does not count, a dose on Sep 5 does:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2746468', '2026-08-20']], '2026-10-10') });
    expectAll('(Aug 20: recommended)', r.state, FLU, 'INCLUDED');
    expect('influenza question', asked(r, FLU_ASK), 'false');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2746468', '2026-09-05']], '2026-10-10') });
    expectAll('(Sep 5: not recommended)', r.state, FLU, 'GATED_OUT');
    expect('influenza question', asked(r, FLU_ASK), 'false');
    expectAll('(COVID-19 unaffected)', r.state, COVID, 'INCLUDED');
    console.log('  … on Sep 1 itself it counts; on Aug 31 it does not:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2746468', '2026-09-01']], '2026-10-10') });
    expectAll('(Sep 1: not recommended)', r.state, FLU, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2746468', '2026-08-31']], '2026-10-10') });
    expectAll('(Aug 31: recommended)', r.state, FLU, 'INCLUDED');
    console.log('  … clock 2026-06-15: last October\'s dose (2025-10-20) is still this season\'s (since 2025-09-01):');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: '2026-06-15T12:00:00.000Z', patient: pt([['2719212', '2025-10-20']], '2026-06-10') });
    expectAll('(not recommended)', r.state, FLU, 'GATED_OUT');
    console.log('  COVID-19, clock 2026-10-15: a dose on Sep 20 → not offered; on Jul 26 → offered:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2722605', '2026-09-20']], '2026-10-10') });
    expectAll('(not offered)', r.state, COVID, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([['2722605', '2026-07-26']], '2026-10-10') });
    expectAll('(offered)', r.state, COVID, 'INCLUDED');

    console.log('  INFLUENZA and COVID-19 are recommended only IN SEASON (September 1 to March 31): clock in July, no dose → not recommended, nothing asked; in October → recommended:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: '2026-07-15T12:00:00.000Z', patient: pt([], '2026-07-10') });
    expectAll('(July: not recommended)', r.state, [...FLU, ...COVID, 'med-3b', 'med-4b'], 'GATED_OUT');
    expect('influenza question', asked(r, FLU_ASK), 'false');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([], '2026-10-10') });
    expectAll('(October: recommended)', r.state, [...FLU, ...COVID], 'INCLUDED');
    console.log('  … July, with an UNDATED influenza and COVID-19 vaccine on the list: out of season nothing is asked either:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: '2026-07-15T12:00:00.000Z', patient: pt(['2746457', '2722600'], '2026-07-10') });
    expect('influenza question', asked(r, FLU_ASK), 'false');
    expect('COVID-19 question', asked(r, COVID_ASK), 'false');
    console.log('  … the season\'s edges: March 31 in, April 1 out; August 31 out, September 1 in:');
    for (const [day, want] of [['2027-03-31', 'INCLUDED'], ['2027-04-01', 'GATED_OUT'], ['2026-08-31', 'GATED_OUT'], ['2026-09-01', 'INCLUDED']] as const) {
      r = await resolveSession({ file: PRENATAL, reverse, asOf: `${day}T12:00:00.000Z`, patient: pt([], day) });
      expect(`clock ${day}: influenza / COVID-19`, `${status(r.state, 'step-1-31')} / ${status(r.state, 'step-1-32')}`, `${want} / ${want}`);
    }

    console.log('  an UNDATED influenza vaccine on the list: asked "given this season (since September 1)?" — yes → not recommended, no → recommended; not asked twice:');
    const undatedFlu = pt(['2746457']);
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedFlu });
    expect('pending questions', keysOf(r.pending), FLU_ASK);
    expect('prompt', String(r.pending[0]?.prompt), 'Influenza vaccine given this season (since September 1)?');
    expectAll('(not recommended before the answer)', r.state, FLU, 'GATED_OUT');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedFlu, replay: [{ gate: FLU_ASK, answer: YES }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(yes: not recommended; add the date)', r.state, ['step-1-34', 'guid-20'], 'INCLUDED');
    expectAll('(yes: no vaccine order)', r.state, ['med-3', 'med-3b'], ['GATED_OUT', 'EXCLUDED']);
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedFlu, replay: [{ gate: FLU_ASK, answer: NO }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(no: recommended)', r.state, ['step-1-35', 'med-3b'], 'INCLUDED');
    console.log('  … an undated entry beside a DATED dose this season: the dated dose settles it — nothing asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt(['2746457', ['2746468', '2026-09-10']]) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(not recommended)', r.state, [...FLU, 'med-3b'], 'GATED_OUT');
    console.log('  an undated COVID-19 vaccine: asked; no → offered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt(['2722600']), replay: [{ gate: COVID_ASK, answer: NO }] });
    expectAll('(offered)', r.state, ['step-1-38', 'med-4b'], 'INCLUDED');

    console.log('  TDAP given THIS pregnancy (Boostrix, 2026-08-20): not recommended, nothing asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt([['1300370', '2026-08-20']]) });
    expectAll('(not recommended)', r.state, TDAP, 'GATED_OUT');
    expect('Tdap question', asked(r, TDAP_ASK), 'false');
    console.log('  Tdap given in a PRIOR pregnancy (Adacel, 2024-05-01, still listed with no end date): recommended again, nothing asked:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt([['1300191', '2024-05-01']]) });
    expectAll('(recommended)', r.state, TDAP, 'INCLUDED');
    expect('Tdap question', asked(r, TDAP_ASK), 'false');
    console.log('  Tdap the day BEFORE this pregnancy began (2026-01-28): recommended; on its first day (2026-01-29): not:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt([['1300370', '2026-01-28']]) });
    expectAll('(recommended)', r.state, TDAP, 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt([['1300370', '2026-01-29']]) });
    expectAll('(not recommended)', r.state, TDAP, 'GATED_OUT');
    console.log('  an UNDATED Tdap on the list: asked "Tdap given this pregnancy?" — yes → not recommended, no → recommended:');
    const undatedTdap = (attrs?: Record<string, boolean>) => pt(['583411'], '2026-09-15', attrs);
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedTdap() });
    expect('pending questions', keysOf(r.pending), TDAP_ASK);
    expect('prompt', String(r.pending[0]?.prompt), 'Tdap given this pregnancy?');
    expect('answer type', String(r.pending[0]?.answerType), 'BOOLEAN');
    expectAll('(held: not assumed given, not recommended)', r.state, [...TDAP, 'med-5b'], ['GATED_OUT', 'PENDING_QUESTION']);
    for (const g of ['gate-tdap-given', 'gate-tdap-not-given']) expect(`remember_answer on ${g}`, rememberOf(g), '{"scope":"PREGNANCY","values":[true]}');
    console.log('  … answered yes — or supplied true at a later encounter, as a remembered answer is: NOT asked, NOT recommended:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedTdap({ tdap_given_this_pregnancy: true }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(already given; add the date)', r.state, ['step-9-12', 'guid-22'], 'INCLUDED');
    expectAll('(no Tdap order)', r.state, ['med-5', 'med-5b'], 'GATED_OUT');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    console.log('  … answered no: recommended:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedTdap({ tdap_given_this_pregnancy: false }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(recommended)', r.state, ['step-9-13', 'med-5b', 'sched-4b'], 'INCLUDED');
    console.log('  … "Not available": unknown is treated like "no" — Tdap is recommended, the "already given" side is closed, nothing blocks:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedTdap(), replay: [{ decline: TDAP_ASK }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(recommended)', r.state, ['step-9-13', 'med-5b', 'sched-4b'], 'INCLUDED');
    expectAll('("already given" side closed; the other Tdap step stays closed)', r.state, ['step-9-12', 'guid-22', ...TDAP], 'GATED_OUT');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    console.log('  … the remembered "yes" matters only while the entry is undated: with NO Tdap on the list it is ignored and Tdap is recommended:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: pt([], '2026-09-15', { tdap_given_this_pregnancy: true }) });
    expectAll('(recommended)', r.state, TDAP, 'INCLUDED');

    console.log('  RSV at 34 weeks, empty list — the SEASON is September 1 to March 1: clock in October → offered; in June → nothing offered, nothing asked:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: pt([], '2026-10-10') });
    expectAll('(October: offered)', r.state, RSV, 'INCLUDED');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: '2026-06-15T12:00:00.000Z', patient: pt([], '2026-06-10') });
    expectAll('(June: not offered)', r.state, [...RSV, 'step-10-3', 'med-7b'], 'GATED_OUT');
    expect('RSV question', asked(r, RSV_ASK), 'false');
    expect('step-10-1 (the stage itself is open at 34 weeks)', status(r.state, 'step-10-1'), 'INCLUDED');
    console.log('  … the season\'s edges: March 1 is in, March 2 is out; August 31 is out, September 1 is in:');
    for (const [day, want] of [['2027-03-01', 'INCLUDED'], ['2027-03-02', 'GATED_OUT'], ['2026-08-31', 'GATED_OUT'], ['2026-09-01', 'INCLUDED']] as const) {
      r = await resolveSession({ file: PRENATAL, reverse, asOf: `${day}T12:00:00.000Z`, patient: pt([], day) });
      expect(`clock ${day}: step-10-2`, status(r.state, 'step-10-2'), want);
    }
    console.log('  … in season but outside 32 0/7–36 6/7 weeks (28 weeks, October): not offered:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: OCT, patient: prenatalPatient({ ...quiet, ga: 28, codes: ['O24.410'], meds: ['4511', '243670'], labs: [['718-7', 12, '2026-10-10']] }) });
    expectAll('(not offered)', r.state, RSV, 'GATED_OUT');
    console.log('  RSV vaccine EVER given, dated — this pregnancy (2026-09-01) or an earlier one (2024-10-10): not offered, nothing asked:');
    for (const date of ['2026-09-01', '2024-10-10']) {
      r = await resolveSession({ file: PRENATAL, reverse, patient: pt([['2642148', date]]) });
      expectAll(`(${date}: not offered)`, r.state, [...RSV, 'med-7b'], 'GATED_OUT');
      expect('RSV question', asked(r, RSV_ASK), 'false');
    }
    console.log('  an UNDATED RSV vaccine: asked "Has she ever had the RSV vaccine?" — yes → not offered, no → offered:');
    const undatedRsv = (attrs?: Record<string, boolean>) => pt(['2642144'], '2026-09-15', attrs);
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedRsv() });
    expect('pending questions', keysOf(r.pending), RSV_ASK);
    expect('prompt', String(r.pending[0]?.prompt), 'Has she ever had the RSV vaccine?');
    for (const g of ['gate-rsv-vaccine-given', 'gate-rsv-vaccine-not-given']) expect(`remember_answer on ${g}`, rememberOf(g), '{"scope":"PATIENT","values":[true]}');
    console.log('  … answered yes — or supplied true at a later encounter (remembered for the patient): NOT asked, NOT offered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedRsv({ rsv_vaccine_ever_given: true }) });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(already given)', r.state, ['step-10-4', 'guid-23'], 'INCLUDED');
    expectAll('(no RSV order)', r.state, ['med-7', 'med-7b'], 'GATED_OUT');
    console.log('  … answered no: offered:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedRsv({ rsv_vaccine_ever_given: false }) });
    expectAll('(offered)', r.state, ['step-10-5', 'med-7b', 'sched-6b'], 'INCLUDED');
    console.log('  … "Not available": unknown is treated like "no" — the RSV vaccine is offered, the "already given" side is closed, nothing blocks:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: undatedRsv(), replay: [{ decline: RSV_ASK }] });
    expect('pending questions', keysOf(r.pending), '(none)');
    expectAll('(offered)', r.state, ['step-10-5', 'med-7b', 'sched-6b'], 'INCLUDED');
    expectAll('("already given" side closed)', r.state, ['step-10-4', 'guid-23', ...RSV], 'GATED_OUT');
    expect('care-plan blockers', String(validateForGeneration(r.state, r.redFlags).length), '0');
    console.log('  … out of season an undated RSV vaccine is not asked about:');
    r = await resolveSession({ file: PRENATAL, reverse, asOf: '2026-06-15T12:00:00.000Z', patient: pt(['2642144'], '2026-06-10') });
    expect('RSV question', asked(r, RSV_ASK), 'false');

    console.log('  gestational age missing: the Tdap stage is held on the one gestational-age question:');
    r = await resolveSession({ file: PRENATAL, reverse, patient: prenatalPatient({ ...quiet, meds: ['4511', '243670'] }) });
    expect('gestational-age questions', String(r.pending.filter((p: any) => p.datumKey === PN_GA).length), '1');
  }
}

const PROOFS: Record<string, () => Promise<void>> = {
  'attribute-form': proveAttributeForm,
  'dp-1': proveDp1,
  'dp-1-scoring': proveDp1Scoring,
  'ga': proveGa,
  'shared-leaves': proveSharedLeaves,
  'mcv': proveMcv,
  'empiric': proveEmpiric,
  'response': proveResponse,
  'dp-3': proveDp3,
  'iv-ferritin': proveIvFerritin,
  'malabsorption': proveMalabsorption,
  'hgbpathy': proveHgbpathy,
  'ghtn-shared-labs': proveGhtnSharedLabs,
  'unknown-hgb': proveUnknownHgb,
  'on-iron': proveOnIron,
  'hgb-recheck': proveHgbRecheck,
  'response-recheck': proveResponseRecheck,
  'ghtn-seizure': proveGhtnSeizure,
  'uti-shared-labs': proveUtiSharedLabs,
  'prenatal-ga': provePrenatalGa,
  'prenatal-triggers': provePrenatalTriggers,
  'prenatal-gdm': provePrenatalGdm,
  'prenatal-handoffs': provePrenatalHandoffs,
  'prenatal-meds': provePrenatalMeds,
  'prenatal-vaccines': provePrenatalVaccines,
};

async function main() {
  const wanted = process.argv.slice(2);
  for (const name of wanted.length ? wanted : Object.keys(PROOFS)) {
    if (!PROOFS[name]) throw new Error(`unknown proof "${name}" — one of ${Object.keys(PROOFS).join(', ')}`);
    await PROOFS[name]();
  }
  console.log(failures === 0 ? '\n✓ all expectations held' : `\n✗ ${failures} expectation(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
