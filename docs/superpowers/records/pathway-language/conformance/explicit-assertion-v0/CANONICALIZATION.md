# Payload equality and canonicalization (`demo-model@0.1`)

**Status:** Proposed. This note is normative for the [evidence-query-to-predicate contract](../../evidence-query-to-predicate-contract.md) (§1.2, §2.1 steps 1 and 6) and for these fixtures. It is not accepted and not implemented. All content is fictional and nonclinical.

Equality is defined first (sections 1–6). The digest in section 7 is only an identifier derived from that equality: it never decides which variant is clinically preferred, and neither does lexical order.

## 1. Occurrences, payload and metadata

An **occurrence** is one row as received. Occurrences are grouped by identity:

| Item | Identity | Semantic payload | Occurrence metadata (not payload) |
|---|---|---|---|
| Revision | `RevisionRef` = (`key.source`, `key.localId`, `revision`) | `recordType`, `subject`, `supersedes`, `episode`, `encounter`, `concept`, `assertion`, `assertionKind`, `author` (`actor`, `permissions`) | `provenance` (`acquisition`, `sourceRecordRef`) |
| Retraction | (`key.source`, `id`) | `key`, `target`, `author` | `provenance` |

- **Metadata.** Different acquisition attempts or source record references never make two occurrences different. Duplicate occurrences form one variant, and the trace lists every occurrence’s metadata (contract §5.3 ordering). No clinical evidence is counted twice and no conflict is invented.
- **Fields that affect authority, correction history, scope or clinical expressions are all payload.** These are `author`, `supersedes`, `subject`, `recordType`, `episode`, `encounter`, `concept`, `assertion` and `assertionKind`. None is normalized away.

## 2. Declared and undeclared fields

`demo-model@0.1` declares exactly the fields above, plus these nested fields:

- `key {source, localId}`;
- `supersedes` / `target {source, localId, revision}`;
- `concept {system, code}`;
- `author {actor, permissions}`;
- `provenance {acquisition, sourceRecordRef}`.

Any other field, at any depth, is **undeclared**. It is removed from the payload, kept verbatim with its occurrence, and reported as diagnostic `UndeclaredField(<path>)`. It cannot affect results, because the compiler-visible read sets (contract §3.2) can reference only declared fields.

## 3. Absent, null and malformed

| Received | Meaning | In payload |
|---|---|---|
| Field omitted | `Absent` | Omitted |
| `null` | Present, **malformed** | Kept as `null` |
| Wrong JSON type, or a string outside a pinned enum | Present, **malformed** | Kept verbatim |

`Absent`, `null` and each distinct malformed value are all different payload values.

## 4. Strings and numbers

- **Strings** are compared as exact sequences of Unicode scalar values. There is no normalization, case folding or trimming.
- **Numbers.** `demo-model@0.1` declares no numeric field, so a number in a declared field is malformed and kept as a value. As in RFC 8785, each JSON number is read as the nearest IEEE-754 double and serialized with the ECMAScript `Number.prototype.toString` algorithm. Two numbers are equal if and only if those serializations are identical. Hence:
  - `1`, `1.0` and `1E0` are equal (`1`);
  - `0` and `-0.0` are equal (`0`);
  - `1e21` and `1000000000000000000000` are equal (`1e+21`);
  - `1` and `2` differ.

  A future model with numeric *declared* fields needs its own clinical numeric-equality rule. Units and precision are not addressed here.

## 5. Arrays and sets

- Arrays are **ordered** by default.
- The only set-valued field is `author.permissions` (`Set<Permission>`). If it is well-formed (an array of strings), duplicates are removed and the remaining strings are sorted by UTF-16 code units, the same rule RFC 8785 uses for keys. If it is malformed (not an array, or containing a non-string), it is kept verbatim with its order.

## 6. Equality

Two occurrences with the same identity have **equal payloads** if and only if their normalized payloads are equal JSON values. Normalization applies sections 1–5:

- object members are compared by name, irrespective of order;
- arrays are compared element by element, in order, after the set normalization of section 5;
- strings are compared exactly;
- `null` equals only `null`.

Equal payloads form one **variant**. Two or more variants under one identity is contradictory data (contract §2.1 step 1).

## 7. Canonical bytes, digest and variant identity

- **Canonical bytes:** the UTF-8 encoding of the RFC 8785 (JSON Canonicalization Scheme) serialization of the normalized payload. Equal payloads have identical canonical bytes, and vice versa. RFC 8785 fixes:
  - member order by UTF-16 code units;
  - strings with only `"`, `\` and U+0000–U+001F escaped (`\b \t \n \f \r`, else `\u00xx` lower-case), everything else literal;
  - the number form above;
  - no whitespace.
- **Input RFC 8785 cannot represent:** a non-finite number, a duplicate member name or a lone surrogate. Such an occurrence is not valid I-JSON. It is an unparseable item, a rejected item under contract §1.7, and never a payload variant. `validate.py` rejects such fixture content explicitly.
- **Digest:** SHA-256 over the canonical bytes, written as 64 lower-case hex characters.
- **Variant identity:** `<source>/<localId>@<revision>#<digest>`. Revisions with a single variant are referenced without the suffix.
- **Ordering** of variants and other identity lists follows contract §5.3. It is representation only.

## 8. Worked example

Payload of occurrence A of `s1/r1@1`, received with keys in a different order and a duplicate permission:

```json
{"assertion":"Affirmed","author":{"permissions":["p","demo.permission.amend-record","p"],"actor":"u1"},"subject":"P1"}
```

The normalized canonical bytes are:

```text
{"assertion":"Affirmed","author":{"actor":"u1","permissions":["demo.permission.amend-record","p"]},"subject":"P1"}
```

**Verification.** Canonical bytes and digests in the fixtures are checked by `check-canonical.cjs`, which uses the maintained RFC 8785 implementation `canonicalize@5.1.0` (npm, by S. Erdtman). That library is itself checked against the RFC 8785 Appendix B number vectors. `validate.py` serializes only the number-free subset and reports numeric payloads as deferred, never as verified.

This example is shortened to three fields. Full payloads appear in fixture `CAN-01`, with their expected canonical bytes and digests.
