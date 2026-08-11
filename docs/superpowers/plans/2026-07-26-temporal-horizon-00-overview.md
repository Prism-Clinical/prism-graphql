# Pathway Temporal Horizon — Plan Suite Overview

> **For agentic workers:** this is the index for a nine-plan suite. Each numbered
> plan (`2026-07-26-temporal-horizon-0N-*.md`) is executed on its own via
> superpowers:executing-plans or subagent-driven-development. Execute in numeric
> order — later plans consume interfaces earlier plans produce (the
> Produces/Consumes blocks below are the contract).

**Design source:** `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md`
(revised through three review rounds). Section references (§N) point there.

**Goal:** Give pathway authors explicit, layered control over the time window
(`Horizon`) and clinical `status` a gate condition examines, with record-validity
as a non-overridable platform safety filter, reproducible evaluation, and
per-condition audit evidence.

**Repos:** `prism-graphql` (pathway-service) for plans 1–8; `prism-admin-dashboard`
for plan 9 (plan 6 touches both).

## Global Constraints (apply to every plan)

- **Language/stack:** TypeScript 5 strict (`noImplicitAny`, `noImplicitReturns`),
  Apollo Server 4 + Federation 2.10, PostgreSQL 15 + Apache AGE, Redis. Tests: Jest
  + ts-jest, `maxWorkers=1`, 30s timeout, files `*.test.ts` in `src/__tests__/`.
- **Commands (run with `--prefix` / `-C`, never `cd &&`):**
  - Typecheck, from the repo root:
    `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`.
    There is no `typecheck` npm script, there is **no `apps/pathway-service/node_modules`**
    (this monorepo hoists binaries to the root), and bare `npx tsc` resolves to a
    decoy package that prints "This is not the tsc command you are looking for".
    (Corrected during plan 03 execution — the previous instruction to `cd
    apps/pathway-service` first named a directory that does not exist.)
  - Tests: `npm test --prefix apps/pathway-service -- --runInBand <path>`.
    Jest's `testRegex` is `/__tests__/.*.test.ts`, so a test file placed
    anywhere else (e.g. beside its source) is silently **not run**.
- **ts-jest runs with `diagnostics: false`** and `tsconfig` excludes
  `src/__tests__`, so **test files are never typechecked**. A type enforces
  nothing against a test caller: every invariant needs a runtime throw plus a
  test that fails without it.
- **Suite baseline: 9 failures across 2 suites** (`data-completeness-scorer`,
  `patient-match-scorer`), both pre-existing and unrelated. The suite has NEVER
  been green — never expect a clean pass. Passing count after plan 05 and its
  two review rounds: **958 passed / 9 failed / 967 total, 84 of 86 suites
  green** (was 805 passed on `main` @ `8abfda4`). A *third* failing suite
  belongs to whatever plan is in flight.
- **Object key order is NOT stable across a session's lifetime.** Session
  context columns are `JSONB`, and Postgres jsonb reorders keys by (length,
  bytewise): `'{"z_long_key":1,"a":2}'::jsonb` reads back as
  `'{"a":2,"z_long_key":1}'`. Anything deriving an identifier or an ordinal
  from `Object.entries` order must sort canonically first. JSON *arrays* do
  preserve order.
