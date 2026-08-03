import { Horizon, TemporalContextError } from './evaluation-context';
import { GateField, FIELD_TO_KIND, fieldToKind } from './contract';

/** Author-selectable clinical state filter (design §3). */
export type TemporalStatus = 'active' | 'inactive' | 'any';

export interface FieldPolicy {
  horizon: Horizon;
  /**
   * Absent for observation fields — labs and vitals carry no clinical state
   * (`stateMatch: NOT_APPLICABLE`), so a status here would be meaningless.
   */
  status?: TemporalStatus;
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
export const TEMPORAL_POLICIES: Readonly<Record<string, TemporalPolicySet>> = Object.freeze({
  'legacy-v0': Object.freeze({
    conditions: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    medications: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    allergies: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    labs: Object.freeze({ horizon: 'LIFETIME' }),
    vitals: Object.freeze({ horizon: 'LIFETIME' }),
  }) as TemporalPolicySet,
  v1: Object.freeze({
    conditions: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    medications: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    allergies: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    // A lifetime of lab results is not "the patient's A1c" — 90 days is.
    // This is a deliberate, versioned behavior change (§Compatibility).
    labs: Object.freeze({ horizon: 'QUARTER' }),
    // Vitals are encounter-scoped (§10). This hard-requires an encounterStart
    // on any session whose pathway reads vitals — see
    // collectEncounterAnchorRequirements, which rejects such a session up
    // front rather than throwing partway through a traversal.
    vitals: Object.freeze({ horizon: 'ENCOUNTER' }),
  }) as TemporalPolicySet,
});

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
