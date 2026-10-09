/**
 * EXPERIMENTAL, NONCLINICAL. Isolated execution of compiled PPL program expressions (I2).
 *
 * Evaluates `ref`, `evidenceValue`, `all`, Predicate outputs and Finding status/attributes over an
 * I1 package, given EvidenceQuery results SUPPLIED by the caller. It runs no evidence-query stage
 * (S1–S6), reads no patient record and generates no Need. Pure: no I/O, no clock, no input
 * mutation; results are detached and deep-frozen like compiler results.
 */
import { compiledKind, detach } from '../compile/compile';
import type { CompiledDeclaration, CompiledPackage, Expr, PreviewPackage } from '../compile/types';
import { compareCodePoints } from '../s1/resolve';
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
function sortIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const x = idTuple(a);
    const y = idTuple(b);
    for (let i = 0; i < 4; i += 1) {
      const d = compareCodePoints(x[i] as string, y[i] as string);
      if (d !== 0) return d;
    }
    return 0;
  });
}
const sortCauses = (cs: Iterable<Cause>): Cause[] => {
  const set = new Set(cs);
  return CAUSES.filter((c) => set.has(c));
};

// ---------- runtime values

type Decision = { kind: 'decision'; value: 'True' | 'False' | 'Unknown'; causes: Cause[]; ids: string[] };
type Value = Decision | { kind: 'evidence'; evidence: SuppliedEvidence } | { kind: 'marker'; holes: string[] };

const showIds = (ids: readonly string[]) => `[${ids.join(', ')}]`;
function show(v: Value): string {
  if (v.kind === 'marker') return `Marker[${v.holes.join(', ')}]`;
  if (v.kind === 'evidence') {
    const e = v.evidence;
    return e.status === 'Known' ? `Known(${e.value}, ${showIds(e.supportingEvidenceIds)})` : `Unresolved{${e.causes.join(', ')}}`;
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
    } else if (q.contract.kind === 'hole') {
      errors.push({ code: 'RESULT_FOR_HOLED_QUERY', query: q.id, message: `'${q.id}' is the authoring hole ${q.contract.hole}; a supplied result cannot fill it` });
    } else {
      const e = normalizeEvidence(v);
      if (typeof e === 'string') errors.push({ code: 'MALFORMED_QUERY_RESULT', query: q.id, message: e });
      else evidence.set(q.id, e);
    }
  }
  for (const q of queries.values()) {
    if (q.kind === 'EvidenceQuery' && q.contract.kind !== 'hole' && !supplied.has(q.id)) {
      errors.push({ code: 'MISSING_QUERY_RESULT', query: q.id, message: `no supplied result for '${q.id}'; an absent result is an input error, never Unresolved{Missing}` });
    }
  }
  errors.sort((a, b) => compareCodePoints(a.query ?? '', b.query ?? '') || compareCodePoints(a.code, b.code));
  return { errors, evidence };
}

// ---------- evaluation

