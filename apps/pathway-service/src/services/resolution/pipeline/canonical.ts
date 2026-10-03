import { createHash } from 'crypto';

/**
 * JSON with object keys sorted at every depth. Maps become entry arrays sorted
 * by key; Sets become arrays sorted by canonical form; `undefined` object
 * fields are dropped. Arrays keep their order, so a caller sorts any array
 * whose order carries no meaning.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, x]) => [k, normalize(x)] as const)
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  }
  if (v instanceof Set) {
    return [...v].map(normalize).sort((a, b) => {
      const x = JSON.stringify(a); const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalize(x);
    }
    return out;
  }
  return v;
}

export const hashOf = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
