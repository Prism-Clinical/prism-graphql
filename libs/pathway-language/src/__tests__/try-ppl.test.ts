/**
 * EXPERIMENTAL, NONCLINICAL. Integration tests of the `try:ppl` developer runner (src/try/try-ppl.ts)
 * over the shipped editable files in try/. Expected Finding values are independent of the runner:
 * they are the acceptance expectations of PPL-01–03 (EA-001, EA-002, EA-005) and EA-007, and of
 * PPL-08a for the preview program. The readable output is checked against the engine's own result,
 * computed here with a separately written scenario mapping.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  type NodeRef,
} from '../index';
import { EXIT, run } from '../try/try-ppl';

const ROOT = join(__dirname, '..', '..');
const PROGRAM = 'try/programs/schematic.ppl.json';
const PREVIEW = 'try/programs/schematic-preview.ppl.json';
const scenario = (n: string) => `try/scenarios/${n}.json`;
type Json = { [k: string]: any }; // test documents are untyped JSON
const load = (p: string): Json => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const tryPpl = (...args: string[]) => run(args, ROOT);

/** Written independently of the runner's adapter: the documented scenario → engine mapping. */
const engineInput = (s: Json) => ({
  subject: s.context.subject,
  revisions: s.records,
  retractions: s.retractions,
  contextEncounter: s.context.encounter,
  contextEpisode: s.context.episode,
  snapshot: { id: s.snapshot, coverage: s.coverage, failures: s.failures, rejectedItems: s.rejectedItems },
});
const engineNormal = (program: Json, s: Json) => {
  const c = experimentalCompile(program);
  if (c.outcome !== 'Compiled') throw new Error('expected a compiled package');
  return experimentalExecuteFromRawRecords(c.package, engineInput(s) as never);
};
const enginePreview = (program: Json, s: Json) => {
  const c = experimentalCompilePreview(program);
  if (c.outcome !== 'PreviewPackage') throw new Error('expected a preview package');
  return experimentalExecutePreviewFromRawRecords(c.package, engineInput(s) as never);
};
const label = (n: NodeRef) => `${n.revision.source}/${n.revision.localId}@${n.revision.revision}`;
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'try-ppl-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (name: string, v: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
  return p;
};

describe('try:ppl: the supplied scenarios (normal mode)', () => {
  const cases: [string, Json, string, string[]][] = [
    ['established', { value: 'True' }, 'True: the Finding is established by this scenario', ['supporting', 's1/r1@1']],
    ['refuted', { value: 'False' }, 'False: the Finding is refuted by this scenario', ['supporting', 's1/r2@1']],
    ['missing', { value: 'Unknown', causes: ['Missing'] }, 'Unknown(Missing): the available evidence does not resolve it', ['candidates', 'none']],
    ['conflicting', { value: 'Unknown', causes: ['Conflicting'] }, 'Unknown(Conflicting): the available evidence does not resolve it', ['candidates', 's1/r1@1, s2/r2@1']],
  ];
  it.each(cases)('%s', (name, status, line, [kind, ids]) => {
    const r = tryPpl('--program', PROGRAM, '--scenario', scenario(name));
    expect(r.code).toBe(EXIT.evaluated);
    expect(r.stderr).toBe('');
    // The engine's own answer, computed independently, agrees with the expectation and the display.
    const e = engineNormal(load(PROGRAM), load(scenario(name))) as Json;
    expect(e.outputs['f.demo'].status).toEqual(status);
    const refs: NodeRef[] = e.outputs['f.demo'].supportingEvidenceIds ?? e.outputs['f.demo'].candidateEvidenceIds;
    expect(refs.length === 0 ? 'none' : refs.map(label).join(', ')).toBe(ids);
    expect(r.stdout).toContain(`  f.demo  ${line}\n`);
    expect(r.stdout).toContain(`    ${kind}: ${ids}\n`);
    expect(r.stdout).toMatch(/^Mode: +normal$/m);
    expect(r.stdout).toContain('Compile:  Compiled, 0 diagnostics');
    expect(r.stdout).not.toMatch(/safe|recommend/i);
  });

  it('shows unresolved causes with their S6 attribution, as the engine returns them', () => {
    const r = tryPpl('--program', PROGRAM, '--scenario', scenario('conflicting'));
    const e = engineNormal(load(PROGRAM), load(scenario('conflicting'))) as Json;
    expect(e.queryEvidence.trace.attribution.length).toBeGreaterThan(0);
    for (const a of e.queryEvidence.trace.attribution) expect(r.stdout).toContain(`${a.cause} from ${a.stage}: ${a.reason}  [${a.label}]`);
  });
});

