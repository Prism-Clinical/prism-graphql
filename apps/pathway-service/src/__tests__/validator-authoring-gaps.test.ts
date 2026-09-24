/**
 * Authoring-boundary gaps: shapes and values the import validator admitted or
 * refused differently from how the engine reads them.
 */
import { validatePathwayJson } from '../services/import/validator';
import { buildGraphCommands } from '../services/import/graph-builder';
import { clonePathway } from './fixtures/reference-pathway';
import { createPathwayWithGates, GATE_IDS } from './fixtures/reference-pathway-with-gates';
import { PathwayJson } from '../services/import/types';

function withGate(props: Record<string, unknown>, id = 'gate-x'): PathwayJson {
  const pw = clonePathway();
  pw.nodes.push({ id, type: 'Gate' as any, properties: { title: 'G', default_behavior: 'skip', ...props } });
  pw.edges.push({ from: 'step-1-1', to: id, type: 'HAS_GATE' as any });
  pw.edges.push({ from: id, to: 'step-1-2', type: 'BRANCHES_TO' as any });
  return pw;
}

describe('depends_on — the runtime shape is {node_id, status}', () => {
  it('accepts the gated reference fixture, whose prior_node_result gate uses the runtime shape', () => {
    const result = validatePathwayJson(createPathwayWithGates());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects the legacy bare-string shape, naming the object shape', () => {
    const pw = withGate({ gate_type: 'prior_node_result', depends_on: ['step-1-1'] });
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('{ "node_id"'));
  });

  it('rejects a non-array depends_on (the runtime iterates it)', () => {
    const pw = withGate({
      gate_type: 'prior_node_result',
      depends_on: { node_id: 'step-1-1', status: 'INCLUDED' },
    });
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('depends_on must be an array'));
  });

  it('rejects a status the runtime can never equal (case-sensitive NodeStatus)', () => {
    const pw = withGate({
      gate_type: 'prior_node_result',
      depends_on: [{ node_id: 'step-1-1', status: 'included' }],
    });
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('"included"'));
  });

  it('rejects a missing status', () => {
    const pw = withGate({ gate_type: 'prior_node_result', depends_on: [{ node_id: 'step-1-1' }] });
    expect(validatePathwayJson(pw).valid).toBe(false);
  });

  it('serializes depends_on into AGE as a list of maps, not a string', () => {
    const cmds = buildGraphCommands(createPathwayWithGates());
    const gate = cmds.find((c) => c.cypher.includes(`'${GATE_IDS.MED_MONITORING}'`));
    expect(gate).toBeDefined();
    expect(gate!.cypher).toContain(`depends_on: [{node_id: 'step-3-1', status: 'INCLUDED'}]`);
  });
});

describe('code wildcards — only a single trailing ".*" is a pattern at runtime', () => {
  const coded = (operator: string, value: string, field = 'conditions') =>
    withGate({ gate_type: 'patient_attribute', condition: { field, operator, value } });

  it('rejects "G82.2*" (silently a literal at runtime) and suggests "G82.2.*"', () => {
    const result = validatePathwayJson(coded('includes_code', 'G82.2*'));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('"G82.2.*"'));
  });

  it.each(['Z94.*.1', '*.9', 'Z9*.*', 'Z94.**', 'Z94.*1'])(
    'rejects the malformed pattern %s without guessing a rewrite',
    (value) => {
      const result = validatePathwayJson(coded('includes_code', value));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('not a wildcard'));
      expect(result.errors.join('\n')).not.toContain('for a prefix match write');
    },
  );

  it('rejects a bare ".*", whose empty prefix matches every code', () => {
    const result = validatePathwayJson(coded('count_in_window', '.*'));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('exists'));
  });

  it.each(['equals', 'greater_than', 'less_than'])(
    'rejects any "*" on %s, which matches codes exactly',
    (operator) => {
      const result = validatePathwayJson(coded(operator, 'Z94.*', 'labs'));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('exactly'));
    },
  );

  it.each(['includes_code', 'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline'])(
    'accepts a well-formed trailing ".*" on %s',
    (operator) => {
      expect(validatePathwayJson(coded(operator, 'Z94.*')).errors).toEqual([]);
    },
  );

  it('ignores the value of an exists condition (the runtime does too)', () => {
    expect(validatePathwayJson(coded('exists', '*')).errors).toEqual([]);
  });
});

describe('answer_type casing — the runtime reads it case-insensitively', () => {
  it('requires options for answer_type "SELECT" (the enum spelling), not only "select"', () => {
    const pw = withGate({ gate_type: 'question', prompt: 'Which?', answer_type: 'SELECT' });
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('requires a non-empty "options" array'));
  });

  it('still accepts an uppercase SELECT that declares its options', () => {
    const pw = withGate({ gate_type: 'question', prompt: 'Which?', answer_type: 'SELECT', options: ['a', 'b'] });
    expect(validatePathwayJson(pw).errors).toEqual([]);
  });
});
