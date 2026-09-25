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
//   dp-1-scoring     DP-1's two branches, scored signal by signal with the seeded
//                    SYSTEM signals — can confidence alone pick one?
//   ga               anemia gate-iv-iron-ga on patient.gestational_age_weeks: present
//                    values decide, a missing one pends and asks for the datum
//   shared-leaves    anemia labs split per host step: a gate closing one step no
//                    longer takes a lab another (open) step also orders
//   mcv              anemia gate-microcytic: DP-1 is offered only for MCV < 80;
//                    normocytic / macrocytic skip it, a missing MCV asks
//   empiric          anemia DP-1 empiric arm (Stage 1.5): reaches the same response
//                    check as confirmed IDA; no ferritin needed
//   response         anemia gate-hgb-response SELECT router (v5): escalation
//                    (expanded workup, IV iron at GA ≥ 14) only after "not
//                    responding"; "responding" → maintenance; "recheck not yet
//                    done" lets the start visit finish with nothing escalated;
//                    both arms, re-answer at the recheck
//   hgbpathy         BLOCKED (needs not_includes_code): hemoglobinopathy code +
//                    MCV 72 is still offered empiric iron at DP-1 — records today's
//                    exposure; flips when the engine can negate a code
//   ghtn-shared-labs gestational hypertension v2: BP, severity-panel and urine-protein
//                    labs split per host step — each follows its own step's gate
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
import { TraversalEngine } from '../../../../apps/pathway-service/src/services/resolution/traversal-engine';
import { containmentClosure } from '../../../../apps/pathway-service/src/services/resolution/graph-containment';
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

function patientWith(
  labs: Array<[string, number]>, attrs: Record<string, number> = {}, extraCodes: string[] = [],
): PatientContext {
  return {
    patientId: 'proof',
    conditionCodes: ['O99.012', ...extraCodes].map((code) => ({ code, system: 'ICD-10' })),
    medications: [], allergies: [], vitalSigns: {}, patientAttributes: attrs,
    labResults: labs.map(([code, value]) => ({ code, system: 'LOINC', value })),
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

/** Stub scorer: `conf(nodeId)` is the confidence the engine sees for that node. */
function engineFor(patient: PatientContext, conf: (id: string) => number): TraversalEngine {
  const tc = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
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
 * Traverse; then replay each answer the way the live mutation does:
 * - a DecisionPoint choice (answerPendingDecision) re-resolves incrementally
 *   seeded at the DecisionPoint;
 * - a question-gate answer (answerGateQuestion) re-resolves seeded at the gate
 *   AND its containment subtree (resolvers/mutations/resolution.ts).
 * `choose` is shorthand for a single leading DecisionPoint choice.
 */
async function resolveSession(opts: {
  file: string; reverse: boolean; patient: PatientContext;
  conf?: (id: string) => number; choose?: { dp: string; option: string };
  answers?: Record<string, GateAnswer>; replay?: Replay[];
}) {
  const graph = graphFrom(opts.file, opts.reverse);
  const engine = engineFor(opts.patient, opts.conf ?? (() => 0.9));
  const answers = new Map<string, GateAnswer>(Object.entries(opts.answers ?? {}));
  const r = await engine.traverse(graph, opts.patient, answers);
  let pending = r.pendingQuestions;
  let redFlags = r.redFlags;
  const steps: Replay[] = [...(opts.choose ? [opts.choose] : []), ...(opts.replay ?? [])];
  for (const step of steps) {
    let nodeId: string; let seed: Set<string>;
    if ('dp' in step) {
      nodeId = step.dp;
      answers.set(nodeId, { selectedOption: step.option } as GateAnswer);
      seed = new Set([nodeId]);
    } else {
      nodeId = step.gate;
      answers.set(nodeId, step.answer);
      seed = containmentClosure(graph, [nodeId]);
    }
    const rr = await engine.resolveIncrementally(
      seed, r.resolutionState, r.dependencyMap!, graph, opts.patient, answers,
      { pendingQuestions: pending, redFlags, alsoDropGateIds: [nodeId] } as never,
    );
    pending = rr.pendingQuestions;
    redFlags = rr.redFlags;
  }
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

    console.log('  ferritin 12, provider chooses the workup:');
    r = await resolveSession({
      ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]]),
      choose: { dp: 'dp-1', option: 'step-1-2' },
    });
    expect(`${EMPIRIC} (unchosen branch)`, status(r.state, EMPIRIC), 'EXCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'INCLUDED');
    for (const id of ['step-2-1', 'step-2-2', 'step-2-3']) expect(id, status(r.state, id), 'INCLUDED');
    expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), 'stage-2');

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
    expect('step-2-1 oral iron (automatic again)', status(r.state, 'step-2-1'), 'INCLUDED');
  }
}

