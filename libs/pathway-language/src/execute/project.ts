/**
 * EXPERIMENTAL, NONCLINICAL. The `Evidence<Boolean>` → `Decision` projection (evidence-query
 * contract §5.2), shared by the isolated executor's `evidenceValue` and the S7 query decision.
 * Pure and internal: it reads only the status, value and causes. It is not exported from the
 * package, so it is no route around evaluation ownership.
 */
import type { Cause, DecisionValue } from './types';

export type ProjectableEvidence =
  | { readonly status: 'Known'; readonly value: boolean }
  | { readonly status: 'Unresolved'; readonly causes: readonly Cause[] };

/** Known(true) → True, Known(false) → False, Unresolved(causes) → Unknown(causes), causes in their given order. */
export function projectEvidence(e: ProjectableEvidence): DecisionValue {
  if (e.status === 'Known') return { value: e.value ? 'True' : 'False' };
  if (e.status === 'Unresolved') return { value: 'Unknown', causes: [...e.causes] };
  throw new Error(`invariant: evidence status ${String((e as { status: unknown }).status)}`);
}
