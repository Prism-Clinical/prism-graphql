import {
  FactSelectionCondition,
  GateField,
  FIELD_TO_KIND,
  TemporalOperator,
  isTemporalOperator,
} from './contract';
import { ConditionTemporalOverride, parseHorizonValue, parseStatusValue } from './cascade';
import { TemporalContextError } from './evaluation-context';
// Only the urn constant. Vitals carry no terminology code, so the assembler
// stamps every vital with this system and the adapter must select on the same
// one; a second spelling here would silently match nothing.
import { VITALS_SYSTEM } from './context-assembler';
import { AttributeCodeMap, AttributeCondition, CodedCondition } from '../types';

/**
 * The one shape both condition kinds adapt to (P1-20).
 *
 * The policy seam consumes only this, never a raw condition: an
 * `AttributeCondition` has no `field`, so a seam typed on the raw condition
 * forces the attribute path to resolve policy inline — and inline resolution is
 * how preflight and evaluation drift apart (locked decision #7).
 */
export interface AdaptedCondition {
  /** Carries `field` — the cascade key. */
  selection: FactSelectionCondition;
  /** The NODE tier. Absent when the author set neither axis. */
  override?: ConditionTemporalOverride;
}

/**
 * Attribute namespace → gate field, for the three clinical namespaces.
 *
 * `null` means "not governed by temporal policy": `patient.*` is demographics
 * with no `FactKind`, interval, or clinical state, and an unrecognized
 * namespace is something the evaluator will simply fail to resolve. Returning
 * `null` rather than throwing is deliberate — the anchor sweep calls this, and
 * a session must not be rejected over a namespace that never resolves a
 * horizon (D3, P1-8).
 *
 * Exported so the sweep and `adaptAttributeCondition` derive the field from one
 * source. Two mappings would let preflight and evaluation disagree.
 */
export function attributeNamespaceToField(namespace: string): GateField | null {
  switch (namespace) {
    case 'lab':
      return 'labs';
    case 'vitals':
      return 'vitals';
    case 'allergy':
      return 'allergies';
    default:
      // `patient` and anything unrecognized.
      return null;
  }
}

/** `exists` is bucket existence: it ignores code and system (select-facts.ts:75). */
function isBucketExistence(operator: string): boolean {
  return operator === 'exists';
}

/**
 * D9 — a coded `vitals` condition may not carry a `system`.
 *
 * Legacy's `getNumericValue` honours `condition.system` on its **labs** branch
 * and ignores it entirely on its **vitals** branch (`gate-evaluator.ts:84-93`):
 * vitals resolve by dotted path through a bag that has no system concept. The
 * kernel is uniform, so it applies `system` to both — and `assembleVitals`
 * stamps every vital with `VITALS_SYSTEM`, which no real terminology system
 * equals. Any author-supplied `system` therefore makes the gate permanently
 * unsatisfiable under `v1` while it was satisfiable under `legacy-v0` (R11-1).
 *
 * Rejected where the author can act on it rather than ignored or disclosed
 * (round-7 P1-22 precedent): silently discarding what the author wrote is the
 * failure mode that produced the round-6 `exists` confusion, and disclosing it
 * leaves a gate that imports cleanly, passes preflight, and can never fire.
 *
 * **The rule is keyed on the FIELD, not on the operator**, so it fires for
 * `exists` too — which drops `system` rather than selecting on it, and so is
 * not itself unsatisfiable. Two reasons: discarding an author's `system` in
 * silence is the very thing being rejected, and an operator-qualified rule
 * would force the import validator to re-derive the kernel's operator
 * classification — two validators, two chances to disagree (locked decision #7).
 *
 * Exported (returning a message rather than throwing) so the import validator
 * and the adapter reject **exactly** the same conditions from one predicate.
 * The validator collects errors and never throws; the adapter throws. One
 * source of truth, two error protocols.
 */
export function codedVitalsSystemError(field: unknown, system: unknown): string | null {
  if (field !== 'vitals' || system === undefined) return null;
  return (
    `a "vitals" condition may not set "system" (got ${JSON.stringify(system)}) — ` +
    `vitals carry no terminology code, so the assembler stamps every vital with ` +
    `"${VITALS_SYSTEM}" and any supplied system makes this gate unsatisfiable. ` +
    `Remove "system"; the condition's "value" is the vital's path (D9)`
  );
}

