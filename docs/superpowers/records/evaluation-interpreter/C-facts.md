# C — Conditions, fact access, temporal selection, external observations

Discovery items 3 and 6. Code: `features/docs-evaluation-interpreter-design/prism-graphql` @ `d377465` (= live). Paths below are relative to `apps/pathway-service/src/` unless stated.

**How this was verified.** Code was read directly. Behavioural claims marked **[probe]** were run against the real modules at d377465: `ts-node --transpile-only` scripts in the scratchpad import `gate-evaluator`, `select-facts`, `context-assembler`, `effective-context` and `unresolved-prompt` with a pinned clock of `2026-09-26T12:00Z`. No repo file was edited. Live facts come from SELECT-only psql and AGE cypher run on 2026-09-26. Anything not checked is marked **[unverified]**.

---

## 1. Condition representations

### 1.1 Gate types (`types/index.ts` GateType; `gate-evaluator.ts:evaluateGate`)

| gate_type | Reads | Evaluator | Condition shape |
|---|---|---|---|
| `patient_attribute` | one `condition` | `evaluatePatientAttribute` → mode evaluator | `GateCondition` |
| `compound` | `conditions[]` + `operator` AND/OR (default AND) | `evaluateCompound` → mode evaluator per condition, resolved **once per gate** | `GateCondition[]` |
| `question` | `gateAnswers.get(gateId)` | `evaluateQuestion` | none. Boolean true opens the gate. **Any** numeric or selected option opens it. |
| `prior_node_result` | `resolutionState.get(dep.node_id).status === dep.status` | `evaluatePriorNodeResult` | `depends_on: [{node_id,status}]` |
| `llm_text_analysis` | `input_attribute` (dotted path into PatientContext), `branches[]`, `confidence_threshold` (default 0.75) | `evaluateLlmTextAnalysis` + injected `llmEvaluator` | none |
| anything else | — | `satisfied:false, "Unknown gate type"` | — |

### 1.2 Condition shapes (`services/resolution/types.ts`)

The two shapes are told apart by `isAttributeCondition(c)`, which checks `typeof c.attribute === 'string'`.

| Form | Type | Keys (import allow-list, `import/validator.ts:41-51`) | Operators |
|---|---|---|---|
| **Coded** | `CodedCondition` | `field` (conditions/medications/allergies/labs/vitals), `operator`, `value`, `system`, `threshold`, `window_days`, `count_threshold`, `min_points`, `slope_threshold`, `delta_threshold`, `horizon`, `status`, `display`, `note` | `VALID_CODED_OPERATORS`: includes_code, equals, exists, greater_than, less_than, count_in_window, trend_up, trend_down, delta_from_baseline |
| **Attribute** | `AttributeCondition` | `attribute` (`<ns>.<rest>`), `operator`, `value` (scalar or array), `unit`, `horizon`, `status`, `display`, `note` | `VALID_ATTRIBUTE_OPERATORS`: equals, not_equals, greater_than, greater_or_equal, less_than, less_or_equal, in, exists |
| **Legacy dialect** (stored only) | none; it arrives as an `AttributeCondition` at runtime | `attribute`, uppercase `operator` (`LT`, `GTE`, `IN`, `EQUALS`), `value` sometimes a string (`"1,3"`), `unit` | not in either vocabulary |

Attribute namespaces are `lab`, `vitals`, `allergy` and `patient` (`attribute-registry.ts:VALID_ATTRIBUTE_NAMESPACES`).
- `lab.*` and `allergy.*` need a `pathway_attribute_code_map` row.
- `vitals.*` is a dotted path into `vitalSigns`.
- `patient.*` reads `patientAttributes[rest]`. `KNOWN_PATIENT_ATTRIBUTES` lists trimester, rh_factor and gestational_age_weeks. `normalizePatientAttributes` derives trimester from GA only when trimester is absent.

Two operator semantics matter later:
- **`in` and `equals`** use strict `===` in `compareScalar`. `"1"` does not equal `1`.
- **Coded `threshold`** falls back to `parseFloat(condition.value)`, and `value` is the lab code. With no `threshold`, `less_than` on `718-7` compares against 718. This is legacy behaviour, preserved in the kernel (`gate-evaluator.ts:721`).

### 1.3 Where conditions are validated and normalized

