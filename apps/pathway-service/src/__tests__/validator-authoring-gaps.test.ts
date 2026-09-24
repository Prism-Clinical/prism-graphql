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
