/**
 * @prism/pathway-language — EXPERIMENTAL, NONCLINICAL.
 *
 * Public boundary of the isolated pathway-language core. It currently exposes only the S1
 * revision-history resolver of the proposed evidence-query contract
 * (docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md §2.1).
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
