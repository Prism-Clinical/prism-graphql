/**
 * EXPERIMENTAL, NONCLINICAL. Shared builders for the S6 step A and step B tests: one compiled demo
 * query, fictional demo-model records and snapshot statements. Builders only; no expectations.
 */
import {
  DEMO_AMEND_PERMISSION,
  DEMO_AUTHORITY_RULE,
  SAME_ENCOUNTER_RULE,
  SAME_EPISODE_RULE,
  experimentalCompile,
  experimentalSelectForQuery,
  type CompiledPackage,
  type EvaluationSnapshot,
  type JsonValue,
  type NodeRef,
  type SelectionResult,
} from '../../index';

export type J = { [k: string]: any };
export const T = 'demo-model/DemoAssessment@0.1';
export const PIN = 'demo-vs/item-x@1';
export const AMEND = { actor: 'u2', permissions: [DEMO_AMEND_PERMISSION] };

export function program(id = 'q'): J {
  return {
    ppl: { languageVersion: 'ppl-1', capabilityProfileVersion: 'ppl-core-v0' },
    package: { id: 'test.s6a', state: 'Draft' },
    references: [],
    valueSets: { [PIN]: { expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] } },
    applicability: { id: 'scope', kind: 'Predicate', expr: { all: [] } },
    nodes: [
      {
        id,
        kind: 'EvidenceQuery',
        subject: 'patient',
        output: 'Evidence<Boolean>',
        contract: {
          retrieve: { type: T, sources: ['s1', 's2'], valueSet: PIN },
          corrections: { authority: DEMO_AUTHORITY_RULE },
          admissible: { episode: SAME_EPISODE_RULE, encounter: SAME_ENCOUNTER_RULE, assertionKind: { in: ['ClinicianDocumented'] } },
          policy: 'explicit-assertion-v0',
          establishes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Affirmed' }] },
          refutes: { eq: [{ field: ['c', 'assertion'] }, { enum: 'AssertionValue.Denied' }] },
          obligations: [{ disjoint: ['establishes', 'refutes'] }],
        },
      },
      { id: 'pv', kind: 'Predicate', expr: { evidenceValue: { ref: id } } },
    ],
  };
}
export function compiled(p: J = program()): CompiledPackage {
  const r = experimentalCompile(p as JsonValue);
  if (r.outcome !== 'Compiled') throw new Error(JSON.stringify(r.diagnostics));
  return r.package;
}
export const PKG = compiled();

export function rev(localId: string, over: J = {}, source = 's1'): J {
  const base: J = {
    key: { source, localId },
    revision: '1',
    recordType: T,
    subject: 'P1',
    episode: 'E1',
    encounter: 'N1',
    concept: { system: 'demo-cs', code: 'item-x' },
    assertion: 'Affirmed',
    assertionKind: 'ClinicianDocumented',
    author: { actor: 'u1', permissions: [] },
    provenance: { acquisition: 'a0', sourceRecordRef: `${source}:${localId}` },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}
export const sup = (localId: string, revision = '1') => ({ source: 's1', localId, revision });
export const retract = (id: string, localId: string, author: J = AMEND): J => ({ id, key: { source: 's1', localId }, target: sup(localId), author, provenance: { acquisition: 'a0', sourceRecordRef: `s1:${id}` } });
export const COMPLETE: J = { id: 'cov-all', appliesTo: { snapshot: 'snap-1' }, recordType: T, subject: 'P1', sources: ['s1', 's2'], status: 'Complete', attestedBy: 'demo-adapter@1' };
export const fail = (id: string, over: J = {}): J => ({ id, attempt: `a-${id}`, appliesTo: { snapshot: 'snap-1' }, outcome: 'Failed', recordType: T, subject: 'P1', sources: ['s1'], ...over });
export const snap = (coverage: J[] = [COMPLETE], failures: J[] = [], id = 'snap-1'): EvaluationSnapshot => ({ id, coverage, failures, rejectedItems: [] });
export const CTX = { subject: 'P1', contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' } } as const;
export const sel = (revisions: J[], retractions: J[] = [], snapshot: EvaluationSnapshot | 'none' = snap(), pkg = PKG): SelectionResult =>
  experimentalSelectForQuery({ package: pkg, query: 'q', revisions: revisions as JsonValue[], retractions: retractions as JsonValue[], ...CTX, ...(snapshot === 'none' ? {} : { snapshot }) });

export const show = (n: NodeRef) => `${n.revision.source}/${n.revision.localId}@${n.revision.revision}${n.digest ? '#' + n.digest : ''}`;

// Records used throughout (D0 = demo-cs#item-x, E1, N1, ClinicianDocumented).
export const SUPPORTING = rev('r1');
export const REFUTING = rev('r2', { assertion: 'Denied' });
export const NONINF = rev('r7', { assertion: 'Indeterminate' });
export const UNCLASSIFIED = rev('r3', { assertion: undefined });
export const INADMISSIBLE = rev('r5', { encounter: 'N0' });
export const OTHER_CS = { system: 'other-cs', code: 'item-x' };
export const OUT = { system: 'demo-cs', code: 'item-y' };
/** Two revisions of one key whose correction authority is missing: UnresolvedRevision with both possible. */
export const history = (localId: string, first: J, second: J) => [rev(localId, first), rev(localId, { revision: '2', supersedes: sup(localId), author: { actor: 'u2' }, ...second })];
