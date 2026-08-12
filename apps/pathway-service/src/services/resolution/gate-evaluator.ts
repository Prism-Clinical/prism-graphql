import { PatientContext, CodeEntry, LabResult } from '../confidence/types';
import {
  GateProperties,
  GateCondition,
  CodedCondition,
  AttributeCondition,
  GateAnswer,
  GateEvaluationResult,
  NodeResult,
  GateType,
  isAttributeCondition,
  AttributeCodeMap,
} from './types';
import { resolveAttribute } from './attribute-registry';
import { compareScalar } from './scalar-compare';
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from './temporal/evaluation-context';
import {
  assertKnownPolicyVersion,
  KNOWN_TEMPORAL_POLICY_VERSIONS,
} from './temporal/policy-registry';
import type { TemporalPolicyVersion } from './temporal/policy-registry';
import type { PathwayTemporalDefaults } from './temporal/cascade';
import type { FactStore, NormalizedFact } from './temporal/fact-model';
import { isObservationFact } from './temporal/fact-model';
import { boundEpochRange } from './temporal/interval';
import type { ResolvedHorizon } from './temporal/overlap';
import { isTemporalOperator, operatorClass } from './temporal/contract';
import type { UncertaintyReason } from './temporal/contract';
import { adaptAttributeCondition, adaptCodedCondition } from './temporal/condition-adapter';
import { effectivePolicyFor } from './temporal/gate-policy';
import { selectFacts } from './temporal/select-facts';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Match a code value against a pattern, supporting trailing wildcard (*).
 * E.g., 'Z94.*' matches 'Z94.0', 'Z94.12', etc.
 */
function matchesCodePattern(code: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return code.startsWith(prefix);
  }
  return code === pattern;
}

/**
 * Retrieve the list of CodeEntry items for a given patient context field.
 */
function getCodeEntries(
  patientContext: PatientContext,
  field: string,
): CodeEntry[] {
  switch (field) {
    case 'conditions':
      return patientContext.conditionCodes;
    case 'medications':
      return patientContext.medications;
    case 'allergies':
      return patientContext.allergies;
    case 'labs':
      return patientContext.labResults;
    default:
      return [];
  }
}

/**
 * Get a numeric value from patient context for comparison operators.
 * Supports lab results (by code) and vital signs (by key or dotted path).
 *
 * For vitals, the condition's `value` is the key within the vitalSigns bag.
 * Fixed vitals live at the root (`systolic_bp`, `heart_rate`, ...) and custom
 * vitals nest under `custom.<key>` — so callers can target either with a
 * single string:
 *   value: "systolic_bp"        → vitalSigns.systolic_bp
 *   value: "custom.pain_score"  → vitalSigns.custom.pain_score
 *
 * Returns undefined if the path doesn't resolve to a finite number.
 */
function getNumericValue(
  patientContext: PatientContext,
  field: string,
  condition: CodedCondition,
): number | undefined {
  if (field === 'labs') {
    const lab = patientContext.labResults.find(
      (l) => l.code === condition.value && (!condition.system || l.system === condition.system),
    );
    return lab?.value;
  }
  if (field === 'vitals' && patientContext.vitalSigns) {
    return resolveNumericPath(patientContext.vitalSigns, condition.value);
  }
  return undefined;
}

/**
 * Time-shape operators (count_in_window, trend_*, delta_from_baseline)
 * read this to decide whether a snapshot entry counts for the gate.
 *
 * - When `windowDays` is undefined, no filtering — the entry counts
 *   regardless of its date or absence of one. Lets "ever had X"-style
 *   patterns work for snapshots that don't track dates.
 * - When `windowDays` is set, the entry's `date` must parse to a finite
 *   timestamp and fall within `windowDays` of `now` (inclusive). Entries
 *   without dates are excluded — date-aware gates can't reason about
 *   un-dated history.
 *
 * `now` is the session's pinned `evaluationAsOf` (see
 * temporal/evaluation-context.ts), supplied by the traversal boundary. Tests
 * pin it directly so window-boundary behavior is deterministic.
 */
function isWithinWindow(
  entryDate: string | undefined,
  windowDays: number | undefined,
  now: number,
): boolean {
  if (windowDays === undefined) return true;
  if (!entryDate) return false;
  const ts = Date.parse(entryDate);
  if (!Number.isFinite(ts)) return false;
  const ageMs = now - ts;
  if (ageMs < 0) return false; // Future-dated entries don't count
  const ageDays = ageMs / 86_400_000;
  return ageDays <= windowDays;
}

/**
 * Collect lab values matching (code [+ system]) into a `(timestamp,
 * value)` series, sorted ascending by timestamp. Used by trend_up,
 * trend_down, and delta_from_baseline. Entries without a parseable
 * date or a finite numeric value are dropped — they can't contribute
 * to a time series. If `windowDays` is set, only in-window entries
 * are kept; future-dated entries are always excluded.
 */
function collectLabSeries(
  patientContext: PatientContext,
  code: string,
  system: string | undefined,
  windowDays: number | undefined,
  now: number,
): Array<{ ts: number; value: number }> {
  const series: Array<{ ts: number; value: number }> = [];
  for (const lab of patientContext.labResults) {
    if (!matchesCodePattern(lab.code, code)) continue;
    if (system && lab.system !== system) continue;
    if (typeof lab.value !== 'number' || !Number.isFinite(lab.value)) continue;
    if (!lab.date) continue;
    const ts = Date.parse(lab.date);
    if (!Number.isFinite(ts)) continue;
    if (ts > now) continue; // Future-dated entries excluded
    if (!isWithinWindow(lab.date, windowDays, now)) continue;
    series.push({ ts, value: lab.value });
  }
  series.sort((a, b) => a.ts - b.ts);
  return series;
}

/**
 * Linear-regression slope over (timestamp-in-days, value) points.
 * Returns the slope in value-units per day. Series must have ≥2 points;
 * collapses to 0 (no trend) when all timestamps are equal (vertical line).
 */
function linearSlope(series: Array<{ ts: number; value: number }>): number {
  const n = series.length;
  if (n < 2) return 0;
  const days = series.map((p) => p.ts / 86_400_000);
  const meanX = days.reduce((s, x) => s + x, 0) / n;
  const meanY = series.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = days[i] - meanX;
    num += dx * (series[i].value - meanY);
    den += dx * dx;
  }
  if (den === 0) return 0;
  return num / den;
}

/**
 * Walk a dotted path through a JSON bag, returning the value only if it's a
 * finite number. Tolerates missing segments at any depth.
 */
function resolveNumericPath(bag: Record<string, unknown>, path: string): number | undefined {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = bag;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined;
}

// ─── Condition Evaluator ──────────────────────────────────────────────

/**
 * The `legacy-v0` condition evaluator — today's code, unchanged.
 *
 * Renamed from `evaluateCondition` by plan 04 Task 3; the body is untouched,
 * deliberately. It is the shadow baseline the `v1` kernel is diffed against,
 * and locked decision #1 keeps it (with `getCodeEntries`, `getNumericValue`,
 * `collectLabSeries` and `isWithinWindow`) until the rollout flip retires it.
 * A behavior change reachable from here is a bug in the seam, not a feature.
 */
