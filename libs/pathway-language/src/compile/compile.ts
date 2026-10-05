/**
 * EXPERIMENTAL, NONCLINICAL. First PPL compiler subset (I1): `compile` and `compilePreview`.
 *
 * Implements first-program-implementation-contract.md §2, §5, the compile rows of §6 and the
 * static part of §7. Pure: no I/O, no clock, no input mutation. Takes an already-parsed JSON value.
 * It evaluates nothing, verifies no citation file and confers no clinical approval.
 */
import { canonicalJson, isObject } from '../s1/payload';
import { compareCodePoints, type JsonObject } from '../s1/resolve';
import { DEMO_AUTHORITY_RULE, type JsonValue } from '../s1/types';
import { expansionProblem } from '../s2/identify';
import type { ValueSetExpansion } from '../s2/types';
import { SAME_ENCOUNTER_RULE } from '../s3/types';
import type {
  CompiledDeclaration,
  CompiledProgram,
  CompiledReference,
  CompileFailure,
  CompileResult,
  DependencyEdge,
  Diagnostic,
  DiagnosticCode,
  EnumCriterion,
  ExplicitAssertionContract,
  Expr,
  HoleInfo,
  PreviewCompileResult,
  PreviewMarker,
  ValueType,
} from './types';

// ---------- pinned catalogue for this subset (demo-model@0.1, contract §1.2; CANONICALIZATION.md §2)

const RECORD_TYPE = 'demo-model/DemoAssessment@0.1';
const POLICY = 'explicit-assertion-v0';
const ENUMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['AssertionValue', ['Affirmed', 'Denied', 'Indeterminate']],
  ['AssertionKind', ['ClinicianDocumented', 'PatientReport']],
]);
/** Declared DemoAssessment fields; the enum-typed ones map to their enum. */
const MODEL_FIELDS: ReadonlyMap<string, string | null> = new Map([
  ['key', null], ['revision', null], ['recordType', null], ['subject', null], ['supersedes', null],
  ['episode', null], ['encounter', null], ['concept', null], ['author', null], ['provenance', null],
  ['assertion', 'AssertionValue'], ['assertionKind', 'AssertionKind'],
]);
const EPISODE_RULE = { eq: [{ field: ['c', 'episode'] }, { ref: 'ctx.episode' }] };

/** Expression forms the language catalogue recognizes; only some are supported in each position. */
const KNOWN_FORMS = new Set(['ref', 'evidenceValue', 'all', 'any', 'not', 'eq', 'in', 'field', 'enum', 'hole', 'call']);
/** Stage A §5 kinds outside this subset (UNSUPPORTED_CONSTRUCT, not unknown). */
const KNOWN_KINDS = new Set(['EvidenceQuery', 'Predicate', 'Finding', 'EvidenceReference', 'DerivedValue', 'Recommendation', 'Choice', 'Need', 'Group']);
const NODE_KINDS = new Set(['EvidenceQuery', 'Predicate', 'Finding']);

