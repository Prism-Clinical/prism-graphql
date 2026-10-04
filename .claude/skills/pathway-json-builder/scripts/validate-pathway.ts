// .claude/skills/pathway-json-builder/scripts/validate-pathway.ts
//
// Thin CLI over the REAL import validator in apps/pathway-service. This is
// deliberately not a reimplementation: it imports `validatePathwayJson` from
// the service source so a pathway JSON that passes here passes the same code
// the import endpoint runs.
//
// **That guarantee only holds if the checkout IS main.** The import below is
// relative to this checkout, so on a branch that is behind origin/main it
// validates against a stale validator and reports stale results. That is not
// hypothetical: on a skill branch 56 commits behind main, two pathways passed
// here with 0 errors and failed main's import with 4 errors each (PR #55
// multi-branch rules). So before validating, this script refuses to run unless
// HEAD contains origin/main. Run `git fetch origin` first — the check reads
// the local `origin/main` ref and does no network access itself.
//
// Usage (from the repo root, after `npm ci` once — Node cannot run this file
// natively because it imports pathway-service TypeScript):
//   npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/validate-pathway.ts <file.json>
//
// Escape hatch (e.g. deliberately testing an unmerged validator change):
//   PATHWAY_VALIDATE_ALLOW_STALE=1 npx ts-node --transpile-only ...
// downgrades the staleness refusal to a warning. Never use it for a delivery.
//
// After the validator it runs check-brief-sync.ts on the same file: a pathway
// JSON under pathways/json/ must be described by its research brief, whose
// stamp line names this JSON at exactly this `pathway.version` (see
// SKILL.md "Brief is the source of truth"). A JSON outside pathways/json/
// (e.g. a test fixture) skips that step.
//
// Exit codes: 0 = valid and in sync with its brief, 1 = invalid,
//             2 = could not read/parse the file,
//             3 = checkout does not contain origin/main (stale validator),
//             5 = valid, but the compiler would refuse to activate it,
//             6 = trigger codes list sibling leaves instead of their family,
//             4 = valid, but out of sync with its brief (check-brief-sync failed).

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { validatePathwayJson } from '../../../../apps/pathway-service/src/services/import/validator';
import type { PathwayJson } from '../../../../apps/pathway-service/src/services/import/types';
import { compilePathway } from '../../../../apps/pathway-service/src/services/compiler/compile';

const SCHEMA_PATHS = [
  'apps/pathway-service/src/services/import',
  'apps/pathway-service/src/services/resolution',
  'apps/pathway-service/src/types',
];

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Refuse (or warn) when the validator being imported is not main's. */
function assertCheckoutIsMain(): void {
  const allowStale = process.env.PATHWAY_VALIDATE_ALLOW_STALE === '1';
  let mainHash: string;
  try {
    mainHash = git(['rev-parse', '--short', 'origin/main']);
  } catch {
    console.log('⚠ Could not resolve origin/main — cannot prove this checkout validates against main.');
    console.log('  Run `git fetch origin`, then re-run.');
    if (!allowStale) process.exit(3);
    return;
  }
  let containsMain = true;
  try {
    git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  } catch {
    containsMain = false;
  }
  if (!containsMain) {
    const behind = git(['rev-list', '--count', 'HEAD..origin/main']);
    console.log(
      `✗ STALE CHECKOUT — HEAD does not contain origin/main (${mainHash}); it is ${behind} commit(s) behind.\n` +
        `  This script imports the validator from THIS checkout, so its verdict would be the\n` +
        `  old validator's, not main's. Rebase onto origin/main, or validate from a worktree:\n` +
        `    git fetch origin && git worktree add /tmp/pw-main origin/main\n` +
        `  (\`git fetch origin\` first if origin/main itself may be out of date.)`,
    );
    if (!allowStale) process.exit(3);
    console.log('  PATHWAY_VALIDATE_ALLOW_STALE=1 set — continuing, result is NOT main\'s verdict.');
    return;
  }
  // Contains main, but the branch may carry its own edits to the schema paths.
  try {
    git(['diff', '--quiet', 'origin/main', '--', ...SCHEMA_PATHS]);
  } catch {
    console.log(
      `⚠ Schema source on this checkout differs from origin/main (${mainHash}) under ` +
        `${SCHEMA_PATHS.join(', ')}.\n  The result below is this branch's validator, not main's.`,
    );
  }
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: npx ts-node --transpile-only validate-pathway.ts <pathway.json>');
  process.exit(2);
}