| Place | What it checks | What it does NOT check |
|---|---|---|
| **Import validator** `import/validator.ts:validateGateConditions` (hard errors even in draft) | Exactly one of field/attribute. Operator is in the right vocabulary. `field` is in `FIELD_TO_KIND`. Namespace is registered. Coded conditions need `value`. D9: a `vitals` condition may not carry `system` (`codedVitalsSystemError`). Numeric control domains (`conditionControlDomainError`). Unknown keys. Also checks `on_unresolved ∈ {ask, default}`, the `gate_type` and `default_behavior` vocabularies, and a non-empty compound list (soft in draft). | **`horizon`/`status` values** and the `window_days`+`horizon` conflict (deferred to preflight). Whether an attribute has a code-map row. The operand's type against the attribute `valueType`. Whether `threshold` is present on a scalar. |
| **v1 anchor sweep** `resolvers/helpers/resolution-context.ts:sweepableConditions` + `assertEncounterAnchor`, run in `pipeline/evaluate.ts` on every evaluation | v1 runs `adaptCodedCondition` / `adaptAttributeCondition` over every patient_attribute/compound condition. That parses the horizon/status override, rejects window_days+horizon together, and re-runs D9 and the control-domain rule. It then throws `MISSING_ENCOUNTER_ANCHOR` if any effective horizon is ENCOUNTER and there is no `encounterStart`. | Under legacy-v0 it only collects raw horizon/status for coded conditions (no adapter). |
| **Runtime adapter** `temporal/condition-adapter.ts` | Same predicates, and it throws (errors propagate out of the kernel evaluators). | — |
| **Activation** `resolvers/mutations/import.ts:activatePathway` | **Nothing.** It is a pure SQL status flip DRAFT→ACTIVE plus `prewarmPathwayInBackground`. | Stored DRAFT graphs, including the legacy-dialect versions, can be activated unvalidated. The memory note says "activation now strictly re-validates", but that is **not** true of this code. |
| **Admin dashboard** `prism-admin-dashboard/src/lib/pathway-json/validator.ts` (master @ bc6ba48) | A zod schema for pathway metadata (condition_codes). | Gate conditions are not validated. `GateConditionEditor` has no horizon/status/window UI (grep found none). |
| **Normalization** | **None for conditions.** No canonicalizer maps `LT`→`less_than` or `attribute`→`field` (grep for `'LT'` / normalizeCondition found nothing). `exists` is normalized inside the adapter only: value and system are dropped. | — |

---

## 2. Dispatch: legacy evaluator versus v1 kernel

### 2.1 Mode selection

- `index.ts:29` reads `TEMPORAL_POLICY_VERSION` from the environment at boot. The default is `DEFAULT_TEMPORAL_POLICY_VERSION = 'v1'` (`evaluation-context.ts`).
- `resolveTemporalPolicyVersion(context)` stamps it into `temporalContext.temporalPolicyVersion` at session start (`resolution.ts:413`, `multi-pathway-resolution.ts:205`). It is pinned per session.
- `policy-registry.ts` maps `EVALUATION_MODE_BY_VERSION = {legacy-v0: 'legacy', v1: 'kernel'}` and `MODE_REQUIRES_FACT_STORE = {legacy:false, kernel:true}`.
- `gate-evaluator.ts:conditionEvaluatorFor` asserts the version is known, then indexes the frozen table `CONDITION_EVALUATORS[mode]`. A compound gate resolves the evaluator once for all its conditions.
- **Live:** `pm2 env 0` has no `TEMPORAL_POLICY_VERSION`, so the deployment runs **v1**. All 16 live sessions have `temporalPolicyVersion: "v1"` and none has `encounterStart`.

### 2.2 Which condition takes which path

| Condition | legacy-v0 (`evaluateConditionLegacy`) | v1 (`evaluateConditionKernel`) |
|---|---|---|
| coded membership (includes_code / equals / exists) | array scan over `getCodeEntries` | `evaluateMembershipKernel` → `selectFacts` |
| coded scalar (greater_than / less_than) | `getNumericValue`: **first array match by `.find()`**; vitals by dotted path; `system` ignored for vitals | `evaluateScalarKernel`: definite-latest fact |
| coded aggregate (count / trend / delta) | array scan + `isWithinWindow(window_days)` | `evaluateAggregateKernel`: `window_days` becomes NODE horizon `{days:N}` |
| coded unknown operator | "Unknown operator" false | falls back to legacy |
| attribute `lab.*` with a code-map row | `resolveAttribute` (`.find()`) + `compareScalar` | `evaluateAttributeKernel`: scalar selection + `compareScalar` |
| attribute `allergy.*` with a code-map row | `allergies.some()` boolean + `compareScalar` | kernel membership selection → boolean (`undefined` only for `exists` with no match) |
| attribute `vitals.*` | `numericPath` | kernel scalar selection, code = the dotted remainder, `system=urn:prism:vitals` |
| attribute `lab.*` / `allergy.*` **without** a row | `undefined` → "attribute has no value" | adapter returns `null` → **legacy** |
| attribute `patient.*` or an unknown namespace | `patientAttributes[rest]` | adapter returns `null` → **legacy, permanently** (D3) |
| legacy dialect (`LT`, `IN`, `EQUALS`, `GTE`) | `compareScalar` has no branch for these. Numeric ops table lookup fails, so the result is false: `"9 LT 11 → false"` or `"numeric EQUALS needs numeric operands"` | identical: comparison stays in `compareScalar` |

### 2.3 Outcome channels

`ConditionOutcome` is `{satisfied, reason, fieldsRead, indeterminate?, uncertainty?, dataUnavailable?}`.
- **legacy-v0** never sets the three optional keys.
- **v1**: membership sets `indeterminate` + `uncertainty`. Scalar and aggregate set all three where applicable. Attribute scalar sets `dataUnavailable` only when `klass==='scalar' && value===undefined`. The `patient.*` / unmapped fallback sets **none**.
- The gate result copies them (`evaluatePatientAttribute`). Compounds propagate them through the truth table in `evaluateCompound`:
  - A definite false dominates AND; a definite true dominates OR.
  - An "unresolved" condition (indeterminate OR dataUnavailable) is never a dominator.
  - `unresolvedConditions` lists the unresolved ones, index-aligned.
