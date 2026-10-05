/**
 * `runAssumptions` — where a run's plan rests on something less than a fresh,
 * measured chart value. A pure reading of what the run stores; the gate
 * shapes below are the ones the anemia pathway stores in `resolution_state`.
 */

import { runAssumptions } from '../services/resolution/assumptions';
import type { AssumptionChild, AssumptionRun } from '../services/resolution/assumptions';

const HGB = { field: 'labs', value: '718-7', system: 'LOINC', display: 'Hemoglobin (g/dL)' };

function gate(
  id: string,
  status: string,
  props: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return { [id]: { nodeId: id, nodeType: 'Gate', title: `title of ${id}`, status, properties: props, ...extra } };
}

const severe = (status = 'GATED_OUT') =>
  gate('gate-severe', status, { condition: { ...HGB, horizon: 'LIFETIME', operator: 'less_than', threshold: 6 } });

function child(state: Record<string, unknown>, gateAnswers: AssumptionChild['gateAnswers'] = {}): AssumptionChild {
  return { sessionId: 's1', pathwayId: 'p1', gateAnswers, resolutionState: state as AssumptionChild['resolutionState'] };
}

const run = (c: AssumptionChild, initial: object = {}, additional: object = {}): AssumptionRun => ({
  initialContext: initial, additionalContext: additional, children: [c],
});

