/**
 * A table-level in-memory stand-in for the relational side of a pathway
 * import: pathway_graph_index, pathway_code_sets, pathway_code_set_members.
 *
 * It answers exactly the statements importPathway (DRAFT_UPDATE, NEW_VERSION,
 * NEW_PATHWAY), reconstructPathwayJson and Query.pathwayGraph issue, so a test
 * can import, read back through the resolver, and re-import against the same
 * stored rows. Cypher is stubbed the way import-orchestrator.test.ts stubs it
 * (one fake AGE id; the edge-count integrity check reads `expectedEdgeCount`).
 * Anything it does not recognise throws, so a new statement cannot silently
 * read back as empty.
 */
import { PathwayJson } from '../../services/import/types';

export interface IndexRow {
  id: string;
  age_node_id: string | null;
  logical_id: string;
  title: string;
  version: string;
  category: string;
  status: string;
  condition_codes: string[];
  scope: string | null;
  target_population: string | null;
  is_active: boolean;
  created_by: string;
  created_at: number;
  updated_at: number;
  /** Held parsed, the way node-postgres returns JSONB. */
  temporal_defaults: unknown;
}

export interface SetRow {
  id: string;
  pathway_id: string;
  scope: string;
  semantics: 'ALL_OF';
  entry_node_id: string | null;
  description: string | null;
}

export interface MemberRow {
  id: string;
  code_set_id: string;
  code: string;
  system: string;
  scope_override: string | null;
  description: string | null;
}

interface Tables {
  index: IndexRow[];
  sets: SetRow[];
  members: MemberRow[];
}

export class FakePathwayStore {
  tables: Tables = { index: [], sets: [], members: [] };
  /** Edge count the post-write integrity check will read back. */
  expectedEdgeCount = 0;
  /** Return code-set rows in reverse storage order (ordering tests). */
  reverseSetRows = false;
  /** Every statement seen, for SQL-shape assertions. */
  statements: Array<{ text: string; values: unknown[] }> = [];

  private seq = 0;
  private clock = 0;
  private snapshot: Tables | null = null;

  private nextId(prefix: string): string {
    this.seq++;
    return `${prefix}-${String(this.seq).padStart(6, '0')}`;
  }

  /** A pg Pool look-alike: `connect()` for the importer, `query()` for resolvers. */
  get pool(): any {
    const client = { query: this.query, release: (): void => undefined };
    return { connect: async () => client, query: this.query };
  }

  /** Arm the integrity check for the JSON about to be imported. */
  expectEdgesOf(json: PathwayJson): void {
    this.expectedEdgeCount = new Set(json.edges.map((e) => `${e.from} ${e.type} ${e.to}`)).size;
  }

