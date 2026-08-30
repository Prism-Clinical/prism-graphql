import { PathwayJson } from './types';
import { NodeStatus } from '../../types';
import { GateDependsOn } from '../resolution/types';

/**
 * Canonicalization for the Gate `depends_on` property.
 *
 * Background — the three layers disagreed on what `depends_on` is:
 *
 *   - The engine (`resolution/types.ts`) declares `GateDependsOn[]`, i.e.
 *     `[{ node_id, status }]`, and `evaluatePriorNodeResult` reads
 *     `dep.node_id` / `dep.status` off each element.
 *   - The import validator cast it to `string[]` and compared whole elements
 *     against the node-id set. So `"step-1-3"` imported cleanly, and the
 *     canonical `[{node_id:'step-1-3', ...}]` was REJECTED as "references
 *     nonexistent node [object Object]" — the only importable shape was the
 *     one evaluation cannot read.
 *   - The graph writer stored whatever it was handed.
 *
 * The result on live data: every `prior_node_result` gate in
 * vaginitis-in-pregnancy-v1 held the bare string `"step-1-3"`, the evaluator's
 * `for (const dep of gate.depends_on)` iterated it CHARACTER BY CHARACTER, and
 * each gate reported eight unmet phantom dependencies and never fired.
 *
 * This module is the one reader of the property. The validator uses it to
 * check the referenced ids exist; the orchestrator uses it to rewrite the
 * property before the graph writer sees it. The engine stays strict and only
 * ever accepts the canonical shape — nothing coerces at evaluation time.
 */

const VALID_STATUSES: ReadonlySet<string> = new Set(Object.values(NodeStatus));

/**
 * Read a raw `depends_on` value into the canonical shape.
 *
 * Returns `[]` when no dependency is declared (absent / null / empty array),
 * and `null` when the value is present but cannot be interpreted — the caller
 * decides whether that is a validation error or a refusal to evaluate.
 *
 * Legacy shapes accepted here (and ONLY here — never at evaluation time):
 *   - `"step-1-3"`              → `[{ node_id: 'step-1-3', status: 'INCLUDED' }]`
 *   - `["step-1-3", "step-2-2"]`→ one INCLUDED entry each
 *   - `[{ node_id: 'step-1' }]` → status defaults to INCLUDED
 *
 * INCLUDED is the only defensible default: a legacy `depends_on: "step-1-3"`
 * meant "step-1-3 was walked", which is exactly what INCLUDED encodes. Any
 * other default would silently change which branch a live pathway takes.
 */
export function parseDependsOn(raw: unknown): GateDependsOn[] | null {
  if (raw === undefined || raw === null) return [];

  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) return [];

  const out: GateDependsOn[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      // An empty id would produce a dependency that can never match any node.
      if (item.length === 0) return null;
      out.push({ node_id: item, status: NodeStatus.INCLUDED });
      continue;
    }

    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

    const rec = item as Record<string, unknown>;
    const nodeId = rec.node_id;
    if (typeof nodeId !== 'string' || nodeId.length === 0) return null;

    const status = rec.status ?? NodeStatus.INCLUDED;
    if (typeof status !== 'string' || !VALID_STATUSES.has(status)) return null;

    out.push({ node_id: nodeId, status });
  }

  return out;
}

/**
 * Rewrite every `prior_node_result` Gate's `depends_on` into the canonical
 * shape, returning a new PathwayJson — the caller's object is not mutated.
 *
 * Values `parseDependsOn` cannot interpret are left exactly as they were, so
 * the validator reports them against what the author actually wrote rather
 * than against something this function invented.
 */
export function normalizeGateDependsOn(pw: PathwayJson): PathwayJson {
  let changed = false;

  const nodes = (pw.nodes ?? []).map((node) => {
    if (node.type !== 'Gate') return node;

    const props = node.properties as Record<string, unknown> | undefined;
    if (!props || props.gate_type !== 'prior_node_result') return node;
    if (!('depends_on' in props)) return node;

    const parsed = parseDependsOn(props.depends_on);
    if (parsed === null) return node;

    changed = true;
    return { ...node, properties: { ...props, depends_on: parsed } };
  });

  return changed ? { ...pw, nodes } : pw;
}