// ---------- helpers

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const at = (ptr: string, k: string | number) => `${ptr}/${typeof k === 'number' ? k : esc(k)}`;
const has = (o: JsonObject, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** Identifier syntax: a string with a character outside Unicode White_Space (as for S2/S3 identifiers). */
const identifier = (v: unknown): v is string => typeof v === 'string' && /\P{White_Space}/u.test(v);
const canon = (v: unknown): string | null => {
  try {
    return canonicalJson(v as JsonValue);
  } catch {
    return null;
  }
};
const SAME_ENCOUNTER = canon(SAME_ENCOUNTER_RULE);
const SAME_EPISODE = canon(EPISODE_RULE);

type Target = { kind: 'Decision' | 'Evidence<Boolean>' | 'Finding' | 'Reference' } | 'ambiguous';
type HoleType = HoleInfo['type'];
interface Position {
  /** Hole type accepted at exactly this position (holes are top-level-only in this subset). */
  readonly holeType: HoleType | null;
  readonly allowEvidenceValue: boolean;
}

class Analysis {
  readonly diags: Diagnostic[] = [];
  readonly holes: HoleInfo[] = [];
  readonly holeIds = new Map<string, string[]>();
  /** Resolvable names: declarations and references; `ambiguous` for duplicated IDs. */
  readonly names = new Map<string, Target>();
  /** reader → read → authoring pointers. */
  readonly refs = new Map<string, Map<string, string[]>>();

  add(code: DiagnosticCode, location: string, message: string, hole?: string): void {
    this.diags.push(hole === undefined ? { code, location, message } : { code, location, message, hole });
  }

  /** Unknown members are UNKNOWN_EXECUTABLE_PROPERTY; missing required ones are SOURCE_INVALID at `ptr`. */
  members(o: JsonObject, ptr: string, required: readonly string[], optional: readonly string[]): boolean {
    let ok = true;
    for (const k of Object.keys(o)) {
      if (!required.includes(k) && !optional.includes(k)) {
        this.add('UNKNOWN_EXECUTABLE_PROPERTY', at(ptr, k), `unknown property '${k}'`);
        ok = false;
      }
    }
    for (const k of required) {
      if (!has(o, k)) {
        this.add('SOURCE_INVALID', ptr, `missing required property '${k}'`);
        ok = false;
      }
    }
    return ok;
  }

  cites(o: JsonObject, ptr: string): string[] {
    if (!has(o, 'cites')) return [];
    const c = o['cites'];
    if (!Array.isArray(c)) {
      this.add('SOURCE_INVALID', at(ptr, 'cites'), 'cites must be an array of reference IDs');
      return [];
    }
    const out: string[] = [];
    c.forEach((id, i) => {
      if (typeof id !== 'string') this.add('SOURCE_INVALID', at(at(ptr, 'cites'), i), 'a citation must be a reference ID');
      else if (this.names.get(id) === 'ambiguous') return;
      else if ((this.names.get(id) as { kind: string } | undefined)?.kind !== 'Reference') {
        this.add('UNDEFINED_REFERENCE', at(at(ptr, 'cites'), i), `no EvidenceReference '${id}'`);
      } else out.push(id);
    });
    return out;
  }

  hole(v: JsonValue | undefined, ptr: string, expected: HoleType): string | null {
    if (!isObject(v)) {
      this.add('SOURCE_INVALID', ptr, 'a hole must be an object with id, type and explains');
      return null;
    }
    const before = this.diags.length;
    this.members(v, ptr, ['id', 'type', 'explains'], ['cites']);
    const { id, type, explains } = v;
    if (has(v, 'id') && !identifier(id)) this.add('SOURCE_INVALID', at(ptr, 'id'), 'a hole id must be a non-blank string');
    if (has(v, 'type') && typeof type !== 'string') this.add('SOURCE_INVALID', at(ptr, 'type'), 'a hole type must be a string');
    if (has(v, 'explains') && !identifier(explains)) this.add('SOURCE_INVALID', at(ptr, 'explains'), 'explains must say what is undecided');
    const cites = this.cites(v, ptr);
    if (typeof type === 'string' && type !== expected) {
      this.add('TYPE_MISMATCH', ptr, `hole of type ${type} where ${expected} is required`);
    }
    if (identifier(id)) this.holeIds.set(id, [...(this.holeIds.get(id) ?? []), at(ptr, 'id')]);
    if (this.diags.length > before || !identifier(id)) return null;
    this.holes.push({ id, type: expected, explains: explains as string, cites, location: ptr });
    return id;
  }

  /** Types one program-position expression. Returns null when it is invalid (already diagnosed). */
  expr(v: JsonValue | undefined, ptr: string, pos: Position, reader: string): { type: ValueType | 'enum'; expr: Expr | null } | null {
    if (!isObject(v) || Object.keys(v).length === 0) {
      this.add('SOURCE_INVALID', ptr, 'expected an expression object');
      return null;
    }
    const keys = Object.keys(v);
    const unknown = keys.filter((k) => !KNOWN_FORMS.has(k));
    unknown.forEach((k) => this.add('UNKNOWN_EXECUTABLE_PROPERTY', at(ptr, k), `unknown expression form '${k}'`));
    if (unknown.length > 0) return null;
    if (keys.length > 1) {
      this.add('SOURCE_INVALID', ptr, `one expression form per object, found ${keys.join(', ')}`);
      return null;
    }
    const form = keys[0] as string;
    const arg = v[form];
    const child: Position = { holeType: null, allowEvidenceValue: pos.allowEvidenceValue };
    switch (form) {
      case 'ref': {
        if (typeof arg !== 'string') {
          this.add('SOURCE_INVALID', at(ptr, 'ref'), 'ref must name a declaration');
          return null;
        }
        const target = this.names.get(arg);
        if (target === 'ambiguous') return null; // the duplicate ID is already diagnosed
        if (arg.startsWith('ctx.')) {
          this.add('UNSUPPORTED_CONTEXT_REFERENCE', at(ptr, 'ref'), `context binding '${arg}' is not supported in a program expression`);
          return null;
        }
        if (!target || target.kind === 'Reference') {
          this.add('UNDEFINED_REFERENCE', at(ptr, 'ref'), `no declaration '${arg}'`);
          return null;
        }
        if (target.kind === 'Finding') {
          this.add('UNSUPPORTED_CONSTRUCT', at(ptr, 'ref'), `a Finding ('${arg}') is not referenceable in this subset`);
          return null;
        }
        const byRead = this.refs.get(reader) ?? new Map<string, string[]>();
        byRead.set(arg, [...(byRead.get(arg) ?? []), ptr]);
        this.refs.set(reader, byRead);
        return { type: target.kind, expr: { form: 'ref', target: arg, location: ptr } };
      }
      case 'evidenceValue': {
        if (!pos.allowEvidenceValue) {
          this.add('UNSUPPORTED_CONSTRUCT', ptr, 'evidenceValue is supported only in a Predicate expression');
          return null;
        }
        const a = this.expr(arg, at(ptr, 'evidenceValue'), child, reader);
        if (!a) return null;
        if (a.type !== 'Evidence<Boolean>') {
          this.add('TYPE_MISMATCH', at(ptr, 'evidenceValue'), `evidenceValue requires Evidence<Boolean>, found ${a.type}`);
          return null;
        }
        return { type: 'Decision', expr: a.expr && { form: 'evidenceValue', arg: a.expr, location: ptr } };
      }
      case 'all': {
        if (!Array.isArray(arg)) {
          this.add('SOURCE_INVALID', at(ptr, 'all'), 'all takes an array of Decision operands');
          return null;
        }
        const args: Expr[] = [];
        let ok = true;
        arg.forEach((op, i) => {
          const r = this.expr(op, at(at(ptr, 'all'), i), child, reader);
          if (!r) ok = false;
          else if (r.type !== 'Decision') {
            this.add('TYPE_MISMATCH', at(at(ptr, 'all'), i), `all requires Decision operands, found ${r.type}`);
            ok = false;
          } else if (r.expr) args.push(r.expr);
        });
        return ok ? { type: 'Decision', expr: { form: 'all', args, location: ptr } } : null;
      }
      case 'hole': {
        if (!pos.holeType) {
          this.add('UNSUPPORTED_CONSTRUCT', ptr, 'holes are supported only as a whole applicability expression, query contract or urgency');
          return null;
        }
        const id = this.hole(arg, at(ptr, 'hole'), pos.holeType);
        return id === null ? null : { type: pos.holeType as ValueType, expr: { form: 'hole', hole: id, location: at(ptr, 'hole') } };
      }
      case 'enum':
        // A typed value with no program position that accepts it: the caller reports TYPE_MISMATCH.
        return { type: 'enum', expr: null };
      default:
        this.add('UNSUPPORTED_CONSTRUCT', ptr, `expression form '${form}' is outside this subset in this position`);
        return null;
    }
  }

  decisionField(o: JsonObject, field: string, ptr: string, pos: Position, reader: string): Expr | null {
    const r = this.expr(o[field], at(ptr, field), pos, reader);
    if (!r) return null;
    if (r.type !== 'Decision') {
      this.add('TYPE_MISMATCH', at(ptr, field), `${field} must be a Decision, found ${r.type}`);
      return null;
    }
    return r.expr;
  }
}

// ---------- explicit-assertion-v0 contract (contract §2.2, §3.1; first-program contract §2)

function contextRefs(v: JsonValue | undefined, ptr: string, out: [string, string][]): void {
  if (Array.isArray(v)) v.forEach((x, i) => contextRefs(x, at(ptr, i), out));
  else if (isObject(v)) {
    if (typeof v['ref'] === 'string' && v['ref'].startsWith('ctx.')) out.push([ptr, v['ref']]);
    for (const [k, x] of Object.entries(v)) contextRefs(x, at(ptr, k), out);
  }
}

function criterion(a: Analysis, v: JsonValue | undefined, ptr: string): EnumCriterion | null {
  if (!isObject(v) || Object.keys(v).length === 0) {
    a.add('SOURCE_INVALID', ptr, 'a criterion must be a typed expression, not prose');
    return null;
  }
  const keys = Object.keys(v);
  const unknown = keys.filter((k) => !KNOWN_FORMS.has(k));
  unknown.forEach((k) => a.add('UNKNOWN_EXECUTABLE_PROPERTY', at(ptr, k), `unknown expression form '${k}'`));
  if (unknown.length > 0) return null;
  if (keys.length > 1) {
    a.add('SOURCE_INVALID', ptr, 'one expression form per object');
    return null;
  }
  const eq = v['eq'];
  const field = Array.isArray(eq) && isObject(eq[0]) && Object.keys(eq[0]).length === 1 ? eq[0]['field'] : undefined;
  const lit = Array.isArray(eq) && isObject(eq[1]) && Object.keys(eq[1]).length === 1 ? eq[1]['enum'] : undefined;
  if (!Array.isArray(eq) || eq.length !== 2 || !Array.isArray(field) || field.length !== 2 || field[0] !== 'c' || typeof field[1] !== 'string' || typeof lit !== 'string') {
    a.add('UNSUPPORTED_CONSTRUCT', ptr, 'this subset supports criteria of the form eq(c.<field>, <Enum>.<value>)');
    return null;
  }
  const name = field[1];
  if (!MODEL_FIELDS.has(name)) {
    a.add('UNDEFINED_REFERENCE', at(at(at(ptr, 'eq'), 0), 'field'), `${RECORD_TYPE} has no field '${name}'`);
    return null;
  }
  const dot = lit.indexOf('.');
  const enumType = lit.slice(0, dot);
  const value = lit.slice(dot + 1);
  if (dot < 0 || !ENUMS.get(enumType)?.includes(value)) {
    a.add('UNDEFINED_REFERENCE', at(at(at(ptr, 'eq'), 1), 'enum'), `no enum value '${lit}' in ${RECORD_TYPE}`);
    return null;
  }
  if (MODEL_FIELDS.get(name) !== enumType) {
    a.add('TYPE_MISMATCH', at(at(ptr, 'eq'), 1), `c.${name} is not of type ${enumType}`);
    return null;
  }
  return { field: name, enumType, value, location: ptr };
}

function explicitContract(a: Analysis, c: JsonObject, ptr: string, valueSets: ReadonlyMap<string, boolean>): ExplicitAssertionContract | null {
  const before = a.diags.length;
  a.members(c, ptr, ['retrieve', 'corrections', 'admissible', 'policy', 'establishes', 'refutes', 'obligations'], []);

  // Context bindings: typed names, each at its one supported position (P3; capability limit).
  const supported = new Map([
    ['ctx.episode', at(at(at(at(ptr, 'admissible'), 'episode'), 'eq'), 1)],
    ['ctx.encounter', at(at(at(at(ptr, 'admissible'), 'encounter'), 'eq'), 1)],
  ]);
  const ctx: [string, string][] = [];
  contextRefs(c, ptr, ctx);
  const flagged: string[] = [];
  for (const [p, name] of ctx) {
    if (supported.get(name) !== p) {
      a.add('UNSUPPORTED_CONTEXT_REFERENCE', at(p, 'ref'), supported.has(name) ? `'${name}' is supported only at ${supported.get(name)}` : `unknown context binding '${name}'`);
      flagged.push(p);
    }
  }
  const touchesFlagged = (p: string) => flagged.some((f) => f === p || f.startsWith(`${p}/`));

  const r = c['retrieve'];
  let recordType = '', sources: string[] = [], valueSet = '';
  if (has(c, 'retrieve')) {
    const rp = at(ptr, 'retrieve');
    if (!isObject(r)) a.add('SOURCE_INVALID', rp, 'retrieve must be an object');
    else if (a.members(r, rp, ['type', 'sources', 'valueSet'], [])) {
      if (typeof r['type'] !== 'string') a.add('SOURCE_INVALID', at(rp, 'type'), 'type must be a record type ID');
      else if (r['type'] !== RECORD_TYPE) a.add('UNSUPPORTED_CONSTRUCT', at(rp, 'type'), `only ${RECORD_TYPE} is supported`);
      else recordType = r['type'];
      const s = r['sources'];
      if (!Array.isArray(s) || s.length === 0 || !s.every(identifier) || new Set(s).size !== s.length) {
        a.add('SOURCE_INVALID', at(rp, 'sources'), 'sources must be a nonempty array of distinct source IDs');
      } else sources = s as string[];
      const vs = r['valueSet'];
      if (typeof vs !== 'string') a.add('SOURCE_INVALID', at(rp, 'valueSet'), 'valueSet must be a pinned value-set ID');
      else if (!valueSets.has(vs)) a.add('UNDEFINED_REFERENCE', at(rp, 'valueSet'), `no value set '${vs}' in valueSets`);
      else if (valueSets.get(vs)) valueSet = vs; // an invalid expansion is already diagnosed
    }
  }
  const corr = c['corrections'];
  let authorityRule = '';
  if (has(c, 'corrections')) {
    const cp = at(ptr, 'corrections');
    if (!isObject(corr)) a.add('SOURCE_INVALID', cp, 'corrections must be an object');
    else if (a.members(corr, cp, ['authority'], [])) {
      if (typeof corr['authority'] !== 'string') a.add('SOURCE_INVALID', at(cp, 'authority'), 'authority must be a rule ID');
      else if (corr['authority'] !== DEMO_AUTHORITY_RULE) a.add('UNSUPPORTED_CONSTRUCT', at(cp, 'authority'), `only ${DEMO_AUTHORITY_RULE} is supported`);
      else authorityRule = corr['authority'];
    }
  }
  if (has(c, 'policy')) {
    if (typeof c['policy'] !== 'string') a.add('SOURCE_INVALID', at(ptr, 'policy'), 'policy must be a policy ID');
    else if (c['policy'] !== POLICY) a.add('UNSUPPORTED_CONSTRUCT', at(ptr, 'policy'), `only ${POLICY} is supported`);
  }

  const adm = c['admissible'];
  let assertionKinds: string[] = [];
  if (has(c, 'admissible')) {
    const ap = at(ptr, 'admissible');
    if (!isObject(adm)) a.add('SOURCE_INVALID', ap, 'admissible must be an object of rules');
    else {
      for (const k of Object.keys(adm)) {
        if (!['episode', 'encounter', 'assertionKind'].includes(k)) a.add('UNSUPPORTED_CONSTRUCT', at(ap, k), `admissible rule '${k}' is outside this subset`);
      }
      for (const k of ['episode', 'encounter', 'assertionKind']) if (!has(adm, k)) a.add('SOURCE_INVALID', ap, `missing admissible rule '${k}'`);
      for (const [k, expected] of [['episode', SAME_EPISODE], ['encounter', SAME_ENCOUNTER]] as const) {
        const p = at(ap, k);
        if (has(adm, k) && !touchesFlagged(p) && canon(adm[k]) !== expected) {
          a.add('UNSUPPORTED_CONSTRUCT', p, `this subset supports only eq(c.${k}, ctx.${k}) for the ${k} rule`);
        }
      }
      const ak = adm['assertionKind'];
      const akp = at(ap, 'assertionKind');
      if (has(adm, 'assertionKind') && !touchesFlagged(akp)) {
        const list = isObject(ak) && Object.keys(ak).length === 1 ? ak['in'] : undefined;
        if (!Array.isArray(list)) a.add('UNSUPPORTED_CONSTRUCT', akp, 'this subset supports only {in: [AssertionKind values]} for assertionKind');
        else {
          list.forEach((x, i) => {
            if (typeof x !== 'string' || !ENUMS.get('AssertionKind')!.includes(x)) {
              a.add('TYPE_MISMATCH', at(at(akp, 'in'), i), `${JSON.stringify(x)} is not an AssertionKind value`);
            }
          });
          assertionKinds = list as string[];
        }
      }
    }
  }

  const crit = (k: 'establishes' | 'refutes') => {
    const p = at(ptr, k);
    if (!has(c, k) || touchesFlagged(p)) return null;
    return criterion(a, c[k], p);
  };
  const establishes = crit('establishes');
  const refutes = crit('refutes');

  if (has(c, 'obligations')) {
    const op = at(ptr, 'obligations');
    const obs = c['obligations'];
    if (!Array.isArray(obs)) a.add('SOURCE_INVALID', op, 'obligations must be an array');
    else {
      let found = false;
      obs.forEach((o, i) => {
        const d = isObject(o) && Object.keys(o).length === 1 ? o['disjoint'] : undefined;
        const pair = Array.isArray(d) && d.length === 2 && new Set(d).size === 2 && d.every((x) => x === 'establishes' || x === 'refutes');
        if (!pair) {
          a.add('UNSUPPORTED_CONSTRUCT', at(op, i), 'this subset supports only the obligation disjoint(establishes, refutes)');
          return;
        }
        found = true;
        if (!establishes || !refutes) return; // an invalid criterion is already diagnosed
        if (establishes.field !== refutes.field || establishes.enumType !== refutes.enumType) {
          a.add('UNSUPPORTED_PROOF_FRAGMENT', at(op, i), 'disjointness is analyzable only for equalities on the same enum field');
        } else if (establishes.value === refutes.value) {
          a.add('EXCLUSIVE_BRANCH_OVERLAP', at(op, i), `a record with c.${establishes.field} = ${establishes.value} satisfies both criteria`);
        }
      });
      if (!found && obs.every((o) => !(isObject(o) && has(o, 'disjoint')))) {
        a.add('SOURCE_INVALID', op, `${POLICY} requires the obligation disjoint(establishes, refutes)`);
      }
    }
  }

  if (a.diags.length > before || !establishes || !refutes) return null;
  return {
    kind: 'explicit-assertion-v0',
    recordType,
    sources,
    valueSet,
    authorityRule,
    admissible: { episode: adm && isObject(adm) ? (adm['episode'] as JsonValue) : null, encounter: isObject(adm) ? (adm['encounter'] as JsonValue) : null, assertionKinds },
    establishes,
    refutes,
    source: JSON.parse(JSON.stringify(c)) as JsonValue,
    location: ptr,
  };
}

// ---------- graph

function stronglyConnected(nodes: readonly string[], next: (n: string) => readonly string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  let i = 0;
  const visit = (v: string): void => {
    index.set(v, i);
    low.set(v, i++);
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        scc.push(w);
      } while (w !== v);
      out.push(scc);
    }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out;
}