function evaluateConditionLegacy(
  condition: GateCondition,
  patientContext: PatientContext,
  now: number,
  codeMap: AttributeCodeMap = new Map(),
): { satisfied: boolean; reason: string; fieldsRead: string[] } {
  if (isAttributeCondition(condition)) {
    const { value, fieldsRead } = resolveAttribute(patientContext, condition.attribute, codeMap);
    const { satisfied, reason } = compareScalar(value, condition.operator, condition.value);
    return { satisfied, reason, fieldsRead };
  }
  // Coded path below — `condition` is now narrowed to CodedCondition.
  const { field, operator, value, system } = condition;
  const fieldsRead = field ? [field] : [];

  switch (operator) {
    case 'includes_code': {
      const entries = getCodeEntries(patientContext, field);
      const matched = entries.some(
        (e) =>
          matchesCodePattern(e.code, value) &&
          (!system || e.system === system),
      );
      return {
        satisfied: matched,
        reason: matched
          ? `Patient has matching code ${value} in ${field}`
          : `No matching code ${value} found in patient ${field}`,
        fieldsRead,
      };
    }

    case 'exists': {
      const entries = getCodeEntries(patientContext, field);
      const exists = entries.length > 0;
      return {
        satisfied: exists,
        reason: exists
          ? `Patient has entries in ${field}`
          : `Patient has no entries in ${field}`,
        fieldsRead,
      };
    }

    case 'equals': {
      const entries = getCodeEntries(patientContext, field);
      const matched = entries.some(
        (e) => e.code === value && (!system || e.system === system),
      );
      return {
        satisfied: matched,
        reason: matched
          ? `Patient has exact code ${value} in ${field}`
          : `No exact code ${value} found in patient ${field}`,
        fieldsRead,
      };
    }

    case 'greater_than': {
      const numericVal = getNumericValue(patientContext, field, condition);
      const threshold = condition.threshold ?? parseFloat(value);
      if (numericVal === undefined) {
        return {
          satisfied: false,
          reason: `No numeric value found for ${field}:${condition.value}`,
          fieldsRead,
        };
      }
      const satisfied = numericVal > threshold;
      return {
        satisfied,
        reason: satisfied
          ? `${field} value ${numericVal} > ${threshold}`
          : `${field} value ${numericVal} <= ${threshold}`,
        fieldsRead,
      };
    }

    case 'less_than': {
      const numericVal = getNumericValue(patientContext, field, condition);
      const threshold = condition.threshold ?? parseFloat(value);
      if (numericVal === undefined) {
        return {
          satisfied: false,
          reason: `No numeric value found for ${field}:${condition.value}`,
          fieldsRead,
        };
      }
      const satisfied = numericVal < threshold;
      return {
        satisfied,
        reason: satisfied
          ? `${field} value ${numericVal} < ${threshold}`
          : `${field} value ${numericVal} >= ${threshold}`,
        fieldsRead,
      };
    }

    /**
     * count_in_window — recurrence pattern. Counts entries matching
     * (code [+ system]) optionally filtered to entries dated within
     * `window_days` of now. Satisfied when the count reaches
     * `count_threshold` (default 2 — "more than once").
     *
     * Works against `labs` (LabResult.date) and the code buckets
     * (CodeEntry.date) — recurrent UTIs, repeat ED visits, ≥3 abnormal
     * lab values, etc. Without `window_days`, counts all matching
     * entries regardless of date (or absence of one).
     */
    case 'count_in_window': {
      const threshold = condition.count_threshold ?? 2;
      const windowDays = condition.window_days;
      let matches = 0;
      if (field === 'labs') {
        for (const lab of patientContext.labResults) {
          if (!matchesCodePattern(lab.code, value)) continue;
          if (system && lab.system !== system) continue;
          if (!isWithinWindow(lab.date, windowDays, now)) continue;
          matches += 1;
        }
      } else {
        const entries = getCodeEntries(patientContext, field);
        for (const e of entries) {
          if (!matchesCodePattern(e.code, value)) continue;
          if (system && e.system !== system) continue;
          if (!isWithinWindow(e.date, windowDays, now)) continue;
          matches += 1;
        }
      }
      const satisfied = matches >= threshold;
      const windowDesc = windowDays === undefined
        ? 'lifetime'
        : `last ${windowDays} day${windowDays === 1 ? '' : 's'}`;
      return {
        satisfied,
        reason: satisfied
          ? `Found ${matches} matching ${value} in ${field} within ${windowDesc} (≥${threshold})`
          : `Found ${matches} matching ${value} in ${field} within ${windowDesc} (<${threshold})`,
        fieldsRead,
      };
    }

    /**
     * trend_up / trend_down — directional slope over the matching
     * dated lab series within window_days. Computes linear-regression
     * slope and compares its sign + magnitude to slope_threshold
     * (default 0 = any non-flat slope in the declared direction). Needs
     * at least min_points dated, finite values inside the window.
     *
     * Only meaningful on labs in v1 — condition/medication entries
     * don't carry numeric values, so a trend over them isn't defined.
     */
    case 'trend_up':
    case 'trend_down': {
      const minPoints = Math.max(2, condition.min_points ?? 3);
      const slopeFloor = condition.slope_threshold ?? 0;
      if (field !== 'labs') {
        return {
          satisfied: false,
          reason: `${operator} only supports field=labs (got "${field}")`,
          fieldsRead,
        };
      }
      const series = collectLabSeries(
        patientContext,
        value,
        system,
        condition.window_days,
        now,
      );
      if (series.length < minPoints) {
        return {
          satisfied: false,
          reason: `Need ≥${minPoints} dated values for ${value}; found ${series.length}`,
          fieldsRead,
        };
      }
      const slope = linearSlope(series);
      const ok =
        operator === 'trend_up'
          ? slope > slopeFloor
          : slope < -slopeFloor;
      return {
        satisfied: ok,
        reason: ok
          ? `${value} slope ${slope.toFixed(4)} value/day satisfies ${operator}${slopeFloor !== 0 ? ` (|slope| > ${slopeFloor})` : ''}`
          : `${value} slope ${slope.toFixed(4)} value/day does not satisfy ${operator}`,
        fieldsRead,
      };
    }

    /**
     * delta_from_baseline — change between newest and oldest in-window
     * value vs a signed delta_threshold. Positive threshold = rose by
     * at least that much. Negative threshold = dropped by at least the
     * magnitude. Zero is degenerate (any non-flat change fires).
     */
    case 'delta_from_baseline': {
      const minPoints = Math.max(2, condition.min_points ?? 2);
      const delta = condition.delta_threshold ?? 0;
      if (field !== 'labs') {
        return {
          satisfied: false,
          reason: `delta_from_baseline only supports field=labs (got "${field}")`,
          fieldsRead,
        };
      }
      const series = collectLabSeries(
        patientContext,
        value,
        system,
        condition.window_days,
        now,
      );
      if (series.length < minPoints) {
        return {
          satisfied: false,
          reason: `Need ≥${minPoints} dated values for ${value}; found ${series.length}`,
          fieldsRead,
        };
      }
      const baseline = series[0].value;
      const current = series[series.length - 1].value;
      const observed = current - baseline;
      const ok =
        delta === 0
          ? observed !== 0
          : delta > 0
            ? observed >= delta
            : observed <= delta;
      const decoration = `(baseline ${baseline}, current ${current})`;
      return {
        satisfied: ok,
        reason: ok
          ? `${value} delta ${observed.toFixed(4)} ${decoration} satisfies threshold ${delta}`
          : `${value} delta ${observed.toFixed(4)} ${decoration} does not satisfy threshold ${delta}`,
        fieldsRead,
      };
    }

    default:
      return {
        satisfied: false,
        reason: `Unknown operator: ${operator}`,
        fieldsRead,
      };
  }
}

// ─── The version seam ─────────────────────────────────────────────────

