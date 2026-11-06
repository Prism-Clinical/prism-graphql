/**
 * EXPERIMENTAL, NONCLINICAL. Runs the compile/preview expectations of the first-program acceptance
 * examples (docs/superpowers/records/pathway-language/programs/examples) against the I1 compiler.
 *
 * Checked, and reported separately:
 * - I1 compiler checks: `compile`, `preview`, and `state` where compilation alone decides it;
 * - I2 isolated program-expression checks: applicability, Predicate and Finding outputs and their
 *   trace entries, executed over the example's own expected query evidence SUPPLIED directly. These
 *   are isolated tests, NOT end-to-end runs: no query is computed;
 * - I2 preview-output checks: every preview output and trace entry that depends only on markers;
 * - raw-input checks (bounded I6 slice): for a compiled one-query program with raw inputs, every
 *   expected output (query evidence included), trace `source`/`result`, `causeAttribution` and
 *   `state`, from experimentalExecuteFromRawRecords over the example's own records and snapshot.
 *   Structured references are compared in fixture notation (a display projection); the structured
 *   identities themselves are checked by the unit tests.
 * - raw-input preview checks (bounded I6 slice): for a one-query PreviewPackage whose query is holed,
 *   every expected output and trace `source`/`result` from experimentalExecutePreviewFromRawRecords
 *   over the example's own raw inputs; and, separately, partial query-stage checks (the stages the
 *   preview query actually ran, the query marker, no S6 cause attribution, publication blocked).
 * - complete-query preview checks (bounded I6 slice): for a one-query PreviewPackage whose query is
 *   complete (holes elsewhere), every expected output (query evidence included), trace
 *   `source`/`result`, `causeAttribution`, and the incomplete-authoring state with publication
 *   blocked, from the same entry point over the example's own raw inputs and snapshot statements.
 * Everything else (Needs, multi-query programs) stays outside scope.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  experimentalExecuteWithSuppliedQueryResults,
  type NodeRef,
  type RawExecutionResult,
  type CompiledProgram,
  type Diagnostic,
  type JsonValue,
  type SuppliedEvidence,
} from '../../index';

export const PROGRAM_DIR = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'superpowers', 'records', 'pathway-language', 'programs');

type Json = { [k: string]: any }; // example documents are untyped JSON

/** RFC 6902 `replace` only: example patches are harness input preparation, not a language feature. */
export function applyPatch(doc: JsonValue, patch: readonly Json[]): JsonValue {
  const copy = JSON.parse(JSON.stringify(doc)) as Json;
  for (const op of patch) {
    if (op.op !== 'replace') throw new Error(`unsupported patch op ${op.op}`);
    const parts = (op.path as string).split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = parts.pop() as string;
    const parent = parts.reduce((o: Json, k) => o[k], copy);
    if (!(last in parent)) throw new Error(`patch path ${op.path} does not exist`);
    parent[last] = op.value;
  }
  return copy;
}

export interface ExampleReport {
  id: string;
  /** I1 compiler checks. */
  checked: number;
  /** I2 isolated program-expression checks (supplied query evidence). */
  executionChecked: number;
  /** I2 preview-output checks. */
  previewChecked: number;
  /** Raw-input checks: the program executed over query evidence computed from the example's records. */
  rawChecked: number;
  /** Raw-input preview checks: program preview outputs and trace from the example's own raw inputs. */
  rawPreviewChecked: number;
  /** Partial query-stage checks of that raw preview (stages run, query marker, no attribution, publication). */
  partialStageChecked: number;
  /** Complete-query preview checks: a complete query's computed evidence inside a PreviewPackage. */
  completePreviewChecked: number;
  failures: string[];
  outOfScope: string[];
}

/** Complete EvidenceQuery IDs of a package, read from the package (never hard-coded). */
const completeQueries = (p: CompiledProgram) =>
  new Set(p.declarations.filter((d) => d.kind === 'EvidenceQuery' && d.contract.kind !== 'hole').map((d) => d.id));

