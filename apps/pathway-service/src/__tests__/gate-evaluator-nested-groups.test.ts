/**
 * Nested condition groups in compound gates — the evaluator.
 *
 * A compound's `conditions` may hold `{ operator, conditions }` groups (the
 * gate's own shape). A group folds into an ordinary condition outcome by the
 * SAME truth table the flat gate uses, so these proofs are stated against an
 * independent reference model of that table:
 *
 *   - a definite false settles an AND, a definite true settles an OR;
 *   - otherwise an unresolved child leaves the list unresolved, and the flavour
 *     of "unresolved" (indeterminate / dataUnavailable / NOT YET DUE) is the
 *     union of the unresolved children's flavours;
 *   - a settled list contributes no askable leaf, at any depth.
 *
 * Five leaf kinds, all real kernel evaluations over one fact store:
 *   T  definite true              (membership match)
 *   F  definite false             (membership miss)
 *   U  dataUnavailable            (scalar lab, no value on file)
 *   I  indeterminate              (scalar lab on an unverified record)
 *   N  NOT YET DUE                (anchored delta, 5 days into a 14-day wait)
 */

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
  ConditionEntry,
  conditionLeaves,
  conditionLeavesWithPath,
  gateConditionLeaves,
  isConditionGroup,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import type { NormalizedFact } from '../services/resolution/temporal/fact-model';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const INSIDE_QUARTER = '2026-07-01';
const ROLE = 'oral-iron-repletion';

function conditionFact(factId: string, code: string): NormalizedFact {
  return {
    kind: 'condition',
    factId,
    code,
    system: 'ICD-10',
    interval: {
      start: { value: '2020', precision: 'year' },
      end: { kind: 'OPEN', assertedCurrentAt: AS_OF },
    },
    recordValidity: 'VALID',
    validityBasis: 'verification:confirmed',
    provenance: { sourceType: 'SYNTHETIC' },
    clinicalState: 'ACTIVE',
    stateBasis: 'FHIR_STATUS',
  } as NormalizedFact;
}

function labFact(factId: string, code: string, day: string, value: number, extra: object = {}): NormalizedFact {
  return {
    kind: 'lab',
    factId,
    code,
    system: 'LOINC',
    value,
    unit: 'g/dL',
    observationStatus: 'final',
    interval: {
      start: { value: day, precision: 'day' },
      end: { kind: 'KNOWN', bound: { value: day, precision: 'day' } },
    },
    recordValidity: 'VALID',
    validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
    ...extra,
  } as NormalizedFact;
}

const STORE: NormalizedFact[] = [
  conditionFact('f-dm', 'E11.9'),
  labFact('f-a1c', '4548-4', INSIDE_QUARTER, 9, {
    recordValidity: 'UNKNOWN',
    validityBasis: 'observation:preliminary',
  }),
];

type Kind = 'T' | 'F' | 'U' | 'I' | 'N';
const KINDS: Kind[] = ['T', 'F', 'U', 'I', 'N'];

const LEAF: Record<Kind, GateCondition> = {
  T: { field: 'conditions', operator: 'includes_code', value: 'E11.9' },
  F: { field: 'conditions', operator: 'includes_code', value: 'Z99.9' },
  U: { field: 'labs', operator: 'less_than', value: '30313-1', system: 'LOINC', threshold: 11 },
  I: { field: 'labs', operator: 'greater_than', value: '4548-4', system: 'LOINC', threshold: 7 },
  N: {
    field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC',
    delta_threshold: 1, delta_comparison: 'at_least', min_points: 2,
    window_from: { event: 'medication_start', clinical_role: ROLE, min_days_since_anchor: 14 },
  },
};

/** A FRESH leaf object: unresolved leaves are reported by identity. */
const leaf = (k: Kind): GateCondition => ({ ...LEAF[k] });

function deps(version = 'v1'): GateEvaluationDeps {
  // Oral iron started 5 days before the clock (care plan), due on day 14.
  const temporalContext = withTherapyStarts(
    makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version }),
    [{
      clinicalRole: ROLE,
      date: '2026-08-06',
      source: { carePlanId: 'cp', interventionId: 'i', pathwayId: 'pw', nodeId: 'med-1' },
    }],
  );
  return {
    temporalContext,
    pathwayDefaults: {},
    factStore: version === 'v1' ? STORE : [],
    codeMap: new Map(),
    patientContext: {
      patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [],
    } as PatientContext,
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
  };
}

