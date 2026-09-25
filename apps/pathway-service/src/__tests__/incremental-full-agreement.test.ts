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
import { GateAnswer, PendingQuestion } from '../services/resolution/types';
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

function patientOf(opts: {
  codes?: Array<string | { code: string; date: string }>;
  labs?: Array<[string, number]>;
  vitals?: Record<string, number>;
  attrs?: Record<string, number>;
}): PatientContext {
  return {
    patientId: 'agreement',
    conditionCodes: (opts.codes ?? []).map((c) => ({ ...(typeof c === 'string' ? { code: c } : c), system: 'ICD-10' })),
    medications: [], allergies: [], vitalSigns: opts.vitals ?? {}, patientAttributes: opts.attrs ?? {},
    labResults: (opts.labs ?? []).map(([code, value]) => ({ code, system: 'LOINC', value })),
  } as unknown as PatientContext;
}

function engineFor(patient: PatientContext): TraversalEngine {
  const tc = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
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
}

/**
 * Traverse, then give each answer as it is asked, re-resolving incrementally
 * the way the mutations do; after every step compare against a full traversal
 * of the answers given so far.
 */
async function replayAndCompare(s: Scenario, reverse: boolean, seeding: Seeding): Promise<string[]> {
  const graph = graphFrom(s.file, reverse);
  const engine = engineFor(s.patient);
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

    const full = await engineFor(s.patient).traverse(graph, s.patient, new Map(given));
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
const MCV72_FER12: Array<[string, number]> = [['787-2', 72], ['2276-4', 12], ['718-7', 9.5]];
const MCV72_NO_FERRITIN: Array<[string, number]> = [['787-2', 72], ['718-7', 9.5]];

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
  {
    name: 'anemia: ferritin 12, workup chosen, then the response question',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: MCV72_FER12, attrs: { gestational_age_weeks: 20 } }),
    answers: [['dp-1', pick('step-1-2')], ['gate-hgb-response', pick('not responding')]],
    mustAnswer: ['dp-1', 'gate-hgb-response'],
  },
  {
    name: 'anemia: empiric chosen, "not yet" then "not responding"',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: MCV72_NO_FERRITIN, attrs: { gestational_age_weeks: 20 } }),
    answers: [
      ['dp-1', pick('stage-2-empiric')],
      ['gate-hgb-response', pick('recheck not yet done')],
    ],
    mustAnswer: ['dp-1', 'gate-hgb-response'],
  },
  {
    name: 'anemia: empiric chosen, responding',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: MCV72_FER50, attrs: { gestational_age_weeks: 20 } }),
    answers: [['dp-1', pick('stage-2-empiric')], ['gate-hgb-response', pick('responding')]],
    mustAnswer: ['dp-1', 'gate-hgb-response'],
  },
  {
    name: 'anemia: empiric chosen, not responding, GA 12',
    file: ANEMIA, patient: patientOf({ codes: ['O99.012'], labs: MCV72_FER50, attrs: { gestational_age_weeks: 12 } }),
    answers: [['dp-1', pick('stage-2-empiric')], ['gate-hgb-response', pick('not responding')]],
    mustAnswer: ['dp-1', 'gate-hgb-response'],
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
