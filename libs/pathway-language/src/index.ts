/**
 * @prism/pathway-language — EXPERIMENTAL, NONCLINICAL.
 *
 * Public boundary of the isolated pathway-language core. It currently exposes only the S1
 * revision-history resolver, S2 candidate identification and one S3 admissibility check
 * (same-encounter scope) of the proposed evidence-query contract
 * (docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md §2), and the
 * first PPL compiler subset (first-program-implementation-contract.md, increment I1), and isolated
 * program-expression execution over SUPPLIED query results (I2), which is not end-to-end evaluation.
 * It is not the PPL evaluator, is not clinically approved and must not be used for patient care.
 */
export { resolveRevisionHistory as experimentalResolveRevisionHistory } from './s1/resolve';
export { DEMO_AMEND_PERMISSION, DEMO_AUTHORITY_RULE } from './s1/types';
export type {
  Addition,
  Defect,
  DefectReason,
  DefectSubject,
  JsonValue,
  KeyDiagnostic,
  KeyDiagnosticCode,
  KeyResolution,
  KeyStatus,
  Membership,
  NodeRef,
  Occurrence,
  PossibleCurrent,
  RecordKey,
  Rejection,
  RejectionReason,
  RetractionAuthority,
  RetractionEffect,
  RetractionInfo,
  RetractionRef,
  RetractionVariant,
  RevisionInfo,
  RevisionRef,
  RevisionState,
  S1Cause,
  S1Envelope,
  S1Input,
  S1Result,
  UndeclaredField,
  Variant,
} from './s1/types';
export { identifyCandidates as experimentalIdentifyCandidates, S2ConfigurationError } from './s2/identify';
export type {
  AnyCause,
  Code,
  KeyCandidacy,
  NodeCandidacy,
  PossibleCandidacy,
  S2Cause,
  S2Finding,
  S2Input,
  S2Reason,
  S2Result,
  ValueSetExpansion,
} from './s2/types';
export { checkEncounterScope as experimentalCheckEncounterScope, EncounterCheckConfigurationError } from './s3/encounter';
export { SAME_ENCOUNTER_RULE } from './s3/types';
export type {
  ContextCause,
  EncounterBinding,
  EncounterCheckInput,
  EncounterCheckResult,
  EncounterFinding,
  EncounterOutcome,
  KeyEncounterScope,
  PossibleEncounterScope,
} from './s3/types';
export { compile as experimentalCompile, compilePreview as experimentalCompilePreview } from './compile/compile';
export type {
  CompiledDeclaration,
  CompiledPackage,
  CompiledProgram,
  CompiledReference,
  CompileFailure,
  CompileResult,
  DependencyEdge,
  Diagnostic,
  DiagnosticCode,
  EnumCriterion,
  ExplicitAssertionContract,
  Expr,
  HoleInfo,
  PreviewCompileResult,
  PreviewMarker,
  PreviewPackage,
  ValueType,
} from './compile/types';
export {
  executeWithSuppliedQueryResults as experimentalExecuteWithSuppliedQueryResults,
  executePreviewWithSuppliedQueryResults as experimentalExecutePreviewWithSuppliedQueryResults,
} from './execute/execute';
export type {
  Cause,
  DecisionOutput,
  DecisionValue,
  ExecutionInputError,
  ExecutionInputErrorCode,
  ExecutionResult,
  FindingAttributes,
  FindingOutput,
  Marker,
  PreviewExecutionResult,
  ProgramOutput,
  QueryOutput,
  SuppliedEvidence,
  SuppliedQueryResults,
  TraceEntry,
  TraceStep,
} from './execute/types';
