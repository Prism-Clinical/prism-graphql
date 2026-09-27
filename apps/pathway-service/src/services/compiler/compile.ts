// apps/pathway-service/src/services/compiler/compile.ts
import { validatePathwayJson } from '../import/validator';
import { buildDatumRegistry, resolveDatums } from './datums';
import { compileChoice, compileGate } from './gates';
import { edgeKindOf, nodeKindOf } from './kinds';
import {
  COMPILER_VERSION, CompileError, CompileInput, CompileResult, CompiledNode, DatumKey, DatumSpec, GraphEdgeIn, GraphNodeIn, NodeKind,
} from './model';
import { buildStructure } from './structure';
import { checkTemporal } from './temporal';
import { deepFreeze, FrozenMap } from './immutable';

/**
 * Authored or stored pathway → CompiledPathway (spec §3). Pure. Runs the strict
 * import validator first, so there is one set of authoring rules; the
 * compiler's own rules (V2, V3, V5-Q13, V7, V8 strict, V9, V10) follow.
 */
export function compilePathway(input: CompileInput): CompileResult {
  // Own the input: nothing in the result may alias the caller's objects.
  const pathway = structuredClone(input.pathway);
  const { codeMap, temporalDefaults } = input;
  const errors: CompileError[] = validatePathwayJson(pathway, { draftMode: false }).errors
    .map((message) => ({ code: 'VALIDATION' as const, message }));

  // Authored JSON addresses the root as "root" in edges and never lists it.
  const nodes: GraphNodeIn[] = [
    { id: 'root', type: 'Pathway', properties: {} },
    ...(pathway.nodes ?? []).filter((n) => n.id !== 'root').map((n) => ({ id: n.id, type: n.type as string, properties: n.properties ?? {} })),
  ];
  const edges: GraphEdgeIn[] = (pathway.edges ?? []).map((e) => ({ from: e.from, to: e.to, type: e.type as string, properties: e.properties ?? {} }));

  const kinds = new Map<string, NodeKind>();
  const nodeTypes = new Map(nodes.map((n) => [n.id, n.type]));
  for (const n of nodes) {
    const kind = nodeKindOf(n.type, n.properties);
    if (kind) kinds.set(n.id, kind);
    else errors.push({ code: 'UNKNOWN_NODE_TYPE', nodeId: n.id, message: `Node "${n.id}": unknown type "${n.type}"` });
  }
  for (const e of edges) {
    if (!edgeKindOf(e.type)) errors.push({ code: 'UNKNOWN_EDGE_TYPE', message: `Edge ${e.from} -> ${e.to}: unknown type "${e.type}"` });
  }

  const armsOf = (id: string) => edges.filter((e) => e.from === id && edgeKindOf(e.type) === 'guards');
  const compiled = new Map<string, CompiledNode>();
  const dataDeps = new Map<string, string[]>();
  const datums = new Map<DatumKey, DatumSpec>();
  const registry = buildDatumRegistry(codeMap);
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const kind = kinds.get(n.id);
    if (!kind) continue;
    if (kind === 'gate') {
      const g = compileGate(n.id, n.properties, armsOf(n.id), kinds, nodeTypes, errors);
      if (!g) continue;
      compiled.set(n.id, { kind, id: n.id, nodeType: 'Gate', properties: n.properties, gate: g.gate, arms: g.arms });
      if (g.gate.type === 'prior_result') dataDeps.set(n.id, g.gate.dependsOn.map((d) => d.nodeId));
      if (g.gate.type === 'condition') resolveDatums(n.id, g.gate.conditions, codeMap, registry, datums, errors);
    } else if (kind === 'choice') {
      const c = compileChoice(n.id, n.properties, armsOf(n.id), errors);
      compiled.set(n.id, { kind, id: n.id, nodeType: 'DecisionPoint', properties: n.properties, mode: c.mode, arms: c.arms });
    } else {
      compiled.set(n.id, { kind, id: n.id, nodeType: n.type, properties: n.properties });
    }
  }

  const structure = buildStructure(kinds, edges, dataDeps, errors);
  const requiresEncounterAnchor = checkTemporal(nodes, codeMap, temporalDefaults, errors);
  if (errors.length > 0) return deepFreeze({ ok: false as const, errors });
  return deepFreeze({
    ok: true as const,
    model: {
      compilerVersion: COMPILER_VERSION,
      nodes: new FrozenMap(compiled),
      datums: new FrozenMap(datums),
      requiresEncounterAnchor,
      order: structure.order,
      annotationOrder: structure.annotationOrder,
      containers: new FrozenMap(structure.containers),
      guards: new FrozenMap(structure.guards),
      owners: new FrozenMap(structure.owners),
    },
  });
}
