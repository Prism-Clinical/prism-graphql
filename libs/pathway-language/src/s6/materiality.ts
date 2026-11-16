/**
 * EXPERIMENTAL, NONCLINICAL. S6 step B: materiality of unresolved records (evidence-query
 * contract §4.2 step B, "Step B boundary").
 *
 * For ONE query-bound evaluation: computes step A internally, then decides for every unresolved
 * record (each S4 Unresolved key and each selected key classified Unclassified) whether its S5
 * possible classes (§3.7) could oppose the ORIGINAL step A base. The comparison row is fixed once
 * from that base and never updated while records are assessed, so the decisions cannot depend on
 * order. A material record can only demote a Known base to Unresolved; nothing promotes, flips
 * or resolves a conflict.
 *
 * Step C (the cause union and attribution), the final Evidence<Boolean> and Needs do not run here.
 */
import { detach } from '../compile/compile';
import type { RecordKey } from '../s1/types';
import type { SelectionStatus } from '../s4/types';
import type { EvidenceClass } from '../s5/types';
import { baseResult, BaseResultConfigurationError, type BaseKeyRole, type BaseResult, type BaseResultInput } from './base';

/** Invalid API input. Never a materiality decision or patient uncertainty. */
export class MaterialityConfigurationError extends Error {}

/** Exactly the step A input: everything else comes from the bound evaluation. */
export type MaterialityInput = BaseResultInput;

/** The row of the §4.2 step B table, fixed by the original step A base. */
export type MaterialityRow = 'KnownTrue' | 'KnownFalse' | 'Unresolved';

/** The classes that make a record material under each row. */
const OPPOSING: { readonly [R in MaterialityRow]: readonly EvidenceClass[] } = {
  KnownTrue: ['Refuting'],
  KnownFalse: ['Supporting'],
  Unresolved: ['Supporting', 'Refuting'],
};

const IMMATERIAL_REASON = {
  KnownTrue: 'NoRefutingPossibility',
  KnownFalse: 'NoSupportingPossibility',
  Unresolved: 'NoSupportingOrRefutingPossibility',
} as const;

export interface RecordMateriality {
  readonly key: RecordKey;
  /** Why it is an unresolved record: an S4 Unresolved key, or a selected key classified Unclassified. */
  readonly kind: 'UnresolvedKey' | 'SelectedUnclassified';
  readonly status: SelectionStatus;
  readonly role: BaseKeyRole;
  /** S5 possible classes (§3.7), as step A read them. */
  readonly possibleClasses: readonly EvidenceClass[];
  readonly material: boolean;
  /** The possible classes that satisfy the row (empty when immaterial). */
  readonly satisfiedBy: readonly EvidenceClass[];
  /** Immaterial records only: the row's opposing classes are absent. */
  readonly reason?: (typeof IMMATERIAL_REASON)[MaterialityRow];
}

export interface MaterialityResult {
  readonly experimental: 'nonclinical-s6-materiality-v0';
  readonly stage: 'S6';
  /** Step B only: no cause union or attribution (step C), evidence result or Needs. */
  readonly step: 'B';
  readonly scope: 'materiality';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  /** The original step A result, unchanged (its base causes are never extended here). */
  readonly stepA: BaseResult;
  /** The row every record was assessed against, fixed from stepA.base before any record. */
  readonly row: MaterialityRow;
  readonly opposingClasses: readonly EvidenceClass[];
  /** One entry per unresolved record, RecordKey order. */
  readonly records: readonly RecordMateriality[];
  readonly material: readonly RecordKey[];
  readonly immaterial: readonly RecordKey[];
  /** Provisional status after step B: a Known base stays Known only if no record is material. */
  readonly after: { readonly status: 'Known'; readonly value: boolean } | { readonly status: 'Unresolved' };
  readonly change: 'Unchanged' | 'DemotedToUnresolved';
  readonly notRun: readonly ['StepC:Causes', 'Evidence', 'Needs'];
}

const INPUT_FIELDS = ['package', 'query', 's4'];

export function materiality(input: MaterialityInput): MaterialityResult {
  if (input === null || typeof input !== 'object') throw new MaterialityConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular a base result, materiality decisions, possible classes, classifications or gaps.
  if (extra.length > 0) throw new MaterialityConfigurationError(`unexpected input field(s) ${extra.join(', ')}; the base and possible classes come only from the query-bound evaluation`);
  let a: BaseResult;
  try {
    a = baseResult({ package: input.package, query: input.query, s4: input.s4 });
  } catch (e) {
    if (e instanceof BaseResultConfigurationError) throw new MaterialityConfigurationError(e.message);
    throw e;
  }
  // The row comes from the ORIGINAL base, once. It is never recomputed from a demoted status.
  const row: MaterialityRow = a.base.status === 'Unresolved' ? 'Unresolved' : a.base.value ? 'KnownTrue' : 'KnownFalse';
  const opposing = OPPOSING[row];

  const records = a.keys
    .filter((k) => k.status === 'Unresolved' || k.role === 'Unclassified')
    .map((k): RecordMateriality => {
      if (!k.possibleClasses) throw new Error('invariant: step A reads possible classes for every unresolved record');
      const satisfiedBy = k.possibleClasses.filter((c) => opposing.includes(c));
      const common = {
        key: k.key,
        kind: k.status === 'Unresolved' ? ('UnresolvedKey' as const) : ('SelectedUnclassified' as const),
        status: k.status,
        role: k.role,
        possibleClasses: k.possibleClasses,
        material: satisfiedBy.length > 0,
        satisfiedBy,
      };
      return satisfiedBy.length > 0 ? common : { ...common, reason: IMMATERIAL_REASON[row] };
    });
  const material = records.filter((r) => r.material).map((r) => r.key);
  const demoted = a.base.status === 'Known' && material.length > 0;

  return detach({
    experimental: 'nonclinical-s6-materiality-v0',
    stage: 'S6',
    step: 'B',
    scope: 'materiality',
    packageId: a.packageId,
    query: a.query,
    snapshot: a.snapshot,
    stepA: a,
    row,
    opposingClasses: opposing,
    records,
    material,
    immaterial: records.filter((r) => !r.material).map((r) => r.key),
    after: demoted ? { status: 'Unresolved' } : a.base,
    change: demoted ? 'DemotedToUnresolved' : 'Unchanged',
    notRun: ['StepC:Causes', 'Evidence', 'Needs'],
  } as MaterialityResult);
}
