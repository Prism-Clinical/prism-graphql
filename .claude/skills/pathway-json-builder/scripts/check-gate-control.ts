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
// The same defect one level down: a gate that closes excludes its target AND
// everything its target contains (`markSubtree` over `containmentChildIds`),
// but the constructive walk follows EVERY outgoing edge of every included
// node — including edges out of action nodes. So a node inside the gated
// region that some other included node points at is reached first and stays
// INCLUDED. That is how anemia v5 shipped IV iron to a GA-12 patient: Step 2.5
// was GATED_OUT, and `med-1 -ESCALATES_TO-> med-5` walked straight past the
// gate (fixed in d6ab163; `fixtures/gate-control/escalates-to-leak.json`).
// Rule 1 therefore checks the whole gated REGION, not just the target.
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
const titleOf = new Map(nodes.map((n) => [n.id, (n as any).properties?.title ?? (n as any).properties?.name ?? n.id]));

// Edges for the Rule 2/3 and gate-shape checks, which only ever look at a
// gate's own BRANCHES_TO edges. REQUIRES never is one; it is dropped here so
// those checks read exactly as they always have.
const walkable = edges.filter((e) => e.type !== 'REQUIRES');

// ── The engine's two walks (apps/pathway-service/src/services/resolution) ──
// CONTAINMENT — what a closing gate excludes. `markSubtree` sweeps the gate's
// `containmentChildIds`, i.e. every outgoing edge EXCEPT REQUIRES
// (`graph-containment.ts` NON_CONTAINMENT_EDGES): REQUIRES runs from a
// dependent back to its prerequisite and says nothing about where the
// prerequisite lives.
// ROUTES — what includes a node. The constructive walk in `traversal-engine.ts`
// enqueues EVERY outgoing edge of an included node, whatever its type: HAS_STEP,
// USES_MEDICATION, ESCALATES_TO, HAS_LAB_TEST, … and REQUIRES too (the engine
// calls that last one an open question: a prerequisite is normally resolved
// before its dependent, so the walk usually finds it written and moves on).
const containmentEdges = edges.filter((e) => e.type !== 'REQUIRES');
const nonRequiresEdges = containmentEdges;

/** Every gate BRANCHES_TO edge, grouped by target. */
const gatesByTarget = new Map<string, string[]>();
for (const e of walkable) {
  if (e.type === 'BRANCHES_TO' && gateIds.has(e.from)) {
    if (!gatesByTarget.has(e.to)) gatesByTarget.set(e.to, []);
    gatesByTarget.get(e.to)!.push(e.from);
  }
}