/** Compares program-level outputs and trace entries of one execution; returns the number of checks. */
function compareExecution(exp: Json, result: Json, supplied: Set<string>, report: ExampleReport, label: string): number {
  let n = 0;
  const check = (ok: boolean, what: string) => {
    n += 1;
    if (!ok) report.failures.push(`${label} ${what}`);
  };
  if (result.outcome !== 'Executed') {
    check(false, `execution failed: ${JSON.stringify(result.errors)}`);
    return n;
  }
  for (const [name, expected] of Object.entries(exp.outputs as Json)) {
    if (supplied.has(name)) continue; // supplied query evidence is input, not an output to check
    check(isDeepStrictEqual(result.outputs[name], expected), `outputs[${name}] ${JSON.stringify(result.outputs[name])}`);
  }
  for (const t of exp.trace as Json[]) {
    if (supplied.has(t.output)) continue;
    const got = (result.trace as Json[]).find((x) => x.output === t.output);
    check(got?.source === t.source && got?.result === t.result, `trace ${t.output}: ${JSON.stringify(got && { source: got.source, result: got.result })}`);
  }
  return n;
}

const showRef = (n: NodeRef) => `${n.revision.source}/${n.revision.localId}@${n.revision.revision}${n.digest ? `#${n.digest}` : ''}`;

const rawInput = (i: Json) => ({
  subject: i.context.subject,
  revisions: i.records,
  retractions: i.retractions,
  contextEncounter: i.context.encounter,
  contextEpisode: i.context.episode,
  snapshot: { id: i.snapshot, coverage: i.coverage, failures: i.failures, rejectedItems: i.rejectedItems },
});
const runRaw = (pkg: CompiledProgram, i: Json): RawExecutionResult => experimentalExecuteFromRawRecords(pkg as never, rawInput(i));

/** Raw-input preview of a one-holed-query PreviewPackage: [program-preview checks, partial query-stage checks]. */
function compareRawPreview(exp: Json, pkg: CompiledProgram, i: Json, report: ExampleReport): [number, number] {
  const r = experimentalExecutePreviewFromRawRecords(pkg as never, rawInput(i));
  if (r.queryAuthoring !== 'Incomplete') {
    report.failures.push(`raw preview: expected the incomplete-authoring branch, got ${r.queryAuthoring}`);
    return [1, 0];
  }
  let n = 0;
  let m = 0;
  const check = (ok: boolean, what: string, partial = false) => {
    if (partial) m += 1;
    else n += 1;
    if (!ok) report.failures.push(`raw preview ${what}`);
  };
  for (const [name, expected] of Object.entries(exp.outputs as Json)) check(isDeepStrictEqual(r.outputs[name], expected), `outputs[${name}] ${JSON.stringify(r.outputs[name])}`);
  for (const t of exp.trace as Json[]) {
    const got = r.trace.find((x) => x.output === t.output);
    check(got?.source === t.source && got?.result === t.result, `trace ${t.output}: ${JSON.stringify(got && { source: got.source, result: got.result })}`);
  }
  const q = r.query;
  check(isDeepStrictEqual(r.previewQuery.stagesRun, (exp.outputs as Json)[q]?.stagesRun), `previewQuery.stagesRun ${JSON.stringify(r.previewQuery.stagesRun)}`, true);
  check(isDeepStrictEqual(r.previewQuery.marker, (exp.outputs as Json)[q]?.marker) && r.previewQuery.queryStatus === 'Incomplete', 'previewQuery marker or status', true);
  // Preview runs no S6, so no cause can be attributed: the expectation must be empty.
  check(isDeepStrictEqual(exp.causeAttribution, []), `causeAttribution ${JSON.stringify(exp.causeAttribution)} (no S6 in preview)`, true);
  check(exp.state === 'IncompleteAuthoring' && r.publication === 'Blocked', `state ${exp.state}, publication ${r.publication}`, true);
  return [n, m];
}