describe('try:ppl --json preserves the engine result', () => {
  it('normal mode', () => {
    const r = tryPpl('--program', PROGRAM, '--scenario', scenario('conflicting'), '--json');
    expect(r.code).toBe(EXIT.evaluated);
    const j = JSON.parse(r.stdout);
    expect(j.mode).toBe('normal');
    expect(j.compile).toEqual({ outcome: 'Compiled', wellFormed: true, diagnostics: [] });
    expect(j.execution).toEqual(roundTrip(engineNormal(load(PROGRAM), load(scenario('conflicting')))));
  });
  it('preview mode', () => {
    const r = tryPpl('--program', PREVIEW, '--scenario', scenario('refuted'), '--preview', '--json');
    expect(r.code).toBe(EXIT.evaluated);
    expect(JSON.parse(r.stdout).execution).toEqual(roundTrip(enginePreview(load(PREVIEW), load(scenario('refuted')))));
  });
});

describe('try:ppl authoring holes', () => {
  it('normal compilation refuses a holed program and executes nothing', () => {
    const r = tryPpl('--program', PREVIEW, '--scenario', scenario('refuted'));
    expect(r.code).toBe(EXIT.compileRefused);
    expect(r.stdout).toContain('UNRESOLVED_AUTHORING_HOLE  at /nodes/1/contract/establishes/hole  hole H-ALT-EST');
    expect(r.stdout).toContain('Add --preview');
    expect(r.stdout).not.toContain('Findings');
    const j = JSON.parse(tryPpl('--program', PREVIEW, '--scenario', scenario('refuted'), '--json').stdout);
    expect(j.compile.outcome).toBe('CompileFailure');
    expect(j.execution).toBeNull();
  });

  it('preview keeps the hole as a marker while the independent Finding stays determinate', () => {
    const r = tryPpl('--program', PREVIEW, '--scenario', scenario('refuted'), '--preview');
    expect(r.code).toBe(EXIT.evaluated);
    const e = enginePreview(load(PREVIEW), load(scenario('refuted'))) as Json;
    expect(e.outputs['f.both'].status).toEqual({ marker: { holes: ['H-ALT-EST'] } });
    expect(e.outputs['f.demo'].status).toEqual({ value: 'False' });
    expect(r.stdout).toContain('Authoring: INCOMPLETE, publication blocked. 1 hole(s):');
    expect(r.stdout).toContain('  f.both  Marker[H-ALT-EST]: authoring marker: a rule it depends on is unfinished\n');
    expect(r.stdout).toContain('  f.demo  False: the Finding is refuted by this scenario\n');
    // The holed query's own stages and per-record criteria, from its preview-query result.
    expect(r.stdout).toContain('stages run: S1, S2, S3, S4, S5; no S6, so no Evidence<Boolean>');
    expect(r.stdout).toContain('s1/r2@1: establishes Marker[H-ALT-EST], refutes True (S4 Selected)');
  });

  it('preview never fills a hole: a refutes hole leaves the Finding a marker for every scenario', () => {
    const p = load(PROGRAM);
    p.nodes[0].contract.refutes = { hole: { id: 'H-REFUTES', type: 'Decision', explains: 'test hole' } };
    const file = write('holed.ppl.json', p);
    expect(tryPpl('--program', file, '--scenario', scenario('established')).code).toBe(EXIT.compileRefused);
    for (const s of ['established', 'refuted', 'missing']) {
      const r = tryPpl('--program', file, '--scenario', scenario(s), '--preview');
      expect(r.code).toBe(EXIT.evaluated);
      expect(r.stdout).toContain('  f.demo  Marker[H-REFUTES]');
    }
  });
});