// ---------- analysis

interface Result {
  readonly structural: readonly Diagnostic[];
  readonly program: CompiledProgram | null;
}

function analyze(source: unknown): Result {
  const a = new Analysis();
  const done = (): Result => ({ structural: a.diags, program: null });
  if (!isObject(source as JsonValue)) {
    a.add('SOURCE_INVALID', '', 'a program must be a JSON object');
    return done();
  }
  const s = source as JsonObject;
  a.members(s, '', ['ppl', 'package', 'applicability', 'nodes'], ['references', 'valueSets']);

  const ppl = s['ppl'];
  if (has(s, 'ppl')) {
    if (!isObject(ppl)) a.add('SOURCE_INVALID', '/ppl', 'ppl must be an object');
    else if (a.members(ppl, '/ppl', ['languageVersion', 'capabilityProfileVersion'], ['sourceStatus'])) {
      if (ppl['languageVersion'] !== 'ppl-1') a.add('SOURCE_INVALID', '/ppl/languageVersion', 'unsupported language version (ppl-1 only)');
      if (ppl['capabilityProfileVersion'] !== 'ppl-core-v0') a.add('SOURCE_INVALID', '/ppl/capabilityProfileVersion', 'unsupported capability profile (ppl-core-v0 only)');
      if (has(ppl, 'sourceStatus') && typeof ppl['sourceStatus'] !== 'string') a.add('SOURCE_INVALID', '/ppl/sourceStatus', 'sourceStatus must be text');
    }
  }
  const pkg = s['package'];
  if (has(s, 'package')) {
    if (!isObject(pkg)) a.add('SOURCE_INVALID', '/package', 'package must be an object');
    else if (a.members(pkg, '/package', ['id', 'state'], ['nonclinical'])) {
      if (!identifier(pkg['id'])) a.add('SOURCE_INVALID', '/package/id', 'package id must be a non-blank string');
      if (typeof pkg['state'] !== 'string') a.add('SOURCE_INVALID', '/package/state', 'state must be a string');
      if (has(pkg, 'nonclinical') && typeof pkg['nonclinical'] !== 'boolean') a.add('SOURCE_INVALID', '/package/nonclinical', 'nonclinical must be a boolean');
    }
  }

  // Value sets (validated exactly as S2 will accept them).
  const valueSets = new Map<string, boolean>();
  const expansions: { [id: string]: ValueSetExpansion } = {};
  if (has(s, 'valueSets')) {
    const vss = s['valueSets'];
    if (!isObject(vss)) a.add('SOURCE_INVALID', '/valueSets', 'valueSets must map pinned IDs to expansions');
    else {
      for (const [id, e] of Object.entries(vss)) {
        const p = at('/valueSets', id);
        let ok = false;
        if (!isObject(e)) a.add('SOURCE_INVALID', p, 'a value set must be an object');
        else if (a.members(e, p, ['expansion', 'coveredSystems'], [])) {
          const problem = expansionProblem(id, { id, ...(e as object) } as ValueSetExpansion);
          if (problem) a.add('SOURCE_INVALID', p, problem);
          else {
            ok = true;
            expansions[id] = JSON.parse(JSON.stringify({ id, expansion: e['expansion'], coveredSystems: e['coveredSystems'] }));
          }
        }
        valueSets.set(id, ok);
      }
    }
  }

  // Collect declarations and references, then identifiers (forward references are fine).
  type Item = { o: JsonObject; ptr: string; kind: string; applicability: boolean };
  const items: Item[] = [];
  const refsItems: { o: JsonObject; ptr: string }[] = [];
  /** Declarations whose kind is invalid: their IDs still exist, so references to them are not undefined. */
  const opaque: { o: JsonObject; ptr: string }[] = [];
  const app = s['applicability'];
  if (has(s, 'applicability')) {
    if (!isObject(app)) a.add('SOURCE_INVALID', '/applicability', 'applicability must be a Predicate declaration');
    else if (app['kind'] !== 'Predicate') {
      a.add('SOURCE_INVALID', has(app, 'kind') ? '/applicability/kind' : '/applicability', 'applicability must be of kind Predicate');
      opaque.push({ o: app, ptr: '/applicability' });
    }
    else items.push({ o: app, ptr: '/applicability', kind: 'Predicate', applicability: true });
  }
  const nodes = s['nodes'];
  if (has(s, 'nodes') && !Array.isArray(nodes)) a.add('SOURCE_INVALID', '/nodes', 'nodes must be an array');
  if (Array.isArray(nodes)) {
    nodes.forEach((n, i) => {
      const p = at('/nodes', i);
      if (!isObject(n)) return a.add('SOURCE_INVALID', p, 'a declaration must be an object');
      const k = n['kind'];
      if (typeof k !== 'string' || !NODE_KINDS.has(k)) opaque.push({ o: n, ptr: p });
      if (typeof k !== 'string') return a.add('SOURCE_INVALID', has(n, 'kind') ? at(p, 'kind') : p, 'a declaration needs a kind');
      if (!KNOWN_KINDS.has(k)) return a.add('UNKNOWN_EXECUTABLE_PROPERTY', at(p, 'kind'), `unknown declaration kind '${k}'`);
      if (!NODE_KINDS.has(k)) return a.add('UNSUPPORTED_CONSTRUCT', at(p, 'kind'), `declaration kind '${k}' is outside this subset`);
      items.push({ o: n, ptr: p, kind: k, applicability: false });
    });
  }
  const refsArr = s['references'];
  if (has(s, 'references') && !Array.isArray(refsArr)) a.add('SOURCE_INVALID', '/references', 'references must be an array');
  if (Array.isArray(refsArr)) {
    refsArr.forEach((r, i) => {
      const p = at('/references', i);
      if (!isObject(r)) return a.add('SOURCE_INVALID', p, 'a reference must be an object');
      const k = r['kind'];
      if (typeof k !== 'string') return a.add('SOURCE_INVALID', has(r, 'kind') ? at(p, 'kind') : p, 'a reference needs kind EvidenceReference');
      if (k !== 'EvidenceReference') {
        return a.add(KNOWN_KINDS.has(k) ? 'UNSUPPORTED_CONSTRUCT' : 'UNKNOWN_EXECUTABLE_PROPERTY', at(p, 'kind'), `'${k}' cannot appear in references`);
      }
      refsItems.push({ o: r, ptr: p });
    });
  }
  const occurrences = new Map<string, string[]>();
  const kindOf = new Map<string, Target>();
  const all = [...items, ...refsItems.map((r) => ({ ...r, kind: 'EvidenceReference' })), ...opaque.map((r) => ({ ...r, kind: '' }))];
  for (const { o, ptr, kind } of all) {
    if (!has(o, 'id')) {
      if (kind) a.add('SOURCE_INVALID', ptr, "missing required property 'id'");
    } else if (!identifier(o['id'])) {
      if (kind) a.add('SOURCE_INVALID', at(ptr, 'id'), 'an id must be a non-blank string');
    } else {
      const id = o['id'];
      occurrences.set(id, [...(occurrences.get(id) ?? []), at(ptr, 'id')]);
      kindOf.set(id, kind === '' ? 'ambiguous' : { kind: kind === 'EvidenceReference' ? 'Reference' : kind === 'EvidenceQuery' ? 'Evidence<Boolean>' : kind === 'Finding' ? 'Finding' : 'Decision' });
    }
  }
  for (const [id, ptrs] of occurrences) {
    if (ptrs.length > 1) {
      ptrs.forEach((p) => a.add('INVALID_DECLARATION_ID', p, `duplicate identifier '${id}'`));
      a.names.set(id, 'ambiguous');
    } else if (id.startsWith('ctx.')) {
      a.add('INVALID_DECLARATION_ID', ptrs[0]!, `'${id}' uses the reserved ctx. prefix`);
      a.names.set(id, 'ambiguous');
    } else a.names.set(id, kindOf.get(id)!);
  }

  // References (citation shapes; no file access).
  const references: CompiledReference[] = [];
  for (const { o, ptr } of refsItems) {
    const before = a.diags.length;
    a.members(o, ptr, ['id', 'kind', 'file', 'sha256', 'lines', 'quote'], []);
    const { file, sha256, lines, quote } = o;
    if (has(o, 'file') && !identifier(file)) a.add('SOURCE_INVALID', at(ptr, 'file'), 'file must be a path');
    if (has(o, 'sha256') && !(typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256))) a.add('SOURCE_INVALID', at(ptr, 'sha256'), 'sha256 must be 64 lowercase hex digits');
    const range = Array.isArray(lines) && lines.length === 2 && lines.every((n) => Number.isInteger(n) && (n as number) >= 1) && (lines[0] as number) <= (lines[1] as number);
    if (has(o, 'lines') && !range) a.add('SOURCE_INVALID', at(ptr, 'lines'), 'lines must be [first, last] with 1 <= first <= last');
    if (has(o, 'quote')) {
      const ok = isObject(quote) && Object.entries(quote).every(([k, v]) => /^[1-9][0-9]*$/.test(k) && typeof v === 'string' && (!range || (Number(k) >= (lines as number[])[0]! && Number(k) <= (lines as number[])[1]!)));
      if (!ok) a.add('SOURCE_INVALID', at(ptr, 'quote'), 'quote must map line numbers within lines to text');
    }
    if (a.diags.length === before && typeof o['id'] === 'string') {
      references.push({ id: o['id'], file: file as string, sha256: sha256 as string, lines: [(lines as number[])[0]!, (lines as number[])[1]!], quote: { ...(quote as { [k: string]: string }) }, location: ptr });
    }
  }

  // Declarations.
  const declarations = new Map<string, CompiledDeclaration>();
  for (const { o, ptr, kind, applicability } of items) {
    const before = a.diags.length;
    const id = typeof o['id'] === 'string' ? o['id'] : '';
    const common = ['id', 'kind'];
    const optional = ['cites', 'rationale'];
    if (has(o, 'rationale') && typeof o['rationale'] !== 'string') a.add('SOURCE_INVALID', at(ptr, 'rationale'), 'rationale must be text');
    if (kind === 'Predicate') {
      a.members(o, ptr, [...common, 'expr'], optional);
      const cites = a.cites(o, ptr);
      const pos: Position = applicability ? { holeType: 'Decision', allowEvidenceValue: false } : { holeType: null, allowEvidenceValue: true };
      const expr = has(o, 'expr') ? a.decisionField(o, 'expr', ptr, pos, id) : null;
      if (a.diags.length === before && expr) declarations.set(id, { kind: 'Predicate', id, applicability, expr, cites, location: ptr });
    } else if (kind === 'EvidenceQuery') {
      a.members(o, ptr, [...common, 'subject', 'output', 'contract'], optional);
      const cites = a.cites(o, ptr);
      for (const [f, expected] of [['subject', 'patient'], ['output', 'Evidence<Boolean>']] as const) {
        if (!has(o, f)) continue;
        if (typeof o[f] !== 'string') a.add('SOURCE_INVALID', at(ptr, f), `${f} must be a string`);
        else if (o[f] !== expected) a.add('UNSUPPORTED_CONSTRUCT', at(ptr, f), `only ${f} '${expected}' is supported`);
      }
      const c = o['contract'];
      const cp = at(ptr, 'contract');
      let contract: (CompiledDeclaration & { kind: 'EvidenceQuery' })['contract'] | null = null;
      if (!has(o, 'contract')) {
        // reported by members()
      } else if (!isObject(c)) a.add('SOURCE_INVALID', cp, 'contract must be an object or a hole');
      else if (has(c, 'hole')) {
        if (a.members(c, cp, ['hole'], [])) {
          const h = a.hole(c['hole'], at(cp, 'hole'), 'EvidenceSelectionContract<Boolean>');
          if (h !== null) contract = { kind: 'hole', hole: h, location: at(cp, 'hole') };
        }
      } else contract = explicitContract(a, c, cp, valueSets);
      if (a.diags.length === before && contract) {
        declarations.set(id, { kind: 'EvidenceQuery', id, subject: 'patient', output: 'Evidence<Boolean>', contract, cites, location: ptr });
      }
    } else {
      a.members(o, ptr, [...common, 'status', 'label'], [...optional, 'heading', 'urgency']);
      const cites = a.cites(o, ptr);
      for (const f of ['label', 'heading']) if (has(o, f) && typeof o[f] !== 'string') a.add('SOURCE_INVALID', at(ptr, f), `${f} must be text`);
      let urgency: { hole: string; location: string } | null = null;
      if (has(o, 'urgency')) {
        const u = o['urgency'];
        const up = at(ptr, 'urgency');
        if (!isObject(u) || !has(u, 'hole')) a.add('UNSUPPORTED_CONSTRUCT', up, 'urgency is supported only as a typed hole');
        else if (a.members(u, up, ['hole'], [])) {
          const h = a.hole(u['hole'], at(up, 'hole'), 'UrgencyRequirement');
          if (h !== null) urgency = { hole: h, location: at(up, 'hole') };
        }
      }
      const status = has(o, 'status') ? a.decisionField(o, 'status', ptr, { holeType: null, allowEvidenceValue: false }, id) : null;
      if (a.diags.length === before && status) {
        declarations.set(id, {
          kind: 'Finding', id, status, label: o['label'] as string,
          heading: has(o, 'heading') ? (o['heading'] as string) : null, urgency, cites, location: ptr,
        });
      }
    }
  }
  for (const [id, ptrs] of a.holeIds) {
    if (ptrs.length > 1) ptrs.forEach((p) => a.add('INVALID_DECLARATION_ID', p, `duplicate hole identifier '${id}'`));
  }

  // Derived dependencies (authored refs only) and cycles.
  const ids = [...a.refs.keys(), ...[...a.refs.values()].flatMap((m) => [...m.keys()])];
  const graphNodes = [...new Set([...declarations.keys(), ...ids])].sort(compareCodePoints);
  const next = (n: string) => [...(a.refs.get(n)?.keys() ?? [])].sort(compareCodePoints);
  for (const scc of stronglyConnected(graphNodes, next)) {
    const members = new Set(scc);
    const cyclic = scc.length > 1 || next(scc[0]!).includes(scc[0]!);
    if (!cyclic) continue;
    const locs = scc.flatMap((r) => [...(a.refs.get(r) ?? [])].filter(([read]) => members.has(read)).flatMap(([, ps]) => ps));
    const first = locs.sort(compareCodePoints)[0]!;
    a.add('CYCLIC_EXECUTION_DEPENDENCY', at(first, 'ref'), `executable dependency cycle through ${[...members].sort(compareCodePoints).join(', ')}`);
  }

  if (a.diags.length > 0) return done();

  const edges: DependencyEdge[] = [];
  for (const [reader, m] of a.refs) for (const [read, ps] of m) edges.push({ reader, read, locations: [...ps].sort(compareCodePoints) });
  edges.sort((x, y) => compareCodePoints(x.reader, y.reader) || compareCodePoints(x.read, y.read));
  // Deterministic topological order: dependencies first, ties by identifier.
  const order: string[] = [];
  const pending = new Map([...declarations.keys()].map((d) => [d, new Set(a.refs.get(d)?.keys() ?? [])]));
  while (pending.size > 0) {
    const ready = [...pending].filter(([, deps]) => [...deps].every((d) => !pending.has(d))).map(([d]) => d).sort(compareCodePoints);
    for (const d of ready) {
      order.push(d);
      pending.delete(d);
    }
  }
  return {
    structural: [],
    program: {
      packageId: (pkg as JsonObject)['id'] as string,
      languageVersion: 'ppl-1',
      capabilityProfileVersion: 'ppl-core-v0',
      applicabilityId: (app as JsonObject)['id'] as string,
      declarations: order.map((d) => declarations.get(d)!),
      references: [...references].sort((x, y) => compareCodePoints(x.id, y.id)),
      valueSets: expansions,
      dependencyEdges: edges,
      holes: [...a.holes].sort((x, y) => compareCodePoints(x.id, y.id)),
    },
  };
}

