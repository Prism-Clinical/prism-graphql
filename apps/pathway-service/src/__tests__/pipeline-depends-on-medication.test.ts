import { validatePathwayJson } from '../services/import/validator';
import { clonePathway } from './fixtures/reference-pathway';

function withDependency(depends_on: unknown) {
  const pw = clonePathway();
  pw.nodes.push({ id: 'med-dep-target', type: 'Medication' as any, properties: { name: 'Labetalol', role: 'first_line' } });
  pw.edges.push({ from: 'step-1-1', to: 'med-dep-target', type: 'USES_MEDICATION' as any });
  pw.nodes.push({ id: 'gate-dep', type: 'Gate' as any, properties: { title: 'Dep', gate_type: 'prior_node_result', default_behavior: 'skip', depends_on } });
  pw.edges.push({ from: 'step-1-1', to: 'gate-dep', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-dep', to: 'step-1-2', type: 'BRANCHES_TO' as any });
  return validatePathwayJson(pw);
}

describe('depends_on may not target Medication (spec C2, D11)', () => {
  it('rejects a Medication target in bare-string form', () => {
    expect(withDependency(['med-dep-target']).errors).toContainEqual(expect.stringContaining('depends_on may not target Medication'));
  });

  it('rejects a Medication target in canonical form', () => {
    expect(withDependency([{ node_id: 'med-dep-target', status: 'INCLUDED' }]).errors)
      .toContainEqual(expect.stringContaining('depends_on may not target Medication'));
  });

  it('allows a Step target', () => {
    const r = withDependency([{ node_id: 'step-1-1', status: 'INCLUDED' }]);
    expect(r.errors).not.toContainEqual(expect.stringContaining('depends_on may not target Medication'));
    expect(r.errors).not.toContainEqual(expect.stringContaining('nonexistent node'));
  });
});
