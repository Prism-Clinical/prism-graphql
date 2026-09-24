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
//   node .claude/skills/pathway-json-builder/scripts/check-gate-control.ts <file.json> [--brief <brief.md>]
//
// Some lints accept a documented exception, and the exception lives in the
// research brief as a marker (see "Brief markers" in the format spec). The brief
// is found at `<json dir>/../briefs/<logical_id>-research-brief.md` unless
// `--brief` names it. It is read only when a marker is actually needed, so a
// pathway that needs no exception checks without one.
//
// Exit codes: 0 = no violations, 1 = violations, 2 = could not read/parse.

// CommonJS require, not ESM import: this script has no pathway-service
// imports, so it runs under plain `node` with no ts-node and no install.
// `import` here would make Node reparse the file as ESM and warn.
const { readFileSync, existsSync } = require('fs');
const { resolve, dirname, join } = require('path');

interface Node { id: string; type: string }
interface Edge { from: string; to: string; type: string; properties?: Record<string, unknown> }
interface Pathway { pathway?: { logical_id?: string }; nodes?: Node[]; edges?: Edge[] }

const argv = process.argv.slice(2);
const briefFlag = argv.indexOf('--brief');
const briefArg: string | undefined = briefFlag >= 0 ? argv[briefFlag + 1] : undefined;
const fileArg = argv.find((a, i) => !a.startsWith('--') && (briefFlag < 0 || i !== briefFlag + 1));
if (!fileArg) {
  console.error('Usage: check-gate-control.ts <pathway.json> [--brief <brief.md>]');
  process.exit(2);
}

let pw: Pathway;
try {
  pw = JSON.parse(readFileSync(resolve(fileArg), 'utf8'));
} catch (err) {
  console.error(`Could not read or parse ${fileArg}: ${(err as Error).message}`);
  process.exit(2);
}

// ── Brief markers ─────────────────────────────────────────────────────
// Lazily loaded: `undefined` = not looked for yet, `null` = looked, not found.
let briefCache: { path: string; text: string } | null | undefined;
function brief(): { path: string; text: string } | null {
  if (briefCache !== undefined) return briefCache;
  const candidate = briefArg
    ? resolve(briefArg)
    : pw.pathway?.logical_id
      ? join(dirname(resolve(fileArg)), '..', 'briefs', `${pw.pathway.logical_id}-research-brief.md`)
      : null;
  briefCache = candidate && existsSync(candidate)
    ? { path: candidate, text: readFileSync(candidate, 'utf8') }
    : null;
  return briefCache;
}
/** True when the brief carries `[<tag> — <ids...>]` (em dash or hyphens). */
function briefHasMarker(tag: string, ...ids: string[]): boolean {
  const b = brief();
  if (!b) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = ids.map(esc).join('\\s+(?:via|→|->)\\s+');
  return new RegExp(`\\[${esc(tag)}\\s*(?:—|-{1,2})\\s*${body}\\s*\\]`).test(b.text);
}
const briefName = (): string => brief()?.path ?? (briefArg ? resolve(briefArg) : '(no brief found — pass --brief)');

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
const warnings: string[] = [];

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