const sortDiagnostics = (ds: readonly Diagnostic[]): Diagnostic[] =>
  [...ds].sort((x, y) => compareCodePoints(x.location, y.location) || compareCodePoints(x.code, y.code) || compareCodePoints(x.hole ?? '', y.hole ?? ''));

/**
 * Structural failure: the same diagnostics in both modes, without hole diagnostics, so the first
 * thing an author sees is what makes the program invalid (an interpretation; see README).
 */
function structuralFailure(r: Result): CompileFailure | null {
  return r.program ? null : { outcome: 'CompileFailure', wellFormed: false, diagnostics: sortDiagnostics(r.structural) };
}

/** Marked outputs (contract §7): a hole, or a reference to a marked output; attribute holes mark only themselves. */
function markers(p: CompiledProgram): PreviewMarker[] {
  const marks = new Map<string, Set<string>>();
  const collect = (e: Expr, into: Set<string>): void => {
    if (e.form === 'hole') into.add(e.hole);
    else if (e.form === 'ref') marks.get(e.target)?.forEach((h) => into.add(h));
    else if (e.form === 'evidenceValue') collect(e.arg, into);
    else e.args.forEach((x) => collect(x, into));
  };
  const out: PreviewMarker[] = [];
  const emit = (output: string, holes: Set<string>) => {
    if (holes.size > 0) out.push({ output, holes: [...holes].sort(compareCodePoints) });
  };
  for (const d of p.declarations) {
    const set = new Set<string>();
    if (d.kind === 'Predicate') collect(d.expr, set);
    else if (d.kind === 'EvidenceQuery') {
      if (d.contract.kind === 'hole') set.add(d.contract.hole);
    } else collect(d.status, set);
    marks.set(d.id, set);
    if (d.kind === 'Finding') {
      emit(`${d.id}.status`, set);
      if (d.urgency) emit(`${d.id}.urgency`, new Set([d.urgency.hole]));
    } else emit(d.id, set);
  }
  return out.sort((x, y) => compareCodePoints(x.output, y.output));
}

