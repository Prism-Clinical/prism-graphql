/**
 * EXPERIMENTAL, NONCLINICAL. S1 assertions of the committed explicit-assertion-v0 fixtures.
 * Only S1 assertions are checked; no fixture is claimed to pass as a whole.
 */
import { runS1Fixtures } from './support/s1-fixture-runner';

describe('explicit-assertion-v0 fixtures: S1 assertions only', () => {
  const { reports, missingS1Expectations } = runS1Fixtures();
  const totals = reports.reduce(
    (t, r) => ({
      applicable: t.applicable + r.s1Applicable,
      passed: t.passed + r.s1Passed,
      attribution: t.attribution + r.s1AttributionOneWay,
      outOfScope: t.outOfScope + r.outOfScope,
      failures: t.failures + r.failures.length,
    }),
    { applicable: 0, passed: 0, attribution: 0, outOfScope: 0, failures: 0 },
  );

  it('reports S1 coverage explicitly', () => {
    const notRun = reports.filter((r) => r.notRun).map((r) => `${r.id} (${r.notRun})`);
    // eslint-disable-next-line no-console
    console.log(
      [
        `fixtures loaded: ${reports.length}`,
        `S1 assertions checked (trace facts + canonicalization): ${totals.applicable} (passed ${totals.passed})`,
        `S1 cause attributions checked one-way: ${totals.attribution}`,
        `out-of-S1-scope expected fields/assertions (not checked): ${totals.outOfScope}`,
        `fixtures not run by S1: ${notRun.length}: ${notRun.join(', ')}`,
        `evaluation/preview fixtures with no S1 expectation: ${missingS1Expectations.length}: ${missingS1Expectations.join(', ')}`,
      ].join('\n'),
    );
    expect(totals.applicable).toBeGreaterThan(0);
  });

  it.each(reports.filter((r) => !r.notRun && r.s1Applicable + r.s1AttributionOneWay > 0).map((r) => [r.id, r] as const))(
    '%s: S1 assertions hold',
    (_id, report) => {
      expect(report.failures).toEqual([]);
    },
  );
});
