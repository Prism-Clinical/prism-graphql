// apps/pathway-service/src/__tests__/compiler-compile.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { compilePathway } from '../services/compiler/compile';
import type { CompileResult } from '../services/compiler/model';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import { pathwayJsonFromStoredGraph } from '../services/import/stored-graph';
import { MINIMAL_PATHWAY } from './fixtures/reference-pathway';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.ferritin', namespace: 'lab', system: 'LOINC', code: '2276-4', valueType: 'number' },
  { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);

/** A stored export (pathwayGraph query shape) → the pathway JSON the compiler reads, metadata from the root node. */
function corpus(file: string) {
  const g = JSON.parse(readFileSync(join(__dirname, 'fixtures/compiler-corpus', file), 'utf8')).data.pathwayGraph;
  const root = g.nodes.find((n: { id: string }) => n.id === 'root').properties;
  return pathwayJsonFromStoredGraph({
    pathway: { logicalId: root.logical_id, title: root.title, version: String(root.version), category: root.category, scope: root.scope, targetPopulation: root.target_population },
    conditionCodes: [{ code: 'O99.019', system: 'ICD-10' }],
    nodes: g.nodes,
    edges: g.edges.map((e: { properties: unknown }) => ({ ...e, properties: e.properties ?? {} })),
  });
}
const compile = (file: string) => compilePathway({ pathway: corpus(file), codeMap, temporalDefaults: {} });
/** MINIMAL_PATHWAY plus one gate `gate-x` on stage-1 guarding a new step-1-2. */
const withGate = (props: Record<string, unknown>) => ({
  ...MINIMAL_PATHWAY,
  nodes: [
    ...MINIMAL_PATHWAY.nodes,
    { id: 'gate-x', type: 'Gate', properties: { title: 'Gate X', ...props } },
    { id: 'step-1-2', type: 'Step', properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'Guarded' } },
  ],
  edges: [...MINIMAL_PATHWAY.edges, { from: 'stage-1', to: 'gate-x', type: 'HAS_GATE' }, { from: 'gate-x', to: 'step-1-2', type: 'BRANCHES_TO' }],
}) as never;
const codes = (r: CompileResult) => (r.ok ? [] : r.errors.map((e) => `${e.code}${e.nodeId ? `:${e.nodeId}` : ''}`));

