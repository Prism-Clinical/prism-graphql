/**
 * Incremental replay must land where a full traversal of the same answers
 * lands — on the authored pathways, not only on hand-built graphs.
 *
 * The live app never re-traverses from the root after an answer: it replays
 * each answer through `resolveIncrementally`, seeded the way the mutations
 * seed it (the answered gate for `answerGateQuestion`, the DecisionPoint for
 * `answerPendingDecision`). A full traversal with every answer pre-loaded is
 * the reference. Wherever the two disagree, the session the provider is
 * looking at is not the one the pathway describes.
 *
 * They did disagree. The answer path seeded the gate's whole containment
 * closure, which includes EvidenceCitation and CodeEntry leaves shared across
 * the graph, and `promote()` re-entered at ANY Gate or DecisionPoint parent of
 * a seed — so a DecisionPoint that merely CITES a shared citation was walked
 * as a root, outside the gate that had closed it, and pended. On the
 * gestational-hypertension pathway, answering "aspirin indicated" re-opened
 * DP-1 inside the gated-out work-up; on UTI in pregnancy, answering "no GBS"
 * did the same.
 *
 * Every scenario runs in file AND reversed edge order (storage order is not
 * file order), and under both seedings: the gate alone, which the resolver now
 * sends, and the gate plus its whole containment closure, which it used to —
 * the engine must not depend on a caller getting that right.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { containmentClosure } from '../services/resolution/graph-containment';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import { normalizePatientAttributes } from '../services/resolution/patient-attributes';
import { GateAnswer, PendingQuestion, TraversalResult } from '../services/resolution/types';
import { GraphContext, GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';

const AS_OF = '2026-09-24T12:00:00.000Z';
const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };
const PATHWAYS = resolve(__dirname, '../../../../pathways/json');
const ANEMIA = 'anemia-in-pregnancy.json';
const GHTN = 'gestational-hypertension-preeclampsia.json';
const UTI = 'uti-asymptomatic-bacteriuria-pregnancy.json';

/** What the importer stores, minus the database. */
function graphFrom(file: string, reverse: boolean): GraphContext {
  const pw = JSON.parse(readFileSync(resolve(PATHWAYS, file), 'utf8'));
  const nodes: GraphNode[] = [
    { id: 'root', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: pw.pathway.title } },
    ...pw.nodes.map((n: { id: string; type: string; properties: Record<string, unknown> }) => ({
      id: n.id, nodeIdentifier: n.id, nodeType: n.type, properties: { title: n.id, ...n.properties },
    })),
  ];
  let edges: GraphEdge[] = pw.edges.map(
    (e: { type: string; from: string; to: string; properties?: Record<string, unknown> }, i: number) => ({
      id: `e${i}`, edgeType: e.type, sourceId: e.from, targetId: e.to, properties: e.properties ?? {},
    }),
  );
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
  };
}

/** A LOINC result: `[code, value]` (undated, as the simulator sends it) or `[code, value, 'YYYY-MM-DD']`. */
type Lab = [string, number] | [string, number, string];

function patientOf(opts: {
  codes?: Array<string | { code: string; date: string }>;
  labs?: Lab[];
  vitals?: Record<string, number>;
  attrs?: Record<string, number>;
}): PatientContext {
  return {
    patientId: 'agreement',
    conditionCodes: (opts.codes ?? []).map((c) => ({ ...(typeof c === 'string' ? { code: c } : c), system: 'ICD-10' })),
    medications: [], allergies: [], vitalSigns: opts.vitals ?? {},
    // As the resolvers do: trimester is derived from gestational age when only GA is given.
    patientAttributes: normalizePatientAttributes(opts.attrs ?? {}) ?? {},
    labResults: (opts.labs ?? []).map(([code, value, date]) => ({ code, system: 'LOINC', value, ...(date ? { date } : {}) })),
  } as unknown as PatientContext;
}

/**
 * The session's clock and what it read at session start. `asOf` pins the
 * clock (default AS_OF). `oralIronStart` (YYYY-MM-DD) is a stored care plan of
 * the anemia pathway that recommended oral iron that day — what a start
 * visit's committed plan gives every later visit, and what anchors the
 * `window_from` response gates at a recheck. The resolver reads those rows at
 * session start and pins them with withTherapyStarts; so does this.
 */
