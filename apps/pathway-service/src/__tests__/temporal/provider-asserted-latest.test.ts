/**
 * A provider's answer to "what is the haemoglobin?" must be able to settle the
 * question it was asked.
 *
 * With several UNDATED values for one lab code, a scalar gate cannot tell
 * which is latest and fails closed as AMBIGUOUS_LATEST, which escalates to the
 * provider. The provider's answer was injected undated too — one more value
 * that cannot be ordered — so the gate asked again, forever.
 *
 * The answer is now dated at the session's evaluation instant and marked
 * PROVIDER_ASSERTED, and a dated provider assertion is ordered against the
 * DATED candidates only. What does NOT change, deliberately: several undated
 * values with no provider assertion stay AMBIGUOUS_LATEST, and one dated chart
 * value beside undated ones stays ambiguous too. Whether an undated value
 * should ever be ordered is a product decision, not this fix.
 */

import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { ResolvedHorizon } from '../../services/resolution/temporal/overlap';

const ASOF = '2026-07-26T00:00:00.000Z';
const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: ASOF };
const HB = { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' } as const;

const undated = (factId: string, value: number): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value,
  interval: { start: undefined, end: { kind: 'OPEN', assertedCurrentAt: ASOF } },
  recordValidity: 'VALID', validityBasis: 'SYNTHETIC_DEFAULT', provenance: { sourceType: 'SYNTHETIC' },
});
const dated = (
  factId: string, at: string, value: number,
  sourceType: 'SYNTHETIC' | 'PROVIDER_ASSERTED' = 'SYNTHETIC',
): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value,
  interval: {
    start: { value: at, precision: 'instant' },
    end: { kind: 'KNOWN', bound: { value: at, precision: 'instant' } },
  },
  recordValidity: 'VALID', validityBasis: 'SYNTHETIC_DEFAULT', provenance: { sourceType },
});

const selectedIds = (out: ReturnType<typeof selectFacts>) =>
  out.status === 'READY' ? out.selected.map(f => f.factId) : out.status;

describe('scalar latest-value selection with a provider assertion', () => {
  it('UNCHANGED: several undated values with no assertion are AMBIGUOUS_LATEST', () => {
    const out = selectFacts(HB, [undated('a', 9), undated('b', 12)], { horizon: Q });
    expect(out.status).toBe('INDETERMINATE');
    if (out.status === 'INDETERMINATE') expect(out.reasons).toContain('AMBIGUOUS_LATEST');
  });

  it('UNCHANGED: a dated CHART value beside undated ones is still ambiguous', () => {
    const out = selectFacts(HB, [undated('a', 9), dated('c', '2026-07-01T00:00:00.000Z', 12)], { horizon: Q });
    expect(out.status).toBe('INDETERMINATE');
  });

  it('a dated provider assertion wins over undated values', () => {
    const out = selectFacts(
      HB,
      [undated('a', 9), undated('b', 12), dated('p', ASOF, 10.5, 'PROVIDER_ASSERTED')],
      { horizon: Q },
    );
    expect(selectedIds(out)).toEqual(['p']);
  });

  it('but not over a dated chart value that is LATER than it', () => {
    const out = selectFacts(
      HB,
      [
        undated('a', 9),
        dated('p', '2026-07-01T00:00:00.000Z', 10.5, 'PROVIDER_ASSERTED'),
        dated('c', '2026-07-20T00:00:00.000Z', 12),
      ],
      { horizon: Q },
    );
    expect(selectedIds(out)).toEqual(['c']);
  });
});
