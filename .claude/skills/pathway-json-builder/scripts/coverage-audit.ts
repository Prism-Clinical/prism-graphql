// Coverage audit — does the REAL engine make sense of every gate and node?
//
// gate-proof.ts proves named scenarios. This script asks the opposite question:
// across many generated patients and answer sequences, is there any gate the
// engine never opens or never closes, any node it never includes, any question
// that cannot be answered, or any evaluation that throws?
//
// Run from the repo root:
//   npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/coverage-audit.ts [file.json ...]
// Default: every pathways/json/*.json. RUNS=<n> patients per pathway (default 400).
// Exit 1 when anything is reported under ERRORS, STUCK or NEVER.
//
// Patients are generated FROM the pathway: every chart condition a gate reads
// contributes a fact that is randomly absent, satisfying or not satisfying.
// Pending questions are then answered at random, as a provider would through
// answerPendingDecision — a question-gate answer, a DecisionPoint choice, a
// datum (a FACT added to the patient), "Not available", or a window_from start date — and after
// every answer the pathway is evaluated again from scratch, as the evaluation
// pipeline does.
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { makeEvaluationTemporalContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/evaluation-context';
import { assembleContext } from '../../../../apps/pathway-service/src/services/resolution/temporal/context-assembler';
import { withTherapyStarts } from '../../../../apps/pathway-service/src/services/resolution/temporal/anchored-window';
import { normalizePatientAttributes } from '../../../../apps/pathway-service/src/services/resolution/patient-attributes';
import { TraversalEngine } from '../../../../apps/pathway-service/src/services/resolution/traversal-engine';
import { readinessOf } from '../../../../apps/pathway-service/src/services/resolution/pipeline/readiness';
import { DataCompletenessScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/data-completeness';
import { EvidenceStrengthScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/evidence-strength';
import { PatientMatchQualityScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/patient-match-quality';
import { RiskMagnitudeScorer } from '../../../../apps/pathway-service/src/services/confidence/scorers/risk-magnitude';
import { ScoringType } from '../../../../apps/pathway-service/src/types';
import { declinedKeyFor } from '../../../../apps/pathway-service/src/services/resolution/types';
import type { GateAnswer } from '../../../../apps/pathway-service/src/services/resolution/types';
import type { GraphContext, GraphEdge, GraphNode, PatientContext } from '../../../../apps/pathway-service/src/services/confidence/types';

const AS_OF = '2026-09-24T12:00:00.000Z';
const TODAY = AS_OF.slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(AS_OF) - n * 86_400_000).toISOString().slice(0, 10);
const THRESHOLDS = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };
const RUNS = Number(process.env.RUNS ?? 1500);
/** The same question still asked after this many answers in a row is a dead end. */
const STUCK_AFTER = 3;
const MAX_ANSWERS = 40;
/**
 * SCORING=stub (default) gives every node confidence 0.9, so the audit sees
 * what the GATES decide. SCORING=real scores each node with the four seeded
 * SYSTEM signals and the real scorers (node-level weighted average, no DB
 * weight overrides, no propagation) — the live engine then EXCLUDES an action
 * node whose confidence is below the suggest threshold even though every gate
 * above it is open. Run both: the difference is what scoring takes away.
 */
const REAL_SCORING = process.env.SCORING === 'real';
const sig = (name: string, t: ScoringType, w: number, rules: Record<string, unknown> = {}) => ({
  id: name, name, displayName: name, description: '', scoringType: t, scoringRules: rules,
  propagationConfig: { mode: 'none' }, scope: 'SYSTEM', defaultWeight: w, isActive: true,
});
const SIGNALS: Array<[any, any]> = [
  [sig('data_completeness', ScoringType.DATA_PRESENCE, 0.30), new DataCompletenessScorer()],
  [sig('evidence_strength', ScoringType.MAPPING_LOOKUP, 0.25, {
    mappings: { 'Level A': 0.95, 'Level B': 0.80, 'Level C': 0.65, 'Expert Consensus': 0.60 }, default_score: 0.30,
  }), new EvidenceStrengthScorer()],
  [sig('match_quality', ScoringType.CRITERIA_MATCH, 0.25), new PatientMatchQualityScorer()],
  [sig('risk_magnitude', ScoringType.RISK_INVERSE, 0.20), new RiskMagnitudeScorer()],
];
function realConfidence(node: GraphNode, patient: PatientContext, graph: GraphContext): number {
  let sum = 0, wsum = 0;
  for (const [def, scorer] of SIGNALS) {
    const r = scorer.score({ node, signalDefinition: def, patientContext: patient, graphContext: graph });
    if (!r.skipped) { sum += r.score * def.defaultWeight; wsum += def.defaultWeight; }
  }
  return wsum === 0 ? 0 : sum / wsum;
}

// Deterministic PRNG: the audit must report the same thing twice.
let seed = 20261003;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

function graphFrom(pw: any): GraphContext {
  const nodes: GraphNode[] = [
    { id: 'root', nodeIdentifier: 'root', nodeType: 'Pathway', properties: { title: pw.pathway.title } },
    ...pw.nodes.map((n: any) => ({ id: n.id, nodeIdentifier: n.id, nodeType: n.type, properties: { title: n.id, ...n.properties } })),
  ];
  const edges: GraphEdge[] = pw.edges.map((e: any, i: number) => ({
    id: `e${i}`, edgeType: e.type, sourceId: e.from, targetId: e.to, properties: e.properties ?? {},
  }));
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

function* leavesOf(c: any): Generator<any> {
  if (c && Array.isArray(c.conditions)) for (const x of c.conditions) yield* leavesOf(x);
  else if (c) yield c;
}
const gateLeaves = (p: any): any[] =>
  [...(p.condition ? [p.condition] : []), ...(p.conditions ?? [])].flatMap((c) => [...leavesOf(c)]);

/** A concrete code a `value` pattern matches (`D57.0.*` → `D57.01`, `Z94.*` → `Z94.1`). */
const concrete = (v: string) => (v.endsWith('.*') ? (v.slice(0, -2).includes('.') ? `${v.slice(0, -2)}1` : `${v.slice(0, -2)}.1`) : v);

interface Facts {
  labs: Map<string, number[]>;       // code → candidate values
  vitals: Map<string, number[]>;
  conditions: Set<string>; allergies: Set<string>; meds: Set<string>;
  counted: Set<string>;              // count_in_window condition patterns
  attrs: Map<string, unknown[]>;     // attribute key (after `patient.`) → candidate values
  series: Set<string>;               // lab codes read as a dated series (delta_from_baseline)
  roles: Set<string>;                // window_from clinical roles
}

function factsOf(pw: any): Facts {
  const f: Facts = { labs: new Map(), vitals: new Map(), conditions: new Set(), allergies: new Set(), meds: new Set(),
    counted: new Set(), attrs: new Map(), series: new Set(), roles: new Set() };
  const add = <K>(m: Map<K, any[]>, k: K, vs: any[]) => m.set(k, [...new Set([...(m.get(k) ?? []), ...vs])]);
  for (const n of pw.nodes) {
    if (n.type !== 'Gate') continue;
    for (const l of gateLeaves(n.properties)) {
      if (l.attribute) {
        const key = String(l.attribute).split('.').slice(1).join('.');
        const v = l.value;
        add(f.attrs, key, typeof v === 'number' ? [v - 1, v, v + 1] : typeof v === 'boolean' ? [true, false] : Array.isArray(v) ? [...v, '__other__'] : [v, '__other__']);
        continue;
      }
      if (l.field === 'labs') {
        if (l.operator === 'delta_from_baseline') { f.series.add(l.value); if (l.window_from?.clinical_role) f.roles.add(l.window_from.clinical_role); }
        else if (typeof l.threshold === 'number') add(f.labs, l.value, [l.threshold * 0.8, l.threshold, l.threshold * 1.2]);
        else add(f.labs, l.value, [1]);
      } else if (l.field === 'vitals') add(f.vitals, l.value, [l.threshold * 0.8, l.threshold * 1.2]);
      else if (l.field === 'conditions') (l.operator === 'count_in_window' ? f.counted : f.conditions).add(l.value);
      else if (l.field === 'allergies') f.allergies.add(l.value);
      else if (l.field === 'medications') f.meds.add(l.value);
    }
  }
  return f;
}

interface Patient { ctx: PatientContext; therapyStart?: string; role?: string }

function randomPatient(pw: any, f: Facts): Patient {
  const trigger = pw.pathway.condition_codes?.[0]?.code;
  const conditionCodes: any[] = trigger ? [{ code: trigger, system: 'ICD-10' }] : [];
  // Sparse and dense charts both: a gate that needs NONE of a dozen codes is
  // never satisfied when each is present 30% of the time.
  const density = pick([0, 0.03, 0.3]);
  for (const c of f.conditions) if (rnd() < density) conditionCodes.push({ code: concrete(c), system: 'ICD-10' });
  for (const c of f.counted) for (let i = Math.floor(rnd() * 4); i > 0; i--) conditionCodes.push({ code: concrete(c), system: 'ICD-10', date: daysAgo(20 * i) });
  const labResults: any[] = [];
  for (const [code, vs] of f.labs) if (rnd() < 0.7) labResults.push({ code, system: 'LOINC', value: pick(vs), date: TODAY });
  for (const code of f.series) {
    const shape = pick(['none', 'baseline', 'both'] as const);
    const base = pick([7.5, 9.5, 10.6]);
    if (shape !== 'none') labResults.push({ code, system: 'LOINC', value: base, date: daysAgo(24) });
    if (shape === 'both') labResults.push({ code, system: 'LOINC', value: base + pick([0.3, 1.4, 3]), date: daysAgo(1) });
  }
  const vitalSigns: Record<string, number> = {};
  for (const [path, vs] of f.vitals) if (rnd() < 0.7) vitalSigns[path] = pick(vs);
  const attrs: Record<string, unknown> = {};
  for (const [key, vs] of f.attrs) if (rnd() < 0.6) attrs[key] = pick(vs);
  const role = [...f.roles][0];
  // Medication lists sparse and dense too, for the same reason as `density`
  // above (anemia v12: DP-1 needs NONE of nine iron codes — 4% of patients at a
  // flat 30% each). Drawn only when a gate reads medications, so a pathway
  // without such gates generates exactly the patients it did before.
  const medDensity = f.meds.size > 0 ? pick([0, 0.03, 0.3]) : 0;
  return {
    ctx: {
      patientId: 'audit', conditionCodes,
      medications: [...f.meds].filter(() => rnd() < medDensity).map((code) => ({ code: concrete(code), system: 'RXNORM' })),
      allergies: [...f.allergies].filter(() => rnd() < 0.3).map((code) => ({ code, system: 'SNOMED' })),
      vitalSigns, labResults,
      patientAttributes: normalizePatientAttributes(attrs as never) ?? {},
    } as unknown as PatientContext,
    ...(role && rnd() < 0.5 ? { therapyStart: daysAgo(pick([5, 21])), role } : {}),
  };
}

function engineFor(p: Patient, pathwayId: string, graph: GraphContext): TraversalEngine {
  let tc = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
  if (p.therapyStart && p.role) {
    tc = withTherapyStarts(tc, [{ clinicalRole: p.role, date: p.therapyStart,
      source: { carePlanId: 'cp', interventionId: 'i', pathwayId, nodeId: 'audit' } }]);
  }
  const facts = assembleContext({ mode: 'SYNTHETIC', patientContext: p.ctx } as never, tc);
  return new TraversalEngine(
    { computeNodeConfidence: async (node: GraphNode) => ({
      confidence: REAL_SCORING ? realConfidence(node, p.ctx, graph) : 0.9, breakdown: [], resolutionType: 'AUTO_RESOLVED',
    }) } as never,
    THRESHOLDS, tc, {}, facts, new Map(),
  );
}

const ACTIONS = new Set(['Medication', 'LabTest', 'Procedure', 'Imaging', 'Guidance', 'Schedule', 'QualityMetric', 'Referral']);
const REFERENCE = new Set(['CodeEntry', 'EvidenceCitation']);

async function audit(file: string): Promise<number> {
  const pw = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const graph = graphFrom(pw);
  const facts = factsOf(pw);
  const pathwayId = pw.pathway.logical_id;
  const seen = new Map<string, Set<string>>(graph.allNodes.map((n) => [n.nodeIdentifier, new Set<string>()]));
  const errors = new Map<string, number>();
  const stuck = new Map<string, number>();
  const stuckExample = new Map<string, string>();
  const lowConfidence = new Map<string, number>();
  const onlyDecline = new Map<string, number>();
  const questionKinds = new Map<string, number>();
  let evaluations = 0, finished = 0, ready = 0, capped = 0;

  const run = async (p: Patient, answers: Map<string, GateAnswer>) => {
    evaluations++;
    const r = await engineFor(p, pathwayId, graph).traverse(graph, p.ctx, answers);
    for (const [id, n] of r.resolutionState) {
      seen.get(id)?.add((n as any).notYetDue ? 'NOT_YET_DUE' : n.status);
      if (/below suggest threshold/.test(String((n as any).excludeReason ?? ''))) lowConfidence.set(id, (lowConfidence.get(id) ?? 0) + 1);
    }
    return r;
  };

  for (let i = 0; i < RUNS; i++) {
    const p = randomPatient(pw, facts);
    const answers = new Map<string, GateAnswer>();
    try {
      let r = await run(p, answers);
      let steps = 0, lastSig = '', repeats = 0;
      while (r.pendingQuestions.length > 0 && steps++ < MAX_ANSWERS) {
        const q: any = pick(r.pendingQuestions);
        const node = graph.getNode(q.gateId);
        const kind = node?.nodeType === 'DecisionPoint' ? 'branch choice'
          : q.askTarget ? `datum:${q.askTarget.kind}:${q.answerType}` : `question:${q.answerType}`;
        questionKinds.set(kind, (questionKinds.get(kind) ?? 0) + 1);
        const sig = `${q.gateId}|${q.datumKey ?? ''}`;

        if (node?.nodeType === 'DecisionPoint') answers.set(q.gateId, { selectedOption: pick(q.options ?? []) } as GateAnswer);
        // One data question in six is answered "Not available", as a provider
        // without the value would (GateAnswerInput.notAvailable).
        else if (q.askTarget && q.datumKey && rnd() < 1 / 6) answers.set(declinedKeyFor(q.datumKey), { notAvailable: true } as GateAnswer);
        else if (q.askTarget?.kind === 'anchor') answers.set(q.askTarget.key, { dateValue: daysAgo(pick([5, 21])) } as GateAnswer);
        else if (q.askTarget?.kind === 'lab') {
          const vs = facts.labs.get(q.askTarget.code) ?? [pick([8, 10, 12])];
          // As mergeAdditionalContext does: a later provider answer for the
          // same code SUPERSEDES the earlier one (effective-context.ts).
          (p.ctx as any).labResults = [
            ...(p.ctx as any).labResults.filter((l: any) => !(l.providerAsserted && l.code === q.askTarget.code)),
            { code: q.askTarget.code, system: q.askTarget.system, value: pick(vs), date: AS_OF, providerAsserted: true }];
        } else if (q.askTarget?.kind === 'vital') {
          (p.ctx as any).vitalSigns = { ...(p.ctx as any).vitalSigns, [q.askTarget.path]: pick(facts.vitals.get(q.askTarget.path) ?? [1]) };
        } else if (q.askTarget?.kind === 'attribute') {
          const key = q.askTarget.path.split('.').slice(1).join('.');
          const t = String(q.answerType).toUpperCase();
          const value = t === 'BOOLEAN' ? rnd() < 0.5 : t === 'SELECT' ? pick(q.options ?? []) : pick((facts.attrs.get(key) ?? [1]).filter((v) => typeof v === 'number'));
          (p.ctx as any).patientAttributes = normalizePatientAttributes({ ...(p.ctx as any).patientAttributes, [key]: value } as never) ?? {};
        } else {
          const t = String(q.answerType).toUpperCase();
          answers.set(q.gateId, (t === 'BOOLEAN' ? { booleanValue: rnd() < 0.5 }
            : t === 'SELECT' ? { selectedOption: pick(q.options ?? []) } : { numericValue: pick([0, 1, 5, 50]) }) as GateAnswer);
        }
        r = await run(p, answers);
        repeats = sig === lastSig ? repeats + 1 : 1;
        lastSig = sig;
        if (repeats >= STUCK_AFTER && r.pendingQuestions.some((x: any) => `${x.gateId}|${x.datumKey ?? ''}` === sig)) {
          // No VALUE settles it. A provider's way out is "Not available"; a
          // question that survives even that is a dead end.
          if (q.askTarget && q.datumKey) {
            answers.set(declinedKeyFor(q.datumKey), { notAvailable: true } as GateAnswer);
            r = await run(p, answers);
            if (!r.pendingQuestions.some((x: any) => `${x.gateId}|${x.datumKey ?? ''}` === sig)) {
              const note = `${q.gateId} — "${String(q.prompt).slice(0, 70)}"`;
              onlyDecline.set(note, (onlyDecline.get(note) ?? 0) + 1);
              repeats = 0;
              continue;
            }
          }
          const key = `${q.gateId} (${kind}) — "${String(q.prompt).slice(0, 70)}"`;
          if (!stuck.has(key)) {
            stuckExample.set(key, JSON.stringify({
              labs: (p.ctx as any).labResults.filter((l: any) => l.code === q.askTarget?.code),
              therapyStart: p.therapyStart ?? null, answers: [...answers.keys()],
              reason: r.resolutionState.get(q.gateId)?.excludeReason,
              askedBy: r.pendingQuestions.find((x: any) => `${x.gateId}|${x.datumKey ?? ''}` === sig)?.askedByNodeIds,
            }));
          }
          stuck.set(key, (stuck.get(key) ?? 0) + 1);
          break;
        }
      }
      if (r.pendingQuestions.length === 0) {
        finished++;
        const b = readinessOf({ state: r.resolutionState as never, pendingQuestions: [], redFlags: r.redFlags as never, unavailable: [], scope: 'ROOT', isDegraded: false }).blockers;
        if (b.length === 0) ready++;
      } else if (steps > MAX_ANSWERS) capped++;
    } catch (err) {
      const m = (err instanceof Error ? err.message : String(err)).slice(0, 160);
      errors.set(m, (errors.get(m) ?? 0) + 1);
    }
  }

  const title = (id: string) => `${id} (${String(graph.getNode(id)?.properties?.title ?? '').slice(0, 50)})`;
  const BAD = ['TIMEOUT', 'CASCADE_LIMIT', 'UNKNOWN'];
  const never: string[] = [], odd: string[] = [];
  for (const n of graph.allNodes) {
    const id = n.nodeIdentifier, s = seen.get(id)!;
    if (id === 'root') continue;
    if (s.size === 0) { never.push(`never reached at all: ${n.nodeType} ${title(id)}`); continue; }
    if ([...s].some((x) => BAD.includes(x))) odd.push(`${n.nodeType} ${title(id)}: ${[...s].filter((x) => BAD.includes(x)).join(', ')}`);
    if (REFERENCE.has(n.nodeType)) continue;
    if (!s.has('INCLUDED')) never.push(`never INCLUDED: ${n.nodeType} ${title(id)} — only ${[...s].join(', ')}`);
    if (n.nodeType === 'Gate' && !['GATED_OUT', 'NOT_YET_DUE'].some((x) => s.has(x))) never.push(`gate never closes: ${title(id)} — only ${[...s].join(', ')}`);
  }

  console.log(`\n=== ${pathwayId} v${pw.pathway.version} — ${graph.allNodes.length - 1} nodes, ${RUNS} patients, ${evaluations} evaluations ===`);
  console.log(`  sessions answered to the end: ${finished}/${RUNS} (${ready} with a generatable plan; ${capped} hit the ${MAX_ANSWERS}-answer cap)`);
  console.log(`  question kinds asked: ${[...questionKinds].map(([k, n]) => `${k} ×${n}`).join(', ') || '(none)'}`);
  const section = (name: string, lines: string[]) => { console.log(`  ${name}: ${lines.length === 0 ? 'none' : ''}`); for (const l of lines) console.log(`    ✗ ${l}`); };
  section('ERRORS (evaluation threw)', [...errors].map(([m, n]) => `×${n} ${m}`));
  section('STUCK (still asked after being answered)', [...stuck].map(([m, n]) => `×${n} ${m}\n        e.g. ${stuckExample.get(m)}`));
  if (onlyDecline.size > 0) {
    console.log('  NOTE — no value settles these; only "Not available" does:');
    for (const [m, n] of onlyDecline) console.log(`    · ×${n} ${m}`);
  }
  section('NEVER (not reached, never included, or a gate that never closes)', never);
  section('INCOMPLETE statuses seen', odd);
  if (REAL_SCORING) {
    const dropped = graph.allNodes.filter((n) => lowConfidence.has(n.nodeIdentifier));
    const byType = new Map<string, { always: number; sometimes: number }>();
    for (const n of dropped) {
      const e = byType.get(n.nodeType) ?? { always: 0, sometimes: 0 };
      if (seen.get(n.nodeIdentifier)!.has('INCLUDED')) e.sometimes++; else e.always++;
      byType.set(n.nodeType, e);
    }
    console.log(`  EXCLUDED BY CONFIDENCE (gates open, score below the suggest threshold): ${dropped.length === 0 ? 'none' : ''}`);
    for (const [t, e] of byType) console.log(`    ${t}: ${e.always} never included in any session, ${e.sometimes} included in some sessions and dropped in others`);
  }
  const actions = graph.allNodes.filter((n) => ACTIONS.has(n.nodeType));
  console.log(`  action nodes included at least once: ${actions.filter((n) => seen.get(n.nodeIdentifier)!.has('INCLUDED')).length}/${actions.length}`);
  return errors.size + stuck.size + never.length + odd.length;
}

async function main() {
  const files = process.argv.slice(2).length > 0 ? process.argv.slice(2)
    : readdirSync('pathways/json').filter((f) => f.endsWith('.json')).map((f) => `pathways/json/${f}`);
  let problems = 0;
  for (const f of files) problems += await audit(f);
  console.log(problems === 0 ? '\n✓ every gate and node is exercised, and every question can be answered' : `\n✗ ${problems} finding(s)`);
  process.exit(problems === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
