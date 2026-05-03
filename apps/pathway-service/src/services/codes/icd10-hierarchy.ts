import { Pool, PoolClient } from 'pg';

/**
 * Returns all descendant codes of `code` in the ICD-10 hierarchy, NOT including
 * `code` itself. Empty array if the code doesn't exist or has no descendants.
 *
 * Uses the GIST index on icd10_codes.path. Sub-millisecond on the seeded ~600
 * codes; scales to the full CMS code set.
 */
export async function findDescendants(pool: Pool, code: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT child.code
       FROM icd10_codes child
       JOIN icd10_codes parent ON child.path <@ parent.path
      WHERE parent.code = $1
        AND child.code != $1
      ORDER BY child.code`,
    [code],
  );
  return result.rows.map((r) => r.code as string);
}

/**
 * Returns all ancestor codes of `code` in the ICD-10 hierarchy, NOT including
 * `code` itself. Empty array if the code doesn't exist or is a 3-char root.
 */
export async function findAncestors(pool: Pool, code: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT ancestor.code
       FROM icd10_codes leaf
       JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
      WHERE leaf.code = $1
        AND ancestor.code != $1
      ORDER BY ancestor.code`,
    [code],
  );
  return result.rows.map((r) => r.code as string);
}

/**
 * Returns the input codes plus all descendants of each input. Codes not found
 * in the hierarchy table are passed through unchanged (treat unknown codes as
 * leaves with no descendants). Result is deduplicated.
 *
 * This is the primary helper consumed by ontology-aware matching: given a
 * patient's codes, expand each one to its full subtree so that pathways
 * declared at a parent level (e.g., requires E11) automatically match patients
 * with a more specific child code (e.g., E11.65).
 */
export async function expandWithDescendants(
  pool: Pool,
  codes: string[],
): Promise<string[]> {
  if (codes.length === 0) return [];

  const result = await pool.query(
    `SELECT DISTINCT child.code
       FROM icd10_codes child
       JOIN icd10_codes parent ON child.path <@ parent.path
      WHERE parent.code = ANY($1::text[])`,
    [codes],
  );

  const expanded = new Set<string>(result.rows.map((r) => r.code as string));
  for (const c of codes) expanded.add(c); // Pass-through codes not in hierarchy
  return [...expanded];
}

/**
 * Returns the input codes plus all ancestors of each input. Codes not found
 * in the hierarchy table are passed through unchanged. Result is deduplicated.
 *
 * Use case: a pathway declares "requires E11.65" and you want to also match it
 * against patients who only have the broader E11 code on file. Reverse-direction
 * expansion of the patient's coding granularity.
 */
export async function expandWithAncestors(
  pool: Pool,
  codes: string[],
): Promise<string[]> {
  if (codes.length === 0) return [];

  const result = await pool.query(
    `SELECT DISTINCT ancestor.code
       FROM icd10_codes leaf
       JOIN icd10_codes ancestor ON leaf.path <@ ancestor.path
      WHERE leaf.code = ANY($1::text[])`,
    [codes],
  );

  const expanded = new Set<string>(result.rows.map((r) => r.code as string));
  for (const c of codes) expanded.add(c);
  return [...expanded];
}

// ─── Write side ──────────────────────────────────────────────────────

/**
 * Derive the parent ICD-10 code from a child via dot-notation length rule.
 * Mirrors the SQL function `icd10_parent`. Exposed for tests; production code
 * should prefer the SQL function inside transactions.
 */
export function derivedParent(code: string): string | null {
  if (code.length <= 3) return null;
  if (code.length === 5) return code.substring(0, 3);
  return code.substring(0, code.length - 1);
}

/** Convert an ICD-10 code into a valid ltree label (dots → underscores). */
export function labelize(code: string): string {
  return code.replace(/\./g, '_');
}

interface ConditionCodeInput {
  code: string;
  system: string;
  description?: string;
}

/**
 * Ensure every ICD-10 code in `conditionCodes` exists in `icd10_codes`. For any
 * code not present, walks up the parent chain inserting missing intermediates
 * (synthetic stubs flagged in their description) until it hits an existing
 * ancestor or a 3-char root. Inserts top-down so the parent_code FK is always
 * satisfied. Idempotent via ON CONFLICT.
 *
 * Non-ICD-10 codes are silently ignored — only ICD-10 has hierarchy.
 *
 * MUST run inside the same transaction as writeConditionCodes so a failure
 * rolls back both the pathway and any partial hierarchy additions.
 */
export async function ensureIcd10Codes(
  client: PoolClient,
  conditionCodes: ConditionCodeInput[],
): Promise<void> {
  const icd10 = conditionCodes.filter((cc) => cc.system === 'ICD-10');
  if (icd10.length === 0) return;

  for (const cc of icd10) {
    await ensureSingleCode(client, cc.code, cc.description);
  }
}

async function ensureSingleCode(
  client: PoolClient,
  code: string,
  description: string | undefined,
): Promise<void> {
  // Walk up from the requested code, collecting any ancestors not already
  // present. Stop when we hit an existing ancestor or NULL (root).
  type ChainEntry = { code: string; isOriginal: boolean };
  const chain: ChainEntry[] = [];
  let current: string | null = code;

  while (current !== null) {
    const exists = await client.query(
      `SELECT 1 FROM icd10_codes WHERE code = $1`,
      [current],
    );
    if ((exists.rowCount ?? 0) > 0) break;
    chain.push({ code: current, isOriginal: current === code });
    current = derivedParent(current);
  }

  if (chain.length === 0) return; // Already present; nothing to do.

  // Track paths we've just inserted so subsequent rows in this chain can
  // reference their parent's path without a DB roundtrip. Only fetch from DB
  // for parents that pre-existed (i.e., the chain was truncated by a real hit).
  const insertedPaths = new Map<string, string>();

  // Insert top-down so each row's parent_code is already in the table.
  for (const entry of chain.reverse()) {
    const parent = derivedParent(entry.code);
    const cat = entry.code.length >= 3 ? entry.code.substring(0, 3) : entry.code;
    const desc =
      entry.isOriginal && description
        ? description
        : entry.isOriginal
          ? `<auto-added from pathway upload>`
          : `<auto-added parent of ${code}>`;

    let pathLiteral: string;
    if (parent === null) {
      pathLiteral = labelize(entry.code);
    } else if (insertedPaths.has(parent)) {
      pathLiteral = `${insertedPaths.get(parent)}.${labelize(entry.code)}`;
    } else {
      // Parent was pre-existing — look up its path from the DB.
      const parentRow = await client.query(
        `SELECT path::text AS path FROM icd10_codes WHERE code = $1`,
        [parent],
      );
      const parentPath: string | undefined = parentRow.rows[0]?.path;
      if (!parentPath) {
        throw new Error(
          `ensureIcd10Codes: parent path missing for ${entry.code} (parent=${parent})`,
        );
      }
      pathLiteral = `${parentPath}.${labelize(entry.code)}`;
    }

    insertedPaths.set(entry.code, pathLiteral);

    await client.query(
      `INSERT INTO icd10_codes
         (code, description, category, category_description, is_billable, parent_code, path)
       VALUES ($1, $2, $3, $4, $5, $6, $7::ltree)
       ON CONFLICT (code) DO NOTHING`,
      [entry.code, desc, cat, cat, entry.isOriginal, parent, pathLiteral],
    );
  }
}
