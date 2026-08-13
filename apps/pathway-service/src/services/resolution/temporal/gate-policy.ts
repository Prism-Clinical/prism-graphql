import { EffectivePolicy } from './select-facts';
import { EvaluationTemporalContext } from './evaluation-context';
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
 */
export function effectivePolicyFor(
  adapted: AdaptedCondition,
  ctx: EvaluationTemporalContext,
  pathwayDefaults: PathwayTemporalDefaults,
): EffectivePolicy {
  const tier = resolveEffectivePolicy(
    adapted.selection.field,
    ctx.temporalPolicyVersion,
    pathwayDefaults,
    adapted.override,
  );
  return toEffectivePolicy(tier, ctx);
}
