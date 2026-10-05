/**
 * EXPERIMENTAL, NONCLINICAL. Payload normalization and identity per CANONICALIZATION.md.
 * Serialization is delegated to `canonicalize` 2.1.0 (an RFC 8785 implementation); this module
 * only selects payload fields, normalizes the declared set field and rejects lone surrogates.
 */
import { createHash } from 'node:crypto';
import canonicalizeJson from 'canonicalize';
import type { JsonValue, KeyResolution, NodeRef, UndeclaredField } from './types';

type JsonObject = { readonly [key: string]: JsonValue };
/**
 * Field name → declared nested names (`null`: scalar or opaque). A Map, not an object literal,
 * so lookups never see inherited properties such as `constructor` or `__proto__`.
 */
type Declaration = ReadonlyMap<string, readonly string[] | null>;
const declaration = (fields: Record<string, readonly string[] | null>): Declaration => new Map(Object.entries(fields));

/** Declared fields of demo-model@0.1 (CANONICALIZATION.md §2). */
const REVISION_FIELDS = declaration({
  key: ['source', 'localId'],
  revision: null,
  recordType: null,
  subject: null,
  supersedes: ['source', 'localId', 'revision'],
  episode: null,
  encounter: null,
  concept: ['system', 'code'],
  assertion: null,
  assertionKind: null,
  author: ['actor', 'permissions'],
  provenance: ['acquisition', 'sourceRecordRef'],
});
const RETRACTION_FIELDS = declaration({
  id: null,
  key: ['source', 'localId'],
  target: ['source', 'localId', 'revision'],
  author: ['actor', 'permissions'],
  provenance: ['acquisition', 'sourceRecordRef'],
});
const IDENTITY_AND_METADATA = {
  revision: ['key', 'revision', 'provenance'],
  retraction: ['id', 'provenance'],
} as const;

/**
 * RFC 8785 bytes of a JSON value, via the library. It calls `toJSON` only when it is a function,
 * which a JSON value never has, so a member named `toJSON` is an ordinary member.
 */
export function canonicalJson(v: JsonValue | readonly unknown[]): string {
  return canonicalizeJson(v) as string;
}

export class UnrepresentableError extends Error {}

export function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertRepresentable(v: JsonValue): void {
  if (typeof v === 'string') {
    if (LONE_SURROGATE.test(v)) throw new UnrepresentableError('lone surrogate');
  } else if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new UnrepresentableError('non-finite number');
  } else if (Array.isArray(v)) {
    v.forEach(assertRepresentable);
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      assertRepresentable(k);
      assertRepresentable(x);
    }
  }
}

export interface PayloadIdentity {
  readonly canonical: string;
  readonly digest: string;
  readonly payload: JsonObject;
  readonly undeclaredPaths: readonly string[];
  /** Undeclared fields, kept verbatim (CANONICALIZATION.md §2), sorted by path. */
  readonly undeclaredFields: readonly UndeclaredField[];
}

/** CANONICALIZATION.md §§1–7 for one occurrence. Never mutates its input. */
export function payloadIdentity(occurrence: JsonObject, kind: 'revision' | 'retraction'): PayloadIdentity {
  const decl = kind === 'revision' ? REVISION_FIELDS : RETRACTION_FIELDS;
  const undeclared: UndeclaredField[] = [];
  // Only declared names are ever assigned below, so `payload` and `kept` never receive
  // `__proto__` or another name with special meaning on a plain object.
  const payload: Record<string, JsonValue> = {};
  for (const [field, value] of Object.entries(occurrence)) {
    const nested = decl.get(field);
    if (nested === undefined) {
      undeclared.push({ path: field, value });
      continue;
    }
    let v: JsonValue = value;
    if (nested && isObject(value)) {
      const kept: Record<string, JsonValue> = {};
      for (const [sub, subValue] of Object.entries(value)) {
        if (nested.includes(sub)) kept[sub] = subValue;
        else undeclared.push({ path: `${field}.${sub}`, value: subValue });
      }
      v = kept;
    }
    if ((IDENTITY_AND_METADATA[kind] as readonly string[]).includes(field)) continue;
    payload[field] = v;
  }
  const author = payload['author'];
  if (isObject(author)) {
    const perms = author['permissions'];
    if (Array.isArray(perms) && perms.every((p): p is string => typeof p === 'string')) {
      // Set-valued field: dedupe, then sort by UTF-16 code units (CANONICALIZATION.md §5).
      payload['author'] = { ...author, permissions: [...new Set(perms)].sort() };
    }
  }
  assertRepresentable(payload);
  const canonical = canonicalJson(payload);
  const undeclaredFields = undeclared.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    canonical,
    digest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    payload,
    undeclaredPaths: undeclaredFields.map((u) => u.path),
    undeclaredFields,
  };
}

/**
 * The payload S1 retained for one possible-current node: its variant's RFC 8785 bytes, parsed.
 * Later stages read node payloads only through this, never from input rows or positions. Returns
 * null when the node names no unique variant (a node without a digest needs exactly one).
 */
export function retainedPayload(k: KeyResolution, node: NodeRef): JsonObject | null {
  const rev = k.revisions.find(
    (r) => r.ref.source === node.revision.source && r.ref.localId === node.revision.localId && r.ref.revision === node.revision.revision,
  );
  const variants = node.digest === undefined ? rev?.variants : rev?.variants.filter((v) => v.digest === node.digest);
  return variants?.length === 1 ? (JSON.parse((variants[0] as { canonicalPayload: string }).canonicalPayload) as JsonObject) : null;
}
