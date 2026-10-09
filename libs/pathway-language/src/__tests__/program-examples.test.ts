/**
 * EXPERIMENTAL, NONCLINICAL. First-program acceptance examples: I1 compile/preview checks, and I2
 * isolated program-expression and preview-output checks. Query results are SUPPLIED from each
 * example's own expectations; no example is evaluated end to end.
 */
import { runProgramExamples } from './support/program-runner';

describe('first-program examples: I1 compile/preview and I2 isolated execution', () => {
  const reports = runProgramExamples();

  it('reports what was and was not checked', () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `examples: ${reports.length}`,
        ...reports.map(
          (r) =>
            `${r.id}: compiler ${r.checked}, isolated program-expression ${r.executionChecked}, preview-output ${r.previewChecked} checks (failures ${r.failures.length}); outside scope: ${r.outOfScope.join('; ') || 'none'}`,
        ),
      ].join('\n'),
    );
    expect(reports.length).toBeGreaterThan(0);
  });

  it.each(reports.map((r) => [r.id, r] as const))('%s: compile, isolated-execution and preview-output expectations hold', (_id, r) => {
    expect(r.failures).toEqual([]);
  });
});
