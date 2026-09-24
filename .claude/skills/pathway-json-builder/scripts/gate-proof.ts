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
//
// The pathway proofs read pathways/json/anemia-in-pregnancy.json (override with
// ANEMIA_JSON=<path>). They replay a branch choice the way the live mutation does
// (answerPendingDecision → resolveIncrementally seeded at the DecisionPoint), not
// by pre-loading the answer into a fresh traversal — the two can disagree.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluateGate, GateEvaluationDeps } from '../../../../apps/pathway-service/src/services/resolution/gate-evaluator';
import { makeEvaluationTemporalContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/evaluation-context';
import { assembleContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/context-assembler';
import { TraversalEngine } from '../../../../apps/pathway-service/src/services/resolution/traversal-engine';
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
const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 }; // migration 039 system defaults

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

function patientWith(labs: Array<[string, number]>, attrs: Record<string, number> = {}): PatientContext {
  return {
    patientId: 'proof', conditionCodes: [{ code: 'O99.012', system: 'ICD-10' }],
    medications: [], allergies: [], vitalSigns: {}, patientAttributes: attrs,
    labResults: labs.map(([code, value]) => ({ code, system: 'LOINC', value })),
  } as unknown as PatientContext;
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

/**
 * Traverse; then, if `choose` is set, answer the named DecisionPoint the way
 * answerPendingDecision does and re-resolve incrementally from it.
 */
async function resolveSession(opts: {
  file: string; reverse: boolean; patient: PatientContext;
  conf?: (id: string) => number; choose?: { dp: string; option: string }; answers?: Record<string, GateAnswer>;
}) {
  const graph = graphFrom(opts.file, opts.reverse);
  const engine = engineFor(opts.patient, opts.conf ?? (() => 0.9));
  const answers = new Map<string, GateAnswer>(Object.entries(opts.answers ?? {}));
  const r = await engine.traverse(graph, opts.patient, answers);
  let pending = r.pendingQuestions;
  if (opts.choose) {
    answers.set(opts.choose.dp, { selectedOption: opts.choose.option } as GateAnswer);
    const rr = await engine.resolveIncrementally(
      new Set([opts.choose.dp]), r.resolutionState, r.dependencyMap!, graph, opts.patient, answers,
      { pendingQuestions: r.pendingQuestions, redFlags: r.redFlags, alsoDropGateIds: [opts.choose.dp] } as never,
    );
    pending = rr.pendingQuestions;
  }
  return { state: r.resolutionState, pending };
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
    expect('dp-1 asks with options', JSON.stringify([...(q?.options ?? [])].sort()), JSON.stringify(['step-1-2', 'step-2-1']));

    console.log('  ferritin 50, provider chooses the workup (criterion 1b):');
    r = await resolveSession({ ...base, patient: patientWith(MCV72_FER50), choose: { dp: 'dp-1', option: 'step-1-2' } });
    expect('step-1-2 workup', status(r.state, 'step-1-2'), 'INCLUDED');
    expect('stage-2', status(r.state, 'stage-2'), 'GATED_OUT');
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'GATED_OUT');
    expect('med-1 ferrous sulfate', status(r.state, 'med-1'), 'GATED_OUT');

    console.log('  ferritin 12, provider chooses the workup:');
    r = await resolveSession({
      ...base, patient: patientWith([['787-2', 72], ['2276-4', 12], ['718-7', 9.5]]),
      choose: { dp: 'dp-1', option: 'step-1-2' },
    });
    expect('stage-2', status(r.state, 'stage-2'), 'INCLUDED');
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'INCLUDED');

    console.log('  ferritin 50, provider chooses empiric iron (criterion 1a) — iron by explicit choice:');
    r = await resolveSession({ ...base, patient: patientWith(MCV72_FER50), choose: { dp: 'dp-1', option: 'step-2-1' } });
    expect('step-2-1 oral iron', status(r.state, 'step-2-1'), 'INCLUDED');
    expect('step-1-2 workup', status(r.state, 'step-1-2'), 'EXCLUDED');
    // [GAP — NEEDS JOSH] the empiric arm reaches Step 2.1 only:
    expect('step-2-3 response assessment (empiric-arm gap)', status(r.state, 'step-2-3'), 'EXCLUDED');

    console.log('  MCV 90, provider chooses the workup — the choice, not MCV, decides Step 1.2:');
    r = await resolveSession({
      ...base, patient: patientWith([['787-2', 90], ['2276-4', 50], ['718-7', 9.5]]),
      choose: { dp: 'dp-1', option: 'step-1-2' },
    });
    expect('step-1-2 workup', status(r.state, 'step-1-2'), 'INCLUDED');

    console.log('  COUNTERFACTUAL — scoring puts step-1-2 below the 0.60 suggest threshold:');
    r = await resolveSession({
      ...base, patient: patientWith(MCV72_FER50), conf: (id) => (id === 'step-1-2' ? 0.5 : 0.9),
    });
    expect('dp-1 auto-selects', status(r.state, 'dp-1'), 'INCLUDED');
    expect('step-2-1 oral iron (automatic again)', status(r.state, 'step-2-1'), 'INCLUDED');
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
  for (const id of ['step-2-1', 'step-1-2']) {
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

const PROOFS: Record<string, () => Promise<void>> = {
  'attribute-form': proveAttributeForm,
  'dp-1': proveDp1,
  'dp-1-scoring': proveDp1Scoring,
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
