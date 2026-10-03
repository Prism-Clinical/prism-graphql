/**
 * EXPERIMENTAL, NONCLINICAL. S1 revision-history resolver (contract §2.1, steps 1–7).
 *
 * Pure: no I/O, no clock, no input mutation. Every decision is taken over sets keyed by
 * identity; input order, revision-ID order and timestamps never choose a revision. Output
 * lists are sorted only for stable representation (contract §5.3).
 */
import { isObject, payloadIdentity, UnrepresentableError } from './payload';
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  type Addition,
  type Defect,
  type DefectReason,
  type DefectSubject,
  type JsonValue,
  type KeyDiagnostic,
  type KeyResolution,
  type Membership,
  type NodeRef,
  type Occurrence,
  type PossibleCurrent,
  type RecordKey,
  type Rejection,
  type RetractionRef,
  type RevisionInfo,
  type RevisionRef,
  type RevisionState,
  type S1Cause,
  type S1Input,
  type S1Result,
  type Variant,
} from './types';

type JsonObject = { readonly [key: string]: JsonValue };

const CAUSE_ORDER: readonly S1Cause[] = ['Missing', 'Conflicting', 'Invalid'];

// ---------- identity helpers (tuples stay tuples; ids below are internal map keys only)

const keyId = (k: RecordKey): string => JSON.stringify([k.source, k.localId]);
const refId = (r: RevisionRef): string => JSON.stringify([r.source, r.localId, r.revision]);
const retractionId = (r: RetractionRef): string => JSON.stringify([r.source, r.id]);
const sameKey = (a: RecordKey, b: RecordKey): boolean => a.source === b.source && a.localId === b.localId;

/** Compare by Unicode code point (contract §5.3), not UTF-16 code unit. */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
const compareTuples = (a: readonly string[], b: readonly string[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = compareCodePoints(a[i] as string, b[i] as string);
    if (d !== 0) return d;
  }
  return a.length - b.length;
};
const refTuple = (r: RevisionRef): string[] => [r.source, r.localId, r.revision];

function str(v: JsonValue | undefined): v is string {
  return typeof v === 'string';
}

/** Read a RevisionRef-shaped field: 'absent' if any part is missing, 'malformed' if not strings. */
function readRef(v: JsonValue | undefined): RevisionRef | 'absent' | 'malformed' {
  if (!isObject(v)) return 'malformed';
  const s = v['source'];
  const l = v['localId'];
  const r = v['revision'];
  if (s === undefined || l === undefined || r === undefined) return 'absent';
  if (!str(s) || !str(l) || !str(r)) return 'malformed';
  return { source: s, localId: l, revision: r };
}

/** Schematic authority rule demo-policy/same-source-amend@1 (contract §1.3). */
function authority(author: JsonValue | undefined): 'authorized' | 'unauthorized' | 'missing' | 'malformed' {
  if (author === undefined) return 'missing';
  if (!isObject(author)) return 'malformed';
  const perms = author['permissions'];
  if (perms === undefined) return 'missing';
  if (!Array.isArray(perms) || !perms.every((p) => typeof p === 'string')) return 'malformed';
  return perms.includes(DEMO_AMEND_PERMISSION) ? 'authorized' : 'unauthorized';
}

// ---------- internal model

interface ParsedVariant {
  readonly digest: string;
  readonly canonical: string;
  readonly payload: JsonObject;
  readonly membership: Membership;
  readonly membershipDefects: readonly { cause: S1Cause; reason: DefectReason }[];
  readonly occurrences: Occurrence[];
}

interface RevisionGroup {
  readonly ref: RevisionRef;
  readonly variants: Map<string, ParsedVariant>; // by digest
}

interface InternalDefect {
  readonly cause: S1Cause;
  readonly reason: DefectReason;
  readonly subject: DefectSubject;
  readonly involves: readonly RevisionRef[];
  /** Additions that apply while active. */
  readonly additions: (ctx: ScopeContext) => Addition[];
  readonly active: (ctx: ScopeContext) => boolean;
}

interface ScopeContext {
  readonly finalHeads: ReadonlySet<string>; // refIds
  readonly retracted: ReadonlySet<string>; // refIds removed by valid retractions
  readonly nodes: ReadonlySet<string>;
}

