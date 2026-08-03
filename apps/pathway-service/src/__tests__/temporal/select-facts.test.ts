import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { ResolvedHorizon } from '../../services/resolution/temporal/overlap';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };

const lab = (factId: string, d: string, value: number, valid = true): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
  observationStatus: valid ? 'final' : 'entered-in-error',
  interval: { start: { value: d, precision: 'day' }, end: { kind: 'KNOWN', bound: { value: d, precision: 'day' } } },
  recordValidity: valid ? 'VALID' : 'INVALID',
  validityBasis: valid ? 'observation:final' : 'observation:entered-in-error',
  provenance: { sourceType: 'SYNTHETIC' },
});
const cond = (factId: string, code: string, state: 'ACTIVE' | 'CONFLICT'): NormalizedFact => ({
  kind: 'condition', factId, code, system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: state, stateBasis: 'FHIR_STATUS',
});

test('field/kind isolation: a lab fact never satisfies a conditions gate', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: '718-7' }, [lab('a', '2026-05-01', 10)], { horizon: Q, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
});

test('includes_code supports trailing wildcard', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' }, [cond('c1', 'Z94.0', 'ACTIVE')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map((f) => f.factId)).toEqual(['c1']);
});

test('exists ignores value and matches on field/kind', () => {
  const out = selectFacts({ field: 'conditions', operator: 'exists', value: '' }, [cond('c1', 'E11.9', 'ACTIVE')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
});

test('scalar less_than selects the definite-latest valid lab', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-07-01', 12)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') {
    expect(out.selected).toHaveLength(1);
    expect(out.selected[0].factId).toBe('b');
  }
});

test('scalar with two labs on the SAME day is INDETERMINATE (no definite latest)', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-05-01', 12)], { horizon: Q });
  expect(out.status).toBe('INDETERMINATE');
});

test('invalid labs drop; if all candidates invalid → NO_MATCH', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-07-01', 9, false)], { horizon: Q });
  expect(out.status).toBe('NO_MATCH');
});

test('count_in_window counts distinct factIds', () => {
  const out = selectFacts({ field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-06-01', 10)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map((f) => f.factId).sort()).toEqual(['a', 'b']);
});

test('membership admits an undated fact via temporal fail-open (temporallyUnverified)', () => {
  const undated: NormalizedFact = {
    kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
    interval: { start: undefined, end: { kind: 'UNKNOWN' } }, recordValidity: 'VALID', validityBasis: 'verification:absent',
    provenance: { sourceType: 'SYNTHETIC' }, clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
  };
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [undated], { horizon: Q, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') {
    expect(out.selected).toHaveLength(1);
    expect(out.temporallyUnverified).toBe(true);
  }
});

test('CONFLICT state under status:active is excluded despite membership fail-open', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [cond('c1', 'E11.9', 'CONFLICT')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
  expect(out.decisions[0].stateMatch).toBe('NO_MATCH');
});

// ─── Review round 4 ───────────────────────────────────────────────────

const datedCond = (
  factId: string,
  code: string,
  day: string,
  validity: 'VALID' | 'UNKNOWN' = 'VALID',
): NormalizedFact => ({
  kind: 'condition', factId, code, system: 'ICD-10',
  interval: {
    start: { value: day, precision: 'day' },
    end: { kind: 'KNOWN', bound: { value: day, precision: 'day' } },
  },
  recordValidity: validity, validityBasis: 'verification:test',
  provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
});

const labAt = (
  factId: string, instant: string, value: number | undefined,
  validity: 'VALID' | 'UNKNOWN' = 'VALID',
): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
  observationStatus: 'final',
  interval: {
    start: { value: instant, precision: 'instant' },
    end: { kind: 'KNOWN', bound: { value: instant, precision: 'instant' } },
  },
  recordValidity: validity, validityBasis: 'observation:test',
  provenance: { sourceType: 'SYNTHETIC' },
});