/** Raw-input preview of a one-complete-query PreviewPackage: outputs, trace, causeAttribution, state and publication. */
function compareCompletePreview(exp: Json, pkg: CompiledProgram, i: Json, report: ExampleReport): number {
  const r = experimentalExecutePreviewFromRawRecords(pkg as never, rawInput(i));
  let n = 0;
  const check = (ok: boolean, what: string) => {
    n += 1;
    if (!ok) report.failures.push(`complete preview ${what}`);
  };
  if (r.queryAuthoring !== 'Complete') {
    check(false, `expected the complete-query branch, got ${r.queryAuthoring}`);
    return n;
  }
  for (const [name, expected] of Object.entries(exp.outputs as Json)) {
    const got = r.outputs[name] ? project(r.outputs[name] as Json) : undefined;
    check(isDeepStrictEqual(got, expected), `outputs[${name}] ${JSON.stringify(got)}`);
  }
  for (const t of exp.trace as Json[]) {
    const got = r.trace.find((x) => x.output === t.output);
    check(got?.source === t.source && got?.result === t.result, `trace ${t.output}: ${JSON.stringify(got && { source: got.source, result: got.result })}`);
  }
  check(isDeepStrictEqual(attribution(r.queryEvidence), (exp.causeAttribution as Json[]).map(attrKey).sort()), `causeAttribution ${JSON.stringify(attribution(r.queryEvidence))}`);
  // A hole elsewhere keeps the program incomplete whatever the patient evidence is.
  check(exp.state === 'IncompleteAuthoring' && r.publication === 'Blocked', `state ${exp.state}, publication ${r.publication}`);
  return n;
}

const attrKey = (a: Json) => JSON.stringify([a.cause, a.origin, a.stage, a.reason, a.refs ?? null]);
/** S6 cause attribution in fixture projection, as a set. */
const attribution = (ev: RawExecutionResult['queryEvidence']) => [...new Set(ev.trace.attribution.map((a) => attrKey({ ...a, origin: a.label, refs: a.refs?.map(showRef) })))].sort();

/** Fixture notation of one raw-execution output (display projection; provenance and `origin` are outside the example format). */
function project(o: Json): Json {
  // A marker output carries no references.
  const refs = (x: Json) => ('supportingEvidenceIds' in x ? { supportingEvidenceIds: x.supportingEvidenceIds.map(showRef) } : 'candidateEvidenceIds' in x ? { candidateEvidenceIds: x.candidateEvidenceIds.map(showRef) } : {});
  if ('evidence' in o) {
    const e = o.evidence;
    return { evidence: e.status === 'Known' ? { status: 'Known', value: e.value, ...refs(e) } : { status: 'Unresolved', causes: e.causes, ...refs(e) } };
  }
  return { ...o, ...refs(o) };
}

/** Every expected output, trace `source`/`result`, `causeAttribution` (fixture projection, as a set) and `state`. */
function compareRaw(exp: Json, r: RawExecutionResult, report: ExampleReport): number {
  let n = 0;
  const check = (ok: boolean, what: string) => {
    n += 1;
    if (!ok) report.failures.push(`raw ${what}`);
  };
  for (const [name, expected] of Object.entries(exp.outputs as Json)) {
    const got = r.outputs[name] ? project(r.outputs[name] as Json) : undefined;
    check(isDeepStrictEqual(got, expected), `outputs[${name}] ${JSON.stringify(got)}`);
  }
  for (const t of exp.trace as Json[]) {
    const got = r.trace.find((x) => x.output === t.output);
    check(got?.source === t.source && got?.result === t.result, `trace ${t.output}: ${JSON.stringify(got && { source: got.source, result: got.result })}`);
  }
  const gotA = attribution(r.queryEvidence);
  check(isDeepStrictEqual(gotA, (exp.causeAttribution as Json[]).map(attrKey).sort()), `causeAttribution ${JSON.stringify(gotA)}`);
  const findings = Object.entries(r.outputs).filter(([, o]) => 'status' in o);
  const status = findings.length === 1 ? (findings[0]![1] as Json).status.value : null;
  const state = { True: 'EstablishedTrue', False: 'EstablishedFalse', Unknown: 'UnresolvedPatientEvidence' }[status as string];
  check(state === exp.state, `state ${state} from the Finding status, expected ${exp.state}`);
  return n;
}

