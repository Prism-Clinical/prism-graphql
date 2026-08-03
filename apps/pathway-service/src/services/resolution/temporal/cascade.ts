import {
  Horizon,
  isNamedHorizon,
  isCustomHorizon,
  MAX_CUSTOM_HORIZON_DAYS,
  TemporalContextError,
  EvaluationTemporalContext,
  resolveHorizon,
  requiresEncounterAnchor,
} from './evaluation-context';
import { GateField, FIELD_TO_KIND } from './contract';
import {
  TemporalStatus,
  FieldPolicy,
  fieldHasClinicalState,
  systemDefaultFor,
  getTemporalPolicy,
} from './policy-registry';
import { EffectivePolicy } from './select-facts';

/** The PATHWAY level of the cascade, as loaded from `temporal_defaults`. */
export interface PathwayTemporalDefaults {
  horizons?: Partial<Record<GateField, Horizon>>;
  statuses?: Partial<Record<GateField, TemporalStatus>>;
}

const STATUSES: readonly string[] = ['active', 'inactive', 'any'];

function isGateField(k: string): k is GateField {
  return Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, k);
}

/**
 * Validate one horizon value from stored or authored JSON.
 *
 * Enforces exactly what `resolveHorizon` enforces at evaluation time — same
 * named tiers, same integer day bounds, same maximum — so an invalid horizon
 * is caught once at load with a message naming the key, instead of throwing
 * from `overlap()` on every fact halfway through a traversal.
 *
 * `where` is the dotted key path, used only for the error message.
 */
export function parseHorizonValue(raw: unknown, where: string): Horizon {
  if (isNamedHorizon(raw)) return raw;

  if (isCustomHorizon(raw)) {
    const { days } = raw;
    if (!Number.isInteger(days) || days <= 0 || days > MAX_CUSTOM_HORIZON_DAYS) {
      throw new TemporalContextError(
        `${where}: horizon day count must be an integer in 1..${MAX_CUSTOM_HORIZON_DAYS} (got: ${days})`,
        'INVALID_HORIZON',
      );
    }
    // Normalize: keep only `days`, so an authoring decoration cannot ride
    // along into the evaluation path or a persisted policy.
    return { days };
  }

  throw new TemporalContextError(
    `${where}: not a horizon (got: ${JSON.stringify(raw)})`,
    'INVALID_HORIZON',
  );
}

function parseStatusValue(raw: unknown, where: string): TemporalStatus {
  if (typeof raw === 'string' && STATUSES.includes(raw)) return raw as TemporalStatus;
  throw new TemporalContextError(
    `${where}: status must be one of ${STATUSES.join(' | ')} (got: ${JSON.stringify(raw)})`,
    'INVALID_TEMPORAL_DEFAULTS',
  );
}

