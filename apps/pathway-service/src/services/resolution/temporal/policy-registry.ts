import { Horizon, TemporalContextError } from './evaluation-context';
import { GateField, FIELD_TO_KIND, fieldToKind } from './contract';

/** Author-selectable clinical state filter (design §3). */
export type TemporalStatus = 'active' | 'inactive' | 'any';

export interface FieldPolicy {
  readonly horizon: Horizon;
  /**
   * Absent for observation fields — labs and vitals carry no clinical state
   * (`stateMatch: NOT_APPLICABLE`), so a status here would be meaningless.
   */
  readonly status?: TemporalStatus;
}

export type TemporalPolicySet = Readonly<Record<GateField, FieldPolicy>>;

/**
 * Does this gate field's fact kind carry a clinical state?
 *
 * Derived from Plan 01's FIELD_TO_KIND rather than restated as its own list:
 * the fact model already decides which kinds are stateful (StatefulFact vs
 * ObservationFact), and a second copy of that decision would drift the first
 * time a field is added.
 */
export function fieldHasClinicalState(field: GateField): boolean {
  const kind = fieldToKind(field); // throws on an unknown field
  return kind !== 'lab' && kind !== 'vital';
}

/**
 * Immutable, versioned platform defaults (design §5).
 *
 * Rules, in force for every future edit:
 *   - NEVER change what an existing version means — add a new one.
 *   - An unknown version is a hard error, never "use the latest".
 *   - Every rolling-deployment pod must understand every still-active
 *     session's version, so a version is only removed once no session pins it.
 *
 * `legacy-v0` reproduces today's *effective* semantics: every operator
 * currently ignores time, so every field is LIFETIME. It is NOT replayable
 * through the new kernel (§5) — it is the default until the v1 flip, not a
 * time machine.
 */
/**
 * Freeze every level, not just the top two.
 *
 * `Object.freeze` is shallow, so a future custom-horizon default written as
 * `{ horizon: { days: 30 } }` would leave that inner object mutable — and an
 * existing version's meaning must never be mutable, which is the entire point
 * of the registry. Latent while every horizon is a string; deliberately fixed
 * before it can bite.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// `satisfies` rather than `as`: an assertion would weaken the completeness
// check, and a version missing a GateField must be a compile error.
const POLICIES = {
  'legacy-v0': {
    conditions: { horizon: 'LIFETIME', status: 'active' },
    medications: { horizon: 'LIFETIME', status: 'active' },
    allergies: { horizon: 'LIFETIME', status: 'active' },
    labs: { horizon: 'LIFETIME' },
    vitals: { horizon: 'LIFETIME' },
  },
  v1: {
    conditions: { horizon: 'LIFETIME', status: 'active' },
    medications: { horizon: 'LIFETIME', status: 'active' },
    allergies: { horizon: 'LIFETIME', status: 'active' },
    // A lifetime of lab results is not "the patient's A1c" — 90 days is.
    // This is a deliberate, versioned behavior change (§Compatibility).
    labs: { horizon: 'QUARTER' },
    // Vitals are encounter-scoped (§10). This hard-requires an encounterStart
    // on any session whose pathway reads vitals — see
    // collectEncounterAnchorRequirements, which rejects such a session up
    // front rather than throwing partway through a traversal.
    vitals: { horizon: 'ENCOUNTER' },
  },
} satisfies Record<string, TemporalPolicySet>;

export const TEMPORAL_POLICIES: Readonly<Record<string, TemporalPolicySet>> = deepFreeze(POLICIES);

export const KNOWN_TEMPORAL_POLICY_VERSIONS: readonly string[] = Object.freeze(
  Object.keys(TEMPORAL_POLICIES),
);

export function getTemporalPolicy(version: string): TemporalPolicySet {
  // Own-property check: a plain `TEMPORAL_POLICIES[version]` lookup would
  // resolve 'constructor'/'toString' off Object.prototype and hand back a
  // function as if it were a policy set.
  if (!Object.prototype.hasOwnProperty.call(TEMPORAL_POLICIES, version)) {
    throw new TemporalContextError(
      `unknown temporalPolicyVersion "${version}" ` +
        `(known: ${KNOWN_TEMPORAL_POLICY_VERSIONS.join(', ')})`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return TEMPORAL_POLICIES[version];
}

/**
 * Assert a version exists, for call sites that only want the check.
 *
 * Exists so the resolver boundary reads as an assertion rather than a
 * discarded lookup — the two mutations call this immediately after creating
 * the clock, covering paths where no condition is ever swept (zero matched
 * pathways, every graph empty).
 */
export function assertKnownPolicyVersion(version: string): void {
  getTemporalPolicy(version);
}

export function systemDefaultFor(field: GateField, version: string): FieldPolicy {
  const set = getTemporalPolicy(version);
  if (!Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)) {
    throw new TemporalContextError(`unknown gate field "${field}"`, 'UNKNOWN_POLICY_VERSION');
  }
  return set[field];
}