assertCheckoutIsMain();

const filePath = resolve(fileArg);
let parsed: PathwayJson;
try {
  parsed = JSON.parse(readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error(`Could not read or parse ${filePath}: ${(err as Error).message}`);
  process.exit(2);
}

const result = validatePathwayJson(parsed);

if (result.warnings.length > 0) {
  console.log(`⚠ ${result.warnings.length} warning(s):`);
  for (const w of result.warnings) console.log(`  - ${w}`);
}

if (!result.valid) {
  console.log(`✗ INVALID — ${result.errors.length} error(s):`);
  for (const e of result.errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ VALID — ${parsed.nodes?.length ?? 0} nodes, ${parsed.edges?.length ?? 0} edges (${result.warnings.length} warnings)`);

// Activation compiles the stored pathway and refuses on any compile error
// (resolvers/mutations/import.ts) — a JSON can import cleanly and then be
// impossible to activate. Compile here so that is caught at build time.
// Coded conditions need no attribute code map; `lab.*` / `allergy.*`
// attribute-form conditions would report UNMAPPED_ATTRIBUTE, which is the
// truth on an unseeded deployment (the spec tells the builder to emit coded form).
const compiled = compilePathway({ pathway: parsed, codeMap: new Map(), temporalDefaults: {} } as never);
if (compiled.ok === false) {
  console.log(`✗ WILL NOT ACTIVATE — ${compiled.errors.length} compile error(s):`);
  for (const e of compiled.errors) console.log(`  - [${e.code}] ${e.message}`);
  process.exit(5);
}
console.log('✓ COMPILES — activation will not be refused');

// Trigger codes are FAMILIES ([DECISION — Josh 2026-10-03]). The matcher
// expands each patient diagnosis to its ICD-10 ancestors, so one parent code
// matches everything beneath it; a list of sibling leaves matches only those
// leaves, misses the ones nobody thought to list, and grows without bound.
// Two or more ICD-10 trigger codes under one parent must be authored as the
// parent — unless the brief says why not, with `[LEAF CODES — <parent>: why]`.
{
  const parentOf = (code: string): string => {
    const cut = code.slice(0, -1);
    return cut.endsWith('.') ? cut.slice(0, -1) : cut;
  };
  const triggers = ((parsed.pathway?.condition_codes ?? []) as Array<{ code: string; system: string }>)
    .filter((c) => /^ICD-?10/i.test(c.system) && c.code.length > 3);
  const byParent = new Map<string, string[]>();
  for (const c of triggers) byParent.set(parentOf(c.code), [...(byParent.get(parentOf(c.code)) ?? []), c.code]);
  const briefPath = resolve(dirname(filePath), '..', 'briefs', `${parsed.pathway?.logical_id}-research-brief.md`);
  const brief = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : '';
  const problems = [...byParent]
    .filter(([parent, codes]) => codes.length > 1 && !brief.includes(`[LEAF CODES — ${parent}:`))
    .map(([parent, codes]) => `${codes.join(', ')} are siblings under ${parent} — author the family "${parent}", or justify the leaves in the brief with [LEAF CODES — ${parent}: <why>]`);
  if (problems.length > 0) {
    console.log(`✗ TRIGGER CODES ARE NOT FAMILIES — ${problems.length} problem(s):`);
    for (const pr of problems) console.log(`  - ${pr}`);
    process.exit(6);
  }
  console.log('✓ TRIGGER CODES — families, or justified leaves');
}

// The brief is the source of truth: a valid JSON its brief does not describe
// is not deliverable. Plain node runs the check (it needs no ts-node).
const sync = spawnSync(process.execPath, [resolve(__dirname, 'check-brief-sync.ts'), '--json', filePath], {
  stdio: 'inherit',
});
if (sync.status !== 0) {
  console.log('✗ BRIEF OUT OF SYNC — the JSON is valid, but its research brief does not describe it (see above).');
  process.exit(sync.status === 2 ? 2 : 4);
}
process.exit(0);
