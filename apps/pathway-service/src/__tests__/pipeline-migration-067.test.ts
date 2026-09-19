import { readFileSync } from 'fs';
import { join } from 'path';

const SQL = readFileSync(
  join(__dirname, '../../../../shared/data-layer/migrations/067_evaluation_inputs.sql'),
  'utf-8',
);
const body = SQL.replace(/--.*$/gm, ''); // statements only, comments stripped

describe('migration 067 — evaluation inputs', () => {
  it('purges both session tables before reshaping, inside one transaction', () => {
    const begin = body.indexOf('BEGIN;');
    const purgeMulti = body.indexOf('DELETE FROM multi_pathway_resolution_sessions;');
    const purgeSingle = body.indexOf('DELETE FROM pathway_resolution_sessions;');
    const alter = body.indexOf('ALTER TABLE pathway_resolution_sessions');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(purgeMulti).toBeGreaterThan(begin);
    expect(purgeSingle).toBeGreaterThan(begin);
    expect(alter).toBeGreaterThan(purgeSingle);
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
  });

  it.each([
    'revision INT NOT NULL DEFAULT 0',
    "provider_overrides JSONB NOT NULL DEFAULT '{}'",
    "observations JSONB NOT NULL DEFAULT '{}'",
    'graph_fingerprint TEXT NOT NULL',
    'env_fingerprint TEXT NOT NULL',
    'result_hash TEXT NOT NULL',
    'readiness JSONB NOT NULL',
    "gate_context_fields JSONB NOT NULL DEFAULT '{}'",
    "catch_up_items JSONB NOT NULL DEFAULT '[]'",
    'parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE CASCADE',
  ])('adds %s', (column) => {
    expect(body).toContain(`ADD COLUMN ${column}`);
  });

  it('drops dependency_map, pins the clock, and forbids facts on a child session', () => {
    expect(body).toContain('DROP COLUMN dependency_map');
    expect(body).toContain('ALTER COLUMN temporal_context SET NOT NULL');
    expect(body).toMatch(/CHECK \(parent_session_id IS NULL OR additional_context = '\{\}'::jsonb\)/);
  });

  it('admits the two event types the resolvers write', () => {
    const check = body.slice(body.indexOf('ALTER TABLE pathway_resolution_events'));
    for (const t of ['traversal_complete', 'override', 'gate_answer', 'context_update',
      'care_plan_generated', 'abandoned', 'BRANCH_CHOSEN', 'PROVIDER_ASSERTED_DATUM']) {
      expect(check).toContain(`'${t}'`);
    }
  });

  it('leaves multi_pathway_resolution_sessions columns to plan 04 (P3-1)', () => {
    expect(body).not.toMatch(/ALTER TABLE multi_pathway_resolution_sessions/);
  });
});
