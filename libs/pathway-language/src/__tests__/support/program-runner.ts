/**
 * EXPERIMENTAL, NONCLINICAL. Runs the compile/preview expectations of the first-program acceptance
 * examples (docs/superpowers/records/pathway-language/programs/examples) against the I1 compiler.
 *
 * Only `compile` and `preview`, and `state` where compilation alone decides it, are checked.
 * Evaluation expectations (outputs, causeAttribution, trace) are counted as outside I1 scope:
 * nothing here executes a program.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { experimentalCompile, experimentalCompilePreview, type Diagnostic, type JsonValue } from '../../index';

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
  checked: number;
  failures: string[];
  outOfScope: string[];
}

const diagKey = (d: Json | Diagnostic) => JSON.stringify([d.code, d.location, d.hole ?? null]);
const sameSet = (a: string[], b: string[]) => isDeepStrictEqual([...a].sort(), [...b].sort());

export function runProgramExamples(dir: string = PROGRAM_DIR): ExampleReport[] {
  const reports: ExampleReport[] = [];
  for (const name of readdirSync(join(dir, 'examples')).sort()) {
    const ex = JSON.parse(readFileSync(join(dir, 'examples', name), 'utf8')) as Json;
    const report: ExampleReport = { id: ex.id, checked: 0, failures: [], outOfScope: [] };
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
    for (const k of ['outputs', 'causeAttribution', 'trace']) if (exp[k] !== null && exp[k] !== undefined) report.outOfScope.push(k);
  }
  return reports;
}

export type { Diagnostic };
