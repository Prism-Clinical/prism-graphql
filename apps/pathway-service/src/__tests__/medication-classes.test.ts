/**
 * Matching a chart medication by what it IS — an ingredient
 * (`system: "RXNORM_INGREDIENT"`) or a product-level ATC class
 * (`system: "ATC"`) — instead of by a list of product codes.
 *
 * [DECISION — Josh 2026-10-04]: "Match the vaccine, not the brand."
 *
 * Dates and status are the chart entry's; the identity is the entry's
 * normalisation. A medication that could not be identified is never a silent
 * "not in the class": a gate whose answer depends on it is unresolved and asks
 * the provider about that entry by name. The session path (question, answer,
 * pinning, replay) is proved in `pipeline-medication-classes.test.ts`.
 *
 * The identities below are what RxNav returned for these products on
 * 2026-10-04 (see the reference table in the format spec).
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { AnswerType, DefaultBehavior, GateAnswer, GateCondition, GateProperties, GateType, NodeStatus } from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import {
  classMembership,
  isMedicationClassCondition,
  medicationClassConditionError,
  medicationClassKey,
} from '../services/resolution/medication-classes';
import type { MedicationIdentity, MedicationIdentityLookup } from '../services/resolution/medication-classes';
import { sweepableConditions } from '../resolvers/helpers/resolution-context';
import { scoreReachability } from '../services/resolution/reachability';
import { validatePathwayJson } from '../services/import/validator';
import { conditionProblem } from '../services/compiler/gates';
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import type { PathwayJson } from '../services/import/types';
import type { GraphEdge, GraphNode, PatientContext } from '../services/confidence/types';
import { clonePathway } from './fixtures/reference-pathway';
import { makeGraphContext } from './fixtures/reference-patient-context';

const AS_OF = '2026-10-04T12:00:00.000Z';

// ─── what RxNav says these are ────────────────────────────────────────

const FLU = ['1657128', '1657131', '1657134']; // influenza A (H1N1), A (H3N2), B antigens
const id = (ingredientRxcuis: string[], productAtcClasses: string[], ingredientNames: string[] = []): MedicationIdentity =>
  ({ ingredientRxcuis, ingredientNames, productAtcClasses });

const IDENTITIES: Record<string, MedicationIdentity> = {
  '2718382': id(FLU, ['J07BB']),                                   // Flucelvax 2025-2026 prefilled syringe
  '2746449': id(FLU, ['J07BB']),                                   // Flublok 2026-2027 prefilled syringe
  '1116183': id(['10454', '1151', '24941', '4511', '9346'], ['B03AE']), // prenatal multivitamin with ferrous fumarate
  '1119573': id(['10454', '105669', '4511'], ['A11AA']),           // Vitafol-One (polysaccharide iron)
  '198640': id(['4511'], ['B03BB']),                               // folic acid 0.4 mg tablet
  '1300370': id(['798302', '798304', '798306'], ['J07AJ']),        // Boostrix (Tdap)
  '1190916': id(['798304', '798306'], ['J07AM']),                  // Tenivac (Td)
  '310325': id(['24947'], ['B03AA']),                              // ferrous sulfate 325 mg tablet
  '198630': id(['24942'], ['B03AA']),                              // ferrous gluconate 324 mg tablet
  '136209': id(['24909'], ['B03AC']),                              // Venofer (iron sucrose)
  '1435170': id(['1433693'], ['B03AC']),                           // Injectafer (ferric carboxymaltose)
  '2723014': id(['2606074'], []),                                  // Nuvaxovid — no ATC class in RxNav at all
  '24947': id(['24947'], []),                                      // "ferrous sulfate" charted as the ingredient: product class ambiguous
};
const lookup: MedicationIdentityLookup = (input) => IDENTITIES[input.code ?? ''] ?? null;

type Med = { code: string; system: string; display?: string; date?: string; endDate?: string };
const med = (code: string, display: string, date?: string, extra: Partial<Med> = {}): Med =>
  ({ code, system: 'RXNORM', display, ...(date ? { date } : {}), ...extra });

const FLUCELVAX_LAST_SEASON = med('2718382', 'Flucelvax 2025-2026', '2025-10-20');
const FLUBLOK_THIS_SEASON = med('2746449', 'Flublok 2026-2027', '2026-09-22');
const PRENATAL = med('1116183', 'Prenatal multivitamin with iron', '2026-05-01');
const FOLIC = med('198640', 'Folic acid 0.4 mg tablet', '2026-05-01');
const BOOSTRIX = med('1300370', 'Boostrix', '2026-09-10');
const TENIVAC = med('1190916', 'Tenivac', '2026-09-10');
const FERROUS_SULFATE = med('310325', 'Ferrous sulfate 325 mg tablet', '2026-08-01');
const VENOFER = med('136209', 'Venofer', '2026-08-15');
const NUVAXOVID = med('2723014', 'Nuvaxovid 2025-2026', '2026-09-25');
const MYSTERY = med('9999999', 'Flublok Quadrivalent 2026', '2026-09-22');

function patient(medications: Med[], attrs?: Record<string, unknown>): PatientContext {
  return {
    patientId: 'pt-1', conditionCodes: [], medications, allergies: [], labResults: [],
    ...(attrs ? { patientAttributes: attrs } : {}),
  } as unknown as PatientContext;
}

function deps(p: PatientContext, opts: { version?: string; answers?: Map<string, GateAnswer>; identity?: MedicationIdentityLookup | null } = {}): GateEvaluationDeps {
  const version = opts.version ?? 'v1';
  const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version });
  return {
    temporalContext, pathwayDefaults: {},
    factStore: version === 'v1' ? assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext) : [],
    patientContext: p, resolutionState: new Map(), gateAnswers: opts.answers ?? new Map(), gateId: 'gate-1', codeMap: new Map(),
    ...(opts.identity === null ? {} : { medicationIdentity: opts.identity ?? lookup }),
  };
}
const gateOf = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}): GateProperties =>
  ({ title: 'Gate', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, condition: condition as unknown as GateCondition, ...extra }) as GateProperties;
const evaluate = (condition: Record<string, unknown>, p: PatientContext, opts: Parameters<typeof deps>[1] = {}) =>
  evaluateGate(gateOf(condition), deps(p, opts));

const ingredient = (operator: string, value: string, display: string, extra: Record<string, unknown> = {}) =>
  ({ field: 'medications', operator, value, system: 'RXNORM_INGREDIENT', display, status: 'any', horizon: 'LIFETIME', ...extra });
const atc = (operator: string, value: string, display: string, extra: Record<string, unknown> = {}) =>
  ({ field: 'medications', operator, value, system: 'ATC', display, status: 'any', horizon: 'LIFETIME', ...extra });

const HAS_FLU = ingredient('includes_code', '1657128', 'an influenza vaccine');
const NO_FLU = ingredient('not_includes_code', '1657128', 'an influenza vaccine');
const FLU_THIS_SEASON = ingredient('count_in_window', '1657128', 'an influenza vaccine', { horizon: { since: '09-01' }, count_threshold: 1 });
const FLU_OWED = { ...FLU_THIS_SEASON, count_comparison: 'less_than' };

// ─── membership test ──────────────────────────────────────────────────

describe('classMembership', () => {
  const entry = { code: '310325', system: 'RXNORM' };
  it('by ingredient: any ingredient of the product', () => {
    expect(classMembership(IDENTITIES['1116183'], entry, 'RXNORM_INGREDIENT', '4511')).toBe('MEMBER');
    expect(classMembership(IDENTITIES['1116183'], entry, 'RXNORM_INGREDIENT', '24947')).toBe('NOT');
    expect(classMembership(null, entry, 'RXNORM_INGREDIENT', '4511')).toBe('UNKNOWN');
  });
  it('by ingredient: an entry coded AS the ingredient is a member with no identity at all', () => {
    expect(classMembership(null, { code: '4511', system: 'RXNORM' }, 'RXNORM_INGREDIENT', '4511')).toBe('MEMBER');
    expect(classMembership(null, { code: '4511', system: 'RxNorm' }, 'RXNORM_INGREDIENT', '4511')).toBe('MEMBER');
    expect(classMembership(null, { code: '4511', system: 'NDC' }, 'RXNORM_INGREDIENT', '4511')).toBe('UNKNOWN');
  });
  it('by ATC: prefix of a PRODUCT class; no product class on record is UNKNOWN, not "in no class"', () => {
    expect(classMembership(IDENTITIES['2718382'], entry, 'ATC', 'J07BB')).toBe('MEMBER');
    expect(classMembership(IDENTITIES['2718382'], entry, 'ATC', 'J07')).toBe('MEMBER');
    expect(classMembership(IDENTITIES['2718382'], entry, 'ATC', 'J07A')).toBe('NOT');
    expect(classMembership(IDENTITIES['2723014'], entry, 'ATC', 'J07BN')).toBe('UNKNOWN');
    expect(classMembership(null, entry, 'ATC', 'J07BB')).toBe('UNKNOWN');
  });
});

// ─── the clinical cases ───────────────────────────────────────────────

describe('influenza vaccine — any brand, any season', () => {
  it('a brand product of this season and one of last season both match the ingredient', async () => {
    for (const m of [FLUBLOK_THIS_SEASON, FLUCELVAX_LAST_SEASON]) {
      const r = await evaluate(HAS_FLU, patient([m]));
      expect(r.satisfied).toBe(true);
      expect(r.reason).toBe(`Medication list includes an influenza vaccine (${m.display})`);
      expect(r.indeterminate).toBe(false);
      expect((await evaluate(NO_FLU, patient([m]))).satisfied).toBe(false);
    }
    // And by product class.
    expect((await evaluate(atc('includes_code', 'J07BB', 'an influenza vaccine'), patient([FLUCELVAX_LAST_SEASON]))).satisfied).toBe(true);
  });

  it('a { since: "09-01" } count sees only the in-season dose, by the date on the chart entry', async () => {
    const both = patient([FLUCELVAX_LAST_SEASON, FLUBLOK_THIS_SEASON]);
    const given = await evaluate(FLU_THIS_SEASON, both);
    expect(given.satisfied).toBe(true);
    expect(given.reason).toBe('Found 1 on the medication list matching an influenza vaccine (Flublok 2026-2027) since 2026-09-01 (this season) (≥1)');

    const lastSeasonOnly = patient([FLUCELVAX_LAST_SEASON]);
    expect((await evaluate(FLU_THIS_SEASON, lastSeasonOnly)).satisfied).toBe(false);
    const owed = await evaluate(FLU_OWED, lastSeasonOnly);
    expect(owed.satisfied).toBe(true);
    expect(owed.reason).toBe('Found 0 on the medication list matching an influenza vaccine since 2026-09-01 (this season) (<1)');
    expect(owed.indeterminate).toBe(false);
  });

  it('membership overlaps the window; a count selects on the start date — so "given this season" is a COUNT', async () => {
    // Last season's record has no end date: as an interval it is still open, and overlaps every window since.
    const lastSeasonOnly = patient([FLUCELVAX_LAST_SEASON]);
    expect((await evaluate({ ...HAS_FLU, horizon: { since: '09-01' } }, lastSeasonOnly)).satisfied).toBe(true);
    expect((await evaluate(FLU_THIS_SEASON, lastSeasonOnly)).satisfied).toBe(false);
    // With an end date the record is closed, and membership agrees with the count.
    const closed = patient([{ ...FLUCELVAX_LAST_SEASON, endDate: '2025-10-20' }]);
    expect((await evaluate({ ...HAS_FLU, horizon: { since: '09-01' } }, closed)).satisfied).toBe(false);
  });

  it('every horizon bounds a class condition as it bounds a product-code one', async () => {
    const p = patient([FLUBLOK_THIS_SEASON], { gestational_age_weeks: 28 }); // given 2026-09-22
    const count = (horizon: unknown) => evaluate({ ...FLU_THIS_SEASON, horizon }, p);
    expect((await count('PREGNANCY')).satisfied).toBe(true);
    expect((await count({ days: 30 })).satisfied).toBe(true);
    expect((await count({ days: 7 })).satisfied).toBe(false);
    expect((await count({ since_gestational_week: 24 })).satisfied).toBe(true);   // week 24 began 2026-09-06
    expect((await count({ since_gestational_week: 27 })).satisfied).toBe(false);  // week 27 began 2026-09-27
    expect((await count({ since: '10-01' })).satisfied).toBe(false);
    const pregnancy = await count('PREGNANCY');
    expect(pregnancy.reason).toContain('within this pregnancy (since 2026-03-22, 28 weeks)');
    expect(pregnancy.contextFieldsRead).toEqual(['medications', 'patient.gestational_age_weeks']);
    // Gestational age missing: the shared gestational-age question, as for any PREGNANCY condition.
    const undated = await evaluate({ ...FLU_THIS_SEASON, horizon: 'PREGNANCY' }, patient([FLUBLOK_THIS_SEASON]));
    expect(undated.unresolvedPregnancyConditions).toHaveLength(1);
  });

  it('status is the chart entry\'s: an inactive record counts only under status "any"', async () => {
    const stopped = patient([{ ...FERROUS_SULFATE, clinicalState: 'INACTIVE' } as never]);
    const onIron = ingredient('includes_code', '24947', 'ferrous sulfate');
    expect((await evaluate({ ...onIron, status: 'any' }, stopped)).satisfied).toBe(true);
    expect((await evaluate({ ...onIron, status: 'active' }, stopped)).satisfied).toBe(false);
  });
});

describe('folic acid, Tdap, iron', () => {
  it('a prenatal multivitamin matches the folic acid ingredient, as plain folic acid does', async () => {
    const folic = ingredient('includes_code', '4511', 'a folic-acid-containing product');
    expect((await evaluate(folic, patient([PRENATAL]))).satisfied).toBe(true);
    expect((await evaluate(folic, patient([FOLIC]))).satisfied).toBe(true);
    expect((await evaluate(folic, patient([FERROUS_SULFATE]))).satisfied).toBe(false);
  });

  it('Tdap matches the pertussis ingredient; plain Td does not', async () => {
    const tdap = ingredient('includes_code', '798302', 'a Tdap vaccine');
    expect((await evaluate(tdap, patient([BOOSTRIX]))).satisfied).toBe(true);
    const td = await evaluate(tdap, patient([TENIVAC]));
    expect(td.satisfied).toBe(false);
    expect(td.indeterminate).toBe(false);
    expect(td.reason).toBe('No medication on the list is a Tdap vaccine');
    // By product class: J07AJ (pertussis) versus J07AM (tetanus).
    expect((await evaluate(atc('includes_code', 'J07AJ', 'a Tdap vaccine'), patient([BOOSTRIX]))).satisfied).toBe(true);
    expect((await evaluate(atc('includes_code', 'J07AJ', 'a Tdap vaccine'), patient([TENIVAC]))).satisfied).toBe(false);
  });

  it('oral iron and IV iron are separate — and a prenatal vitamin that CONTAINS iron is neither, by product class', async () => {
    const oral = atc('includes_code', 'B03AA', 'an oral iron supplement');
    const iv = atc('includes_code', 'B03AC', 'intravenous iron');
    expect((await evaluate(oral, patient([FERROUS_SULFATE]))).satisfied).toBe(true);
    expect((await evaluate(iv, patient([FERROUS_SULFATE]))).satisfied).toBe(false);
    expect((await evaluate(iv, patient([VENOFER]))).satisfied).toBe(true);
    expect((await evaluate(oral, patient([VENOFER]))).satisfied).toBe(false);
    expect((await evaluate(oral, patient([PRENATAL]))).satisfied).toBe(false);   // B03AE, a multivitamin
    expect((await evaluate(iv, patient([PRENATAL]))).satisfied).toBe(false);
    // The ingredient DOES match the prenatal vitamin — which is why "on oral iron" is authored on the class.
    expect((await evaluate(ingredient('includes_code', '24941', 'ferrous fumarate'), patient([PRENATAL]))).satisfied).toBe(true);
    // IV iron by ingredient is exact too.
    expect((await evaluate(ingredient('includes_code', '24909', 'iron sucrose'), patient([VENOFER]))).satisfied).toBe(true);
  });
});

// ─── a medication that cannot be identified ───────────────────────────

describe('an unidentified medication is never a silent "not in the class"', () => {
  const key = (code: string, display: string, value = '1657128', system = 'RXNORM_INGREDIENT') =>
    medicationClassKey(system, value, `${display.toLowerCase()}|RXNORM|${code}`);
  const MYSTERY_ENTRY = { key: key('9999999', 'Flublok Quadrivalent 2026'), label: 'Flublok Quadrivalent 2026' };

  it.each([
    ['includes_code', HAS_FLU],
    ['not_includes_code', NO_FLU],
    ['count_in_window at_least 1', FLU_THIS_SEASON],
    ['count_in_window less_than 1', FLU_OWED],
  ])('%s: unresolved, naming the entry — never a verdict', async (_l, condition) => {
    const r = await evaluate(condition, patient([MYSTERY]));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['MEDICATION_UNIDENTIFIED']);
    expect(r.unresolvedMedicationClasses).toEqual([{ condition, entries: [MYSTERY_ENTRY] }]);
    expect(r.reason).toContain('Cannot tell whether Flublok Quadrivalent 2026 on the medication list is an influenza vaccine: not identified');
  });

  it('with NO identity lookup at all (a caller outside the pipeline) every medication is unidentified — and asked about', async () => {
    const r = await evaluate(NO_FLU, patient([FLUBLOK_THIS_SEASON]), { identity: null });
    expect(r.indeterminate).toBe(true);
    expect(r.unresolvedMedicationClasses![0].entries).toEqual([{ key: key('2746449', 'Flublok 2026-2027'), label: 'Flublok 2026-2027' }]);
  });

  it('is definite when the unidentified entry cannot change the answer', async () => {
    // One identified flu vaccine settles "is one on the list".
    const has = await evaluate(HAS_FLU, patient([MYSTERY, FLUBLOK_THIS_SEASON]));
    expect(has.satisfied).toBe(true);
    expect(has.indeterminate).toBe(false);
    const hasNot = await evaluate(NO_FLU, patient([MYSTERY, FLUBLOK_THIS_SEASON]));
    expect(hasNot.satisfied).toBe(false);
    expect(hasNot.indeterminate).toBe(false);
    // The count already reaches its threshold without it.
    expect((await evaluate(FLU_THIS_SEASON, patient([MYSTERY, FLUBLOK_THIS_SEASON]))).indeterminate).toBe(false);
    // An unidentified entry OUTSIDE the window is irrelevant.
    const old = await evaluate(FLU_OWED, patient([{ ...MYSTERY, date: '2025-03-01' }]));
    expect(old.satisfied).toBe(true);
    expect(old.indeterminate).toBe(false);
    // An empty list is a definite "none".
    const none = await evaluate(NO_FLU, patient([]));
    expect(none.satisfied).toBe(true);
    expect(none.reason).toBe('No medication on the list is an influenza vaccine');
  });

  it('a count is unresolved only when the unknowns could cross the threshold', async () => {
    const twoDoses = { ...FLU_THIS_SEASON, count_threshold: 2 };
    // 1 identified + 1 unknown: could be 1 or 2 → unresolved.
    expect((await evaluate(twoDoses, patient([FLUBLOK_THIS_SEASON, MYSTERY]))).indeterminate).toBe(true);
    // 0 identified + 1 unknown: 0 or 1, both below 2 → definite.
    const short = await evaluate(twoDoses, patient([MYSTERY]));
    expect(short.indeterminate).toBe(false);
    expect(short.satisfied).toBe(false);
  });

  it('ATC: a product RxNav gives no class for is unknown to an ATC condition — but known to an ingredient one', async () => {
    const covidByClass = atc('not_includes_code', 'J07BN', 'a COVID-19 vaccine');
    const r = await evaluate(covidByClass, patient([NUVAXOVID]));
    expect(r.indeterminate).toBe(true);
    expect(r.unresolvedMedicationClasses![0].entries[0].label).toBe('Nuvaxovid 2025-2026');
    const covidByIngredient = ingredient('includes_code', '2606074', 'a COVID-19 vaccine');
    expect((await evaluate(covidByIngredient, patient([NUVAXOVID]))).satisfied).toBe(true);
  });

  it('the provider\'s answer for an entry decides that entry: yes counts it, dated as the entry is; no excludes it', async () => {
    const yes = new Map<string, GateAnswer>([[MYSTERY_ENTRY.key, { booleanValue: true }]]);
    const given = await evaluate(FLU_THIS_SEASON, patient([MYSTERY]), { answers: yes });
    expect(given.satisfied).toBe(true);
    expect(given.indeterminate).toBe(false);
    expect(given.reason).toContain('(Flublok Quadrivalent 2026) since 2026-09-01 (this season)');
    // "Yes", but the entry is dated last season: it is a flu vaccine, and not one given this season.
    const lastSeason = await evaluate(FLU_THIS_SEASON, patient([{ ...MYSTERY, date: '2025-10-20' }]), { answers: yes });
    expect(lastSeason.satisfied).toBe(false);

    const no = new Map<string, GateAnswer>([[MYSTERY_ENTRY.key, { booleanValue: false }]]);
    const owed = await evaluate(FLU_OWED, patient([MYSTERY]), { answers: no });
    expect(owed.satisfied).toBe(true);
    expect(owed.indeterminate).toBe(false);
    // An answer is about ONE class: the same entry is still unknown to another.
    const tdap = await evaluate(ingredient('not_includes_code', '798302', 'a Tdap vaccine'), patient([MYSTERY]), { answers: yes });
    expect(tdap.indeterminate).toBe(true);
  });

  it('in a compound: asked about only when nothing else settles the gate', async () => {
    const compound = (sibling: Record<string, unknown>) =>
      ({ title: 'G', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP, operator: 'AND', conditions: [sibling, NO_FLU] }) as unknown as GateProperties;
    const inSeason = { attribute: 'encounter.date', operator: 'in_season', from: '09-01', to: '03-31' };
    const outOfSeason = { attribute: 'encounter.date', operator: 'in_season', from: '11-01', to: '03-31' };
    const open = await evaluateGate(compound(inSeason), deps(patient([MYSTERY])));
    expect(open.indeterminate).toBe(true);
    expect(open.unresolvedMedicationClasses).toHaveLength(1);
    const settled = await evaluateGate(compound(outOfSeason), deps(patient([MYSTERY])));
    expect(settled.satisfied).toBe(false);
    expect(settled.indeterminate).toBe(false);
    expect(settled.unresolvedMedicationClasses).toBeUndefined();
  });

  // ── the question ──

  const node = (id_: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
    ({ id: id_, nodeIdentifier: id_, nodeType: type, properties: { title: id_, ...props } });
  const edge = (sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge =>
    ({ id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} });

  async function traverse(gates: Array<Record<string, unknown>>, p: PatientContext, answers = new Map<string, GateAnswer>()) {
    const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    const nodes = [node('root', 'Pathway')];
    const edges: GraphEdge[] = [];
    gates.forEach((props, i) => {
      nodes.push(node(`gate-${i}`, 'Gate', props), node(`step-${i}`, 'Step'));
      edges.push(edge('root', `gate-${i}`, 'HAS_GATE'), edge(`gate-${i}`, `step-${i}`, 'BRANCHES_TO'));
    });
    const engine = new TraversalEngine(
      { computeNodeConfidence: jest.fn().mockResolvedValue({ confidence: 0.85, breakdown: [], resolutionType: 'AUTO_RESOLVED' }) } as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      temporalContext, {}, assembleContext({ mode: 'SYNTHETIC', patientContext: p } as never, temporalContext), new Map(),
      undefined, lookup,
    );
    return engine.traverse(makeGraphContext(nodes, edges), p, answers);
  }
  const askGate = (condition: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ ...gateOf(condition), on_unresolved: 'ask', ...extra }) as unknown as Record<string, unknown>;

  it('the gate PENDS on one yes/no question that names the entry and the class', async () => {
    const result = await traverse([askGate(FLU_OWED, { prompt: 'Influenza vaccine still owed?' })], patient([MYSTERY]));
    expect(result.resolutionState.get('gate-0')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(result.pendingQuestions).toHaveLength(1);
    expect(result.pendingQuestions[0]).toMatchObject({
      gateId: 'gate-0',
      datumKey: MYSTERY_ENTRY.key,
      answerType: AnswerType.BOOLEAN,
      askTarget: { kind: 'medication_class', key: MYSTERY_ENTRY.key },
      // The gate's own prompt is about the class; the question is about this entry.
      prompt: '"Flublok Quadrivalent 2026" is on the medication list and could not be identified. Does it count as an influenza vaccine?',
    });
  });

  it('two gates on the same class share the question; a gate on another class asks its own', async () => {
    const tdapOwed = ingredient('not_includes_code', '798302', 'a Tdap vaccine');
    const result = await traverse([askGate(FLU_OWED), askGate(NO_FLU), askGate(tdapOwed)], patient([MYSTERY]));
    expect(result.pendingQuestions.map((q) => [q.datumKey, q.askedByNodeIds])).toEqual([
      [MYSTERY_ENTRY.key, ['gate-0', 'gate-1']],
      [key('9999999', 'Flublok Quadrivalent 2026', '798302'), ['gate-2']],
    ]);
  });

  it('several unidentified entries are asked about one at a time', async () => {
    const OTHER = med('8888888', 'Vaccine NOS', '2026-09-25');
    const first = await traverse([askGate(FLU_OWED)], patient([MYSTERY, OTHER]));
    expect(first.pendingQuestions).toHaveLength(1);
    expect(first.pendingQuestions[0].prompt).toContain('"Flublok Quadrivalent 2026"');
    // "No" to the first: the second is asked.
    const second = await traverse([askGate(FLU_OWED)], patient([MYSTERY, OTHER]), new Map([[MYSTERY_ENTRY.key, { booleanValue: false }]]));
    expect(second.pendingQuestions[0].prompt).toContain('"Vaccine NOS"');
    // "Yes" to the first: decided, and the second is never asked.
    const done = await traverse([askGate(FLU_OWED)], patient([MYSTERY, OTHER]), new Map([[MYSTERY_ENTRY.key, { booleanValue: true }]]));
    expect(done.pendingQuestions).toEqual([]);
    expect(done.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('"Not available": nothing more is asked; default_behavior applies — or the gate opens under on_declined', async () => {
    const declined = new Map<string, GateAnswer>([[`declined:${MYSTERY_ENTRY.key}`, { notAvailable: true }]]);
    const closed = await traverse([askGate(FLU_OWED)], patient([MYSTERY]), declined);
    expect(closed.pendingQuestions).toEqual([]);
    expect(closed.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
    expect(closed.resolutionState.get('gate-0')!.excludeReason).toContain('not identified');
    const opened = await traverse([askGate(FLU_OWED, { on_declined: 'traverse' })], patient([MYSTERY]), declined);
    expect(opened.pendingQuestions).toEqual([]);
    expect(opened.resolutionState.get('step-0')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('on_unresolved "default": no question, the default applies, and the reason still names the entry', async () => {
    const result = await traverse([askGate(FLU_OWED, { on_unresolved: 'default' })], patient([MYSTERY]));
    expect(result.pendingQuestions).toEqual([]);
    expect(result.resolutionState.get('gate-0')!.status).toBe(NodeStatus.GATED_OUT);
    expect(result.resolutionState.get('gate-0')!.excludeReason).toContain('Flublok Quadrivalent 2026');
    expect(result.resolutionState.get('gate-0')!.indeterminate).toBe(true);
  });
});

// ─── grammar, compiler, legacy ────────────────────────────────────────

describe('authoring', () => {
  function withCondition(condition: Record<string, unknown>): PathwayJson {
    const pw = clonePathway();
    pw.nodes.push({ id: 'gate-t', type: 'Gate' as never, properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition } });
    pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as never });
    pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as never });
    return pw;
  }

  it.each([
    ['ingredient includes_code', HAS_FLU],
    ['ingredient not_includes_code', NO_FLU],
    ['ingredient count with a since-horizon', FLU_OWED],
    ['ATC level 4', atc('includes_code', 'J07BB', 'an influenza vaccine')],
    ['ATC level 3', atc('not_includes_code', 'B03A', 'an iron preparation')],
    ['ATC level 2', atc('includes_code', 'J07', 'a vaccine')],
    ['ATC level 1', atc('includes_code', 'J', 'an anti-infective')],
    ['with PREGNANCY', { ...FLU_OWED, horizon: 'PREGNANCY' }],
    ['with window_days', (() => { const { horizon: _h, ...rest } = FLU_OWED; return { ...rest, window_days: 120 }; })()],
  ])('import accepts %s', (_l, condition) => {
    expect(validatePathwayJson(withCondition(condition as Record<string, unknown>)).errors).toEqual([]);
  });

  it.each([
    ['on another field', { ...HAS_FLU, field: 'conditions' }, 'valid only on field "medications"'],
    ['on labs', { field: 'labs', operator: 'includes_code', value: '4511', system: 'RXNORM_INGREDIENT', display: 'x', horizon: 'LIFETIME' }, 'valid only on field "medications"'],
    ['with a threshold operator', { ...HAS_FLU, operator: 'greater_than', threshold: 1 }, 'includes_code / not_includes_code / count_in_window only'],
    ['with exists', { ...HAS_FLU, operator: 'exists' }, 'includes_code / not_includes_code / count_in_window only'],
    ['an ingredient that is not an RxCUI', { ...HAS_FLU, value: 'folic acid' }, 'digits only'],
    ['an ingredient wildcard', { ...HAS_FLU, value: '1657.*' }, 'digits only'],
    ['a level-5 ATC code', atc('includes_code', 'J07BB02', 'x'), 'level 1–4'],
    ['a lower-case ATC code', atc('includes_code', 'j07bb', 'x'), 'level 1–4'],
    ['no display', (() => { const { display: _d, ...rest } = HAS_FLU; return rest; })(), 'needs a "display"'],
    ['a blank display', { ...HAS_FLU, display: '  ' }, 'needs a "display"'],
  ])('import rejects %s', (_l, condition, fragment) => {
    const result = validatePathwayJson(withCondition(condition as Record<string, unknown>));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining(fragment));
  });

  it('product-code conditions are untouched: no display needed, any operator', () => {
    const product = { field: 'medications', operator: 'includes_code', value: '310325', system: 'RXNORM', horizon: 'LIFETIME' };
    expect(isMedicationClassCondition(product)).toBe(false);
    expect(medicationClassConditionError(product)).toBeNull();
    expect(validatePathwayJson(withCondition(product)).errors).toEqual([]);
  });

  it('session preflight and evaluation refuse exactly what import refuses', async () => {
    const bad = atc('includes_code', 'J07BB02', 'x');
    const message = medicationClassConditionError(bad)!;
    const gateNode: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(bad) as unknown as Record<string, unknown> };
    expect(() => sweepableConditions([gateNode], 'v1', new Map())).toThrow(message);
    await expect(evaluate(bad, patient([]))).rejects.toThrow(message);
  });

  it('the compiler accepts it and records no lab or attribute datum; reachability calls membership always-evaluable', () => {
    expect(conditionProblem(HAS_FLU)).toBeNull();
    const datums = new Map<DatumKey, DatumSpec>();
    const errors: CompileError[] = [];
    const codeMap = new Map();
    resolveDatums('g', [HAS_FLU, FLU_OWED], codeMap, buildDatumRegistry(codeMap), datums, errors);
    expect(errors).toEqual([]);
    expect([...datums.values()]).toEqual([]);
    const gate: GraphNode = { id: 'g', nodeIdentifier: 'g', nodeType: 'Gate', properties: gateOf(NO_FLU) as unknown as Record<string, unknown> };
    expect(scoreReachability([gate], patient([]), new Map()).gateExplanations[0].classification).toBe('ALWAYS_EVALUABLE');
  });

  it('legacy-v0 refuses it', async () => {
    for (const condition of [HAS_FLU, NO_FLU, FLU_OWED, atc('includes_code', 'J07BB', 'an influenza vaccine')]) {
      const r = await evaluate(condition, patient([FLUBLOK_THIS_SEASON]), { version: 'legacy-v0' });
      expect(r.satisfied).toBe(false);
      expect(r.reason).toMatch(/^matching a medication by (RXNORM_INGREDIENT|ATC) requires the v1 temporal kernel; legacy-v0 cannot evaluate it$/);
    }
  });
});
