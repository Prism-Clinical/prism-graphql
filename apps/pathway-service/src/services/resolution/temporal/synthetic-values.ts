import { TemporalBound, ClinicalState, FactBase } from './fact-model';
import { parseFhirDate } from './interval';
import { TemporalContextError } from './evaluation-context';

/**
 * The closed unions a SYNTHETIC caller may assert into.
 *
 * `satisfies` proves every listed member is a real member of the fact model.
 * The `assertExactUnion` calls below prove the converse — that the fact model
 * has no member missing here — so adding a state to `fact-model.ts` breaks
 * this build rather than silently becoming unassertable.
 */
export const CLINICAL_STATES = [
  'ACTIVE',
  'INACTIVE',
  'ON_HOLD',
  'UNKNOWN',
  'CONFLICT',
] as const satisfies readonly ClinicalState[];

export const RECORD_VALIDITIES = [
  'VALID',
  'INVALID',
  'UNKNOWN',
] as const satisfies readonly FactBase['recordValidity'][];

export type SyntheticClinicalState = (typeof CLINICAL_STATES)[number];
export type SyntheticRecordValidity = (typeof RECORD_VALIDITIES)[number];

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
function assertExactUnion<A, B>(_proof: Exact<A, B>): void {
  /* compile-time only */
}
assertExactUnion<SyntheticClinicalState, ClinicalState>(true);
assertExactUnion<SyntheticRecordValidity, FactBase['recordValidity']>(true);

function reject(where: string, got: unknown, allowed: readonly string[]): never {
  throw new TemporalContextError(
    `${where}: ${JSON.stringify(got)} is not one of ${allowed.join(' | ')}`,
    'INVALID_RESOLUTION_INPUT',
  );
}

export function parseClinicalState(raw: unknown, where: string): SyntheticClinicalState {
  if (typeof raw === 'string' && (CLINICAL_STATES as readonly string[]).includes(raw)) {
    return raw as SyntheticClinicalState;
  }
  reject(where, raw, CLINICAL_STATES);
}

export function parseRecordValidity(raw: unknown, where: string): SyntheticRecordValidity {
  if (typeof raw === 'string' && (RECORD_VALIDITIES as readonly string[]).includes(raw)) {
    return raw as SyntheticRecordValidity;
  }
  reject(where, raw, RECORD_VALIDITIES);
}

export function parseSyntheticDate(raw: string, where: string): TemporalBound {
  const bound = parseFhirDate(raw);
  if (!bound) {
    throw new TemporalContextError(
      `${where}: "${raw}" is not a valid FHIR date`,
      'INVALID_RESOLUTION_INPUT',
    );
  }
  return bound;
}
