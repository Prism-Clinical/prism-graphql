// apps/pathway-service/src/services/compiler/cache.ts
import { hashOf } from '../resolution/pipeline/canonical';
import { compilePathway } from './compile';
import { COMPILER_VERSION, CompileInput, CompileResult } from './model';

/** Draft autosaves produce many content revisions, so the cache is bounded. Map insertion order is the recency order. */
export const COMPILE_CACHE_CAPACITY = 256;
const cache = new Map<string, CompileResult>();

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** Content key: order-insensitive for nodes and edges (compilation is order-independent too). */
function keyOf(input: CompileInput): string {
  const p = input.pathway;
  return hashOf({
    v: COMPILER_VERSION,
    pathway: {
      ...p,
      nodes: [...(p.nodes ?? [])].sort((a, b) => compare(a.id, b.id)),
      edges: [...(p.edges ?? [])].sort((a, b) => compare(`${a.from}|${a.to}|${a.type}`, `${b.from}|${b.to}|${b.type}`)),
    },
    codeMap: input.codeMap,
    temporalDefaults: input.temporalDefaults,
  });
}

/** Compile once per distinct content; results are frozen (Task 5), so sharing them is safe. */
export function compileCached(input: CompileInput): CompileResult {
  const key = keyOf(input);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const result = compilePathway(input);
  if (result.ok === false) {
    // eslint-disable-next-line no-console
    console.warn(`[compiler] ${input.pathway.pathway?.logical_id}@${input.pathway.pathway?.version} does not compile: ${result.errors.length} error(s)`);
  }
  cache.set(key, result);
  if (cache.size > COMPILE_CACHE_CAPACITY) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Test hook. */
export const compileCacheSize = (): number => cache.size;
