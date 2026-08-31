import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { DataSourceContext } from '../types/index';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: any; output: any; }
  _FieldSet: { input: any; output: any; }
};

export type AddAdminEvidenceInput = {
  applicableCriteria?: InputMaybe<Array<Scalars['String']['input']>>;
  evidenceLevel: Scalars['String']['input'];
  nodeIdentifier: Scalars['String']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
  pathwayId: Scalars['ID']['input'];
  populationDescription?: InputMaybe<Scalars['String']['input']>;
  source?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
  url?: InputMaybe<Scalars['String']['input']>;
  year?: InputMaybe<Scalars['Int']['input']>;
};

export type AdditionalContextInput = {
  allergies?: InputMaybe<Array<CodeInput>>;
  conditionCodes?: InputMaybe<Array<CodeInput>>;
  freeformData?: InputMaybe<Scalars['JSON']['input']>;
  labResults?: InputMaybe<Array<LabResultInput>>;
  medications?: InputMaybe<Array<CodeInput>>;
  patientAttributes?: InputMaybe<Scalars['JSON']['input']>;
  vitalSigns?: InputMaybe<Scalars['JSON']['input']>;
};

export type AdminEvidenceEntry = {
  __typename?: 'AdminEvidenceEntry';
  applicableCriteria?: Maybe<Array<Scalars['String']['output']>>;
  createdAt: Scalars['String']['output'];
  createdBy?: Maybe<Scalars['String']['output']>;
  evidenceLevel: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  nodeIdentifier: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  pathwayId: Scalars['ID']['output'];
  populationDescription?: Maybe<Scalars['String']['output']>;
  source?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  url?: Maybe<Scalars['String']['output']>;
  year?: Maybe<Scalars['Int']['output']>;
};

export enum AnswerType {
  Boolean = 'BOOLEAN',
  Numeric = 'NUMERIC',
  Select = 'SELECT'
}

export type ArchiveResult = {
  __typename?: 'ArchiveResult';
  pathway: Pathway;
  success: Scalars['Boolean']['output'];
};

/**
 * One entry in the authoring vocabulary for named attribute conditions:
 * either a curated code-map row (lab.*\/allergy.*) or a derived patient.*
 * attribute. Used by the admin UI authoring picker so it never drifts from
 * what the resolver actually understands.
 */
export type AttributeVocabularyEntry = {
  __typename?: 'AttributeVocabularyEntry';
  attribute: Scalars['String']['output'];
  display: Scalars['String']['output'];
  namespace: Scalars['String']['output'];
  unit?: Maybe<Scalars['String']['output']>;
  valueType: Scalars['String']['output'];
};

export enum BlockerType {
  Contradiction = 'CONTRADICTION',
  EmptyPlan = 'EMPTY_PLAN',
  PendingGate = 'PENDING_GATE',
  UnresolvedRedFlag = 'UNRESOLVED_RED_FLAG'
}

export type CarePlanGenerationResult = {
  __typename?: 'CarePlanGenerationResult';
  blockers: Array<ValidationBlockerType>;
  carePlanId?: Maybe<Scalars['ID']['output']>;
  success: Scalars['Boolean']['output'];
  warnings: Array<Scalars['String']['output']>;
};

/**
 * A pathway node the patient hasn't satisfied (per its `satisfaction_check`)
 * that was required by a downstream node that did fire. Surfaced so the
 * encounter can cover catch-up work alongside the actually-requested
 * recommendation.
 */
export type CatchUpItem = {
  __typename?: 'CatchUpItem';
  /** The downstream node that REQUIRES this prereq. */
  dependentNodeId: Scalars['ID']['output'];
  /** The unmet prerequisite node. */
  nodeId: Scalars['ID']['output'];
  nodeType: Scalars['String']['output'];
  /**
   * Why the prereq was flagged. One of:
   *   no-satisfaction-check  — the prereq node has no `satisfaction_check` authored.
   *   code-not-in-snapshot   — code-based check found no matching code in the patient context.
   *   attestation-required   — explicit attestation, provider must confirm.
   */
  reason: Scalars['String']['output'];
  /** Pathway whose backtracking pass flagged this catch-up. */
  sourcePathwayId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
};

/** Clinical state a SYNTHETIC caller may assert on a coded entry. */
export enum ClinicalStateInput {
  Active = 'ACTIVE',
  Conflict = 'CONFLICT',
  Inactive = 'INACTIVE',
  OnHold = 'ON_HOLD',
  Unknown = 'UNKNOWN'
}

export type CodeDefinition = {
  __typename?: 'CodeDefinition';
  category?: Maybe<Scalars['String']['output']>;
  code: Scalars['String']['output'];
  description: Scalars['String']['output'];
  isCommon: Scalars['Boolean']['output'];
  /**
   * For LOINC: TEST or PANEL. Null for non-LOINC systems. Drives the simulator's
   * panel-expansion affordance and the pathway editor's LabTest authoring (which
   * filters PANEL out — gates target individual analytes).
   */
  labKind?: Maybe<LabKind>;
  system: Scalars['String']['output'];
};

export type CodeInput = {
  /** SYNTHETIC only. Absent means ACTIVE, recorded as a fail-open default. */
  clinicalState?: InputMaybe<ClinicalStateInput>;
  code: Scalars['String']['input'];
  /**
   * Occurrence date (FHIR date or instant). Two entries with the same code on
   * different dates are distinct occurrences, not duplicates.
   */
  date?: InputMaybe<Scalars['String']['input']>;
  display?: InputMaybe<Scalars['String']['input']>;
  /**
   * End of the occurrence. Absent on an active entry means "still ongoing"; on an
   * INACTIVE entry it means the end is simply unknown.
   */
  endDate?: InputMaybe<Scalars['String']['input']>;
  /** SYNTHETIC only. Absent means VALID. */
  recordValidity?: InputMaybe<RecordValidityInput>;
  /** Opaque source identifier — part of what makes an occurrence distinct. */
  sourceId?: InputMaybe<Scalars['String']['input']>;
  system: Scalars['String']['input'];
};

export type ConditionCodeDetail = {
  __typename?: 'ConditionCodeDetail';
  code: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  grouping?: Maybe<Scalars['String']['output']>;
  system: Scalars['String']['output'];
  usage?: Maybe<Scalars['String']['output']>;
};

export type ConflictCandidate = {
  __typename?: 'ConflictCandidate';
  recommendation: ResolvedMedication;
  sourcePathwayId: Scalars['ID']['output'];
  sourcePathwayTitle: Scalars['String']['output'];
};

/**
 * Provider's choice for one conflict. Exactly one of the kind-specific fields
 * must be populated; the resolver validates which is required for each kind.
 *
 *   CONFIRM_PATHWAY  → chosenPathwayId
 *   ACCEPT_BOTH      → (no extra fields)
 *   REJECT_BOTH      → (no extra fields)
 *   CUSTOM_OVERRIDE  → customMedication
 */
export type ConflictChoiceInput = {
  chosenPathwayId?: InputMaybe<Scalars['ID']['input']>;
  customMedication?: InputMaybe<CustomMedicationOverrideInput>;
  kind: ConflictResolutionKind;
  reason?: InputMaybe<Scalars['String']['input']>;
};

export type ConflictResolution = {
  __typename?: 'ConflictResolution';
  /** Set when kind=CONFIRM_PATHWAY. */
  chosenPathwayId?: Maybe<Scalars['ID']['output']>;
  /** Set when kind=CUSTOM_OVERRIDE. */
  customMedication?: Maybe<CustomMedicationOverride>;
  kind: ConflictResolutionKind;
  reason?: Maybe<Scalars['String']['output']>;
  resolvedAt: Scalars['String']['output'];
  resolvedBy: Scalars['ID']['output'];
};

export enum ConflictResolutionKind {
  AcceptBoth = 'ACCEPT_BOTH',
  ConfirmPathway = 'CONFIRM_PATHWAY',
  CustomOverride = 'CUSTOM_OVERRIDE',
  RejectBoth = 'REJECT_BOTH'
}

export enum ConflictType {
  Medication = 'MEDICATION'
}

export type CreateSignalDefinitionInput = {
  defaultWeight: Scalars['Float']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  displayName: Scalars['String']['input'];
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  propagationConfig?: InputMaybe<PropagationConfigInput>;
  scope: SignalScope;
  scoringRules: Scalars['JSON']['input'];
  scoringType: ScoringType;
};

/**
 * A custom medication a provider wrote in to replace both candidates of a
 * soft conflict. Free-text in v1; no RxNorm normalization. The downstream
 * care plan carries the strings through verbatim.
 */
export type CustomMedicationOverride = {
  __typename?: 'CustomMedicationOverride';
  dose?: Maybe<Scalars['String']['output']>;
  duration?: Maybe<Scalars['String']['output']>;
  frequency?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  note?: Maybe<Scalars['String']['output']>;
  route?: Maybe<Scalars['String']['output']>;
};

export type CustomMedicationOverrideInput = {
  dose?: InputMaybe<Scalars['String']['input']>;
  duration?: InputMaybe<Scalars['String']['input']>;
  frequency?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  note?: InputMaybe<Scalars['String']['input']>;
  route?: InputMaybe<Scalars['String']['input']>;
};

export enum DdiFindingCategory {
  Allergy = 'ALLERGY',
  DdiContraindicated = 'DDI_CONTRAINDICATED',
  DdiModerate = 'DDI_MODERATE',
  DdiSevere = 'DDI_SEVERE'
}

/** Reference to the patient med, allergy, or other recommendation that fired the finding. */
export type DdiFindingSource = {
  __typename?: 'DDIFindingSource';
  /** One of: PATIENT_MEDICATION | PATIENT_ALLERGY | OTHER_RECOMMENDATION. */
  kind: Scalars['String']['output'];
  /** Set when kind=PATIENT_MEDICATION or OTHER_RECOMMENDATION. */
  name?: Maybe<Scalars['String']['output']>;
  /** Set when kind=OTHER_RECOMMENDATION. */
  recommendationId?: Maybe<Scalars['String']['output']>;
  /** Set when kind=PATIENT_MEDICATION (RxCUI of patient drug) or OTHER_RECOMMENDATION (RxCUI of other rec). */
  rxcui?: Maybe<Scalars['String']['output']>;
  /** Set when kind=PATIENT_ALLERGY. */
  snomedCode?: Maybe<Scalars['String']['output']>;
  /** Set when kind=PATIENT_ALLERGY. */
  snomedDisplay?: Maybe<Scalars['String']['output']>;
};

/**
 * A DDI finding at MODERATE severity. Suppressions (CONTRAINDICATED/SEVERE)
 * flow through the existing SuppressedRecommendation surface; warnings are
 * advisory and surface inline so providers see them before signing.
 */
export type DdiWarning = {
  __typename?: 'DDIWarning';
  category: DdiFindingCategory;
  clinicalAdvice?: Maybe<Scalars['String']['output']>;
  drugName: Scalars['String']['output'];
  mechanism?: Maybe<Scalars['String']['output']>;
  recommendationId: Scalars['String']['output'];
  severity: Scalars['String']['output'];
  source: DdiFindingSource;
};

/**
 * A closed-off branch: a gate that didn't fire, plus the action-node
 * recommendations the system would have surfaced if it had. Powers
 * "add this data" affordances in the provider UI.
 */
export type DataGapHint = {
  __typename?: 'DataGapHint';
  /**
   * True when a scalar comparison had no usable value at all — the common half
   * of "the gate did not answer", and the only half that is honestly an
   * "add this data" prompt. Neither flag set on a non-firing gate means the
   * gate ANSWERED "no", which is not a data gap.
   */
  dataUnavailable?: Maybe<Scalars['Boolean']['output']>;
  fieldsRead: Array<Scalars['String']['output']>;
  /** Gate node id. */
  gateNodeId: Scalars['ID']['output'];
  gateTitle: Scalars['String']['output'];
  /**
   * True when candidate facts existed but could not be ordered or trusted, so
   * the gate refused to decide. Null when the resolution ran under a policy
   * version that does not compute it.
   */
  indeterminate?: Maybe<Scalars['Boolean']['output']>;
  /** Same kind vocabulary as GateEvidence.kind. */
  kind: Scalars['String']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  /** Pathway that produced this hint (set in the merged plan). */
  sourcePathwayId: Scalars['ID']['output'];
  /** GATED_OUT / PENDING_QUESTION / UNKNOWN. */
  status: Scalars['String']['output'];
  /** Why the gate could not decide, when `indeterminate` is true. */
  uncertaintyReason?: Maybe<Scalars['String']['output']>;
  /** Action-node recommendations downstream of this gate. */
  unlockedRecommendations: Array<UnlockedRecommendation>;
};

/**
 * Result of `deletePreviewSession`. Reports the deleted multi-pathway
 * session id plus how many per-pathway contributing sessions were removed
 * as part of the cascade.
 */
export type DeletePreviewSessionResult = {
  __typename?: 'DeletePreviewSessionResult';
  contributingSessionsDeleted: Scalars['Int']['output'];
  sessionId: Scalars['ID']['output'];
};

export type DiffDetail = {
  __typename?: 'DiffDetail';
  action: Scalars['String']['output'];
  entityId: Scalars['String']['output'];
  entityLabel: Scalars['String']['output'];
  entityType: Scalars['String']['output'];
};

export type GateAnswerInput = {
  booleanValue?: InputMaybe<Scalars['Boolean']['input']>;
  numericValue?: InputMaybe<Scalars['Float']['input']>;
  selectedOption?: InputMaybe<Scalars['String']['input']>;
};

export enum GateClassification {
  AlwaysEvaluable = 'ALWAYS_EVALUABLE',
  DataAvailable = 'DATA_AVAILABLE',
  DataBlocked = 'DATA_BLOCKED',
  Indeterminate = 'INDETERMINATE',
  Question = 'QUESTION'
}

/**
 * One gate / decision-point's contribution to a pathway's resolution.
 * Surfaced for provider transparency — clinicians can see what patient
 * data the pathway considered, not just the final care plan.
 */
export type GateEvidence = {
  __typename?: 'GateEvidence';
  /**
   * True when a scalar comparison had no usable value at all — the common half
   * of "the gate did not answer", and the only half that is honestly an
   * "add this data" prompt. Neither flag set on a non-firing gate means the
   * gate ANSWERED "no", which is not a data gap.
   */
  dataUnavailable?: Maybe<Scalars['Boolean']['output']>;
  /**
   * Patient-context field paths the gate read (e.g. "labs",
   * "conditions", "vitals.systolic_bp"). Lets the dashboard render
   * which signals drove the gate.
   */
  fieldsRead: Array<Scalars['String']['output']>;
  /**
   * True when candidate facts existed but could not be ordered or trusted, so
   * the gate refused to decide. Null when the resolution ran under a policy
   * version that does not compute it.
   */
  indeterminate?: Maybe<Scalars['Boolean']['output']>;
  /**
   * Source kind: 'patient_attribute' | 'compound' | 'question' |
   * 'llm_text_analysis' | 'prior_node_result' | 'decision_point'.
   */
  kind: Scalars['String']['output'];
  /** Pathway node id of the gate / decision point. */
  nodeId: Scalars['ID']['output'];
  /** Human-readable evaluator output (e.g. "labs value 8.1 > 7.0"). */
  reason?: Maybe<Scalars['String']['output']>;
  /** Pathway that produced this evidence (set in the merged plan). */
  sourcePathwayId: Scalars['ID']['output'];
  /** INCLUDED / GATED_OUT / PENDING_QUESTION / etc. */
  status: Scalars['String']['output'];
  /** Display title (e.g. "BP > 130", "HbA1c trending up over 6mo"). */
  title: Scalars['String']['output'];
  /** Why the gate could not decide, when `indeterminate` is true. */
  uncertaintyReason?: Maybe<Scalars['String']['output']>;
};