/**
 * The numeric CONTROLS on a coded condition, and the domain each one has.
 *
 * The validator checked keys, operators and fields; the adapter checked
 * field/operator/override grammar. Neither checked what these contain, and the
 * evaluator reads them raw — so a sign error in one of them silently reverses a
 * clinical decision:
 *
 *  - **`slope_threshold` must be NON-NEGATIVE.** It is a magnitude: `trend_down`
 *    is `slope < -slopeFloor` (`gate-evaluator.ts:388` legacy, `:891` kernel), so
 *    a negative floor flips the comparison's sense. `slope_threshold: -1` makes
 *    `trend_down` mean `slope < 1`, and a RISING series satisfies "trending
 *    down". The evaluator's own negation is what consumes the sign; the author
 *    supplies only the size.
 *  - **`count_threshold` and `min_points` must be POSITIVE INTEGERS.**
 *    `count_threshold: 0` makes an empty count succeed. A non-numeric
 *    `min_points` reaches `Math.max(2, NaN)` as NaN, and `length < NaN` is
 *    always false, so the series-length guard disappears entirely.
 *  - **`threshold` and `delta_threshold` must be FINITE NUMBERS, and their sign
 *    is the author's.** `delta_threshold: -3` means "fell by ≥3" (design's
 *    signed-delta rule, pinned by `gate-evaluator-trend.test.ts`); constraining
 *    it the way `slope_threshold` is constrained would break every drop gate.
 *
 * **`window_days` is deliberately absent.** Its domain — finite positive integer
 * within the cap — is `parseHorizonValue`'s, reached through
 * `parseConditionOverride` (D2), and a second copy here is exactly the two-places
 * -to-disagree shape locked decision #7 forbids. It is checked, from inside the
 * same `adaptCodedCondition` call, by the override parser.
 *
 * Keyed on the KEY BEING PRESENT, not on the operator — the same reasoning D9
 * records: an operator-qualified rule would force the import validator to
 * re-derive the kernel's operator classification, which is two validators and
 * two chances to disagree.
 *
 * Exported returning a message rather than throwing, the D9 shape: the import
 * validator pushes it onto `errors` and the adapter throws it. One source of
 * truth, two error protocols. Returns the FIRST violation — an author fixing a
 * pathway re-imports, and reporting one precise cause beats a list assembled
 * from a condition that is already being rewritten.
 */
export function conditionControlDomainError(condition: unknown): string | null {
  if (!condition || typeof condition !== 'object') return null;
  const c = condition as Record<string, unknown>;

  for (const key of ['threshold', 'delta_threshold'] as const) {
    const v = c[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return `"${key}" must be a finite number (got ${JSON.stringify(v)})`;
    }
  }

  for (const key of ['count_threshold', 'min_points'] as const) {
    const v = c[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      return `"${key}" must be a positive integer (got ${JSON.stringify(v)})`;
    }
  }

  const slope = c.slope_threshold;
  if (slope !== undefined) {
    if (typeof slope !== 'number' || !Number.isFinite(slope)) {
      return `"slope_threshold" must be a finite non-negative number (got ${JSON.stringify(slope)})`;
    }
    if (slope < 0) {
      return (
        `"slope_threshold" must be non-negative (got ${JSON.stringify(slope)}) — ` +
        `it is a MAGNITUDE, and trend_down already negates it (slope < -slope_threshold), ` +
        `so a negative value inverts the comparison and a RISING series satisfies trend_down`
      );
    }
  }

  return null;
}

/**
 * Translate a coded condition into the kernel's selection shape, rejecting
 * anything the kernel does not model.
 *
 * **`exists` is normalized, not rejected (round 6).** The kernel short-circuits
 * `exists` to match any fact of the kind, so `value` and `system` are dropped
 * here — `value: ''` and `value: '718-7'` produce an identical selection, which
 * is what today's `entries.length > 0` already means. Rejecting a non-empty
 * value would be unsatisfiable: the import validator REQUIRES `value` on every
 * coded condition (`validator.ts:289`), so an author following the authoring
 * contract produces exactly what the rejection would refuse. Authoring-time
 * rejection belongs to plan 06, which can warn and migrate rather than throw.
 */
