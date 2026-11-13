/**
 * EXPERIMENTAL, NONCLINICAL. Isolated execution of compiled PPL program expressions (I2).
 *
 * Evaluates `ref`, `evidenceValue`, `all`, Predicate outputs and Finding status/attributes over an
 * I1 package, given EvidenceQuery results SUPPLIED by the caller. It runs no evidence-query stage
 * (S1–S6), reads no patient record and generates no Need. Pure: no I/O, no clock, no input
 * mutation; results are detached and deep-frozen like compiler results.
 */
import { compiledKind, contractHoles, detach } from '../compile/compile';
import type { CompiledDeclaration, CompiledPackage, Expr, PreviewPackage } from '../compile/types';
import { compareCodePoints } from '../s1/resolve';
import { projectEvidence } from './project';
import type {
  Cause,
  DecisionValue,
  ExecutionInputError,
  ExecutionResult,
  FindingAttributes,
  PreviewExecutionResult,
  ProgramOutput,
  SuppliedEvidence,
  TraceEntry,
  TraceStep,
} from './types';

const CAUSES: readonly Cause[] = ['Missing', 'Conflicting', 'Unavailable', 'Invalid', 'Inadmissible', 'InsufficientEvidence'];
/** Fixture ID notation: `source/localId@revision`, optionally `#<sha-256 digest>` for a payload variant. */
const EVIDENCE_ID = /^([^/@#]+)\/([^/@#]+)@([^/@#]+)(?:#([0-9a-f]{64}))?$/;

/** Canonical order of evidence IDs (contract §5.3): by (source, localId, revision, digest), code point. */
function idTuple(id: string): string[] {
  const m = EVIDENCE_ID.exec(id) as RegExpExecArray;
  return [m[1] as string, m[2] as string, m[3] as string, m[4] ?? ''];
}
/**
 * How the evaluator orders, deduplicates and displays evidence references. Identity is `compare`
 * (0 means the same reference); `label` is display text for trace strings only, never a key.
 */
export interface RefOps<R> {
  readonly compare: (a: R, b: R) => number;
  readonly label: (r: R) => string;
}
/** Supplied fixture-notation strings: §5.3 tuple order; the string is its own identity. */
const STRING_REFS: RefOps<string> = {
  compare: (a, b) => {
    const x = idTuple(a);
    const y = idTuple(b);
    for (let i = 0; i < 4; i += 1) {
      const d = compareCodePoints(x[i] as string, y[i] as string);
      if (d !== 0) return d;
    }
    return 0;
  },
  label: (r) => r,
};
/** Sorted by identity, one entry per identity. */
function sortRefs<R>(ids: Iterable<R>, refs: RefOps<R>): R[] {
  return [...ids].sort(refs.compare).filter((r, i, a) => i === 0 || refs.compare(a[i - 1] as R, r) !== 0);
}
const sortIds = (ids: Iterable<string>): string[] => sortRefs(ids, STRING_REFS);
const sortCauses = (cs: Iterable<Cause>): Cause[] => {
  const set = new Set(cs);
  return CAUSES.filter((c) => set.has(c));
};

// ---------- runtime values

/** `Evidence<Boolean>` over any reference type; extra fields (such as `provenance`) pass through untouched. */
export type EvidenceOf<R> =
  | { readonly status: 'Known'; readonly value: boolean; readonly supportingEvidenceIds: readonly R[] }
  | { readonly status: 'Unresolved'; readonly causes: readonly Cause[]; readonly candidateEvidenceIds: readonly R[] };

type Decision<R> = { kind: 'decision'; value: 'True' | 'False' | 'Unknown'; causes: Cause[]; ids: R[] };
type Value<R> = Decision<R> | { kind: 'evidence'; evidence: EvidenceOf<R> } | { kind: 'marker'; holes: string[] };

function showValue<R>(v: Value<R>, refs: RefOps<R>): string {
  if (v.kind === 'marker') return `Marker[${v.holes.join(', ')}]`;
  if (v.kind === 'evidence') {
    const e = v.evidence;
    return e.status === 'Known' ? `Known(${e.value}, [${e.supportingEvidenceIds.map(refs.label).join(', ')}])` : `Unresolved{${e.causes.join(', ')}}`;
  }
  return v.value === 'Unknown' ? `Unknown(${v.causes.join(', ')})` : v.value;
}

// ---------- input validation (never patient uncertainty)

/**
 * The first invalid element of an array, or null when every element is valid. Explicit index loop:
 * an array hole (sparse array) and an `undefined` element are both invalid, never “not found”.
 */
function elementProblem(x: unknown, name: string, valid: (v: unknown) => boolean, expected: string): string | null {
  if (!Array.isArray(x)) return `${name} must be an array`;
  for (let i = 0; i < x.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(x, i)) return `${name}[${i}] is missing (sparse array)`;
    if (!valid(x[i])) return `${name}[${i}] is ${x[i] === undefined ? 'undefined' : JSON.stringify(x[i])}, not ${expected}`;
  }
  return null;
}

function normalizeEvidence(v: unknown): SuppliedEvidence | string {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'expected an Evidence<Boolean> object';
  const o = v as { [k: string]: unknown };
  const keys = Object.keys(o).sort();
  const ids = (x: unknown, name: string): string[] | string => {
    const problem = elementProblem(x, name, (i) => typeof i === 'string' && EVIDENCE_ID.test(i), 'an evidence ID (source/localId@revision[#digest])');
    return problem ?? sortIds(x as string[]);
  };
  if (o['status'] === 'Known') {
    if (keys.join() !== 'status,supportingEvidenceIds,value') return 'Known has exactly status, value, supportingEvidenceIds';
    if (typeof o['value'] !== 'boolean') return 'Known.value must be a boolean';
    const s = ids(o['supportingEvidenceIds'], 'supportingEvidenceIds');
    return typeof s === 'string' ? s : { status: 'Known', value: o['value'], supportingEvidenceIds: s };
  }
  if (o['status'] === 'Unresolved') {
    if (keys.join() !== 'candidateEvidenceIds,causes,status') return 'Unresolved has exactly status, causes, candidateEvidenceIds';
    const cs = o['causes'];
    if (!Array.isArray(cs) || cs.length === 0) return 'Unresolved.causes must be a nonempty set of causes';
    const causeProblem = elementProblem(cs, 'causes', (c) => CAUSES.includes(c as Cause), 'a Stage A cause');
    if (causeProblem) return causeProblem;
    const c = ids(o['candidateEvidenceIds'], 'candidateEvidenceIds');
    return typeof c === 'string' ? c : { status: 'Unresolved', causes: sortCauses(cs as Cause[]), candidateEvidenceIds: c };
  }
  return 'status must be Known or Unresolved';
}

function checkInputs(
  pkg: unknown,
  kind: 'CompiledPackage' | 'PreviewPackage',
  supplied: unknown,
): { errors: ExecutionInputError[]; evidence: Map<string, SuppliedEvidence> } {
  const errors: ExecutionInputError[] = [];
  const evidence = new Map<string, SuppliedEvidence>();
  // Only objects the compiler itself produced in this process are accepted (a private registry);
  // tags, shape and frozenness are not proof of compilation.
  const produced = compiledKind(pkg);
  if (produced !== kind) {
    const p = pkg as { outcome?: unknown } | null;
    const what = produced ? `an I1 ${produced}` : p && typeof p === 'object' && 'outcome' in p ? `a compile result (${String(p.outcome)}), not a package` : 'an object the I1 compiler did not produce';
    errors.push({ code: 'INVALID_PACKAGE', message: `expected an I1 ${kind}; got ${what}` });
    return { errors, evidence };
  }
  if (!(supplied instanceof Map)) {
    errors.push({ code: 'INVALID_QUERY_RESULTS', message: 'query results must be a Map from EvidenceQuery ID to Evidence<Boolean>' });
    return { errors, evidence };
  }
  const queries = new Map((pkg as CompiledPackage | PreviewPackage).declarations.filter((d) => d.kind === 'EvidenceQuery').map((d) => [d.id, d]));
  for (const [id, v] of supplied as Map<unknown, unknown>) {
    const q = typeof id === 'string' ? queries.get(id) : undefined;
    if (!q || q.kind !== 'EvidenceQuery') {
      errors.push({ code: 'UNEXPECTED_QUERY_RESULT', query: String(id), message: `no EvidenceQuery '${String(id)}' in this package` });
    } else if (contractHoles(q.contract).length > 0) {
      errors.push({ code: 'RESULT_FOR_HOLED_QUERY', query: q.id, message: `'${q.id}' contains the authoring hole(s) ${contractHoles(q.contract).join(', ')}; a supplied result cannot fill it` });
    } else {
      const e = normalizeEvidence(v);
      if (typeof e === 'string') errors.push({ code: 'MALFORMED_QUERY_RESULT', query: q.id, message: e });
      else evidence.set(q.id, e);
    }
  }
  for (const q of queries.values()) {
    if (q.kind === 'EvidenceQuery' && contractHoles(q.contract).length === 0 && !supplied.has(q.id)) {
      errors.push({ code: 'MISSING_QUERY_RESULT', query: q.id, message: `no supplied result for '${q.id}'; an absent result is an input error, never Unresolved{Missing}` });
    }
  }
  errors.sort((a, b) => compareCodePoints(a.query ?? '', b.query ?? '') || compareCodePoints(a.code, b.code));
  return { errors, evidence };
}

// ---------- evaluation

function evaluate<R>(pkg: CompiledPackage | PreviewPackage, evidence: ReadonlyMap<string, EvidenceOf<R>>, refs: RefOps<R>, origin: 'supplied' | 'computed', previewStages?: ReadonlyMap<string, readonly string[]>) {
  type V = Value<R>;
  type D = Decision<R>;
  const show = (v: V) => showValue(v, refs);
  const values = new Map<string, V>();
  const outputs: [string, ProgramOutput][] = [];
  const trace: TraceEntry[] = [];
  const attributes: [string, FindingAttributes][] = [];
  const staticMarkers = new Map(('markers' in pkg ? pkg.markers : []).map((m) => [m.output, m.holes]));

  /** The declarations and holes a sub-expression's steps read directly. */
  const readsOf = (ss: readonly TraceStep[]): string[] => [...new Set(ss.flatMap((x) => (x.form === 'ref' || x.form === 'hole' ? x.uses : [])))];
  const expr = (e: Expr, steps: TraceStep[]): V => {
    if (e.form === 'hole') {
      const v: V = { kind: 'marker', holes: [e.hole] };
      steps.push({ source: e.location, form: 'hole', result: show(v), uses: [e.hole], because: `authoring hole ${e.hole}: incomplete authoring, not patient uncertainty` });
      return v;
    }
    if (e.form === 'ref') {
      const v = values.get(e.target) as V;
      steps.push({ source: e.location, form: 'ref', result: show(v), uses: [e.target], because: `reads ${e.target}` });
      return v;
    }
    if (e.form === 'evidenceValue') {
      const before = steps.length;
      const a = expr(e.arg, steps);
      const uses = readsOf(steps.slice(before));
      let v: V;
      let because: string;
      if (a.kind === 'marker') {
        v = a;
        because = 'the projected query is an authoring hole, so the marker is kept';
      } else {
        const ev = (a as { kind: 'evidence'; evidence: EvidenceOf<R> }).evidence;
        const d = projectEvidence(ev);
        v = d.value === 'Unknown'
          ? { kind: 'decision', value: 'Unknown', causes: [...d.causes], ids: [...(ev as Extract<EvidenceOf<R>, { status: 'Unresolved' }>).candidateEvidenceIds] }
          : { kind: 'decision', value: d.value, causes: [], ids: [...(ev as Extract<EvidenceOf<R>, { status: 'Known' }>).supportingEvidenceIds] };
        because = `${show(a)} projects to ${show(v)} with the same ${ev.status === 'Known' ? 'supporting' : 'candidate'} IDs (contract §5.2)`;
      }
      steps.push({ source: e.location, form: 'evidenceValue', result: show(v), uses, because });
      return v;
    }
    // all: every operand is evaluated and traced, even after a decisive one.
    const ops = e.args.map((x) => {
      const before = steps.length;
      const v = expr(x, steps);
      return { v, uses: readsOf(steps.slice(before)) };
    });
    const marked = ops.filter((o) => o.v.kind === 'marker');
    let v: V;
    let because: string;
    if (marked.length > 0) {
      v = { kind: 'marker', holes: [...new Set(marked.flatMap((o) => (o.v as { holes: string[] }).holes))].sort(compareCodePoints) };
      because = `an operand depends on authoring hole(s) ${v.holes.join(', ')}; Boolean simplification never removes a marker`;
    } else {
      const ds = ops.map((o) => o.v as D);
      const f = ds.filter((d) => d.value === 'False');
      const u = ds.filter((d) => d.value === 'Unknown');
      if (f.length > 0) v = { kind: 'decision', value: 'False', causes: [], ids: sortRefs(f.flatMap((d) => d.ids), refs) };
      else if (u.length > 0) v = { kind: 'decision', value: 'Unknown', causes: sortCauses(u.flatMap((d) => d.causes)), ids: sortRefs(u.flatMap((d) => d.ids), refs) };
      else v = { kind: 'decision', value: 'True', causes: [], ids: sortRefs(ds.flatMap((d) => d.ids), refs) };
      because = ds.length === 0
        ? 'all() over zero operands is True with empty support'
        : `all(${ds.map(show).join(', ')}) = ${show(v)} (Kleene; ${f.length > 0 ? 'support from the False operands' : u.length > 0 ? 'causes and candidates from the Unknown operands' : 'support from every operand'})`;
    }
    steps.push({ source: e.location, form: 'all', result: show(v), uses: [...new Set(ops.flatMap((o) => o.uses))], because });
    return v;
  };

  const decisionOutput = (v: V, field: 'decision' | 'status'): ProgramOutput => {
    if (v.kind === 'marker') return (field === 'decision' ? { marker: { holes: v.holes } } : { status: { marker: { holes: v.holes } } }) as ProgramOutput;
    const d = v as D;
    const value: DecisionValue = d.value === 'Unknown' ? { value: 'Unknown', causes: d.causes } : { value: d.value };
    const ids = d.value === 'Unknown' ? { candidateEvidenceIds: d.ids } : { supportingEvidenceIds: d.ids };
    return { [field]: value, ...ids } as unknown as ProgramOutput;
  };
  const checkMarker = (output: string, v: V) => {
    const expected = staticMarkers.get(output) ?? [];
    const got = v.kind === 'marker' ? v.holes : [];
    if (expected.join('\u0000') !== got.join('\u0000')) throw new Error(`invariant: ${output} marker ${got} differs from the compiler's static marker ${expected}`);
  };

  for (const d of pkg.declarations as readonly CompiledDeclaration[]) {
    const steps: TraceStep[] = [];
    if (d.kind === 'EvidenceQuery') {
      const source = `${d.location}/contract`;
      const holes = contractHoles(d.contract);
      if (holes.length > 0) {
        const v: V = { kind: 'marker', holes: [...holes].sort(compareCodePoints) };
        values.set(d.id, v);
        checkMarker(d.id, v);
        // The stages a raw-input preview actually ran for this query; isolated execution runs none.
        const ran = previewStages?.get(d.id) ?? [];
        outputs.push([d.id, { marker: { holes: v.holes }, stagesRun: [...ran] } as ProgramOutput]);
        const because = d.contract.kind === 'hole'
          ? `whole-contract authoring hole ${d.contract.hole}: no evidence stage runs and nothing is read`
          : previewStages
            ? `criterion authoring hole(s) ${holes.join(', ')}: the query stays marked (incomplete authoring, not patient uncertainty). Preview-query evaluation ran ${ran.join(', ')} on this evaluation's records (per-record results in this query's preview result); nothing was classified and no S6 result or Evidence<Boolean> exists`
            : `criterion authoring hole(s) ${holes.join(', ')}: the query is marked; no evidence stage runs in isolated execution (S1–S4 and the sibling criterion run in experimentalEvaluatePreviewQuery)`;
        trace.push({ output: d.id, source, result: show(v), because, steps });
      } else {
        const ev = evidence.get(d.id) as EvidenceOf<R>;
        const v: V = { kind: 'evidence', evidence: ev };
        values.set(d.id, v);
        // The evidence object itself, unchanged (computed evidence keeps its provenance).
        outputs.push([d.id, { evidence: ev, origin } as unknown as ProgramOutput]);
        const because = origin === 'supplied'
          ? 'supplied directly as Evidence<Boolean>; the evidence-query pipeline (S1–S6) did not run'
          : 'computed by the evidence-query pipeline (S1–S6) from this evaluation’s raw records; its S6 trace is in queryEvidence.trace';
        trace.push({ output: d.id, source, result: show(v), because, steps });
      }
    } else if (d.kind === 'Predicate') {
      const v = expr(d.expr, steps);
      values.set(d.id, v);
      checkMarker(d.id, v);
      outputs.push([d.id, decisionOutput(v, 'decision')]);
      trace.push({ output: d.id, source: `${d.location}/expr`, result: show(v), because: (steps[steps.length - 1] as TraceStep).because, steps });
    } else {
      const v = expr(d.status, steps);
      checkMarker(`${d.id}.status`, v);
      const out = decisionOutput(v, 'status') as { [k: string]: unknown };
      trace.push({ output: `${d.id}.status`, source: `${d.location}/status`, result: show(v), because: `${(steps[steps.length - 1] as TraceStep).because}. A False status says only that this finding is not established`, steps });
      if (d.urgency) {
        const u: V = { kind: 'marker', holes: [d.urgency.hole] };
        checkMarker(`${d.id}.urgency`, u);
        out['urgency'] = { marker: { holes: u.holes } };
        const source = d.urgency.location.replace(/\/hole$/, '');
        trace.push({ output: `${d.id}.urgency`, source, result: show(u), because: `attribute hole ${d.urgency.hole}: marks only this attribute, never the status`, steps: [] });
      }
      outputs.push([d.id, out as ProgramOutput]);
      attributes.push([d.id, { label: d.label, heading: d.heading, cites: d.cites }]);
    }
  }
  return { outputs, trace, attributes };
}

/**
 * Internal (not exported from the package): the one expression evaluator, over any reference type.
 * Callers own the evidence: the supplied-results APIs validate it, the raw-record entry point computes it.
 */
export function evaluateProgram<R>(
  pkg: CompiledPackage | PreviewPackage,
  evidence: ReadonlyMap<string, EvidenceOf<R>>,
  refs: RefOps<R>,
  origin: 'supplied' | 'computed',
  /** Raw-input preview only: the stages its preview-query evaluation actually ran, per holed query. */
  previewStages?: ReadonlyMap<string, readonly string[]>,
) {
  const { outputs, trace, attributes } = evaluate(pkg, evidence, refs, origin, previewStages);
  // Pairs → own data properties (detach), so IDs such as `__proto__` stay ordinary keys.
  return { outputs: Object.fromEntries(outputs), findingAttributes: Object.fromEntries(attributes), trace };
}

function run(pkg: CompiledPackage | PreviewPackage, evidence: Map<string, SuppliedEvidence>) {
  return {
    outcome: 'Executed' as const,
    experimental: 'nonclinical-ppl-isolated-execution-v0' as const,
    scope: 'program-expressions-with-supplied-query-results' as const,
    packageId: pkg.packageId,
    ...evaluateProgram(pkg, evidence, STRING_REFS, 'supplied'),
  };
}

/**
 * Normal isolated execution: a complete CompiledPackage plus one supplied Evidence<Boolean> per
 * EvidenceQuery. Program expressions only; NOT end-to-end evaluation (no query is computed).
 */
export function executeWithSuppliedQueryResults(pkg: CompiledPackage, suppliedQueryResults: ReadonlyMap<string, SuppliedEvidence>): ExecutionResult {
  const { errors, evidence } = checkInputs(pkg, 'CompiledPackage', suppliedQueryResults);
  if (errors.length > 0) return detach({ outcome: 'ExecutionInputError', errors });
  return detach({ ...run(pkg, evidence), mode: 'normal' as const });
}

/**
 * Preview isolated execution: a PreviewPackage plus supplied results for its complete queries only.
 * Holed outputs keep their authoring markers; publication stays blocked.
 */
export function executePreviewWithSuppliedQueryResults(pkg: PreviewPackage, suppliedQueryResults: ReadonlyMap<string, SuppliedEvidence>): PreviewExecutionResult {
  const { errors, evidence } = checkInputs(pkg, 'PreviewPackage', suppliedQueryResults);
  if (errors.length > 0) return detach({ outcome: 'ExecutionInputError', errors });
  return detach({ ...run(pkg, evidence), mode: 'preview' as const, publication: 'Blocked' as const, markers: pkg.markers, inspectable: pkg.inspectable });
}