/**
 * Per-gate explanation surfaced for a pathway/patient pair. `missingData` is
 * populated only when classification is DATA_BLOCKED — it lists the specific
 * data items needed to make the gate resolvable.
 */
export type GateExplanation = {
  __typename?: 'GateExplanation';
  classification: GateClassification;
  gateNodeIdentifier: Scalars['String']['output'];
  gateTitle: Scalars['String']['output'];
  missingData: Array<MissingData>;
  reason: Scalars['String']['output'];
};

export type ImportDiff = {
  __typename?: 'ImportDiff';
  details: Array<DiffDetail>;
  summary: ImportDiffSummary;
  /** True when the diff is a placeholder (creation summary or graph reconstruction unavailable). */
  synthetic: Scalars['Boolean']['output'];
};

export type ImportDiffSummary = {
  __typename?: 'ImportDiffSummary';
  edgesAdded: Scalars['Int']['output'];
  edgesModified: Scalars['Int']['output'];
  edgesRemoved: Scalars['Int']['output'];
  nodesAdded: Scalars['Int']['output'];
  nodesModified: Scalars['Int']['output'];
  nodesRemoved: Scalars['Int']['output'];
};

export enum ImportMode {
  DraftUpdate = 'DRAFT_UPDATE',
  NewPathway = 'NEW_PATHWAY',
  NewVersion = 'NEW_VERSION'
}

export type ImportPathwayResult = {
  __typename?: 'ImportPathwayResult';
  diff?: Maybe<ImportDiff>;
  importType: ImportMode;
  pathway?: Maybe<Pathway>;
  validation: ValidationResult;
};

/**
 * LOINC codes can be individual analytes ("TEST") or collections ("PANEL").
 * Null for every other code system (ICD-10, SNOMED, RxNorm, CPT).
 */
export enum LabKind {
  Panel = 'PANEL',
  Test = 'TEST'
}

export type LabResultInput = {
  code: Scalars['String']['input'];
  date?: InputMaybe<Scalars['String']['input']>;
  display?: InputMaybe<Scalars['String']['input']>;
  /** SYNTHETIC only. Absent means VALID. */
  recordValidity?: InputMaybe<RecordValidityInput>;
  /** Opaque source identifier — part of what makes an occurrence distinct. */
  sourceId?: InputMaybe<Scalars['String']['input']>;
  system: Scalars['String']['input'];
  unit?: InputMaybe<Scalars['String']['input']>;
  value?: InputMaybe<Scalars['Float']['input']>;
};

/**
 * Audit row for one llm_text_analysis Gate evaluation. Persisted in
 * llm_gate_evaluations; surfaced to providers as the "show me what the AI saw"
 * popout.
 */
export type LlmGateEvaluation = {
  __typename?: 'LlmGateEvaluation';
  branches: Scalars['JSON']['output'];
  chosenBranch?: Maybe<Scalars['String']['output']>;
  confidence?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['String']['output'];
  errorMessage?: Maybe<Scalars['String']['output']>;
  gateId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  inputAttribute?: Maybe<Scalars['String']['output']>;
  inputText?: Maybe<Scalars['String']['output']>;
  latencyMs?: Maybe<Scalars['Int']['output']>;
  model: Scalars['String']['output'];
  pathwayId: Scalars['ID']['output'];
  prompt: Scalars['String']['output'];
  reasoning?: Maybe<Scalars['String']['output']>;
  sessionId: Scalars['ID']['output'];
  tentative: Scalars['Boolean']['output'];
};

/**
 * One constituent test of a LOINC panel — the analyte that gets a real value
 * when the panel is run. Returned by `loincPanelConstituents(panelCode)`.
 */
export type LoincPanelConstituent = {
  __typename?: 'LoincPanelConstituent';
  code: Scalars['String']['output'];
  description: Scalars['String']['output'];
  displayOrder: Scalars['Int']['output'];
};

export type ManuallyResolvedMedication = {
  __typename?: 'ManuallyResolvedMedication';
  atcClasses: Array<Scalars['String']['output']>;
  ingredientName: Scalars['String']['output'];
  ingredientRxcui: Scalars['String']['output'];
  inputCode?: Maybe<Scalars['String']['output']>;
  inputSystem?: Maybe<Scalars['String']['output']>;
  inputText: Scalars['String']['output'];
};

/**
 * A code set whose member codes are all satisfied by the patient. The
 * matcher returns one of these per fired set per matched pathway.
 */
export type MatchedCodeSet = {
  __typename?: 'MatchedCodeSet';
  description?: Maybe<Scalars['String']['output']>;
  entryNodeId?: Maybe<Scalars['String']['output']>;
  memberCount: Scalars['Int']['output'];
  members: Array<MatchedCodeSetMember>;
  scope: Scalars['String']['output'];
  setId: Scalars['ID']['output'];
};

export type MatchedCodeSetMember = {
  __typename?: 'MatchedCodeSetMember';
  code: Scalars['String']['output'];
  system: Scalars['String']['output'];
};

export type MatchedPathway = {
  __typename?: 'MatchedPathway';
  /**
   * Coverage score: patientCodesAddressed.length / (addressed + unaddressed).
   * An honest measure of how comprehensively this pathway addresses the
   * patient's clinical profile. NOTE: semantic shifted from the legacy
   * "matched_codes / total_codes" computation; same field shape.
   */
  matchScore: Scalars['Float']['output'];
  /**
   * Always true for results in the matchedPathways list (a non-match wouldn't
   * appear). Explicit field for clients that want to render binary state.
   */
  matched: Scalars['Boolean']['output'];
  /**
   * Union of code-set member codes that fired across all matched sets.
   * Retained from the pre-Phase-1b shape for backwards compatibility.
   */
  matchedConditionCodes: Array<Scalars['String']['output']>;
  /**
   * Every code set whose member codes are all satisfied by the patient's
   * expanded code set. Multiple sets fire when a patient's profile satisfies
   * multiple scenarios (typically nested ones — broader sets fire when the
   * more-specific set fires).
   */
  matchedSets: Array<MatchedCodeSet>;
  /**
   * Pointer to the matched set with the largest member count — i.e. the most
   * specific scenario this patient triggers within the pathway. The clinical
   * surface a provider should look at first.
   */
  mostSpecificMatchedSet: MatchedCodeSet;
  pathway: Pathway;
  /**
   * Patient's literal active condition codes that fall under at least one
   * member of the most-specific matched set (member codes themselves OR ICD-10
   * descendants thereof). These are the patient problems THIS pathway addresses.
   */
  patientCodesAddressed: Array<Scalars['String']['output']>;
  /**
   * Patient's literal active condition codes NOT covered by any matched-set
   * member. Signals "consider other pathways" for these clinical problems.
   */
  patientCodesUnaddressed: Array<Scalars['String']['output']>;
  /**
   * Decision-point reachability score for this patient. Lazy field — computed
   * only when requested. Indicates how many of the pathway's gates can be
   * auto-resolved from the patient's current snapshot data.
   */
  reachability: ReachabilityScore;
  /**
   * Member count of mostSpecificMatchedSet. Useful for ranking pathways by
   * match depth (bigger = more nuanced clinical scenario triggered).
   */
  specificityDepth: Scalars['Int']['output'];
};

/**
 * Result of resolving every matched pathway for a patient and merging their
 * recommendations. `medications`/`labs`/etc. carry auto-resolved entries;
 * `conflicts` carries cross-pathway soft conflicts (medications-only in v1)
 * that the provider has to resolve before the merged plan can become a real
 * care plan; `suppressed` carries entries hidden because some pathway flagged
 * the same drug as contraindicated/avoid.
 */
export type MergedCarePlan = {
  __typename?: 'MergedCarePlan';
  /**
   * Unmet prerequisites surfaced by the REQUIRES backtracking pass —
   * catch-up work the encounter should cover because a downstream
   * recommendation requires a prereq the patient hasn't satisfied per
   * the prereq's `satisfaction_check` property.
   */
  catchUpItems: Array<CatchUpItem>;
  /**
   * Soft conflicts requiring provider resolution. v1: medications only —
   * surfaced when ≥2 pathways tag different drugs with the same `clinical_role`.
   * Resolved conflicts stay in this list with `resolution` populated.
   */
  conflicts: Array<MergedConflict>;
  /**
   * Gates that DIDN'T fire (gated out, pending an answer, or
   * unevaluable for lack of data) and the recommendations their subtree
   * would have surfaced. Lets the UI render "Add this data → unlocks N
   * more recommendations" prompts.
   */
  dataGapHints: Array<DataGapHint>;
  /**
   * Provenance: every gate / decision-point across the contributing
   * pathways that fired during resolution, with the patient-context
   * fields each one read. Lets the UI render "the system considered
   * these patient signals" alongside the merged plan, so providers can
   * see what drove the recommendations and what additional data could
   * influence them.
   */
  evidenceTrail: Array<GateEvidence>;
  guidance: Array<MergedGuidanceRecommendation>;
  imaging: Array<MergedImagingRecommendation>;
  labs: Array<MergedLabRecommendation>;
  medications: Array<MergedMedicationRecommendation>;
  procedures: Array<MergedProcedureRecommendation>;
  qualityMetrics: Array<MergedQualityMetricRecommendation>;
  schedules: Array<MergedScheduleRecommendation>;
  /** Pathways whose resolution fed this merge (post-lattice-collapse). */
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  suppressed: Array<SuppressedRecommendation>;
};

/**
 * A cross-pathway soft conflict (medications-only in v1). Triggered when ≥2
 * pathways tag different drugs with the same `clinical_role`. The provider
 * must resolve every conflict before the merged plan can be turned into a
 * real care plan via `generateMergedCarePlan`.
 */
export type MergedConflict = {
  __typename?: 'MergedConflict';
  candidates: Array<ConflictCandidate>;
  clinicalRole: Scalars['String']['output'];
  /** Stable id within the session — equals the clinical_role tag value. */
  conflictId: Scalars['String']['output'];
  /** Null while the conflict is unresolved. */
  resolution?: Maybe<ConflictResolution>;
  type: ConflictType;
};

