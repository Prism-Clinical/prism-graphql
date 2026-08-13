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

/**
 * The registry IS the version vocabulary — derived, never restated.
 *
 * A second hand-written union would let a version exist in one list and not the
 * other, which is precisely the class of defect the capability table below
 * exists to end.
 */
export type TemporalPolicyVersion = keyof typeof POLICIES;

export const KNOWN_TEMPORAL_POLICY_VERSIONS: readonly TemporalPolicyVersion[] = Object.freeze(
  Object.keys(TEMPORAL_POLICIES) as TemporalPolicyVersion[],
);

/**
 * What a version DOES, as data — so nothing has to ask "is this the default?"
 * in order to find out.
 *
 * The bug this closes: `DEFAULT_TEMPORAL_POLICY_VERSION` did double duty. It was
 * both the **deployment default** (`index.ts:30`) and the semantic test for
 * **"is this the legacy path?"** — `version !== DEFAULT` chose the sweep
 * (`resolution-context.ts`), `version === DEFAULT` chose the preflight branch,
 * and `=== DEFAULT` decided whether a fact store was assembled at all
 * (`fact-store.ts`). Flipping the constant to `v1` — which is literally the
 * rollout action this whole plan exists to enable — would therefore have given
 * `v1` the LEGACY sweep, the LEGACY preflight and an EMPTY fact store, while
 * handing `legacy-v0` the kernel treatment. Three silent inversions from a
 * one-line config change.
 *
 * Capabilities are per-version facts. The default is a deployment choice. They
 * are now different things, and the rollout flip moves only the second.
 *
 *  - **`evaluationMode`** — `'legacy'` routes to the untouched legacy condition
 *    evaluator, today's sweep and today's preflight; `'kernel'` routes to the
 *    `selectFacts` kernel, the adapter-based sweep and the unconditional `v1`
 *    preflight (D1, P1-18).
 *  - **`requiresFactStore`** — whether the assembler runs at all. `false` is not
 *    an optimization: `assembleContext` VALIDATES, so running it for a
 *    `legacy-v0` request would turn a malformed date the legacy evaluator
 *    ignores into a session-creation rejection (P1-9).
 *
 * **`requiresFactStore` is DERIVED from `evaluationMode`, not declared beside
 * it (R14-2).** It was declared independently, which made a version that
 * disagreed with itself representable: `{ evaluationMode: 'kernel',
 * requiresFactStore: false }` compiles, boots, passes every coverage check, and
 * evaluates every kernel gate against an empty store — every membership gate
 * unsatisfied, silently. There is exactly one declaration per version now, and
 * it is the mode.
 */
export interface TemporalPolicyCapabilities {
  readonly evaluationMode: EvaluationMode;
  readonly requiresFactStore: boolean;
}

/**
 * The evaluation-mode vocabulary, and the SOURCE of the mode type.
 *
 * A hand-written `'legacy' | 'kernel'` union would have nothing to enumerate at
 * runtime, and the evaluator table's coverage check has to iterate the modes —
 * the same reason `TemporalPolicyVersion` is derived from `POLICIES` rather
 * than restated.
 */
export const EVALUATION_MODES = Object.freeze(['legacy', 'kernel'] as const);
export type EvaluationMode = (typeof EVALUATION_MODES)[number];

/**
 * Kernel evaluation reads an assembled fact store; legacy evaluation must NOT
 * have one assembled, because assembling it validates (P1-9).
 *
 * A TABLE, not `mode === 'kernel'`. The predicate form answered `false` for
 * every mode it had never heard of, so adding a third mode forced an evaluator
 * entry — the coverage check sees to that — but **silently granted it an empty
 * fact store**. A kernel-like third mode would have evaluated against no facts
 * and every gate would have quietly answered `false`, which is the failure this
 * whole capability layer exists to make impossible.
 *
 * `Record<EvaluationMode, boolean>` makes the omission a COMPILE error: add a
 * mode to `EVALUATION_MODES` and this object stops type-checking until the new
 * mode declares what it needs. The runtime throw below covers a mode arriving
 * from outside the type, which `tsconfig` cannot police (it is not full strict
 * and excludes `src/__tests__`).
 */
