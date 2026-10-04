// .claude/skills/pathway-json-builder/scripts/test-pipeline-checks.ts
//
// Regression tests for the builder's own checks: check-gate-control.ts against
// its fixtures, check-brief-sync.ts against deliberately broken sample trees
// built in a temp dir, and validate-pathway.ts's response-recheck DATA USE
// warning (that one runs under ts-node, so `npm ci` must have been run). Run
// after changing any of them:
//
//   node .claude/skills/pathway-json-builder/scripts/test-pipeline-checks.ts
//
// Exit 0 = every case behaved; 1 = at least one did not.

const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');

const HERE: string = __dirname;
const GATE = join(HERE, 'check-gate-control.ts');
const SYNC = join(HERE, 'check-brief-sync.ts');
const FIX = join(HERE, 'fixtures', 'gate-control');

let failed = 0;
function run(script: string, args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
function expectAbsent(name: string, got: { code: number; out: string }, code: number, needle: string): void {
  const ok = got.code === code && !got.out.includes(needle);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} — exit ${got.code}, ${got.out.includes(needle) ? 'MENTIONS' : 'does not mention'} "${needle}"`);
  if (!ok) console.log(got.out.split('\n').map((l) => `    | ${l}`).join('\n'));
}
function expect(name: string, got: { code: number; out: string }, code: number, needle?: string): void {
  const ok = got.code === code && (!needle || got.out.includes(needle));
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} — exit ${got.code}${needle ? `, ${got.out.includes(needle) ? 'mentions' : 'MISSING'} "${needle}"` : ''}`);
  if (!ok) console.log(got.out.split('\n').map((l) => `    | ${l}`).join('\n'));
}

// ── check-gate-control ────────────────────────────────────────────────
expect('gate-control: ESCALATES_TO into a gated step is a Rule 1 violation',
  run(GATE, [join(FIX, 'escalates-to-leak.json')]), 1, 'med-1 -ESCALATES_TO-> med-5');
expect('gate-control: same pathway without the escalation edge passes',
  run(GATE, [join(FIX, 'escalates-to-leak-fixed.json')]), 0);

// Condition lints on NESTED groups: the fixed fixture with its one gate swapped
// for a compound whose leaves sit inside `{ operator, conditions }` groups.
const gateRoots: string[] = [];
function withGate(props: Record<string, unknown>): string {
  const pwj = JSON.parse(require('fs').readFileSync(join(FIX, 'escalates-to-leak-fixed.json'), 'utf8'));
  const gate = pwj.nodes.find((n: any) => n.type === 'Gate');
  gate.properties = { title: 'nested', default_behavior: 'skip', gate_type: 'compound', ...props };
  const dir = mkdtempSync(join(tmpdir(), 'gate-control-'));
  gateRoots.push(dir);
  const file = join(dir, 'nested.json');
  writeFileSync(file, JSON.stringify(pwj));
  return file;
}
const HGB = { field: 'labs', operator: 'greater_than', value: '718-7', system: 'LOINC', threshold: 10.95, horizon: { days: 28 }, display: 'Hemoglobin (g/dL)' };
const TRI = { attribute: 'patient.trimester', operator: 'in', value: [1, 3] };
expect('gate-control: a nested anemia-style compound passes',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'OR', conditions: [
    { field: 'conditions', operator: 'includes_code', value: 'D50.*', system: 'ICD-10', horizon: 'LIFETIME' },
    { operator: 'AND', conditions: [TRI, HGB] },
  ] })]), 0, 'GATE CONTROL OK');
expect('gate-control: a nested vitals leaf with no horizon is named by its path',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'OR', conditions: [
    TRI, { operator: 'AND', conditions: [{ field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 }, TRI] },
  ] })]), 1, '"gate-iv-iron-ga" condition[1].conditions[0] reads vitals');