describe('P1: count_in_window candidate rules', () => {
  it('counts recurrent CONDITION facts — occurrence counting is not lab-only', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [datedCond('u1', 'N39.0', '2026-05-02'), datedCond('u2', 'N39.0', '2026-06-02')],
      { horizon: Q, status: 'active' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected.map((f) => f.factId).sort()).toEqual(['u1', 'u2']);
    }
  });

  it('counts medications and allergies too', () => {
    const med: NormalizedFact = {
      ...(datedCond('m1', 'RX1', '2026-05-02') as never),
      kind: 'medication_order', factId: 'm1',
    };
    const out = selectFacts(
      { field: 'medications', operator: 'count_in_window', value: 'RX1' },
      [med], { horizon: Q, status: 'active' },
    );
    expect(out.status).toBe('READY');
  });

  it('counts a lab occurrence with no numeric value', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', undefined),
       labAt('b', '2026-06-01T00:00:00.000Z', undefined)],
      { horizon: Q },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') expect(out.selected).toHaveLength(2);
  });

  it('supports the trailing wildcard, matching the current evaluator', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.*', system: 'ICD-10' },
      [datedCond('u1', 'N39.0', '2026-05-02'), datedCond('u2', 'N39.1', '2026-06-02')],
      { horizon: Q, status: 'active' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') expect(out.selected).toHaveLength(2);
  });

  it('still requires a finite numeric value for trend/delta', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'trend_up', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', undefined)],
      { horizon: Q },
    );
    expect(out.status).toBe('NO_MATCH');
  });

  it('keeps scalar code matching EXACT — no wildcard', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-*', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', 10)],
      { horizon: Q },
    );
    expect(out.status).toBe('NO_MATCH');
  });
});

describe('P1: equal exact timestamps must not select by input order', () => {
  const t = '2026-05-01T08:00:00.000Z';

  it('two labs at the identical instant are AMBIGUOUS_LATEST, either way round', () => {
    const forward = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' },
      [labAt('a', t, 10), labAt('b', t, 12)], { horizon: Q },
    );
    const reversed = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' },
      [labAt('b', t, 12), labAt('a', t, 10)], { horizon: Q },
    );
    expect(forward.status).toBe('INDETERMINATE');
    expect(reversed.status).toBe('INDETERMINATE');
    if (forward.status === 'INDETERMINATE') {
      expect(forward.reasons).toContain('AMBIGUOUS_LATEST');
    }
  });

  it('still picks a strictly later fact', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T08:00:00.000Z', 10), labAt('b', '2026-05-01T09:00:00.000Z', 12)],
      { horizon: Q },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') expect(out.selected[0].factId).toBe('b');
  });
});

describe('P1: aggregate uncertainty is not silently discarded', () => {
  it('an uncertain-validity fact is excluded fail-closed and flagged, not dropped silently', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', 9, 'UNKNOWN')],
      { horizon: Q },
    );
    // Fail-closed per design §13 (aggregate excludes on UNKNOWN), but the
    // uncertainty must survive into the outcome for evidence.
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected).toHaveLength(0);
      expect(out.validityUnverified).toBe(true);
    }
    expect(out.decisions[0].operatorDecision).toBe('EXCLUDE');
    expect(out.decisions[0].uncertainty).toContain('VALIDITY_UNKNOWN');
  });
});

describe('P1: trend/delta series ordering must be a proven total order', () => {
  const monthFact = (factId: string, month: string, value: number): NormalizedFact => ({
    kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
    observationStatus: 'final',
    interval: {
      start: { value: month, precision: 'month' },
      end: { kind: 'KNOWN', bound: { value: month, precision: 'month' } },
    },
    recordValidity: 'VALID', validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
  });

  it('two facts in the same month cannot be ordered → AMBIGUOUS_SERIES_ORDER', () => {
    const forward = selectFacts(
      { field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC' },
      [monthFact('a', '2026-05', 10), monthFact('b', '2026-05', 12)], { horizon: Q },
    );
    expect(forward.status).toBe('INDETERMINATE');
    if (forward.status === 'INDETERMINATE') {
      expect(forward.reasons).toContain('AMBIGUOUS_SERIES_ORDER');
    }
  });

  it('non-overlapping months order deterministically regardless of input order', () => {
    const forward = selectFacts(
      { field: 'labs', operator: 'trend_up', value: '718-7', system: 'LOINC' },
      [monthFact('a', '2026-05', 10), monthFact('b', '2026-06', 12)], { horizon: Q },
    );
    const reversed = selectFacts(
      { field: 'labs', operator: 'trend_up', value: '718-7', system: 'LOINC' },
      [monthFact('b', '2026-06', 12), monthFact('a', '2026-05', 10)], { horizon: Q },
    );
    expect(forward.status).toBe('READY');
    expect(reversed.status).toBe('READY');
    if (forward.status === 'READY' && reversed.status === 'READY') {
      expect(forward.selected.map((f) => f.factId)).toEqual(['a', 'b']);
      expect(reversed.selected.map((f) => f.factId)).toEqual(['a', 'b']);
    }
  });
});

describe('P2: exists is kind-only', () => {
  it('a system filter does not defeat exists', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'exists', value: '', system: 'SNOMED' },
      [cond('c1', 'E11.9', 'ACTIVE')],
      { horizon: LIFE, status: 'active' },
    );
    expect(out.status).toBe('READY');
  });
});