function membershipOf(payload: JsonObject, env: S1Input['envelope']) {
  const defects: { cause: S1Cause; reason: DefectReason }[] = [];
  let mismatch = false;
  for (const [field, expected] of [['recordType', env.recordType], ['subject', env.subject]] as const) {
    const v = payload[field];
    if (v === undefined) defects.push({ cause: 'Missing', reason: 'EnvelopeFieldAbsent' });
    else if (!str(v)) defects.push({ cause: 'Invalid', reason: 'EnvelopeFieldMalformed' });
    else if (v !== expected) mismatch = true;
  }
  const membership: Membership = mismatch ? 'out' : defects.length > 0 ? 'undeterminable' : 'in';
  return { membership, defects: mismatch ? [] : defects };
}

const occurrenceOf = (occ: JsonObject, undeclaredPaths: readonly string[], inputIndex: number): Occurrence => ({
  provenance: occ['provenance'] ?? null,
  undeclaredPaths,
  inputIndex,
});

/**
 * EXPERIMENTAL, NONCLINICAL. Resolve the S1 revision history of every record key in the input
 * envelope. Implements contract §2.1 steps 1–7 only (no candidacy, admissibility or evidence).
 */
export function resolveRevisionHistory(input: S1Input): S1Result {
  if (input.authorityRule !== DEMO_AUTHORITY_RULE) {
    throw new Error(`Unsupported authority rule: ${String(input.authorityRule)}`);
  }
  const env = input.envelope;
  const declared = new Set(env.sources);
  const outsideEnvelope: S1Result['outsideEnvelope'][number][] = [];
  const unidentified: S1Result['unidentified'][number][] = [];
  const unattributable: S1Result['unattributableRetractions'][number][] = [];
  const rejections: Rejection[] = [];

  // ---------- Step 1: occurrences → revisions → variants, per key
  const keys = new Map<string, { key: RecordKey; groups: Map<string, RevisionGroup> }>();
  input.revisions.forEach((occ, inputIndex) => {
    const key = isObject(occ) ? occ['key'] : undefined;
    const revision = isObject(occ) ? occ['revision'] : undefined;
    if (!isObject(occ) || !isObject(key) || !str(key['source']) || !str(key['localId']) || !str(revision)) {
      unidentified.push({ kind: 'revision', inputIndex, reason: 'missing or malformed key/revision' });
      return;
    }
    const ref: RevisionRef = { source: key['source'], localId: key['localId'], revision };
    if (!declared.has(ref.source)) {
      outsideEnvelope.push({ kind: 'revision', ref });
      return;
    }
    let identity;
    try {
      identity = payloadIdentity(occ, 'revision');
    } catch (e) {
      if (!(e instanceof UnrepresentableError)) throw e;
      unidentified.push({ kind: 'revision', inputIndex, reason: `not representable under RFC 8785: ${e.message}` });
      return;
    }
    const k = keys.get(keyId(ref)) ?? { key: { source: ref.source, localId: ref.localId }, groups: new Map() };
    keys.set(keyId(ref), k);
    const g = k.groups.get(refId(ref)) ?? { ref, variants: new Map() };
    k.groups.set(refId(ref), g);
    const existing = g.variants.get(identity.digest);
    const occurrence = occurrenceOf(occ, identity.undeclaredPaths, inputIndex);
    if (existing) existing.occurrences.push(occurrence);
    else {
      const m = membershipOf(identity.payload, env);
      g.variants.set(identity.digest, {
        digest: identity.digest,
        canonical: identity.canonical,
        payload: identity.payload,
        membership: m.membership,
        membershipDefects: m.defects,
        occurrences: [occurrence],
      });
    }
  });

  // Envelope membership of keys (key-closed, contract §1.4): a key belongs when any of its
  // variants could belong (membership 'in' or 'undeterminable').
  const enveloped = new Map<string, { key: RecordKey; groups: Map<string, RevisionGroup> }>();
  for (const [id, k] of keys) {
    const possible = [...k.groups.values()].some((g) => [...g.variants.values()].some((v) => v.membership !== 'out'));
    if (possible) enveloped.set(id, k);
    else for (const g of k.groups.values()) outsideEnvelope.push({ kind: 'revision', ref: g.ref });
  }

  // ---------- Retractions: parse and group by (key.source, id) (step 6 grouping)
  const retractionGroups = new Map<string, { ref: RetractionRef; key: RecordKey; variants: Map<string, { payload: JsonObject; inputIndex: number }> }>();
  input.retractions.forEach((occ, inputIndex) => {
    const key = isObject(occ) ? occ['key'] : undefined;
    const id = isObject(occ) ? occ['id'] : undefined;
    if (!isObject(occ) || !isObject(key) || !str(key['source']) || !str(key['localId']) || !str(id)) {
      unidentified.push({ kind: 'retraction', inputIndex, reason: 'missing or malformed key/id' });
      return;
    }
    const ref: RetractionRef = { source: key['source'], id };
    if (!declared.has(ref.source)) {
      outsideEnvelope.push({ kind: 'retraction', ref });
      return;
    }
    let identity;
    try {
      identity = payloadIdentity(occ, 'retraction');
    } catch (e) {
      if (!(e instanceof UnrepresentableError)) throw e;
      unidentified.push({ kind: 'retraction', inputIndex, reason: `not representable under RFC 8785: ${e.message}` });
      return;
    }
    const g = retractionGroups.get(retractionId(ref)) ?? {
      ref,
      key: { source: key['source'], localId: key['localId'] },
      variants: new Map(),
    };
    retractionGroups.set(retractionId(ref), g);
    if (!g.variants.has(identity.digest)) g.variants.set(identity.digest, { payload: identity.payload, inputIndex });
  });

  // ---------- Per-key analysis, steps 1–5
  interface KeyState {
    key: RecordKey;
    groups: Map<string, RevisionGroup>;
    nodes: Set<string>; // non-rejected, in-envelope or undeterminable revisions (incl. conflicted)
    conflicted: Set<string>;
    outOfEnvelope: Set<string>;
    rejected: Set<string>;
    defects: InternalDefect[];
    validEdges: [from: string, to: string][];
    heads: Set<string>;
    retracted: Set<string>;
    diagnostics: KeyDiagnostic[];
  }
  const states = new Map<string, KeyState>();
  const refById = new Map<string, RevisionRef>();

  for (const [kid, k] of enveloped) {
    const st: KeyState = {
      key: k.key,
      groups: k.groups,
      nodes: new Set(),
      conflicted: new Set(),
      outOfEnvelope: new Set(),
      rejected: new Set(),
      defects: [],
      validEdges: [],
      heads: new Set(),
      retracted: new Set(),
      diagnostics: [],
    };
    states.set(kid, st);
    for (const [rid, g] of k.groups) {
      refById.set(rid, g.ref);
      const variants = [...g.variants.values()];
      if (variants.length > 1) {
        // Step 1: conflicted revision (genuine contradictory data, never a boundary rejection).
        st.nodes.add(rid);
        st.conflicted.add(rid);
        const anyNotIn = variants.some((v) => v.membership !== 'in');
        st.defects.push({
          cause: 'Conflicting',
          reason: 'PayloadConflict',
          subject: { kind: 'revision', ref: g.ref },
          involves: [g.ref],
          additions: () => (anyNotIn ? ['excluded'] : []),
          active: (ctx) => ctx.finalHeads.has(rid),
        });
        continue;
      }
      const v = variants[0] as ParsedVariant;
      // Step 2: envelope membership of ordinary revisions.
      if (v.membership === 'out') {
        st.outOfEnvelope.add(rid);
        continue;
      }
      st.nodes.add(rid);
      for (const d of v.membershipDefects) {
        st.defects.push({
          ...d,
          subject: { kind: 'revision', ref: g.ref },
          involves: [g.ref],
          additions: () => ['excluded'],
          active: (ctx) => ctx.finalHeads.has(rid),
        });
      }
    }
  }

  // Step 3: correction edges (ordinary nodes only; conflicted revisions' own edges are not applied).
  const crossKeyDiagnostics: { target: RevisionRef; diag: KeyDiagnostic }[] = [];
  for (const st of states.values()) {
    const sortedNodes = [...st.nodes].sort();
    for (const rid of sortedNodes) {
      if (st.conflicted.has(rid)) continue;
      const g = st.groups.get(rid) as RevisionGroup;
      const v = [...g.variants.values()][0] as ParsedVariant;
      if (!('supersedes' in v.payload)) continue;
      const source = g.ref;
      const sourceInH = (ctx: ScopeContext) => ctx.finalHeads.has(rid);
      const t = readRef(v.payload['supersedes']);
      const edgeDefect = (
        cause: S1Cause,
        reason: DefectReason,
        active: (ctx: ScopeContext) => boolean,
        additions: (ctx: ScopeContext) => Addition[] = () => [],
        involves: RevisionRef[] = [source],
      ) => st.defects.push({ cause, reason, subject: { kind: 'revision', ref: source }, involves, active, additions });
      // Undeterminable edge: active while its target is a head; adds `excluded` if the source
      // was removed by a valid retraction (contract §2.1 step 7).
      const undeterminable = (cause: S1Cause, reason: DefectReason, target: RevisionRef) => {
        const tid = refId(target);
        edgeDefect(cause, reason, (ctx) => ctx.finalHeads.has(tid), (ctx) => (ctx.retracted.has(rid) ? ['excluded'] : []), [source, target]);
      };
      if (t === 'absent') {
        edgeDefect('Missing', 'CorrectionRefIncomplete', sourceInH);
        continue;
      }
      if (t === 'malformed') {
        edgeDefect('Invalid', 'CorrectionRefMalformed', sourceInH);
        continue;
      }
      if (!sameKey(t, source)) {
        st.nodes.delete(rid);
        st.rejected.add(rid);
        rejections.push({ item: { kind: 'revision', ref: source }, reason: 'CrossKeyCorrection', target: t });
        crossKeyDiagnostics.push({ target: t, diag: { code: 'CrossKeyCorrection', from: source, target: t } });
        continue;
      }
      const tid = refId(t);
      const targetGroup = st.groups.get(tid);
      if (v.membership === 'undeterminable') {
        // Step 2: an edge from a revision of undeterminable membership is undeterminable.
        // Self-reference and an absent target are structural facts and are classified first.
        if (tid === rid) edgeDefect('Invalid', 'SelfSupersession', sourceInH);
        else if (!targetGroup) edgeDefect('Missing', 'CorrectionTargetAbsent', sourceInH, () => ['unknown']);
        else for (const d of v.membershipDefects) undeterminable(d.cause, d.reason, t);
        continue;
      }
      if (targetGroup && targetGroup.variants.size === 1) {
        const tv = [...targetGroup.variants.values()][0] as ParsedVariant;
        if (tv.membership === 'out') {
          const subjectDiffers = tv.payload['subject'] !== env.subject;
          st.nodes.delete(rid);
          st.rejected.add(rid);
          rejections.push({ item: { kind: 'revision', ref: source }, reason: subjectDiffers ? 'SubjectChanged' : 'RecordTypeChanged', target: t });
          continue;
        }
      }
      if (targetGroup && targetGroup.variants.size > 1) {
        const tvs = [...targetGroup.variants.values()];
        const disagree = new Set(tvs.map((x) => JSON.stringify([x.payload['recordType'], x.payload['subject']]))).size > 1;
        if (disagree) {
          undeterminable('Conflicting', 'CorrectionBoundaryUndeterminable', t);
          continue;
        }
      }
      if (tid === rid) {
        edgeDefect('Invalid', 'SelfSupersession', sourceInH);
        continue;
      }
      if (!targetGroup) {
        edgeDefect('Missing', 'CorrectionTargetAbsent', sourceInH, () => ['unknown']);
        continue;
      }
      const auth = authority(v.payload['author']);
      if (auth === 'unauthorized') {
        st.nodes.delete(rid);
        st.rejected.add(rid);
        rejections.push({ item: { kind: 'revision', ref: source }, reason: 'Unauthorized', target: t });
        continue;
      }
      if (auth === 'missing') {
        undeterminable('Missing', 'CorrectionAuthorityMissing', t);
        continue;
      }
      if (auth === 'malformed') {
        undeterminable('Invalid', 'CorrectionAuthorityMalformed', t);
        continue;
      }
      st.validEdges.push([rid, tid]);
    }
  }
  for (const { target, diag } of crossKeyDiagnostics) states.get(keyId(target))?.diagnostics.push(diag);

  for (const st of states.values()) {
    // Edges whose source was rejected (in another pass) are not valid; targets may be non-nodes.
    st.validEdges = st.validEdges.filter(([from]) => st.nodes.has(from));
    // Step 4: cycles among valid edges (strongly connected components larger than one node).
    const components = stronglyConnected([...st.nodes], st.validEdges);
    for (const comp of components) {
      if (comp.length < 2) continue;
      const members = new Set(comp);
      st.validEdges = st.validEdges.filter(([a, b]) => !(members.has(a) && members.has(b)));
      st.defects.push({
        cause: 'Invalid',
        reason: 'Cycle',
        subject: { kind: 'key', ref: st.key },
        involves: comp.map((id) => refById.get(id) as RevisionRef),
        additions: () => [],
        active: (ctx) => comp.some((id) => ctx.finalHeads.has(id)),
      });
    }
    // Step 5: heads; a fork is recorded only when no defect was recorded in steps 1–4.
    const superseded = new Set(st.validEdges.map(([, to]) => to));
    for (const n of st.nodes) if (!superseded.has(n)) st.heads.add(n);
    if (st.heads.size > 1 && st.defects.length === 0) {
      const branches = [...st.heads];
      st.defects.push({
        cause: 'Conflicting',
        reason: 'Fork',
        subject: { kind: 'key', ref: st.key },
        involves: branches.map((id) => refById.get(id) as RevisionRef),
        additions: () => [],
        active: (ctx) => branches.filter((b) => ctx.finalHeads.has(b)).length >= 2,
      });
    }
  }

  // ---------- Step 6: retractions
  for (const g of retractionGroups.values()) {
    const variants = [...g.variants.values()];
    if (variants.length > 1) {
      // Conflicted retraction: each in-envelope key any variant targets gets Conflicting + excluded.
      const targets = new Map<string, RevisionRef>();
      for (const rv of variants) {
        const t = readRef(rv.payload['target']);
        if (typeof t !== 'string') targets.set(refId(t), t);
      }
      for (const [tid, t] of targets) {
        const st = states.get(keyId(t));
        if (!st) continue;
        st.defects.push(retractionDefect('Conflicting', 'RetractionConflict', g.ref, t, tid, st));
      }
      continue;
    }
    const payload = (variants[0] as { payload: JsonObject }).payload;
    const t = readRef(payload['target']);
    if (t === 'absent' || t === 'malformed') {
      unattributable.push({ ref: g.ref, cause: t === 'absent' ? 'Missing' : 'Invalid' });
      continue;
    }
    if (!sameKey(t, g.key)) {
      rejections.push({ item: { kind: 'retraction', ref: g.ref }, reason: 'CrossKeyRetraction', target: t });
      states.get(keyId(t))?.diagnostics.push({ code: 'CrossKeyRetraction', from: g.ref, target: t });
      continue;
    }
    const st = states.get(keyId(t));
    if (!st) {
      outsideEnvelope.push({ kind: 'retraction', ref: g.ref }); // target key not in the envelope: traced only
      continue;
    }
    const tid = refId(t);
    if (st.outOfEnvelope.has(tid)) {
      st.diagnostics.push({ code: 'RetractionTargetsOutOfEnvelopeRevision', from: g.ref, target: t });
      continue;
    }
    if (st.rejected.has(tid)) {
      st.diagnostics.push({ code: 'RetractionTargetsRejectedRevision', from: g.ref, target: t });
      continue;
    }
    if (!st.groups.has(tid)) {
      st.defects.push({
        cause: 'Missing',
        reason: 'RetractionTargetAbsent',
        subject: { kind: 'retraction', ref: g.ref },
        involves: [],
        additions: () => ['excluded'],
        active: (ctx) => [...ctx.finalHeads].some((h) => st.nodes.has(h)),
      });
      continue;
    }
    const auth = authority(payload['author']);
    if (auth === 'unauthorized') {
      rejections.push({ item: { kind: 'retraction', ref: g.ref }, reason: 'Unauthorized', target: t });
      continue;
    }
    if (auth === 'missing' || auth === 'malformed') {
      st.defects.push(
        retractionDefect(auth === 'missing' ? 'Missing' : 'Invalid', auth === 'missing' ? 'RetractionAuthorityMissing' : 'RetractionAuthorityMalformed', g.ref, t, tid, st),
      );
      continue;
    }
    if (st.heads.has(tid)) st.retracted.add(tid);
    else st.diagnostics.push({ code: 'RetractionTargetsSupersededRevision', from: g.ref, target: t });
  }

  // ---------- Step 7: scope defects and decide
  const results: KeyResolution[] = [];
  for (const st of states.values()) {
    const finalHeads = new Set([...st.heads].filter((h) => !st.retracted.has(h)));
    const ctx: ScopeContext = { finalHeads, retracted: st.retracted, nodes: st.nodes };
    const active: Defect[] = [];
    const historical: Defect[] = [];
    const causes = new Set<S1Cause>();
    const additions = new Set<Addition>();
    for (const d of st.defects) {
      const involves = [...d.involves].sort((a, b) => compareTuples(refTuple(a), refTuple(b)));
      const pub: Defect = { cause: d.cause, reason: d.reason, subject: d.subject, involves, additions: d.active(ctx) ? d.additions(ctx) : [] };
      if (d.active(ctx)) {
        active.push(pub);
        causes.add(d.cause);
        pub.additions.forEach((a) => additions.add(a));
      } else historical.push({ ...pub, additions: [] });
    }
    let status: KeyResolution['status'];
    let current: NodeRef | null = null;
    let contractGap: string | null = null;
    if (st.nodes.size === 0 && causes.size === 0 && additions.size === 0) status = 'NoRecord';
    else if (causes.size === 0 && additions.size === 0) {
      if (finalHeads.size === 1) {
        status = 'Current';
        current = { revision: refById.get([...finalHeads][0] as string) as RevisionRef };
      } else if (finalHeads.size === 0) status = 'Retracted';
      else {
        status = 'ContractUndefined';
        contractGap =
          'Several heads remain with no active defect: a fork was not recorded at step 5 because another defect existed, and that defect is now historical. Contract §2.1 step 7 then yields UnresolvedRevision with an empty cause set, which Stage A §4.1 forbids.';
      }
    } else status = 'UnresolvedRevision';

    const possibleCurrent: PossibleCurrent[] = [];
    if (status === 'UnresolvedRevision') {
      for (const h of sortIds([...finalHeads], refById)) {
        const g = st.groups.get(h) as RevisionGroup;
        if (st.conflicted.has(h)) {
          for (const v of sortVariants([...g.variants.values()])) {
            if (v.membership !== 'out') possibleCurrent.push({ kind: 'node', node: { revision: g.ref, digest: v.digest } });
          }
        } else possibleCurrent.push({ kind: 'node', node: { revision: g.ref } });
      }
      for (const a of ['excluded', 'unknown'] as const) if (additions.has(a)) possibleCurrent.push({ kind: a });
    }

    const revisions: RevisionInfo[] = sortIds([...st.groups.keys()], refById).map((rid) => {
      const g = st.groups.get(rid) as RevisionGroup;
      let state: RevisionState;
      if (st.outOfEnvelope.has(rid)) state = 'outOfEnvelope';
      else if (st.rejected.has(rid)) state = 'rejected';
      else if (st.retracted.has(rid)) state = 'retracted';
      else if (st.heads.has(rid)) state = 'head';
      else state = 'superseded';
      return { ref: g.ref, state, variants: sortVariants([...g.variants.values()]).map(publicVariant) };
    });

    results.push({
      key: st.key,
      status,
      current,
      causes: status === 'UnresolvedRevision' ? CAUSE_ORDER.filter((c) => causes.has(c)) : [],
      possibleCurrent,
      activeDefects: sortDefects(active),
      historicalDefects: sortDefects(historical),
      revisions,
      diagnostics: [...st.diagnostics].sort((a, b) => compareTuples(diagnosticTuple(a), diagnosticTuple(b))),
      contractGap,
    });
  }

  return {
    experimental: 'nonclinical-s1-v0',
    keys: results.sort((a, b) => compareTuples([a.key.source, a.key.localId], [b.key.source, b.key.localId])),
    rejections: rejections.sort((a, b) => compareTuples(itemTuple(a), itemTuple(b))),
    outsideEnvelope: outsideEnvelope.sort((a, b) =>
      compareTuples(a.kind === 'revision' ? refTuple(a.ref) : [a.ref.source, a.ref.id], b.kind === 'revision' ? refTuple(b.ref) : [b.ref.source, b.ref.id]),
    ),
    unidentified: unidentified.sort((a, b) => compareCodePoints(a.kind, b.kind) || a.inputIndex - b.inputIndex),
    unattributableRetractions: unattributable.sort((a, b) => compareTuples([a.ref.source, a.ref.id], [b.ref.source, b.ref.id])),
  };

  function retractionDefect(cause: S1Cause, reason: DefectReason, ref: RetractionRef, t: RevisionRef, tid: string, st: KeyState): InternalDefect {
    const targetPresent = st.groups.has(tid);
    return {
      cause,
      reason,
      subject: { kind: 'retraction', ref },
      involves: targetPresent ? [t] : [],
      additions: () => ['excluded'],
      active: (ctx) => (targetPresent ? ctx.finalHeads.has(tid) : [...ctx.finalHeads].some((h) => st.nodes.has(h))),
    };
  }
}