describe('runAssumptions', () => {
  it('finds nothing on a measured, current chart', () => {
    const out = runAssumptions(run(child(severe()), { labResults: [{ code: '718-7', system: 'LOINC', value: 10.4, date: '2026-10-01' }] }));
    expect(out).toEqual([]);
  });

  describe('an estimated value', () => {
    const chart = { labResults: [{ code: '4544-3', system: 'LOINC', value: 30, unit: '%', date: '2026-09-29' }] };

    it('is one assumption, naming every gate that read the lab — passed or closed', () => {
      const state = {
        ...severe(),
        ...gate('gate-referral', 'INCLUDED', {
          operator: 'OR',
          conditions: [
            { ...HGB, operator: 'less_than', threshold: 11 },
            { field: 'labs', value: '4544-3', system: 'LOINC', operator: 'less_than', threshold: 33 },
          ],
        }),
      };
      const out = runAssumptions(run(child(state), chart));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        kind: 'ESTIMATED_VALUE',
        key: 'p1|ESTIMATED_VALUE|LOINC:718-7',
        gateIds: ['gate-referral', 'gate-severe'],
        supply: 'CHART',
      });
      expect(out[0].statement).toBe('Hemoglobin was not measured: 10 g/dL is an estimate from hematocrit 30%, dated 2026-09-29.');
    });

    it('is not claimed when a newer measured value exists', () => {
      const labs = [...chart.labResults, { code: '718-7', system: 'LOINC', value: 10.9, date: '2026-10-02' }];
      expect(runAssumptions(run(child(severe()), { labResults: labs }))).toEqual([]);
    });

    it('is claimed when the estimate is newer than the measured value', () => {
      const labs = [...chart.labResults, { code: '718-7', system: 'LOINC', value: 10.9, date: '2026-08-02' }];
      expect(runAssumptions(run(child(severe()), { labResults: labs })).map((a) => a.kind)).toEqual(['ESTIMATED_VALUE']);
    });

    it('follows the assembler: no estimate beside a same-day or undated measured value', () => {
      const sameDay = [...chart.labResults, { code: '718-7', system: 'LOINC', value: 10.9, date: '2026-09-29' }];
      const undatedRival = [...chart.labResults, { code: '718-7', system: 'LOINC', value: 10.9 }];
      expect(runAssumptions(run(child(severe()), { labResults: sameDay }))).toEqual([]);
      expect(runAssumptions(run(child(severe()), { labResults: undatedRival }))).toEqual([]);
    });

    it('is not derived from a value in another unit', () => {
      const fraction = { labResults: [{ code: '4544-3', system: 'LOINC', value: 0.3, unit: 'L/L', date: '2026-09-29' }] };
      expect(runAssumptions(run(child(severe()), fraction))).toEqual([]);
    });

    it('ignores gates that never ran or are still waiting', () => {
      const state = {
        ...gate('gate-cascaded', 'GATED_OUT', { condition: { ...HGB, operator: 'less_than', threshold: 6 } }, { excludeReason: 'Gated out by MCV < 80: labs value 88 >= 80' }),
        ...gate('gate-pending', 'PENDING_QUESTION', { condition: { ...HGB, operator: 'less_than', threshold: 6 } }),
      };
      expect(runAssumptions(run(child(state), chart))).toEqual([]);
    });
  });

  describe('a value the provider entered with no draw date', () => {
    it('is listed, and so is the estimate made from it', () => {
      const additional = { labResults: [{ code: '4544-3', system: 'LOINC', value: 27.5, date: '2026-10-05T00:03:41.354Z', providerAsserted: true }] };
      const out = runAssumptions(run(child(severe()), {}, additional));
      expect(out.map((a) => a.kind)).toEqual(['ESTIMATED_VALUE', 'UNDATED_VALUE']);
      expect(out[1].statement).toBe(
        'Hematocrit 27.5% was entered by you with no draw date, so it is dated at the visit (2026-10-05) and read as the newest.',
      );
      expect(out[1].gateIds).toEqual(['gate-severe']);
    });

    it('is not listed when the provider dated it (an ordinary dated result)', () => {
      const additional = { labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-09-20' }] };
      expect(runAssumptions(run(child(severe()), {}, additional))).toEqual([]);
    });
  });

  describe("the pathway's own recheck rule", () => {
    const rule = (status: string) =>
      gate('gate-recheck', status, { title: 'No hemoglobin in the last 30 days', condition: { ...HGB, horizon: 'MONTH', operator: 'not_includes_code' } });
    const old = { labResults: [{ code: '718-7', system: 'LOINC', value: 8.5, date: '2026-07-26' }] };

    it('is an assumption when it passed and other gates read the older value', () => {
      const out = runAssumptions(run(child({ ...rule('INCLUDED'), ...severe() }), old));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind: 'OLDER_THAN_RECHECK', gateIds: ['gate-severe'] });
      expect(out[0].statement).toContain('“title of gate-recheck”');
      expect(out[0].statement).toContain('8.5 g/dL from 2026-07-26');
    });

    it('is not one when the rule did not pass, when nothing is on file, or when the rule has no horizon', () => {
      expect(runAssumptions(run(child({ ...rule('GATED_OUT'), ...severe() }), old))).toEqual([]);
      expect(runAssumptions(run(child({ ...rule('INCLUDED'), ...severe() }), {}))).toEqual([]);
      const lifetime = gate('gate-recheck', 'INCLUDED', { condition: { ...HGB, horizon: 'LIFETIME', operator: 'not_includes_code' } });
      expect(runAssumptions(run(child({ ...lifetime, ...severe() }), old))).toEqual([]);
    });

    it('is not read out of a compound gate', () => {
      const compound = gate('gate-recheck', 'INCLUDED', { operator: 'AND', conditions: [{ ...HGB, horizon: 'MONTH', operator: 'not_includes_code' }] });
      expect(runAssumptions(run(child({ ...compound, ...severe() }), old))).toEqual([]);
    });
  });

  describe('a medication the provider vouched for', () => {
    const onIron = gate('gate-on-iron', 'INCLUDED', {
      operator: 'AND',
      conditions: [
        { operator: 'OR', conditions: [{ field: 'medications', value: 'B03AA', system: 'ATC', display: 'an oral iron supplement', operator: 'includes_code' }] },
      ],
    });
    const chart = { medications: [{ code: 'X-1', system: 'LOCAL', display: 'Compounded iron elixir' }] };
    const key = 'medclass:ATC:B03AA:compounded iron elixir|LOCAL|X-1';

    it('names the chart entry and the class, never the raw key', () => {
      const out = runAssumptions(run(child(onIron, { [key]: { booleanValue: true } }), chart));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind: 'VOUCHED_MEDICATION', gateIds: ['gate-on-iron'], supply: 'CHART' });
      expect(out[0].statement).toBe(
        '“Compounded iron elixir” on the medication list could not be identified. You said it counts as an oral iron supplement.',
      );
    });

    it('does not list an entry the provider said is NOT in the class', () => {
      expect(runAssumptions(run(child(onIron, { [key]: { booleanValue: false } }), chart))).toEqual([]);
    });
  });

  describe('"Not available"', () => {
    const anchored = {
      ...HGB,
      operator: 'count_in_window',
      count_threshold: 1,
      count_comparison: 'less_than',
      window_from: { event: 'medication_start', clinical_role: 'oral-iron-repletion', label: 'oral iron', codes: [{ code: '310325', system: 'RXNORM' }] },
    };
    const declined = { 'declined:anchor:medication_start:oral-iron-repletion': { notAvailable: true } };

    it('lists a declined start date while a gate still decides without it, and says the date can be supplied', () => {
      const state = gate('gate-response', 'GATED_OUT', { condition: anchored }, { indeterminate: true, excludeReason: 'Cannot anchor …' });
      const out = runAssumptions(run(child(state, declined)));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        kind: 'NOT_AVAILABLE',
        datumKey: 'anchor:medication_start:oral-iron-repletion',
        supply: 'ANCHOR_DATE',
        anchorGateId: 'gate-response',
        sessionId: 's1',
      });
      expect(out[0].statement).toBe(
        "You answered “Not available” to: When did oral iron start? The gate that needed it took the pathway's default (1 closed).",
      );
    });

    it('drops it once the gates decide as usual', () => {
      const state = gate('gate-response', 'GATED_OUT', { condition: anchored }, { indeterminate: false });
      expect(runAssumptions(run(child(state, declined)))).toEqual([]);
    });

    it("uses the gate's own question for a patient attribute, and sends the provider to the chart", () => {
      const state = gate(
        'gate-vitamin',
        'INCLUDED',
        {
          prompt: 'Already taking a prenatal vitamin?',
          condition: { attribute: 'patient.on_prenatal_vitamin', operator: 'equals', value: true },
        },
        { dataUnavailable: true },
      );
      const out = runAssumptions(run(child(state, { 'declined:patient.on_prenatal_vitamin': { notAvailable: true } })));
      expect(out[0]).toMatchObject({ kind: 'NOT_AVAILABLE', supply: 'CHART', anchorGateId: null });
      expect(out[0].statement).toBe(
        "You answered “Not available” to: Already taking a prenatal vitamin? The gate that needed it took the pathway's default (1 passed).",
      );
    });

    it('covers a declined lab under its equivalence-group key', () => {
      const state = gate('gate-severe', 'GATED_OUT', { condition: { ...HGB, operator: 'less_than', threshold: 6 } }, { dataUnavailable: true });
      const out = runAssumptions(run(child(state, { 'declined:LOINC:718-7': { notAvailable: true } })));
      expect(out.map((a) => a.key)).toEqual(['p1|NOT_AVAILABLE|LOINC:718-7']);
    });
  });

  it('keeps pathways apart: the same lab read by two pathways is one entry per pathway', () => {
    const chart = { labResults: [{ code: '4544-3', system: 'LOINC', value: 30, unit: '%', date: '2026-09-29' }] };
    const a = child(severe());
    const b = { ...child(severe()), sessionId: 's2', pathwayId: 'p2' };
    const out = runAssumptions({ initialContext: chart, additionalContext: {}, children: [a, b] });
    expect(out.map((x) => x.key)).toEqual(['p1|ESTIMATED_VALUE|LOINC:718-7', 'p2|ESTIMATED_VALUE|LOINC:718-7']);
  });
});

