import { effectivePolicyFor } from '../../services/resolution/temporal/gate-policy';
import {
  adaptCodedCondition,
  AdaptedCondition,
} from '../../services/resolution/temporal/condition-adapter';
import {
  makeEvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';

const AS_OF = '2026-08-11T00:00:00.000Z';
// Must PRECEDE the clock — makeEvaluationTemporalContext rejects an
// encounterStart after evaluationAsOf, which is correct: an encounter cannot
// begin after the instant you are evaluating as of.
const ANCHOR = '2026-08-10T22:00:00.000Z';

const ctx = makeEvaluationTemporalContext({
  evaluationAsOf: AS_OF,
  temporalPolicyVersion: 'legacy-v0',
});
const v1 = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
const v1WithAnchor = makeEvaluationTemporalContext({
  evaluationAsOf: AS_OF,
  temporalPolicyVersion: 'v1',
  encounterStart: ANCHOR,
});

// The seam takes an AdaptedCondition, never a raw condition (P1-20).
const adaptLab = (extra = {}) =>
  adaptCodedCondition({ field: 'labs', operator: 'greater_than', value: '718-7', ...extra });

describe('effectivePolicyFor', () => {
  it('resolves labs to an unbounded lower bound under legacy-v0', () => {
    const p = effectivePolicyFor(adaptLab(), ctx, {});
    expect(p.horizon.lowerBound).toBeNull();
    expect(p.horizon.upperBound).toBe(AS_OF);
    expect(p.status).toBeUndefined();
  });

  it('applies the legacy-v0 active default to conditions', () => {
    const adapted = adaptCodedCondition({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
    });
    expect(effectivePolicyFor(adapted, ctx, {}).status).toBe('active');
  });

  it('lets a NODE horizon beat the pathway default', () => {
    expect(
      effectivePolicyFor(adaptLab({ horizon: 'QUARTER' }), ctx, { horizons: { labs: 'YEAR' } })
        .horizon.lowerBound,
    ).toBe('2026-05-13T00:00:00.000Z'); // 90 days, not 365
  });

  it('lets a PATHWAY default beat the system default (P1-10)', () => {
    // v1 system default for labs is QUARTER; the pathway says YEAR.
    expect(
      effectivePolicyFor(adaptLab(), v1, { horizons: { labs: 'YEAR' } }).horizon.lowerBound,
    ).toBe('2025-08-11T00:00:00.000Z');
  });

  it('resolves the version from the context, never from an argument', () => {
    // Same adapted condition, same defaults — only the context version differs,
    // and that alone must change the resolved window. If a caller could pass a
    // version, sibling conditions in one traversal could disagree.
    const legacy = effectivePolicyFor(adaptLab(), ctx, {});
    const modern = effectivePolicyFor(adaptLab(), v1, {});
    expect(legacy.horizon.lowerBound).toBeNull(); // LIFETIME
    expect(modern.horizon.lowerBound).toBe('2026-05-13T00:00:00.000Z'); // QUARTER
    expect(effectivePolicyFor).toHaveLength(3); // (adapted, ctx, pathwayDefaults)
  });

  it('propagates MISSING_ENCOUNTER_ANCHOR rather than swallowing it', () => {
    // The sweep turns this into an up-front rejection; catching it here would
    // restore the mid-traversal throw the sweep exists to prevent.
    const adapted: AdaptedCondition = {
      selection: { field: 'vitals', operator: 'greater_than', value: 'systolic_bp' },
    };
    try {
      effectivePolicyFor(adapted, v1, {}); // v1 vitals = ENCOUNTER, no anchor
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
    }
  });

  it('resolves an ADAPTED attribute condition through the same path (P1-20)', () => {
    // A LITERAL AdaptedCondition, not adaptAttributeCondition(...) — that
    // function is Task 7's deliverable. The claim under test is that the seam
    // is keyed on the ADAPTED SHAPE, not on the condition kind, and a literal
    // proves exactly that without coupling to the attribute adapter.
    //
    // Stand-in for `vitals.systolic_bp`. Under v1 the vitals system default is
    // ENCOUNTER — the same tier the anchor sweep computes for it.
    const adapted: AdaptedCondition = {
      selection: { field: 'vitals', operator: 'greater_than', value: 'systolic_bp' },
    };
    expect(effectivePolicyFor(adapted, v1WithAnchor, {}).horizon.lowerBound).toBe(ANCHOR);
  });

  it('carries a NODE status override onto the resolved policy', () => {
    const adapted = adaptCodedCondition({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
      status: 'any',
    });
    expect(effectivePolicyFor(adapted, ctx, {}).status).toBe('any');
  });

  it('rejects a status on an observation field, which has no clinical state', () => {
    const adapted: AdaptedCondition = {
      selection: { field: 'labs', operator: 'greater_than', value: '718-7' },
      override: { status: 'active' },
    };
    expect(() => effectivePolicyFor(adapted, ctx, {})).toThrow(TemporalContextError);
  });
});
