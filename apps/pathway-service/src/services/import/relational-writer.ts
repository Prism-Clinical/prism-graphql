import { PoolClient } from 'pg';
import {
  PathwayMetadata,
  ConditionCodeDefinition,
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
 */
export async function writeConditionCodes(
  client: PoolClient,
  pathwayId: string,
  conditionCodes: ConditionCodeDefinition[]
): Promise<void> {
  for (const cc of conditionCodes) {
    await client.query(
      `INSERT INTO pathway_condition_codes
        (pathway_id, code, system, description, usage, grouping)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pathwayId, cc.code, cc.system, cc.description || null, cc.usage || null, cc.grouping || null]
    );
  }
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