const diagKey = (d: Json | Diagnostic) => JSON.stringify([d.code, d.location, d.hole ?? null]);
const sameSet = (a: string[], b: string[]) => isDeepStrictEqual([...a].sort(), [...b].sort());

export function runProgramExamples(dir: string = PROGRAM_DIR): ExampleReport[] {
  const reports: ExampleReport[] = [];
  for (const name of readdirSync(join(dir, 'examples')).sort()) {
    const ex = JSON.parse(readFileSync(join(dir, 'examples', name), 'utf8')) as Json;
    const report: ExampleReport = { id: ex.id, checked: 0, executionChecked: 0, previewChecked: 0, rawChecked: 0, rawPreviewChecked: 0, partialStageChecked: 0, completePreviewChecked: 0, failures: [], outOfScope: [] };
    reports.push(report);
    const program = JSON.parse(readFileSync(join(dir, 'examples', ex.program.file), 'utf8')) as JsonValue;
    const source = applyPatch(program, ex.program.patch);
    const exp = ex.expected as Json;
    const check = (ok: boolean, what: string) => {
      report.checked += 1;
      if (!ok) report.failures.push(what);
    };

    const c = experimentalCompile(source);
    const ec = exp.compile as Json;
    check(c.outcome === ec.outcome, `compile.outcome ${c.outcome}, expected ${ec.outcome}`);
    check(c.wellFormed === ec.wellFormed, `compile.wellFormed ${c.wellFormed}, expected ${ec.wellFormed}`);
    check(sameSet(c.diagnostics.map(diagKey), (ec.diagnostics as Json[]).map(diagKey)), `compile.diagnostics ${JSON.stringify(c.diagnostics.map(diagKey))}`);
    if ('dependencyEdges' in ec) {
      const edges = c.outcome === 'Compiled' ? c.package.dependencyEdges : c.dependencyEdges;
      const got = (edges ?? []).map((e) => JSON.stringify([e.reader, e.read]));
      check(sameSet(got, (ec.dependencyEdges as string[][]).map((e) => JSON.stringify(e))), `compile.dependencyEdges ${JSON.stringify(got)}`);
    }

    const ep = exp.preview as Json | null;
    if (ep === null) report.outOfScope.push('preview (not requested by this example)');
    else {
      const p = experimentalCompilePreview(source);
      if (ep.sameDiagnostics) {
        check(p.outcome === 'CompileFailure', `preview.outcome ${p.outcome}, expected CompileFailure`);
        check(sameSet(p.diagnostics.map(diagKey), c.diagnostics.map(diagKey)), 'preview diagnostics differ from compile diagnostics');
      } else {
        check(p.outcome === ep.outcome, `preview.outcome ${p.outcome}, expected ${ep.outcome}`);
        if (p.outcome === 'PreviewPackage') {
          check(p.package.publication === ep.publication, `preview.publication ${p.package.publication}`);
          const markers = p.package.markers.map((m) => JSON.stringify([m.output, [...m.holes].sort()]));
          check(sameSet(markers, (ep.markers as Json[]).map((m) => JSON.stringify([m.output, [...m.holes].sort()]))), `preview.markers ${JSON.stringify(markers)}`);
          check(isDeepStrictEqual(p.package.inspectable, ep.inspectable), `preview.inspectable ${JSON.stringify(p.package.inspectable)}`);
        }
      }
    }

    // `state`: compilation alone decides InvalidProgram and IncompleteAuthoring. For a compiled
    // program it can only confirm that the state is one of the three evaluation states.
    if (c.outcome === 'CompileFailure' && !c.wellFormed) check(exp.state === 'InvalidProgram', `state ${exp.state} for a structural failure`);
    else if (c.outcome === 'CompileFailure') check(exp.state === 'IncompleteAuthoring', `state ${exp.state} for a holed program`);
    else check(['EstablishedTrue', 'EstablishedFalse', 'UnresolvedPatientEvidence'].includes(exp.state), `state ${exp.state} for a compiled program`);
    // I2: isolated execution with the example's own query evidence supplied directly.
    const entry = ex.entryPoints as string[];
    if (entry.includes('evaluate') && c.outcome === 'Compiled') {
      const supplied = completeQueries(c.package);
      const map = new Map([...supplied].map((q) => [q, exp.outputs[q].evidence as SuppliedEvidence]));
      report.executionChecked += compareExecution(exp, experimentalExecuteWithSuppliedQueryResults(c.package, map), supplied, report, 'isolated');
      report.outOfScope.push(`query evidence for ${[...supplied].join(', ')} (supplied, not computed)`);
    }
    if (entry.includes('evaluatePreview')) {
      const p = experimentalCompilePreview(source);
      if (p.outcome !== 'PreviewPackage') report.failures.push('preview execution: no PreviewPackage');
      else {
        const supplied = completeQueries(p.package);
        const map = new Map([...supplied].map((q) => [q, exp.outputs[q].evidence as SuppliedEvidence]));
        report.previewChecked += compareExecution(exp, experimentalExecutePreviewWithSuppliedQueryResults(p.package, map), supplied, report, 'preview');
        if (supplied.size > 0) report.outOfScope.push(`query evidence for ${[...supplied].join(', ')} (supplied, not computed)`);
        // Raw-input preview: one query, holed or complete, run from the example's own raw inputs.
        const queries = p.package.declarations.filter((d) => d.kind === 'EvidenceQuery');
        if (ex.input?.records && queries.length === 1 && supplied.size === 0) {
          const [n, m] = compareRawPreview(exp, p.package, ex.input, report);
          report.rawPreviewChecked += n;
          report.partialStageChecked += m;
          report.outOfScope.push('input.context.clock, input.context.mode and input.supersedesSnapshot (not preview-query inputs); snapshot statements validated, not read (no S6 for a holed query)');
        } else if (ex.input?.records && queries.length === 1) {
          report.completePreviewChecked += compareCompletePreview(exp, p.package, ex.input, report);
          report.outOfScope.push('input.context.clock, input.context.mode and input.supersedesSnapshot (not inputs of query-bound selection)');
          // The raw run computes the query output itself, so the isolated run's "supplied" note no longer applies.
          report.outOfScope = report.outOfScope.filter((x) => !x.startsWith('query evidence for'));
        }
      }
    }
    // Raw-input execution: one complete query, computed from the example's own records and snapshot.
    let raw = false;
    if (entry.includes('evaluate') && c.outcome === 'Compiled' && ex.input?.records && completeQueries(c.package).size === 1) {
      raw = true;
      report.rawChecked += compareRaw(exp, runRaw(c.package, ex.input), report);
      report.outOfScope.push('input.context.clock, input.context.mode and input.supersedesSnapshot (not inputs of query-bound selection)');
      // The raw run checks the query output itself, so the isolated run's "supplied" note no longer applies.
      report.outOfScope = report.outOfScope.filter((x) => !x.startsWith('query evidence for'));
    } else if (c.outcome === 'Compiled') report.outOfScope.push(`state value ${exp.state} (decided by evaluation)`);
    if (!entry.includes('evaluate') && !entry.includes('evaluatePreview')) {
      for (const k of ['outputs', 'trace']) if (exp[k] !== null && exp[k] !== undefined) report.outOfScope.push(`${k} (no execution entry point)`);
    }
    if (!raw && !entry.includes('evaluatePreview') && exp.causeAttribution !== null && exp.causeAttribution !== undefined) report.outOfScope.push('causeAttribution (S1–S6, not run)');
  }
  return reports;
}

export type { Diagnostic };