describe('compilePathway', () => {
  it('compiles the minimal reference pathway', () => {
    const r = compilePathway({ pathway: MINIMAL_PATHWAY, codeMap, temporalDefaults: {} });
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    expect(r.model.order).toEqual(['root', 'stage-1', 'step-1-1']);
    expect(r.model.nodes.get('root')?.kind).toBe('root');
  });

  it('compiles the live ACTIVE anemia 1.4 and records the stage-contained, gate-guarded transfusion step', () => {
    const r = compile('anemia-1.4.json');
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    expect(r.model.containers.get('step-3-3')).toEqual(['stage-3']);
    expect(r.model.guards.get('step-3-3')).toEqual([{ controller: 'gate-severe-anemia', armId: 'gate-severe-anemia->step-3-3' }]);
    expect(r.model.order.indexOf('gate-severe-anemia')).toBeLessThan(r.model.order.indexOf('step-3-3'));
    expect([...r.model.datums.keys()].sort()).toEqual(['attribute:trimester', 'lab:LOINC:2276-4', 'lab:LOINC:718-7']);
    expect(r.model.requiresEncounterAnchor).toBe(false);
  });

  it('refuses anemia 1.1 (legacy condition dialect)', () => {
    const r = compile('anemia-1.1.json');
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.map((e) => e.message).join('\n')).toMatch(/LT|EQUALS|IN/);
  });

  it('refuses GHTN: routing question gates without `when`, and Q13 on its compound gate', () => {
    const got = codes(compile('ghtn-1.json'));
    expect(got).toEqual(expect.arrayContaining([
      'MISSING_WHEN:gate-aspirin-indicated',
      'MISSING_WHEN:gate-htn-confirmed',
      'MULTI_TARGET_NON_ROUTING_GATE:gate-htn-diagnosed',
    ]));
  });

  it.each([
    ['patient_attribute with no condition', { gate_type: 'patient_attribute', default_behavior: 'skip' }],
    ['SELECT question with no options (uppercase answer_type)', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' }],
    ['trimester comparison with no value', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than' } }],
  ])('refuses an unusable gate payload: %s', (_label, props) => {
    const r = compilePathway({ pathway: withGate(props), codeMap, temporalDefaults: {} });
    expect(codes(r)).toContain('PAYLOAD:gate-x');
  });

  it.each([
    ['patient_attribute with a condition', { gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'patient.trimester', operator: 'less_than', value: 3 } }],
    ['SELECT question with options', { gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT', options: ['yes', 'no'], prompt: 'Which?' }],
  ])('compiles the well-formed equivalent: %s', (_label, props) => {
    expect(codes(compilePathway({ pathway: withGate(props), codeMap, temporalDefaults: {} }))).toEqual([]);
  });

  it.each([
    ['a trimester comparison against a string', { attribute: 'patient.trimester', operator: 'less_than', value: 'oops' }],
    ['an `in` list with a non-scalar member', { attribute: 'patient.trimester', operator: 'in', value: [{}] }],
  ])('refuses a malformed operand through the public compiler: %s', (_label, condition) => {
    expect(codes(compilePathway({ pathway: withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition }), codeMap, temporalDefaults: {} }))).toContain('PAYLOAD:gate-x');
  });

  it.each([
    ['a count over a string-valued lab', { field: 'labs', operator: 'count_in_window', value: '10331-7', system: 'LOINC', window_days: 30, count_threshold: 1 }],
    ['bucket existence with an empty code', { field: 'labs', operator: 'exists', value: '' }],
  ])('compiles %s', (_label, condition) => {
    expect(codes(compilePathway({ pathway: withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition }), codeMap, temporalDefaults: {} }))).toEqual([]);
  });

  it('conflicting code-map aliases fail the same way in either row order', () => {
    const rows = [...codeMap.values(), { attributeName: 'lab.rh_alias', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'number' as const }];
    const pathway = withGate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition: { attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' } });
    const a = compilePathway({ pathway, codeMap: buildCodeMap(rows), temporalDefaults: {} });
    expect(codes(a)).toEqual(['DATUM_TYPE:gate-x']);
    expect(compilePathway({ pathway, codeMap: buildCodeMap([...rows].reverse()), temporalDefaults: {} })).toEqual(a);
  });

  it('owns its output: later input edits cannot change an earlier result, and the result cannot be mutated', () => {
    const input = structuredClone(MINIMAL_PATHWAY);
    const r = compilePathway({ pathway: input, codeMap, temporalDefaults: {} });
    if (!r.ok) throw new Error('minimal pathway must compile');
    (input.nodes[0].properties as Record<string, unknown>).title = 'Edited after compile';
    expect(r.model.nodes.get('stage-1')!.properties.title).toBe('Assessment');
    expect(() => { (r.model.nodes.get('stage-1')!.properties as Record<string, unknown>).title = 'x'; }).toThrow(TypeError);
    expect(() => (r.model.nodes as Map<string, unknown>).set('x', {})).toThrow(TypeError);
    expect(() => (r.model.order as string[]).push('x')).toThrow(TypeError);
    expect(compilePathway({ pathway: structuredClone(MINIMAL_PATHWAY), codeMap, temporalDefaults: {} })).toEqual(r);
  });

  it('is deterministic under node and edge order', () => {
    const p = corpus('anemia-1.4.json');
    const reversed = { ...p, nodes: [...p.nodes].reverse(), edges: [...p.edges].reverse() };
    expect(compilePathway({ pathway: reversed, codeMap, temporalDefaults: {} })).toEqual(compilePathway({ pathway: p, codeMap, temporalDefaults: {} }));
  });

  it.each([
    ['a node with the reserved id "root"', { id: 'root', type: 'Stage', properties: { stage_number: 2, title: 'Shadow' } }],
    ['an authored Pathway node', { id: 'pw-2', type: 'Pathway', properties: {} }],
  ])('refuses %s instead of silently dropping it', (_label, node) => {
    const pathway = { ...MINIMAL_PATHWAY, nodes: [...MINIMAL_PATHWAY.nodes, node] } as never;
    expect(codes(compilePathway({ pathway, codeMap, temporalDefaults: {} }))).toContain(`RESERVED_ROOT:${node.id}`);
  });
});
