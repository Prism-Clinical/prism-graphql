// .claude/skills/pathway-json-builder/scripts/validate-pathway.ts
//
// Thin CLI over the REAL import validator in apps/pathway-service. This is
// deliberately not a reimplementation: it imports `validatePathwayJson` from
// the service source so a pathway JSON that passes here is guaranteed to pass
// the same code the import endpoint runs. When the schema evolves on main,
// this CLI picks the changes up automatically.
//
// Usage (from the repo root, no build step needed — Node 23+ runs TS natively):
//   node .claude/skills/pathway-json-builder/scripts/validate-pathway.ts <file.json>
//
// Exit codes: 0 = valid, 1 = invalid, 2 = could not read/parse the file.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validatePathwayJson } from '../../../../apps/pathway-service/src/services/import/validator';
import type { PathwayJson } from '../../../../apps/pathway-service/src/services/import/types';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node validate-pathway.ts <pathway.json>');
  process.exit(2);
}

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

if (result.valid) {
  console.log(`✓ VALID — ${parsed.nodes?.length ?? 0} nodes, ${parsed.edges?.length ?? 0} edges (${result.warnings.length} warnings)`);
  process.exit(0);
} else {
  console.log(`✗ INVALID — ${result.errors.length} error(s):`);
  for (const e of result.errors) console.log(`  - ${e}`);
  process.exit(1);
}