/** What every condition evaluator, on either side of the seam, returns. */
export interface ConditionOutcome {
  satisfied: boolean;
  reason: string;
  fieldsRead: string[];
  /**
   * D5, and **only** populated by the `v1` kernel. Both keys stay absent on the
   * `legacy-v0` path so its result object is byte-identical to today's — a new
   * key there would be a behavior change reachable under `legacy-v0`, which
   * locked decision #2 makes a bug in the seam.
   *
   * `indeterminate` — uncertainty *could have prevented* a definitive outcome.
   * For membership it is always `false`: `selectFacts` resolves uncertainty to
   * INCLUDE for this operator class, so INDETERMINATE is unreachable
   * (`select-facts.ts:184-190`). The compound truth table is Task 8's.
   */
  indeterminate?: boolean;
  /**
   * `uncertainty` — relevant uncertainty that *existed*, retained even when the
   * outcome is definite (D5, P1-11). A fail-open membership match on a
   * validity-UNKNOWN fact is certain in its answer and doubtful in its
   * evidence; both facts are true and plan 08 has to show the second.
   */
  uncertainty?: UncertaintyReason[];
}

export type ConditionEvaluator = (
  condition: GateCondition,
  deps: GateEvaluationDeps,
) => ConditionOutcome;

/** The pinned clock as epoch ms — the ONLY clock a condition may read. */
function evaluationNowMs(deps: GateEvaluationDeps): number {
  return Date.parse(deps.temporalContext.evaluationAsOf);
}

/** `legacy-v0`, adapted onto the deps object. The legacy body itself is untouched. */
function evaluateConditionLegacyAdapted(
  condition: GateCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  return evaluateConditionLegacy(
    condition,
    deps.patientContext,
    evaluationNowMs(deps),
    deps.codeMap,
  );
}

/**
 * The membership reason strings, kept byte-identical to the legacy evaluator's.
 *
 * `v1` changes *which facts* are admitted, not how the decision reads. Rewriting
 * the prose here would make every `legacy-v0`/`v1` diff — the whole point of
 * keeping the baseline — noisy with cosmetic differences.
 */
function membershipReason(
  condition: CodedCondition,
  satisfied: boolean,
): string {
  const { field, operator, value } = condition;
  switch (operator) {
    case 'exists':
      return satisfied
        ? `Patient has entries in ${field}`
        : `Patient has no entries in ${field}`;
    case 'equals':
      return satisfied
        ? `Patient has exact code ${value} in ${field}`
        : `No exact code ${value} found in patient ${field}`;
    default:
      return satisfied
        ? `Patient has matching code ${value} in ${field}`
        : `No matching code ${value} found in patient ${field}`;
  }
}

/**
 * `includes_code` / `equals` / `exists` on the kernel (Task 4).
 *
 * Every read of clinical data goes through `selectFacts`, so horizon, clinical
 * status and record validity govern the gate. Nothing about fail-open is
 * decided here: `selectFacts` already resolves membership uncertainty to
 * INCLUDE (`select-facts.ts:184-190`, locked decision #3), and re-deciding it
 * per operator is how the three membership operators would come to disagree.
 *
 * Errors from the adapter and the cascade PROPAGATE. Under `v1` the anchor
 * sweep runs the same `adaptCodedCondition`, so a condition that throws here
 * was already rejected at session creation; swallowing it into a quiet `false`
 * would hide a preflight that never ran (locked decision #7).
 */
function evaluateMembershipKernel(
  condition: CodedCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  const where = `condition (${condition.field})`;
  const adapted = adaptCodedCondition(condition, where);
  const policy = effectivePolicyFor(adapted, deps.temporalContext, deps.pathwayDefaults);
  const outcome = selectFacts(adapted.selection, deps.factStore, policy);

  // Uncertainty is read off the DECISIONS, not off the outcome's summary flags,
  // because the flags are booleans and D5 requires the reasons themselves. For
  // membership every uncertain candidate is INCLUDEd, so no reason is lost by
  // reading them all: a decision that was EXCLUDEd was definitely out on some
  // axis and carries an empty `uncertainty` by construction.
  const uncertainty = [...new Set(outcome.decisions.flatMap((d) => d.uncertainty))];

  const satisfied = outcome.status === 'READY';
  return {
    satisfied,
    reason: membershipReason(condition, satisfied),
    fieldsRead: condition.field ? [condition.field] : [],
    // Derived rather than hard-coded to `false`: membership cannot be
    // INDETERMINATE today, and if that ever changes this reports the truth
    // instead of asserting a stale one.
    indeterminate: outcome.status === 'INDETERMINATE',
    uncertainty,
  };
}

/**
 * The scalar reason strings, kept byte-identical to the legacy evaluator's
 * (`greater_than` / `less_than` above). Same rationale as `membershipReason`:
 * `v1` changes *which fact* is compared, not how the comparison reads.
 */
function scalarReason(
  condition: CodedCondition,
  numericVal: number,
  threshold: number,
  satisfied: boolean,
): string {
  const symbol =
    condition.operator === 'greater_than'
      ? satisfied
        ? '>'
        : '<='
      : satisfied
        ? '<'
        : '>=';
  return `${condition.field} value ${numericVal} ${symbol} ${threshold}`;
}

/**
 * The comparable number carried by a selected fact.
 *
 * `candidateMatches` already requires a finite-valued observation for the
 * scalar class (`select-facts.ts:98-100`), so this re-narrowing is a type
 * bridge rather than a second rule: `NormalizedFact` also covers stateful
 * facts, which carry no value at all. Returning `undefined` rather than
 * throwing keeps the single "no numeric value" exit — an unreachable throw
 * would be an invariant no test could cover.
 */
function scalarValueOf(fact: NormalizedFact): number | undefined {
  if (!isObservationFact(fact)) return undefined;
  return typeof fact.value === 'number' && Number.isFinite(fact.value) ? fact.value : undefined;
}

/**
 * `greater_than` / `less_than` on the kernel (Task 5).
 *
 * Only **selection** moves: `selectFacts` returns the definite latest valid,
 * in-window fact — sorted by effective time, never by array order (design §4,
 * fixing today's `getNumericValue` `.find()`) — and the numeric comparison plus
 * its threshold derivation stay here, unchanged from `legacy-v0`.
 *
 * **Fail-closed, and recorded.** Scalar is the one class where `selectFacts`
 * resolves uncertainty to INDETERMINATE (`select-facts.ts:194-195`, locked
 * decision #3): a single untrustworthy value poisons a comparison in a way it
 * cannot poison a membership test. The gate is therefore unsatisfied — but it
 * must not read as an ordinary "no match", so `indeterminate` is set and the
 * reasons are named in both `uncertainty` and the reason string. An outcome
 * that says only `satisfied: false` cannot be told apart later from "the
 * patient had no such result", and plan 08's evidence has to tell them apart.
 *
 * Errors from the adapter and the cascade PROPAGATE, exactly as for membership:
 * the `v1` anchor sweep runs the same `adaptCodedCondition` and the same
 * cascade, so anything that throws here was already rejected at session
 * creation (locked decision #7).
 */