function compound(op: 'AND' | 'OR', conditions: ConditionEntry[]): GateProperties {
  return {
    title: 'nested', gate_type: GateType.COMPOUND, default_behavior: DefaultBehavior.SKIP,
    operator: op, conditions,
  };
}
const group = (operator: 'AND' | 'OR', conditions: ConditionEntry[]): ConditionEntry =>
  ({ operator, conditions });

// ─── The reference model ──────────────────────────────────────────────

interface Ref {
  v: 'T' | 'F' | 'U';
  du: boolean;
  ind: boolean;
  nyd: boolean;
  /** Unresolved leaves that could still change this value. */
  leaves: GateCondition[];
}

type Tree = { kind: Kind; obj: GateCondition } | { op: 'AND' | 'OR'; children: Tree[] };

function refOf(t: Tree): Ref {
  if ('kind' in t) {
    switch (t.kind) {
      case 'T': return { v: 'T', du: false, ind: false, nyd: false, leaves: [] };
      case 'F': return { v: 'F', du: false, ind: false, nyd: false, leaves: [] };
      case 'U': return { v: 'U', du: true, ind: false, nyd: false, leaves: [t.obj] };
      case 'I': return { v: 'U', du: false, ind: true, nyd: false, leaves: [t.obj] };
      case 'N': return { v: 'U', du: false, ind: true, nyd: true, leaves: [t.obj] };
    }
  }
  const kids = t.children.map(refOf);
  const settler = t.op === 'AND' ? 'F' : 'T';
  const neutral = t.op === 'AND' ? 'T' : 'F';
  if (kids.some((k) => k.v === settler)) return { v: settler, du: false, ind: false, nyd: false, leaves: [] };
  if (kids.every((k) => k.v === neutral)) return { v: neutral, du: false, ind: false, nyd: false, leaves: [] };
  return {
    v: 'U',
    du: kids.some((k) => k.du),
    ind: kids.some((k) => k.ind),
    nyd: kids.some((k) => k.nyd),
    leaves: kids.flatMap((k) => k.leaves),
  };
}

function entryOf(t: Tree): ConditionEntry {
  return 'kind' in t ? t.obj : group(t.op, t.children.map(entryOf));
}

async function assertMatchesModel(op: 'AND' | 'OR', children: Tree[]): Promise<void> {
  const root: Tree = { op, children };
  const ref = refOf(root);
  const r = await evaluateGate(compound(op, children.map(entryOf)), deps());
  const label = JSON.stringify(root, (k, v) => (k === 'obj' ? undefined : v));
  const got = {
    satisfied: r.satisfied,
    indeterminate: r.indeterminate === true,
    dataUnavailable: r.dataUnavailable === true,
    notYetDue: r.notYetDue !== undefined,
    unresolved: r.unresolvedConditions ?? [],
  };
  const want = {
    satisfied: ref.v === 'T',
    indeterminate: ref.v === 'U' && ref.ind,
    dataUnavailable: ref.v === 'U' && ref.du,
    notYetDue: ref.v === 'U' && ref.nyd,
    unresolved: ref.v === 'U' ? ref.leaves : [],
  };
  expect({ label, ...got, unresolved: got.unresolved.length }).toEqual({
    label, ...want, unresolved: want.unresolved.length,
  });
  // BY IDENTITY: the traversal matches anchors / series back to these.
  got.unresolved.forEach((c, i) => expect(c).toBe(want.unresolved[i]));
  if (want.notYetDue) {
    expect(r.reason).toMatch(/^NOT_YET_DUE: due on\/after 2026-08-20/);
    expect(r.notYetDue).toEqual({ dueOn: '2026-08-20' });
  }
}

const triples: Array<[Kind, Kind, Kind]> = KINDS.flatMap((a) =>
  KINDS.flatMap((b) => KINDS.map((c) => [a, b, c] as [Kind, Kind, Kind])),
);
const L = (k: Kind): Tree => ({ kind: k, obj: leaf(k) });