function adjacency(over: Edge[], skip: Set<Edge>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of over) {
    if (skip.has(e)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}
function closure(adj: Map<string, string[]>, roots: string[]): Set<string> {
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    for (const next of adj.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}
/**
 * Reachable from the literal `root` source (never declared in `nodes` — the
 * validator allows it as a special edge source), over `over` minus `skip`.
 */
function reachableFromRoot(over: Edge[], skip: Set<Edge>): Set<string> {
  return closure(adjacency(over, skip), ['root']);
}
/** What a closing gate on `target` excludes: target + its containment closure. */
function gatedRegion(target: string): Set<string> {
  return closure(adjacency(containmentEdges, new Set()), [target]);
}

/** The evaluable shape of a gate — equal shapes always give the same verdict. */
function gateEvalShape(props: any): string {
  return JSON.stringify({
    gate_type: props.gate_type, default_behavior: props.default_behavior,
    on_unresolved: props.on_unresolved, operator: props.operator,
    condition: props.condition, conditions: props.conditions,
    prompt: props.prompt, answer_type: props.answer_type,
  });
}

const errors: string[] = [];
const warnings: string[] = [];
const infos: string[] = [];
const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
const dpOfCriterion = new Map(
  edges.filter((e) => e.type === 'HAS_CRITERION').map((e) => [e.to, e.from]),
);

// Rule 3 fan-out copies (`gate-x`, `gate-x-<suffix>`, identical evaluable
// shape) always agree, so for Rule 1 they are one gate: a node two copies'
// targets share is not a second route around either.
const gateFamily = new Map<string, string>([...gateIds].map((g) => [g, g]));
{
  const gateNodeList = nodes.filter((n) => n.type === 'Gate');
  for (const base of gateNodeList) {
    for (const copy of gateNodeList) {
      if (copy.id === base.id || !copy.id.startsWith(`${base.id}-`)) continue;
      if (gateEvalShape((copy as any).properties ?? {}) === gateEvalShape((base as any).properties ?? {})) {
        gateFamily.set(copy.id, gateFamily.get(base.id)!);
      }
    }
  }
}

// CodeEntry and EvidenceCitation carry no recommendation of their own: scorers
// and the care plan read them through their HOST (`graphContext.linkedNodes`,
// `care-plan-projection.ts` projects only action nodes), so their own status is
// never consulted. Pathways share them across hosts on purpose; a shared one is
// not a leak.
const REFERENCE_TYPES = new Set(['CodeEntry', 'EvidenceCitation']);

// ── Rule 1 — a gated REGION has its gate as the ONLY way in ──────────
// For each gated target T: the region is T plus everything T contains (what a
// closing gate sweeps). With the gate's routes removed, any edge from a node
// that is still reachable INTO that region is a second route: the engine walks
// it, first writer wins, and the gate's "no" is discarded for that node — or,
// the other way round, the gate's sweep drops a node another included host
// ordered. Either way the verdict depends on BFS order, not on the patient.
//
// "The gate's routes" means EVERY BRANCHES_TO of the gate (and of its fan-out
// copies), not only the one into T: a router spares everything under the branch
// it takes (`liveUnderSelected`), so a node shared by two of its own branches
// is not a leak.
//
// A second route the brief records as deliberate with
// `[SECOND ROUTE — <node> via <source>]` (a Criterion counts as its
// DecisionPoint) is printed as info instead — anemia's DP-1 "empiric oral iron"
// reaches Steps 2.1-2.3 without the ferritin gate by design. A route that
// exists only through REQUIRES is a warning: the engine's constructive walk
// does follow REQUIRES, but only leaks when the dependent resolves before the
// gate, and the engine itself leaves that open.
for (const [target, gates] of gatesByTarget) {
  const families = new Set(gates.map((g) => gateFamily.get(g)));
  const gateRoutes = new Set(
    edges.filter((e) => e.type === 'BRANCHES_TO' && gateIds.has(e.from) && families.has(gateFamily.get(e.from))),
  );
  const region = gatedRegion(target);
  const reachStrict = reachableFromRoot(nonRequiresEdges, gateRoutes);
  const reachAll = reachableFromRoot(edges, gateRoutes);
  const gateList = gates.map((g) => `"${g}"`).join(', ');

  const entries = edges.filter((e) =>
    region.has(e.to) && !region.has(e.from) && !gateRoutes.has(e) && reachAll.has(e.from) &&
    !REFERENCE_TYPES.has(typeOf.get(e.to) ?? ''));
  const hard: string[] = [];
  for (const e of entries) {
    const route = `${e.from} -${e.type}-> ${e.to}`;
    const where = e.to === target
      ? `the gated node itself`
      : `"${e.to}" (${titleOf.get(e.to)}), inside the gated region`;
    if (e.type === 'REQUIRES' || !reachStrict.has(e.from)) {
      warnings.push(
        `RULE 1 (REQUIRES) — ${route} reaches ${where} of ${gateList} (target "${target}") ` +
        `only through a REQUIRES edge.\n      The engine's constructive walk follows REQUIRES, so if ` +
        `"${e.from}" resolves before the gate, "${e.to}" is INCLUDED past it. Confirm the order, or re-home the prerequisite.`,
      );
      continue;
    }
    const source = typeOf.get(e.from) === 'Criterion' ? dpOfCriterion.get(e.from) ?? e.from : e.from;
    if (briefHasMarker('SECOND ROUTE', e.to, source)) {
      infos.push(
        `Gate ${gateList} excludes "${target}", but ${route} reaches ${where} anyway — ` +
        `deliberate per the brief ([SECOND ROUTE — ${e.to} via ${source}]).`,
      );
      continue;
    }
    const toType = typeOf.get(e.to);
    const fix =
      e.to === target || e.type === 'HAS_STEP' || e.type === 'BRANCHES_TO' || e.type === 'SELECTS_BRANCH'
        ? `delete the competing edge, or move "${e.from}" behind the gate`
        : e.type === 'ESCALATES_TO'
          ? `drop the escalation edge (escalation into gated content is the gated step's own route), or put "${e.from}" inside the gate too`
          : toType && ['LabTest', 'Medication', 'Imaging', 'Procedure', 'Guidance', 'Schedule', 'QualityMetric'].includes(toType)
            ? `"${e.to}" is shared by a host outside the gate — split it into one node per host (as anemia 2a6b602 did for its labs), and update the brief`
            : `delete the edge, or move "${e.from}" inside the gate`;
    hard.push(`${route}  (enters ${where})\n        => ${fix}`);
  }
  if (hard.length > 0) {
    errors.push(
      `RULE 1 — gate ${gateList} closes "${target}" (${titleOf.get(target)}) and everything it contains, ` +
      `but ${hard.length} route(s) enter that region without the gate:\n      ${hard.join('\n      ')}\n` +
      `      => the engine walks every outgoing edge of an included node, first writer wins: whatever these ` +
      `routes reach does not obey the gate.\n` +
      `      => a route the brief intends is recorded there as "[SECOND ROUTE — <node> via <source>]" ` +
      `(brief: ${briefName()}).`,
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
// A compound's `conditions` may nest `{ operator, conditions }` groups (the
// gate's own shape; the import validator caps it at 4 levels). Every lint below
// runs on the LEAVES, depth first, labelled with the validator's path:
// `condition[1]` at the top level, `condition[1].conditions[0]` inside a group.
const isGroup = (c: any): boolean => !!c && typeof c === 'object' && Array.isArray(c.conditions);
function conditionLeaves(entries: any[], parent = ''): Array<{ at: string; c: any }> {
  const out: Array<{ at: string; c: any }> = [];
  entries.forEach((c, i) => {
    const at = parent === '' ? `condition[${i}]` : `${parent}.conditions[${i}]`;
    if (isGroup(c)) out.push(...conditionLeaves(c.conditions, at));
    else if (c && typeof c === 'object') out.push({ at, c });
  });
  return out;
}

// Every evaluable condition of every chart gate, with a label for messages.
function chartConditions(): Array<{ gate: string; at: string; c: any }> {
  const out: Array<{ gate: string; at: string; c: any }> = [];
  for (const node of nodes) {
    if (node.type !== 'Gate') continue;
    const props = (node as any).properties ?? {};
    const t = String(props.gate_type ?? '');
    const conds: any[] =
      t === 'patient_attribute' ? (props.condition ? [props.condition] : [])
      : t === 'compound' && Array.isArray(props.conditions) ? props.conditions
      : [];
    for (const { at, c } of conditionLeaves(conds)) out.push({ gate: node.id, at, c });
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
for (const { gate, at, c } of chartConditions()) {
  if (!isVitals(c)) continue;
  if (c.horizon === undefined) {
    errors.push(
      `VITALS HORIZON — "${gate}" ${at} reads vitals (${c.value ?? c.attribute}) with no \`horizon\`.\n` +
      `      => it inherits ENCOUNTER, which rejects every session without an encounterStart (the simulator\n` +
      `         never sends one) — and takes every co-matched pathway down with it. Emit "horizon": "DAY".`,
    );
  } else if (c.horizon === 'ENCOUNTER') {
    errors.push(
      `VITALS HORIZON — "${gate}" ${at} sets horizon ENCOUNTER on a vitals read.\n` +
      `      => sessions without an encounterStart (every simulator session) are rejected. Use "DAY".`,
    );
  }
}

// EXPLICIT HORIZON — an omitted horizon is not "lifetime": it is the field's v1
// default (LIFETIME for conditions/meds/allergies, QUARTER for labs, ENCOUNTER for
// vitals). Emitting it makes the time scope reviewable in the JSON and the brief.
// STATUS ON OBSERVATIONS — labs and vitals have no clinical state; a `status`
// there imports cleanly and then throws at session preflight.
for (const { gate, at, c } of chartConditions()) {
  // patient.* has no temporal policy at all (the adapter returns null for it).
  // encounter.* (the calendar condition `encounter.date` / `in_season`) reads the
  // session clock, not chart data: it has no window, and a `horizon` there is an
  // import error.
  if (c.horizon === undefined && c.window_days === undefined && c.window_from === undefined && !isVitals(c) &&
      !(typeof c.attribute === 'string' && (c.attribute.startsWith('patient.') || c.attribute.startsWith('encounter.')))) {
    errors.push(
      `EXPLICIT HORIZON — "${gate}" ${at} (${c.field ?? c.attribute} ${c.value ?? ''}) has neither ` +
      `horizon, window_days nor window_from.\n      => it silently inherits the v1 field default ` +
      `(${c.field === 'labs' ? 'QUARTER = 90 days, not lifetime' : 'LIFETIME'}); emit it explicitly.`,
    );
  }
  if (c.status !== undefined && (c.field === 'labs' || isVitals(c) ||
      (typeof c.attribute === 'string' && c.attribute.startsWith('lab.')))) {
    errors.push(
      `STATUS ON OBSERVATION — "${gate}" ${at} sets status on ${c.field ?? c.attribute}: ` +
      `labs and vitals have no clinical state; session preflight throws INVALID_TEMPORAL_DEFAULTS.`,
    );
  }
}

// WILDCARD — the matcher (`select-facts.ts` codeMatches) supports exactly ONE
// wildcard form: a trailing `.*`, meaning "starts with the part before it". Any
// other `*` is compared as a literal character, so `G82.2*` matches no real code
// and the condition silently answers "no". And only includes_code,
// not_includes_code, count_in_window, trend_* and delta_from_baseline use the
// matcher at all (the import validator's PATTERN_CODE_OPS) —
// equals / greater_than / less_than compare the code exactly.
const WILDCARD_OPS = new Set([
  'includes_code', 'not_includes_code', 'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline',
]);
for (const { gate, at, c } of chartConditions()) {
  if (typeof c.value !== 'string' || !c.value.includes('*')) continue;
  const wellFormed = /^[^*]+\.\*$/.test(c.value);
  if (!wellFormed) {
    const fix = c.value.replace(/\.?\*+$/, '.*');
    errors.push(
      `WILDCARD — "${gate}" ${at} value "${c.value}": only a trailing ".*" is a wildcard; ` +
      `any other "*" is a literal and matches nothing.\n      => write "${fix}".`,
    );
  } else if (!WILDCARD_OPS.has(c.operator)) {
    errors.push(
      `WILDCARD — "${gate}" ${at} uses "${c.value}" with operator "${c.operator}", which compares ` +
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
//   - coded `labs` trend_up / trend_down / delta_from_baseline (engine-anchored-
//     window): a series one dated value short asks for the newest result;
//   - any condition with `window_from`: an unknown start date asks a DATE.
const SCALAR_OPS = new Set(['greater_than', 'less_than']);
const SERIES_OPS = new Set(['trend_up', 'trend_down', 'delta_from_baseline']);
const NUMERIC_NAMESPACES = ['lab.', 'vitals.', 'patient.'];
const isNumeric = (c: any): boolean =>
  (typeof c.attribute === 'string' && c.operator !== 'exists' &&
    NUMERIC_NAMESPACES.some((ns) => c.attribute.startsWith(ns))) ||
  ((c.field === 'labs' || c.field === 'vitals') && SCALAR_OPS.has(c.operator)) ||
  (c.field === 'labs' && SERIES_OPS.has(c.operator)) ||
  c.window_from !== undefined;
{
  const byGate = new Map<string, any[]>();
  for (const { gate, c } of chartConditions()) {
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate)!.push(c);
  }
  for (const [gate, conds] of byGate) {
    const props = (nodes.find((n) => n.id === gate) as any).properties ?? {};
    const askable = conds.some(isNumeric);
    // `horizon: "PREGNANCY"` needs the gestational age: when it is missing the
    // condition is unresolved for EVERY operator, membership included, and with
    // `ask` the gate holds on the shared gestational-age question. So `ask` is
    // not inert there — and `default` stays legal without a marker, because the
    // gestational-age gates ask for the same datum anyway.
    const holdsOnGestationalAge = conds.some((c) => c.horizon === 'PREGNANCY');
    // The distinct data this gate can ask for. One datum: an authored prompt is
    // simply that question's wording. Several: the one prompt would be shown for each.
    const askableData = new Set(conds.filter(isNumeric).map((c) => String(c.attribute ?? `${c.field}:${c.value}`)));
    if (holdsOnGestationalAge) askableData.add('patient.gestational_age_weeks');
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
    } else if (props.on_unresolved === 'ask' && !askable && !holdsOnGestationalAge) {
      warnings.push(
        `Gate "${gate}": on_unresolved "ask" is inert — it has no numeric condition, so the engine ` +
        `never asks and applies default_behavior. Emit "default" so the JSON says what happens.`,
      );
    }
    // ON_DECLINED — what "Not available" means for this gate. `traverse` opens
    // the gate when the datum it asked for was declined, and only then: it is NOT
    // `default_behavior: "traverse"` (it does nothing on a definite "no"), so it
    // is legal on a single-target gate. It can act only on a gate that can ask.
    if (props.on_declined !== undefined) {
      if (props.on_declined !== 'traverse' && props.on_declined !== 'default') {
        errors.push(
          `ON_DECLINED — "${gate}" sets on_declined ${JSON.stringify(props.on_declined)}; only "traverse" and "default" exist.`,
        );
      } else if (props.on_declined === 'traverse' && (askableData.size === 0 || props.on_unresolved !== 'ask')) {
        warnings.push(
          `Gate "${gate}": on_declined "traverse" is inert — ${askableData.size === 0
            ? 'the gate has no condition it can ask for, so nothing can be declined'
            : 'the gate does not ask (on_unresolved is not "ask"), so nothing can be declined'}.`,
        );
      }
    }
    if (askable && typeof props.prompt === 'string' && askableData.size > 1) {
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

// ── STAGE NUMBERS — every Stage has its own stage_number ─────────────
// The admin dashboard orders stages by `Number(stage_number)` and labels each
// "Stage <stage_number>" (PathwayDrillDown `stages()`, the pathway preview,
// the editor navigator), and draws its dashed default-sequence arrows between
// neighbours in that order. Two stages with one number show as two "Stage 1"s,
// in whatever order the sort leaves them. A fan-out sub-stage takes a number
// BETWEEN its parent and the next stage (parent + 0.5), never its parent's.
{
  const byNumber = new Map<string, string[]>();
  for (const n of nodes.filter((x) => x.type === 'Stage')) {
    const raw = (n as any).properties?.stage_number;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(num)) {
      errors.push(`STAGE NUMBER — "${n.id}" has no numeric stage_number (${JSON.stringify(raw)}); the dashboard sorts stages by it.`);
      continue;
    }
    const key = String(num);
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key)!.push(n.id);
  }
  for (const [num, ids] of byNumber) {
    if (ids.length < 2) continue;
    errors.push(
      `DUPLICATE STAGE NUMBER — stage_number ${num} is used by ${ids.map((i) => `"${i}" (${titleOf.get(i)})`).join(', ')}.\n` +
      `      => the drill-down shows ${ids.length} "Stage ${num}" cards in arbitrary order. Give each stage a unique\n` +
      `         number; a fan-out sub-stage takes its parent's number + 0.5 (e.g. 1.5), and its steps keep theirs.`,
    );
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
    ...conditionLeaves(Array.isArray(props.conditions) ? props.conditions : []).map((l) => l.c),
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
// identical conditions. Editing one and not the others silently splits the verdict
// (and Rule 1 then stops treating them as one gate).
const evalShape = gateEvalShape;
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

for (const i of infos) console.log(`ℹ ${i}`);
for (const w of warnings) console.log(`⚠ ${w}`);

if (errors.length === 0) {
  console.log(
    `✓ GATE CONTROL OK — ${gateIds.size} gate(s), ${gatesByTarget.size} gated target(s), no violations ` +
    `(rules 1-3), ${warnings.length} warning(s)`,
  );
  process.exit(0);
}
console.log(`✗ GATE CONTROL — ${errors.length} violation(s):`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(1);