interface Visit { asOf?: string; oralIronStart?: string }

function engineFor(patient: PatientContext, visit: Visit = {}): TraversalEngine {
  let tc = makeEvaluationTemporalContext({ evaluationAsOf: visit.asOf ?? AS_OF, temporalPolicyVersion: 'v1' });
  if (visit.oralIronStart) {
    tc = withTherapyStarts(tc, [{
      clinicalRole: 'oral-iron-repletion', date: visit.oralIronStart,
      source: { carePlanId: 'cp-agreement', interventionId: 'i-agreement', pathwayId: 'anemia-in-pregnancy', nodeId: 'med-1' },
    }]);
  }
  const facts = assembleContext({ mode: 'SYNTHETIC', patientContext: patient } as never, tc);
  return new TraversalEngine(
    {
      computeNodeConfidence: async () => ({ confidence: 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED' }),
    } as never,
    THRESHOLDS, tc, {}, facts, new Map(),
  );
}

const YES = { booleanValue: true } as GateAnswer;
const NO = { booleanValue: false } as GateAnswer;
const pick = (o: string) => ({ selectedOption: o }) as GateAnswer;

const asks = (q: PendingQuestion, id: string) => q.gateId === id || (q.askedByNodeIds ?? []).includes(id);

type Seeding = 'gate' | 'closure';

const NON_REFERENCE = new Set([
  'Pathway', 'Stage', 'Step', 'Gate', 'DecisionPoint',
  'Medication', 'LabTest', 'Imaging', 'Procedure', 'Guidance',
]);

/**
 * A citation or code entry that several nodes refer to.
 *
 * Its status in a FULL traversal is whichever host the walk reached first —
 * a closing gate's sweep writes it GATED_OUT and a live step arriving later
 * finds it already written, or the other way round — so it moves with edge
 * order and is not a reference either walk can be held to. What IS the
 * incremental walk's to get right is not leaving one closed that the full
 * traversal found live: that was the region's own sweep overwriting a leaf a
 * host outside the answer still refers to.
 */
function isSharedReferenceLeaf(graph: GraphContext, node: GraphNode): boolean {
  if (NON_REFERENCE.has(node.nodeType)) return false;
  const contains = (e: GraphEdge) => e.edgeType !== 'REQUIRES';
  if (graph.outgoingEdges(node.nodeIdentifier).some(contains)) return false;
  return graph.incomingEdges(node.nodeIdentifier).filter(contains).length > 1;
}

interface Scenario {
  name: string;
  file: string;
  patient: PatientContext;
  /**
   * The provider's intended answers, by gate or DecisionPoint id, in the order
   * they would give them. Each is given only once it is actually being asked —
   * the live app offers nothing else — so an answer to a question that never
   * pends in this scenario is simply never given.
   */
  answers: Array<[string, GateAnswer]>;
  /** Ids that MUST have been asked and answered, so a scenario cannot pass by doing nothing. */
  mustAnswer: string[];
  /** The visit's clock and stored therapy starts; both walks get the same one. */
  visit?: Visit;
  /**
   * What the final incremental state must show, so agreement cannot hold by
   * both walks missing the point (an anchor that never landed reads every
   * visit as a start visit, and the two would still agree).
   */
  outcome?: (r: TraversalResult, pending: PendingQuestion[]) => string[];
}

/**
 * Traverse, then give each answer as it is asked, re-resolving incrementally
 * the way the mutations do; after every step compare against a full traversal
 * of the answers given so far.
 */
async function replayAndCompare(s: Scenario, reverse: boolean, seeding: Seeding): Promise<string[]> {
  const graph = graphFrom(s.file, reverse);
  const engine = engineFor(s.patient, s.visit);
  const given = new Map<string, GateAnswer>();
  const r = await engine.traverse(graph, s.patient, given);
  let pending = r.pendingQuestions;
  let redFlags = r.redFlags;
  const problems: string[] = [];
  const remaining = [...s.answers];

  for (;;) {
    const idx = remaining.findIndex(([id]) => pending.some((q) => asks(q, id)));
    if (idx === -1) break;
    const [id, answer] = remaining.splice(idx, 1)[0];
    given.set(id, answer);
    const isDp = graph.getNode(id)?.nodeType === 'DecisionPoint';
    const seed = isDp || seeding === 'gate' ? new Set([id]) : containmentClosure(graph, [id]);
    const rr = await engine.resolveIncrementally(
      seed, r.resolutionState, r.dependencyMap, graph, s.patient, given,
      { pendingQuestions: pending, redFlags, alsoDropGateIds: [id] },
    );
    pending = rr.pendingQuestions;
    redFlags = rr.redFlags;

    const full = await engineFor(s.patient, s.visit).traverse(graph, s.patient, new Map(given));
    const ids = new Set([...r.resolutionState.keys(), ...full.resolutionState.keys()]);
    for (const n of ids) {
      const a = r.resolutionState.get(n)?.status ?? '(absent)';
      const b = full.resolutionState.get(n)?.status ?? '(absent)';
      if (a === b) continue;
      const node = graph.getNode(n);
      if (node && isSharedReferenceLeaf(graph, node)) {
        // See isSharedReferenceLeaf: only "closed here, live there" is a
        // disagreement the incremental walk owns.
        if (b === 'INCLUDED') problems.push(`after ${id}: shared leaf ${n} incremental=${a} full=${b}`);
        continue;
      }
      problems.push(`after ${id}: ${node?.nodeType} ${n} incremental=${a} full=${b}`);
    }
    const pi = pending.map((q) => q.gateId).sort().join(',');
    const pf = full.pendingQuestions.map((q) => q.gateId).sort().join(',');
    if (pi !== pf) problems.push(`after ${id}: pending incremental=[${pi}] full=[${pf}]`);
    // Care-plan generation blocks on ANY PENDING_QUESTION node, leaves included.
    const blocksI = [...r.resolutionState.values()].some((x) => x.status === 'PENDING_QUESTION');
    const blocksF = [...full.resolutionState.values()].some((x) => x.status === 'PENDING_QUESTION');
    if (blocksI !== blocksF) problems.push(`after ${id}: generation blocked incremental=${blocksI} full=${blocksF}`);
  }
  const answered = new Set(given.keys());
  for (const id of s.mustAnswer) if (!answered.has(id)) problems.push(`${id} was never asked`);
  if (s.outcome) problems.push(...s.outcome(r, pending).map((p) => `outcome: ${p}`));
  return problems;
}

// ── Scenarios ─────────────────────────────────────────────────────────

const NORMAL_BP = { systolic_bp: 120, diastolic_bp: 75 };
const HIGH_BP = { systolic_bp: 150, diastolic_bp: 95 };
const GHTN_LABS: Array<[string, number]> = [['777-3', 220], ['2160-0', 0.7]];
const ghtnDiagnosed = (severe: boolean): Array<[string, GateAnswer]> => [
  ['gate-aspirin-indicated', NO],
  ['gate-htn-confirmed', YES],
  ['gate-severe-feature-symptoms', severe ? YES : NO],
  ['gate-no-severe-features', severe ? NO : YES],
  ['dp-1', pick('step-2-3a')],
];

const AFEBRILE = { temperature_f: 98.6 };
const NEGATIVE: Array<[string, number]> = [['19090-0', 1000]];
const POSITIVE: Array<[string, number]> = [['19090-0', 150000]];
const utiTreated = (a: { symptomatic: boolean; gbs: boolean; completed: boolean }): Array<[string, GateAnswer]> => [
  ['gate-symptomatic', a.symptomatic ? YES : NO],
  ['gate-gbs-identified', a.gbs ? YES : NO],
  ['gate-gbs-treat-threshold', NO],
  ['gate-first-trimester', NO],
  ['dp-1', pick('step-5-2a')],
  ['gate-treatment-completed', a.completed ? YES : NO],
];

const MCV72_FER50: Array<[string, number]> = [['787-2', 72], ['2276-4', 50], ['718-7', 9.5]];

// The anemia response check's clock (as gate-proof's `response` proof): oral
// iron starts on DAY0 and the check is due 14 days later. Hgb is dated only —
// an undated value would compete with the dated baseline and recheck.
const EMPIRIC = 'stage-2-empiric';
const DAY0 = '2026-06-01T15:00:00.000Z';
const RECHECK_VISIT: Visit = { asOf: '2026-06-22T15:00:00.000Z', oralIronStart: '2026-06-01' };
const START_HGB: Lab[] = [['718-7', 9.5, '2026-05-29']];
const RECHECK = (hgb: number): Lab[] => [...START_HGB, ['718-7', hgb, '2026-06-20']];
const empiricLabs = (hgb: Lab[]): Lab[] => [['787-2', 72], ...hgb];
const confirmedLabs = (hgb: Lab[]): Lab[] => [['787-2', 72], ['2276-4', 12], ...hgb];
/** The confirmed arm: workup at DP-1, then the oral-iron trial at DP-3. */
const CONFIRMED_ORAL: Array<[string, GateAnswer]> = [['dp-1', pick('step-1-2')], ['dp-3', pick('stage-2-oral')]];
const RESPONSE_GATES = ['gate-hgb-response', 'gate-hgb-nonresponse'];

function expectStatus(r: TraversalResult, want: Record<string, string>): string[] {
  return Object.entries(want).flatMap(([id, status]) => {
    const got = r.resolutionState.get(id)?.status ?? '(absent)';
    return got === status ? [] : [`${id} is ${got}, expected ${status}`];
  });
}

/** Nothing pending is asked by a response gate — no verdict, no datum. */
function responseQuestions(pending: PendingQuestion[]): string[] {
  return pending.filter((q) => RESPONSE_GATES.some((g) => asks(q, g)))
    .map((q) => `response check asks ${q.gateId}${q.datumKey ? ` (${q.datumKey})` : ''}`);
}

function anchoredOn(r: TraversalResult, source: string): string[] {
  return RESPONSE_GATES.flatMap((g) => {
    const got = r.resolutionState.get(g)?.windowAnchors?.[0]?.source ?? '(none)';
    return got === source ? [] : [`${g} anchored on ${got}, expected ${source}`];
  });
}

/** The start visit: both response gates closed NOT YET DUE, nothing asked. */
function startVisit(r: TraversalResult, pending: PendingQuestion[]): string[] {
  return [
    ...expectStatus(r, { 'step-2-3': 'INCLUDED', 'gate-hgb-response': 'GATED_OUT', 'gate-hgb-nonresponse': 'GATED_OUT' }),
    ...RESPONSE_GATES.filter((g) => r.resolutionState.get(g)?.notYetDue !== true).map((g) => `${g} is not NOT_YET_DUE`),
    ...anchoredOn(r, 'SESSION_RECOMMENDATION'),
    ...responseQuestions(pending),
  ];
}

/** A due recheck: anchored on the stored care plan, decided from chart data, nothing asked. */
function dueRecheck(r: TraversalResult, pending: PendingQuestion[]): string[] {
  return [
    ...RESPONSE_GATES.filter((g) => r.resolutionState.get(g)?.notYetDue === true).map((g) => `${g} is still not yet due`),
    ...anchoredOn(r, 'CARE_PLAN'),
    ...responseQuestions(pending),
  ];
}

const SCENARIOS: Scenario[] = [
  // The reported repro: aspirin "yes" with a normal BP re-opened DP-1 (and, in
  // reversed order, gate-no-severe-features) inside the gated-out work-up.
  {
    name: 'ghtn: aspirin indicated, BP 120/75',
    file: GHTN, patient: patientOf({ labs: GHTN_LABS, vitals: NORMAL_BP }),
    answers: [['gate-aspirin-indicated', YES]], mustAnswer: ['gate-aspirin-indicated'],
  },
  {
    name: 'ghtn: aspirin not indicated, BP 150/95, hypertension not confirmed',
    file: GHTN, patient: patientOf({ labs: GHTN_LABS, vitals: HIGH_BP }),
    answers: [['gate-aspirin-indicated', NO], ['gate-htn-confirmed', NO]],
    mustAnswer: ['gate-aspirin-indicated', 'gate-htn-confirmed'],
  },
  {
    name: 'ghtn: gestational HTN, quantitative proteinuria, no severe features',
    file: GHTN, patient: patientOf({ codes: ['O13.3'], labs: GHTN_LABS, vitals: HIGH_BP }),
    answers: ghtnDiagnosed(false), mustAnswer: ['gate-htn-confirmed', 'dp-1'],
  },
  {
    name: 'ghtn: preeclampsia, no severe features',
    file: GHTN, patient: patientOf({ codes: ['O14.03'], labs: GHTN_LABS, vitals: HIGH_BP }),
    answers: ghtnDiagnosed(false), mustAnswer: ['gate-htn-confirmed', 'dp-1'],
  },
  {
    name: 'ghtn: gestational HTN, severe feature on assessment',
    file: GHTN, patient: patientOf({ codes: ['O13.3'], labs: GHTN_LABS, vitals: HIGH_BP }),
    answers: ghtnDiagnosed(true), mustAnswer: ['gate-htn-confirmed', 'gate-severe-feature-symptoms'],
  },
  // The reported repro: "no GBS" on a negative culture re-opened DP-1
  // (reversed order).
  {
    name: 'uti: culture negative, no GBS',
    file: UTI, patient: patientOf({ labs: NEGATIVE, vitals: AFEBRILE }),
    answers: [['gate-gbs-identified', NO]], mustAnswer: ['gate-gbs-identified'],
  },
  {
    name: 'uti: culture positive, symptomatic, repeat culture chosen, course not completed',
    file: UTI, patient: patientOf({ labs: POSITIVE, vitals: AFEBRILE }),
    answers: utiTreated({ symptomatic: true, gbs: false, completed: false }),
    mustAnswer: ['gate-symptomatic', 'gate-gbs-identified', 'gate-treatment-completed'],
  },
  {
    name: 'uti: culture positive, asymptomatic, course completed',
    file: UTI, patient: patientOf({ labs: POSITIVE, vitals: AFEBRILE }),
    answers: utiTreated({ symptomatic: false, gbs: false, completed: true }),
    mustAnswer: ['gate-symptomatic', 'gate-gbs-identified', 'gate-treatment-completed'],
  },
  {
    name: 'uti: culture positive, GBS identified',
    file: UTI, patient: patientOf({ labs: POSITIVE, vitals: AFEBRILE }),
    answers: utiTreated({ symptomatic: false, gbs: true, completed: false }),
    mustAnswer: ['gate-gbs-identified'],
  },
  {
    name: 'uti: course completed, two dated O23 episodes (recurrent)',
    file: UTI,
    patient: patientOf({
      codes: [{ code: 'O23.42', date: '2026-07-01' }, { code: 'O23.42', date: '2026-09-01' }],
      labs: POSITIVE, vitals: AFEBRILE,
    }),
    answers: utiTreated({ symptomatic: false, gbs: false, completed: true }),
    mustAnswer: ['gate-treatment-completed'],
  },
  // Anemia DP-1, where a prior agent reported full traversal and incremental
  // replay disagreeing.
  {
    name: 'anemia: ferritin 50, workup chosen at DP-1',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: MCV72_FER50 }),
    answers: [['dp-1', pick('step-1-2')]], mustAnswer: ['dp-1'],
  },
  // Anemia v7: the oral-iron response check reads chart data — an anchored
  // Hgb delta since oral iron started (window_from, baseline 28 d, due 14 d
  // after the start) or Hgb at target by trimester — and asks nothing. Each
  // visit is its own session, so the provider re-chooses at DP-1 (and DP-3)
  // every time; later visits read the start from the stored care plan.
  {
    name: 'anemia: empiric chosen, start visit — response check not yet due, nothing asked',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: empiricLabs(START_HGB), attrs: { gestational_age_weeks: 20 } }),
    visit: { asOf: DAY0 },
    answers: [['dp-1', pick(EMPIRIC)]], mustAnswer: ['dp-1'],
    outcome: startVisit,
  },
  {
    name: 'anemia: ferritin 12, workup, oral trial at DP-3, start visit — response check not yet due',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: confirmedLabs(START_HGB), attrs: { gestational_age_weeks: 20 } }),
    visit: { asOf: DAY0 },
    answers: CONFIRMED_ORAL, mustAnswer: ['dp-1', 'dp-3'],
    outcome: (r, pending) => [...startVisit(r, pending), ...expectStatus(r, { 'stage-2-oral': 'INCLUDED', 'step-2-9': 'EXCLUDED' })],
  },
  {
    name: 'anemia: empiric chosen, day-21 recheck 9.5 → 10.7 — responder',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: empiricLabs(RECHECK(10.7)), attrs: { gestational_age_weeks: 20 } }),
    visit: RECHECK_VISIT,
    answers: [['dp-1', pick(EMPIRIC)], ['gate-hgbpathy-needed', NO], ['gate-transfusion-refusal', NO]],
    mustAnswer: ['dp-1', 'gate-hgbpathy-needed', 'gate-transfusion-refusal'],
    outcome: (r, pending) => [
      ...dueRecheck(r, pending),
      ...expectStatus(r, {
        'step-1-6': 'GATED_OUT', 'step-3-10': 'GATED_OUT',
        'gate-hgb-response': 'INCLUDED', 'step-2-4': 'INCLUDED',
        'gate-hgb-nonresponse': 'GATED_OUT', 'step-2-6': 'GATED_OUT', 'dp-2': 'GATED_OUT',
      }),
    ],
  },
  {
    name: 'anemia: ferritin 12, workup, oral trial at DP-3, day-21 recheck 9.5 → 9.9, GA 20 — nonresponder, IV iron',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: confirmedLabs(RECHECK(9.9)), attrs: { gestational_age_weeks: 20 } }),
    visit: RECHECK_VISIT,
    // The two question gates still in the pathway, so the gate-seeded and
    // closure-seeded answer paths are exercised here too, not only DP seeds.
    answers: [...CONFIRMED_ORAL, ['gate-hgbpathy-needed', YES], ['gate-transfusion-refusal', YES]],
    mustAnswer: ['dp-1', 'dp-3', 'gate-hgbpathy-needed', 'gate-transfusion-refusal'],
    outcome: (r, pending) => [
      ...dueRecheck(r, pending),
      ...expectStatus(r, {
        'step-1-6': 'INCLUDED', 'step-3-10': 'INCLUDED',
        'gate-hgb-nonresponse': 'INCLUDED', 'step-2-6': 'INCLUDED', 'dp-2': 'INCLUDED',
        'gate-iv-iron-ga': 'INCLUDED', 'step-2-5': 'INCLUDED',
        'gate-hgb-response': 'GATED_OUT', 'step-2-4': 'GATED_OUT',
      }),
    ],
  },
  {
    name: 'anemia: empiric chosen, day-21 recheck 9.5 → 9.9, GA 12 — nonresponder, IV iron gated out',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: empiricLabs(RECHECK(9.9)), attrs: { gestational_age_weeks: 12 } }),
    visit: RECHECK_VISIT,
    answers: [['dp-1', pick(EMPIRIC)]], mustAnswer: ['dp-1'],
    outcome: (r, pending) => [
      ...dueRecheck(r, pending),
      ...expectStatus(r, {
        'gate-hgb-nonresponse': 'INCLUDED', 'step-2-6': 'INCLUDED',
        'gate-iv-iron-ga': 'GATED_OUT', 'step-2-5': 'GATED_OUT', 'step-2-4': 'GATED_OUT',
      }),
    ],
  },
  {
    name: 'anemia: ferritin 12, workup, IV iron without an oral trial at DP-3 (3b), GA 20',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: confirmedLabs(START_HGB), attrs: { gestational_age_weeks: 20 } }),
    visit: { asOf: DAY0 },
    answers: [['dp-1', pick('step-1-2')], ['dp-3', pick('step-2-9')]], mustAnswer: ['dp-1', 'dp-3'],
    outcome: (r, pending) => [
      ...expectStatus(r, {
        'step-2-9': 'INCLUDED', 'gate-iv-iron-ga-direct': 'INCLUDED', 'step-2-10': 'INCLUDED',
        'stage-2-oral': 'EXCLUDED', 'gate-hgb-response': 'EXCLUDED', 'gate-hgb-nonresponse': 'EXCLUDED',
      }),
      ...responseQuestions(pending),
    ],
  },
];

describe('incremental replay agrees with a full traversal on the authored pathways', () => {
  for (const s of SCENARIOS) {
    for (const reverse of [false, true]) {
      for (const seeding of ['gate', 'closure'] as const) {
        it(`${s.name} [${reverse ? 'reversed' : 'file'} order, ${seeding} seed]`, async () => {
          expect(await replayAndCompare(s, reverse, seeding)).toEqual([]);
        });
      }
    }
  }
});
