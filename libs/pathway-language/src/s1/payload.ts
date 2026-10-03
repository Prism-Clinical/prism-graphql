/**
 * EXPERIMENTAL, NONCLINICAL. Payload normalization and identity per CANONICALIZATION.md.
 * Serialization is delegated to `json-canonicalize` (an RFC 8785 implementation); this module
 * only selects payload fields, normalizes the declared set field and rejects lone surrogates.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import type { JsonValue } from './types';

type JsonObject = { readonly [key: string]: JsonValue };
type Declaration = Readonly<Record<string, readonly string[] | null>>;

/** Declared fields of demo-model@0.1 (CANONICALIZATION.md §2). `null`: scalar or opaque. */
const REVISION_FIELDS: Declaration = {
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
};
const RETRACTION_FIELDS: Declaration = {
  id: null,
  key: ['source', 'localId'],
  target: ['source', 'localId', 'revision'],
  author: ['actor', 'permissions'],
  provenance: ['acquisition', 'sourceRecordRef'],
};
const IDENTITY_AND_METADATA = {
  revision: ['key', 'revision', 'provenance'],
  retraction: ['id', 'provenance'],
} as const;

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
}

/** CANONICALIZATION.md §§1–7 for one occurrence. Never mutates its input. */
export function payloadIdentity(occurrence: JsonObject, kind: 'revision' | 'retraction'): PayloadIdentity {
  const decl = kind === 'revision' ? REVISION_FIELDS : RETRACTION_FIELDS;
  const undeclared: string[] = [];
  const payload: Record<string, JsonValue> = {};
  for (const [field, value] of Object.entries(occurrence)) {
    if (!(field in decl)) {
      undeclared.push(field);
      continue;
    }
    const nested = decl[field];
    let v: JsonValue = value;
    if (nested && isObject(value)) {
      const kept: Record<string, JsonValue> = {};
      for (const [sub, subValue] of Object.entries(value)) {
        if (nested.includes(sub)) kept[sub] = subValue;
        else undeclared.push(`${field}.${sub}`);
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
  const canonical = canonicalize(payload);
  return {
    canonical,
    digest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    payload,
    undeclaredPaths: undeclared.sort(),
  };
}