- **"Ambiguous"** has no separate channel. It surfaces as `indeterminate:true` with reason `AMBIGUOUS_LATEST` (scalar) or `AMBIGUOUS_SERIES_ORDER` (aggregate). **"Conflicting"** clinical state (`CONFLICT`) is treated as NO_MATCH for status active/inactive, and as a MATCH flagged `stateUnverified` for status any.

### 2.4 Selection semantics (`temporal/select-facts.ts`) — what "present / undated / conflicting / temporally unknown" mean

Facts are assembled only from SYNTHETIC input (`context-assembler.ts`). LIVE and REPLAY throw.

- **Stateful facts** (condition, medication, allergy):
  - no `clinicalState` → `ACTIVE`, basis `MISSING_STATUS_FAIL_OPEN`
  - no `endDate` + ACTIVE → end `OPEN` asserted current at `evaluationAsOf`
  - INACTIVE or CONFLICT → end `UNKNOWN`
- **Labs**: undated → no start, end `OPEN` at `evaluationAsOf`. Dated → a point interval.
- **Vitals**: always undated and OPEN (the bag has no dates).
- **Temporal predicate**: `overlap` for membership and scalar, `startsWithin` for aggregate.
- **Resolving uncertainty** (`TEMPORAL_UNKNOWN`, `STATE_UNKNOWN`, `VALIDITY_UNKNOWN`) differs by class:
  - membership → INCLUDE (fail-open)
  - scalar → INDETERMINATE (poisons the result)
  - aggregate → EXCLUDE, but still READY
- **Scalar winner**: `definiteLatest`, where an undated fact's range is (−∞, +∞).

### 2.5 Table: condition kind × data state → outcome

Codes: `F` = satisfied:false with no signals; `F/du` = false + dataUnavailable; `F/ind` = false + indeterminate; `T` = satisfied. Rows marked **[probe]** were executed.

| Kind | Data state | legacy-v0 | v1 kernel |
|---|---|---|---|
| coded scalar (labs) | present, dated in horizon | T/F on the **first array match** [probe: two dated values, 12 then 9 → "12 ≥ 11" F] | T/F on the definite latest [probe: 9 < 11 → T] |
| | missing | F ("No numeric value found") [probe] | **F/du** + ask `LOINC:718-7` [probe] |
| | present but outside horizon (v1 default QUARTER) | T/F (no horizon) [probe: Jan value → T] | **F/du** [probe] |
| | one undated value | T/F | T/F; undated counts as current [probe: READY] |
| | two or more undated values | first match | **F/ind** `AMBIGUOUS_LATEST` [probe] |
| | two same-day values | first match | **F/ind** `AMBIGUOUS_LATEST` [probe] |
| | month precision straddling the horizon | T/F | **F/ind** `TEMPORAL_UNKNOWN` [probe] |
| | present, `recordValidity: UNKNOWN` (SYNTHETIC/ADMIN only) | T/F | F/ind `VALIDITY_UNKNOWN` |
| | value absent (`{code}` only) | F | F/du (not a candidate; `hasFiniteValue`) [probe: NO_MATCH] |
| coded scalar on conditions / meds / allergies | any | F | F/du, but **ask = null** → default_behavior [probe] |
| coded vitals scalar | present | T/F | T/F; needs `encounterStart` (ENCOUNTER default), otherwise the whole evaluation throws |
| coded membership | present (any date, active) | T | T. Undated, and dated years ago but still active, both MATCH a `{days:300}` horizon [probe] |
| | missing | F | F, **never du** (absence is an answer) |
| | STATE UNKNOWN / VALIDITY UNKNOWN | T | T (fail-open), uncertainty recorded |
| | CONFLICT, status active | T | F (NO_MATCH) |
| coded aggregate (delta / trend) | too few points | F "Need ≥N" | F, **no du, no ask** [probe] |
| | undated under a bounded horizon | counted only if `window_days` is unset | excluded (`startsWithin` NO_MATCH) [probe] |
| | two same-instant points | ordered arbitrarily | **F/ind** `AMBIGUOUS_SERIES_ORDER` → ask = null → default_behavior |
| count_in_window | uncertain facts | counted | excluded; the count is a lower bound; READY |
| attribute `lab.*` mapped, standard operator | missing | F | **F/du** + ask `lab.hemoglobin` → lab target [probe] |
| attribute `lab.*` mapped, legacy `LT` | present | F ("9.4 LT 7 → false") — **live evidence** in sessions on 1.1–1.3 | same F (no du, since value is present) [probe] |
| | missing | F | F/du → ask; the answer arrives and the gate is **still F forever** |
| attribute `lab.rh_factor` (valueType string) | missing | F | F/du → asks for a **NUMERIC** value; `"negative"` can never match a numeric lab value |
| attribute unmapped (`lab.MCV`, `lab.hemoglobin_delta_2wk`) | any | F | F via legacy, **no du, no ask** [probe] |
| attribute `patient.*` | missing | F | F, **no signal**, so it counts as a *definite* false [probe] |
| attribute `allergy.*` | none | `equals true` F | F, never du |
| attribute `vitals.*` | missing | F | F/du + ask target `{kind:'vital', path:'vitals.systolic_bp'}`, but the answer **never resolves it** (see §6) [probe] |
| compound AND: `patient.trimester` missing + hb missing | — | F | **F, du:false**: the unsignalled patient.* false dominates, so nothing is asked and the gate is GATED_OUT (skip) [probe]. This is the ACTIVE anemia 1.4 `gate-anemia-t1t3` / `-t2` shape. |
| compound AND: trimester=1 + hb missing | — | F | F/du → ask `LOINC:718-7` [probe] |
| llm_text_analysis | no client configured (live today) | safe default, tentative | same (the pipeline always passes an evaluator, which returns `failed`) |

