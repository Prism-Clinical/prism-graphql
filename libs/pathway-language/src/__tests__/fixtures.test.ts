/**
 * EXPERIMENTAL, NONCLINICAL. S1, S2, same-encounter-, same-episode- and assertionKind-check assertions of
 * the committed explicit-assertion-v0 fixtures. Only those are checked; no fixture is claimed to pass as a whole, because the rest of S3
 * and S4–S7 are not implemented.
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
        `one-way checks: S1 cause attributions ${totals.s1Attribution}; S2 cause attributions ${totals.s2Attribution}; candidateEvidenceIds entries ⊆ S2 InDomain/Unresolved ${totals.s2CandidateIds}; encounter outcomes implied by complete S3 facts (admissibility Admissible/OtherEncounter, S3 encounter attributions) ${totals.encounterOneWay}`,
        `episode-check assertions checked (episodeScope trace facts): ${totals.episode} (passed ${totals.episodePassed})`,
        `episode outcomes implied by complete S3 facts (one-way: admissibility Admissible/OtherEpisode, S3 episode attributions): ${totals.episodeOneWay}`,
        `assertionKind-check assertions checked (assertionKindScope trace facts): ${totals.assertionKind} (passed ${totals.assertionKindPassed})`,
        `combined S3 admissibility assertions checked (admissibility trace facts, contract §2.7): ${totals.admissibility} (passed ${totals.admissibilityPassed})`,
        `assertionKind outcomes implied by complete S3 facts (one-way: admissibility Admissible/AssertionKindNotAllowed, S3 assertionKind attributions): ${totals.assertionKindOneWay}`,
        `expected fields/assertions outside implemented scope (S4–S7; not checked): ${totals.outOfScope}`,
        `fixtures not run: ${notRun.length}: ${notRun.join(', ')}`,
        `evaluation/preview fixtures with no applicable S1–S3 assertion: ${noApplicableAssertions.length}: ${noApplicableAssertions.join(', ')}`,
      ].join('\n'),
    );
    expect(totals.s1).toBeGreaterThan(0);
    expect(totals.s2).toBeGreaterThan(0);
    expect(totals.encounter).toBeGreaterThan(0);
    expect(totals.episode).toBeGreaterThan(0);
    expect(totals.episodeOneWay).toBeGreaterThan(0);
    expect(totals.assertionKind).toBeGreaterThan(0);
    expect(totals.admissibility).toBeGreaterThan(0);
  });

  const checked = (r: (typeof reports)[number]) =>
    r.s1Applicable + r.s1AttributionOneWay + r.s2Applicable + r.s2AttributionOneWay + r.s2CandidateIdsOneWay + r.encounterApplicable + r.encounterOneWay + r.episodeApplicable + r.episodeOneWay + r.assertionKindApplicable + r.assertionKindOneWay + r.admissibilityApplicable > 0;
  it.each(reports.filter((r) => !r.notRun && checked(r)).map((r) => [r.id, r] as const))('%s: S1/S2/S3 assertions hold (not a whole-fixture pass)', (_id, report) => {
    expect(report.failures).toEqual([]);
  });
});