// ── Proof: the empiric arm gets the confirmed arm's follow-up ─────────
// [DECISION — Josh 2026-09-24] Through v3, choosing empiric oral iron at DP-1
// reached Step 2.1 only: Steps 2.2/2.3, DP-2 and IV iron hung from Stage 2,
// which only gate-ida-confirmed opens. DP-1's empiric branch is now Stage 1.5
// (`stage-2-empiric`), which HAS_STEPs the SAME Steps 2.1–2.3 — so the same
// Hgb recheck, gate-hgb-response and DP-2 → gate-iv-iron-ga → IV iron apply.
// Shared, not copied: DP-1 is one_of, so only one of the two parent stages is
// ever open, and the engine spares a chosen branch's contents from the sweep
// that excludes the other (containmentClosure) — checked here in both orders.
async function proveEmpiric(): Promise<void> {
  console.log(`\n=== empiric: DP-1 empiric arm → the same response check (${ANEMIA}) ===`);
  const choose = { dp: 'dp-1', option: EMPIRIC };
  const labs = (ferritin: number | null, hgb: number | null): Array<[string, number]> => [
    ['787-2', 72],
    ...(ferritin === null ? [] : [['2276-4', ferritin] as [string, number]]),
    ...(hgb === null ? [] : [['718-7', hgb] as [string, number]]),
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse, choose };

    // v5: the empiric arm reaches Step 2.3 and its response question; what the
    // answer does (maintenance vs escalation) is proved per arm in `response`.
    console.log('  ferritin 50, Hgb 9.5, GA 20 — empiric chosen:');
    let r = await resolveSession({ ...base, patient: patientWith(labs(50, 9.5), { gestational_age_weeks: 20 }) });
    expect(EMPIRIC, status(r.state, EMPIRIC), 'INCLUDED');
    expect('step-1-2 workup (unchosen)', status(r.state, 'step-1-2'), 'EXCLUDED');
    expect('gate-ida-confirmed (not evaluated)', status(r.state, 'gate-ida-confirmed'), 'EXCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'EXCLUDED');
    for (const id of ['step-2-1', 'med-1', 'step-2-2', 'step-2-3', 'lab-10', 'sched-2', 'qm-1']) {
      expect(id, status(r.state, id), 'INCLUDED');
    }
    expect('step-2-3 sits under', String(r.state.get('step-2-3')?.parentNodeId), EMPIRIC);
    expect('gate-hgb-response (response question)', status(r.state, 'gate-hgb-response'), 'PENDING_QUESTION');
    expect('asks the response question', String(r.pending.some((p: any) => p.gateId === 'gate-hgb-response')), 'true');
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');

    console.log('  ferritin never drawn — empiric needs none:');
    r = await resolveSession({ ...base, patient: patientWith(labs(null, 9.5), { gestational_age_weeks: 20 }) });
    expect('no ferritin question', String(r.pending.some((p: any) => p.datumKey === 'LOINC:2276-4')), 'false');
    expect('step-2-3 response assessment', status(r.state, 'step-2-3'), 'INCLUDED');
    expect('gate-hgb-response (response question)', status(r.state, 'gate-hgb-response'), 'PENDING_QUESTION');
  }
}