// ---------- helpers

function itemTuple(r: Rejection): string[] {
  return r.item.kind === 'revision' ? ['revision', ...refTuple(r.item.ref)] : ['retraction', r.item.ref.source, r.item.ref.id];
}

function sortIds(ids: string[], refs: Map<string, RevisionRef>): string[] {
  return ids.sort((a, b) => compareTuples(refTuple(refs.get(a) as RevisionRef), refTuple(refs.get(b) as RevisionRef)));
}

function sortVariants<T extends { digest: string }>(vs: T[]): T[] {
  return vs.sort((a, b) => compareCodePoints(a.digest, b.digest));
}

function publicVariant(v: ParsedVariant): Variant {
  return {
    digest: v.digest,
    canonicalPayload: v.canonical,
    membership: v.membership,
    // Contract §5.3: by provenance.acquisition, then provenance.sourceRecordRef (code point).
    // Input index only separates occurrences with identical provenance.
    occurrences: [...v.occurrences].sort(
      (a, b) => compareTuples(provenanceTuple(a), provenanceTuple(b)) || a.inputIndex - b.inputIndex,
    ),
  };
}

function diagnosticTuple(d: KeyDiagnostic): string[] {
  const from = 'revision' in d.from ? refTuple(d.from) : [d.from.source, d.from.id];
  return [d.code, ...refTuple(d.target), ...from];
}

