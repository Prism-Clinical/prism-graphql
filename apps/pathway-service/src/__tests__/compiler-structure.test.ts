// apps/pathway-service/src/__tests__/compiler-structure.test.ts
import { buildStructure } from '../services/compiler/structure';
import type { CompileError, GraphEdgeIn, NodeKind } from '../services/compiler/model';

const e = (from: string, to: string, type: string): GraphEdgeIn => ({ from, to, type, properties: {} });
const run = (kinds: Record<string, NodeKind>, edges: GraphEdgeIn[], deps: Record<string, string[]> = {}) => {
  const errors: CompileError[] = [];
  const s = buildStructure(new Map(Object.entries(kinds)), edges, new Map(Object.entries(deps)), errors);
  return { s, errors };
};
const shuffle = <T>(xs: T[], seed: number) => xs.map((x, i) => ({ x, k: (i * 7919 + seed * 104729) % 1009 })).sort((a, b) => a.k - b.k).map((p) => p.x);

describe('buildStructure', () => {
  // The live anemia shape: step-3-3 is both stage-contained and gate-guarded.
  const kinds: Record<string, NodeKind> = {
    root: 'root', 'stage-3': 'container', 'gate-severe': 'gate', 'step-3-3': 'container', 'proc-1': 'action',
    'z-med': 'action', 'a-code': 'annotation', 'crit-1': 'annotation', 'ev-1': 'annotation', 'dp-1': 'choice',
  };
  const edges = [
    e('root', 'stage-3', 'HAS_STAGE'), e('stage-3', 'gate-severe', 'HAS_GATE'), e('stage-3', 'step-3-3', 'HAS_STEP'),
    e('gate-severe', 'step-3-3', 'BRANCHES_TO'), e('step-3-3', 'proc-1', 'HAS_PROCEDURE'),
    e('stage-3', 'dp-1', 'HAS_DECISION_POINT'), e('dp-1', 'crit-1', 'HAS_CRITERION'), e('crit-1', 'ev-1', 'CITES_EVIDENCE'),
    e('proc-1', 'ev-1', 'CITES_EVIDENCE'), e('step-3-3', 'z-med', 'USES_MEDICATION'), e('z-med', 'a-code', 'HAS_CODE'),
    e('crit-1', 'step-3-3', 'SELECTS_BRANCH'),
  ];

  it('records containers and guards separately', () => {
    const { s, errors } = run(kinds, edges);
    expect(errors).toEqual([]);
    expect(s.containers.get('step-3-3')).toEqual(['stage-3']);
    expect(s.guards.get('step-3-3')).toEqual([{ controller: 'gate-severe', armId: 'gate-severe->step-3-3' }]);
  });

  it('orders every node after all of its parents, and annotations after their annotation owners', () => {
    const { s } = run(kinds, edges);
    const at = (id: string) => s.order.indexOf(id);
    expect(at('gate-severe')).toBeLessThan(at('step-3-3'));
    expect(at('stage-3')).toBeLessThan(at('step-3-3'));
    expect(s.order).not.toContain('crit-1');
    expect(s.annotationOrder.indexOf('crit-1')).toBeLessThan(s.annotationOrder.indexOf('ev-1'));
    expect(s.owners.get('ev-1')).toEqual(['crit-1', 'proc-1']);          // shared evidence, sorted
    expect(s.owners.get('a-code')).toEqual(['z-med']);                    // adversarial id order
  });

  it('is independent of edge order', () => {
    const base = run(kinds, edges).s;
    for (const seed of [1, 2, 3, 4, 5]) expect(run(kinds, shuffle(edges, seed)).s).toEqual(base);
  });

  it('orders a depends_on target before the gate that reads it', () => {
    const k: Record<string, NodeKind> = { root: 'root', stage: 'container', 'a-gate-dep': 'gate', 'z-step': 'container', 'b-step': 'container' };
    const { s, errors } = run(k, [
      e('root', 'stage', 'HAS_STAGE'), e('stage', 'a-gate-dep', 'HAS_GATE'), e('stage', 'z-step', 'HAS_STEP'),
      e('a-gate-dep', 'b-step', 'BRANCHES_TO'),
    ], { 'a-gate-dep': ['z-step'] });
    expect(errors).toEqual([]);
    expect(s.order.indexOf('z-step')).toBeLessThan(s.order.indexOf('a-gate-dep'));
  });

  it('rejects unreachable nodes and orphan annotations; SELECTS_BRANCH does not reach', () => {
    const { errors } = run(
      { root: 'root', stage: 'container', crit: 'annotation', lonely: 'container', ev: 'annotation' },
      [e('root', 'stage', 'HAS_STAGE'), e('crit', 'lonely', 'SELECTS_BRANCH')],
    );
    expect(errors.map((x) => [x.code, x.nodeId])).toEqual([
      ['UNREACHABLE', 'lonely'], ['ORPHAN_ANNOTATION', 'crit'], ['ORPHAN_ANNOTATION', 'ev'],
    ]);
  });

  it('rejects a cycle created by depends_on', () => {
    const { errors } = run(
      { root: 'root', stage: 'container', gate: 'gate', step: 'container' },
      [e('root', 'stage', 'HAS_STAGE'), e('stage', 'gate', 'HAS_GATE'), e('gate', 'step', 'BRANCHES_TO')],
      { gate: ['step'] },
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'CYCLE', message: expect.stringContaining('gate, step') })]);
  });
});
