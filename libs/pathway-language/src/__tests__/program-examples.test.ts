/**
 * EXPERIMENTAL, NONCLINICAL. First-program acceptance examples: I1 compile/preview checks, I2
 * isolated program-expression and preview-output checks (query results SUPPLIED from each example's
 * own expectations), and raw-input checks of one-query programs (query evidence COMPUTED from the
 * example's records; a bounded I6 slice, not I6 completion), raw-input preview checks of PPL-04 (holed
 * query), complete-query preview checks of PPL-06a–c (complete query beside an unrelated hole), and
 * multi-query raw-input checks of PPL-07a–d (two complete queries over one shared snapshot), and
 * multi-query raw-input preview checks of PPL-08a–c (complete and holed queries over one captured input).
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
            `${r.id}: compiler ${r.checked}, isolated program-expression ${r.executionChecked}, preview-output ${r.previewChecked}, raw-input ${r.rawChecked}, raw-input preview ${r.rawPreviewChecked}, partial query-stage ${r.partialStageChecked}, complete-query preview ${r.completePreviewChecked}, multi-query raw-input ${r.multiRawChecked}, multi-query preview ${r.multiPreviewChecked} checks (failures ${r.failures.length}); outside scope: ${r.outOfScope.join('; ') || 'none'}`,
        ),
      ].join('\n'),
    );
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.filter((r) => r.rawChecked > 0).map((r) => r.id)).toEqual(['PPL-01', 'PPL-02', 'PPL-03']);
    expect(reports.filter((r) => r.rawPreviewChecked > 0 && r.partialStageChecked > 0).map((r) => r.id)).toEqual(['PPL-04']);
    expect(reports.filter((r) => r.completePreviewChecked > 0).map((r) => r.id)).toEqual(['PPL-06a', 'PPL-06b', 'PPL-06c']);
    expect(reports.filter((r) => r.multiRawChecked > 0).map((r) => r.id)).toEqual(['PPL-07a', 'PPL-07b', 'PPL-07c', 'PPL-07d']);
    expect(reports.filter((r) => r.multiPreviewChecked > 0).map((r) => r.id)).toEqual(['PPL-08a', 'PPL-08b', 'PPL-08c']);
  });

  it.each(reports.map((r) => [r.id, r] as const))('%s: compile, isolated-execution, preview-output and raw-input expectations hold', (_id, r) => {
    expect(r.failures).toEqual([]);
  });
});
