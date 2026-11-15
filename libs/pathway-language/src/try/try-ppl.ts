/**
 * EXPERIMENTAL, NONCLINICAL developer tool: `npm run try:ppl -- --program <file> --scenario <file> [--preview] [--json]`.
 *
 * A thin runner over the existing compiler and raw-record executors. It reads two files, compiles
 * (normal or preview, never switching between them), executes, and prints what the engine returned.
 * It evaluates nothing itself and adds no language behaviour. Not part of the library boundary
 * (`src/index.ts` does not export it); it is the only module under `src/` that reads files.
 *
 * Exit codes: 0 evaluated (Unknown evidence and authoring markers included); 1 the compiler refused
 * the program; 2 usage, file, JSON or scenario-shape error; 3 the engine rejected the runtime input
 * (a configuration error). Anything else is an unexpected defect: it propagates (main prints the
 * stack and exits 70) and is never reported as patient uncertainty.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  type CompiledProgram,
  type Diagnostic,
  type NodeRef,
  type QueryEvidenceResult,
  type RawExecutionInput,
  type RawExecutionResult,
  type RawPreviewResult,
} from '../index';
import type { RawPreviewQueryResult } from '../execute/raw';
import * as engine from '../index';

/**
 * Every configuration-error class the library exports. The raw executors wrap most of them, but some
 * stage errors (for example a malformed context binding's EpisodeCheckConfigurationError) reach the
 * caller unwrapped; all are invalid input, never patient uncertainty and never a defect.
 */
const CONFIGURATION_ERRORS = Object.entries(engine).filter(([k, v]) => k.endsWith('ConfigurationError') && typeof v === 'function').map(([, v]) => v as new (...a: never[]) => Error);
const isConfigurationError = (e: unknown): e is Error => CONFIGURATION_ERRORS.some((C) => e instanceof C);

export const EXIT = { evaluated: 0, compileRefused: 1, input: 2, configuration: 3, internal: 70 } as const;

export interface RunOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

class InputError extends Error {}

const USAGE = `usage: npm run try:ppl -- --program <file.ppl.json> --scenario <file.json> [--preview] [--json]
  --preview  compile for preview: authoring holes become markers (publication stays blocked)
  --json     print the compile outcome and the engine result unchanged, as JSON
Paths are relative to libs/pathway-language. Exit: 0 evaluated, 1 compile refused, 2 input error, 3 configuration error.`;

/** The scenario format: the acceptance examples' `input`, minus fields the executor never reads. */
const SCENARIO_FIELDS = ['description', 'snapshot', 'context', 'records', 'retractions', 'coverage', 'failures', 'rejectedItems'];
const REQUIRED = SCENARIO_FIELDS.filter((f) => f !== 'description');
const CONTEXT_FIELDS = ['subject', 'episode', 'encounter'];