- **Commit prefixes:** `feat:` / `fix:` / `test:` / `refactor:` / `docs:`. No
  `@anthropic.com`/`@claude.com`, no "Generated with" lines. End commit messages
  with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>`.
- **Branch:** `feat/pathway-temporal-horizon` (already checked out in this worktree).
- **v1 vs legacy:** `temporalPolicyVersion` selects **defaults only**, not the whole
  kernel. The current evaluator is the shadow baseline; existing sessions are
  non-retraversable (§5).
- **The "no production sessions" premise is FALSE** (verified on the live host, and
  corrected here 2026-08-03). There are **41 `pathway_resolution_sessions` + 14
  multi-pathway sessions** across 5 patients, all ACTIVE, created 2026-05-18…07-13.
  All carry `temporal_context NULL`, so every one raises `SESSION_NOT_RETRAVERSABLE`
  once plan 02 is **deployed** (nothing breaks while it is merely merged — the column
  is additive and the live pm2 processes never select it). Backfill-vs-accept is still
  undecided and is a deployment decision, not a plan decision.
- **Deployment vs development order:** these plans are *development* order. Behavior
  is activated later via shadow evaluation → explicit `v1` flip (§Rollout,
  deployment order). Plans 1–8 must not change live routing until the `v1` flip.
- **Empty substrate:** all `snapshot_*` tables are empty; the encounter simulator is
  the only live context source. v1 runs in SYNTHETIC mode. Plan 7 (snapshot mapper)
  is therefore last among backend layers and untestable against real data.

## Execution order — 05 runs BEFORE 04

The numbered order below is the *decomposition*, not the execution order. **Plan
05 executes before plan 04**, and this is load-bearing rather than a preference
(decision 2026-08-03, verified by probe, and confirmed by plan 05's
`assembler-preserves-today` suite on execution).

Plan 04 rewires `evaluateGate` onto `selectFacts`, which maps an uncertain
scalar to `INDETERMINATE` and thence to fail-closed. `PatientContext.vitalSigns`
is a `Record<string, unknown>` with **no date field anywhere**, and
`LabResult.date` is optional. Probing `overlap()` directly:

```
undated fact, end: UNKNOWN     + LIFETIME = UNKNOWN   ⇒ scalar INDETERMINATE ⇒ gate fails
undated fact, end: OPEN(asOf)  + LIFETIME = MATCH     ⇒ preserves today
```

So plan 04 in the documented order would stop **every vitals scalar gate and
every undated-lab gate** from being satisfied under `legacy-v0` — the version
that exists to reproduce today. The `OPEN(evaluationAsOf)` modeling that fixes
it is plan 05's deliverable. Plan 05's originally-listed "Consumes 01–04" was
nominal: the assembler needs the fact model (01) and the clock (02), nothing
from the evaluator.

**Status:** 01, 02, 03 merged to `main`. 05 executed on
`feat/temporal-horizon-context-assembler`. 04, 05b, 06, 07, 08, 09 outstanding.

## Decomposition (files locked here)

Each layer is one plan. New pure code lives under
`apps/pathway-service/src/services/resolution/temporal/`.

| Plan | Layer (§) | Primary new/changed files |
|---|---|---|
| 01 | Fact model + `selectFacts` kernel (§2,§3,§4) | `temporal/fact-model.ts`, `temporal/interval.ts`, `temporal/overlap.ts`, `temporal/state-mapping.ts`, `temporal/select-facts.ts` |
| 02 | Pinned clock (§1) | `temporal/evaluation-context.ts`; edits to `traversal-engine.ts`, `retraversal-engine.ts`, `gate-evaluator.ts`, session persistence |
| 03 | Policy registry + cascade (§5,§7-load) | `temporal/policy-registry.ts`, `temporal/cascade.ts`; migration `064_add_temporal_defaults_to_pathway_graph_index.sql`; edits to `resolvers/helpers/resolution-context.ts`, `temporal/evaluation-context.ts` (2 error codes), plus guard calls in `resolvers/mutations/resolution.ts` and `multi-pathway-resolution.ts` |
| 04 | Evaluator + reachability via kernel (§4,§8-kernel) | edits to `gate-evaluator.ts`, `reachability.ts` |
| 05 | Input contract + trust modes + assembler (§8) | `temporal/context-assembler.ts`, `temporal/trust-mode.ts`, `temporal/synthetic-values.ts`; edits to `schema.graphql`, `resolvers/mutations/resolution.ts`, `multi-pathway-resolution.ts`, `services/confidence/types.ts`, `resolution/effective-context.ts` |
| 05b | Normalized-fact persistence + REPLAY (§8) | deferred; see the interface contract below |
| 06 | Canonicalization + pathway-default persistence (§6,§7) | `services/import/canonicalize.ts`; edits to `import/validator.ts`, `import/types.ts`, `import/graph-builder.ts`, `import/import-orchestrator.ts`, `schema.graphql`; admin `src/lib/pathway-json/canonicalize.ts` + shared fixtures |
| 07 | Snapshot mapper → `NormalizedFact[]` (§8b) | edits to `resolution/snapshot-context.ts` |
| 08 | Per-condition evidence + GraphQL surfaces (§9,§11) | `temporal/evidence.ts`; edits to `traversal-engine.ts`, `retraversal-engine.ts`, `schema.graphql`, `resolvers/Query.ts` (formatter), session persistence |
| 09 | Admin UI (§10) | admin `GateConditionEditor.tsx`, new `PathwayMetadataPanel.tsx`, `PublishValidationModal.tsx`, resolved-value caption |

## Cross-plan interface contract

The exact names/types each plan **Produces** (later plans depend on) and
**Consumes** (must already exist). Plan 01 produces the vocabulary the whole suite
uses.

> **This section is normative and later plans treat it as locked.** If execution
> adds or changes a published name, update it HERE in the same commit. A plan that
> reads a stale contract will implement an incompatible type — the types below
> drifted once already (`FactDecision.uncertainty`, `AMBIGUOUS_SERIES_ORDER`,
> `FactDecision.stateUnverified` all landed in code before appearing here).

### Plan 01 — Produces
Plan 01 is a genuine leaf: it defines its **own** operator/condition contract and
imports nothing from `resolution/types.ts`. (Plan 04 owns the
`GateCondition → FactSelectionCondition` adapter.)
```ts
// temporal/contract.ts
type TemporalOperator = 'includes_code'|'equals'|'exists'|'greater_than'|'less_than'
  |'count_in_window'|'trend_up'|'trend_down'|'delta_from_baseline';