// ── Advisory — Rule 1 one level down: a gated STAGE whose step has another way in.
// The gate still excludes the Stage, but that step (and its subtree) is reached
// anyway. Sometimes intended — anemia's DP-1 "empiric oral iron" deliberately
// reaches Step 2.1 without ferritin — so this warns rather than fails; the brief
// should say it is deliberate.
for (const [target, gates] of gatesByTarget) {
  const gateRoutes = new Set(
    walkable.filter((e) => e.type === 'BRANCHES_TO' && e.to === target && gateIds.has(e.from)),
  );
  const reach = reachableFromRoot(gateRoutes);
  if (reach.has(target)) continue; // already a Rule 1 error
  for (const e of walkable.filter((x) => x.from === target && x.type === 'HAS_STEP')) {
    if (!reach.has(e.to)) continue;
    const via = walkable.filter((x) => x.to === e.to && x.from !== target).map((x) => `${x.from} -${x.type}->`);
    warnings.push(
      `Gate ${gates.map((g) => `"${g}"`).join(', ')} excludes "${target}", but its step "${e.to}" ` +
      `(${titleOf.get(e.to)}) is also reached via ${via.join(', ')} — that step survives a "no". ` +
      `Confirm the brief intends it.`,
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
warnings.push(...[...gateIds]
  .filter((g) => !walkable.some((e) => e.from === g && e.type === 'BRANCHES_TO'))
  .map((g) => `Gate "${g}" (${titleOf.get(g)}) has no BRANCHES_TO edge — it guards nothing.`));

// ── INERT (traverse) — default_behavior applies to a definite "no" as well as
// to missing data (`traversal-engine.ts:1263-1310`), so a single-target gate set
// to traverse includes its target whether the answer is yes or no: it cannot
// exclude anything. Anemia gate-ida-confirmed did exactly this — ferritin 50 still
// opened iron therapy. A multi-target router picks its edge by answer, so it is
// exempt.
for (const node of nodes) {
  if (node.type !== 'Gate') continue;
  const props = (node as any).properties ?? {};
  const out = walkable.filter((e) => e.from === node.id && e.type === 'BRANCHES_TO');
  if (out.length === 1 && String(props.default_behavior ?? '').toLowerCase() === 'traverse') {
    errors.push(
      `INERT GATE — "${node.id}" (${titleOf.get(node.id)}) has default_behavior "traverse" and one target.\n` +
      `      => traverse applies to a definite "no" too, so "${out[0].to}" is included either way.\n` +
      `      => use "skip"; control missing data with on_unresolved ("ask" holds and asks, "default" excludes).`,
    );
  }
}

// ── Condition lints (builder-enforced; import accepts all of these) ─────
// Every evaluable condition of every chart gate, with a label for messages.
function chartConditions(): Array<{ gate: string; i: number; c: any }> {
  const out: Array<{ gate: string; i: number; c: any }> = [];
  for (const node of nodes) {
    if (node.type !== 'Gate') continue;
    const props = (node as any).properties ?? {};
    const t = String(props.gate_type ?? '');
    const conds: any[] =
      t === 'patient_attribute' ? (props.condition ? [props.condition] : [])
      : t === 'compound' && Array.isArray(props.conditions) ? props.conditions
      : [];
    conds.forEach((c, i) => { if (c && typeof c === 'object') out.push({ gate: node.id, i, c }); });
  }
  return out;
}
const isVitals = (c: any): boolean =>
  c.field === 'vitals' || (typeof c.attribute === 'string' && c.attribute.startsWith('vitals.'));

// VITALS HORIZON — a vitals condition with no horizon inherits the v1 system
// default ENCOUNTER (`policy-registry.ts`), which needs an `encounterStart` on the
// session. The encounter simulator never sends one, and session preflight
// asserts EVERY matched pathway before traversing any
// (`multi-pathway-resolution.ts`), so one such condition rejects the whole
// simulator session — including every other pathway it co-matched. Vitals are
// asserted current at evaluation time, so any bounded horizon admits them.
for (const { gate, i, c } of chartConditions()) {
  if (!isVitals(c)) continue;
  if (c.horizon === undefined) {
    errors.push(
      `VITALS HORIZON — "${gate}" condition[${i}] reads vitals (${c.value ?? c.attribute}) with no \`horizon\`.\n` +
      `      => it inherits ENCOUNTER, which rejects every session without an encounterStart (the simulator\n` +
      `         never sends one) — and takes every co-matched pathway down with it. Emit "horizon": "DAY".`,
    );
  } else if (c.horizon === 'ENCOUNTER') {
    errors.push(
      `VITALS HORIZON — "${gate}" condition[${i}] sets horizon ENCOUNTER on a vitals read.\n` +
      `      => sessions without an encounterStart (every simulator session) are rejected. Use "DAY".`,
    );
  }
}

// EXPLICIT HORIZON — an omitted horizon is not "lifetime": it is the field's v1
// default (LIFETIME for conditions/meds/allergies, QUARTER for labs, ENCOUNTER for
// vitals). Emitting it makes the time scope reviewable in the JSON and the brief.
// STATUS ON OBSERVATIONS — labs and vitals have no clinical state; a `status`
// there imports cleanly and then throws at session preflight.
for (const { gate, i, c } of chartConditions()) {
  // patient.* has no temporal policy at all (the adapter returns null for it).
  if (c.horizon === undefined && c.window_days === undefined && !isVitals(c) &&
      !(typeof c.attribute === 'string' && c.attribute.startsWith('patient.'))) {
    errors.push(
      `EXPLICIT HORIZON — "${gate}" condition[${i}] (${c.field ?? c.attribute} ${c.value ?? ''}) has neither ` +
      `horizon nor window_days.\n      => it silently inherits the v1 field default ` +
      `(${c.field === 'labs' ? 'QUARTER = 90 days, not lifetime' : 'LIFETIME'}); emit it explicitly.`,
    );
  }
  if (c.status !== undefined && (c.field === 'labs' || isVitals(c) ||
      (typeof c.attribute === 'string' && c.attribute.startsWith('lab.')))) {
    errors.push(
      `STATUS ON OBSERVATION — "${gate}" condition[${i}] sets status on ${c.field ?? c.attribute}: ` +
      `labs and vitals have no clinical state; session preflight throws INVALID_TEMPORAL_DEFAULTS.`,
    );
  }
}

// WILDCARD — the matcher (`select-facts.ts` codeMatches) supports exactly ONE
// wildcard form: a trailing `.*`, meaning "starts with the part before it". Any
// other `*` is compared as a literal character, so `G82.2*` matches no real code
// and the condition silently answers "no". And only includes_code,
// count_in_window, trend_* and delta_from_baseline use the matcher at all —
// equals / greater_than / less_than compare the code exactly.
const WILDCARD_OPS = new Set(['includes_code', 'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline']);
for (const { gate, i, c } of chartConditions()) {
  if (typeof c.value !== 'string' || !c.value.includes('*')) continue;
  const wellFormed = /^[^*]+\.\*$/.test(c.value);
  if (!wellFormed) {
    const fix = c.value.replace(/\.?\*+$/, '.*');
    errors.push(
      `WILDCARD — "${gate}" condition[${i}] value "${c.value}": only a trailing ".*" is a wildcard; ` +
      `any other "*" is a literal and matches nothing.\n      => write "${fix}".`,
    );
  } else if (!WILDCARD_OPS.has(c.operator)) {
    errors.push(
      `WILDCARD — "${gate}" condition[${i}] uses "${c.value}" with operator "${c.operator}", which compares ` +
      `codes exactly — the ".*" is a literal. Use includes_code, or name the code.`,
    );
  }
}

// ON_UNRESOLVED — what a chart gate does when it cannot DECIDE (no usable value,
// or values that cannot be ordered). Absent means 'ask' (resolution/types.ts):
// the gate pends, its subtree is held, and the provider is asked for the datum.
// Only NUMERIC conditions can raise it: membership never does (absence is a
// definite "no"), and aggregates never ask (they fall to default_behavior). So
// the builder emits it explicitly on every chart gate.
//
// DECIDED (Josh, 2026-09-24): a gate that reads a numeric value ASKS when the
// value is missing. `ask` is the rule, not a per-gate choice; `default` on a
// numeric gate is an exception that must be justified in the brief with an
// `[ON-UNRESOLVED DEFAULT — <gate-id>]` marker, or this check fails. A gate with
// no numeric condition gets 'default', which is what the engine does there.
//
// NUMERIC CONDITION — the one definition, shared with the spec:
//   - coded `labs` / `vitals` with greater_than or less_than;
//   - attribute `lab.*`, `vitals.*` or `patient.*` with any operator but
//     `exists` (absence IS the answer to exists). `patient.*` counts since
//     8f64fc1: a missing demographic now reports dataUnavailable and asks for
//     the `patient.<attr>` datum instead of reading as a silent "no".
const SCALAR_OPS = new Set(['greater_than', 'less_than']);
const NUMERIC_NAMESPACES = ['lab.', 'vitals.', 'patient.'];
const isNumeric = (c: any): boolean =>
  (typeof c.attribute === 'string' && c.operator !== 'exists' &&
    NUMERIC_NAMESPACES.some((ns) => c.attribute.startsWith(ns))) ||
  ((c.field === 'labs' || c.field === 'vitals') && SCALAR_OPS.has(c.operator));
{
  const byGate = new Map<string, any[]>();
  for (const { gate, c } of chartConditions()) {
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate)!.push(c);
  }
  for (const [gate, conds] of byGate) {
    const props = (nodes.find((n) => n.id === gate) as any).properties ?? {};
    const askable = conds.some(isNumeric);
    if (props.on_unresolved === undefined) {
      errors.push(
        `ON_UNRESOLVED — "${gate}" does not say what to do when it cannot decide.\n` +
        `      => emit "on_unresolved": ${askable
          ? '"ask" (it reads a numeric value: numeric gates ask when the value is missing)'
          : '"default" (no numeric condition: the engine can never ask here)'}.`,
      );
    } else if (props.on_unresolved === 'default' && askable &&
               !briefHasMarker('ON-UNRESOLVED DEFAULT', gate)) {
      errors.push(
        `ON_UNRESOLVED DEFAULT — "${gate}" reads a numeric value but sets on_unresolved "default", so a\n` +
        `      missing value silently takes default_behavior instead of asking. Numeric gates ask by rule.\n` +
        `      => emit "ask", or justify the exception in the brief with a line containing\n` +
        `         "[ON-UNRESOLVED DEFAULT — ${gate}]" and the clinical reason (brief: ${briefName()}).`,
      );
    } else if (props.on_unresolved === 'ask' && !askable) {
      warnings.push(
        `Gate "${gate}": on_unresolved "ask" is inert — it has no numeric condition, so the engine ` +
        `never asks and applies default_behavior. Emit "default" so the JSON says what happens.`,
      );
    }
    if (askable && typeof props.prompt === 'string') {
      warnings.push(
        `Gate "${gate}": an authored \`prompt\` on a chart gate replaces the generated per-datum ` +
        `escalation prompt — a compound gate asking for several values would show the same text for each.`,
      );
    }
    for (const c of conds) {
      if (c.field === 'labs' && SCALAR_OPS.has(c.operator) && typeof c.display !== 'string') {
        warnings.push(
          `Gate "${gate}": lab condition on ${c.value} has no \`display\` — the escalation prompt ` +
          `will read "${c.value} (LOINC ${c.value}) — most recent value?". Add "display": "<name> (<unit the threshold assumes>)".`,
        );
      }
    }
  }
}

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
