import { computeDiff } from '../services/import/diff-engine';
import { MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

describe('computeDiff', () => {
  it('should report no changes for identical pathways', () => {
    const diff = computeDiff(MINIMAL_PATHWAY, MINIMAL_PATHWAY);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.nodesRemoved).toBe(0);
    expect(diff.summary.nodesModified).toBe(0);
    expect(diff.summary.edgesAdded).toBe(0);
    expect(diff.summary.edgesRemoved).toBe(0);
    expect(diff.summary.edgesModified).toBe(0);
    expect(diff.details).toHaveLength(0);
  });

  it('should detect added nodes', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes.push({
      id: 'step-1-2',
      type: 'Step',
      properties: { stage_number: 1, step_number: 2, display_number: '1.2', title: 'New Step' },
    });

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.details).toContainEqual(
      expect.objectContaining({ entityType: 'node', action: 'added', entityId: 'step-1-2' })
    );
  });

  it('should detect removed nodes', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes = incoming.nodes.filter(n => n.id !== 'step-1-1');
    // Also remove edges referencing the removed node
    incoming.edges = incoming.edges.filter(e => e.to !== 'step-1-1');

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.details).toContainEqual(
      expect.objectContaining({ entityType: 'node', action: 'removed', entityId: 'step-1-1' })
    );
  });

  it('should detect modified node properties', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes[0].properties.title = 'Updated Assessment';

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.nodesModified).toBe(1);
    const modified = diff.details.find(d => d.action === 'modified' && d.entityType === 'node');
    expect(modified).toBeDefined();
    expect(modified!.changes).toContainEqual(
      expect.objectContaining({ property: 'title', oldValue: 'Assessment', newValue: 'Updated Assessment' })
    );
  });

  it('should detect added edges', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.nodes.push({
      id: 'ev-1',
      type: 'EvidenceCitation',
      properties: { reference_number: 1, title: 'Test', evidence_level: 'Level A' },
    });
    incoming.edges.push({ from: 'step-1-1', to: 'ev-1', type: 'CITES_EVIDENCE' });

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesAdded).toBe(1);
    expect(diff.summary.nodesAdded).toBe(1);
  });

  it('should detect removed edges', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.edges = incoming.edges.filter(e => e.type !== 'HAS_STEP');

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesRemoved).toBe(1);
  });

  it('should detect modified edge properties', () => {
    const incoming = clonePathway(MINIMAL_PATHWAY);
    incoming.edges[0].properties = { order: 99 };

    const diff = computeDiff(MINIMAL_PATHWAY, incoming);
    expect(diff.summary.edgesModified).toBe(1);
  });
});