function inspectable(p: CompiledProgram): { [output: string]: JsonValue } {
  const out: { [output: string]: JsonValue } = {};
  for (const d of [...p.declarations].sort((x, y) => compareCodePoints(x.id, y.id))) {
    if (d.kind !== 'Finding') continue;
    out[`${d.id}.label`] = d.label;
    if (d.heading !== null) out[`${d.id}.heading`] = d.heading;
    if (d.cites.length > 0) out[`${d.id}.cites`] = [...d.cites];
  }
  return out;
}

/** Normal compilation: complete programs only; each unresolved hole is UNRESOLVED_AUTHORING_HOLE. */
export function compile(source: unknown): CompileResult {
  const r = analyze(source);
  const failed = structuralFailure(r);
  if (failed) return failed;
  const program = r.program!;
  if (program.holes.length > 0) {
    return {
      outcome: 'CompileFailure',
      wellFormed: true,
      diagnostics: sortDiagnostics(
        program.holes.map((h) => ({ code: 'UNRESOLVED_AUTHORING_HOLE' as const, location: h.location, hole: h.id, message: `authoring hole ${h.id} is unresolved: ${h.explains}` })),
      ),
      dependencyEdges: program.dependencyEdges,
    };
  }
  return { outcome: 'Compiled', wellFormed: true, diagnostics: [], package: { ...program, kind: 'CompiledPackage', experimental: 'nonclinical-ppl-compile-v0' } };
}

/** Preview compilation: accepts correctly typed holes as markers. Never publishable or clinically executable. */
export function compilePreview(source: unknown): PreviewCompileResult {
  const r = analyze(source);
  const failed = structuralFailure(r);
  if (failed) return failed;
  const program = r.program!;
  return {
    outcome: 'PreviewPackage',
    wellFormed: true,
    diagnostics: [],
    package: {
      ...program,
      kind: 'PreviewPackage',
      experimental: 'nonclinical-ppl-compile-v0',
      publication: 'Blocked',
      markers: markers(program),
      inspectable: inspectable(program),
    },
  };
}