export type MergedGuidanceRecommendation = {
  __typename?: 'MergedGuidanceRecommendation';
  recommendation: ResolvedGuidance;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedImagingRecommendation = {
  __typename?: 'MergedImagingRecommendation';
  recommendation: ResolvedImaging;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedLabRecommendation = {
  __typename?: 'MergedLabRecommendation';
  recommendation: ResolvedLab;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedMedicationRecommendation = {
  __typename?: 'MergedMedicationRecommendation';
  recommendation: ResolvedMedication;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedProcedureRecommendation = {
  __typename?: 'MergedProcedureRecommendation';
  recommendation: ResolvedProcedure;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedQualityMetricRecommendation = {
  __typename?: 'MergedQualityMetricRecommendation';
  recommendation: ResolvedQualityMetric;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MergedScheduleRecommendation = {
  __typename?: 'MergedScheduleRecommendation';
  recommendation: ResolvedSchedule;
  sourcePathwayIds: Array<Scalars['ID']['output']>;
  state: RecommendationState;
};

export type MissingData = {
  __typename?: 'MissingData';
  attribute?: Maybe<Scalars['String']['output']>;
  code?: Maybe<Scalars['String']['output']>;
  comparison?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['String']['output']>;
  system?: Maybe<Scalars['String']['output']>;
  threshold?: Maybe<Scalars['Float']['output']>;
  vitalName?: Maybe<Scalars['String']['output']>;
};

/**
 * A pending Gate question surfaced from one of the contributing per-pathway
 * sessions of a multi-pathway resolution. Carries enough metadata for the FE
 * to route the answer to the correct per-pathway session via
 * `answerPendingDecision(sessionId, nodeId, answer)`.
 */
export type MultiPathwayPendingGate = {
  __typename?: 'MultiPathwayPendingGate';
  affectedSubtreeSize: Scalars['Int']['output'];
  answerType: AnswerType;
  /**
   * Set when this question is a request for a DATUM — a gate that could not
   * decide because the value it needed was missing or unorderable — rather
   * than a clinical question put to the provider. Identifies the datum, so
   * several gates reading it surface as one request.
   *
   * Its presence is what tells a client this is answerable from a chart:
   * "what is this patient's haemoglobin?" rather than "is the patient
   * symptomatic?". Null for ordinary question gates.
   */
  datumKey?: Maybe<Scalars['String']['output']>;
  estimatedImpact: Scalars['String']['output'];
  gateId: Scalars['ID']['output'];
  /**
   * Display text for `options`, index-aligned, when the option values are not
   * readable on their own. A branch choice answers with a node id; this carries
   * the branch titles so a client can render them. Null for question gates,
   * whose options are already the author's words.
   */
  optionLabels?: Maybe<Array<Scalars['String']['output']>>;
  options?: Maybe<Array<Scalars['String']['output']>>;
  pathwayId: Scalars['ID']['output'];
  pathwayTitle: Scalars['String']['output'];
  prompt: Scalars['String']['output'];
  sessionId: Scalars['ID']['output'];
  /**
   * True when this question was surfaced by an llm_text_analysis Gate whose
   * confidence fell below the authored threshold. The safe-default branch
   * has already been routed; the provider can confirm or pick a different
   * branch via the standard answer mutation.
   */
  tentative?: Maybe<Scalars['Boolean']['output']>;
  /** The branch the LLM picked (already routed); null for non-LLM gates. */
  tentativeBranch?: Maybe<Scalars['String']['output']>;
  /** Self-reported LLM confidence in [0, 1]; null for non-LLM gates. */
  tentativeConfidence?: Maybe<Scalars['Float']['output']>;
  /** LLM reasoning shown to the provider so they can decide whether to override. */
  tentativeReasoning?: Maybe<Scalars['String']['output']>;
};

/**
 * Persistent session for a multi-pathway resolution. Carries the merged plan,
 * the per-pathway sessions that fed the merge, and the provider's conflict
 * resolutions. Lifecycle:
 *
 *   ACTIVE      — merge produced; provider working on conflicts
 *   COMPLETED   — generateMergedCarePlan succeeded; care_plan_id populated
 *   ABANDONED   — provider abandoned without generating
 *
 * `mergedPlan.conflicts` is the source of truth for whether the session is
 * ready to generate; while any conflict has `resolution: null`,
 * generateMergedCarePlan will return `success: false` with a blocker.
 */
export type MultiPathwayResolutionSession = {
  __typename?: 'MultiPathwayResolutionSession';
  carePlanId?: Maybe<Scalars['ID']['output']>;
  /** Bare ID list of pathways that fed the merge. For full pathway data use `contributingPathways`. */
  contributingPathwayIds: Array<Scalars['ID']['output']>;
  /**
   * Hydrated Pathway objects for `contributingPathwayIds`. Lazily resolved —
   * the FE uses these to decorate merged recommendations + conflicts with
   * pathway titles + condition codes for clinical-meaningful provenance.
   */
  contributingPathways: Array<Pathway>;
  contributingSessionIds: Array<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  /** Phase 4: DDI MODERATE-severity findings — pre-merge + cross-recommendation. */
  ddiWarnings: Array<DdiWarning>;
  id: Scalars['ID']['output'];
  /**
   * True when this session was created by admin/QA/preview tooling
   * (currently: `startMultiPathwayResolution` called with
   * `syntheticPatient: true`). Preview sessions are filtered out of
   * default list queries and can be hard-deleted via
   * `deletePreviewSession`. They exercise the exact same resolver code
   * path as real sessions so preview traffic tests what ships to prod.
   */
  isPreview: Scalars['Boolean']['output'];
  mergedPlan: MergedCarePlan;
  patientId: Scalars['ID']['output'];
  /**
   * Aggregated pending Gate questions across every contributing per-pathway
   * session. Empty when every gate has been auto-resolved from patient data or
   * hand-answered. Each entry carries `sessionId` so the FE can call
   * `answerPendingDecision` against the correct per-pathway session. Until a
   * re-merge surface exists, answering a gate updates the per-pathway state
   * but NOT the merged plan — re-run resolution to see merge changes.
   */
  pendingGateQuestions: Array<MultiPathwayPendingGate>;
  providerId: Scalars['ID']['output'];
  status: MultiPathwayResolutionSessionStatus;
  updatedAt: Scalars['String']['output'];
};

export enum MultiPathwayResolutionSessionStatus {
  Abandoned = 'ABANDONED',
  Active = 'ACTIVE',
  Completed = 'COMPLETED'
}

/** Lightweight summary for list views (no embedded merged plan). */
export type MultiPathwayResolutionSessionSummary = {
  __typename?: 'MultiPathwayResolutionSessionSummary';
  carePlanId?: Maybe<Scalars['ID']['output']>;
  contributingPathwayCount: Scalars['Int']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** See `MultiPathwayResolutionSession.isPreview`. */
  isPreview: Scalars['Boolean']['output'];
  patientId: Scalars['ID']['output'];
  providerId: Scalars['ID']['output'];
  status: MultiPathwayResolutionSessionStatus;
  unresolvedConflictCount: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Mark a multi-pathway session ABANDONED. */
  abandonMultiPathwaySession: MultiPathwayResolutionSession;
  abandonSession: ResolutionSession;
  /** Activate a DRAFT pathway, making it available for patient matching. */
  activatePathway: PathwayStatusResult;
  addAdminEvidence: AdminEvidenceEntry;
  addPatientContext: ResolutionSession;
  /**
   * Answer whatever the session is waiting on at a node: a question gate, an
   * escalated request for a datum the pathway needed, or a branch choice at a
   * DecisionPoint whose branches could not be told apart by the data.
   *
   * Renamed from `answerGateQuestion`, which named only the first of the three.
   */
  answerPendingDecision: ResolutionSession;
  /** Archive an ACTIVE pathway, removing it from patient matching. */
  archivePathway: PathwayStatusResult;
  createSignalDefinition: SignalDefinitionType;
  /**
   * Hard-delete a preview session (one whose `isPreview` is true) and its
   * contributing per-pathway sessions. Refuses to touch a real (non-preview)
   * session — those must go through `abandonMultiPathwaySession`, which
   * preserves the row for audit. Intended for admin/QA/preview UIs so they
   * can clean up their own traffic instead of leaving rows behind.
   */
  deletePreviewSession: DeletePreviewSessionResult;
  deleteSignalDefinition: Scalars['Boolean']['output'];
  /** Delete a saved simulator scenario. Returns true when a row was removed. */
  deleteSimulatorScenario: Scalars['Boolean']['output'];
  generateCarePlanFromResolution: CarePlanGenerationResult;
  /**
   * Materialize the merged plan into actual care_plans / care_plan_goals /
   * care_plan_interventions rows. Returns `success=false` with blockers if
   * any conflict is unresolved or if validation fails.
   */
  generateMergedCarePlan: CarePlanGenerationResult;
  /**
   * Import a clinical pathway from JSON. Supports three modes:
   * - NEW_PATHWAY: First import of a new pathway
   * - DRAFT_UPDATE: Re-import of an existing DRAFT pathway (applies diff)
   * - NEW_VERSION: Create a new version of an existing pathway
   *
   * pathwayJson is a JSON string conforming to the PathwayJson schema (see
   * apps/pathway-service/src/services/import/types.ts). It includes schema_version,
   * pathway metadata, nodes array, and edges array. The pipeline validates the
   * full structure and returns all errors at once.
   */
  importPathway: ImportPathwayResult;
  /**
   * Phase 4: clinician-supplied resolution for a medication that failed to
   * normalize. Provide the canonical RxCUI; the system fetches ATC classes
   * from RxNav and rewrites the cache entry. Returns the resolved record.
   */
  manuallyResolveMedicationNormalization: ManuallyResolvedMedication;
  overrideNode: ResolutionSession;
  /**
   * Re-run the merge pipeline against the current state of every contributing
   * per-pathway session, then update this multi-pathway session's stored
   * `mergedPlan` and `ddiWarnings`. Use after a provider answers a Gate
   * question (which re-traverses the per-pathway session) so the merged view
   * picks up the new per-pathway state without forcing a full new resolution.
   * Existing conflict resolutions are preserved.
   */
  reMergeMultiPathwaySession: MultiPathwayResolutionSession;
  /** Reactivate a SUPERSEDED or ARCHIVED pathway. */
  reactivatePathway: PathwayStatusResult;
  removeAdminEvidence: Scalars['Boolean']['output'];
  removeNodeWeight: Scalars['Boolean']['output'];
  removeResolutionThresholds: Scalars['Boolean']['output'];
  removeSignalWeight: Scalars['Boolean']['output'];
  /**
   * Record a provider's choice for one conflict. The session's mergedPlan is
   * rewritten to reflect the choice (chosen drug moves to PROVIDER_CONFIRMED,
   * losers move to PROVIDER_OVERRIDE; CUSTOM_OVERRIDE attaches a write-in
   * recommendation). Returns the updated session.
   */
  resolveConflict: MultiPathwayResolutionSession;
  /**
   * Save a synthetic-patient scenario for the admin simulator. When `id` is
   * provided in input, the existing scenario is overwritten; otherwise a new
   * one is created. Names must be unique — duplicate-name inserts fail and
   * the FE should prompt for a different name.
   */
  saveSimulatorScenario: SimulatorScenario;
  setNodeWeight: NodeWeight;
  setResolutionThresholds: ResolutionThresholds;
  setSignalWeight: SignalWeight;
  /**
   * Run resolution against every pathway that matches the patient and merge
   * the results into a single care plan, persisting both the per-pathway
   * sessions and the multi-pathway session. Soft conflicts (medications with
   * the same clinical_role across pathways) are surfaced inside
   * `mergedPlan.conflicts` for the provider to resolve via `resolveConflict`.
   * Once all conflicts are resolved, `generateMergedCarePlan` materializes
   * the actual care plan rows.
   */
  startMultiPathwayResolution: MultiPathwayResolutionSession;
  startResolution: ResolutionSession;
  updateSignalDefinition: SignalDefinitionType;
};


export type MutationAbandonMultiPathwaySessionArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type MutationAbandonSessionArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type MutationActivatePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAddAdminEvidenceArgs = {
  input: AddAdminEvidenceInput;
};


export type MutationAddPatientContextArgs = {
  additionalContext: AdditionalContextInput;
  sessionId: Scalars['ID']['input'];
};


export type MutationAnswerPendingDecisionArgs = {
  answer: GateAnswerInput;
  nodeId: Scalars['ID']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationArchivePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateSignalDefinitionArgs = {
  input: CreateSignalDefinitionInput;
};


export type MutationDeletePreviewSessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type MutationDeleteSignalDefinitionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSimulatorScenarioArgs = {
  id: Scalars['ID']['input'];
};


export type MutationGenerateCarePlanFromResolutionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type MutationGenerateMergedCarePlanArgs = {
  sessionId: Scalars['ID']['input'];
};


export type MutationImportPathwayArgs = {
  importMode: ImportMode;
  pathwayJson: Scalars['String']['input'];
};


export type MutationManuallyResolveMedicationNormalizationArgs = {
  inputCode?: InputMaybe<Scalars['String']['input']>;
  inputSystem?: InputMaybe<Scalars['String']['input']>;
  inputText: Scalars['String']['input'];
  rxcui: Scalars['String']['input'];
};


export type MutationOverrideNodeArgs = {
  action: OverrideAction;
  nodeId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type MutationReMergeMultiPathwaySessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type MutationReactivatePathwayArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveAdminEvidenceArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveNodeWeightArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveResolutionThresholdsArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveSignalWeightArgs = {
  id: Scalars['ID']['input'];
};


export type MutationResolveConflictArgs = {
  choice: ConflictChoiceInput;
  conflictId: Scalars['String']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationSaveSimulatorScenarioArgs = {
  input: SaveSimulatorScenarioInput;
};


export type MutationSetNodeWeightArgs = {
  input: SetNodeWeightInput;
};


export type MutationSetResolutionThresholdsArgs = {
  input: SetResolutionThresholdsInput;
};


export type MutationSetSignalWeightArgs = {
  input: SetSignalWeightInput;
};


export type MutationStartMultiPathwayResolutionArgs = {
  encounterStart?: InputMaybe<Scalars['String']['input']>;
  evaluationAsOf?: InputMaybe<Scalars['String']['input']>;
  includeDraftPathways?: InputMaybe<Scalars['Boolean']['input']>;
  patientContext?: InputMaybe<PatientContextInput>;
  patientId: Scalars['ID']['input'];
  resolutionMode?: InputMaybe<ResolutionModeInput>;
  sessionId?: InputMaybe<Scalars['ID']['input']>;
  snapshotId?: InputMaybe<Scalars['ID']['input']>;
  syntheticPatient?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationStartResolutionArgs = {
  encounterStart?: InputMaybe<Scalars['String']['input']>;
  evaluationAsOf?: InputMaybe<Scalars['String']['input']>;
  pathwayId: Scalars['ID']['input'];
  patientContext?: InputMaybe<PatientContextInput>;
  patientId: Scalars['ID']['input'];
  resolutionMode?: InputMaybe<ResolutionModeInput>;
  sessionId?: InputMaybe<Scalars['ID']['input']>;
  snapshotId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateSignalDefinitionArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSignalDefinitionInput;
};

export type NodeConfidenceResult = {
  __typename?: 'NodeConfidenceResult';
  breakdown: Array<SignalBreakdown>;
  confidence: Scalars['Float']['output'];
  nodeIdentifier: Scalars['String']['output'];
  nodeType: Scalars['String']['output'];
  propagationInfluences: Array<PropagationInfluence>;
  resolutionType?: Maybe<ResolutionType>;
};

export enum NodeStatus {
  CascadeLimit = 'CASCADE_LIMIT',
  Excluded = 'EXCLUDED',
  GatedOut = 'GATED_OUT',
  Included = 'INCLUDED',
  PendingQuestion = 'PENDING_QUESTION',
  Timeout = 'TIMEOUT',
  Unknown = 'UNKNOWN'
}

export type NodeWeight = {
  __typename?: 'NodeWeight';
  defaultWeight: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier: Scalars['String']['output'];
  nodeType: Scalars['String']['output'];
  pathwayId: Scalars['ID']['output'];
  propagationOverrides?: Maybe<Scalars['JSON']['output']>;
  weightOverride?: Maybe<Scalars['Float']['output']>;
};

export enum OverrideAction {
  Exclude = 'EXCLUDE',
  Include = 'INCLUDE'
}

export type Pathway = {
  __typename?: 'Pathway';
  category: PathwayCategory;
  conditionCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  logicalId: Scalars['String']['output'];
  scope?: Maybe<Scalars['String']['output']>;
  status: PathwayStatus;
  targetPopulation?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  version: Scalars['String']['output'];
};

export enum PathwayCategory {
  AcuteCare = 'ACUTE_CARE',
  ChronicDisease = 'CHRONIC_DISEASE',
  Geriatric = 'GERIATRIC',
  LifestyleModification = 'LIFESTYLE_MODIFICATION',
  MedicationManagement = 'MEDICATION_MANAGEMENT',
  MentalHealth = 'MENTAL_HEALTH',
  Obstetric = 'OBSTETRIC',
  Pediatric = 'PEDIATRIC',
  PostProcedure = 'POST_PROCEDURE',
  PreventiveCare = 'PREVENTIVE_CARE'
}

export type PathwayConfidenceResult = {
  __typename?: 'PathwayConfidenceResult';
  nodes: Array<NodeConfidenceResult>;
  overallConfidence: Scalars['Float']['output'];
  pathwayId: Scalars['ID']['output'];
};

export type PathwayGraph = {
  __typename?: 'PathwayGraph';
  conditionCodeDetails: Array<ConditionCodeDetail>;
  edges: Array<PathwayGraphEdge>;
  nodes: Array<PathwayGraphNode>;
  pathway: Pathway;
};

export type PathwayGraphEdge = {
  __typename?: 'PathwayGraphEdge';
  from: Scalars['String']['output'];
  properties?: Maybe<Scalars['JSON']['output']>;
  to: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type PathwayGraphNode = {
  __typename?: 'PathwayGraphNode';
  id: Scalars['String']['output'];
  properties?: Maybe<Scalars['JSON']['output']>;
  type: Scalars['String']['output'];
};

export enum PathwayRelationshipType {
  /** Code sets are equal. */
  Identical = 'IDENTICAL',
  /** Code sets overlap but neither contains the other. */
  PartialOverlap = 'PARTIAL_OVERLAP',
  /** Candidate's code set is a strict subset of the input pathway's code set (candidate is more specific). */
  Subset = 'SUBSET',
  /** Candidate's code set is a strict superset of the input pathway's code set (candidate is broader). */
  Superset = 'SUPERSET'
}

export enum PathwayStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Draft = 'DRAFT',
  Superseded = 'SUPERSEDED'
}

export type PathwayStatusResult = {
  __typename?: 'PathwayStatusResult';
  pathway: Pathway;
  previousStatus: PathwayStatus;
};

export type PatientContextInput = {
  allergies?: InputMaybe<Array<CodeInput>>;
  conditionCodes?: InputMaybe<Array<CodeInput>>;
  freeformData?: InputMaybe<Scalars['JSON']['input']>;
  labResults?: InputMaybe<Array<LabResultInput>>;
  medications?: InputMaybe<Array<CodeInput>>;
  patientAttributes?: InputMaybe<Scalars['JSON']['input']>;
  patientId: Scalars['ID']['input'];
  vitalSigns?: InputMaybe<Scalars['JSON']['input']>;
};

export type PendingQuestionType = {
  __typename?: 'PendingQuestionType';
  affectedSubtreeSize: Scalars['Int']['output'];
  answerType: AnswerType;
  estimatedImpact: Scalars['String']['output'];
  gateId: Scalars['ID']['output'];
  options?: Maybe<Array<Scalars['String']['output']>>;
  prompt: Scalars['String']['output'];
  /** True when this question was surfaced by a low-confidence LLM gate. */
  tentative?: Maybe<Scalars['Boolean']['output']>;
  /** Branch the LLM picked (already routed); null for non-LLM gates. */
  tentativeBranch?: Maybe<Scalars['String']['output']>;
  /** Self-reported LLM confidence in [0, 1]; null for non-LLM gates. */
  tentativeConfidence?: Maybe<Scalars['Float']['output']>;
  /** LLM reasoning shown to the provider. */
  tentativeReasoning?: Maybe<Scalars['String']['output']>;
};

export type PropagationConfigInput = {
  decayFactor?: InputMaybe<Scalars['Float']['input']>;
  edgeTypes?: InputMaybe<Array<Scalars['String']['input']>>;
  immuneToSignals?: InputMaybe<Array<Scalars['String']['input']>>;
  maxHops?: InputMaybe<Scalars['Int']['input']>;
  mode: PropagationMode;
  sourceNodeTypes?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type PropagationConfigType = {
  __typename?: 'PropagationConfigType';
  decayFactor?: Maybe<Scalars['Float']['output']>;
  edgeTypes?: Maybe<Array<Scalars['String']['output']>>;
  immuneToSignals?: Maybe<Array<Scalars['String']['output']>>;
  maxHops?: Maybe<Scalars['Int']['output']>;
  mode: PropagationMode;
  sourceNodeTypes?: Maybe<Array<Scalars['String']['output']>>;
};

export type PropagationInfluence = {
  __typename?: 'PropagationInfluence';
  hopDistance: Scalars['Int']['output'];
  originalScore: Scalars['Float']['output'];
  propagatedScore: Scalars['Float']['output'];
  signalName: Scalars['String']['output'];
  sourceNodeIdentifier: Scalars['String']['output'];
};

export enum PropagationMode {
  Direct = 'DIRECT',
  None = 'NONE',
  TransitiveWithDecay = 'TRANSITIVE_WITH_DECAY'
}

export type ProviderOverrideType = {
  __typename?: 'ProviderOverrideType';
  action: OverrideAction;
  originalConfidence: Scalars['Float']['output'];
  originalStatus: NodeStatus;
  reason?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  adminEvidenceEntries: Array<AdminEvidenceEntry>;
  /** Authoring vocabulary for named attribute conditions (code-map + derived patient.* attributes). */
  attributeVocabulary: Array<AttributeVocabularyEntry>;
  effectiveThresholds: ResolvedThresholds;
  effectiveWeights: WeightMatrix;
  /**
   * Audit trail for llm_text_analysis Gate evaluations on a given session.
   * When `gateId` is provided, scopes to that gate. Most-recent first.
   */
  llmGateEvaluations: Array<LlmGateEvaluation>;
  /**
   * Return the constituent LOINC tests for a panel code (ordered as a clinician
   * would expect to enter them). Returns an empty list for non-panel codes or
   * panels whose constituents aren't yet seeded.
   */
  loincPanelConstituents: Array<LoincPanelConstituent>;
  matchedPathways: Array<MatchedPathway>;
  /** Fetch a single multi-pathway resolution session including its merged plan. */
  multiPathwayResolutionSession?: Maybe<MultiPathwayResolutionSession>;
  pathway?: Maybe<Pathway>;
  pathwayConfidence: PathwayConfidenceResult;
  pathwayGraph?: Maybe<PathwayGraph>;
  pathwayServiceHealth: Scalars['Boolean']['output'];
  pathways: Array<Pathway>;
  /**
   * List a patient's multi-pathway sessions, optionally filtered by status.
   * Preview sessions (created by admin/QA tooling with `syntheticPatient:
   * true`) are excluded by default. Pass `includePreview: true` to include
   * them — intended for admin surfaces only.
   */
  patientMultiPathwayResolutionSessions: Array<MultiPathwayResolutionSessionSummary>;
  patientResolutionSessions: Array<ResolutionSessionSummary>;
  pendingQuestions: Array<PendingQuestionType>;
  redFlags: Array<RedFlagType>;
  /**
   * Find pathways whose condition-code set overlaps with this pathway's set.
   * Used at upload time to surface related/conflicting/duplicate pathways for
   * admin review. Excludes the input pathway itself; ACTIVE pathways only.
   * Ordered by relationship strength: IDENTICAL > SUBSET > SUPERSET > PARTIAL_OVERLAP.
   */
  relatedPathways: Array<RelatedPathway>;
  resolutionSession?: Maybe<ResolutionSession>;
  searchCodes: Array<CodeDefinition>;
  signalDefinitions: Array<SignalDefinitionType>;
  /** Fetch a single saved simulator scenario by id. */
  simulatorScenario?: Maybe<SimulatorScenario>;
  /** All saved simulator scenarios, most-recently-updated first. */
  simulatorScenarios: Array<SimulatorScenario>;
  /**
   * Admin queue: medications whose RxNav normalization failed at import or
   * snapshot ingestion. Surfaced here for a clinician to manually resolve
   * via `manuallyResolveMedicationNormalization`.
   */
  unnormalizedMedications: Array<UnnormalizedMedication>;
};


export type QueryAdminEvidenceEntriesArgs = {
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  pathwayId: Scalars['ID']['input'];
};


export type QueryEffectiveThresholdsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
};


export type QueryEffectiveWeightsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
};


export type QueryLlmGateEvaluationsArgs = {
  gateId?: InputMaybe<Scalars['String']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type QueryLoincPanelConstituentsArgs = {
  panelCode: Scalars['String']['input'];
};


export type QueryMatchedPathwaysArgs = {
  patientId: Scalars['ID']['input'];
};


export type QueryMultiPathwayResolutionSessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryPathwayArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPathwayConfidenceArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
  pathwayId: Scalars['ID']['input'];
  patientContext: PatientContextInput;
};


export type QueryPathwayGraphArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPathwaysArgs = {
  category?: InputMaybe<PathwayCategory>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<PathwayStatus>;
};


export type QueryPatientMultiPathwayResolutionSessionsArgs = {
  includePreview?: InputMaybe<Scalars['Boolean']['input']>;
  patientId: Scalars['ID']['input'];
  status?: InputMaybe<MultiPathwayResolutionSessionStatus>;
};


export type QueryPatientResolutionSessionsArgs = {
  patientId: Scalars['ID']['input'];
  status?: InputMaybe<SessionStatus>;
};


export type QueryPendingQuestionsArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryRedFlagsArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QueryRelatedPathwaysArgs = {
  pathwayId: Scalars['ID']['input'];
};


export type QueryResolutionSessionArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QuerySearchCodesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  system?: InputMaybe<Scalars['String']['input']>;
};


export type QuerySignalDefinitionsArgs = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  scope?: InputMaybe<SignalScope>;
};


export type QuerySimulatorScenarioArgs = {
  id: Scalars['ID']['input'];
};

/**
 * Per-pathway gate-resolvability metrics for a specific patient. `autoResolvableScore`
 * is the headline value: (alwaysEvaluableGates + dataAvailableGates) / totalGates.
 * The remaining counts let the UI surface specifics like "needs N more lab values".
 * `gateExplanations` provides per-gate detail for explainability surfaces.
 */
export type ReachabilityScore = {
  __typename?: 'ReachabilityScore';
  alwaysEvaluableGates: Scalars['Int']['output'];
  autoResolvableScore?: Maybe<Scalars['Float']['output']>;
  dataAvailableGates: Scalars['Int']['output'];
  dataDependentGates: Scalars['Int']['output'];
  gateExplanations: Array<GateExplanation>;
  indeterminateGates: Scalars['Int']['output'];
  questionGates: Scalars['Int']['output'];
  totalGates: Scalars['Int']['output'];
};

export enum RecommendationState {
  AutoIncluded = 'AUTO_INCLUDED',
  PendingProviderChoice = 'PENDING_PROVIDER_CHOICE',
  ProviderConfirmed = 'PROVIDER_CONFIRMED',
  ProviderOverride = 'PROVIDER_OVERRIDE'
}

/** Record-validity a SYNTHETIC caller may assert. Orthogonal to clinical state. */
export enum RecordValidityInput {
  Invalid = 'INVALID',
  Unknown = 'UNKNOWN',
  Valid = 'VALID'
}

export type RedFlagBranchType = {
  __typename?: 'RedFlagBranchType';
  confidence: Scalars['Float']['output'];
  nodeId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  topExcludeReason?: Maybe<Scalars['String']['output']>;
};

export type RedFlagType = {
  __typename?: 'RedFlagType';
  branches?: Maybe<Array<RedFlagBranchType>>;
  description: Scalars['String']['output'];
  nodeId: Scalars['ID']['output'];
  nodeTitle: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

/**
 * A pathway whose condition-code set overlaps with another pathway's, with the
 * specific overlap classification and the actual code differences. Used to
 * surface related/conflicting/duplicate pathways at upload time.
 */
export type RelatedPathway = {
  __typename?: 'RelatedPathway';
  pathway: Pathway;
  relationshipType: PathwayRelationshipType;
  sharedCodes: Array<Scalars['String']['output']>;
  uniqueToCandidate: Array<Scalars['String']['output']>;
  uniqueToInput: Array<Scalars['String']['output']>;
};

export type ResolutionEventType = {
  __typename?: 'ResolutionEventType';
  createdAt: Scalars['String']['output'];
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  nodesRecomputed: Scalars['Int']['output'];
  statusChanges?: Maybe<Scalars['JSON']['output']>;
  triggerData?: Maybe<Scalars['JSON']['output']>;
};

/**
 * Which trust mode a resolution runs under. The payload differs per mode:
 * SYNTHETIC carries `patientContext`, LIVE carries `snapshotId`, REPLAY carries
 * `sessionId`. Supplying the wrong one for the mode is rejected.
 */
export enum ResolutionModeInput {
  Live = 'LIVE',
  Replay = 'REPLAY',
  Synthetic = 'SYNTHETIC'
}

export type ResolutionSession = {
  __typename?: 'ResolutionSession';
  createdAt: Scalars['String']['output'];
  /** Phase 4: DDI MODERATE-severity findings. Suppressions (CONTRAINDICATED/SEVERE) appear in excludedNodes with a DDI excludeReason. */
  ddiWarnings: Array<DdiWarning>;
  excludedNodes: Array<ResolvedNode>;
  gatedOutNodes: Array<ResolvedNode>;
  id: Scalars['ID']['output'];
  includedNodes: Array<ResolvedNode>;
  pathwayId: Scalars['ID']['output'];
  pathwayVersion: Scalars['String']['output'];
  patientId: Scalars['ID']['output'];
  pendingQuestions: Array<PendingQuestionType>;
  providerId: Scalars['ID']['output'];
  redFlags: Array<RedFlagType>;
  resolutionEvents: Array<ResolutionEventType>;
  status: SessionStatus;
  totalNodesEvaluated: Scalars['Int']['output'];
  traversalDurationMs: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type ResolutionSessionSummary = {
  __typename?: 'ResolutionSessionSummary';
  carePlanId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  includedCount: Scalars['Int']['output'];
  pathwayId: Scalars['ID']['output'];
  pathwayTitle: Scalars['String']['output'];
  redFlagCount: Scalars['Int']['output'];
  status: SessionStatus;
  totalNodesEvaluated: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type ResolutionThresholds = {
  __typename?: 'ResolutionThresholds';
  autoResolveThreshold: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier?: Maybe<Scalars['String']['output']>;
  pathwayId?: Maybe<Scalars['ID']['output']>;
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['output'];
};

export enum ResolutionType {
  AutoResolved = 'AUTO_RESOLVED',
  ForcedManual = 'FORCED_MANUAL',
  ProviderDecided = 'PROVIDER_DECIDED',
  SystemSuggested = 'SYSTEM_SUGGESTED'
}

/** Patient instruction / counseling content. */
export type ResolvedGuidance = {
  __typename?: 'ResolvedGuidance';
  /** Optional category (counseling, lifestyle, medication_adherence, self_monitoring, other). */
  category?: Maybe<Scalars['String']['output']>;
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  /** Longer narrative — the actual instruction the provider gives the patient. */
  instructions: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
  /** Short title for the care-plan section. */
  topic: Scalars['String']['output'];
};

/** Imaging order — e.g. "MRI head without contrast". */
export type ResolvedImaging = {
  __typename?: 'ResolvedImaging';
  bodyRegion?: Maybe<Scalars['String']['output']>;
  code?: Maybe<Scalars['String']['output']>;
  contrast?: Maybe<Scalars['Boolean']['output']>;
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  /** Modality (X-ray, CT, MRI, Ultrasound, etc.). */
  modality: Scalars['String']['output'];
  name: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
  system?: Maybe<Scalars['String']['output']>;
};

export type ResolvedLab = {
  __typename?: 'ResolvedLab';
  code?: Maybe<Scalars['String']['output']>;
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
  specimen?: Maybe<Scalars['String']['output']>;
  system?: Maybe<Scalars['String']['output']>;
};

export type ResolvedMedication = {
  __typename?: 'ResolvedMedication';
  /**
   * Optional author tag identifying the clinical lane this drug occupies,
   * e.g. "first_line_beta_blocker_for_chf". Two pathways tagging different
   * drugs with the same role surface as a soft conflict.
   */
  clinicalRole?: Maybe<Scalars['String']['output']>;
  dose?: Maybe<Scalars['String']['output']>;
  duration?: Maybe<Scalars['String']['output']>;
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  frequency?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  role: Scalars['String']['output'];
  route?: Maybe<Scalars['String']['output']>;
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
};

export type ResolvedNode = {
  __typename?: 'ResolvedNode';
  confidence: Scalars['Float']['output'];
  confidenceBreakdown: Array<SignalBreakdown>;
  depth: Scalars['Int']['output'];
  excludeReason?: Maybe<Scalars['String']['output']>;
  nodeId: Scalars['ID']['output'];
  nodeType: Scalars['String']['output'];
  parentNodeId?: Maybe<Scalars['ID']['output']>;
  providerOverride?: Maybe<ProviderOverrideType>;
  status: NodeStatus;
  title: Scalars['String']['output'];
};

export type ResolvedProcedure = {
  __typename?: 'ResolvedProcedure';
  code?: Maybe<Scalars['String']['output']>;
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
  system?: Maybe<Scalars['String']['output']>;
};

export type ResolvedQualityMetric = {
  __typename?: 'ResolvedQualityMetric';
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  measure: Scalars['String']['output'];
  name: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
};

export type ResolvedSchedule = {
  __typename?: 'ResolvedSchedule';
  description: Scalars['String']['output'];
  /**
   * Gate / decision-point node ids that gated the path to this
   * recommendation. Cross-reference with MergedCarePlan.evidenceTrail
   * to render "this fired because of A, B, C" chips per rec.
   */
  evidenceGateIds: Array<Scalars['String']['output']>;
  interval: Scalars['String']['output'];
  sourceNodeId?: Maybe<Scalars['String']['output']>;
  sourcePathwayId: Scalars['ID']['output'];
};

export type ResolvedThresholds = {
  __typename?: 'ResolvedThresholds';
  autoResolveThreshold: Scalars['Float']['output'];
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['output'];
};

export type SaveSimulatorScenarioInput = {
  allergies?: InputMaybe<Array<CodeInput>>;
  conditionCodes?: InputMaybe<Array<CodeInput>>;
  description?: InputMaybe<Scalars['String']['input']>;
  /** When provided, updates the existing scenario; otherwise creates a new one. */
  id?: InputMaybe<Scalars['ID']['input']>;
  includeDraftPathways?: InputMaybe<Scalars['Boolean']['input']>;
  labResults?: InputMaybe<Array<LabResultInput>>;
  medications?: InputMaybe<Array<CodeInput>>;
  name: Scalars['String']['input'];
  /** Narrative snapshot — same shape as the FE's NarrativeSnapshot, stored as JSON. */
  narrative?: InputMaybe<Scalars['JSON']['input']>;
  /** Vitals snapshot — same shape as the FE's VitalsSnapshot, stored as JSON. */
  vitals?: InputMaybe<Scalars['JSON']['input']>;
};

export enum ScoringType {
  CriteriaMatch = 'CRITERIA_MATCH',
  CustomRules = 'CUSTOM_RULES',
  DataPresence = 'DATA_PRESENCE',
  MappingLookup = 'MAPPING_LOOKUP',
  RiskInverse = 'RISK_INVERSE'
}

export enum SessionStatus {
  Abandoned = 'ABANDONED',
  Active = 'ACTIVE',
  Completed = 'COMPLETED',
  Degraded = 'DEGRADED'
}

export type SetNodeWeightInput = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier: Scalars['String']['input'];
  nodeType: Scalars['String']['input'];
  pathwayId: Scalars['ID']['input'];
  propagationOverrides?: InputMaybe<Scalars['JSON']['input']>;
  weightOverride?: InputMaybe<Scalars['Float']['input']>;
};

export type SetResolutionThresholdsInput = {
  autoResolveThreshold: Scalars['Float']['input'];
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  pathwayId?: InputMaybe<Scalars['ID']['input']>;
  scope: ThresholdScope;
  suggestThreshold: Scalars['Float']['input'];
};

export type SetSignalWeightInput = {
  institutionId?: InputMaybe<Scalars['ID']['input']>;
  nodeIdentifier?: InputMaybe<Scalars['String']['input']>;
  nodeType?: InputMaybe<Scalars['String']['input']>;
  pathwayId?: InputMaybe<Scalars['ID']['input']>;
  scope: WeightScope;
  signalDefinitionId: Scalars['ID']['input'];
  weight: Scalars['Float']['input'];
};

export type SignalBreakdown = {
  __typename?: 'SignalBreakdown';
  missingInputs: Array<Scalars['String']['output']>;
  score: Scalars['Float']['output'];
  signalName: Scalars['String']['output'];
  /**
   * True when this signal was excluded from the weighted-average confidence
   * computation because its score was genuinely unknown (e.g. risk magnitude
   * with no `risk_value` declared on the node). The score field still carries
   * whatever the scorer last computed, but it did not contribute to the
   * overall confidence. UI should render the dimension as "Unknown" / neutral
   * rather than treating the score as a depressing factor.
   */
  skipped: Scalars['Boolean']['output'];
  weight: Scalars['Float']['output'];
  weightSource: WeightSource;
};

export type SignalDefinitionType = {
  __typename?: 'SignalDefinitionType';
  defaultWeight: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  propagationConfig?: Maybe<PropagationConfigType>;
  scope: SignalScope;
  scoringRules: Scalars['JSON']['output'];
  scoringType: ScoringType;
};

export enum SignalScope {
  Institution = 'INSTITUTION',
  Organization = 'ORGANIZATION',
  System = 'SYSTEM'
}

export type SignalWeight = {
  __typename?: 'SignalWeight';
  id: Scalars['ID']['output'];
  institutionId?: Maybe<Scalars['ID']['output']>;
  nodeIdentifier?: Maybe<Scalars['String']['output']>;
  nodeType?: Maybe<Scalars['String']['output']>;
  pathwayId?: Maybe<Scalars['ID']['output']>;
  scope: WeightScope;
  signalDefinitionId: Scalars['ID']['output'];
  weight: Scalars['Float']['output'];
};

/**
 * A named synthetic-patient scenario saved by the admin simulator for
 * regression-testing pathway authoring changes. Re-runnable end-to-end:
 * the FE loads the scenario, repopulates the patient composer, and submits
 * the same resolution it always would.
 */
export type SimulatorScenario = {
  __typename?: 'SimulatorScenario';
  allergies: Array<SimulatorScenarioCode>;
  conditionCodes: Array<SimulatorScenarioCode>;
  createdAt: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  includeDraftPathways: Scalars['Boolean']['output'];
  labResults: Array<SimulatorScenarioLabResult>;
  medications: Array<SimulatorScenarioCode>;
  name: Scalars['String']['output'];
  /**
   * Unstructured narrative bag — chief_complaint, HPI, social_history, plus
   * an ad-hoc map for custom keys. Consumed by `llm_text_analysis` Gate nodes
   * via dotted paths like `freeformData.narrative.chief_complaint`.
   */
  narrative: Scalars['JSON']['output'];
  updatedAt: Scalars['String']['output'];
  /**
   * Structured uncoded numeric data — BP, HR, SpO2, temp, weight, height,
   * computed BMI, plus a `custom` map for ad-hoc entries. Shape mirrors the
   * FE's VitalsSnapshot interface; pathway authors target paths like
   * `vitals.systolic_bp` via Gate nodes with gate_type=patient_attribute.
   */
  vitals: Scalars['JSON']['output'];
};

/** Output mirror of `CodeInput` — output types cannot use input types as fields. */
export type SimulatorScenarioCode = {
  __typename?: 'SimulatorScenarioCode';
  clinicalState?: Maybe<ClinicalStateInput>;
  code: Scalars['String']['output'];
  date?: Maybe<Scalars['String']['output']>;
  display?: Maybe<Scalars['String']['output']>;
  endDate?: Maybe<Scalars['String']['output']>;
  recordValidity?: Maybe<RecordValidityInput>;
  sourceId?: Maybe<Scalars['String']['output']>;
  system: Scalars['String']['output'];
};

/** Output mirror of `LabResultInput`. Observations carry no clinical state. */
export type SimulatorScenarioLabResult = {
  __typename?: 'SimulatorScenarioLabResult';
  code: Scalars['String']['output'];
  date?: Maybe<Scalars['String']['output']>;
  display?: Maybe<Scalars['String']['output']>;
  recordValidity?: Maybe<RecordValidityInput>;
  sourceId?: Maybe<Scalars['String']['output']>;
  system: Scalars['String']['output'];
  unit?: Maybe<Scalars['String']['output']>;
  value?: Maybe<Scalars['Float']['output']>;
};

/**
 * Suppressed recommendation. Source can be a pathway (Phase 3
 * contraindicated/avoid), a patient med (Phase 4 drug↔drug), an allergy
 * (Phase 4 drug↔allergy), or another recommendation in the merge (Phase 4
 * cross-recommendation). Exactly one source-specific field-set is populated
 * per row depending on the SuppressionReason.
 */
export type SuppressedRecommendation = {
  __typename?: 'SuppressedRecommendation';
  name: Scalars['String']['output'];
  reason: SuppressionReason;
  /** Set when reason=ALLERGY. */
  suppressedByAllergyCode?: Maybe<Scalars['String']['output']>;
  /** Set when reason=ALLERGY. */
  suppressedByAllergyDisplay?: Maybe<Scalars['String']['output']>;
  /** Set when reason=CONTRAINDICATED or AVOID. */
  suppressedByPathwayId?: Maybe<Scalars['ID']['output']>;
  /** Set when reason=CONTRAINDICATED or AVOID. */
  suppressedByPathwayTitle?: Maybe<Scalars['String']['output']>;
  /** Set when reason=DDI_CONTRAINDICATED or DDI_SEVERE (drug↔drug source). */
  suppressedByPatientMedName?: Maybe<Scalars['String']['output']>;
  /** Set when reason=DDI_CONTRAINDICATED or DDI_SEVERE (drug↔drug source). */
  suppressedByPatientMedRxcui?: Maybe<Scalars['String']['output']>;
  type: SuppressedRecommendationType;
};

export enum SuppressedRecommendationType {
  Guidance = 'GUIDANCE',
  Imaging = 'IMAGING',
  Lab = 'LAB',
  Medication = 'MEDICATION',
  Procedure = 'PROCEDURE',
  QualityMetric = 'QUALITY_METRIC',
  Schedule = 'SCHEDULE'
}

export enum SuppressionReason {
  /** Phase 4: drug recommendation matches a patient allergy class. */
  Allergy = 'ALLERGY',
  Avoid = 'AVOID',
  Contraindicated = 'CONTRAINDICATED',
  /** Phase 4: drug↔drug interaction at CONTRAINDICATED severity. */
  DdiContraindicated = 'DDI_CONTRAINDICATED',
  /** Phase 4: drug↔drug interaction at SEVERE severity. */
  DdiSevere = 'DDI_SEVERE'
}

export enum ThresholdScope {
  Institution = 'INSTITUTION',
  Node = 'NODE',
  Organization = 'ORGANIZATION',
  Pathway = 'PATHWAY',
  SystemDefault = 'SYSTEM_DEFAULT'
}

export type UnlockedRecommendation = {
  __typename?: 'UnlockedRecommendation';
  nodeId: Scalars['ID']['output'];
  nodeType: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type UnnormalizedMedication = {
  __typename?: 'UnnormalizedMedication';
  attemptedAt: Scalars['String']['output'];
  inputCode?: Maybe<Scalars['String']['output']>;
  inputSystem?: Maybe<Scalars['String']['output']>;
  inputText: Scalars['String']['output'];
};

export type UpdateSignalDefinitionInput = {
  defaultWeight?: InputMaybe<Scalars['Float']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  propagationConfig?: InputMaybe<PropagationConfigInput>;
  scoringRules?: InputMaybe<Scalars['JSON']['input']>;
};

export type ValidationBlockerType = {
  __typename?: 'ValidationBlockerType';
  description: Scalars['String']['output'];
  relatedNodeIds: Array<Scalars['ID']['output']>;
  type: BlockerType;
};

export type ValidationResult = {
  __typename?: 'ValidationResult';
  errors: Array<Scalars['String']['output']>;
  valid: Scalars['Boolean']['output'];
  warnings: Array<Scalars['String']['output']>;
};

export type WeightMatrix = {
  __typename?: 'WeightMatrix';
  entries: Array<WeightMatrixEntry>;
};

export type WeightMatrixEntry = {
  __typename?: 'WeightMatrixEntry';
  nodeIdentifier: Scalars['String']['output'];
  signalName: Scalars['String']['output'];
  source: WeightSource;
  weight: Scalars['Float']['output'];
};

export enum WeightScope {
  InstitutionGlobal = 'INSTITUTION_GLOBAL',
  Node = 'NODE',
  OrganizationGlobal = 'ORGANIZATION_GLOBAL',
  Pathway = 'PATHWAY'
}

export enum WeightSource {
  InstitutionGlobal = 'INSTITUTION_GLOBAL',
  NodeOverride = 'NODE_OVERRIDE',
  OrganizationGlobal = 'ORGANIZATION_GLOBAL',
  PathwayOverride = 'PATHWAY_OVERRIDE',
  SystemDefault = 'SYSTEM_DEFAULT'
}

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ReferenceResolver<TResult, TReference, TContext> = (
      reference: TReference,
      context: TContext,
      info: GraphQLResolveInfo
    ) => Promise<TResult> | TResult;

      type ScalarCheck<T, S> = S extends true ? T : NullableCheck<T, S>;
      type NullableCheck<T, S> = Maybe<T> extends T ? Maybe<ListCheck<NonNullable<T>, S>> : ListCheck<T, S>;
      type ListCheck<T, S> = T extends (infer U)[] ? NullableCheck<U, S>[] : GraphQLRecursivePick<T, S>;
      export type GraphQLRecursivePick<T, S> = { [K in keyof T & keyof S]: ScalarCheck<T[K], S[K]> };
    

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  AddAdminEvidenceInput: AddAdminEvidenceInput;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  AdditionalContextInput: AdditionalContextInput;
  AdminEvidenceEntry: ResolverTypeWrapper<AdminEvidenceEntry>;
  AnswerType: AnswerType;
  ArchiveResult: ResolverTypeWrapper<ArchiveResult>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  AttributeVocabularyEntry: ResolverTypeWrapper<AttributeVocabularyEntry>;
  BlockerType: BlockerType;
  CarePlanGenerationResult: ResolverTypeWrapper<CarePlanGenerationResult>;
  CatchUpItem: ResolverTypeWrapper<CatchUpItem>;
  ClinicalStateInput: ClinicalStateInput;
  CodeDefinition: ResolverTypeWrapper<CodeDefinition>;
  CodeInput: CodeInput;
  ConditionCodeDetail: ResolverTypeWrapper<ConditionCodeDetail>;
  ConflictCandidate: ResolverTypeWrapper<ConflictCandidate>;
  ConflictChoiceInput: ConflictChoiceInput;
  ConflictResolution: ResolverTypeWrapper<ConflictResolution>;
  ConflictResolutionKind: ConflictResolutionKind;
  ConflictType: ConflictType;
  CreateSignalDefinitionInput: CreateSignalDefinitionInput;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  CustomMedicationOverride: ResolverTypeWrapper<CustomMedicationOverride>;
  CustomMedicationOverrideInput: CustomMedicationOverrideInput;
  DDIFindingCategory: DdiFindingCategory;
  DDIFindingSource: ResolverTypeWrapper<DdiFindingSource>;
  DDIWarning: ResolverTypeWrapper<DdiWarning>;
  DataGapHint: ResolverTypeWrapper<DataGapHint>;
  DeletePreviewSessionResult: ResolverTypeWrapper<DeletePreviewSessionResult>;
  DiffDetail: ResolverTypeWrapper<DiffDetail>;
  GateAnswerInput: GateAnswerInput;
  GateClassification: GateClassification;
  GateEvidence: ResolverTypeWrapper<GateEvidence>;
  GateExplanation: ResolverTypeWrapper<GateExplanation>;
  ImportDiff: ResolverTypeWrapper<ImportDiff>;
  ImportDiffSummary: ResolverTypeWrapper<ImportDiffSummary>;
  ImportMode: ImportMode;
  ImportPathwayResult: ResolverTypeWrapper<ImportPathwayResult>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  LabKind: LabKind;
  LabResultInput: LabResultInput;
  LlmGateEvaluation: ResolverTypeWrapper<LlmGateEvaluation>;
  LoincPanelConstituent: ResolverTypeWrapper<LoincPanelConstituent>;
  ManuallyResolvedMedication: ResolverTypeWrapper<ManuallyResolvedMedication>;
  MatchedCodeSet: ResolverTypeWrapper<MatchedCodeSet>;
  MatchedCodeSetMember: ResolverTypeWrapper<MatchedCodeSetMember>;
  MatchedPathway: ResolverTypeWrapper<MatchedPathway>;
  MergedCarePlan: ResolverTypeWrapper<MergedCarePlan>;
  MergedConflict: ResolverTypeWrapper<MergedConflict>;
  MergedGuidanceRecommendation: ResolverTypeWrapper<MergedGuidanceRecommendation>;
  MergedImagingRecommendation: ResolverTypeWrapper<MergedImagingRecommendation>;
  MergedLabRecommendation: ResolverTypeWrapper<MergedLabRecommendation>;
  MergedMedicationRecommendation: ResolverTypeWrapper<MergedMedicationRecommendation>;
  MergedProcedureRecommendation: ResolverTypeWrapper<MergedProcedureRecommendation>;
  MergedQualityMetricRecommendation: ResolverTypeWrapper<MergedQualityMetricRecommendation>;
  MergedScheduleRecommendation: ResolverTypeWrapper<MergedScheduleRecommendation>;
  MissingData: ResolverTypeWrapper<MissingData>;
  MultiPathwayPendingGate: ResolverTypeWrapper<MultiPathwayPendingGate>;
  MultiPathwayResolutionSession: ResolverTypeWrapper<MultiPathwayResolutionSession>;
  MultiPathwayResolutionSessionStatus: MultiPathwayResolutionSessionStatus;
  MultiPathwayResolutionSessionSummary: ResolverTypeWrapper<MultiPathwayResolutionSessionSummary>;
  Mutation: ResolverTypeWrapper<{}>;
  NodeConfidenceResult: ResolverTypeWrapper<NodeConfidenceResult>;
  NodeStatus: NodeStatus;
  NodeWeight: ResolverTypeWrapper<NodeWeight>;
  OverrideAction: OverrideAction;
  Pathway: ResolverTypeWrapper<Pathway>;
  PathwayCategory: PathwayCategory;
  PathwayConfidenceResult: ResolverTypeWrapper<PathwayConfidenceResult>;
  PathwayGraph: ResolverTypeWrapper<PathwayGraph>;
  PathwayGraphEdge: ResolverTypeWrapper<PathwayGraphEdge>;
  PathwayGraphNode: ResolverTypeWrapper<PathwayGraphNode>;
  PathwayRelationshipType: PathwayRelationshipType;
  PathwayStatus: PathwayStatus;
  PathwayStatusResult: ResolverTypeWrapper<PathwayStatusResult>;
  PatientContextInput: PatientContextInput;
  PendingQuestionType: ResolverTypeWrapper<PendingQuestionType>;
  PropagationConfigInput: PropagationConfigInput;
  PropagationConfigType: ResolverTypeWrapper<PropagationConfigType>;
  PropagationInfluence: ResolverTypeWrapper<PropagationInfluence>;
  PropagationMode: PropagationMode;
  ProviderOverrideType: ResolverTypeWrapper<ProviderOverrideType>;
  Query: ResolverTypeWrapper<{}>;
  ReachabilityScore: ResolverTypeWrapper<ReachabilityScore>;
  RecommendationState: RecommendationState;
  RecordValidityInput: RecordValidityInput;
  RedFlagBranchType: ResolverTypeWrapper<RedFlagBranchType>;
  RedFlagType: ResolverTypeWrapper<RedFlagType>;
  RelatedPathway: ResolverTypeWrapper<RelatedPathway>;
  ResolutionEventType: ResolverTypeWrapper<ResolutionEventType>;
  ResolutionModeInput: ResolutionModeInput;
  ResolutionSession: ResolverTypeWrapper<ResolutionSession>;
  ResolutionSessionSummary: ResolverTypeWrapper<ResolutionSessionSummary>;
  ResolutionThresholds: ResolverTypeWrapper<ResolutionThresholds>;
  ResolutionType: ResolutionType;
  ResolvedGuidance: ResolverTypeWrapper<ResolvedGuidance>;
  ResolvedImaging: ResolverTypeWrapper<ResolvedImaging>;
  ResolvedLab: ResolverTypeWrapper<ResolvedLab>;
  ResolvedMedication: ResolverTypeWrapper<ResolvedMedication>;
  ResolvedNode: ResolverTypeWrapper<ResolvedNode>;
  ResolvedProcedure: ResolverTypeWrapper<ResolvedProcedure>;
  ResolvedQualityMetric: ResolverTypeWrapper<ResolvedQualityMetric>;
  ResolvedSchedule: ResolverTypeWrapper<ResolvedSchedule>;
  ResolvedThresholds: ResolverTypeWrapper<ResolvedThresholds>;
  SaveSimulatorScenarioInput: SaveSimulatorScenarioInput;
  ScoringType: ScoringType;
  SessionStatus: SessionStatus;
  SetNodeWeightInput: SetNodeWeightInput;
  SetResolutionThresholdsInput: SetResolutionThresholdsInput;
  SetSignalWeightInput: SetSignalWeightInput;
  SignalBreakdown: ResolverTypeWrapper<SignalBreakdown>;
  SignalDefinitionType: ResolverTypeWrapper<SignalDefinitionType>;
  SignalScope: SignalScope;
  SignalWeight: ResolverTypeWrapper<SignalWeight>;
  SimulatorScenario: ResolverTypeWrapper<SimulatorScenario>;
  SimulatorScenarioCode: ResolverTypeWrapper<SimulatorScenarioCode>;
  SimulatorScenarioLabResult: ResolverTypeWrapper<SimulatorScenarioLabResult>;
  SuppressedRecommendation: ResolverTypeWrapper<SuppressedRecommendation>;
  SuppressedRecommendationType: SuppressedRecommendationType;
  SuppressionReason: SuppressionReason;
  ThresholdScope: ThresholdScope;
  UnlockedRecommendation: ResolverTypeWrapper<UnlockedRecommendation>;
  UnnormalizedMedication: ResolverTypeWrapper<UnnormalizedMedication>;
  UpdateSignalDefinitionInput: UpdateSignalDefinitionInput;
  ValidationBlockerType: ResolverTypeWrapper<ValidationBlockerType>;
  ValidationResult: ResolverTypeWrapper<ValidationResult>;
  WeightMatrix: ResolverTypeWrapper<WeightMatrix>;
  WeightMatrixEntry: ResolverTypeWrapper<WeightMatrixEntry>;
  WeightScope: WeightScope;
  WeightSource: WeightSource;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AddAdminEvidenceInput: AddAdminEvidenceInput;
  String: Scalars['String']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  AdditionalContextInput: AdditionalContextInput;
  AdminEvidenceEntry: AdminEvidenceEntry;
  ArchiveResult: ArchiveResult;
  Boolean: Scalars['Boolean']['output'];
  AttributeVocabularyEntry: AttributeVocabularyEntry;
  CarePlanGenerationResult: CarePlanGenerationResult;
  CatchUpItem: CatchUpItem;
  CodeDefinition: CodeDefinition;
  CodeInput: CodeInput;
  ConditionCodeDetail: ConditionCodeDetail;
  ConflictCandidate: ConflictCandidate;
  ConflictChoiceInput: ConflictChoiceInput;
  ConflictResolution: ConflictResolution;
  CreateSignalDefinitionInput: CreateSignalDefinitionInput;
  Float: Scalars['Float']['output'];
  CustomMedicationOverride: CustomMedicationOverride;
  CustomMedicationOverrideInput: CustomMedicationOverrideInput;
  DDIFindingSource: DdiFindingSource;
  DDIWarning: DdiWarning;
  DataGapHint: DataGapHint;
  DeletePreviewSessionResult: DeletePreviewSessionResult;
  DiffDetail: DiffDetail;
  GateAnswerInput: GateAnswerInput;
  GateEvidence: GateEvidence;
  GateExplanation: GateExplanation;
  ImportDiff: ImportDiff;
  ImportDiffSummary: ImportDiffSummary;
  ImportPathwayResult: ImportPathwayResult;
  JSON: Scalars['JSON']['output'];
  LabResultInput: LabResultInput;
  LlmGateEvaluation: LlmGateEvaluation;
  LoincPanelConstituent: LoincPanelConstituent;
  ManuallyResolvedMedication: ManuallyResolvedMedication;
  MatchedCodeSet: MatchedCodeSet;
  MatchedCodeSetMember: MatchedCodeSetMember;
  MatchedPathway: MatchedPathway;
  MergedCarePlan: MergedCarePlan;
  MergedConflict: MergedConflict;
  MergedGuidanceRecommendation: MergedGuidanceRecommendation;
  MergedImagingRecommendation: MergedImagingRecommendation;
  MergedLabRecommendation: MergedLabRecommendation;
  MergedMedicationRecommendation: MergedMedicationRecommendation;
  MergedProcedureRecommendation: MergedProcedureRecommendation;
  MergedQualityMetricRecommendation: MergedQualityMetricRecommendation;
  MergedScheduleRecommendation: MergedScheduleRecommendation;
  MissingData: MissingData;
  MultiPathwayPendingGate: MultiPathwayPendingGate;
  MultiPathwayResolutionSession: MultiPathwayResolutionSession;
  MultiPathwayResolutionSessionSummary: MultiPathwayResolutionSessionSummary;
  Mutation: {};
  NodeConfidenceResult: NodeConfidenceResult;
  NodeWeight: NodeWeight;
  Pathway: Pathway;
  PathwayConfidenceResult: PathwayConfidenceResult;
  PathwayGraph: PathwayGraph;
  PathwayGraphEdge: PathwayGraphEdge;
  PathwayGraphNode: PathwayGraphNode;
  PathwayStatusResult: PathwayStatusResult;
  PatientContextInput: PatientContextInput;
  PendingQuestionType: PendingQuestionType;
  PropagationConfigInput: PropagationConfigInput;
  PropagationConfigType: PropagationConfigType;
  PropagationInfluence: PropagationInfluence;
  ProviderOverrideType: ProviderOverrideType;
  Query: {};
  ReachabilityScore: ReachabilityScore;
  RedFlagBranchType: RedFlagBranchType;
  RedFlagType: RedFlagType;
  RelatedPathway: RelatedPathway;
  ResolutionEventType: ResolutionEventType;
  ResolutionSession: ResolutionSession;
  ResolutionSessionSummary: ResolutionSessionSummary;
  ResolutionThresholds: ResolutionThresholds;
  ResolvedGuidance: ResolvedGuidance;
  ResolvedImaging: ResolvedImaging;
  ResolvedLab: ResolvedLab;
  ResolvedMedication: ResolvedMedication;
  ResolvedNode: ResolvedNode;
  ResolvedProcedure: ResolvedProcedure;
  ResolvedQualityMetric: ResolvedQualityMetric;
  ResolvedSchedule: ResolvedSchedule;
  ResolvedThresholds: ResolvedThresholds;
  SaveSimulatorScenarioInput: SaveSimulatorScenarioInput;
  SetNodeWeightInput: SetNodeWeightInput;
  SetResolutionThresholdsInput: SetResolutionThresholdsInput;
  SetSignalWeightInput: SetSignalWeightInput;
  SignalBreakdown: SignalBreakdown;
  SignalDefinitionType: SignalDefinitionType;
  SignalWeight: SignalWeight;
  SimulatorScenario: SimulatorScenario;
  SimulatorScenarioCode: SimulatorScenarioCode;
  SimulatorScenarioLabResult: SimulatorScenarioLabResult;
  SuppressedRecommendation: SuppressedRecommendation;
  UnlockedRecommendation: UnlockedRecommendation;
  UnnormalizedMedication: UnnormalizedMedication;
  UpdateSignalDefinitionInput: UpdateSignalDefinitionInput;
  ValidationBlockerType: ValidationBlockerType;
  ValidationResult: ValidationResult;
  WeightMatrix: WeightMatrix;
  WeightMatrixEntry: WeightMatrixEntry;
}>;

export type AdminEvidenceEntryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AdminEvidenceEntry'] = ResolversParentTypes['AdminEvidenceEntry']> = ResolversObject<{
  applicableCriteria?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdBy?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceLevel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  populationDescription?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  source?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  url?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  year?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ArchiveResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ArchiveResult'] = ResolversParentTypes['ArchiveResult']> = ResolversObject<{
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AttributeVocabularyEntryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['AttributeVocabularyEntry'] = ResolversParentTypes['AttributeVocabularyEntry']> = ResolversObject<{
  attribute?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  display?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  namespace?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  unit?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  valueType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CarePlanGenerationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CarePlanGenerationResult'] = ResolversParentTypes['CarePlanGenerationResult']> = ResolversObject<{
  blockers?: Resolver<Array<ResolversTypes['ValidationBlockerType']>, ParentType, ContextType>;
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnings?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CatchUpItemResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CatchUpItem'] = ResolversParentTypes['CatchUpItem']> = ResolversObject<{
  dependentNodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CodeDefinitionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CodeDefinition'] = ResolversParentTypes['CodeDefinition']> = ResolversObject<{
  category?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isCommon?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  labKind?: Resolver<Maybe<ResolversTypes['LabKind']>, ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ConditionCodeDetailResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ConditionCodeDetail'] = ResolversParentTypes['ConditionCodeDetail']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  grouping?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  usage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ConflictCandidateResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ConflictCandidate'] = ResolversParentTypes['ConflictCandidate']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedMedication'], ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  sourcePathwayTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ConflictResolutionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ConflictResolution'] = ResolversParentTypes['ConflictResolution']> = ResolversObject<{
  chosenPathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  customMedication?: Resolver<Maybe<ResolversTypes['CustomMedicationOverride']>, ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['ConflictResolutionKind'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  resolvedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  resolvedBy?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type CustomMedicationOverrideResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['CustomMedicationOverride'] = ResolversParentTypes['CustomMedicationOverride']> = ResolversObject<{
  dose?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  duration?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  frequency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  note?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  route?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DdiFindingSourceResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DDIFindingSource'] = ResolversParentTypes['DDIFindingSource']> = ResolversObject<{
  kind?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  recommendationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  rxcui?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  snomedCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  snomedDisplay?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DdiWarningResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DDIWarning'] = ResolversParentTypes['DDIWarning']> = ResolversObject<{
  category?: Resolver<ResolversTypes['DDIFindingCategory'], ParentType, ContextType>;
  clinicalAdvice?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  drugName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  mechanism?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  recommendationId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  severity?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['DDIFindingSource'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DataGapHintResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DataGapHint'] = ResolversParentTypes['DataGapHint']> = ResolversObject<{
  dataUnavailable?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  fieldsRead?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  gateNodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  gateTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  indeterminate?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  uncertaintyReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  unlockedRecommendations?: Resolver<Array<ResolversTypes['UnlockedRecommendation']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DeletePreviewSessionResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DeletePreviewSessionResult'] = ResolversParentTypes['DeletePreviewSessionResult']> = ResolversObject<{
  contributingSessionsDeleted?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sessionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type DiffDetailResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['DiffDetail'] = ResolversParentTypes['DiffDetail']> = ResolversObject<{
  action?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityLabel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GateEvidenceResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GateEvidence'] = ResolversParentTypes['GateEvidence']> = ResolversObject<{
  dataUnavailable?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  fieldsRead?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  indeterminate?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  uncertaintyReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type GateExplanationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['GateExplanation'] = ResolversParentTypes['GateExplanation']> = ResolversObject<{
  classification?: Resolver<ResolversTypes['GateClassification'], ParentType, ContextType>;
  gateNodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  gateTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  missingData?: Resolver<Array<ResolversTypes['MissingData']>, ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportDiffResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportDiff'] = ResolversParentTypes['ImportDiff']> = ResolversObject<{
  details?: Resolver<Array<ResolversTypes['DiffDetail']>, ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['ImportDiffSummary'], ParentType, ContextType>;
  synthetic?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportDiffSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportDiffSummary'] = ResolversParentTypes['ImportDiffSummary']> = ResolversObject<{
  edgesAdded?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  edgesModified?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  edgesRemoved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesAdded?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesModified?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  nodesRemoved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ImportPathwayResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ImportPathwayResult'] = ResolversParentTypes['ImportPathwayResult']> = ResolversObject<{
  diff?: Resolver<Maybe<ResolversTypes['ImportDiff']>, ParentType, ContextType>;
  importType?: Resolver<ResolversTypes['ImportMode'], ParentType, ContextType>;
  pathway?: Resolver<Maybe<ResolversTypes['Pathway']>, ParentType, ContextType>;
  validation?: Resolver<ResolversTypes['ValidationResult'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type LlmGateEvaluationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['LlmGateEvaluation'] = ResolversParentTypes['LlmGateEvaluation']> = ResolversObject<{
  branches?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  chosenBranch?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  confidence?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  errorMessage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  gateId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  inputAttribute?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  inputText?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  latencyMs?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  model?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reasoning?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sessionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  tentative?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type LoincPanelConstituentResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['LoincPanelConstituent'] = ResolversParentTypes['LoincPanelConstituent']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  displayOrder?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ManuallyResolvedMedicationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ManuallyResolvedMedication'] = ResolversParentTypes['ManuallyResolvedMedication']> = ResolversObject<{
  atcClasses?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  ingredientName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ingredientRxcui?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  inputCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  inputSystem?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  inputText?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MatchedCodeSetResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchedCodeSet'] = ResolversParentTypes['MatchedCodeSet']> = ResolversObject<{
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  entryNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  memberCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  members?: Resolver<Array<ResolversTypes['MatchedCodeSetMember']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  setId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MatchedCodeSetMemberResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchedCodeSetMember'] = ResolversParentTypes['MatchedCodeSetMember']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MatchedPathwayResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MatchedPathway'] = ResolversParentTypes['MatchedPathway']> = ResolversObject<{
  matchScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  matched?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  matchedConditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  matchedSets?: Resolver<Array<ResolversTypes['MatchedCodeSet']>, ParentType, ContextType>;
  mostSpecificMatchedSet?: Resolver<ResolversTypes['MatchedCodeSet'], ParentType, ContextType>;
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  patientCodesAddressed?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  patientCodesUnaddressed?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  reachability?: Resolver<ResolversTypes['ReachabilityScore'], ParentType, ContextType>;
  specificityDepth?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedCarePlanResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedCarePlan'] = ResolversParentTypes['MergedCarePlan']> = ResolversObject<{
  catchUpItems?: Resolver<Array<ResolversTypes['CatchUpItem']>, ParentType, ContextType>;
  conflicts?: Resolver<Array<ResolversTypes['MergedConflict']>, ParentType, ContextType>;
  dataGapHints?: Resolver<Array<ResolversTypes['DataGapHint']>, ParentType, ContextType>;
  evidenceTrail?: Resolver<Array<ResolversTypes['GateEvidence']>, ParentType, ContextType>;
  guidance?: Resolver<Array<ResolversTypes['MergedGuidanceRecommendation']>, ParentType, ContextType>;
  imaging?: Resolver<Array<ResolversTypes['MergedImagingRecommendation']>, ParentType, ContextType>;
  labs?: Resolver<Array<ResolversTypes['MergedLabRecommendation']>, ParentType, ContextType>;
  medications?: Resolver<Array<ResolversTypes['MergedMedicationRecommendation']>, ParentType, ContextType>;
  procedures?: Resolver<Array<ResolversTypes['MergedProcedureRecommendation']>, ParentType, ContextType>;
  qualityMetrics?: Resolver<Array<ResolversTypes['MergedQualityMetricRecommendation']>, ParentType, ContextType>;
  schedules?: Resolver<Array<ResolversTypes['MergedScheduleRecommendation']>, ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  suppressed?: Resolver<Array<ResolversTypes['SuppressedRecommendation']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedConflictResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedConflict'] = ResolversParentTypes['MergedConflict']> = ResolversObject<{
  candidates?: Resolver<Array<ResolversTypes['ConflictCandidate']>, ParentType, ContextType>;
  clinicalRole?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  conflictId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  resolution?: Resolver<Maybe<ResolversTypes['ConflictResolution']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['ConflictType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedGuidanceRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedGuidanceRecommendation'] = ResolversParentTypes['MergedGuidanceRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedGuidance'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedImagingRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedImagingRecommendation'] = ResolversParentTypes['MergedImagingRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedImaging'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedLabRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedLabRecommendation'] = ResolversParentTypes['MergedLabRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedLab'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedMedicationRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedMedicationRecommendation'] = ResolversParentTypes['MergedMedicationRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedMedication'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedProcedureRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedProcedureRecommendation'] = ResolversParentTypes['MergedProcedureRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedProcedure'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedQualityMetricRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedQualityMetricRecommendation'] = ResolversParentTypes['MergedQualityMetricRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedQualityMetric'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MergedScheduleRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MergedScheduleRecommendation'] = ResolversParentTypes['MergedScheduleRecommendation']> = ResolversObject<{
  recommendation?: Resolver<ResolversTypes['ResolvedSchedule'], ParentType, ContextType>;
  sourcePathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RecommendationState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MissingDataResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MissingData'] = ResolversParentTypes['MissingData']> = ResolversObject<{
  attribute?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  code?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  comparison?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  field?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  threshold?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  vitalName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MultiPathwayPendingGateResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MultiPathwayPendingGate'] = ResolversParentTypes['MultiPathwayPendingGate']> = ResolversObject<{
  affectedSubtreeSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  answerType?: Resolver<ResolversTypes['AnswerType'], ParentType, ContextType>;
  datumKey?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  estimatedImpact?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  gateId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  optionLabels?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  options?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pathwayTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sessionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  tentative?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  tentativeBranch?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  tentativeConfidence?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  tentativeReasoning?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MultiPathwayResolutionSessionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MultiPathwayResolutionSession'] = ResolversParentTypes['MultiPathwayResolutionSession']> = ResolversObject<{
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  contributingPathwayIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  contributingPathways?: Resolver<Array<ResolversTypes['Pathway']>, ParentType, ContextType>;
  contributingSessionIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ddiWarnings?: Resolver<Array<ResolversTypes['DDIWarning']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isPreview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mergedPlan?: Resolver<ResolversTypes['MergedCarePlan'], ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pendingGateQuestions?: Resolver<Array<ResolversTypes['MultiPathwayPendingGate']>, ParentType, ContextType>;
  providerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['MultiPathwayResolutionSessionStatus'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MultiPathwayResolutionSessionSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['MultiPathwayResolutionSessionSummary'] = ResolversParentTypes['MultiPathwayResolutionSessionSummary']> = ResolversObject<{
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  contributingPathwayCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isPreview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  providerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['MultiPathwayResolutionSessionStatus'], ParentType, ContextType>;
  unresolvedConflictCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  abandonMultiPathwaySession?: Resolver<ResolversTypes['MultiPathwayResolutionSession'], ParentType, ContextType, RequireFields<MutationAbandonMultiPathwaySessionArgs, 'sessionId'>>;
  abandonSession?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAbandonSessionArgs, 'sessionId'>>;
  activatePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationActivatePathwayArgs, 'id'>>;
  addAdminEvidence?: Resolver<ResolversTypes['AdminEvidenceEntry'], ParentType, ContextType, RequireFields<MutationAddAdminEvidenceArgs, 'input'>>;
  addPatientContext?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAddPatientContextArgs, 'additionalContext' | 'sessionId'>>;
  answerPendingDecision?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationAnswerPendingDecisionArgs, 'answer' | 'nodeId' | 'sessionId'>>;
  archivePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationArchivePathwayArgs, 'id'>>;
  createSignalDefinition?: Resolver<ResolversTypes['SignalDefinitionType'], ParentType, ContextType, RequireFields<MutationCreateSignalDefinitionArgs, 'input'>>;
  deletePreviewSession?: Resolver<ResolversTypes['DeletePreviewSessionResult'], ParentType, ContextType, RequireFields<MutationDeletePreviewSessionArgs, 'sessionId'>>;
  deleteSignalDefinition?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteSignalDefinitionArgs, 'id'>>;
  deleteSimulatorScenario?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteSimulatorScenarioArgs, 'id'>>;
  generateCarePlanFromResolution?: Resolver<ResolversTypes['CarePlanGenerationResult'], ParentType, ContextType, RequireFields<MutationGenerateCarePlanFromResolutionArgs, 'sessionId'>>;
  generateMergedCarePlan?: Resolver<ResolversTypes['CarePlanGenerationResult'], ParentType, ContextType, RequireFields<MutationGenerateMergedCarePlanArgs, 'sessionId'>>;
  importPathway?: Resolver<ResolversTypes['ImportPathwayResult'], ParentType, ContextType, RequireFields<MutationImportPathwayArgs, 'importMode' | 'pathwayJson'>>;
  manuallyResolveMedicationNormalization?: Resolver<ResolversTypes['ManuallyResolvedMedication'], ParentType, ContextType, RequireFields<MutationManuallyResolveMedicationNormalizationArgs, 'inputText' | 'rxcui'>>;
  overrideNode?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationOverrideNodeArgs, 'action' | 'nodeId' | 'sessionId'>>;
  reMergeMultiPathwaySession?: Resolver<ResolversTypes['MultiPathwayResolutionSession'], ParentType, ContextType, RequireFields<MutationReMergeMultiPathwaySessionArgs, 'sessionId'>>;
  reactivatePathway?: Resolver<ResolversTypes['PathwayStatusResult'], ParentType, ContextType, RequireFields<MutationReactivatePathwayArgs, 'id'>>;
  removeAdminEvidence?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveAdminEvidenceArgs, 'id'>>;
  removeNodeWeight?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveNodeWeightArgs, 'id'>>;
  removeResolutionThresholds?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveResolutionThresholdsArgs, 'id'>>;
  removeSignalWeight?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRemoveSignalWeightArgs, 'id'>>;
  resolveConflict?: Resolver<ResolversTypes['MultiPathwayResolutionSession'], ParentType, ContextType, RequireFields<MutationResolveConflictArgs, 'choice' | 'conflictId' | 'sessionId'>>;
  saveSimulatorScenario?: Resolver<ResolversTypes['SimulatorScenario'], ParentType, ContextType, RequireFields<MutationSaveSimulatorScenarioArgs, 'input'>>;
  setNodeWeight?: Resolver<ResolversTypes['NodeWeight'], ParentType, ContextType, RequireFields<MutationSetNodeWeightArgs, 'input'>>;
  setResolutionThresholds?: Resolver<ResolversTypes['ResolutionThresholds'], ParentType, ContextType, RequireFields<MutationSetResolutionThresholdsArgs, 'input'>>;
  setSignalWeight?: Resolver<ResolversTypes['SignalWeight'], ParentType, ContextType, RequireFields<MutationSetSignalWeightArgs, 'input'>>;
  startMultiPathwayResolution?: Resolver<ResolversTypes['MultiPathwayResolutionSession'], ParentType, ContextType, RequireFields<MutationStartMultiPathwayResolutionArgs, 'patientId'>>;
  startResolution?: Resolver<ResolversTypes['ResolutionSession'], ParentType, ContextType, RequireFields<MutationStartResolutionArgs, 'pathwayId' | 'patientId'>>;
  updateSignalDefinition?: Resolver<ResolversTypes['SignalDefinitionType'], ParentType, ContextType, RequireFields<MutationUpdateSignalDefinitionArgs, 'id' | 'input'>>;
}>;

export type NodeConfidenceResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['NodeConfidenceResult'] = ResolversParentTypes['NodeConfidenceResult']> = ResolversObject<{
  breakdown?: Resolver<Array<ResolversTypes['SignalBreakdown']>, ParentType, ContextType>;
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  propagationInfluences?: Resolver<Array<ResolversTypes['PropagationInfluence']>, ParentType, ContextType>;
  resolutionType?: Resolver<Maybe<ResolversTypes['ResolutionType']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type NodeWeightResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['NodeWeight'] = ResolversParentTypes['NodeWeight']> = ResolversObject<{
  defaultWeight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  propagationOverrides?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  weightOverride?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Pathway'] = ResolversParentTypes['Pathway']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Pathway']>, { __typename: 'Pathway' } & GraphQLRecursivePick<ParentType, {"id":true}>, ContextType>;
  category?: Resolver<ResolversTypes['PathwayCategory'], ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  logicalId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scope?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['PathwayStatus'], ParentType, ContextType>;
  targetPopulation?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayConfidenceResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayConfidenceResult'] = ResolversParentTypes['PathwayConfidenceResult']> = ResolversObject<{
  nodes?: Resolver<Array<ResolversTypes['NodeConfidenceResult']>, ParentType, ContextType>;
  overallConfidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraph'] = ResolversParentTypes['PathwayGraph']> = ResolversObject<{
  conditionCodeDetails?: Resolver<Array<ResolversTypes['ConditionCodeDetail']>, ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['PathwayGraphEdge']>, ParentType, ContextType>;
  nodes?: Resolver<Array<ResolversTypes['PathwayGraphNode']>, ParentType, ContextType>;
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphEdgeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraphEdge'] = ResolversParentTypes['PathwayGraphEdge']> = ResolversObject<{
  from?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  properties?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  to?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayGraphNodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayGraphNode'] = ResolversParentTypes['PathwayGraphNode']> = ResolversObject<{
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  properties?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PathwayStatusResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PathwayStatusResult'] = ResolversParentTypes['PathwayStatusResult']> = ResolversObject<{
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  previousStatus?: Resolver<ResolversTypes['PathwayStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PendingQuestionTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PendingQuestionType'] = ResolversParentTypes['PendingQuestionType']> = ResolversObject<{
  affectedSubtreeSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  answerType?: Resolver<ResolversTypes['AnswerType'], ParentType, ContextType>;
  estimatedImpact?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  gateId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  options?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tentative?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  tentativeBranch?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  tentativeConfidence?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  tentativeReasoning?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PropagationConfigTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PropagationConfigType'] = ResolversParentTypes['PropagationConfigType']> = ResolversObject<{
  decayFactor?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  edgeTypes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  immuneToSignals?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  maxHops?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  mode?: Resolver<ResolversTypes['PropagationMode'], ParentType, ContextType>;
  sourceNodeTypes?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PropagationInfluenceResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['PropagationInfluence'] = ResolversParentTypes['PropagationInfluence']> = ResolversObject<{
  hopDistance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  originalScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  propagatedScore?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ProviderOverrideTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ProviderOverrideType'] = ResolversParentTypes['ProviderOverrideType']> = ResolversObject<{
  action?: Resolver<ResolversTypes['OverrideAction'], ParentType, ContextType>;
  originalConfidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  originalStatus?: Resolver<ResolversTypes['NodeStatus'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  adminEvidenceEntries?: Resolver<Array<ResolversTypes['AdminEvidenceEntry']>, ParentType, ContextType, RequireFields<QueryAdminEvidenceEntriesArgs, 'pathwayId'>>;
  attributeVocabulary?: Resolver<Array<ResolversTypes['AttributeVocabularyEntry']>, ParentType, ContextType>;
  effectiveThresholds?: Resolver<ResolversTypes['ResolvedThresholds'], ParentType, ContextType, RequireFields<QueryEffectiveThresholdsArgs, 'pathwayId'>>;
  effectiveWeights?: Resolver<ResolversTypes['WeightMatrix'], ParentType, ContextType, RequireFields<QueryEffectiveWeightsArgs, 'pathwayId'>>;
  llmGateEvaluations?: Resolver<Array<ResolversTypes['LlmGateEvaluation']>, ParentType, ContextType, RequireFields<QueryLlmGateEvaluationsArgs, 'sessionId'>>;
  loincPanelConstituents?: Resolver<Array<ResolversTypes['LoincPanelConstituent']>, ParentType, ContextType, RequireFields<QueryLoincPanelConstituentsArgs, 'panelCode'>>;
  matchedPathways?: Resolver<Array<ResolversTypes['MatchedPathway']>, ParentType, ContextType, RequireFields<QueryMatchedPathwaysArgs, 'patientId'>>;
  multiPathwayResolutionSession?: Resolver<Maybe<ResolversTypes['MultiPathwayResolutionSession']>, ParentType, ContextType, RequireFields<QueryMultiPathwayResolutionSessionArgs, 'sessionId'>>;
  pathway?: Resolver<Maybe<ResolversTypes['Pathway']>, ParentType, ContextType, RequireFields<QueryPathwayArgs, 'id'>>;
  pathwayConfidence?: Resolver<ResolversTypes['PathwayConfidenceResult'], ParentType, ContextType, RequireFields<QueryPathwayConfidenceArgs, 'pathwayId' | 'patientContext'>>;
  pathwayGraph?: Resolver<Maybe<ResolversTypes['PathwayGraph']>, ParentType, ContextType, RequireFields<QueryPathwayGraphArgs, 'id'>>;
  pathwayServiceHealth?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  pathways?: Resolver<Array<ResolversTypes['Pathway']>, ParentType, ContextType, Partial<QueryPathwaysArgs>>;
  patientMultiPathwayResolutionSessions?: Resolver<Array<ResolversTypes['MultiPathwayResolutionSessionSummary']>, ParentType, ContextType, RequireFields<QueryPatientMultiPathwayResolutionSessionsArgs, 'patientId'>>;
  patientResolutionSessions?: Resolver<Array<ResolversTypes['ResolutionSessionSummary']>, ParentType, ContextType, RequireFields<QueryPatientResolutionSessionsArgs, 'patientId'>>;
  pendingQuestions?: Resolver<Array<ResolversTypes['PendingQuestionType']>, ParentType, ContextType, RequireFields<QueryPendingQuestionsArgs, 'sessionId'>>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlagType']>, ParentType, ContextType, RequireFields<QueryRedFlagsArgs, 'sessionId'>>;
  relatedPathways?: Resolver<Array<ResolversTypes['RelatedPathway']>, ParentType, ContextType, RequireFields<QueryRelatedPathwaysArgs, 'pathwayId'>>;
  resolutionSession?: Resolver<Maybe<ResolversTypes['ResolutionSession']>, ParentType, ContextType, RequireFields<QueryResolutionSessionArgs, 'sessionId'>>;
  searchCodes?: Resolver<Array<ResolversTypes['CodeDefinition']>, ParentType, ContextType, RequireFields<QuerySearchCodesArgs, 'query'>>;
  signalDefinitions?: Resolver<Array<ResolversTypes['SignalDefinitionType']>, ParentType, ContextType, Partial<QuerySignalDefinitionsArgs>>;
  simulatorScenario?: Resolver<Maybe<ResolversTypes['SimulatorScenario']>, ParentType, ContextType, RequireFields<QuerySimulatorScenarioArgs, 'id'>>;
  simulatorScenarios?: Resolver<Array<ResolversTypes['SimulatorScenario']>, ParentType, ContextType>;
  unnormalizedMedications?: Resolver<Array<ResolversTypes['UnnormalizedMedication']>, ParentType, ContextType>;
}>;

export type ReachabilityScoreResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ReachabilityScore'] = ResolversParentTypes['ReachabilityScore']> = ResolversObject<{
  alwaysEvaluableGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  autoResolvableScore?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  dataAvailableGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  dataDependentGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  gateExplanations?: Resolver<Array<ResolversTypes['GateExplanation']>, ParentType, ContextType>;
  indeterminateGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  questionGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalGates?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RedFlagBranchTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RedFlagBranchType'] = ResolversParentTypes['RedFlagBranchType']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  topExcludeReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RedFlagTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RedFlagType'] = ResolversParentTypes['RedFlagType']> = ResolversObject<{
  branches?: Resolver<Maybe<Array<ResolversTypes['RedFlagBranchType']>>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RelatedPathwayResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['RelatedPathway'] = ResolversParentTypes['RelatedPathway']> = ResolversObject<{
  pathway?: Resolver<ResolversTypes['Pathway'], ParentType, ContextType>;
  relationshipType?: Resolver<ResolversTypes['PathwayRelationshipType'], ParentType, ContextType>;
  sharedCodes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  uniqueToCandidate?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  uniqueToInput?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionEventTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionEventType'] = ResolversParentTypes['ResolutionEventType']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  eventType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodesRecomputed?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  statusChanges?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  triggerData?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionSessionResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionSession'] = ResolversParentTypes['ResolutionSession']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ddiWarnings?: Resolver<Array<ResolversTypes['DDIWarning']>, ParentType, ContextType>;
  excludedNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  gatedOutNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includedNodes?: Resolver<Array<ResolversTypes['ResolvedNode']>, ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pathwayVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  patientId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pendingQuestions?: Resolver<Array<ResolversTypes['PendingQuestionType']>, ParentType, ContextType>;
  providerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  redFlags?: Resolver<Array<ResolversTypes['RedFlagType']>, ParentType, ContextType>;
  resolutionEvents?: Resolver<Array<ResolversTypes['ResolutionEventType']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['SessionStatus'], ParentType, ContextType>;
  totalNodesEvaluated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  traversalDurationMs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionSessionSummaryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionSessionSummary'] = ResolversParentTypes['ResolutionSessionSummary']> = ResolversObject<{
  carePlanId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  pathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pathwayTitle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  redFlagCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['SessionStatus'], ParentType, ContextType>;
  totalNodesEvaluated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolutionThresholdsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolutionThresholds'] = ResolversParentTypes['ResolutionThresholds']> = ResolversObject<{
  autoResolveThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['ThresholdScope'], ParentType, ContextType>;
  suggestThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedGuidanceResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedGuidance'] = ResolversParentTypes['ResolvedGuidance']> = ResolversObject<{
  category?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  instructions?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  topic?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedImagingResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedImaging'] = ResolversParentTypes['ResolvedImaging']> = ResolversObject<{
  bodyRegion?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  code?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  contrast?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  modality?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  system?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedLabResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedLab'] = ResolversParentTypes['ResolvedLab']> = ResolversObject<{
  code?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  specimen?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedMedicationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedMedication'] = ResolversParentTypes['ResolvedMedication']> = ResolversObject<{
  clinicalRole?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  dose?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  duration?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  frequency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  route?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedNodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedNode'] = ResolversParentTypes['ResolvedNode']> = ResolversObject<{
  confidence?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  confidenceBreakdown?: Resolver<Array<ResolversTypes['SignalBreakdown']>, ParentType, ContextType>;
  depth?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  excludeReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  parentNodeId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  providerOverride?: Resolver<Maybe<ResolversTypes['ProviderOverrideType']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['NodeStatus'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedProcedureResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedProcedure'] = ResolversParentTypes['ResolvedProcedure']> = ResolversObject<{
  code?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  system?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedQualityMetricResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedQualityMetric'] = ResolversParentTypes['ResolvedQualityMetric']> = ResolversObject<{
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  measure?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedScheduleResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedSchedule'] = ResolversParentTypes['ResolvedSchedule']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  evidenceGateIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  interval?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sourceNodeId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sourcePathwayId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ResolvedThresholdsResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ResolvedThresholds'] = ResolversParentTypes['ResolvedThresholds']> = ResolversObject<{
  autoResolveThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['ThresholdScope'], ParentType, ContextType>;
  suggestThreshold?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalBreakdownResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalBreakdown'] = ResolversParentTypes['SignalBreakdown']> = ResolversObject<{
  missingInputs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  score?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  skipped?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  weightSource?: Resolver<ResolversTypes['WeightSource'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalDefinitionTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalDefinitionType'] = ResolversParentTypes['SignalDefinitionType']> = ResolversObject<{
  defaultWeight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  displayName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  propagationConfig?: Resolver<Maybe<ResolversTypes['PropagationConfigType']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['SignalScope'], ParentType, ContextType>;
  scoringRules?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  scoringType?: Resolver<ResolversTypes['ScoringType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SignalWeightResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SignalWeight'] = ResolversParentTypes['SignalWeight']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  institutionId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  nodeIdentifier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nodeType?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  pathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  scope?: Resolver<ResolversTypes['WeightScope'], ParentType, ContextType>;
  signalDefinitionId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SimulatorScenarioResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SimulatorScenario'] = ResolversParentTypes['SimulatorScenario']> = ResolversObject<{
  allergies?: Resolver<Array<ResolversTypes['SimulatorScenarioCode']>, ParentType, ContextType>;
  conditionCodes?: Resolver<Array<ResolversTypes['SimulatorScenarioCode']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  includeDraftPathways?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  labResults?: Resolver<Array<ResolversTypes['SimulatorScenarioLabResult']>, ParentType, ContextType>;
  medications?: Resolver<Array<ResolversTypes['SimulatorScenarioCode']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  narrative?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vitals?: Resolver<ResolversTypes['JSON'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SimulatorScenarioCodeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SimulatorScenarioCode'] = ResolversParentTypes['SimulatorScenarioCode']> = ResolversObject<{
  clinicalState?: Resolver<Maybe<ResolversTypes['ClinicalStateInput']>, ParentType, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  date?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  display?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  endDate?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  recordValidity?: Resolver<Maybe<ResolversTypes['RecordValidityInput']>, ParentType, ContextType>;
  sourceId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SimulatorScenarioLabResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SimulatorScenarioLabResult'] = ResolversParentTypes['SimulatorScenarioLabResult']> = ResolversObject<{
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  date?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  display?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  recordValidity?: Resolver<Maybe<ResolversTypes['RecordValidityInput']>, ParentType, ContextType>;
  sourceId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  system?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  unit?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  value?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type SuppressedRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['SuppressedRecommendation'] = ResolversParentTypes['SuppressedRecommendation']> = ResolversObject<{
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['SuppressionReason'], ParentType, ContextType>;
  suppressedByAllergyCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  suppressedByAllergyDisplay?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  suppressedByPathwayId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  suppressedByPathwayTitle?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  suppressedByPatientMedName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  suppressedByPatientMedRxcui?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['SuppressedRecommendationType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type UnlockedRecommendationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['UnlockedRecommendation'] = ResolversParentTypes['UnlockedRecommendation']> = ResolversObject<{
  nodeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nodeType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type UnnormalizedMedicationResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['UnnormalizedMedication'] = ResolversParentTypes['UnnormalizedMedication']> = ResolversObject<{
  attemptedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  inputCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  inputSystem?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  inputText?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ValidationBlockerTypeResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ValidationBlockerType'] = ResolversParentTypes['ValidationBlockerType']> = ResolversObject<{
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  relatedNodeIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['BlockerType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ValidationResultResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['ValidationResult'] = ResolversParentTypes['ValidationResult']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  valid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnings?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type WeightMatrixResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['WeightMatrix'] = ResolversParentTypes['WeightMatrix']> = ResolversObject<{
  entries?: Resolver<Array<ResolversTypes['WeightMatrixEntry']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type WeightMatrixEntryResolvers<ContextType = DataSourceContext, ParentType extends ResolversParentTypes['WeightMatrixEntry'] = ResolversParentTypes['WeightMatrixEntry']> = ResolversObject<{
  nodeIdentifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  signalName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['WeightSource'], ParentType, ContextType>;
  weight?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = DataSourceContext> = ResolversObject<{
  AdminEvidenceEntry?: AdminEvidenceEntryResolvers<ContextType>;
  ArchiveResult?: ArchiveResultResolvers<ContextType>;
  AttributeVocabularyEntry?: AttributeVocabularyEntryResolvers<ContextType>;
  CarePlanGenerationResult?: CarePlanGenerationResultResolvers<ContextType>;
  CatchUpItem?: CatchUpItemResolvers<ContextType>;
  CodeDefinition?: CodeDefinitionResolvers<ContextType>;
  ConditionCodeDetail?: ConditionCodeDetailResolvers<ContextType>;
  ConflictCandidate?: ConflictCandidateResolvers<ContextType>;
  ConflictResolution?: ConflictResolutionResolvers<ContextType>;
  CustomMedicationOverride?: CustomMedicationOverrideResolvers<ContextType>;
  DDIFindingSource?: DdiFindingSourceResolvers<ContextType>;
  DDIWarning?: DdiWarningResolvers<ContextType>;
  DataGapHint?: DataGapHintResolvers<ContextType>;
  DeletePreviewSessionResult?: DeletePreviewSessionResultResolvers<ContextType>;
  DiffDetail?: DiffDetailResolvers<ContextType>;
  GateEvidence?: GateEvidenceResolvers<ContextType>;
  GateExplanation?: GateExplanationResolvers<ContextType>;
  ImportDiff?: ImportDiffResolvers<ContextType>;
  ImportDiffSummary?: ImportDiffSummaryResolvers<ContextType>;
  ImportPathwayResult?: ImportPathwayResultResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  LlmGateEvaluation?: LlmGateEvaluationResolvers<ContextType>;
  LoincPanelConstituent?: LoincPanelConstituentResolvers<ContextType>;
  ManuallyResolvedMedication?: ManuallyResolvedMedicationResolvers<ContextType>;
  MatchedCodeSet?: MatchedCodeSetResolvers<ContextType>;
  MatchedCodeSetMember?: MatchedCodeSetMemberResolvers<ContextType>;
  MatchedPathway?: MatchedPathwayResolvers<ContextType>;
  MergedCarePlan?: MergedCarePlanResolvers<ContextType>;
  MergedConflict?: MergedConflictResolvers<ContextType>;
  MergedGuidanceRecommendation?: MergedGuidanceRecommendationResolvers<ContextType>;
  MergedImagingRecommendation?: MergedImagingRecommendationResolvers<ContextType>;
  MergedLabRecommendation?: MergedLabRecommendationResolvers<ContextType>;
  MergedMedicationRecommendation?: MergedMedicationRecommendationResolvers<ContextType>;
  MergedProcedureRecommendation?: MergedProcedureRecommendationResolvers<ContextType>;
  MergedQualityMetricRecommendation?: MergedQualityMetricRecommendationResolvers<ContextType>;
  MergedScheduleRecommendation?: MergedScheduleRecommendationResolvers<ContextType>;
  MissingData?: MissingDataResolvers<ContextType>;
  MultiPathwayPendingGate?: MultiPathwayPendingGateResolvers<ContextType>;
  MultiPathwayResolutionSession?: MultiPathwayResolutionSessionResolvers<ContextType>;
  MultiPathwayResolutionSessionSummary?: MultiPathwayResolutionSessionSummaryResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NodeConfidenceResult?: NodeConfidenceResultResolvers<ContextType>;
  NodeWeight?: NodeWeightResolvers<ContextType>;
  Pathway?: PathwayResolvers<ContextType>;
  PathwayConfidenceResult?: PathwayConfidenceResultResolvers<ContextType>;
  PathwayGraph?: PathwayGraphResolvers<ContextType>;
  PathwayGraphEdge?: PathwayGraphEdgeResolvers<ContextType>;
  PathwayGraphNode?: PathwayGraphNodeResolvers<ContextType>;
  PathwayStatusResult?: PathwayStatusResultResolvers<ContextType>;
  PendingQuestionType?: PendingQuestionTypeResolvers<ContextType>;
  PropagationConfigType?: PropagationConfigTypeResolvers<ContextType>;
  PropagationInfluence?: PropagationInfluenceResolvers<ContextType>;
  ProviderOverrideType?: ProviderOverrideTypeResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ReachabilityScore?: ReachabilityScoreResolvers<ContextType>;
  RedFlagBranchType?: RedFlagBranchTypeResolvers<ContextType>;
  RedFlagType?: RedFlagTypeResolvers<ContextType>;
  RelatedPathway?: RelatedPathwayResolvers<ContextType>;
  ResolutionEventType?: ResolutionEventTypeResolvers<ContextType>;
  ResolutionSession?: ResolutionSessionResolvers<ContextType>;
  ResolutionSessionSummary?: ResolutionSessionSummaryResolvers<ContextType>;
  ResolutionThresholds?: ResolutionThresholdsResolvers<ContextType>;
  ResolvedGuidance?: ResolvedGuidanceResolvers<ContextType>;
  ResolvedImaging?: ResolvedImagingResolvers<ContextType>;
  ResolvedLab?: ResolvedLabResolvers<ContextType>;
  ResolvedMedication?: ResolvedMedicationResolvers<ContextType>;
  ResolvedNode?: ResolvedNodeResolvers<ContextType>;
  ResolvedProcedure?: ResolvedProcedureResolvers<ContextType>;
  ResolvedQualityMetric?: ResolvedQualityMetricResolvers<ContextType>;
  ResolvedSchedule?: ResolvedScheduleResolvers<ContextType>;
  ResolvedThresholds?: ResolvedThresholdsResolvers<ContextType>;
  SignalBreakdown?: SignalBreakdownResolvers<ContextType>;
  SignalDefinitionType?: SignalDefinitionTypeResolvers<ContextType>;
  SignalWeight?: SignalWeightResolvers<ContextType>;
  SimulatorScenario?: SimulatorScenarioResolvers<ContextType>;
  SimulatorScenarioCode?: SimulatorScenarioCodeResolvers<ContextType>;
  SimulatorScenarioLabResult?: SimulatorScenarioLabResultResolvers<ContextType>;
  SuppressedRecommendation?: SuppressedRecommendationResolvers<ContextType>;
  UnlockedRecommendation?: UnlockedRecommendationResolvers<ContextType>;
  UnnormalizedMedication?: UnnormalizedMedicationResolvers<ContextType>;
  ValidationBlockerType?: ValidationBlockerTypeResolvers<ContextType>;
  ValidationResult?: ValidationResultResolvers<ContextType>;
  WeightMatrix?: WeightMatrixResolvers<ContextType>;
  WeightMatrixEntry?: WeightMatrixEntryResolvers<ContextType>;
}>;

