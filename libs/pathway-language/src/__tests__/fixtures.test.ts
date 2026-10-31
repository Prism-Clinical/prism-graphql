/**
 * EXPERIMENTAL, NONCLINICAL. S1–S4 and S5 criterion assertions of the committed explicit-assertion-v0
 * fixtures: S1, S2, the three S3 rules, combined S3 admissibility (checked directly), S4 selection,
 * per-record criterion values and classification, and key-level possible classes, plus one-way
 * implications from downstream expectations, and the preview criterion, marker and publication
 * expectations of preview fixtures (query-bound preview evaluation), and S6 coverage-cell and gap-relevance
 * facts with two one-way implications. No fixture is claimed to pass as a whole: S6–S7 are not implemented.
 */
import { runFixtures } from './support/fixture-runner';

describe('explicit-assertion-v0 fixtures: S1, S2 and encounter-check assertions only', () => {
  const { reports, noApplicableAssertions } = runFixtures();
  const sum = (f: (r: (typeof reports)[number]) => number) => reports.reduce((t, r) => t + f(r), 0);
  const totals = {
    s1: sum((r) => r.s1Applicable),
    s1Passed: sum((r) => r.s1Passed),
    s1Attribution: sum((r) => r.s1AttributionOneWay),
    s2: sum((r) => r.s2Applicable),
    s2Passed: sum((r) => r.s2Passed),
    s2Attribution: sum((r) => r.s2AttributionOneWay),
    s2CandidateIds: sum((r) => r.s2CandidateIdsOneWay),
    encounter: sum((r) => r.encounterApplicable),
    encounterPassed: sum((r) => r.encounterPassed),
    encounterOneWay: sum((r) => r.encounterOneWay),
    episode: sum((r) => r.episodeApplicable),
    episodePassed: sum((r) => r.episodePassed),
    episodeOneWay: sum((r) => r.episodeOneWay),
    assertionKind: sum((r) => r.assertionKindApplicable),
    assertionKindPassed: sum((r) => r.assertionKindPassed),
    assertionKindOneWay: sum((r) => r.assertionKindOneWay),
    selection: sum((r) => r.selectionApplicable),
    selectionPassed: sum((r) => r.selectionPassed),
    selectionOneWay: sum((r) => r.selectionOneWay),
    criterion: sum((r) => r.criterionApplicable),
    criterionPassed: sum((r) => r.criterionPassed),
    classification: sum((r) => r.classificationApplicable),
    classificationPassed: sum((r) => r.classificationPassed),
    possibleClasses: sum((r) => r.possibleClassesApplicable),
    possibleClassesPassed: sum((r) => r.possibleClassesPassed),
    previewCriterion: sum((r) => r.previewCriterionApplicable),
    previewCriterionPassed: sum((r) => r.previewCriterionPassed),
    preview: sum((r) => r.previewApplicable),
    previewPassed: sum((r) => r.previewPassed),
    coverage: sum((r) => r.coverageApplicable),
    coveragePassed: sum((r) => r.coveragePassed),
    gap: sum((r) => r.gapApplicable),
    gapPassed: sum((r) => r.gapPassed),
    gapOneWay: sum((r) => r.gapOneWay),
    admissibility: sum((r) => r.admissibilityApplicable),
    admissibilityPassed: sum((r) => r.admissibilityPassed),
    outOfScope: sum((r) => r.outOfScope),
  };

  it('reports S1, S2 and encounter-check coverage explicitly', () => {
    const notRun = reports.filter((r) => r.notRun).map((r) => `${r.id} (${r.notRun})`);
    // eslint-disable-next-line no-console
    console.log(
      [
        `fixtures loaded: ${reports.length}`,
        `S1 assertions checked (trace facts + canonicalization): ${totals.s1} (passed ${totals.s1Passed})`,
        `S2 assertions checked (candidacy trace facts): ${totals.s2} (passed ${totals.s2Passed})`,
        `encounter-check assertions checked (encounterScope trace facts): ${totals.encounter} (passed ${totals.encounterPassed})`,
        `one-way checks: S1 cause attributions ${totals.s1Attribution}; S2 cause attributions ${totals.s2Attribution}; candidateEvidenceIds entries ⊆ S2 InDomain/Unresolved ${totals.s2CandidateIds}; encounter outcomes implied by combined S3 facts (admissibility Admissible/OtherEncounter, S3 encounter attributions) ${totals.encounterOneWay}`,
        `episode-check assertions checked (episodeScope trace facts): ${totals.episode} (passed ${totals.episodePassed})`,
        `episode outcomes implied by combined S3 facts (one-way: admissibility Admissible/OtherEpisode, S3 episode attributions): ${totals.episodeOneWay}`,
        `assertionKind-check assertions checked (assertionKindScope trace facts): ${totals.assertionKind} (passed ${totals.assertionKindPassed})`,
        `combined S3 admissibility assertions checked (admissibility trace facts, contract §2.7): ${totals.admissibility} (passed ${totals.admissibilityPassed})`,
        `S4 selection assertions checked (selection and disposition trace facts, contract §2.8): ${totals.selection} (passed ${totals.selectionPassed})`,
        `one-way: Known supportingEvidenceIds entries that must be S4-selected revisions: ${totals.selectionOneWay}`,
        `S5 criterion assertions checked (criterion trace facts of complete queries, contract §3.5): ${totals.criterion} (passed ${totals.criterionPassed})`,
        `S5 per-record classification assertions checked (classification trace facts, contract §3.6): ${totals.classification} (passed ${totals.classificationPassed})`,
        `S5 key-level possibleClasses assertions checked (possibleClasses trace facts, contract §4.2 step B, §3.7; not materiality): ${totals.possibleClasses} (passed ${totals.possibleClassesPassed})`,
        `assertionKind outcomes implied by combined S3 facts (one-way: admissibility Admissible/AssertionKindNotAllowed, S3 assertionKind attributions): ${totals.assertionKindOneWay}`,
        `preview criterion assertions evaluated (criterion trace facts of preview fixtures, query-bound preview evaluation, contract §3.5): ${totals.previewCriterion} (passed ${totals.previewCriterionPassed})`,
        `preview compiler/marker/publication checks (outcome, markers, publication, absent evidence and Needs, stagesRun; not evaluation): ${totals.preview} (passed ${totals.previewPassed})`,
        `S6 coverage-state assertions checked (cell and notCurrent facts, ContradictoryAttestation / InsufficientlyScopedStatement diagnostics; contract §1.5): ${totals.coverage} (passed ${totals.coveragePassed})`,
        `S6 gap-relevance assertions checked (gap facts with provenBy; contract §4.1): ${totals.gap} (passed ${totals.gapPassed})`,
        `one-way: coverage/gap cause attributions that must be relevant gaps with that finding, and Known results that must have no relevant gap: ${totals.gapOneWay}`,
        `expected fields/assertions outside implemented scope (evidence results, base rules, materiality, final cause attribution, Needs, S7; not checked): ${totals.outOfScope}`,
        `fixtures not run: ${notRun.length}: ${notRun.join(', ')}`,
        `evaluation/preview fixtures with no applicable S1–S5 assertion: ${noApplicableAssertions.length}: ${noApplicableAssertions.join(', ')}`,
      ].join('\n'),
    );
    expect(totals.s1).toBeGreaterThan(0);
    expect(totals.s2).toBeGreaterThan(0);
    expect(totals.encounter).toBeGreaterThan(0);
    expect(totals.episode).toBeGreaterThan(0);
    expect(totals.episodeOneWay).toBeGreaterThan(0);
    expect(totals.assertionKind).toBeGreaterThan(0);
    expect(totals.admissibility).toBeGreaterThan(0);
    expect(totals.selection).toBeGreaterThan(0);
    expect(totals.criterion).toBeGreaterThan(0);
    expect(totals.classification).toBeGreaterThan(0);
    expect(totals.possibleClasses).toBeGreaterThan(0);
    expect(totals.previewCriterion).toBeGreaterThan(0);
    expect(totals.preview).toBeGreaterThan(0);
    expect(totals.coverage).toBeGreaterThan(0);
    expect(totals.gap).toBeGreaterThan(0);
  });

  const checked = (r: (typeof reports)[number]) =>
    r.s1Applicable + r.s1AttributionOneWay + r.s2Applicable + r.s2AttributionOneWay + r.s2CandidateIdsOneWay + r.encounterApplicable + r.encounterOneWay + r.episodeApplicable + r.episodeOneWay + r.assertionKindApplicable + r.assertionKindOneWay + r.admissibilityApplicable + r.selectionApplicable + r.selectionOneWay + r.criterionApplicable + r.classificationApplicable + r.possibleClassesApplicable + r.previewCriterionApplicable + r.previewApplicable + r.coverageApplicable + r.gapApplicable + r.gapOneWay > 0;
  it.each(reports.filter((r) => !r.notRun && checked(r)).map((r) => [r.id, r] as const))('%s: S1–S5, preview and S6 gap-relevance assertions hold (not a whole-fixture pass)', (_id, report) => {
    expect(report.failures).toEqual([]);
  });
});