---

## 3. Fact access

### 3.1 Readers of patient facts

| Reader | Source | Temporal / state / validity aware? | Used in evaluation? |
|---|---|---|---|
| `effective-context.ts:buildEffectivePatientContext` | `initialPatientContext` + `additionalContext` | no | yes: the single source for everything below in the pipeline (`pipeline/evaluate.ts` step 1) |
| `temporal/fact-store.ts:factStoreFor` / `factStoreForInput` / `factStoreForSession` → `context-assembler.ts:assembleContext` | effective context cast to `SyntheticPatientContext` | creates the model | v1 only (`requiresFactStore`), otherwise `[]`. `factStoreForInput` also runs once at start purely to validate. |
| `select-facts.ts:selectFacts` | FactStore | yes | v1 kernel |
| `gate-evaluator.ts` `getCodeEntries` / `getNumericValue` / `collectLabSeries` / `isWithinWindow` | PatientContext arrays | window_days only | legacy-v0; v1 unknown-operator fallback |
| `attribute-registry.ts:resolveAttribute` | PatientContext | no (`.find()` / `.some()`) | legacy; v1 for `patient.*` and unmapped attributes |
| `observations.ts:narrativeFor` (`dotted-path.ts`) | PatientContext (freeformData, …) | no | LLM gates |
| Confidence scorers `confidence/scorers/{custom-rules,data-completeness,patient-match-quality,risk-magnitude}.ts` | whole arrays | **no**: ignore horizon, status, validity | yes, `scorePathway` in evaluate step 2; confidence decides whether action nodes are included |
| `prerequisites.ts:patientHasCode` (via `pipeline/findings.ts:catchUpItemsFor`) | all code buckets + labs | no | yes, catch-up items (part of `resultHash`) |
| `pipeline/safety.ts` + `load-env.ts:candidateMedications` / `allergyCodesOf` | `patient.medications`, SNOMED allergies | **no status filter**: an INACTIVE synthetic medication still enters DDI and the candidate universe | yes |
| `reachability.ts:hasDataForCondition` (via `Query.matchedPathways` → `snapshot-context.ts`) | Epic snapshot tables | no. Also `vitalSigns[value]` has no dotted path. **Diverges from v1** (out-of-horizon data reads as "available"). | no: read-only query |
| `snapshot-context.ts:loadPatientContextFromSnapshot` | `snapshot_*` tables (active conditions via `isConditionActive`, **condition dates dropped**, labs dated) | partial | only for reachability. LIVE resolution throws "requires the snapshot mapper (plan 07)". |
| `session-store.ts:getMatchedPathways` | `snapshot_conditions`, or direct codes | no | multi-pathway matching |

So a v1 gate and the confidence, catch-up and safety stages of the **same evaluation** read the same facts under different rules. A lab excluded by QUARTER still raises data-completeness confidence. An INACTIVE medication is not in the gate's `status:active` view but is in DDI.

### 3.2 Writers of patient facts