function evaluate(pkg: CompiledPackage | PreviewPackage, evidence: Map<string, SuppliedEvidence>) {
  const values = new Map<string, Value>();
  const outputs: [string, ProgramOutput][] = [];
  const trace: TraceEntry[] = [];
  const attributes: [string, FindingAttributes][] = [];
  const staticMarkers = new Map(('markers' in pkg ? pkg.markers : []).map((m) => [m.output, m.holes]));

  /** The declarations and holes a sub-expression's steps read directly. */
  const readsOf = (ss: readonly TraceStep[]): string[] => [...new Set(ss.flatMap((x) => (x.form === 'ref' || x.form === 'hole' ? x.uses : [])))];
  const expr = (e: Expr, steps: TraceStep[]): Value => {
    if (e.form === 'hole') {
      const v: Value = { kind: 'marker', holes: [e.hole] };
      steps.push({ source: e.location, form: 'hole', result: show(v), uses: [e.hole], because: `authoring hole ${e.hole}: incomplete authoring, not patient uncertainty` });
      return v;
    }
    if (e.form === 'ref') {
      const v = values.get(e.target) as Value;
      steps.push({ source: e.location, form: 'ref', result: show(v), uses: [e.target], because: `reads ${e.target}` });
      return v;
    }
    if (e.form === 'evidenceValue') {
      const before = steps.length;
      const a = expr(e.arg, steps);
      const uses = readsOf(steps.slice(before));
      let v: Value;
      let because: string;
      if (a.kind === 'marker') {
        v = a;
        because = 'the projected query is an authoring hole, so the marker is kept';
      } else {
        const ev = (a as { kind: 'evidence'; evidence: SuppliedEvidence }).evidence;
        v = ev.status === 'Known'
          ? { kind: 'decision', value: ev.value ? 'True' : 'False', causes: [], ids: [...ev.supportingEvidenceIds] }
          : { kind: 'decision', value: 'Unknown', causes: [...ev.causes], ids: [...ev.candidateEvidenceIds] };
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
    let v: Value;
    let because: string;
    if (marked.length > 0) {
      v = { kind: 'marker', holes: [...new Set(marked.flatMap((o) => (o.v as { holes: string[] }).holes))].sort(compareCodePoints) };
      because = `an operand depends on authoring hole(s) ${v.holes.join(', ')}; Boolean simplification never removes a marker`;
    } else {
      const ds = ops.map((o) => o.v as Decision);
      const f = ds.filter((d) => d.value === 'False');
      const u = ds.filter((d) => d.value === 'Unknown');
      if (f.length > 0) v = { kind: 'decision', value: 'False', causes: [], ids: sortIds(f.flatMap((d) => d.ids)) };
      else if (u.length > 0) v = { kind: 'decision', value: 'Unknown', causes: sortCauses(u.flatMap((d) => d.causes)), ids: sortIds(u.flatMap((d) => d.ids)) };
      else v = { kind: 'decision', value: 'True', causes: [], ids: sortIds(ds.flatMap((d) => d.ids)) };
      because = ds.length === 0
        ? 'all() over zero operands is True with empty support'
        : `all(${ds.map(show).join(', ')}) = ${show(v)} (Kleene; ${f.length > 0 ? 'support from the False operands' : u.length > 0 ? 'causes and candidates from the Unknown operands' : 'support from every operand'})`;
    }
    steps.push({ source: e.location, form: 'all', result: show(v), uses: [...new Set(ops.flatMap((o) => o.uses))], because });
    return v;
  };

  const decisionOutput = (v: Value, field: 'decision' | 'status'): ProgramOutput => {
    if (v.kind === 'marker') return (field === 'decision' ? { marker: { holes: v.holes } } : { status: { marker: { holes: v.holes } } }) as ProgramOutput;
    const d = v as Decision;
    const value: DecisionValue = d.value === 'Unknown' ? { value: 'Unknown', causes: d.causes } : { value: d.value };
    const ids = d.value === 'Unknown' ? { candidateEvidenceIds: d.ids } : { supportingEvidenceIds: d.ids };
    return { [field]: value, ...ids } as unknown as ProgramOutput;
  };
  const checkMarker = (output: string, v: Value) => {
    const expected = staticMarkers.get(output) ?? [];
    const got = v.kind === 'marker' ? v.holes : [];
    if (expected.join('\u0000') !== got.join('\u0000')) throw new Error(`invariant: ${output} marker ${got} differs from the compiler's static marker ${expected}`);
  };

  for (const d of pkg.declarations as readonly CompiledDeclaration[]) {
    const steps: TraceStep[] = [];
    if (d.kind === 'EvidenceQuery') {
      const source = `${d.location}/contract`;
      if (d.contract.kind === 'hole') {
        const v: Value = { kind: 'marker', holes: [d.contract.hole] };
        values.set(d.id, v);
        checkMarker(d.id, v);
        outputs.push([d.id, { marker: { holes: v.holes }, stagesRun: [] }]);
        trace.push({ output: d.id, source, result: show(v), because: `whole-contract authoring hole ${d.contract.hole}: no evidence stage runs and nothing is read`, steps });
      } else {
        const ev = evidence.get(d.id) as SuppliedEvidence;
        const v: Value = { kind: 'evidence', evidence: ev };
        values.set(d.id, v);
        outputs.push([d.id, { evidence: ev, origin: 'supplied' }]);
        trace.push({ output: d.id, source, result: show(v), because: 'supplied directly as Evidence<Boolean>; the evidence-query pipeline (S1–S6) did not run', steps });
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
        const u: Value = { kind: 'marker', holes: [d.urgency.hole] };
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

function run(pkg: CompiledPackage | PreviewPackage, evidence: Map<string, SuppliedEvidence>) {
  const { outputs, trace, attributes } = evaluate(pkg, evidence);
  return {
    outcome: 'Executed' as const,
    experimental: 'nonclinical-ppl-isolated-execution-v0' as const,
    scope: 'program-expressions-with-supplied-query-results' as const,
    packageId: pkg.packageId,
    // Pairs → own data properties (detach), so IDs such as `__proto__` stay ordinary keys.
    outputs: Object.fromEntries(outputs),
    findingAttributes: Object.fromEntries(attributes),
    trace,
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
