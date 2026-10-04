/**
 * The guideline citations behind a plan line, read from the pathway graph.
 *
 * Not part of the projection, on purpose. The projection works from a
 * `ResolutionState`, which carries the EvidenceCitation nodes but none of the
 * CITES_EVIDENCE edges (a citation's `parentNodeId` names only the first owner
 * the traversal reached), and everything the projection emits is hashed into
 * the run's `resultHash`. Citations are reference material, not something a
 * provider's review depends on, so they are looked up at read time instead and
 * never move a hash.
 *
 * Pure: the caller loads the graph.
 */

import type { GraphEdge, GraphNode } from '../confidence/types';

export interface PlanCitation {
  referenceNumber: number | null;
  title: string;
  authors: string | null;
  year: number | null;
  /** Journal / publisher line as authored, e.g. "Obstetrics & Gynecology 138:e55–64". */
  source: string | null;
  url: string | null;
  evidenceLevel: string | null;
}

export interface NodeCitations {
  nodeId: string;
  /**
   * 'ITEM' when the recommendation cites the evidence itself; 'STEP' when it
   * cites none and these are the citations of the step that holds it.
   */
  from: 'ITEM' | 'STEP';
  /** The step's title when `from` is 'STEP'. */
  stepTitle: string | null;
  citations: PlanCitation[];
}

const CITES = 'CITES_EVIDENCE';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

function toCitation(node: GraphNode): PlanCitation | null {
  const p = node.properties ?? {};
  const title = str(p.title);
  // A citation with no title cannot be named to a clinician; leave it out.
  if (!title) return null;
  return {
    referenceNumber: int(p.reference_number),
    title,
    authors: str(p.authors),
    year: int(p.year),
    source: str(p.source),
    url: str(p.url),
    evidenceLevel: str(p.evidence_level),
  };
}

/**
 * For each requested node: the evidence it cites, in reference-number order.
 * A node that cites nothing falls back to the Step that holds it (the source
 * of its HAS_* / USES_MEDICATION edge), and says so. A node with no citation
 * either way is left out — nothing is invented for it.
 */
export function citationsForNodes(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  nodeIds: string[],
): NodeCitations[] {
  const byId = new Map(graph.nodes.map((n) => [n.nodeIdentifier, n]));
  const citedBy = new Map<string, string[]>();
  const holders = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.edgeType === CITES) {
      citedBy.set(e.sourceId, [...(citedBy.get(e.sourceId) ?? []), e.targetId]);
    } else if (e.edgeType !== 'REQUIRES' && byId.get(e.sourceId)?.nodeType === 'Step') {
      // REQUIRES is an ordering constraint between steps, not ownership.
      holders.set(e.targetId, [...(holders.get(e.targetId) ?? []), e.sourceId]);
    }
  }

  const cited = (id: string): PlanCitation[] => {
    const seen = new Set<string>();
    const out: PlanCitation[] = [];
    for (const target of citedBy.get(id) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      const node = byId.get(target);
      const c = node && node.nodeType === 'EvidenceCitation' ? toCitation(node) : null;
      if (c) out.push(c);
    }
    // Unnumbered citations keep their authored order, after the numbered ones.
    return out.sort((a, b) => (a.referenceNumber ?? Infinity) - (b.referenceNumber ?? Infinity));
  };

  const out: NodeCitations[] = [];
  for (const nodeId of [...new Set(nodeIds)]) {
    const own = cited(nodeId);
    if (own.length > 0) {
      out.push({ nodeId, from: 'ITEM', stepTitle: null, citations: own });
      continue;
    }
    for (const stepId of holders.get(nodeId) ?? []) {
      const viaStep = cited(stepId);
      if (viaStep.length === 0) continue;
      const step = byId.get(stepId);
      out.push({ nodeId, from: 'STEP', stepTitle: str(step?.properties?.title) ?? str(step?.properties?.name), citations: viaStep });
      break;
    }
  }
  return out;
}
