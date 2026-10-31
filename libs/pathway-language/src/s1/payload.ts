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

/**
 * Why `v` is not a plain JSON value, as `<path>: <reason>`, or null. Run before canonicalization:
 * RFC 8785 serialization silently skips or rewrites what JSON cannot hold (a sparse slot, an extra
 * array member, an accessor, a symbol key, `undefined`), so serializing is not validating.
 * `ancestors` is the current chain of containers (object → its path): a value that is its own
 * ancestor is a cycle. An object shared by separate branches is not on its own chain, so it passes.
 * Depth: the root value's own members and elements are level 1 (for a snapshot list, each
 * statement), and each nested array or object adds one. A container deeper than
 * MAX_JSON_DEPTH is rejected before any recursion past it, so very deep input cannot overflow.
 */
export const MAX_JSON_DEPTH = 32;

export function jsonValueProblem(v: unknown, path: string, ancestors: Map<object, string> = new Map()): string | null {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'string') return LONE_SURROGATE.test(v) ? `${path}: lone surrogate` : null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}: non-finite number`;
  if (typeof v !== 'object') return `${path}: ${typeof v} is not JSON`;
  const back = ancestors.get(v);
  if (back !== undefined) return `${path}: cycle (refers back to ${back})`;
  // The chain holds this container's ancestors, so its size is this container's level.
  if (ancestors.size > MAX_JSON_DEPTH) return `${path}: nested more than ${MAX_JSON_DEPTH} levels deep`;
  ancestors.set(v, path);
  try {
    return containerProblem(v, path, ancestors);
  } finally {
    ancestors.delete(v);
  }
}

function containerProblem(v: object, path: string, ancestors: Map<object, string>): string | null {
  const keys = Reflect.ownKeys(v);
  if (keys.some((k) => typeof k !== 'string')) return `${path}: symbol key`;
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) return `${path}: not a plain array`;
    // Index loop: every slot must be an own data element; no other member than `length`.
    if (keys.length !== v.length + 1) return `${path}: sparse array or extra array member`;
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, i);
      if (!d || !('value' in d)) return `${path}[${i}]: missing or accessor element (sparse array)`;
      const p = jsonValueProblem(d.value, `${path}[${i}]`, ancestors);
      if (p) return p;
    }
    return null;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return `${path}: not a plain object`;
  for (const k of keys as string[]) {
    const d = Object.getOwnPropertyDescriptor(v, k)!;
    if (!('value' in d) || !d.enumerable) return `${path}.${k}: accessor or non-enumerable member`;
    if (LONE_SURROGATE.test(k)) return `${path}: member name with a lone surrogate`;
    const p = jsonValueProblem(d.value, `${path}.${k}`, ancestors);
    if (p) return p;
  }
  return null;
}

/**
 * Why a whole S1 occurrence (identity, payload, provenance and undeclared fields, everything S1
 * canonicalizes or retains) cannot be traversed, or null: a cycle on the current ancestor chain, or
 * nesting deeper than MAX_JSON_DEPTH with the occurrence itself as level 1. Shared acyclic objects
 * pass. Nothing past the limit is visited. Other JSON problems stay with assertRepresentable.
 */
export function nestingProblem(v: unknown, path: string, ancestors: Map<object, string> = new Map()): string | null {
  if (v === null || typeof v !== 'object') return null;
  const back = ancestors.get(v);
  if (back !== undefined) return `${path}: cycle (refers back to ${back})`;
  if (ancestors.size >= MAX_JSON_DEPTH) return `${path}: nested more than ${MAX_JSON_DEPTH} levels deep`;
  ancestors.set(v, path);
  try {
    for (const [k, x] of Object.entries(v)) {
      const p = nestingProblem(x, Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, ancestors);
      if (p) return p;
    }
    return null;
  } finally {
    ancestors.delete(v);
  }
}

function assertRepresentable(v: JsonValue): void {
  if (typeof v === 'string') {
    if (LONE_SURROGATE.test(v)) throw new UnrepresentableError('lone surrogate (RFC 8785)');
  } else if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new UnrepresentableError('non-finite number (RFC 8785)');
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

/**
 * CANONICALIZATION.md §§1–7 for one occurrence. Never mutates its input. `path` names the
 * occurrence in UnrepresentableError messages.
 */
export function payloadIdentity(occurrence: JsonObject, kind: 'revision' | 'retraction', path: string = kind): PayloadIdentity {
  // Before anything is read, selected or retained: the whole occurrence, not only digest fields.
  const shape = nestingProblem(occurrence, path);
  if (shape) throw new UnrepresentableError(shape);
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
