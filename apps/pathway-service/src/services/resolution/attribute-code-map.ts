import type { Pool } from 'pg';
import { AttributeCodeEntry, AttributeCodeMap } from './types';

let cache: AttributeCodeMap | null = null;

export function buildCodeMap(rows: AttributeCodeEntry[]): AttributeCodeMap {
  const map: AttributeCodeMap = new Map();
  for (const r of rows) map.set(r.attributeName, r);
  return map;
}

export async function loadAttributeCodeMap(pool: Pool): Promise<AttributeCodeMap> {
  if (cache) return cache;
  const { rows } = await pool.query(
    `SELECT attribute_name, namespace, system, code, value_type
       FROM pathway_attribute_code_map`,
  );
  cache = buildCodeMap(
    rows.map((r): AttributeCodeEntry => ({
      attributeName: r.attribute_name,
      namespace: r.namespace,
      system: r.system,
      code: r.code,
      valueType: r.value_type,
    })),
  );
  return cache;
}

/** Test hook — clears the process-wide cache. */
export function __resetAttributeCodeMapCache(): void {
  cache = null;
}
