// .claude/skills/pathway-json-builder/scripts/test-pipeline-checks.ts
//
// Regression tests for the builder's own checks: check-gate-control.ts against
// its fixtures, and check-brief-sync.ts against deliberately broken sample
// trees built in a temp dir. Run after changing either script:
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
