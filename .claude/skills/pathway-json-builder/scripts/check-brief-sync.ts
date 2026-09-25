// .claude/skills/pathway-json-builder/scripts/check-brief-sync.ts
//
// THE RULE (Josh): "We shouldn't change a pathway without updating the doc."
// The research brief (`pathways/briefs/<logical_id>-research-brief.md`) is the
// source of truth; the JSON (`pathways/json/<logical_id>.json`) is derived from
// it. This check makes drift between them mechanically impossible to miss.
//
// Every brief carries ONE stamp line in its header (before the first `## `):
//
//   JSON: pathways/json/<logical_id>.json @ version <version>
//   JSON: (not built)
//
// where <version> is exactly the JSON's `pathway.version` (compared as a
// trimmed string: `"5"` in the JSON is `5` in the stamp). Bumping the JSON's
// version without touching the brief therefore fails here, and so does any
// JSON with no brief.
//
// FAILS when:
//   - a JSON has no brief (neither a brief stamped with its path, nor
//     `<logical_id>-research-brief.md`);
//   - that brief has no stamp, a malformed one, or more than one;
//   - the stamp says `(not built)` although the JSON exists;
//   - the stamp names a different JSON, or a different version;
//   - the stamp is right but §1's `- **Version**:` line says another version
//     (the stamp was bumped and the prose was not);
//   - a stamp names a JSON that does not exist;
//   - a stamp's JSON does not match the brief's filename, or a JSON's
//     `pathway.logical_id` does not match its own filename;
//   - two briefs stamp the same JSON;
//   - (--staged) a pathways/json/*.json is staged without its brief.
// WARNS (does not fail) when a brief has no stamp and no JSON exists yet —
// drafts in progress; stamp them `JSON: (not built)`.
//
// Usage (repo root; plain node, no install — Node >= 23 strips types):
//   node .claude/skills/pathway-json-builder/scripts/check-brief-sync.ts
//       [--root <dir>]      check <dir>/pathways instead of the repo's
//       [--json <file>]     check only this JSON (and its brief)
//       [--staged]          check the git INDEX, and require every staged
//                           pathways/json/*.json to have its brief staged too
//                           (the pre-commit hook runs this)
//
// Exit codes: 0 = in sync, 1 = out of sync, 2 = usage / could not read.

const { readFileSync, readdirSync, existsSync } = require('fs');
const { resolve, join, basename, relative, sep } = require('path');
const { execFileSync } = require('child_process');

const JSON_DIR = 'pathways/json';
const BRIEF_DIR = 'pathways/briefs';
const BRIEF_SUFFIX = '-research-brief.md';
const STAMP_RE = /^JSON:[ \t]*(.*?)[ \t]*$/;
const STAMP_BUILT_RE = /^(pathways\/json\/[^\s@]+\.json)\s+@\s+version\s+(\S+)$/;
const STAMP_NOT_BUILT = '(not built)';

const argv: string[] = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return v;
}
const staged = argv.includes('--staged');
const jsonOnlyArg = flagValue('--json');
const rootArg = flagValue('--root');

function git(args: string[], cwd?: string): string {
  // Inherit the environment: during `git commit -a` / `git commit <paths>` the
  // hook runs against a temporary GIT_INDEX_FILE, and that is the index to read.
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

let root: string;
const jsonMarker = `${sep}pathways${sep}json${sep}`;
if (rootArg) {
  root = resolve(rootArg);
} else if (jsonOnlyArg && resolve(jsonOnlyArg).lastIndexOf(jsonMarker) >= 0) {
  // --json <root>/pathways/json/x.json: its tree is the one to check.
  const abs = resolve(jsonOnlyArg);
  root = abs.slice(0, abs.lastIndexOf(jsonMarker));
} else {
  try {
    root = git(['rev-parse', '--show-toplevel']).trim();
  } catch {
    root = process.cwd();
  }
}

// ── File access: working tree, or the index under --staged ─────────────
function listFiles(dir: string, suffix: string): string[] {
  if (staged) {
    return git(['ls-files', '-z', '--', dir], root)
      .split('\0')
      .filter((p: string) => p && p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/') && p.endsWith(suffix))
      .sort();
  }
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f: string) => f.endsWith(suffix))
    .map((f: string) => `${dir}/${f}`)
    .sort();
}
function readRepoFile(rel: string): string {
  return staged ? git(['show', `:${rel}`], root) : readFileSync(join(root, rel), 'utf8');
}

const errors: string[] = [];
const warnings: string[] = [];

// ── Briefs and their stamps ──────────────────────────────────────────
interface Stamp { kind: 'built' | 'not-built'; json?: string; version?: string; line: number }
interface Brief { path: string; id: string; stamp: Stamp | null; metaVersion: string | null }