type OperatorClass = 'membership'|'scalar'|'aggregate';
function isTemporalOperator(op: string): op is TemporalOperator;
function operatorClass(op: TemporalOperator): OperatorClass;   // throws on unknown
type GateField = 'conditions'|'medications'|'allergies'|'labs'|'vitals';
type FactKind = 'condition'|'medication_order'|'allergy'|'lab'|'vital';
function fieldToKind(field: GateField): FactKind;              // throws on unknown
interface FactSelectionCondition { field: GateField; operator: TemporalOperator; value: string; system?: string; }
type UncertaintyReason = 'TEMPORAL_UNKNOWN'|'STATE_UNKNOWN'|'VALIDITY_UNKNOWN'|'AMBIGUOUS_LATEST'
  |'AMBIGUOUS_SERIES_ORDER';   // added in execution: trend/delta series with no proven total order

// temporal/fact-model.ts
interface TemporalBound { value: string; precision: 'year'|'month'|'day'|'instant'; }
type TemporalEnd =
  | { kind: 'KNOWN'; bound: TemporalBound }
  | { kind: 'OPEN'; assertedCurrentAt: string }
  | { kind: 'UNKNOWN' };
interface FactBase {
  factId: string; code: string; system: string; display?: string;
  interval: { start?: TemporalBound; end: TemporalEnd };
  recordValidity: 'VALID'|'INVALID'|'UNKNOWN'; validityBasis: string;   // tri-state
  provenance: { sourceType: 'FHIR'|'SYNTHETIC'; sourceId?: string; snapshotId?: string };
}
interface StatefulFact extends FactBase {
  kind: 'condition'|'medication_order'|'allergy';
  clinicalState: 'ACTIVE'|'INACTIVE'|'ON_HOLD'|'UNKNOWN'|'CONFLICT';
  stateAsOf?: string;
  stateBasis: 'FHIR_STATUS'|'ABATEMENT'|'SNAPSHOT_ASSERTION'|'SYNTHETIC'|'MISSING_STATUS_FAIL_OPEN';
}
interface ObservationFact extends FactBase {  // labs AND vitals
  kind: 'lab'|'vital'; value?: number; unit?: string; observationStatus?: string; issuedAt?: string;
}
type NormalizedFact = StatefulFact | ObservationFact;
type FactStore = ReadonlyArray<NormalizedFact>;

// temporal/interval.ts — strict FHIR parsing to epoch ranges
function parseFhirDate(s: string|null|undefined): TemporalBound | null;   // calendar-validated
function boundEpochRange(b: TemporalBound): { loMs: number; hiMs: number };
function instantEpoch(s: string): number;

// temporal/overlap.ts — possible/established three-valued reasoning
type ThreeValued = 'MATCH'|'NO_MATCH'|'UNKNOWN';
interface ResolvedHorizon { lowerBound: string | null; upperBound: string; } // upperBound = evaluationAsOf
function overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued; // throws on inverted interval

// temporal/select-facts.ts — discriminated outcome
interface EffectivePolicy { horizon: ResolvedHorizon; status?: 'active'|'inactive'|'any'; }
interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT'|'DROP_INVALID'|'UNKNOWN';
  stateMatch: 'MATCH'|'NO_MATCH'|'UNKNOWN'|'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE'|'EXCLUDE'|'INDETERMINATE';
  // Both added during execution — Plan 08 evidence MUST surface them.
  uncertainty: UncertaintyReason[];  // why uncertain; retained even when the operator
                                     // policy resolved it to EXCLUDE (aggregate
                                     // fail-closed), so evidence can show a count is
                                     // a lower bound. Empty when decided definitely.
  stateUnverified: boolean;          // UNKNOWN/CONFLICT state, or a status inferred by
                                     // failing open. Separate from `uncertainty`
                                     // because `status: any` bypasses state filtering
                                     // (RFC §3): the doubt is evidence, but must not
                                     // reach the operator policy.
}
type SelectionOutcome =
  | { status: 'READY'; selected: NormalizedFact[]; decisions: FactDecision[];
      temporallyUnverified: boolean; stateUnverified: boolean; validityUnverified: boolean }
  | { status: 'NO_MATCH'; decisions: FactDecision[] }
  | { status: 'INDETERMINATE'; reasons: UncertaintyReason[]; decisions: FactDecision[] };
