// .claude/skills/pathway-json-builder/scripts/check-gate-control.ts
//
// BUILDER-ENFORCED gate-wiring check — the same category as the §17 temporal
// rules: the import validator accepts these graphs, so this runs at build time
// or the defect ships silently.
//
// It exists because a gate that evaluates perfectly can still exclude nothing.
// The traversal engine gates only a gate's OWN outgoing edges, and marking is
// first-writer-wins (`traversal-engine.ts:852`, `:990` on a428da5). So if a gate's BRANCHES_TO
// target is reachable by any other route, BFS resolves that target INCLUDED
// first and the gate's verdict is discarded — silently.
//
// Verified on anemia-in-pregnancy v1.4 (2026-09-07): all 5 gates evaluated
// correctly and not one could exclude anything. A patient with Hb 12.0 g/dL
// resolved with PRBC transfusion, oral iron and IV iron all INCLUDED, and the
// import validator reported 0 errors and 0 warnings.
//
// Usage (from repo root) — no install needed, Node runs the TS directly
// (Node >= 23 strips types; this file has no pathway-service imports):
//   node .claude/skills/pathway-json-builder/scripts/check-gate-control.ts <file.json>
//
// Exit codes: 0 = no violations, 1 = violations, 2 = could not read/parse.

// CommonJS require, not ESM import: this script has no pathway-service
// imports, so it runs under plain `node` with no ts-node and no install.
// `import` here would make Node reparse the file as ESM and warn.
const { readFileSync } = require('fs');
const { resolve } = require('path');

interface Node { id: string; type: string }
interface Edge { from: string; to: string; type: string; properties?: Record<string, unknown> }
interface Pathway { nodes?: Node[]; edges?: Edge[] }

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: check-gate-control.ts <pathway.json>');
  process.exit(2);
}

let pw: Pathway;
try {
  pw = JSON.parse(readFileSync(resolve(fileArg), 'utf8'));
} catch (err) {
  console.error(`Could not read or parse ${fileArg}: ${(err as Error).message}`);
  process.exit(2);
}

const nodes = pw.nodes ?? [];
const edges = pw.edges ?? [];
const gateIds = new Set(nodes.filter((n) => n.type === 'Gate').map((n) => n.id));
const titleOf = new Map(nodes.map((n) => [n.id, (n as any).properties?.title ?? n.id]));

// `REQUIRES` points backwards by design and is excluded from the depth calc;
// walking it would manufacture phantom routes into gated steps and produce
// false violations on correct pathways.
const walkable = edges.filter((e) => e.type !== 'REQUIRES');

/** Every gate BRANCHES_TO edge, grouped by target. */
const gatesByTarget = new Map<string, string[]>();
for (const e of walkable) {
  if (e.type === 'BRANCHES_TO' && gateIds.has(e.from)) {
    if (!gatesByTarget.has(e.to)) gatesByTarget.set(e.to, []);
    gatesByTarget.get(e.to)!.push(e.from);
  }
}

/**
 * Reachable from the literal `root` source (never declared in `nodes` — the
 * validator allows it as a special edge source), over `walkable` minus `skip`.
 */