const MODE_REQUIRES_FACT_STORE: Record<EvaluationMode, boolean> = {
  legacy: false,
  kernel: true,
};

export function modeRequiresFactStore(mode: EvaluationMode): boolean {
  const required = MODE_REQUIRES_FACT_STORE[mode];
  if (typeof required !== 'boolean') {
    throw new TemporalContextError(
      `evaluation mode "${mode}" declares no fact-store requirement ` +
        `(known: ${EVALUATION_MODES.join(', ')})`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return required;
}

/** The full capability row implied by a mode. A version declares only the mode. */
export function capabilitiesFor(mode: EvaluationMode): TemporalPolicyCapabilities {
  return { evaluationMode: mode, requiresFactStore: modeRequiresFactStore(mode) };
}

// `satisfies Record<TemporalPolicyVersion, EvaluationMode>`: adding a version to
// POLICIES without a mode is a COMPILE error, not a runtime surprise. This table
// is the ONLY place a version's routing is written down.
const EVALUATION_MODE_BY_VERSION = {
  'legacy-v0': 'legacy',
  v1: 'kernel',
} satisfies Record<TemporalPolicyVersion, EvaluationMode>;

export const TEMPORAL_POLICY_CAPABILITIES: Readonly<
  Record<TemporalPolicyVersion, TemporalPolicyCapabilities>
> = deepFreeze(
  Object.fromEntries(
    Object.entries(EVALUATION_MODE_BY_VERSION).map(([version, mode]) => [
      version,
      capabilitiesFor(mode),
    ]),
  ) as Record<TemporalPolicyVersion, TemporalPolicyCapabilities>,
);

// The runtime half of the same guarantee. `tsconfig` is not full strict and
// excludes `src/__tests__`, so the `satisfies` above binds only this file's
// authors; this binds the module load. A version that reaches production
// without capabilities must never be resolvable, and a mode outside the
// vocabulary must never reach the evaluator table's keys.
for (const mode of EVALUATION_MODES) {
  if (typeof MODE_REQUIRES_FACT_STORE[mode] !== 'boolean') {
    throw new TemporalContextError(
      `evaluation mode "${mode}" is in the vocabulary but declares no fact-store ` +
        `requirement — every mode must state what it needs`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
}

for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
  if (!Object.prototype.hasOwnProperty.call(TEMPORAL_POLICY_CAPABILITIES, version)) {
    throw new TemporalContextError(
      `temporal policy version "${version}" has a policy set but no capabilities`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  const mode = TEMPORAL_POLICY_CAPABILITIES[version].evaluationMode;
  if (!EVALUATION_MODES.includes(mode)) {
    throw new TemporalContextError(
      `temporal policy version "${version}" declares unknown evaluationMode "${mode}" ` +
        `(known: ${EVALUATION_MODES.join(', ')})`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
}

/**
 * What this version does. Throws for an unregistered version, exactly as
 * `getTemporalPolicy` does — a caller must never get a default set of
 * capabilities for a version nobody declared.
 */
export function policyCapabilities(version: string): TemporalPolicyCapabilities {
  if (!Object.prototype.hasOwnProperty.call(TEMPORAL_POLICY_CAPABILITIES, version)) {
    throw new TemporalContextError(
      `unknown temporalPolicyVersion "${version}" ` +
        `(known: ${KNOWN_TEMPORAL_POLICY_VERSIONS.join(', ')})`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return TEMPORAL_POLICY_CAPABILITIES[version as TemporalPolicyVersion];
}

/**
 * Does this version evaluate through the kernel — the sweep, the preflight and
 * the condition evaluator, which must always be the same answer?
 *
 * One predicate for all three, deliberately. Three call sites each comparing
 * against a constant is how they came to be able to disagree.
 */
export function usesKernelEvaluation(version: string): boolean {
  return policyCapabilities(version).evaluationMode === 'kernel';
}

/**
 * Does this version read an assembled fact store (locked decision #5)?
 *
 * Reads the same capability row `usesKernelEvaluation` reads, whose two fields
 * come from one declaration — so this and the evaluator choice cannot disagree.
 */
export function requiresFactStore(version: string): boolean {
  return policyCapabilities(version).requiresFactStore;
}

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
