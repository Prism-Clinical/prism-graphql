/**
 * EXPERIMENTAL, NONCLINICAL. Public types for the S1 revision-history resolver.
 *
 * Normative source: docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md
 * (§1.1–1.4, §2.1) and conformance/explicit-assertion-v0/CANONICALIZATION.md. These types
 * carry no clinical meaning and must not be used for patient care.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Source-scoped record identity (contract §1.1). */
export interface RecordKey {
  readonly source: string;
  readonly localId: string;
}

/** Revision identity. `revision` is opaque: it carries no ordering or recency meaning. */
export interface RevisionRef extends RecordKey {
  readonly revision: string;
}

/** Retraction identity: (key.source, id). */
export interface RetractionRef {
  readonly source: string;
  readonly id: string;
}

/**
 * A graph node. `digest` is present only for one variant of a conflicted revision
 * (two or more distinct payloads under one RevisionRef).
 */
export interface NodeRef {
  readonly revision: RevisionRef;
  readonly digest?: string;
}

export const DEMO_AUTHORITY_RULE = 'demo-policy/same-source-amend@1' as const;
export const DEMO_AMEND_PERMISSION = 'demo.permission.amend-record' as const;

export interface S1Envelope {
  readonly recordType: string;
  readonly subject: string;
  /** Declared finite source set (contract §1.4). */
  readonly sources: readonly string[];
}

export interface S1Input {
  readonly envelope: S1Envelope;
  /** Only the schematic nonclinical rule of contract §1.3 is supported. */
  readonly authorityRule: typeof DEMO_AUTHORITY_RULE;
  /** Raw revision occurrences as received (frozen JSON values; never mutated). */
  readonly revisions: readonly JsonValue[];
  /** Raw retraction occurrences as received. */
  readonly retractions: readonly JsonValue[];
}

/** The subset of Stage A §4.1 causes that S1 can produce. */
export type S1Cause = 'Missing' | 'Conflicting' | 'Invalid';

export type DefectReason =
  | 'PayloadConflict'
  | 'Fork'
  | 'SelfSupersession'
  | 'Cycle'
  | 'CorrectionTargetAbsent'
  | 'CorrectionRefIncomplete'
  | 'CorrectionRefMalformed'
  | 'CorrectionAuthorityMissing'
  | 'CorrectionAuthorityMalformed'
  | 'CorrectionBoundaryUndeterminable'
  | 'EnvelopeFieldAbsent'
  | 'EnvelopeFieldMalformed'
  | 'RetractionTargetAbsent'
  | 'RetractionAuthorityMissing'
  | 'RetractionAuthorityMalformed'
  | 'RetractionConflict';

export type Addition = 'excluded' | 'unknown';

export type DefectSubject =
  | { readonly kind: 'revision'; readonly ref: RevisionRef }
  | { readonly kind: 'key'; readonly ref: RecordKey }
  | { readonly kind: 'retraction'; readonly ref: RetractionRef };

export interface Defect {
  readonly cause: S1Cause;
  readonly reason: DefectReason;
  readonly subject: DefectSubject;
  /** Revisions whose presence in the final heads keeps this defect active (contract §2.1 step 7). */
  readonly involves: readonly RevisionRef[];
  readonly additions: readonly Addition[];
}

export type PossibleCurrent =
  | { readonly kind: 'node'; readonly node: NodeRef }
  | { readonly kind: Addition };

export type RejectionReason =
  | 'Unauthorized'
  | 'CrossKeyCorrection'
  | 'SubjectChanged'
  | 'RecordTypeChanged'
  | 'CrossKeyRetraction';

export interface Rejection {
  readonly item:
    | { readonly kind: 'revision'; readonly ref: RevisionRef }
    | { readonly kind: 'retraction'; readonly ref: RetractionRef };
  readonly reason: RejectionReason;
  readonly target: RevisionRef | null;
}

export interface Occurrence {
  /** Raw provenance (occurrence metadata, not payload). */
  readonly provenance: JsonValue | null;
  /** Dotted paths of fields outside the declared evidence model (diagnostic `UndeclaredField`). */
  readonly undeclaredPaths: readonly string[];
  /** Index in the input array, for traceability only. Never used to choose anything. */
  readonly inputIndex: number;
}

export type Membership = 'in' | 'out' | 'undeterminable';

export interface Variant {
  readonly digest: string;
  readonly canonicalPayload: string;
  readonly membership: Membership;
  readonly occurrences: readonly Occurrence[];
}

export type RevisionState = 'head' | 'superseded' | 'retracted' | 'rejected' | 'outOfEnvelope';

export interface RevisionInfo {
  readonly ref: RevisionRef;
  readonly variants: readonly Variant[];
  readonly state: RevisionState;
}

export type KeyDiagnosticCode =
  | 'CrossKeyCorrection'
  | 'CrossKeyRetraction'
  | 'RetractionTargetsOutOfEnvelopeRevision'
  | 'RetractionTargetsRejectedRevision'
  | 'RetractionTargetsSupersededRevision';

export interface KeyDiagnostic {
  readonly code: KeyDiagnosticCode;
  readonly from: RevisionRef | RetractionRef;
  readonly target: RevisionRef;
}

export type KeyStatus = 'Current' | 'Retracted' | 'NoRecord' | 'UnresolvedRevision' | 'ContractUndefined';

export interface KeyResolution {
  readonly key: RecordKey;
  readonly status: KeyStatus;
  /** Present only when status is `Current`. */
  readonly current: NodeRef | null;
  /** Active causes, Stage A §4.1 order. Empty unless status is `UnresolvedRevision`. */
  readonly causes: readonly S1Cause[];
  /** H ∪ X for `UnresolvedRevision`; empty otherwise. */
  readonly possibleCurrent: readonly PossibleCurrent[];
  readonly activeDefects: readonly Defect[];
  /** Resolved defects: trace diagnostics (`HistoricalDefect`), never active causes. */
  readonly historicalDefects: readonly Defect[];
  readonly revisions: readonly RevisionInfo[];
  readonly diagnostics: readonly KeyDiagnostic[];
  /** Set when the current contract yields no valid outcome (status `ContractUndefined`). */
  readonly contractGap: string | null;
}

export interface S1Result {
  readonly experimental: 'nonclinical-s1-v0';
  readonly keys: readonly KeyResolution[];
  readonly rejections: readonly Rejection[];
  /** Occurrences never evaluated: undeclared source, or a key with no possible envelope revision. */
  readonly outsideEnvelope: readonly ({ kind: 'revision'; ref: RevisionRef } | { kind: 'retraction'; ref: RetractionRef })[];
  /** Occurrences lacking identity or not representable under RFC 8785 (rejected items for S6). */
  readonly unidentified: readonly { kind: 'revision' | 'retraction'; inputIndex: number; reason: string }[];
  /** Retractions whose target cannot be attributed (absent or malformed target fields). */
  readonly unattributableRetractions: readonly { ref: RetractionRef; cause: 'Missing' | 'Invalid' }[];
}
