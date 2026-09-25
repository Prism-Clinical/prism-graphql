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
//                    2.10); GA 12 gates IV out, GA missing asks; ferritin 50 and
//                    hemoglobinopathy disease never see DP-3
//   hgbpathy         anemia v7: hemoglobinopathy disease + MCV < 80 → no DP-1 (no
//                    empiric iron) and its own confirmatory iron studies (Step
//                    1.8); traits and uncoded patients keep DP-1; MCV ≥ 80 neither
//   ghtn-shared-labs gestational hypertension v2: BP, severity-panel and urine-protein
//                    labs split per host step — each follows its own step's gate
//   ghtn-seizure     gestational hypertension v4: Guid-5 "Seizure: call 911" follows
//                    Step 4.4 (outpatient, no severe features) in both edge orders
//   uti-shared-labs  UTI in pregnancy v3: organism ID, susceptibility and test-of-cure
//                    culture labs split per host step — each follows its own step's
//                    gate; the one Step 1.1/2.1 culture (both unconditional) is
//                    listed once
//
// The anemia proofs read pathways/json/anemia-in-pregnancy.json (override with
// ANEMIA_JSON=<path>); ghtn-* reads gestational-hypertension-preeclampsia.json
// (GHTN_JSON=<path>); uti-* reads uti-asymptomatic-bacteriuria-pregnancy.json
// (UTI_JSON=<path>). They replay a branch choice the way the live mutation does
// (answerPendingDecision → resolveIncrementally seeded at the DecisionPoint), not
// by pre-loading the answer into a fresh traversal — the two can disagree.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluateGate, GateEvaluationDeps } from '../../../../apps/pathway-service/src/services/resolution/gate-evaluator';
import { makeEvaluationTemporalContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/evaluation-context';
import { assembleContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../../../../apps/pathway-service/src/services/resolution/temporal/anchored-window';
import { normalizePatientAttributes } from '../../../../apps/pathway-service/src/services/resolution/patient-attributes';
import { TraversalEngine } from '../../../../apps/pathway-service/src/services/resolution/traversal-engine';
import { validateForGeneration } from '../../../../apps/pathway-service/src/services/resolution/care-plan-generator';
import { GateType, DefaultBehavior, ScoringType } from '../../../../apps/pathway-service/src/types';
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
  /** RxNorm medication orders, `[code, 'YYYY-MM-DD' start]`. */
  meds: Array<[string, string]> = [],
): PatientContext {
  return {
    patientId: 'proof',
    conditionCodes: ['O99.012', ...extraCodes].map((code) => ({ code, system: 'ICD-10' })),
    medications: meds.map(([code, startDate]) => ({ code, system: 'RXNORM', date: startDate })),
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
  | { gate: string; answer: GateAnswer };     // answerGateQuestion (a question gate)

/**
 * Traverse; then give each answer the way the live app does — one at a time,
 * and only once it is actually being asked:
 * - a DecisionPoint choice (answerPendingDecision) re-resolves incrementally
 *   seeded at the DecisionPoint;
 * - a question-gate answer (answerGateQuestion) re-resolves seeded at the gate
 *   (resolvers/mutations/resolution.ts); its subtree is the engine's region.
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
  const r = await engine.traverse(graph, opts.patient, answers);
  let pending = r.pendingQuestions;
  let redFlags = r.redFlags;
  const idOf = (step: Replay) => ('dp' in step ? step.dp : step.gate);
  const asked = (id: string) =>
    pending.some((q: any) => q.gateId === id || (q.askedByNodeIds ?? []).includes(id));
  const give = async (step: Replay) => {
    const nodeId = idOf(step);
    answers.set(nodeId, 'dp' in step ? ({ selectedOption: step.option } as GateAnswer) : step.answer);
    const rr = await engine.resolveIncrementally(
      new Set([nodeId]), r.resolutionState, r.dependencyMap!, graph, opts.patient, answers,
      { pendingQuestions: pending, redFlags, alsoDropGateIds: [nodeId] } as never,
    );
    pending = rr.pendingQuestions;
    redFlags = rr.redFlags;
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
  return { state: r.resolutionState, pending, redFlags };
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
    expect('gate-hgb-response (not yet due)', String(r.state.get('gate-hgb-response')?.notYetDue === true), 'true');
    expect('gate-hgb-nonresponse (not yet due)', String(r.state.get('gate-hgb-nonresponse')?.notYetDue === true), 'true');
    expect('no response question', String(r.pending.some((p: any) =>
      ['gate-hgb-response', 'gate-hgb-nonresponse'].includes(p.gateId)
      || (p.askedByNodeIds ?? []).some((id: string) => id.startsWith('gate-hgb-')))), 'false');
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');

    console.log('  ferritin never drawn — empiric needs none:');
    r = await resolveSession({ ...base, patient: patientWith(labs(null, 9.5), { gestational_age_weeks: 20 }), replay: [EMPIRIC_CHOICE, ORAL] });
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');
    expect('step-2-3 response assessment', status(r.state, 'step-2-3'), 'INCLUDED');
    expect('gate-hgb-response (not yet due)', String(r.state.get('gate-hgb-response')?.notYetDue === true), 'true');
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
async function proveResponse(): Promise<void> {
  console.log(`\n=== response: oral-iron response check on chart data (${ANEMIA}) ===`);
  const RESPONSE_GATES = ['gate-hgb-response', 'gate-hgb-nonresponse'];
  const RESPONSE_GATES_SORTED = [...RESPONSE_GATES].sort();
  const ESCALATION = ['step-2-6', 'dp-2', 'step-1-5', 'lab-8', 'lab-14', 'step-2-5', 'med-4', 'med-5', 'med-6', 'med-7'];
  const IV = ['step-2-5', 'med-4', 'med-5', 'med-6', 'med-7', 'sched-3'];
  const REGION = [...RESPONSE_GATES, 'step-2-4', ...ESCALATION, 'gate-iv-iron-ga'];
  /** Care-plan blockers that point into the response region (Stage 3 questions etc. excluded). */
  const regionBlockers = (r: { state: any; redFlags: any[] }) => String(
    validateForGeneration(r.state, r.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => REGION.includes(id))).length,
  );
  const regionQuestions = (pending: any[]) => pending.filter((p) =>
    RESPONSE_GATES.includes(p.gateId) || (p.askedByNodeIds ?? []).some((id: string) => RESPONSE_GATES.includes(id)));
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
        meds?: Array<[string, string]>;
      }) => resolveSession({
        file: ANEMIA, reverse, replay: choice, asOf: o.asOf, oralIronStart: o.start,
        patient: patientWith([...base, ...o.hgb.map(([v, date]) => ['718-7', v, date] as Lab)], o.attrs ?? {}, [], o.meds ?? []),
      });
      const notYetDue = (r: { state: any }) => {
        for (const g of RESPONSE_GATES) {
          const n = r.state.get(g);
          expect(`${g}`, status(r.state, g), 'GATED_OUT');
          expect(`${g} not yet due`, String(n?.notYetDue === true), 'true');
          expect(`${g} reason`, String(n?.excludeReason ?? '').slice(0, 36), 'NOT_YET_DUE: due on/after 2026-06-15');
        }
      };

      console.log('    start visit (oral iron recommended this session), Hgb 9.5, GA 20 — NOT YET DUE, nothing asked:');
      let r = await visit({ asOf: DAY0, hgb: [[9.5, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('step-2-3 response assessment (recheck carries the plan)', status(r.state, 'step-2-3'), 'INCLUDED');
      expect('lab-10 Hgb recheck', status(r.state, 'lab-10'), 'INCLUDED');
      expect('med-1 ferrous sulfate', status(r.state, 'med-1'), 'INCLUDED');
      notYetDue(r);
      expect('anchor source', String(r.state.get('gate-hgb-response')?.windowAnchors?.[0]?.source), 'SESSION_RECOMMENDATION');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'GATED_OUT');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    start visit, Hgb 10.7, trimester unknown — still NOT YET DUE, trimester not asked:');
      r = await visit({ asOf: DAY0, hgb: [[10.7, BASELINE_DATE]] });
      notYetDue(r);
      expect('trimester question', String(r.pending.some((p: any) => p.datumKey === 'patient.trimester')), 'false');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    start visit, Hgb 11.2 (already at target) — maintenance opens at once (accepted):');
      r = await visit({ asOf: DAY0, hgb: [[11.2, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('gate-hgb-nonresponse (definite no, not "not yet due")', status(r.state, 'gate-hgb-nonresponse'), 'GATED_OUT');
      expect('gate-hgb-nonresponse notYetDue', String(r.state.get('gate-hgb-nonresponse')?.notYetDue === true), 'false');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');

      console.log('    day 5 recheck, +0.3 (anchored on the start visit\'s care plan) — NOT YET DUE:');
      r = await visit({ asOf: DAY5, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.8, '2026-06-05']], attrs: { gestational_age_weeks: 20 } });
      notYetDue(r);
      expect('anchor source', String(r.state.get('gate-hgb-nonresponse')?.windowAnchors?.[0]?.source), 'CARE_PLAN');
      expect('step-2-6 nonresponse (a day-5 +0.3 does not escalate)', status(r.state, 'step-2-6'), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      console.log('    day 21, 9.5 → 10.7 (+1.2) — responder: maintenance, nothing escalates:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [10.7, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('gate-hgb-nonresponse', status(r.state, 'gate-hgb-nonresponse'), 'GATED_OUT');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    day 21, 9.5 → 9.9 (+0.4, below target), GA 20 — nonresponder: expanded workup + IV iron:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
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
      console.log('    day 21, +0.4, NO stored care plan, dated ferrous sulfate order 2026-06-01 — anchored on the order:');
      r = await visit({ asOf: DAY21, meds: [['310325', IRON_START]], hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('anchor source', String(r.state.get('gate-hgb-nonresponse')?.windowAnchors?.[0]?.source), 'MEDICATION_ORDER');
      expect('step-2-6 nonresponse', status(r.state, 'step-2-6'), 'INCLUDED');
      console.log('    day 21, +0.4, no care plan, no order, no clinician date — reads as a start visit (NOT YET DUE):');
      r = await visit({ asOf: DAY21, hgb: [[9.5, BASELINE_DATE], [9.9, RECHECK_DATE]], attrs: { gestational_age_weeks: 20 } });
      expect('anchor source', String(r.state.get('gate-hgb-nonresponse')?.windowAnchors?.[0]?.source), 'SESSION_RECOMMENDATION');
      for (const g of RESPONSE_GATES) expect(`${g} not yet due`, String(r.state.get(g)?.notYetDue === true), 'true');
      expect('step-2-6 nonresponse', status(r.state, 'step-2-6'), 'GATED_OUT');
      expect('response questions', String(regionQuestions(r.pending).length), '0');

      console.log('    day 21, one in-window Hgb (day 15), no later recheck — ONE question: the newest Hgb; both branches held:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.6, '2026-06-16']], attrs: { gestational_age_weeks: 20 } });
      let hq = r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7') as any[];
      expect('Hgb questions', String(hq.length), '1');
      expect('asks for the newest result', String(/newest result, drawn after 2026-06-16/.test(hq[0]?.prompt ?? '')), 'true');
      expect('asked by both response gates', JSON.stringify([...(hq[0]?.askedByNodeIds ?? [])].sort()), JSON.stringify(RESPONSE_GATES_SORTED));
      for (const g of RESPONSE_GATES) expect(g, status(r.state, g), 'PENDING_QUESTION');
      for (const id of ['step-2-4', 'step-2-6', 'step-2-5']) expect(id, status(r.state, id), 'PENDING_QUESTION');

      // The pre-treatment baseline is 24 days old, so gate-severe-anemia (Hgb,
      // 7-day horizon) asks for a current Hgb on the FIRST pass. The response
      // gates are reached only after the DP-1 answer (an incremental pass), and
      // reconcilePendingQuestions keeps the existing out-of-scope prompt for the
      // shared datum and drops the new claim (findings-reconciliation.ts: the
      // derived copy is skipped once the key is emitted). ONE Hgb question
      // still stands and both response gates are held on it; only its wording
      // ("most recent value?") and askedByNodeIds come from gate-severe-anemia.
      // Engine gap, reported — not a pathway defect.
      console.log('    day 21, baseline only (24 days old, not rechecked) — one Hgb question (raised by gate-severe-anemia); both branches held:');
      r = await visit({ asOf: DAY21, start: IRON_START, hgb: [[9.5, BASELINE_DATE]], attrs: { gestational_age_weeks: 20 } });
      hq = r.pending.filter((p: any) => p.datumKey === 'LOINC:718-7') as any[];
      expect('Hgb questions', String(hq.length), '1');
      expect('ENGINE GAP — asked by (response gates\' claim dropped on reconcile)', JSON.stringify(hq[0]?.askedByNodeIds ?? []), '["gate-severe-anemia"]');
      for (const g of RESPONSE_GATES) expect(g, status(r.state, g), 'PENDING_QUESTION');
      expect('gate-hgb-nonresponse reason', String(/Need ≥2 dated values for 718-7; found 1/.test(r.state.get('gate-hgb-nonresponse')?.excludeReason ?? '')), 'true');
      for (const id of ['step-2-4', 'step-2-6', 'step-2-5']) expect(id, status(r.state, id), 'PENDING_QUESTION');
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
      EMPIRIC_CHOICE, EMPIRIC],
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
      for (const g of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
        expect(`${g} not yet due (start visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
      }
      expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), ORAL_TRIAL);
      expect(`${IV_FIRST} (unchosen)`, status(r.state, IV_FIRST), 'EXCLUDED');
      expectAll('(IV without a trial)', r.state, ['gate-iv-iron-ga-direct', ...IV_DIRECT], 'EXCLUDED');
      expectAll('(oral bridge, under the unchosen branch)', r.state, ['gate-oral-bridge-ga', BRIDGE], 'EXCLUDED');

      for (const [ga, label] of [[20, 'intolerance or malabsorption (3b/3c), GA 20'], [36, 'anemia diagnosed at ≥ 34 weeks (3d), GA 36']] as const) {
        console.log(`    IV iron first chosen — ${label}: IV iron, no oral trial, no response check:`);
        r = await resolveSession({ ...base, patient: patient(ga), replay: [dp1, IV_FIRST_CHOICE] });
        expect(`${IV_FIRST}`, status(r.state, IV_FIRST), 'INCLUDED');
        expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'INCLUDED');
        expectAll('(IV without a trial)', r.state, IV_DIRECT, 'INCLUDED');
        expect('med-14 sits under', String(r.state.get('med-14')?.parentNodeId), 'step-2-10');
        expect(`${ORAL_TRIAL} (unchosen)`, status(r.state, ORAL_TRIAL), 'EXCLUDED');
        // v8: the oral steps also sit under Step 2.9's bridge, so DP-3 spares them
        // and the bridge's GA gate decides them: closed at GA ≥ 14.
        expect('gate-oral-bridge-ga (GA ≥ 14)', status(r.state, 'gate-oral-bridge-ga'), 'GATED_OUT');
        expectAll('(oral steps, bridge closed)', r.state, [BRIDGE, ...ORAL_STEPS], 'GATED_OUT');
        expectAll('(post-nonresponse IV route)', r.state, NONRESPONSE_IV, 'GATED_OUT');
        expect('questions from the response check', String(r.pending.some((p: any) =>
          ['gate-hgb-response', 'gate-hgb-nonresponse'].includes(p.gateId)
          || (p.askedByNodeIds ?? []).some((id: string) => id.startsWith('gate-hgb-')))), 'false');
      }

      console.log('    IV iron first chosen, GA 12 — IV iron gated out; oral trial until 14 weeks (v8):');
      r = await resolveSession({ ...base, patient: patient(12), replay: [dp1, IV_FIRST_CHOICE] });
      expect(`${IV_FIRST}`, status(r.state, IV_FIRST), 'INCLUDED');
      expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'GATED_OUT');
      expectAll('(IV without a trial)', r.state, IV_DIRECT, 'GATED_OUT');
      expect('gate-oral-bridge-ga', status(r.state, 'gate-oral-bridge-ga'), 'INCLUDED');
      expectAll('(oral trial via the bridge)', r.state,
        [BRIDGE, ...ORAL_STEPS.filter((id) => !id.startsWith('gate-hgb'))], 'INCLUDED');
      expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), BRIDGE);
      expect(`${ORAL_TRIAL} (unchosen DP-3 branch)`, status(r.state, ORAL_TRIAL), 'EXCLUDED');
      for (const g of ['gate-hgb-response', 'gate-hgb-nonresponse']) {
        expect(`${g} not yet due (start visit)`, String(r.state.get(g)?.notYetDue === true), 'true');
      }
      expect('GA questions', String(r.pending.filter((p: any) => p.datumKey === 'patient.gestational_age_weeks').length), '0');

      console.log('    IV iron first chosen, GA missing — asks for GA once, holds IV iron and the oral bridge:');
      r = await resolveSession({ ...base, patient: patient(null), replay: [dp1, IV_FIRST_CHOICE] });
      expect('gate-iv-iron-ga-direct', status(r.state, 'gate-iv-iron-ga-direct'), 'PENDING_QUESTION');
      expect('gate-oral-bridge-ga', status(r.state, 'gate-oral-bridge-ga'), 'PENDING_QUESTION');
      expectAll('(held)', r.state, ['step-2-10', BRIDGE, 'step-2-1', 'med-1'], 'PENDING_QUESTION');
      const gaQs = r.pending.filter((p: any) => p.datumKey === 'patient.gestational_age_weeks') as any[];
      expect('GA questions', String(gaQs.length), '1');
      expect('asked by both GA gates', JSON.stringify([...(gaQs[0]?.askedByNodeIds ?? [])].sort()),
        JSON.stringify(['gate-iv-iron-ga-direct', 'gate-oral-bridge-ga']));
      // The boundary: exactly one of the two GA gates opens on either side of 14 0/7.
      for (const [ga, iv, oral] of [[13.9, 'GATED_OUT', 'INCLUDED'], [14, 'INCLUDED', 'GATED_OUT']] as const) {
        console.log(`    IV iron first chosen, GA ${ga} — exactly one of IV iron / the oral bridge:`);
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

    console.log('  D57.1 sickle-cell disease, MCV 72 — no DP-1, so no DP-3:');
    const d = await resolveSession({ ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]],
      { gestational_age_weeks: 20 }, ['D57.1']) });
    expect('dp-3', status(d.state, 'dp-3'), 'GATED_OUT');
    expect('no dp-3 question', dp3Asked(d.pending), 'false');
  }
}

// ── Proof: hemoglobinopathy disease keeps microcytic patients off empiric iron (v7) ──
// [DECISION — Josh 2026-09-24] gate-microcytic (DP-1's only way in, via Step
// 1.7) is AND(MCV < 80, not_includes_code × 12 disease codes: D57.0.*, D57.1,
// D57.2.*, D57.4.*, D57.8.*, D56.0/.1/.2/.5/.8/.9, D58.2 — LIFETIME, status
// any). Traits (D57.3, D56.3) are NOT listed: carriers keep DP-1 (and
// gate-trait). gate-hgbpathy-microcytic = AND(MCV < 80, OR(includes_code × the
// same 12)) → Step 1.8, the disease patients' own confirmatory iron studies
// (lab-15 ferritin, lab-16 iron/TIBC/sat — one node per host). Step 1.8 has no
// route into DP-1's region: a closing gate sweeps its whole closure and spares
// nothing, so a second route into Step 1.2 / Stage 2 loses the race (tried:
// Step 1.2 and Stage 2 GATED_OUT in both edge orders, for coded AND uncoded
// patients). Consequence, recorded: a ferritin-confirmed disease patient gets
// the workup plus her route-out step, not the Stage 2 iron arm.
async function proveHgbpathy(): Promise<void> {
  console.log(`\n=== hgbpathy: hemoglobinopathy disease + MCV 72 vs DP-1 (${ANEMIA}) ===`);
  const labs = (mcv: number | null): Lab[] => [...(mcv === null ? [] : [['787-2', mcv] as Lab]), ['718-7', 9.5]];
  const options = (pending: unknown[]) =>
    JSON.stringify([...((pending.find((p: any) => p.gateId === 'dp-1') as any)?.options ?? [])].sort());
  const HG_WORKUP = ['step-1-8', 'lab-15', 'lab-16'];
  const EMPIRIC_ARM = [EMPIRIC, 'step-2-1', 'med-1', 'step-2-3'];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };
    const offered = async (codes: string[], label: string, stage3?: [string, string]) => {
      console.log(`  ${label}, MCV 72 — DP-1 offered with both branches:`);
      const r = await resolveSession({ ...base, patient: patientWith(labs(72), {}, codes) });
      expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'INCLUDED');
      expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
      expect('dp-1 options', options(r.pending), JSON.stringify(DP1_OPTIONS));
      expect('gate-hgbpathy-microcytic', status(r.state, 'gate-hgbpathy-microcytic'), 'GATED_OUT');
      expectAll('(Step 1.8, not this patient)', r.state, HG_WORKUP, 'GATED_OUT');
      if (stage3) expect(`${stage3[0]} fires`, status(r.state, stage3[0]), 'INCLUDED');
      if (stage3) expect(stage3[1], status(r.state, stage3[1]), 'INCLUDED');
    };
    await offered([], 'no hemoglobinopathy code');
    await offered(['D57.3'], 'D57.3 sickle-cell trait', ['gate-trait', 'step-3-3']);
    await offered(['D56.3'], 'D56.3 thalassemia minor', ['gate-trait', 'step-3-3']);

    for (const [code, label, gate, step] of [
      ['D57.1', 'sickle-cell disease without crisis', 'gate-scd', 'step-3-1'],
      ['D57.00', 'Hb-SS with crisis (D57.0.*)', 'gate-scd', 'step-3-1'],
      ['D57.40', 'sickle-cell thalassemia (D57.4.*)', 'gate-scd', 'step-3-1'],
      ['D56.1', 'beta thalassemia', 'gate-thal-major', 'step-3-2'],
      ['D58.2', 'other hemoglobinopathy (HbC / HbE disease)', null, null],
    ] as const) {
      console.log(`  ${code} ${label}, MCV 72 — no empiric option, confirmatory iron studies (Step 1.8):`);
      let r = await resolveSession({ ...base, patient: patientWith(labs(72), {}, [code]) });
      expect('gate-microcytic', status(r.state, 'gate-microcytic'), 'GATED_OUT');
      expect('dp-1', status(r.state, 'dp-1'), 'GATED_OUT');
      expect('no dp-1 question', String(r.pending.some((p: any) => p.gateId === 'dp-1')), 'false');
      expectAll('(empiric arm)', r.state, EMPIRIC_ARM, 'GATED_OUT');
      expect('gate-hgbpathy-microcytic', status(r.state, 'gate-hgbpathy-microcytic'), 'INCLUDED');
      expectAll('(Step 1.8 workup)', r.state, HG_WORKUP, 'INCLUDED');
      expect('lab-15 sits under', String(r.state.get('lab-15')?.parentNodeId), 'step-1-8');
      // Recorded consequence: DP-1's region (Step 1.2, Stage 2) is closed for her.
      expect('CONSEQUENCE — stage-2 iron arm', status(r.state, 'stage-2'), 'GATED_OUT');
      if (gate && step) {
        expect(`${gate} fires`, status(r.state, gate), 'INCLUDED');
        expect(`${step} route-out`, status(r.state, step), 'INCLUDED');
      }
      if (code === 'D57.1') {
        console.log(`  ${code}, MCV 90 — neither microcytic gate opens; normocytic workup:`);
        r = await resolveSession({ ...base, patient: patientWith(labs(90), {}, [code]) });
        expect('gate-hgbpathy-microcytic', status(r.state, 'gate-hgbpathy-microcytic'), 'GATED_OUT');
        expect('dp-1', status(r.state, 'dp-1'), 'GATED_OUT');
        expectAll('(Step 1.8)', r.state, HG_WORKUP, 'GATED_OUT');
        expect('step-1-3 normocytic workup', status(r.state, 'step-1-3'), 'INCLUDED');

        console.log(`  ${code}, MCV missing — one MCV question; the code settles gate-microcytic (not an asker):`);
        r = await resolveSession({ ...base, patient: patientWith(labs(null), {}, [code]) });
        const q = r.pending.filter((p: any) => p.datumKey === 'LOINC:787-2') as any[];
        expect('one MCV question', String(q.length), '1');
        expect('asked by', JSON.stringify([...(q[0]?.askedByNodeIds ?? [])].sort()),
          JSON.stringify(['gate-hgbpathy-microcytic', 'gate-macrocytic', 'gate-normocytic']));
        expect('gate-microcytic (settled by the code)', status(r.state, 'gate-microcytic'), 'GATED_OUT');
        expect('step-1-8', status(r.state, 'step-1-8'), 'PENDING_QUESTION');
      }
    }
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
async function proveGhtnSeizure(): Promise<void> {
  console.log(`\n=== ghtn-seizure: Guid-5 "Seizure: call 911" follows Step 4.4 (${GHTN}) ===`);
  const pw = JSON.parse(readFileSync(resolve(GHTN), 'utf8'));
  const g5 = pw.nodes.find((n: any) => n.id === 'guid-5');
  const g1 = pw.nodes.find((n: any) => n.id === 'guid-1');
  expect('guid-5 topic', String(g5?.properties?.topic), 'Seizure: call 911');
  expect('guid-5 is its own node (guid-1 text has no seizure line)', String(/seizure/i.test(g1?.properties?.instructions ?? '')), 'false');
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
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const run = (codes: string[], vitals: Record<string, number>, ask: Replay[]) =>
      resolveSession({ file: GHTN, reverse, patient: patientOf({ codes, labs: LABS, vitals }), ask });

    console.log('  gestational HTN (O13.3), no severe features — outpatient: seizure line with the warning signs:');
    let r = await run(['O13.3'], HIGH_BP, diagnosed(false));
    expect('step-4-4 safety-netting', status(r.state, 'step-4-4'), 'INCLUDED');
    expectAll('(Step 4.4 guidance)', r.state, ['guid-1', 'guid-5'], 'INCLUDED');
    expect('guid-5 sits under', String(r.state.get('guid-5')?.parentNodeId), 'step-4-4');

    console.log('  preeclampsia (O14.03), no severe features — same:');
    r = await run(['O14.03'], HIGH_BP, diagnosed(false));
    expectAll('(Step 4.4 guidance)', r.state, ['guid-1', 'guid-5'], 'INCLUDED');

    console.log('  gestational HTN, severe feature on assessment — Stage 4 closed, escalated (flagged):');
    r = await run(['O13.3'], HIGH_BP, diagnosed(true));
    expect('stage-4', status(r.state, 'stage-4'), 'GATED_OUT');
    expectAll('(Step 4.4 guidance)', r.state, ['guid-1', 'guid-5'], 'GATED_OUT');

    console.log('  BP 120/75, aspirin indicated — no hypertensive disorder: no seizure line:');
    r = await run([], { systolic_bp: 120, diastolic_bp: 75 }, [q('gate-aspirin-indicated', YES)]);
    expect('guid-5', status(r.state, 'guid-5'), 'GATED_OUT');
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
  'hgbpathy': proveHgbpathy,
  'ghtn-shared-labs': proveGhtnSharedLabs,
  'ghtn-seizure': proveGhtnSeizure,
  'uti-shared-labs': proveUtiSharedLabs,
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