function provenanceTuple(o: Occurrence): string[] {
  const p = o.provenance;
  const field = (k: string) => (isObject(p) && typeof p[k] === 'string' ? (p[k] as string) : '');
  return [field('acquisition'), field('sourceRecordRef'), JSON.stringify(p)];
}

function subjectTuple(s: DefectSubject): string[] {
  if (s.kind === 'revision') return ['revision', ...refTuple(s.ref)];
  if (s.kind === 'key') return ['key', s.ref.source, s.ref.localId];
  return ['retraction', s.ref.source, s.ref.id];
}

function sortDefects(ds: Defect[]): Defect[] {
  return ds.sort(
    (a, b) =>
      CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause) ||
      compareCodePoints(a.reason, b.reason) ||
      compareTuples(subjectTuple(a.subject), subjectTuple(b.subject)),
  );
}

/** Iterative Tarjan SCC; finite and order-insensitive in the components it returns. */
function stronglyConnected(nodes: string[], edges: [string, string][]): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const [a, b] of edges) if (adj.has(a) && adj.has(b)) (adj.get(a) as string[]).push(b);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const start of [...nodes].sort()) {
    if (idx.has(start)) continue;
    const work: [string, number][] = [[start, 0]];
    while (work.length > 0) {
      const frame = work[work.length - 1] as [string, number];
      const [v, i] = frame;
      if (i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
      }
      const succ = adj.get(v) as string[];
      if (i < succ.length) {
        frame[1] = i + 1;
        const w = succ[i] as string;
        if (!idx.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent[0], Math.min(low.get(parent[0]) as number, low.get(v) as number));
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        out.push(comp.sort());
      }
    }
  }
  return out;
}

export type { JsonObject };
