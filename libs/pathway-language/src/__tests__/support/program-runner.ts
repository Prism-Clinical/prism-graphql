/**
 * EXPERIMENTAL, NONCLINICAL. Runs the compile/preview expectations of the first-program acceptance
 * examples (docs/superpowers/records/pathway-language/programs/examples) against the I1 compiler.
 *
 * Checked, and reported separately:
 * - I1 compiler checks: `compile`, `preview`, and `state` where compilation alone decides it;
 * - I2 isolated program-expression checks: applicability, Predicate and Finding outputs and their
 *   trace entries, executed over the example's own expected query evidence SUPPLIED directly. These
 *   are isolated tests, NOT end-to-end runs: no query is computed;
 * - I2 preview-output checks: every preview output and trace entry that depends only on markers.
 * Query outputs and query traces of complete queries (supplied, not computed), causeAttribution
 * (S1–S6) and evaluated `state` values stay outside scope.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecutePreviewWithSuppliedQueryResults,
  experimentalExecuteWithSuppliedQueryResults,
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

const diagKey = (d: Json | Diagnostic) => JSON.stringify([d.code, d.location, d.hole ?? null]);
const sameSet = (a: string[], b: string[]) => isDeepStrictEqual([...a].sort(), [...b].sort());

export function runProgramExamples(dir: string = PROGRAM_DIR): ExampleReport[] {
  const reports: ExampleReport[] = [];
  for (const name of readdirSync(join(dir, 'examples')).sort()) {
    const ex = JSON.parse(readFileSync(join(dir, 'examples', name), 'utf8')) as Json;
    const report: ExampleReport = { id: ex.id, checked: 0, executionChecked: 0, previewChecked: 0, failures: [], outOfScope: [] };
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
    else {
      check(['EstablishedTrue', 'EstablishedFalse', 'UnresolvedPatientEvidence'].includes(exp.state), `state ${exp.state} for a compiled program`);
      report.outOfScope.push(`state value ${exp.state} (decided by evaluation)`);
    }
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
      }
    }
    if (!entry.includes('evaluate') && !entry.includes('evaluatePreview')) {
      for (const k of ['outputs', 'trace']) if (exp[k] !== null && exp[k] !== undefined) report.outOfScope.push(`${k} (no execution entry point)`);
    }
    if (exp.causeAttribution !== null && exp.causeAttribution !== undefined) report.outOfScope.push('causeAttribution (S1–S6, not run)');
  }
  return reports;
}

export type { Diagnostic };
