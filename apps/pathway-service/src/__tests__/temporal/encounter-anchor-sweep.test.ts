import {
  collectEncounterAnchorRequirements,
  SweepableCondition,
} from '../../services/resolution/temporal/cascade';

const vitalsGate: SweepableCondition = { label: 'gate g-bp / condition 0', field: 'vitals' };
const labsGate: SweepableCondition = { label: 'gate g-a1c / condition 0', field: 'labs' };

describe('collectEncounterAnchorRequirements', () => {
  it('finds nothing under legacy-v0 — no field defaults to ENCOUNTER', () => {
    expect(collectEncounterAnchorRequirements([vitalsGate, labsGate], 'legacy-v0', {})).toEqual([]);
  });

  it('flags a vitals condition under v1, where the system default is ENCOUNTER', () => {
    const reqs = collectEncounterAnchorRequirements([vitalsGate, labsGate], 'v1', {});
    expect(reqs).toEqual([
      { label: 'gate g-bp / condition 0', field: 'vitals', level: 'SYSTEM_DEFAULT' },
    ]);
  });

  it('flags an explicitly authored ENCOUNTER horizon even under legacy-v0', () => {
    const reqs = collectEncounterAnchorRequirements(
      [{ ...labsGate, override: { horizon: 'ENCOUNTER' } }],
      'legacy-v0',
      {},
    );
    expect(reqs).toEqual([{ label: 'gate g-a1c / condition 0', field: 'labs', level: 'NODE' }]);
  });

  it('flags a pathway-level ENCOUNTER default', () => {
    const reqs = collectEncounterAnchorRequirements([labsGate], 'legacy-v0', {
      horizons: { labs: 'ENCOUNTER' },
    });
    expect(reqs[0].level).toBe('PATHWAY');
  });

  it('does NOT flag a condition whose node override escapes an ENCOUNTER default', () => {
    const reqs = collectEncounterAnchorRequirements(
      [{ ...vitalsGate, override: { horizon: 'YEAR' } }],
      'v1',
      {},
    );
    expect(reqs).toEqual([]);
  });

  it('reports every offender, not just the first — the author fixes them in one pass', () => {
    const reqs = collectEncounterAnchorRequirements(
      [vitalsGate, { label: 'gate g-hr / condition 1', field: 'vitals' }],
      'v1',
      {},
    );
    expect(reqs).toHaveLength(2);
    expect(reqs.map((r) => r.label)).toEqual([
      'gate g-bp / condition 0',
      'gate g-hr / condition 1',
    ]);
  });

  it('is empty for an empty pathway', () => {
    expect(collectEncounterAnchorRequirements([], 'v1', {})).toEqual([]);
  });

  it('propagates an unknown version rather than reporting "no anchors needed"', () => {
    expect(() => collectEncounterAnchorRequirements([vitalsGate], 'v99', {})).toThrow();
  });

  it('rejects an unknown version even when there is nothing to sweep', () => {
    // Regression: validating inside the loop meant an empty pathway reported
    // "no anchors needed" for a version that does not exist.
    expect(() => collectEncounterAnchorRequirements([], 'v99', {})).toThrow(
      /unknown temporalPolicyVersion/,
    );
  });
});
