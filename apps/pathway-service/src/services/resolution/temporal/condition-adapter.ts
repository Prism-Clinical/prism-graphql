import {
  FactSelectionCondition,
  GateField,
  FIELD_TO_KIND,
  isTemporalOperator,
} from './contract';
import { ConditionTemporalOverride, parseHorizonValue, parseStatusValue } from './cascade';
import { TemporalContextError } from './evaluation-context';
import { CodedCondition } from '../types';

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
export function toFactSelectionCondition(condition: CodedCondition): FactSelectionCondition {
  const { field, operator, value, system } = condition;

  if (!Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)) {
    throw new TemporalContextError(
      `gate condition field "${field}" has no fact kind`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  if (!isTemporalOperator(operator)) {
    throw new TemporalContextError(
      `gate condition operator "${operator}" is not modelled by the selection kernel`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
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
export function nodeOverrideFor(condition: CodedCondition): ConditionTemporalOverride | undefined {
  return parseConditionOverride(condition, `condition (${condition.field})`);
}

/** Both adapters return `AdaptedCondition`; this is the coded one. */
export function adaptCodedCondition(condition: CodedCondition): AdaptedCondition {
  const adapted: AdaptedCondition = { selection: toFactSelectionCondition(condition) };
  const override = nodeOverrideFor(condition);
  if (override !== undefined) adapted.override = override;
  return adapted;
}