function evaluateScalarKernel(
  condition: CodedCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  const where = `condition (${condition.field})`;
  const adapted = adaptCodedCondition(condition, where);
  const policy = effectivePolicyFor(adapted, deps.temporalContext, deps.pathwayDefaults);
  const outcome = selectFacts(adapted.selection, deps.factStore, policy);

  const fieldsRead = condition.field ? [condition.field] : [];

  // The per-fact doubt plus, when the kernel refused to decide, the reasons it
  // refused for. `AMBIGUOUS_LATEST` exists ONLY on the outcome — no single fact
  // is uncertain when two of them merely cannot be ordered — so reading the
  // decisions alone would silently drop it.
  const uncertainty: UncertaintyReason[] = [
    ...new Set([
      ...outcome.decisions.flatMap((d) => d.uncertainty),
      ...(outcome.status === 'INDETERMINATE' ? outcome.reasons : []),
    ]),
  ];

  if (outcome.status === 'INDETERMINATE') {
    return {
      satisfied: false,
      // Deliberately NOT legacy's "No numeric value found" — that outcome has no
      // legacy counterpart, and reusing its prose would make a fail-closed
      // refusal indistinguishable from an absent result in every audit row.
      reason:
        `Indeterminate numeric value for ${condition.field}:${condition.value} ` +
        `(${uncertainty.join(', ')})`,
      fieldsRead,
      indeterminate: true,
      uncertainty,
    };
  }

  const numericVal = outcome.status === 'READY' ? scalarValueOf(outcome.selected[0]) : undefined;
  if (numericVal === undefined) {
    return {
      satisfied: false,
      reason: `No numeric value found for ${condition.field}:${condition.value}`,
      fieldsRead,
      indeterminate: false,
      uncertainty,
    };
  }

  // Threshold derivation is the legacy expression, untouched — including its
  // `parseFloat(value)` fallback, where `value` is the observation code. Odd,
  // but it is current behavior and this task moves selection, not comparison.
  const threshold = condition.threshold ?? parseFloat(condition.value);
  const satisfied =
    condition.operator === 'greater_than' ? numericVal > threshold : numericVal < threshold;

  return {
    satisfied,
    reason: scalarReason(condition, numericVal, threshold, satisfied),
    fieldsRead,
    // Derived, never hard-coded: a READY or NO_MATCH selection is by definition
    // a decision the kernel was able to make.
    indeterminate: false,
    uncertainty,
  };
}

/**
 * How the applied window reads in a `count_in_window` reason string.
 *
 * Derived from the RESOLVED horizon, never from `condition.window_days`, so the
 * sentence always describes the window that was actually applied. Under `v1` the
 * window can come from any cascade tier — a `window_days` the adapter translated
 * into a NODE `{days:N}` (D2), a PATHWAY default, or the system default — and a
 * description keyed on `window_days` alone would print "lifetime" for a labs
 * count that in fact only looked back a QUARTER.
 *
 * The day-count spelling is legacy's, verbatim, so a count whose outcome matches
 * `legacy-v0`'s reads identically: `{days:90}` and `QUARTER` both render
 * "last 90 days", and LIFETIME renders "lifetime". Only a horizon with a
 * non-integral width — ENCOUNTER — needs a spelling legacy never had.
 */
