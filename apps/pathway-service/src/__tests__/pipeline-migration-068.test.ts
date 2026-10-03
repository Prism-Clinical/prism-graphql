import { readFileSync } from 'fs';
import { join } from 'path';

const SQL = readFileSync(
  join(__dirname, '../../../../shared/data-layer/migrations/068_run_inputs.sql'),
  'utf-8',
);
const body = SQL.replace(/--.*$/gm, ''); // statements only, comments stripped

describe('migration 068 — run inputs', () => {
  it('purges both session tables before reshaping, inside one transaction', () => {
    const begin = body.indexOf('BEGIN;');
    const purgeRuns = body.indexOf('DELETE FROM multi_pathway_resolution_sessions;');
    const purgeSessions = body.indexOf('DELETE FROM pathway_resolution_sessions;');
    const alter = body.indexOf('ALTER TABLE multi_pathway_resolution_sessions');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(purgeRuns).toBeGreaterThan(begin);
    expect(purgeSessions).toBeGreaterThan(begin);
    expect(alter).toBeGreaterThan(Math.max(purgeRuns, purgeSessions));
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
  });

  it.each([
    'revision INT NOT NULL DEFAULT 0',
    "additional_context JSONB NOT NULL DEFAULT '{}'",
    'env_fingerprint TEXT NOT NULL',
    'result_hash TEXT NOT NULL',
    'readiness JSONB NOT NULL',
  ])('adds %s', (column) => {
    expect(body).toContain(`ADD COLUMN ${column}`);
  });

  it('pins the run clock', () => {
    expect(body).toContain('ALTER COLUMN temporal_context SET NOT NULL');
  });

  it('leaves pathway_resolution_sessions alone (067 reshaped it)', () => {
    expect(body).not.toMatch(/ALTER TABLE pathway_resolution_sessions/);
  });
});
