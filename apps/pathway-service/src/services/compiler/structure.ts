// apps/pathway-service/src/services/compiler/structure.ts
import { edgeKindOf } from './kinds';
import type { ArmRef, CompileError, GraphEdgeIn, NodeKind } from './model';

export interface Structure {
  containers: Map<string, string[]>;
  guards: Map<string, ArmRef[]>;
  owners: Map<string, string[]>;
  order: string[];
  annotationOrder: string[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

/** Kahn's algorithm with a sorted ready set: the order depends only on the graph, never on input order. */
function topo(ids: string[], deps: Map<string, Set<string>>): { order: string[]; stuck: string[] } {
  const members = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const id of ids) {
    for (const before of deps.get(id) ?? []) {
      if (!members.has(before)) continue;
      indegree.set(id, indegree.get(id)! + 1);
      push(next, before, id);
    }
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const n of next.get(id) ?? []) {
      indegree.set(n, indegree.get(n)! - 1);
      if (indegree.get(n) === 0) { ready.push(n); ready.sort(); } // ponytail: O(n² log n) worst case; fine for a few hundred nodes
    }
  }
  const placed = new Set(order);
  return { order, stuck: ids.filter((id) => !placed.has(id)).sort() };
}

export function buildStructure(
  kinds: Map<string, NodeKind>,
  edges: GraphEdgeIn[],
  dataDeps: Map<string, string[]>,
  errors: CompileError[],
): Structure {
  const containers = new Map<string, string[]>();
  const guards = new Map<string, ArmRef[]>();
  const owners = new Map<string, string[]>();
  const forward = new Map<string, string[]>();
  const deps = new Map<string, Set<string>>();
  const follow = (node: string, before: string) => {
    const s = deps.get(node) ?? new Set<string>();
    s.add(before);
    deps.set(node, s);
  };

  for (const edge of edges) {
    const kind = edgeKindOf(edge.type);
    if (kind === 'contains') {
      push(containers, edge.to, edge.from); push(forward, edge.from, edge.to); follow(edge.to, edge.from);
    } else if (kind === 'guards') {
      push(guards, edge.to, { controller: edge.from, armId: `${edge.from}->${edge.to}` });
      push(forward, edge.from, edge.to); follow(edge.to, edge.from);
    } else if (kind === 'owns') {
      push(owners, edge.to, edge.from);
    }
  }
  for (const [gate, targets] of dataDeps) for (const t of targets) follow(gate, t);

  const semantic = [...kinds].filter(([, k]) => k !== 'annotation').map(([id]) => id);
  const annotations = [...kinds].filter(([, k]) => k === 'annotation').map(([id]) => id);

  // V2: every semantic node reachable from the root; every annotation owned.
  const seen = new Set<string>(['root']);
  const stack = ['root'];
  while (stack.length > 0) {
    for (const n of forward.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  for (const id of semantic.filter((x) => !seen.has(x)).sort()) {
    errors.push({ code: 'UNREACHABLE', nodeId: id, message: `Node "${id}" is not reachable from the pathway root through containment or branch edges` });
  }
  for (const id of annotations.filter((x) => !(owners.get(x)?.length)).sort()) {
    errors.push({ code: 'ORPHAN_ANNOTATION', nodeId: id, message: `Annotation "${id}" has no owner (HAS_CRITERION, CITES_EVIDENCE or HAS_CODE)` });
  }

  // V3: one order for semantic nodes, one for annotations.
  const sem = topo(semantic, deps);
  if (sem.stuck.length > 0) {
    errors.push({ code: 'CYCLE', message: `Cycle through containment, branch or depends_on edges involving: ${sem.stuck.join(', ')}` });
  }
  const annotationDeps = new Map(annotations.map((id) => [
    id, new Set((owners.get(id) ?? []).filter((o) => kinds.get(o) === 'annotation')),
  ]));
  const ann = topo(annotations, annotationDeps);
  if (ann.stuck.length > 0) {
    errors.push({ code: 'CYCLE', message: `Cycle through ownership edges involving: ${ann.stuck.join(', ')}` });
  }

  for (const m of [containers, owners]) for (const [k, v] of m) m.set(k, [...new Set(v)].sort());
  for (const [k, v] of guards) {
    guards.set(k, [...new Map(v.map((a) => [a.armId, a])).values()].sort((a, b) => (a.armId < b.armId ? -1 : 1)));
  }
  return { containers, guards, owners, order: sem.order, annotationOrder: ann.order };
}