export function toFactSelectionCondition(
  condition: CodedCondition,
  where = 'gate condition',
): FactSelectionCondition {
  const { field, operator, value, system } = condition;

  if (!Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)) {
    throw new TemporalContextError(
      `${where}: field "${field}" has no fact kind`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  if (!isTemporalOperator(operator)) {
    throw new TemporalContextError(
      `${where}: operator "${operator}" is not modelled by the selection kernel`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }

  // Checked BEFORE the `exists` early return, which drops `system` and would
  // otherwise let one operator through the field rule (D9, see above).
  const vitalsSystem = codedVitalsSystemError(field, system);
  if (vitalsSystem !== null) {
    throw new TemporalContextError(`${where}: ${vitalsSystem}`, 'INVALID_TEMPORAL_DEFAULTS');
  }

  // Likewise before the early return, and for the same reason: the control
  // rules are keyed on the key's presence, not on the operator, so an `exists`
  // carrying a nonsense `slope_threshold` is rejected rather than silently
  // dropped. Under `v1` the anchor sweep runs this same adapter, so a condition
  // rejected here was already rejected at session creation (locked decision #7).
  const controls = conditionControlDomainError(condition);
  if (controls !== null) {
    throw new TemporalContextError(`${where}: ${controls}`, 'INVALID_TEMPORAL_DEFAULTS');
  }

  if (isBucketExistence(operator)) {
    return { field: field as GateField, operator, value: '' };
  }

  const out: FactSelectionCondition = { field: field as GateField, operator, value };
  if (system !== undefined) out.system = system;
  return out;
}

/**
 * Parse the NODE tier off an untyped condition object.
 *
 * Takes `unknown` because the anchor sweep reads conditions straight off AGE
 * JSON, and the evaluator reads them off a typed `CodedCondition`. Both must go
 * through this one function or they will disagree about the same pathway —
 * which is the whole of locked decision #7.
 *
 * Errors propagate. Under `v1` this is the only preflight that catches a
 * malformed override or a `window_days`/`horizon` conflict, so swallowing them
 * here restores the mid-traversal throw the sweep exists to prevent (P1-18).
 */
export function parseConditionOverride(
  raw: unknown,
  where: string,
): ConditionTemporalOverride | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const cond = raw as Record<string, unknown>;

  const hasWindowDays = cond.window_days !== undefined;
  const hasHorizon = cond.horizon !== undefined;

  // Checked BEFORE either is parsed: with both present there is no defensible
  // winner, and silently preferring one is how a pathway comes to mean
  // something different from what it reads like (D2, design §419).
  if (hasWindowDays && hasHorizon) {
    throw new TemporalContextError(
      `${where}: a condition may set window_days or horizon, not both — ` +
        `horizon supersedes window_days (design §419)`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }

  const override: ConditionTemporalOverride = {};

  if (hasWindowDays) {
    // Routed through parseHorizonValue rather than validated here, so the
    // day-count rule (finite positive integer within the cap) lives in exactly
    // one place.
    override.horizon = parseHorizonValue({ days: cond.window_days }, `${where}.window_days`);
  } else if (hasHorizon) {
    override.horizon = parseHorizonValue(cond.horizon, `${where}.horizon`);
  }

  if (cond.status !== undefined) {
    override.status = parseStatusValue(cond.status, `${where}.status`);
  }

  return Object.keys(override).length > 0 ? override : undefined;
}

/**
 * The NODE tier for a typed coded condition. Delegates to
 * `parseConditionOverride` so the typed and untyped paths cannot diverge.
 */
export function nodeOverrideFor(
  condition: CodedCondition,
  where?: string,
): ConditionTemporalOverride | undefined {
  return parseConditionOverride(condition, where ?? `condition (${condition.field})`);
}

/**
 * Both adapters return `AdaptedCondition`; this is the coded one.
 *
 * `where` is an author-facing location (e.g. `"g-bp / condition 0"`). The
 * anchor sweep passes the gate label so a preflight rejection names the gate
 * rather than just the field — an author fixing a pathway needs to know which
 * one. Validating field, operator and override in ONE call is what makes the
 * `v1` sweep reject exactly what evaluation would (round 7 P1-22): two
 * different validators are two chances to disagree.
 */
export function adaptCodedCondition(condition: CodedCondition, where?: string): AdaptedCondition {
  const adapted: AdaptedCondition = { selection: toFactSelectionCondition(condition, where) };
  const override = nodeOverrideFor(condition, where);
  if (override !== undefined) adapted.override = override;
  return adapted;
}

/**
 * Which selection class a clinical attribute namespace resolves through (D3).
 *
 * Keyed on the namespace and on the TYPE OF VALUE that namespace resolves to —
 * **never** on the condition's operator. `attribute-registry.ts` is the source:
 * `lab` returns `lab?.value`, a number, and `vitals` returns a number off the
 * bag, so both need the scalar rules (exact code + a finite value + the
 * definite-latest winner). `allergy` returns `allergies.some(...)`, a boolean,
 * and allergy facts are `StatefulFact`s carrying no numeric value at all — a
 * scalar selection would reject every one of them via `hasFiniteValue`
 * (`select-facts.ts:50`).
 *
 * Two traps this ordering closes, both named by D3:
 *  - an attribute `exists` must NOT become the kernel's `exists`, which ignores
 *    code and system by design (`select-facts.ts:106`) and would be satisfied by
 *    any unrelated lab;
 *  - an attribute `equals` on a `lab.*` must NOT become the kernel's membership
 *    `equals`, which returns every matching result in array order instead of the
 *    one definitely-latest value.
 */
function attributeSelectionClass(namespace: string): 'membership' | 'scalar' {
  return namespace === 'allergy' ? 'membership' : 'scalar';
}

/**
 * The temporal operator that stands for each attribute selection class.
 *
 * The attribute operator set is not the coded one: `not_equals`,
 * `greater_or_equal`, `less_or_equal` and `in` have no `TemporalOperator`
 * equivalent, and `TemporalOperator` is deliberately not widened for them. Each
 * maps to the nearest operator of the SAME selection class, for SELECTION only —
 * the real comparison stays in `compareScalar`, exactly where `legacy-v0` does
 * it.
 */
const ATTRIBUTE_SELECTION_OPERATOR: Record<'membership' | 'scalar', TemporalOperator> = {
  // Exact-code membership. `equals` is the kernel's exact-code candidate rule;
  // `includes_code` would apply the trailing wildcard, which `resolveAttribute`
  // never does.
  membership: 'equals',
  // Exact code plus a finite value. `greater_than` and `less_than` share ONE
  // candidate rule (`select-facts.ts:121-123`) and one class, so which stands
  // for the class cannot change what is selected.
  scalar: 'greater_than',
  // No `aggregate` entry, and the key type is narrowed rather than
  // `OperatorClass`: no attribute namespace resolves an aggregate, and a
  // never-taken third branch is an invariant no test can cover.
};

/**
 * Translate a clinical attribute condition onto the kernel's selection shape.
 *
 * Returns **the same `AdaptedCondition` shape as `adaptCodedCondition`** so both
 * kinds reach `effectivePolicyFor` through byte-identical code (P1-20). Resolving
 * attribute policy inline is how preflight and evaluation drift apart, which is
 * the whole of locked decision #7.
 *
 * `null` means "not routable through the kernel — use `resolveAttribute`", and
 * there are two ways to earn it:
 *  - **`patient.*` or an unrecognized namespace.** Demographics have no
 *    `FactKind`, interval, or clinical state (D3).
 *  - **A `lab.*` / `allergy.*` with no `codeMap` row.** There is no code to
 *    select on. `resolveAttribute` returns `undefined` for exactly this case
 *    today — it bails on the missing row before reading any clinical data — so
 *    the fallback decides identically and reads nothing from `patientContext`.
 *    Widening this to a throw would reject at evaluation what the anchor sweep
 *    cannot see: the sweep has no `codeMap`, so it could never reject the same
 *    condition at preflight.
 *
 * **The sweep derives its field from `attributeNamespaceToField` rather than
 * from this function, and that is not an oversight.** `sweepableConditions`
 * reads pathway JSON off AGE with no attribute registry in scope, so it cannot
 * resolve a code. Sharing the namespace map and `parseConditionOverride` is what
 * makes the two agree on the only two things preflight computes — the cascade
 * key and the NODE tier — and that agreement is asserted by test.
 */
export function adaptAttributeCondition(
  condition: AttributeCondition,
  codeMap: AttributeCodeMap,
  where?: string,
): AdaptedCondition | null {
  const attribute = condition.attribute;
  const dot = attribute.indexOf('.');
  const namespace = dot === -1 ? attribute : attribute.slice(0, dot);
  const rest = dot === -1 ? '' : attribute.slice(dot + 1);

  // The SAME mapping the anchor sweep uses (locked decision #6). Checked FIRST,
  // and before the override is parsed, because the sweep also returns before
  // parsing for a `null` field — a malformed `horizon` on a `patient.*`
  // condition is ignored by both sides, not rejected by one.
  const field = attributeNamespaceToField(namespace);
  if (field === null) return null;

  // Parsed BEFORE the codeMap lookup, deliberately. The sweep parses every
  // clinical-namespace attribute condition it sees and has no codeMap at all,
  // so resolving the code first would let a malformed override on an UNMAPPED
  // attribute reject session creation while evaluation ignored it — the two
  // sides asymmetric over one condition, which is locked decision #7 read in
  // the other direction.
  const override = parseConditionOverride(condition, where ?? `condition (${attribute})`);

  let value: string;
  let system: string | undefined;
  if (namespace === 'vitals') {
    // No terminology code exists: the dotted remainder IS the code, matching
    // both `resolveAttribute`'s `numericPath` and the flattened key the
    // assembler stamps on every vital (`context-assembler.ts:264-268`). That is
    // what makes a nested `vitals.custom.pain_score` resolve with no codeMap row.
    value = rest;
    system = VITALS_SYSTEM;
  } else {
    const entry = codeMap.get(attribute);
    if (!entry) return null;
    value = entry.code;
    // An empty system means "any system", mirroring `resolveAttribute`'s
    // `!entry.system ||` guard. Passing '' would narrow the selection to facts
    // whose system is literally empty.
    system = entry.system ? entry.system : undefined;
  }

  const selection: FactSelectionCondition = {
    field,
    operator: ATTRIBUTE_SELECTION_OPERATOR[attributeSelectionClass(namespace)],
    value,
  };
  if (system !== undefined) selection.system = system;

  const adapted: AdaptedCondition = { selection };
  if (override !== undefined) adapted.override = override;
  return adapted;
}
