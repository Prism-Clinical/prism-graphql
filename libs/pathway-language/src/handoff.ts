/**
 * EXPERIMENTAL, NONCLINICAL. The evidence handoff from S3 through S4 to S5 (evidence-query
 * contract §2.8, "Evidence handoff"). INTERNAL: not exported from the package index.
 *
 * A stage result carries record references, not payloads. The exact payload of each checked
 * revision or variant is bound, in this process, to the very possibility object of the result that
 * owns it. The binding is made in S3 from S1's retained variant bytes (never from record IDs
 * afterwards) and re-made by S4 for its own possibility objects. There is no lookup by record
 * identity, so two snapshots with the same IDs can never be confused, and a copied, fabricated or
 * foreign result owns no binding.
 *
 * Lifetime: as long as the result objects are reachable (WeakMap). Serializing a result keeps its
 * references and drops the binding by design: evidence is retrieved only from the in-process result
 * of the same evaluation.
 */
import { detach } from './compile/compile';
import type { JsonObject } from './s1/resolve';

/** Explicit failure of the handoff itself: never patient uncertainty. */
export class EvidenceHandoffError extends Error {}

const bound = new WeakMap<object, { readonly owner: object; readonly payload: Readonly<JsonObject> }>();

/** Binds a deep-frozen copy of `payload` to `possibility`, owned by `owner`. Rebinding is a defect. */
export function bindEvidence(owner: object, possibility: object, payload: JsonObject): void {
  if (bound.has(possibility)) throw new EvidenceHandoffError('possibility already has evidence bound');
  bound.set(possibility, { owner, payload: detach(payload) });
}

/**
 * The exact payload bound to `possibility` in `owner`. Throws EvidenceHandoffError when there is
 * no binding (a marker, an out-of-domain possibility, a copied or fabricated object) or when the
 * binding belongs to another result. Retrieval never changes the possibility's disposition.
 */
export function boundEvidence(owner: object, possibility: object): Readonly<JsonObject> {
  const b = typeof possibility === 'object' && possibility !== null ? bound.get(possibility) : undefined;
  if (!b) throw new EvidenceHandoffError('no evidence is bound to this possibility');
  if (b.owner !== owner) throw new EvidenceHandoffError('this possibility belongs to another result');
  return b.payload;
}