function selectFacts(condition: FactSelectionCondition, store: FactStore, policy: EffectivePolicy): SelectionOutcome;
```
Consumes: nothing (leaf module).

### Plan 02 — Produces `EvaluationTemporalContext` (§1) + `resolveHorizon(tier, ctx)`; threads it to `selectFacts` callers. Consumes Plan 01.
### Plan 03 — Produces `TEMPORAL_POLICIES` + `getTemporalPolicy(version)` / `assertKnownPolicyVersion(version)` (unknown version = hard error); `TemporalStatus`, `FieldPolicy`, `fieldHasClinicalState(field)`, `systemDefaultFor(field, version)`; `PathwayTemporalDefaults` + `parsePathwayTemporalDefaults(raw)` + `parseHorizonValue(raw, where)`; `PolicyLevel`/`PolicyTier`/`ConditionTemporalOverride`; `resolveEffectivePolicy(field, version, pathwayDefaults, condition?)` returning an **unresolved tier**; `toEffectivePolicy(tier, ctx)` producing Plan 01's `EffectivePolicy`; `SweepableCondition`/`EncounterAnchorRequirement` + `collectEncounterAnchorRequirements(...)`; `assertEncounterAnchor(rctx, temporalCtx)` from `resolvers/helpers/resolution-context`; `temporal_defaults` column (migration 064) + `ResolutionContext.temporalDefaults`. Adds `UNKNOWN_POLICY_VERSION` and `INVALID_TEMPORAL_DEFAULTS` to `TemporalContextErrorCode`. Consumes 01–02.

**Plan 03 decisions (executed 2026-08-03):** `vitals` joins the registry — `legacy-v0` LIFETIME, `v1` ENCOUNTER (§5's table omitted it while `GateField` includes it; §10 fixes vitals to Encounter). The anchor sweep runs at **session creation only** — both creating mutations, never the four retraversal sites, which reuse a clock from a session that already passed. `resolveAndPersistAll` is split into two passes so a rejection leaves no child sessions or audit rows.
### Plan 04 — Produces the validated `GateCondition → FactSelectionCondition` adapter (rejecting unknown operators/fields); rewrites `evaluateGate` scalar/membership/aggregate branches to call `selectFacts` and apply the numeric `<`/`>` to `selected`, mapping `INDETERMINATE` to fail-closed (gate not satisfied) while recording it for evidence; `reachability` calls the same kernel. **Consumes 01–03 and 05.**
### Plan 05 — **EXECUTED 2026-08-10.** Produces, in `temporal/trust-mode.ts`: `ResolutionModeKind`, the `ResolutionInput` discriminated union (payload inside the variant), `SyntheticCodeEntry`/`SyntheticLabResult`/`SyntheticPatientContext`, `assertSyntheticAuthorized(role)`, `ResolutionModeArgs`, `parseResolutionInput(args, syntheticContext, userRole)`. In `temporal/synthetic-values.ts`: `CLINICAL_STATES`, `RECORD_VALIDITIES`, `parseClinicalState`, `parseRecordValidity`, `parseSyntheticDate`. In `temporal/context-assembler.ts`: `assembleContext(input, ctx) → FactStore`, `assertAssemblableMode(input)`, `VITALS_SYSTEM`. In `resolvers/mutations/resolution.ts`: `PatientContextArgs`, `TemporalAnchorArgs`, `temporalInputFrom(args)`. Adds `INVALID_RESOLUTION_INPUT` to `TemporalContextErrorCode`; widens `CodeEntry`/`LabResult` centrally; widens the `buildEffectivePatientContext` merge key to `code|system|date|sourceId`. Consumes 01–03.
### Plan 06 — Produces `canonicalize(json) → { json, warnings }`, `conditionId` on `GateCondition`, `temporal_defaults` round-trip. Consumes 01,03.
### Plan 05b — Normalized-fact persistence and REPLAY loading. Split out of 05 (decision 5 there): REPLAY needs persisted facts, but retraversal does not, because it re-assembles from the stored `initialPatientContext` plus additions and identical input yields identical `factId`s. Until this lands, `assembleContext` and both start mutations refuse REPLAY by name. Consumes 01,05.
### Plan 07 — Rewrites `snapshot-context.ts` to emit `NormalizedFact[]`. Consumes 01,03,05.
### Plan 08 — Produces `GateEvaluationEvidence`/`GateConditionEvidence` on `NodeResult` + GraphQL. Consumes 01–05.
### Plan 09 — Admin controls. Consumes 03,06,08 (GraphQL shapes).

## Self-review note

Spec coverage map (design § → plan): §1→02, §2/§3/§4→01, §5→03, §6→06, §7→03+06,
§8→05(+04 kernel), §9→08, §10→09, §11→08, §12→04+05, §13→acceptance criteria
embedded per plan. Compatibility/rollout are cross-cutting (Global Constraints).
