// apps/pathway-service/src/__tests__/compiler-kinds.test.ts
import { REQUIRED_NODE_PROPERTIES, VALID_EDGE_ENDPOINTS } from '../services/import/types';
import { edgeKindOf, nodeKindOf } from '../services/compiler/kinds';

describe('compiler kind tables', () => {
  it('gives every authorable edge type exactly one kind', () => {
    for (const type of Object.keys(VALID_EDGE_ENDPOINTS)) expect(edgeKindOf(type)).not.toBeNull();
  });

  it('gives every authorable node type a kind', () => {
    for (const type of Object.keys(REQUIRED_NODE_PROPERTIES)) expect(nodeKindOf(type, {})).not.toBeNull();
  });

  it('maps the spec §3.3 table', () => {
    expect(edgeKindOf('HAS_STEP')).toBe('contains');
    expect(edgeKindOf('HAS_GATE')).toBe('contains');
    expect(edgeKindOf('BRANCHES_TO')).toBe('guards');
    expect(edgeKindOf('CITES_EVIDENCE')).toBe('owns');
    expect(edgeKindOf('SELECTS_BRANCH')).toBe('references');
    expect(edgeKindOf('REQUIRES')).toBe('prerequisite');
    expect(edgeKindOf('ESCALATES_TO')).toBe('alternative');
    expect(edgeKindOf('HAS_CHILD')).toBeNull();
  });

  it('classifies a contraindicated or avoid Medication as a constraint (V10)', () => {
    expect(nodeKindOf('Medication', { role: 'first_line' })).toBe('action');
    expect(nodeKindOf('Medication', { role: 'contraindicated' })).toBe('constraint');
    expect(nodeKindOf('Medication', { role: 'avoid' })).toBe('constraint');
    expect(nodeKindOf('Pathway', {})).toBe('root');
    expect(nodeKindOf('Schedule', {})).toBe('item');
    expect(nodeKindOf('Criterion', {})).toBe('annotation');
    expect(nodeKindOf('Monitoring', {})).toBeNull();
  });
});
