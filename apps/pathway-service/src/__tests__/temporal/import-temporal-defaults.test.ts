/**
 * `pathway_graph_index.temporal_defaults` across imports.
 *
 * The pathway JSON cannot author temporal defaults (the header has no
 * temporal keys; unknown `pathway.*` keys are dropped), so the stored row is
 * the only copy. A DRAFT_UPDATE leaves it alone because its UPDATE never
 * names the column. A NEW_VERSION inserts a fresh row, and used to omit the
 * column — "Create New Version" silently reset the new version to the system
 * defaults. It now inherits from the previous version (the same row the audit
 * records as previous_pathway_id).
 */
import { importPathway } from '../../services/import/import-orchestrator';
import { parsePathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';
import { ImportMode, PathwayJson } from '../../services/import/types';
import { MINIMAL_PATHWAY, clonePathway } from '../fixtures/reference-pathway';
import { FakePathwayStore } from '../fixtures/fake-pathway-store';

const DEFAULTS = {
  default_horizons: { labs: 'YEAR', conditions: { days: 30 } },
  default_statuses: { medications: 'any' },
};

async function importInto(store: FakePathwayStore, json: PathwayJson, mode: 'NEW_PATHWAY' | 'DRAFT_UPDATE' | 'NEW_VERSION') {
  store.expectEdgesOf(json);
  const result = await importPathway(store.pool, json, mode as ImportMode, 'user-1');
  if (!result.validation.valid) throw new Error(`${mode} rejected: ${result.validation.errors.join('; ')}`);
  return result;
}

function atVersion(version: string): PathwayJson {
  const pw = clonePathway(MINIMAL_PATHWAY);
  pw.pathway.version = version;
  return pw;
}

/** v1.0 imported, then given pathway-level defaults the only way possible: in the row. */
async function seeded(defaults: unknown) {
  const store = new FakePathwayStore();
  await importInto(store, atVersion('1.0'), 'NEW_PATHWAY');
  store.indexRow('CP-Minimal', '1.0').temporal_defaults = defaults;
  return store;
}

describe('temporal_defaults survive imports', () => {
  it('the fixture defaults are ones the runtime parser accepts', () => {
    expect(() => parsePathwayTemporalDefaults(DEFAULTS)).not.toThrow();
  });

  it('NEW_PATHWAY writes no pathway-level opinion', async () => {
    const store = new FakePathwayStore();
    await importInto(store, atVersion('1.0'), 'NEW_PATHWAY');
    expect(store.indexRow('CP-Minimal', '1.0').temporal_defaults).toBeNull();
  });

  it('NEW_VERSION inherits the previous version\'s temporal_defaults', async () => {
    const store = await seeded(DEFAULTS);
    await importInto(store, atVersion('1.1'), 'NEW_VERSION');

    const v11 = store.indexRow('CP-Minimal', '1.1');
    expect(v11.temporal_defaults).toEqual(DEFAULTS);
    expect(parsePathwayTemporalDefaults(v11.temporal_defaults))
      .toEqual(parsePathwayTemporalDefaults(DEFAULTS));
    // The previous version is untouched.
    expect(store.indexRow('CP-Minimal', '1.0').temporal_defaults).toEqual(DEFAULTS);
  });

  it('NEW_VERSION of a pathway with no defaults stays null', async () => {
    const store = await seeded(null);
    await importInto(store, atVersion('1.1'), 'NEW_VERSION');
    expect(store.indexRow('CP-Minimal', '1.1').temporal_defaults).toBeNull();
  });

  it('NEW_VERSION inherits from the latest version of the logical_id', async () => {
    const store = await seeded(DEFAULTS);
    await importInto(store, atVersion('1.1'), 'NEW_VERSION');
    const newer = { default_horizons: { labs: { days: 180 } } };
    store.indexRow('CP-Minimal', '1.1').temporal_defaults = newer;
    await importInto(store, atVersion('1.2'), 'NEW_VERSION');
    expect(store.indexRow('CP-Minimal', '1.2').temporal_defaults).toEqual(newer);
  });

  it('DRAFT_UPDATE keeps the stored temporal_defaults', async () => {
    const store = await seeded(DEFAULTS);
    const edited = atVersion('1.0');
    edited.pathway.title = 'Edited title';
    await importInto(store, edited, 'DRAFT_UPDATE');

    const row = store.indexRow('CP-Minimal', '1.0');
    expect(row.title).toBe('Edited title');
    expect(row.temporal_defaults).toEqual(DEFAULTS);
  });

  it('the INSERT sends the value as JSON text cast to jsonb', async () => {
    const store = await seeded(DEFAULTS);
    await importInto(store, atVersion('1.1'), 'NEW_VERSION');
    const insert = store.statements.filter((s) => s.text.includes('INSERT INTO pathway_graph_index')).pop()!;
    expect(insert.text).toContain('$10::jsonb');
    expect(insert.values[9]).toBe(JSON.stringify(DEFAULTS));
  });
});