function reachableFromRoot(skip: Set<Edge>): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of walkable) {
    if (skip.has(e)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const seen = new Set<string>(['root']);
  const queue = ['root'];
  while (queue.length > 0) {
    for (const next of adj.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

const errors: string[] = [];

// ── Rule 1 — a gated node must have its gate as the ONLY way in ──────
// Ask: ignoring EVERY gate route into T, is T still reachable? If yes, some
// unconditional (or confidence-selected) route reaches it first and the gate
// is inert.
for (const [target, gates] of gatesByTarget) {
  const gateRoutes = new Set(
    walkable.filter((e) => e.type === 'BRANCHES_TO' && e.to === target && gateIds.has(e.from)),
  );
  if (reachableFromRoot(gateRoutes).has(target)) {
    const via = walkable
      .filter((e) => e.to === target && !gateRoutes.has(e))
      .map((e) => `${e.from} -${e.type}-> ${e.to}`);
    errors.push(
      `RULE 1 — "${target}" (${titleOf.get(target)}) is gated by ${gates.map((g) => `"${g}"`).join(', ')}, ` +
      `but is ALSO reachable without them:\n      ${via.join('\n      ')}\n` +
      `      => the gate cannot exclude it. Delete the competing edge(s), or move the target behind the gate.`,
    );
  }
}

// ── Rule 2 — exactly ONE gate may point at a given target ────────────
// Subsumed by Rule 1 in reachability terms, but kept because the failure is
// different in kind and Rule 1's message would misdescribe it: on main, a target
// behind several gates is a deterministic AND — ANY gate that misses excludes it,
// in either evaluation order, and a satisfied gate cannot rescue it. There is no
// OR across gates.
for (const [target, gates] of gatesByTarget) {
  if (gates.length > 1) {
    errors.push(
      `RULE 2 — "${target}" (${titleOf.get(target)}) is the BRANCHES_TO target of ${gates.length} gates: ` +
      `${gates.map((g) => `"${g}"`).join(', ')}.\n` +
      `      => this is an AND, not an OR: any one of them missing excludes the target, and a\n` +
      `         satisfied gate cannot rescue it. Gates do not OR.\n` +
      `      => merge them into one gate, or give each its own target.`,
    );
  }
}

// ── Rule 3 — a chart gate has exactly ONE target; a router maps every edge ──
// PR #55 made a gate with several BRANCHES_TO edges a ROUTER: it takes exactly
// the one edge whose `when` matches the gate's answer. A patient_attribute /
// compound / prior_node_result gate has no answer to match, so the validator
// rejects it outright, and a router without `when` on every edge takes no edge
// at all at runtime (`unroutable_decision`). The import validator catches both
// on main; they are repeated here so a stale checkout cannot hide them, and so
// the message names the fan-out fix rather than the routing grammar.
const CHART_GATE_TYPES = new Set(['patient_attribute', 'compound', 'prior_node_result']);
const ROUTER_GATE_TYPES = new Set(['question', 'llm_text_analysis']);
for (const node of nodes) {
  if (node.type !== 'Gate') continue;
  const props = (node as any).properties ?? {};
  const gateType = String(props.gate_type ?? '').toLowerCase();
  const out = walkable.filter((e) => e.from === node.id && e.type === 'BRANCHES_TO');
  if (out.length <= 1) continue;
  if (CHART_GATE_TYPES.has(gateType)) {
    errors.push(
      `RULE 3 — "${node.id}" (${titleOf.get(node.id)}) is a ${gateType} gate with ${out.length} ` +
      `BRANCHES_TO targets: ${out.map((e) => `"${e.to}"`).join(', ')}.\n` +
      `      => a chart gate yields no answer to route on; main rejects it at import.\n` +
      `      => fan out instead: one identical-condition gate per target (cross-stage), or ONE target\n` +
      `         that is a branch-entry-only Stage HAS_STEP-ing the several steps (same-stage).`,
    );
  } else if (ROUTER_GATE_TYPES.has(gateType)) {
    const unmapped = out.filter((e) => (e as any).properties?.when == null);
    if (unmapped.length > 0) {
      errors.push(
        `RULE 3 — "${node.id}" (${titleOf.get(node.id)}) routes to ${out.length} targets, but ` +
        `${unmapped.map((e) => `"${e.to}"`).join(', ')} carry no \`when\`.\n` +
        `      => a router takes exactly the edge whose \`when\` matches the answer; without one it takes none.\n` +
        `      => if every target should open on "yes", this is fan-out, not routing: give the gate ONE\n` +
        `         target (a branch-entry-only Stage holding the steps). Duplicating a question gate asks twice.`,
      );
    }
  }
}

// ── Advisory — a gate whose target has no other route is fine, but a gate
// with no BRANCHES_TO at all guards nothing. ─────────────────────────
const warnings = [...gateIds]
  .filter((g) => !walkable.some((e) => e.from === g && e.type === 'BRANCHES_TO'))
  .map((g) => `Gate "${g}" (${titleOf.get(g)}) has no BRANCHES_TO edge — it guards nothing.`);

// ── Advisory — baseline drift on trend gates ─────────────────────────
// A lone long trend window fits every dated point in it, including pre-treatment
// values from a different physiologic state, and can invert the verdict. See the
// spec's "Baseline drift" box. Advisory only: some values genuinely have no drift.
const LONG = 180;
const SHORT = 90;
for (const node of nodes) {
  if (node.type !== 'Gate') continue;
  const props = (node as any).properties ?? {};
  const conds: any[] = [
    ...(props.condition ? [props.condition] : []),
    ...(Array.isArray(props.conditions) ? props.conditions : []),
  ];
  const trends = conds.filter(
    (c) => (c?.operator === 'trend_up' || c?.operator === 'trend_down') && typeof c.window_days === 'number',
  );
  if (trends.length === 0) continue;
  for (const t of trends) {
    if (t.window_days <= LONG) continue;
    const hasShort = trends.some((o) => o.value === t.value && o.window_days <= SHORT);
    if (!hasShort) {
      warnings.push(
        `Gate "${node.id}" (${titleOf.get(node.id)}): ${t.operator} on ${t.value} uses a lone ` +
        `${t.window_days}-day window with no shorter companion.\n` +
        `      If this value drifts physiologically, a pre-treatment reading inside that window ` +
        `drags the slope and can invert the verdict.\n` +
        `      Consider layering the same trend at short/mid/long lookbacks under OR (tiering ` +
        `slope_threshold), plus an absolute-target condition.`,
      );
    }
  }
}

// ── Advisory — Rule 3 fan-out copies must stay identical ────────────
// A cross-stage fan-out is authored as `gate-x` plus `gate-x-<suffix>` copies with
// identical conditions. Editing one and not the others silently splits the verdict.
const evalShape = (props: any): string => JSON.stringify({
  gate_type: props.gate_type, default_behavior: props.default_behavior,
  on_unresolved: props.on_unresolved, operator: props.operator,
  condition: props.condition, conditions: props.conditions,
  prompt: props.prompt, answer_type: props.answer_type,
});
const gateNodes = nodes.filter((n) => n.type === 'Gate');
for (const base of gateNodes) {
  for (const copy of gateNodes) {
    if (copy.id === base.id || !copy.id.startsWith(`${base.id}-`)) continue;
    if (evalShape((copy as any).properties ?? {}) !== evalShape((base as any).properties ?? {})) {
      warnings.push(
        `Gate "${copy.id}" looks like a Rule 3 fan-out copy of "${base.id}" but its evaluable ` +
        `properties differ.\n      If it is a copy, re-sync it; if not, rename it so the prefix does not imply one.`,
      );
    }
  }
}

for (const w of warnings) console.log(`⚠ ${w}`);

if (errors.length === 0) {
  console.log(`✓ GATE CONTROL OK — ${gateIds.size} gate(s), ${gatesByTarget.size} gated target(s), no violations (rules 1-3)`);
  process.exit(0);
}
console.log(`✗ GATE CONTROL — ${errors.length} violation(s):`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(1);
