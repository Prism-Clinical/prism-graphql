jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: jest.fn(),
}));
jest.mock('../services/medications/normalizer', () => ({
  ...jest.requireActual('../services/medications/normalizer'),
  prewarmMedications: jest.fn(),
}));
jest.mock('../services/import/import-orchestrator', () => ({ importPathway: jest.fn() }));

import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { importMutations } from '../resolvers/mutations/import';
import { backfill } from '../scripts/backfill-medication-normalization';
import { prewarmMedications } from '../services/medications/normalizer';
import { pathwayMedicationNames, prewarmPathwayInBackground, prewarmPathwayMedications } from '../services/medications/prewarm-pathway';
import { importPathway } from '../services/import/import-orchestrator';

const graphWith = (...meds: Array<Record<string, unknown>>) => ({
  graphContext: buildGraphContext(
    [{ id: 'r', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
      ...meds.map((p, i) => ({ id: `m${i}`, nodeIdentifier: `med-${i}`, nodeType: 'Medication', properties: p }))] as never,
    [],
  ),
});
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  (prewarmMedications as jest.Mock).mockResolvedValue({ succeeded: 2, failed: 0 });
});

describe('pathway medication pre-warm (D14)', () => {
  it('names each medication exactly as evaluation looks it up, once, sorted', async () => {
    (buildResolutionContext as jest.Mock).mockResolvedValue(graphWith({ name: 'Labetalol' }, { title: 'Nifedipine' }, { name: 'Labetalol' }));
    expect(await pathwayMedicationNames({} as never, 'pw')).toEqual(['Labetalol', 'Nifedipine']);

    expect(await prewarmPathwayMedications({} as never, 'pw')).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(prewarmMedications).toHaveBeenCalledWith({}, [{ text: 'Labetalol' }, { text: 'Nifedipine' }]);
  });

  it('in the background, never throws and never rejects', async () => {
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));
    expect(() => prewarmPathwayInBackground({} as never, 'pw', 'import')).not.toThrow();
    await flush(); // an unhandled rejection would fail the run
  });

  it('import pre-warms the imported pathway without waiting for it', async () => {
    (importPathway as jest.Mock).mockResolvedValue({ pathwayId: 'pw-new', validation: { valid: true, errors: [], warnings: [] }, diff: null, importType: 'NEW_PATHWAY' });
    (buildResolutionContext as jest.Mock).mockReturnValue(new Promise(() => undefined)); // never settles
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-new' }] }) };

    const result = await importMutations.importPathway(null, { pathwayJson: '{}', importMode: 'NEW_PATHWAY' as never }, { pool, userId: 'u' } as never);

    expect(result.pathway).toEqual({ id: 'pw-new' });
    expect(buildResolutionContext).toHaveBeenCalledWith(pool, 'pw-new');
  });

  it('an invalid import pre-warms nothing', async () => {
    (importPathway as jest.Mock).mockResolvedValue({ validation: { valid: false, errors: ['x'], warnings: [] }, importType: 'NEW_PATHWAY' });
    await importMutations.importPathway(null, { pathwayJson: '{}', importMode: 'NEW_PATHWAY' as never }, { pool: { query: jest.fn() }, userId: 'u' } as never);
    expect(buildResolutionContext).not.toHaveBeenCalled();
  });

  it('activation pre-warms the activated pathway without waiting for it', async () => {
    (buildResolutionContext as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', previousStatus: 'DRAFT' }] }) };
    const r = await importMutations.activatePathway(null, { id: 'pw-1' }, { pool } as never);
    expect(r.previousStatus).toBe('DRAFT');
    expect(buildResolutionContext).toHaveBeenCalledWith(pool, 'pw-1');
  });

  it('the backfill covers ACTIVE and DRAFT pathways; a dry run calls nothing external', async () => {
    (buildResolutionContext as jest.Mock).mockResolvedValue(graphWith({ name: 'Labetalol' }));
    const pool = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'a', title: 'HTN', version: '1.0', status: 'ACTIVE' },
      { id: 'd', title: 'HTN', version: '1.1', status: 'DRAFT' },
    ] }) };
    const lines: string[] = [];

    const dry = await backfill(pool as never, { dryRun: true, log: (l) => lines.push(l) });
    expect(prewarmMedications).not.toHaveBeenCalled();
    expect(lines).toEqual(['ACTIVE HTN@1.0: Labetalol', 'DRAFT HTN@1.1: Labetalol']);
    expect(dry.pathways).toBe(2);
    expect(pool.query.mock.calls[0][0]).toContain("status IN ('ACTIVE', 'DRAFT')");

    (prewarmMedications as jest.Mock).mockResolvedValue({ succeeded: 1, failed: 0 });
    expect(await backfill(pool as never, { dryRun: false, log: () => undefined })).toEqual({ pathways: 2, succeeded: 2, failed: 0 });
  });
});