expect('gate-control: a numeric leaf two groups down makes the gate numeric (default needs a marker)',
  run(GATE, [withGate({ on_unresolved: 'default', operator: 'OR', conditions: [
    { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10', horizon: 'LIFETIME' },
    { operator: 'AND', conditions: [{ operator: 'OR', conditions: [TRI] }] },
  ] })]), 1, 'ON_UNRESOLVED DEFAULT');
expect('gate-control: not_includes_code uses the pattern matcher — "Z94.*" is a real wildcard',
  run(GATE, [withGate({ on_unresolved: 'default', operator: 'AND', conditions: [
    { operator: 'OR', conditions: [
      { field: 'conditions', operator: 'not_includes_code', value: 'Z94.*', system: 'ICD-10', horizon: 'LIFETIME' },
      { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10', horizon: 'LIFETIME' },
    ] },
  ] })]), 0, 'GATE CONTROL OK');
expect('gate-control: a malformed nested wildcard is named by its path',
  run(GATE, [withGate({ on_unresolved: 'default', operator: 'AND', conditions: [
    { operator: 'OR', conditions: [
      { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10', horizon: 'LIFETIME' },
      { field: 'conditions', operator: 'not_includes_code', value: 'G82.2*', system: 'ICD-10', horizon: 'LIFETIME' },
    ] },
  ] })]), 1, '"gate-iv-iron-ga" condition[0].conditions[1] value "G82.2*"');

// The calendar condition reads the session clock, not chart data: no horizon (one is an import error).
const SEASON = { attribute: 'encounter.date', operator: 'in_season', from: '09-01', to: '03-01' };
expect('gate-control: an encounter.date / in_season leaf needs no horizon',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [SEASON, TRI] })]), 0, 'GATE CONTROL OK');
expectAbsent('gate-control: … and is not reported under EXPLICIT HORIZON, nested or not',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [TRI, { operator: 'OR', conditions: [SEASON, HGB] }] })]), 0, 'EXPLICIT HORIZON');
expect('gate-control: a chart leaf with no horizon is still an error beside a calendar leaf',
  run(GATE, [withGate({ on_unresolved: 'default', operator: 'AND', conditions: [SEASON,
    { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' }] })]), 1, 'EXPLICIT HORIZON');
// horizon PREGNANCY needs the gestational age: `ask` holds the gate on that question, so it is not inert.
const PREG_MEMBER = { field: 'labs', operator: 'not_includes_code', value: '56888-1', system: 'LOINC', display: 'HIV screen', horizon: 'PREGNANCY' };
expectAbsent('gate-control: "ask" on a PREGNANCY membership gate is not reported inert',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [PREG_MEMBER] })]), 0, 'is inert');
expect('gate-control: "ask" on a LIFETIME membership gate still is',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [{ ...PREG_MEMBER, horizon: 'LIFETIME' }] })]), 0, 'is inert');
expect('gate-control: "default" on a PREGNANCY membership gate needs no marker',
  run(GATE, [withGate({ on_unresolved: 'default', operator: 'AND', conditions: [PREG_MEMBER] })]), 0, 'GATE CONTROL OK');