describe('P2: indeterminate reasons are derived from the decisions', () => {
  it('a validity-uncertain scalar reports VALIDITY_UNKNOWN, not TEMPORAL_UNKNOWN', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', 9, 'UNKNOWN')],
      { horizon: Q },
    );
    expect(out.status).toBe('INDETERMINATE');
    if (out.status === 'INDETERMINATE') {
      expect(out.reasons).toContain('VALIDITY_UNKNOWN');
      expect(out.reasons).not.toContain('TEMPORAL_UNKNOWN');
    }
  });

  it('reasons are deduplicated across many facts', () => {
    const out = selectFacts(
      { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' },
      [labAt('a', '2026-05-01T00:00:00.000Z', 9, 'UNKNOWN'),
       labAt('b', '2026-05-02T00:00:00.000Z', 8, 'UNKNOWN')],
      { horizon: Q },
    );
    if (out.status === 'INDETERMINATE') {
      expect(out.reasons).toEqual(['VALIDITY_UNKNOWN']);
    }
  });
});

// ─── review round 5 ───────────────────────────────────────────────────

/** A condition whose interval sits unambiguously inside Q, so only state varies. */
const statedCond = (
  factId: string,
  state: 'ACTIVE' | 'INACTIVE' | 'ON_HOLD' | 'UNKNOWN' | 'CONFLICT',
): NormalizedFact => ({
  kind: 'condition', factId, code: 'N39.0', system: 'ICD-10',
  interval: {
    start: { value: '2026-05-01', precision: 'day' },
    end: { kind: 'KNOWN', bound: { value: '2026-05-02', precision: 'day' } },
  },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed',
  provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: state, stateBasis: 'FHIR_STATUS',
});

describe('P1: status "any" bypasses state filtering entirely (RFC §3)', () => {
  it('count_in_window with status any counts an UNKNOWN-state condition', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'UNKNOWN')],
      { horizon: Q, status: 'any' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected.map((f) => f.factId)).toEqual(['c1']);
      // Bypassed-but-uncertain state is still surfaced as evidence.
      expect(out.stateUnverified).toBe(true);
    }
  });

  it('count_in_window with status any counts a CONFLICT-state condition', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'CONFLICT'), statedCond('c2', 'ACTIVE')],
      { horizon: Q, status: 'any' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected.map((f) => f.factId).sort()).toEqual(['c1', 'c2']);
      expect(out.stateUnverified).toBe(true);
    }
  });

  it('an all-definite status-any aggregate reports stateUnverified false', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'ACTIVE'), statedCond('c2', 'INACTIVE')],
      { horizon: Q, status: 'any' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected).toHaveLength(2);
      expect(out.stateUnverified).toBe(false);
    }
  });

  it('membership with status any admits every state without uncertainty', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'includes_code', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'UNKNOWN')],
      { horizon: Q, status: 'any' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      const d = out.decisions.find((x) => x.fact.factId === 'c1');
      expect(d?.stateMatch).toBe('MATCH');
      expect(d?.uncertainty).not.toContain('STATE_UNKNOWN');
    }
  });

  it('status active still EXCLUDES a CONFLICT state (fail-open must not resolve a conflict)', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'CONFLICT')],
      { horizon: Q, status: 'active' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') expect(out.selected).toHaveLength(0);
  });

  it('status active still treats an UNKNOWN state as uncertain', () => {
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'N39.0', system: 'ICD-10' },
      [statedCond('c1', 'UNKNOWN')],
      { horizon: Q, status: 'active' },
    );
    expect(out.status).toBe('READY');
    if (out.status === 'READY') {
      expect(out.selected).toHaveLength(0);
      expect(out.stateUnverified).toBe(true);
      const d = out.decisions.find((x) => x.fact.factId === 'c1');
      expect(d?.uncertainty).toContain('STATE_UNKNOWN');
    }
  });
});