function asRecord(raw: unknown, where: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TemporalContextError(
      `${where}: expected an object (got: ${JSON.stringify(raw)})`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  return raw as Record<string, unknown>;
}

/**
 * Turn the stored `pathway_graph_index.temporal_defaults` value into the
 * PATHWAY cascade level.
 *
 * Fails closed. Plan 06's import validator guards the write path, so anything
 * malformed reaching here is corruption — and silently discarding an author's
 * horizon would resolve gates against a window they never chose, invisibly.
 */
export function parsePathwayTemporalDefaults(raw: unknown): PathwayTemporalDefaults {
  if (raw === null || raw === undefined) return {};

  // node-postgres returns JSONB already parsed, but a text column, a driver
  // change, or a hand-written fixture can hand back the string form.
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TemporalContextError(
        `temporal_defaults: not valid JSON (got: ${raw})`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
  }

  const root = asRecord(value, 'temporal_defaults');

  // Allowlist the root keys. Without this a typo — `default_horizon`,
  // singular — parses to `{}` and the author's override is silently replaced
  // by the system defaults, which is exactly the failure the fail-closed
  // contract exists to prevent. Ignoring an unknown key is indistinguishable
  // from ignoring the author.
  for (const key of Object.keys(root)) {
    if (key !== 'default_horizons' && key !== 'default_statuses') {
      throw new TemporalContextError(
        `temporal_defaults.${key}: unknown key (expected default_horizons or default_statuses)`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
  }

  const out: PathwayTemporalDefaults = {};

  // An ABSENT section means "inherit". A section that is present but null is
  // not the same thing — asRecord rejects it. Exempting null here would let
  // {"default_horizons": null} silently resolve every gate against system
  // defaults while the stored document looks like it states an opinion.
  if (root.default_horizons !== undefined) {
    const src = asRecord(root.default_horizons, 'temporal_defaults.default_horizons');
    const horizons: Partial<Record<GateField, Horizon>> = {};
    for (const [key, val] of Object.entries(src)) {
      if (!isGateField(key)) {
        throw new TemporalContextError(
          `default_horizons.${key}: unknown gate field`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      horizons[key] = parseHorizonValue(val, `default_horizons.${key}`);
    }
    if (Object.keys(horizons).length > 0) out.horizons = horizons;
  }

  if (root.default_statuses !== undefined) {
    const src = asRecord(root.default_statuses, 'temporal_defaults.default_statuses');
    const statuses: Partial<Record<GateField, TemporalStatus>> = {};
    for (const [key, val] of Object.entries(src)) {
      if (!isGateField(key)) {
        throw new TemporalContextError(
          `default_statuses.${key}: unknown gate field`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      if (!fieldHasClinicalState(key)) {
        throw new TemporalContextError(
          `default_statuses.${key}: ${key} have no clinical state, so a status is meaningless`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      statuses[key] = parseStatusValue(val, `default_statuses.${key}`);
    }
    if (Object.keys(statuses).length > 0) out.statuses = statuses;
  }

  return out;
}

/** Which cascade level supplied a resolved value — surfaced in evidence (Plan 08). */
export type PolicyLevel = 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';

/** The NODE level: the author's per-condition overrides. */
export interface ConditionTemporalOverride {
  horizon?: Horizon;
  status?: TemporalStatus;
}

/**
 * A resolved policy that has NOT yet been anchored to a clock. Horizon is
 * still a tier (`'QUARTER'`, `{days:45}`), not a date range — resolving it
 * requires the session's pinned context, and keeping that separate is what
 * lets the cascade be tested without a clock and keeps `evaluationAsOf` the
 * single wall-clock read.
 */
export interface PolicyTier {
  horizon: Horizon;
  status?: TemporalStatus;
  horizonLevel: PolicyLevel;
  statusLevel?: PolicyLevel;
}

/**
 * Resolve SYSTEM_DEFAULT → PATHWAY → NODE for one (field, condition) pair
 * (design §5).
 *
 * The two axes resolve independently: a condition that overrides only
 * `status` keeps whatever horizon it inherits, and vice versa. Folding them
 * into one "the node has an opinion" check would silently reset the other.
 *
 * Observation fields never carry a status at any level.
 */
export function resolveEffectivePolicy(
  field: GateField,
  version: string,
  pathwayDefaults: PathwayTemporalDefaults,
  condition?: ConditionTemporalOverride,
): PolicyTier {
  const system: FieldPolicy = systemDefaultFor(field, version);

  let horizon: Horizon = system.horizon;
  let horizonLevel: PolicyLevel = 'SYSTEM_DEFAULT';

  const fromPathway = pathwayDefaults.horizons?.[field];
  if (fromPathway !== undefined) {
    horizon = parseHorizonValue(fromPathway, `default_horizons.${field}`);
    horizonLevel = 'PATHWAY';
  }
  if (condition?.horizon !== undefined) {
    horizon = parseHorizonValue(condition.horizon, `condition.horizon (${field})`);
    horizonLevel = 'NODE';
  }

  if (!fieldHasClinicalState(field)) {
    if (condition?.status !== undefined) {
      throw new TemporalContextError(
        `condition.status (${field}): ${field} have no clinical state, so a status is meaningless`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
    return { horizon, horizonLevel };
  }

  let status: TemporalStatus | undefined = system.status;
  let statusLevel: PolicyLevel | undefined = status === undefined ? undefined : 'SYSTEM_DEFAULT';

  const statusFromPathway = pathwayDefaults.statuses?.[field];
  if (statusFromPathway !== undefined) {
    status = parseStatusValue(statusFromPathway, `default_statuses.${field}`);
    statusLevel = 'PATHWAY';
  }
  if (condition?.status !== undefined) {
    status = parseStatusValue(condition.status, `condition.status (${field})`);
    statusLevel = 'NODE';
  }

  const tier: PolicyTier = { horizon, horizonLevel };
  if (status !== undefined) {
    tier.status = status;
    tier.statusLevel = statusLevel;
  }
  return tier;
}

/**
 * Anchor a resolved tier to the session's pinned clock, producing the
 * `EffectivePolicy` Plan 01's `selectFacts` consumes.
 *
 * Throws `MISSING_ENCOUNTER_ANCHOR` when an ENCOUNTER horizon has no
 * `encounterStart` — `resolveHorizon` never substitutes `evaluationAsOf`,
 * which would silently narrow the window to zero width. Call
 * `collectEncounterAnchorRequirements` at session creation so this surfaces
 * before a traversal starts rather than partway through one.
 */
export function toEffectivePolicy(
  tier: PolicyTier,
  ctx: EvaluationTemporalContext,
): EffectivePolicy {
  const policy: EffectivePolicy = { horizon: resolveHorizon(tier.horizon, ctx) };
  if (tier.status !== undefined) policy.status = tier.status;
  return policy;
}

/** One gate condition, reduced to what the anchor sweep needs. */
export interface SweepableCondition {
  /** Human-readable location, used verbatim in the rejection message. */
  label: string;
  field: GateField;
  override?: ConditionTemporalOverride;
}

export interface EncounterAnchorRequirement {
  label: string;
  field: GateField;
  /** Which cascade level introduced the ENCOUNTER horizon. */
  level: PolicyLevel;
}

/**
 * Every condition in a pathway whose effective horizon needs an
 * `encounterStart`, resolved through the same cascade evaluation uses.
 *
 * Run this at session creation. `resolveHorizon` refuses to invent an anchor,
 * so without a preflight the first ENCOUNTER condition throws mid-traversal —
 * after LLM gates have already been called and audit rows written, and with a
 * message that names no gate. Sweeping first turns that into one up-front
 * rejection listing every offending condition.
 *
 * Reports ALL offenders rather than short-circuiting on the first: an author
 * fixing a pathway wants the whole list in one pass.
 */
export function collectEncounterAnchorRequirements(
  conditions: readonly SweepableCondition[],
  version: string,
  pathwayDefaults: PathwayTemporalDefaults,
): EncounterAnchorRequirement[] {
  // Validate the version BEFORE the loop. Left to the loop, an empty or
  // attribute-only pathway would sweep zero conditions, never touch the
  // registry, and report "no anchors needed" for a version that does not
  // exist — the session would then be created pinned to a version nothing
  // can evaluate.
  getTemporalPolicy(version);

  const out: EncounterAnchorRequirement[] = [];
  for (const c of conditions) {
    const tier = resolveEffectivePolicy(c.field, version, pathwayDefaults, c.override);
    if (requiresEncounterAnchor(tier.horizon)) {
      out.push({ label: c.label, field: c.field, level: tier.horizonLevel });
    }
  }
  return out;
}