// An authored prompt is one question's wording when the gate can ask for one datum only.
const VITAMIN = { attribute: 'patient.on_prenatal_vitamin', operator: 'equals', value: true };
expectAbsent('gate-control: an authored prompt on a single-datum gate is not warned about',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', prompt: 'Already taking a prenatal vitamin?', condition: VITAMIN })]), 0, 'authored `prompt`');
expect('gate-control: … and still is when the gate can ask for two data',
  run(GATE, [withGate({ on_unresolved: 'ask', prompt: 'One text for both', operator: 'AND', conditions: [VITAMIN, TRI] })]), 0, 'authored `prompt`');

// on_declined: "traverse" opens a gate on "Not available" only — it is not default_behavior traverse.
expectAbsent('gate-control: on_declined "traverse" on a single-target asking gate is not an INERT GATE',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', on_declined: 'traverse', condition: { ...VITAMIN, value: false } })]), 0, 'INERT GATE');
expect('gate-control: … and passes clean',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', on_declined: 'traverse', condition: { ...VITAMIN, value: false } })]), 0, 'GATE CONTROL OK');
expect('gate-control: an on_declined value that does not exist is an error',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', on_declined: 'skip', condition: VITAMIN })]), 1, 'ON_DECLINED');
expect('gate-control: on_declined "traverse" on a gate that can ask for nothing is reported inert',
  run(GATE, [withGate({ on_unresolved: 'default', on_declined: 'traverse', operator: 'AND', conditions: [
    { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10', horizon: 'LIFETIME' }] })]), 0, 'on_declined "traverse" is inert');
expect('gate-control: default_behavior "traverse" on a single-target gate is still an INERT GATE',
  run(GATE, [withGate({ gate_type: 'patient_attribute', default_behavior: 'traverse', on_unresolved: 'ask', condition: VITAMIN })]), 1, 'INERT GATE');

// A medication matched by ingredient or class asks about an entry it cannot identify: `ask` is live.
const FLU_CLASS = { field: 'medications', operator: 'includes_code', value: '1657128', system: 'RXNORM_INGREDIENT', display: 'an influenza vaccine', status: 'any', horizon: 'LIFETIME' };
expectAbsent('gate-control: "ask" on a gate matching a medication by ingredient is not reported inert',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', condition: FLU_CLASS })]), 0, 'is inert');
expectAbsent('gate-control: … nor by ATC class',
  run(GATE, [withGate({ on_unresolved: 'ask', operator: 'OR', conditions: [{ ...FLU_CLASS, value: 'B03AA', system: 'ATC', display: 'an oral iron supplement' }] })]), 0, 'is inert');
expect('gate-control: "ask" on a product-code medication gate still is',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', condition: { ...FLU_CLASS, system: 'RXNORM', value: '2746468' } })]), 0, 'is inert');
expect('gate-control: "default" on a medication-class gate needs no marker',
  run(GATE, [withGate({ gate_type: 'patient_attribute', on_unresolved: 'default', condition: FLU_CLASS })]), 0, 'GATE CONTROL OK');

// ── validate-pathway: DATA USE — a response check must order its recheck ──
// [DECISION — Josh 2026-10-04]. validate-pathway.ts imports pathway-service
// TypeScript, so it runs under ts-node (slow: a few seconds per case). The
// fixtures live in a temp dir, outside pathways/json/, so brief sync is skipped;
// PATHWAY_VALIDATE_ALLOW_STALE keeps the case independent of where HEAD sits
// relative to origin/main (this test is about the warning, not the verdict).
const VALIDATE = join(HERE, 'validate-pathway.ts');
function validate(file: string): { code: number; out: string } {
  const r = spawnSync('npx', ['ts-node', '--transpile-only', VALIDATE, file], {
    encoding: 'utf8', cwd: join(HERE, '..', '..', '..', '..'), env: { ...process.env, PATHWAY_VALIDATE_ALLOW_STALE: '1' },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
function expectNot(name: string, got: { code: number; out: string }, code: number, needle: string): void {
  const ok = got.code === code && !got.out.includes(needle);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} — exit ${got.code}, ${got.out.includes(needle) ? 'MENTIONS' : 'does not mention'} "${needle}"`);
  if (!ok) console.log(got.out.split('\n').map((l) => `    | ${l}`).join('\n'));
}
const ANCHOR = { event: 'medication_start', clinical_role: 'oral-iron-repletion', label: 'oral iron',
  codes: [{ system: 'RXNORM', code: '310325' }], min_days_since_anchor: 14 };
const DELTA = { field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC', display: 'Hemoglobin (g/dL)',
  delta_threshold: 1.0, delta_comparison: 'less_than', min_points: 2, window_from: { ...ANCHOR, baseline_days: 28 } };
const COUNT = (cmp: string) => ({ field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC', display: 'Hemoglobin (g/dL)',
  count_threshold: 1, count_comparison: cmp, window_from: ANCHOR });
const NEEDLE = 'judge the response to "oral-iron-repletion"';
expect('validate-pathway: an anchored delta with no "nothing since the start" count gate warns (DATA USE)',
  validate(withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [DELTA] })), 0, NEEDLE);
expect('validate-pathway: an at_least count beside it is not a recheck route — still warns',
  validate(withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [DELTA, COUNT('at_least')] })), 0, NEEDLE);
expectNot('validate-pathway: a less_than count on the same class silences it',
  validate(withGate({ on_unresolved: 'ask', operator: 'OR', conditions: [DELTA, COUNT('less_than')] })), 0, NEEDLE);
expect('validate-pathway: count_comparison on another operator is an import error',
  validate(withGate({ on_unresolved: 'ask', operator: 'AND', conditions: [{ ...DELTA, count_comparison: 'less_than' }] })), 1, 'count_comparison');

for (const r of gateRoots) rmSync(r, { recursive: true, force: true });

// ── check-brief-sync ──────────────────────────────────────────────────
function pathwayJson(id: string, version: string): string {
  return JSON.stringify({ schema_version: '1.0', pathway: { logical_id: id, title: id, version }, nodes: [], edges: [] });
}
function brief(title: string, stamp: string | null, metaVersion = '1'): string {
  return [`# Pathway Research Brief — ${title}`, '', ...(stamp === null ? [] : [stamp, '']),
    '**Status: DRAFT**', '', '## 1. Pathway metadata', '', `- **Version**: ${metaVersion}`, '', '## 2. Stages', ''].join('\n');
}
/** A sample tree: files maps "json/x.json" / "briefs/x-research-brief.md" to content. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'brief-sync-'));
  mkdirSync(join(root, 'pathways', 'json'), { recursive: true });
  mkdirSync(join(root, 'pathways', 'briefs'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, 'pathways', rel), text);
  return root;
}
const roots: string[] = [];
function sync(name: string, files: Record<string, string>, code: number, needle?: string): void {
  const root = tree(files);
  roots.push(root);
  expect(`brief-sync: ${name}`, run(SYNC, ['--root', root]), code, needle);
}
const STAMP = (id: string, v: string) => `JSON: pathways/json/${id}.json @ version ${v}`;

sync('in sync', {
  'json/p.json': pathwayJson('p', '3'), 'briefs/p-research-brief.md': brief('P', STAMP('p', '3'), '3'),
}, 0, 'BRIEF SYNC OK');
sync('unbuilt draft with no stamp only warns', {
  'briefs/q-research-brief.md': brief('Q', null),
}, 0, 'has no stamp');
sync('"(not built)" draft passes', {
  'briefs/q-research-brief.md': brief('Q', 'JSON: (not built)'),
}, 0, 'BRIEF SYNC OK');
sync('missing stamp', {
  'json/p.json': pathwayJson('p', '1'), 'briefs/p-research-brief.md': brief('P', null),
}, 1, 'has no stamp, but pathways/json/p.json');
sync('version mismatch (JSON bumped, brief not)', {
  'json/p.json': pathwayJson('p', '2'), 'briefs/p-research-brief.md': brief('P', STAMP('p', '1')),
}, 1, 'OUT OF SYNC');
sync('JSON without a brief', {
  'json/p.json': pathwayJson('p', '1'),
}, 1, 'has NO research brief');
sync('stamp points at a missing JSON', {
  'briefs/p-research-brief.md': brief('P', STAMP('p', '1')),
}, 1, 'that JSON does not exist');
sync('"(not built)" while the JSON exists', {
  'json/p.json': pathwayJson('p', '1'), 'briefs/p-research-brief.md': brief('P', 'JSON: (not built)'),
}, 1, 'says "JSON: (not built)"');
sync('stamp bumped but §1 Version not', {
  'json/p.json': pathwayJson('p', '2'), 'briefs/p-research-brief.md': brief('P', STAMP('p', '2'), '1'),
}, 1, '§1 "**Version**" says 1');
sync('logical_id does not match the filename', {
  'json/p.json': pathwayJson('other', '1'), 'briefs/p-research-brief.md': brief('P', STAMP('p', '1')),
}, 1, 'must be named "other.json"');
sync('malformed stamp', {
  'json/p.json': pathwayJson('p', '1'), 'briefs/p-research-brief.md': brief('P', 'JSON: p.json v1'),
}, 1, 'malformed stamp');
sync('two stamps in one brief', {
  'json/p.json': pathwayJson('p', '1'),
  'briefs/p-research-brief.md': brief('P', `${STAMP('p', '1')}\n${STAMP('p', '1')}`),
}, 1, '2 stamp lines');
sync('stamp below the header is not a stamp', {
  'json/p.json': pathwayJson('p', '1'),
  'briefs/p-research-brief.md': `${brief('P', null)}\n${STAMP('p', '1')}\n`,
}, 1, 'has no stamp');

for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(failed === 0 ? '\nALL CHECKS BEHAVED' : `\n${failed} CASE(S) MISBEHAVED`);
process.exit(failed === 0 ? 0 : 1);
