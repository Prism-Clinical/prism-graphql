import { PoolClient } from 'pg';
import {
  PathwayMetadata,
  ConditionCodeDefinition,
  CodeSetDefinition,
  CodeSetMemberDefinition,
  ImportMode,
  ImportDiffSummary,
  DiffDetail,
} from './types';

/**
 * Insert a row into pathway_graph_index. Returns the inserted row.
 */
export async function writePathwayIndex(
  client: PoolClient,
  meta: PathwayMetadata,
  ageNodeId: string | null,
  userId: string
): Promise<{ id: string }> {
  const conditionCodesArray = meta.condition_codes.map(cc => cc.code);

  const result = await client.query(
    `INSERT INTO pathway_graph_index
      (age_node_id, logical_id, title, version, category, condition_codes, scope, target_population, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      ageNodeId,
      meta.logical_id,
      meta.title,
      meta.version,
      meta.category,
      conditionCodesArray,
      meta.scope || null,
      meta.target_population || null,
      userId,
    ]
  );

  return result.rows[0];
}

/**
 * Insert rows into pathway_condition_codes for a given pathway.
 * Uses a single multi-row INSERT to minimize round-trips within the transaction.
 */
export async function writeConditionCodes(
  client: PoolClient,
  pathwayId: string,
  conditionCodes: ConditionCodeDefinition[]
): Promise<void> {
  if (conditionCodes.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < conditionCodes.length; i++) {
    const cc = conditionCodes[i];
    const offset = i * 6;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    values.push(pathwayId, cc.code, cc.system, cc.description || null, cc.usage || null, cc.grouping || null);
  }

  await client.query(
    `INSERT INTO pathway_condition_codes
      (pathway_id, code, system, description, usage, grouping)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

/**
 * Insert a row into pathway_version_diffs to record the import audit trail.
 */
export async function writeVersionDiff(
  client: PoolClient,
  pathwayId: string,
  previousPathwayId: string | null,
  importType: ImportMode,
  summary: ImportDiffSummary,
  details: DiffDetail[],
  userId: string
): Promise<void> {
  await client.query(
    `INSERT INTO pathway_version_diffs
      (pathway_id, previous_pathway_id, import_type, diff_summary, diff_details, imported_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [pathwayId, previousPathwayId, importType, JSON.stringify(summary), JSON.stringify(details), userId]
  );
}

/**
 * Delete condition codes for a pathway (used during DRAFT_UPDATE to replace them).
 */
export async function deleteConditionCodes(
  client: PoolClient,
  pathwayId: string
): Promise<void> {
  await client.query('DELETE FROM pathway_condition_codes WHERE pathway_id = $1', [pathwayId]);
}

// ─── Phase 1b: code-set writers ─────────────────────────────────────

/**
 * Build the effective code-set list to persist for a pathway:
 *   - If meta.code_sets is non-empty, use it directly.
 *   - Otherwise, synthesize one single-element set per condition_code
 *     (legacy disjunction semantic preserved).
 */
function effectiveCodeSets(meta: PathwayMetadata): CodeSetDefinition[] {
  if (meta.code_sets && meta.code_sets.length > 0) {
    return meta.code_sets;
  }
  return synthesizeFromConditionCodes(meta.condition_codes);
}

function synthesizeFromConditionCodes(
  codes: ConditionCodeDefinition[]
): CodeSetDefinition[] {
  return codes.map((cc) => ({
    description: cc.description,
    scope: 'EXACT',
    required_codes: [
      {
        code: cc.code,
        system: cc.system,
        description: cc.usage,
      } as CodeSetMemberDefinition,
    ],
  }));
}

/**
 * Insert pathway_code_sets and pathway_code_set_members rows for a pathway.
 *
 * If `meta.code_sets` is provided, writes those directly. Otherwise synthesizes
 * one single-element set per `condition_codes` entry — preserves the legacy
 * "any code matches" behavior under set-based matching.
 */
export async function writeCodeSets(
  client: PoolClient,
  pathwayId: string,
  meta: PathwayMetadata
): Promise<void> {
  const sets = effectiveCodeSets(meta);
  if (sets.length === 0) return;

  for (const setDef of sets) {
    const setResult = await client.query(
      `INSERT INTO pathway_code_sets
        (pathway_id, scope, semantics, entry_node_id, description)
       VALUES ($1, $2, 'ALL_OF', $3, $4)
       RETURNING id`,
      [
        pathwayId,
        setDef.scope ?? 'EXACT',
        setDef.entry_node_id ?? null,
        setDef.description ?? null,
      ]
    );
    const setId = setResult.rows[0].id;

    if (setDef.required_codes.length === 0) continue;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < setDef.required_codes.length; i++) {
      const m = setDef.required_codes[i];
      const offset = i * 5;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`
      );
      values.push(
        setId,
        m.code,
        m.system,
        m.scope_override ?? null,
        m.description ?? null,
      );
    }

    await client.query(
      `INSERT INTO pathway_code_set_members
        (code_set_id, code, system, scope_override, description)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (code_set_id, code, system) DO NOTHING`,
      values
    );
  }
}

/**
 * Delete all code sets (and their members via CASCADE) for a pathway.
 * Used during DRAFT_UPDATE to replace them.
 */
export async function deleteCodeSets(
  client: PoolClient,
  pathwayId: string
): Promise<void> {
  await client.query(
    'DELETE FROM pathway_code_sets WHERE pathway_id = $1',
    [pathwayId]
  );
}

/**
 * Update a pathway_graph_index row (for DRAFT_UPDATE mode).
 * Note: logical_id and version are NOT updated — DRAFT_UPDATE is version-preserving
 * by design. The orchestrator already verified (logical_id, version) match before calling.
 */
export async function updatePathwayIndex(
  client: PoolClient,
  pathwayId: string,
  meta: PathwayMetadata,
  ageNodeId: string | null
): Promise<{ id: string }> {
  const conditionCodesArray = meta.condition_codes.map(cc => cc.code);

  const result = await client.query(
    `UPDATE pathway_graph_index
     SET age_node_id = $1, title = $2, condition_codes = $3, scope = $4,
         target_population = $5, category = $6
     WHERE id = $7
     RETURNING *`,
    [ageNodeId, meta.title, conditionCodesArray, meta.scope || null, meta.target_population || null, meta.category, pathwayId]
  );

  return result.rows[0];
}
