import type { Pool } from 'pg';
import { AttributeCodeEntry, AttributeCodeMap } from './types';

export function buildCodeMap(rows: AttributeCodeEntry[]): AttributeCodeMap {
  const map: AttributeCodeMap = new Map();
  for (const r of rows) map.set(r.attributeName, r);
  return map;
}

/**
 * Read the code map. No cache: evaluation calls this inside its snapshot
 * transaction (EP C4), so the map is consistent with everything else the
 * mutation reads, and an added row is visible to the next request.
 */
export async function loadAttributeCodeMap(pool: Pick<Pool, 'query'>): Promise<AttributeCodeMap> {
  const { rows } = await pool.query(
    `SELECT attribute_name, namespace, system, code, value_type
       FROM pathway_attribute_code_map`,
  );
  return buildCodeMap(
    rows.map((r): AttributeCodeEntry => ({
      attributeName: r.attribute_name,
      namespace: r.namespace,
      system: r.system,
      code: r.code,
      valueType: r.value_type,
    })),
  );
}
