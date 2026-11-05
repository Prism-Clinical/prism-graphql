/**
 * EXPERIMENTAL, NONCLINICAL. First-program acceptance examples: I1 compile/preview checks, I2
 * isolated program-expression and preview-output checks (query results SUPPLIED from each example's
 * own expectations), and raw-input checks of one-query programs (query evidence COMPUTED from the
 * example's records; a bounded I6 slice, not I6 completion), and raw-input preview checks of PPL-04.
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
            `${r.id}: compiler ${r.checked}, isolated program-expression ${r.executionChecked}, preview-output ${r.previewChecked}, raw-input ${r.rawChecked}, raw-input preview ${r.rawPreviewChecked}, partial query-stage ${r.partialStageChecked} checks (failures ${r.failures.length}); outside scope: ${r.outOfScope.join('; ') || 'none'}`,
        ),
      ].join('\n'),
    );
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.filter((r) => r.rawChecked > 0).map((r) => r.id)).toEqual(['PPL-01', 'PPL-02', 'PPL-03']);
    expect(reports.filter((r) => r.rawPreviewChecked > 0 && r.partialStageChecked > 0).map((r) => r.id)).toEqual(['PPL-04']);
  });

  it.each(reports.map((r) => [r.id, r] as const))('%s: compile, isolated-execution, preview-output and raw-input expectations hold', (_id, r) => {
    expect(r.failures).toEqual([]);
  });
});
