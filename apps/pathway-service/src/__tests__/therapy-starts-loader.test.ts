/**
 * The care-plan source of `window_from` anchors, read at session creation.
 *
 * `materializeCarePlan` writes a NEW `patient_care_plans` row per commit, so a
 * patient seen three times has three plans each recommending oral iron. The
 * loader returns every matching row and `withTherapyStarts` keeps the EARLIEST.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  loadCarePlanTherapyStarts,
  windowFromRoles,
} from '../resolvers/helpers/therapy-starts';
import { withTherapyStarts } from '../services/resolution/temporal/anchored-window';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { GraphNode } from '../services/confidence/types';
import { makeGraphContext } from './fixtures/reference-patient-context';

const PATIENT = '5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f';
const PW_V4 = '00000000-0000-4000-8000-000000000004';
const PW_V3 = '00000000-0000-4000-8000-000000000003';
const PW_OTHER = '00000000-0000-4000-8000-0000000000ff';

function node(id: string, type: string, props: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } };
}

const ANCHORED_GATE = node('gate-hgb-response', 'Gate', {
  gate_type: 'compound',
  operator: 'OR',
  conditions: [
    { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 10.9, horizon: { days: 90 } },
    {
      field: 'labs', operator: 'trend_up', value: '718-7', slope_threshold: 0.015, min_points: 2,
      window_from: { event: 'medication_start', clinical_role: 'oral-iron-repletion' },
    },
  ],
});

const GRAPH = makeGraphContext(
  [
    ANCHORED_GATE,
    node('med-1', 'Medication', { name: 'Ferrous sulfate', clinical_role: 'oral-iron-repletion' }),
    node('med-2', 'Medication', { name: 'Ferrous gluconate', clinical_role: 'oral-iron-repletion' }),
    node('med-4', 'Medication', { name: 'Iron sucrose', clinical_role: 'iv-iron-repletion' }),
    node('step-2-1', 'Step', { clinical_role: 'oral-iron-repletion' }),
  ],
  [],
);

function mockPool(rows: Array<Record<string, unknown>>) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM pathway_graph_index')) return { rows: [{ id: PW_V4 }, { id: PW_V3 }] };
    if (sql.includes('FROM patient_care_plan_interventions')) return { rows };
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query } as unknown as { query: jest.Mock };
}

const row = (carePlanId: string, date: string, ref: string) => ({
  intervention_id: `i-${carePlanId}`,
  care_plan_id: carePlanId,
  guideline_reference: ref,
  start_date: date,
});

describe('loadCarePlanTherapyStarts', () => {
  it('finds the classes a pathway anchors on', () => {
    expect([...windowFromRoles(GRAPH)]).toEqual(['oral-iron-repletion']);
  });

  it('issues no query for a pathway with no window_from', async () => {
    const pool = mockPool([]);
    const plain = makeGraphContext([node('g', 'Gate', { gate_type: 'patient_attribute', condition: {} })], []);
    await expect(
      loadCarePlanTherapyStarts(pool as never, { patientId: PATIENT, pathwayId: PW_V4, graphContext: plain }),
    ).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('issues no query for a non-UUID patient id (the column is UUID)', async () => {
    const pool = mockPool([]);
    await expect(
      loadCarePlanTherapyStarts(pool as never, { patientId: 'pt-1', pathwayId: PW_V4, graphContext: GRAPH }),
    ).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("matches this pathway's (any version's) medication recommendations of the class; the earliest wins", async () => {
    const pool = mockPool([
      row('cp-3', '2026-08-20', `pathway:${PW_V4} node:med-1`),
      row('cp-1', '2026-06-01', `pathway:${PW_V3} node:med-2`), // an earlier version, gluconate
      row('cp-2', '2026-07-10', `pathway:${PW_V4} node:med-1`),
      row('cp-x', '2026-01-01', `pathway:${PW_OTHER} node:med-1`), // another pathway's med-1
      row('cp-y', '2026-01-02', `pathway:${PW_V4} node:med-4`), // IV iron — another class
      row('cp-z', '2026-01-03', `pathway:${PW_V4} node:step-2-1`), // not a Medication
      row('cp-w', '2026-01-04', `node:med-1`), // provider-override row: no pathway
    ]);
    const events = await loadCarePlanTherapyStarts(pool as never, {
      patientId: PATIENT, pathwayId: PW_V4, graphContext: GRAPH,
    });
    expect(events.map((e) => e.source.carePlanId)).toEqual(['cp-3', 'cp-1', 'cp-2']);

    const ctx = withTherapyStarts(
      makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-01T00:00:00.000Z', temporalPolicyVersion: 'v1' }),
      events,
    );
    expect(ctx.therapyStarts).toEqual([
      {
        clinicalRole: 'oral-iron-repletion',
        date: '2026-06-01',
        source: { carePlanId: 'cp-1', interventionId: 'i-cp-1', pathwayId: PW_V3, nodeId: 'med-2' },
      },
    ]);
  });

  it('reads the plan date as text and excludes cancelled rows in SQL', async () => {
    const pool = mockPool([]);
    await loadCarePlanTherapyStarts(pool as never, { patientId: PATIENT, pathwayId: PW_V4, graphContext: GRAPH });
    const sql = String(pool.query.mock.calls[1][0]);
    expect(sql).toContain(`to_char(p.start_date, 'YYYY-MM-DD')`);
    expect(sql).toContain(`i.type = 'MEDICATION'`);
    expect(sql).toContain(`i.status <> 'CANCELLED'`);
    expect(sql).toContain(`p.status <> 'CANCELLED'`);
    expect(pool.query.mock.calls[1][1]).toEqual([PATIENT]);
  });
});
