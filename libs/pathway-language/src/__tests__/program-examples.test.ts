/**
 * EXPERIMENTAL, NONCLINICAL. First-program acceptance examples, compile/preview expectations only.
 * No example is executed: evaluation expectations are reported as outside I1 scope.
 */
import { runProgramExamples } from './support/program-runner';

describe('first-program examples: compile and preview expectations only (I1)', () => {
  const reports = runProgramExamples();

  it('reports what was and was not checked', () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `examples: ${reports.length}`,
        ...reports.map((r) => `${r.id}: ${r.checked - r.failures.length}/${r.checked} compile/preview checks; outside I1 scope: ${r.outOfScope.join('; ') || 'none'}`),
      ].join('\n'),
    );
    expect(reports.length).toBeGreaterThan(0);
  });

  it.each(reports.map((r) => [r.id, r] as const))('%s: compile/preview expectations hold', (_id, r) => {
    expect(r.failures).toEqual([]);
  });
});
