import { FactKind } from './contract';

export interface TemporalBound {
  value: string; // FHIR: YYYY | YYYY-MM | YYYY-MM-DD | full instant with timezone
  precision: 'year' | 'month' | 'day' | 'instant';
}

export type TemporalEnd =
  | { kind: 'KNOWN'; bound: TemporalBound } // a real end (abatement, resolution, stop)
  | { kind: 'OPEN'; assertedCurrentAt: string } // ongoing, known-current only as of this instant
  | { kind: 'UNKNOWN' }; // no usable end signal — never invent one

export interface FactBase {
  factId: string; // assigned + persisted at ingestion; never a lossy hash (Plan 05)
  code: string;
  system: string;
  display?: string;
  interval: { start?: TemporalBound; end: TemporalEnd };
  recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; // tri-state: see state-mapping
  validityBasis: string;
  provenance: { sourceType: 'FHIR' | 'SYNTHETIC'; sourceId?: string; snapshotId?: string };
}

export type ClinicalState = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD' | 'UNKNOWN' | 'CONFLICT';
export type StateBasis =
  | 'FHIR_STATUS' | 'ABATEMENT' | 'SNAPSHOT_ASSERTION' | 'SYNTHETIC' | 'MISSING_STATUS_FAIL_OPEN';

export interface StatefulFact extends FactBase {
  kind: Extract<FactKind, 'condition' | 'medication_order' | 'allergy'>;
  clinicalState: ClinicalState;
  stateAsOf?: string;
  stateBasis: StateBasis;
}

export interface ObservationFact extends FactBase {
  kind: Extract<FactKind, 'lab' | 'vital'>;
  value?: number;
  unit?: string;
  observationStatus?: string; // labs only; vitals typically have none
  issuedAt?: string;
}

export type NormalizedFact = StatefulFact | ObservationFact;
export type FactStore = ReadonlyArray<NormalizedFact>;

export function isObservationFact(f: NormalizedFact): f is ObservationFact {
  return f.kind === 'lab' || f.kind === 'vital';
}
export function isStatefulFact(f: NormalizedFact): f is StatefulFact {
  return !isObservationFact(f);
}
