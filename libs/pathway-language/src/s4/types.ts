/**
 * EXPERIMENTAL, NONCLINICAL. Public types for S4 selection (evidence-query contract §2.8).
 *
 * Selection decides only which keys' records go to criterion evaluation (S5). It evaluates no
 * criterion, decides no materiality and computes no evidence result (S6).
 */
import type { Defect, KeyStatus, NodeRef, RecordKey, S1Cause } from '../s1/types';
import type { AdmissibilityCheckResult, PossibleAdmissibility } from '../s3/types';

/** The only input: one combined S3 result produced by experimentalCheckAdmissibility in this process. */
export interface SelectionInput {
  readonly s3: AdmissibilityCheckResult;
}

export type SelectionStatus = 'Selected' | 'Unresolved' | 'Inadmissible' | 'OutOfDomain' | 'Retracted' | 'NoRecord';

export type Blocker = 'AdmissibilityUnresolved' | 'CandidacyUnresolved' | 'HistoryUnresolved' | 'Inadmissible' | 'OutOfDomain';

export type UnresolvedBy = Extract<Blocker, 'AdmissibilityUnresolved' | 'CandidacyUnresolved' | 'HistoryUnresolved'>;

export type Disposition =
  | { readonly disposition: 'Selected' }
  /** Every applicable blocker, code point order (contract §2.8). */
  | { readonly disposition: 'NotSelected'; readonly blockers: readonly Blocker[] };

/** A combined-S3 possibility, unchanged, plus its disposition. `excluded`/`unknown` carry none. */
export type PossibleSelection =
  | (Extract<PossibleAdmissibility, { kind: 'node' }> & { readonly selection: Disposition })
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unknown' };

export interface KeySelection {
  readonly key: RecordKey;
  readonly s1Status: KeyStatus;
  readonly candidate: boolean;
  readonly inheritedS1Causes: readonly S1Cause[];
  readonly inheritedS1Defects: readonly Defect[];
  readonly status: SelectionStatus;
  /** Empty unless `status` is `Unresolved`; code point order. */
  readonly unresolvedBy: readonly UnresolvedBy[];
  readonly possibilities: readonly PossibleSelection[];
}

/** Detached and deep-frozen. The three lists summarize the per-key statuses; RecordKey order. */
export interface SelectionResult {
  readonly experimental: 'nonclinical-s4-selection-v0';
  readonly stage: 'S4';
  readonly valueSet: string;
  readonly keys: readonly KeySelection[];
  readonly selected: readonly { readonly key: RecordKey; readonly node: NodeRef }[];
  readonly unresolved: readonly RecordKey[];
  readonly inadmissible: readonly RecordKey[];
}