// ── Proof: escalation waits for non-response (v5) ─────────────────────
// [DECISION — Josh 2026-09-24] gate-hgb-response is a SELECT question router on
// Step 2.3 — the 2–4-week Hgb recheck: "responding" (risen ≥1 g/dL) → Step 2.4
// (maintenance); "not responding" (< 1 g/dL) → Step 2.6 (Nonresponse
// management), the sole host of DP-2 → Step 1.5 (expanded workup) and
// gate-iv-iron-ga → Step 2.5 (IV iron, GA ≥ 14); "recheck not yet done" →
// Step 2.7 (Awaiting response recheck, childless), so the oral-iron START
// visit can finish (care-plan generation blocks on any PENDING_QUESTION) with
// nothing escalated. Through v4, DP-2 hung from Step 2.3, so expanded workup
// and IV iron were INCLUDED the moment oral iron started. Run on BOTH arms (the
// steps are shared by Stage 1.5 and Stage 2): empiric, and workup + ferritin
// 12. [INTERIM — switch to window_from]
const RESPONDING = 'responding';
const NOT_RESPONDING = 'not responding';
const RECHECK_PENDING = 'recheck not yet done';
async function proveResponse(): Promise<void> {
  console.log(`\n=== response: escalation only after non-response (${ANEMIA}) ===`);
  const ESCALATION = ['step-2-6', 'dp-2', 'step-1-5', 'lab-8', 'lab-14', 'step-2-5', 'med-4', 'med-5', 'med-6', 'med-7'];
  const IV = ['step-2-5', 'med-4', 'med-5', 'med-6', 'med-7', 'sched-3'];
  const REGION = ['gate-hgb-response', 'step-2-4', 'step-2-7', ...ESCALATION, 'gate-iv-iron-ga'];
  const answer = (o: string): Replay => ({ gate: 'gate-hgb-response', answer: { selectedOption: o } as GateAnswer });
  /** Care-plan blockers that point into the response region (Stage 3 questions etc. excluded). */
  const regionBlockers = (r: { state: any; redFlags: any[] }) => String(
    validateForGeneration(r.state, r.redFlags)
      .filter((b) => b.relatedNodeIds.some((id) => REGION.includes(id))).length,
  );
  const arms: Array<[string, Array<[string, number]>, Replay]> = [
    ['empiric arm (ferritin never drawn)', [['787-2', 72], ['718-7', 9.5]], { dp: 'dp-1', option: EMPIRIC }],
    ['confirmed arm (workup, ferritin 12)', [['787-2', 72], ['2276-4', 12], ['718-7', 9.5]], { dp: 'dp-1', option: 'step-1-2' }],
  ];
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    for (const [arm, labs, choice] of arms) {
      console.log(`  ${arm}:`);
      const run = (ga: number | null, replay: Replay[]) => resolveSession({
        file: ANEMIA, reverse, replay: [choice, ...replay],
        patient: patientWith(labs, ga === null ? {} : { gestational_age_weeks: ga }),
      });

      console.log('    question not answered — asks, holds maintenance and every escalation step:');
      let r = await run(20, []);
      expect('step-2-3 response assessment', status(r.state, 'step-2-3'), 'INCLUDED');
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'PENDING_QUESTION');
      const q = r.pending.find((p: any) => p.gateId === 'gate-hgb-response') as any;
      expect('asks the response question (SELECT)', String(q?.answerType), 'SELECT');
      expect('options', JSON.stringify(q?.options), JSON.stringify([RESPONDING, NOT_RESPONDING, RECHECK_PENDING]));
      for (const id of ['step-2-4', 'step-2-7', ...ESCALATION]) expect(id, status(r.state, id), 'PENDING_QUESTION');

      console.log('    "recheck not yet done" (oral iron just started) — visit can finish, nothing escalates:');
      r = await run(20, [answer(RECHECK_PENDING)]);
      expect('step-2-7 awaiting recheck', status(r.state, 'step-2-7'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'EXCLUDED');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'EXCLUDED');
      expect('response question settled', String(r.pending.some((p: any) => p.gateId === 'gate-hgb-response')), 'false');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    responder — maintenance, no IV iron, no expanded workup:');
      r = await run(20, [answer(RESPONDING)]);
      expect('gate-hgb-response', status(r.state, 'gate-hgb-response'), 'INCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      expect('step-2-7 awaiting recheck', status(r.state, 'step-2-7'), 'EXCLUDED');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'EXCLUDED');
      expect('response question settled', String(r.pending.some((p: any) => p.gateId === 'gate-hgb-response')), 'false');
      expect('care-plan blockers in the response region', regionBlockers(r), '0');

      console.log('    non-responder, GA 20 — expanded workup + IV iron:');
      r = await run(20, [answer(NOT_RESPONDING)]);
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'EXCLUDED');
      expect('step-2-7 awaiting recheck', status(r.state, 'step-2-7'), 'EXCLUDED');
      for (const id of ['step-2-6', 'dp-2', 'step-1-5', 'lab-8', 'lab-14', 'gate-iv-iron-ga', ...IV]) {
        expect(id, status(r.state, id), 'INCLUDED');
      }

      console.log('    "not yet" at the start visit, then "not responding" at the recheck (re-answer):');
      r = await run(20, [answer(RECHECK_PENDING), answer(NOT_RESPONDING)]);
      expect('step-2-7 awaiting recheck', status(r.state, 'step-2-7'), 'EXCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'EXCLUDED');
      for (const id of ['step-2-6', 'dp-2', 'step-1-5', ...IV]) expect(id, status(r.state, id), 'INCLUDED');

      console.log('    "not yet", then "responding" at the recheck (re-answer):');
      r = await run(20, [answer(RECHECK_PENDING), answer(RESPONDING)]);
      expect('step-2-7 awaiting recheck', status(r.state, 'step-2-7'), 'EXCLUDED');
      expect('step-2-4 maintenance', status(r.state, 'step-2-4'), 'INCLUDED');
      for (const id of ESCALATION) expect(id, status(r.state, id), 'EXCLUDED');

      console.log('    non-responder, GA 12 — expanded workup, IV iron gated out:');
      r = await run(12, [answer(NOT_RESPONDING)]);
      for (const id of ['step-2-6', 'dp-2', 'step-1-5']) expect(id, status(r.state, id), 'INCLUDED');
      expect('gate-iv-iron-ga', status(r.state, 'gate-iv-iron-ga'), 'GATED_OUT');
      for (const id of IV) expect(id, status(r.state, id), 'GATED_OUT');

      console.log('    non-responder, GA missing — asks for GA, holds IV iron:');
      r = await run(null, [answer(NOT_RESPONDING)]);
      expect('step-1-5 expanded workup', status(r.state, 'step-1-5'), 'INCLUDED');
      expect('gate-iv-iron-ga', status(r.state, 'gate-iv-iron-ga'), 'PENDING_QUESTION');
      expect('step-2-5 IV iron', status(r.state, 'step-2-5'), 'PENDING_QUESTION');
      const ga = r.pending.find((p: any) => p.gateId === 'gate-iv-iron-ga') as any;
      expect('asks for datum', String(ga?.datumKey), 'patient.gestational_age_weeks');
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
  const confs: number[] = [];
  const perSignal: string[] = [];
  // A Stage (the empiric branch) and a Step (the workup) — the node type must
  // not move the score, or the fork would auto-select instead of pending.
  for (const id of [EMPIRIC, 'step-1-2']) {
    const node = graph.getNode(id)!;
    let sum = 0; let wsum = 0; const parts: string[] = [];
    for (const [def, scorer] of signals) {
      const s = scorer.score({ node, signalDefinition: def, patientContext: patient, graphContext: graph });
      parts.push(`${def.name}=${s.skipped ? 'skipped' : s.score}`);
      if (!s.skipped) { sum += s.score * def.defaultWeight; wsum += def.defaultWeight; }
    }
    const conf = Math.round((sum / wsum) * 1000) / 1000;
    confs.push(conf); perSignal.push(parts.join(' '));
    console.log(`  ${id.padEnd(9)} ${parts.join('  ')}  → confidence ${conf}`);
  }
  expect('per-signal scores identical', String(perSignal[0] === perSignal[1]), 'true');
  expect('both ≥ suggest threshold 0.60 (so a one_of fork pends)', String(confs.every((c) => c >= 0.6)), 'true');
}

// ── Proof: anemia gate-iv-iron-ga reads gestational age directly ──────
// patient.gestational_age_weeks >= 14, on_unresolved ask. Since 8f64fc1 a
// MISSING patient.* value is missing data (pends with a datum request), not a
// silent "no". Reached through the workup with ferritin 12 so Stage 2 is open,
// and (since v5) a "no response" answer at Step 2.3 so DP-2, the gate's host,
// is open.
async function proveGa(): Promise<void> {
  console.log(`\n=== ga: anemia gate-iv-iron-ga — patient.gestational_age_weeks >= 14 (${ANEMIA}) ===`);
  const labs: Array<[string, number]> = [['787-2', 72], ['2276-4', 12], ['718-7', 9.5]];
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
        choose: { dp: 'dp-1', option: 'step-1-2' },
        replay: [{ gate: 'gate-hgb-response', answer: { selectedOption: NOT_RESPONDING } as GateAnswer }],
      });
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