// ─── Truth tables ─────────────────────────────────────────────────────

describe('truth table: AND inside OR — OR(x, AND(y, z))', () => {
  it.each(triples)('x=%s y=%s z=%s', async (x, y, z) => {
    await assertMatchesModel('OR', [L(x), { op: 'AND', children: [L(y), L(z)] }]);
  });
});

describe('truth table: OR inside AND — AND(x, OR(y, z))', () => {
  it.each(triples)('x=%s y=%s z=%s', async (x, y, z) => {
    await assertMatchesModel('AND', [L(x), { op: 'OR', children: [L(y), L(z)] }]);
  });
});

describe('deeper shapes against the same model', () => {
  // Every level up to MAX_CONDITION_NESTING (4, counting the gate).
  const shapes: Array<[string, (k: Kind[]) => Tree[]]> = [
    ['OR(AND(a, OR(b, AND(c, d))))', (k) => [
      { op: 'AND', children: [L(k[0]), { op: 'OR', children: [L(k[1]), { op: 'AND', children: [L(k[2]), L(k[3])] }] }] },
    ]],
    ['AND(OR(a, b), OR(c, d))', (k) => [
      { op: 'OR', children: [L(k[0]), L(k[1])] },
      { op: 'OR', children: [L(k[2]), L(k[3])] },
    ]],
  ];
  const quads = KINDS.flatMap((a) => KINDS.flatMap((b) => KINDS.flatMap((c) => KINDS.map((d) => [a, b, c, d]))));
  for (const [name, build] of shapes) {
    it(`${name} — all ${quads.length} leaf assignments`, async () => {
      const rootOp = name.startsWith('OR') ? 'OR' : 'AND';
      for (const q of quads) await assertMatchesModel(rootOp, build(q as Kind[]));
    });
  }
});

// ─── Specific consequences ────────────────────────────────────────────

describe('what a nested group reports upward', () => {
  it('a settled sibling group asks for nothing inside it', async () => {
    // OR(missing, AND(false, missing')) — the AND settled false on its own, so
    // `missing'` cannot change anything; only the top-level missing is asked.
    const topMissing = leaf('U');
    const buried = leaf('U');
    const r = await evaluateGate(
      compound('OR', [topMissing, group('AND', [leaf('F'), buried])]), deps(),
    );
    expect(r.dataUnavailable).toBe(true);
    expect(r.unresolvedConditions).toHaveLength(1);
    expect(r.unresolvedConditions![0]).toBe(topMissing);
  });

  it('NOT YET DUE inside a group outranks a missing datum elsewhere, and never dominates', async () => {
    const missing = leaf('U');
    const r = await evaluateGate(compound('AND', [missing, group('OR', [leaf('N'), leaf('F')])]), deps());
    expect(r.satisfied).toBe(false);
    expect(r.notYetDue).toEqual({ dueOn: '2026-08-20' });
    expect(r.reason).toMatch(/^NOT_YET_DUE: due on\/after 2026-08-20 — due on\/after 2026-08-20/);
    // A definite false settles the AND whatever the nested NOT YET DUE says.
    const settled = await evaluateGate(compound('AND', [leaf('F'), group('OR', [leaf('N'), leaf('F')])]), deps());
    expect(settled.notYetDue).toBeUndefined();
    expect(settled.indeterminate).toBe(false);
  });

  it('fieldsRead, uncertainty, windowAnchors and the reason reach the nested leaves', async () => {
    const r = await evaluateGate(
      compound('AND', [leaf('T'), group('OR', [leaf('I'), group('AND', [leaf('T'), leaf('N')])])]),
      deps(),
    );
    // The anchored leaf two levels down reads the medications and its anchor key.
    expect(r.contextFieldsRead).toEqual([
      'conditions', 'labs', 'medications', `anchor:medication_start:${ROLE}`,
    ]);
    expect(r.uncertainty).toEqual(expect.arrayContaining(['NOT_YET_DUE']));
    expect(r.windowAnchors).toEqual([
      expect.objectContaining({ key: `anchor:medication_start:${ROLE}`, source: 'CARE_PLAN', date: '2026-08-06' }),
    ]);
    // Not due, so the reason is the NOT_YET_DUE one, naming the nested leaf.
    expect(r.reason).toMatch(/NOT_YET_DUE.*delta_from_baseline for labs:718-7/);

    const plain = await evaluateGate(
      compound('AND', [leaf('T'), group('OR', [leaf('F'), group('AND', [leaf('T'), leaf('T')])])]),
      deps(),
    );
    expect(plain.satisfied).toBe(true);
    expect(plain.reason).toBe('All compound conditions satisfied');
    const failed = await evaluateGate(compound('AND', [leaf('T'), group('OR', [leaf('F'), leaf('F')])]), deps());
    expect(failed.reason).toMatch(/^Unsatisfied conditions: none of \(.*Z99\.9.*; .*Z99\.9.*\)$/);
    const orOk = await evaluateGate(compound('OR', [leaf('F'), group('AND', [leaf('T'), leaf('T')])]), deps());
    expect(orOk.reason).toMatch(/^Satisfied conditions: all of \(.*E11\.9.*; .*E11\.9.*\)$/);
  });

  it('group operators are case-insensitive, like the gate\'s', async () => {
    const r = await evaluateGate(
      compound('AND', [{ operator: 'or', conditions: [leaf('F'), leaf('T')] } as unknown as ConditionEntry]),
      deps(),
    );
    expect(r.satisfied).toBe(true);
  });

  it('an empty group (refused at import) fails closed as a definite false', async () => {
    const r = await evaluateGate(compound('OR', [group('AND', []), leaf('F')]), deps());
    expect(r.satisfied).toBe(false);
    const r2 = await evaluateGate(compound('OR', [group('AND', []), leaf('T')]), deps());
    expect(r2.satisfied).toBe(true);
  });
});