describe('try:ppl failures', () => {
  it('a structural compiler error prevents execution in both modes', () => {
    const p = load(PROGRAM);
    p.nodes[2].status.all[1].ref = 'p.nope';
    const file = write('bad.ppl.json', p);
    for (const extra of [[], ['--preview']]) {
      const r = tryPpl('--program', file, '--scenario', scenario('established'), ...extra);
      expect(r.code).toBe(EXIT.compileRefused);
      expect(r.stdout).toContain('UNDEFINED_REFERENCE  at /nodes/2/status/all/1/ref');
      expect(r.stdout).not.toContain('Findings');
      expect(r.stdout).not.toContain('Add --preview');
    }
  });

  it('malformed scenario files are input errors; nothing is evaluated', () => {
    const s = load(scenario('established'));
    const bad: [string, unknown, RegExp][] = [
      ['not JSON', '{"snapshot": ', /not valid JSON/],
      ['not an object', [], /must be a JSON object/],
      ['unsupported field', { ...s, clock: '2026-01-01T00:00:00Z' }, /unsupported field\(s\) clock/],
      ['missing field', (({ failures: _f, ...rest }) => rest)(s), /missing field\(s\) failures/],
      ['unsupported context field', { ...s, context: { ...s.context, mode: 'nonclinical' } }, /context has unsupported field\(s\) mode/],
    ];
    for (const [, content, msg] of bad) {
      const r = tryPpl('--program', PROGRAM, '--scenario', write('s.json', content));
      expect(r.code).toBe(EXIT.input);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(msg);
    }
    expect(tryPpl('--program', PROGRAM, '--scenario', join(dir, 'absent.json')).code).toBe(EXIT.input);
    expect(tryPpl('--program', PROGRAM).code).toBe(EXIT.input);
    expect(tryPpl('--program', PROGRAM, '--scenario', scenario('missing'), '--verbose').code).toBe(EXIT.input);
  });

  it('input the engine rejects is a configuration error, not Unknown evidence', () => {
    const s = load(scenario('established'));
    for (const ctx of [{ ...s.context, episode: { known: 5 } }, { ...s.context, encounter: { unknown: [] } }]) {
      const r = tryPpl('--program', PROGRAM, '--scenario', write('s.json', { ...s, context: ctx }));
      expect(r.code).toBe(EXIT.configuration);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^configuration error \(RawExecutionConfigurationError: .*malformed evaluation (episode|encounter)/);
    }
    const r = tryPpl('--program', PROGRAM, '--scenario', write('s.json', { ...s, coverage: 'all' }));
    expect(r.code).toBe(EXIT.configuration);
  });
});

describe('try:ppl reads the files on every run (the guide exercises)', () => {
  it('editing the scenario changes the result', () => {
    const s = load(scenario('established'));
    const file = write('s.json', s);
    expect(tryPpl('--program', PROGRAM, '--scenario', file).stdout).toContain('  f.demo  True:');
    s.records[0].assertion = 'Denied';
    writeFileSync(file, JSON.stringify(s));
    expect(tryPpl('--program', PROGRAM, '--scenario', file).stdout).toContain('  f.demo  False:');
    s.records = [];
    writeFileSync(file, JSON.stringify(s));
    expect(tryPpl('--program', PROGRAM, '--scenario', file).stdout).toContain('  f.demo  Unknown(Missing):');
  });

  it('editing the authored criterion changes the result, and an overlapping edit is refused', () => {
    const p = load(PROGRAM);
    const file = write('p.ppl.json', p);
    const c = p.nodes[0].contract;
    [c.establishes, c.refutes] = [c.refutes, c.establishes];
    writeFileSync(file, JSON.stringify(p));
    expect(tryPpl('--program', file, '--scenario', scenario('established')).stdout).toContain('  f.demo  False:');
    c.establishes = c.refutes;
    writeFileSync(file, JSON.stringify(p));
    const r = tryPpl('--program', file, '--scenario', scenario('established'));
    expect(r.code).toBe(EXIT.compileRefused);
    expect(r.stdout).toContain('EXCLUSIVE_BRANCH_OVERLAP');
  });

  it('narrowing admissibility makes the record inadmissible', () => {
    const p = load(PROGRAM);
    p.nodes[0].contract.admissible.assertionKind = { in: ['PatientReport'] };
    const r = tryPpl('--program', write('p.ppl.json', p), '--scenario', scenario('established'));
    expect(r.stdout).toContain('  f.demo  Unknown(Inadmissible):');
  });
});