function windowDescription(horizon: ResolvedHorizon): string {
  if (horizon.lowerBound === null) return 'lifetime';
  const days = (Date.parse(horizon.upperBound) - Date.parse(horizon.lowerBound)) / 86_400_000;
  if (!Number.isInteger(days)) return `the window since ${horizon.lowerBound}`;
  return `last ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Turn the kernel's selected facts into the `(timestamp, value)` series
 * `linearSlope` and the delta comparison consume.
 *
 * **The order is the kernel's, not ours.** `selectFacts` already sorts the
 * aggregate selection by effective time and refuses the series outright unless
 * every adjacent pair is strictly ordered (`select-facts.ts:262-273`), so
 * re-sorting here would only hide a kernel bug. `delta_from_baseline` depends on
 * that order — it reads the first and last elements — which is precisely why the
 * kernel proves it rather than assuming it.
 *
 * A fact with no `interval.start` contributes no point: it has no position in
 * time, and legacy's `collectLabSeries` drops undated entries for the same
 * reason (`if (!lab.date) continue`). Two rules keep this branch narrow, and
 * both leave the shortfall message reading exactly as `legacy-v0`'s does:
 * D8 excludes an undated fact from the selection outright under any BOUNDED
 * horizon, so it can only arrive here under LIFETIME; and D7 then admits it
 * only as a single-candidate selection, since an undated fact alongside any
 * other candidate is `AMBIGUOUS_SERIES_ORDER` and never reaches here.
 */
function seriesPoints(facts: readonly NormalizedFact[]): Array<{ ts: number; value: number }> {
  const points: Array<{ ts: number; value: number }> = [];
  for (const fact of facts) {
    const start = fact.interval.start;
    const value = scalarValueOf(fact);
    if (!start || value === undefined) continue;
    points.push({ ts: boundEpochRange(start).loMs, value });
  }
  return points;
}

/**
 * `count_in_window` / `trend_up` / `trend_down` / `delta_from_baseline` on the
 * kernel (Task 6).
 *
 * Only **selection** moves. The count, `linearSlope`, the baseline/current
 * delta, every knob (`count_threshold`, `min_points`, `slope_threshold`,
 * `delta_threshold`) and every reason string stay here, unchanged from
 * `legacy-v0`.
 *
 * **No window filtering happens in this function.** `window_days` is translated
 * by the adapter into a NODE-level `{days:N}` horizon (D2), so the window
 * arrives as part of the effective policy and `selectFacts` applies it. Filtering
 * again here would be a second implementation of the same rule, and two
 * implementations of one rule are how preflight and evaluation drift apart.
 *
 * **Fail-closed, and recorded.** The aggregate class resolves an uncertain fact
 * to EXCLUDE (`select-facts.ts:196-201`, locked decision #3) while still
 * reporting the selection as READY — so a definite count carrying non-empty
 * `uncertainty` is the NORMAL case, not an edge case: the count is a lower
 * bound (D5, P1-11). `indeterminate` and `uncertainty` are therefore derived
 * independently, and only `AMBIGUOUS_SERIES_ORDER` makes an aggregate
 * indeterminate.
 *
 * **The policy is resolved BEFORE the labs-only check**, unlike `legacy-v0`
 * which short-circuits `field !== 'labs'` first. That ordering is deliberate:
 * the `v1` anchor sweep resolves the cascade for every coded condition, so a
 * `vitals` trend gate is rejected at session creation. Short-circuiting here
 * would let evaluation quietly answer `false` for a condition preflight refuses
 * — the divergence locked decision #7 forbids.
 */
function evaluateAggregateKernel(
  condition: CodedCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  const where = `condition (${condition.field})`;
  const adapted = adaptCodedCondition(condition, where);
  const policy = effectivePolicyFor(adapted, deps.temporalContext, deps.pathwayDefaults);
  const outcome = selectFacts(adapted.selection, deps.factStore, policy);

  const { field, operator, value } = condition;
  const fieldsRead = field ? [field] : [];

  // Per-fact doubt plus, when the kernel refused to order the series, the
  // reason it refused for. `AMBIGUOUS_SERIES_ORDER` exists ONLY on the outcome —
  // no single fact is uncertain when two of them merely cannot be ordered — so
  // reading the decisions alone would silently drop it. (The series analogue of
  // the `AMBIGUOUS_LATEST` gap Task 5 found.)
  const uncertainty: UncertaintyReason[] = [
    ...new Set([
      ...outcome.decisions.flatMap((d) => d.uncertainty),
      ...(outcome.status === 'INDETERMINATE' ? outcome.reasons : []),
    ]),
  ];

  if (outcome.status === 'INDETERMINATE') {
    return {
      satisfied: false,
      // Deliberately NOT legacy's "Need ≥N dated values" — a fail-closed refusal
      // must not read like an ordinary shortfall, or no audit row can tell
      // "there were too few results" from "the results could not be ordered".
      reason:
        `Indeterminate ${operator} series for ${field}:${value} ` +
        `(${uncertainty.join(', ')})`,
      fieldsRead,
      indeterminate: true,
      uncertainty,
    };
  }

  const selected = outcome.status === 'READY' ? outcome.selected : [];

  if (operator === 'count_in_window') {
    // `selectFacts` has already deduplicated by `factId` (design §4), so the
    // count is over distinct occurrences.
    const matches = selected.length;
    const threshold = condition.count_threshold ?? 2;
    const satisfied = matches >= threshold;
    const bound = satisfied ? `≥${threshold}` : `<${threshold}`;
    return {
      satisfied,
      reason:
        `Found ${matches} matching ${value} in ${field} ` +
        `within ${windowDescription(policy.horizon)} (${bound})`,
      fieldsRead,
      // Derived, never hard-coded: only an unorderable series is indeterminate,
      // and `count_in_window` never builds one.
      indeterminate: false,
      uncertainty,
    };
  }

  // trend_up / trend_down / delta_from_baseline — a numeric series over labs.
  if (field !== 'labs') {
    return {
      satisfied: false,
      reason: `${operator} only supports field=labs (got "${field}")`,
      fieldsRead,
      indeterminate: false,
      uncertainty,
    };
  }

  const isDelta = operator === 'delta_from_baseline';
  const minPoints = Math.max(2, condition.min_points ?? (isDelta ? 2 : 3));
  const points = seriesPoints(selected);
  if (points.length < minPoints) {
    return {
      satisfied: false,
      reason: `Need ≥${minPoints} dated values for ${value}; found ${points.length}`,
      fieldsRead,
      indeterminate: false,
      uncertainty,
    };
  }

  if (isDelta) {
    const baseline = points[0].value;
    const current = points[points.length - 1].value;
    const observed = current - baseline;
    const delta = condition.delta_threshold ?? 0;
    const ok = delta === 0 ? observed !== 0 : delta > 0 ? observed >= delta : observed <= delta;
    const decoration = `(baseline ${baseline}, current ${current})`;
    return {
      satisfied: ok,
      reason: ok
        ? `${value} delta ${observed.toFixed(4)} ${decoration} satisfies threshold ${delta}`
        : `${value} delta ${observed.toFixed(4)} ${decoration} does not satisfy threshold ${delta}`,
      fieldsRead,
      indeterminate: false,
      uncertainty,
    };
  }

  const slopeFloor = condition.slope_threshold ?? 0;
  const slope = linearSlope(points);
  const ok = operator === 'trend_up' ? slope > slopeFloor : slope < -slopeFloor;
  return {
    satisfied: ok,
    reason: ok
      ? `${value} slope ${slope.toFixed(4)} value/day satisfies ${operator}${slopeFloor !== 0 ? ` (|slope| > ${slopeFloor})` : ''}`
      : `${value} slope ${slope.toFixed(4)} value/day does not satisfy ${operator}`,
    fieldsRead,
    indeterminate: false,
    uncertainty,
  };
}

/**
 * Clinical attribute conditions on the kernel (Task 7, D3).
 *
 * `lab.*`, `vitals.*` and `allergy.*` read the fact store; `patient.*` keeps
 * `resolveAttribute` forever — it is demographics, with no `FactKind`, interval,
 * or clinical state to govern.
 *
 * **Selection is chosen by namespace, never by the operator**, and the whole of
 * that choice lives in `adaptAttributeCondition`. Only two things happen here:
 * turning the selection into the value `resolveAttribute` would have produced,
 * and handing it to `compareScalar` — the same comparison, with the same reason
 * strings, that `legacy-v0` uses. `v1` changes which fact is read, not how the
 * answer reads.
 *
 * The fallback to legacy is not a leak of `patientContext` into `v1` clinical
 * decisions: `adaptAttributeCondition` returns `null` only for `patient.*`, an
 * unrecognized namespace, or a `lab`/`allergy` with no `codeMap` row — and in
 * that last case `resolveAttribute` bails on the missing row before reading any
 * clinical array.
 *
 * Errors from the adapter and the cascade PROPAGATE, exactly as for the coded
 * classes. The `v1` anchor sweep now covers these namespaces (P1-8), so anything
 * that throws here was already rejected at session creation; swallowing it into
 * a quiet `false` would hide a preflight that never ran.
 */
function evaluateAttributeKernel(
  condition: AttributeCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  const where = `condition (${condition.attribute})`;
  const adapted = adaptAttributeCondition(condition, deps.codeMap, where);
  if (adapted === null) return evaluateConditionLegacyAdapted(condition, deps);

  const policy = effectivePolicyFor(adapted, deps.temporalContext, deps.pathwayDefaults);
  const outcome = selectFacts(adapted.selection, deps.factStore, policy);

  // Byte-identical to `resolveAttribute`'s: the attribute name, not the gate
  // field. Reporting `labs` here would change what every audit row records for
  // a condition whose decision is unchanged.
  const fieldsRead = [condition.attribute];

  // Per-fact doubt plus, when the kernel refused to decide, the reasons it
  // refused for. `AMBIGUOUS_LATEST` exists ONLY on the outcome — no single fact
  // is uncertain when two of them merely cannot be ordered — so reading the
  // decisions alone would silently drop it.
  const uncertainty: UncertaintyReason[] = [
    ...new Set([
      ...outcome.decisions.flatMap((d) => d.uncertainty),
      ...(outcome.status === 'INDETERMINATE' ? outcome.reasons : []),
    ]),
  ];

  if (outcome.status === 'INDETERMINATE') {
    return {
      satisfied: false,
      // Deliberately NOT compareScalar's "attribute has no value" — a
      // fail-closed refusal must stay distinguishable from a genuinely absent
      // attribute in every audit row.
      reason: `Indeterminate value for ${condition.attribute} (${uncertainty.join(', ')})`,
      fieldsRead,
      indeterminate: true,
      uncertainty,
    };
  }

  // Membership derives a BOOLEAN — always one, never `undefined`, exactly as
  // `allergies.some(...)` does today, so `exists` on an allergy stays satisfied
  // whether or not the allergy is present. Scalar derives the numeric value of
  // the single definitely-latest fact, or `undefined` when nothing matched.
  const klass = operatorClass(adapted.selection.operator);
  const value =
    klass === 'membership'
      ? outcome.status === 'READY'
      : outcome.status === 'READY'
        ? scalarValueOf(outcome.selected[0])
        : undefined;

  const { satisfied, reason } = compareScalar(value, condition.operator, condition.value);
  return {
    satisfied,
    reason,
    fieldsRead,
    // Derived, never hard-coded: a READY or NO_MATCH selection is by definition
    // a decision the kernel was able to make.
    indeterminate: false,
    uncertainty,
  };
}

/**
 * The `v1` condition evaluator.
 *
 * Tasks 4–8 replace this body one operator class at a time; everything not yet
 * moved still delegates to the legacy evaluator, so a failure is attributable to
 * the operator rewrite rather than to the plumbing.
 *
 * Moved so far: **membership** (`includes_code`, `equals`, `exists`) — Task 4;
 * **scalar** (`greater_than`, `less_than`) — Task 5; **aggregate**
 * (`count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`) — Task 6;
 * **clinical attributes** (`lab.*`, `vitals.*`, `allergy.*`) — Task 7. Still
 * legacy by design: `patient.*` demographics (D3). An operator the kernel does
 * not model at all — an authoring typo that reached evaluation — also lands on
 * legacy, which reports it as an unknown operator exactly as it does today.
 */
function evaluateConditionKernel(
  condition: GateCondition,
  deps: GateEvaluationDeps,
): ConditionOutcome {
  if (isAttributeCondition(condition)) {
    return evaluateAttributeKernel(condition, deps);
  }
  const { operator } = condition;
  if (isTemporalOperator(operator) && operatorClass(operator) === 'membership') {
    return evaluateMembershipKernel(condition, deps);
  }
  if (isTemporalOperator(operator) && operatorClass(operator) === 'scalar') {
    return evaluateScalarKernel(condition, deps);
  }
  if (isTemporalOperator(operator) && operatorClass(operator) === 'aggregate') {
    return evaluateAggregateKernel(condition, deps);
  }
  return evaluateConditionLegacyAdapted(condition, deps);
}

/**
 * The dispatch table, keyed by `temporalContext.temporalPolicyVersion`.
 *
 * A table rather than a `switch` because the seam has to be *observable*: at
 * this task both branches decide identically by construction, so the only
 * honest proof that a version routes where it claims is a spy on the entry it
 * is supposed to reach (P1-16). Keys must stay in step with
 * `KNOWN_TEMPORAL_POLICY_VERSIONS` — `assertKnownPolicyVersion` runs first, so
 * a registry key with no policy set would fail there before reaching here.
 */
export const CONDITION_EVALUATORS: Record<TemporalPolicyVersion, ConditionEvaluator> = {
  'legacy-v0': evaluateConditionLegacyAdapted,
  v1: evaluateConditionKernel,
};

/**
 * Every registered policy version must have an evaluator — checked at module
 * load, not at the first gate that needs one.
 *
 * The type above is the compile-time half: keyed on `TemporalPolicyVersion`,
 * adding a version to the registry without an evaluator here is a compile
 * error. This is the runtime half, and it is not redundant — `tsconfig` is not
 * full strict, excludes `src/__tests__` entirely, and the table is exported and
 * mutable, so nothing else stops a version reaching production with no
 * evaluator. Without it, such a version passed `assertKnownPolicyVersion` at
 * session creation and threw at the first CONDITION gate — mid-traversal, on a
 * session already persisted.
 */
export function assertConditionEvaluatorCoverage(
  evaluators: Partial<Record<string, ConditionEvaluator>>,
): void {
  for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
    if (typeof evaluators[version] !== 'function') {
      throw new TemporalContextError(
        `temporal policy version "${version}" is registered but has no condition evaluator — ` +
          'it would pass session creation and throw at the first condition gate',
        'UNKNOWN_POLICY_VERSION',
      );
    }
  }
}

assertConditionEvaluatorCoverage(CONDITION_EVALUATORS);

/**
 * Resolve the one condition evaluator this gate — and every sibling condition
 * inside it — is evaluated with. Reading the version once, here, is what stops
 * two conditions of a compound gate resolving against different semantics.
 */
function conditionEvaluatorFor(deps: GateEvaluationDeps): ConditionEvaluator {
  const version = deps.temporalContext.temporalPolicyVersion;
  // Throws `unknown temporalPolicyVersion "<v>"` for anything unregistered —
  // never a silent fallback to legacy.
  assertKnownPolicyVersion(version);
  // The cast is safe only because `assertKnownPolicyVersion` ran: it throws for
  // anything outside `KNOWN_TEMPORAL_POLICY_VERSIONS`, which is the union this
  // table is keyed on. The `!evaluator` guard below still stands — the table is
  // exported and mutable, and the module-load coverage check proves only what
  // was true at load.
  const evaluator = CONDITION_EVALUATORS[version as TemporalPolicyVersion];
  if (!evaluator) {
    throw new TemporalContextError(
      `no condition evaluator registered for temporalPolicyVersion "${version}"`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return evaluator;
}

// ─── Gate Type Evaluators ─────────────────────────────────────────────

function evaluatePatientAttribute(
  gate: GateProperties,
  deps: GateEvaluationDeps,
): GateEvaluationResult {
  if (!gate.condition) {
    return {
      satisfied: false,
      reason: 'Gate has no condition defined',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const result = conditionEvaluatorFor(deps)(gate.condition, deps);
  const out: GateEvaluationResult = {
    satisfied: result.satisfied,
    reason: result.reason,
    contextFieldsRead: result.fieldsRead,
    dependedOnNodes: [],
  };
  // Copied only when the evaluator reported them, which is `v1` alone. Setting
  // them unconditionally would put `indeterminate: undefined` on every
  // `legacy-v0` result and break `toEqual` against today's shape — a behavior
  // change reachable under `legacy-v0` is a bug in the seam (locked decision #2).
  //
  // Single-condition gates only. The compound gate still drops these signals at
  // its boundary; widening it needs the truth table, which is Task 8.
  if (result.indeterminate !== undefined) out.indeterminate = result.indeterminate;
  if (result.uncertainty !== undefined) out.uncertainty = result.uncertainty;
  return out;
}

function evaluateQuestion(
  gate: GateProperties,
  gateAnswers: Map<string, GateAnswer>,
  gateId?: string,
): GateEvaluationResult {
  if (!gateId) {
    return {
      satisfied: false,
      reason: 'No gate ID provided for question evaluation',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const answer = gateAnswers.get(gateId);
  if (!answer) {
    return {
      satisfied: false,
      reason: 'Question has not been answered',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Boolean: true opens the gate
  if (answer.booleanValue !== undefined) {
    return {
      satisfied: answer.booleanValue === true,
      reason: answer.booleanValue
        ? 'Question answered yes'
        : 'Question answered no',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Numeric: any non-null value opens the gate
  if (answer.numericValue !== undefined && answer.numericValue !== null) {
    return {
      satisfied: true,
      reason: `Numeric answer provided: ${answer.numericValue}`,
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  // Select: any selected option opens the gate
  if (answer.selectedOption !== undefined && answer.selectedOption !== null) {
    return {
      satisfied: true,
      reason: `Option selected: ${answer.selectedOption}`,
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  return {
    satisfied: false,
    reason: 'Question answer has no value',
    contextFieldsRead: [],
    dependedOnNodes: [],
  };
}

function evaluatePriorNodeResult(
  gate: GateProperties,
  resolutionState: Map<string, NodeResult>,
): GateEvaluationResult {
  if (!gate.depends_on || gate.depends_on.length === 0) {
    return {
      satisfied: false,
      reason: 'Gate has no depends_on entries',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const dependedOnNodes: string[] = [];
  const unsatisfied: string[] = [];

  for (const dep of gate.depends_on) {
    dependedOnNodes.push(dep.node_id);
    const nodeResult = resolutionState.get(dep.node_id);
    if (!nodeResult || nodeResult.status !== dep.status) {
      const actual = nodeResult?.status ?? 'NOT_FOUND';
      unsatisfied.push(`${dep.node_id} expected ${dep.status}, got ${actual}`);
    }
  }

  const satisfied = unsatisfied.length === 0;
  return {
    satisfied,
    reason: satisfied
      ? `All depended-on nodes have expected status`
      : `Unmet dependencies: ${unsatisfied.join('; ')}`,
    contextFieldsRead: [],
    dependedOnNodes,
  };
}

/**
 * The `indeterminate` truth table for a compound gate (Task 8, D5 — normative).
 *
 * | Operator | Conditions | `satisfied` | `indeterminate` |
 * |---|---|---|---|
 * | AND | any definite `false` | `false` | `false` — a definite false dominates |
 * | AND | all `true` except ≥1 indeterminate | `false` | `true` |
 * | AND | all definite `true` | `true` | `false` |
 * | OR | any definite `true` | `true` | `false` — a definite true dominates |
 * | OR | all `false` except ≥1 indeterminate | `false` | `true` |
 * | OR | all definite `false` | `false` | `false` |
 * | either | all indeterminate | `false` | `true` |
 *
 * The principle: **report it only when uncertainty could have changed the
 * answer.** So the rule is "some condition is indeterminate, and no condition
 * decided the gate on its own" — the dominating value being `false` under AND
 * and `true` under OR. The last row falls out of the first six rather than
 * being special-cased: with every condition indeterminate there is no dominator
 * under either operator.
 *
 * **`satisfied` is NOT recomputed here.** It stays legacy's `every`/`some` over
 * the conditions, which already yields `false` for an indeterminate condition
 * because every fail-closed kernel branch returns `satisfied: false` with it.
 * Deriving it a second way would be a second thing to keep in step.
 *
 * A condition reporting `satisfied: true` **and** `indeterminate: true` is
 * unreachable from every kernel branch today — INDETERMINATE always fails
 * closed — and is classified here as neither a definite true nor a definite
 * false, i.e. as a dominator of nothing. That is the conservative reading, and
 * it is the reason the predicates below are written positively rather than as
 * `!indeterminate` shorthands.
 */
function compoundIndeterminate(
  op: 'AND' | 'OR',
  results: readonly ConditionOutcome[],
): boolean {
  const isIndeterminate = (r: ConditionOutcome) => r.indeterminate === true;
  const dominates = (r: ConditionOutcome) =>
    op === 'AND' ? !r.satisfied && !isIndeterminate(r) : r.satisfied && !isIndeterminate(r);
  if (results.some(dominates)) return false;
  return results.some(isIndeterminate);
}

function evaluateCompound(
  gate: GateProperties,
  deps: GateEvaluationDeps,
): GateEvaluationResult {
  if (!gate.conditions || gate.conditions.length === 0) {
    return {
      satisfied: false,
      reason: 'Compound gate has no conditions',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const op = gate.operator ?? 'AND';
  const allFieldsRead: string[] = [];
  // Typed as the full outcome, not `{satisfied, reason}`: the D5 signals died at
  // this boundary because the narrowed type made dropping them invisible.
  const results: ConditionOutcome[] = [];

  // Resolved once for the whole gate: sibling conditions must never evaluate
  // against different policy versions.
  const evaluateOneCondition = conditionEvaluatorFor(deps);

  for (const condition of gate.conditions) {
    const result = evaluateOneCondition(condition, deps);
    results.push(result);
    allFieldsRead.push(...result.fieldsRead);
  }

  const uniqueFields = [...new Set(allFieldsRead)];

  let out: GateEvaluationResult;
  if (op === 'AND') {
    const allSatisfied = results.every((r) => r.satisfied);
    const failedReasons = results
      .filter((r) => !r.satisfied)
      .map((r) => r.reason);
    out = {
      satisfied: allSatisfied,
      reason: allSatisfied
        ? 'All compound conditions satisfied'
        : `Unsatisfied conditions: ${failedReasons.join('; ')}`,
      contextFieldsRead: uniqueFields,
      dependedOnNodes: [],
    };
  } else {
    // OR
    const anySatisfied = results.some((r) => r.satisfied);
    const satisfiedReasons = results
      .filter((r) => r.satisfied)
      .map((r) => r.reason);
    out = {
      satisfied: anySatisfied,
      reason: anySatisfied
        ? `Satisfied conditions: ${satisfiedReasons.join('; ')}`
        : 'No compound conditions satisfied',
      contextFieldsRead: uniqueFields,
      dependedOnNodes: [],
    };
  }

  // ─── The D5 signals cross the compound boundary (Task 8) ───────────
  //
  // Copied only when a condition actually reported them, per key, which is the
  // `v1` kernel alone: setting them unconditionally would put
  // `indeterminate: undefined` on every `legacy-v0` compound result and break
  // `toEqual` against today's shape, and a behavior change reachable under
  // `legacy-v0` is a bug in the seam (locked decision #2). Same rule as the
  // single-condition path in `evaluatePatientAttribute`.
  //
  // A condition that reported NEITHER key — `patient.*` under `v1`, which keeps
  // `resolveAttribute` forever (D3) — reads as definite and doubt-free, which is
  // what `indeterminate === true` and `?? []` below give it. Absent must not
  // mean "unknown", or every demographic condition would make its gate
  // indeterminate.
  if (results.some((r) => r.indeterminate !== undefined)) {
    out.indeterminate = compoundIndeterminate(op, results);
  }
  // The DEDUPLICATED UNION, retained regardless of `indeterminate` (D5, P1-11).
  // The two signals are independent: a definite `true` dominating an OR does not
  // make the excluded uncertain facts imaginary, and plan 08's evidence has to
  // show them. Each condition's array already unions its per-fact reasons with
  // the outcome-level ones (`AMBIGUOUS_LATEST` / `AMBIGUOUS_SERIES_ORDER` exist
  // only on the outcome), so this needs no second source.
  if (results.some((r) => r.uncertainty !== undefined)) {
    out.uncertainty = [...new Set(results.flatMap((r) => r.uncertainty ?? []))];
  }
  return out;
}

// ─── llm_text_analysis evaluator ──────────────────────────────────────

/**
 * Result of one LLM gate evaluation, in the shape the gate-evaluator expects
 * back from its async callback. The callback owns the actual API call,
 * caching, audit-trail writing — this layer just consumes the verdict and
 * folds it into a GateEvaluationResult.
 */
export interface LlmGateVerdict {
  chosenBranch: string;
  confidence: number;
  reasoning: string;
  /** True if the LLM call itself failed; evaluator falls back to safe-default. */
  failed?: boolean;
  errorMessage?: string;
}

export type LlmGateEvaluator = (
  gate: GateProperties,
  gateId: string,
  patientContext: PatientContext,
) => Promise<LlmGateVerdict>;

async function evaluateLlmTextAnalysis(
  gate: GateProperties,
  gateId: string | undefined,
  patientContext: PatientContext,
  llmEvaluator?: LlmGateEvaluator,
): Promise<GateEvaluationResult> {
  if (!gateId) {
    return {
      satisfied: false,
      reason: 'LLM gate evaluated without gateId',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }
  if (!gate.branches || gate.branches.length === 0) {
    return {
      satisfied: false,
      reason: 'LLM gate has no declared branches',
      contextFieldsRead: [],
      dependedOnNodes: [],
    };
  }

  const safeDefault =
    gate.branches.find((b) => b.is_safe_default)?.name ?? gate.branches[0].name;
  const threshold = gate.confidence_threshold ?? 0.75;
  const inputAttr = gate.input_attribute ?? '';

  // Missing callback (no LLM_GATE_API_KEY configured) → fall back to
  // safe-default + tentative, so the gate surfaces as a pending question
  // for manual provider answer.
  if (!llmEvaluator) {
    return {
      satisfied: true,
      reason: 'LLM gate evaluator not configured; defaulted to safe branch',
      contextFieldsRead: inputAttr ? [inputAttr] : [],
      dependedOnNodes: [],
      tentative: true,
      chosenBranch: safeDefault,
      llmConfidence: 0,
      llmReasoning: 'LLM gate evaluator not configured.',
    };
  }

  const verdict = await llmEvaluator(gate, gateId, patientContext);

  if (verdict.failed) {
    return {
      satisfied: true,
      reason: `LLM call failed (${verdict.errorMessage ?? 'unknown'}); defaulted to safe branch`,
      contextFieldsRead: inputAttr ? [inputAttr] : [],
      dependedOnNodes: [],
      tentative: true,
      chosenBranch: safeDefault,
      llmConfidence: 0,
      llmReasoning: verdict.errorMessage ?? 'LLM call failed',
    };
  }

  const tentative = verdict.confidence < threshold;
  const effectiveBranch = tentative ? safeDefault : verdict.chosenBranch;
  return {
    // A gate is "satisfied" (subtree traversed) whenever it routes a branch.
    // For LLM gates the branch IS the gate's output; downstream branch routing
    // is handled separately by the traversal engine via gate properties.
    satisfied: true,
    reason: tentative
      ? `LLM picked "${verdict.chosenBranch}" with confidence ${verdict.confidence.toFixed(2)} < ${threshold}; routing safe-default "${safeDefault}" pending provider confirmation`
      : `LLM picked "${verdict.chosenBranch}" with confidence ${verdict.confidence.toFixed(2)}`,
    contextFieldsRead: inputAttr ? [inputAttr] : [],
    dependedOnNodes: [],
    tentative,
    chosenBranch: effectiveBranch,
    llmConfidence: verdict.confidence,
    llmReasoning: verdict.reasoning,
  };
}

// ─── Main Evaluator ───────────────────────────────────────────────────

/**
 * Everything a gate evaluation reads, as one object (D6).
 *
 * An options object rather than eight positional parameters because the two
 * cascade inputs — the clock and the pathway defaults — must be **impossible
 * to omit**. As positional arguments they were both defaultable, and an
 * omitted `pathwayDefaults` at one of five construction sites is a silent
 * divergence generator: that pathway evaluates against system defaults while
 * its own preflight used pathway defaults (P1-10, locked decision #7).
 */
export interface GateEvaluationDeps {
  /**
   * The session's pinned evaluation clock and policy version. Required — the
   * `Date.now()` fallback this replaced meant a retraversal could silently
   * resolve against a different instant than the traversal it repeats.
   */
  temporalContext: EvaluationTemporalContext;
  /**
   * The PATHWAY tier of the horizon/status cascade, from
   * `rctx.temporalDefaults`. Required, never optional: see above.
   */
  pathwayDefaults: PathwayTemporalDefaults;
  /**
   * The normalized facts the `v1` kernel selects from. Empty at Task 3 and on
   * `legacy-v0` forever — the assembler that fills it is wired at Task 9,
   * under `v1` only (locked decision #5).
   */
  factStore: FactStore;
  /** Current patient clinical context. */
  patientContext: PatientContext;
  /** Map of nodeId → NodeResult, for `prior_node_result` gates. */
  resolutionState: Map<string, NodeResult>;
  /** Map of gateId → provider answer, for `question` gates. */
  gateAnswers: Map<string, GateAnswer>;
  /** The gate's own ID (needed for question + LLM lookup). */
  gateId?: string;
  /**
   * Optional async callback that performs the LLM call for
   * `llm_text_analysis` gates. The resolver wires this in (with caching +
   * audit-trail writing); call sites that don't supply it default LLM gates
   * to the safe-default branch with `tentative: true`.
   */
  llmEvaluator?: LlmGateEvaluator;
  /**
   * Namespace/system/code lookup table for attribute conditions (e.g.
   * `lab.hemoglobin` → LOINC 718-7).
   *
   * REQUIRED (R11-4), for the reason P1-10 promoted `pathwayDefaults` and
   * Task 9 promoted `factStore`: omitted at one of five construction sites,
   * every mapped `lab.*` and `allergy.*` gate adapts to `null`, falls back to
   * `resolveAttribute` with nothing to look up, and answers a quiet `false` —
   * indistinguishable at the audit row from a patient who genuinely has no
   * such lab. An EMPTY map is legitimate (`legacy-v0` never reads it, and a
   * deployment with no registry rows has one); an ABSENT one is a wiring bug.
   */
  codeMap: AttributeCodeMap;
}

/**
 * Guard the two required cascade inputs at runtime.
 *
 * A type alone enforces nothing here: `tsconfig` excludes `src/__tests__` with
 * `diagnostics: false`, so no test caller is ever typechecked, and the engines
 * are constructed from resolvers whose `rctx` shape is partly `unknown` at the
 * boundary. Every invariant this seam depends on needs a throw.
 */
function assertRequiredDeps(deps: GateEvaluationDeps): void {
  if (!deps || !deps.temporalContext) {
    throw new TemporalContextError(
      'evaluateGate requires an explicit temporalContext — there is no wall-clock fallback',
      'INVALID_CLOCK',
    );
  }
  if (!deps.pathwayDefaults) {
    throw new TemporalContextError(
      'evaluateGate requires pathwayDefaults — omitting it resolves gates against ' +
        'system defaults while their preflight used the pathway defaults',
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  // An ABSENT store is a wiring bug; an EMPTY one is `legacy-v0` working as
  // designed, so the test is `Array.isArray`, not truthiness. Under `v1` an
  // omitted store makes every kernel branch select from nothing and answer a
  // quiet `false` — indistinguishable at the audit row from a patient who
  // genuinely has no such fact (R11-4's failure mode, for the input that
  // matters most).
  if (!Array.isArray(deps.factStore)) {
    throw new TemporalContextError(
      'evaluateGate requires an explicit factStore — `[]` under legacy-v0, the ' +
        'assembled store under v1; omitting it makes every v1 gate select from nothing',
      'INVALID_RESOLUTION_INPUT',
    );
  }
  // Same shape, same reasoning (R11-4). Checked on BOTH versions —
  // `evaluateConditionLegacyAdapted` reads the map too, and an input checked on
  // one branch is an input one branch can skip.
  assertEngineCodeMap(deps.codeMap, 'evaluateGate');
}

/**
 * The `codeMap` wiring invariant, in one place (R11-4).
 *
 * `instanceof Map` rather than truthiness, for the reason `factStore` uses
 * `Array.isArray`: an EMPTY map is a legitimate deployment — `legacy-v0` never
 * reads it, and an installation with no attribute registry rows has one — while
 * an absent or wrong-typed map is a wiring bug whose only symptom would
 * otherwise be an attribute gate answering a quiet `false`.
 *
 * Exported so both engine constructors assert the same rule with the same
 * message rather than each spelling its own; the engines are the sites where
 * the argument can actually go missing.
 */
export function assertEngineCodeMap(codeMap: unknown, where: string): void {
  if (codeMap instanceof Map) return;
  throw new TemporalContextError(
    `${where} requires an explicit codeMap (an empty Map is fine) — omitting it makes ` +
      'every mapped lab.* / allergy.* attribute gate answer a quiet false, which is ' +
      'indistinguishable at the audit row from a patient who has no such fact',
    'INVALID_RESOLUTION_INPUT',
  );
}

/**
 * Evaluate a gate to determine if its guarded subtree should be traversed.
 *
 * @param gate - The gate's properties (type, condition, depends_on, etc.)
 * @param deps - Everything the evaluation reads; see `GateEvaluationDeps`.
 */
export async function evaluateGate(
  gate: GateProperties,
  deps: GateEvaluationDeps,
): Promise<GateEvaluationResult> {
  assertRequiredDeps(deps);
  // Checked here rather than lazily inside the condition evaluator: a question
  // or prior_node_result gate reads no condition, and a session pinned to a
  // version the registry cannot resolve must not quietly succeed through one.
  assertKnownPolicyVersion(deps.temporalContext.temporalPolicyVersion);

  switch (gate.gate_type) {
    case GateType.PATIENT_ATTRIBUTE:
      return evaluatePatientAttribute(gate, deps);

    case GateType.QUESTION:
      return evaluateQuestion(gate, deps.gateAnswers, deps.gateId);

    case GateType.PRIOR_NODE_RESULT:
      return evaluatePriorNodeResult(gate, deps.resolutionState);

    case GateType.COMPOUND:
      return evaluateCompound(gate, deps);

    case GateType.LLM_TEXT_ANALYSIS:
      return evaluateLlmTextAnalysis(gate, deps.gateId, deps.patientContext, deps.llmEvaluator);

    default:
      return {
        satisfied: false,
        reason: `Unknown gate type: ${gate.gate_type}`,
        contextFieldsRead: [],
        dependedOnNodes: [],
      };
  }
}