describe('legacy-v0 composes nested groups as plain booleans', () => {
  const patientCodes = {
    patientId: 'p',
    conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }],
    medications: [], labResults: [], allergies: [],
  } as unknown as PatientContext;
  const legacy = (): GateEvaluationDeps => ({ ...deps('legacy-v0'), patientContext: patientCodes });

  it('evaluates, and adds none of the v1 keys (locked decision #2)', async () => {
    const r = await evaluateGate(
      compound('OR', [leaf('F'), group('AND', [leaf('T'), leaf('T')])]),
      legacy(),
    );
    expect(r).toEqual({
      satisfied: true,
      reason: expect.stringMatching(/^Satisfied conditions: all of \(/),
      contextFieldsRead: ['conditions'],
      dependedOnNodes: [],
    });
    const miss = await evaluateGate(compound('AND', [leaf('T'), group('OR', [leaf('F'), leaf('F')])]), legacy());
    expect(miss).toEqual({
      satisfied: false,
      reason: expect.stringMatching(/^Unsatisfied conditions: none of \(/),
      contextFieldsRead: ['conditions'],
      dependedOnNodes: [],
    });
  });
});

describe('leaf helpers', () => {
  const a = leaf('T');
  const b = leaf('F');
  const c = leaf('U');
  const list: ConditionEntry[] = [a, group('OR', [b, group('AND', [c])])];

  it('flatten depth first, by reference', () => {
    const leaves = conditionLeaves(list);
    expect(leaves).toHaveLength(3);
    expect(leaves[0]).toBe(a);
    expect(leaves[1]).toBe(b);
    expect(leaves[2]).toBe(c);
    expect(conditionLeavesWithPath(list).map((l) => l.path)).toEqual(['0', '1.0', '1.1.0']);
    expect(gateConditionLeaves({ condition: a })).toEqual([a]);
    expect(gateConditionLeaves({ conditions: list })).toHaveLength(3);
    expect(conditionLeaves(undefined)).toEqual([]);
  });

  it('a group is exactly an object with a `conditions` array', () => {
    expect(isConditionGroup(list[1])).toBe(true);
    expect(isConditionGroup(a)).toBe(false);
    expect(isConditionGroup(null)).toBe(false);
    expect(isConditionGroup([a])).toBe(false);
  });
});