// ── Proof: hemoglobinopathy codes vs the empiric arm — BLOCKED on the engine ──
// [DECISION — Josh 2026-09-24] Hemoglobinopathy codes (SCD, thalassemia, and
// their traits) must suppress DP-1's empiric-iron arm; those patients go to the
// confirmatory workup. NOT ENCODABLE on josh-dev: no coded operator negates a
// membership test (`includes_code` only), `not_equals` exists only on attribute
// namespaces (lab/vitals/allergy/patient — none carries diagnoses), and DP-1's
// branch qualification comes from DB-seeded confidence signals, not the JSON.
// Needs `not_includes_code` (brief §4, DP-1). This proof records TODAY's
// exposure so the gap stays visible; when the operator lands and the wiring
// follows, the "BLOCKED" expectations flip (empiric no longer offered).
async function proveHgbpathy(): Promise<void> {
  console.log(`\n=== hgbpathy: hemoglobinopathy code + MCV 72 vs DP-1 (${ANEMIA}) ===`);
  const labs: Array<[string, number]> = [['787-2', 72], ['718-7', 9.5]];
  const options = (pending: unknown[]) =>
    JSON.stringify([...((pending.find((p: any) => p.gateId === 'dp-1') as any)?.options ?? [])].sort());
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const base = { file: ANEMIA, reverse };

    console.log('  control — no hemoglobinopathy code, MCV 72: DP-1 offered with both branches:');
    let r = await resolveSession({ ...base, patient: patientWith(labs) });
    expect('dp-1', status(r.state, 'dp-1'), 'PENDING_QUESTION');
    expect('dp-1 options', options(r.pending), JSON.stringify(DP1_OPTIONS));

    for (const [code, label, gate, step] of [
      ['D56.3', 'thalassemia minor', 'gate-trait', 'step-3-3'],
      ['D57.3', 'sickle-cell trait', 'gate-trait', 'step-3-3'],
      ['D56.1', 'beta thalassemia', 'gate-thal-major', 'step-3-2'],
      ['D57.40', 'sickle-cell thalassemia', 'gate-scd', 'step-3-1'],
    ] as const) {
      console.log(`  ${code} ${label}, MCV 72:`);
      r = await resolveSession({ ...base, patient: patientWith(labs, {}, [code]) });
      expect(`${gate} fires`, status(r.state, gate), 'INCLUDED');
      expect(`${step}`, status(r.state, step), 'INCLUDED');
      expect('BLOCKED — exposure today: dp-1 still offers empiric', options(r.pending), JSON.stringify(DP1_OPTIONS));
    }

    console.log('  D57.40 sickle-cell thalassemia, MCV 72, provider picks empiric:');
    r = await resolveSession({ ...base, patient: patientWith(labs, {}, ['D57.40']), choose: { dp: 'dp-1', option: EMPIRIC } });
    expect('step-3-1 SCD route-out', status(r.state, 'step-3-1'), 'INCLUDED');
    expect(`BLOCKED — exposure today: ${EMPIRIC}`, status(r.state, EMPIRIC), 'INCLUDED');
    expect('BLOCKED — exposure today: med-1 ferrous sulfate', status(r.state, 'med-1'), 'INCLUDED');
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
// Question-gate answers are PRE-LOADED here (one traversal that knows them),
// not replayed; the DP-1 choice is replayed. For these gates the two disagree
// for a reason that is not this pathway's: answerGateQuestion seeds the answered
// gate's whole containment closure, which includes CodeEntry / EvidenceCitation
// leaves shared across the graph, and resolveIncrementally's promote() climbs
// from such a leaf to a decider that does not govern it and re-disposes it as a
// root. Answering aspirin "yes" with BP 120/75 re-opens DP-1 (and, in reversed
// order, gate-no-severe-features) as PENDING_QUESTION inside the GATED_OUT
// work-up — identically on v1 and v2. With those leaves stripped from the seed,
// replay agrees with every expectation below. Engine defect, reported separately.
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
  const diagnosed = (severe: boolean): Record<string, GateAnswer> => ({
    'gate-aspirin-indicated': NO,
    'gate-htn-confirmed': YES,
    'gate-severe-feature-symptoms': severe ? YES : NO,
    'gate-no-severe-features': severe ? NO : YES,
  });
  const QUANTITATIVE = { dp: 'dp-1', option: 'step-2-3a' };
  for (const reverse of [false, true]) {
    console.log(`  -- edge order: ${reverse ? 'reversed' : 'file'}`);
    const run = (codes: string[], vitals: Record<string, number>, answers: Record<string, GateAnswer>,
      choose?: { dp: string; option: string }) =>
      resolveSession({ file: GHTN, reverse, patient: patientOf({ codes, labs: LABS, vitals }), answers, choose });

    // gate-bp-elevated closes Step 2.2 and everything downstream of it. v1: the
    // Step 1.2 baseline panel and the Step 2.1 BP readings were also in that
    // region (via 3.1 / 4.1 / 2.3a / 4.2 and 2.2), so they could go GATED_OUT.
    console.log('  aspirin indicated, BP 120/75 — baseline labs ordered, nothing downstream:');
    let r = await run([], NORMAL_BP, { 'gate-aspirin-indicated': YES });
    expect('step-1-2 baseline labs', status(r.state, 'step-1-2'), 'INCLUDED');
    expectAll('(Step 1.2)', r.state, L.base12, 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expect('step-2-2 confirm HTN', status(r.state, 'step-2-2'), 'GATED_OUT');
    expectAll('(Step 2.2)', r.state, L.bp22, 'GATED_OUT');
    for (const k of ['urine23a', 'sev31', 'surv41', 'urine42'] as const) expectAll(`(${k})`, r.state, L[k], 'GATED_OUT');

    // gate-htn-confirmed "no" closes the work-up. v1: the Step 2.1/2.2 BP
    // readings were also Step 4.1's, inside that region.
    console.log('  aspirin not indicated, BP 150/95, hypertension NOT confirmed:');
    r = await run([], HIGH_BP, { 'gate-aspirin-indicated': NO, 'gate-htn-confirmed': NO });
    expect('step-2-2 confirm HTN', status(r.state, 'step-2-2'), 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expectAll('(Step 2.2)', r.state, L.bp22, 'INCLUDED');
    expect('stage-2-workup', status(r.state, 'stage-2-workup'), 'GATED_OUT');
    expectAll('(Step 1.2, aspirin gate is its only route)', r.state, L.base12, 'GATED_OUT');
    for (const k of ['urine23a', 'sev31', 'surv41', 'urine42'] as const) expectAll(`(${k})`, r.state, L[k], 'GATED_OUT');

    // Aspirin "no" is now the only route to the Step 1.2 panel. v1: Steps 3.1,
    // 4.1, 2.3a and 4.2 ordered the same nodes, so they leaked INCLUDED.
    console.log('  aspirin not indicated, gestational HTN (O13.3), quantitative proteinuria, no severe features:');
    r = await run(['O13.3'], HIGH_BP, diagnosed(false), QUANTITATIVE);
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
    r = await run(['O14.03'], HIGH_BP, diagnosed(false), QUANTITATIVE);
    expect('gate-gestational-htn', status(r.state, 'gate-gestational-htn'), 'GATED_OUT');
    expectAll('(Step 4.2)', r.state, L.urine42, 'GATED_OUT');
    expectAll('(Step 2.3a)', r.state, L.urine23a, 'INCLUDED');
    expectAll('(Step 4.1)', r.state, L.surv41, 'INCLUDED');

    // gate-no-severe-features closes Stage 4. v1: the Step 4.1 surveillance
    // labs were the Step 3.1 severity panel and the Step 2.1/2.2 BP readings.
    console.log('  gestational HTN (O13.3), severe feature on assessment — no outpatient surveillance:');
    r = await run(['O13.3'], HIGH_BP, diagnosed(true), QUANTITATIVE);
    expect('stage-4 outpatient surveillance', status(r.state, 'stage-4'), 'GATED_OUT');
    expectAll('(Step 4.1)', r.state, L.surv41, 'GATED_OUT');
    expectAll('(Step 4.2)', r.state, L.urine42, 'GATED_OUT');
    expectAll('(Step 3.1)', r.state, L.sev31, 'INCLUDED');
    expectAll('(Step 2.1)', r.state, L.bp21, 'INCLUDED');
    expectAll('(Step 2.2)', r.state, L.bp22, 'INCLUDED');
  }
}

// ── Proof: UTI in pregnancy labs, one node per host step (v2) ─────────
// v1 shared three LabTest nodes across hosts: the urine culture (lab-1) on
// Steps 1.1, 2.1 and the test-of-cure repeat culture (step-5-2a); organism
// identification (lab-2) on Step 2.1 and Step 4.1 (GBS arm); susceptibility
// (lab-3) on Step 3.1 and suppressive prophylaxis (step-5-3). Same defect as
// ghtn-shared-labs, same split; question-gate answers pre-loaded for the same
// engine reason (see the comment above GHTN_LABS).
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
  const REPEAT_CULTURE = { dp: 'dp-1', option: 'step-5-2a' };
  /** Culture positive, treated; the other questions as given. */
  const treated = (a: { symptomatic: boolean; gbs: boolean; completed: boolean }): Record<string, GateAnswer> => ({
    'gate-symptomatic': a.symptomatic ? YES : NO,
    'gate-gbs-identified': a.gbs ? YES : NO,
    'gate-gbs-treat-threshold': NO,
    'gate-first-trimester': NO,
    'gate-treatment-completed': a.completed ? YES : NO,
  });
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
      answers: Record<string, GateAnswer>, choose?: { dp: string; option: string }) =>
      resolveSession({ file: UTI, reverse, patient: patientOf({ codes, labs, vitals: AFEBRILE }), answers, choose });

    // Culture negative closes Stage 3 and Step 2.2 (and with it test of cure);
    // GBS "no" closes Stage 4. v1: the Step 1.1 / 2.1 culture was also
    // step-5-2a's, and the Step 2.1 organism ID was also Step 4.1's.
    console.log('  culture negative (1,000 CFU/mL), no GBS — screening and interpretation only:');
    let r = await run([], NEGATIVE, { 'gate-gbs-identified': NO });
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
    r = await run([], POSITIVE, treated({ symptomatic: true, gbs: false, completed: false }), REPEAT_CULTURE);
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
  'hgbpathy': proveHgbpathy,
  'ghtn-shared-labs': proveGhtnSharedLabs,
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