/** §1's "- **Version**: <v>" — the version the brief's prose claims. */
function parseMetaVersion(text: string): string | null {
  const s1 = /^## 1\. [^\n]*\n([\s\S]*?)(?=^## )/m.exec(text);
  const m = s1 && /^- \*\*Version\*\*:\s*`?"?([0-9][0-9A-Za-z.\-]*)/m.exec(s1[1]);
  return m ? m[1] : null;
}

function parseStamp(path: string, text: string): Stamp | null {
  const lines = text.split(/\r?\n/);
  const found: Stamp[] = [];
  let malformed = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break; // the stamp lives in the header only
    const m = STAMP_RE.exec(lines[i]);
    if (!m) continue;
    const body = m[1].replace(/^`|`$/g, '');
    if (body === STAMP_NOT_BUILT) {
      found.push({ kind: 'not-built', line: i + 1 });
      continue;
    }
    const b = STAMP_BUILT_RE.exec(body);
    if (!b) {
      errors.push(
        `${path}:${i + 1} — malformed stamp "${lines[i]}".\n` +
        `      => write exactly "JSON: pathways/json/<logical_id>.json @ version <version>" or "JSON: (not built)".`,
      );
      malformed = true;
      continue;
    }
    found.push({ kind: 'built', json: b[1], version: b[2].replace(/^"|"$/g, ''), line: i + 1 });
  }
  if (found.length > 1) {
    errors.push(`${path} — ${found.length} stamp lines (lines ${found.map((s) => s.line).join(', ')}); a brief carries exactly one.`);
  }
  if (found.length === 0 && malformed) return { kind: 'not-built', line: 0 }; // already reported
  return found[0] ?? null;
}

const briefPaths = listFiles(BRIEF_DIR, BRIEF_SUFFIX);
const briefs: Brief[] = briefPaths.map((p: string) => {
  let text = '';
  try {
    text = readRepoFile(p);
  } catch (err) {
    errors.push(`${p} — could not read: ${(err as Error).message}`);
  }
  return {
    path: p, id: basename(p).slice(0, -BRIEF_SUFFIX.length),
    stamp: parseStamp(p, text), metaVersion: parseMetaVersion(text),
  };
});

// ── JSONs ─────────────────────────────────────────────────────────────
let jsonPaths: string[] = listFiles(JSON_DIR, '.json');
if (jsonOnlyArg) {
  const rel = relative(root, resolve(jsonOnlyArg)).split(sep).join('/');
  if (!rel.startsWith(`${JSON_DIR}/`)) {
    console.log(`ℹ brief sync skipped — ${jsonOnlyArg} is not under ${JSON_DIR}/ (no brief is expected for it).`);
    process.exit(0);
  }
  jsonPaths = [rel];
}
const jsonSet = new Set(listFiles(JSON_DIR, '.json'));
const STAMP_HINT = (json: string, version: string) => `JSON: ${json} @ version ${version}`;

/** The brief a JSON is described by: a brief stamped with its path, else by filename. */
function briefFor(jsonPath: string, logicalId: string): Brief[] {
  const stamped = briefs.filter((b) => b.stamp?.kind === 'built' && b.stamp.json === jsonPath);
  if (stamped.length > 0) return stamped;
  const byName = briefs.find((b) => b.id === logicalId);
  return byName ? [byName] : [];
}

const checkedBriefs = new Set<string>();
for (const jp of jsonPaths) {
  const fileId = basename(jp, '.json');
  let version = '';
  let logicalId = fileId;
  try {
    const pw = JSON.parse(readRepoFile(jp));
    logicalId = String(pw?.pathway?.logical_id ?? '');
    version = pw?.pathway?.version === undefined ? '' : String(pw.pathway.version).trim();
  } catch (err) {
    errors.push(`${jp} — could not read or parse: ${(err as Error).message}`);
    continue;
  }
  if (logicalId !== fileId) {
    errors.push(`${jp} — pathway.logical_id is "${logicalId}"; the file must be named "${logicalId}.json".`);
  }
  if (!version) {
    errors.push(`${jp} — has no pathway.version, so no brief can stamp it.`);
    continue;
  }
  const found = briefFor(jp, fileId);
  if (found.length === 0) {
    errors.push(
      `${jp} (version ${version}) has NO research brief.\n` +
      `      => every pathway JSON is derived from ${BRIEF_DIR}/${fileId}${BRIEF_SUFFIX}; write or restore it,\n` +
      `         with the stamp line "${STAMP_HINT(jp, version)}".`,
    );
    continue;
  }
  if (found.length > 1) {
    errors.push(`${jp} is stamped by ${found.length} briefs: ${found.map((b) => b.path).join(', ')} — exactly one brief describes a JSON.`);
    continue;
  }
  const b = found[0];
  checkedBriefs.add(b.path);
  if (!b.stamp) {
    errors.push(
      `${b.path} has no stamp, but ${jp} (version ${version}) exists.\n` +
      `      => add "${STAMP_HINT(jp, version)}" to its header (before the first "## "),\n` +
      `         after confirming the brief says what version ${version} of the JSON does.`,
    );
  } else if (b.stamp.kind === 'not-built') {
    if (b.stamp.line > 0) {
      errors.push(
        `${b.path}:${b.stamp.line} says "JSON: (not built)", but ${jp} (version ${version}) exists.\n` +
        `      => stamp it "${STAMP_HINT(jp, version)}" once the brief describes that JSON.`,
      );
    }
  } else if (b.stamp.json !== jp) {
    errors.push(`${b.path}:${b.stamp.line} stamps ${b.stamp.json}, but it is the brief for ${jp}.`);
  } else if (b.stamp.version !== version) {
    errors.push(
      `OUT OF SYNC — ${jp} is version ${version}, but ${b.path}:${b.stamp.line} describes version ${b.stamp.version}.\n` +
      `      => the JSON changed without its brief. Update the brief to say what version ${version} does (decisions\n` +
      `         marked [DECISION — Josh <date>]), then set its stamp to "${STAMP_HINT(jp, version)}".`,
    );
  } else if (b.metaVersion !== null && b.metaVersion !== version) {
    // Stamp bumped, prose not: the header says one version and §1 another.
    errors.push(
      `${b.path} — stamp says version ${version} but §1 "**Version**" says ${b.metaVersion}.\n` +
      `      => update §1 (and say what changed) so the brief describes version ${version}.`,
    );
  }
}

// ── Briefs: stamps that point nowhere, or at the wrong pathway ─────────
if (!jsonOnlyArg) {
  for (const b of briefs) {
    if (!b.stamp) {
      if (!checkedBriefs.has(b.path)) {
        warnings.push(`${b.path} has no stamp (no JSON built yet?) — add "JSON: ${STAMP_NOT_BUILT}" to its header.`);
      }
      continue;
    }
    if (b.stamp.kind !== 'built') continue;
    const stampId = basename(b.stamp.json!, '.json');
    if (stampId !== b.id) {
      errors.push(
        `${b.path}:${b.stamp.line} stamps ${b.stamp.json}, but a brief named "${b.id}${BRIEF_SUFFIX}" describes ` +
        `${JSON_DIR}/${b.id}.json — rename one so they match.`,
      );
    }
    if (!jsonSet.has(b.stamp.json!)) {
      errors.push(
        `${b.path}:${b.stamp.line} stamps ${b.stamp.json} @ version ${b.stamp.version}, but that JSON does not exist` +
        `${staged ? ' in the index' : ''}.\n      => build it, or stamp the brief "JSON: ${STAMP_NOT_BUILT}".`,
      );
    }
  }
}

// ── --staged: a JSON may not be committed without its brief ────────────
if (staged) {
  const changed: string[] = git(['diff', '--cached', '--name-only', '-z', '--no-renames', '--', 'pathways/'], root)
    .split('\0').filter(Boolean);
  const changedSet = new Set(changed);
  for (const jp of changed) {
    if (!jp.startsWith(`${JSON_DIR}/`) || !jp.endsWith('.json') || jp.slice(JSON_DIR.length + 1).includes('/')) continue;
    const fileId = basename(jp, '.json');
    const found = briefFor(jp, fileId);
    // Deleted JSON: its brief is found by name or by a (now dangling) stamp.
    const briefPath = found[0]?.path ?? `${BRIEF_DIR}/${fileId}${BRIEF_SUFFIX}`;
    if (!changedSet.has(briefPath)) {
      errors.push(
        `STAGED WITHOUT ITS BRIEF — ${jp} is staged, but ${briefPath} is not.\n` +
        `      => "We shouldn't change a pathway without updating the doc": edit the brief to describe the\n` +
        `         change (and its stamp, if the version moved), then stage both in this commit.`,
      );
    }
  }
}

for (const w of warnings) console.log(`⚠ ${w}`);
if (errors.length === 0) {
  console.log(
    `✓ BRIEF SYNC OK — ${jsonPaths.length} pathway JSON(s) match their brief's stamp` +
    `${staged ? ' (index)' : ''}, ${warnings.length} warning(s)`,
  );
  process.exit(0);
}
console.log(`✗ BRIEF SYNC — ${errors.length} problem(s)${staged ? ' (index)' : ''}:`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(1);
