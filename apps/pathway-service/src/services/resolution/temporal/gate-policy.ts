import { EffectivePolicy } from './select-facts';
import {
  EvaluationTemporalContext,
  PregnancyWindow,
  pregnancyWindowFrom,
  requiresPregnancyAnchor,
} from './evaluation-context';
import {
  PathwayTemporalDefaults,
  resolveEffectivePolicy,
  toEffectivePolicy,
} from './cascade';
import { AdaptedCondition } from './condition-adapter';

/**
 * Resolve the one `EffectivePolicy` a gate condition is evaluated against.
 *
 * Deliberately thin. Its value is that it is the **single** place that reads
 * `ctx.temporalPolicyVersion`: if each operator branch resolved its own policy,
 * sibling conditions in one traversal could silently evaluate against different
 * versions.
 *
 * **Takes an `AdaptedCondition`, never a raw condition (P1-20).** The cascade
 * key is `adapted.selection.field` and the NODE tier is `adapted.override`, so
 * coded and attribute conditions reach the cascade through byte-identical code.
 * That is what keeps an attribute gate's evaluation agreeing with the anchor
 * preflight that now sweeps it (P1-8). A seam typed on the raw condition could
 * not do this — an `AttributeCondition` has no `field`.
 *
 * The version is taken from the context and is not a parameter: a caller-chosen
 * version is exactly the divergence this function exists to prevent.
 *
 * `MISSING_ENCOUNTER_ANCHOR` propagates. Plan 03's sweep turns that into an
 * up-front session rejection listing every offending gate; catching it here
 * would restore the mid-traversal throw the sweep exists to prevent — after LLM
 * gates have run and audit rows have been written.
 *
 * **The evaluator calls `conditionPolicyFor` (below), not this.** This function
 * has no patient data, so a `horizon: "PREGNANCY"` condition throws
 * `MISSING_PREGNANCY_ANCHOR` here by design; `conditionPolicyFor` is the one
 * that derives the bound and reports a missing gestational age as an outcome.
 */
export function effectivePolicyFor(
  adapted: AdaptedCondition,
  ctx: EvaluationTemporalContext,
  pathwayDefaults: PathwayTemporalDefaults,
  /** The resolved `window_from` lower bound; see `toEffectivePolicy`. */
  anchorLowerBound?: string,
): EffectivePolicy {
  const tier = resolveEffectivePolicy(
    adapted.selection.field,
    ctx.temporalPolicyVersion,
    pathwayDefaults,
    adapted.override,
  );
  return toEffectivePolicy(tier, ctx, anchorLowerBound);
}

/** What `conditionPolicyFor` resolved for one condition. */
export type ConditionPolicy =
  | {
      status: 'RESOLVED';
      policy: EffectivePolicy;
      /** Set when the window is the PREGNANCY horizon's — evidence for the reason string. */
      pregnancy?: PregnancyWindow;
    }
  /**
   * The condition's horizon is PREGNANCY and the patient has no usable
   * gestational age. NOT a policy: there is no window to select over, and the
   * caller must report the condition as unresolved for that datum.
   */
  | { status: 'PREGNANCY_UNDATED' };

/**
 * `effectivePolicyFor`, plus the one horizon whose lower bound is PATIENT data.
 *
 * This is the seam for `horizon: "PREGNANCY"`. The cascade resolves the tier
 * exactly as for every other condition; only then — when the resolved tier IS
 * PREGNANCY — is the gestational age read, through a thunk so a condition that
 * does not need it never touches patient data. The evaluator's four operator
 * classes all call this one function, so none of them can resolve the window
 * differently or forget the missing-age outcome.
 *
 * The age arrives as a thunk rather than as a field on
 * `EvaluationTemporalContext` because that context is PINNED at session
 * creation, and a gestational age answered mid-session must move the window on
 * the very next evaluation.
 */
export function conditionPolicyFor(
  adapted: AdaptedCondition,
  ctx: EvaluationTemporalContext,
  pathwayDefaults: PathwayTemporalDefaults,
  gestationalAgeWeeks: () => unknown,
  /** The resolved `window_from` lower bound; see `toEffectivePolicy`. */
  anchorLowerBound?: string,
): ConditionPolicy {
  const tier = resolveEffectivePolicy(
    adapted.selection.field,
    ctx.temporalPolicyVersion,
    pathwayDefaults,
    adapted.override,
  );
  if (!requiresPregnancyAnchor(tier.horizon)) {
    return { status: 'RESOLVED', policy: toEffectivePolicy(tier, ctx, anchorLowerBound) };
  }
  const pregnancy = pregnancyWindowFrom(gestationalAgeWeeks(), ctx);
  if (pregnancy === null) return { status: 'PREGNANCY_UNDATED' };
  return {
    status: 'RESOLVED',
    policy: toEffectivePolicy(tier, ctx, anchorLowerBound, pregnancy.lowerBound),
    pregnancy,
  };
}
