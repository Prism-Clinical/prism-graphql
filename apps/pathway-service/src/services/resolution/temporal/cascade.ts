import {
  Horizon,
  isNamedHorizon,
  isCustomHorizon,
  MAX_CUSTOM_HORIZON_DAYS,
  TemporalContextError,
} from './evaluation-context';
import { GateField, FIELD_TO_KIND } from './contract';
import { TemporalStatus, fieldHasClinicalState } from './policy-registry';

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

  if (root.default_horizons !== undefined && root.default_horizons !== null) {
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

  if (root.default_statuses !== undefined && root.default_statuses !== null) {
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
