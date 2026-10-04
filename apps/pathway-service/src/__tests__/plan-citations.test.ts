/**
 * Citations for plan lines, read from a pathway graph: a recommendation's own
 * CITES_EVIDENCE first, else the citations of the step that holds it.
 */

import { citationsForNodes } from '../services/resolution/plan-citations';
import type { GraphEdge, GraphNode } from '../services/confidence/types';

const node = (nodeIdentifier: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode => ({
  id: nodeIdentifier,
  nodeIdentifier,
  nodeType,
  properties,
});
const edge = (sourceId: string, edgeType: string, targetId: string): GraphEdge => ({
  id: `${sourceId}-${edgeType}-${targetId}`,
  edgeType,
  sourceId,
  targetId,
  properties: {},
});

const graph = {
  nodes: [
    node('step-1', 'Step', { title: 'Start oral iron' }),
    node('step-2', 'Step', { title: 'Recheck' }),
    node('med-1', 'Medication', { name: 'Ferrous sulfate' }),
    node('lab-1', 'LabTest', { name: 'CBC' }),
    node('guid-1', 'Guidance', { topic: 'Uncited' }),
    node('ev-2', 'EvidenceCitation', {
      reference_number: 2,
      title: 'Screening and Supplementation for Iron Deficiency',
      authors: 'USPSTF',
      year: 2024,
      url: 'https://example.org/uspstf',
      evidence_level: 'Level B',
    }),
    node('ev-1', 'EvidenceCitation', {
      reference_number: 1,
      title: 'Anemia in Pregnancy: ACOG Practice Bulletin No. 233',
      authors: 'ACOG',
      year: '2021',
      source: 'Obstetrics & Gynecology 138:e55–64',
      url: 'https://example.org/pb233',
    }),
    node('ev-untitled', 'EvidenceCitation', { reference_number: 3, authors: 'Nobody' }),
  ],
  edges: [
    edge('step-1', 'USES_MEDICATION', 'med-1'),
    edge('step-1', 'HAS_LAB_TEST', 'lab-1'),
    edge('step-2', 'HAS_GUIDANCE', 'guid-1'),
    edge('step-2', 'REQUIRES', 'step-1'),
    edge('med-1', 'CITES_EVIDENCE', 'ev-2'),
    edge('med-1', 'CITES_EVIDENCE', 'ev-1'),
    edge('med-1', 'CITES_EVIDENCE', 'ev-untitled'),
    edge('step-1', 'CITES_EVIDENCE', 'ev-2'),
  ],
};

describe('citationsForNodes', () => {
  it("returns a recommendation's own citations, in reference order, with the authored fields", () => {
    const [med] = citationsForNodes(graph, ['med-1']);
    expect(med).toEqual({
      nodeId: 'med-1',
      from: 'ITEM',
      stepTitle: null,
      citations: [
        {
          referenceNumber: 1,
          title: 'Anemia in Pregnancy: ACOG Practice Bulletin No. 233',
          authors: 'ACOG',
          // A year stored as text is still a year.
          year: 2021,
          source: 'Obstetrics & Gynecology 138:e55–64',
          url: 'https://example.org/pb233',
          evidenceLevel: null,
        },
        {
          referenceNumber: 2,
          title: 'Screening and Supplementation for Iron Deficiency',
          authors: 'USPSTF',
          year: 2024,
          source: null,
          url: 'https://example.org/uspstf',
          evidenceLevel: 'Level B',
        },
      ],
    });
  });

  it("falls back to the holding step's citations, and says so", () => {
    const [lab] = citationsForNodes(graph, ['lab-1']);
    expect(lab.from).toBe('STEP');
    expect(lab.stepTitle).toBe('Start oral iron');
    expect(lab.citations.map((c) => c.referenceNumber)).toEqual([2]);
  });

  it('leaves out a node with no citation of its own or of its step', () => {
    // step-2 cites nothing; its REQUIRES edge to step-1 is ordering, not ownership.
    expect(citationsForNodes(graph, ['guid-1', 'step-1-missing'])).toEqual([]);
  });

  it('answers each requested node once', () => {
    expect(citationsForNodes(graph, ['med-1', 'med-1', 'lab-1']).map((c) => c.nodeId)).toEqual(['med-1', 'lab-1']);
  });
});
