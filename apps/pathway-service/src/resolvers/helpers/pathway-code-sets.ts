import type { CodeSetScope } from '../../services/import/types';

/**
 * A pathway's stored code sets, read back for `PathwayGraph.codeSets`.
 *
 * The shape is the pathway-JSON import vocabulary (`pathway.code_sets[]`) in
 * camelCase, so an editor that opened the pathway from the database can send
 * the sets straight back as `code_sets` on its next DRAFT_UPDATE /
 * NEW_VERSION. Without them it has to send condition_codes alone, and the
 * importer replaces the stored sets with one single-code set per condition
 * code (relational-writer.ts effectiveCodeSets): an ALL_OF set ("these codes
 * together") silently becomes OR.
 *
 * Ordering is by content, not storage. Set ids are random UUIDs and every
 * set of one import shares a transaction-level created_at, so neither can
 * order anything; the authored order was never stored. Sorting members by
 * (code, system) and sets by their members, then scope / entry node /
 * description, gives the same answer for the same stored content every time.
 * The id is the last key only so identical sets tie deterministically; it
 * never changes the order of sets that differ.
 */
export interface StoredCodeSetMember {
  code: string;
  system: string;
  scopeOverride: CodeSetScope | null;
  description: string | null;
}

export interface StoredCodeSet {
  id: string;
  description: string | null;
  scope: CodeSetScope;
  entryNodeId: string | null;
  requiredCodes: StoredCodeSetMember[];
}

/** The legacy flattened row: one per (set, member). */
export interface ConditionCodeDetailRow {
  code: string;
  system: string;
  /** The set's description. */
  description: string | null;
  /** The member's description. */
  usage: string | null;
  /** Never stored — always null. */
  grouping: null;
}

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}

export async function loadPathwayCodeSets(
  db: Queryable,
  pathwayId: string,
): Promise<StoredCodeSet[]> {
  const result = await db.query(
    `SELECT cs.id, cs.scope, cs.entry_node_id, cs.description,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'code', m.code,
                  'system', m.system,
                  'scope_override', m.scope_override,
                  'description', m.description
                )
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'::jsonb
            ) AS members
       FROM pathway_code_sets cs
       LEFT JOIN pathway_code_set_members m ON m.code_set_id = cs.id
      WHERE cs.pathway_id = $1
      GROUP BY cs.id, cs.scope, cs.entry_node_id, cs.description`,
    [pathwayId],
  );

  const sets: StoredCodeSet[] = result.rows.map((row) => {
    const members = (row.members ?? []) as Array<{
      code: string;
      system: string;
      scope_override: CodeSetScope | null;
      description: string | null;
    }>;
    return {
      id: String(row.id),
      description: row.description ?? null,
      scope: row.scope as CodeSetScope,
      entryNodeId: row.entry_node_id ?? null,
      requiredCodes: members
        .map((m) => ({
          code: m.code,
          system: m.system,
          scopeOverride: m.scope_override ?? null,
          description: m.description ?? null,
        }))
        .sort((a, b) => compareKeys([a.code, a.system], [b.code, b.system])),
    };
  });

  return sets.sort((a, b) => compareKeys(setSortKey(a), setSortKey(b)));
}

/** Flatten sets into the legacy `ConditionCodeDetail` rows, in set order. */
export function flattenCodeSets(sets: StoredCodeSet[]): ConditionCodeDetailRow[] {
  return sets.flatMap((set) =>
    set.requiredCodes.map((m): ConditionCodeDetailRow => ({
      code: m.code,
      system: m.system,
      description: set.description,
      usage: m.description,
      grouping: null,
    })),
  );
}

function setSortKey(set: StoredCodeSet): string[] {
  return [
    ...set.requiredCodes.flatMap((m) => [m.code, m.system, m.scopeOverride ?? '', m.description ?? '']),
    // Separates "fewer members" from "more members" after a shared prefix.
    '\u0000',
    set.scope,
    set.entryNodeId ?? '',
    set.description ?? '',
    set.id,
  ];
}

/** Lexicographic, code-unit order (locale-independent). */
function compareKeys(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}
