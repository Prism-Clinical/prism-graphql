import { loadPatientContextFromSnapshot } from '../services/resolution/snapshot-context';

function makePool() {
  return { query: jest.fn() } as unknown as { query: jest.Mock };
}

const SNAPSHOT_ROW = { rows: [{ id: 'snap-1' }] };

function emptyTable() {
  return { rows: [] };
}

describe('loadPatientContextFromSnapshot — active-condition filtering', () => {
  it('SELECT pulls clinical_status and abatement_date_time alongside core fields', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce(SNAPSHOT_ROW)
      .mockResolvedValueOnce(emptyTable())   // conditions
      .mockResolvedValueOnce(emptyTable())   // medications
      .mockResolvedValueOnce(emptyTable())   // labs
      .mockResolvedValueOnce(emptyTable())   // allergies
      .mockResolvedValueOnce(emptyTable()); // vitals

    await loadPatientContextFromSnapshot(pool as any, 'patient-1');

    // The conditions SELECT is the second pool.query call (after the snapshot lookup).
    const conditionsSql = pool.query.mock.calls[1][0];
    expect(conditionsSql).toContain('clinical_status');
    expect(conditionsSql).toContain('abatement_date_time');
    expect(conditionsSql).toContain('snapshot_conditions');
  });

  it('drops conditions with non-null abatement_date_time', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce(SNAPSHOT_ROW)
      .mockResolvedValueOnce({
        rows: [
          { code: 'I10', code_detail: null, display: 'HTN', clinical_status: null, abatement_date_time: null },
          { code: 'E11.65', code_detail: null, display: 'T2DM hyperglycemia', clinical_status: null, abatement_date_time: '2024-06-15' },
        ],
      })
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable());

    const result = await loadPatientContextFromSnapshot(pool as any, 'patient-1');
    expect(result.conditionCodes.map((c) => c.code)).toEqual(['I10']);
  });

  it('drops conditions whose clinical_status indicates resolved', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce(SNAPSHOT_ROW)
      .mockResolvedValueOnce({
        rows: [
          {
            code: 'I10',
            code_detail: null,
            display: 'HTN',
            clinical_status: { coding: [{ code: 'active' }] },
            abatement_date_time: null,
          },
          {
            code: 'J02.0',
            code_detail: null,
            display: 'Strep throat',
            clinical_status: { coding: [{ code: 'resolved' }] },
            abatement_date_time: null,
          },
          {
            code: 'F41.1',
            code_detail: null,
            display: 'GAD',
            clinical_status: { coding: [{ code: 'remission' }] },
            abatement_date_time: null,
          },
        ],
      })
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable());

    const result = await loadPatientContextFromSnapshot(pool as any, 'patient-1');
    expect(result.conditionCodes.map((c) => c.code)).toEqual(['I10']);
  });

  it('keeps conditions with null clinical_status and null abatement (fail-safe)', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce(SNAPSHOT_ROW)
      .mockResolvedValueOnce({
        rows: [
          { code: 'I10', code_detail: null, display: null, clinical_status: null, abatement_date_time: null },
        ],
      })
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable());

    const result = await loadPatientContextFromSnapshot(pool as any, 'patient-1');
    expect(result.conditionCodes.map((c) => c.code)).toEqual(['I10']);
  });

  it('keeps conditions with active or recurrence clinical_status', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce(SNAPSHOT_ROW)
      .mockResolvedValueOnce({
        rows: [
          {
            code: 'I10',
            code_detail: null,
            display: null,
            clinical_status: { coding: [{ code: 'active' }] },
            abatement_date_time: null,
          },
          {
            code: 'F32.9',
            code_detail: null,
            display: null,
            clinical_status: { coding: [{ code: 'recurrence' }] },
            abatement_date_time: null,
          },
        ],
      })
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable())
      .mockResolvedValueOnce(emptyTable());

    const result = await loadPatientContextFromSnapshot(pool as any, 'patient-1');
    expect(new Set(result.conditionCodes.map((c) => c.code))).toEqual(new Set(['I10', 'F32.9']));
  });
});