| Writer | Path | Notes |
|---|---|---|
| Session start | `startResolution` / `startMultiPathwayResolution` → `parseResolutionInput` (`trust-mode.ts`) → `toPatientContext` | SYNTHETIC is the default mode. Synthetic assertions (`clinicalState`, `recordValidity`, `endDate`, `sourceId`) require `resolutionMode: SYNTHETIC` and the ADMIN role. `evaluationAsOf` also requires SYNTHETIC. Stored as `initial_patient_context`. |
| `addPatientContext` | `resolution.ts:contextChange` → `mergeAdditionalContext` | Rejects synthetic assertions (`firstTrustAssertion`) and strips nulls. |
| Escalated datum answer | `resolution.ts:answerChange`, when `pending.askTarget` is set | Requires `numericValue`. `lab` → `labResults:[{code, system, value, date: evaluationAsOf}]` (dated since PR #62). `vital` → `vitalSigns[path]`. `attribute` → `patientAttributes[path minus namespace]`. Event `PROVIDER_ASSERTED_DATUM`. |
| Multi-pathway | `commitSession` → `commitRun(childChange)` | Facts land on the parent's `additionalContext` (spec D5), shared by all children. |

### 3.3 Dedup rules and what follows from them

- **`buildEffectivePatientContext`** (retraversal merge): coded arrays are deduped on `code|system|date|sourceId`. The **base (initial) entry wins**, so an addition with the same key is dropped. vitalSigns, freeformData and patientAttributes are deep-merged with additions winning.
- **`mergeAdditionalContext`** (accumulating additions): the same key, first occurrence wins. Bags are deep-merged.

Consequences:
1. **Undated duplicates collapse.** Undated diagnoses or labs with the same code are one fact, so `count_in_window` undercounts undated recurrences (it only counts under LIFETIME anyway).
2. **A same-key correction is impossible.** An added lab with the same code, system and date as an existing one is silently dropped. That was the PR #62 bug (an undated answer merged into an undated initial entry). The fix dates the answer at `evaluationAsOf`. Because the clock is **pinned per session**, a second answer for the same lab has the same key as the first and is dropped too. The provider cannot correct a mis-keyed datum answer through the datum path. They can only add a lab with a different date via `addPatientContext`, and `evaluationAsOf` cannot be set on non-SYNTHETIC runs. **[unverified end-to-end]**, but it follows directly from the code.
3. **Additions can never remove or override coded facts.** Nothing retracts an initial entry.
4. **Scalar selection sees the dated answer at `evaluationAsOf` alongside any undated value.** An undated lab's range is (−∞, +∞), so the answer is never the definite latest. **[probe]**: undated 9 + answer → `AMBIGUOUS_LATEST`. See §6.

### 3.4 Live evidence of the fact paths

- `pathway_resolution_events` holds 17 `PROVIDER_ASSERTED_DATUM` events, all `datumKey LOINC:718-7`. One session (`4e4c95eb…`, v1.4) has four assertions (1, 1, 1, 9.4) before `gate-severe-anemia` resolved. That is consistent with the pre-#62 dropped-answer bug; the cause is **[unverified]**.
- Sessions on DRAFT 1.1–1.3 show `gate-severe-anemia` GATED_OUT with reason `"9.4 LT 7 → false"`: the legacy dialect answering false while a value is present.

---

## 4. Temporal policy

### 4.1 Registry (`temporal/policy-registry.ts`, frozen, validated at module load)

| Field | legacy-v0 horizon / status | v1 horizon / status |
|---|---|---|
| conditions | LIFETIME / active | LIFETIME / active |
| medications | LIFETIME / active | LIFETIME / active |
| allergies | LIFETIME / active | LIFETIME / active |
| labs | LIFETIME / — | **QUARTER (90 d)** / — |
| vitals | LIFETIME / — | **ENCOUNTER** / — |

- The legacy-v0 set is consulted only by the anchor sweep. The legacy evaluator ignores policy (it uses `window_days` only).
- Named horizons: LIFETIME, YEAR 365, QUARTER 90, MONTH 30, WEEK 7, DAY 1, ENCOUNTER. Custom `{days:N}` for 1 ≤ N ≤ 36525 (`evaluation-context.ts`).
- `status` is meaningless for labs and vitals. At the NODE tier it throws; in pathway defaults it throws at parse time.

### 4.2 Cascade (`temporal/cascade.ts:resolveEffectivePolicy`)

SYSTEM_DEFAULT (registry) < PATHWAY (`pathway_graph_index.temporal_defaults` `{default_horizons, default_statuses}`, parsed strictly) < NODE (condition `horizon` / `status`; `window_days` becomes `{days:N}`; both present throws).

`gate-policy.ts:effectivePolicyFor` resolves this and `toEffectivePolicy` binds it to the clock. **Live:** `temporal_defaults` is NULL for every pathway. The NODE tier is used only by DRAFT `gestational-hypertension-preeclampsia` (`{days:7}`, `{days:1}`, `{days:300}` + `status:active`).

### 4.3 Clock pinning

- `makeEvaluationTemporalContext` reads the wall clock **once**, at start, unless a SYNTHETIC `evaluationAsOf` is supplied. It optionally takes `encounterStart`, which must not be after `evaluationAsOf`.
- The result is stored as `temporal_context` (NOT NULL since migration 067). It is reused on every later mutation (`inputs.temporalContext`). A multi-pathway run has one clock on the parent, spliced into every child (`run.ts:sessionInputsOf`).
- `GateEvaluationDeps` makes `temporalContext`, `pathwayDefaults`, `factStore` and `codeMap` mandatory and runtime-asserted (`assertRequiredDeps`). There is no `Date.now()` in the evaluators.
- Wall-clock reads that remain: `traversalDurationMs` and `durationMs` (excluded from `resultHash`), and `observations.ts` `acquiredAt` (an observation's metadata, not an input).
- `snapshotId` and `snapshotCapturedAt` exist on the context but are unused while LIVE mode throws.

### 4.4 Consequences

- **ENCOUNTER is the v1 default for vitals.** Any v1 pathway with a vitals condition (coded, or `vitals.*` attribute) needs `encounterStart`. Otherwise `assertEncounterAnchor` throws `MISSING_ENCOUNTER_ANCHOR` on **every** evaluation, start included. No live session has `encounterStart`. No live pathway uses vitals: gestational-HTN encodes BP as `labs` LOINC 8480-6/8462-4 with `{days:7}`.
- **Open-ended stateful facts ignore look-back horizons.** An ACTIVE condition dated 2020 matches `{days:300}` because OPEN-at-asOf overlaps. **[probe]**
- **Undated labs count as current** for scalar and membership, but are excluded from bounded aggregates.

---

## 5. External observations

### 5.1 LLM gates

**Call site.**
- `pipeline/request.ts:evaluateSession` (single pathway) and `pipeline/run.ts:evaluateRun` (per child) build `liveObservations(sessionObs, request.requestObservations, auditingLlmClient(loadLLMGateConfig(), pathwayId, request.audits), env.llmModel ?? '')`.
- The client is `services/llm/llm-gate-client.ts:evaluateGateWithLLM`: an OpenAI-compatible `POST {LLM_GATE_BASE_URL}/chat/completions` (default Groq `llama-3.3-70b-versatile`) with `temperature:0` and a forced tool call `decide_branch` whose `chosen_branch` is constrained by an enum.
- Timeout: `LLM_GATE_TIMEOUT_MS` (default 30000) via AbortController.
- It throws `LLMGateError` on timeout, network error, non-2xx, missing tool call, bad JSON, or a branch outside the enum. Confidence is clamped to [0,1].
- The call is made **inside** `traverse` (awaited per gate), i.e. during evaluation.

**Observation key** (`observations.ts:observationKey`) = `hashOf({gateId, prompt ?? title, branches[{name,description}], inputAttribute, narrative, model})`.
- `confidence_threshold` is excluded, per spec D10.
- `model` is `env.llmModel`, which is `loadLLMGateConfig()?.model ?? null`, becoming `''` when no key is set. The model is part of `envFingerprint`.

**Lookup order and failure handling (`liveObservations`).**

| Step | What happens |
|---|---|
| Key found in session `observations`, then in request observations | Reuse, mark `used`. |
| No client, or this key already failed in this attempt | `unavailable` → verdict `failed`. |
| Otherwise | Call the client. Success stores the result in `request.requestObservations` and marks it `used`. |
| Call throws | Add to `failedThisAttempt` → `unavailable`. |

- A `failed` verdict makes `evaluateLlmTextAnalysis` return `satisfied:true`, `tentative:true`, safe-default branch, confidence 0.
- The traversal then INCLUDEs the gate and pushes a tentative SELECT pending question unless `gateAnswers` has an answer. Readiness blocks on it (spec D3).

**Recording.**
- `persistedObservations`: the session keeps all prior observations plus only the request observations whose keys this result used. Failures are **never** recorded, per D3.
- Audit rows go to `llm_gate_evaluations` via `auditingLlmClient` (success and error), written in the committing transaction or flushed best-effort (`commit.ts:withAudits`).

**Retry reuse.** `EvaluationRequest.requestObservations` survives the up-to-3 `RevisionConflict` retries (`commit.ts:MAX_ATTEMPTS`). `failedThisAttempt` is per provider, so a failed call **is retried on the next attempt and on every later mutation**.

**Replay.** `replayObservations(frozen, model)` is referenced only in `__tests__` (for example pipeline-properties, acceptance-a1/a2, sequence-vs-fresh). No production code path replays. The REPLAY resolution mode throws "requires persisted normalized facts (plan 05b)".

**Determinism holes.**
1. The key includes the narrative, so any `freeformData` change re-queries the model.
2. An answered LLM gate still calls the model on every evaluation (the evaluator ignores `gateAnswers`). Routing then prefers the answer (`decisionValueOf`). The call costs latency and audit rows but does not change the outcome.
3. A failure is non-sticky: the same inputs can produce "tentative, safe default" now and a real verdict on the next mutation.
4. Changing `LLM_GATE_MODEL` changes keys, so every recorded observation is orphaned and the model is re-queried.

**Live.** No `LLM_GATE_*` variables are set in `pm2 env 0`, so the client is null. `llm_gate_evaluations` has 0 rows. No stored graph (any status) has an `llm_text_analysis` gate.

### 5.2 Other external calls

- **RxNav** (`medications/rxnav-client.ts`, `https://rxnav.nlm.nih.gov/REST`, 5 s timeout per fetch, via `normalizer.ts:prewarmMedication(s)`).
- Triggers:
  - `prewarmPathwayInBackground` at import and activation
  - `scripts/backfill-medication-normalization.ts`
  - `prewarmInBackground(pool, env.unnormalized)` in `evaluateSession` and `evaluateRun` on **every evaluation request**, fire-and-forget, started right after the REPEATABLE READ env snapshot closes
- It **can run concurrently with an evaluation but cannot affect it**: the safety reference was already read in the snapshot (`load-env.ts:inSnapshot`). It can change the **next** attempt's or mutation's env. New `medication_normalization_cache` rows change `SafetyReference` and so `envFingerprint`, and a retry after `RevisionConflict` takes a fresh snapshot.
- Misses are cached as rows with a null rxcui (never retried automatically). Live: 16 cache rows, 9 with an rxcui.
- **The medication admin queue** (`admin-queue.ts`) calls RxNav on admin action only.
- **No other network I/O** was found in the evaluation path. `age-client` is PostgreSQL.

---

## 6. Missing-data question generation

### 6.1 Mechanism

`traversal-engine.ts:unresolvedAsk` runs on a non-satisfied, non-question gate:
- It fires only if `indeterminate || dataUnavailable`, and not when `on_unresolved === 'default'` (absent means `ask`).
- It iterates `gateResult.unresolvedConditions`, or falls back to all of the gate's conditions, and takes the **first** condition for which `unresolved-prompt.ts:askFor` returns non-null.
- The gate becomes `PENDING_QUESTION` with its subtree held.
- The question is deduped on `datumKey` (a second gate is appended to `askedByNodeIds`).
- The prompt is `gateProps.prompt ?? generated`. The answer type is always `NUMERIC`.

`askFor` returns:

| Condition | datumKey | askTarget |
|---|---|---|
| attribute `vitals.X` | `vitals.X` | `{vital, path: 'vitals.X'}` (**full attribute name**) |
| attribute `lab.X` / `allergy.X` with a row | `lab.X` | `{lab, code, system}`: allergy gets a *lab* target |
| attribute otherwise (`patient.*`, unmapped) | the attribute name | `{attribute, path}` |
| coded scalar on `vitals` | `vitals.<value>` | `{vital, path: value}` |
| coded scalar on `labs` | `<system ?? 'LOINC'>:<value>` | `{lab, code, system}` |
| coded membership, aggregate, scalar on other fields, unknown operator | null | — |

The answer path (`answerChange`) writes the fact as described in §3.2.

### 6.2 Can every missing-data path produce a question that resolves it? No.

| Missing-data path | Produces a question? | Does answering resolve it? |
|---|---|---|
| coded labs scalar, missing or out of horizon | yes | yes |
| attribute `lab.*` mapped, standard operator | yes (datumKey `lab.hemoglobin`, **different** from coded `LOINC:718-7` for the same datum, so a pathway mixing both forms asks twice) | yes |
| coded vitals scalar | yes | yes (path = value), given `encounterStart` |
| **attribute `vitals.*`** | yes | **no.** The answer is written to `vitalSigns['vitals.systolic_bp']`. The assembler flattens that to code `vitals.systolic_bp`, but the adapter selects code `systolic_bp`. The gate stays `du` and the question re-appears forever. **[probe]** The coded form's datumKey `vitals.systolic_bp` is the **same** as the attribute form's, so if both forms appear, whichever gate asks first decides the target. |
| **scalar `AMBIGUOUS_LATEST` from ≥2 undated values** | yes | **no.** The dated answer never beats an undated fact whose range is (−∞, +∞). **[probe]** |
| **scalar `TEMPORAL_UNKNOWN` / `VALIDITY_UNKNOWN`** | yes | **no.** Any INDETERMINATE candidate poisons the scalar regardless of a newer fact. **[probe]** |
| scalar same-day duplicate values | yes | yes (a later-instant answer wins) **[probe]** |
| legacy-dialect `lab.* LT` missing | yes | **no.** The value arrives and `compareScalar('LT')` is false forever. |
| `lab.rh_factor` (string valueType) | yes, but NUMERIC | a numeric answer can never equal `"negative"` |
| attribute `patient.*` missing | **no** (legacy fallback emits no signal) | — The `{attribute}` target and the `patientAttributes` write path are **dead code** today. |
| unmapped `lab.*` / `allergy.*` | **no** | — |
| aggregate with too few points (e.g. `gate-oral-iron-response`) | **no** (by design: "a series cannot be asked for") | — falls to `default_behavior` (traverse there) |
| aggregate `AMBIGUOUS_SERIES_ORDER` | indeterminate, but askFor is null | — falls to default_behavior; the uncertainty is recorded on the NodeResult |
| coded scalar on a stateful field | du, askFor null | — default_behavior |
| compound AND with an unsignalled false sibling (`patient.*` missing) | **no**: the false dominates | — silent GATED_OUT |
| legacy-v0 session, any condition | **never** (no signals) | — |

**Loop hazard.** Where the answer does not resolve the gate, each answer adds an event, advances the revision and bumps nothing else. Because of the dedup rule, the second and later answers are dropped (§3.3). The session pends indefinitely, and nothing detects an asked-and-answered datum that is still unresolved.

---

## 7. Live data (read-only, 2026-09-26)

**Pathways** (`pathway_graph_index`):
- ACTIVE: `anemia-in-pregnancy-v1@1.4` only.
- DRAFT: anemia 1.1, 1.2, 1.3, 1.5, 1.6, 1.7; `chronic-htn-pregnancy-v1@1.0`; `gestational-hypertension-preeclampsia@1`.
- SUPERSEDED: anemia 1.0.
- ARCHIVED: anemia-pregnancy-v1, routine-prenatal-care-v1, vaginal-discharge-pregnancy-v1, vaginitis-in-pregnancy-v1.
- `temporal_defaults` is NULL everywhere.

**Condition forms in ACTIVE and DRAFT graphs** (AGE `MATCH (g:Gate)`):

| Pathway@ver | Status | Gates | Forms |
|---|---|---|---|
| anemia 1.4 | ACTIVE | 2 compound, 3 patient_attribute | canonical coded `labs` (718-7 `less_than` 11 / 10.5 / 7; 2276-4 `less_than` 30; 718-7 `delta_from_baseline` window_days 14 delta 1, default traverse) + attribute `patient.trimester` `in [1,3]` / `equals 2` |
| anemia 1.5, 1.6, 1.7 | DRAFT | same | identical to 1.4 |
| anemia 1.1, 1.2, 1.3 | DRAFT | same | **legacy dialect**: `lab.hemoglobin LT`, `lab.ferritin LT`, `patient.trimester IN "1,3"` (a string) / `EQUALS 2`, `lab.hemoglobin_delta_2wk GTE 1` (**unmapped**) |
| gestational-HTN 1 | DRAFT | 4 compound, 4 question | coded labs scalar with NODE horizons (`{days:7}`, `{days:1}`), default-horizon labs (777-3, 2160-0), membership conditions ICD-10 `O13.x`, `O14.x.*` with `status:active` and `horizon:{days:300}` |
| chronic-htn 1.0 | DRAFT | **0 Gates** | 6 DecisionPoints (question-style), 18 Criteria |

- In ARCHIVED graphs: legacy dialect (`lab.MCV` unmapped, `allergy.metronidazole EQUALS true`, `lab.rh_factor EQUALS "negative"`) and 4 `prior_node_result` gates (vaginitis).
- No vitals conditions anywhere. No LLM gates anywhere. No gate sets `on_unresolved`, so all default to `ask`.

**`pathway_attribute_code_map`** (loaded once per process and cached forever by `attribute-code-map.ts:loadAttributeCodeMap`; a row change needs a restart):

| attribute_name | namespace | system | code | value_type |
|---|---|---|---|---|
| allergy.metronidazole | allergy | RXNORM | 6922 | boolean |
| lab.ferritin | lab | LOINC | 2276-4 | number |
| lab.hemoglobin | lab | LOINC | 718-7 | number |
| lab.rh_factor | lab | LOINC | 10331-7 | string |

**Sessions.**
- 16 in `pathway_resolution_sessions`: 14 ACTIVE and 2 ABANDONED, all v1, none with `encounterStart`, none with LLM observations.
- They run on anemia versions 1.1 through 1.7. Most are on versions now DRAFT; start requires ACTIVE, so these were presumably created while each was active **[unverified]**.
- 9 are still pending on the hemoglobin datum (`LOINC:718-7` or `lab.hemoglobin`) at `gate-severe-anemia`.

---

## 8. Findings that matter for the interpreter design (ranked)

1. **Two evaluators, one table of semantics that differ by notation.**
   - Under v1, `patient.*` and unmapped attributes stay on the legacy path and emit no signals, so a missing demographic is a *definite false*. In compound AND gates, the shape of ACTIVE anemia 1.4, that silently gates out and suppresses the question for the lab sibling.
   - `lab.hemoglobin` and `LOINC:718-7` produce different datumKeys for one datum.
   - An interpreter needs one condition IR with explicit missing/unknown for every kind.
2. **Several asked questions cannot be resolved by answering them:** attribute `vitals.*` (path mismatch), scalar indeterminate from undated duplicates, TEMPORAL/VALIDITY_UNKNOWN, legacy `LT`, and string-typed lab attributes. Combined with the pinned clock and first-wins dedup, re-answers are dropped. Nothing detects "answered but still unresolved".
3. **Fact semantics are inconsistent across the stages of one evaluation.** The kernel applies horizon, status and validity. The scorers, catch-up prerequisites, patient safety/DDI and reachability read raw arrays. An undated lab is "current" for scalars but absent for bounded aggregates. An open-ended active condition satisfies any look-back horizon.
4. **Nothing normalizes or re-validates stored conditions.**
   - The legacy dialect (uppercase operators, string list operands, unmapped attributes) survives in DRAFT 1.1–1.3 and archived graphs. It evaluates to a silent false.
   - `activatePathway` does no validation, so these can be made ACTIVE.
   - Horizon/status values are validated only at session start (v1 sweep), so a malformed override makes the pathway unstartable, not unimportable.
   - The admin UI validates no conditions and cannot author horizon or status.
5. **External observations.**
   - LLM calls happen inside traversal and are keyed on narrative + model. Failures are never recorded, so they are retried on every mutation and the outcome can flip between "tentative safe default" and a real verdict with no fact change.
   - Answered LLM gates are still re-queried.
   - `replayObservations` has no production caller.
   - Live has no LLM key and no LLM gates.
   - RxNav pre-warm fires on every evaluation request, concurrently but outside the snapshot, so it changes the env (fingerprint) of later mutations and of retries within the same request.
6. **v1 vitals default to ENCOUNTER, and no live session has `encounterStart`.** The first vitals-based pathway will throw `MISSING_ENCOUNTER_ANCHOR` at start unless callers start sending `encounterStart`. The gestational-HTN draft avoids this only by coding BP as labs.