type Json = { [k: string]: unknown };
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new InputError(`cannot read ${what} file ${path} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // The first clause only: newer Node versions quote a snippet of the file after it.
    throw new InputError(`${what} file ${path} is not valid JSON: ${(e as Error).message.split(',')[0]}`);
  }
}

/**
 * Exact mapping (nothing defaulted, nothing ignored):
 * context.subject → subject; context.episode → contextEpisode; context.encounter → contextEncounter;
 * records → revisions; retractions → retractions;
 * {snapshot, coverage, failures, rejectedItems} → snapshot {id, coverage, failures, rejectedItems}.
 * `description` is display text only. Values are passed through unchanged for the engine to validate.
 */
export function scenarioInput(s: unknown): { input: RawExecutionInput; description: string | null } {
  if (!isObject(s)) throw new InputError('scenario must be a JSON object');
  const unknown = Object.keys(s).filter((k) => !SCENARIO_FIELDS.includes(k));
  if (unknown.length > 0) throw new InputError(`scenario has unsupported field(s) ${unknown.join(', ')}; supported: ${SCENARIO_FIELDS.join(', ')} (clock, mode and supersedesSnapshot are not read by the executor)`);
  const missing = REQUIRED.filter((k) => !(k in s));
  if (missing.length > 0) throw new InputError(`scenario is missing field(s) ${missing.join(', ')} (write [] for none; nothing is defaulted)`);
  if ('description' in s && typeof s.description !== 'string') throw new InputError('scenario description must be a string');
  const c = s.context;
  if (!isObject(c)) throw new InputError('scenario context must be an object {subject, episode, encounter}');
  const cu = Object.keys(c).filter((k) => !CONTEXT_FIELDS.includes(k));
  if (cu.length > 0) throw new InputError(`scenario context has unsupported field(s) ${cu.join(', ')}; supported: ${CONTEXT_FIELDS.join(', ')}`);
  const cm = CONTEXT_FIELDS.filter((k) => !(k in c));
  if (cm.length > 0) throw new InputError(`scenario context is missing field(s) ${cm.join(', ')}`);
  const input = {
    subject: c.subject,
    revisions: s.records,
    retractions: s.retractions,
    contextEncounter: c.encounter,
    contextEpisode: c.episode,
    snapshot: { id: s.snapshot, coverage: s.coverage, failures: s.failures, rejectedItems: s.rejectedItems },
  } as unknown as RawExecutionInput;
  return { input, description: (s.description as string | undefined) ?? null };
}

function parseArgs(argv: readonly string[]) {
  const a = { program: null as string | null, scenario: null as string | null, preview: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--program' || x === '--scenario') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new InputError(`${x} needs a file path`);
      a[x === '--program' ? 'program' : 'scenario'] = v;
    } else if (x === '--preview') a.preview = true;
    else if (x === '--json') a.json = true;
    else if (x === '--help' || x === '-h') a.help = true;
    else throw new InputError(`unknown argument ${x}`);
  }
  return a;
}

// ---------- display (labels are display only; structured values stay in the result and --json)

const ref = (n: NodeRef) => `${n.revision.source}/${n.revision.localId}@${n.revision.revision}${n.digest ? `#${n.digest}` : ''}`;
const refs = (xs: readonly NodeRef[]) => (xs.length === 0 ? 'none' : xs.map(ref).join(', '));

type Value = { value: 'True' | 'False' } | { value: 'Unknown'; causes: readonly string[] } | { marker: { holes: readonly string[] } };
const show = (v: Value) => ('marker' in v ? `Marker[${v.marker.holes.join(', ')}]` : v.value === 'Unknown' ? `Unknown(${v.causes.join(', ')})` : v.value);
const MEANING = {
  True: 'the Finding is established by this scenario',
  False: 'the Finding is refuted by this scenario',
  Unknown: 'the available evidence does not resolve it',
  Marker: 'authoring marker: a rule it depends on is unfinished',
};
const meaning = (v: Value) => MEANING['marker' in v ? 'Marker' : v.value];

function refLine(o: Json): string | null {
  if ('supportingEvidenceIds' in o) return `supporting: ${refs(o.supportingEvidenceIds as NodeRef[])}`;
  if ('candidateEvidenceIds' in o) return `candidates: ${refs(o.candidateEvidenceIds as NodeRef[])}`;
  return null;
}

type QueryView = { query: string } & ({ authoring: 'Complete'; evidence: QueryEvidenceResult } | { authoring: 'Incomplete'; preview: Extract<RawPreviewQueryResult, { queryAuthoring: 'Incomplete' }> });

/** Each query's own result, whatever the result's scope. */
function queryViews(r: RawExecutionResult | RawPreviewResult): QueryView[] {
  if (r.mode === 'normal') {
    const list = r.scope === 'one-query-program-from-raw-records' ? [r.queryEvidence] : r.queryEvidenceResults;
    return list.map((e) => ({ query: e.query, authoring: 'Complete', evidence: e }));
  }
  const list: readonly RawPreviewQueryResult[] =
    r.scope === 'multi-query-program-preview-from-raw-records' ? r.queryPreviewResults : [{ ...(r as unknown as RawPreviewQueryResult), query: r.query }];
  return list.map((q) => (q.queryAuthoring === 'Complete' ? { query: q.query, authoring: 'Complete', evidence: q.queryEvidence } : { query: q.query, authoring: 'Incomplete', preview: q }));
}

function queryLines(v: QueryView, out: string[]): void {
  if (v.authoring === 'Complete') {
    const e = v.evidence.evidence;
    if (e.status === 'Known') {
      out.push(`  ${v.query}  Known(${e.value})  supporting: ${refs(e.supportingEvidenceIds)}`);
      return;
    }
    out.push(`  ${v.query}  Unresolved(${e.causes.join(', ')})  candidates: ${refs(e.candidateEvidenceIds)}`);
    out.push('    causes, as attributed by S6:');
    for (const a of v.evidence.trace.attribution) out.push(`      ${a.cause} from ${a.stage}: ${a.reason}  [${a.label}]`);
    return;
  }
  const p = v.preview;
  const pq = p.previewQuery;
  out.push(`  ${v.query}  authoring incomplete: Marker[${pq.marker.holes.join(', ')}], no Evidence<Boolean>`);
  if (pq.contract === 'WholeContractHole') {
    out.push('    whole-contract hole: no stage ran and no record was read');
  } else {
    out.push(`    stages run: ${p.stagesRun.join(", ")}; no S6, so no Evidence<Boolean>`);
    for (const [name, slot] of Object.entries(pq.criteria)) out.push(`    ${name}: ${slot.kind === 'hole' ? `hole ${slot.hole}` : 'complete'} (${slot.source})`);
    out.push('    per-record criteria (preview-query evaluation):');
    let any = false;
    for (const k of pq.keys) {
      for (const { record } of k.possibilities) {
        any = true;
        if (record.outcome === 'NotEvaluated') {
          out.push(`      ${record.node ? ref(record.node) : `${k.key.source}/${k.key.localId}`}: not evaluated (${record.reason})`);
          continue;
        }
        const c = (x: typeof record.establishes) => (x.result.value === 'Marker' ? `Marker[${(x.result as { hole: string }).hole}]` : x.result.value);
        out.push(`      ${ref(record.node)}: establishes ${c(record.establishes)}, refutes ${c(record.refutes)} (S4 ${record.disposition.disposition}${record.disposition.disposition === 'NotSelected' ? `: ${record.disposition.blockers.join(', ')}` : ''})`);
      }
    }
    if (!any) out.push('      none: no record reached criterion evaluation');
  }
}

function render(programPath: string, scenarioPath: string, description: string | null, pkg: CompiledProgram, r: RawExecutionResult | RawPreviewResult): string {
  const out: string[] = [];
  const decls = pkg.declarations;
  out.push('PPL trial runner (experimental, nonclinical: not for patient care)');
  out.push(`Program:  ${programPath}  (package ${pkg.packageId})`);
  out.push(`Scenario: ${scenarioPath}${description ? `\n          ${description}` : ''}`);
  out.push(`Mode:     ${r.mode}`);
  out.push(`Compile:  ${r.mode === 'normal' ? 'Compiled' : 'PreviewPackage'}, 0 diagnostics`);
  if (pkg.holes.length === 0) out.push(`Authoring: complete (no holes)${r.mode === 'preview' ? '; preview still blocks publication' : ''}`);
  else {
    out.push(`Authoring: INCOMPLETE, publication blocked. ${pkg.holes.length} hole(s):`);
    for (const h of pkg.holes) out.push(`  ${h.id} (${h.type}) at ${h.location}: ${h.explains}`);
  }
  out.push(`Snapshot: ${r.snapshot}`);

  out.push('', 'Findings');
  for (const d of decls.filter((x) => x.kind === 'Finding')) {
    const o = r.outputs[d.id] as Json;
    const v = o.status as Value;
    out.push(`  ${d.id}  ${show(v)}: ${meaning(v)}`);
    const attrs = r.findingAttributes[d.id];
    if (attrs) {
      out.push(`    label: ${JSON.stringify(attrs.label)}`);
      if (attrs.heading !== null) out.push(`    heading: ${JSON.stringify(attrs.heading)}`);
      if (attrs.cites.length > 0) out.push(`    cites: ${attrs.cites.join(', ')}`);
    }
    const rl = refLine(o);
    if (rl) out.push(`    ${rl}`);
    if (o.urgency) out.push(`    urgency: ${show(o.urgency as Value)}`);
  }

  out.push('', 'Queries');
  for (const v of queryViews(r)) queryLines(v, out);

  out.push('', 'Program trace (source pointers into the program file)');
  for (const t of r.trace) {
    out.push(`  ${t.output}  ${t.source}  ${t.result}`);
    out.push(`    ${t.because}`);
  }
  out.push('', 'Not run here: ' + (r.notRun as readonly string[]).join(', ') + '. The trace has S6 summaries and attributions, not every per-record criterion of a complete query.');
  return out.join('\n') + '\n';
}

function diagnosticsText(programPath: string, mode: string, diagnostics: readonly Diagnostic[], wellFormed: boolean): string {
  const out = ['PPL trial runner (experimental, nonclinical: not for patient care)', `Program:  ${programPath}`, `Mode:     ${mode}`, `Compile:  REFUSED, ${diagnostics.length} diagnostic(s); nothing was executed`];
  for (const d of diagnostics) out.push(`  ${d.code}  at ${d.location || '/'}${d.hole ? `  hole ${d.hole}` : ''}\n    ${d.message}`);
  if (mode === 'normal' && wellFormed) out.push('Only authoring holes remain. Add --preview to evaluate with the holes kept as markers.');
  return out.join('\n') + '\n';
}

/** The whole command, without touching process state. Unexpected errors propagate. */
export function run(argv: readonly string[], cwd: string = process.cwd()): RunOutput {
  const done = (code: number, stdout: string, stderr = '') => ({ code, stdout, stderr });
  let a: ReturnType<typeof parseArgs>;
  try {
    a = parseArgs(argv);
    if (a.help) return done(EXIT.evaluated, USAGE + '\n');
    if (!a.program || !a.scenario) throw new InputError('--program and --scenario are both required');
  } catch (e) {
    if (e instanceof InputError) return done(EXIT.input, '', `input error: ${e.message}\n${USAGE}\n`);
    throw e;
  }
  const mode = a.preview ? 'preview' : 'normal';
  let source: unknown;
  let scenario: ReturnType<typeof scenarioInput>;
  try {
    source = readJson(resolve(cwd, a.program), 'program');
    scenario = scenarioInput(readJson(resolve(cwd, a.scenario), 'scenario'));
  } catch (e) {
    if (e instanceof InputError) return done(EXIT.input, '', `input error: ${e.message}\n`);
    throw e;
  }

  const compiled = a.preview ? experimentalCompilePreview(source) : experimentalCompile(source);
  const compileView = { outcome: compiled.outcome, wellFormed: compiled.wellFormed, diagnostics: compiled.diagnostics };
  const json = (execution: unknown) => JSON.stringify({ runner: 'nonclinical-ppl-try-v0', program: a.program, scenario: a.scenario, mode, compile: compileView, execution }, null, 2) + '\n';
  if (compiled.outcome === 'CompileFailure') {
    return done(EXIT.compileRefused, a.json ? json(null) : diagnosticsText(a.program, mode, compiled.diagnostics, compiled.wellFormed));
  }

  let result: RawExecutionResult | RawPreviewResult;
  try {
    result = compiled.outcome === 'Compiled' ? experimentalExecuteFromRawRecords(compiled.package, scenario.input) : experimentalExecutePreviewFromRawRecords(compiled.package, scenario.input);
  } catch (e) {
    if (isConfigurationError(e)) {
      return done(EXIT.configuration, '', `configuration error (${e.constructor.name}: the engine rejected this input; no evaluation happened): ${e.message}\n`);
    }
    throw e;
  }
  return done(EXIT.evaluated, a.json ? json(result) : render(a.program, a.scenario, scenario.description, compiled.package, result));
}

if (require.main === module) {
  let r: RunOutput;
  try {
    r = run(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`internal error (an engine or runner defect, not a property of the scenario):\n${(e as Error).stack ?? String(e)}\n`);
    process.exit(EXIT.internal);
  }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
