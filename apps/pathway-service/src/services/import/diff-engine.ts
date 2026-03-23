import {
  PathwayJson,
  PathwayNodeDefinition,
  PathwayEdgeDefinition,
  ImportDiffSummary,
  DiffDetail,
  PropertyChange,
} from './types';

export interface DiffResult {
  summary: ImportDiffSummary;
  details: DiffDetail[];
}

/**
 * Compute the diff between an existing pathway and an incoming one.
 * Nodes are matched by `id`. Edges are matched by `(from, to, type)` tuple.
 */
export function computeDiff(existing: PathwayJson, incoming: PathwayJson): DiffResult {
  const details: DiffDetail[] = [];

  // ─── Node diffs ─────────────────────────────────────────────────
  const existingNodes = new Map<string, PathwayNodeDefinition>();
  for (const node of existing.nodes) {
    existingNodes.set(node.id, node);
  }

  const incomingNodes = new Map<string, PathwayNodeDefinition>();
  for (const node of incoming.nodes) {
    incomingNodes.set(node.id, node);
  }

  let nodesAdded = 0;
  let nodesRemoved = 0;
  let nodesModified = 0;

  // Check for added and modified nodes
  for (const [id, inNode] of incomingNodes) {
    const exNode = existingNodes.get(id);
    if (!exNode) {
      nodesAdded++;
      details.push({ entityType: 'node', action: 'added', entityId: id, entityLabel: inNode.type });
    } else {
      const changes = diffProperties(exNode.properties, inNode.properties);
      if (changes.length > 0) {
        nodesModified++;
        details.push({ entityType: 'node', action: 'modified', entityId: id, entityLabel: inNode.type, changes });
      }
    }
  }

  // Check for removed nodes
  for (const [id, exNode] of existingNodes) {
    if (!incomingNodes.has(id)) {
      nodesRemoved++;
      details.push({ entityType: 'node', action: 'removed', entityId: id, entityLabel: exNode.type });
    }
  }

  // ─── Edge diffs ─────────────────────────────────────────────────
  const edgeKey = (e: PathwayEdgeDefinition) => `${e.from}|${e.to}|${e.type}`;

  const existingEdges = new Map<string, PathwayEdgeDefinition>();
  for (const edge of existing.edges) {
    existingEdges.set(edgeKey(edge), edge);
  }

  const incomingEdges = new Map<string, PathwayEdgeDefinition>();
  for (const edge of incoming.edges) {
    incomingEdges.set(edgeKey(edge), edge);
  }

  let edgesAdded = 0;
  let edgesRemoved = 0;
  let edgesModified = 0;

  // Check for added and modified edges
  for (const [key, inEdge] of incomingEdges) {
    const exEdge = existingEdges.get(key);
    if (!exEdge) {
      edgesAdded++;
      details.push({ entityType: 'edge', action: 'added', entityId: key, entityLabel: inEdge.type });
    } else {
      const changes = diffProperties(exEdge.properties || {}, inEdge.properties || {});
      if (changes.length > 0) {
        edgesModified++;
        details.push({ entityType: 'edge', action: 'modified', entityId: key, entityLabel: inEdge.type, changes });
      }
    }
  }

  // Check for removed edges
  for (const [key, exEdge] of existingEdges) {
    if (!incomingEdges.has(key)) {
      edgesRemoved++;
      details.push({ entityType: 'edge', action: 'removed', entityId: key, entityLabel: exEdge.type });
    }
  }

  return {
    summary: { nodesAdded, nodesRemoved, nodesModified, edgesAdded, edgesRemoved, edgesModified },
    details,
  };
}

/**
 * Diff two property objects, returning a list of changed properties.
 */
function diffProperties(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>
): PropertyChange[] {
  const changes: PropertyChange[] = [];
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

  for (const key of allKeys) {
    const oldVal = oldProps[key];
    const newVal = newProps[key];

    if (!deepEqual(oldVal, newVal)) {
      changes.push({ property: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  // Use stable-sorted stringify to handle property order differences
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
}