  indexRow(logicalId: string, version: string): IndexRow {
    const row = this.tables.index.find((r) => r.logical_id === logicalId && r.version === version);
    if (!row) throw new Error(`no index row for ${logicalId}@${version}`);
    return row;
  }

  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> = async (text, values = []) => {
    this.statements.push({ text, values });
    const sql = text.replace(/\s+/g, ' ').trim();
    const t = this.tables;

    if (sql === 'BEGIN') {
      this.snapshot = JSON.parse(JSON.stringify(t));
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      this.snapshot = null;
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      if (this.snapshot) this.tables = this.snapshot;
      this.snapshot = null;
      return { rows: [] };
    }
    if (sql.startsWith('LOAD') || sql.startsWith('SET search_path')) return { rows: [] };

    if (sql.includes('cypher(')) {
      if (sql.includes('count(r)') || sql.includes('(c agtype)')) {
        return { rows: [{ c: String(this.expectedEdgeCount) }] };
      }
      if (sql.includes('(bid agtype)')) return { rows: [] };
      if (sql.includes('(a agtype, r agtype, b agtype)') || sql.includes('(af agtype')) return { rows: [] };
      return { rows: [{ v: JSON.stringify({ id: 123456 }) }] };
    }

    // ── pathway_graph_index ──────────────────────────────────────────
    if (sql.startsWith('INSERT INTO pathway_graph_index')) {
      const [ageNodeId, logicalId, title, version, category, codes, scope, targetPop, createdBy, temporal] =
        values as [string | null, string, string, string, string, string[], string | null, string | null, string, string | null | undefined];
      const row: IndexRow = {
        id: this.nextId('pw'),
        age_node_id: ageNodeId,
        logical_id: logicalId,
        title,
        version,
        category,
        status: 'DRAFT',
        condition_codes: [...codes],
        scope,
        target_population: targetPop,
        is_active: false,
        created_by: createdBy,
        created_at: ++this.clock,
        updated_at: this.clock,
        temporal_defaults: temporal == null ? null : JSON.parse(temporal),
      };
      t.index.push(row);
      return { rows: [{ ...row }] };
    }
    if (sql.startsWith('UPDATE pathway_graph_index SET age_node_id = $1')) {
      const [ageNodeId, title, codes, scope, targetPop, category, id] = values as any[];
      const row = t.index.find((r) => r.id === id);
      if (!row) return { rows: [] };
      Object.assign(row, {
        age_node_id: ageNodeId, title, condition_codes: [...codes], scope,
        target_population: targetPop, category, updated_at: ++this.clock,
      });
      return { rows: [{ ...row }] };
    }
    if (sql.startsWith('SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2')) {
      return { rows: t.index.filter((r) => r.logical_id === values[0] && r.version === values[1]).map((r) => ({ id: r.id, status: r.status })) };
    }
    if (sql.startsWith('SELECT id, status, temporal_defaults FROM pathway_graph_index WHERE logical_id = $1 ORDER BY created_at DESC LIMIT 1')) {
      const rows = t.index.filter((r) => r.logical_id === values[0]).sort((a, b) => b.created_at - a.created_at).slice(0, 1);
      return { rows: rows.map((r) => ({ id: r.id, status: r.status, temporal_defaults: r.temporal_defaults })) };
    }
    if (sql.startsWith('SELECT age_node_id FROM pathway_graph_index WHERE id = $1')) {
      return { rows: t.index.filter((r) => r.id === values[0]).map((r) => ({ age_node_id: r.age_node_id })) };
    }
    if (sql.startsWith('SELECT * FROM pathway_graph_index WHERE id = $1')) {
      return { rows: t.index.filter((r) => r.id === values[0]).map((r) => ({ ...r })) };
    }
    // Query.ts PATHWAY_COLUMNS projection (camelCase aliases).
    if (sql.startsWith('SELECT id, age_node_id AS "ageNodeId"') && sql.includes('FROM pathway_graph_index WHERE id = $1')) {
      return {
        rows: t.index.filter((r) => r.id === values[0]).map((r) => ({
          id: r.id, ageNodeId: r.age_node_id, logicalId: r.logical_id, title: r.title,
          version: r.version, category: r.category, status: r.status,
          conditionCodes: [...r.condition_codes], scope: r.scope,
          targetPopulation: r.target_population, isActive: r.is_active,
          createdAt: r.created_at, updatedAt: r.updated_at,
        })),
      };
    }

    // ── code sets ────────────────────────────────────────────────────
    if (sql.startsWith('DELETE FROM pathway_code_sets WHERE pathway_id = $1')) {
      const gone = new Set(t.sets.filter((s) => s.pathway_id === values[0]).map((s) => s.id));
      t.sets = t.sets.filter((s) => !gone.has(s.id));
      t.members = t.members.filter((m) => !gone.has(m.code_set_id)); // ON DELETE CASCADE
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO pathway_code_sets')) {
      const [pathwayId, scope, entry, description] = values as [string, string, string | null, string | null];
      const row: SetRow = {
        id: this.nextId('set'), pathway_id: pathwayId, scope, semantics: 'ALL_OF',
        entry_node_id: entry, description,
      };
      t.sets.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('INSERT INTO pathway_code_set_members')) {
      if (!sql.includes('ON CONFLICT (code_set_id, code, system) DO NOTHING')) {
        throw new Error('member insert without its conflict clause');
      }
      for (let i = 0; i < values.length; i += 5) {
        const [setId, code, system, scopeOverride, description] = values.slice(i, i + 5) as [string, string, string, string | null, string | null];
        if (t.members.some((m) => m.code_set_id === setId && m.code === code && m.system === system)) continue;
        t.members.push({
          id: this.nextId('mem'), code_set_id: setId, code, system,
          scope_override: scopeOverride, description,
        });
      }
      return { rows: [] };
    }
    // The aggregate read shared by reconstructPathwayJson and loadPathwayCodeSets.
    if (sql.includes('FROM pathway_code_sets cs LEFT JOIN pathway_code_set_members m') && sql.includes('WHERE cs.pathway_id = $1')) {
      let sets = t.sets.filter((s) => s.pathway_id === values[0]);
      if (this.reverseSetRows) sets = [...sets].reverse();
      return {
        rows: sets.map((s) => {
          let members = t.members.filter((m) => m.code_set_id === s.id);
          if (this.reverseSetRows) members = [...members].reverse();
          return {
            id: s.id, set_id: s.id, scope: s.scope, entry_node_id: s.entry_node_id,
            description: s.description,
            members: members.map((m) => ({
              code: m.code, system: m.system, scope_override: m.scope_override, description: m.description,
            })),
          };
        }),
      };
    }

    // ── side tables the importer touches but these tests do not read ──
    if (sql.startsWith('SELECT 1 FROM icd10_codes')) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith('INSERT INTO clinical_code_reference')) return { rows: [] };
    if (sql.startsWith('INSERT INTO pathway_version_diffs')) return { rows: [] };

    throw new Error(`FakePathwayStore: unhandled statement: ${sql.slice(0, 160)}`);
  };

  /**
   * The stored code sets of one pathway with storage ids removed, members and
   * sets sorted — i.e. what "the same code sets" means across a re-import.
   */
  storedCodeSets(pathwayId: string): Array<{
    scope: string; semantics: string; entry_node_id: string | null; description: string | null;
    members: Array<{ code: string; system: string; scope_override: string | null; description: string | null }>;
  }> {
    const t = this.tables;
    return t.sets
      .filter((s) => s.pathway_id === pathwayId)
      .map((s) => ({
        scope: s.scope,
        semantics: s.semantics,
        entry_node_id: s.entry_node_id,
        description: s.description,
        members: t.members
          .filter((m) => m.code_set_id === s.id)
          .map(({ code, system, scope_override, description }) => ({ code, system, scope_override, description }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
}