describe('MultiPathwayResolutionSession.assumptions', () => {
  // Imported here so the pure tests above never load the resolver module.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { multiPathwayResolutionTypeResolvers } = require('../resolvers/mutations/multi-pathway-resolution');
  const resolver = multiPathwayResolutionTypeResolvers.MultiPathwayResolutionSession.assumptions;

  it('reads nothing for a run with no pathways', async () => {
    const query = jest.fn();
    expect(await resolver({ id: 'run', contributingSessionIds: [] }, undefined, { pool: { query } })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("reads the run's chart and its pathways' stored gates, in the run's pathway order, and writes nothing", async () => {
    const chart = { labResults: [{ code: '4544-3', system: 'LOINC', value: 30, unit: '%', date: '2026-09-29' }] };
    const row = (id: string, pathwayId: string) => ({ id, pathway_id: pathwayId, gate_answers: {}, resolution_state: severe() });
    const query = jest.fn(async (sql: string) =>
      sql.includes('multi_pathway_resolution_sessions')
        ? { rows: [{ initial_patient_context: chart, additional_context: {} }] }
        // Returned out of order, as the database may.
        : { rows: [row('s2', 'p2'), row('s1', 'p1')] });
    const out = await resolver({ id: 'run', contributingSessionIds: ['s1', 's2'] }, undefined, { pool: { query } });
    expect(out.map((a: { key: string }) => a.key)).toEqual(['p1|ESTIMATED_VALUE|LOINC:718-7', 'p2|ESTIMATED_VALUE|LOINC:718-7']);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql] of query.mock.calls) expect(String(sql).trim().toUpperCase().startsWith('SELECT')).toBe(true);
  });
});
