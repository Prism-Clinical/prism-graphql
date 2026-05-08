/**
 * One-time migration: backfill `clinical_code_reference` from existing
 * pathways so the searchCodes typeahead surfaces every code that's
 * actually attached to a pathway today.
 *
 * Sources:
 *   - pathway_code_set_members (pathway-level condition codes)
 *   - AGE CodeEntry nodes (node-level codes)
 *
 * Idempotent: ON CONFLICT (code, system) preserves the existing
 * description if it's already non-empty (curated entries beat auto-added).
 *
 * Usage:
 *   npx ts-node migrations/003_backfill_clinical_code_reference.ts
 */

import { Pool, PoolClient } from 'pg';
import { executeCypher } from '../src/services/age-client';
import {
  ensureClinicalCodeReference,
  type ClinicalCodeRef,
} from '../src/services/codes/clinical-code-reference';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  pool.on('connect', (client: PoolClient) => {
    client
      .query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public;")
      .catch((err) => console.error('AGE load failed:', err));
  });

  const client = await pool.connect();
  try {
    // --- 1. Pull pathway-level condition codes ---
    const memberRows = await client.query<{
      code: string;
      system: string;
      description: string | null;
    }>(`SELECT code, system, description FROM pathway_code_set_members`);

    const fromMembers: ClinicalCodeRef[] = memberRows.rows.map((r) => ({
      code: r.code,
      system: r.system,
      description: r.description ?? undefined,
    }));
    console.log(`pathway_code_set_members: ${fromMembers.length} rows`);

    // --- 2. Pull node-level codes from AGE CodeEntry nodes ---
    const cypher = `MATCH (c:CodeEntry) RETURN c.code AS code, c.system AS system, c.description AS description`;
    const ageResult = await executeCypher(
      pool,
      cypher,
      '(code agtype, system agtype, description agtype)',
    );

    const fromAge: ClinicalCodeRef[] = [];
    for (const row of ageResult.rows) {
      const code = parseAgString(row.code);
      const system = parseAgString(row.system);
      const description = parseAgString(row.description);
      if (code && system) {
        fromAge.push({ code, system, description: description ?? undefined });
      }
    }
    console.log(`AGE CodeEntry nodes: ${fromAge.length} rows`);

    // --- 3. Upsert all into clinical_code_reference ---
    const all = [...fromMembers, ...fromAge];
    await ensureClinicalCodeReference(client, all);
    console.log(`Upserted ${all.length} code records (deduped inside writer).`);

    // --- 4. Sanity check ---
    const after = await client.query<{ count: string }>(
      `SELECT count(*)::text FROM clinical_code_reference WHERE description = '<auto-added from pathway upload>'`,
    );
    console.log(`Auto-added rows in clinical_code_reference: ${after.rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

function parseAgString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = typeof val === 'string' ? val : String(val);
  // AGE returns strings as JSON-quoted (e.g. "\"O99.011\"")
  const cleaned = str.replace(/::(?:vertex|edge)$/, '').trim();
  if (cleaned === 'null' || cleaned === '') return null;
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return cleaned;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
