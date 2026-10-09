#!/usr/bin/env node
// Verifies canonical bytes, digests and variant identities with a maintained RFC 8785
// implementation: the npm package `canonicalize` (S. Erdtman, an RFC 8785 author).
// It covers every payload, including the numbers that validate.py defers.
// This is not an evaluator: it checks payload equality and identifiers only.
//
// Run without adding a dependency to the repository:
//   TMP=$(mktemp -d) && npm install --no-save --prefix "$TMP" canonicalize@5.1.0 \
//     && NODE_PATH="$TMP/node_modules" node check-canonical.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('canonicalize'); // ES module; Node >= 20.19 supports require() of it
const canonicalize = typeof lib === 'function' ? lib : lib.default;

const HERE = __dirname;
const DECL = {
  key: ['source', 'localId'], revision: null, recordType: null, subject: null,
  supersedes: ['source', 'localId', 'revision'], episode: null, encounter: null,
  concept: ['system', 'code'], assertion: null, assertionKind: null,
  author: ['actor', 'permissions'], provenance: ['acquisition', 'sourceRecordRef'],
};
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// CANONICALIZATION.md sections 1-5: payload normalization (not serialization).
function payload(occ) {
  const out = {};
  for (const [k, v] of Object.entries(occ)) {
    if (!Object.hasOwn(DECL, k)) continue; // own names only: never constructor, __proto__, ...
    const sub = DECL[k];
    out[k] = sub && v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([k2]) => sub.includes(k2)))
      : v;
  }
  delete out.key; delete out.revision; delete out.provenance;
  const perms = out.author && typeof out.author === 'object' ? out.author.permissions : undefined;
  if (Array.isArray(perms) && perms.every((p) => typeof p === 'string')) {
    out.author = { ...out.author, permissions: [...new Set(perms)].sort() }; // sort(): UTF-16 code units
  }
  return out;
}

// 1. The library against RFC 8785 Appendix B (IEEE 754 bits -> expected serialization).
const APPENDIX_B = [
  ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'], ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'], ['4340000000000000', '9007199254740992'],
  ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'], ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'], ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'], ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'],
];
for (const [hex, want] of APPENDIX_B) {
  const got = canonicalize(Buffer.from(hex, 'hex').readDoubleBE(0));
  if (got !== want) err('rfc8785-appendix-b', `${hex}: got ${got}, want ${want}`);
}

// 2. Canonicalization fixtures and 3. variant identities in evaluation fixtures.
let canonChecked = 0;
let variantChecked = 0;
const fxDir = path.join(HERE, 'fixtures');
for (const name of fs.readdirSync(fxDir).sort()) {
  const fx = JSON.parse(fs.readFileSync(path.join(fxDir, name), 'utf8'));
  if (fx.kind === 'canonicalization') {
    const raws = fx.input.rawOccurrences;
    for (const v of fx.expected.variants) {
      if (sha(v.canonicalBytes) !== v.digest) err(fx.id, 'digest does not match canonicalBytes');
      for (const o of v.occurrences) {
        const got = canonicalize(payload(JSON.parse(raws[o])));
        canonChecked += 1;
        if (got !== v.canonicalBytes) err(fx.id, `occurrence ${o} canonicalizes to ${got}`);
      }
    }
    continue;
  }
  if (fx.kind !== 'evaluation' && fx.kind !== 'stage') continue;
  const groups = new Map();
  for (const occ of fx.input.records) {
    const ref = `${occ.key.source}/${occ.key.localId}@${occ.revision}`;
    const id = `${ref}#${sha(canonicalize(payload(occ)))}`;
    if (!groups.has(ref)) groups.set(ref, new Map());
    const g = groups.get(ref);
    g.set(id, (g.get(id) || 0) + 1);
  }
  for (const t of fx.expected.traceAssertions) {
    if (t.fact === 'variants') {
      variantChecked += 1;
      const got = [...(groups.get(t.ref) || new Map()).keys()].sort();
      if (JSON.stringify(got) !== JSON.stringify([...t.value].sort())) err(fx.id, `variants for ${t.ref}: ${got}`);
    }
    if (t.fact === 'occurrences') {
      variantChecked += 1;
      const g = groups.get(t.ref);
      if (!g || g.size !== 1 || [...g.values()][0] !== t.count) {
        err(fx.id, `${t.ref} is not one variant with ${t.count} occurrences`);
      }
    }
  }
}

if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: RFC 8785 Appendix B (${APPENDIX_B.length} vectors), ${canonChecked} canonicalization occurrences, `
  + `${variantChecked} variant/occurrence assertions`);
