import {
  parseDependsOn,
  normalizeGateDependsOn,
} from '../services/import/normalize-gates';
import { PathwayJson } from '../services/import/types';

// ─── parseDependsOn ───────────────────────────────────────────────────
//
// The single reader for the `depends_on` property. Both the validator (to
// check the referenced node ids exist) and the import normalizer (to rewrite
// the property into the canonical shape) go through it, so the authoring
// boundary cannot admit a shape evaluation would reject.

describe('parseDependsOn', () => {
  it('passes the canonical shape through unchanged', () => {
    expect(parseDependsOn([{ node_id: 'step-1', status: 'EXCLUDED' }])).toEqual([
      { node_id: 'step-1', status: 'EXCLUDED' },
    ]);
  });

  // The legacy shapes the old validator explicitly blessed
  // (`props.depends_on as string[]` / `[props.depends_on as string]`).
  it('lifts a bare string to a single INCLUDED dependency', () => {
    expect(parseDependsOn('step-1-3')).toEqual([
      { node_id: 'step-1-3', status: 'INCLUDED' },
    ]);
  });

  it('lifts an array of bare strings', () => {
    expect(parseDependsOn(['step-1-3', 'step-2-2'])).toEqual([
      { node_id: 'step-1-3', status: 'INCLUDED' },
      { node_id: 'step-2-2', status: 'INCLUDED' },
    ]);
  });

  // INCLUDED is the only defensible default: a legacy `depends_on: "step-1-3"`
  // meant "step-1-3 was walked", which is what INCLUDED encodes. Defaulting to
  // anything else would silently change which branch a live pathway takes.
  it('defaults a missing status to INCLUDED', () => {
    expect(parseDependsOn([{ node_id: 'step-1' }])).toEqual([
      { node_id: 'step-1', status: 'INCLUDED' },
    ]);
  });

  it('returns null for shapes it cannot interpret', () => {
    expect(parseDependsOn(42)).toBeNull();
    expect(parseDependsOn([{ status: 'INCLUDED' }])).toBeNull();
    expect(parseDependsOn([{ node_id: 7 }])).toBeNull();
    expect(parseDependsOn({})).toBeNull();
  });

  it('returns null for a status outside the NodeStatus vocabulary', () => {
    expect(parseDependsOn([{ node_id: 'step-1', status: 'MAYBE' }])).toBeNull();
  });

  it('treats absent / empty as "no dependencies declared"', () => {
    expect(parseDependsOn(undefined)).toEqual([]);
    expect(parseDependsOn(null)).toEqual([]);
    expect(parseDependsOn([])).toEqual([]);
  });

  it('rejects an empty node_id rather than emitting an unmatchable dependency', () => {
    expect(parseDependsOn('')).toBeNull();
    expect(parseDependsOn([{ node_id: '', status: 'INCLUDED' }])).toBeNull();
  });
});

// ─── normalizeGateDependsOn ───────────────────────────────────────────

function pathwayWithGate(dependsOn: unknown): PathwayJson {
  return {
    schema_version: '1.0',
    pathway: {
      logical_id: 'test-v1',
      title: 'Test',
      version: '1.0',
      category: 'OBSTETRIC',
      condition_codes: [{ code: 'N76.0', system: 'ICD-10' }],
    },
    nodes: [
      { id: 'step-1-3', type: 'Step', properties: { title: 'Workup' } },
      {
        id: 'gate-dx-bv',
        type: 'Gate',
        properties: {
          title: 'BV positive?',
          gate_type: 'prior_node_result',
          default_behavior: 'skip',
          depends_on: dependsOn,
        },
      },
    ],
    edges: [],
  } as unknown as PathwayJson;
}

describe('normalizeGateDependsOn', () => {
  it('rewrites a legacy string into the canonical array', () => {
    const out = normalizeGateDependsOn(pathwayWithGate('step-1-3'));
    expect(out.nodes[1].properties!.depends_on).toEqual([
      { node_id: 'step-1-3', status: 'INCLUDED' },
    ]);
  });

  it('leaves an uninterpretable value alone so the validator can report it', () => {
    const out = normalizeGateDependsOn(pathwayWithGate(42));
    expect(out.nodes[1].properties!.depends_on).toBe(42);
  });

  it('does not mutate the caller-supplied pathway', () => {
    const input = pathwayWithGate('step-1-3');
    normalizeGateDependsOn(input);
    expect(input.nodes[1].properties!.depends_on).toBe('step-1-3');
  });

  it('touches only prior_node_result gates', () => {
    const pw = pathwayWithGate('step-1-3');
    (pw.nodes[1].properties as Record<string, unknown>).gate_type = 'question';
    const out = normalizeGateDependsOn(pw);
    expect(out.nodes[1].properties!.depends_on).toBe('step-1-3');
  });

  it('leaves gates without depends_on untouched', () => {
    const pw = pathwayWithGate(undefined);
    delete (pw.nodes[1].properties as Record<string, unknown>).depends_on;
    const out = normalizeGateDependsOn(pw);
    expect(out.nodes[1].properties).not.toHaveProperty('depends_on');
  });
});
