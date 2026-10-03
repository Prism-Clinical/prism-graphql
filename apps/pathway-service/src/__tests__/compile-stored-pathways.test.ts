// apps/pathway-service/src/__tests__/compile-stored-pathways.test.ts
jest.mock('../services/compiler/stored-input', () => ({ loadStoredCompileInput: jest.fn() }));
import { compileAll } from '../scripts/compile-stored-pathways';
import { loadStoredCompileInput } from '../services/compiler/stored-input';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

it('compiles every stored pathway read-only and prints one line each', async () => {
  const pool = { query: jest.fn(async () => ({ rows: [
    { id: 'a', logical_id: 'good', version: '1', status: 'ACTIVE' },
    { id: 'b', logical_id: 'nograph', version: '1', status: 'DRAFT' },
  ] })) };
  (loadStoredCompileInput as jest.Mock).mockImplementation(async (_db: unknown, id: string) =>
    id === 'a' ? { pathway: MINIMAL_PATHWAY, codeMap: new Map(), temporalDefaults: {} } : null);
  const lines: string[] = [];
  const s = await compileAll(pool as never, (l) => lines.push(l));
  expect(s).toEqual({ total: 2, ok: 1 });
  expect(lines[0]).toMatch(/^OK +ACTIVE +good@1 \(\d+ ms\)$/);
  expect(lines[1]).toBe('SKIP  DRAFT    nograph@1 (no stored graph)');
  expect(pool.query.mock.calls.every(([sql]: [string]) => /^\s*SELECT/i.test(sql))).toBe(true);
});
